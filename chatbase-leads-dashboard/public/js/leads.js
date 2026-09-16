import { deleteServiceLeads, createServiceLead, listServiceLeads, updateServiceLead, promoteServiceLeadToEvent } from "./api.js";
import { openConversationInInbox } from "./conversation-view.js";
import {
  formatLeadActivityDate,
  formatServiceLabel
} from "./format.js";
import {
  pipelineSelectHtml,
  readLeadFormFields,
  readLeadDetailEdits,
  renderLeadDetailPanel,
  renderLeadFormFieldsHtml,
  showLeadDetailEmpty
} from "./lead-detail.js";
import { downloadLeadInvoice } from "./lead-invoice.js";
import { indexLeadConversationNames } from "./lead-inbox-names.js";
import { getPipelineStatus, pipelineStatusBadgeHtml } from "./lead-status.js";
import {
  clearPanelLoadState,
  enableAppTabs,
  setPanelBusy,
  setPanelLoading,
  setPanelSyncing
} from "./panel-loading.js";
import { onPaymentsTabActivated, openPaymentById } from "./payments.js";

const PAGE_SIZE = 20;
const REFRESH_STALE_MS = 120_000;
const TAB_STORAGE_KEY = "chatbase_active_tab";
const LEADS_STORAGE_PREFIX = "chatbase_service_leads_cache:";
const LEADS_FILTERS_STORAGE_KEY = "chatbase_service_leads_filters";
const LEADS_FETCH_SIZE = 500;
const LIST_COLSPAN = 4;

const panelInbox = document.getElementById("panel-inbox");
const panelLeads = document.getElementById("panel-leads");
const panelPayments = document.getElementById("panel-payments");
const tabInbox = document.getElementById("tab-inbox");
const tabLeads = document.getElementById("tab-leads");
const tabPayments = document.getElementById("tab-payments");

const form = document.getElementById("leads-filters-form");
const resetBtn = document.getElementById("leads-reset-filters-btn");
const loadBtn = document.getElementById("leads-load-btn");
const addLeadBtn = document.getElementById("leads-add-btn");
const createDialog = document.getElementById("lead-create-dialog");
const createForm = document.getElementById("lead-create-form");
const createFieldsEl = document.getElementById("lead-create-fields");
const createStatusWrapEl = document.getElementById("lead-create-status-wrap");
const createNotesEl = document.getElementById("lead-create-notes");
const createErrorEl = document.getElementById("lead-create-error");
const createSubmitBtn = document.getElementById("lead-create-submit");
const createCancelBtn = document.getElementById("lead-create-cancel");
const tbody = document.getElementById("service-leads-tbody");
const thead = document.getElementById("leads-thead");
const leadsTable = document.getElementById("leads-table");
const splitView = document.getElementById("leads-split-view");
const countEl = document.getElementById("leads-count");
const pagePrevBtns = document.querySelectorAll(".leads-page-prev");
const pageNextBtns = document.querySelectorAll(".leads-page-next");
const pageInfoEls = document.querySelectorAll(".leads-page-info");

const detailEmptyEl = document.getElementById("leads-detail-empty");
const detailContentEl = document.getElementById("leads-detail-content");
const conversationContentEl = document.getElementById("leads-conversation-content");
const detailCloseBtn = document.getElementById("leads-detail-close");
const detailEditBtn = document.getElementById("leads-detail-edit");
const detailSaveBtn = document.getElementById("lead-detail-save");
const detailCancelBtn = document.getElementById("lead-detail-cancel");
const detailSaveErrorEl = document.getElementById("lead-detail-save-error");
const conversationBackBtn = document.getElementById("leads-conversation-back");
const conversationTitleEl = document.getElementById("leads-conversation-title");
const conversationMetaEl = document.getElementById("leads-conversation-meta");
const conversationMessagesEl = document.getElementById("leads-conversation-messages");

