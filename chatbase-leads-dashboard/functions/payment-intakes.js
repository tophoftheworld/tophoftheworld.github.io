const admin = require("firebase-admin");
const {
  findOrder,
  markOrderPaid,
  normalizeOrderNumber,
  resolveIntakeClientName
} = require("./shopify-admin");

const COLLECTION = "paymentIntakes";

const PAID_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);
const UNPAID_STATUSES = new Set(["pending", "partially_paid", "authorized", "voided"]);

function pickString(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

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

function verifyActionSecret(req) {
  const expected = process.env.CHATBASE_ACTION_SECRET;
  if (!expected) {
    return { ok: false, status: 500, message: "Missing CHATBASE_ACTION_SECRET env" };
  }
  const provided = req.headers["x-chatbase-action-secret"];
  if (provided !== expected) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}

function buildMessageForUser({ outcome, orderName }) {
  const ref = orderName || "your order";
  if (outcome === "marked_paid") {
    return `Thank you! We've received your payment for ${ref}. Your order is being processed.`;
  }
  if (outcome === "already_paid") {
    return `Thanks! We already have payment recorded for ${ref}. You're all set.`;
  }
  if (outcome === "not_found") {
    return `We couldn't find that order. Please send your order number from your confirmation email (for example, M#2053).`;
  }
  if (outcome === "ambiguous_name") {
    return `We found more than one open order for that name. Please send your order number from your confirmation email (for example, M#2053).`;
  }
  if (outcome === "mark_failed") {
    return `We logged your payment for ${ref}, but couldn't update the order automatically. Our team will confirm it shortly.`;
  }
  return "Thanks! We've received your payment details.";
}

function serializeIntakeRow(id, data) {
  return { id, ...data };
}

function parsePaymentPayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object" };
  }

  const orderNumber = pickString(body, ["orderNumber", "order_number", "orderName", "order_name"]);
  const clientName = pickString(body, ["clientName", "client_name", "name", "payerName", "payer_name"]);
  const amount = pickString(body, ["amount", "paymentAmount", "payment_amount"]);
  const paymentMethod = pickString(body, ["paymentMethod", "payment_method", "method"]);
  const referenceNumber = pickString(body, [
    "referenceNumber",
    "reference_number",
    "transactionRef",
    "transaction_ref",
    "ref"
  ]);
  const notes = pickString(body, ["notes", "note"]);

  if (!orderNumber && !clientName) {
    return {
      ok: false,
      message: "Provide at least orderNumber or clientName"
    };
  }

  return {
    ok: true,
    data: {
      orderNumber: orderNumber ? normalizeOrderNumber(orderNumber) || orderNumber : null,
      clientName,
      amount,
      paymentMethod,
      referenceNumber,
      notes
    }
  };
}

function parseDateBound(dateStr, endOfDay) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  return endOfDay ? `${dateStr}T23:59:59.999Z` : `${dateStr}T00:00:00.000Z`;
}

function rowInDateRange(iso, startBound, endBound) {
  if (!iso) return false;
  if (startBound && iso < startBound) return false;
  if (endBound && iso > endBound) return false;
  return true;
}

async function processPaymentProof(payload) {
  const now = new Date().toISOString();
  const {
    orderNumber,
    clientName,
    amount,
    paymentMethod,
    referenceNumber,
    notes,
  } = payload;

  let match = null;
  try {
    match = await findOrder({ orderNumber, clientName });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: err.message,
      messageForUser: buildMessageForUser({ outcome: "mark_failed", orderName: orderNumber })
    };
  }

  if (match?.ambiguous) {
    return {
      ok: false,
      status: 400,
      message: `Multiple unpaid orders match that name (${match.count})`,
      messageForUser: buildMessageForUser({ outcome: "ambiguous_name" })
    };
  }

  if (!match?.order) {
    return {
      ok: false,
      status: 400,
      message: "Order not found",
      messageForUser: buildMessageForUser({ outcome: "not_found" })
    };
  }

  const { order, matchMethod } = match;

  const fin = order.financialStatus;
  let intakeStatus = "marked_paid";
  let shopifyMarkPaid = { ok: false, at: now };

  if (PAID_STATUSES.has(fin)) {
    intakeStatus = "already_paid";
    shopifyMarkPaid = { ok: true, skipped: "already_paid", at: now };
  } else if (UNPAID_STATUSES.has(fin)) {
    try {
      shopifyMarkPaid = await markOrderPaid(order.id);
      intakeStatus = "marked_paid";
    } catch (err) {
      intakeStatus = "mark_failed";
      shopifyMarkPaid = { ok: false, error: err.message, at: now };
    }
  } else {
    intakeStatus = "mark_failed";
    shopifyMarkPaid = { ok: false, error: `Unsupported financial status: ${fin}`, at: now };
  }

  const record = {
    source: "chatbase_action",
    clientName: resolveIntakeClientName(clientName, order, matchMethod),
    orderNumber: orderNumber || order.name,
    shopifyOrderId: String(order.id),
    shopifyOrderName: order.name,
    shopifyOrderCreatedAt: order.createdAt || null,
    amount: amount || null,
    paymentMethod: paymentMethod || null,
    referenceNumber: referenceNumber || null,
    notes: notes || null,
    automated: true,
    matchMethod,
    status: intakeStatus,
    shopifyMarkPaid,
    createdAt: now,
    updatedAt: now
  };

  const docRef = await getDb().collection(COLLECTION).add(record);

  const outcome =
    intakeStatus === "already_paid"
      ? "already_paid"
      : intakeStatus === "mark_failed"
        ? "mark_failed"
        : "marked_paid";

  if (intakeStatus === "mark_failed") {
    return {
      ok: false,
      status: 502,
      id: docRef.id,
      orderName: order.name,
      shopifyOrderId: order.id,
      status: intakeStatus,
      message: shopifyMarkPaid.error || "Mark as paid failed",
      messageForUser: buildMessageForUser({ outcome, orderName: order.name })
    };
  }

  return {
    ok: true,
    created: true,
    id: docRef.id,
    orderName: order.name,
    shopifyOrderId: order.id,
    status: intakeStatus,
    matchMethod,
    messageForUser: buildMessageForUser({ outcome, orderName: order.name })
  };
}

