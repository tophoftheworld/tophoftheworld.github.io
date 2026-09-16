/**
 * Shared purchasing plan state \u2014 live overlay + archived weeks on Firebase.
 * localStorage caches the last server-acked overlay for faster boots / offline reads.
 * Writes use a 3-way merge transaction so concurrent editors do not wipe each other.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from '../firebase.js?v=96';
import { STORAGE_KEY, THIS_WEEK_ID } from './seed.js?v=96';
import { mergeOverlays, stampOverlayEdits } from './overlay-merge.js?v=96';
import { preferNonEmptyPastWeek, weekHasOnPlanBudget } from './overlay-filter.js?v=96';
import { actorStamp } from './actor.js?v=96';

export const OVERLAY_KEY = 'purchasing-overlay-v2';

/** Singleton doc \u2014 must be collection/doc/collection/doc (even segments). */
const LIVE_OVERLAY_PATH = ['purchasing', '_config', 'liveOverlay', 'current'];
/** Archived weeks: purchasing/_config/weeks/{weekId} */
const WEEKS_PATH = ['purchasing', '_config', 'weeks'];

export function emptyOverlay(weekStart, weekEnd) {
  return {
    weekStart: weekStart || null,
    weekEnd: weekEnd || null,
    weekStatus: 'draft',
    released: 0,
    spent: 0,
    returned: 0,
    settledAt: null,
    lines: {},
    manualLines: {},
    branchForecast: {},
    locationMeta: {},
    offPlanExpenses: [],
  };
}

function liveOverlayRef() {
  return doc(db, ...LIVE_OVERLAY_PATH);
}

function weekRef(weekId) {
  return doc(db, ...WEEKS_PATH, weekId);
}

function weeksCollection() {
  return collection(db, ...WEEKS_PATH);
}

function readLocalOverlay() {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeLocalOverlay(overlay) {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay || emptyOverlay()));
  } catch (_) {
    /* ignore */
  }
}

function readLocalPastWeeks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.version === 7 && Array.isArray(parsed.weeks)) {
      return parsed.weeks.filter((w) => w?.id && w.id !== THIS_WEEK_ID);
    }
  } catch (_) {
    /* ignore */
  }
  return [];
}

function writeLocalPastWeeks(weeks) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 7,
        weeks: (weeks || []).filter((w) => w?.id && w.id !== THIS_WEEK_ID),
      })
    );
  } catch (_) {
    /* ignore */
  }
}

function stripUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

function overlayLooksUseful(overlay) {
  if (!overlay || typeof overlay !== 'object') return false;
  if (overlay.weekStart) return true;
  if (overlay.weekStatus && overlay.weekStatus !== 'draft') return true;
  if (Number(overlay.released) > 0) return true;
  if (overlay.lines && Object.keys(overlay.lines).length) return true;
  if (overlay.manualLines && Object.keys(overlay.manualLines).length) return true;
  if (overlay.branchForecast && Object.keys(overlay.branchForecast).length) return true;
  return false;
}

function normalizeUpdatedAt(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (_) {
      return null;
    }
  }
  if (value && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  return null;
}

/** Last overlay confirmed from the server (load, successful write, or listener). */
let ackedOverlay = null;
/** Doc-level updatedAt of last write this tab made (echo skip). */
let lastWrittenUpdatedAt = null;
/** Base doc updatedAt the pending local overlay was derived from. */
let pendingBaseUpdatedAt = null;

let overlaySaveTimer = null;
let pendingLocalOverlay = null;
let writeChain = Promise.resolve();
let writeInFlight = false;

export function getAckedOverlay() {
  return ackedOverlay;
}

export function setAckedOverlay(overlay) {
  ackedOverlay = overlay ? stripUndefined(overlay) : emptyOverlay();
  writeLocalOverlay(ackedOverlay);
  return ackedOverlay;
}

/** Load live overlay: Firebase wins; migrate local cache up only if cloud is empty. */
export async function loadLiveOverlay() {
  let remote = null;
  try {
    const snap = await getDoc(liveOverlayRef());
    if (snap.exists()) remote = snap.data() || null;
  } catch (err) {
    console.warn('Could not load purchasing overlay from Firebase', err);
  }

  const local = readLocalOverlay();
  if (overlayLooksUseful(remote)) {
    const normalized = {
      ...emptyOverlay(),
      ...remote,
      updatedAt: normalizeUpdatedAt(remote.updatedAt) || remote.updatedAt || null,
    };
    setAckedOverlay(normalized);
    return normalized;
  }
  if (overlayLooksUseful(local)) {
    // Only migrate when cloud is empty \u2014 never overwrite remote plan work with stale cache.
    try {
      const payload = stripUndefined({ ...local, updatedAt: new Date().toISOString() });
      lastWrittenUpdatedAt = payload.updatedAt;
      await setDoc(liveOverlayRef(), payload);
      setAckedOverlay(payload);
      return payload;
    } catch (err) {
      console.warn('Could not migrate local overlay to Firebase', err);
      setAckedOverlay(local);
      return local;
    }
  }
  const fresh = emptyOverlay();
  setAckedOverlay(fresh);
  return fresh;
}

