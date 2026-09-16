const admin = require("firebase-admin");
const {
  normalizeToken,
  findPublishedInvoiceByToken,
  toPublicInvoice,
  roundMoney,
  loadInvoicePayments,
  PROOFS_COLLECTION
} = require("./public-invoice");
const {
  scheduleMilestones,
  allocatePaymentWaterfall,
  reallocateAllPayments,
  enrichMilestonesWithPayments,
  totalRemainingOnSchedule,
  toFiniteNumber: allocToFinite,
  softSyncMilestonesFromPayments,
  buildScheduleFromStructure,
  repairInvoicePaymentState,
  invoiceLooksPaymentBroken,
  findDuplicatePayment
} = require("./invoice-payment-alloc");

const INVOICE_COLLECTION = "invoice-generator";
const STORAGE_PREFIX = "invoice-payment-proofs";

const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS_PER_MODEL = 3;

const PAYMENT_METHODS = ["gcash", "maya", "gotyme", "bank", "other"];

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    amount: { type: "NUMBER", nullable: true },
    paymentMethod: {
      type: "STRING",
      nullable: true,
      enum: [...PAYMENT_METHODS, null]
    },
    referenceNumber: { type: "STRING", nullable: true },
    paidAt: { type: "STRING", nullable: true },
    senderName: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER", nullable: true }
  },
  required: []
};

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

function getBucket() {
  if (!admin.apps.length) getDb();
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.STORAGE_BUCKET ||
    "matchanese-attendance.firebasestorage.app";
  return admin.storage().bucket(bucketName);
}

function stripDataUrl(base64OrDataUrl) {
  if (!base64OrDataUrl || typeof base64OrDataUrl !== "string") return "";
  const m = base64OrDataUrl.match(/^data:image\/[\w+.-]+;base64,(.+)$/i);
  return (m ? m[1] : base64OrDataUrl).replace(/\s/g, "");
}

function detectMimeType(imageBase64, explicitMime) {
  if (explicitMime && String(explicitMime).startsWith("image/")) return explicitMime;
  if (typeof imageBase64 === "string") {
    const m = imageBase64.match(/^data:(image\/[\w+.-]+);base64,/i);
    if (m) return m[1];
  }
  return "image/jpeg";
}

function extensionForMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "jpg";
}

function toFiniteNumber(value) {
  return allocToFinite(value);
}

function localTodayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizePaidAt(value) {
  if (!value) return "";
  const s = String(value).trim();
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (slash) {
    const a = parseInt(slash[1], 10);
    const b = parseInt(slash[2], 10);
    const y = slash[3];
    if (a > 12 && b <= 12) {
      return `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    }
    return `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }
  return "";
}

function normalizePaymentMethod(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!raw) return "other";
  if (raw.includes("gcash") || raw.includes("g-cash")) return "gcash";
  if (raw.includes("maya") || raw.includes("paymaya")) return "maya";
  if (raw.includes("gotyme") || raw.includes("go tyme")) return "gotyme";
  if (
    raw.includes("bank") ||
    raw.includes("bdo") ||
    raw.includes("bpi") ||
    raw.includes("unionbank") ||
    raw.includes("transfer")
  ) {
    return "bank";
  }
  if (PAYMENT_METHODS.includes(raw)) return raw;
  return "other";
}

function buildExtractionPrompt(todayIso) {
  return `You extract payment proof details from a Philippine e-wallet or bank transfer screenshot (GCash, Maya, GoTyme, BDO, BPI, UnionBank, etc.).

Today's date (upload context): ${todayIso}.

Return JSON only matching the schema. Rules:
- amount: the transferred / sent amount in PHP as a number (no currency symbol). Prefer the main transfer amount, not fees.
- paymentMethod: one of gcash, maya, gotyme, bank, other.
- referenceNumber: transaction / reference / control number when visible.
- paidAt: transaction date as YYYY-MM-DD when possible.
- senderName: payer / "From" name when visible.
- confidence: 0 to 1 how sure you are overall.
- Use null for unknown fields. Do not invent reference numbers.`;
}

function normalizeExtracted(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const amount = toFiniteNumber(data.amount);
  const confidence = toFiniteNumber(data.confidence);
  return {
    amount: amount != null && amount >= 0 ? roundMoney(amount) : null,
    paymentMethod: normalizePaymentMethod(data.paymentMethod),
    referenceNumber: String(data.referenceNumber || "").trim(),
    paidAt: normalizePaidAt(data.paidAt) || localTodayIso(),
    senderName: String(data.senderName || "").trim(),
    confidence:
      confidence != null ? Math.max(0, Math.min(1, confidence)) : null
  };
}

function extractJsonText(geminiResponse) {
  const parts = geminiResponse?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("\n")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 500;
}

function buildRequestBody(raw, mime, now = new Date()) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildExtractionPrompt(localTodayIso(now)) },
          { inline_data: { mime_type: mime, data: raw } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };
}

async function callGeminiModel({ apiKey, model, raw, mime }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRequestBody(raw, mime))
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

