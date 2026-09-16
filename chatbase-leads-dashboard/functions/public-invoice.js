const admin = require("firebase-admin");
const {
  scheduleMilestones,
  enrichMilestonesWithPayments,
  buildScheduleDisplayRows,
  totalReceivedFromPayments,
  sanitizePayment,
  activePayments,
  reallocateAllPayments,
  invoiceLooksPaymentBroken,
  repairInvoicePaymentState,
  softSyncMilestonesFromPayments
} = require("./invoice-payment-alloc");

const COLLECTION = "invoice-generator";
const PROOFS_COLLECTION = "invoicePaymentProofs";
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

function getDb() {
  if (!admin.apps.length) {
    const projectId =
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      "matchanese-attendance";
    admin.initializeApp({ projectId });
  }
  return admin.firestore();
}

function normalizeToken(value) {
  const token = String(value || "").trim();
  if (!TOKEN_PATTERN.test(token)) return null;
  return token;
}

function roundMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function isActiveMilestone(milestone) {
  if (!milestone || !String(milestone.milestone || "").trim()) return false;
  // Schedule rows only — ignore legacy split remainders.
  if (milestone.splitFromId) return false;
  return Number(milestone.percentage) > 0 || roundMoney(milestone.amount) > 0;
}

function activeMilestones(milestones) {
  return scheduleMilestones(milestones);
}

async function loadInvoicePayments(invoiceId, db = getDb()) {
  const id = String(invoiceId || "").trim();
  if (!id) return [];
  const snap = await db
    .collection(PROOFS_COLLECTION)
    .where("invoiceId", "==", id)
    .get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return rows;
}

