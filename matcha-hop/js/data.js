/**
 * Data layer: Firestore (primary) with IndexedDB fallback and one-time migration from IndexedDB to Firestore.
 * In-memory cache for sync reads; initData() must be awaited before use.
 */

import { getDb, initFirebase, initAuth, getCurrentUserId, CAFES_COLLECTION, LOGS_COLLECTION, SETTINGS_COLLECTION, BRANDS_CONFIG_DOC, BRAND_POPUPS_COLLECTION, BRAND_LIKES_COLLECTION, LOCATION_LIKES_COLLECTION } from './firebase.js';

const DB_NAME = 'matchaHop';
const DB_VERSION = 1;
const STORE_CAFES = 'cafes';
const STORE_LOGS = 'logs';
const LEGACY_CAFES = 'matchaHop_cafes';
const LEGACY_LOGS = 'matchaHop_logs';

let idb = null;
let _cafes = [];
let _logs = [];
let _dataInited = false;
let _brandsConfig = null;

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
      return { id: docId(d.id), ...data, createdAt: createdAtMs };
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
    return;
  }

  _cafes = idbCafes || [];
  _logs = idbLogs || [];
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
  return [..._logs];
}

export function getLogsByCafeId(cafeId) {
  return _logs
    .filter((l) => docId(l.cafeId) === docId(cafeId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getLogsByBrandId(brandId) {
  if (!brandId) return [];
  const id = docId(brandId);
  return _logs
    .filter((l) => docId(l.brandId) === id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getLogsByPopupId(popupId) {
  if (!popupId) return [];
  const id = docId(popupId);
  return _logs
    .filter((l) => docId(l.popupId) === id)
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
  for (const log of _logs) {
    if (seen.has(log.id)) continue;
    if (docId(log.brandId) === brandId || cafeIds.has(docId(log.cafeId)) || popupIds.has(docId(log.popupId))) {
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
  const photos = Array.isArray(log.photos) && log.photos.length > 0
    ? log.photos
    : (log.photo ? [log.photo] : []);
  const entry = {
    id,
    cafeId: log.cafeId ?? null,
    cafe: log.cafe ?? null,
    brandId: log.brandId ?? null,
    brandName: log.brandName || null,
    popupId: log.popupId ?? null,
    drinkName: log.drinkName || '',
    orderRating: log.orderRating ?? 0,
    cafeRating: log.cafeRating ?? 0,
    notes: log.notes || '',
    photo: photos[0] || null,
    photos,
    createdAt: log.createdAt ?? Date.now(),
  };
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
  const cafeIds = [...new Set(_logs.map((l) => l.cafeId).filter(Boolean))];
  return cafeIds.map((cafeId) => _cafes.find((c) => c.id === cafeId)).filter(Boolean);
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

/** Resolve brands config to full brand objects with cafes array (for gallery). Returns [{ id, name, cafeIds, cafes: cafe[] }]. */
export async function getGalleryBrands() {
  const config = await getBrandsConfig();
  return config.brands.map((b) => {
    const cafeIds = Array.isArray(b.cafeIds) ? b.cafeIds : [];
    const cafes = cafeIds.map((id) => getCafeById(docId(id))).filter(Boolean);
    return { id: b.id || uid(), name: b.name || 'Unnamed', cafeIds, cafes };
  });
}

// ---------- Brand pop-ups (contributed, time-based locations) ----------

/** Fetch all pop-ups for a brand from Firestore. Returns [{ id, brandId, address, placeId, lat, lng, startDate, endDate, name?, createdAt }]. */
export async function getPopUpsByBrandId(brandId) {
  if (!brandId) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(BRAND_POPUPS_COLLECTION).where('brandId', '==', brandId).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.warn('[Matcha Hop] getPopUpsByBrandId failed:', e?.message || e);
    return [];
  }
}

/** Add a pop-up for a brand. payload: { address, placeId?, lat, lng, startDate, endDate, name? }. Returns the new pop-up with id. */
export async function addPopUp(brandId, payload) {
  if (!brandId) throw new Error('brandId required');
  const id = uid();
  const doc = {
    id,
    brandId,
    address: payload.address ?? '',
    placeId: payload.placeId ?? null,
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,
    startDate: payload.startDate ?? null,
    endDate: payload.endDate ?? null,
    name: payload.name ?? null,
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

/** Update an existing pop-up by id. payload: { address?, placeId?, lat?, lng?, startDate?, endDate?, name? }. */
export async function updatePopUp(id, payload) {
  if (!id) throw new Error('pop-up id required');
  const db = getDb();
  if (!db) return;
  const doc = {
    address: payload.address ?? null,
    placeId: payload.placeId ?? null,
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,
    startDate: payload.startDate ?? null,
    endDate: payload.endDate ?? null,
    name: payload.name ?? null,
  };
  const clean = Object.fromEntries(Object.entries(doc).filter(([, v]) => v != null));
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
    };
  } catch {
    return { brandIds: [], locationIds: [] };
  }
}

function saveLocalLikes(data) {
  const payload = {
    brandIds: data.brandIds || [],
    locationIds: data.locationIds || [],
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
