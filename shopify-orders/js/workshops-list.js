/**
 * Workshop Management — list all workshop days (event + date).
 */

import { formatWorkshopDisplayName } from "./registration-core.mjs";
import { hasOrdersApi } from "./orders-api-host.js";

const PAGE_SIZE = 10;

const els = {
    status: document.getElementById("statusBar"),
    rangeToggle: document.getElementById("rangeToggle"),
    tbody: document.getElementById("workshopsBody"),
    cardList: document.getElementById("workshopsCardList"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    pageIndicator: document.getElementById("pageIndicator"),
};

const state = {
    range: "upcoming",
    offset: 0,
    total: 0,
    sessions: [],
    loading: false,
};

function isLiveHost() {
    return hasOrdersApi();
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function setStatus(msg, isError = false) {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", Boolean(isError));
}

function rosterUrl(session) {
    const qs = new URLSearchParams({
        event_id: session.eventId,
        session_date: session.sessionDateIso,
    });
    qs.set("v", "54");
    return `workshop.html?${qs.toString()}`;
}

function formatTimes(timeLabels) {
    const labels = (timeLabels || []).filter(Boolean);
    return labels.length ? labels.join(", ") : "—";
}

function renderWorkshopRow(s) {
    const href = rosterUrl(s);
    const workshop = formatWorkshopDisplayName(
        s.workshopDisplay || "Workshop"
    );
    const times = formatTimes(s.timeLabels);
    const noBooking =
        s.noBookingCount > 0 ? String(s.noBookingCount) : "—";

    const location = (s.location || "").trim() || "—";

    return `<tr class="workshops-row" data-href="${escapeHtml(href)}" tabindex="0" role="link">
        <td class="col-date">${escapeHtml(s.dateLabel || s.sessionDateIso)}</td>
        <td class="col-workshop">${escapeHtml(workshop)}</td>
        <td class="col-location">${escapeHtml(location)}</td>
        <td class="col-times">${escapeHtml(times)}</td>
        <td class="col-seats">${escapeHtml(String(s.seatCount ?? 0))}</td>
        <td class="col-nobooking">${escapeHtml(noBooking)}</td>
    </tr>`;
}

function renderWorkshopCard(s) {
    const href = rosterUrl(s);
    const workshop = formatWorkshopDisplayName(
        s.workshopDisplay || "Workshop"
    );
    const times = formatTimes(s.timeLabels);
    const noBooking =
        s.noBookingCount > 0
            ? `<span class="workshops-card__nobooking">${escapeHtml(String(s.noBookingCount))} no booking</span>`
            : "";

    const location = (s.location || "").trim();
    const locationLine = location
        ? `<p class="entity-card__sub workshops-card__location">${escapeHtml(location)}</p>`
        : "";

    return `<article class="entity-card workshops-card" data-href="${escapeHtml(href)}" tabindex="0" role="link">
        <div class="entity-card__head">
            <span class="entity-card__title">${escapeHtml(s.dateLabel || s.sessionDateIso)}</span>
            <span class="workshops-card__seats">${escapeHtml(String(s.seatCount ?? 0))} registered</span>
        </div>
        <p class="entity-card__primary">${escapeHtml(workshop)}</p>
        ${locationLine}
        <p class="entity-card__sub">${escapeHtml(times)}</p>
        ${noBooking}
    </article>`;
}

function bindRowNavigation(root) {
    root.querySelectorAll("[data-href]").forEach((el) => {
        const href = el.getAttribute("data-href");
        if (!href) return;
        const go = () => {
            window.location.href = href;
        };
        el.addEventListener("click", go);
        el.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                go();
            }
        });
    });
}

function updatePagination() {
    const page = Math.floor(state.offset / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    els.pageIndicator.textContent = `Page ${page} of ${totalPages}`;
    els.btnPrev.disabled = state.offset <= 0 || state.loading;
    els.btnNext.disabled =
        state.offset + PAGE_SIZE >= state.total || state.loading;
}

function renderList() {
    if (!state.sessions.length) {
        const emptyMsg =
            state.range === "past"
                ? "No past workshops in this range."
                : "No upcoming workshops found.";
        els.tbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(emptyMsg)}</td></tr>`;
        if (els.cardList) {
            els.cardList.innerHTML = `<p class="entity-card-empty muted">${escapeHtml(emptyMsg)}</p>`;
        }
        updatePagination();
        return;
    }

    const html = state.sessions.map(renderWorkshopRow).join("");
    els.tbody.innerHTML = html;
    bindRowNavigation(els.tbody);

    if (els.cardList) {
        els.cardList.innerHTML = state.sessions.map(renderWorkshopCard).join("");
        bindRowNavigation(els.cardList);
    }

    updatePagination();
}

async function loadSessions() {
    if (!isLiveHost()) {
        setStatus("Orders API is not available on this site.", true);
        return;
    }

    state.loading = true;
    updatePagination();
    setStatus("Loading workshops…");

    try {
        const qs = new URLSearchParams({
            range: state.range,
            limit: String(PAGE_SIZE),
            offset: String(state.offset),
        });
        const res = await fetch(`/api/workshop-sessions?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || res.statusText || "Request failed");
        }

        state.sessions = data.sessions || [];
        state.total = data.total ?? state.sessions.length;
        const scan = data.scan || {};
        const scanNote =
            scan.orderLookbackDays != null
                ? ` · orders from last ${scan.orderLookbackDays} days`
                : "";
        setStatus(
            state.total
                ? `${state.total} workshop${state.total === 1 ? "" : "s"}${scanNote}`
                : scan.orderLookbackDays != null
                  ? `No matches in orders from last ${scan.orderLookbackDays} days`
                  : ""
        );
        renderList();
    } catch (e) {
        setStatus(e.message || String(e), true);
        els.tbody.innerHTML = "";
        if (els.cardList) els.cardList.innerHTML = "";
    } finally {
        state.loading = false;
        updatePagination();
    }
}

function setRange(range) {
    state.range = range === "past" ? "past" : "upcoming";
    state.offset = 0;
    els.rangeToggle?.querySelectorAll(".type-btn").forEach((btn) => {
        btn.classList.toggle(
            "active",
            btn.getAttribute("data-range") === state.range
        );
    });
    loadSessions();
}

function init() {
    els.rangeToggle?.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".type-btn[data-range]");
        if (!btn) return;
        setRange(btn.getAttribute("data-range"));
    });

    els.btnPrev?.addEventListener("click", () => {
        if (state.offset <= 0) return;
        state.offset = Math.max(0, state.offset - PAGE_SIZE);
        loadSessions();
    });

    els.btnNext?.addEventListener("click", () => {
        if (state.offset + PAGE_SIZE >= state.total) return;
        state.offset += PAGE_SIZE;
        loadSessions();
    });

    loadSessions();
}

init();
