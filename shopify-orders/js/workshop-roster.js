/**
 * Workshop Management — one table per day, session time column, grouped sort.
 */

import {
    extractWorkshopLocation,
    formatWorkshopDisplayName,
    normalizeOrderSeatLabels,
    parseTimeSortKey,
} from "./registration-core.mjs";
import { hasOrdersApi } from "./orders-api-host.js";
import {
    canCancelOrder,
    confirmCancelOrder,
    postCancelOrder,
} from "./order-cancel.js";
import { showConfirmDialog } from "./confirm-dialog.js";
import { paidIconHtml, paymentCellHtml } from "./payment-method.js";
import {
    applyNameOverrides,
    certificateParticipantNames,
    seatNameKey,
} from "./workshop-certificate-core.mjs";
import { downloadWorkshopCertificatesPdf } from "./workshop-certificates.js?v=2";
import {
    loadWorkshopRosterMeta,
    saveWorkshopRosterMeta,
} from "./workshop-roster-meta.js";

const params = new URLSearchParams(window.location.search);
const eventId = (params.get("event_id") || "").trim();
const sessionDate = (params.get("session_date") || "").trim();
const fromOrder = (params.get("from_order") || "").trim();

const els = {
    status: document.getElementById("statusBar"),
    btnBackShopify: document.getElementById("btnBackShopify"),
    workshopInfoBar: document.getElementById("workshopInfoBar"),
    infoWorkshop: document.getElementById("infoWorkshop"),
    infoDate: document.getElementById("infoDate"),
    tbody: document.getElementById("rosterBody"),
    rosterCardList: document.getElementById("rosterCardList"),
    table: document.getElementById("rosterTable"),
    btnExportExcel: document.getElementById("btnExportExcel"),
    btnDownloadCertificates: document.getElementById("btnDownloadCertificates"),
    btnGoogleSheet: document.getElementById("btnGoogleSheet"),
    participantModal: document.getElementById("participantModal"),
    participantModalBackdrop: document.getElementById("participantModalBackdrop"),
    participantModalHeader: document.getElementById("participantModalHeader"),
    participantModalBody: document.getElementById("participantModalBody"),
};

const SESSION_PILL_PALETTE = [
    "session-pill--slot-a",
    "session-pill--slot-b",
    "session-pill--slot-c",
    "session-pill--slot-d",
];

