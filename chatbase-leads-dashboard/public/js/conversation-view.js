import {
  clientNameSearchTerms,
  conversationLastActivityAt,
  formatActivityDate,
  getConversationHeading,
  shortenSource
} from "./format.js";
import { formatSummaryHtml, formatSummarySectionsHtml } from "./format-summary.js";
import { getClientNameForConversation } from "./lead-inbox-names.js";
import { resolveDisplayName } from "./name-infer.js";

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Open Inbox and find the thread by name / user tag (or payment order#). Prefer display name over booking codes. */
export function openConversationInInbox(searchLabel, searchTerms = [], { clientName } = {}) {
  const terms = searchTerms.length ? searchTerms : (searchLabel ? [searchLabel] : []);
  const nameSearchTerms = clientNameSearchTerms(clientName);
  if (!terms.length && !nameSearchTerms.length) return;
  const label = searchLabel || clientName || terms[0] || "";
  window.dispatchEvent(
    new CustomEvent("chatbase-open-conversation", {
      detail: {
        searchTerms: terms,
        searchLabel: label,
        nameSearchTerms
      }
    })
  );
}

export function scrollMessagesToBottom(messagesEl) {
  const scrollContainer = messagesEl.closest(".split-detail") || messagesEl;
  requestAnimationFrame(() => {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  });
}

export function renderConversationPanel(conversation, { titleEl, metaEl, messagesEl, emailBtnEl }) {
  if (emailBtnEl) emailBtnEl.hidden = true;

  const displayName =
    getClientNameForConversation(conversation?.id) || resolveDisplayName(conversation);
  if (displayName && !conversation.displayName) {
    conversation.displayName = displayName;
  }

  titleEl.textContent = getConversationHeading(conversation, displayName);

  const nameLine = displayName
    ? `<span class="contact-name">${escapeHtml(displayName)}</span>`
    : `<span class="subtle name-missing">No name detected</span>`;

  metaEl.innerHTML = `
    ${nameLine}
    <span class="source-pill" title="${escapeHtml(conversation.source)}">${escapeHtml(shortenSource(conversation.source))}</span>
    <span class="subtle">${formatActivityDate(conversationLastActivityAt(conversation))}</span>
  `;

  const messages = conversation.messages || [];
  if (!messages.length) {
    messagesEl.innerHTML = '<p class="empty">No messages in this conversation.</p>';
    return;
  }

  const userLabel = displayName || "User";
  messagesEl.innerHTML = messages.map((message) => {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = escapeHtml(message.content);
    const label = role === "assistant" ? "Agent" : userLabel;
    return `
      <article class="message message-${role}">
        <header>${escapeHtml(label)}</header>
        <div class="message-body">${content || "<span class='subtle'>—</span>"}</div>
      </article>
    `;
  }).join("");

  scrollMessagesToBottom(messagesEl);
}

export function showDetailEmpty(emptyEl, contentEl, message = "Select a conversation") {
  emptyEl.hidden = false;
  emptyEl.textContent = message;
  contentEl.hidden = true;
}

export function showDetailContent(emptyEl, contentEl) {
  emptyEl.hidden = true;
  contentEl.hidden = false;
}

function escapeSummaryText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function summaryTitleForDate(iso, { todayIso } = {}) {
  const today = todayIso || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  if (iso === today) return "Today's summary";
  const d = new Date(`${iso}T12:00:00`);
  const label = Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${label} summary`;
}

export function renderSummaryPanel({ titleEl, metaEl, messagesEl, emailBtnEl, summary, sections, meta }) {
  titleEl.textContent = meta?.date ? summaryTitleForDate(meta.date) : "Today's summary";
  if (emailBtnEl) {
    emailBtnEl.hidden = false;
    emailBtnEl.disabled = Boolean(meta?.partial);
  }

  const parts = [];
  if (meta?.phase !== "pending" && meta?.threadCount != null) {
    const n = meta.threadCount;
    parts.push(`${n} conversation${n === 1 ? "" : "s"}`);
  }
  if (meta?.date) {
    const d = new Date(`${meta.date}T12:00:00`);
    const dateLabel = Number.isNaN(d.getTime())
      ? meta.date
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    parts.push(dateLabel);
  }
  if (meta?.phase === "pending" && meta?.partial && meta?.totalPendingBatches > 1) {
    const done = (meta.pendingBatch ?? 0) + 1;
    parts.push(`follow-ups ${done}/${meta.totalPendingBatches}`);
  } else if (meta?.phase !== "pending" && meta?.partial && meta?.totalBatches > 1) {
    const done = (meta.batch ?? 0) + 1;
    parts.push(`batch ${done}/${meta.totalBatches}`);
  }

  metaEl.innerHTML = parts.length
    ? `<span class="subtle">${escapeSummaryText(parts.join(" · "))}</span>`
    : "";

  const bodyHtml = sections
    ? formatSummarySectionsHtml(sections)
    : formatSummaryHtml(summary);
  messagesEl.innerHTML = `<div class="inbox-summary-body">${bodyHtml}</div>`;
  const scrollContainer = messagesEl.closest(".split-detail") || messagesEl;
  requestAnimationFrame(() => {
    scrollContainer.scrollTop = 0;
  });
}
