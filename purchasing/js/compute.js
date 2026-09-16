import { locationLabel, locationSortRank } from './data/catalog.js?v=96';
import { compareOrderViewMasterItems, categorySortRank } from '../../inventory/js/shared/order-view-feed.js?v=105';

export const RATE_SANITY_QTY_HINT = 500;
export const RATE_SANITY_MAX_TOTAL = 100000;

export function isAbsurdRate(rate, qtyHint = RATE_SANITY_QTY_HINT) {
  const r = Number(rate);
  const q = Number(qtyHint) || RATE_SANITY_QTY_HINT;
  if (!r || r <= 0) return false;
  return r * q > RATE_SANITY_MAX_TOTAL;
}

function locOrder(key) {
  return locationSortRank(key);
}

export function derivedRate(qty, lumpCost) {
  const q = Number(qty);
  const c = Number(lumpCost);
  if (!q || q <= 0 || c == null || Number.isNaN(c)) return null;
  return c / q;
}

export function lineAmount(line) {
  return Number(line.estimatedCost) || 0;
}

export function isBudgetLine(line) {
  return line?.kind === 'budget' || line?.kind === 'deliveryFee';
}

export function isFee(line) {
  return isBudgetLine(line);
}

export function isManualLine(line) {
  return line?.source === 'manual' || (!line?.itemId && !!line?.freeTextName);
}

export function lineUnitRate(line) {
  if (line?.unitRate != null && line.unitRate > 0) return Number(line.unitRate);
  return derivedRate(line?.qty, line?.estimatedCost);
}

/**
 * Recalculate cost fields after an edit. All three stay editable.
 * - unit → total = qty × unit
 * - total → unit = total ÷ qty (qty unchanged)
 * - qty → usually total = qty × unit; pass preserveTotal to keep total and derive unit instead
 * @param {object} line
 * @param {'qty'|'unit'|'total'} editedField
 * @param {{ preserveTotal?: boolean }} [opts]
 * @returns {{ qty: number, unitRate: number, estimatedCost: number }}
 */
export function recalcLineCost(line, editedField, opts = {}) {
  let qty = Number(line.qty) || 0;
  let unitRate = lineUnitRate(line) ?? (Number(line.lastPaidRate) || 0);
  let estimatedCost = Number(line.estimatedCost) || 0;

  if (editedField === 'unit') {
    if (unitRate > 0) estimatedCost = Math.round(qty * unitRate);
  } else if (editedField === 'total') {
    estimatedCost = Number(line.estimatedCost) || 0;
    if (qty > 0 && estimatedCost >= 0) {
      unitRate = estimatedCost > 0 ? estimatedCost / qty : 0;
    }
  } else if (editedField === 'qty') {
    if (opts.preserveTotal && estimatedCost > 0 && qty > 0) {
      unitRate = estimatedCost / qty;
    } else if (unitRate > 0) {
      estimatedCost = Math.round(qty * unitRate);
    }
  }

  return { qty, unitRate, estimatedCost };
}

/** Prefer prefs rate when overlay cost implies an absurd unit rate. */
export function sanitizeLineCost(line, prefRate) {
  const implied = derivedRate(line.qty, line.estimatedCost);
  if (
    implied != null &&
    isAbsurdRate(implied, line.qty || RATE_SANITY_QTY_HINT) &&
    prefRate != null &&
    prefRate > 0 &&
    !isAbsurdRate(prefRate, line.qty || RATE_SANITY_QTY_HINT)
  ) {
    return {
      estimatedCost: Math.round(Number(line.qty) * prefRate),
      unitRate: prefRate,
      costSet: true,
      rateLocked: false,
    };
  }
  const unitRate = line.unitRate ?? implied ?? prefRate ?? null;
  return { unitRate };
}

export function isLockedStatus(status) {
  return status === 'ordered' || status === 'delivered';
}

export function isLinePaid(line) {
  return isLockedStatus(fulfillmentStatus(line));
}

export function fulfillmentStatus(line) {
  if (!line) return 'planned';
  if (line.status === 'spent') return 'delivered';
  return line.status || 'planned';
}

export function plannedLines(week) {
  return (week.lines || []).filter((l) => l.onPlan);
}

export function locationLines(week, location) {
  return (week.lines || []).filter((l) => !isFee(l) && l.location === location);
}

export function feeLines(week) {
  return (week.lines || []).filter(isFee);
}

export function weekSubtotal(week) {
  return plannedLines(week).reduce((s, l) => s + lineAmount(l), 0);
}

export function bufferAmount(week) {
  return 0;
}

export function ensureBuffer(week) {
  week.buffer = 0;
  return 0;
}

