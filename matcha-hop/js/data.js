/**
 * Data layer: Firestore (primary) with IndexedDB fallback and one-time migration from IndexedDB to Firestore.
 * In-memory cache for sync reads; initData() must be awaited before use.
 */

import {
  getDb,
  initFirebase,
  initAuth,
  getCurrentUserId,
  getCurrentProfile,
  CAFES_COLLECTION,
  LOGS_COLLECTION,
  SETTINGS_COLLECTION,
  BRANDS_CONFIG_DOC,
  BRAND_POPUPS_COLLECTION,
  BRAND_LIKES_COLLECTION,
  LOCATION_LIKES_COLLECTION,
  LOG_POST_LIKES_COLLECTION,
  EVENTS_COLLECTION,
  LISTS_COLLECTION,
  USER_PROFILES_COLLECTION,
} from './firebase.js';

const DB_NAME = 'matchaHop';
const DB_VERSION = 1;
const STORE_CAFES = 'cafes';
const STORE_LOGS = 'logs';
const LEGACY_CAFES = 'matchaHop_cafes';
const LEGACY_LOGS = 'matchaHop_logs';
const STRICT_MIGRATION_DOC = 'migrations';
const LOG_COMMENTS_COLLECTION = 'logComments';

let idb = null;
let _cafes = [];
let _logs = [];
let _dataInited = false;
let _brandsConfig = null;
let _logsSchemaMigrated = false;
const STRICT_SCHEMA_VERSION = 3;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Firestore document size limit ~1 MiB; single field value must be <= 1 MiB. Strip oversized photo (base64) so batch writes succeed. */
const FIRESTORE_MAX_FIELD_BYTES = 1_000_000;

/** Remove undefined so Firestore accepts the object. Optionally strip log photo/photos if too large. */
function sanitize(obj, options = {}) {
  const out = JSON.parse(JSON.stringify(obj || {}));
  if (!options.stripLargePhoto) return out;
  if (out.photo && typeof out.photo === 'string' && out.photo.length > FIRESTORE_MAX_FIELD_BYTES) {
    delete out.photo;
  }
  if (Array.isArray(out.photos)) {
    out.photos = out.photos.filter((p) => typeof p === 'string' && p.length <= FIRESTORE_MAX_FIELD_BYTES);
  }
  return out;
}

/** Firestore .doc(id) requires a string; IDs from IDB or legacy data may be numbers. */
function docId(id) {
  if (id == null) return '';
  return String(id);
}

function normalizeDrink(drink) {
  const name = String(drink?.name || '').trim();
  if (!name) return null;
  const notes = String(drink?.notes || '').trim();
  const details = drink?.details || {};
  const profile = drink?.profile || details?.profile || details || {};
  const rating = Number(drink?.rating) || 0;
  const recommended = Boolean(drink?.recommended ?? details?.recommended ?? details?.recommend);
  return {
    name,
    rating,
    notes,
    price: details.price ?? drink?.price ?? '',
    flavorNotes: Array.isArray(details.flavorTags ?? drink?.flavorNotes)
      ? (details.flavorTags ?? drink?.flavorNotes).map((t) => String(t || '').trim()).filter(Boolean)
      : [],
    profile: {
      sweet: Number(profile.sweet ?? profile.sweetness) || 0,
      matcha: Number(profile.matcha ?? profile.matchaPresence) || 0,
      balance: Number(profile.balance) || 0,
      umami: Number(profile.umami) || 0,
      bitterness: Number(profile.bitterness ?? profile.bitter) || 0,
      astringency: Number(profile.astringency) || 0,
      body: Number(profile.body) || 0,
      texture: Number(profile.texture) || 0,
      finish: Number(profile.finish) || 0,
    },
    recommended,
  };
}

function normalizeLog(log) {
  const sourceDrinks = Array.isArray(log?.post?.drinks) ? log.post.drinks : (Array.isArray(log?.drinks) ? log.drinks : []);
  const drinksFromArray = sourceDrinks.map(normalizeDrink).filter(Boolean);
  const photos = Array.isArray(log?.post?.photos) && log.post.photos.length
    ? log.post.photos.filter((p) => typeof p === 'string' && p)
    : (Array.isArray(log?.photos) && log.photos.length
      ? log.photos.filter((p) => typeof p === 'string' && p)
      : (log?.photo ? [log.photo] : []));
  const visit = {
    brandId: log?.visit?.brandId ?? log?.brandId ?? null,
    brandName: log?.visit?.brandName ?? log?.brandName ?? null,
    orderedAt: log?.visit?.orderedAt ?? null,
    location: {
      cafeId: log?.visit?.location?.cafeId ?? log?.cafeId ?? null,
      cafeName: log?.visit?.location?.cafeName ?? log?.cafe?.name ?? null,
      address: log?.visit?.location?.address ?? log?.cafe?.address ?? null,
      popupId: log?.visit?.location?.popupId ?? log?.popupId ?? null,
      eventId: log?.visit?.location?.eventId ?? log?.eventId ?? null,
      popupGeneric: Boolean(log?.visit?.location?.popupGeneric ?? log?.popupGeneric ?? false),
    },
  };
  const postCaption = String(log?.post?.caption ?? log?.postNotes ?? log?.notes ?? '').trim();
  const postRating = Number(log?.post?.rating ?? log?.orderRating ?? log?.cafeRating) || 0;
  const primaryDrinkName = drinksFromArray[0]?.name || '';
  return {
    id: docId(log?.id),
    userId: docId(log?.userId || getCurrentUserId()),
    userName: log?.userName || getCurrentProfile().username,
    userDisplayName: log?.userDisplayName || getCurrentProfile().name,
    createdAt: Number(log?.createdAt) || Date.now(),
    updatedAt: Number(log?.updatedAt) || Date.now(),
    visit,
    post: {
      rating: postRating,
      caption: postCaption,
      photos,
      photo: photos[0] || null,
      drinks: drinksFromArray,
      primaryDrinkName,
    },
    schemaVersion: STRICT_SCHEMA_VERSION,
  };
}

function assertStrictLogShape(log) {
  if (!log || typeof log !== 'object') throw new Error('Invalid log payload');
  if (!log.id) throw new Error('Log id is required');
  if (!log.userId) throw new Error('Log userId is required');
  if (!log.visit?.brandId || !log.visit?.brandName) throw new Error('Log brand context is required');
  if (!log.visit?.location) throw new Error('Log location object is required');
  if (!Array.isArray(log.post?.drinks)) throw new Error('Log drinks must be an array');
  for (const drink of (log.post.drinks || [])) {
    if (!drink?.name) throw new Error('Drink name is required when drink details are saved');
  }
}

/** True if cafe has a classification set and not N/A (used so we only migrate classified cafes to Firestore). */
function isClassified(cafe) {
  const c = cafe?.classification;
  return c != null && c !== '' && c !== 'na';
}

// ---------- IndexedDB (fallback + migration source) ----------
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_CAFES)) {
        database.createObjectStore(STORE_CAFES, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_LOGS)) {
        database.createObjectStore(STORE_LOGS, { keyPath: 'id' });
      }
    };
  });
}

