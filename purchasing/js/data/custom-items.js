import {
  collection,
  doc,
  getDocs,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from '../firebase.js?v=96';

const CUSTOM_PATH = ['purchasing', '_config', 'customItems'];

/** @type {Map<string, object>} */
let customBySlug = new Map();

function customCollection() {
  return collection(db, ...CUSTOM_PATH);
}

function customDoc(slug) {
  return doc(db, ...CUSTOM_PATH, slug);
}

export function slugifyCustomName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function getCustomItem(slug) {
  return customBySlug.get(slug) || null;
}

export function getAllCustomItems() {
  return [...customBySlug.values()];
}

export function findCustomItemByName(name) {
  const slug = slugifyCustomName(name);
  if (slug && customBySlug.has(slug)) return customBySlug.get(slug);
  const norm = (name || '').trim().toLowerCase();
  return (
    [...customBySlug.values()].find(
      (c) => (c.name || '').trim().toLowerCase() === norm
    ) || null
  );
}

export async function loadCustomItems() {
  customBySlug = new Map();
  try {
    const snap = await getDocs(customCollection());
    for (const d of snap.docs) {
      const data = d.data() || {};
      customBySlug.set(d.id, {
        slug: d.id,
        name: data.name || d.id,
        kind: data.kind || 'product',
        category: data.category || 'Other',
        defaultUnit: data.defaultUnit || 'pcs',
        lastPaidTotal:
          data.lastPaidTotal != null ? Number(data.lastPaidTotal) : null,
        lastPaidRate:
          data.lastPaidRate != null ? Number(data.lastPaidRate) : null,
        lastSupplierId: data.lastSupplierId ?? null,
        lastSupplierName: data.lastSupplierName || '',
        orderCount: Number(data.orderCount) || 0,
        updatedAt: data.updatedAt || null,
      });
    }
  } catch (err) {
    console.warn('Could not load custom items from Firebase', err);
  }
  return customBySlug;
}

export async function upsertCustomItem(name, patch = {}) {
  const slug = slugifyCustomName(name);
  if (!slug) return null;
  const prev = customBySlug.get(slug) || {
    slug,
    name: (name || '').trim(),
    kind: 'product',
    category: 'Other',
    defaultUnit: 'pcs',
    lastPaidTotal: null,
    lastPaidRate: null,
    lastSupplierId: null,
    lastSupplierName: '',
    orderCount: 0,
  };
  const next = {
    ...prev,
    ...patch,
    slug,
    name: (patch.name || prev.name || name || '').trim(),
    orderCount: prev.orderCount + (patch.increment ? 1 : 0),
    updatedAt: new Date().toISOString(),
  };
  delete next.increment;
  customBySlug.set(slug, next);
  try {
    await setDoc(
      customDoc(slug),
      {
        name: next.name,
        kind: next.kind,
        category: next.category,
        defaultUnit: next.defaultUnit,
        lastPaidTotal: next.lastPaidTotal,
        lastPaidRate: next.lastPaidRate,
        lastSupplierId: next.lastSupplierId,
        lastSupplierName: next.lastSupplierName || '',
        orderCount: next.orderCount,
        updatedAt: next.updatedAt,
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('Could not save custom item', slug, err);
  }
  return next;
}

/** Persist memory from a manual / non-inventory plan line. */
export async function savePrefsFromCustomLine(line) {
  if (line?.itemId) return null;
  const name = (line.freeTextName || line.itemName || '').trim();
  if (!name) return null;

  const isBudget = line.kind === 'budget' || line.kind === 'deliveryFee';
  const qty = Number(line.qty) || 1;
  const cost = Number(line.estimatedCost) || 0;
  const patch = {
    name,
    kind: isBudget ? 'budget' : line.kind === 'service' ? 'service' : 'product',
    category: line.category || (isBudget ? 'Services & Budget' : 'Other'),
    defaultUnit: line.unit || (isBudget ? 'budget' : 'pcs'),
    lastSupplierId: line.supplierId ?? null,
    lastSupplierName: line.supplierName || '',
    increment: true,
  };
  if (isBudget) {
    patch.lastPaidTotal = cost > 0 ? cost : null;
  } else if (qty > 0 && cost > 0) {
    patch.lastPaidRate = cost / qty;
    patch.lastPaidTotal = cost;
  }
  return upsertCustomItem(name, patch);
}

/** Ranked picker matches for add modal (inventory names handled separately). */
export function buildCustomItemMatchList(query) {
  const q = (query || '').trim().toLowerCase();
  const items = getAllCustomItems().map((item) => {
    const name = (item.name || '').toLowerCase();
    let priority = 999;
    if (!q) priority = 5;
    else if (name === q) priority = 1;
    else if (name.startsWith(q)) priority = 2;
    else if (name.includes(q)) priority = 3;
    return { ...item, priority, secondarySort: -item.orderCount };
  });
  return items
    .filter((i) => i.priority < 999)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.secondarySort - b.secondarySort ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 10);
}