export function weekTotal(week) {
  return weekSubtotal(week);
}

export function locationSubtotals(week) {
  const out = { 'sm-north': 0, podium: 0, moa: 0, events: 0, general: 0 };
  for (const line of plannedLines(week)) {
    if (!line.location || out[line.location] == null) continue;
    out[line.location] += lineAmount(line);
  }
  return out;
}

export function sortByRunout(lines) {
  return [...lines].sort((a, b) => {
    if (!a.runoutDate && !b.runoutDate) return 0;
    if (!a.runoutDate) return 1;
    if (!b.runoutDate) return -1;
    return a.runoutDate.localeCompare(b.runoutDate);
  });
}

export function sortByInventoryOrder(lines) {
  return [...lines].sort((a, b) =>
    compareOrderViewMasterItems(
      {
        category: a.category || 'Other',
        categoryOrder: a.categoryOrder,
        displayOrder: a.displayOrder,
        order: a.displayOrder,
      },
      {
        category: b.category || 'Other',
        categoryOrder: b.categoryOrder,
        displayOrder: b.displayOrder,
        order: b.displayOrder,
      }
    )
  );
}

/**
 * Order qty visual state vs suggested.
 * Italic = edited away from suggested. →“ = order qty is below suggested.
 * (Need is week demand; stock + order vs need is a different check \u2014 not this flag.)
 * @returns {{ edited: boolean, belowNeed: boolean, aboveNeed: boolean, classes: string, tip: string }}
 */
export function orderQtyState(line) {
  const qty = Number(line.qty);
  const suggested = line.suggestedQty != null ? Number(line.suggestedQty) : null;
  const atSuggested =
    suggested != null && !Number.isNaN(qty) && !Number.isNaN(suggested) && qty === suggested;
  const edited = !!line.qtyEdited || (suggested != null && !atSuggested && !Number.isNaN(qty));
  const belowNeed =
    suggested != null &&
    !Number.isNaN(suggested) &&
    !Number.isNaN(qty) &&
    qty < suggested;
  const aboveNeed =
    suggested != null &&
    !Number.isNaN(suggested) &&
    !Number.isNaN(qty) &&
    qty > suggested;

  const classes = [
    edited ? 'order-qty--edited' : '',
    belowNeed ? 'order-qty--below' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const tips = [];
  if (belowNeed) tips.push(`Below suggested ${suggested}`);
  else if (edited && suggested != null) tips.push(`Edited from suggested ${suggested}`);
  if (aboveNeed) tips.push('Above suggested');

  return { edited, belowNeed, aboveNeed, classes, tip: tips.join(' \u00B7 ') };
}

/**
 * Plan-fidelity: ordered qty vs Monday suggested for on-plan lines.
 * @returns {{ ordered: number, suggested: number, delta: number, over: number, under: number, compared: number, overLines: number, underLines: number, onPlanLines: number }}
 */
export function orderedVsSuggestedSummary(week) {
  let ordered = 0;
  let suggested = 0;
  let over = 0;
  let under = 0;
  let compared = 0;
  let overLines = 0;
  let underLines = 0;
  let onPlanLines = 0;
  for (const line of plannedLines(week)) {
    if (isFee(line)) continue;
    const qty = Number(line.qty) || 0;
    ordered += qty;
    if (line.suggestedQty == null || Number.isNaN(Number(line.suggestedQty))) continue;
    const sug = Number(line.suggestedQty) || 0;
    suggested += sug;
    compared += 1;
    const delta = qty - sug;
    if (delta > 0) {
      over += delta;
      overLines += 1;
    } else if (delta < 0) {
      under += -delta;
      underLines += 1;
    } else {
      onPlanLines += 1;
    }
  }
  return {
    ordered,
    suggested,
    delta: ordered - suggested,
    over,
    under,
    compared,
    overLines,
    underLines,
    onPlanLines,
  };
}

export function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const d = new Date(`${iso}T12:00:00`);
  return Math.round((d - today) / 86400000);
}

export function daysSince(iso) {
  const d = daysUntil(iso);
  return d == null ? null : -d;
}

export function locationCountFreshness(lines) {
  const dates = lines.map((l) => l.lastCountedAt).filter(Boolean);
  if (!dates.length) return { date: null, ageDays: null, current: false, stale: true, mixed: false };
  const unique = [...new Set(dates)];
  const newest = dates.reduce((a, b) => (a > b ? a : b));
  const ageDays = daysSince(newest);
  return {
    date: newest,
    ageDays,
    current: ageDays != null && ageDays <= 1,
    stale: ageDays != null && ageDays >= 3,
    mixed: unique.length > 1,
  };
}

