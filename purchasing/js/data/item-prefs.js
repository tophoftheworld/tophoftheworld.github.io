import {
  collection,
  doc,
  getDocs,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from '../firebase.js?v=96';
import { getCatalog } from './catalog.js?v=96';
import { buildSupplierMatchList } from '../../../expenses/js/autocomplete.js?v=96';
import { getSuppliers } from './suppliers.js?v=96';
import { isAbsurdRate, RATE_SANITY_QTY_HINT } from '../compute.js?v=96';
import { rateForSupplier } from './rate-scope.js?v=96';

const PREFS_PATH = ['purchasing', '_config', 'itemPrefs'];

/** @type {Map<string, object>} */
let prefsByItem = new Map();

function prefsCollection() {
  return collection(db, ...PREFS_PATH);
}

function prefsDoc(itemId) {
  return doc(db, ...PREFS_PATH, itemId);
}

function normalizeSupplierHistory(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [sid, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    out[sid] = {
      supplierName: entry.supplierName || '',
      lastPaidRate:
        entry.lastPaidRate != null ? Number(entry.lastPaidRate) : null,
      lastPaidDate: entry.lastPaidDate || null,
      orderCount: Number(entry.orderCount) || 0,
    };
  }
  return out;
}

function parsePrefDoc(id, data) {
  return {
    itemId: id,
    lastSupplierId: data.lastSupplierId ?? null,
    lastSupplierName: data.lastSupplierName || '',
    lastPaidRate: data.lastPaidRate != null ? Number(data.lastPaidRate) : null,
    lastPaidDate: data.lastPaidDate || null,
    primarySupplierId: data.primarySupplierId ?? null,
    supplierHistory: normalizeSupplierHistory(data.supplierHistory),
    updatedAt: data.updatedAt || null,
  };
}

export function getItemPref(itemId) {
  if (!itemId) return null;
  return prefsByItem.get(itemId) || null;
}

export function getAllItemPrefs() {
  return prefsByItem;
}

export { isAbsurdRate, RATE_SANITY_QTY_HINT } from '../compute.js?v=96';

export function getSupplierRate(itemId, supplierId) {
  return rateForSupplier(getItemPref(itemId), supplierId);
}

/** Suppliers that have sold this item before, most-used first. */
export function getItemSupplierHistory(itemId) {
  const pref = getItemPref(itemId);
  if (!pref?.supplierHistory) return [];
  return Object.entries(pref.supplierHistory)
    .map(([supplierId, entry]) => ({
      supplierId,
      supplierName: entry.supplierName || '',
      lastPaidRate: entry.lastPaidRate,
      lastPaidDate: entry.lastPaidDate,
      orderCount: entry.orderCount || 0,
    }))
    .sort(
      (a, b) =>
        b.orderCount - a.orderCount ||
        String(b.lastPaidDate || '').localeCompare(String(a.lastPaidDate || ''))
    );
}

export function buildItemSupplierMatchList(itemId, query) {
  if (!itemId) return buildSupplierMatchList(getSuppliers, query);
  const history = getItemSupplierHistory(itemId);
  const historyIds = new Set(history.map((h) => h.supplierId));
  const base = buildSupplierMatchList(getSuppliers, query);
  const queryLower = (query || '').toLowerCase().trim();

  const boosted = history.map((h, idx) => {
    const supplier = getSuppliers().find((s) => s.id === h.supplierId);
    if (!supplier) return null;
    const name = (supplier.name || '').toLowerCase();
    const biz = (supplier.businessName || '').toLowerCase();
    let priority = idx;
    if (queryLower) {
      if (name.startsWith(queryLower) || biz.startsWith(queryLower)) priority = idx;
      else if (name.includes(queryLower) || biz.includes(queryLower)) priority = 10 + idx;
      else return null;
    }
    const safeName = escapeHtmlLite(supplier.name || '');
    const safeBiz = escapeHtmlLite(supplier.businessName || 'No business name');
    return {
      ...supplier,
      priority,
      display: `<div style="font-weight:500">${safeName}</div><div style="font-size:12px;color:#666">${safeBiz}</div>`,
    };
  }).filter(Boolean);

  const rest = base.filter((s) => !historyIds.has(s.id)).map((s) => ({
    ...s,
    priority: (s.priority ?? 7) + 20,
  }));

  return [...boosted, ...rest]
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    .slice(0, 12);
}

function escapeHtmlLite(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pickPrimarySupplier(history, lastSupplierId) {
  let best = null;
  for (const [sid, entry] of Object.entries(history)) {
    if (!best || entry.orderCount > best.orderCount) {
      best = { id: sid, ...entry };
    } else if (
      entry.orderCount === best.orderCount &&
      String(entry.lastPaidDate || '') > String(best.lastPaidDate || '')
    ) {
      best = { id: sid, ...entry };
    }
  }
  return best?.id || lastSupplierId || null;
}

export async function loadItemPrefs() {
  prefsByItem = new Map();
  try {
    const snap = await getDocs(prefsCollection());
    for (const d of snap.docs) {
      prefsByItem.set(d.id, parsePrefDoc(d.id, d.data() || {}));
    }
  } catch (err) {
    console.warn('Could not load item prefs from Firebase', err);
  }
  return prefsByItem;
}

export async function upsertItemPref(itemId, patch) {
  if (!itemId) return null;
  const prev = prefsByItem.get(itemId) || {
    itemId,
    lastSupplierId: null,
    lastSupplierName: '',
    lastPaidRate: null,
    lastPaidDate: null,
    primarySupplierId: null,
    supplierHistory: {},
  };
  const { supplierHistoryEntry, ...restPatch } = patch;
  const next = {
    ...prev,
    ...restPatch,
    itemId,
    supplierHistory: {
      ...prev.supplierHistory,
      ...(restPatch.supplierHistory || {}),
    },
    updatedAt: new Date().toISOString(),
  };
  if (supplierHistoryEntry?.supplierId) {
    const sid = supplierHistoryEntry.supplierId;
    const prevEntry = next.supplierHistory[sid] || {
      supplierName: '',
      lastPaidRate: null,
      lastPaidDate: null,
      orderCount: 0,
    };
    next.supplierHistory[sid] = {
      ...prevEntry,
      ...supplierHistoryEntry,
      orderCount:
        (prevEntry.orderCount || 0) + (supplierHistoryEntry.increment ? 1 : 0),
    };
  }
  next.primarySupplierId = pickPrimarySupplier(
    next.supplierHistory,
    next.lastSupplierId
  );
  prefsByItem.set(itemId, next);
  try {
    await setDoc(
      prefsDoc(itemId),
      {
        lastSupplierId: next.lastSupplierId,
        lastSupplierName: next.lastSupplierName || '',
        lastPaidRate: next.lastPaidRate,
        lastPaidDate: next.lastPaidDate,
        primarySupplierId: next.primarySupplierId,
        supplierHistory: next.supplierHistory,
        updatedAt: next.updatedAt,
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('Could not save item pref', itemId, err);
  }
  return next;
}

function validatedRate(line) {
  const unitRate =
    line.unitRate != null && line.unitRate > 0
      ? Number(line.unitRate)
      : null;
  if (unitRate != null && !isAbsurdRate(unitRate, line.qty || RATE_SANITY_QTY_HINT)) {
    return unitRate;
  }
  const qty = Number(line.qty) || 0;
  const cost = Number(line.estimatedCost) || 0;
  if (qty > 0 && cost > 0) {
    const derived = cost / qty;
    if (!isAbsurdRate(derived, qty)) return derived;
  }
  return line.lastPaidRate != null && !isAbsurdRate(line.lastPaidRate)
    ? Number(line.lastPaidRate)
    : null;
}

/** Persist last supplier + unit rate from a plan line. */
export async function savePrefsFromLine(line) {
  if (!line?.itemId) return null;
  const rate = validatedRate(line);
  const patch = {};
  const supplierId = line.supplierId || null;
  const supplierName =
    line.supplierName && line.supplierName !== 'Unassigned'
      ? line.supplierName
      : '';

  if (supplierId || supplierName) {
    patch.lastSupplierId = supplierId;
    patch.lastSupplierName = supplierName;
  }
  if (rate != null && rate > 0) {
    patch.lastPaidRate = rate;
    patch.lastPaidDate = new Date().toISOString().slice(0, 10);
  }
  if (supplierId && rate != null && rate > 0) {
    patch.supplierHistoryEntry = {
      supplierId,
      supplierName,
      lastPaidRate: rate,
      lastPaidDate: patch.lastPaidDate,
      increment: true,
    };
  } else if (supplierId) {
    patch.supplierHistoryEntry = {
      supplierId,
      supplierName,
      increment: true,
    };
  }
  if (!Object.keys(patch).length) return getItemPref(line.itemId);
  return upsertItemPref(line.itemId, patch);
}

function normalizeItemName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function catalogItemById(itemId) {
  const catalog = getCatalog();
  return (catalog?.items || []).find((i) => i.id === itemId) || null;
}

/**
 * Derive per-inventory-unit rate from an expense line row.
 */
export function deriveUnitRateFromExpense(row, catalogItem) {
  const qty = Number(row.quantity) || 1;
  const price = Number(row.price) || 0;
  const lineTotal = Number(row.total) || price * qty;
  if (!lineTotal || lineTotal <= 0 || qty <= 0) return null;

  let rate = lineTotal / qty;
  const catalogUnit = catalogItem?.unit || 'pcs';
  const restock = catalogItem?.restockAmount || RATE_SANITY_QTY_HINT;

  if (catalogUnit === 'g' && qty <= 10 && rate >= 50) {
    const perGram = rate / 1000;
    if (!isAbsurdRate(perGram, restock)) rate = perGram;
  }

  if (isAbsurdRate(rate, restock)) return null;
  return rate;
}

/**
 * Seed missing lastPaidRate from recent expenses by fuzzy item-name match.
 */
export async function bootstrapLatestCostsFromExpenses() {
  return rebootstrapItemPrefs({ force: false });
}

/**
 * Re-scan expenses for item rates. Overwrites missing or absurd existing rates.
 * Do not call on Purchasing boot \u2014 it downloads the full expenses collection.
 */
export async function rebootstrapItemPrefs({ force = false } = {}) {
  const catalog = getCatalog();
  const items = catalog?.items || [];
  if (!items.length) return 0;

  const byName = new Map();
  const itemById = new Map();
  for (const item of items) {
    itemById.set(item.id, item);
    const keys = [
      normalizeItemName(item.name),
      normalizeItemName(
        item.description ? `${item.name} ${item.description}` : item.name
      ),
    ].filter(Boolean);
    for (const k of keys) {
      if (!byName.has(k)) byName.set(k, item.id);
    }
  }

  let expenseDocs = [];
  try {
    const snap = await getDocs(collection(db, 'expenses'));
    expenseDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (err) {
    console.warn('Could not load expenses for cost bootstrap', err);
    return 0;
  }

  expenseDocs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  let written = 0;
  const seenItem = new Set();

  for (const expense of expenseDocs) {
    for (const row of expense.items || []) {
      const key = normalizeItemName(row.name);
      if (!key) continue;
      const itemId = byName.get(key);
      if (!itemId || seenItem.has(itemId)) continue;

      const catalogItem = itemById.get(itemId);
      const rate = deriveUnitRateFromExpense(row, catalogItem);
      if (rate == null) continue;

      const existing = prefsByItem.get(itemId);
      const hasRate = existing?.lastPaidRate != null && existing.lastPaidRate > 0;
      const rateBad =
        hasRate &&
        isAbsurdRate(existing.lastPaidRate, catalogItem?.restockAmount || RATE_SANITY_QTY_HINT);

      if (hasRate && !force && !rateBad) {
        seenItem.add(itemId);
        continue;
      }

      const supplierId = expense.supplierId || existing?.lastSupplierId || null;
      const patch = {
        lastPaidRate: rate,
        lastPaidDate: expense.date || null,
        lastSupplierId: supplierId,
        lastSupplierName: expense.supplierName || existing?.lastSupplierName || '',
      };
      if (supplierId) {
        patch.supplierHistoryEntry = {
          supplierId,
          supplierName: patch.lastSupplierName,
          lastPaidRate: rate,
          lastPaidDate: patch.lastPaidDate,
          increment: false,
        };
      }
      await upsertItemPref(itemId, patch);
      seenItem.add(itemId);
      written += 1;
    }
  }

  return written;
}
