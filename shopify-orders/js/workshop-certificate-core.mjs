/** Pure helpers for workshop certificates and roster name overrides. */

export function rosterMetaDocId(eventId, sessionDate) {
    return `${String(eventId || "").trim()}_${String(sessionDate || "").trim()}`.replace(
        /[^\w-]/g,
        "_"
    );
}

export function seatNameKey(orderId, seatIndex) {
    return `${String(orderId || "").trim()}_${String(seatIndex ?? "").trim()}`;
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
