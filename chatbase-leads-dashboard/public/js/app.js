import { listConversationsPage, getConversation, fetchInboxSummary } from "./api.js";
import { getConversationLookupQuery } from "./inbox-query.js";
import {
  renderConversationPanel,
  renderSummaryPanel,
  showDetailEmpty,
  showDetailContent,
  summaryTitleForDate
} from "./conversation-view.js";
import { emptySummarySections, mergeSummarySections } from "./format-summary.js";
import {
  conversationLastActivityAt,
  formatInboxListDate,
  shortenSource
} from "./format.js";
import { resolveDisplayName } from "./name-infer.js";
import { getClientNameForConversation } from "./lead-inbox-names.js";
import { initTabs, switchTab } from "./leads.js";
import { initPaymentsTab } from "./payments.js";
import { clearPanelLoadState, setPanelBusy, setPanelLoading, setPanelSyncing } from "./panel-loading.js";

const PAGE_SIZE = 20;
const REFRESH_STALE_MS = 120_000;
/** Chatbase returns newest first — one page on load; more via Next. */
const INBOX_INITIAL_PAGES = 1;
const INBOX_FETCH_PAGE_SIZE = 50;
const INBOX_DEFAULT_DAYS = 90;

const panelInbox = document.getElementById("panel-inbox");
const conversationsListEl = document.getElementById("conversations-list");
const countEl = document.getElementById("conversations-count");
const form = document.getElementById("filters-form");
const resetBtn = document.getElementById("reset-filters-btn");
const loadBtn = document.getElementById("load-btn");
const inboxSummaryBtn = document.getElementById("inbox-summary-btn");
const inboxSummaryDateInput = document.getElementById("inbox-summary-date");
const searchInput = document.getElementById("filter-search");
const searchClearBtn = document.getElementById("filter-search-clear");
const pagePrevBtns = document.querySelectorAll("#panel-inbox .page-prev");
const pageNextBtns = document.querySelectorAll("#panel-inbox .page-next");
const pageInfoEls = document.querySelectorAll("#panel-inbox .page-info");
const detailEmptyEl = document.getElementById("detail-empty");
const detailContentEl = document.getElementById("detail-content");
const titleEl = document.getElementById("conversation-title");
const metaEl = document.getElementById("conversation-meta");
const messagesEl = document.getElementById("messages");

const STORAGE_KEY = "chatbase_conversations_cache";
const FILTER_STORAGE_KEY = "chatbase_conversations_filters";

let allConversations = [];
let currentPage = 1;
let selectedConversationId = null;
let inboxFetchInProgress = false;
let inboxFetchComplete = false;
let inboxHasMoreFromApi = false;
let inboxApiNextPage = 2;
let lastInboxFetchAt = 0;
let inboxSummaryInProgress = false;

function isInboxTabActive() {
  return panelInbox && !panelInbox.hidden;
}

function isInboxFetchStale() {
  return !lastInboxFetchAt || Date.now() - lastInboxFetchAt > REFRESH_STALE_MS;
}

function defaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - INBOX_DEFAULT_DAYS);
  return date.toISOString().slice(0, 10);
}

function defaultEndDate() {
  return new Date().toISOString().slice(0, 10);
}

function initDefaultDates() {
  const start = document.getElementById("filter-start-date");
  const end = document.getElementById("filter-end-date");
  if (start && !start.value) start.value = defaultStartDate();
  if (end && !end.value) end.value = defaultEndDate();
}

function restoreFiltersFromSession() {
  const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
  if (!raw || !form) return;
  try {
    const saved = JSON.parse(raw);
    const start = document.getElementById("filter-start-date");
    const end = document.getElementById("filter-end-date");
    const source = document.getElementById("filter-source");
    if (start && saved.startDate) start.value = saved.startDate;
    if (end && saved.endDate) end.value = saved.endDate;
    if (source && saved.filteredSources !== undefined) source.value = saved.filteredSources;
  } catch (_err) {
    /* ignore */
  }
}

function formToQuery() {
  const formData = new FormData(form);
  return {
    startDate: formData.get("startDate") || defaultStartDate(),
    endDate: formData.get("endDate") || defaultEndDate(),
    filteredSources: formData.get("filteredSources") || ""
  };
}