function getAllIDB(storeName) {
  return new Promise((resolve, reject) => {
    if (!idb) return resolve([]);
    const tx = idb.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function putIDB(storeName, value) {
  return new Promise((resolve, reject) => {
    if (!idb) return resolve();
    const tx = idb.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function migrateFromLocalStorage() {
  try {
    const rawCafes = localStorage.getItem(LEGACY_CAFES);
    const rawLogs = localStorage.getItem(LEGACY_LOGS);
    const cafes = rawCafes ? JSON.parse(rawCafes) : [];
    const logs = rawLogs ? JSON.parse(rawLogs) : [];
    if (cafes.length === 0 && logs.length === 0) return Promise.resolve();
    return Promise.all([
      ...cafes.map((c) => putIDB(STORE_CAFES, c)),
      ...logs.map((l) => putIDB(STORE_LOGS, l)),
    ]).then(() => {
      localStorage.removeItem(LEGACY_CAFES);
      localStorage.removeItem(LEGACY_LOGS);
    });
  } catch {
    return Promise.resolve();
  }
}

/** Load cafes and logs from Firestore into _cafes and _logs. Returns true on success. */
async function loadFromFirestore() {
  const db = getDb();
  if (!db) return false;
  try {
    const cafesSnap = await db.collection(CAFES_COLLECTION).get();
    const logsSnap = await db.collection(LOGS_COLLECTION).get();
    _cafes = cafesSnap.docs.map((d) => ({ id: docId(d.id), ...d.data() }));
    _logs = logsSnap.docs.map((d) => {
      const data = d.data();
      const createdAt = data.createdAt;
      const createdAtMs = typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : (createdAt ?? 0);
      return normalizeLog({ id: docId(d.id), ...data, createdAt: createdAtMs });
    });
    return true;
  } catch (e) {
    console.warn('[Matcha Hop] Firestore load failed:', e?.message || e);
    return false;
  }
}

const FIRESTORE_BATCH_LIMIT = 450;

/** Build batch ops for cafes and logs; write to Firestore in chunks. Strips oversized log photo to stay under 1 MiB. */
async function writeToFirestore(cafes, logs) {
  const db = getDb();
  if (!db) return;
  const ops = [];
  (cafes || []).forEach((c) => {
    const id = docId(c.id);
    ops.push({ collection: CAFES_COLLECTION, id, data: sanitize({ ...c, id }) });
  });
  (logs || []).forEach((l) => {
    const id = docId(l.id);
    ops.push({ collection: LOGS_COLLECTION, id, data: sanitize({ ...l, id }, { stripLargePhoto: true }) });
  });
  for (let i = 0; i < ops.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = ops.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach(({ collection, id, data }) => {
      batch.set(db.collection(collection).doc(id), data);
    });
    try {
      await batch.commit();
    } catch (e) {
      console.error('[Matcha Hop] Firestore batch write failed at chunk', Math.floor(i / FIRESTORE_BATCH_LIMIT) + 1, e?.message || e);
      throw e;
    }
  }
}

/** Write all local cafes and logs to Firestore (full migration). Uses _cafes and _logs. */
async function migrateIDBToFirestore() {
  await writeToFirestore(_cafes, _logs);
}

async function migrateLogsToCanonicalSchema() {
  if (_logsSchemaMigrated) return;
  _logsSchemaMigrated = true;
  const db = getDb();
  if (!db || !_logs.length) return;
  const updatedLogs = [];
  const changedLogs = [];
  _logs.forEach((log) => {
    const normalized = normalizeLog(log);
    updatedLogs.push(normalized);
    if (Number(log?.schemaVersion) !== STRICT_SCHEMA_VERSION) changedLogs.push(normalized);
  });
  _logs = updatedLogs;
  if (!changedLogs.length) return;
  await writeToFirestore([], changedLogs);
  console.log('[Matcha Hop] Canonical log migration complete', { schemaVersion: STRICT_SCHEMA_VERSION, migrated: changedLogs.length });
}

async function isStrictMigrationApplied() {
  const db = getDb();
  if (!db) return false;
  try {
    const snap = await db.collection(SETTINGS_COLLECTION).doc(STRICT_MIGRATION_DOC).get();
    const data = snap.exists ? snap.data() : {};
    return data?.strictLogsSchemaVersion === STRICT_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

async function markStrictMigrationApplied() {
  const db = getDb();
  if (!db) return;
  await db.collection(SETTINGS_COLLECTION).doc(STRICT_MIGRATION_DOC).set({
    strictLogsSchemaVersion: STRICT_SCHEMA_VERSION,
    strictAppliedAt: Date.now(),
  }, { merge: true });
}

/** Call once before using getCafes/getLogs. Uses Firestore if configured; else IndexedDB. Migrates IDB → Firestore once when Firestore is empty. */
export async function initData() {
  if (_dataInited) return;
  _dataInited = true;
  idb = await openIDB().catch(() => null);
  let idbCafes = [];
  let idbLogs = [];
  if (idb) {
    idbCafes = await getAllIDB(STORE_CAFES);
    idbLogs = await getAllIDB(STORE_LOGS);
    if (idbCafes.length === 0 && idbLogs.length === 0) {
      await migrateFromLocalStorage();
      idbCafes = await getAllIDB(STORE_CAFES);
      idbLogs = await getAllIDB(STORE_LOGS);
    }
  }

  initFirebase();
  const db = getDb();
  if (db) {
    await initAuth();
    await loadFromFirestore();
    const fsCafeIds = new Set(_cafes.map((c) => docId(c.id)));
    const fsLogIds = new Set(_logs.map((l) => docId(l.id)));
    const classifiedIdbCafes = idbCafes.filter(isClassified);
    const classifiedCafeIds = new Set(classifiedIdbCafes.map((c) => docId(c.id)));
    const idbLogsForClassified = idbLogs.filter((l) => classifiedCafeIds.has(docId(l.cafeId)));
    const missingCafes = classifiedIdbCafes.filter((c) => !fsCafeIds.has(docId(c.id)));
    const missingLogs = idbLogsForClassified.filter((l) => !fsLogIds.has(docId(l.id)));
    const firestoreEmpty = _cafes.length === 0 && _logs.length === 0;
    const hasMissing = missingCafes.length > 0 || missingLogs.length > 0;

    if (firestoreEmpty && (classifiedIdbCafes.length > 0 || idbLogsForClassified.length > 0)) {
      console.log('[Matcha Hop] Migrating classified local data to Firebase…', { cafes: classifiedIdbCafes.length, logs: idbLogsForClassified.length });
      _cafes = classifiedIdbCafes;
      _logs = idbLogsForClassified;
      await migrateIDBToFirestore();
      await loadFromFirestore();
      console.log('[Matcha Hop] Using Firebase Firestore (migrated)', { cafes: _cafes.length, logs: _logs.length });
    } else if (hasMissing) {
      console.log('[Matcha Hop] Uploading missing classified data to Firebase…', { cafes: missingCafes.length, logs: missingLogs.length });
      await writeToFirestore(missingCafes, missingLogs);
      await loadFromFirestore();
      console.log('[Matcha Hop] Using Firebase Firestore (merged)', { cafes: _cafes.length, logs: _logs.length });
    } else {
      console.log('[Matcha Hop] Using Firebase Firestore', { cafes: _cafes.length, logs: _logs.length });
    }
    const alreadyApplied = await isStrictMigrationApplied();
    await migrateLogsToCanonicalSchema();
    if (!alreadyApplied) {
      await markStrictMigrationApplied();
    }
    return;
  }

  _cafes = idbCafes || [];
  _logs = (idbLogs || []).map((l) => normalizeLog(l));
  console.log('[Matcha Hop] Using local storage (Firebase not configured)', { cafes: _cafes.length, logs: _logs.length });
}

export const CLASSIFICATIONS = {
  matcha_cafe: 'Matcha Cafe',
  cafe_specialty_matcha: 'Cafe with Specialty Matcha',
  regular_cafe: 'Regular Cafe',
  na: 'N/A',
};

export const ZOOM_TIER_1 = 12;
export const ZOOM_TIER_2 = 14;
export const ZOOM_FOR_SPECIALTY = 15;

export const METRO_MANILA_SW = { lat: 14.35, lng: 120.95 };
export const METRO_MANILA_NE = { lat: 14.85, lng: 121.25 };

export function getCafes() {
  return [..._cafes];
}

async function syncCafeToFirestore(entry) {
  const db = getDb();
  if (!db) return;
  try {
    const id = docId(entry.id);
    await db.collection(CAFES_COLLECTION).doc(id).set(sanitize({ ...entry, id }));
  } catch (e) {
    console.error('saveCafe Firestore', e);
  }
}

function syncCafeToIDB(entry) {
  if (idb) putIDB(STORE_CAFES, entry).catch((e) => console.error('saveCafe IDB', e));
}

function normalizeLocationTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  const seen = new Set();
  tags.forEach((tag) => {
    const cleaned = String(tag || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned.slice(0, 32));
  });
  return out.slice(0, 24);
}

function normalizeHoursOverride(raw) {
  const txt = String(raw || '').trim();
  return txt ? txt.slice(0, 120) : null;
}

export function saveCafe(cafe) {
  const id = docId(cafe.id || cafe.placeId || uid());
  const existing = _cafes.find((c) => docId(c.id) === id || c.placeId === cafe.placeId);
  const entry = {
    ...(existing || {}),
    ...cafe,
    id: docId(existing?.id || id),
    name: cafe.name || existing?.name || '',
    address: cafe.address || existing?.address || '',
    lat: cafe.lat,
    lng: cafe.lng,
    placeId: cafe.placeId != null ? cafe.placeId : (existing?.placeId ?? null),
    classification: cafe.classification !== undefined ? cafe.classification : (existing?.classification ?? null),
    starred: cafe.starred !== undefined ? cafe.starred : (existing?.starred ?? false),
    locationTags: cafe.locationTags !== undefined
      ? normalizeLocationTags(cafe.locationTags)
      : normalizeLocationTags(existing?.locationTags),
    hoursOverride: cafe.hoursOverride !== undefined
      ? normalizeHoursOverride(cafe.hoursOverride)
      : normalizeHoursOverride(existing?.hoursOverride),
  };
  const idx = _cafes.findIndex((c) => c.id === entry.id);
  if (idx >= 0) _cafes[idx] = entry;
  else _cafes.push(entry);
  syncCafeToIDB(entry);
  syncCafeToFirestore(entry);
  return entry;
}

export function setClassification(cafeId, classification) {
  const cafe = _cafes.find((c) => c.id === cafeId);
  if (!cafe) return;
  const updated = { ...cafe, classification };
  const idx = _cafes.findIndex((c) => c.id === cafeId);
  _cafes[idx] = updated;
  syncCafeToIDB(updated);
  syncCafeToFirestore(updated);
}

export function setCafeLocationMeta(cafeId, { locationTags, hoursOverride } = {}) {
  const cafe = _cafes.find((c) => docId(c.id) === docId(cafeId));
  if (!cafe) return null;
  const updated = {
    ...cafe,
    ...(locationTags !== undefined ? { locationTags: normalizeLocationTags(locationTags) } : {}),
    ...(hoursOverride !== undefined ? { hoursOverride: normalizeHoursOverride(hoursOverride) } : {}),
  };
  const idx = _cafes.findIndex((c) => docId(c.id) === docId(cafeId));
  if (idx >= 0) _cafes[idx] = updated;
  syncCafeToIDB(updated);
  syncCafeToFirestore(updated);
  return updated;
}

// Backward-compat alias for older/stale module imports with a typo.
export const setCafeLocatigonmeta = setCafeLocationMeta;

export function setStarred(cafeId, value) {
  const cafe = _cafes.find((c) => c.id === cafeId);
  if (!cafe) return;
  const updated = { ...cafe, starred: !!value };
  const idx = _cafes.findIndex((c) => c.id === cafeId);
  _cafes[idx] = updated;
  syncCafeToIDB(updated);
  syncCafeToFirestore(updated);
}

export function getCafesForAdmin() {
  return _cafes.filter((c) => c.placeId).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function getCafesInBounds(bounds, zoom) {
  const inBounds = _cafes.filter((c) => {
    if (c.classification == null || c.classification === 'na') return false;
    if (bounds && typeof bounds.contains === 'function') {
      const latLng = typeof google !== 'undefined' && google.maps ? new google.maps.LatLng(c.lat, c.lng) : null;
      if (latLng && !bounds.contains(latLng)) return false;
    }
    return true;
  });
  const matchaCount = inBounds.filter((c) => c.classification === 'matcha_cafe').length;
  const allowed = new Set(['matcha_cafe']);
  if (matchaCount <= 3 && zoom >= ZOOM_FOR_SPECIALTY) {
    allowed.add('cafe_specialty_matcha');
  }
  const result = inBounds.filter((c) => allowed.has(c.classification));
  const resultIds = new Set(result.map((c) => c.id));
  inBounds.forEach((c) => {
    if (c.starred && !resultIds.has(c.id)) {
      result.push(c);
      resultIds.add(c.id);
    }
  });
  const inBoundsGeo = _cafes.filter((c) => {
    if (c.lat == null || c.lng == null) return false;
    if (bounds && typeof bounds.contains === 'function') {
      const latLng = typeof google !== 'undefined' && google.maps ? new google.maps.LatLng(c.lat, c.lng) : null;
      if (latLng && !bounds.contains(latLng)) return false;
    }
    return true;
  });
  inBoundsGeo.forEach((c) => {
    if (c.starred && !resultIds.has(c.id)) {
      result.push(c);
      resultIds.add(c.id);
    }
  });
  return result;
}

export function getCafeById(id) {
  return _cafes.find((c) => c.id === id) || null;
}

export function getCafeByPlaceId(placeId) {
  if (!placeId) return null;
  return _cafes.find((c) => c.placeId && String(c.placeId) === String(placeId)) || null;
}

export function getLogs() {
  return _logs.filter((l) => Number(l.schemaVersion) === STRICT_SCHEMA_VERSION);
}

/** Posts by the signed-in (anonymous) user; empty if no uid. Legacy logs without userId are excluded. */
export function getLogsForCurrentUser() {
  const uid = getCurrentUserId();
  if (!uid) return [];
  const id = docId(uid);
  return getLogs()
    .filter((l) => l.userId != null && docId(l.userId) === id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getLogsByCafeId(cafeId) {
  return getLogs()
    .filter((l) => docId(l.visit?.location?.cafeId) === docId(cafeId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getLogsByBrandId(brandId) {
  if (!brandId) return [];
  const id = docId(brandId);
  return getLogs()
    .filter((l) => docId(l.visit?.brandId) === id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getLogsByPopupId(popupId) {
  if (!popupId) return [];
  const id = docId(popupId);
  return getLogs()
    .filter((l) => docId(l.visit?.location?.popupId) === id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** All posts for a brand: direct brandId + any of its locations + any of its pop-ups. Deduplicated, sorted by createdAt desc. */
export async function getLogsForBrand(brand) {
  if (!brand?.id) return [];
  const brandId = docId(brand.id);
  const cafeIds = new Set(
    (Array.isArray(brand.cafeIds) ? brand.cafeIds : (brand.cafes || []).map((c) => c.id)).map((id) => docId(id))
  );
  const popUps = await getPopUpsByBrandId(brand.id);
  const popupIds = new Set(popUps.map((p) => docId(p.id)));
  const seen = new Set();
  const out = [];
  for (const log of getLogs()) {
    if (seen.has(log.id)) continue;
    if (
      docId(log.visit?.brandId) === brandId ||
      cafeIds.has(docId(log.visit?.location?.cafeId)) ||
      popupIds.has(docId(log.visit?.location?.popupId))
    ) {
      seen.add(log.id);
      out.push(log);
    }
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function syncLogToFirestore(entry) {
  const db = getDb();
  if (!db) return;
  try {
    const id = docId(entry.id);
    await db.collection(LOGS_COLLECTION).doc(id).set(sanitize({ ...entry, id }, { stripLargePhoto: true }));
  } catch (e) {
    console.error('saveLog Firestore', e);
    throw e;
  }
}

export function saveLog(log) {
  const id = docId(log.id || uid());
  const existing = _logs.find((l) => docId(l.id) === id);
  const profile = getCurrentProfile();
  const userId = profile.ownerId;
  const inputPost = log.post || {};
  const photos = Array.isArray(inputPost.photos) && inputPost.photos.length > 0
    ? inputPost.photos
    : (Array.isArray(log.photos) && log.photos.length ? log.photos : (log.photo ? [log.photo] : []));
  const drinks = Array.isArray(inputPost.drinks)
    ? inputPost.drinks
      .map((d) => normalizeDrink(d))
      .filter((d) => d && d.name)
    : Array.isArray(log.drinks)
    ? log.drinks
      .map((d) => normalizeDrink(d))
      .filter((d) => d && d.name)
    : [];
  const visit = log.visit || existing?.visit || {
    brandId: log.brandId ?? existing?.brandId ?? null,
    brandName: log.brandName ?? existing?.brandName ?? null,
    location: {
      cafeId: log.cafeId ?? existing?.cafeId ?? null,
      cafeName: log.cafe?.name ?? existing?.cafe?.name ?? null,
      address: log.cafe?.address ?? existing?.cafe?.address ?? null,
      popupId: log.popupId ?? existing?.popupId ?? null,
    },
  };
  const entry = normalizeLog({
    id,
    userId,
    userName: log.userName || existing?.userName || profile.username,
    userDisplayName: log.userDisplayName || existing?.userDisplayName || profile.name,
    visit,
    post: {
      rating: Number(inputPost.rating ?? log.orderRating ?? 0) || 0,
      caption: String(inputPost.caption ?? log.postNotes ?? '').trim(),
      photos,
      drinks,
    },
    createdAt: log.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  assertStrictLogShape(entry);
  const idx = _logs.findIndex((l) => l.id === id);
  if (idx >= 0) _logs[idx] = entry;
  else _logs.push(entry);
  putIDB(STORE_LOGS, entry).catch((e) => console.error('saveLog IDB', e));
  return syncLogToFirestore(entry).then(
    () => entry,
    (e) => {
      throw e;
    }
  );
}

/** Delete a log by id from memory, IDB, and Firestore. */
export async function deleteLog(logId) {
  const id = docId(logId);
  const idx = _logs.findIndex((l) => docId(l.id) === id);
  if (idx < 0) return;
  _logs.splice(idx, 1);
  if (idb) {
    const tx = idb.transaction(STORE_LOGS, 'readwrite');
    tx.objectStore(STORE_LOGS).delete(id);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  const db = getDb();
  if (db) {
    try {
      await db.collection(LOGS_COLLECTION).doc(id).delete();
    } catch (e) {
      console.error('[Matcha Hop] deleteLog Firestore', e);
    }
  }
}

export function getMyCafes() {
  const cafeIds = [...new Set(_logs.map((l) => l.visit?.location?.cafeId).filter(Boolean))];
  return cafeIds.map((cafeId) => _cafes.find((c) => c.id === cafeId)).filter(Boolean);
}

/** Get comments for a specific log (post). */
export async function getLogComments(logId) {
  if (!logId) return [];
  const db = getDb();
  if (!db) return [];
  const lid = docId(logId);
  try {
    const snap = await db.collection(LOG_COMMENTS_COLLECTION).where('logId', '==', lid).get();
    const out = snap.docs.map((d) => ({ id: docId(d.id), ...d.data() }));
    out.sort((a, b) => (Number(a.createdAt || 0) - Number(b.createdAt || 0)));
    return out;
  } catch (e) {
    console.warn('[Matcha Hop] getLogComments failed:', e?.message || e);
    return [];
  }
}

/** Add a comment for a specific log (post). Returns the created comment payload. */
export async function addLogComment(logId, text) {
  const db = getDb();
  if (!db) throw new Error('Firestore not configured');
  if (!logId) throw new Error('logId is required');
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('Comment text is required');
  const profile = getCurrentProfile();
  const now = Date.now();
  const commentId = uid();
  const payload = {
    logId: docId(logId),
    authorId: String(profile?.ownerId || ''),
    authorName: String(profile?.username || ''),
    text: cleanText,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(LOG_COMMENTS_COLLECTION).doc(commentId).set(payload);
  return { id: docId(commentId), ...payload };
}

// ---------- Brands gallery config (Firestore settings/brands) ----------

/** Brands config: { brands: [{ id, name, cafeIds: string[] }, ...] }. Each brand = one gallery card; cafeIds = branches. */
export async function getBrandsConfig() {
  if (_brandsConfig) return _brandsConfig;
  const db = getDb();
  if (!db) return { brands: [] };
  try {
    const snap = await db.collection(SETTINGS_COLLECTION).doc(BRANDS_CONFIG_DOC).get();
    const data = snap.exists ? snap.data() : {};
    _brandsConfig = Array.isArray(data.brands) ? { brands: data.brands } : { brands: [] };
    return _brandsConfig;
  } catch (e) {
    console.warn('[Matcha Hop] getBrandsConfig failed:', e?.message || e);
    return { brands: [] };
  }
}

export async function setBrandsConfig(brands) {
  const list = Array.isArray(brands) ? brands : [];
  _brandsConfig = { brands: list };
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(SETTINGS_COLLECTION).doc(BRANDS_CONFIG_DOC).set({ brands: list });
  } catch (e) {
    console.error('[Matcha Hop] setBrandsConfig failed:', e?.message || e);
  }
}

/** True when a brand config row is archived (hidden from gallery). */
export function isBrandArchived(brand) {
  return Boolean(brand?.archived);
}

function normalizeSocialUrl(kind, raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (kind === 'instagram') {
    const handle = v.replace(/^@/, '').replace(/^instagram\.com\//i, '').replace(/\/+$/, '');
    return handle ? `https://instagram.com/${handle}` : '';
  }
  return '';
}

/** Normalize brand social link fields for storage/display. Instagram only. */
export function normalizeBrandSocialLinks(input) {
  const src = input && typeof input === 'object' ? input : {};
  const url = normalizeSocialUrl('instagram', src.instagram);
  return url ? { instagram: url } : {};
}

/** Cafe IDs assigned to brands. excludeBrandId skips that brand (for edit flows). Archived brands are skipped. */
export function getAssignedCafeIds(brands, excludeBrandId = null) {
  const assigned = new Set();
  (Array.isArray(brands) ? brands : []).forEach((b) => {
    if (isBrandArchived(b)) return;
    if (excludeBrandId && b.id === excludeBrandId) return;
    (b.cafeIds || []).forEach((id) => assigned.add(String(id)));
  });
  return assigned;
}

/** Brand that owns a cafe id, or null. Ignores archived brands. */
export function findBrandOwningCafe(cafeId, brands) {
  const id = String(cafeId || '');
  if (!id) return null;
  return (Array.isArray(brands) ? brands : []).find((b) =>
    !isBrandArchived(b) && (b.cafeIds || []).some((cid) => String(cid) === id)
  ) || null;
}

/** Resolve brands config to full brand objects with cafes array (for gallery). Returns [{ id, name, cafeIds, cafes: cafe[] }]. */
export async function getGalleryBrands() {
  const config = await getBrandsConfig();
  return config.brands
    .filter((b) => !isBrandArchived(b))
    .map((b) => {
    const cafeIds = Array.isArray(b.cafeIds) ? b.cafeIds : [];
    const cafes = cafeIds.map((id) => getCafeById(docId(id))).filter(Boolean);
    return {
      id: b.id || uid(),
      name: b.name || 'Unnamed',
      logoUrl: b.logoUrl || null,
      socialLinks: normalizeBrandSocialLinks(b.socialLinks),
      cafeIds,
      cafes,
    };
  });
}

// ---------- Brand pop-ups (contributed, time-based locations) ----------

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD in local time. */
export function todayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inclusive expansion of [start, end] into ["YYYY-MM-DD", ...]. */
export function expandDateRange(start, end) {
  const a = String(start || '').trim();
  const b = String(end || '').trim();
  if (!DATE_STR_RE.test(a)) return DATE_STR_RE.test(b) ? [b] : [];
  if (!DATE_STR_RE.test(b)) return [a];
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const startDate = new Date(ay, am - 1, ad);
  const endDate = new Date(by, bm - 1, bd);
  if (endDate < startDate) return [a];
  const out = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
    if (out.length > 366) break;
  }
  return out;
}

/** Sort + dedupe + filter to valid YYYY-MM-DD entries. */
function cleanDates(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const s = String(raw || '').trim();
    if (!DATE_STR_RE.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  out.sort();
  return out;
}

/** Hydrate a popup record so `dates` is always present, derived from startDate/endDate when missing. */
function hydratePopUpDates(pop) {
  if (!pop || typeof pop !== 'object') return pop;
  const cleaned = cleanDates(pop.dates);
  if (cleaned.length > 0) {
    return {
      ...pop,
      dates: cleaned,
      startDate: pop.startDate || cleaned[0] || null,
      endDate: pop.endDate || cleaned[cleaned.length - 1] || null,
    };
  }
  const fromRange = expandDateRange(pop.startDate, pop.endDate);
  if (fromRange.length === 0) return { ...pop, dates: [] };
  return {
    ...pop,
    dates: fromRange,
    startDate: pop.startDate || fromRange[0],
    endDate: pop.endDate || fromRange[fromRange.length - 1],
  };
}

/** Normalize an Add/Update pop-up payload. Accepts either { dates } or { startDate, endDate } (or both). */
function normalizePopUpPayload(payload) {
  const explicit = cleanDates(payload?.dates);
  const fromRange = explicit.length === 0 ? expandDateRange(payload?.startDate, payload?.endDate) : [];
  const dates = explicit.length > 0 ? explicit : fromRange;
  return {
    name: payload?.name ? String(payload.name).trim() : null,
    address: payload?.address ? String(payload.address).trim() : '',
    placeId: payload?.placeId || null,
    lat: typeof payload?.lat === 'number' ? payload.lat : (payload?.lat != null ? Number(payload.lat) : null),
    lng: typeof payload?.lng === 'number' ? payload.lng : (payload?.lng != null ? Number(payload.lng) : null),
    dates,
    startDate: dates.length > 0 ? dates[0] : null,
    endDate: dates.length > 0 ? dates[dates.length - 1] : null,
  };
}

/** Status for a pop-up given today's date string. Returns 'active' | 'upcoming' | 'past' | 'unknown'. */
export function popUpStatus(pop, todayStr) {
  const today = todayStr || todayDateStr();
  const dates = Array.isArray(pop?.dates) && pop.dates.length > 0
    ? pop.dates
    : expandDateRange(pop?.startDate, pop?.endDate);
  if (!dates.length) return 'unknown';
  if (dates.includes(today)) return 'active';
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  if (today < minDate) return 'upcoming';
  if (today > maxDate) return 'past';
  return 'active';
}

/** Partition pop-ups into { active, upcoming, past } sorted appropriately. */
export function categorizePopUps(popUps, todayStr) {
  const today = todayStr || todayDateStr();
  const active = [];
  const upcoming = [];
  const past = [];
  (popUps || []).forEach((p) => {
    const hydrated = hydratePopUpDates(p);
    const status = popUpStatus(hydrated, today);
    if (status === 'active') active.push(hydrated);
    else if (status === 'upcoming') upcoming.push(hydrated);
    else if (status === 'past') past.push(hydrated);
  });
  active.sort((a, b) => (a.endDate || '9999-12-31').localeCompare(b.endDate || '9999-12-31'));
  upcoming.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  past.sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
  return { active, upcoming, past, activeUpcoming: [...active, ...upcoming] };
}

/** Fetch all pop-ups for a brand from Firestore. Synthesizes `dates` for legacy records. */
export async function getPopUpsByBrandId(brandId) {
  if (!brandId) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(BRAND_POPUPS_COLLECTION).where('brandId', '==', brandId).get();
    return snap.docs.map((doc) => hydratePopUpDates({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.warn('[Matcha Hop] getPopUpsByBrandId failed:', e?.message || e);
    return [];
  }
}

/** Add a pop-up for a brand. payload: { address, placeId?, lat, lng, dates?, startDate?, endDate?, name? }. */
export async function addPopUp(brandId, payload) {
  if (!brandId) throw new Error('brandId required');
  const id = uid();
  const normalized = normalizePopUpPayload(payload || {});
  const doc = {
    id,
    brandId,
    ...normalized,
    createdAt: Date.now(),
  };
  const db = getDb();
  if (!db) return doc;
  try {
    await db.collection(BRAND_POPUPS_COLLECTION).doc(id).set(doc);
  } catch (e) {
    console.error('[Matcha Hop] addPopUp failed:', e?.message || e);
    throw e;
  }
  return doc;
}

/** Update an existing pop-up by id. payload: { address?, placeId?, lat?, lng?, dates?, startDate?, endDate?, name? }. */
export async function updatePopUp(id, payload) {
  if (!id) throw new Error('pop-up id required');
  const db = getDb();
  if (!db) return;
  const normalized = normalizePopUpPayload(payload || {});
  const clean = Object.fromEntries(Object.entries(normalized).filter(([, v]) => v != null));
  try {
    await db.collection(BRAND_POPUPS_COLLECTION).doc(id).update(clean);
  } catch (e) {
    console.error('[Matcha Hop] updatePopUp failed:', e?.message || e);
    throw e;
  }
}

/** Delete a pop-up by id. */
export async function deletePopUp(id) {
  if (!id) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(BRAND_POPUPS_COLLECTION).doc(id).delete();
  } catch (e) {
    console.error('[Matcha Hop] deletePopUp failed:', e?.message || e);
    throw e;
  }
}

// ---------- Likes (local-first for instant UI, then sync to Firebase; shown as heart in UI) ----------

const LOCAL_LIKES_KEY = 'matchaHop_likes';

function getLocalLikes() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_LIKES_KEY) : null;
    const data = raw ? JSON.parse(raw) : {};
    return {
      brandIds: Array.isArray(data.brandIds) ? data.brandIds : [],
      locationIds: Array.isArray(data.locationIds) ? data.locationIds : [],
      postIds: Array.isArray(data.postIds) ? data.postIds : [],
    };
  } catch {
    return { brandIds: [], locationIds: [], postIds: [] };
  }
}

function saveLocalLikes(data) {
  const payload = {
    brandIds: data.brandIds || [],
    locationIds: data.locationIds || [],
    postIds: data.postIds || [],
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_LIKES_KEY, JSON.stringify(payload));
    }
  } catch (e) {
    console.warn('[Matcha Hop] saveLocalLikes failed:', e?.message || e);
  }
}

function getFirestoreFieldValue() {
  const firebase = typeof window !== 'undefined' ? window.firebase : null;
  return firebase?.firestore?.FieldValue ?? null;
}

/** Get brand like count (likes on the brand entity only). */
export async function getBrandLikeCount(brandId) {
  if (!brandId) return 0;
  const db = getDb();
  if (!db) return 0;
  try {
    const snap = await db.collection(BRAND_LIKES_COLLECTION).doc(docId(brandId)).get();
    const data = snap.exists ? snap.data() : {};
    return typeof data.count === 'number' ? data.count : 0;
  } catch (e) {
    console.warn('[Matcha Hop] getBrandLikeCount failed:', e?.message || e);
    return 0;
  }
}

/** Get location (cafe) like count. */
export async function getLocationLikeCount(cafeId) {
  if (!cafeId) return 0;
  const db = getDb();
  if (!db) return 0;
  try {
    const snap = await db.collection(LOCATION_LIKES_COLLECTION).doc(docId(cafeId)).get();
    const data = snap.exists ? snap.data() : {};
    return typeof data.count === 'number' ? data.count : 0;
  } catch (e) {
    console.warn('[Matcha Hop] getLocationLikeCount failed:', e?.message || e);
    return 0;
  }
}

/** Total likes for a brand = likes on brand + likes on all its locations. */
export async function getBrandTotalLikeCount(brand) {
  const brandOnly = await getBrandLikeCount(brand?.id);
  const cafeIds = Array.isArray(brand?.cafeIds) ? brand.cafeIds : (brand?.cafes ? (brand.cafes || []).map((c) => c.id) : []);
  let locationTotal = 0;
  for (const cafeId of cafeIds) {
    locationTotal += await getLocationLikeCount(cafeId);
  }
  return brandOnly + locationTotal;
}

/** Whether the current user has liked this brand. Local-first for instant UI. */
export function hasUserLikedBrand(brandId) {
  if (!brandId) return false;
  const local = getLocalLikes();
  return local.brandIds.includes(docId(brandId));
}

/** Whether the current user has liked this location. Local-first for instant UI. */
export function hasUserLikedLocation(cafeId) {
  if (!cafeId) return false;
  const local = getLocalLikes();
  return local.locationIds.includes(docId(cafeId));
}

/** Toggle or set brand like. Saves to local immediately, then syncs to Firebase in background. */
export function setBrandLike(brandId, value) {
  if (!brandId) return;
  const id = docId(brandId);
  const local = getLocalLikes();
  const hasLocal = local.brandIds.includes(id);
  if (value && !hasLocal) {
    local.brandIds = [...local.brandIds, id];
    saveLocalLikes(local);
  } else if (!value && hasLocal) {
    local.brandIds = local.brandIds.filter((x) => x !== id);
    saveLocalLikes(local);
  }
  syncBrandLikeToFirebase(brandId, value).catch((e) => console.warn('[Matcha Hop] setBrandLike Firebase sync failed:', e?.message || e));
}

async function syncBrandLikeToFirebase(brandId, value) {
  const uid = getCurrentUserId();
  const db = getDb();
  if (!db || !uid) return;
  const id = docId(brandId);
  const ref = db.collection(BRAND_LIKES_COLLECTION).doc(id);
  try {
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const userIds = Array.isArray(data.userIds) ? [...data.userIds] : [];
    const count = typeof data.count === 'number' ? data.count : 0;
    const hasLiked = userIds.includes(uid);
    if (value && !hasLiked) {
      userIds.push(uid);
      await ref.set({ count: count + 1, userIds });
    } else if (!value && hasLiked) {
      const next = userIds.filter((x) => x !== uid);
      await ref.set({ count: Math.max(0, count - 1), userIds: next });
    }
  } catch (e) {
    console.error('[Matcha Hop] syncBrandLikeToFirebase failed:', e?.message || e);
    throw e;
  }
}

/** Toggle or set location like. Saves to local immediately, then syncs to Firebase in background. */
export function setLocationLike(cafeId, value) {
  if (!cafeId) return;
  const id = docId(cafeId);
  const local = getLocalLikes();
  const hasLocal = local.locationIds.includes(id);
  if (value && !hasLocal) {
    local.locationIds = [...local.locationIds, id];
    saveLocalLikes(local);
  } else if (!value && hasLocal) {
    local.locationIds = local.locationIds.filter((x) => x !== id);
    saveLocalLikes(local);
  }
  syncLocationLikeToFirebase(cafeId, value).catch((e) => console.warn('[Matcha Hop] setLocationLike Firebase sync failed:', e?.message || e));
}

async function syncLocationLikeToFirebase(cafeId, value) {
  const uid = getCurrentUserId();
  const db = getDb();
  if (!db || !uid) return;
  const id = docId(cafeId);
  const ref = db.collection(LOCATION_LIKES_COLLECTION).doc(id);
  try {
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const userIds = Array.isArray(data.userIds) ? [...data.userIds] : [];
    const count = typeof data.count === 'number' ? data.count : 0;
    const hasLiked = userIds.includes(uid);
    if (value && !hasLiked) {
      userIds.push(uid);
      await ref.set({ count: count + 1, userIds });
    } else if (!value && hasLiked) {
      const next = userIds.filter((x) => x !== uid);
      await ref.set({ count: Math.max(0, count - 1), userIds: next });
    }
  } catch (e) {
    console.error('[Matcha Hop] syncLocationLikeToFirebase failed:', e?.message || e);
    throw e;
  }
}

// ---------- Post likes (log / feed posts; local-first + Firestore doc per logId) ----------

/** Snap of Firestore post-like doc (one read). */
export async function getPostLikeDoc(logId) {
  if (!logId) return { count: 0, userIds: [] };
  const db = getDb();
  if (!db) return { count: 0, userIds: [] };
  const id = docId(logId);
  try {
    const snap = await db.collection(LOG_POST_LIKES_COLLECTION).doc(id).get();
    if (!snap.exists) return { count: 0, userIds: [] };
    const data = snap.data();
    return {
      count: typeof data.count === 'number' ? data.count : 0,
      userIds: Array.isArray(data.userIds) ? data.userIds : [],
    };
  } catch (e) {
    console.warn('[Matcha Hop] getPostLikeDoc failed:', e?.message || e);
    return { count: 0, userIds: [] };
  }
}

export async function getPostLikeCount(logId) {
  const doc = await getPostLikeDoc(logId);
  return doc.count;
}

/** Whether the current user liked this post (local-first). */
export function hasUserLikedPost(logId) {
  if (!logId) return false;
  const local = getLocalLikes();
  return local.postIds.includes(docId(logId));
}

function applyLocalPostLike(logId, value) {
  if (!logId) return;
  const id = docId(logId);
  const local = getLocalLikes();
  const hasLocal = local.postIds.includes(id);
  if (value && !hasLocal) {
    local.postIds = [...local.postIds, id];
    saveLocalLikes(local);
  } else if (!value && hasLocal) {
    local.postIds = local.postIds.filter((x) => x !== id);
    saveLocalLikes(local);
  }
}

/** Toggle or set post like. Saves local immediately, syncs Firestore in background. */
export function setPostLike(logId, value) {
  applyLocalPostLike(logId, value);
  syncPostLikeToFirebase(logId, value).catch((e) => console.warn('[Matcha Hop] setPostLike Firebase sync failed:', e?.message || e));
}

/** Same as setPostLike but waits for Firestore write (for UI reconciliation). */
export async function setPostLikeSynced(logId, value) {
  applyLocalPostLike(logId, value);
  await syncPostLikeToFirebase(logId, value);
}

async function syncPostLikeToFirebase(logId, value) {
  const uid = getCurrentUserId();
  const db = getDb();
  if (!db || !uid) return;
  const id = docId(logId);
  const ref = db.collection(LOG_POST_LIKES_COLLECTION).doc(id);
  try {
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const userIds = Array.isArray(data.userIds) ? [...data.userIds] : [];
    const count = typeof data.count === 'number' ? data.count : 0;
    const hasLiked = userIds.includes(uid);
    if (value && !hasLiked) {
      userIds.push(uid);
      await ref.set({ count: count + 1, userIds });
    } else if (!value && hasLiked) {
      const next = userIds.filter((x) => x !== uid);
      await ref.set({ count: Math.max(0, count - 1), userIds: next });
    }
  } catch (e) {
    console.error('[Matcha Hop] syncPostLikeToFirebase failed:', e?.message || e);
    throw e;
  }
}

/** Merge remote userIds into local liked-post list so hearts match after reload. */
export function mergePostLikeFromRemote(logId, remoteUserIds) {
  if (!logId || !Array.isArray(remoteUserIds)) return;
  const uid = getCurrentUserId();
  if (!uid || !remoteUserIds.includes(uid)) return;
  const id = docId(logId);
  const local = getLocalLikes();
  if (local.postIds.includes(id)) return;
  local.postIds = [...local.postIds, id];
  saveLocalLikes(local);
}

/** Number of comments for a log (post). Uses aggregate count when supported. */
export async function getLogCommentCount(logId) {
  if (!logId) return 0;
  const db = getDb();
  if (!db) return 0;
  const lid = docId(logId);
  try {
    const q = db.collection(LOG_COMMENTS_COLLECTION).where('logId', '==', lid);
    if (typeof q.count === 'function') {
      try {
        const agg = await q.count().get();
        const data = typeof agg.data === 'function' ? agg.data() : {};
        if (typeof data.count === 'number') return data.count;
      } catch (_) {
        /* fall through */
      }
    }
    const snap = await q.get();
    return snap.size;
  } catch (e) {
    console.warn('[Matcha Hop] getLogCommentCount failed:', e?.message || e);
    return 0;
  }
}

// ---------- Events (v2) ----------

function normalizeEventDoc(raw) {
  if (!raw || !raw.id) return null;
  const start = raw.startDate ?? raw.date;
  const end = raw.endDate ?? null;
  return {
    id: String(raw.id),
    title: String(raw.title || '').trim() || 'Event',
    subtitle: raw.subtitle != null ? String(raw.subtitle) : '',
    type: ['popup', 'workshop', 'fest', 'crawl', 'meetup'].includes(raw.type) ? raw.type : 'fest',
    startDate: start,
    endDate: end,
    timeLabel: String(raw.timeLabel || '').trim() || '',
    location: String(raw.location || '').trim() || '—',
    address: String(raw.address || '').trim() || '',
    organizer: String(raw.organizer || '').trim() || '',
    description: String(raw.description || '').trim() || '',
    eventDates: Array.isArray(raw.eventDates) ? raw.eventDates.map((x) => String(x).slice(0, 10)).filter(Boolean) : [],
    merchantIds: Array.isArray(raw.merchantIds) ? raw.merchantIds.map((x) => String(x)) : [],
    placeId: raw.placeId != null ? String(raw.placeId) : null,
    lat: typeof raw.lat === 'number' ? raw.lat : (raw.lat != null ? Number(raw.lat) : null),
    lng: typeof raw.lng === 'number' ? raw.lng : (raw.lng != null ? Number(raw.lng) : null),
    coverPhoto: raw.coverPhoto != null ? String(raw.coverPhoto) : null,
    coverHue: Number.isFinite(raw.coverHue) ? raw.coverHue : 120,
    status: ['upcoming', 'ongoing', 'past', 'pending'].includes(raw.status) ? raw.status : 'upcoming',
    submittedBy: raw.submittedBy != null ? String(raw.submittedBy) : '',
    published: raw.published !== false,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

/** Published events for the app (user submissions with published:false are hidden until curated). */
export async function getEvents() {
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(EVENTS_COLLECTION).get();
    const rows = snap.docs
      .map((doc) => normalizeEventDoc({ id: doc.id, ...doc.data() }))
      .filter(Boolean)
      .filter((e) => e.published !== false);
    rows.sort((a, b) => {
      const ta = dateKeyFromRaw(a.startDate);
      const tb = dateKeyFromRaw(b.startDate);
      return ta.localeCompare(tb);
    });
    return rows;
  } catch (e) {
    console.warn('[Matcha Hop] getEvents failed:', e?.message || e);
    return [];
  }
}

function dateKeyFromRaw(v) {
  if (!v) return '9999-12-31';
  if (typeof v === 'string') return v.slice(0, 10);
  try {
    if (v?.toDate) return v.toDate().toISOString().slice(0, 10);
  } catch (_) { /* empty */ }
  return '9999-12-31';
}

function buildEventDoc(payload, { published }) {
  const id = String(payload?.id || '').trim() || uid();
  const profile = getCurrentProfile();
  const handle = String(profile?.username || '').replace(/^@/, '') || 'member';
  const type = ['popup', 'workshop', 'fest', 'crawl', 'meetup'].includes(payload?.type) ? payload.type : 'fest';
  let title = String(payload?.title || '').trim();
  const subtitle = String(payload?.subtitle || '').trim();
  const location = String(payload?.location || '').trim();
  if (!location) throw new Error('Location is required');
  const merchantIds = Array.isArray(payload?.merchantIds) ? payload.merchantIds.map(String) : [];
  if (type === 'popup') {
    const brand = String(payload?.brandName || payload?.merchantName || '').trim();
    if (!merchantIds.length && !brand) throw new Error('Brand is required for pop-up');
    title = title || brand;
  } else if (!title) {
    throw new Error('Title is required');
  }
  const dateStr = payload?.startDate
    ? (typeof payload.startDate === 'string' ? payload.startDate : toYmd(payload.startDate))
    : toYmd(new Date());
  return {
    id,
    title,
    subtitle,
    type,
    startDate: dateStr,
    endDate: payload?.endDate ? (typeof payload.endDate === 'string' ? payload.endDate : toYmd(payload.endDate)) : dateStr,
    timeLabel: String(payload?.timeLabel || '').trim() || '',
    location,
    address: String(payload?.address || '').trim(),
    organizer: String(payload?.organizer || '').trim(),
    description: String(payload?.description || '').trim(),
    merchantIds,
    eventDates: Array.isArray(payload?.eventDates) ? payload.eventDates.map((x) => String(x).slice(0, 10)).filter(Boolean) : [],
    placeId: payload?.placeId != null ? String(payload.placeId) : null,
    lat: typeof payload?.lat === 'number' ? payload.lat : (payload?.lat != null ? Number(payload.lat) : null),
    lng: typeof payload?.lng === 'number' ? payload.lng : (payload?.lng != null ? Number(payload.lng) : null),
    coverPhoto: payload?.coverPhoto != null ? String(payload.coverPhoto) : null,
    coverHue: Number(payload?.coverHue) || 120,
    status: published ? 'upcoming' : 'pending',
    submittedBy: handle,
    published,
    createdAt: Date.now(),
  };
}

/**
 * Create a user-submitted event (pending review: published false).
 * payload: { type, title?, subtitle?, location, startDate (YYYY-MM-DD or Date), timeLabel?, merchantName? for popup }
 */
export async function createEventSubmission(payload) {
  const db = getDb();
  if (!db) throw new Error('Firestore is not available');
  const doc = buildEventDoc(payload, { published: false });
  await db.collection(EVENTS_COLLECTION).doc(doc.id).set(doc);
  return normalizeEventDoc(doc);
}

/** Create and publish an event immediately (no review queue). */
export async function createEvent(payload) {
  const db = getDb();
  if (!db) throw new Error('Firestore is not available');
  const doc = buildEventDoc(payload, { published: true });
  await db.collection(EVENTS_COLLECTION).doc(doc.id).set(doc);
  return normalizeEventDoc(doc);
}

function buildEventPatch(payload) {
  const type = ['popup', 'workshop', 'fest', 'crawl', 'meetup'].includes(payload?.type) ? payload.type : 'fest';
  let title = String(payload?.title || '').trim();
  const subtitle = String(payload?.subtitle || '').trim();
  const location = String(payload?.location || '').trim();
  if (!location) throw new Error('Location is required');
  const merchantIds = Array.isArray(payload?.merchantIds) ? payload.merchantIds.map(String) : [];
  if (type === 'popup') {
    const brand = String(payload?.brandName || payload?.merchantName || '').trim();
    if (!merchantIds.length && !brand) throw new Error('Brand is required for pop-up');
    title = title || brand;
  } else if (!title) {
    throw new Error('Title is required');
  }
  const dateStr = payload?.startDate
    ? (typeof payload.startDate === 'string' ? payload.startDate : toYmd(payload.startDate))
    : toYmd(new Date());
  const endStr = payload?.endDate
    ? (typeof payload.endDate === 'string' ? payload.endDate : toYmd(payload.endDate))
    : dateStr;
  const patch = {
    title,
    subtitle,
    type,
    startDate: dateStr,
    endDate: endStr,
    location,
    address: String(payload?.address || '').trim(),
    organizer: String(payload?.organizer || '').trim(),
    eventDates: Array.isArray(payload?.eventDates) && payload.eventDates.length > 1
      ? payload.eventDates.map((x) => String(x).slice(0, 10)).filter(Boolean)
      : [],
  };
  if (payload?.timeLabel !== undefined) patch.timeLabel = String(payload.timeLabel || '').trim() || '';
  if (Array.isArray(payload?.merchantIds)) patch.merchantIds = merchantIds;
  if (payload?.placeId !== undefined) patch.placeId = payload.placeId != null ? String(payload.placeId) : null;
  if (payload?.lat !== undefined) patch.lat = typeof payload.lat === 'number' ? payload.lat : (payload.lat != null ? Number(payload.lat) : null);
  if (payload?.lng !== undefined) patch.lng = typeof payload.lng === 'number' ? payload.lng : (payload.lng != null ? Number(payload.lng) : null);
  if (payload?.coverPhoto !== undefined) {
    patch.coverPhoto = payload.coverPhoto != null ? String(payload.coverPhoto) : null;
  }
  return patch;
}

export async function updateEvent(eventId, payload) {
  const db = getDb();
  if (!db) throw new Error('Firestore is not available');
  const id = String(eventId || '').trim();
  if (!id) throw new Error('Event id required');
  const snap = await db.collection(EVENTS_COLLECTION).doc(id).get();
  if (!snap.exists) throw new Error('Event not found');
  const patch = buildEventPatch(payload || {});
  await db.collection(EVENTS_COLLECTION).doc(id).update(patch);
  return normalizeEventDoc({ id, ...snap.data(), ...patch });
}

export async function deleteEvent(eventId) {
  const db = getDb();
  if (!db) throw new Error('Firestore is not available');
  const id = String(eventId || '').trim();
  if (!id) throw new Error('Event id required');
  await db.collection(EVENTS_COLLECTION).doc(id).delete();
}

export async function updateEventMerchants(eventId, merchantIds) {
  const db = getDb();
  if (!db) throw new Error('Firestore is not available');
  const id = String(eventId || '').trim();
  if (!id) throw new Error('Event id required');
  const ids = Array.isArray(merchantIds) ? merchantIds.map(String) : [];
  await db.collection(EVENTS_COLLECTION).doc(id).update({ merchantIds: ids });
}

function toYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return toYmd(new Date());
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------- Lists (v2) ----------

function gpCafeIdFromPlaceId(placeId) {
  return `gp_${String(placeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`;
}

function normalizeListEntry(raw, index = 0) {
  if (!raw) return null;
  const placeId = raw.placeId != null && raw.placeId !== '' ? String(raw.placeId) : null;
  const placeName = String(raw.placeName || '').trim();
  let brandId = raw.brandId != null && raw.brandId !== '' ? String(raw.brandId) : null;
  if (!brandId && placeId) brandId = `gplace_${placeId}`;
  if (!brandId) return null;
  const resolvedPlaceId = placeId
    || (brandId.startsWith('gplace_') ? brandId.slice('gplace_'.length) : null);
  const branchId = raw.branchId != null && raw.branchId !== ''
    ? String(raw.branchId)
    : (resolvedPlaceId ? gpCafeIdFromPlaceId(resolvedPlaceId) : null);
  return {
    id: String(raw.id || `entry_${index}`),
    brandId,
    branchId,
    placeId: resolvedPlaceId,
    placeName: placeName || null,
    placeAddress: String(raw.placeAddress || '').trim() || null,
    photoUrl: raw.photoUrl != null && raw.photoUrl !== '' ? String(raw.photoUrl) : null,
  };
}

function normalizeListDoc(raw) {
  if (!raw || !raw.id) return null;
  let entries = Array.isArray(raw.entries)
    ? raw.entries.map((e, i) => normalizeListEntry(e, i)).filter(Boolean)
    : [];
  const legacyItems = Array.isArray(raw.items) ? raw.items.map((x) => String(x)) : [];
  if (!entries.length && legacyItems.length) {
    entries = legacyItems.map((brandId, i) => ({
      id: `legacy_${brandId}_${i}`,
      brandId,
      branchId: null,
      photoUrl: null,
    }));
  }
  const items = entries.length ? entries.map((e) => e.brandId) : legacyItems;
  return {
    id: String(raw.id),
    ownerId: String(raw.ownerId || ''),
    authorHandle: String(raw.authorHandle || '').trim() || String(raw.ownerId || '').slice(0, 12),
    name: String(raw.name || '').trim() || 'List',
    type: raw.type === 'drinks' ? 'drinks' : 'brands',
    description: String(raw.description || '').trim(),
    items,
    entries,
    coverHue: Number.isFinite(raw.coverHue) ? raw.coverHue : 120,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    likeCount: typeof raw.likeCount === 'number' ? raw.likeCount : 0,
  };
}

function normalizeUserProfileDoc(raw) {
  if (!raw) return null;
  const ownerId = String(raw.ownerId || raw.id || '').trim();
  if (!ownerId) return null;
  return {
    ownerId,
    displayName: String(raw.displayName || '').trim(),
    username: String(raw.username || '').trim(),
    avatarUrl: raw.avatarUrl != null && raw.avatarUrl !== '' ? String(raw.avatarUrl) : null,
    instagram: String(raw.instagram || '').trim().replace(/^@/, ''),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

export async function getUserProfile(ownerId) {
  const oid = docId(ownerId);
  if (!oid) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection(USER_PROFILES_COLLECTION).doc(oid).get();
    if (!snap.exists) return null;
    return normalizeUserProfileDoc({ id: snap.id, ...snap.data() });
  } catch (e) {
    console.warn('[Matcha Hop] getUserProfile failed:', e?.message || e);
    return null;
  }
}

export async function upsertUserProfile(ownerId, patch) {
  const oid = docId(ownerId);
  if (!oid) throw new Error('ownerId required');
  const db = getDb();
  if (!db) throw new Error('Firestore not available');
  const clean = { ownerId: oid, updatedAt: Date.now() };
  if (patch?.displayName != null) clean.displayName = String(patch.displayName).trim();
  if (patch?.username != null) clean.username = String(patch.username).trim();
  if (patch?.avatarUrl != null) clean.avatarUrl = patch.avatarUrl ? String(patch.avatarUrl) : null;
  if (patch?.instagram != null) clean.instagram = String(patch.instagram).trim().replace(/^@/, '');
  await db.collection(USER_PROFILES_COLLECTION).doc(oid).set(clean, { merge: true });
  const existing = await getUserProfile(oid);
  return existing || normalizeUserProfileDoc({ id: oid, ...clean });
}

export async function getListsForOwner(ownerId) {
  const oid = docId(ownerId);
  if (!oid) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(LISTS_COLLECTION).where('ownerId', '==', oid).get();
    const rows = snap.docs.map((d) => normalizeListDoc({ id: d.id, ...d.data() })).filter(Boolean);
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return rows;
  } catch (e) {
    console.warn('[Matcha Hop] getListsForOwner failed:', e?.message || e);
    return [];
  }
}

/** All lists (for feed cards / discovery); optional use in v2. */
export async function getAllLists() {
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(LISTS_COLLECTION).get();
    return snap.docs.map((d) => normalizeListDoc({ id: d.id, ...d.data() })).filter(Boolean);
  } catch (e) {
    console.warn('[Matcha Hop] getAllLists failed:', e?.message || e);
    return [];
  }
}

export async function createList(ownerId, payload) {
  const oid = docId(ownerId);
  if (!oid) throw new Error('ownerId required');
  const name = String(payload?.name || '').trim();
  if (!name) throw new Error('List name is required');
  const type = payload?.type === 'drinks' ? 'drinks' : 'brands';
  const id = payload?.id ? docId(payload.id) : uid();
  const prof = typeof getCurrentProfile === 'function' ? getCurrentProfile() : {};
  const authorHandle = String(payload?.authorHandle || '').trim()
    || String(prof?.username || '').replace(/^@/, '').trim()
    || 'member';
  let entries = Array.isArray(payload?.entries)
    ? payload.entries.map((e, i) => normalizeListEntry({ ...e, id: e.id || uid() }, i)).filter(Boolean)
    : [];
  const legacyItems = Array.isArray(payload?.items) ? payload.items.map(String) : [];
  if (!entries.length && legacyItems.length) {
    entries = legacyItems.map((brandId, i) => ({
      id: `legacy_${brandId}_${i}`,
      brandId,
      branchId: null,
      photoUrl: null,
    }));
  }
  if (Array.isArray(payload?.entries) && payload.entries.length > 0 && !entries.length) {
    throw new Error('At least one valid entry is required');
  }
  const items = entries.length ? entries.map((e) => e.brandId) : legacyItems;
  const doc = {
    id,
    ownerId: oid,
    authorHandle,
    name,
    type,
    description: String(payload?.description || '').trim(),
    items,
    entries,
    coverHue: Number(payload?.coverHue) || 120,
    createdAt: Date.now(),
    likeCount: 0,
  };
  const db = getDb();
  if (!db) return normalizeListDoc(doc);
  await db.collection(LISTS_COLLECTION).doc(id).set(doc);
  return normalizeListDoc(doc);
}

export async function updateList(listId, payload) {
  if (!listId) return;
  const db = getDb();
  if (!db) return;
  const clean = {};
  if (payload?.name != null) clean.name = String(payload.name).trim();
  if (payload?.description != null) clean.description = String(payload.description);
  if (Array.isArray(payload?.items)) clean.items = payload.items.map(String);
  if (Array.isArray(payload?.entries)) {
    const entries = payload.entries.map((e, i) => normalizeListEntry(e, i)).filter(Boolean);
    clean.entries = entries;
    clean.items = entries.map((e) => e.brandId);
  }
  if (payload?.type === 'brands' || payload?.type === 'drinks') clean.type = payload.type;
  if (Number.isFinite(payload?.likeCount)) clean.likeCount = payload.likeCount;
  if (Object.keys(clean).length === 0) return;
  try {
    await db.collection(LISTS_COLLECTION).doc(docId(listId)).update(clean);
  } catch (e) {
    console.error('[Matcha Hop] updateList failed:', e?.message || e);
    throw e;
  }
}

export async function deleteList(listId) {
  if (!listId) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(LISTS_COLLECTION).doc(docId(listId)).delete();
  } catch (e) {
    console.error('[Matcha Hop] deleteList failed:', e?.message || e);
    throw e;
  }
}