const state = {
    sessions: [],
    day: null,
    rows: [],
    shopHandle: null,
    sortKey: null,
    sortDir: null,
    sessionPillClasses: new Map(),
    selectedRowKey: null,
    sheet: { configured: false, exists: false, url: null },
    meta: { venue: "", names: {} },
    certificatesBusy: false,
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

function parseOrderNum(name) {
    const m = String(name || "").match(/#(\d+)/i);
    return m ? Number(m[1]) : 0;
}

function adminOrderUrl(orderId) {
    if (!state.shopHandle || !orderId) return null;
    return `https://admin.shopify.com/store/${state.shopHandle}/orders/${orderId}`;
}

function shopifyDashboardOrderUrl(orderId) {
    return `/shopify/index.html?order=${encodeURIComponent(orderId)}`;
}

function sortHeaderArrow(dir) {
    return dir === "asc" ? "▴" : "▾";
}

function flattenParticipants(sessions) {
    const rows = [];
    for (const session of sessions) {
        const timeLabel =
            session.timeLabel ||
            [session.startTime, session.endTime].filter(Boolean).join(" – ") ||
            "Session";
        const sessionSortKey = parseTimeSortKey(session.startTime);
        for (const p of session.participants || []) {
            rows.push({
                ...p,
                timeLabel,
                sessionSortKey,
                sessionKey: session.sessionKey,
            });
        }
    }
    return rows;
}

function buildSessionPillClasses(sessions) {
    const map = new Map();
    sessions.forEach((session, index) => {
        const key = session.sessionKey || String(index);
        map.set(key, SESSION_PILL_PALETTE[index % SESSION_PILL_PALETTE.length]);
    });
    return map;
}

function sessionPillClass(sessionKey) {
    return (
        state.sessionPillClasses.get(sessionKey) ||
        SESSION_PILL_PALETTE[0]
    );
}

function orderGroupKey(row) {
    return `${row.sessionKey}|${row.orderId}`;
}

function applyOrderSeatLabels(rows) {
    normalizeOrderSeatLabels(rows, orderGroupKey);
}

function groupRowsByOrder(rows) {
    const map = new Map();
    for (const row of rows) {
        const key = orderGroupKey(row);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
    }
    return [...map.values()];
}

/** Primary seat on top, grey follower seats directly below within the same order. */
function sortOrderGroupInternally(group) {
    group.sort((a, b) => {
        if (Boolean(a.isSeatFollower) !== Boolean(b.isSeatFollower)) {
            return a.isSeatFollower ? 1 : -1;
        }
        return (a.seatIndex ?? 0) - (b.seatIndex ?? 0);
    });
}

function primarySeatRow(group) {
    return (
        group.find((r) => !r.isSeatFollower) ||
        group.find((r) => (r.seatIndex ?? 0) === 1) ||
        group[0]
    );
}

function comparePrimaryRows(a, b, sortKey, sortDir) {
    const dir = sortDir === "asc" ? 1 : -1;

    if (sortKey === "timeLabel") {
        if (a.sessionSortKey !== b.sessionSortKey) {
            return (a.sessionSortKey - b.sessionSortKey) * dir;
        }
        return (parseOrderNum(b.orderName) - parseOrderNum(a.orderName)) * dir;
    }

    if (a.sessionSortKey !== b.sessionSortKey) {
        return a.sessionSortKey - b.sessionSortKey;
    }

    if (sortKey === "orderName") {
        const av = parseOrderNum(a.orderName);
        const bv = parseOrderNum(b.orderName);
        return (av - bv) * dir;
    }
    if (sortKey === "seatLabel") {
        const av = a.seatTotal ?? a.seatIndex ?? 0;
        const bv = b.seatTotal ?? b.seatIndex ?? 0;
        if (av !== bv) return (av - bv) * dir;
        return parseOrderNum(b.orderName) - parseOrderNum(a.orderName);
    }
    let av = a[sortKey];
    let bv = b[sortKey];
    av = String(av ?? "").toLowerCase();
    bv = String(bv ?? "").toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return parseOrderNum(b.orderName) - parseOrderNum(a.orderName);
}

function comparePrimaryRowsDefault(a, b) {
    if (a.sessionSortKey !== b.sessionSortKey) {
        return a.sessionSortKey - b.sessionSortKey;
    }
    return parseOrderNum(b.orderName) - parseOrderNum(a.orderName);
}

/** Sort order groups as units; seat rows for one order always stay stacked. */
function sortRowsInPlace(rows, sortKey, sortDir) {
    const groups = groupRowsByOrder(rows);
    for (const group of groups) sortOrderGroupInternally(group);

    groups.sort((ga, gb) => {
        const a = primarySeatRow(ga);
        const b = primarySeatRow(gb);
        if (!sortKey) {
            if (a.sessionSortKey !== b.sessionSortKey) {
                return a.sessionSortKey - b.sessionSortKey;
            }
            return comparePrimaryRowsDefault(a, b);
        }
        return comparePrimaryRows(a, b, sortKey, sortDir);
    });

    rows.length = 0;
    rows.push(...groups.flat());
}

function updateSortHeaderIndicators() {
    document.querySelectorAll("#rosterTable th[data-sort]").forEach((th) => {
        const key = th.getAttribute("data-sort");
        const label =
            th.dataset.sortLabel ||
            th.textContent.replace(/\s*(?:▴|▾)\s*$/u, "").trim();
        th.dataset.sortLabel = label;
        if (state.sortKey === key) {
            th.textContent = `${label} ${sortHeaderArrow(state.sortDir)}`;
            th.setAttribute(
                "aria-sort",
                state.sortDir === "asc" ? "ascending" : "descending"
            );
            th.classList.add("th--sorted");
        } else {
            th.textContent = label;
            th.removeAttribute("aria-sort");
            th.classList.remove("th--sorted");
        }
    });
}

function assignSessionRowNumbers(rows) {
    let lastSession = null;
    let num = 0;
    for (const row of rows) {
        if (row.sessionKey !== lastSession) {
            lastSession = row.sessionKey;
            num = 0;
        }
        num += 1;
        row.rowNum = num;
    }
}

function participantRowKey(r) {
    return `${r.sessionKey}|${r.orderId}|${r.seatIndex ?? 0}`;
}

function passPillHtml(pass) {
    if (!pass) return "—";
    const tier = /premium/i.test(pass) ? "premium" : "basic";
    return `<span class="pass-pill" data-tier="${tier}">${escapeHtml(pass)}</span>`;
}

function editNameButtonHtml(r) {
    return `<button type="button" class="roster-edit-name" data-edit-name data-row-key="${escapeHtml(participantRowKey(r))}" title="Edit participant name" aria-label="Edit participant name">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    </button>`;
}

function participantNameHtml(r) {
    const edited = r.nameOverridden ? " roster-name-text--edited" : "";
    return `<span class="roster-name-cell">
        <span class="roster-name-text${edited}">${escapeHtml(r.participant || "—")}</span>
        ${editNameButtonHtml(r)}
    </span>`;
}

function renderSessionBadge(r) {
    if (r.noBooking) {
        return '<span class="roster-badge roster-badge--no-booking">No booking</span>';
    }
    if (r.timeLabel) {
        return `<span class="session-pill ${sessionPillClass(r.sessionKey)}">${escapeHtml(r.timeLabel)}</span>`;
    }
    return "—";
}

function renderParticipantCard(r) {
    const selected =
        state.selectedRowKey === participantRowKey(r)
            ? " entity-card--selected"
            : "";
    const contactLine = r.contact
        ? `<a href="tel:${escapeHtml(r.contact.replace(/[^\d+]/g, ""))}">${escapeHtml(r.contact)}</a>`
        : "—";
    const emailLine = r.email
        ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>`
        : "—";

    return `<article class="entity-card roster-card${r.isSeatFollower ? " roster-card--seat-follow" : ""}${r.noBooking ? " roster-card--no-booking" : ""}${selected}" data-order-id="${r.orderId}" data-row-key="${escapeHtml(participantRowKey(r))}" tabindex="0" role="button">
        <div class="entity-card__head">
            <span class="entity-card__title">${escapeHtml(r.orderName)}</span>
            ${renderSessionBadge(r)}
        </div>
        <p class="entity-card__primary">${participantNameHtml(r)}${r.pass ? ` ${passPillHtml(r.pass)}` : ""}</p>
        <p class="entity-card__sub">Seat ${escapeHtml(r.seatLabel || "1 of 1")} · #${escapeHtml(String(r.rowNum ?? ""))}</p>
        <div class="entity-card__detail-grid">
            <div><span class="entity-card__label">Contact</span>${contactLine}</div>
            <div><span class="entity-card__label">Email</span>${emailLine}</div>
        </div>
        <div class="entity-card__payment">
            ${paymentCellHtml(r.financialStatus, escapeHtml(r.paymentMethod || "—"))}
        </div>
    </article>`;
}

function renderParticipantRow(r) {
    const selected =
        state.selectedRowKey === participantRowKey(r) ? " roster-row--selected" : "";
    const orderCell = escapeHtml(r.orderName);
    const emailCell = r.email
        ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>`
        : "—";
    const contactCell = r.contact
        ? (() => {
              const tel = r.contact.replace(/[^\d+]/g, "");
              return tel
                  ? `<a href="tel:${escapeHtml(tel)}">${escapeHtml(r.contact)}</a>`
                  : escapeHtml(r.contact);
          })()
        : "—";
    const rowClass = r.isSeatFollower
        ? "roster-row roster-row--seat-follow"
        : "roster-row";
    return `<tr class="${rowClass}${selected}${r.noBooking ? " roster-row--no-booking" : ""}" data-order-id="${r.orderId}" data-row-key="${escapeHtml(participantRowKey(r))}" tabindex="0">
        <td class="col-num">${escapeHtml(String(r.rowNum ?? ""))}</td>
        <td class="col-session">${renderSessionBadge(r)}</td>
        <td class="col-order">${orderCell}</td>
        <td class="col-customer">${participantNameHtml(r)}</td>
        <td class="col-pass">${passPillHtml(r.pass)}</td>
        <td class="col-contact">${contactCell}</td>
        <td class="col-email">${emailCell}</td>
        <td class="col-items">${escapeHtml(r.seatLabel || "1 of 1")}</td>
        <td class="col-paid">${paidIconHtml(r.financialStatus)}</td>
        <td class="col-payment">${escapeHtml(r.paymentMethod || "—")}</td>
    </tr>`;
}

function renderWorkshopInfo(day) {
    if (!day) return;
    els.workshopInfoBar.hidden = false;
    els.infoWorkshop.textContent = formatWorkshopDisplayName(
        day.workshop || "Workshop"
    );
    els.infoDate.textContent = day.dateLabel || day.sessionDate || "";
}

function getSortedRows() {
    const rows = [...state.rows];
    sortRowsInPlace(rows, state.sortKey, state.sortDir);
    assignSessionRowNumbers(rows);
    return rows;
}

function renderTable() {
    const rows = getSortedRows();
    updateSortHeaderIndicators();

    if (!rows.length) {
        els.tbody.innerHTML =
            '<tr><td colspan="10" class="muted">No participants found for this day.</td></tr>';
        if (els.rosterCardList) {
            els.rosterCardList.innerHTML =
                '<p class="entity-card-empty muted">No participants found for this day.</p>';
        }
        return;
    }

    els.tbody.innerHTML = rows.map(renderParticipantRow).join("");
    if (els.rosterCardList) {
        els.rosterCardList.innerHTML = rows.map(renderParticipantCard).join("");
    }
}

const EXPORT_HEADERS = [
    "Order ID",
    "Name",
    "Checked-In",
    "Pass",
    "Email",
    "Contact Number",
    "Time Slot",
    "Milk Options",
    "Payment Method",
    "Notes",
];

function exportRowValues(r) {
    return [
        r.orderName || "",
        r.participant === "—" ? "" : r.participant || "",
        "",
        r.pass || "",
        r.email || "",
        r.contact || "",
        r.noBooking ? "" : r.timeLabel || "",
        r.milk || "",
        r.paymentMethod === "—" ? "" : r.paymentMethod || "",
        "",
    ];
}

function exportFileBase() {
    const name = formatWorkshopDisplayName(state.day?.workshop || "Workshop");
    const date = state.day?.dateLabel || state.day?.sessionDate || "";
    const raw = [name, date].filter(Boolean).join(" - ");
    return (raw || "workshop-roster").replace(/[\\/:*?"<>|]+/g, " ").trim();
}

function updateExportButton() {
    const hasRows = state.rows.length > 0;
    if (els.btnExportExcel) els.btnExportExcel.hidden = !hasRows;
    if (els.btnDownloadCertificates) {
        els.btnDownloadCertificates.hidden = !hasRows;
        els.btnDownloadCertificates.disabled = state.certificatesBusy;
    }
}

function suggestedVenue() {
    const saved = String(state.meta.venue || "").trim();
    if (saved) return saved;
    return extractWorkshopLocation(
        state.day?.workshop || "",
        state.day?.workshop || ""
    );
}

async function persistMeta() {
    try {
        await saveWorkshopRosterMeta(eventId, sessionDate, state.meta);
    } catch (e) {
        setStatus(e.message || "Saved on this device only. Cloud save failed.", true);
    }
}

async function handleEditName(row) {
    if (!row) return;
    const current = String(row.participant || "").trim();
    const original = String(row.originalParticipant || row.participant || "").trim();
    const result = await showConfirmDialog({
        title: "Edit participant name",
        message: "This name is used on the roster and certificates. Leave blank to restore the original booking name.",
        confirmLabel: "Save",
        cancelLabel: "Cancel",
        input: {
            label: "Participant name",
            value: current === "—" ? "" : current,
            placeholder: original === "—" ? "Full name" : original,
        },
    });
    if (!result.confirmed) return;

    const next = String(result.value || "").trim();
    const key = seatNameKey(row.orderId, row.seatIndex);
    if (!next || next === original) {
        delete state.meta.names[key];
    } else {
        state.meta.names[key] = next;
    }
    applyNameOverrides(state.rows, state.meta.names);
    renderTable();
    if (state.selectedRowKey === participantRowKey(row)) {
        const updated = state.rows.find((r) => participantRowKey(r) === state.selectedRowKey);
        if (updated) openParticipantModal(updated);
    }
    await persistMeta();
    backgroundSyncSheet();
}

async function handleDownloadCertificates() {
    if (state.certificatesBusy) return;
    const rows = getSortedRows();
    const names = certificateParticipantNames(rows);
    if (!names.length) {
        setStatus("No participant names to print.", true);
        return;
    }

    const result = await showConfirmDialog({
        title: "Download certificates",
        message: `This will create a PDF with ${names.length} certificate${names.length === 1 ? "" : "s"}.`,
        confirmLabel: "Download PDF",
        cancelLabel: "Cancel",
        input: {
            label: "Full venue",
            value: suggestedVenue(),
            placeholder: formatWorkshopDisplayName(state.day?.workshop || "") ||
                "e.g. Marikina Sports Center, Marikina City",
            hint: "Printed on every certificate. Include the place name and city.",
        },
    });
    if (!result.confirmed) return;

    const venue = String(result.value || "").trim();
    if (!venue) {
        setStatus("Enter the full venue before downloading certificates.", true);
        return;
    }

    state.meta.venue = venue;
    await persistMeta();

    const btn = els.btnDownloadCertificates;
    const originalLabel = btn?.textContent || "Download Certificates";
    state.certificatesBusy = true;
    updateExportButton();
    setStatus("Generating certificates…");
    try {
        await downloadWorkshopCertificatesPdf({
            names,
            dateIso: sessionDate,
            venue,
            fileBase: `Certificates - ${exportFileBase()}`,
            onProgress: (i, total) => {
                if (btn) btn.textContent = `Generating ${i}/${total}…`;
                setStatus(`Generating certificate ${i} of ${total}…`);
            },
        });
        setStatus("");
    } catch (e) {
        setStatus(e.message || String(e), true);
    } finally {
        state.certificatesBusy = false;
        if (btn) btn.textContent = originalLabel;
        updateExportButton();
    }
}

function exportToExcel() {
    if (typeof XLSX === "undefined") {
        setStatus("Excel export library not loaded. Check your connection.", true);
        return;
    }
    const rows = getSortedRows();
    if (!rows.length) {
        setStatus("Nothing to export for this day.", true);
        return;
    }

    const aoa = [EXPORT_HEADERS, ...rows.map(exportRowValues)];
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet["!cols"] = [
        { wch: 10 },
        { wch: 24 },
        { wch: 10 },
        { wch: 14 },
        { wch: 30 },
        { wch: 16 },
        { wch: 16 },
        { wch: 12 },
        { wch: 16 },
        { wch: 20 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Roster");
    XLSX.writeFile(workbook, `${exportFileBase()}.xlsx`);
}

function sheetDayParams() {
    return new URLSearchParams({
        event_id: eventId,
        session_date: sessionDate,
    });
}

function updateGoogleSheetButton() {
    const btn = els.btnGoogleSheet;
    if (!btn) return;
    if (!state.sheet.configured || !state.rows.length) {
        btn.hidden = true;
        return;
    }
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = state.sheet.exists
        ? "Open Google Sheet"
        : "Export to Google Sheets";
}

async function fetchSheetInfo() {
    state.sheet = { configured: false, exists: false, url: null };
    if (!isLiveHost() || !eventId || !sessionDate) return;
    try {
        const res = await fetch(`/api/workshop-sheet?${sheetDayParams()}`);
        if (!res.ok) return;
        const info = await res.json();
        state.sheet = {
            configured: Boolean(info.configured),
            exists: Boolean(info.exists),
            url: info.url || null,
        };
    } catch (_) {
        /* leave defaults */
    }
}

/** Fire-and-forget refresh so the sheet reflects the current roster on view. */
function backgroundSyncSheet() {
    if (!state.sheet.configured || !state.sheet.exists) return;
    fetch(`/api/workshop-sheet/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, session_date: sessionDate }),
    }).catch(() => {});
}

async function handleGoogleSheetClick() {
    const btn = els.btnGoogleSheet;
    if (state.sheet.exists && state.sheet.url) {
        window.open(state.sheet.url, "_blank", "noopener");
        return;
    }
    btn.disabled = true;
    btn.textContent = "Creating sheet…";
    setStatus("Creating Google Sheet…");
    try {
        const res = await fetch(`/api/workshop-sheet/export`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event_id: eventId, session_date: sessionDate }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || "Export failed");
        }
        state.sheet.exists = true;
        state.sheet.url = data.url || null;
        setStatus("");
        updateGoogleSheetButton();
        if (data.url) window.open(data.url, "_blank", "noopener");
    } catch (e) {
        setStatus(e.message || String(e), true);
    } finally {
        btn.disabled = false;
        updateGoogleSheetButton();
    }
}

function closeParticipantModal() {
    state.selectedRowKey = null;
    document.body.classList.remove("detail-modal-open");
    if (els.participantModalBackdrop) {
        els.participantModalBackdrop.classList.add("hidden");
        els.participantModalBackdrop.setAttribute("aria-hidden", "true");
    }
    if (els.participantModal) {
        els.participantModal.classList.add("hidden");
    }
    renderTable();
}

function openParticipantModal(r) {
    state.selectedRowKey = participantRowKey(r);
    renderTable();

    const dashboardUrl = shopifyDashboardOrderUrl(r.orderId);
    const shopifyUrl = adminOrderUrl(r.orderId);
    const contactLine = r.contact
        ? `<a href="tel:${escapeHtml(r.contact.replace(/[^\d+]/g, ""))}">${escapeHtml(r.contact)}</a>`
        : "—";
    const emailLine = r.email
        ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>`
        : "—";

    els.participantModalHeader.innerHTML = `
        <div class="detail-header-main">
            <div class="detail-header-text">
                <h2 class="detail-order-name">${escapeHtml(r.participant || "—")}</h2>
                <p class="detail-meta">${escapeHtml(r.orderName)} · ${escapeHtml(r.timeLabel || "")}</p>
            </div>
            <button type="button" class="detail-close-btn" id="btnParticipantClose" aria-label="Close">×</button>
        </div>`;

    const showCancel = canCancelOrder({
        financial_status: r.financialStatus,
        cancelled_at: r.cancelledAt,
        type: "workshop",
    });

    els.participantModalBody.innerHTML = `
        <section class="detail-card">
            <div class="entity-card__detail-grid entity-card__detail-grid--modal">
                <div><span class="entity-card__label">Seat</span><p>${escapeHtml(r.seatLabel || "1 of 1")}</p></div>
                <div><span class="entity-card__label">Pass</span><p>${r.pass ? escapeHtml(r.pass) : "—"}</p></div>
                <div><span class="entity-card__label">Payment</span><p>${paymentCellHtml(r.financialStatus, escapeHtml(r.paymentMethod || "—"))}</p></div>
                <div><span class="entity-card__label">Contact</span><p>${contactLine}</p></div>
                <div><span class="entity-card__label">Email</span><p>${emailLine}</p></div>
            </div>
            <div class="detail-actions detail-actions--stack">
                <button type="button" class="action-btn secondary" id="btnEditParticipantName">Edit name</button>
                <a class="action-btn primary" href="${escapeHtml(dashboardUrl)}">Open full order</a>
                ${shopifyUrl ? `<a class="action-btn secondary" href="${escapeHtml(shopifyUrl)}" target="_blank" rel="noopener">Open in Shopify</a>` : ""}
                ${showCancel ? `<div class="detail-cancel-row"><button type="button" class="detail-cancel-link" id="btnCancelRegistration">Cancel registration</button></div>` : ""}
            </div>
        </section>`;

    document.getElementById("btnParticipantClose")?.addEventListener("click", closeParticipantModal);
    document.getElementById("btnEditParticipantName")?.addEventListener("click", () => {
        handleEditName(r);
    });
    document.getElementById("btnCancelRegistration")?.addEventListener("click", async () => {
        const choice = await confirmCancelOrder({
            type: "workshop",
            financialStatus: r.financialStatus,
        });
        if (!choice) {
            return;
        }
        try {
            setStatus("");
            await postCancelOrder(r.orderId, { refund: choice.refund });
            closeParticipantModal();
            await loadWorkshopDay();
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    });

    document.body.classList.add("detail-modal-open");
    if (els.participantModalBackdrop) {
        els.participantModalBackdrop.classList.remove("hidden");
        els.participantModalBackdrop.setAttribute("aria-hidden", "false");
    }
    els.participantModal?.classList.remove("hidden");
}

function openParticipantFromTarget(target) {
    const el = target.closest("[data-row-key]");
    if (!el) return;
    const key = el.getAttribute("data-row-key");
    const row = state.rows.find((r) => participantRowKey(r) === key);
    if (!row) return;
    openParticipantModal(row);
}

function setupSortHeaders() {
    els.table.querySelectorAll("th[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
            const k = th.getAttribute("data-sort");
            if (state.sortKey === k) {
                state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
            } else {
                state.sortKey = k;
                state.sortDir =
                    k === "orderName" || k === "timeLabel" ? "desc" : "asc";
            }
            renderTable();
        });
    });
}

function setupRowClicks() {
    const activate = (ev) => {
        if (ev.type === "keydown" && ev.key !== "Enter") return;
        if (ev.target.closest("[data-edit-name]")) return;
        openParticipantFromTarget(ev.target);
    };
    const onEditClick = (ev) => {
        const btn = ev.target.closest("[data-edit-name]");
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        const key = btn.getAttribute("data-row-key");
        const row = state.rows.find((r) => participantRowKey(r) === key);
        handleEditName(row);
    };
    els.tbody.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-edit-name]")) {
            onEditClick(ev);
            return;
        }
        if (ev.target.closest("a")) return;
        activate(ev);
    });
    els.tbody.addEventListener("keydown", activate);
    if (els.rosterCardList) {
        els.rosterCardList.addEventListener("click", (ev) => {
            if (ev.target.closest("[data-edit-name]")) {
                onEditClick(ev);
                return;
            }
            if (ev.target.closest("a")) return;
            activate(ev);
        });
        els.rosterCardList.addEventListener("keydown", activate);
    }
}

function setupParticipantModalBackdrop() {
    els.participantModalBackdrop?.addEventListener("click", () => {
        if (state.selectedRowKey) closeParticipantModal();
    });
    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && state.selectedRowKey) {
            closeParticipantModal();
        }
    });
}

