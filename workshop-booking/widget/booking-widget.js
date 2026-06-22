import { listBookableSessions } from "./sessions-storefront.js";
import {
    buildCartProperties,
    addSessionToCart,
    redirectToCart,
} from "./cart-bridge.js";
import { formatSessionDate, formatTimeRange, remainingSeats } from "../js/session-utils.js";

function escapeHtml(s) {
    return String(s || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function uniqueDates(sessions) {
    return [...new Set(sessions.map((s) => s.date))].sort();
}

function formatChipDate(dateIso) {
    const [y, mo, d] = dateIso.split("-").map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString("en-PH", {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

/**
 * @param {HTMLElement} root
 */
export async function mountWorkshopBookingWidget(root) {
    if (!root || root.dataset.wbMounted === "true") return;
    root.dataset.wbMounted = "true";

    const variantId = root.dataset.variantId || "";
    const eventName = root.dataset.eventName || "";
    const eventId = root.dataset.eventId || "";
    const demoMode = root.dataset.demo === "true" || !variantId;

    root.innerHTML = `<p class="wb-loading">Loading sessions…</p>`;

    let sessions = [];
    try {
        sessions = await listBookableSessions({ eventName, eventId });
    } catch (err) {
        console.error(err);
        root.innerHTML = `<p class="wb-error">Could not load sessions. ${escapeHtml(err.message)}</p>`;
        return;
    }

    if (!sessions.length) {
        root.innerHTML = `<p class="wb-empty">No upcoming sessions available. Check back soon.</p>`;
        return;
    }

    const dates = uniqueDates(sessions);
    let selectedDate = dates[0];
    let selectedSessionId = sessions.find((s) => s.date === selectedDate)?.id || "";

    function sessionsForDate(date) {
        return sessions.filter((s) => s.date === date);
    }

    function selectedSession() {
        return sessions.find((s) => s.id === selectedSessionId) || null;
    }

    function render() {
        const dateSessions = sessionsForDate(selectedDate);
        if (!dateSessions.some((s) => s.id === selectedSessionId)) {
            selectedSessionId = dateSessions[0]?.id || "";
        }

        const dateChips = dates.map((date) => {
            const sel = date === selectedDate ? " is-selected" : "";
            return `<button type="button" class="wb-chip${sel}" data-date="${escapeHtml(date)}">${escapeHtml(formatChipDate(date))}</button>`;
        }).join("");

        const slotButtons = dateSessions.map((s) => {
            const rem = remainingSeats(s);
            const sel = s.id === selectedSessionId ? " is-selected" : "";
            return `<button type="button" class="wb-slot${sel}" data-session-id="${escapeHtml(s.id)}">
  <span class="wb-slot-time">${escapeHtml(formatTimeRange(s.startTime, s.endTime))}</span>
  <span class="wb-slot-seats">${rem} left</span>
</button>`;
        }).join("");

        root.innerHTML = `
<div class="wb-panel">
  <h3 class="wb-title">Select your session</h3>
  <div class="wb-field">
    <label>Date</label>
    <div class="wb-chip-row" role="listbox" aria-label="Session date">${dateChips}</div>
  </div>
  <div class="wb-field">
    <label>Time</label>
    <div class="wb-slot-list" role="listbox" aria-label="Session time">${slotButtons}</div>
  </div>
  <div class="wb-field">
    <label for="wb-participant-name">Participant name</label>
    <input type="text" id="wb-participant-name" name="participant_name" autocomplete="name" required placeholder="Full name" />
  </div>
  <div class="wb-field">
    <label for="wb-participant-email">Email</label>
    <input type="email" id="wb-participant-email" name="participant_email" autocomplete="email" required placeholder="you@example.com" />
  </div>
  <div class="wb-field">
    <label for="wb-participant-phone">Phone</label>
    <input type="tel" id="wb-participant-phone" name="participant_phone" autocomplete="tel" placeholder="09xx xxx xxxx" />
  </div>
  <div class="wb-actions">
    <button type="button" class="wb-submit" id="wb-submit-btn">${demoMode ? "Preview booking" : "Add to cart"}</button>
    <p class="wb-hint" id="wb-selection-hint"></p>
    <p class="wb-status" id="wb-status" hidden></p>
  </div>
</div>`;

        root.querySelectorAll(".wb-chip[data-date]").forEach((btn) => {
            btn.addEventListener("click", () => {
                selectedDate = btn.dataset.date;
                render();
            });
        });

        root.querySelectorAll(".wb-slot[data-session-id]").forEach((btn) => {
            btn.addEventListener("click", () => {
                selectedSessionId = btn.dataset.sessionId;
                render();
            });
        });

        updateHint();
        root.querySelector("#wb-submit-btn")?.addEventListener("click", onSubmit);
    }

    function setStatus(message, type = "") {
        const el = root.querySelector("#wb-status");
        if (!el) return;
        el.hidden = !message;
        el.textContent = message;
        el.className = "wb-status" + (type ? ` is-${type}` : "");
    }

    function updateHint() {
        const session = selectedSession();
        const hint = root.querySelector("#wb-selection-hint");
        if (!hint || !session) {
            if (hint) hint.textContent = "";
            return;
        }
        hint.textContent = `${formatSessionDate(session.date)} · ${formatTimeRange(session.startTime, session.endTime)}`;
    }

    async function onSubmit() {
        const session = selectedSession();
        if (!session) {
            setStatus("Pick a date and time.", "error");
            return;
        }

        const attendee = {
            name: root.querySelector("#wb-participant-name")?.value.trim() || "",
            email: root.querySelector("#wb-participant-email")?.value.trim() || "",
            phone: root.querySelector("#wb-participant-phone")?.value.trim() || "",
        };

        if (!attendee.name) {
            setStatus("Enter participant name.", "error");
            return;
        }
        if (!attendee.email) {
            setStatus("Enter email address.", "error");
            return;
        }

        const properties = buildCartProperties(session, attendee);
        const btn = root.querySelector("#wb-submit-btn");
        if (btn) btn.disabled = true;
        setStatus(demoMode ? "" : "Adding to cart…", "");

        try {
            if (demoMode) {
                console.log("Workshop booking preview", { variantId, properties });
                setStatus(`Preview: ${properties.Date} ${properties.Time} — check console for cart properties.`, "success");
                if (btn) btn.disabled = false;
                return;
            }

            await addSessionToCart({
                variantId,
                quantity: 1,
                properties,
            });
            setStatus("Added to cart. Redirecting…", "success");
            redirectToCart();
        } catch (err) {
            console.error(err);
            setStatus(err.message || "Could not add to cart.", "error");
            if (btn) btn.disabled = false;
        }
    }

    render();
}

function autoMount() {
    document.querySelectorAll("[data-workshop-booking]").forEach((el) => {
        mountWorkshopBookingWidget(el);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
} else {
    autoMount();
}