async function pushMergedOverlay(localOverlay) {
  const actor = actorStamp();
  const stamped = stampOverlayEdits(
    stripUndefined(localOverlay || emptyOverlay()),
    ackedOverlay || emptyOverlay(),
    new Date().toISOString(),
    actor
  );
  const baseUpdatedAt = pendingBaseUpdatedAt;

  try {
    const merged = await runTransaction(db, async (tx) => {
      const ref = liveOverlayRef();
      const snap = await tx.get(ref);
      const remote = snap.exists() ? snap.data() || emptyOverlay() : emptyOverlay();
      const remoteUpdatedAt = normalizeUpdatedAt(remote.updatedAt);

      // If a newer snapshot landed and our pending write was based on older state,
      // still merge \u2014 do not blind-replace.
      if (
        baseUpdatedAt &&
        remoteUpdatedAt &&
        remoteUpdatedAt > baseUpdatedAt &&
        remoteUpdatedAt !== lastWrittenUpdatedAt
      ) {
        // Concurrent remote change \u2014 merge handles it below.
      }

      const next = mergeOverlays(ackedOverlay || emptyOverlay(), stamped, remote);
      const updatedAt = new Date().toISOString();
      const toWrite = stripUndefined({
        ...next,
        updatedAt,
        ...(actor ? { updatedBy: actor } : {}),
      });
      tx.set(ref, toWrite);
      return toWrite;
    });

    lastWrittenUpdatedAt = merged.updatedAt;
    setAckedOverlay(merged);
    return merged;
  } catch (err) {
    console.warn('Could not save purchasing overlay to Firebase', err);
    throw err;
  }
}

function enqueueWrite(localOverlay) {
  pendingLocalOverlay = localOverlay;
  if (!pendingBaseUpdatedAt) {
    pendingBaseUpdatedAt =
      normalizeUpdatedAt(ackedOverlay?.updatedAt) || ackedOverlay?.updatedAt || null;
  }

  writeChain = writeChain
    .then(async () => {
      const toWrite = pendingLocalOverlay;
      pendingLocalOverlay = null;
      const base = pendingBaseUpdatedAt;
      pendingBaseUpdatedAt = null;
      if (!toWrite) return null;
      writeInFlight = true;
      try {
        // Re-attach base for this specific push
        pendingBaseUpdatedAt = base;
        return await pushMergedOverlay(toWrite);
      } finally {
        writeInFlight = false;
        pendingBaseUpdatedAt = null;
      }
    })
    .catch((err) => {
      console.warn('Purchasing overlay write queue failed', err);
      return null;
    });

  return writeChain;
}

/**
 * Save live overlay via transactional 3-way merge (never blind full replace of maps).
 * Debounced 400ms unless flush: true.
 * Pass replace: true for intentional resets (week rollover / clear plan).
 */
export function saveLiveOverlay(overlay, { flush = false, replace = false } = {}) {
  const payload = stripUndefined(overlay || emptyOverlay());

  if (replace) {
    if (overlaySaveTimer) {
      clearTimeout(overlaySaveTimer);
      overlaySaveTimer = null;
    }
    pendingLocalOverlay = null;
    pendingBaseUpdatedAt = null;
    const run = async () => {
      const updatedAt = new Date().toISOString();
      const actor = actorStamp();
      const toWrite = stripUndefined({
        ...payload,
        updatedAt,
        ...(actor ? { updatedBy: actor } : {}),
      });
      try {
        await setDoc(liveOverlayRef(), toWrite);
        lastWrittenUpdatedAt = updatedAt;
        setAckedOverlay(toWrite);
        return toWrite;
      } catch (err) {
        console.warn('Could not replace purchasing overlay on Firebase', err);
        throw err;
      }
    };
    writeChain = writeChain.then(run, run);
    return writeChain;
  }

  pendingLocalOverlay = payload;
  if (!pendingBaseUpdatedAt) {
    pendingBaseUpdatedAt =
      normalizeUpdatedAt(ackedOverlay?.updatedAt) || ackedOverlay?.updatedAt || null;
  }

  if (overlaySaveTimer) clearTimeout(overlaySaveTimer);

  if (flush) {
    overlaySaveTimer = null;
    return enqueueWrite(payload);
  }

  return new Promise((resolve) => {
    overlaySaveTimer = setTimeout(() => {
      overlaySaveTimer = null;
      resolve(enqueueWrite(payload));
    }, 400);
  });
}

/** Cancel a debounced save that has not started yet (e.g. after applying remote when not dirty). */
export function cancelPendingOverlaySave() {
  if (overlaySaveTimer) {
    clearTimeout(overlaySaveTimer);
    overlaySaveTimer = null;
  }
  // Keep in-flight writes; only drop not-yet-queued debounce payload if no write started.
  if (!writeInFlight) {
    pendingLocalOverlay = null;
    pendingBaseUpdatedAt = null;
  }
}