function resolvePackageCount(item) {
  const n = parseInt(item?.count, 10);
  if (n > 0) return n;
  if (item?.numberOfPax === "custom") return parseInt(item.customCups, 10) || 0;
  const nop = parseInt(item?.numberOfPax, 10);
  if (nop > 0) return nop;
  const match = String(item?.cups || "").match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function computeMobileBarListPrice(item) {
  const ratesByPackage = {
    starter: { 100: 29500, 150: 43500 },
    signature: { 100: 32500, 150: 46750 },
    special: { 100: 36000, 150: 52000 }
  };
  const rates = ratesByPackage[item?.packageType];
  if (!rates) return 0;
  const cups = resolvePackageCount(item);
  if (!cups) return 0;
  if (rates[cups] != null) return rates[cups];
  const tiers = [100, 150];
  let lower;
  let upper;
  if (cups < tiers[0]) {
    lower = tiers[0];
    upper = tiers[1];
  } else if (cups > tiers[tiers.length - 1]) {
    lower = tiers[tiers.length - 2];
    upper = tiers[tiers.length - 1];
  } else {
    for (let i = 0; i < tiers.length - 1; i++) {
      if (cups > tiers[i] && cups < tiers[i + 1]) {
        lower = tiers[i];
        upper = tiers[i + 1];
        break;
      }
    }
  }
  if (lower == null || upper == null) return 0;
  const slope = (rates[upper] - rates[lower]) / (upper - lower);
  const anchor = cups > tiers[tiers.length - 1] ? upper : lower;
  return Math.round(rates[anchor] + (cups - anchor) * slope);
}

function packageItemDiscount(item) {
  if (!item || item.isWorkshop) return 0;
  const pkgDisc = Number(item.packageDiscount);
  if (Number.isFinite(pkgDisc) && pkgDisc > 0) return roundMoney(pkgDisc);
  const charged = Number(item.unitPrice);
  if (!Number.isFinite(charged)) return 0;
  let list = Number(item.listPrice);
  if (!Number.isFinite(list) || list <= 0) list = computeMobileBarListPrice(item);
  if (!Number.isFinite(list) || list <= charged) return 0;
  if (item.priceOverride == null || item.priceOverride === "") return 0;
  return roundMoney(list - charged);
}

function computePaymentSummary(doc, payments = []) {
  const total = roundMoney(
    Number.isFinite(Number(doc?.amountTotal)) ? doc.amountTotal : doc?.totalAmount
  );
  let amountDiscount = roundMoney(doc?.amountDiscount);
  if (!(amountDiscount > 0)) {
    amountDiscount = roundMoney(
      (Array.isArray(doc?.invoiceItems) ? doc.invoiceItems : []).reduce(
        (sum, item) => sum + packageItemDiscount(item),
        0
      ) + roundMoney(doc?.invoiceDiscount)
    );
  }
  const amountSubtotal = roundMoney(total + amountDiscount);
  const enriched = enrichMilestonesWithPayments(doc?.paymentMilestones, payments);
  const fromPayments = activePayments(payments);
  let amountPaid;
  let amountRemaining;
  if (fromPayments.length) {
    amountPaid = totalReceivedFromPayments(payments);
    amountRemaining = roundMoney(Math.max(0, total - amountPaid));
  } else {
    // Legacy: paid flags on milestones (pre-ledger invoices / unit tests)
    const milestones = activeMilestones(doc?.paymentMilestones);
    amountPaid = roundMoney(
      milestones.filter((m) => m.paid).reduce((sum, m) => sum + roundMoney(m.amount), 0)
    );
    amountRemaining = roundMoney(Math.max(0, total - amountPaid));
  }
  const nextUnpaid = fromPayments.length
    ? enriched.find((m) => roundMoney(m.remaining) > 0.5)
    : activeMilestones(doc?.paymentMilestones).find((m) => !m.paid);
  const allPaid = fromPayments.length
    ? enriched.length > 0 && enriched.every((m) => roundMoney(m.remaining) <= 0.5)
    : (() => {
        const milestones = activeMilestones(doc?.paymentMilestones);
        return milestones.length > 0 && milestones.every((m) => m.paid);
      })();

  let paymentStatus = "unpaid";
  if (allPaid || (total > 0 && amountRemaining <= 0 && amountPaid > 0)) {
    paymentStatus = "paid";
  } else if (amountPaid > 0) {
    paymentStatus = "partial";
  }

  return {
    amountTotal: total,
    amountSubtotal,
    amountDiscount,
    invoiceDiscount: roundMoney(doc?.invoiceDiscount),
    amountPaid,
    amountRemaining,
    amountDueNow: nextUnpaid
      ? roundMoney(
          nextUnpaid.remaining != null ? nextUnpaid.remaining : nextUnpaid.amount
        )
      : amountRemaining,
    dueLabel: nextUnpaid
      ? String(nextUnpaid.milestone)
      : paymentStatus === "paid"
        ? "Paid in full"
        : "Amount due",
    paymentStatus
  };
}

function sanitizeMilestone(milestone) {
  const received =
    milestone.received != null ? roundMoney(milestone.received) : null;
  const remaining =
    milestone.remaining != null
      ? roundMoney(milestone.remaining)
      : received != null
        ? roundMoney(Math.max(0, roundMoney(milestone.amount) - received))
        : null;
  return {
    id: milestone.id ?? null,
    role: milestone.role || null,
    milestone: String(milestone.milestone || ""),
    date: milestone.date || "",
    percentage: Number(milestone.percentage) || 0,
    amount: roundMoney(milestone.amount),
    received,
    remaining,
    paid: milestone.paid === true,
    paymentStatus: milestone.paymentStatus || (milestone.paid === true ? "confirmed" : null),
    proofId: milestone.proofId || null,
    screenshotUrl: milestone.screenshotUrl || null,
    paymentReference: milestone.paymentReference || null,
    paymentMethod: milestone.paymentMethod || null,
    paymentIds: Array.isArray(milestone.paymentIds) ? milestone.paymentIds : []
  };
}

function toPublicInvoice(doc, payments = []) {
  if (!doc || typeof doc !== "object") return null;
  const summary = computePaymentSummary(doc, payments);
  const enriched = enrichMilestonesWithPayments(doc.paymentMilestones, payments);
  const scheduleRows = buildScheduleDisplayRows(doc.paymentMilestones, payments);
  return {
    invoiceNumber: doc.invoiceNumber || "",
    invoiceDate: doc.invoiceDate || "",
    eventDate: doc.eventDate || "",
    clientName: doc.clientName || "",
    clientCompany: doc.clientCompany || "",
    clientAddress: doc.clientAddress || "",
    clientTIN: doc.clientTIN || "",
    notes: doc.notes || "",
    invoiceItems: Array.isArray(doc.invoiceItems) ? doc.invoiceItems : [],
    customLineItems: Array.isArray(doc.customLineItems) ? doc.customLineItems : [],
    paymentMilestones: enriched.map(sanitizeMilestone),
    paymentScheduleRows: scheduleRows,
    payments: activePayments(payments)
      .map((p) => sanitizePayment({ ...p, id: p.id }))
      .filter(Boolean),
    paymentStructure: doc.paymentStructure || "three",
    ...summary
  };
}

async function findPublishedInvoiceByToken(token, db = getDb()) {
  const snap = await db.collection(COLLECTION).where("publicToken", "==", token).limit(8).get();
  const match = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .find((row) => row.shareStatus === "published");
  return match || null;
}

async function getPublicInvoiceByToken(rawToken, db = getDb()) {
  const token = normalizeToken(rawToken);
  if (!token) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }
  const doc = await findPublishedInvoiceByToken(token, db);
  if (!doc) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }
  let payments = await loadInvoicePayments(doc.id, db);
  const total = roundMoney(
    Number.isFinite(Number(doc.amountTotal)) ? doc.amountTotal : doc.totalAmount
  );
  const broken = invoiceLooksPaymentBroken({
    paymentMilestones: doc.paymentMilestones,
    paymentStructure: doc.paymentStructure,
    amountTotal: total
  });
  const missingAllocs = payments.some(
    (p) =>
      p &&
      p.status !== "voided" &&
      Number(p.amount) > 0 &&
      (!Array.isArray(p.allocations) || !p.allocations.length)
  );

  if (broken || missingAllocs) {
    let repaired;
    if (broken) {
      repaired = repairInvoicePaymentState({
        paymentMilestones: doc.paymentMilestones,
        payments,
        paymentStructure: doc.paymentStructure || "three",
        amountTotal: total
      });
    } else {
      const reallocated = reallocateAllPayments(doc.paymentMilestones, payments);
      repaired = {
        paymentMilestones: softSyncMilestonesFromPayments(
          doc.paymentMilestones,
          reallocated
        ),
        payments: reallocated,
        promoted: []
      };
    }

    doc.paymentMilestones = repaired.paymentMilestones;
    payments = repaired.payments;

    try {
      await db.collection(COLLECTION).doc(String(doc.id)).update({
        paymentMilestones: doc.paymentMilestones,
        paymentProofUpdatedAt: new Date().toISOString()
      });
      for (const p of payments) {
        if (!p?.id) continue;
        if (p._needsPersist || String(p.id).startsWith("promoted_")) {
          if (p.status === "voided" && !String(p.id).startsWith("promoted_")) {
            await db
              .collection(PROOFS_COLLECTION)
              .doc(String(p.id))
              .set(
                {
                  status: "voided",
                  voidedAt: p.voidedAt || new Date().toISOString(),
                  voidedSource: p.voidedSource || "duplicate_reference",
                  allocations: p.allocations || []
                },
                { merge: true }
              );
            p._needsPersist = false;
            continue;
          }
          if (p.status === "voided") continue;
          const payload = { ...p };
          delete payload._needsPersist;
          delete payload.id;
          payload.invoiceId = String(doc.id);
          const ref = db.collection(PROOFS_COLLECTION).doc();
          await ref.set({
            ...payload,
            createdAt: payload.createdAt || new Date().toISOString()
          });
          p.id = ref.id;
          p._needsPersist = false;
        } else {
          const patch = { allocations: p.allocations || [] };
          if (p.status === "voided") {
            patch.status = "voided";
            patch.voidedAt = p.voidedAt || new Date().toISOString();
            patch.voidedSource = p.voidedSource || "duplicate_reference";
          }
          await db
            .collection(PROOFS_COLLECTION)
            .doc(String(p.id))
            .set(patch, { merge: true });
        }
      }
    } catch (err) {
      console.warn("invoice payment repair persist failed", err?.message || err);
    }
  }

  return { ok: true, data: toPublicInvoice(doc, payments) };
}

