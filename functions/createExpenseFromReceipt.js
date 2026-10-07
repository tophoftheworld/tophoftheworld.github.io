/**
 * Server-side: OCR receipt → Storage + Firestore expense (+ supplier upsert).
 */
const { extractExpenseFieldsFromImage } = require('./extractExpenseReceipt');
const { defaultPaidBy } = require('./discordExpenseChannels');
const { randomUUID, createHash } = require('node:crypto');

const CATEGORY_OPTIONS = [
  'Supplies',
  'Logistics',
  'Staff',
  'Rent & Utilities',
  'Marketing',
  'Equipment',
  'Operations'
];
const DEFAULT_CATEGORY = 'Supplies';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function todayLocalIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
}

function calculateVatBreakdown(totalAmount, vatExemptAmount = 0, isVatRegistered = false) {
  if (!isVatRegistered || totalAmount <= 0) {
    return {
      totalAmount,
      vatExemptAmount: 0,
      vatableSale: 0,
      vatAmount: 0,
      isVatRegistered: false
    };
  }
  const taxableAmount = totalAmount - vatExemptAmount;
  const vatableSale = taxableAmount / 1.12;
  const vatAmount = taxableAmount - vatableSale;
  return {
    totalAmount,
    vatExemptAmount,
    vatableSale,
    vatAmount,
    isVatRegistered: true
  };
}

/**
 * @param {object|null} parsed
 * @param {{ allocation: string, branch: string|null }} channelDefaults
 * @param {string} expenseId
 * @param {string|null} receiptUrl
 * @param {{ discordAuthor?: string, notesExtra?: string }} [meta]
 */
