import { APP_TITLE, DEFAULT_CAPACITY, SESSION_DURATION_HOURS } from "../../js/config.js";
import {
    endTimeFromStart,
    durationHoursFromRange,
    snapStartTime,
    addMinutesToTime,
    minutesBetweenTimes,
    timeSelectOptionsHtml,
    timeToMinutes,
    formatSessionDate,
    formatTimeRange,
    formatTime12,
    sessionIdFor,
    remainingSeats,
} from "../../js/session-utils.js";
import {
    listSessions,
    listParticipantsForSession,
    getSessionsForEvent,
    deleteSession,
} from "./sessions-api.js";
import {
    mountLocationPicker,
    readLocationPicker,
    locationPickerIsValid,
} from "../../js/location-picker.js";
import {
    getEvent,
    saveEventWithSessions,
    deleteEventWithSessions,
} from "./events-api.js";

function eventNameFrom(event, session) {
    return String(
        event?.eventName || event?.title || event?.eventType || session?.eventType || ""
    ).trim();
}

function eventLocationFrom(event) {
    return {
        venue: event?.venue || "",
        address: event?.address || "",
        placeId: event?.placeId || "",
        lat: event?.lat ?? null,
        lng: event?.lng ?? null,
    };
}

const $ = (id) => document.getElementById(id);

const filterMonth = $("filterMonth");
const filterEventType = $("filterEventType");
const filterStatus = $("filterStatus");
const searchInput = $("searchInput");
const statusBar = $("statusBar");
const sessionsTbody = $("sessionsTbody");
const emptyState = $("emptyState");
const calendarGrid = $("calendarGrid");
const calendarMonthLabel = $("calendarMonthLabel");
const listView = $("listView");
const calendarView = $("calendarView");
const workspace = $("workspace");
const detailPane = $("detailPane");
const detailPaneBody = $("detailPaneBody");
const detailPaneTitle = $("detailPaneTitle");
const detailModalBackdrop = $("detailModalBackdrop");
const eventTypeSuggestions = $("eventTypeSuggestions");

const listTableHead = $("listTableHead");
const listGroupToggle = $("listGroupToggle");

let currentSessions = [];
let viewMode = "list";
let listGrouping = "events";
let detailOpen = false;
let detailMode = "closed";
let selectedSessionId = null;
let selectedEventKey = null;
let editingEventId = null;
let legacyOrphanSessionId = null;
let originalSessionIds = [];
let viewEventCache = { event: null, sessions: [] };

document.title = APP_TITLE;

function setStatus(message, type = "") {
    statusBar.textContent = message;
    statusBar.className = "status-bar" + (type ? ` ${type}` : "");
}

function escapeHtml(s) {
    return String(s || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
}

function setDefaultMonthAndDate() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    filterMonth.value = `${y}-${m}`;
}

function todayIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function sortedEventTypes(items) {
    return [...new Set(items.map((x) => (x.eventType || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

function renderEventTypeSuggestions() {
    eventTypeSuggestions.innerHTML = sortedEventTypes(currentSessions)
        .map((name) => `<option value="${escapeHtml(name)}"></option>`)
        .join("");
}

function eventKeyForSession(session) {
    return session?.eventId || `orphan:${session?.id}`;
}

function aggregateEventStatus(sessions) {
    if (!sessions.length) return "open";
    if (sessions.every((s) => s.status === "cancelled")) return "cancelled";
    const remaining = sessions.reduce((sum, s) => sum + remainingSeats(s), 0);
    if (remaining === 0) return "full";
    return "open";
}

function groupSessionsForList(sessions) {
    const groups = new Map();
    for (const session of sessions) {
        const key = eventKeyForSession(session);
        if (!groups.has(key)) {
            groups.set(key, { eventKey: key, eventId: session.eventId || null, sessions: [] });
        }
        groups.get(key).sessions.push(session);
    }
    return [...groups.values()]
        .map((group) => {
            const sorted = [...group.sessions].sort((a, b) => {
                const dateCmp = a.date.localeCompare(b.date);
                return dateCmp || a.startTime.localeCompare(b.startTime);
            });
            const booked = sorted.reduce((sum, s) => sum + Number(s.bookedSeats || 0), 0);
            const remaining = sorted.reduce((sum, s) => sum + remainingSeats(s), 0);
            const times = sorted
                .map((s) => formatTimeRange(s.startTime, s.endTime))
                .join(", ");
            return {
                ...group,
                sessions: sorted,
                eventName: sorted[0]?.eventType || "Untitled Event",
                date: sorted[0]?.date || "",
                booked,
                remaining,
                times,
                status: aggregateEventStatus(sorted),
            };
        })
        .sort((a, b) => {
            const dateCmp = a.date.localeCompare(b.date);
            return dateCmp || a.eventName.localeCompare(b.eventName);
        });
}

function setListGrouping(group) {
    listGrouping = group;
    listGroupToggle?.querySelectorAll(".list-group-btn").forEach((btn) => {
        const active = btn.dataset.group === group;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    renderListTable();
}

function setViewMode(mode) {
    viewMode = mode;
    document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
        const active = btn.dataset.view === mode;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    listView.classList.toggle("hidden", mode !== "list");
    calendarView.classList.toggle("hidden", mode !== "calendar");
    listGroupToggle?.classList.toggle("hidden", mode !== "list");
}

function setDetailOpen(open) {
    detailOpen = open;
    const mobile = isMobile();
    document.body.classList.toggle("split-active", open && !mobile);
    document.body.classList.toggle("detail-modal-open", open && mobile);

    if (open) {
        workspace.classList.add("workspace--split");
        detailPane.classList.remove("hidden");
        detailModalBackdrop.classList.toggle("hidden", !mobile);
    } else {
        workspace.classList.remove("workspace--split");
        detailPane.classList.add("hidden");
        detailModalBackdrop.classList.add("hidden");
        detailPaneBody.innerHTML = `<p class="detail-placeholder">Select an event or add one to get started.</p>`;
        detailPaneTitle.textContent = "Event";
        selectedSessionId = null;
        selectedEventKey = null;
        editingEventId = null;
        legacyOrphanSessionId = null;
        originalSessionIds = [];
        viewEventCache = { event: null, sessions: [] };
        detailMode = "closed";
        renderListTable();
    }
}

function formatListDate(date) {
    const [y, mo, d] = date.split("-").map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
    });
}

function formatSeatsFraction(booked, capacity) {
    return `${Number(booked) || 0}/${Number(capacity) || 0}`;
}

function sessionPillsHtml(sessions) {
    return sessions
        .map((s) => `<span class="row-sub">${escapeHtml(formatTimeRange(s.startTime, s.endTime))}</span>`)
        .join("");
}

function formatSessionRangesList(sessions) {
    return sessions.map((s) => formatTimeRange(s.startTime, s.endTime)).join(" · ");
}

function sessionBookedTotal(sessions) {
    return sessions.reduce((sum, s) => sum + Number(s.bookedSeats || 0), 0);
}

function sessionCapacityTotal(sessions) {
    return sessions.reduce((sum, s) => sum + Number(s.capacity || 0), 0);
}

function venueDetailHtml(location) {
    const venue = String(location.venue || "").trim();
    const address = String(location.address || "").trim();
    if (!venue && !address) return `<dd class="venue-detail">—</dd>`;
    return `<dd class="venue-detail">
  ${venue ? `<span class="venue-name">${escapeHtml(venue)}</span>` : ""}
  ${address ? `<span class="venue-address">${escapeHtml(address)}</span>` : ""}
</dd>`;
}

function groupDaySessionsByEvent(daySessions) {
    const groups = new Map();
    for (const session of daySessions) {
        const key = eventKeyForSession(session);
        if (!groups.has(key)) {
            groups.set(key, {
                eventKey: key,
                eventName: session.eventType || "Event",
                sessions: [],
            });
        }
        groups.get(key).sessions.push(session);
    }
    return [...groups.values()]
        .map((group) => ({
            ...group,
            sessions: group.sessions.sort((a, b) => a.startTime.localeCompare(b.startTime)),
        }))
        .sort((a, b) => a.sessions[0].startTime.localeCompare(b.sessions[0].startTime));
}

function renderListTableHead() {
    if (!listTableHead) return;
    listTableHead.innerHTML = `
<tr>
  <th class="col-event">Event</th>
  <th class="col-date">Date</th>
  <th class="col-seats">Booked</th>
</tr>`;
}

function renderListTable() {
    renderListTableHead();
    if (!currentSessions.length) {
        sessionsTbody.innerHTML = "";
        emptyState.classList.remove("hidden");
        return;
    }
    emptyState.classList.add("hidden");

    if (listGrouping === "sessions") {
        sessionsTbody.innerHTML = currentSessions.map((s) => {
            const selected = s.id === selectedSessionId ? " row-selected" : "";
            return `
<tr data-id="${s.id}" data-event-key="${escapeHtml(eventKeyForSession(s))}" class="${selected.trim()}">
  <td class="col-event">
    <strong class="row-title">${escapeHtml(s.eventType || "Untitled Event")}</strong>
    <div class="row-schedule-pills">${sessionPillsHtml([s])}</div>
  </td>
  <td class="col-date">${escapeHtml(formatListDate(s.date))}</td>
  <td class="col-seats">${escapeHtml(formatSeatsFraction(s.bookedSeats || 0, s.capacity))}</td>
</tr>`;
        }).join("");
        return;
    }

    const groups = groupSessionsForList(currentSessions);
    sessionsTbody.innerHTML = groups.map((group) => {
        const selected = group.eventKey === selectedEventKey ? " row-selected" : "";
        const booked = sessionBookedTotal(group.sessions);
        const capacity = sessionCapacityTotal(group.sessions);
        return `
<tr data-event-key="${escapeHtml(group.eventKey)}" data-session-id="${escapeHtml(group.sessions[0]?.id || "")}" class="${selected.trim()}">
  <td class="col-event">
    <strong class="row-title">${escapeHtml(group.eventName)}</strong>
    <div class="row-schedule-pills">${sessionPillsHtml(group.sessions)}</div>
  </td>
  <td class="col-date">${escapeHtml(formatListDate(group.date))}</td>
  <td class="col-seats">${escapeHtml(formatSeatsFraction(booked, capacity))}</td>
</tr>`;
    }).join("");
}

function renderSessionsTable() {
    renderListTable();
}

function renderDayEventChip(group) {
    const firstSession = group.sessions[0];
    const ranges = formatSessionRangesList(group.sessions);
    const title = `${group.eventName} — ${ranges}`;
    const maxTimes = 3;
    const visible = group.sessions.slice(0, maxTimes);
    const hidden = group.sessions.length - visible.length;
    const timesHtml = visible
        .map((s) => `<span class="day-event-time">${escapeHtml(formatTime12(s.startTime))}</span>`)
        .join("");
    const moreTimes = hidden > 0
        ? `<span class="day-event-time day-event-time--more">+${hidden}</span>`
        : "";
    return `<button type="button" class="day-event" data-session-id="${escapeHtml(firstSession.id)}" title="${escapeHtml(title)}">
  <span class="day-event-name">${escapeHtml(group.eventName)}</span>
  <span class="day-event-times">${timesHtml}${moreTimes}</span>
</button>`;
}

function renderCalendar(items, month) {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstWeekday = first.getDay();
    calendarMonthLabel.textContent = first.toLocaleDateString("en-PH", { month: "long", year: "numeric" });

    const map = new Map();
    items.forEach((s) => {
        if (!map.has(s.date)) map.set(s.date, []);
        map.get(s.date).push(s);
    });

    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const header = weekdays
        .map((label) => `<div class="calendar-weekday">${label}</div>`)
        .join("");

    const cells = [];
    for (let i = 0; i < firstWeekday; i += 1) {
        cells.push(`<div class="day-card empty day-card--pad" aria-hidden="true"></div>`);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const daySessions = (map.get(date) || []).sort((a, b) => a.startTime.localeCompare(b.startTime));
        if (!daySessions.length) {
            cells.push(`<div class="day-card empty" data-date="${date}" role="button" tabindex="0" title="Add event on ${date}">
  <div class="day-num">${day}</div>
</div>`);
            continue;
        }

        const eventGroups = groupDaySessionsByEvent(daySessions);
        const chips = eventGroups
            .slice(0, 2)
            .map((group) => renderDayEventChip(group))
            .join("");
        const hiddenCount = eventGroups.length > 2 ? eventGroups.length - 2 : 0;
        const more = hiddenCount
            ? `<button type="button" class="day-event-more" data-date="${date}">+${hiddenCount} more</button>`
            : "";
        cells.push(`<div class="day-card has-sessions" data-date="${date}">
  <div class="day-num">${day}</div>
  <div class="day-events">${chips}${more}</div>
</div>`);
    }
    calendarGrid.innerHTML = header + cells.join("");
}

async function loadAndRender() {
    const month = filterMonth.value;
    if (!month) {
        setStatus("Pick a month to list sessions.", "error");
        return;
    }
    setStatus("Loading...");
    try {
        currentSessions = await listSessions({
            monthPrefix: month,
            statusFilter: filterStatus.value || null,
            eventTypeFilter: filterEventType.value.trim() || null,
            searchText: searchInput.value.trim() || null,
        });
        renderListTable();
        renderCalendar(currentSessions, month);
        renderEventTypeSuggestions();
        const eventCount = groupSessionsForList(currentSessions).length;
        const label = listGrouping === "events"
            ? `${eventCount} event(s), ${currentSessions.length} session(s).`
            : `${currentSessions.length} session(s).`;
        setStatus(label, "success");
    } catch (err) {
        console.error(err);
        setStatus(`Failed to load: ${err.message}`, "error");
    }
}

function scheduleMetaHtml(date) {
    return `
<div class="schedule-meta">
  <div class="schedule-meta-field">
    <label for="scheduleDate">Date</label>
    <input type="date" id="scheduleDate" value="${escapeHtml(date)}" required />
  </div>
</div>`;
}

function timeSelectHtml(value, className) {
    const time = snapStartTime(value || "10:00");
    return `<select class="${className}" required>${timeSelectOptionsHtml(time)}</select>`;
}

function wireLinkedSessionTimes(root) {
    root?.querySelectorAll(".session-row, .schedule-block").forEach((container) => {
        const startSelect = container.querySelector(".session-start");
        const endSelect = container.querySelector(".session-end");
        if (!startSelect || !endSelect) return;

        const rememberTimes = () => {
            container.dataset.linkStart = startSelect.value;
            container.dataset.linkEnd = endSelect.value;
        };

        startSelect.addEventListener("focus", rememberTimes);
        endSelect.addEventListener("focus", rememberTimes);

        startSelect.addEventListener("change", () => {
            const durationMin = minutesBetweenTimes(
                container.dataset.linkStart || startSelect.value,
                container.dataset.linkEnd || endSelect.value
            ) || SESSION_DURATION_HOURS * 60;
            const newStart = snapStartTime(startSelect.value);
            endSelect.value = snapStartTime(addMinutesToTime(newStart, durationMin));
        });

        endSelect.addEventListener("change", () => {
            const durationMin = minutesBetweenTimes(
                container.dataset.linkStart || startSelect.value,
                container.dataset.linkEnd || endSelect.value
            ) || SESSION_DURATION_HOURS * 60;
            const newEnd = snapStartTime(endSelect.value);
            startSelect.value = snapStartTime(addMinutesToTime(newEnd, -durationMin));
        });
    });
}

function blankSessionRow(date = todayIso(), capacity = DEFAULT_CAPACITY) {
    const start = "10:00";
    return {
        id: "",
        date,
        startTime: start,
        endTime: endTimeFromStart(start, SESSION_DURATION_HOURS),
        capacity,
        status: "open",
        bookedSeats: 0,
        heldSeats: 0,
    };
}

function scheduleDateValue(rows) {
    if (!rows?.length) return todayIso();
    const fromSelected = selectedSessionId
        ? rows.find((r) => r.id === selectedSessionId)?.date
        : "";
    return fromSelected || rows[0]?.date || todayIso();
}

function slotFieldsHtml(row, { showBookedMeta = false } = {}) {
    const start = snapStartTime(row.startTime || "10:00");
    const end = snapStartTime(row.endTime || endTimeFromStart(start, SESSION_DURATION_HOURS));
    const meta = showBookedMeta && row.id
        ? `<p class="session-row-meta">${row.bookedSeats || 0}/${row.capacity}</p>`
        : "";
    return `
<div class="slot-row">
  <div class="slot-start">
    <label>Start</label>
    ${timeSelectHtml(start, "session-start")}
  </div>
  <div class="slot-end">
    <label>End</label>
    ${timeSelectHtml(end, "session-end")}
  </div>
  <div class="slot-capacity">
    <label>Capacity</label>
    <input type="number" class="session-capacity" min="1" max="200" value="${row.capacity}" required />
  </div>
</div>
${meta}
<input type="hidden" class="session-id" value="${escapeHtml(row.id || "")}" />
<input type="hidden" class="session-booked" value="${row.bookedSeats || 0}" />
<input type="hidden" class="session-held" value="${row.heldSeats || 0}" />
<input type="hidden" class="session-status" value="${escapeHtml(row.status || "open")}" />`;
}

function renderSessionRepeaterRow(row, index, canRemove) {
    return `
<div class="session-row" data-session-index="${index}">
  ${canRemove ? `<button type="button" class="session-remove-btn btn-remove-session" data-session-index="${index}" aria-label="Remove slot">&times;</button>` : ""}
  ${slotFieldsHtml(row, { showBookedMeta: true })}
</div>`;
}

function renderEventView({ event, sessions, focusSessionId }) {
    const eventName = eventNameFrom(event, sessions[0]);
    const location = eventLocationFrom(event);
    const scheduleDate = scheduleDateValue(sessions);
    const notes = String(event?.notes || "").trim() || "—";
    const multi = sessions.length > 1;

    detailPaneTitle.textContent = eventName || "Event";

    const sessionList = sessions.map((row) => {
        const active = row.id === focusSessionId ? " is-active" : "";
        return `
<li class="session-detail-item${active}">
  <button type="button" class="session-focus-btn${active}" data-session-id="${escapeHtml(row.id)}">
    <span class="session-detail-time">${escapeHtml(formatTimeRange(row.startTime, row.endTime))}</span>
    <span class="session-detail-meta">${escapeHtml(formatSeatsFraction(row.bookedSeats || 0, row.capacity))}</span>
  </button>
</li>`;
    }).join("");

    detailPaneBody.innerHTML = `
<div class="event-detail-view">
  <section class="event-form-section">
    <h3>Event details</h3>
    <dl class="detail-grid">
      <div><dt>Event name</dt><dd>${escapeHtml(eventName || "—")}</dd></div>
      <div><dt>Date</dt><dd>${escapeHtml(formatSessionDate(scheduleDate))}</dd></div>
      <div class="full-width"><dt>Venue</dt>${venueDetailHtml(location)}</div>
      <div class="full-width"><dt>Notes</dt><dd>${escapeHtml(notes)}</dd></div>
    </dl>
  </section>
  <section class="event-form-section schedule-section">
    <h3>Schedule</h3>
    <dl class="detail-grid">
      <div class="full-width"><dt>${multi ? "Sessions" : "Time"}</dt>
        <dd>
          <ul class="session-detail-list">${sessionList}</ul>
        </dd>
      </div>
    </dl>
  </section>
  <div class="detail-actions">
    <button type="button" class="btn-primary" id="editEventBtn">Edit event</button>
    <button type="button" class="btn-danger" id="deleteEventViewBtn">Delete event</button>
  </div>
  <div class="participants-section" id="participantsSection">
    <h3>Participants</h3>
    <div id="participantsContent"><p class="participants-empty">Loading…</p></div>
  </div>
</div>`;

    $("editEventBtn")?.addEventListener("click", () => openEditFromView());
    $("deleteEventViewBtn")?.addEventListener("click", onDeleteEvent);
    detailPaneBody.querySelectorAll(".session-focus-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const sessionId = btn.dataset.sessionId;
            if (!sessionId || sessionId === focusSessionId) return;
            selectedSessionId = sessionId;
            renderEventView({
                event: viewEventCache.event,
                sessions: viewEventCache.sessions,
                focusSessionId: sessionId,
            });
            renderListTable();
            renderParticipants(sessionId);
        });
    });

    if (focusSessionId) {
        renderParticipants(focusSessionId);
    }
}

async function loadEventContext(sessionId) {
    const session = currentSessions.find((s) => s.id === sessionId);
    if (!session) return null;

    let event = null;
    let sessions = [];

    if (session.eventId) {
        editingEventId = session.eventId;
        legacyOrphanSessionId = null;
        event = await getEvent(session.eventId);
        sessions = await getSessionsForEvent(session.eventId);
        if (!sessions.length) sessions = [session];
    } else {
        editingEventId = null;
        legacyOrphanSessionId = session.id;
        event = {
            eventName: session.eventType || "",
            notes: "",
        };
        sessions = [{
            id: session.id,
            date: session.date,
            startTime: session.startTime,
            endTime: session.endTime,
            capacity: session.capacity,
            status: session.status || "open",
            bookedSeats: session.bookedSeats || 0,
            heldSeats: session.heldSeats || 0,
        }];
    }

    if (!event) {
        event = {
            eventName: session.eventType || "",
            notes: "",
        };
    }

    originalSessionIds = sessions.map((s) => s.id);
    const eventKey = eventKeyForSession(session);

    return {
        event: { ...event, id: editingEventId || undefined },
        sessions,
        eventKey,
        focusSessionId: sessionId,
    };
}

async function openViewForSession(sessionId) {
    const context = await loadEventContext(sessionId);
    if (!context) return;

    selectedSessionId = context.focusSessionId;
    selectedEventKey = context.eventKey;
    detailMode = "view";
    viewEventCache = { event: context.event, sessions: context.sessions };
    setDetailOpen(true);
    renderListTable();
    renderEventView({
        event: context.event,
        sessions: context.sessions,
        focusSessionId: context.focusSessionId,
    });
}

async function openViewForEventKey(eventKey) {
    const sessions = currentSessions
        .filter((s) => eventKeyForSession(s) === eventKey)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (!sessions.length) return;
    await openViewForSession(sessions[0].id);
}

function openEditFromView() {
    if (!viewEventCache.sessions.length) return;
    detailMode = "edit";
    renderEventForm({
        mode: "edit",
        event: viewEventCache.event,
        sessions: viewEventCache.sessions,
        participantsSessionId: selectedSessionId,
    });
}

function renderEventForm({ mode, event, sessions, participantsSessionId }) {
    const isEdit = mode === "edit";
    const rows = sessions.length ? sessions : [blankSessionRow()];
    const multi = rows.length > 1;
    const eventName = eventNameFrom(event);
    const location = eventLocationFrom(event);
    const scheduleDate = scheduleDateValue(rows);

    detailPaneTitle.textContent = isEdit ? "Edit event" : "Add event";

    const slotsBlock = multi
        ? `
    <p class="field-hint schedule-slots-hint">Time slots on the date above.</p>
    <div class="session-repeater" id="sessionRepeater">
      ${rows.map((row, i) => renderSessionRepeaterRow(row, i, rows.length > 1)).join("")}
    </div>
    <button type="button" class="btn-secondary add-session-btn" id="addSessionRowBtn">+ Add session</button>`
        : `
    <div id="singleSchedule" class="schedule-block schedule-slot">
      ${slotFieldsHtml(rows[0], { showBookedMeta: isEdit })}
    </div>
    <button type="button" class="btn-add-session-link" id="promoteToMultiBtn">+ Add another session</button>`;

    detailPaneBody.innerHTML = `
<form id="eventForm" class="event-form">
  <section class="event-form-section">
    <h3>Event details</h3>
    <div class="form-grid">
      <div class="full-width">
        <label for="eventName">Event name</label>
        <input type="text" id="eventName" list="eventTypeSuggestions" value="${escapeHtml(eventName)}" placeholder="Matcha Workshop, Meetup, Tasting" required />
      </div>
      <div class="full-width">
        <label for="locationPickerMount">Venue / address</label>
        <div id="locationPickerMount" class="location-picker-mount"></div>
      </div>
      <div class="full-width">
        <label for="eventNotes">Notes</label>
        <textarea id="eventNotes" rows="2" placeholder="Internal notes">${escapeHtml(event.notes || "")}</textarea>
      </div>
    </div>
  </section>
  <section class="event-form-section schedule-section">
    <h3>Schedule</h3>
    ${scheduleMetaHtml(scheduleDate)}
    ${slotsBlock}
  </section>
  <div class="form-actions">
    <button type="submit" class="btn-primary">${isEdit ? "Save changes" : "Save event"}</button>
    ${isEdit ? `<button type="button" class="btn-danger" id="deleteEventBtn">Delete event</button>` : ""}
    <button type="button" class="btn-secondary" id="cancelFormBtn">Cancel</button>
  </div>
</form>
<div class="participants-section" id="participantsSection" ${participantsSessionId ? "" : "hidden"}>
  <h3>Participants</h3>
  <div id="participantsContent"><p class="participants-empty">Loading…</p></div>
</div>`;

    mountLocationPicker($("locationPickerMount"), location);
    wireEventForm({ mode, participantsSessionId, multi, event, sessions: rows });
}

function readSharedScheduleDate() {
    return $("scheduleDate")?.value || "";
}

function readSessionRowsFromDom() {
    const sharedDate = readSharedScheduleDate();
    const multiRows = [...detailPaneBody.querySelectorAll(".session-row")];
    if (multiRows.length) {
        return multiRows.map((row) => ({
            ...readScheduleFromContainer(row),
            date: sharedDate,
        }));
    }
    const single = $("singleSchedule");
    if (single) {
        return [{
            ...readScheduleFromContainer(single),
            date: sharedDate,
        }];
    }
    return [];
}

function readScheduleFromContainer(container) {
    const startTime = snapStartTime(container.querySelector(".session-start")?.value || "10:00");
    const endTime = snapStartTime(container.querySelector(".session-end")?.value || endTimeFromStart(startTime, SESSION_DURATION_HOURS));
    return {
        id: container.querySelector(".session-id")?.value || "",
        date: readSharedScheduleDate(),
        startTime,
        endTime,
        capacity: Number(container.querySelector(".session-capacity")?.value || DEFAULT_CAPACITY),
        status: container.querySelector(".session-status")?.value || "open",
        bookedSeats: Number(container.querySelector(".session-booked")?.value || 0),
        heldSeats: Number(container.querySelector(".session-held")?.value || 0),
    };
}

function snapshotEventFormState() {
    const location = readLocationPicker($("locationPickerMount"));
    return {
        mode: detailMode === "add" ? "add" : "edit",
        event: {
            id: editingEventId || undefined,
            eventName: $("eventName")?.value.trim() || "",
            venue: location.venue,
            address: location.address,
            placeId: location.placeId,
            lat: location.lat,
            lng: location.lng,
            notes: $("eventNotes")?.value.trim() || "",
        },
        sessions: readSessionRowsFromDom(),
        participantsSessionId: selectedSessionId,
    };
}

function wireEventForm({ mode, participantsSessionId, multi }) {
    const form = $("eventForm");
    const repeater = $("sessionRepeater");

    function rerenderFromDom(nextSessions, forceMulti = null) {
        const snap = snapshotEventFormState();
        snap.sessions = nextSessions;
        const useMulti = forceMulti ?? nextSessions.length > 1;
        if (!useMulti && nextSessions.length > 1) {
            snap.sessions = [nextSessions[0]];
        }
        renderEventForm({
            mode: snap.mode,
            event: snap.event,
            sessions: useMulti ? nextSessions : [nextSessions[0] || blankSessionRow()],
            participantsSessionId: snap.participantsSessionId,
        });
    }

    function wireSessionRowListeners() {
        if (!repeater) return;
        repeater.querySelectorAll(".btn-remove-session").forEach((btn) => {
            btn.addEventListener("click", () => {
                const index = Number(btn.dataset.sessionIndex);
                const rows = readSessionRowsFromDom();
                rows.splice(index, 1);
                if (!rows.length) rows.push(blankSessionRow());
                rerenderFromDom(rows);
            });
        });
    }

    wireSessionRowListeners();
    wireLinkedSessionTimes(detailPaneBody);

    $("promoteToMultiBtn")?.addEventListener("click", () => {
        const rows = readSessionRowsFromDom();
        const sharedDate = readSharedScheduleDate() || todayIso();
        const first = rows[0];
        const second = blankSessionRow(sharedDate, DEFAULT_CAPACITY);
        if (first) {
            second.startTime = snapStartTime(first.endTime);
            second.endTime = endTimeFromStart(second.startTime, SESSION_DURATION_HOURS);
        }
        rerenderFromDom([...rows, second], true);
    });

    $("addSessionRowBtn")?.addEventListener("click", () => {
        const sharedDate = readSharedScheduleDate() || todayIso();
        const rows = readSessionRowsFromDom();
        const last = rows[rows.length - 1];
        const next = blankSessionRow(sharedDate, DEFAULT_CAPACITY);
        if (last) {
            next.startTime = snapStartTime(last.endTime);
            next.endTime = endTimeFromStart(next.startTime, SESSION_DURATION_HOURS);
        }
        rows.push(next);
        rerenderFromDom(rows, true);
    });

    $("cancelFormBtn")?.addEventListener("click", () => {
        if (mode === "edit" && viewEventCache.sessions.length) {
            detailMode = "view";
            renderEventView({
                event: viewEventCache.event,
                sessions: viewEventCache.sessions,
                focusSessionId: selectedSessionId || viewEventCache.sessions[0]?.id,
            });
            return;
        }
        setDetailOpen(false);
    });

    if (mode === "edit") {
        $("deleteEventBtn")?.addEventListener("click", onDeleteEvent);
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await onSaveEvent(mode);
    });

    if (participantsSessionId) {
        renderParticipants(participantsSessionId);
    }
}

async function renderParticipants(sessionId) {
    const container = $("participantsContent");
    const section = $("participantsSection");
    if (!container || !section) return;
    section.hidden = false;
    try {
        const rows = await listParticipantsForSession(sessionId);
        if (!rows.length) {
            container.innerHTML = `<p class="participants-empty">No participants yet for this session.</p>`;
            return;
        }
        container.innerHTML = `
<table class="participants-table">
  <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Seats</th><th>Status</th><th>Order</th></tr></thead>
  <tbody>
    ${rows.map((r) => `<tr><td>${escapeHtml(r.name || "-")}</td><td>${escapeHtml(r.email || "-")}</td><td>${escapeHtml(r.phone || "-")}</td><td>${r.seats}</td><td>${escapeHtml(r.bookingStatus)}</td><td>${escapeHtml(r.orderRef)}</td></tr>`).join("")}
  </tbody>
</table>`;
    } catch (err) {
        container.innerHTML = `<p class="participants-empty">Failed to load participants: ${escapeHtml(err.message)}</p>`;
    }
}

async function openAddEvent(prefillDate) {
    detailMode = "add";
    editingEventId = null;
    legacyOrphanSessionId = null;
    originalSessionIds = [];
    selectedSessionId = null;
    setDetailOpen(true);

    const date = prefillDate || todayIso();
    if (prefillDate) filterMonth.value = prefillDate.slice(0, 7);

    renderEventForm({
        mode: "add",
        event: {},
        sessions: [blankSessionRow(date, DEFAULT_CAPACITY)],
        participantsSessionId: null,
    });
}

async function onSaveEvent(mode) {
    const eventName = $("eventName")?.value.trim();
    if (!eventName) {
        setStatus("Event name is required.", "error");
        return;
    }

    const locationMount = $("locationPickerMount");
    if (!locationPickerIsValid(locationMount)) {
        setStatus("Pick a venue from Google Maps search.", "error");
        return;
    }
    const location = readLocationPicker(locationMount);

    const sessionRows = readSessionRowsFromDom();
    if (!sessionRows.length) {
        setStatus("Add a date and time for this event.", "error");
        return;
    }

    for (const row of sessionRows) {
        if (!row.date || !row.startTime || !row.endTime) {
            setStatus("Date, start time, and end time are required.", "error");
            return;
        }
        if (timeToMinutes(row.endTime) <= timeToMinutes(row.startTime)) {
            setStatus("End time must be after start time.", "error");
            return;
        }
    }

    const event = {
        id: editingEventId || undefined,
        eventName,
        venue: location.venue,
        address: location.address,
        placeId: location.placeId,
        lat: location.lat,
        lng: location.lng,
        notes: $("eventNotes")?.value.trim() || "",
        durationHours: durationHoursFromRange(sessionRows[0].startTime, sessionRows[0].endTime),
    };

    const startKeys = sessionRows.map((r) => `${r.date}|${r.startTime}`);
    if (new Set(startKeys).size !== startKeys.length) {
        setStatus("Each session needs a different start time on the same day.", "error");
        return;
    }

    const sessions = sessionRows.map((row) => {
        const startTime = snapStartTime(row.startTime);
        const endTime = snapStartTime(row.endTime);
        const newId = sessionIdFor(eventName, row.date, startTime);
        return {
            id: newId,
            date: row.date,
            startTime,
            endTime,
            capacity: row.capacity,
            status: row.status,
            bookedSeats: row.bookedSeats,
            heldSeats: row.heldSeats,
        };
    });

    const newIds = new Set(sessions.map((s) => s.id));
    const removedSessionIds = [...originalSessionIds.filter((id) => id && !newIds.has(id))];

    for (const row of sessionRows) {
        if (!row.id) continue;
        const newId = sessionIdFor(eventName, row.date, row.startTime);
        if (row.id !== newId && !removedSessionIds.includes(row.id)) {
            removedSessionIds.push(row.id);
        }
    }

    const bookedOnRemoved = removedSessionIds.reduce((sum, id) => {
        const s = currentSessions.find((x) => x.id === id);
        return sum + Number(s?.bookedSeats || 0);
    }, 0);
    if (bookedOnRemoved > 0) {
        const ok = confirm(`Removing session(s) with ${bookedOnRemoved} booked seat(s). Continue?`);
        if (!ok) return;
    }

    if (legacyOrphanSessionId && !newIds.has(legacyOrphanSessionId)) {
        removedSessionIds.push(legacyOrphanSessionId);
    }

    try {
        setStatus("Saving...");
        const result = await saveEventWithSessions({ event, sessions, removedSessionIds });
        editingEventId = result.eventId;
        legacyOrphanSessionId = null;
        originalSessionIds = result.sessionIds;
        selectedSessionId = result.sessionIds[0] || null;

        const firstDate = sessions[0]?.date;
        if (firstDate) filterMonth.value = firstDate.slice(0, 7);

        await loadAndRender();
        setStatus(mode === "edit" ? "Event updated." : "Event saved.", "success");

        detailMode = "view";
        const savedEvent = await getEvent(result.eventId);
        const savedSessions = await getSessionsForEvent(result.eventId);
        viewEventCache = { event: { ...savedEvent, id: result.eventId }, sessions: savedSessions };
        selectedEventKey = result.eventId;
        renderEventView({
            event: viewEventCache.event,
            sessions: savedSessions,
            focusSessionId: selectedSessionId || savedSessions[0]?.id,
        });
    } catch (err) {
        console.error(err);
        setStatus(`Save failed: ${err.message}`, "error");
    }
}

async function onDeleteEvent() {
    if (!editingEventId) {
        if (legacyOrphanSessionId) {
            const session = currentSessions.find((s) => s.id === legacyOrphanSessionId);
            const booked = Number(session?.bookedSeats || 0);
            const msg = booked > 0
                ? `This session has ${booked} booked seat(s). Delete anyway?`
                : "Delete this session?";
            if (!confirm(msg)) return;
            try {
                await deleteSession(legacyOrphanSessionId);
                setDetailOpen(false);
                await loadAndRender();
                setStatus("Session deleted.", "success");
            } catch (err) {
                setStatus(`Delete failed: ${err.message}`, "error");
            }
        }
        return;
    }

    const sessions = await getSessionsForEvent(editingEventId);
    const totalBooked = sessions.reduce((n, s) => n + Number(s.bookedSeats || 0), 0);
    const msg = totalBooked > 0
        ? `This event has ${totalBooked} booked seat(s) across ${sessions.length} session(s). Delete anyway?`
        : `Delete this event and ${sessions.length} session(s)?`;
    if (!confirm(msg)) return;

    try {
        await deleteEventWithSessions(editingEventId);
        setDetailOpen(false);
        await loadAndRender();
        setStatus("Event deleted.", "success");
    } catch (err) {
        setStatus(`Delete failed: ${err.message}`, "error");
    }
}

sessionsTbody.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id], tr[data-event-key]");
    if (!row) return;
    if (listGrouping === "events" && row.dataset.eventKey) {
        openViewForEventKey(row.dataset.eventKey);
        return;
    }
    if (row.dataset.id) {
        openViewForSession(row.dataset.id);
    }
});