async function listPaymentIntakes({
  startDate,
  endDate,
  status,
  search,
  page = 1,
  size = 20
}) {
  const db = getDb();
  const startBound = parseDateBound(startDate, false);
  const endBound = parseDateBound(endDate, true);
  const snap = await db.collection(COLLECTION).orderBy("createdAt", "desc").limit(500).get();

  let rows = snap.docs.map((doc) => serializeIntakeRow(doc.id, doc.data()));

  if (status) {
    const needle = String(status).trim().toLowerCase();
    rows = rows.filter((row) => String(row.status || "").toLowerCase() === needle);
  }

  if (search) {
    const q = String(search).trim().toLowerCase();
    rows = rows.filter((row) => {
      const hay = [
        row.shopifyOrderName,
        row.orderNumber,
        row.clientName,
        row.referenceNumber,
        row.paymentMethod
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  rows = rows.filter((row) => rowInDateRange(row.createdAt, startBound, endBound));

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * size;
  const data = rows.slice(start, start + size);

  return {
    data,
    meta: {
      page: safePage,
      size,
      count: data.length,
      total,
      hasMore: safePage < totalPages
    }
  };
}

async function getPaymentIntakeByOrder(shopifyOrderId) {
  const id = String(shopifyOrderId || "").trim();
  if (!id) return null;

  const snap = await getDb().collection(COLLECTION).where("shopifyOrderId", "==", id).limit(25).get();
  if (snap.empty) return null;
  const sorted = snap.docs
    .map((doc) => serializeIntakeRow(doc.id, doc.data()))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return sorted[0] || null;
}

async function getPaymentIntakesByOrders(shopifyOrderIds) {
  const unique = [...new Set((shopifyOrderIds || []).map((x) => String(x).trim()).filter(Boolean))];
  if (!unique.length) return {};

  const snap = await getDb().collection(COLLECTION).orderBy("createdAt", "desc").limit(500).get();
  const map = {};
  for (const doc of snap.docs) {
    const row = serializeIntakeRow(doc.id, doc.data());
    const oid = String(row.shopifyOrderId || "");
    if (!unique.includes(oid) || map[oid]) continue;
    map[oid] = row;
  }
  return map;
}

async function deletePaymentIntakes(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!unique.length) {
    return { ok: false, status: 400, message: "No payment ids provided" };
  }
  if (unique.length > 100) {
    return { ok: false, status: 400, message: "Cannot delete more than 100 payments at once" };
  }

  const db = getDb();
  const batch = db.batch();
  let deleted = 0;
  const refs = await Promise.all(
    unique.map((id) => db.collection(COLLECTION).doc(id).get())
  );
  for (const doc of refs) {
    if (doc.exists) {
      batch.delete(doc.ref);
      deleted += 1;
    }
  }
  if (deleted > 0) {
    await batch.commit();
  }

  return { ok: true, deleted, requested: unique.length };
}

module.exports = {
  COLLECTION,
  verifyActionSecret,
  parsePaymentPayload,
  buildMessageForUser,
  processPaymentProof,
  listPaymentIntakes,
  getPaymentIntakeByOrder,
  getPaymentIntakesByOrders,
  deletePaymentIntakes,
  normalizeOrderNumber
};
