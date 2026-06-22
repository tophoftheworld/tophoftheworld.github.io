import {
    db,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp,
} from "../../js/firebase-setup.js";
import { COLLECTIONS, SESSION_DURATION_HOURS } from "../../js/config.js";
import { snapDurationHours } from "../../js/session-utils.js";
import {
    buildSessionPayload,
    getSessionsForEvent,
} from "./sessions-api.js";

export async function getEvent(eventId) {
    if (!eventId) return null;
    const snap = await getDoc(doc(db, COLLECTIONS.events, eventId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

function buildEventPayload(event, isNew) {
    const payload = {
        eventName: String(event.eventName || event.eventType || "").trim(),
        venue: String(event.venue || "").trim(),
        address: String(event.address || "").trim(),
        placeId: String(event.placeId || "").trim(),
        lat: typeof event.lat === "number" ? event.lat : null,
        lng: typeof event.lng === "number" ? event.lng : null,
        notes: String(event.notes || "").trim(),
        durationHours: snapDurationHours(Number(event.durationHours) || SESSION_DURATION_HOURS),
        status: "open",
        updatedAt: serverTimestamp(),
    };
    if (isNew) payload.createdAt = serverTimestamp();
    return payload;
}

/**
 * Save event + sessions in one batch. Returns new eventId and saved session ids.
 * @param {{ event: object, sessions: object[], removedSessionIds?: string[] }} input
 */
export async function saveEventWithSessions({ event, sessions, removedSessionIds = [] }) {
    const eventId = event.id || crypto.randomUUID();
    const isNewEvent = !event.id;
    const batch = writeBatch(db);

    batch.set(
        doc(db, COLLECTIONS.events, eventId),
        buildEventPayload(event, isNewEvent),
        { merge: true }
    );

    const savedSessionIds = [];
    for (const sessionInput of sessions) {
        const { id, payload } = buildSessionPayload({
            ...sessionInput,
            eventId,
            eventType: event.eventName || event.eventType,
        });
        batch.set(doc(db, COLLECTIONS.sessions, id), payload, { merge: true });
        savedSessionIds.push(id);
    }

    for (const sessionId of removedSessionIds) {
        if (!sessionId) continue;
        batch.delete(doc(db, COLLECTIONS.sessions, sessionId));
    }

    await batch.commit();
    return { eventId, sessionIds: savedSessionIds };
}

export async function deleteEventWithSessions(eventId) {
    if (!eventId) return;
    const sessions = await getSessionsForEvent(eventId);
    const batch = writeBatch(db);
    batch.delete(doc(db, COLLECTIONS.events, eventId));
    for (const s of sessions) {
        batch.delete(doc(db, COLLECTIONS.sessions, s.id));
    }
    await batch.commit();
    return sessions.length;
}