/** Shared count-as-of label for a location group, or null if mixed/missing. */
export function locationCommonStockLabel(lines) {
  const counted = (lines || []).filter((l) => !isFee(l) && !l.needsCount && (l.stockAsOfLabel || l.lastCountedAt));
  if (!counted.length) return null;
  const labels = counted
    .map((l) => {
      if (l.stockAsOfLabel) return normalizeStockAsOfLabel(l.stockAsOfLabel, l.stockCountKind);
      const d = l.lastCountedAt;
      return d ? formatCountDate(d) : null;
    })
    .filter(Boolean);
  if (!labels.length) return null;
  const first = labels[0];
  return labels.every((l) => l === first) ? first : null;
}

/** Collapse legacy "Sep 11 Opening" / "Mon opening" to a short comparable label. */
function normalizeStockAsOfLabel(label, kindHint = null) {
  const raw = String(label || '').trim();
  if (!raw) return null;
  if (raw === 'Mon opening' || raw === 'Mon') return 'Mon';
  const legacy = raw.match(/^(.+?)\s+(Opening|Closing)\b(.*)$/i);
  if (legacy) return `${legacy[1].trim()}${legacy[3] || ''}`.trim();
  return raw;
}

function formatCountDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function lineWarning(week, line) {
  const fromFeed = (line.warnReasons || []).find((r) => /negative/i.test(r) || /opening\/closing/i.test(r));
  if (fromFeed) return fromFeed;
  const age = line.countAgeDays != null ? line.countAgeDays : daysSince(line.lastCountedAt);
  if (age != null && age >= 3) return `Count is ${age} days old`;
  const days = daysUntil(line.runoutDate);
  if (days != null && days <= 0) return 'Already out or runs out today';
  return null;
}

export function groupOrderSheets(week) {
  const bySupplier = new Map();
  for (const line of plannedLines(week)) {
    const skey = line.supplierId || line.supplierName || 'unknown';
    if (!bySupplier.has(skey)) {
      bySupplier.set(skey, {
        supplierId: line.supplierId,
        supplierName: line.supplierName || 'Unknown',
        items: new Map(),
      });
    }
    const g = bySupplier.get(skey);
    const ikey = isFee(line) ? `fee:${skey}` : line.itemId || `free:${line.freeTextName}`;
    if (!g.items.has(ikey)) {
      g.items.set(ikey, {
        itemId: line.itemId,
        freeTextName: line.freeTextName,
        unit: line.unit,
        kind: line.kind || 'item',
        lines: [],
      });
    }
    g.items.get(ikey).lines.push(line);
  }

  return [...bySupplier.values()]
    .map((g) => ({
      supplierId: g.supplierId,
      supplierName: g.supplierName,
      rows: [...g.items.values()].map((item) => {
        const statuses = item.lines.map((l) => fulfillmentStatus(l));
        let status = 'planned';
        if (statuses.every((s) => s === 'delivered')) status = 'delivered';
        else if (statuses.every((s) => isLockedStatus(s))) status = 'ordered';
        return {
          itemId: item.itemId,
          freeTextName: item.freeTextName,
          unit: item.unit,
          kind: item.kind,
          qty: item.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
          cost: item.lines.reduce((s, l) => s + lineAmount(l), 0),
          status,
          splits: [...item.lines]
            .sort((a, b) => locOrder(a.location) - locOrder(b.location))
            .map((l) => ({
              id: l.id,
              location: l.location,
              label: locationLabel(l.location),
              qty: l.qty,
              cost: lineAmount(l),
              status: fulfillmentStatus(l),
            })),
          lineIds: item.lines.map((l) => l.id),
        };
      }),
    }))
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName));
}

export function spentBuckets(week) {
  const lines = plannedLines(week);
  const bought = [];
  const notBought = [];
  for (const line of lines) {
    if (isLinePaid(line)) bought.push(line);
    else notBought.push(line);
  }
  return { bought, notBought, offPlan: week.offPlanExpenses || [] };
}

export function settlementSummary(week) {
  const released = Number(week.released) || weekTotal(week);
  const spent = Number(week.spent) || 0;
  const returned = Number(week.returned) || 0;
  const balance = released - spent - returned;
  return { released, spent, returned, balance };
}

export function topLinesByAmount(week, n = 5) {
  return [...plannedLines(week)].sort((a, b) => lineAmount(b) - lineAmount(a)).slice(0, n);
}

export function rateOffLastPaid(line) {
  const rate = derivedRate(line.qty, line.estimatedCost);
  const last = Number(line.lastPaidRate);
  if (rate == null || !last) return false;
  return Math.abs(rate - last) / last > 0.1;
}

export { categorySortRank };