/** End date is inclusive for Chatbase — bump by one day for API calls. */
function formToApiQuery() {
  const query = formToQuery();
  const end = new Date(`${query.endDate}T12:00:00`);
  if (!Number.isNaN(end.getTime())) {
    end.setDate(end.getDate() + 1);
    return { ...query, endDate: end.toISOString().slice(0, 10) };
  }
  return query;
}

function renderInboxCount() {
  if (!countEl || countEl.classList.contains("count-error") || inboxFetchInProgress) return;

  const filtered = getFilteredConversations();
  const keyword = searchInput?.value?.trim();

  if (keyword) {
    const n = filtered.length;
    countEl.innerHTML = `${n} match${n === 1 ? "" : "es"} · <button type="button" class="link-btn inbox-show-all">Show all</button>`;
    return;
  }

  countEl.textContent = `${filtered.length} conversation${filtered.length === 1 ? "" : "s"}`;
}

function saveFiltersToSession() {
  sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(formToQuery()));
}

function conversationStorageKey(id) {
  return `chatbase_conversation_${id}`;
}

function stashConversation(conversation) {
  sessionStorage.setItem(conversationStorageKey(conversation.id), JSON.stringify(conversation));
}

function sourcePill(source) {
  const label = shortenSource(source);
  const safe = (source || "unknown").replace(/\s+/g, "-").toLowerCase();
  return `<span class="source-pill source-${safe}" title="${source || "unknown"}">${label}</span>`;
}

