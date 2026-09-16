/**
 * Bulk-send apology/sales reminder emails.
 * Requires deployed sendApologySalesReminderEmails with confirmBulk: true.
 */
import { initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCjXM75RSdlSmEKIgPC6DUGdmERG6P7_-8',
    authDomain: 'manila-matcha-fest.firebaseapp.com',
    projectId: 'manila-matcha-fest',
    storageBucket: 'manila-matcha-fest.firebasestorage.app',
    messagingSenderId: '110163876581',
    appId: '1:110163876581:web:7d28c7758ddd30eac1520c',
};

const app = initializeApp(FIREBASE_CONFIG);
const functions = getFunctions(app, 'asia-southeast1');
const sendFn = httpsCallable(functions, 'sendApologySalesReminderEmails');

console.log('Sending apology/sales reminder bulk…');
const result = await sendFn({ confirmBulk: true });
console.log(JSON.stringify(result.data, null, 2));
