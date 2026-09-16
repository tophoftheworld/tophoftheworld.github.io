/** Same-supplier check for copying a unit rate between plan lines. */
export function sameSupplierForRate(a, b) {
  const aId = a?.supplierId || '';
  const bId = b?.supplierId || '';
  if (aId && bId) return aId === bId;

  const aName = String(a?.supplierName || '').trim().toLowerCase();
  const bName = String(b?.supplierName || '').trim().toLowerCase();
  if (!aName || !bName || aName === 'unassigned' || bName === 'unassigned') {
    return false;
  }
  return aName === bName;
}

/** True when a cost/rate edit on `source` should also update `sibling`. */
export function siblingSharesRate(source, sibling) {
  if (!source || !sibling) return false;
  if (sibling.id === source.id) return false;
  if (!source.itemId || sibling.itemId !== source.itemId) return false;
  if (sibling.frozen || sibling.status !== 'planned') return false;
  return sameSupplierForRate(source, sibling);
}

/**
 * Last paid rate for one supplier. Never fall back to another supplier's rate
 * when `supplierId` is set.
 */
export function rateForSupplier(pref, supplierId) {
  if (!pref) return null;
  if (supplierId) {
    const hist = pref.supplierHistory?.[supplierId]?.lastPaidRate;
    if (hist != null && Number(hist) > 0) return Number(hist);
    return null;
  }
  if (pref.lastPaidRate != null && pref.lastPaidRate > 0) {
    return Number(pref.lastPaidRate);
  }
  return null;
}
