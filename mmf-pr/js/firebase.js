import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VERSION = '11.6.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

let app = null;
let db = null;
let firestoreFns = null;

export async function initFirebase() {
    if (db && firestoreFns) return { app, db, firestoreFns };

    const [{ initializeApp }, firestore] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-firestore.js`),
    ]);

    app = initializeApp(firebaseConfig);
    db = firestore.getFirestore(app);
    firestoreFns = {
        collection: firestore.collection,
        getDocs: firestore.getDocs,
    };

    return { app, db, firestoreFns };
}
