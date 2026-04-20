/**
 * Firebase Firestore and Storage init. Requires Firebase compat scripts loaded before this module
 * (firebase-app-compat, firebase-firestore-compat, firebase-storage-compat).
 * Set window.FIREBASE_CONFIG in config.js. If not set, getDb() returns null and data layer falls back to IndexedDB.
 */

let firestore = null;
let storage = null;

export function initFirebase() {
  if (firestore !== null) return firestore;
  const firebase = typeof window !== 'undefined' ? window.firebase : null;
  const config = typeof window !== 'undefined' ? window.FIREBASE_CONFIG : null;
  if (!firebase || !config || !config.apiKey || config.apiKey === 'YOUR_API_KEY') return null;
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(config);
    }
    firestore = firebase.firestore();
    if (firebase.storage) {
      storage = firebase.storage();
    }
    return firestore;
  } catch (e) {
    console.warn('[Matcha Hop] Firebase init failed:', e?.message || e);
    return null;
  }
}

export function getDb() {
  if (firestore === null) initFirebase();
  return firestore;
}

export function getStorage() {
  if (storage === null) initFirebase();
  return storage;
}

export const CAFES_COLLECTION = 'cafes';
export const LOGS_COLLECTION = 'logs';
export const SETTINGS_COLLECTION = 'settings';
export const BRANDS_CONFIG_DOC = 'brands';
export const PLACE_DETAILS_COLLECTION = 'placeDetails';
export const BRAND_POPUPS_COLLECTION = 'brandPopUps';
export const BRAND_LIKES_COLLECTION = 'brandLikes';
export const LOCATION_LIKES_COLLECTION = 'locationLikes';

let _currentUserId = null;
let _authInitPromise = null;
let _authDisabled = false;

/** Initialize anonymous auth so we have a stable userId for likes. Call after initFirebase. */
export function initAuth() {
  if (_authDisabled) return Promise.resolve(null);
  if (_authInitPromise) return _authInitPromise;
  const firebase = typeof window !== 'undefined' ? window.firebase : null;
  if (!firebase?.auth) return Promise.resolve(null);
  const auth = firebase.auth();
  if (auth.currentUser) {
    _currentUserId = auth.currentUser.uid;
    return Promise.resolve(_currentUserId);
  }
  _authInitPromise = auth.signInAnonymously().then((cred) => {
    _currentUserId = cred.user?.uid ?? null;
    return _currentUserId;
  }).catch((e) => {
    const code = e?.code || '';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      _authDisabled = true;
      console.warn('[Matcha Hop] Anonymous auth disabled in Firebase project.');
    } else {
      console.warn('[Matcha Hop] Anonymous auth failed:', e?.message || e);
    }
    return null;
  }).finally(() => {
    _authInitPromise = null;
  });
  return _authInitPromise;
}

/** Current user id for likes (anonymous auth). Returns null if auth not available. */
export function getCurrentUserId() {
  const firebase = typeof window !== 'undefined' ? window.firebase : null;
  if (firebase?.auth?.currentUser) return firebase.auth().currentUser.uid;
  return _currentUserId;
}