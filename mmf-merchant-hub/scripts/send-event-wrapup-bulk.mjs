/**
 * Bulk-send event wrap-up emails (thank-you + sales reminder).
 * Pending-final-payment merchants get the unpaid template.
 * Matchanese is skipped. Requires deployed sendEventWrapupEmails.
 *
 * Usage:
 *   node scripts/send-event-wrapup-bulk.mjs --dry-run
 *   node scripts/send-event-wrapup-bulk.mjs
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

const dryRun = process.argv.includes('--dry-run');

const app = initializeApp(FIREBASE_CONFIG);
const functions = getFunctions(app, 'asia-southeast1');
const sendFn = httpsCallable(functions, 'sendEventWrapupEmails');

const payload = dryRun ? { dryRun: true } : { confirmBulk: true };
console.log(dryRun ? 'Dry-run event wrap-up bulk…' : 'Sending event wrap-up bulk…');
const result = await sendFn(payload);
console.log(JSON.stringify(result.data, null, 2));