async function extractPaymentProofFromImage({ apiKey, imageBase64, mimeType }) {
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not configured");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const raw = stripDataUrl(imageBase64);
  if (!raw || raw.length < 32) {
    const err = new Error("Payment screenshot is missing or empty");
    err.code = "INVALID_IMAGE";
    throw err;
  }
  if (raw.length > MAX_IMAGE_BYTES * 1.4) {
    const err = new Error("Payment screenshot is too large");
    err.code = "INVALID_IMAGE";
    throw err;
  }

  const mime = detectMimeType(imageBase64, mimeType);
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const { res, payload } = await callGeminiModel({ apiKey, model, raw, mime });
        if (!res.ok) {
          const msg =
            payload?.error?.message ||
            `Gemini request failed (${res.status})`;
          if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(400 * attempt);
            continue;
          }
          lastError = new Error(msg);
          break;
        }
        const text = extractJsonText(payload);
        let parsed = {};
        try {
          parsed = JSON.parse(text || "{}");
        } catch {
          lastError = new Error("Could not parse payment details from screenshot");
          continue;
        }
        return normalizeExtracted(parsed);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS_PER_MODEL) await sleep(400 * attempt);
      }
    }
  }

  const err = lastError || new Error("Could not read payment screenshot");
  err.code = err.code || "EXTRACT_FAILED";
  throw err;
}

function nextUnpaidMilestone(milestones, payments = []) {
  const enriched = enrichMilestonesWithPayments(milestones, payments);
  return enriched.find((m) => roundMoney(m.remaining) > 0.5) || null;
}

function remainingUnpaidTotal(milestones, payments = []) {
  return totalRemainingOnSchedule(milestones, payments);
}

function findMilestoneIndex(milestones, milestoneId) {
  if (!Array.isArray(milestones)) return -1;
  if (milestoneId == null || milestoneId === "") return -1;
  return milestones.findIndex((m) => String(m?.id) === String(milestoneId));
}

async function extractInvoicePaymentProof({ token, imageBase64, mimeType, apiKey }) {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }
  const doc = await findPublishedInvoiceByToken(normalized);
  if (!doc) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }
  const payments = await loadInvoicePayments(doc.id);
  const due = nextUnpaidMilestone(doc.paymentMilestones, payments);
  if (!due) {
    return { ok: false, status: 400, message: "This invoice is already paid in full" };
  }

  const extracted = await extractPaymentProofFromImage({
    apiKey,
    imageBase64,
    mimeType
  });

  const amountOk = extracted.amount != null && extracted.amount > 0;
  const lowConfidence =
    extracted.confidence != null && extracted.confidence < 0.4;
  const needsClearerScreenshot = !amountOk || lowConfidence;

  return {
    ok: true,
    data: {
      ...extracted,
      needsClearerScreenshot,
      milestoneId: due.id ?? null,
      milestoneName: String(due.milestone || ""),
      remainingDue: remainingUnpaidTotal(doc.paymentMilestones, payments),
      invoiceNumber: doc.invoiceNumber || ""
    }
  };
}

async function uploadProofImage({ token, milestoneId, imageBase64, mimeType }) {
  const raw = stripDataUrl(imageBase64);
  const mime = detectMimeType(imageBase64, mimeType);
  const ext = extensionForMime(mime);
  const safeMilestone = String(milestoneId || "due").replace(/[^a-zA-Z0-9_-]/g, "");
  const path = `${STORAGE_PREFIX}/${token}/${safeMilestone}_${Date.now()}.${ext}`;
  const buffer = Buffer.from(raw, "base64");
  const bucket = getBucket();
  const file = bucket.file(path);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mime,
      cacheControl: "private, max-age=0"
    }
  });
  await file.makePublic().catch(() => {});
  const screenshotUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;
  return { path, screenshotUrl, mime };
}

