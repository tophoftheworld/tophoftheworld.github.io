/** Self-contained Firebase for story-giveaway (no /shared dependency). */

const firebaseConfig = {
  apiKey: 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE',
  authDomain: 'matchanese-attendance.firebaseapp.com',
  projectId: 'matchanese-attendance',
  storageBucket: 'matchanese-attendance.firebasestorage.app',
  messagingSenderId: '339591618451',
  appId: '1:339591618451:web:23f9d95833ee5010bbd266',
  measurementId: 'G-YEK4GML6SJ',
};

let servicesPromise = null;

export async function getFirebase() {
  if (servicesPromise) return servicesPromise;

  servicesPromise = (async () => {
    const { initializeApp, getApps } = await import(
      'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js'
    );
    const { getFirestore } = await import(
      'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js'
    );
    const { getStorage } = await import(
      'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js'
    );

    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    return {
      app,
      db: getFirestore(app),
      storage: getStorage(app),
    };
  })();

  return servicesPromise;
}

export const GIVEAWAY_DOC = 'story_giveaways/current';
export const PHOTOS_COLLECTION = 'story_giveaways/current/photos';
export const STORAGE_PREFIX = 'story-giveaway/photos';
export const THUMB_STORAGE_PREFIX = 'story-giveaway/thumbs';
