const DB_NAME = 'story-giveaway';
const DB_VERSION = 3;
const STORE = 'photos';
const META_STORE = 'meta';
const GIVEAWAY_STORE = 'giveaway';
const GIVEAWAY_ID = 'current';
const CHANNEL_NAME = 'story-giveaway';

let dbPromise = null;
let channel = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('name', 'name', { unique: false });
      } else if (req.oldVersion < 2) {
        const store = req.transaction.objectStore(STORE);
        if (!store.indexNames.contains('name')) {
          store.createIndex('name', 'name', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'filenameKey' });
      }
      if (!db.objectStoreNames.contains(GIVEAWAY_STORE)) {
        db.createObjectStore(GIVEAWAY_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Normalize file names for matching (basename, lower-case). */
export function filenameKey(name) {
  const base = String(name || '')
    .replace(/^.*[/\\]/, '')
    .trim();
  return base.toLowerCase();
}

export function stripExtension(name) {
  return String(name || '').replace(/\.[^.]+$/, '') || String(name || 'Untitled');
}

/** Label for winners UI: username if set, else file name (no extension). */
export function displayLabel(photo) {
  const user = String(photo?.username || '').trim();
  if (user) return user;
  return stripExtension(photo?.name || photo?.filename || 'Untitled');
}

/**
 * Normalize frame tags from CSV/JSON.
 * Real pack column: frame_type = framed | fullscreen
 */
export function normalizeLayout(raw, notes = '') {
  const direct = String(raw || '').trim().toLowerCase();
  if (['framed', 'frame', 'repost', 'reshare', 'shared'].includes(direct)) return 'framed';
  if (['fullscreen', 'full', 'full_screen', 'full-screen', 'fs'].includes(direct)) {
    return 'fullscreen';
  }

  const n = String(notes || '').toLowerCase();
  if (/\b(framed|frame|repost|reshare)\b/.test(n)) return 'framed';
  if (/\bfull[\s_-]?screen\b/.test(n) || /\b\bfs\b/.test(n)) return 'fullscreen';
  return 'fullscreen';
}

export function layoutFromEntry(raw = {}) {
  // Prefer the pack's frame_type column
  const tag =
    raw.frame_type ??
    raw.frameType ??
    raw.layout ??
    raw.frame ??
    raw.presentation ??
    '';
  return normalizeLayout(tag, raw.notes);
}

export function getChannel() {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

export function notifyPhotosUpdated() {
  const ch = getChannel();
  if (ch) ch.postMessage({ type: 'photos-updated', at: Date.now() });
}

export function notifyGiveawayUpdated() {
  const ch = getChannel();
  if (ch) ch.postMessage({ type: 'giveaway-updated', at: Date.now() });
}

export function onPhotosUpdated(callback) {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event) => {
    if (event.data?.type === 'photos-updated') callback(event.data);
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}

export function onGiveawayUpdated(callback) {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event) => {
    if (event.data?.type === 'giveaway-updated') callback(event.data);
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

async function getMetaMap(db) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(META_STORE)) {
      resolve(new Map());
      return;
    }
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () => {
      const map = new Map();
      for (const row of req.result || []) {
        map.set(row.filenameKey, row);
      }
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addPhotos(files) {
  const db = await openDb();
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (!list.length) return [];

  const metaMap = await getMetaMap(db);
  const added = [];
  const CHUNK = 40;

  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK);
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    for (const file of slice) {
      const blob = file.slice(0, file.size, file.type || 'image/jpeg');
      const name = file.name || 'Untitled';
      const meta = metaMap.get(filenameKey(name));
      const record = {
        id: uuid(),
        blob,
        name,
        username: meta?.username || '',
        displayName: meta?.displayName || '',
        notes: meta?.notes || '',
        layout: meta?.layout || 'fullscreen',
        storyDate: meta?.storyDate || '',
        storyTime: meta?.storyTime || '',
        contentType: meta?.contentType || '',
        size: file.size || blob.size || 0,
        createdAt: Date.now() + i,
      };
      store.put(record);
      added.push({
        id: record.id,
        name: record.name,
        username: record.username,
        size: record.size,
        createdAt: record.createdAt,
      });
    }

    await txDone(tx);
  }

  notifyPhotosUpdated();
  return added;
}

export async function listPhotos() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result || []).slice().sort((a, b) => a.createdAt - b.createdAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Upsert photo records — blob and/or thumbBlob. */
export async function putPhotos(records) {
  const list = Array.isArray(records)
    ? records.filter((r) => r?.id && (r?.blob || r?.thumbBlob))
    : [];
  if (!list.length) return 0;

  const db = await openDb();
  const CHUNK = 40;
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK);
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const record of slice) {
      store.put({
        id: record.id,
        blob: record.blob ?? null,
        thumbBlob: record.thumbBlob ?? null,
        storagePath: record.storagePath || '',
        thumbStoragePath: record.thumbStoragePath || '',
        hasLocalFull: record.hasLocalFull ?? Boolean(record.blob),
        name: record.name || 'Untitled',
        username: record.username || '',
        displayName: record.displayName || '',
        notes: record.notes || '',
        layout: record.layout || 'fullscreen',
        storyDate: record.storyDate || '',
        storyTime: record.storyTime || '',
        contentType: record.contentType || '',
        size: record.size || record.blob?.size || record.thumbBlob?.size || 0,
        createdAt: record.createdAt || Date.now(),
      });
    }
    await txDone(tx);
  }

  notifyPhotosUpdated();
  return list.length;
}

