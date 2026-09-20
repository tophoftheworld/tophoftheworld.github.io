/** Pure helpers for workshop certificates and roster name overrides. */

export const WORKSHOP_TIMEZONE = "Asia/Manila";

export function rosterMetaDocId(eventId, sessionDate) {
    return `${String(eventId || "").trim()}_${String(sessionDate || "").trim()}`.replace(
        /[^\w-]/g,
        "_"
    );
}

export function seatNameKey(orderId, seatIndex) {
    return `${String(orderId || "").trim()}_${String(seatIndex ?? "").trim()}`;
}

export function todayDateIso(now = new Date(), timeZone = WORKSHOP_TIMEZONE) {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function isSameDaySession(
    sessionDate,
    now = new Date(),
    timeZone = WORKSHOP_TIMEZONE
) {
    const iso = String(sessionDate || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso === todayDateIso(now, timeZone);
}

export function normalizeCheckInValue(value) {
    if (value === false || value === 0) return false;
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
        const s = value.trim();
        if (!s) return undefined;
        const lower = s.toLowerCase();
        if (lower === "false" || lower === "no" || lower === "0") return false;
        if (lower === "true" || lower === "yes" || lower === "1") return true;
        return s;
    }
    return undefined;
}

export function normalizeCheckedInMap(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [key, value] of Object.entries(raw)) {
        const k = String(key || "").trim();
        if (!k) continue;
        const normalized = normalizeCheckInValue(value);
        if (normalized !== undefined) out[k] = normalized;
    }
    return out;
}

export function isSeatCheckedIn(value) {
    const normalized = normalizeCheckInValue(value);
    return normalized !== false && normalized != null;
}

export function sheetCheckInCell(value) {
    if (value === false) return false;
    if (isSeatCheckedIn(value)) return true;
    return "";
}

export function applyCheckIns(rows, checkedIn) {
    const map = normalizeCheckedInMap(checkedIn);
    for (const row of rows || []) {
        const key = seatNameKey(row.orderId, row.seatIndex);
        const value = map[key];
        row.checkedIn = isSeatCheckedIn(value);
        row.checkedInAt = typeof value === "string" ? value : null;
    }
    return rows;
}

export function setSeatCheckIn(
    checkedIn,
    orderId,
    seatIndex,
    present,
    at = new Date()
) {
    const next = { ...normalizeCheckedInMap(checkedIn) };
    const key = seatNameKey(orderId, seatIndex);
    next[key] = present
        ? at instanceof Date
            ? at.toISOString()
            : String(at)
        : false;
    return next;
}

export function formatCertificateDate(dateString) {
    if (!dateString) return "Date";

    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
        ? new Date(`${dateString}T00:00:00`)
        : new Date(dateString);
    if (Number.isNaN(date.getTime())) return "Date";

    const day = date.getDate();
    const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    const month = monthNames[date.getMonth()];

    function getOrdinalSuffix(n) {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return s[(v - 20) % 10] || s[v] || s[0];
    }

    const year = date.getFullYear();
    return `${day}${getOrdinalSuffix(day)} Day of ${month} ${year}`;
}

export function applyNameOverrides(rows, names) {
    const map = names && typeof names === "object" ? names : {};
    for (const row of rows || []) {
        if (row.originalParticipant == null) {
            row.originalParticipant = row.participant;
        }
        const key = seatNameKey(row.orderId, row.seatIndex);
        const next = String(map[key] || "").trim();
        if (next) {
            row.participant = next;
            row.nameOverridden = true;
        } else {
            row.participant = row.originalParticipant;
            row.nameOverridden = false;
        }
    }
    return rows;
}

export function applyParticipantNameOverridesToRoster(data, names) {
    const map = names && typeof names === "object" ? names : {};
    for (const session of data?.sessions || []) {
        applyNameOverrides(session.participants || [], map);
    }
    if (Array.isArray(data?.participants)) {
        applyNameOverrides(data.participants, map);
    }
    return data;
}

export function certificateParticipantNames(rows) {
    return (rows || [])
        .map((r) => String(r.participant || "").trim())
        .filter((name) => name && name !== "—");
}
