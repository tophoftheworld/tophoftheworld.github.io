import { initializeFirebaseServices } from '../../../shared/js/firebase-config.js?v=46';

const FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

let readyPromise = null;

/** Single Firebase init for the page; returns { db, fns } where fns matches ops-events' firestoreFns. */
export function initFirebase() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const services = await initializeFirebaseServices('attendance');
      const fs = await import(FIRESTORE_URL);
      const fns = {
        getDocs: fs.getDocs,
        getDoc: fs.getDoc,
        collection: fs.collection,
        doc: fs.doc,
        setDoc: fs.setDoc,
        addDoc: fs.addDoc,
        updateDoc: fs.updateDoc,
        deleteDoc: fs.deleteDoc,
        query: fs.query,
        where: fs.where,
        orderBy: fs.orderBy,
        limit: fs.limit,
        onSnapshot: fs.onSnapshot,
        serverTimestamp: fs.serverTimestamp
      };
      return { db: services.db, fns };
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}