function resolveInboxDisplayName(conversation) {
  const fromLead = getClientNameForConversation(conversation?.id);
  return fromLead || resolveDisplayName(conversation);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function updateSearchClearVisibility() {
  if (!searchClearBtn || !searchInput) return;
  searchClearBtn.hidden = !searchInput.value.trim();
}

function clearInboxSearch() {
  if (!searchInput) return;
  searchInput.value = "";
  currentPage = 1;
  updateSearchClearVisibility();
  renderRows();
}

function getFilteredConversations() {
  const keyword = searchInput?.value?.trim().toLowerCase() || "";
  if (!keyword) return allConversations;
  return allConversations.filter((row) => {
    const hay = [
      row.id,
      row.source,
      row.displayName,
      resolveInboxDisplayName(row),
      row.preview,
      ...(row.messages || []).map((m) => m.content)
    ].join(" ").toLowerCase();
    return hay.includes(keyword);
  });
}

function getTotalPages(totalItems) {
  return Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
}

function clampCurrentPage(totalPages) {
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
}

function updatePaginationUi(totalItems) {
  const totalPages = getTotalPages(totalItems);
  clampCurrentPage(totalPages);

  const keyword = searchInput?.value?.trim();
  const canLoadMore = inboxHasMoreFromApi && !keyword;

  let infoText = "";
  let prevDisabled = true;
  let nextDisabled = true;

  if (totalItems > 0) {
    infoText = `Page ${currentPage}`;
    prevDisabled = currentPage <= 1;
    nextDisabled = currentPage >= totalPages && !canLoadMore;
  }

  pageInfoEls.forEach((el) => {
    el.textContent = infoText;
  });
  pagePrevBtns.forEach((btn) => {
    btn.disabled = prevDisabled || inboxFetchInProgress;
  });
  pageNextBtns.forEach((btn) => {
    btn.disabled = nextDisabled || inboxFetchInProgress;
    btn.textContent = canLoadMore && currentPage >= totalPages ? "Next · load more" : "Next";
  });
}

function syncUrlToSelection() {
  const url = new URL(window.location.href);
  if (selectedConversationId) {
    url.searchParams.set("id", selectedConversationId);
  } else {
    url.searchParams.delete("id");
  }
  window.history.replaceState({}, "", url);
}

function showDetailPlaceholder(message = "Select a conversation to read messages.") {
  selectedConversationId = null;
  syncUrlToSelection();
  showDetailEmpty(detailEmptyEl, detailContentEl, message);
}

function todayIsoInManila() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function summaryDateIso() {
  const value = inboxSummaryDateInput?.value;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return todayIsoInManila();
}

async function loadInboxSummary() {
  if (inboxSummaryInProgress) return;

  inboxSummaryInProgress = true;
  if (inboxSummaryBtn) {
    inboxSummaryBtn.disabled = true;
    inboxSummaryBtn.classList.add("is-loading");
  }
  if (inboxSummaryDateInput) inboxSummaryDateInput.disabled = true;

  const summaryDate = summaryDateIso();

  selectedConversationId = null;
  syncUrlToSelection();
  showDetailContent(detailEmptyEl, detailContentEl);
  titleEl.textContent = summaryTitleForDate(summaryDate);
  metaEl.innerHTML = "";
  messagesEl.innerHTML = '<p class="subtle inbox-summary-loading">Generating summary…</p>';

  const query = formToQuery();

  try {
    let mergedSections = emptySummarySections();
    let lastMeta = {};
    let batch = 0;
    let totalBatches = 1;

    while (batch < totalBatches) {
      if (batch > 0) {
        metaEl.innerHTML = `<span class="subtle">Summarizing day batch ${batch + 1} of ${totalBatches}…</span>`;
      }

      const { data } = await fetchInboxSummary({
        date: summaryDate,
        filteredSources: query.filteredSources || "",
        batch
      });

      const dayBatches = data?.meta?.totalBatches ?? 0;
      totalBatches = dayBatches > 0 ? dayBatches : 1;
      mergedSections = mergeSummarySections(mergedSections, data?.sections || emptySummarySections());
      lastMeta = data?.meta || {};

      renderSummaryPanel({
        titleEl,
        metaEl,
        messagesEl,
        sections: mergedSections,
        meta: {
          ...lastMeta,
          partial: batch < totalBatches - 1 || (data?.meta?.totalPendingBatches ?? 0) > 0
        }
      });

      batch += 1;
    }

    let pendingBatch = 0;
    let totalPendingBatches = null;

    while (totalPendingBatches === null || pendingBatch < totalPendingBatches) {
      if (totalPendingBatches != null && totalPendingBatches > 1) {
        metaEl.innerHTML = `<span class="subtle">Checking open follow-ups ${pendingBatch + 1} of ${totalPendingBatches}…</span>`;
      } else if (pendingBatch === 0) {
        metaEl.innerHTML = `<span class="subtle">Checking open follow-ups…</span>`;
      }

      const { data } = await fetchInboxSummary({
        date: summaryDate,
        filteredSources: query.filteredSources || "",
        pendingBatch
      });

      totalPendingBatches = data?.meta?.totalPendingBatches ?? 0;
      mergedSections = mergeSummarySections(mergedSections, data?.sections || emptySummarySections());
      lastMeta = data?.meta || {};

      renderSummaryPanel({
        titleEl,
        metaEl,
        messagesEl,
        sections: mergedSections,
        meta: {
          ...lastMeta,
          partial: pendingBatch < totalPendingBatches - 1
        }
      });

      pendingBatch += 1;
    }
  } catch (err) {
    showDetailEmpty(detailEmptyEl, detailContentEl, err.message);
    detailContentEl.hidden = true;
  } finally {
    inboxSummaryInProgress = false;
    if (inboxSummaryBtn) {
      inboxSummaryBtn.disabled = false;
      inboxSummaryBtn.classList.remove("is-loading");
    }
    if (inboxSummaryDateInput) inboxSummaryDateInput.disabled = false;
  }
}

async function selectConversation(conversation) {
  if (!conversation?.id) return;

  selectedConversationId = conversation.id;
  syncUrlToSelection();
  showDetailContent(detailEmptyEl, detailContentEl);

  titleEl.textContent = "Loading…";
  metaEl.innerHTML = "";
  messagesEl.innerHTML = "";

  let full = conversation;
  try {
    const { data } = await getConversation(full.id, {
      ...formToApiQuery(),
      maxPages: 5
    });
    full = data;
    stashConversation(full);
    const idx = allConversations.findIndex((c) => c.id === full.id);
    if (idx >= 0) {
      const { messages, ...summary } = full;
      allConversations[idx] = { ...allConversations[idx], ...summary };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(allConversations));
    }
  } catch (err) {
    if (conversation.messages?.length) {
      full = conversation;
    } else {
      showDetailEmpty(detailEmptyEl, detailContentEl, err.message);
      detailContentEl.hidden = true;
      return;
    }
  }

  renderConversationPanel(full, { titleEl, metaEl, messagesEl });
  renderRows();
}

