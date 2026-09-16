/**
 * Payment ledger helpers: allocate receipts across schedule milestones
 * without mutating scheduled milestone amounts.
 */

function roundMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n =
    typeof value === "number" ? value : parseFloat(String(value).replace(/[₱,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Schedule rows only — ignore legacy split remainder rows. */
function scheduleMilestones(milestones) {
  if (!Array.isArray(milestones)) return [];
  return milestones.filter((m) => {
    if (!m || !String(m.milestone || "").trim()) return false;
    if (m.splitFromId) return false;
    return Number(m.percentage) > 0 || roundMoney(m.amount) > 0;
  });
}

function activePayments(payments) {
  if (!Array.isArray(payments)) return [];
  return payments.filter((p) => p && p.status !== "voided");
}

function receivedByMilestoneId(payments) {
  const map = new Map();
  for (const p of activePayments(payments)) {
    const allocs = Array.isArray(p.allocations) ? p.allocations : [];
    for (const a of allocs) {
      const id = String(a.milestoneId ?? "");
      if (!id) continue;
      map.set(id, roundMoney((map.get(id) || 0) + roundMoney(a.amount)));
    }
  }
  return map;
}

function remainingForMilestone(milestone, receivedMap) {
  const scheduled = roundMoney(milestone.amount);
  const received = roundMoney(receivedMap.get(String(milestone.id)) || 0);
  return roundMoney(Math.max(0, scheduled - received));
}

/**
 * Waterfall-allocate `amount` across milestones with remaining balance.
 * Does not mutate milestones. `priorPayments` are other active payments.
 */
function allocatePaymentWaterfall(milestones, amount, priorPayments = []) {
  const confirmedAmount = toFiniteNumber(amount);
  if (confirmedAmount == null || confirmedAmount <= 0) return [];

  const schedule = scheduleMilestones(milestones);
  const receivedMap = receivedByMilestoneId(priorPayments);
  let leftover = roundMoney(confirmedAmount);
  const allocations = [];

  for (const m of schedule) {
    if (leftover <= 0.5) break;
    const rem = remainingForMilestone(m, receivedMap);
    if (rem <= 0.5) continue;
    const take = roundMoney(Math.min(leftover, rem));
    if (take <= 0) continue;
    allocations.push({
      milestoneId: m.id ?? null,
      role: m.role || null,
      milestoneName: String(m.milestone || ""),
      amount: take
    });
    receivedMap.set(String(m.id), roundMoney((receivedMap.get(String(m.id)) || 0) + take));
    leftover = roundMoney(leftover - take);
  }

  return allocations;
}

/** Recompute allocations for every active payment in chronological order. */
function reallocateAllPayments(milestones, payments) {
  const list = Array.isArray(payments) ? payments.map((p) => ({ ...p })) : [];
  const active = [];
  for (const p of list) {
    if (!p || p.status === "voided") {
      if (p) p.allocations = Array.isArray(p.allocations) ? p.allocations : [];
      continue;
    }
    const allocs = allocatePaymentWaterfall(milestones, p.amount, active);
    p.allocations = allocs;
    active.push({ ...p, allocations: allocs });
  }
  return list;
}

function paymentsTowardMilestone(payments, milestoneId) {
  const id = String(milestoneId ?? "");
  const out = [];
  for (const p of activePayments(payments)) {
    const allocs = Array.isArray(p.allocations) ? p.allocations : [];
    const hit = allocs.filter((a) => String(a.milestoneId) === id);
    if (!hit.length) continue;
    const allocated = roundMoney(hit.reduce((s, a) => s + roundMoney(a.amount), 0));
    out.push({ payment: p, allocated });
  }
  return out;
}

function deriveMilestonePaymentFields(milestone, payments) {
  const scheduled = roundMoney(milestone.amount);
  const toward = paymentsTowardMilestone(payments, milestone.id);
  const received = roundMoney(toward.reduce((s, t) => s + t.allocated, 0));
  const remaining = roundMoney(Math.max(0, scheduled - received));
  const covering = toward.map((t) => t.payment);
  const hasSent = covering.some((p) => p.status === "sent");
  const hasConfirmed = covering.some((p) => p.status === "confirmed");
  let paymentStatus = null;
  let paid = false;
  if (remaining <= 0.5 && received > 0) {
    paid = true;
    paymentStatus = hasSent && !covering.every((p) => p.status === "confirmed")
      ? "sent"
      : "confirmed";
  } else if (received > 0) {
    paymentStatus = hasSent ? "sent" : hasConfirmed ? "confirmed" : "sent";
  }
  const screenshotUrl =
    covering.map((p) => p.screenshotUrl).find(Boolean) || null;
  const paymentReference =
    covering.map((p) => p.referenceNumber).find(Boolean) || null;
  const paymentMethod =
    covering.map((p) => p.paymentMethod).find(Boolean) || null;
  const proofId = covering.map((p) => p.id).find(Boolean) || null;

  return {
    scheduled,
    received,
    remaining,
    paid,
    paymentStatus,
    screenshotUrl,
    paymentReference,
    paymentMethod,
    proofId,
    paymentIds: covering.map((p) => p.id).filter(Boolean)
  };
}

function enrichMilestonesWithPayments(milestones, payments) {
  const schedule = scheduleMilestones(milestones);
  return schedule.map((m) => {
    const d = deriveMilestonePaymentFields(m, payments);
    return {
      ...m,
      // Keep scheduled amount on `amount` for display of due schedule
      amount: d.scheduled,
      paid: d.paid,
      paymentStatus: d.paymentStatus,
      received: d.received,
      remaining: d.remaining,
      screenshotUrl: d.screenshotUrl,
      paymentReference: d.paymentReference,
      paymentMethod: d.paymentMethod,
      proofId: d.proofId,
      paymentIds: d.paymentIds,
      // Clear legacy split fields from public view
      splitFromId: null,
      originalAmount: null
    };
  });
}

/**
 * Expand schedule + payments into customer-facing rows:
 * one received row per allocation, then a due row for remaining.
 */
function buildScheduleDisplayRows(milestones, payments = []) {
  const schedule = scheduleMilestones(milestones);
  const rows = [];
  let sawDue = false;

  for (const m of schedule) {
    const toward = paymentsTowardMilestone(payments, m.id);
    const derived = deriveMilestonePaymentFields(m, payments);

    for (const t of toward) {
      const p = t.payment;
      const status = p.status === "confirmed" ? "confirmed" : "sent";
      rows.push({
        kind: "received",
        milestoneId: m.id ?? null,
        role: m.role || null,
        milestone: String(m.milestone || ""),
        date: p.paidAt || m.date || "",
        amount: roundMoney(t.allocated),
        paymentStatus: status,
        statusLabel: status === "confirmed" ? "Payment confirmed" : "Payment sent",
        paymentId: p.id || null,
        screenshotUrl: p.screenshotUrl || null,
        paymentReference: p.referenceNumber || null,
        paymentMethod: p.paymentMethod || null
      });
    }

    if (derived.remaining > 0.5) {
      const isDue = !sawDue;
      sawDue = true;
      rows.push({
        kind: "due",
        milestoneId: m.id ?? null,
        role: m.role || null,
        milestone: String(m.milestone || ""),
        date: m.date || "",
        amount: derived.remaining,
        paymentStatus: null,
        statusLabel: isDue ? "Due now" : "Upcoming",
        paymentId: null,
        screenshotUrl: null,
        paymentReference: null,
        paymentMethod: null
      });
    }
  }

  return rows;
}

function totalReceivedFromPayments(payments) {
  return roundMoney(
    activePayments(payments).reduce((s, p) => s + roundMoney(p.amount), 0)
  );
}

function totalRemainingOnSchedule(milestones, payments) {
  const enriched = enrichMilestonesWithPayments(milestones, payments);
  return roundMoney(enriched.reduce((s, m) => s + roundMoney(m.remaining), 0));
}

function sanitizePayment(payment) {
  if (!payment || typeof payment !== "object") return null;
  return {
    id: payment.id || null,
    amount: roundMoney(payment.amount),
    paymentMethod: payment.paymentMethod || "other",
    referenceNumber: String(payment.referenceNumber || "").trim(),
    paidAt: payment.paidAt || "",
    senderName: String(payment.senderName || "").trim(),
    screenshotUrl: payment.screenshotUrl || null,
    status: payment.status || "sent",
    allocations: Array.isArray(payment.allocations)
      ? payment.allocations.map((a) => ({
          milestoneId: a.milestoneId ?? null,
          role: a.role || null,
          milestoneName: String(a.milestoneName || ""),
          amount: roundMoney(a.amount)
        }))
      : [],
    createdAt: payment.createdAt || null
  };
}

function softSyncMilestonesFromPayments(milestones, payments = []) {
  const enriched = enrichMilestonesWithPayments(milestones, payments);
  const byId = new Map(enriched.map((m) => [String(m.id), m]));
  const cleaned = [];
  for (const m of Array.isArray(milestones) ? milestones : []) {
    if (!m || m.splitFromId) continue;
    if (!String(m.milestone || "").trim()) continue;
    if (!(Number(m.percentage) > 0 || roundMoney(m.amount) > 0)) continue;
    const d = byId.get(String(m.id));
    cleaned.push({
      id: m.id,
      role: m.role || null,
      milestone: String(m.milestone || ""),
      date: m.date || "",
      percentage: Number(m.percentage) || 0,
      amount: roundMoney(m.amount),
      paid: d ? d.paid === true : false,
      paymentStatus: null,
      proofId: null,
      screenshotUrl: null,
      paymentReference: null,
      paymentMethod: null,
      splitFromId: null,
      originalAmount: null
    });
  }
  return cleaned.length
    ? cleaned
    : enriched.map((m) => ({
        id: m.id,
        role: m.role || null,
        milestone: String(m.milestone || ""),
        date: m.date || "",
        percentage: Number(m.percentage) || 0,
        amount: roundMoney(m.amount),
        paid: m.paid === true,
        paymentStatus: null,
        proofId: null,
        screenshotUrl: null,
        paymentReference: null,
        paymentMethod: null,
        splitFromId: null,
        originalAmount: null
      }));
}

function buildScheduleFromStructure(structure, total, existing = []) {
  const t = roundMoney(total);
  const byRole = {};
  (Array.isArray(existing) ? existing : []).forEach((m) => {
    if (m?.role) byRole[m.role] = m;
  });
  const mk = (role, name, pct) => {
    const prev = byRole[role];
    return {
      id: prev?.id ?? Date.now() + Math.floor(Math.random() * 1000),
      role,
      milestone: name,
      date: prev?.date || "",
      percentage: pct,
      amount: roundMoney(t * (pct / 100)),
      paid: false,
      paymentStatus: null,
      proofId: null,
      screenshotUrl: null,
      paymentReference: null,
      paymentMethod: null,
      splitFromId: null,
      originalAmount: null
    };
  };
  if (structure === "two") {
    return [mk("first", "Down Payment", 50), mk("final", "Final Payment", 50)];
  }
  return [
    mk("first", "Date Reservation", 30),
    mk("preEvent", "Pre-Event", 40),
    mk("final", "Completion", 30)
  ];
}

function invoiceLooksPaymentBroken({ paymentMilestones, paymentStructure, amountTotal } = {}) {
  const list = Array.isArray(paymentMilestones) ? paymentMilestones : [];
  if (list.some((m) => m && m.splitFromId)) return true;
  if (list.some((m) => m && (m.screenshotUrl || m.proofId) && !m.splitFromId)) return true;
  const schedule = scheduleMilestones(list);
  const names = schedule
    .map((m) => String(m.milestone || "").trim().toLowerCase())
    .filter(Boolean);
  if (names.length !== new Set(names).size) return true;
  const roles = schedule.map((m) => m.role).filter(Boolean);
  if (roles.length !== new Set(roles).size) return true;
  const expected = paymentStructure === "two" ? 2 : 3;
  if (schedule.length > expected) return true;
  const total = roundMoney(amountTotal);
  if (paymentStructure === "two" && schedule.length >= 2 && total > 0) {
    const final =
      schedule.find((m) => m.role === "final") || schedule[schedule.length - 1];
    const expectedAmt = total * 0.5;
    if (final && roundMoney(final.amount) > expectedAmt * 1.15) return true;
  }
  return false;
}

function normalizeReferenceKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Keep earliest payment per reference; mark later duplicates voided. */
function dedupePaymentsByReference(payments) {
  const list = Array.isArray(payments) ? payments.map((p) => ({ ...p })) : [];
  list.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const seen = new Map();
  for (const p of list) {
    if (!p || p.status === "voided") continue;
    const key = normalizeReferenceKey(p.referenceNumber);
    if (!key) continue;
    if (seen.has(key)) {
      p.status = "voided";
      p.voidedAt = p.voidedAt || new Date().toISOString();
      p.voidedSource = p.voidedSource || "duplicate_reference";
      p._needsPersist = true;
    } else {
      seen.set(key, p.id);
    }
  }
  return list;
}

/**
 * Find an existing non-voided payment that matches this receipt (anti-replay).
 */
function findDuplicatePayment(
  payments,
  { referenceNumber, amount, paidAt, paymentMethod } = {}
) {
  const active = activePayments(payments);
  const refKey = normalizeReferenceKey(referenceNumber);
  if (refKey) {
    return (
      active.find((p) => normalizeReferenceKey(p.referenceNumber) === refKey) || null
    );
  }
  const amt = roundMoney(amount);
  const date = String(paidAt || "").trim();
  const method = String(paymentMethod || "").trim().toLowerCase();
  if (!(amt > 0) || !date) return null;
  return (
    active.find(
      (p) =>
        roundMoney(p.amount) === amt &&
        String(p.paidAt || "").trim() === date &&
        String(p.paymentMethod || "").trim().toLowerCase() === method
    ) || null
  );
}

/**
 * Promote milestone-embedded screenshots into payment docs + restore % schedule.
 */
function repairInvoicePaymentState({
  paymentMilestones,
  payments,
  paymentStructure,
  amountTotal
} = {}) {
  const structure = paymentStructure === "two" ? "two" : "three";
  const total = roundMoney(amountTotal);
  const existingPayments = Array.isArray(payments) ? payments.map((p) => ({ ...p })) : [];
  const milestonesIn = Array.isArray(paymentMilestones) ? paymentMilestones : [];

  const promoted = [];
  for (const m of milestonesIn) {
    if (!m?.screenshotUrl && !m?.proofId) continue;
    const already = existingPayments.some(
      (p) =>
        (m.proofId && String(p.id) === String(m.proofId)) ||
        (m.screenshotUrl && p.screenshotUrl === m.screenshotUrl)
    );
    if (already) continue;
    if (m.proofId) continue;
    const amt = roundMoney(m.amount);
    if (!(amt > 0) || !m.screenshotUrl) continue;
    promoted.push({
      id: `promoted_${m.id || Date.now()}`,
      amount: amt,
      paymentMethod: m.paymentMethod || "other",
      referenceNumber: m.paymentReference || "",
      paidAt: m.date || "",
      senderName: "",
      screenshotUrl: m.screenshotUrl,
      status: m.paymentStatus === "confirmed" ? "confirmed" : "sent",
      allocations: [],
      createdAt: new Date().toISOString(),
      source: "repair_promote",
      _needsPersist: true
    });
  }

  const allPayments = dedupePaymentsByReference([
    ...existingPayments,
    ...promoted
  ]);
  const schedule = buildScheduleFromStructure(structure, total, milestonesIn);
  const reallocated = reallocateAllPayments(schedule, allPayments);
  const synced = softSyncMilestonesFromPayments(schedule, reallocated);

  return {
    paymentMilestones: synced,
    payments: reallocated,
    promoted
  };
}

const InvoicePaymentAlloc = {
  roundMoney,
  toFiniteNumber,
  scheduleMilestones,
  activePayments,
  receivedByMilestoneId,
  remainingForMilestone,
  allocatePaymentWaterfall,
  reallocateAllPayments,
  paymentsTowardMilestone,
  deriveMilestonePaymentFields,
  enrichMilestonesWithPayments,
  buildScheduleDisplayRows,
  totalReceivedFromPayments,
  totalRemainingOnSchedule,
  sanitizePayment,
  softSyncMilestonesFromPayments,
  buildScheduleFromStructure,
  invoiceLooksPaymentBroken,
  repairInvoicePaymentState,
  normalizeReferenceKey,
  findDuplicatePayment,
  dedupePaymentsByReference
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = InvoicePaymentAlloc;
}
if (typeof window !== "undefined") {
  window.InvoicePaymentAlloc = InvoicePaymentAlloc;
}