function buildExpenseFromParsed(parsed, channelDefaults, expenseId, receiptUrl, meta = {}) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const rawItems = Array.isArray(p.items) ? p.items.filter((i) => i && i.name) : [];
  let total = Number(p.totalAmount) || 0;
  if (!total && rawItems.length) {
    total = rawItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  }

  const items =
    rawItems.length > 0
      ? rawItems.map((item) => ({
          name: String(item.name || '').trim(),
          quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
          price: Number(item.price) || 0,
          total: Number(item.total) || 0
        }))
      : [
          {
            name: 'Receipt',
            quantity: 1,
            price: total,
            total
          }
        ];

  const suggested = String(p.suggestedCategory || '').trim();
  const expenseCategory = CATEGORY_OPTIONS.includes(suggested) ? suggested : DEFAULT_CATEGORY;

  // Channel owns allocation/branch for Discord ingest
  const allocation = channelDefaults.allocation || 'General';
  const branch = allocation === 'Store' ? channelDefaults.branch || null : null;

  const hasPrintedVat =
    (Number(p.printedVat?.vatableSale) || 0) > 0 || (Number(p.printedVat?.vatAmount) || 0) > 0;
  const supplierVat =
    typeof p.supplierVatRegistered === 'boolean'
      ? p.supplierVatRegistered
      : hasPrintedVat
        ? true
        : false;
  const claimable = typeof p.inputVatClaimable === 'boolean' ? p.inputVatClaimable : null;
  let vatOn = supplierVat || (Number(p.vatExemptAmount) || 0) > 0 || hasPrintedVat;
  if (claimable === false) vatOn = false;

  const vatExemptAmount = Number(p.vatExemptAmount) || 0;
  const vat = vatOn
    ? calculateVatBreakdown(total, vatExemptAmount, true)
    : calculateVatBreakdown(total, 0, false);

  const author = String(meta.discordAuthor || '').trim();
  const notesParts = [];
  if (meta.notesExtra) notesParts.push(String(meta.notesExtra).trim());
  if (author) notesParts.push(`Discord: ${author}`);

  const nowIso = new Date().toISOString();
  return {
    id: expenseId,
    date: p.date || todayLocalIso(),
    branch,
    allocation,
    eventName: null,
    isPettyCash: false,
    supplierName: String(p.supplierName || '').trim() || 'Unknown supplier',
    businessName: String(p.businessName || '').trim(),
    tin: String(p.tin || '').trim(),
    address: String(p.address || '').trim(),
    invoiceNumber: String(p.invoiceNumber || '').trim(),
    items,
    totalAmount: total,
    vatExemptAmount: vat.vatExemptAmount,
    vatableSale: vat.vatableSale,
    vatAmount: vat.vatAmount,
    expenseCategory,
    paidBy: defaultPaidBy(allocation),
    notes: notesParts.filter(Boolean).join(' · '),
    receiptImage: receiptUrl || null,
    hasReceiptImage: Boolean(receiptUrl),
    isVatRegistered: supplierVat,
    vatComputationEnabled: vatOn,
    recordedVia: 'discord',
    recordedBy: author || 'Discord',
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

/**
 * Find or create supplier in Firestore.
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} expense
 * @returns {Promise<string|null>} supplierId
 */
async function upsertSupplierForExpense(db, expense) {
  const supplierName = String(expense.supplierName || '').trim();
  if (!supplierName || supplierName === 'Unknown supplier') return null;

  const snap = await db.collection('suppliers').get();
  const nameLower = supplierName.toLowerCase();
  const bizLower = String(expense.businessName || '')
    .trim()
    .toLowerCase();

  let existing = null;
  for (const doc of snap.docs) {
    const s = doc.data() || {};
    const sn = String(s.name || '').toLowerCase();
    const bn = String(s.businessName || '').toLowerCase();
    if (sn === nameLower || (bizLower && bn === bizLower)) {
      existing = { id: doc.id, ...s };
      break;
    }
  }

  if (existing) {
    const patch = {};
    if (expense.isVatRegistered && !existing.isVatRegistered) patch.isVatRegistered = true;
    if (!(existing.tin || '').trim() && (expense.tin || '').trim()) patch.tin = expense.tin;
    if (!(existing.address || '').trim() && (expense.address || '').trim()) {
      patch.address = expense.address;
    }
    if (!(existing.businessName || '').trim() && (expense.businessName || '').trim()) {
      patch.businessName = expense.businessName;
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date().toISOString();
      await db.collection('suppliers').doc(existing.id).set(patch, { merge: true });
    }
    return existing.id;
  }

  const id = generateId();
  const row = {
    id,
    name: supplierName,
    businessName: expense.businessName || '',
    tin: expense.tin || '',
    address: expense.address || '',
    isVatRegistered: Boolean(expense.isVatRegistered),
    createdAt: new Date().toISOString()
  };
  await db.collection('suppliers').doc(id).set(row);
  return id;
}

/**
 * Upload image buffer to Storage and return download URL.
 * @param {import('firebase-admin').storage.Storage} storage
 * @param {string} expenseId
 * @param {Buffer} buffer
 * @param {string} contentType
 */
async function uploadReceiptBuffer(storage, expenseId, buffer, contentType) {
  const bucket = storage.bucket();
  const path = `expense-receipts/${expenseId}`;
  const file = bucket.file(path);
  const token = randomUUID();
  await file.save(buffer, {
    metadata: {
      contentType: contentType || 'image/jpeg',
      cacheControl: 'private,max-age=3600',
      metadata: { firebaseStorageDownloadTokens: token }
    },
    resumable: false
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  const check = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
  if (!check.ok) throw new Error(`Stored receipt could not be retrieved (${check.status})`);
  return url;
}

/**
 * Full pipeline: OCR → Storage → Firestore.
 * @param {{
 *   admin: typeof import('firebase-admin'),
 *   apiKey: string,
 *   imageBuffer: Buffer,
 *   mimeType?: string,
 *   channelDefaults: { allocation: string, branch: string|null, label?: string },
 *   discordAuthor?: string,
 *   signal?: AbortSignal,
 *   ocrOptions?: {
 *     models?: string[],
 *     maxAttemptsPerModel?: number,
 *     fetchTimeoutMs?: number
 *   }
 * }} opts
 */
async function createExpenseFromReceiptImage(opts) {
  const {
    admin,
    apiKey,
    imageBuffer,
    mimeType = 'image/jpeg',
    channelDefaults,
    discordAuthor = '',
    signal,
    ocrOptions = {}
  } = opts;

  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length < 32) {
    const err = new Error('Receipt image is missing or empty');
    err.code = 'invalid-argument';
    throw err;
  }

  const expenseId = opts.expenseId || generateId();
  const db = admin.firestore();
  const expenseRef = db.collection('expenses').doc(expenseId);
  const existing = await expenseRef.get();
  if (existing.exists) return { expense: existing.data(), parsed: null };
  const receiptHash = createHash('sha256').update(imageBuffer).digest('hex');
  const hashRef = opts.source ? db.collection('discord_receipt_hashes').doc(receiptHash) : null;
  if (hashRef) {
    const prior = (await hashRef.get()).data();
    if (prior) {
      const expense = (await db.collection('expenses').doc(prior.expenseId).get()).data();
      if (expense) return { expense, parsed: null, duplicate: true };
      throw Object.assign(new Error('This receipt was previously recorded and its expense was removed. Please review it before re-entering.'), { needsReview: true });
    }
  }
  const imageBase64 = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

  const parsed = await extractExpenseFieldsFromImage({
    apiKey,
    imageBase64,
    mimeType,
    signal,
    models: ocrOptions.models,
    maxAttemptsPerModel: ocrOptions.maxAttemptsPerModel,
    fetchTimeoutMs: ocrOptions.fetchTimeoutMs,
    preserveDate: Boolean(opts.source)
  });

  if (signal?.aborted) {
    const err = new Error('Receipt OCR timed out');
    err.staffFacing = true;
    throw err;
  }

  const storage = admin.storage();

  if (opts.source) validateReceipt(parsed);

  const receiptUrl = await uploadReceiptBuffer(storage, expenseId, imageBuffer, mimeType);
  const expense = buildExpenseFromParsed(parsed, channelDefaults, expenseId, receiptUrl, {
    discordAuthor
  });

  const supplierId = await upsertSupplierForExpense(db, expense);
  if (supplierId) expense.supplierId = supplierId;

  expense.syncedAt = new Date().toISOString();
  expense.deviceId = 'discord-bot';
  if (opts.source) {
    expense.discordSource = opts.source;
    expense.receiptHash = receiptHash;
  }

  // Never overwrite an existing receipt, including after an ambiguous write timeout.
  try {
    if (hashRef) {
      const result = await db.runTransaction(async (tx) => {
        const sameId = await tx.get(expenseRef);
        const sameImage = await tx.get(hashRef);
        if (sameId.exists) return { expense: sameId.data(), parsed };
        if (sameImage.exists) {
          const prior = await tx.get(db.collection('expenses').doc(sameImage.data().expenseId));
          if (!prior.exists) throw Object.assign(new Error('Previously saved receipt requires review.'), { needsReview: true });
          return { expense: prior.data(), parsed, duplicate: true };
        }
        tx.create(expenseRef, expense);
        tx.create(hashRef, { expenseId, createdAt: new Date().toISOString() });
        return { expense, parsed };
      });
      return result;
    }
    await expenseRef.create(expense);
  } catch (err) {
    const committed = await expenseRef.get();
    if (committed.exists) return { expense: committed.data(), parsed };
    throw err;
  }

  return { expense, parsed };
}

function validateReceipt(parsed) {
  const date = String(parsed.date || '');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!parsed.supplierName || !(parsed.totalAmount > 0) || !validDate ||
      date > todayLocalIso() || parsed.vatExemptAmount < 0 ||
      parsed.vatExemptAmount > parsed.totalAmount) {
    const err = new Error('Receipt needs review: check the supplier, date, amount and VAT in the Expenses app. No expense was saved.');
    err.needsReview = true;
    throw err;
  }
}

module.exports = {
  generateId,
  todayLocalIso,
  calculateVatBreakdown,
  buildExpenseFromParsed,
  upsertSupplierForExpense,
  uploadReceiptBuffer,
  createExpenseFromReceiptImage,
  validateReceipt,
  CATEGORY_OPTIONS,
  DEFAULT_CATEGORY
};
