/**
 * Firebase init for manila-matcha-fest (MMF project).
 */

import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VERSION = '11.6.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const FUNCTIONS_REGION = 'asia-southeast1';

let app = null;
let db = null;
let storage = null;
let functions = null;
let firestoreFns = null;
let storageFns = null;
let functionsFns = null;

export async function initFirebase() {
    if (db && storage && firestoreFns && storageFns && functionsFns) {
        return { app, db, storage, functions, firestoreFns, storageFns, functionsFns };
    }

    const [{ initializeApp }, firestore, storageModule, functionsModule] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-firestore.js`),
        import(`${CDN}/firebase-storage.js`),
        import(`${CDN}/firebase-functions.js`),
    ]);

    const config = firebaseConfig;
    app = initializeApp(config);
    db = firestore.getFirestore(app);
    storage = storageModule.getStorage(app);
    functions = functionsModule.getFunctions(app, FUNCTIONS_REGION);

    firestoreFns = {
        collection: firestore.collection,
        doc: firestore.doc,
        setDoc: firestore.setDoc,
        updateDoc: firestore.updateDoc,
        getDocs: firestore.getDocs,
        getDoc: firestore.getDoc,
        query: firestore.query,
        where: firestore.where,
        orderBy: firestore.orderBy,
        serverTimestamp: firestore.serverTimestamp,
        deleteField: firestore.deleteField,
    };

    storageFns = {
        ref: storageModule.ref,
        uploadBytes: storageModule.uploadBytes,
        getDownloadURL: storageModule.getDownloadURL,
        getBlob: storageModule.getBlob,
    };

    functionsFns = {
        httpsCallable: functionsModule.httpsCallable,
    };

    return { app, db, storage, functions, firestoreFns, storageFns, functionsFns };
}

export function makeSubmissionId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `mmf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function safeFilename(name) {
    const base = String(name || 'proof')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 80);
    return base || 'proof';
}
