// Shared Firebase Configuration
// This file provides a centralized Firebase configuration for all apps

// Firebase configuration object
export const firebaseConfig = {
    // Main attendance/production config
    attendance: {
        apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
        authDomain: "matchanese-attendance.firebaseapp.com",
        projectId: "matchanese-attendance",
        storageBucket: "matchanese-attendance.appspot.com",
        messagingSenderId: "339591618451",
        appId: "1:339591618451:web:23f9d95833ee5010bbd266",
        measurementId: "G-YEK4GML6SJ"
    },
    
    // MMF Stamp Rally config
    mmf: {
        apiKey: "AIzaSyCjXM75RSdlSmEKIgPC6DUGdmERG6P7_-8",
        authDomain: "manila-matcha-fest.firebaseapp.com",
        projectId: "manila-matcha-fest",
        storageBucket: "manila-matcha-fest.firebasestorage.app",
        messagingSenderId: "110163876581",
        appId: "1:110163876581:web:7d28c7758ddd30eac1520c",
        measurementId: "G-89F877CS05"
    }
};

// Default configuration (attendance)
export const defaultConfig = firebaseConfig.attendance;

// Helper function to get Firebase config by app name
export function getFirebaseConfig(appName = 'attendance') {
    return firebaseConfig[appName] || defaultConfig;
}

// Firebase initialization helper
export async function initializeFirebase(appName = 'attendance') {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js');
    const config = getFirebaseConfig(appName);
    return initializeApp(config);
}

// Common Firebase services initialization
export async function initializeFirebaseServices(appName = 'attendance') {
    const app = await initializeFirebase(appName);
    
    // Import Firebase services
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
    const { getStorage } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js');
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js');
    
    return {
        app,
        db: getFirestore(app),
        storage: getStorage(app),
        auth: getAuth(app)
    };
}
