import {
    db,
    collection,
    getDocs,
    query,
    where,
    orderBy,
} from "../js/firebase-setup.js";
import { COLLECTIONS } from "../js/config.js";
import { remainingSeats } from "../js/session-utils.js";

const sessionsColl = collection(db, COLLECTIONS.sessions);

function todayIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function monthEndIso(monthPrefix) {
    const [y, m] = monthPrefix.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${monthPrefix}-${String(lastDay).padStart(2, "0")}`;
}

function addMonths(monthPrefix, count) {
    const [y, m] = monthPrefix.split("-").map(Number);
    const d = new Date(y, m - 1 + count, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function querySessionsBetween(startDate, endDate) {
    try {
        const q = query(
            sessionsColl,
            where("date", ">=", startDate),
            where("date", "<=", endDate),
            orderBy("date"),
            orderBy("startTime")
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        if (err?.code !== "failed-precondition") throw err;
        const fallbackQ = query(
            sessionsColl,
            where("date", ">=", startDate),
            where("date", "<=", endDate),
            orderBy("date")
        );
        const snap = await getDocs(fallbackQ);
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a, b) =>
            `${a.date}-${a.startTime}`.localeCompare(`${b.date}-${b.startTime}`)
        );
        return items;
    }
}

/**
 * Open bookable sessions from today through the next few months.
 * @param {{ eventName?: string, eventId?: string, monthsAhead?: number }} opts
 */
export async function listBookableSessions({ eventName = "", eventId = "", monthsAhead = 4 } = {}) {
    const start = todayIso();
    const endMonth = addMonths(start.slice(0, 7), monthsAhead);
    const end = monthEndIso(endMonth);
    let items = await querySessionsBetween(start, end);

    const nameFilter = String(eventName || "").trim().toLowerCase();
    const idFilter = String(eventId || "").trim();

    items = items.filter((s) => {
        if (s.status === "cancelled") return false;
        if (remainingSeats(s) <= 0) return false;
        if (idFilter && s.eventId !== idFilter) return false;
        if (nameFilter && String(s.eventType || "").trim().toLowerCase() !== nameFilter) {
            return false;
        }
        return true;
    });

    return items;
}
