/** Shared Easy Appointment Booking parsing (Node + browser). */

export function formatWorkshopDisplayName(raw) {
    let s = String(raw || "").trim();
    s = s.replace(/\s*[-–]\s*\d+\s*$/u, "").trim();
    s = s.replace(/\s+_+\s*$/u, "").trim();
    s = s.replace(/_+$/u, "").trim();
    s = s.replace(/[\s\u00A0]+$/u, "").trim();
    s = s.replace(/^[\s_]+/u, "").trim();
    s = s.replace(/\s{2,}/g, " ");
    return s;
}

/** Venue suffix from Easy Booking product name (e.g. "Matcha Workshop Lansons"). */
export function extractWorkshopLocation(workshopRaw, workshopDisplay) {
    const display = formatWorkshopDisplayName(
        workshopDisplay || workshopRaw || ""
    );
    if (!display) return "";

    const dashMatch = display.match(/^Matcha Workshop\s*[-–]\s*(.+)$/iu);
    if (dashMatch) {
        const loc = dashMatch[1].trim();
        if (loc && !/^premium\b/i.test(loc)) return loc;
    }

    const suffixMatch = display.match(/^Matcha Workshop\s+(.+)$/iu);
    if (suffixMatch) {
        const loc = suffixMatch[1].trim();
        if (loc && !/^premium\b/i.test(loc)) return loc;
    }

    return "";
}

export function lineItemPropertiesFromShopify(props) {
    return (props || [])
        .filter(
            (p) =>
                p?.name &&
                p.value != null &&
                String(p.value).trim() !== ""
        )
        .map((p) => ({
            name: String(p.name).trim(),
            value: String(p.value).trim(),
        }));
}

export function propertyValueByPattern(properties, pattern) {
    for (const p of properties || []) {
        if (pattern.test(p.name) && String(p.value).trim()) {
            return String(p.value).trim();
        }
    }
    return "";
}