async function fetchConfig() {
    if (!isLiveHost()) return;
    try {
        const res = await fetch("/api/config");
        if (!res.ok) return;
        const cfg = await res.json();
        if (cfg.shop) state.shopHandle = cfg.shop;
    } catch (_) {
        /* ignore */
    }
}

async function loadWorkshopDay() {
    if (!isLiveHost()) {
        setStatus("Orders API is not available on this site.", true);
        return;
    }
    if (!eventId || !sessionDate) {
        setStatus("Missing event_id or session_date in URL.", true);
        return;
    }

    setStatus("Loading participants…");

    try {
        const qs = new URLSearchParams({
            event_id: eventId,
            session_date: sessionDate,
        });
        const res = await fetch(`/api/workshop-roster?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || res.statusText || "Request failed");
        }

        state.sessions = data.sessions || [];
        state.day = data.day || null;
        state.sessionPillClasses = buildSessionPillClasses(state.sessions);
        state.rows = flattenParticipants(state.sessions);
        applyOrderSeatLabels(state.rows);
        state.sortKey = null;
        state.sortDir = null;

        renderWorkshopInfo(state.day);
        setStatus("");
        renderTable();
        updateExportButton();

        const loaded = await loadWorkshopRosterMeta(eventId, sessionDate);
        state.meta = {
            venue: state.meta.venue || loaded.venue,
            names: { ...loaded.names, ...state.meta.names },
        };
        applyNameOverrides(state.rows, state.meta.names);
        renderTable();

        await fetchSheetInfo();
        updateGoogleSheetButton();
        backgroundSyncSheet();
    } catch (e) {
        setStatus(e.message || String(e), true);
        els.tbody.innerHTML = "";
        updateExportButton();
        updateGoogleSheetButton();
    }
}

function initBackLink() {
    if (fromOrder) {
        els.btnBackShopify.href = shopifyDashboardOrderUrl(fromOrder);
    }
}

async function boot() {
    initBackLink();
    setupSortHeaders();
    setupRowClicks();
    setupParticipantModalBackdrop();
    els.btnExportExcel?.addEventListener("click", exportToExcel);
    els.btnDownloadCertificates?.addEventListener("click", handleDownloadCertificates);
    els.btnGoogleSheet?.addEventListener("click", handleGoogleSheetClick);
    await fetchConfig();
    await loadWorkshopDay();
}

boot();