calendarGrid.addEventListener("click", (e) => {
    const sessionBtn = e.target.closest("[data-session-id]");
    if (sessionBtn) {
        openViewForSession(sessionBtn.dataset.sessionId);
        return;
    }
    const moreBtn = e.target.closest(".day-event-more[data-date]");
    if (moreBtn) {
        const date = moreBtn.dataset.date;
        const firstOnDay = currentSessions
            .filter((s) => s.date === date)
            .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
        if (firstOnDay) openViewForSession(firstOnDay.id);
        return;
    }
    const day = e.target.closest(".day-card.empty[data-date]");
    if (day) {
        openAddEvent(day.dataset.date);
    }
});

calendarGrid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const day = e.target.closest(".day-card.empty[data-date]");
    if (day) {
        e.preventDefault();
        openAddEvent(day.dataset.date);
    }
});

$("addEventBtn").addEventListener("click", () => openAddEvent());
$("detailCloseBtn").addEventListener("click", () => setDetailOpen(false));
detailModalBackdrop.addEventListener("click", () => setDetailOpen(false));
$("refreshBtn").addEventListener("click", loadAndRender);
filterMonth.addEventListener("change", loadAndRender);
filterEventType.addEventListener("input", loadAndRender);
filterStatus.addEventListener("change", loadAndRender);
searchInput.addEventListener("input", loadAndRender);

document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => setViewMode(btn.dataset.view));
});

listGroupToggle?.querySelectorAll(".list-group-btn").forEach((btn) => {
    btn.addEventListener("click", () => setListGrouping(btn.dataset.group));
});

$("prevMonthBtn").addEventListener("click", () => {
    const [y, m] = filterMonth.value.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    filterMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    loadAndRender();
});
$("nextMonthBtn").addEventListener("click", () => {
    const [y, m] = filterMonth.value.split("-").map(Number);
    const d = new Date(y, m, 1);
    filterMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    loadAndRender();
});

window.addEventListener("resize", () => {
    if (!detailOpen) return;
    const mobile = isMobile();
    document.body.classList.toggle("split-active", !mobile);
    document.body.classList.toggle("detail-modal-open", mobile);
    detailModalBackdrop.classList.toggle("hidden", !mobile);
});

setDefaultMonthAndDate();
setViewMode("list");
setListGrouping("events");
loadAndRender();