export function sessionDateToIso(dateStr) {
    const raw = (dateStr || "").trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "";
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function propertySuffix(name) {
    const m = String(name || "").match(/__(\d+)$/);
    return m ? Number(m[1]) : 0;
}

/** Easy Appointment Booking uses unrelated numeric suffixes per field — pair by sorted index. */
export function extractAttendeesFromProperties(props) {
    const participants = [];
    const contacts = [];
    const emails = [];
    const milks = [];
    for (const p of props || []) {
        const name = String(p.name || "");
        const entry = { suffix: propertySuffix(name), value: String(p.value || "").trim() };
        if (!entry.value) continue;
        if (/participant/i.test(name)) participants.push(entry);
        else if (/contact number/i.test(name)) contacts.push(entry);
        else if (/e-mail address/i.test(name)) emails.push(entry);
        else if (/milk/i.test(name)) milks.push(entry);
    }
    const bySuffix = (a, b) => a.suffix - b.suffix;
    participants.sort(bySuffix);
    contacts.sort(bySuffix);
    emails.sort(bySuffix);
    milks.sort(bySuffix);

    const count = Math.max(
        participants.length,
        contacts.length,
        emails.length,
        milks.length,
        0
    );
    if (!count) return null;

    const list = [];
    for (let i = 0; i < count; i++) {
        const row = {
            participant: participants[i]?.value || "",
            contact: contacts[i]?.value || "",
            email: emails[i]?.value || "",
            milk: milks[i]?.value || "",
        };
        if (row.participant || row.contact || row.email || row.milk) list.push(row);
    }
    return list.length ? list : null;
}

export function orderContactFallback(order) {
    const c = order?.customer || {};
    const billing = order?.billing_address || {};
    const shipping = order?.shipping_address || {};
    const participant = [c.first_name, c.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
    return {
        participant:
            participant ||
            String(billing.name || shipping.name || "").trim(),
        contact: String(
            order?.phone ||
                c.phone ||
                billing.phone ||
                shipping.phone ||
                ""
        ).trim(),
        email: String(
            order?.email ||
                order?.contact_email ||
                c.email ||
                ""
        ).trim(),
    };
}

export function applyContactFallback(row, reg, orderFallback = {}) {
    const regParticipant = (reg?.participant || "").trim();
    const regContact = (reg?.contact || "").trim();
    const regEmail = (reg?.email || "").trim();
    const orderParticipant = (orderFallback.participant || "").trim();
    const orderContact = (orderFallback.contact || "").trim();
    const orderEmail = (orderFallback.email || "").trim();

    let participant = (row.participant || "").trim();
    if (!participant || participant === "—") {
        participant =
            regParticipant || orderParticipant || "—";
    }

    return {
        ...row,
        participant,
        contact:
            (row.contact || "").trim() ||
            regContact ||
            orderContact ||
            "",
        email:
            (row.email || "").trim() ||
            regEmail ||
            orderEmail ||
            "",
        financialStatus: row.financialStatus,
        financialLabel: row.financialLabel,
        paymentMethod: row.paymentMethod,
    };
}

export function sessionSlotKey(startTime, endTime) {
    return `${(startTime || "").trim().toLowerCase()}|${(endTime || "").trim().toLowerCase()}`;
}

export function parseTimeSortKey(timeStr) {
    const raw = (timeStr || "").trim().toLowerCase();
    const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!m) return 0;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return h * 60 + min;
}

export function parseRegistrationFromLineItem(lineItem) {
    const props = lineItem.properties || [];
    if (!props.length) return null;

    const byName = Object.fromEntries(props.map((p) => [p.name, p.value]));
    const hasBooking =
        byName.Date ||
        byName["_Event #"] ||
        propertyValueByPattern(props, /participant/i);
    if (!hasBooking) return null;

    const date = (byName.Date || byName["_Start Date"] || "").trim();
    const startTime = (byName.Time || byName["_Start Time"] || "").trim();
    const endTime = (byName["_End Time"] || "").trim();
    let timeLabel = startTime;
    if (startTime && endTime) {
        timeLabel = `${startTime} – ${endTime}`;
    }

    const workshopRaw =
        (byName["_Booked With"] || "").trim() ||
        [lineItem.title, lineItem.variant_title].filter(Boolean).join(" · ");

    const attendees = extractAttendeesFromProperties(props);
    const fallbackParticipant = propertyValueByPattern(
        props,
        /^_Full Name of Participant/i
    );
    const fallbackContact = propertyValueByPattern(
        props,
        /^_Contact Number/i
    );
    const fallbackEmail = propertyValueByPattern(
        props,
        /^_E-mail Address/i
    );

    const workshopDisplay = formatWorkshopDisplayName(workshopRaw);

    const pass =
        propertyValueByPattern(props, /pass|ticket|tier/i) ||
        String(lineItem.variant_title || "").trim();
    const fallbackMilk = propertyValueByPattern(props, /milk/i);

    return {
        workshop: workshopRaw,
        workshopDisplay,
        location: extractWorkshopLocation(workshopRaw, workshopDisplay),
        date,
        sessionDateIso: sessionDateToIso(date),
        time: timeLabel,
        startTime,
        endTime,
        eventId: String(byName["_Event #"] ?? "").trim(),
        quantity: lineItem.quantity || 1,
        attendees,
        participant: fallbackParticipant,
        contact: fallbackContact,
        email: fallbackEmail,
        pass,
        milk: fallbackMilk,
    };
}

/** Seats on one line item: Shopify qty or Easy Booking attendee rows, whichever is larger. */
export function registrationSeatCount(reg) {
    const qty = Math.max(1, Number(reg?.quantity) || 1);
    const attendeeCount = Array.isArray(reg?.attendees) ? reg.attendees.length : 0;
    return Math.max(qty, attendeeCount);
}

/** Renumber seat labels within each order group (e.g. 1 of 3, 2 of 3). */
export function normalizeOrderSeatLabels(participants, groupKey = (p) => String(p.orderId)) {
    const byOrder = new Map();
    for (const p of participants || []) {
        const key = groupKey(p);
        if (!byOrder.has(key)) byOrder.set(key, []);
        byOrder.get(key).push(p);
    }
    for (const group of byOrder.values()) {
        group.sort((a, b) => {
            if (Boolean(a.isSeatFollower) !== Boolean(b.isSeatFollower)) {
                return a.isSeatFollower ? 1 : -1;
            }
            return (a.seatIndex ?? 0) - (b.seatIndex ?? 0);
        });
        const total = group.length;
        group.forEach((p, i) => {
            p.seatIndex = i + 1;
            p.seatTotal = total;
            p.seatLabel = `${i + 1} of ${total}`;
            p.isSeatFollower = i > 0;
        });
    }
}

export function expandRegistrationToSeatRows(reg, orderMeta) {
    const qty = registrationSeatCount(reg);
    const baseAttendees =
        reg.attendees && reg.attendees.length
            ? reg.attendees
            : [
                  {
                      participant: reg.participant,
                      contact: reg.contact,
                      email: reg.email,
                  },
              ];

    const primary = baseAttendees[0] || {
        participant: reg.participant,
        contact: reg.contact,
        email: reg.email,
    };

    const rows = [];
    for (let i = 0; i < qty; i++) {
        const specific = baseAttendees[i] || {};
        const att = {
            participant:
                (specific.participant || "").trim() ||
                (primary.participant || "").trim() ||
                (reg.participant || "").trim(),
            contact:
                (specific.contact || "").trim() ||
                (primary.contact || "").trim() ||
                (reg.contact || "").trim(),
            email:
                (specific.email || "").trim() ||
                (primary.email || "").trim() ||
                (reg.email || "").trim(),
            milk:
                (specific.milk || "").trim() ||
                (reg.milk || "").trim(),
        };
        rows.push({
            ...orderMeta,
            participant: att.participant || "—",
            contact: att.contact,
            email: att.email,
            pass: reg.pass || "",
            milk: att.milk,
            seatLabel: `${i + 1} of ${qty}`,
            seatIndex: i + 1,
            seatTotal: qty,
            isSeatFollower: i > 0,
        });
    }
    return rows;
}

export function expandRegistrationToSeatRowsWithFallback(
    reg,
    orderMeta,
    orderFallback = {}
) {
    return expandRegistrationToSeatRows(reg, orderMeta).map((row) =>
        applyContactFallback(row, reg, orderFallback)
    );
}

export function dedupeWorkshopSessions(sessions) {
    const seen = new Set();
    const out = [];
    for (const s of sessions || []) {
        if (!s?.sessionDateIso || !s?.eventId) continue;
        const key = `${s.eventId}|${s.sessionDateIso}|${(s.startTime || "").trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

export function findNextSessionAfter(sessions, orderDateIso) {
    const unique = dedupeWorkshopSessions(sessions);
    if (!unique.length || !orderDateIso) return null;
    const sorted = unique.sort((a, b) => {
        const byDate = a.sessionDateIso.localeCompare(b.sessionDateIso);
        if (byDate !== 0) return byDate;
        return parseTimeSortKey(a.startTime) - parseTimeSortKey(b.startTime);
    });
    return sorted.find((s) => s.sessionDateIso >= orderDateIso) || null;
}

export function sessionsForLineItem(lineItem, catalog) {
    return dedupeWorkshopSessions([
        ...(catalog?.byProductId?.get(lineItem.product_id) || []),
        ...(catalog?.byTitle?.get(
            formatWorkshopDisplayName(lineItem.title || "").toLowerCase()
        ) || []),
    ]);
}

/** Next inferred session that lands on a specific roster day/event. */
export function findInferredSessionForTarget(
    lineItem,
    orderDateIso,
    catalog,
    eventId,
    sessionDateIso
) {
    const next = findNextSessionAfter(
        sessionsForLineItem(lineItem, catalog),
        orderDateIso
    );
    if (!next) return null;
    if (String(next.eventId) !== String(eventId)) return null;
    if (next.sessionDateIso !== sessionDateIso) return null;
    return next;
}

export function buildSessionCatalogFromOrders(orders) {
    const byProductId = new Map();
    const byTitle = new Map();
    const seen = new Set();

    for (const order of orders || []) {
        for (const li of order.line_items || []) {
            const reg = parseRegistrationFromLineItem(li);
            if (!reg?.sessionDateIso || !reg?.eventId) continue;
            const dedupeKey = `${reg.eventId}|${reg.sessionDateIso}|${(reg.startTime || "").trim().toLowerCase()}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const session = {
                eventId: reg.eventId,
                sessionDateIso: reg.sessionDateIso,
                date: reg.date,
                time: reg.time,
                startTime: reg.startTime,
                endTime: reg.endTime,
                workshop: reg.workshop,
                workshopDisplay: reg.workshopDisplay,
            };

            if (li.product_id) {
                const pid = li.product_id;
                const arr = byProductId.get(pid) || [];
                arr.push(session);
                byProductId.set(pid, arr);
            }

            const titleKey = formatWorkshopDisplayName(
                li.title || reg.workshop || ""
            ).toLowerCase();
            if (titleKey) {
                const arr = byTitle.get(titleKey) || [];
                arr.push(session);
                byTitle.set(titleKey, arr);
            }
        }
    }

    return { byProductId, byTitle };
}

