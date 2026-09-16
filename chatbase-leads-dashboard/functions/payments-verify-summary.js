const { listPaymentIntakes } = require("./payment-intakes");
const {
  calendarDateInTz,
  createCalendarWindow,
  createRollingWindow,
  RECENT_LOOKBACK_HOURS,
  DEFAULT_TZ,
  todayDateInTz
} = require("./inbox-summary");

function normalizeMethod(method) {
  const raw = String(method || "").trim();
  if (!raw) return "Unspecified";
  const lower = raw.toLowerCase();
  if (lower.includes("gcash") || lower.includes("g-cash")) return "GCash";
  if (lower.includes("maya") || lower.includes("paymaya")) return "Maya";
  if (lower.includes("bpi")) return "BPI";
  if (lower.includes("bdo")) return "BDO";
  if (lower.includes("unionbank") || lower.includes("union bank") || lower === "ub") return "UnionBank";
  if (lower.includes("metrobank")) return "Metrobank";
  if (lower.includes("rcbc")) return "RCBC";
  if (lower.includes("gotyme")) return "GoTyme";
  if (lower.includes("seabank")) return "SeaBank";
  if (lower.includes("bank transfer") || lower.includes("transfer")) return "Bank transfer";
  // Title-case short labels
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatAmount(amount) {
  if (amount == null || amount === "") return null;
  const raw = String(amount).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[₱,\s]/g, "").replace(/^php/i, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) {
    return raw.startsWith("Php") || raw.startsWith("₱") ? raw : `Php${raw}`;
  }
  return `Php${num.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

function orderLabel(row) {
  return String(row.shopifyOrderName || row.orderNumber || "?").trim() || "?";
}

function formatPaymentEntry(row) {
  const order = orderLabel(row);
  const amount = formatAmount(row.amount);
  return amount ? `${order} - ${amount}` : order;
}

function intakeInWindow(row, window) {
  const iso = row.createdAt;
  if (!iso) return false;
  if (window.mode === "rolling") {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return false;
    return t >= window.startMs && t <= window.endMs;
  }
  return calendarDateInTz(iso, window.tz) === window.date;
}

/**
 * Group payment intakes into bank-method bullets for manual verification.
 * Example: "GCash: M#8191 - Php3,500, M#9128 - Php5,150"
 */
function buildPaymentsToVerifyBullets(rows, window) {
  const grouped = new Map();

  for (const row of rows || []) {
    if (!intakeInWindow(row, window)) continue;
    const method = normalizeMethod(row.paymentMethod);
    if (!grouped.has(method)) grouped.set(method, []);
    grouped.get(method).push(formatPaymentEntry(row));
  }

  const methodOrder = (a, b) => {
    if (a === "Unspecified") return 1;
    if (b === "Unspecified") return -1;
    return a.localeCompare(b);
  };

  return [...grouped.keys()]
    .sort(methodOrder)
    .map((method) => `${method}: ${grouped.get(method).join(", ")}`);
}

function resolvePaymentsWindow({ date, windowMode = "calendar", tz = DEFAULT_TZ, endMs } = {}) {
  if (windowMode === "rolling24h") {
    return createRollingWindow(RECENT_LOOKBACK_HOURS, endMs ?? Date.now(), tz);
  }
  return createCalendarWindow(date || todayDateInTz(tz), tz);
}

async function loadPaymentsToVerifyBullets(opts = {}) {
  const window = resolvePaymentsWindow(opts);
  const listOpts = {};
  if (window.mode === "calendar") {
    listOpts.startDate = window.date;
    listOpts.endDate = window.date;
  } else {
    // Pull a couple calendar days then filter by rolling ms window.
    listOpts.startDate =
      calendarDateInTz(new Date(window.startMs).toISOString(), window.tz) || window.date;
    listOpts.endDate =
      calendarDateInTz(new Date(window.endMs).toISOString(), window.tz) || window.date;
  }

  const result = await listPaymentIntakes({
    ...listOpts,
    page: 1,
    size: 500
  });

  return buildPaymentsToVerifyBullets(result.data || [], window);
}

module.exports = {
  normalizeMethod,
  formatAmount,
  formatPaymentEntry,
  buildPaymentsToVerifyBullets,
  resolvePaymentsWindow,
  loadPaymentsToVerifyBullets
};
