// firebase-config.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    updateDoc,
    doc,
    getDocs,
    query,
    orderBy,
    limit,
    setDoc,
    getDoc,
    deleteDoc,
    serverTimestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

export { app, db, collection, addDoc, updateDoc, doc, getDocs, query, orderBy, limit, setDoc, getDoc, deleteDoc, serverTimestamp, onSnapshot };