const MOBILE_BAR_SIGNATURE_DRINKS = [
  "Signature Matchanese Latte",
  "Hojicha Latte"
];

const MOBILE_BAR_CHOICE_CATALOG = [
  "Strawberry Matchanese Latte",
  "Matchanese Seasalt Latte",
  "Spanish Matchanese Latte",
  "Matchanese Sunrise",
  "Matchanese Coconut",
  "Earl Grey Matchanese Latte",
  "Salted Caramel Matchanese Latte",
  "White Chocolate Matchanese Latte",
  "Blueberry Matchanese Latte",
  "Peach Mango Matchanese Latte",
  "Americano",
  "Kyoto Latte",
  "Spanish Latte",
  "Matchanese Espresso",
  "Seasalt Latte"
];

const COFFEE_DRINKS = [
  "Americano",
  "Kyoto Latte",
  "Spanish Latte",
  "Matchanese Espresso",
  "Seasalt Latte"
];

function choiceSlotsForPackageType(packageType) {
  if (packageType === "signature") return 3;
  if (packageType === "special") return 5;
  if (packageType === "starter") return 1;
  return 0;
}

function choiceCatalog(includeCoffee) {
  if (includeCoffee) return MOBILE_BAR_CHOICE_CATALOG.slice();
  return MOBILE_BAR_CHOICE_CATALOG.filter((d) => !COFFEE_DRINKS.includes(d));
}