/**
 * Upsert metadata by filename and patch any already-uploaded photos.
 * @param {Array<object>} entries
 */
export async function importEntries(entries) {
  const db = await openDb();
  const list = Array.isArray(entries) ? entries : [];
  const normalized = [];

  for (const raw of list) {
    const filename = String(raw.filename || raw.file || raw.name || '').trim();
    if (!filename) continue;
    const key = filenameKey(filename);
    const notes = String(raw.notes || '').trim();
    normalized.push({
      filenameKey: key,
      filename,
      username: String(raw.username || raw.handle || '').trim(),
      displayName: String(raw.display_name || raw.displayName || '').trim(),
      notes,
      layout: layoutFromEntry(raw),
      storyDate: String(raw.story_date || raw.storyDate || '').trim(),
      storyTime: String(raw.story_time || raw.storyTime || '').trim(),
      contentType: String(raw.content_type || raw.contentType || '').trim(),
    });
  }

  if (!normalized.length) {
    return { metaCount: 0, photosUpdated: 0 };
  }

  {
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    for (const row of normalized) store.put(row);
    await txDone(tx);
  }

  const metaByKey = new Map(normalized.map((r) => [r.filenameKey, r]));
  let photosUpdated = 0;

  {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    for (const photo of all) {
      const meta = metaByKey.get(filenameKey(photo.name));
      if (!meta) continue;
      photo.username = meta.username;
      photo.displayName = meta.displayName;
      photo.notes = meta.notes;
      photo.layout = meta.layout;
      photo.storyDate = meta.storyDate;
      photo.storyTime = meta.storyTime;
      photo.contentType = meta.contentType;
      store.put(photo);
      photosUpdated += 1;
    }
    await txDone(tx);
  }

  notifyPhotosUpdated();
  return { metaCount: normalized.length, photosUpdated };
}

export async function deletePhoto(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  notifyPhotosUpdated();
}

export async function clearAll() {
  const db = await openDb();
  const stores = [STORE];
  if (db.objectStoreNames.contains(META_STORE)) stores.push(META_STORE);
  const tx = db.transaction(stores, 'readwrite');
  tx.objectStore(STORE).clear();
  if (stores.includes(META_STORE)) tx.objectStore(META_STORE).clear();
  await txDone(tx);
  notifyPhotosUpdated();
}

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function defaultGiveaway() {
  return {
    id: GIVEAWAY_ID,
    name: 'Story Giveaway',
    batches: [],
    currentBatchIndex: 0,
    wonUsernames: [],
    wonPhotoIds: [],
    batchResults: [],
    // Manual per-photo overrides for the draw.
    // - Include (Must win): guaranteed winner on next draw; cleared after draw.
    // - Exclude: stays in grid but never picked as winner.
    forcedIncludePhotoIds: [],
    forcedExcludePhotoIds: [],
  };
}

