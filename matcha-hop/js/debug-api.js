/**
 * Debug: cumulative API call counters in localStorage (for cost tracking).
 * Key: matchaHop_apiCalls = { placesTextSearch: N, mapLoad: N, ... }
 */

import {
  initFirebase,
  getDb,
  LOGS_COLLECTION,
} from './firebase.js';

const DEBUG_API_KEY = 'matchaHop_apiCalls';

export function incrementApiCall(type) {
  try {
    const raw = localStorage.getItem(DEBUG_API_KEY);
    const counts = raw ? JSON.parse(raw) : {};
    counts[type] = (counts[type] || 0) + 1;
    localStorage.setItem(DEBUG_API_KEY, JSON.stringify(counts));
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[Matcha Hop] API calls (cumulative):', counts);
    }
  } catch (_) {}
}

export function getApiCallCounts() {
  try {
    const raw = localStorage.getItem(DEBUG_API_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

async function deleteCollectionBatch(db, collectionName, limit = 400) {
  while (true) {
    const snap = await db.collection(collectionName).limit(limit).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snap.size < limit) break;
  }
}

export async function getFirebaseDebugSnapshot() {
  initFirebase();
  const db = getDb();
  if (!db) {
    throw new Error('Firebase is not configured.');
  }
  const snap = await db.collection(LOGS_COLLECTION).get();
  const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  posts.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  return {
    logs: {
      count: posts.length,
      sampleIds: posts.slice(0, 8).map((p) => p.id),
      latest: posts.slice(0, 25).map((p) => ({
        id: p.id,
        brandName: p.visit?.brandName || '',
        drinkName: p.post?.drinks?.[0]?.name || '',
        createdAt: Number(p.createdAt) || 0,
      })),
    },
  };
}

export async function clearAllPostsData() {
  initFirebase();
  const db = getDb();
  if (!db) {
    throw new Error('Firebase is not configured.');
  }
  await deleteCollectionBatch(db, LOGS_COLLECTION);
}

export async function deletePostById(postId) {
  initFirebase();
  const db = getDb();
  if (!db) {
    throw new Error('Firebase is not configured.');
  }
  const id = String(postId || '').trim();
  if (!id) throw new Error('Post ID is required.');
  await db.collection(LOGS_COLLECTION).doc(id).delete();
}