const detailElements = {
  emptyEl: detailEmptyEl,
  contentEl: detailContentEl,
  conversationEl: conversationContentEl,
  quoteRefEl: document.getElementById("lead-detail-quote-ref"),
  statusBadgeEl: document.getElementById("lead-detail-status-badge"),
  statusWrapEl: document.getElementById("lead-detail-status-wrap"),
  fieldsEl: document.getElementById("lead-detail-fields"),
  activityEl: document.getElementById("lead-detail-activity"),
  docIdEl: document.getElementById("lead-detail-doc-id"),
  viewConversationBtn: document.getElementById("lead-detail-view-conversation"),
  deleteBtn: document.getElementById("lead-detail-delete"),
  downloadInvoiceBtn: document.getElementById("lead-detail-download-invoice"),
  addCalendarBtn: document.getElementById("lead-detail-add-calendar"),
  notesViewEl: document.getElementById("lead-detail-notes-view"),
  notesEditEl: document.getElementById("lead-detail-notes"),
  editBtn: detailEditBtn,
  saveBtn: detailSaveBtn,
  cancelBtn: detailCancelBtn,
  editActionsEl: document.getElementById("lead-detail-edit-actions")
};

let allLeads = [];
let currentPage = 1;
let leadsLoaded = false;
let selectedLeadId = null;
let leadsFetchInProgress = false;
let leadsFetchComplete = false;
let lastLeadsFetchAt = 0;
let leadsLoadGeneration = 0;

export function isLeadsTabActive() {
  return panelLeads && !panelLeads.hidden;
}

function isLeadsFetchStale() {
  return !lastLeadsFetchAt || Date.now() - lastLeadsFetchAt > REFRESH_STALE_MS;
}
let detailPaneView = "lead";
let detailEditMode = false;

const THEAD_ROWS = `
  <tr>
    <th>Name</th>
    <th>Status</th>
    <th>Service</th>
    <th>Last updated</th>
  </tr>
`;

function defaultStartDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return date.toISOString().slice(0, 10);
}

function defaultEndDate() {
  return new Date().toISOString().slice(0, 10);
}

export function initDefaultLeadDates() {
  const start = document.getElementById("leads-filter-start-date");
  const end = document.getElementById("leads-filter-end-date");
  if (start && !start.value) start.value = defaultStartDate();
  if (end && !end.value) end.value = defaultEndDate();
}

function formToQuery() {
  const formData = new FormData(form);
  return {
    startDate: formData.get("startDate") || defaultStartDate(),
    endDate: formData.get("endDate") || defaultEndDate(),
    service: formData.get("service") || "",
    eventType: formData.get("eventType") || "",
    pipelineStatus: formData.get("pipelineStatus") || ""
  };
}

function leadsCacheKey(query) {
  return `${LEADS_STORAGE_PREFIX}${JSON.stringify(query)}`;
}

function saveLeadsFiltersToSession() {
  sessionStorage.setItem(LEADS_FILTERS_STORAGE_KEY, JSON.stringify(formToQuery()));
}

function restoreLeadsFiltersFromSession() {
  const raw = sessionStorage.getItem(LEADS_FILTERS_STORAGE_KEY);
  if (!raw || !form) return;
  try {
    const saved = JSON.parse(raw);
    const start = document.getElementById("leads-filter-start-date");
    const end = document.getElementById("leads-filter-end-date");
    const service = document.getElementById("leads-filter-service");
    const eventType = document.getElementById("leads-filter-event-type");
    const pipeline = document.getElementById("leads-filter-pipeline");
    if (start && saved.startDate) start.value = saved.startDate;
    if (end && saved.endDate) end.value = saved.endDate;
    if (service && saved.service !== undefined) service.value = saved.service;
    if (eventType && saved.eventType !== undefined) eventType.value = saved.eventType;
    if (pipeline && saved.pipelineStatus !== undefined) pipeline.value = saved.pipelineStatus;
  } catch (_err) {
    /* ignore */
  }
}

function readLeadsCache() {
  const key = leadsCacheKey(formToQuery());
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { rows: parsed, fetchedAt: 0 };
    }
    if (parsed && Array.isArray(parsed.rows)) {
      return parsed;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

function writeLeadsCache(rows) {
  const key = leadsCacheKey(formToQuery());
  sessionStorage.setItem(
    key,
    JSON.stringify({ rows, fetchedAt: Date.now() })
  );
}

function clearAllLeadsCache() {
  const toRemove = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(LEADS_STORAGE_PREFIX)) toRemove.push(key);
  }
  toRemove.forEach((key) => sessionStorage.removeItem(key));
}

