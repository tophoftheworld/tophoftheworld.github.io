import {
  listPhotos,
  putPhotos,
  getGiveaway,
  saveGiveaway,
  getPhotoById,
} from './db.js';
import {
  getFirebase,
  GIVEAWAY_DOC,
  PHOTOS_COLLECTION,
  STORAGE_PREFIX,
  THUMB_STORAGE_PREFIX,
} from './firebase.js';
import { createThumbnail } from './image-utils.js';

const fullResUrlCache = new Map();

function photoMetaFromLocal(photo) {
  const storagePath = `${STORAGE_PREFIX}/${photo.id}`;
  const thumbStoragePath = `${THUMB_STORAGE_PREFIX}/${photo.id}`;
  return {
    name: photo.name || 'Untitled',
    username: photo.username || '',
    displayName: photo.displayName || '',
    notes: photo.notes || '',
    layout: photo.layout || 'fullscreen',
    storyDate: photo.storyDate || '',
    storyTime: photo.storyTime || '',
    contentType: photo.contentType || '',
    size: photo.size || photo.blob?.size || 0,
    createdAt: photo.createdAt || Date.now(),
    storagePath,
    thumbStoragePath,
  };
}

async function uploadThumbForPhoto(photo, storage) {
  if (!photo.blob) return null;
  const thumbPath = `${THUMB_STORAGE_PREFIX}/${photo.id}`;
  const thumbBlob = await createThumbnail(photo.blob);
  const { ref, uploadBytes } = await import(
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js'
  );
  await uploadBytes(ref(storage, thumbPath), thumbBlob, { contentType: 'image/jpeg' });
  return thumbPath;
}

function giveawayForCloud(g) {
  return {
    id: 'current',
    name: g.name || 'Story Giveaway',
    batches: g.batches || [],
    currentBatchIndex: g.currentBatchIndex || 0,
    wonUsernames: g.wonUsernames || [],
    wonPhotoIds: g.wonPhotoIds || [],
    batchResults: g.batchResults || [],
    forcedIncludePhotoIds: g.forcedIncludePhotoIds || [],
    forcedExcludePhotoIds: g.forcedExcludePhotoIds || [],
    updatedAt: Date.now(),
  };
}

/**
 * Push local giveaway state to Firestore.
 * @param {object} [data] — if omitted, reads from IDB
 */
export async function pushGiveaway(data) {
  const { db } = await getFirebase();
  const {
    doc,
    setDoc,
  } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');

  const g = data || (await getGiveaway());
  const payload = giveawayForCloud(g);
  await setDoc(doc(db, ...GIVEAWAY_DOC.split('/')), payload, { merge: true });
  return payload;
}

/**
 * Subscribe to cloud giveaway. Mirrors into IDB (notify: false) then calls onChange.
 * @returns {Promise<() => void>} unsubscribe
 */
export async function subscribeGiveaway(onChange) {
  const { db } = await getFirebase();
  const {
    doc,
    onSnapshot,
  } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');

  const ref = doc(db, ...GIVEAWAY_DOC.split('/'));
  return onSnapshot(
    ref,
    async (snap) => {
      if (!snap.exists()) {
        onChange?.(null);
        return;
      }
      const data = snap.data();
      const local = await saveGiveaway(
        {
          name: data.name,
          batches: data.batches || [],
          currentBatchIndex: data.currentBatchIndex || 0,
          wonUsernames: data.wonUsernames || [],
          wonPhotoIds: data.wonPhotoIds || [],
          batchResults: data.batchResults || [],
          forcedIncludePhotoIds: data.forcedIncludePhotoIds || [],
          forcedExcludePhotoIds: data.forcedExcludePhotoIds || [],
        },
        { notify: false }
      );
      onChange?.(local);
    },
    (err) => {
      console.error('Giveaway subscription error', err);
    }
  );
}

/**
 * Upload local IDB photos missing (or force-all) to Storage + Firestore meta.
 * Concurrent blob uploads with per-file byte progress so the UI doesn't look stuck.
 * @param {{ onProgress?: (p: object) => void, force?: boolean, concurrency?: number }} [opts]
 */
