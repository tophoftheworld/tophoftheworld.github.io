/**
 * Place details cache: Firestore (placeDetails) + Firebase Storage (place photos).
 * getCachedPlaceDetails / setCachedPlaceDetails use Firestore; uploadPlacePhoto stores image in Storage and returns URL.
 */

import { getDb, getStorage, PLACE_DETAILS_COLLECTION } from './firebase.js';

/** Firestore doc IDs cannot contain "/"; use a safe key for placeDetails so read/write match. */
export function safePlaceIdPath(placeId) {
  if (!placeId || typeof placeId !== 'string') return null;
  return placeId.replace(/\//g, '_');
}

/**
 * Read cached place details from Firestore. Returns { photoUrl, rating, userRatingCount, openStatus } or null.
 */
export async function getCachedPlaceDetails(placeId) {
  if (!placeId) return null;
  const docId = safePlaceIdPath(placeId);
  if (!docId) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const doc = await db.collection(PLACE_DETAILS_COLLECTION).doc(docId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
      photoUrl: data.photoUrl ?? null,
      rating: data.rating ?? null,
      userRatingCount: data.userRatingCount ?? null,
      openStatus: data.openStatus ?? null,
    };
  } catch (e) {
    console.warn('[Matcha Hop] getCachedPlaceDetails failed:', e?.message || e);
    return null;
  }
}

/**
 * Write place details to Firestore. details = { photoUrl, rating, userRatingCount, openStatus }.
 */
export async function setCachedPlaceDetails(placeId, details) {
  if (!placeId) return;
  const docId = safePlaceIdPath(placeId);
  if (!docId) return;
  const db = getDb();
  if (!db) return;
  try {
    const payload = {
      placeId,
      photoUrl: details.photoUrl ?? null,
      rating: details.rating ?? null,
      userRatingCount: details.userRatingCount ?? null,
      openStatus: details.openStatus ?? null,
      fetchedAt: typeof window !== 'undefined' && window.firebase?.firestore?.FieldValue?.serverTimestamp
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : new Date(),
    };
    await db.collection(PLACE_DETAILS_COLLECTION).doc(docId).set(payload);
  } catch (e) {
    console.error('[Matcha Hop] setCachedPlaceDetails failed:', e?.message || e);
  }
}

/**
 * Upload place photo blob to Firebase Storage at placePhotos/{placeId}.jpg.
 * Returns the permanent download URL, or null on failure.
 */
export async function uploadPlacePhoto(placeId, imageBlob) {
  if (!placeId || !imageBlob) return null;
  const st = getStorage();
  if (!st) return null;
  const path = safePlaceIdPath(placeId);
  if (!path) return null;
  const pathWithExt = `placePhotos/${path}.jpg`;
  try {
    const ref = st.ref(pathWithExt);
    await ref.put(imageBlob, { contentType: imageBlob.type || 'image/jpeg' });
    const url = await ref.getDownloadURL();
    return url;
  } catch (e) {
    console.warn('[Matcha Hop] uploadPlacePhoto failed:', e?.message || e);
    return null;
  }
}