function hydrateLeadsFromCache() {
  const cached = readLeadsCache();
  if (!cached?.rows?.length) return false;
  allLeads = cached.rows;
  leadsLoaded = true;
  leadsFetchComplete = true;
  lastLeadsFetchAt = cached.fetchedAt || Date.now();
  renderRows();
  syncLeadInboxNameIndex();
  clearPanelLoadState(panelLeads);
  return true;
}

function applyClientFilters(rows) {
  const pipeline = formToQuery().pipelineStatus;
  if (!pipeline) return rows;
  return rows.filter((row) => getPipelineStatus(row) === pipeline);
}

function leadLastUpdatedAt(row) {
  return row?.updatedAt || row?.createdAt || "";
}

function sortLeadsByLastUpdated(rows) {
  return [...rows].sort((a, b) => leadLastUpdatedAt(b).localeCompare(leadLastUpdatedAt(a)));
}

function replaceLeadInList(updated) {
  const idx = allLeads.findIndex((r) => r.id === updated.id);
  if (idx >= 0) allLeads[idx] = updated;
}

function getDetailRenderOptions() {
  return {
    mode: detailEditMode ? "edit" : "view",
    paneView: detailPaneView
  };
}

function refreshDetailPanel() {
  const row = findLeadById(selectedLeadId);
  if (!row) return;
  renderLeadDetailPanel(row, detailElements, getDetailRenderOptions());
}

function setCreateLeadError(message = "") {
  if (!createErrorEl) return;
  if (message) {
    createErrorEl.textContent = message;
    createErrorEl.hidden = false;
  } else {
    createErrorEl.textContent = "";
    createErrorEl.hidden = true;
  }
}

function resetCreateLeadForm() {
  if (createFieldsEl) createFieldsEl.innerHTML = renderLeadFormFieldsHtml({});
  if (createStatusWrapEl) createStatusWrapEl.innerHTML = pipelineSelectHtml("inquiry");
  if (createNotesEl) createNotesEl.value = "";
  setCreateLeadError("");
}

function openCreateLeadDialog() {
  if (!createDialog) return;
  resetCreateLeadForm();
  if (typeof createDialog.showModal === "function") {
    createDialog.showModal();
  } else {
    createDialog.setAttribute("open", "");
  }
}

function closeCreateLeadDialog() {
  if (!createDialog) return;
  if (typeof createDialog.close === "function") {
    createDialog.close();
  } else {
    createDialog.removeAttribute("open");
  }
}

async function submitCreateLead() {
  const payload = readLeadFormFields({
    fieldsEl: createFieldsEl,
    statusWrapEl: createStatusWrapEl,
    notesEl: createNotesEl
  });

  if (!payload.clientName?.trim()) {
    setCreateLeadError("Client name is required.");
    return;
  }

  if (createSubmitBtn) createSubmitBtn.disabled = true;
  setCreateLeadError("");

  try {
    const { data } = await createServiceLead(payload);
    allLeads = [data, ...allLeads];
    writeLeadsCache(allLeads);
    syncLeadInboxNameIndex();
    leadsLoaded = true;
    leadsFetchComplete = true;
    lastLeadsFetchAt = Date.now();

    closeCreateLeadDialog();
    selectLead(data);

    const shown = getFilteredLeads().length;
    setCountMessage(`${shown} lead${shown === 1 ? "" : "s"}`);
    renderRows();
  } catch (err) {
    setCreateLeadError(err.message);
  } finally {
    if (createSubmitBtn) createSubmitBtn.disabled = false;
  }
}

function setLeadSaveError(message = "") {
  if (!detailSaveErrorEl) return;
  if (message) {
    detailSaveErrorEl.textContent = message;
    detailSaveErrorEl.hidden = false;
  } else {
    detailSaveErrorEl.textContent = "";
    detailSaveErrorEl.hidden = true;
  }
}

