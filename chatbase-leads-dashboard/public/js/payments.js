import { deletePaymentIntakes, listPaymentIntakes } from "./api.js";
import { openConversationInInbox } from "./conversation-view.js";
import { formatLeadActivityDate, formatPesoAmount, orderNumberSearchTerms } from "./format.js";
import { clearPanelLoadState, setPanelBusy, setPanelLoading } from "./panel-loading.js";

const PAGE_SIZE = 20;
const LIST_COLSPAN = 6;
const PAYMENTS_FILTERS_STORAGE_KEY = "chatbase_payments_filters";

const panelPayments = document.getElementById("panel-payments");
const form = document.getElementById("payments-filters-form");
const resetBtn = document.getElementById("payments-reset-filters-btn");
const loadBtn = document.getElementById("payments-load-btn");
const tbody = document.getElementById("payments-tbody");
const splitView = document.getElementById("payments-split-view");
const countEl = document.getElementById("payments-count");
const pagePrevBtns = document.querySelectorAll(".payments-page-prev");
const pageNextBtns = document.querySelectorAll(".payments-page-next");
const pageInfoEls = document.querySelectorAll(".payments-page-info");
const detailEmptyEl = document.getElementById("payments-detail-empty");
const detailContentEl = document.getElementById("payments-detail-content");
const detailOrderEl = document.getElementById("payments-detail-order");
const detailStatusBadgeEl = document.getElementById("payments-detail-status-badge");
const detailFieldsEl = document.getElementById("payments-detail-fields");
const viewConversationBtn = document.getElementById("payments-view-conversation");
const viewShopifyBtn = document.getElementById("payments-view-shopify");
const deleteBtn = document.getElementById("payments-delete");
const detailCloseBtn = document.getElementById("payments-detail-close");

let allPayments = [];
let currentPage = 1;
let paymentsLoaded = false;
let selectedPaymentId = null;
let paymentsLoadGeneration = 0;

function statusLabel(status) {
  const map = {
    marked_paid: "Marked as paid",
    already_paid: "Already paid",
    mark_failed: "Could not apply"
  };
  return map[status] || status || "—";
}

function statusClass(status) {
  return `payment-status--${String(status || "unknown").replace(/_/g, "-")}`;
}

function setCountMessage(text, isError = false) {
  if (!countEl) return;
  countEl.textContent = text;
  countEl.classList.toggle("count-error", isError);
}

function readFiltersFromForm() {
  return {
    status: document.getElementById("payments-filter-status")?.value || "",
    search: document.getElementById("payments-filter-search")?.value?.trim() || "",
    startDate: document.getElementById("payments-filter-start-date")?.value || "",
    endDate: document.getElementById("payments-filter-end-date")?.value || ""
  };
}

function getFilteredPayments() {
  const { status, search } = readFiltersFromForm();
  let rows = [...allPayments];
  if (status) {
    rows = rows.filter((r) => r.status === status);
  }
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) => {
      const hay = [
        r.shopifyOrderName,
        r.orderNumber,
        r.clientName,
        r.referenceNumber,
        r.paymentMethod
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return rows;
}

function updatePaginationUi(total) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const label = `Page ${currentPage} of ${totalPages}`;
  pageInfoEls.forEach((el) => {
    el.textContent = label;
  });
  const disablePrev = currentPage <= 1;
  const disableNext = currentPage >= totalPages;
  pagePrevBtns.forEach((btn) => {
    btn.disabled = disablePrev;
  });
  pageNextBtns.forEach((btn) => {
    btn.disabled = disableNext;
  });
}

function findPaymentById(id) {
  return allPayments.find((r) => r.id === id) || null;
}

function syncSplitUi() {
  if (!splitView) return;
  splitView.classList.toggle("is-split", Boolean(selectedPaymentId));
}

function closePaymentDetail() {
  selectedPaymentId = null;
  if (detailEmptyEl) detailEmptyEl.hidden = false;
  if (detailContentEl) detailContentEl.hidden = true;
  tbody?.querySelectorAll(".row-selected").forEach((row) => row.classList.remove("row-selected"));
  syncSplitUi();
}

