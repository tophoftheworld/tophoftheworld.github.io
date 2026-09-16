/**
 * Expense search / create for Purchasing Reconcile.
 * Writes the same Firestore `expenses` collection the Expenses app uses.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from '../firebase.js?v=96';
import { locationLabel, itemDisplayName } from './catalog.js?v=96';
import { lineAmount, isFee } from '../compute.js?v=96';

let cachedExpenses = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

/** Days after weekEnd still included when picking expenses to link. */
export const EXPENSE_WINDOW_GRACE_DAYS = 3;

export async function loadRecentExpenses({ force = false, max = 200 } = {}) {
  if (!force && cachedExpenses && Date.now() - cachedAt < CACHE_MS) {
    return cachedExpenses;
  }
  try {
    const q = query(collection(db, 'expenses'), orderBy('date', 'desc'), limit(max));
    const snap = await getDocs(q);
    cachedExpenses = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (err) {
    // Fallback without orderBy if index missing
    console.warn('Expense ordered query failed, using unordered', err);
    const snap = await getDocs(collection(db, 'expenses'));
    cachedExpenses = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, max);
  }
  cachedAt = Date.now();
  return cachedExpenses;
}

export function invalidateExpenseCache() {
  cachedExpenses = null;
  cachedAt = 0;
}

export async function getExpenseById(expenseId) {
  if (!expenseId) return null;
  if (cachedExpenses) {
    const hit = cachedExpenses.find((e) => e.id === expenseId);
    if (hit) return hit;
  }
  try {
    const snap = await getDoc(doc(db, 'expenses', expenseId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() || {}) };
  } catch (err) {
    console.warn('getExpenseById failed', err);
    return null;
  }
}

export async function patchExpenseReceipt(expenseId, { receiptImage, hasReceiptImage = true }) {
  if (!expenseId) return;
  const payload = {
    receiptImage: receiptImage || null,
    hasReceiptImage: Boolean(hasReceiptImage && receiptImage),
    updatedAt: new Date().toISOString(),
  };
  await updateDoc(doc(db, 'expenses', expenseId), payload);
  if (cachedExpenses) {
    cachedExpenses = cachedExpenses.map((e) =>
      e.id === expenseId ? { ...e, ...payload } : e
    );
  }
}