async function patchLead(id, patch) {
  const { data } = await updateServiceLead(id, patch);
  replaceLeadInList(data);
  setLeadSaveError("");
  if (selectedLeadId === id) {
    detailEditMode = false;
    refreshDetailPanel();
  }
  renderRows();
  writeLeadsCache(allLeads);
  syncLeadInboxNameIndex();
  return data;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getTotalPages(totalItems) {
  return Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
}

function isSplitView() {
  return Boolean(selectedLeadId);
}

function findLeadById(id) {
  return allLeads.find((row) => row.id === id) || null;
}

/** Open admin Events planner (parent shell or known admin origin). */
function openEventsPlanner({ eventId, leadId } = {}) {
  const params = new URLSearchParams();
  params.set("app", "Events");
  if (eventId) params.set("event", eventId);
  if (leadId) params.set("lead", leadId);
  const qs = params.toString();

  try {
    if (window.parent && window.parent !== window) {
      const parentUrl = new URL(window.parent.location.href);
      if (parentUrl.pathname.includes("admin") || parentUrl.searchParams.has("app")) {
        parentUrl.search = `?${qs}`;
        window.parent.location.href = parentUrl.toString();
        return;
      }
    }
  } catch (_err) {
    /* cross-origin — fall through */
  }

  const host = window.location.hostname || "";
  let base = "https://admin.matchanese.com/";
  if (host === "localhost" || host === "127.0.0.1") {
    base = `${window.location.protocol}//${host}:5500/admin.html`;
  } else if (host.includes("github.io")) {
    base = `${window.location.origin}/admin.html`;
  }
  window.open(`${base}?${qs}`, "_blank", "noopener");
}

function setCountMessage(message, isError = false) {
  if (!countEl) return;
  countEl.textContent = message;
  countEl.classList.toggle("count-error", Boolean(isError));
}

function getFilteredLeads() {
  return sortLeadsByLastUpdated(applyClientFilters(allLeads));
}

function getPageRows() {
  const filtered = getFilteredLeads();
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  return filtered.slice(pageStart, pageStart + PAGE_SIZE);
}

function updatePaginationUi(totalItems) {
  const totalPages = getTotalPages(totalItems);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  let infoText = "No results";
  let prevDisabled = true;
  let nextDisabled = true;

  if (totalItems > 0) {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalItems);
    infoText = `Page ${currentPage} of ${totalPages} (${start}–${end} of ${totalItems})`;
    prevDisabled = currentPage <= 1;
    nextDisabled = currentPage >= totalPages;
  }

  pageInfoEls.forEach((el) => {
    el.textContent = infoText;
  });
  pagePrevBtns.forEach((btn) => {
    btn.disabled = prevDisabled;
  });
  pageNextBtns.forEach((btn) => {
    btn.disabled = nextDisabled;
  });
}

function renderThead() {
  if (thead) thead.innerHTML = THEAD_ROWS;
  leadsTable?.classList.add("leads-table--compact");
}

function statusCellHtml(row) {
  return pipelineStatusBadgeHtml(getPipelineStatus(row));
}

function syncLeadInboxNameIndex() {
  indexLeadConversationNames(allLeads);
}

function renderLeadRow(row) {
  const selected = row.id === selectedLeadId ? " row-selected" : "";
  return `
    <tr class="clickable-row${selected}" data-lead-id="${escapeHtml(row.id)}">
      <td class="leads-cell-name" title="${escapeHtml(row.id)}">${escapeHtml(row.clientName || "—")}</td>
      <td class="leads-cell-status">${statusCellHtml(row)}</td>
      <td class="leads-cell-service">${escapeHtml(formatServiceLabel(row.service))}</td>
      <td class="leads-cell-updated">${formatLeadActivityDate(row)}</td>
    </tr>
  `;
}

function wireRowClicks() {
  tbody.querySelectorAll(".clickable-row").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = tr.dataset.leadId;
      const row = findLeadById(id);
      if (row) selectLead(row);
    });
  });
}

function resetDetailPaneState() {
  detailPaneView = "lead";
  detailEditMode = false;
}