export async function getGiveaway() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GIVEAWAY_STORE, 'readonly');
    const req = tx.objectStore(GIVEAWAY_STORE).get(GIVEAWAY_ID);
    req.onsuccess = () => {
      resolve(req.result ? { ...defaultGiveaway(), ...req.result } : defaultGiveaway());
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveGiveaway(data, { notify = true } = {}) {
  const db = await openDb();
  const record = {
    ...defaultGiveaway(),
    ...data,
    id: GIVEAWAY_ID,
  };
  const tx = db.transaction(GIVEAWAY_STORE, 'readwrite');
  tx.objectStore(GIVEAWAY_STORE).put(record);
  await txDone(tx);
  if (notify) notifyGiveawayUpdated();
  return record;
}

export async function setGiveawayName(name) {
  const g = await getGiveaway();
  if ((g.currentBatchIndex || 0) > 0 || (g.batchResults || []).length > 0) {
    throw new Error('Start over before editing the giveaway');
  }
  g.name = String(name || '').trim() || 'Story Giveaway';
  return saveGiveaway(g);
}

export async function addBatch(prize) {
  const text = String(prize || '').trim();
  if (!text) throw new Error('Prize name required');
  const g = await getGiveaway();
  if ((g.currentBatchIndex || 0) > 0 || (g.batchResults || []).length > 0) {
    throw new Error('Start over before editing batches');
  }
  g.batches.push({
    id: uuid(),
    prize: text,
    order: g.batches.length,
  });
  return saveGiveaway(g);
}

export async function updateBatchPrize(batchId, prize) {
  const text = String(prize || '').trim();
  if (!text) throw new Error('Prize name required');
  const g = await getGiveaway();
  if ((g.currentBatchIndex || 0) > 0 || (g.batchResults || []).length > 0) {
    throw new Error('Start over before editing batches');
  }
  const batch = g.batches.find((b) => b.id === batchId);
  if (!batch) throw new Error('Batch not found');
  batch.prize = text;
  return saveGiveaway(g);
}

export async function removeBatch(batchId) {
  const g = await getGiveaway();
  if ((g.currentBatchIndex || 0) > 0 || (g.batchResults || []).length > 0) {
    throw new Error('Start over before editing batches');
  }
  g.batches = g.batches
    .filter((b) => b.id !== batchId)
    .map((b, i) => ({ ...b, order: i }));
  if (g.currentBatchIndex > g.batches.length) {
    g.currentBatchIndex = g.batches.length;
  }
  return saveGiveaway(g);
}

export async function resetGiveawayProgress() {
  const g = await getGiveaway();
  g.currentBatchIndex = 0;
  g.wonUsernames = [];
  g.wonPhotoIds = [];
  g.batchResults = [];
  return saveGiveaway(g);
}

/**
 * Cycle manual eligibility override for a single photo.
 * State order: None -> Include -> Exclude -> None
 * @param {string} photoId
 * @returns {Promise<{forcedIncludePhotoIds: string[], forcedExcludePhotoIds: string[]}>}
 */
export async function cyclePhotoForce(photoId) {
  const id = String(photoId || '').trim();
  if (!id) throw new Error('Photo id required');

  const g = await getGiveaway();
  const include = new Set(g.forcedIncludePhotoIds || []);
  const exclude = new Set(g.forcedExcludePhotoIds || []);

  const isInc = include.has(id);
  const isExc = exclude.has(id);

  // Decide next state
  let next = 'include';
  if (isInc) next = 'exclude';
  else if (isExc) next = 'none';

  include.delete(id);
  exclude.delete(id);

  if (next === 'include') include.add(id);
  if (next === 'exclude') exclude.add(id);

  g.forcedIncludePhotoIds = [...include];
  g.forcedExcludePhotoIds = [...exclude];
  await saveGiveaway(g);
  return {
    forcedIncludePhotoIds: g.forcedIncludePhotoIds,
    forcedExcludePhotoIds: g.forcedExcludePhotoIds,
  };
}

/**
 * Record a completed batch draw and advance the pointer.
 * @param {{ winners: Array<{ id: string, username?: string, label: string }> }}
 */
export async function recordBatchDraw({ winners }) {
  const g = await getGiveaway();
  if (!g.batches.length) throw new Error('No prize batches configured');
  if (g.currentBatchIndex >= g.batches.length) {
    throw new Error('All prizes already drawn');
  }

  const batch = g.batches[g.currentBatchIndex];
  const wonUsers = new Set(g.wonUsernames || []);
  const wonIds = new Set(g.wonPhotoIds || []);

  for (const w of winners) {
    const key = normalizeUsername(w.username);
    if (key) wonUsers.add(key);
    else if (w.id) wonIds.add(w.id);
  }

  g.wonUsernames = [...wonUsers];
  g.wonPhotoIds = [...wonIds];
  g.batchResults = [
    ...(g.batchResults || []),
    {
      batchId: batch.id,
      prize: batch.prize,
      winnerPhotoIds: winners.map((w) => w.id),
      winnerLabels: winners.map((w) => w.label),
    },
  ];
  g.currentBatchIndex += 1;
  // Must-win flags are one-shot per draw.
  g.forcedIncludePhotoIds = [];
  return saveGiveaway(g);
}

export function getPhotoUrl(photo) {
  const blob = photo?.blob || photo?.thumbBlob;
  if (!blob) return '';
  return URL.createObjectURL(blob);
}

/** Feed / grid — prefer stored thumbnail over full screenshot. */
export function getThumbUrl(photo) {
  const blob = photo?.thumbBlob || photo?.blob;
  if (!blob) return '';
  return URL.createObjectURL(blob);
}

export async function getPhotoById(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export function revokePhotoUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Parse entries.csv or entries.json File → array of entry objects. */
export async function parseEntriesFile(file) {
  const text = await file.text();
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.entries)) return data.entries;
    throw new Error('JSON must be an array or { "entries": [...] }');
  }

  return parseCsv(text);
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] || '').trim();
    });
    if (row.filename || row.file || row.name) rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
