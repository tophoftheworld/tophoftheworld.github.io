import {
    MERCHANTS_COLLECTION,
    REGISTRATIONS_COLLECTION,
    SESSION_KEY,
    sha256,
} from './config.js';
import { initFirebase } from './firebase.js';

const TRACK_SESSION_KEY = 'mmf_hub_open_tracked';

export function getSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.merchantId || !parsed?.brandName) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function setSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    try {
        sessionStorage.removeItem(TRACK_SESSION_KEY);
    } catch {
        /* ignore */
    }
}

export async function loadMerchants() {
    const { db, firestoreFns } = await initFirebase();
    const snap = await firestoreFns.getDocs(
        firestoreFns.collection(db, MERCHANTS_COLLECTION)
    );
    const merchants = [];
    snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        merchants.push({
            id: docSnap.id,
            brandName: String(data.brandName || '').trim() || docSnap.id,
            codeHash: String(data.codeHash || ''),
            registrationId: data.registrationId || null,
            email: data.email || '',
            contactPerson: data.contactPerson || '',
            contactNumber: data.contactNumber || '',
        });
    });
    merchants.sort((a, b) =>
        a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' })
    );
    return merchants;
}

export async function loginWithCode(merchantId, code, merchants) {
    const merchant = merchants.find((m) => m.id === merchantId);
    if (!merchant) {
        return { ok: false, error: 'Select your brand.' };
    }
    const trimmed = String(code || '').trim();
    if (!trimmed) {
        return { ok: false, error: 'Enter your access code.' };
    }
    if (!merchant.codeHash) {
        return { ok: false, error: 'This brand has no access code yet. Contact the organizer.' };
    }
    const hash = await sha256(trimmed.toUpperCase());
    if (hash !== merchant.codeHash) {
        return { ok: false, error: 'Incorrect access code.' };
    }
    const session = {
        merchantId: merchant.id,
        brandName: merchant.brandName,
        email: String(merchant.email || '').trim(),
        contactPerson: String(merchant.contactPerson || '').trim(),
        contactNumber: String(merchant.contactNumber || '').trim(),
        registrationId: merchant.registrationId || merchant.id || null,
        loggedInAt: new Date().toISOString(),
    };
    setSession(session);
    return { ok: true, session };
}

/** Silent: mark that this merchant opened Merchant Hub (once per browser session). */
export async function trackHubOpen(session) {
    const registrationId = String(session?.registrationId || session?.merchantId || '').trim();
    if (!registrationId) return;
    try {
        if (sessionStorage.getItem(TRACK_SESSION_KEY) === registrationId) return;
    } catch {
        /* ignore */
    }

    try {
        const { db, firestoreFns } = await initFirebase();
        const ref = firestoreFns.doc(db, REGISTRATIONS_COLLECTION, registrationId);
        const snap = await firestoreFns.getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data() || {};
        const updates = {
            hubLastOpenedAt: firestoreFns.serverTimestamp(),
            hubOpenCount: firestoreFns.increment(1),
        };
        if (!data.hubOpenedAt) {
            updates.hubOpenedAt = firestoreFns.serverTimestamp();
        }
        await firestoreFns.updateDoc(ref, updates);
        try {
            sessionStorage.setItem(TRACK_SESSION_KEY, registrationId);
        } catch {
            /* ignore */
        }
    } catch (err) {
        // Silent — never block the hub UI
        console.warn('[MMF Hub] open track failed', err?.message || err);
    }
}
