/**
 * Supply forecast cloud sync — shared catalog + per-event forecasts.
 * localStorage remains a write-through cache for faster boots / offline reads.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from './firebase.js?v=32';
import { newId, defaultState, normalizeEventServiceType, normalizeNeedBufferPct } from './defaults.js?v=32';
import { normalizeState, readLocalBundle, writeLocalBundle } from './store.js?v=32';

/** @typedef {import('./defaults.js').ForecastState} ForecastState */

const CATALOG_PATH = ['supplyForecast', 'catalog'];
const META_PATH = ['supplyForecast', 'meta'];
const EVENTS_COLLECTION = 'supplyForecastEvents';

/** @type {'saved'|'saving'|'offline'|'error'} */
let syncStatus = 'saved';
/** @type {((status: string) => void)|null} */
let onStatusChange = null;
/** @type {((state: ForecastState) => void)|null} */
let onRemoteState = null;
/** @type {number} */
let lastWriteAt = 0;
/** @type {(() => void)|null} */
let unsubCatalog = null;
/** @type {(() => void)|null} */
let unsubEvent = null;
/** @type {(() => void)|null} */
let unsubMeta = null;
/** @type {string|null} */
let listeningEventId = null;

let catalogTimer = null;
let eventTimer = null;
/** @type {object|null} */
let pendingCatalog = null;
/** @type {object|null} */
let pendingEvent = null;

function catalogRef() {
  return doc(db, ...CATALOG_PATH);
}

function metaRef() {
  return doc(db, ...META_PATH);
}

function eventRef(eventId) {
  return doc(db, EVENTS_COLLECTION, eventId);
}

function eventsCollection() {
  return collection(db, EVENTS_COLLECTION);
}

function stripUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

function setStatus(status) {
  syncStatus = status;
  onStatusChange?.(status);
}