export async function uploadAllPhotos(opts = {}) {
  const { onProgress, force = false, concurrency = 3 } = opts;
  const { db, storage } = await getFirebase();
  const {
    collection,
    doc,
    getDocs,
    setDoc,
  } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
  const { ref, uploadBytesResumable } = await import(
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js'
  );

  onProgress?.({ done: 0, total: 0, phase: 'listing', name: '' });
  const local = await listPhotos();
  if (!local.length) {
    return { uploaded: 0, skipped: 0, total: 0, metaUpdated: 0, failed: [] };
  }

  onProgress?.({ done: 0, total: local.length, phase: 'checking', name: '' });
  let cloudIds = new Set();
  if (!force) {
    const snap = await getDocs(collection(db, ...PHOTOS_COLLECTION.split('/')));
    cloudIds = new Set(snap.docs.map((d) => d.id));
  }

  const needBlob = [];
  const metaOnly = [];
  for (const photo of local) {
    if (force || !cloudIds.has(photo.id)) needBlob.push(photo);
    else metaOnly.push(photo);
  }

  let metaUpdated = 0;
  const failed = [];

  // Fast path: refresh Firestore metadata for photos already in Storage
  for (let i = 0; i < metaOnly.length; i++) {
    const photo = metaOnly[i];
    const meta = photoMetaFromLocal(photo);
    onProgress?.({
      done: i,
      total: metaOnly.length,
      phase: 'meta',
      name: photo.name,
    });
    try {
      if (photo.blob) {
        meta.thumbStoragePath = await uploadThumbForPhoto(photo, storage);
      }
      await setDoc(doc(db, ...PHOTOS_COLLECTION.split('/'), photo.id), meta, { merge: true });
      metaUpdated += 1;
    } catch (err) {
      failed.push({ name: photo.name, error: err?.message || String(err) });
    }
  }

  let uploaded = 0;
  const blobTotal = needBlob.length;
  const active = new Map(); // id -> { name, percent }

  function reportBlobProgress() {
    const parts = [...active.values()];
    const current = parts[0];
    const pct =
      current && typeof current.percent === 'number'
        ? Math.round(current.percent * 100)
        : null;
    onProgress?.({
      done: uploaded,
      total: blobTotal,
      phase: 'upload',
      name: current?.name || '',
      percent: current?.percent,
      active: parts.length,
      detail:
        pct != null
          ? `${uploaded}/${blobTotal} · ${current.name} · ${pct}%`
          : `${uploaded}/${blobTotal}${current?.name ? ` · ${current.name}` : ''}`,
    });
  }

  function uploadBlob(photo) {
    const meta = photoMetaFromLocal(photo);
    const storageRef = ref(storage, meta.storagePath);
    const contentType = photo.blob?.type || 'image/jpeg';

    return new Promise((resolve, reject) => {
      active.set(photo.id, { name: photo.name, percent: 0 });
      reportBlobProgress();

      const task = uploadBytesResumable(storageRef, photo.blob, { contentType });
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          task.cancel();
        } catch {
          /* ignore */
        }
        active.delete(photo.id);
        reject(new Error(`Timed out uploading ${photo.name}`));
      }, 120000);

      task.on(
        'state_changed',
        (snap) => {
          const percent = snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0;
          active.set(photo.id, { name: photo.name, percent });
          reportBlobProgress();
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          active.delete(photo.id);
          reject(err);
        },
        async () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            meta.thumbStoragePath = await uploadThumbForPhoto(photo, storage);
            await setDoc(doc(db, ...PHOTOS_COLLECTION.split('/'), photo.id), meta, {
              merge: true,
            });
            active.delete(photo.id);
            uploaded += 1;
            metaUpdated += 1;
            reportBlobProgress();
            resolve();
          } catch (err) {
            active.delete(photo.id);
            reject(err);
          }
        }
      );
    });
  }

  // Concurrent pool
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(blobTotal, 1)) }, async () => {
    while (next < needBlob.length) {
      const photo = needBlob[next++];
      try {
        await uploadBlob(photo);
      } catch (err) {
        console.error('Upload failed', photo.name, err);
        failed.push({ name: photo.name, error: err?.message || String(err) });
        active.delete(photo.id);
        reportBlobProgress();
      }
    }
  });

  if (blobTotal > 0) await Promise.all(workers);

  if (failed.length && uploaded === 0 && needBlob.length > 0) {
    const first = failed[0];
    throw new Error(
      `Upload failed (${failed.length}): ${first.name} — ${first.error}`
    );
  }

  return {
    uploaded,
    skipped: local.length - uploaded,
    total: local.length,
    metaUpdated,
    failed,
  };
}

/**
 * Download cloud photo meta + blobs into local IDB.
 * @param {{ onProgress?: (p: object) => void, force?: boolean, thumbsOnly?: boolean }} [opts]
 */
