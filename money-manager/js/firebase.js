const firebaseConfig = {
    apiKey: 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE',
    authDomain: 'matchanese-attendance.firebaseapp.com',
    projectId: 'matchanese-attendance',
    storageBucket: 'matchanese-attendance.firebasestorage.app',
    messagingSenderId: '339591618451',
    appId: '1:339591618451:web:23f9d95833ee5010bbd266',
    measurementId: 'G-YEK4GML6SJ'
};

let db = null;
let app = null;
let firestoreApi = null;

export async function initFirebase() {
    if (db && firestoreApi) return { db, ...firestoreApi };

    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js');
    firestoreApi = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');

    app = initializeApp(firebaseConfig);
    db = firestoreApi.getFirestore(app);
    return { db, ...firestoreApi };
}

export function getDb() {
    if (!db) throw new Error('Firebase not initialized');
    return db;
}

export function getFirestoreApi() {
    if (!firestoreApi) throw new Error('Firebase not initialized');
    return firestoreApi;
}

export const WORKSPACE_ID = 'default';
export const ROOT_PATH = ['money_manager', WORKSPACE_ID];
