/**
 * Check Kokorobi registration + recent hubAnnouncementEmail markers.
 */
import { initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore, getDoc, doc } from 'firebase/firestore';

const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCjXM75RSdlSmEKIgPC6DUGdmERG6P7_-8',
    authDomain: 'manila-matcha-fest.firebaseapp.com',
    projectId: 'manila-matcha-fest',
    storageBucket: 'manila-matcha-fest.firebasestorage.app',
    messagingSenderId: '110163876581',
    appId: '1:110163876581:web:7d28c7758ddd30eac1520c',
};

const KOKOROBI_ID = '72daf4b8-7511-4147-b826-e3257c87bfd8';
const MATCHANESE_HINT = 'matchanese';

initializeApp(FIREBASE_CONFIG);
const db = getFirestore();

const k = await getDoc(doc(db, 'mmf_merchant_registrations', KOKOROBI_ID));
console.log('Kokorobi:', JSON.stringify({
    brandName: k.data()?.brandName,
    email: k.data()?.email,
    hubAccessCode: k.data()?.hubAccessCode,
    hubAnnouncementEmail: k.data()?.hubAnnouncementEmail,
}, null, 2));

const snap = await getDocs(collection(db, 'mmf_merchant_registrations'));
const recent = [];
snap.forEach((d) => {
    const data = d.data() || {};
    const brand = String(data.brandName || '');
    const email = String(data.email || '');
    const sent = data.hubAnnouncementEmail;
    if (!sent?.sent) return;
    const lower = (brand + ' ' + email).toLowerCase();
    if (lower.includes(MATCHANESE_HINT) || d.id === KOKOROBI_ID || true) {
        recent.push({
            id: d.id,
            brandName: brand,
            email,
            template: sent.template,
            sentAt: sent.sentAt?.toDate?.()?.toISOString?.() || sent.sentAt || null,
        });
    }
});

recent.sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
console.log('\nHub announcement sent markers (newest first), count=', recent.length);
console.log(JSON.stringify(recent.slice(0, 30), null, 2));
