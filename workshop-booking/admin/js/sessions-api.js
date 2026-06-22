import {
    db,
    collection,
    doc,
    getDocs,
    setDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
} from "../../js/firebase-setup.js";
import { COLLECTIONS, TIMEZONE } from "../../js/config.js";
import { endTimeFromStart, sessionIdFor, remainingSeats } from "../../js/session-utils.js";

const sessionsColl = collection(db, COLLECTIONS.sessions);
const bookingsColl = collection(db, COLLECTIONS.bookings);

/** @param {object} session */
export function sessionLabelFor(session) {
    return String(session?.sessionLabel || session?.sessionTitle || "").trim();
}

/**
 * Query is intentionally index-light for small-volume usage.
 * Filter by event type and search text client-side.
 */
export async function listSessions({ monthPrefix, statusFilter, eventTypeFilter, searchText }) {
    let items = [];
    try {
        const q = query(
            sessionsColl,
            where("date", ">=", `${monthPrefix}-01`),
            where("date", "<=", `${monthPrefix}-31`),
            orderBy("date"),
            orderBy("startTime")
        );
        const snap = await getDocs(q);
        items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        if (err?.code !== "failed-precondition") throw err;
        const fallbackQ = query(
            sessionsColl,
            where("date", ">=", `${monthPrefix}-01`),
            where("date", "<=", `${monthPrefix}-31`),
            orderBy("date")
        );
        const fallbackSnap = await getDocs(fallbackQ);
        items = fallbackSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a, b) =>
            `${a.date}-${a.startTime}`.localeCompare(`${b.date}-${b.startTime}`)
        );
    }
    if (eventTypeFilter) {
        items = items.filter((s) => String(s.eventType || "").toLowerCase() === eventTypeFilter.toLowerCase());
    }
    if (statusFilter) {
        items = items.filter((s) => s.status === statusFilter);
    }
    if (searchText) {
        const term = searchText.toLowerCase();
        items = items.filter((s) => {
            const hay = `${s.eventType || ""} ${sessionLabelFor(s)} ${s.id} ${s.eventId || ""}`.toLowerCase();
            return hay.includes(term);
        });
    }
    return items;
}

export async function getSessionsForEvent(eventId) {
    if (!eventId) return [];
    let items = [];
    try {
        const q = query(
            sessionsColl,
            where("eventId", "==", eventId),
            orderBy("date"),
            orderBy("startTime")
        );
        const snap = await getDocs(q);
        items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        if (err?.code !== "failed-precondition") throw err;
        const fallbackQ = query(sessionsColl, where("eventId", "==", eventId));
        const fallbackSnap = await getDocs(fallbackQ);
        items = fallbackSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a, b) =>
            `${a.date}-${a.startTime}`.localeCompare(`${b.date}-${b.startTime}`)
        );
    }
    return items;
}

export async function listParticipantsForSession(sessionId) {
    const q = query(bookingsColl, where("sessionId", "==", sessionId));
    const snap = await getDocs(q);
    const rows = [];
    snap.docs.forEach((d) => {
        const booking = d.data();
        const attendees = Array.isArray(booking.attendees) && booking.attendees.length
            ? booking.attendees
            : [{ name: "", email: "", phone: "", seats: booking.seats || 1 }];
        attendees.forEach((a) => {
            rows.push({
                bookingId: d.id,
                name: a.name || "",
                email: a.email || "",
                phone: a.phone || "",
                seats: Number(a.seats || booking.seats || 1),
                bookingStatus: booking.bookingStatus || booking.status || "pending",
                orderRef: booking.orderNumber || booking.orderId || "-",
            });
        });
    });
    return rows;
}

/** Build session document payload without writing. */
export function buildSessionPayload(input) {
    const endTime = input.endTime || endTimeFromStart(input.startTime);
    const id = input.id || sessionIdFor(input.eventType, input.date, input.startTime);
    const existingBooked = Number(input.bookedSeats) || 0;
    const existingHeld = Number(input.heldSeats) || 0;
    const capacity = Number(input.capacity);
    const remaining = capacity - existingBooked - existingHeld;

    let status = input.status || "open";
    if (status !== "cancelled" && remaining <= 0) status = "full";
    if (status === "full" && remaining > 0) status = "open";

    const sessionLabel = String(input.sessionLabel ?? input.sessionTitle ?? "").trim();

    const payload = {
        eventId: input.eventId || "",
        eventType: String(input.eventType || "").trim(),
        sessionLabel,
        sessionTitle: sessionLabel,
        date: input.date,
        startTime: input.startTime,
        endTime,
        timezone: TIMEZONE,
        capacity,
        bookedSeats: existingBooked,
        heldSeats: existingHeld,
        status,
        updatedAt: serverTimestamp(),
    };
    if (!input.id) payload.createdAt = serverTimestamp();

    return { id, payload };
}

export async function upsertSession(input) {
    const { id, payload } = buildSessionPayload(input);
    await setDoc(doc(db, COLLECTIONS.sessions, id), payload, { merge: true });
    return id;
}

export async function deleteSession(id) {
    await deleteDoc(doc(db, COLLECTIONS.sessions, id));
}

export async function deleteSessionsForEvent(eventId) {
    const sessions = await getSessionsForEvent(eventId);
    await Promise.all(sessions.map((s) => deleteSession(s.id)));
    return sessions.length;
}

export { remainingSeats };
