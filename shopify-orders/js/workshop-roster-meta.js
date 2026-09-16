import { rosterMetaDocId } from "./workshop-certificate-core.mjs";

const COLLECTION = "workshopRosterMeta";

function emptyMeta() {
    return { venue: "", names: {} };
}

function normalizeMeta(raw) {
    const names =
        raw && typeof raw.names === "object" && raw.names ? { ...raw.names } : {};
    return {
        venue: String(raw?.venue || "").trim(),
        names,
    };
}

function localKey(eventId, sessionDate) {
    return `workshopRosterMeta:${rosterMetaDocId(eventId, sessionDate)}`;
}

function readLocal(eventId, sessionDate) {
    try {
        const raw = localStorage.getItem(localKey(eventId, sessionDate));
        if (!raw) return emptyMeta();
        return normalizeMeta(JSON.parse(raw));
    } catch {
        return emptyMeta();
    }
}

function writeLocal(eventId, sessionDate, meta) {
    try {
        localStorage.setItem(
            localKey(eventId, sessionDate),
            JSON.stringify(normalizeMeta(meta))
        );
    } catch {
        /* ignore quota / private mode */
    }
}

async function firestoreApi() {
    const [{ db }, fs] = await Promise.all([
        import("./firebase-setup.js"),
        import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js"),
    ]);
    return {
        db,
        doc: fs.doc,
        getDoc: fs.getDoc,
        setDoc: fs.setDoc,
        serverTimestamp: fs.serverTimestamp,
    };
}

export async function loadWorkshopRosterMeta(eventId, sessionDate) {
    const fallback = readLocal(eventId, sessionDate);
    try {
        const { db, doc, getDoc } = await firestoreApi();
        const snap = await getDoc(doc(db, COLLECTION, rosterMetaDocId(eventId, sessionDate)));
        if (!snap.exists()) return fallback;
        const meta = normalizeMeta(snap.data());
        writeLocal(eventId, sessionDate, meta);
        return meta;
    } catch (error) {
        console.warn("Unable to load workshop roster meta:", error);
        return fallback;
    }
}

export async function saveWorkshopRosterMeta(eventId, sessionDate, meta) {
    const next = normalizeMeta(meta);
    writeLocal(eventId, sessionDate, next);
    try {
        const { db, doc, setDoc, serverTimestamp } = await firestoreApi();
        await setDoc(doc(db, COLLECTION, rosterMetaDocId(eventId, sessionDate)), {
            eventId: String(eventId || "").trim(),
            sessionDate: String(sessionDate || "").trim(),
            venue: next.venue,
            names: next.names,
            updatedAt: serverTimestamp(),
        });
        return next;
    } catch (error) {
        console.warn("Unable to save workshop roster meta:", error);
        throw error;
    }
}