export function inferRegistrationStub(lineItem, orderFallback, nextSession) {
    const stub = {
        workshop: lineItem.title || "",
        workshopDisplay: formatWorkshopDisplayName(lineItem.title || ""),
        date: "",
        sessionDateIso: "",
        time: "",
        startTime: "",
        endTime: "",
        eventId: "",
        quantity: lineItem.quantity || 1,
        attendees: null,
        participant: orderFallback.participant || "",
        contact: orderFallback.contact || "",
        email: orderFallback.email || "",
        noBooking: true,
        inferred: true,
    };
    if (!nextSession) return stub;
    return {
        ...stub,
        eventId: nextSession.eventId,
        sessionDateIso: nextSession.sessionDateIso,
        date: nextSession.date,
        time: nextSession.time,
        startTime: nextSession.startTime,
        endTime: nextSession.endTime,
    };
}

export function orderCreatedDateIso(order) {
    const raw = (order?.created_at || "").trim();
    if (!raw) return "";
    const ymd = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    return sessionDateToIso(raw);
}

function workshopDayKey(eventId, sessionDateIso) {
    return `${String(eventId)}|${sessionDateIso}`;
}

function ensureWorkshopDayEntry(days, eventId, sessionDateIso, meta = {}) {
    const key = workshopDayKey(eventId, sessionDateIso);
    if (!days.has(key)) {
        days.set(key, {
            eventId: String(eventId),
            sessionDateIso,
            dateLabel: meta.dateLabel || meta.date || sessionDateIso,
            workshopDisplay:
                meta.workshopDisplay ||
                formatWorkshopDisplayName(meta.workshop || "") ||
                "Workshop",
            location:
                meta.location ||
                extractWorkshopLocation(meta.workshop, meta.workshopDisplay) ||
                "",
            timeLabels: new Set(),
            seatCount: 0,
            noBookingCount: 0,
        });
    }
    const day = days.get(key);
    if (meta.dateLabel && !day.dateLabel) day.dateLabel = meta.dateLabel;
    if (meta.workshopDisplay && day.workshopDisplay === "Workshop") {
        day.workshopDisplay = meta.workshopDisplay;
    }
    if (meta.location && !day.location) day.location = meta.location;
    if (meta.time) day.timeLabels.add(meta.time);
    return day;
}

