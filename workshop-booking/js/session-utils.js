import { SESSION_DURATION_HOURS, MAX_DURATION_HOURS, DURATION_STEP_MINUTES, TIME_STEP_MINUTES } from "./config.js";

/** Snap hours to nearest 15-minute increment (0–5 h). */
export function snapDurationHours(hours) {
    const maxMin = MAX_DURATION_HOURS * 60;
    const totalMin = Math.round(Number(hours || 0) * 60);
    const snapped = Math.round(totalMin / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
    const clamped = Math.min(maxMin, Math.max(0, snapped));
    return clamped / 60;
}

/** All duration values in hours: 0, 0.25, … 5. */
export function durationOptionsHours() {
    const options = [];
    const maxMin = MAX_DURATION_HOURS * 60;
    for (let m = 0; m <= maxMin; m += DURATION_STEP_MINUTES) {
        options.push(m / 60);
    }
    return options;
}

/** Human label for a duration option. */
export function formatDurationLabel(hours) {
    const totalMin = Math.round(Number(hours) * 60);
    if (totalMin <= 0) return "0 min";
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
    const hourPart = h === 1 ? "1 hr" : `${h} hr`;
    return `${hourPart} ${m} min`;
}

/** @param {string} startTime "HH:mm" @param {number} [durationHours] */
export function endTimeFromStart(startTime, durationHours = SESSION_DURATION_HOURS) {
    const [h, m] = startTime.split(":").map(Number);
    const totalMinutes = h * 60 + m + Number(durationHours || SESSION_DURATION_HOURS) * 60;
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

/** @param {string} hhmm */
export function formatTime12(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Snap HH:mm to nearest time-step increment. */
export function snapStartTime(hhmm) {
    const raw = String(hhmm || "").trim().slice(0, 5);
    if (!raw) return "10:00";
    const [h, m] = raw.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return "10:00";
    let total = h * 60 + m;
    total = Math.round(total / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
    total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
    const rh = Math.floor(total / 60);
    const rm = total % 60;
    return `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
}

/** All start times in HH:mm at TIME_STEP_MINUTES increments. */
export function startTimeOptions() {
    const options = [];
    for (let m = 0; m < 24 * 60; m += TIME_STEP_MINUTES) {
        const h = Math.floor(m / 60);
        const min = m % 60;
        options.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
    }
    return options;
}

/** Minutes from midnight for HH:mm. */
export function timeToMinutes(hhmm) {
    const [h, m] = String(hhmm || "00:00").split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h * 60 + m;
}

/** HH:mm from minutes (wraps within a day). */
export function minutesToTime(totalMinutes) {
    const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minutes from start to end; adds a day if end is not after start. */
export function minutesBetweenTimes(startTime, endTime) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    let diff = end - start;
    if (diff <= 0) diff += 24 * 60;
    return diff;
}

/** Add minutes to HH:mm (wraps within a day). */
export function addMinutesToTime(hhmm, minutes) {
    return minutesToTime(timeToMinutes(hhmm) + minutes);
}

/** Options HTML for a time dropdown. */
export function timeSelectOptionsHtml(selectedTime) {
    const selected = snapStartTime(selectedTime);
    return startTimeOptions()
        .map((t) => {
            const sel = t === selected ? " selected" : "";
            return `<option value="${t}"${sel}>${formatTime12(t)}</option>`;
        })
        .join("");
}

/** @param {string} startTime @param {number} [durationHours] */
export function endTimeLabel(startTime, durationHours = SESSION_DURATION_HOURS) {
    if (!startTime) return "—";
    return formatTime12(endTimeFromStart(startTime, durationHours));
}

/** Round HH:mm to nearest 5 minutes (legacy). */
export function roundTimeTo5Min(hhmm) {
    return snapStartTime(hhmm);
}

/** Infer duration in hours from start/end HH:mm pair. */
export function durationHoursFromRange(startTime, endTime) {
    if (!startTime || !endTime) return SESSION_DURATION_HOURS;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff <= 0) diff += 24 * 60;
    const hours = diff / 60;
    return Math.round(hours * 4) / 4 || SESSION_DURATION_HOURS;
}

/** @param {string} eventType @param {string} date YYYY-MM-DD @param {string} startTime HH:mm */
export function sessionIdFor(eventType, date, startTime) {
    const t = startTime.replace(":", "");
    return `${slugify(eventType)}_${date}_${t}`;
}

/** @param {string} value */
export function slugify(value) {
    return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "event";
}

/** @param {object} session */
export function remainingSeats(session) {
    const cap = Number(session.capacity) || 0;
    const booked = Number(session.bookedSeats) || 0;
    const held = Number(session.heldSeats) || 0;
    return Math.max(0, cap - booked - held);
}

/** @param {string} date YYYY-MM-DD */
export function formatSessionDate(date) {
    const [y, mo, d] = date.split("-").map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString("en-PH", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

/** @param {string} start @param {string} end HH:mm */
export function formatTimeRange(start, end) {
    return `${formatTime12(start)} - ${formatTime12(end)}`;
}
