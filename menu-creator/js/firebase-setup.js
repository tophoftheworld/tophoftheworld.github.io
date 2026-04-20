import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    updateDoc,
    setDoc,
    getDoc,
    doc,
    getDocs,
    query,
    orderBy,
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const DRINKS_COLLECTION = "menuDrinks";
const MENUS_COLLECTION = "savedMenus";

export {
    db,
    collection,
    addDoc,
    updateDoc,
    setDoc,
    getDoc,
    doc,
    getDocs,
    query,
    orderBy,
    deleteDoc,
    serverTimestamp,
    DRINKS_COLLECTION,
    MENUS_COLLECTION,
    storage,
    storageRef,
    uploadBytes,
    getDownloadURL
};