function remoteUpdatedAt(data) {
  const raw = data?.updatedAt;
  if (!raw) return 0;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Prefer whichever event blob is newer (local cache vs Firebase).
 * @param {object|null|undefined} localEvent
 * @param {object|null|undefined} remoteEvent
 * @returns {object|null|undefined}
 */
function pickNewerEvent(localEvent, remoteEvent) {
  if (!localEvent) return remoteEvent;
  if (!remoteEvent) return localEvent;
  const localTs = remoteUpdatedAt(localEvent);
  const remoteTs = remoteUpdatedAt(remoteEvent);
  if (localTs >= remoteTs) {
    return { ...remoteEvent, ...localEvent, id: localEvent.id || remoteEvent.id };
  }
  return remoteEvent;
}

function touchLastWriteFromEvent(event) {
  const ts = remoteUpdatedAt(event);
  if (ts > lastWriteAt) lastWriteAt = ts;
}

/**
 * @param {ForecastState} state
 */
export function extractCatalog(state) {
  return stripUndefined({
    ingredients: state.ingredients || [],
    drinks: (state.drinks || []).map((d) => ({
      id: d.id,
      name: d.name,
      lines: d.lines || [],
    })),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * @param {ForecastState} state
 */
export function extractEvent(state) {
  return stripUndefined({
    id: state.eventId,
    name: state.eventName || '',
    eventServiceType: state.eventServiceType,
    weekStart: state.weekStart,
    days: state.days,
    menuDrinkIds: state.menuDrinkIds,
    drinkMix: state.drinkMix,
    milkMix: state.milkMix,
    levelMix: state.levelMix,
    addonPrices: state.addonPrices,
    needBufferPct: normalizeNeedBufferPct(state.needBufferPct),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * @param {ForecastState} state
 * @param {object} catalog
 */
function applyCatalog(state, catalog) {
  if (!catalog || typeof catalog !== 'object') return;
  if (Array.isArray(catalog.ingredients) && catalog.ingredients.length) {
    state.ingredients = catalog.ingredients;
  }
  if (Array.isArray(catalog.drinks) && catalog.drinks.length) {
    state.drinks = catalog.drinks;
  }
}

/**
 * @param {ForecastState} state
 * @param {object} event
 */
function applyEvent(state, event) {
  if (!event || typeof event !== 'object') return;
  if (typeof event.id === 'string' && event.id) state.eventId = event.id;
  if (typeof event.eventName === 'string') state.eventName = event.eventName;
  else if (typeof event.name === 'string') state.eventName = event.name;
  if (event.eventServiceType) state.eventServiceType = normalizeEventServiceType(event.eventServiceType);
  if (typeof event.weekStart === 'string') state.weekStart = event.weekStart;
  if (Array.isArray(event.days)) state.days = event.days;
  if (Array.isArray(event.menuDrinkIds)) state.menuDrinkIds = event.menuDrinkIds;
  if (Array.isArray(event.drinkMix)) state.drinkMix = event.drinkMix;
  if (Array.isArray(event.milkMix)) state.milkMix = event.milkMix;
  if (event.levelMix && typeof event.levelMix === 'object') state.levelMix = event.levelMix;
  if (event.addonPrices && typeof event.addonPrices === 'object') state.addonPrices = event.addonPrices;
  if ('needBufferPct' in event) state.needBufferPct = normalizeNeedBufferPct(event.needBufferPct);
}

/**
 * @param {ForecastState} state
 */
export function mergeRemoteIntoState(state, { catalog, event }) {
  if (catalog) applyCatalog(state, catalog);
  if (event) applyEvent(state, event);
  return normalizeState(state);
}

async function pushCatalog(payload) {
  try {
    await setDoc(catalogRef(), payload, { merge: true });
    setStatus('saved');
  } catch (err) {
    console.warn('Could not save supply forecast catalog', err);
    setStatus('offline');
  }
}

async function pushEvent(payload) {
  try {
    await setDoc(eventRef(payload.id), payload, { merge: true });
    await setDoc(metaRef(), { activeEventId: payload.id, updatedAt: payload.updatedAt }, { merge: true });
    setStatus('saved');
  } catch (err) {
    console.warn('Could not save supply forecast event', err);
    setStatus('offline');
  }
}

/**
 * @param {ForecastState} state
 * @param {'catalog'|'event'|'both'} scope
 */
export function scheduleCloudSave(state, scope = 'both') {
  writeLocalBundle(state);
  lastWriteAt = Date.now();

  if (scope === 'catalog' || scope === 'both') {
    pendingCatalog = extractCatalog(state);
    if (catalogTimer) clearTimeout(catalogTimer);
    setStatus('saving');
    catalogTimer = setTimeout(() => {
      catalogTimer = null;
      const payload = pendingCatalog;
      pendingCatalog = null;
      if (payload) pushCatalog(payload);
    }, 400);
  }

  if (scope === 'event' || scope === 'both') {
    pendingEvent = extractEvent(state);
    if (eventTimer) clearTimeout(eventTimer);
    setStatus('saving');
    eventTimer = setTimeout(() => {
      eventTimer = null;
      const payload = pendingEvent;
      pendingEvent = null;
      if (payload) pushEvent(payload);
    }, 400);
  }
}

function shouldApplyRemote(ts) {
  return ts > lastWriteAt + 500;
}

function subscribeEvent(eventId) {
  if (listeningEventId === eventId && unsubEvent) return;
  unsubEvent?.();
  listeningEventId = eventId;
  unsubEvent = onSnapshot(
    eventRef(eventId),
    (snap) => {
      if (!snap.exists() || !onRemoteState) return;
      const remoteData = snap.data();
      const bundle = readLocalBundle();
      const localEvent = bundle.events?.[eventId];
      const localTs = remoteUpdatedAt(localEvent);
      const remoteTs = remoteUpdatedAt(remoteData);
      if (localEvent && localTs >= remoteTs) return;
      if (!shouldApplyRemote(remoteTs)) return;
      const merged = mergeRemoteIntoState(bundle.state, { event: remoteData });
      writeLocalBundle(merged);
      onRemoteState(merged);
    },
    (err) => {
      console.warn('Supply forecast event listener error', err);
      setStatus('offline');
    }
  );
}

/**
 * @param {(state: ForecastState) => void} onState
 * @param {(status: string) => void} [onStatus]
 */
export async function initSync(onState, onStatus) {
  onRemoteState = onState;
  onStatusChange = onStatus || null;
  setStatus('saving');

  let catalogData = null;
  let metaData = { activeEventId: 'default' };
  let eventData = null;

  try {
    const [catalogSnap, metaSnap] = await Promise.all([getDoc(catalogRef()), getDoc(metaRef())]);
    if (catalogSnap.exists()) catalogData = catalogSnap.data();
    if (metaSnap.exists()) metaData = metaSnap.data() || metaData;

    const local = readLocalBundle();
    let eventId =
      typeof metaData.activeEventId === 'string' && metaData.activeEventId
        ? metaData.activeEventId
        : local.activeEventId || 'default';

    if (!catalogData && local.catalog) {
      catalogData = local.catalog;
      await setDoc(catalogRef(), stripUndefined({ ...catalogData, updatedAt: new Date().toISOString() }), {
        merge: true,
      });
    }

    const eventSnap = await getDoc(eventRef(eventId));
    if (eventSnap.exists()) {
      eventData = eventSnap.data();
    } else if (local.events?.[eventId]) {
      eventData = local.events[eventId];
      await setDoc(eventRef(eventId), stripUndefined({ ...eventData, updatedAt: new Date().toISOString() }), {
        merge: true,
      });
    } else {
      const seed = local.state || defaultState();
      seed.eventId = eventId;
      eventData = extractEvent(seed);
      await setDoc(eventRef(eventId), eventData, { merge: true });
    }

    const localEvent = local.events?.[eventId];
    eventData = pickNewerEvent(localEvent, eventData);
    touchLastWriteFromEvent(localEvent);
    touchLastWriteFromEvent(eventData);

    if (!catalogData) {
      const seed = local.state || defaultState();
      catalogData = extractCatalog(seed);
      await setDoc(catalogRef(), catalogData, { merge: true });
    }

    await setDoc(metaRef(), { activeEventId: eventId, updatedAt: new Date().toISOString() }, { merge: true });

    const merged = mergeRemoteIntoState(local.state || defaultState(), {
      catalog: catalogData,
      event: eventData,
    });
    merged.eventId = eventId;
    writeLocalBundle(merged);
    onState(merged);
    setStatus('saved');
  } catch (err) {
    console.warn('Supply forecast cloud init failed; using local cache', err);
    setStatus('offline');
    onState(readLocalBundle().state || defaultState());
  }

  unsubCatalog?.();
  unsubCatalog = onSnapshot(
    catalogRef(),
    (snap) => {
      if (!snap.exists() || !onRemoteState) return;
      const remoteTs = remoteUpdatedAt(snap.data());
      if (!shouldApplyRemote(remoteTs)) return;
      const bundle = readLocalBundle();
      const merged = mergeRemoteIntoState(bundle.state, { catalog: snap.data() });
      writeLocalBundle(merged);
      onRemoteState(merged);
    },
    () => setStatus('offline')
  );

  unsubMeta?.();
  unsubMeta = onSnapshot(
    metaRef(),
    (snap) => {
      if (!snap.exists()) return;
      const id = snap.data()?.activeEventId;
      if (typeof id === 'string' && id) subscribeEvent(id);
    },
    () => setStatus('offline')
  );

  subscribeEvent(metaData.activeEventId || 'default');
}

/** @returns {Promise<Array<{ id: string, name: string }>>} */
export async function listEvents() {
  try {
    const snap = await getDocs(eventsCollection());
    return snap.docs
      .map((d) => {
        const data = d.data() || {};
        return { id: data.id || d.id, name: data.name || d.id };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn('Could not list supply forecast events', err);
    const local = readLocalBundle();
    return Object.entries(local.events || {}).map(([id, ev]) => ({
      id,
      name: ev?.name || id,
    }));
  }
}

/**
 * @param {ForecastState} current
 * @param {string} eventId
 * @returns {Promise<ForecastState>}
 */
export async function switchEvent(current, eventId) {
  scheduleCloudSave(current, 'event');
  let eventData = null;
  try {
    const snap = await getDoc(eventRef(eventId));
    if (snap.exists()) eventData = snap.data();
  } catch (err) {
    console.warn('Could not load event', err);
  }
  if (!eventData) {
    const local = readLocalBundle();
    eventData = local.events?.[eventId] || null;
  }
  const next = mergeRemoteIntoState(
    { ...current, eventId },
    { event: eventData || { id: eventId, name: '', drinkMix: [], menuDrinkIds: [] } }
  );
  next.eventId = eventId;
  writeLocalBundle(next);
  try {
    await setDoc(metaRef(), { activeEventId: eventId, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (_) {
    setStatus('offline');
  }
  subscribeEvent(eventId);
  return next;
}

/**
 * @param {ForecastState} current
 * @param {string} [name]
 * @returns {Promise<ForecastState>}
 */
export async function createEvent(current, name = 'New event') {
  const id = newId();
  const event = {
    id,
    name,
    eventServiceType: current.eventServiceType || 'popup',
    weekStart: current.weekStart,
    days: (current.days || []).map((d) => ({ ...d, cups: 0 })),
    menuDrinkIds: current.menuDrinkIds?.length ? [...current.menuDrinkIds] : current.drinks.map((d) => d.id),
    drinkMix: (current.drinkMix || []).map((m) => ({ ...m, price: 0 })),
    milkMix: current.milkMix,
    levelMix: current.levelMix,
    addonPrices: current.addonPrices ? { ...current.addonPrices } : { oat: 0, l1: 0, l2: 0, l3: 0 },
    needBufferPct: current.needBufferPct || 0,
    updatedAt: new Date().toISOString(),
  };
  try {
    await setDoc(eventRef(id), stripUndefined(event));
    await setDoc(metaRef(), { activeEventId: id, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (err) {
    console.warn('Could not create event', err);
    setStatus('offline');
  }
  const next = mergeRemoteIntoState({ ...current, eventId: id }, { event });
  next.eventId = id;
  next.eventName = name;
  writeLocalBundle(next);
  subscribeEvent(id);
  return next;
}

/**
 * @param {ForecastState} current
 * @param {string} sourceEventId
 * @param {string} [sourceName]
 * @returns {Promise<ForecastState>}
 */
export async function duplicateEvent(current, sourceEventId, sourceName = '') {
  /** @type {Record<string, unknown>|null} */
  let sourceData = null;

  if (sourceEventId === current.eventId) {
    sourceData = extractEvent(current);
  } else {
    try {
      const snap = await getDoc(eventRef(sourceEventId));
      if (snap.exists()) sourceData = snap.data();
    } catch (err) {
      console.warn('Could not load event to duplicate', err);
    }
    if (!sourceData) {
      const local = readLocalBundle();
      sourceData = local.events?.[sourceEventId] || null;
    }
  }

  if (!sourceData) return current;

  scheduleCloudSave(current, 'event');

  const id = newId();
  const baseName = String(sourceName || sourceData.name || 'Event').trim() || 'Event';
  const name = / copy$/i.test(baseName) ? `${baseName} 2` : `${baseName} copy`;
  const event = stripUndefined({
    id,
    name,
    eventServiceType: sourceData.eventServiceType || current.eventServiceType || 'popup',
    weekStart: sourceData.weekStart || current.weekStart,
    days: Array.isArray(sourceData.days) ? sourceData.days.map((d) => ({ ...d })) : [],
    menuDrinkIds: Array.isArray(sourceData.menuDrinkIds) ? [...sourceData.menuDrinkIds] : [],
    drinkMix: Array.isArray(sourceData.drinkMix) ? sourceData.drinkMix.map((m) => ({ ...m })) : [],
    milkMix: Array.isArray(sourceData.milkMix) ? sourceData.milkMix.map((m) => ({ ...m })) : current.milkMix,
    levelMix: sourceData.levelMix ? { ...sourceData.levelMix } : current.levelMix,
    addonPrices: sourceData.addonPrices ? { ...sourceData.addonPrices } : { ...current.addonPrices },
    needBufferPct: sourceData.needBufferPct ?? current.needBufferPct ?? 0,
    updatedAt: new Date().toISOString(),
  });

  try {
    await setDoc(eventRef(id), event);
    await setDoc(metaRef(), { activeEventId: id, updatedAt: event.updatedAt }, { merge: true });
  } catch (err) {
    console.warn('Could not duplicate event', err);
    setStatus('offline');
  }

  const next = mergeRemoteIntoState({ ...current, eventId: id }, { event });
  next.eventId = id;
  next.eventName = name;
  writeLocalBundle(next);
  subscribeEvent(id);
  return next;
}

export function getSyncStatus() {
  return syncStatus;
}

export function destroySync() {
  unsubCatalog?.();
  unsubEvent?.();
  unsubMeta?.();
  unsubCatalog = null;
  unsubEvent = null;
  unsubMeta = null;
  listeningEventId = null;
}