function syncSplitUi() {
  const split = isSplitView();
  splitView?.classList.toggle("is-split", split);

  if (split) {
    const row = findLeadById(selectedLeadId);
    if (row) refreshDetailPanel();
    else showLeadDetailEmpty(detailEmptyEl, detailContentEl, conversationContentEl, "Lead not found.");
  } else {
    resetDetailPaneState();
    showLeadDetailEmpty(detailEmptyEl, detailContentEl, conversationContentEl);
  }
}

export function selectLead(row) {
  if (!row?.id) return;
  resetDetailPaneState();
  selectedLeadId = row.id;
  syncSplitUi();
  renderRows();
}

export function closeLeadDetail() {
  selectedLeadId = null;
  resetDetailPaneState();
  syncSplitUi();
  renderRows();
}

function showLeadDetailView() {
  detailPaneView = "lead";
  detailEmptyEl.hidden = true;
  conversationContentEl.hidden = true;
  detailContentEl.hidden = false;
  refreshDetailPanel();
}

function renderRows() {
  const total = getFilteredLeads().length;

  renderThead();
  updatePaginationUi(total);

  if (!total) {
    if (leadsFetchInProgress && !leadsFetchComplete) {
      return;
    }
    tbody.innerHTML = `<tr><td colspan="${LIST_COLSPAN}" class="empty">No service leads found.</td></tr>`;
    return;
  }

  const pageRows = getPageRows();
  tbody.innerHTML = pageRows.map(renderLeadRow).join("");
  wireRowClicks();
}

async function deleteLead(id) {
  if (!id) return;
  const row = findLeadById(id);
  const label = row?.quoteReference || row?.clientName || "this lead";
  if (!window.confirm(`Delete lead ${label}? This cannot be undone.`)) return;

  const deleteBtn = detailElements.deleteBtn;
  if (deleteBtn) deleteBtn.disabled = true;

  try {
    const { deleted } = await deleteServiceLeads([id]);
    allLeads = allLeads.filter((r) => r.id !== id);
    writeLeadsCache(allLeads);
    syncLeadInboxNameIndex();

    const total = allLeads.length;
    const totalPages = getTotalPages(total);
    if (currentPage > totalPages) currentPage = totalPages;

    setCountMessage(`${total} lead${total === 1 ? "" : "s"}`);

    if (selectedLeadId === id) {
      closeLeadDetail();
    } else {
      renderRows();
    }

    if (deleted < 1) {
      window.alert("Lead may have already been removed.");
    }
  } catch (err) {
    setCountMessage(err.message, true);
  } finally {
    if (deleteBtn) deleteBtn.disabled = false;
  }
}

function goToPage(page) {
  const totalPages = getTotalPages(getFilteredLeads().length);
  currentPage = Math.min(Math.max(1, page), totalPages);
  renderRows();
  if (selectedLeadId && !findLeadById(selectedLeadId)) {
    closeLeadDetail();
  }
}

export async function loadServiceLeads({ background = false } = {}) {
  if (!loadBtn) return;
  if (leadsFetchInProgress) return;

  const generation = ++leadsLoadGeneration;
  const hadData = allLeads.length > 0;
  const previousSelection = selectedLeadId;
  const leadsTabActive = isLeadsTabActive();
  const coldLoad = !hadData && !background;

  loadBtn.disabled = true;
  leadsFetchInProgress = true;
  saveLeadsFiltersToSession();

  if (coldLoad) {
    setPanelLoading(panelLeads, { active: true, initial: true });
    if (leadsTabActive) {
      setPanelBusy(panelLeads, true, { disableTabs: true });
    }
    setCountMessage("Loading…");
  } else {
    setPanelSyncing(panelLeads, true);
  }

  if (!background && !hadData) {
    selectedLeadId = null;
    resetDetailPaneState();
    currentPage = 1;
    syncSplitUi();
  }

  const query = formToQuery();

  try {
    const { data } = await listServiceLeads({
      ...query,
      page: 1,
      size: LEADS_FETCH_SIZE
    });

    allLeads = data || [];
    writeLeadsCache(allLeads);
    syncLeadInboxNameIndex();
    leadsLoaded = true;
    leadsFetchComplete = true;
    lastLeadsFetchAt = Date.now();

    renderRows();

    if (previousSelection && !findLeadById(previousSelection)) {
      closeLeadDetail();
    } else if (previousSelection && findLeadById(previousSelection)) {
      syncSplitUi();
    }

    const shown = getFilteredLeads().length;
    setCountMessage(`${shown} lead${shown === 1 ? "" : "s"}`);
  } catch (err) {
    setCountMessage(
      hadData ? `${err.message} (showing cached)` : err.message,
      !hadData
    );
    if (!hadData) {
      tbody.innerHTML = `<tr><td colspan="${LIST_COLSPAN}" class="empty">${escapeHtml(err.message)}</td></tr>`;
    }
  } finally {
    if (generation !== leadsLoadGeneration) return;
    leadsFetchInProgress = false;
    clearPanelLoadState(panelLeads);
    if (leadsTabActive) {
      setPanelBusy(panelLeads, false, { disableTabs: false });
    }
    loadBtn.disabled = false;
    if (leadsFetchComplete) {
      updatePaginationUi(getFilteredLeads().length);
    }
  }
}