function normalizeCustomerChoiceDrinks(rawDrinks, maxSlots, includeCoffee) {
  const allowed = new Set(choiceCatalog(includeCoffee).map((d) => d.toLowerCase()));
  const out = [];
  const seen = new Set();
  (Array.isArray(rawDrinks) ? rawDrinks : []).forEach((raw) => {
    const name = String(raw || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!allowed.has(key) || seen.has(key)) return;
    const canonical = choiceCatalog(includeCoffee).find((d) => d.toLowerCase() === key);
    if (!canonical) return;
    seen.add(key);
    out.push(canonical);
  });
  const limit = Math.max(0, parseInt(maxSlots, 10) || 0);
  return out.slice(0, limit);
}

function buildMobileBarMenuLines(choiceSlots, coffeeAddOn, choiceDrinks) {
  const n = parseInt(choiceSlots, 10) || 0;
  const named = normalizeCustomerChoiceDrinks(choiceDrinks, Math.max(n, 0), !!coffeeAddOn);
  const lines = [...MOBILE_BAR_SIGNATURE_DRINKS];
  named.forEach((drink) => lines.push(drink));
  const remaining = n - named.length;
  if (remaining > 0) {
    lines.push(
      remaining === 1
        ? "1 additional drink of choice"
        : `${remaining} additional drinks of choice`
    );
  }
  return lines;
}

async function updatePublicChoiceDrinks(rawToken, payload, db = getDb()) {
  const token = normalizeToken(rawToken);
  if (!token) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }
  const doc = await findPublishedInvoiceByToken(token, db);
  if (!doc || !doc.id) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }

  const itemId = payload?.itemId;
  const drinks = payload?.drinks;
  if (itemId == null || itemId === "") {
    return { ok: false, status: 400, message: "Missing package item" };
  }
  if (!Array.isArray(drinks)) {
    return { ok: false, status: 400, message: "Drinks must be a list" };
  }

  const items = Array.isArray(doc.invoiceItems) ? doc.invoiceItems.map((item) => ({ ...item })) : [];
  const index = items.findIndex((item) => String(item.id) === String(itemId));
  if (index < 0) {
    return { ok: false, status: 404, message: "Package not found on this invoice" };
  }

  const item = items[index];
  if (item.isWorkshop || !item.packageType || item.packageType === "custom") {
    return { ok: false, status: 400, message: "This package has no drink choices" };
  }

  const slots = choiceSlotsForPackageType(item.packageType);
  if (slots <= 0) {
    return { ok: false, status: 400, message: "This package has no drink choices" };
  }

  const includeCoffee = !!item.coffeeAddOn;
  const normalized = normalizeCustomerChoiceDrinks(drinks, slots, includeCoffee);
  if (normalized.length !== drinks.filter((d) => String(d || "").trim()).length) {
    // Some submitted names were invalid / duplicates — still accept normalized set,
    // but reject if they tried to submit more than allowed after normalization.
  }
  if (drinks.length > slots) {
    return {
      ok: false,
      status: 400,
      message: `Choose up to ${slots} drink${slots === 1 ? "" : "s"}`
    };
  }
  if (normalized.length > slots) {
    return {
      ok: false,
      status: 400,
      message: `Choose up to ${slots} drink${slots === 1 ? "" : "s"}`
    };
  }

  item.choiceDrinks = normalized;
  item.menuItems = buildMobileBarMenuLines(slots, includeCoffee, normalized);
  items[index] = item;

  await db.collection(COLLECTION).doc(String(doc.id)).update({
    invoiceItems: items,
    choiceDrinksUpdatedAt: new Date().toISOString()
  });

  const updated = { ...doc, invoiceItems: items };
  const payments = await loadInvoicePayments(doc.id, db);
  return { ok: true, data: toPublicInvoice(updated, payments) };
}

module.exports = {
  COLLECTION,
  PROOFS_COLLECTION,
  TOKEN_PATTERN,
  normalizeToken,
  roundMoney,
  computePaymentSummary,
  toPublicInvoice,
  findPublishedInvoiceByToken,
  getPublicInvoiceByToken,
  loadInvoicePayments,
  updatePublicChoiceDrinks,
  choiceSlotsForPackageType,
  choiceCatalog,
  buildMobileBarMenuLines,
  normalizeCustomerChoiceDrinks,
  activeMilestones,
  sanitizeMilestone,
  MOBILE_BAR_CHOICE_CATALOG,
  COFFEE_DRINKS
};
