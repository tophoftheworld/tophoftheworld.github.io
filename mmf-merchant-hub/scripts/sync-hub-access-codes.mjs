/**
 * One-time: copy plaintext access codes from merchant-codes.csv
 * onto mmf_merchant_registrations/{id}.hubAccessCode for announcement emails.
 *
 * Usage (from mmf-merchant-hub):
 *   node ../mmf-merchant-registration/functions/sync-hub-access-codes-to-firestore.cjs
 * or:
 *   node scripts/sync-hub-access-codes.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { doc, getFirestore, updateDoc } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, '..', '..', 'mmf-merchant-hub', 'merchant-codes.csv');

const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCjXM75RSdlSmEKIgPC6DUGdmERG6P7_-8',
    authDomain: 'manila-matcha-fest.firebaseapp.com',
    projectId: 'manila-matcha-fest',
    storageBucket: 'manila-matcha-fest.firebasestorage.app',
    messagingSenderId: '110163876581',
    appId: '1:110163876581:web:7d28c7758ddd30eac1520c',
};

function parseCsvLine(line) {
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (c === '"') {
            q = !q;
            continue;
        }
        if (c === ',' && !q) {
            cols.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    cols.push(cur);
    return cols;
}

const raw = readFileSync(csvPath, 'utf8').trim();
const lines = raw.split(/\r?\n/);
const entries = [];
for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const id = cols[0];
    const brand = cols[1];
    const code = cols[5];
    if (!id || !code || String(code).startsWith('(unchanged')) continue;
    entries.push({ id, brand, code: String(code).trim().toUpperCase() });
}

if (!entries.length) {
    console.error('No codes found in CSV.');
    process.exit(1);
}

initializeApp(FIREBASE_CONFIG);
const db = getFirestore();

let ok = 0;
for (const entry of entries) {
    await updateDoc(doc(db, 'mmf_merchant_registrations', entry.id), {
        hubAccessCode: entry.code,
    });
    ok += 1;
    console.log(`ok: ${entry.brand} → ${entry.code}`);
}
console.log(`\nUpdated hubAccessCode on ${ok} registration(s).`);