export function switchTab(tabName) {
  const isInbox = tabName === "inbox";
  const isLeads = tabName === "leads";
  const isPayments = tabName === "payments";

  enableAppTabs();

  panelInbox.hidden = !isInbox;
  panelLeads.hidden = !isLeads;
  if (panelPayments) panelPayments.hidden = !isPayments;

  tabInbox.classList.toggle("active", isInbox);
  tabLeads.classList.toggle("active", isLeads);
  if (tabPayments) tabPayments.classList.toggle("active", isPayments);

  tabInbox.setAttribute("aria-selected", String(isInbox));
  tabLeads.setAttribute("aria-selected", String(isLeads));
  if (tabPayments) tabPayments.setAttribute("aria-selected", String(isPayments));

  sessionStorage.setItem(TAB_STORAGE_KEY, tabName);

  if (isLeads) {
    clearPanelLoadState(panelLeads);
    setPanelBusy(panelLeads, false);
    initDefaultLeadDates();
    const hadCache = hydrateLeadsFromCache();
    if (hadCache) {
      setCountMessage(`Showing ${getFilteredLeads().length} cached`);
      if (isLeadsFetchStale()) {
        loadServiceLeads({ background: true });
      }
    } else if (!leadsLoaded) {
      loadServiceLeads();
    }
  }

  if (isPayments) {
    onPaymentsTabActivated();
  }
}

