/**
 * Firebase init for manila-matcha-fest (MMF Merchant Hub).
 */

import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VERSION = '11.6.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const FUNCTIONS_REGION = 'asia-southeast1';

let app = null;
let db = null;
let functions = null;
let firestoreFns = null;
let functionsFns = null;

export async function initFirebase() {
    if (db && firestoreFns && functionsFns) {
        return { app, db, functions, firestoreFns, functionsFns };
    }

    const [{ initializeApp }, firestore, functionsModule] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-firestore.js`),
        import(`${CDN}/firebase-functions.js`),
    ]);

    app = initializeApp(firebaseConfig);
    db = firestore.getFirestore(app);
    functions = functionsModule.getFunctions(app, FUNCTIONS_REGION);
    firestoreFns = {
        collection: firestore.collection,
        doc: firestore.doc,
        setDoc: firestore.setDoc,
        getDocs: firestore.getDocs,
        getDoc: firestore.getDoc,
        updateDoc: firestore.updateDoc,
        increment: firestore.increment,
        serverTimestamp: firestore.serverTimestamp,
    };
    functionsFns = {
        httpsCallable: functionsModule.httpsCallable,
    };

    return { app, db, functions, firestoreFns, functionsFns };
}