function findConversationById(id) {
  if (!id) return null;
  return allConversations.find((c) => c.id && String(c.id) === String(id)) || null;
}

function conversationHaystack(row) {
  return [
    row.id,
    row.source,
    row.displayName,
    resolveInboxDisplayName(row),
    row.preview,
    ...(row.messages || []).map((m) => m.content)
  ]
    .join(" ")
    .toLowerCase();
}

function findConversationBySearchTerms(terms) {
  const needles = (terms || []).map((t) => String(t).toLowerCase()).filter(Boolean);
  if (!needles.length) return null;
  return (
    allConversations.find((row) => {
      const hay = conversationHaystack(row);
      return needles.some((needle) => hay.includes(needle));
    }) || null
  );
}

function findConversationWithNameFallback(codeTerms, nameTerms) {
  const codeMatch = findConversationBySearchTerms(codeTerms);
  if (codeMatch) {
    return { match: codeMatch, label: codeTerms[0] || "" };
  }

  const unique = [...new Set((nameTerms || []).map((t) => String(t).trim()).filter((t) => t.length >= 2))];
  const ordered = unique.sort((a, b) => b.length - a.length);

  for (const term of ordered) {
    const needle = term.toLowerCase();
    const candidates = allConversations.filter((row) => conversationHaystack(row).includes(needle));
    if (candidates.length === 1) {
      return { match: candidates[0], label: term };
    }
  }

  return null;
}

async function ensureInboxLoadedForOpen() {
  if (allConversations.length) return;
  if (!inboxFetchInProgress) {
    await loadAllConversations({ background: false });
    return;
  }
  await new Promise((resolve) => {
    const wait = () => {
      if (!inboxFetchInProgress) {
        resolve();
        return;
      }
      setTimeout(wait, 200);
    };
    wait();
  });
}

function renderRows() {
  const filtered = getFilteredConversations();
  const totalPages = getTotalPages(filtered.length);
  clampCurrentPage(totalPages);

  if (!countEl.classList.contains("count-error") && !inboxFetchInProgress) {
    renderInboxCount();
  }

  updatePaginationUi(filtered.length);

  if (!filtered.length) {
    if (inboxFetchInProgress && !inboxFetchComplete) {
      return;
    }
    conversationsListEl.innerHTML =
      '<p class="inbox-thread-empty empty">No conversations found.</p>';
    if (inboxFetchComplete) {
      showDetailPlaceholder("No conversations match your filters.");
    }
    return;
  }

  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  conversationsListEl.innerHTML = pageRows
    .map((row) => {
      const selected = row.id === selectedConversationId ? " row-selected" : "";
      const name = resolveInboxDisplayName(row);
      const nameHtml = name
        ? `<span class="inbox-thread-name contact-name" title="${escapeHtml(name).replace(/"/g, "&quot;")}">${escapeHtml(name)}</span>`
        : '<span class="inbox-thread-name name-missing">Unknown</span>';
      const preview = row.preview
        ? escapeHtml(row.preview)
        : "<span class='subtle'>—</span>";
      const previewTitle = escapeHtml(row.preview || "").replace(/"/g, "&quot;");
      const activityAt = formatInboxListDate(conversationLastActivityAt(row));

      return `
    <button type="button" class="inbox-thread clickable-row${selected}" role="listitem" data-id="${encodeURIComponent(row.id)}">
      <div class="inbox-thread-header">
        <div class="inbox-thread-title">
          ${nameHtml}
          ${sourcePill(row.source)}
        </div>
        <time class="inbox-thread-time">${escapeHtml(activityAt)}</time>
      </div>
      <p class="inbox-thread-preview" title="${previewTitle}">${preview}</p>
    </button>
  `;
    })
    .join("");

  conversationsListEl.querySelectorAll(".inbox-thread").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = decodeURIComponent(btn.dataset.id);
      const conversation = filtered.find((r) => r.id === id);
      if (conversation) {
        stashConversation(conversation);
        selectConversation(conversation);
      }
    });
  });
}

function setCountMessage(message, isError = false) {
  countEl.textContent = message;
  countEl.classList.toggle("count-error", Boolean(isError));
}

