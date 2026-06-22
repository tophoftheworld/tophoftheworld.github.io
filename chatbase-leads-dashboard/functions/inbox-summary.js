const DEFAULT_TZ = "Asia/Manila";
/** Chatbase /chat user message limit */
const CHATBASE_MAX_CHARS = 8000;
const PROMPT_INSTRUCTION_RESERVE = 1200;
const MAX_TRANSCRIPT_CHARS = CHATBASE_MAX_CHARS - PROMPT_INSTRUCTION_RESERVE;
const PENDING_LOOKBACK_DAYS = 5;
/** Last N in-window messages per thread (5-day window can be much longer than a single day). */
const PENDING_MAX_MESSAGES_PER_THREAD = 10;
const PENDING_MAX_MESSAGE_CHARS = 320;
const PROMPT_BUDGET_BUFFER = 128;

const SECTION_ALIASES = {
  "awaiting reply": "awaitingReply",
  "awaiting replies": "awaitingReply",
  "pending replies": "awaitingReply",
  urgent: "urgent",
  topics: "topics",
  leads: "leads",
  payments: "payments",
  "follow-ups": "followUps",
  "follow ups": "followUps",
  followups: "followUps"
};

function todayDateInTz(tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function calendarDateInTz(iso, tz = DEFAULT_TZ) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

function isActivityOnDate(iso, date, tz = DEFAULT_TZ) {
  return calendarDateInTz(iso, tz) === date;
}

function apiEndDateInclusive(dateStr) {
  const end = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(end.getTime())) return dateStr;
  end.setDate(end.getDate() + 1);
  return end.toISOString().slice(0, 10);
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function compareDateStr(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function isDateInRange(date, start, endInclusive) {
  return compareDateStr(date, start) >= 0 && compareDateStr(date, endInclusive) <= 0;
}

function normalizeLine(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ");
}

function truncateForPrompt(text, maxChars = PENDING_MAX_MESSAGE_CHARS) {
  const t = normalizeLine(text);
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** AI filler when a section is empty — drop on parse/merge so batches don't pollute each other. */
function isPlaceholderSummaryBullet(text) {
  const t = normalizeLine(text);
  if (!t) return true;
  const lower = t.toLowerCase().replace(/\.+$/, "");

  if (/^(none|n\/a|na|nil|nothing|—|-)$/.test(lower)) return true;
  if (/^none\s+flagged/.test(lower)) return true;
  if (/\bin this batch$/.test(lower) && (/\bno\b/.test(lower) || /\bnone\b/.test(lower))) return true;
  if (/\bnothing\s+to\s+report\b/.test(lower)) return true;
  if (/\bno\s+items?\s+to\s+report\b/.test(lower)) return true;

  return false;
}

function messagesOnDate(messages, date, tz = DEFAULT_TZ) {
  return (messages || []).filter((m) => {
    const content = normalizeLine(m.content);
    if (!content) return false;
    return isActivityOnDate(m.createdAt, date, tz);
  });
}

function shortenSource(source) {
  const s = String(source || "").toLowerCase();
  if (s.includes("instagram")) return "IG";
  if (s.includes("messenger")) return "FB";
  if (s.includes("whatsapp")) return "WA";
  if (s.includes("widget") || s.includes("site")) return "Web";
  return String(source || "?").slice(0, 8);
}

function formatThreadForPrompt(conv, { index, date, tz = DEFAULT_TZ, maxBlockChars } = {}) {
  let todayMessages = messagesOnDate(conv.messages, date, tz);
  if (!todayMessages.length) return null;

  const name = conv.displayName || "?";
  const src = shortenSource(conv.source);
  const lines = todayMessages.map((m) => {
    const prefix = m.role === "assistant" ? "A" : "U";
    return `${prefix}: ${normalizeLine(m.content)}`;
  });

  let block = `[${index + 1}] ${src} / ${name}\n${lines.join("\n")}`;
  if (maxBlockChars && block.length > maxBlockChars) {
    while (lines.length > 2 && block.length > maxBlockChars) {
      lines.shift();
      block = `[${index + 1}] ${src} / ${name}\n${lines.join("\n")}`;
    }
    if (block.length > maxBlockChars) {
      block = `${block.slice(0, Math.max(0, maxBlockChars - 16))}\n…(truncated)`;
    }
  }

  return block;
}

function blockLengthForThread(conv, date, tz, index = 0, maxBlockChars) {
  const block = formatThreadForPrompt(conv, { index, date, tz, maxBlockChars });
  return block ? block.length : 0;
}

function dayTranscriptCharBudget(dateLabel, { batchIndex = 0, totalBatches = 2, threadCount = 0 } = {}) {
  const headerLen = instructionHeader(dateLabel, { batchIndex, totalBatches, threadCount }).length;
  return Math.max(1500, CHATBASE_MAX_CHARS - headerLen - PROMPT_BUDGET_BUFFER);
}

function packThreadsIntoDayBatches(threads, date, tz, totalBatches, budgetSkim = 0) {
  const batches = [];
  let current = [];
  let used = 0;
  let globalIndex = 0;

  const budgetFor = (batchIndex, threadCount) =>
    dayTranscriptCharBudget(date, { batchIndex, totalBatches, threadCount }) - budgetSkim;

  const measureBlock = (conv, index, maxChars) => {
    let len = blockLengthForThread(conv, date, tz, index);
    if (!len) return 0;
    if (len > maxChars) len = blockLengthForThread(conv, date, tz, index, maxChars);
    return len;
  };

  const startNewBatch = () => {
    if (current.length) batches.push(current);
    current = [];
    used = 0;
  };

  for (const conv of threads) {
    const probeLen = blockLengthForThread(conv, date, tz, globalIndex);
    if (!probeLen) continue;

    const batchIndex = batches.length;
    const maxChars = budgetFor(batchIndex, current.length + 1);
    let blockLen = measureBlock(conv, globalIndex, maxChars);
    const separator = current.length ? 2 : 0;

    if (current.length && used + separator + blockLen > maxChars) {
      startNewBatch();
      const nextBatchIndex = batches.length;
      const nextMaxChars = budgetFor(nextBatchIndex, 1);
      blockLen = measureBlock(conv, globalIndex, nextMaxChars);
      current = [conv];
      used = blockLen;
    } else {
      current.push(conv);
      used += separator + blockLen;
    }

    globalIndex += 1;
  }

  if (current.length) batches.push(current);
  return batches;
}

function verifyDayBatchesFit(batches, date, tz) {
  let offset = 0;
  for (let i = 0; i < batches.length; i += 1) {
    buildBatchPrompt(batches[i], date, tz, {
      batchIndex: i,
      totalBatches: batches.length,
      threadOffset: offset
    });
    offset += batches[i].length;
  }
}

/** Pack threads into batches that each fit the transcript char budget. */
function splitThreadsIntoBatches(threads, date, tz, maxCharsOverride) {
  if (maxCharsOverride != null) {
    const skim = dayTranscriptCharBudget(date) - maxCharsOverride;
    return packThreadsIntoDayBatches(threads, date, tz, 2, Math.max(0, skim));
  }

  let totalBatches = 2;
  let budgetSkim = 0;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const batches = packThreadsIntoDayBatches(threads, date, tz, totalBatches, budgetSkim);
    if (batches.length > totalBatches) {
      totalBatches = batches.length;
      continue;
    }

    try {
      verifyDayBatchesFit(batches, date, tz);
      return batches;
    } catch {
      budgetSkim += 64;
      totalBatches = Math.max(totalBatches, batches.length);
    }
  }

  throw new Error("Unable to split inbox threads within Chatbase prompt limit");
}

function buildTranscriptForThreads(threads, date, tz, threadOffset = 0, { maxTotalChars } = {}) {
  const blocks = [];
  let used = 0;

  for (let i = 0; i < threads.length; i += 1) {
    const conv = threads[i];
    const index = threadOffset + i;
    let blockLen = blockLengthForThread(conv, date, tz, index);
    if (!blockLen) continue;

    const separator = blocks.length ? 2 : 0;
    const remaining = maxTotalChars != null ? maxTotalChars - used - separator : null;
    let block;
    if (remaining != null && blockLen > remaining) {
      block = formatThreadForPrompt(conv, {
        index,
        date,
        tz,
        maxBlockChars: Math.max(80, remaining)
      });
    } else {
      block = formatThreadForPrompt(conv, { index, date, tz });
    }
    if (!block) continue;

    blocks.push(block);
    used += separator + block.length;
  }

  return { text: blocks.join("\n\n"), count: blocks.length };
}

function instructionHeader(dateLabel, { batchIndex = 0, totalBatches = 1, threadCount = 0 } = {}) {
  const batchLine =
    totalBatches > 1
      ? `Batch ${batchIndex + 1} of ${totalBatches}. Summarize ONLY the threads in this batch. If a section has nothing in this batch, omit the entire section — never write "none", "no items in this batch", or similar.\n\n`
      : "";

  return `Internal ops brief for Matchanese (${dateLabel}). Summarize ONLY today's messages below. Write for operators skimming quickly. No greeting. Never mention thread counts or channel splits.

${batchLine}Use these exact section headings only when you have real items. Omit empty sections entirely — no heading, no bullets, no "none"/"N/A"/"nothing in this batch" placeholders.

Urgent
- Same-day human action only: emergencies, serious complaints, VIP issues, or clear dropped balls. One short line per item.

Topics
- Recurring themes as "Label: short phrase" (e.g. "MOA: Pop-up location inquiries", "Public workshops: Schedule and signup questions"). One line each. Stay brief; only add detail for something new or unusual. Public/group workshops at matchanese.com/workshop are Topics, NOT Leads.

Leads
- High-value only: private Mobile Matcha Bar events, private matcha workshops (booked for a group/event), brand or partnership collabs. Name + one-line status. Do NOT list public workshop signups or general workshop FAQ here — those belong under Topics. Leads are auto-logged — note quote stage or missing info, not "please log lead".

Payments
- Workshop or Shopify payment proofs/confirmations. Order ref + name + outcome.

Follow-ups
- ONLY same-day items where a human must act (promised callback, quote to send today, escalation). Skip old unreplied threads — those appear under Awaiting reply separately. Skip resolved items and routine FAQ the bot already handled.

Under 350 words. Bullets with "-" only. No sub-bullets.

Today's messages (${threadCount} thread${threadCount === 1 ? "" : "s"}):

`;
}

function buildBatchPrompt(threads, dateLabel, tz, { batchIndex, totalBatches, threadOffset }) {
  let threadCount = threads.length;
  let headerLen = instructionHeader(dateLabel, { batchIndex, totalBatches, threadCount }).length;
  let transcriptBudget = CHATBASE_MAX_CHARS - headerLen - PROMPT_BUDGET_BUFFER;
  let { text: transcript, count } = buildTranscriptForThreads(threads, dateLabel, tz, threadOffset, {
    maxTotalChars: transcriptBudget
  });

  let header = instructionHeader(dateLabel, { batchIndex, totalBatches, threadCount: count });
  let prompt = `${header}${transcript}`;

  if (prompt.length > CHATBASE_MAX_CHARS && transcript.length > 0) {
    const overrun = prompt.length - CHATBASE_MAX_CHARS;
    transcriptBudget = Math.max(80, transcriptBudget - overrun - 8);
    ({ text: transcript, count } = buildTranscriptForThreads(threads, dateLabel, tz, threadOffset, {
      maxTotalChars: transcriptBudget
    }));
    header = instructionHeader(dateLabel, { batchIndex, totalBatches, threadCount: count });
    prompt = `${header}${transcript}`;
  }

  if (prompt.length > CHATBASE_MAX_CHARS) {
    throw new Error(`Batch ${batchIndex + 1} prompt exceeds Chatbase limit (${prompt.length} chars)`);
  }
  return prompt;
}

function buildSummaryPrompt(threads, dateLabel, tz = DEFAULT_TZ) {
  return buildBatchPrompt(threads, dateLabel, tz, {
    batchIndex: 0,
    totalBatches: 1,
    threadOffset: 0
  });
}

function isBulletLine(line) {
  return /^[-•*]\s+/.test(line) || /^\d+\.\s+/.test(line);
}

function bulletContent(line) {
  const m = line.match(/^[-•*]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
  return m ? m[1].trim() : line.trim();
}

function resolveSectionKey(line) {
  const key = line.replace(/:+$/, "").trim().toLowerCase();
  return SECTION_ALIASES[key] || null;
}

function emptySections() {
  return { awaitingReply: [], urgent: [], topics: [], leads: [], payments: [], followUps: [] };
}

function parseSummarySections(text) {
  const sections = emptySections();
  let current = null;

  for (const raw of String(text || "").split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (!isBulletLine(trimmed)) {
      const key = resolveSectionKey(trimmed);
      if (key) {
        current = key;
        continue;
      }
      if (current) {
        if (!isPlaceholderSummaryBullet(trimmed)) sections[current].push(trimmed);
        continue;
      }
    }

    if (isBulletLine(trimmed) && current) {
      const content = bulletContent(trimmed);
      if (!isPlaceholderSummaryBullet(content)) sections[current].push(content);
    }
  }

  return sections;
}

function mergeSections(a, b) {
  const out = emptySections();
  for (const key of Object.keys(out)) {
    const seen = new Set();
    for (const src of [a, b]) {
      for (const item of src?.[key] || []) {
        if (isPlaceholderSummaryBullet(item)) continue;
        const norm = normalizeLine(item).toLowerCase();
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        out[key].push(item);
      }
    }
  }
  return out;
}

const SECTION_LABELS = [
  ["urgent", "Urgent"],
  ["topics", "Topics"],
  ["leads", "Leads"],
  ["payments", "Payments"],
  ["followUps", "Follow-ups"],
  ["awaitingReply", "Awaiting reply"]
];

function sectionsToText(sections) {
  const parts = [];
  for (const [key, label] of SECTION_LABELS) {
    const items = sections[key];
    if (!items?.length) continue;
    parts.push(label);
    for (const item of items) parts.push(`- ${item}`);
    parts.push("");
  }
  return parts.join("\n").trim();
}

function sortByLastActivity(threads) {
  return [...threads].sort((a, b) => {
    const ta = new Date(a.lastActivityAt || a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.lastActivityAt || b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
}

function countMessagesOnDate(threads, date, tz) {
  return threads.reduce((n, conv) => n + messagesOnDate(conv.messages, date, tz).length, 0);
}

function pendingRangeForSummary(summaryDate) {
  return {
    rangeStart: addDaysToDateStr(summaryDate, -PENDING_LOOKBACK_DAYS),
    rangeEnd: addDaysToDateStr(summaryDate, -1)
  };
}

function messagesInDateRange(messages, rangeStart, rangeEnd, tz = DEFAULT_TZ) {
  return (messages || []).filter((m) => {
    const content = normalizeLine(m.content);
    if (!content) return false;
    const msgDate = calendarDateInTz(m.createdAt, tz);
    if (!msgDate) return false;
    return isDateInRange(msgDate, rangeStart, rangeEnd);
  });
}

/** In-range customer/agent exchange for one thread — not full history. */
function messagesForPendingWindow(messages, rangeStart, rangeEnd, tz = DEFAULT_TZ) {
  const msgs = (messages || []).filter((m) => normalizeLine(m.content));
  if (!msgs.length) return [];

  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < msgs.length; i += 1) {
    const msgDate = calendarDateInTz(msgs[i].createdAt, tz);
    if (!msgDate || !isDateInRange(msgDate, rangeStart, rangeEnd)) continue;
    if (firstIdx < 0) firstIdx = i;
    lastIdx = i;
  }
  if (firstIdx < 0) return [];

  let endIdx = lastIdx;
  while (endIdx + 1 < msgs.length && msgs[endIdx + 1].role === "assistant") {
    endIdx += 1;
  }

  return msgs.slice(firstIdx, endIdx + 1);
}

function pendingTranscriptCharBudget(summaryDate, rangeStart, rangeEnd, { batchIndex = 0, totalBatches = 2 } = {}) {
  const headerLen = pendingInstructionHeader(summaryDate, rangeStart, rangeEnd, {
    batchIndex,
    totalBatches,
    threadCount: 0
  }).length;
  return Math.max(1500, CHATBASE_MAX_CHARS - headerLen - PROMPT_BUDGET_BUFFER);
}

function formatThreadForPendingPrompt(
  conv,
  { index, rangeStart, rangeEnd, tz = DEFAULT_TZ, maxBlockChars } = {}
) {
  let windowMessages = messagesForPendingWindow(conv.messages, rangeStart, rangeEnd, tz);
  if (!windowMessages.length) return null;

  if (windowMessages.length > PENDING_MAX_MESSAGES_PER_THREAD) {
    windowMessages = windowMessages.slice(-PENDING_MAX_MESSAGES_PER_THREAD);
  }

  const name = conv.displayName || "?";
  const src = shortenSource(conv.source);
  const lines = windowMessages.map((m) => {
    const prefix = m.role === "assistant" ? "A" : "U";
    return `${prefix}: ${truncateForPrompt(m.content)}`;
  });

  let block = `[${index + 1}] ${src} / ${name}\n${lines.join("\n")}`;
  if (maxBlockChars && block.length > maxBlockChars) {
    while (lines.length > 2 && block.length > maxBlockChars) {
      lines.shift();
      block = `[${index + 1}] ${src} / ${name}\n${lines.join("\n")}`;
    }
    if (block.length > maxBlockChars) {
      block = `${block.slice(0, Math.max(0, maxBlockChars - 16))}\n…(truncated)`;
    }
  }

  return block;
}

function blockLengthForPendingThread(conv, rangeStart, rangeEnd, tz, maxBlockChars) {
  const block = formatThreadForPendingPrompt(conv, {
    index: 0,
    rangeStart,
    rangeEnd,
    tz,
    maxBlockChars
  });
  return block ? block.length : 0;
}

function splitThreadsIntoPendingBatches(threads, summaryDate, tz, maxCharsOverride) {
  const { rangeStart, rangeEnd } = pendingRangeForSummary(summaryDate);
  const maxChars = maxCharsOverride ?? pendingTranscriptCharBudget(summaryDate, rangeStart, rangeEnd);
  const batches = [];
  let current = [];
  let used = 0;

  for (const conv of threads) {
    let blockLen = blockLengthForPendingThread(conv, rangeStart, rangeEnd, tz);
    if (!blockLen) continue;

    if (blockLen > maxChars) {
      blockLen = blockLengthForPendingThread(conv, rangeStart, rangeEnd, tz, maxChars);
    }

    const separator = current.length ? 2 : 0;
    if (current.length && used + separator + blockLen > maxChars) {
      batches.push(current);
      current = [conv];
      used = blockLen;
      continue;
    }

    current.push(conv);
    used += separator + blockLen;
  }

  if (current.length) batches.push(current);
  return batches;
}

function assertPendingBatchFits(prompt, batchIndex) {
  if (prompt.length > CHATBASE_MAX_CHARS) {
    throw new Error(
      `Pending batch ${batchIndex + 1} prompt exceeds Chatbase limit (${prompt.length} chars)`
    );
  }
}

function pendingInstructionHeader(
  summaryDate,
  rangeStart,
  rangeEnd,
  { batchIndex = 0, totalBatches = 1, threadCount = 0 } = {}
) {
  const batchLine =
    totalBatches > 1
      ? `Batch ${batchIndex + 1} of ${totalBatches}. Review ONLY the threads in this batch. If nothing here needs follow-up, omit the section — never write "none" or "nothing in this batch".\n\n`
      : "";

  return `Internal ops brief — high-priority open follow-ups (summary date ${summaryDate}). Messages below are ONLY from ${rangeStart} through ${rangeEnd} (the ${PENDING_LOOKBACK_DAYS} days before ${summaryDate}, not ${summaryDate}). The bot always auto-replies. Your job: flag only threads where a human still owes a consequential action.

${batchLine}For each thread, score importance 1–10 (business/revenue/risk). Include ONLY if score ≥7.5. When in doubt, EXCLUDE. Sort highest score first. Max 8 bullets in this batch.

≥7.5 — INCLUDE: complaint or frustrated customer needing fix; refund; payment proof/status check; registration or booking confirmation after fee/deposit; quotation/invoice/proposal to send or customer ready to reserve; partnership/collab email awaiting human reply; paid order shipping delay; private event/workshop quote awaiting human decision or final confirmation doc.

<7.5 — NEVER INCLUDE: user silent after bot greeting only; "re-engage", "close the loop", or "hasn't said what they need yet"; generic workshop FAQ already answered with link; restock/schedule curiosity (notify-me on site is enough); optional soft check-ins ("ask if they have questions", "ask if they hit notify me"); clarifying bar vs workshop when no quote/booking yet unless high-value event imminent.

Do not repeat items that are routine today's follow-ups unless the human action was promised on a prior day and is still undone.

Output ONLY this section if ≥7.5 items exist. Omit entirely if none — no placeholders.

Awaiting reply
- "Name (channel) — Nd open — one-line action owed"

Threads (${threadCount}):

`;
}

function buildPendingBatchPrompt(threads, summaryDate, rangeStart, rangeEnd, tz, { batchIndex, totalBatches, threadOffset }) {
  const blocks = threads
    .map((conv, i) =>
      formatThreadForPendingPrompt(conv, { index: threadOffset + i, rangeStart, rangeEnd, tz })
    )
    .filter(Boolean);
  const header = pendingInstructionHeader(summaryDate, rangeStart, rangeEnd, {
    batchIndex,
    totalBatches,
    threadCount: blocks.length
  });
  const prompt = `${header}${blocks.join("\n\n")}`;
  assertPendingBatchFits(prompt, batchIndex);
  return prompt;
}

function buildPendingSummaryPrompt(threads, summaryDate, tz = DEFAULT_TZ) {
  const { rangeStart, rangeEnd } = pendingRangeForSummary(summaryDate);
  return buildPendingBatchPrompt(threads, summaryDate, rangeStart, rangeEnd, tz, {
    batchIndex: 0,
    totalBatches: 1,
    threadOffset: 0
  });
}

async function fetchThreadsForPendingSummary({ client, date, filteredSources, tz }) {
  const summaryDate = date || todayDateInTz(tz);
  const { rangeStart, rangeEnd } = pendingRangeForSummary(summaryDate);
  const apiEnd = apiEndDateInclusive(rangeEnd);

  const { data: fetched } = await client.fetchAllConversations({
    startDate: rangeStart,
    endDate: apiEnd,
    filteredSources,
    maxPages: 20
  });

  const threads = sortByLastActivity(
    (fetched || []).filter((conv) => messagesInDateRange(conv.messages, rangeStart, rangeEnd, tz).length > 0)
  );

  return { summaryDate, rangeStart, rangeEnd, threads };
}

async function fetchThreadsForSummary({ client, date, filteredSources, tz }) {
  const summaryDate = date || todayDateInTz(tz);
  const apiEnd = apiEndDateInclusive(summaryDate);

  const { data: fetched } = await client.fetchAllConversations({
    startDate: summaryDate,
    endDate: apiEnd,
    filteredSources,
    maxPages: 20
  });

  const threads = sortByLastActivity(
    (fetched || []).filter((conv) => messagesOnDate(conv.messages, summaryDate, tz).length > 0)
  );

  return { summaryDate, threads };
}

async function summarizeBatch(client, threads, summaryDate, tz, batchOpts) {
  const prompt = buildBatchPrompt(threads, summaryDate, tz, batchOpts);
  const summaryText = await client.chat({
    messages: [{ role: "user", content: prompt }],
    temperature: 0
  });
  const sections = parseSummarySections(summaryText);
  sections.awaitingReply = [];
  return sections;
}

async function summarizePendingBatch(client, threads, summaryDate, rangeStart, rangeEnd, tz, batchOpts) {
  const prompt = buildPendingBatchPrompt(threads, summaryDate, rangeStart, rangeEnd, tz, batchOpts);
  const summaryText = await client.chat({
    messages: [{ role: "user", content: prompt }],
    temperature: 0
  });
  const parsed = parseSummarySections(summaryText);
  return { ...emptySections(), awaitingReply: parsed.awaitingReply || [] };
}

async function generateDailyInboxSummary({
  client,
  date,
  filteredSources = "",
  batch = 0,
  tz = DEFAULT_TZ
} = {}) {
  const batchIndex = Number.isFinite(Number(batch)) ? Math.max(0, Math.floor(Number(batch))) : 0;
  const { summaryDate, threads } = await fetchThreadsForSummary({
    client,
    date,
    filteredSources,
    tz
  });

  const threadCount = threads.length;
  const messageCount = countMessagesOnDate(threads, summaryDate, tz);
  const batches = splitThreadsIntoBatches(threads, summaryDate, tz);
  const totalBatches = batches.length;

  if (!threadCount) {
    if (batchIndex > 0) {
      throw new Error(`Invalid batch index ${batchIndex} (no threads)`);
    }

    return {
      sections: emptySections(),
      summary: "",
      meta: {
        phase: "day",
        date: summaryDate,
        threadCount: 0,
        threadsInBatch: 0,
        totalBatches: 0,
        batch: 0,
        complete: true,
        messageCount: 0
      }
    };
  }

  if (batchIndex >= totalBatches) {
    throw new Error(`Invalid batch index ${batchIndex} (total ${totalBatches})`);
  }

  let threadOffset = 0;
  for (let i = 0; i < batchIndex; i += 1) {
    threadOffset += batches[i].length;
  }

  const batchThreads = batches[batchIndex];
  const sections = await summarizeBatch(client, batchThreads, summaryDate, tz, {
    batchIndex,
    totalBatches,
    threadOffset
  });

  return {
    sections,
    summary: sectionsToText(sections),
    meta: {
      phase: "day",
      date: summaryDate,
      threadCount,
      threadsInBatch: batchThreads.length,
      totalBatches,
      batch: batchIndex,
      complete: batchIndex >= totalBatches - 1,
      messageCount
    }
  };
}

async function generatePendingInboxSummary({
  client,
  date,
  filteredSources = "",
  pendingBatch = 0,
  tz = DEFAULT_TZ
} = {}) {
  const batchIndex = Number.isFinite(Number(pendingBatch)) ? Math.max(0, Math.floor(Number(pendingBatch))) : 0;
  const { summaryDate, rangeStart, rangeEnd, threads } = await fetchThreadsForPendingSummary({
    client,
    date,
    filteredSources,
    tz
  });

  const threadCount = threads.length;
  const batches = splitThreadsIntoPendingBatches(threads, summaryDate, tz);
  const totalPendingBatches = batches.length;

  if (!threadCount) {
    if (batchIndex > 0) {
      throw new Error(`Invalid pending batch index ${batchIndex} (no threads)`);
    }

    return {
      sections: emptySections(),
      summary: "",
      meta: {
        phase: "pending",
        date: summaryDate,
        rangeStart,
        rangeEnd,
        threadCount: 0,
        threadsInBatch: 0,
        totalPendingBatches: 0,
        pendingBatch: 0,
        complete: true
      }
    };
  }

  if (batchIndex >= totalPendingBatches) {
    throw new Error(`Invalid pending batch index ${batchIndex} (total ${totalPendingBatches})`);
  }

  let threadOffset = 0;
  for (let i = 0; i < batchIndex; i += 1) {
    threadOffset += batches[i].length;
  }

  const batchThreads = batches[batchIndex];
  const sections = await summarizePendingBatch(
    client,
    batchThreads,
    summaryDate,
    rangeStart,
    rangeEnd,
    tz,
    {
      batchIndex,
      totalBatches: totalPendingBatches,
      threadOffset
    }
  );

  return {
    sections,
    summary: sectionsToText(sections),
    meta: {
      phase: "pending",
      date: summaryDate,
      rangeStart,
      rangeEnd,
      threadCount,
      threadsInBatch: batchThreads.length,
      totalPendingBatches,
      pendingBatch: batchIndex,
      complete: batchIndex >= totalPendingBatches - 1
    }
  };
}

async function generateInboxSummary({
  client,
  date,
  filteredSources = "",
  batch = 0,
  pendingBatch,
  tz = DEFAULT_TZ
} = {}) {
  if (!client) throw new Error("Missing Chatbase client");

  if (pendingBatch != null && pendingBatch !== "") {
    return generatePendingInboxSummary({ client, date, filteredSources, pendingBatch, tz });
  }

  return generateDailyInboxSummary({ client, date, filteredSources, batch, tz });
}

module.exports = {
  DEFAULT_TZ,
  CHATBASE_MAX_CHARS,
  MAX_TRANSCRIPT_CHARS,
  todayDateInTz,
  calendarDateInTz,
  isActivityOnDate,
  apiEndDateInclusive,
  messagesOnDate,
  formatThreadForPrompt,
  dayTranscriptCharBudget,
  splitThreadsIntoBatches,
  buildTranscriptForThreads,
  buildBatchPrompt,
  buildSummaryPrompt,
  emptySections,
  isPlaceholderSummaryBullet,
  parseSummarySections,
  mergeSections,
  sectionsToText,
  sortByLastActivity,
  countMessagesOnDate,
  addDaysToDateStr,
  pendingRangeForSummary,
  messagesInDateRange,
  messagesForPendingWindow,
  formatThreadForPendingPrompt,
  pendingTranscriptCharBudget,
  splitThreadsIntoPendingBatches,
  buildPendingBatchPrompt,
  buildPendingSummaryPrompt,
  generateInboxSummary
};