function addDaysIso(iso, days) {
  if (!iso || iso.length < 10) return iso;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Inclusive date window for reconcile linking: weekStart \u2026 weekEnd + grace.
 */
export function expenseDateWindow(week, { graceDays = EXPENSE_WINDOW_GRACE_DAYS } = {}) {
  const start = week?.weekStart || null;
  const end = week?.weekEnd ? addDaysIso(week.weekEnd, graceDays) : null;
  return { start, end };
}

export function expenseInDateWindow(exp, { start, end } = {}) {
  const date = String(exp?.date || '').slice(0, 10);
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

export function filterExpensesForWeek(expenses, week, opts = {}) {
  const window = expenseDateWindow(week, opts);
  if (!window.start && !window.end) return expenses || [];
  return (expenses || []).filter((exp) => expenseInDateWindow(exp, window));
}

function normalizeSupplier(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function supplierMatchScore(expenseName, hintName) {
  const a = normalizeSupplier(expenseName);
  const b = normalizeSupplier(hintName);
  if (!a || !b) return 0;
  if (a === b) return 50;
  if (a.includes(b) || b.includes(a)) return 42;
  const aTok = a.split(' ').filter((t) => t.length > 1);
  const bTok = b.split(' ').filter((t) => t.length > 1);
  if (!aTok.length || !bTok.length) return 0;
  const shared = bTok.filter((t) => aTok.some((x) => x === t || x.startsWith(t) || t.startsWith(x)));
  if (!shared.length) return 0;
  const ratio = shared.length / Math.max(bTok.length, 1);
  return Math.round(18 + ratio * 22);
}

function amountNearScore(amount, planned) {
  if (planned == null || planned <= 0 || !(amount > 0)) return 0;
  const diff = Math.abs(amount - planned);
  const pct = diff / planned;
  if (diff === 0) return 45;
  if (pct <= 0.03 || diff <= 25) return 40;
  if (pct <= 0.08 || diff <= 75) return 32;
  if (pct <= 0.15 || diff <= 150) return 22;
  if (pct <= 0.25) return 12;
  return 0;
}

function itemMatchScore(exp, line) {
  if (!line) return 0;
  const name = itemDisplayName(line).toLowerCase();
  if (!name) return 0;
  const items = (exp.items || []).map((i) => String(i.name || '').toLowerCase());
  const joined = items.join(' ');
  if (joined.includes(name)) return 20;
  const stem = name.split(/\s+/).filter((t) => t.length > 3).slice(0, 2);
  if (stem.length && stem.every((t) => joined.includes(t))) return 16;
  if (stem.some((t) => joined.includes(t))) return 8;
  return 0;
}

/**
 * Rank expenses for linking. Returns { exp, score, suggested, reasons[] }.
 * `suggested` only affects sort order \u2014 UI must not style suggestions differently.
 */
export function searchExpenses(expenses, queryText, { line = null } = {}) {
  const q = String(queryText || '')
    .trim()
    .toLowerCase();
  const supplierHint =
    line?.supplierName && line.supplierName !== 'Unassigned' ? line.supplierName : '';
  const planned = line ? lineAmount(line) : null;

  const scored = (expenses || []).map((exp) => {
    const supplier = String(exp.supplierName || '');
    const items = (exp.items || []).map((i) => String(i.name || '')).join(' ');
    const amount = Number(exp.totalAmount) || 0;
    const hay = `${supplier} ${items} ${exp.date || ''} ${amount}`.toLowerCase();

    if (q && !hay.includes(q) && !normalizeSupplier(supplier).includes(normalizeSupplier(q))) {
      return null;
    }

    const reasons = [];
    let score = q ? 8 : 1;

    const supScore = supplierMatchScore(supplier, supplierHint);
    if (supScore) {
      score += supScore;
      reasons.push('supplier');
    }
    const amtScore = amountNearScore(amount, planned);
    if (amtScore) {
      score += amtScore;
      reasons.push(amtScore >= 32 ? 'amount' : 'near');
    }
    const itemScore = itemMatchScore(exp, line);
    if (itemScore) {
      score += itemScore;
      reasons.push('item');
    }
    if (q && normalizeSupplier(supplier).includes(normalizeSupplier(q))) score += 15;

    const suggested =
      !q && (supScore >= 40 || (supScore >= 18 && amtScore >= 22) || amtScore >= 40 || itemScore >= 16);

    if (suggested) score += 8;

    return { exp, score, suggested, reasons };
  });

  return scored
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(b.suggested) - Number(a.suggested) ||
        b.score - a.score ||
        String(b.exp.date || '').localeCompare(String(a.exp.date || ''))
    )
    .slice(0, 50);
}

/** @deprecated Kept for callers; UI no longer shows match badges. */
export function matchReasonLabel(reasons) {
  if (!reasons?.length) return '';
  if (reasons.includes('supplier') && reasons.includes('amount')) return 'Supplier + amount';
  if (reasons.includes('supplier') && reasons.includes('near')) return 'Supplier \u00B7 near amount';
  if (reasons.includes('supplier')) return 'Same supplier';
  if (reasons.includes('amount')) return 'Amount match';
  if (reasons.includes('near')) return 'Near amount';
  if (reasons.includes('item')) return 'Item match';
  return 'Suggested';
}

export function locationToExpenseFields(locationKey) {
  if (locationKey === 'events' || (typeof locationKey === 'string' && locationKey.startsWith('event:'))) {
    return {
      allocation: 'Popup',
      branch: '',
      eventName: locationLabel(locationKey) || 'Event',
    };
  }
  return {
    allocation: 'Store',
    branch: locationLabel(locationKey),
    eventName: '',
  };
}

function newExpenseId() {
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create an expense from one or more purchasing lines and write to Firestore.
 * Optional overrides for the Purchasing Add Expense modal (single-line form).
 */
export async function createExpenseFromLines(
  lines,
  {
    date = null,
    notes = '',
    supplierName = null,
    supplierId = null,
    quantity = null,
    price = null,
    totalAmount: totalOverride = null,
    itemName = null,
    allocation = null,
    branch = null,
    eventName = null,
    receiptImage = null,
    hasReceiptImage = false,
  } = {}
) {
  const list = (lines || []).filter(Boolean);
  if (!list.length) throw new Error('No lines to create an expense from');

  const primary = list[0];
  const locFields = locationToExpenseFields(primary.location);
  const singleOverride = list.length === 1 && (quantity != null || price != null || totalOverride != null || itemName);

  const items = list.map((line) => {
    if (singleOverride && line === primary) {
      const qty = isFee(line) ? 1 : Number(quantity != null ? quantity : line.qty) || 1;
      let total;
      let unitPrice;
      if (totalOverride != null && totalOverride !== '') {
        total = Number(totalOverride) || 0;
        unitPrice = qty > 0 ? total / qty : total;
      } else {
        unitPrice =
          price != null && price !== ''
            ? Number(price) || 0
            : qty > 0
              ? lineAmount(line) / qty
              : lineAmount(line);
        total = Math.round(qty * unitPrice);
      }
      return {
        name: (itemName || itemDisplayName(line) || 'Item').trim(),
        quantity: qty,
        price: unitPrice,
        total,
      };
    }
    const qty = isFee(line) ? 1 : Number(line.qty) || 1;
    const total = lineAmount(line);
    const unitPrice = qty > 0 ? total / qty : total;
    return {
      name: itemDisplayName(line),
      quantity: qty,
      price: unitPrice,
      total,
    };
  });
  const totalAmount = items.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const id = newExpenseId();
  const now = new Date().toISOString();
  const expense = {
    id,
    date: date || now.slice(0, 10),
    supplierName:
      supplierName != null
        ? String(supplierName).trim()
        : primary.supplierName || '',
    supplierId:
      supplierId != null ? String(supplierId).trim() : primary.supplierId || '',
    businessName: '',
    tin: '',
    address: '',
    isVatRegistered: false,
    items,
    totalAmount,
    vatExemptAmount: 0,
    vatableSale: 0,
    vatAmount: 0,
    vatComputationEnabled: false,
    invoiceNumber: '',
    expenseCategory: isFee(primary) ? 'Logistics' : 'Supplies',
    paidBy: 'Company',
    notes: notes || `From Purchasing \u00B7 ${list.map((l) => itemDisplayName(l)).join(', ')}`,
    isPettyCash: false,
    receiptImage: receiptImage || null,
    hasReceiptImage: Boolean(hasReceiptImage || receiptImage),
    allocation: allocation != null ? allocation : locFields.allocation,
    branch: branch != null ? branch : locFields.branch,
    eventName: eventName != null ? eventName : locFields.eventName,
    createdAt: now,
    updatedAt: now,
    source: 'purchasing',
    purchasingLineIds: list.map((l) => l.id),
  };

  await setDoc(doc(db, 'expenses', id), expense);
  invalidateExpenseCache();
  if (cachedExpenses) {
    cachedExpenses = [expense, ...cachedExpenses];
  }
  return expense;
}

export function expenseDisplayLabel(exp) {
  if (!exp) return '';
  const supplier = exp.supplierName || 'Expense';
  const amount = Number(exp.totalAmount) || 0;
  const items = (exp.items || [])
    .slice(0, 2)
    .map((i) => i.name)
    .filter(Boolean)
    .join(', ');
  return `${exp.date || '\u2014'} \u00B7 ${supplier} \u00B7 \u20B1${amount.toLocaleString()}${items ? ` \u00B7 ${items}` : ''}`;
}
