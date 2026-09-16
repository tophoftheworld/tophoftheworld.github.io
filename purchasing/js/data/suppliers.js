import {
  collection,
  doc,
  getDocs,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from '../firebase.js?v=96';
import { catalogSuppliersForPicker } from './catalog.js?v=96';

let suppliers = [];
let loaded = false;

function normalizeKey(name) {
  return (name || '').trim().toLowerCase();
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function getSuppliers() {
  return suppliers;
}

export async function loadSuppliers() {
  try {
    const snap = await getDocs(collection(db, 'suppliers'));
    suppliers = snap.docs
      .map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          name: data.name || '',
          businessName: data.businessName || '',
          tin: data.tin || '',
          address: data.address || '',
          isVatRegistered: !!data.isVatRegistered,
        };
      })
      .filter((s) => s.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    loaded = true;
  } catch (err) {
    console.warn('Could not load suppliers from Firebase; using catalog fallback', err);
    suppliers = catalogSuppliersForPicker().map((s) => ({
      id: s.id,
      name: s.name,
      businessName: s.businessName || '',
    }));
    loaded = true;
  }
  return suppliers;
}

export function findSupplierById(id) {
  if (!id) return null;
  return suppliers.find((s) => s.id === id) || null;
}

export function findSupplierByName(name) {
  const key = normalizeKey(name);
  if (!key) return null;
  return (
    suppliers.find(
      (s) =>
        normalizeKey(s.name) === key ||
        (s.businessName && normalizeKey(s.businessName) === key)
    ) || null
  );
}

/**
 * Resolve or create a supplier by typed name. Returns { id, name } or null if blank.
 */
export async function ensureSupplier(name, { supplierId = null } = {}) {
  const trimmed = (name || '').trim();
  if (!trimmed || trimmed === 'Unassigned' || trimmed === '\u2014') {
    return { id: null, name: 'Unassigned' };
  }

  if (supplierId) {
    const byId = findSupplierById(supplierId);
    if (byId) return { id: byId.id, name: byId.name };
  }

  const existing = findSupplierByName(trimmed);
  if (existing) return { id: existing.id, name: existing.name };

  const id = generateId();
  const record = {
    id,
    name: trimmed,
    businessName: '',
    tin: '',
    address: '',
    isVatRegistered: false,
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'suppliers', id), record);
  } catch (err) {
    console.warn('Could not write new supplier to Firebase', err);
  }

  if (!loaded) await loadSuppliers();
  suppliers.push(record);
  suppliers.sort((a, b) => a.name.localeCompare(b.name));
  return { id, name: trimmed };
}

export function suppliersForPicker() {
  return suppliers.length ? suppliers : catalogSuppliersForPicker();
}