export async function pullPhotosToLocal(opts = {}) {
  const { onProgress, force = false, thumbsOnly = false } = opts;
  const { db, storage } = await getFirebase();
  const { collection, getDocs } = await import(
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js'
  );
  const { ref, getBlob } = await import(
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js'
  );

  const snap = await getDocs(collection(db, ...PHOTOS_COLLECTION.split('/')));
  const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!remote.length) {
    return { pulled: 0, skipped: 0, total: 0 };
  }

  const local = await listPhotos();
  const localById = new Map(local.map((p) => [p.id, p]));

  function needsPull(meta) {
    const existing = localById.get(meta.id);
    if (!existing) return true;
    if (force) return true;
    if (thumbsOnly && !existing.thumbBlob) return true;
    return false;
  }

  const toPull = remote.filter((p) => needsPull(p));
  const toPatch = force ? [] : remote.filter((p) => localById.has(p.id) && !needsPull(p));

  if (toPatch.length) {
    const patched = toPatch.map((meta) => {
      const existing = localById.get(meta.id);
      return {
        ...existing,
        name: meta.name || existing.name,
        username: meta.username ?? existing.username,
        displayName: meta.displayName ?? existing.displayName,
        notes: meta.notes ?? existing.notes,
        layout: meta.layout || existing.layout,
        storyDate: meta.storyDate ?? existing.storyDate,
        storyTime: meta.storyTime ?? existing.storyTime,
        contentType: meta.contentType ?? existing.contentType,
        size: meta.size || existing.size,
        createdAt: meta.createdAt || existing.createdAt,
        storagePath: meta.storagePath || existing.storagePath || `${STORAGE_PREFIX}/${meta.id}`,
        thumbStoragePath:
          meta.thumbStoragePath ||
          existing.thumbStoragePath ||
          `${THUMB_STORAGE_PREFIX}/${meta.id}`,
      };
    });
    await putPhotos(patched);
  }

  const records = [];
  let done = 0;
  const total = toPull.length;

  for (const meta of toPull) {
    const storagePath = meta.storagePath || `${STORAGE_PREFIX}/${meta.id}`;
    const thumbPath = meta.thumbStoragePath || `${THUMB_STORAGE_PREFIX}/${meta.id}`;
    onProgress?.({ done, total, name: meta.name || meta.id });

    let thumbBlob = null;
    let blob = null;
    let hasLocalFull = false;

    if (thumbsOnly) {
      try {
        thumbBlob = await getBlob(ref(storage, thumbPath));
      } catch {
        // Legacy pack without thumbs — one-time full download
        blob = await getBlob(ref(storage, storagePath));
        hasLocalFull = true;
      }
    } else {
      blob = await getBlob(ref(storage, storagePath));
      hasLocalFull = true;
      try {
        thumbBlob = await getBlob(ref(storage, thumbPath));
      } catch {
        /* thumb optional when pulling full */
      }
    }

    records.push({
      id: meta.id,
      blob,
      thumbBlob,
      storagePath,
      thumbStoragePath: thumbPath,
      hasLocalFull,
      name: meta.name || 'Untitled',
      username: meta.username || '',
      displayName: meta.displayName || '',
      notes: meta.notes || '',
      layout: meta.layout || 'fullscreen',
      storyDate: meta.storyDate || '',
      storyTime: meta.storyTime || '',
      contentType: meta.contentType || '',
      size: meta.size || thumbBlob?.size || blob?.size || 0,
      createdAt: meta.createdAt || Date.now(),
    });
    done += 1;
    onProgress?.({ done, total, name: meta.name || meta.id });

    if (records.length >= 20) {
      await putPhotos(records.splice(0, records.length));
    }
  }

  if (records.length) await putPhotos(records);

  return {
    pulled: total,
    skipped: remote.length - total,
    total: remote.length,
    metaPatched: toPatch.length,
    thumbsOnly,
  };
}

/**
 * Fetch a full-resolution object URL for lightbox / winner reveal (lazy).
 */
export async function fetchFullResUrl(photoId) {
  if (fullResUrlCache.has(photoId)) return fullResUrlCache.get(photoId);

  const local = await getPhotoById(photoId);
  if (local?.blob) {
    const url = URL.createObjectURL(local.blob);
    fullResUrlCache.set(photoId, url);
    return url;
  }

  const path = local?.storagePath || `${STORAGE_PREFIX}/${photoId}`;
  const { storage } = await getFirebase();
  const { ref, getBlob } = await import(
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js'
  );
  const blob = await getBlob(ref(storage, path));
  const url = URL.createObjectURL(blob);
  fullResUrlCache.set(photoId, url);
  return url;
}

/**
 * Ensure local has all cloud photos (pull missing) and return local list length.
 * Phone draw app uses thumbnails only for the feed.
 */
export async function ensurePhotosFromCloud(onProgress) {
  const local = await listPhotos();
  const result = await pullPhotosToLocal({ onProgress, force: false, thumbsOnly: true });
  if (!local.length && result.total === 0) {
    return { ...result, localCount: 0 };
  }
  const after = await listPhotos();
  return { ...result, localCount: after.length };
}

/**
 * Full sync from admin: upload photos + push giveaway.
 */
export async function syncToCloud(opts = {}) {
  const photoResult = await uploadAllPhotos(opts);
  const giveaway = await pushGiveaway();
  return { ...photoResult, giveaway };
}