function renderPaymentDetail(row) {
  if (!row || !detailContentEl || !detailEmptyEl) return;
  detailEmptyEl.hidden = true;
  detailContentEl.hidden = false;

  if (detailOrderEl) {
    detailOrderEl.textContent = row.shopifyOrderName || row.orderNumber || "—";
  }
  if (detailStatusBadgeEl) {
    detailStatusBadgeEl.textContent = statusLabel(row.status);
    detailStatusBadgeEl.className = `payment-status-badge ${statusClass(row.status)}`;
  }
  const fields = [
    ["Customer", row.clientName],
    ["Amount", formatPesoAmount(row.amount)],
    ["Method", row.paymentMethod],
    ["Reference", row.referenceNumber],
    ["Match", row.matchMethod],
    ["Logged", formatLeadActivityDate(row)],
    ["Notes", row.notes, true]
  ];
  if (detailFieldsEl) {
    detailFieldsEl.innerHTML = fields
      .filter(([, val]) => val && val !== "—")
      .map(
        ([label, val, wide]) =>
          `<div class="lead-detail-row${wide ? " lead-detail-row--wide" : ""}"><dt>${label}</dt><dd>${escapeHtml(String(val))}</dd></div>`
      )
      .join("");
  }

  if (viewConversationBtn) {
    viewConversationBtn.hidden = false;
    viewConversationBtn.dataset.paymentId = row.id;
    viewConversationBtn.textContent = "View conversation";
    viewConversationBtn.title = "Open Inbox thread where this order number appears in chat";
  }

  if (viewShopifyBtn) {
    if (row.shopifyOrderId) {
      viewShopifyBtn.hidden = false;
      viewShopifyBtn.dataset.shopifyOrderId = row.shopifyOrderId;
    } else {
      viewShopifyBtn.hidden = true;
      delete viewShopifyBtn.dataset.shopifyOrderId;
    }
  }

  if (deleteBtn) {
    deleteBtn.hidden = false;
    deleteBtn.disabled = false;
    deleteBtn.dataset.paymentId = row.id;
  }
}

