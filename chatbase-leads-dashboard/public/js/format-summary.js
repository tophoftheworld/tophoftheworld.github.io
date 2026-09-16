const SECTION_ORDER = [
  ["urgent", "Urgent"],
  ["leads", "Leads"],
  ["payments", "Payments to verify"],
  ["followUps", "Follow-ups"],
  ["awaitingReply", "Awaiting reply"]
];

const SECTION_HEADERS = new Set([
  "awaiting reply",
  "awaiting replies",
  "pending replies",
  "urgent",
  "topics",
  "leads",
  "payments",
  "payments to verify",
  "follow-ups",
  "follow ups",
  "followups"
]);

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function emptySummarySections() {
  return { awaitingReply: [], urgent: [], topics: [], leads: [], payments: [], followUps: [] };
}

export function mergeSummarySections(a, b) {
  const out = emptySummarySections();
  for (const [key] of SECTION_ORDER) {
    const seen = new Set();
    for (const src of [a, b]) {
      for (const item of src?.[key] || []) {
        if (isPlaceholderSummaryBullet(item)) continue;
        const norm = normalizeSummaryLine(item).toLowerCase();
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        out[key].push(item);
      }
    }
  }
  return out;
}

function isSectionHeader(line) {
  const key = line.replace(/:+$/, "").trim().toLowerCase();
  return SECTION_HEADERS.has(key);
}

function isBulletLine(line) {
  return /^[-•*]\s+/.test(line) || /^\d+\.\s+/.test(line);
}

function bulletContent(line) {
  const m = line.match(/^[-•*]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
  return m ? m[1].trim() : line.trim();
}

function normalizeSummaryLine(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Strip a leaked 1–10 importance score the model sometimes prints in an Awaiting reply bullet. */
function stripLeakedImportanceScore(text) {
  const t = normalizeSummaryLine(text);
  if (!t) return t;
  const SCORE = /^(?:10(?:\.0)?|[0-9](?:\.[0-9])?)$/;
  const parts = t.split(/\s+[—–-]\s+/);
  if (!parts.some((p) => SCORE.test(p.trim()))) return t;
  return parts.filter((p) => !SCORE.test(p.trim())).join(" — ");
}

/** Normalize age to "Nd ago"; drop ambiguous ranges like "1-4d open". */
function normalizeAwaitingReplyAge(text) {
  const t = normalizeSummaryLine(text);
  if (!t) return t;
  const parts = t.split(/\s+[—–-]\s+/);
  if (parts.length < 2) return t;

  const out = [];
  for (const part of parts) {
    const p = part.trim();
    if (/^\d+\s*[–—-]\s*\d+\s*d(?:ays?)?(?:\s+open)?$/i.test(p)) continue;
    const exact = p.match(/^(\d+)\s*d(?:ays?)?(?:\s+open|\s+ago)?$/i);
    if (exact) {
      out.push(`${Number(exact[1])}d ago`);
      continue;
    }
    out.push(p);
  }
  return out.join(" — ");
}

function isPlaceholderSummaryBullet(text) {
  const t = normalizeSummaryLine(text);
  if (!t) return true;
  const lower = t.toLowerCase().replace(/\.+$/, "");

  if (/^(none|n\/a|na|nil|nothing|—|-)$/.test(lower)) return true;
  if (/^none\s+flagged/.test(lower)) return true;
  if (/\bin this batch$/.test(lower) && (/\bno\b/.test(lower) || /\bnone\b/.test(lower))) return true;
  if (/\bnothing\s+to\s+report\b/.test(lower)) return true;
  if (/\bno\s+items?\s+to\s+report\b/.test(lower)) return true;

  return false;
}

export function formatSummarySectionsHtml(sections) {
  const chunks = [];
  for (const [key, label] of SECTION_ORDER) {
    let items = (sections?.[key] || []).filter((item) => !isPlaceholderSummaryBullet(item));
    if (key === "awaitingReply") {
      items = items.map(stripLeakedImportanceScore).map(normalizeAwaitingReplyAge);
    }
    if (!items.length) continue;
    chunks.push(`<h3 class="inbox-summary-section">${escapeHtml(label)}</h3>`);
    chunks.push('<ul class="inbox-summary-list">');
    for (const item of items) {
      chunks.push(`<li>${escapeHtml(item)}</li>`);
    }
    chunks.push("</ul>");
  }
  return chunks.join("") || `<p class="inbox-summary-p subtle">No summary content.</p>`;
}

/** Turn Chatbase plain-text summary into structured HTML for the detail panel. */
export function formatSummaryHtml(text) {
  const lines = String(text || "").split(/\r?\n/);
  const chunks = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      chunks.push("</ul>");
      listOpen = false;
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    if (!isBulletLine(trimmed) && isSectionHeader(trimmed)) {
      closeList();
      const title = trimmed.replace(/:+$/, "").trim();
      chunks.push(`<h3 class="inbox-summary-section">${escapeHtml(title)}</h3>`);
      continue;
    }

    if (isBulletLine(trimmed)) {
      const content = bulletContent(trimmed);
      if (isPlaceholderSummaryBullet(content)) continue;
      if (!listOpen) {
        chunks.push('<ul class="inbox-summary-list">');
        listOpen = true;
      }
      chunks.push(`<li>${escapeHtml(content)}</li>`);
      continue;
    }

    closeList();
    chunks.push(`<p class="inbox-summary-p">${escapeHtml(trimmed)}</p>`);
  }

  closeList();
  return chunks.join("") || `<p class="inbox-summary-p subtle">No summary content.</p>`;
}