async function confirmInvoicePaymentProof({
  token,
  imageBase64,
  mimeType,
  milestoneId,
  amount,
  paymentMethod,
  referenceNumber,
  paidAt,
  senderName
}) {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }
  if (!imageBase64) {
    return { ok: false, status: 400, message: "Payment screenshot is required" };
  }

  const db = getDb();
  const doc = await findPublishedInvoiceByToken(normalized, db);
  if (!doc) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }

  const existingPayments = await loadInvoicePayments(doc.id, db);
  const invoiceTotal = roundMoney(
    Number.isFinite(Number(doc.amountTotal)) ? doc.amountTotal : doc.totalAmount
  );

  let milestones = Array.isArray(doc.paymentMilestones)
    ? doc.paymentMilestones.map((m) => ({ ...m }))
    : [];
  let paymentsForAlloc = existingPayments;

  if (
    invoiceLooksPaymentBroken({
      paymentMilestones: milestones,
      paymentStructure: doc.paymentStructure,
      amountTotal: invoiceTotal
    })
  ) {
    const repaired = repairInvoicePaymentState({
      paymentMilestones: milestones,
      payments: existingPayments,
      paymentStructure: doc.paymentStructure || "three",
      amountTotal: invoiceTotal
    });
    milestones = repaired.paymentMilestones;
    paymentsForAlloc = repaired.payments.filter((p) => p.status !== "voided");
    await db.collection(INVOICE_COLLECTION).doc(String(doc.id)).update({
      paymentMilestones: milestones,
      paymentProofUpdatedAt: new Date().toISOString()
    });
    for (const p of repaired.payments) {
      if (!p?.id || String(p.id).startsWith("promoted_")) continue;
      if (p.status === "voided" && p.voidedSource === "duplicate_reference") {
        await db
          .collection(PROOFS_COLLECTION)
          .doc(String(p.id))
          .set(
            {
              status: "voided",
              voidedAt: p.voidedAt || new Date().toISOString(),
              voidedSource: "duplicate_reference",
              allocations: p.allocations || []
            },
            { merge: true }
          );
      } else if (Array.isArray(p.allocations)) {
        await db
          .collection(PROOFS_COLLECTION)
          .doc(String(p.id))
          .set({ allocations: p.allocations }, { merge: true });
      }
    }
  } else {
    milestones = scheduleMilestones(milestones);
  }

  const due = nextUnpaidMilestone(milestones, paymentsForAlloc);
  if (!due) {
    return { ok: false, status: 400, message: "No unpaid milestone to confirm" };
  }

  let preferredMilestone = due;
  const preferredIndex = findMilestoneIndex(milestones, milestoneId);
  if (preferredIndex >= 0) {
    const enriched = enrichMilestonesWithPayments(milestones, paymentsForAlloc);
    const candidate = enriched.find((m) => String(m.id) === String(milestoneId));
    if (candidate && roundMoney(candidate.remaining) > 0.5) {
      preferredMilestone = milestones[preferredIndex];
    }
  }

  const confirmedAmount = toFiniteNumber(amount);
  if (confirmedAmount == null || confirmedAmount <= 0) {
    return {
      ok: false,
      status: 400,
      message: "A valid payment amount is required from the screenshot"
    };
  }
  const method = normalizePaymentMethod(paymentMethod);
  const reference = String(referenceNumber || "").trim();
  const paidDate = normalizePaidAt(paidAt) || localTodayIso();
  const sender = String(senderName || "").trim();

  const duplicate = findDuplicatePayment(paymentsForAlloc, {
    referenceNumber: reference,
    amount: confirmedAmount,
    paidAt: paidDate,
    paymentMethod: method
  });
  if (duplicate) {
    return {
      ok: false,
      status: 409,
      message: reference
        ? "This payment reference was already submitted for this invoice"
        : "This payment was already submitted for this invoice"
    };
  }

  const { screenshotUrl, path } = await uploadProofImage({
    token: normalized,
    milestoneId: preferredMilestone.id || "due",
    imageBase64,
    mimeType
  });

  const allocations = allocatePaymentWaterfall(
    milestones,
    confirmedAmount,
    paymentsForAlloc
  );
  if (!allocations.length) {
    return { ok: false, status: 400, message: "No unpaid milestone to confirm" };
  }

  const proofRef = db.collection(PROOFS_COLLECTION).doc();
  const proofPayload = {
    invoiceId: String(doc.id),
    publicToken: normalized,
    milestoneId: allocations[0]?.milestoneId ?? preferredMilestone.id ?? null,
    milestoneName: allocations[0]?.milestoneName || String(preferredMilestone.milestone || ""),
    amount: roundMoney(confirmedAmount),
    paymentMethod: method,
    referenceNumber: reference,
    paidAt: paidDate,
    senderName: sender,
    screenshotUrl,
    storagePath: path,
    status: "sent",
    source: "customer_page",
    allocations,
    createdAt: new Date().toISOString()
  };
  await proofRef.set(proofPayload);

  const allPayments = [
    ...paymentsForAlloc,
    { id: proofRef.id, ...proofPayload }
  ];
  milestones = softSyncMilestonesFromPayments(milestones, allPayments);

  await db.collection(INVOICE_COLLECTION).doc(String(doc.id)).update({
    paymentMilestones: milestones,
    paymentProofUpdatedAt: new Date().toISOString(),
    savedAt: new Date().toISOString()
  });

  const updated = { ...doc, paymentMilestones: milestones };
  return {
    ok: true,
    data: {
      invoice: toPublicInvoice(updated, allPayments),
      proof: { id: proofRef.id, ...proofPayload }
    }
  };
}

module.exports = {
  PAYMENT_METHODS,
  normalizeExtracted,
  normalizePaymentMethod,
  nextUnpaidMilestone,
  remainingUnpaidTotal,
  softSyncMilestonesFromPayments,
  buildScheduleFromStructure,
  repairInvoicePaymentState,
  allocatePaymentWaterfall,
  reallocateAllPayments,
  extractPaymentProofFromImage,
  extractInvoicePaymentProof,
  confirmInvoicePaymentProof,
  stripDataUrl,
  detectMimeType
};
