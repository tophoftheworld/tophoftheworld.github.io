// Firebase configuration and initialization
// Your Firebase config (same as sales dashboard)
const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

// Initialize Firebase dynamically to avoid blocking module loading
let db = null;
let app = null;

export async function initializeFirebaseConfig() {
    try {
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js');
        const { getFirestore } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
        
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        
        return { db, app };
    } catch (error) {
        console.error('Firebase config initialization failed:', error);
        return null;
    }
}

// Export a getter for db that initializes if needed
export { db };