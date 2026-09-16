const {
  generateInboxSummary,
  mergeSections,
  emptySections,
  sectionsToText,
  SECTION_LABELS,
  DEFAULT_TZ,
  todayDateInTz
} = require("./inbox-summary");
const { loadPaymentsToVerifyBullets } = require("./payments-verify-summary");

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** e.g. 2026-07-10 → "July 10 (Friday)" — matches daily-sales email style. */
function formatHumanSummaryDate(isoDate) {
  const raw = String(isoDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isoDate || "today";
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  const monthDay = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  return `${monthDay} (${weekday})`;
}

function emailSubjectForFraming(framing, isoDate) {
  const human = formatHumanSummaryDate(isoDate);
  if (framing === "morning") return `Morning action brief - ${human}`;
  if (framing === "evening") return `Evening review - ${human}`;
  if (framing === "test") return `Inbox summary test - ${human}`;
  return `Inbox summary - ${human}`;
}

function emailTitleForFraming(framing, isoDate) {
  const human = formatHumanSummaryDate(isoDate);
  if (framing === "morning") return `Morning action brief — ${human}`;
  if (framing === "evening") return `Evening review — ${human}`;
  if (framing === "test") return `Inbox summary — ${human} (test)`;
  return `Inbox summary — ${human}`;
}

function formatSummarySectionsHtml(sections) {
  const chunks = [];
  for (const [key, label] of SECTION_LABELS) {
    const items = (sections?.[key] || []).filter(Boolean);
    if (!items.length) continue;
    chunks.push(`<h3 style="margin:1.1em 0 0.4em;font-size:15px;color:#1a1a1a;">${escapeHtml(label)}</h3>`);
    chunks.push('<ul style="margin:0;padding-left:1.2em;">');
    for (const item of items) {
      chunks.push(`<li style="margin:0.25em 0;line-height:1.45;">${escapeHtml(item)}</li>`);
    }
    chunks.push("</ul>");
  }
  return chunks.join("") || `<p style="color:#666;">No summary content.</p>`;
}

function wrapSummaryEmailHtml({ title, subtitle, sectionsHtml, framing }) {
  const framingLine = framing
    ? `<p style="margin:0 0 1em;color:#555;font-size:13px;">${escapeHtml(framing)}</p>`
    : "";
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:10px;padding:24px 22px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h1 style="margin:0 0 0.25em;font-size:20px;color:#111;">${escapeHtml(title)}</h1>
      ${subtitle ? `<p style="margin:0 0 1em;color:#666;font-size:13px;">${escapeHtml(subtitle)}</p>` : ""}
      ${framingLine}
      ${sectionsHtml}
    </div>
    <p style="margin:16px 0 0;color:#999;font-size:11px;text-align:center;">Matchanese Inbox Summary</p>
  </div>
</body>
</html>`;
}

async function injectPaymentsSection(sections, { date, windowMode, tz }) {
  const bullets = await loadPaymentsToVerifyBullets({ date, windowMode, tz });
  return {
    ...sections,
    payments: bullets
  };
}

/**
 * Run the full day + pending batch loop server-side (mirrors the dashboard client).
 */
async function buildFullInboxSummary({
  client,
  date,
  filteredSources = "",
  tz = DEFAULT_TZ,
  windowMode = "calendar",
  framing = null
} = {}) {
  if (!client) throw new Error("Missing Chatbase client");

  const summaryDate = date || todayDateInTz(tz);
  let merged = emptySections();
  let lastMeta = {};

  let batch = 0;
  let totalBatches = 1;
  while (batch < totalBatches) {
    const result = await generateInboxSummary({
      client,
      date: summaryDate,
      filteredSources,
      batch,
      tz,
      windowMode
    });
    const dayBatches = result?.meta?.totalBatches ?? 0;
    totalBatches = dayBatches > 0 ? dayBatches : 1;
    merged = mergeSections(merged, result?.sections || emptySections());
    lastMeta = result?.meta || {};
    batch += 1;
  }

  let pendingBatch = 0;
  let totalPendingBatches = null;
  while (totalPendingBatches === null || pendingBatch < totalPendingBatches) {
    const result = await generateInboxSummary({
      client,
      date: summaryDate,
      filteredSources,
      pendingBatch,
      tz
    });
    totalPendingBatches = result?.meta?.totalPendingBatches ?? 0;
    merged = mergeSections(merged, result?.sections || emptySections());
    lastMeta = { ...lastMeta, ...(result?.meta || {}) };
    pendingBatch += 1;
  }

  merged = await injectPaymentsSection(merged, {
    date: summaryDate,
    windowMode,
    tz
  });

  const summary = sectionsToText(merged);
  const sectionsHtml = formatSummarySectionsHtml(merged);
  const humanDate = formatHumanSummaryDate(summaryDate);
  const windowLabel =
    windowMode === "rolling24h" ? "Last 24 hours + open follow-ups" : humanDate;
  const title = emailTitleForFraming(framing, summaryDate);
  const subtitle =
    framing === "morning"
      ? "What to see / do / take action on as you start the day."
      : framing === "evening"
        ? "Review of recent activity and open follow-ups."
        : windowLabel;

  const html = wrapSummaryEmailHtml({
    title,
    subtitle,
    sectionsHtml,
    framing: null
  });

  return {
    sections: merged,
    summary,
    html,
    subject: emailSubjectForFraming(framing, summaryDate),
    meta: {
      ...lastMeta,
      date: summaryDate,
      windowMode,
      framing,
      complete: true
    }
  };
}

module.exports = {
  buildFullInboxSummary,
  injectPaymentsSection,
  formatSummarySectionsHtml,
  wrapSummaryEmailHtml,
  formatHumanSummaryDate,
  emailSubjectForFraming,
  emailTitleForFraming
};
