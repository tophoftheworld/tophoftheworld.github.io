const {
  getChatbaseClientFromEnv,
  getDefaultMaxPages,
  getDefaultPageSize,
  normalizeConversation,
} = require("./chatbase");
const { normalizeOrderNumber } = require("./shopify-admin");

const NEAR_EVENT_DAYS_BEFORE = 7;
const NEAR_EVENT_DAYS_AFTER = 2;
const ANCHOR_BUFFER_DAYS_BEFORE = 3;
const MAX_SPAN_DAYS = 400;

function pickString(body, keys) {
  if (!body || typeof body !== "object") return null;
  for (const key of keys) {
    const val = body[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      return String(val).trim();
    }
  }
  return null;
}

function pickConversationId(body) {
  return pickString(body, [
    "conversationId",
    "conversation_id",
    "chatId",
    "chat_id",
  ]);
}

function parseDateInput(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Build Chatbase API date windows from when the webhook fired and an optional anchor
 * (lead createdAt, Shopify order createdAt). Tries tight window around the event first,
 * then the full span from anchor → event.
 */
function buildSearchWindows({ loggedAt, anchorDate } = {}) {
  const event = parseDateInput(loggedAt) || new Date();
  const anchor = parseDateInput(anchorDate) || event;
  const spanStart = anchor.getTime() < event.getTime() ? anchor : event;

  const end = addDays(event, NEAR_EVENT_DAYS_AFTER);
  const nearStart = addDays(event, -NEAR_EVENT_DAYS_BEFORE);

  let wideStart = addDays(new Date(spanStart), -ANCHOR_BUFFER_DAYS_BEFORE);
  const maxStart = addDays(event, -MAX_SPAN_DAYS);
  if (wideStart.getTime() < maxStart.getTime()) {
    wideStart = maxStart;
  }

  const windows = [
    {
      startDate: toDateString(nearStart),
      endDate: toDateString(end),
      phase: "nearEvent",
    },
  ];

  const wideKey = `${toDateString(wideStart)}:${toDateString(end)}`;
  const nearKey = `${toDateString(nearStart)}:${toDateString(end)}`;
  if (wideKey !== nearKey) {
    windows.push({
      startDate: toDateString(wideStart),
      endDate: toDateString(end),
      phase: "sinceAnchor",
    });
  }

  return windows;
}

function messageTexts(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((m) => String(m?.content || m?.text || "").trim())
    .filter(Boolean);
}

function conversationHaystack(messages) {
  return messageTexts(messages).join("\n");
}

function haystackIncludesTerm(haystack, term) {
  const needle = String(term || "").toLowerCase();
  if (!needle) return false;
  return haystack.toLowerCase().includes(needle);
}

function orderNumberSearchTerms(orderNumber) {
  const normalized = normalizeOrderNumber(orderNumber);
  if (!normalized) return [];
  const terms = new Set([normalized, normalized.toLowerCase()]);
  const digits = normalized.replace(/^M#?/i, "");
  if (digits) {
    terms.add(digits);
    terms.add(`#${digits}`);
    terms.add(`m#${digits}`);
    terms.add(`M#${digits}`);
    terms.add(`order ${digits}`);
    terms.add(`order #${digits}`);
    terms.add(`order m#${digits}`);
    terms.add(`order M#${digits}`);
  }
  return [...terms];
}

function quoteReferenceSearchTerms(quoteReference) {
  const ref = String(quoteReference || "").trim().toUpperCase();
  if (!ref) return [];
  return [
    ref,
    ref.toLowerCase(),
    `reference ${ref}`,
    `reference: ${ref}`,
    `quote ${ref}`,
    `quote reference ${ref}`,
    `booking reference ${ref}`,
    `ref ${ref}`,
  ];
}

async function scanRecentConversations({ matchRow, options = {} }) {
  const client = getChatbaseClientFromEnv();
  const size = options.size ?? getDefaultPageSize();
  const maxPages = options.maxPages ?? getDefaultMaxPages();
  const startDate = options.startDate;
  const endDate = options.endDate;

  if (!startDate) return null;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await client.getConversations({
      startDate,
      endDate: endDate || undefined,
      page,
      size,
      filteredSources: options.filteredSources || "",
    });
    const rows = result?.data || [];
    for (const row of rows) {
      const messages = Array.isArray(row.messages) ? row.messages : [];
      if (matchRow(row, messages)) {
        const normalized = normalizeConversation(row);
        return normalized.id || null;
      }
    }
    if (rows.length < size) break;
  }

  return null;
}

async function findInInboxWithWindows(matchRow, options = {}) {
  const windows = buildSearchWindows(options);
  for (const window of windows) {
    const id = await scanRecentConversations({
      ...options,
      startDate: window.startDate,
      endDate: window.endDate,
      matchRow,
    });
    if (id) return id;
  }
  return null;
}

async function findConversationIdByOrderNumber(orderNumber, options = {}) {
  const terms = orderNumberSearchTerms(orderNumber);
  if (!terms.length) return null;

  return findInInboxWithWindows((_row, messages) => {
    const haystack = conversationHaystack(messages);
    return terms.some((term) => haystackIncludesTerm(haystack, term));
  }, options);
}

async function findConversationIdByQuoteReference(quoteReference, options = {}) {
  const terms = quoteReferenceSearchTerms(quoteReference);
  if (!terms.length) return null;

  return findInInboxWithWindows((_row, messages) => {
    const haystack = conversationHaystack(messages);
    return terms.some((term) => haystackIncludesTerm(haystack, term));
  }, options);
}

async function resolveConversationIdForPayment({
  conversationId,
  orderNumber,
  loggedAt,
  anchorDate,
} = {}) {
  if (conversationId) {
    return { conversationId, via: "body" };
  }

  const normalized = normalizeOrderNumber(orderNumber) || orderNumber;
  if (normalized) {
    const byOrder = await findConversationIdByOrderNumber(normalized, {
      loggedAt,
      anchorDate,
    });
    if (byOrder) {
      return { conversationId: byOrder, via: "orderNumber" };
    }
  }

  return { conversationId: null, via: null };
}

async function resolveConversationIdForLead({
  conversationId,
  quoteReference,
  loggedAt,
  anchorDate,
} = {}) {
  if (conversationId) {
    return { conversationId, via: "body" };
  }

  const ref = String(quoteReference || "").trim().toUpperCase();
  if (ref) {
    const byRef = await findConversationIdByQuoteReference(ref, {
      loggedAt,
      anchorDate,
    });
    if (byRef) {
      return { conversationId: byRef, via: "quoteReference" };
    }
  }

  return { conversationId: null, via: null };
}

module.exports = {
  pickConversationId,
  findConversationIdByOrderNumber,
  findConversationIdByQuoteReference,
  resolveConversationIdForPayment,
  resolveConversationIdForLead,
  buildSearchWindows,
  orderNumberSearchTerms,
  quoteReferenceSearchTerms,
  MAX_SPAN_DAYS,
};