export function initTabs() {
  restoreLeadsFiltersFromSession();
  initDefaultLeadDates();
  syncSplitUi();

  document.querySelectorAll(".app-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });

  const params = new URLSearchParams(window.location.search);
  const urlTab = params.get("tab");
  const saved = sessionStorage.getItem(TAB_STORAGE_KEY);

  if (urlTab === "payments" || urlTab === "leads") {
    switchTab(urlTab);
    if (urlTab === "payments" && params.get("id")) {
      openPaymentById(params.get("id"));
    }
  } else if (saved === "leads" || saved === "payments") {
    switchTab(saved);
  } else {
    switchTab("inbox");
  }

  const inboxSearch = params.get("inboxSearch");
  if (inboxSearch) {
    switchTab("inbox");
    openConversationInInbox(inboxSearch, [inboxSearch]);
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    currentPage = 1;
    loadServiceLeads({ background: allLeads.length > 0 });
  });

  resetBtn?.addEventListener("click", () => {
    form?.reset();
    initDefaultLeadDates();
    currentPage = 1;
    allLeads = [];
    selectedLeadId = null;
    leadsLoaded = false;
    leadsFetchComplete = false;
    resetDetailPaneState();
    clearAllLeadsCache();
    sessionStorage.removeItem(LEADS_FILTERS_STORAGE_KEY);
    setCountMessage("—");
    tbody.innerHTML = `<tr><td colspan="${LIST_COLSPAN}" class="empty">No service leads loaded.</td></tr>`;
    renderThead();
    updatePaginationUi(0);
    closeLeadDetail();
    clearPanelLoadState(panelLeads);
    setPanelBusy(panelLeads, false);
  });

  loadBtn?.addEventListener("click", () => {
    loadServiceLeads({ background: allLeads.length > 0 });
  });

  addLeadBtn?.addEventListener("click", () => {
    openCreateLeadDialog();
  });

  createCancelBtn?.addEventListener("click", () => {
    closeCreateLeadDialog();
  });

  createDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCreateLeadDialog();
  });

  createForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCreateLead();
  });

  pagePrevBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      goToPage(currentPage - 1);
    });
  });

  pageNextBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      goToPage(currentPage + 1);
    });
  });

  detailCloseBtn?.addEventListener("click", () => {
    closeLeadDetail();
  });

  detailEditBtn?.addEventListener("click", () => {
    if (detailPaneView !== "lead") return;
    detailEditMode = true;
    setLeadSaveError("");
    refreshDetailPanel();
  });

  detailCancelBtn?.addEventListener("click", () => {
    detailEditMode = false;
    setLeadSaveError("");
    refreshDetailPanel();
  });

  detailSaveBtn?.addEventListener("click", async () => {
    const id = detailSaveBtn?.dataset.leadId;
    if (!id) return;
    const edits = readLeadDetailEdits(detailElements);
    try {
      detailSaveBtn.disabled = true;
      setLeadSaveError("");
      await patchLead(id, edits);
    } catch (err) {
      setLeadSaveError(err.message);
      setCountMessage(err.message, true);
    } finally {
      detailSaveBtn.disabled = false;
    }
  });

  detailElements.viewConversationBtn?.addEventListener("click", () => {
    const row = findLeadById(
      detailElements.viewConversationBtn?.dataset.leadId || selectedLeadId
    );
    const clientName = String(row?.clientName || "").trim();
    if (!clientName) {
      setCountMessage("Lead has no client name to search for", true);
      return;
    }
    openConversationInInbox(clientName, [clientName], {
      clientName
    });
  });

  conversationBackBtn?.addEventListener("click", () => {
    showLeadDetailView();
  });

  detailElements.deleteBtn?.addEventListener("click", () => {
    const id = detailElements.deleteBtn.dataset.leadId;
    if (id) deleteLead(id);
  });

  detailElements.downloadInvoiceBtn?.addEventListener("click", async () => {
    const row = findLeadById(selectedLeadId);
    if (!row) return;
    const btn = detailElements.downloadInvoiceBtn;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      await downloadLeadInvoice(row);
      await patchLead(row.id, { pipelineStatus: "invoiced" });
    } catch (err) {
      window.alert(err.message || "Could not generate invoice.");
    } finally {
      btn.textContent = original;
      const updated = findLeadById(row.id);
      if (updated) refreshDetailPanel();
    }
  });

  detailElements.addCalendarBtn?.addEventListener("click", async () => {
    const row = findLeadById(selectedLeadId);
    if (!row) return;
    const btn = detailElements.addCalendarBtn;
    const mode = btn.dataset.mode || "promote";

    if (mode === "view" || row.opsEventId) {
      openEventsPlanner({ eventId: row.opsEventId, leadId: row.id });
      return;
    }

    if (!String(row.targetDate || "").trim()) {
      window.alert("Set a target date on the lead before adding it to the calendar.");
      return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      const result = await promoteServiceLeadToEvent(row.id);
      const eventId = result.id || result.event?.id;
      const idx = allLeads.findIndex((l) => l.id === row.id);
      if (idx >= 0) {
        allLeads[idx] = { ...allLeads[idx], opsEventId: eventId };
        writeLeadsCache(allLeads);
      }
      refreshDetailPanel();
      renderRows();
      if (eventId && window.confirm("Draft event created. Open Events calendar?")) {
        openEventsPlanner({ eventId, leadId: row.id });
      }
    } catch (err) {
      window.alert(err.message || "Could not add lead to calendar.");
    } finally {
      btn.textContent = original;
      refreshDetailPanel();
    }
  });

  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (!isLeadsTabActive()) return;
    if (leadsFetchInProgress) return;
    if (!leadsLoaded || !isLeadsFetchStale()) return;
    loadServiceLeads({ background: true });
  }, REFRESH_STALE_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!isLeadsTabActive()) return;
    if (leadsFetchInProgress) return;
    if (!leadsLoaded || !isLeadsFetchStale()) return;
    loadServiceLeads({ background: true });
  });
}