async function deletePayment(id) {
  const row = findPaymentById(id);
  const label = row?.shopifyOrderName || row?.orderNumber || id;
  if (!window.confirm(`Delete payment record for ${label}? This cannot be undone.`)) return;

  if (deleteBtn) deleteBtn.disabled = true;

  try {
    const { deleted } = await deletePaymentIntakes([id]);
    if (deleted < 1) {
      throw new Error("Payment record not found or already deleted.");
    }
    allPayments = allPayments.filter((r) => r.id !== id);
    closePaymentDetail();
    renderPaymentsTable();
    setCountMessage(`${allPayments.length} payment${allPayments.length === 1 ? "" : "s"}`);
  } catch (err) {
    setCountMessage(err.message, true);
    if (deleteBtn) deleteBtn.disabled = false;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPaymentsTable() {
  if (!tbody) return;
  const filtered = getFilteredPayments();
  updatePaginationUi(filtered.length);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="${LIST_COLSPAN}" class="empty">No payments match filters.</td></tr>`;
    closePaymentDetail();
    return;
  }

  tbody.innerHTML = pageRows
    .map((row) => {
      const selected = row.id === selectedPaymentId ? " row-selected" : "";
      return `<tr class="clickable-row${selected}" data-payment-id="${escapeHtml(row.id)}" tabindex="0">
        <td class="payments-cell-date">${escapeHtml(formatLeadActivityDate(row))}</td>
        <td>${escapeHtml(row.shopifyOrderName || row.orderNumber || "—")}</td>
        <td>${escapeHtml(row.clientName || "—")}</td>
        <td>${escapeHtml(formatPesoAmount(row.amount))}</td>
        <td>${escapeHtml(row.paymentMethod || "—")}</td>
        <td class="payments-cell-status"><span class="payment-status-badge ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
      </tr>`;
    })
    .join("");

  if (selectedPaymentId) {
    const row = findPaymentById(selectedPaymentId);
    if (row) renderPaymentDetail(row);
    else closePaymentDetail();
  }
}

function openPaymentDetail(id) {
  const row = findPaymentById(id);
  if (!row) return;
  selectedPaymentId = id;
  renderPaymentDetail(row);
  syncSplitUi();
  tbody?.querySelectorAll(".clickable-row").forEach((tr) => {
    tr.classList.toggle("row-selected", tr.dataset.paymentId === id);
  });
}

export async function loadPayments({ background = false } = {}) {
  const generation = ++paymentsLoadGeneration;
  if (!background) {
    setPanelLoading(panelPayments, { active: true, initial: !paymentsLoaded });
    setPanelBusy(panelPayments, true, { disableTabs: true });
  }
  if (loadBtn) loadBtn.disabled = true;

  try {
    const filters = readFiltersFromForm();
    const { data } = await listPaymentIntakes({
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      status: filters.status || undefined,
      search: filters.search || undefined,
      page: 1,
      size: 500
    });
    if (generation !== paymentsLoadGeneration) return;
    allPayments = data || [];
    paymentsLoaded = true;
    sessionStorage.setItem(PAYMENTS_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    setCountMessage(`${allPayments.length} payment${allPayments.length === 1 ? "" : "s"}`);
    renderPaymentsTable();
  } catch (err) {
    if (generation !== paymentsLoadGeneration) return;
    setCountMessage(err.message, true);
    if (!paymentsLoaded) {
      tbody.innerHTML = `<tr><td colspan="${LIST_COLSPAN}" class="empty">${escapeHtml(err.message)}</td></tr>`;
    }
  } finally {
    if (generation !== paymentsLoadGeneration) return;
    clearPanelLoadState(panelPayments);
    setPanelBusy(panelPayments, false, { disableTabs: false });
    if (loadBtn) loadBtn.disabled = false;
  }
}

export function initPaymentsTab() {
  try {
    const saved = sessionStorage.getItem(PAYMENTS_FILTERS_STORAGE_KEY);
    if (saved) {
      const f = JSON.parse(saved);
      if (f.status) document.getElementById("payments-filter-status").value = f.status;
      if (f.search) document.getElementById("payments-filter-search").value = f.search;
      if (f.startDate) document.getElementById("payments-filter-start-date").value = f.startDate;
      if (f.endDate) document.getElementById("payments-filter-end-date").value = f.endDate;
    }
  } catch {
    /* ignore */
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    currentPage = 1;
    loadPayments();
  });

  resetBtn?.addEventListener("click", () => {
    form?.reset();
    currentPage = 1;
    allPayments = [];
    paymentsLoaded = false;
    selectedPaymentId = null;
    sessionStorage.removeItem(PAYMENTS_FILTERS_STORAGE_KEY);
    closePaymentDetail();
    loadPayments();
  });

  loadBtn?.addEventListener("click", () => loadPayments());

  pagePrevBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderPaymentsTable();
      }
    });
  });

  pageNextBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(getFilteredPayments().length / PAGE_SIZE));
      if (currentPage < totalPages) {
        currentPage += 1;
        renderPaymentsTable();
      }
    });
  });

  tbody?.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-payment-id]");
    if (!row) return;
    openPaymentDetail(row.dataset.paymentId);
  });

  detailCloseBtn?.addEventListener("click", () => closePaymentDetail());

  deleteBtn?.addEventListener("click", () => {
    const id = deleteBtn.dataset.paymentId;
    if (id) deletePayment(id);
  });

  viewShopifyBtn?.addEventListener("click", () => {
    const orderId = viewShopifyBtn.dataset.shopifyOrderId;
    if (!orderId) return;
    window.location.href = `/shopify/index.html?order=${encodeURIComponent(orderId)}`;
  });

  viewConversationBtn?.addEventListener("click", () => {
    const row = findPaymentById(viewConversationBtn.dataset.paymentId || selectedPaymentId);
    const orderNumber = row?.shopifyOrderName || row?.orderNumber;
    if (!orderNumber) {
      setCountMessage("No order number on this payment", true);
      return;
    }
    openConversationInInbox(orderNumber, orderNumberSearchTerms(orderNumber), {
      clientName: row?.clientName
    });
  });
}

export function onPaymentsTabActivated() {
  clearPanelLoadState(panelPayments);
  setPanelBusy(panelPayments, false, { disableTabs: false });
  if (!paymentsLoaded) {
    loadPayments();
  }
}

export function openPaymentById(paymentId) {
  if (!paymentId) return;
  selectedPaymentId = paymentId;
  if (paymentsLoaded) {
    renderPaymentsTable();
    openPaymentDetail(paymentId);
  }
}
