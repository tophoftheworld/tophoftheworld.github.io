/**
 * One-off: generate per-brand access codes for MMF Merchant Hub.
 *
 * Reads submitted (non-archived) docs from mmf_merchant_registrations,
 * writes mmf_hub_merchants/{id} with SHA-256 hashed codes,
 * and writes merchant-codes.csv (gitignored) with plaintext codes for emailing.
 *
 * Usage:
 *   node mmf-merchant-hub/scripts/generate-merchant-codes.mjs
 *   node mmf-merchant-hub/scripts/generate-merchant-codes.mjs --force
 *
 * Requires network access to Firestore (client SDK + web config).
 */

import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
    collection,
    doc,
    getDocs,
    getFirestore,
    setDoc,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_CSV = join(__dirname, '..', 'merchant-codes.csv');
const FORCE = process.argv.includes('--force');

const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCjXM75RSdlSmEKIgPC6DUGdmERG6P7_-8',
    authDomain: 'manila-matcha-fest.firebaseapp.com',
    projectId: 'manila-matcha-fest',
    storageBucket: 'manila-matcha-fest.firebasestorage.app',
    messagingSenderId: '110163876581',
    appId: '1:110163876581:web:7d28c7758ddd30eac1520c',
    measurementId: 'G-89F877CS05',
};

const REGISTRATIONS = 'mmf_merchant_registrations';
const HUB_MERCHANTS = 'mmf_hub_merchants';

/** Crockford-ish alphabet without ambiguous chars (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function sha256Hex(text) {
    return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function makeCode(length = 8) {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return out;
}

function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function isSubmittedRegistration(data) {
    if (data?.archived) return false;
    const state = String(data?.submissionState || '').toLowerCase();
    if (state === 'draft') return false;
    if (state === 'submitted') return true;
    // Legacy docs without submissionState
    const status = String(data?.status || '').toLowerCase();
    return Boolean(status && status !== 'draft');
}

function brandNameOf(data, id) {
    return (
        String(data?.brandName || '').trim() ||
        String(data?.registeredBusinessName || '').trim() ||
        id
    );
}

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

const [regSnap, hubSnap] = await Promise.all([
    getDocs(collection(db, REGISTRATIONS)),
    getDocs(collection(db, HUB_MERCHANTS)),
]);

const existingHub = new Map();
hubSnap.forEach((d) => existingHub.set(d.id, d.data() || {}));

const brands = [];
regSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!isSubmittedRegistration(data)) return;
    brands.push({
        id: docSnap.id,
        brandName: brandNameOf(data, docSnap.id),
        email: String(data.email || '').trim(),
        contactPerson: String(data.contactPerson || '').trim(),
        contactNumber: String(data.contactNumber || '').trim(),
    });
});

brands.sort((a, b) =>
    a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' })
);

console.log(`Found ${brands.length} submitted registration(s).`);
if (!brands.length) {
    console.error('No brands to process. Exiting.');
    process.exit(1);
}

const csvRows = [
    ['merchantId', 'brandName', 'email', 'contactPerson', 'contactNumber', 'accessCode', 'action'],
];
let created = 0;
let skipped = 0;
let regenerated = 0;

for (const brand of brands) {
    const existing = existingHub.get(brand.id);
    if (existing?.codeHash && !FORCE) {
        skipped += 1;
        csvRows.push([
            brand.id,
            brand.brandName,
            brand.email,
            brand.contactPerson,
            brand.contactNumber,
            '(unchanged — use --force to regenerate)',
            'skipped',
        ]);
        console.log(`skip: ${brand.brandName}`);
        continue;
    }

    const code = makeCode(8);
    const codeHash = sha256Hex(code);
    await setDoc(
        doc(db, HUB_MERCHANTS, brand.id),
        {
            brandName: brand.brandName,
            codeHash,
            registrationId: brand.id,
            email: brand.email,
            contactPerson: brand.contactPerson,
            contactNumber: brand.contactNumber,
            codeGeneratedAt: new Date().toISOString(),
        },
        { merge: true }
    );
    await setDoc(
        doc(db, REGISTRATIONS, brand.id),
        { hubAccessCode: code },
        { merge: true }
    );

    const action = existing?.codeHash ? 'regenerated' : 'created';
    if (action === 'regenerated') regenerated += 1;
    else created += 1;

    csvRows.push([
        brand.id,
        brand.brandName,
        brand.email,
        brand.contactPerson,
        brand.contactNumber,
        code,
        action,
    ]);
    console.log(`${action}: ${brand.brandName} → ${code}`);
}

const csv = csvRows.map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
writeFileSync(OUT_CSV, csv, 'utf8');

console.log(`\nDone. created=${created} regenerated=${regenerated} skipped=${skipped}`);
console.log(`Plaintext codes written to: ${OUT_CSV}`);
console.log('Email the accessCode column to each brand contact. Do not commit this CSV.');
process.exit(0);