export function hasPendingOverlaySave() {
  return !!(overlaySaveTimer || pendingLocalOverlay || writeInFlight);
}

export async function clearLiveOverlay(weekStart = null, weekEnd = null) {
  cancelPendingOverlaySave();
  const fresh = emptyOverlay(weekStart, weekEnd);
  const payload = stripUndefined({ ...fresh, updatedAt: new Date().toISOString() });
  try {
    // Intentional full reset \u2014 replace the document.
    await setDoc(liveOverlayRef(), payload);
    lastWrittenUpdatedAt = payload.updatedAt;
    setAckedOverlay(payload);
  } catch (err) {
    console.warn('Could not clear purchasing overlay on Firebase', err);
    setAckedOverlay(payload);
  }
  return fresh;
}

/**
 * Listen for remote overlay changes. Skips echoes of this browser’s own saves.
 * Updates acked overlay when applying remote (caller decides dirty merge).
 * @param {(overlay: object, meta: { isEcho: boolean }) => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeLiveOverlay(onChange) {
  return onSnapshot(
    liveOverlayRef(),
    (snap) => {
      if (!snap.exists()) {
        const fresh = emptyOverlay();
        setAckedOverlay(fresh);
        onChange(fresh, { isEcho: false });
        return;
      }
      const data = snap.data() || {};
      const updatedAt = normalizeUpdatedAt(data.updatedAt) || data.updatedAt || null;
      const normalized = { ...emptyOverlay(), ...data, updatedAt };
      if (updatedAt && updatedAt === lastWrittenUpdatedAt) {
        setAckedOverlay(normalized);
        onChange(normalized, { isEcho: true });
        return;
      }
      onChange(normalized, { isEcho: false });
    },
    (err) => {
      console.warn('Purchasing live overlay listener failed', err);
    }
  );
}

/** Load archived weeks: merge Firebase + local (Firebase wins on same id). */
export async function loadPastWeeksRemote() {
  const byId = new Map();
  for (const w of readLocalPastWeeks()) {
    if (w?.id) byId.set(w.id, w);
  }

  try {
    const snap = await getDocs(weeksCollection());
    for (const d of snap.docs) {
      const data = d.data() || {};
      const week = { ...data, id: data.id || d.id };
      if (!week.id || week.id === THIS_WEEK_ID) continue;
      byId.set(week.id, week);
    }
  } catch (err) {
    console.warn('Could not load past purchasing weeks from Firebase', err);
  }

  const weeks = [...byId.values()].sort((a, b) =>
    String(b.weekStart || '').localeCompare(String(a.weekStart || ''))
  );
  writeLocalPastWeeks(weeks);
  return weeks;
}

/** Sync peek of archived weeks already on disk (no network). */
export function peekLocalPastWeeks() {
  return readLocalPastWeeks();
}

export async function savePastWeekRemote(week) {
  if (!week?.id || week.id === THIS_WEEK_ID) return null;

  const existingLocal = readLocalPastWeeks().find((w) => w.id === week.id) || null;
  let existingRemote = null;
  try {
    const snap = await getDoc(weekRef(week.id));
    if (snap.exists()) {
      const data = snap.data() || {};
      existingRemote = { ...data, id: data.id || snap.id };
    }
  } catch (err) {
    console.warn('Could not read past purchasing week before save', err);
  }

  const existing = preferNonEmptyPastWeek(existingRemote, existingLocal) || existingLocal;
  const toSave = preferNonEmptyPastWeek(existing, week);
  if (
    existing &&
    weekHasOnPlanBudget(existing) &&
    !weekHasOnPlanBudget(week) &&
    toSave === existing
  ) {
    // Keep the richer week \u2014 do not write an empty archive over it.
    writeLocalPastWeeks([
      ...readLocalPastWeeks().filter((w) => w.id !== existing.id),
      existing,
    ]);
    return existing;
  }

  const actor = actorStamp();
  const payload = stripUndefined({
    ...toSave,
    updatedAt: new Date().toISOString(),
    ...(actor ? { updatedBy: actor } : {}),
  });
  const local = readLocalPastWeeks().filter((w) => w.id !== payload.id);
  local.push(payload);
  writeLocalPastWeeks(local);
  try {
    await setDoc(weekRef(payload.id), payload, { merge: true });
  } catch (err) {
    console.warn('Could not save past purchasing week to Firebase', err);
  }
  return payload;
}

export async function savePastWeeksRemote(weeks) {
  const list = (weeks || []).filter((w) => w?.id && w.id !== THIS_WEEK_ID);
  const saved = [];
  for (const week of list) {
    saved.push(await savePastWeekRemote(week));
  }
  return saved.filter(Boolean);
}

export async function deletePastWeekRemote(weekId) {
  if (!weekId || weekId === THIS_WEEK_ID) return;
  writeLocalPastWeeks(readLocalPastWeeks().filter((w) => w.id !== weekId));
  try {
    await deleteDoc(weekRef(weekId));
  } catch (err) {
    console.warn('Could not delete past purchasing week on Firebase', err);
  }
}

export { mergeOverlays, stampOverlayEdits };
