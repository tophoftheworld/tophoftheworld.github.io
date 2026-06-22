/**
 * One-off: set Instagram socialLinks on gallery brands (only when missing).
 * Run: node matcha-hop/scripts/patch-brand-instagram.mjs
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE',
  authDomain: 'matchanese-attendance.firebaseapp.com',
  projectId: 'matchanese-attendance',
  storageBucket: 'matchanese-attendance.firebasestorage.app',
  messagingSenderId: '339591618451',
  appId: '1:339591618451:web:23f9d95833ee5010bbd266',
};

/** Exact gallery brand name → Instagram handle (path after instagram.com/) */
const INSTAGRAM_BY_NAME = {
  'Chotto Matcha': 'chottomatchaph',
  'UJISAN': 'ujisanmatcha',
  'Tsujiri': 'tsujiri_ph',
  'Shizu': 'shizumatchabar',
  'Matcha Bar': 'matchabarph',
  'Matcha Later': 'matchalaterph',
  'OH HEY THERE': 'ohheythere.matchacafe',
  'Wasachi': 'wasachi_ph',
  'Matcha Super': 'matcha.super',
  'Matcha by Kamo': 'matchabykamo',
  'Kokorobi Matcha': 'kokorobimatcha',
  'Hoshi House': 'hoshihouse.cafe',
  'LOOP': 'loop_kapitolyo',
  'Matcha Folk': 'matchafolk',
  'The Matcha Co': 'thematchaco.ph',
  'Matcha by Acay': '____acay',
  'Matcha House': 'the.matchahouse',
  'Kumatcha': 'kumatcha.co',
};

function normalizeInstagram(handle) {
  const h = String(handle || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '');
  return h ? `https://instagram.com/${h}` : '';
}

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const ref = doc(db, 'settings', 'brands');

const snap = await getDoc(ref);
if (!snap.exists()) {
  console.error('settings/brands document not found');
  process.exit(1);
}

const brands = Array.isArray(snap.data()?.brands) ? [...snap.data().brands] : [];
let patched = 0;
let skipped = 0;
let missing = [];

for (const brand of brands) {
  const name = String(brand?.name || '').trim();
  const handle = INSTAGRAM_BY_NAME[name];
  if (!handle) continue;
  const url = normalizeInstagram(handle);
  const existing = String(brand?.socialLinks?.instagram || '').trim();
  if (existing) {
    skipped += 1;
    console.log(`skip (has IG): ${name} → ${existing}`);
    continue;
  }
  brand.socialLinks = { ...(brand.socialLinks || {}), instagram: url };
  patched += 1;
  console.log(`patch: ${name} → ${url}`);
}

for (const name of Object.keys(INSTAGRAM_BY_NAME)) {
  if (!brands.some((b) => String(b?.name || '').trim() === name)) {
    missing.push(name);
  }
}

if (patched > 0) {
  await setDoc(ref, { brands }, { merge: true });
  console.log(`\nSaved ${patched} brand(s). Skipped ${skipped} already set.`);
} else {
  console.log(`\nNo changes needed. Skipped ${skipped} already set.`);
}

if (missing.length) {
  console.warn('Brand names not found in Firestore:', missing.join(', '));
}

process.exit(0);