async function loadMoreInboxPage() {
  if (!inboxHasMoreFromApi || inboxFetchInProgress) return false;

  inboxFetchInProgress = true;
  setPanelSyncing(panelInbox, true);

  try {
    const { data, meta } = await listConversationsPage({
      ...formToApiQuery(),
      page: inboxApiNextPage,
      size: INBOX_FETCH_PAGE_SIZE
    });

    const rows = data || [];
    const ids = new Set(allConversations.map((c) => c.id));
    for (const row of rows) {
      if (!ids.has(row.id)) {
        allConversations.push(row);
        ids.add(row.id);
      }
    }

    inboxHasMoreFromApi = Boolean(meta?.hasMore);
    inboxApiNextPage += 1;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(allConversations));
    renderRows();
    return rows.length > 0;
  } catch (_err) {
    return false;
  } finally {
    inboxFetchInProgress = false;
    clearPanelLoadState(panelInbox);
  }
}

async function goToPage(page) {
  let totalPages = getTotalPages(getFilteredConversations().length);
  const keyword = searchInput?.value?.trim();

  if (page > totalPages && !keyword && inboxHasMoreFromApi) {
    const loaded = await loadMoreInboxPage();
    if (loaded) {
      totalPages = getTotalPages(getFilteredConversations().length);
    }
  }

  currentPage = Math.min(Math.max(1, page), getTotalPages(getFilteredConversations().length));
  renderRows();
}

async function resolveUrlConversation(query) {
  const urlId = new URLSearchParams(window.location.search).get("id");
  if (!urlId) return;

  const match = findConversationById(urlId);
  if (match) {
    await selectConversation(match);
    return;
  }

  try {
    const { data } = await getConversation(urlId, getConversationLookupQuery());
    await selectConversation(data);
  } catch (_err) {
    showDetailPlaceholder("Conversation not found.");
  }
}

async function loadAllConversations({ background = false } = {}) {
  if (inboxFetchInProgress) return;

  const hadData = allConversations.length > 0;
  const previousSelection = selectedConversationId;
  const coldLoad = !hadData && !background;

  loadBtn.disabled = true;
  inboxFetchInProgress = true;
  saveFiltersToSession();

  if (coldLoad) {
    setPanelLoading(panelInbox, { active: true, initial: true });
    setPanelBusy(panelInbox, true, { disableTabs: true });
    setCountMessage("Loading…");
  } else {
    setPanelSyncing(panelInbox, true);
  }

  const query = formToApiQuery();
  let page = 1;

  try {
    while (true) {
      const { data, meta } = await listConversationsPage({
        ...query,
        page,
        size: INBOX_FETCH_PAGE_SIZE
      });

      allConversations = [...(data || [])];
      inboxHasMoreFromApi = Boolean(meta?.hasMore);
      inboxApiNextPage = page + 1;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(allConversations));
      renderRows();

      if (coldLoad && page === 1) {
        setPanelLoading(panelInbox, { active: false });
        setPanelBusy(panelInbox, false, { disableTabs: false });
      }

      if (page >= INBOX_INITIAL_PAGES) break;
      if (!meta?.hasMore) break;
      page += 1;
    }

    inboxFetchComplete = true;
    lastInboxFetchAt = Date.now();

    if (previousSelection) {
      const match = findConversationById(previousSelection);
      if (match) await selectConversation(match);
    } else if (!hadData) {
      showDetailPlaceholder();
    }

    await resolveUrlConversation(formToQuery());

    if (!countEl.classList.contains("count-error")) {
      renderInboxCount();
    }
  } catch (err) {
    setCountMessage(
      hadData ? `${err.message} (showing cached)` : err.message,
      !hadData
    );
    if (!hadData) {
      renderRows();
    }
  } finally {
    inboxFetchInProgress = false;
    clearPanelLoadState(panelInbox);
    setPanelBusy(panelInbox, false, { disableTabs: false });
    loadBtn.disabled = false;
    if (!countEl.classList.contains("count-error") && inboxFetchComplete) {
      updatePaginationUi(getFilteredConversations().length);
      renderInboxCount();
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  currentPage = 1;
  inboxApiNextPage = 2;
  loadAllConversations({ background: allConversations.length > 0 });
});