/** Aggregate workshop days (event + date) with seat counts from orders. */
export function buildWorkshopDayIndex(orders) {
    const days = new Map();
    const processedInferKeys = new Set();

    for (const order of orders || []) {
        if (order.cancelled_at) continue;
        for (const li of order.line_items || []) {
            const reg = parseRegistrationFromLineItem(li);
            if (!reg?.eventId || !reg?.sessionDateIso) continue;
            const day = ensureWorkshopDayEntry(
                days,
                reg.eventId,
                reg.sessionDateIso,
                {
                    dateLabel: reg.date,
                    workshopDisplay: reg.workshopDisplay || reg.workshop,
                    workshop: reg.workshop,
                    location: reg.location,
                    time: reg.time,
                }
            );
            day.seatCount += registrationSeatCount(reg);
        }
    }

    const catalog = buildSessionCatalogFromOrders(orders);

    for (const order of orders || []) {
        if (order.cancelled_at) continue;
        for (const li of order.line_items || []) {
            if (parseRegistrationFromLineItem(li)) continue;

            const orderDateIso = orderCreatedDateIso(order);
            const sessions = sessionsForLineItem(li, catalog);
            const next = findNextSessionAfter(sessions, orderDateIso);
            if (!next?.eventId || !next?.sessionDateIso) continue;

            const inferKey = `${order.id}|${li.id}|${workshopDayKey(next.eventId, next.sessionDateIso)}`;
            if (processedInferKeys.has(inferKey)) continue;
            processedInferKeys.add(inferKey);

            const seats = registrationSeatCount({ quantity: li.quantity || 1, attendees: null });
            const day = ensureWorkshopDayEntry(
                days,
                next.eventId,
                next.sessionDateIso,
                {
                    dateLabel: next.date,
                    workshopDisplay: next.workshopDisplay || next.workshop,
                    workshop: next.workshop,
                    location: extractWorkshopLocation(
                        next.workshop,
                        next.workshopDisplay
                    ),
                    time: next.time,
                }
            );
            day.seatCount += seats;
            day.noBookingCount += seats;
        }
    }

    return [...days.values()].map((day) => ({
        eventId: day.eventId,
        sessionDateIso: day.sessionDateIso,
        dateLabel: day.dateLabel,
        workshopDisplay: day.workshopDisplay,
        location: day.location || "",
        timeLabels: [...day.timeLabels].filter(Boolean).sort(),
        seatCount: day.seatCount,
        noBookingCount: day.noBookingCount,
    }));
}

export function workshopManagementUrl(reg, fromOrderId) {
    if (!reg?.eventId || !reg?.sessionDateIso) return null;
    const qs = new URLSearchParams({
        event_id: reg.eventId,
        session_date: reg.sessionDateIso,
    });
    if (fromOrderId) qs.set("from_order", String(fromOrderId));
    qs.set("v", "54");
    return `workshop.html?${qs.toString()}`;
}