resetBtn.addEventListener("click", () => {
  form.reset();
  initDefaultDates();
  if (searchInput) searchInput.value = "";
  updateSearchClearVisibility();
  currentPage = 1;
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(FILTER_STORAGE_KEY);
  allConversations = [];
  inboxFetchComplete = false;
  inboxHasMoreFromApi = false;
  inboxApiNextPage = 2;
  showDetailPlaceholder();
  setCountMessage("—");
  conversationsListEl.innerHTML =
    '<p class="inbox-thread-empty empty">No conversations loaded.</p>';
  updatePaginationUi(0);
});

searchInput?.addEventListener("input", () => {
  currentPage = 1;
  updateSearchClearVisibility();
  renderRows();
});

searchClearBtn?.addEventListener("click", () => {
  clearInboxSearch();
  searchInput?.focus();
});

loadBtn.addEventListener("click", () => {
  loadAllConversations({ background: allConversations.length > 0 });
});

inboxSummaryBtn?.addEventListener("click", () => {
  loadInboxSummary();
});

document.querySelector(".inbox-summary-date-wrap")?.addEventListener("click", (event) => {
  if (!inboxSummaryDateInput || inboxSummaryDateInput.disabled) return;
  if (event.target === inboxSummaryDateInput) return;
  if (typeof inboxSummaryDateInput.showPicker === "function") {
    event.preventDefault();
    inboxSummaryDateInput.showPicker();
  }
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

countEl?.addEventListener("click", (event) => {
  if (event.target.closest(".inbox-show-all")) {
    clearInboxSearch();
  }
});

window.addEventListener("chatbase-open-conversation", async (event) => {
  const { searchTerms = [], searchLabel = "", nameSearchTerms = [] } = event.detail || {};
  const terms = searchTerms.length ? searchTerms : (searchLabel ? [searchLabel] : []);
  if (!terms.length && !nameSearchTerms.length) return;

  switchTab("inbox");
  await ensureInboxLoadedForOpen();

  const found = findConversationWithNameFallback(terms, nameSearchTerms);
  if (found?.match) {
    if (searchInput) {
      searchInput.value = found.label || searchLabel || terms[0] || "";
      currentPage = 1;
      updateSearchClearVisibility();
    }
    await selectConversation(found.match);
    renderRows();
    return;
  }

  if (searchLabel && searchInput) {
    searchInput.value = searchLabel;
    currentPage = 1;
    updateSearchClearVisibility();
    renderRows();
  }
  showDetailPlaceholder(
    `No thread found for "${searchLabel || terms[0]}". Tried name too — hit Refresh on Inbox, then search.`
  );
});

initDefaultDates();
restoreFiltersFromSession();
updateSearchClearVisibility();
initPaymentsTab();
initTabs();
showDetailPlaceholder();

if (inboxSummaryDateInput) {
  inboxSummaryDateInput.value = todayIsoInManila();
}

const cached = sessionStorage.getItem(STORAGE_KEY);
if (cached) {
  try {
    allConversations = JSON.parse(cached);
    if (allConversations.length) {
      inboxApiNextPage = Math.max(2, Math.ceil(allConversations.length / INBOX_FETCH_PAGE_SIZE) + 1);
      renderRows();
      renderInboxCount();
      const urlId = new URLSearchParams(window.location.search).get("id");
      if (urlId) {
        const match = findConversationById(urlId);
        if (match) selectConversation(match);
      }
    }
  } catch (_err) {
    allConversations = [];
  }
}

if (!allConversations.length) {
  setPanelLoading(panelInbox, { active: true, initial: true });
  setPanelBusy(panelInbox, true, { disableTabs: true });
  setCountMessage("Loading…");
}

loadAllConversations({ background: allConversations.length > 0 });

setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (!isInboxTabActive()) return;
  if (inboxFetchInProgress) return;
  if (!inboxFetchComplete || !isInboxFetchStale()) return;
  if (inboxApiNextPage > INBOX_INITIAL_PAGES + 1) return;
  loadAllConversations({ background: true });
}, REFRESH_STALE_MS);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!isInboxTabActive()) return;
  if (inboxFetchInProgress) return;
  if (!inboxFetchComplete || !isInboxFetchStale()) return;
  if (inboxApiNextPage > INBOX_INITIAL_PAGES + 1) return;
  loadAllConversations({ background: true });
});
