/**
 * Shared Order View feed — same math as Inventory Order View.
 * Inventory builder and Purchasing both call this so numbers cannot drift.
 */
import { db } from '../firebase-inventory.js';
import { collection, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  buildCategoryOrderMap,
  categoryRank,
  compareItemsByCategoryOrder,
} from './category-order.js?v=105';
import {
  getDateKey,
  startOfDay,
  lastCompleteWeekStart,
  lastCompleteWeekStarts,
  weekDates,
  planWeekStart,
  coverageDatesForHorizon,
  coverageDatesForPlanAsOf,
  defaultHorizonForToday,
  computeProjectedNeed,
  computeSuggestedOrder,
  upliftCensoredPattern,
  isCensoredDay,
  pickLatestStock,
  rollForwardStock,
  countAgeDays,
  computeRunOutDate,
  averageWeekdayPatterns,
  DEFAULT_LEAD_TIME_DAYS,
  DEFAULT_BUFFER_PCT,
  STOCK_LOOKBACK_DAYS,
  addDays,
} from './forecast.js?v=105';

export const CORE_BRANCHES = ['sm-north', 'podium', 'moa'];
export const ORDER_VIEW_HUGE_VALUE_THRESHOLD = 1_000_000;

const BRANCH_LABELS = { 'sm-north': 'SM North', podium: 'Podium', moa: 'MOA' };

let categoryOrderMap = Object.create(null);

export function setCategoryOrderMap(map) {
  categoryOrderMap = map && typeof map === 'object' ? map : Object.create(null);
}

export function getBranchDisplayName(branch) {
  if (!branch) return '';
  return BRANCH_LABELS[branch] || branch.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function categorySortRank(category, categoryOrder = 999) {
  return categoryRank(category, categoryOrderMap, categoryOrder);
}

export function compareOrderViewMasterItems(a, b) {
  return compareItemsByCategoryOrder(a, b, categoryOrderMap);
}

export function isMasterItemEnabledForBranch(item, branchKey) {
  if (!item) return false;
  if (item.enabledBranches === undefined) return true;
  if (item.enabledBranches.length === 0) return false;
  return item.enabledBranches.includes(branchKey);
}

export function filterOrderViewItems(items, selectedBranches) {
  if (!selectedBranches || selectedBranches.length === 0) return [];
  return items.filter((item) => selectedBranches.some((b) => isMasterItemEnabledForBranch(item, b)));
}

export function computeDayUsageFromItemQuantities(itemQuantities) {
  if (!itemQuantities || typeof itemQuantities !== 'object') {
    return { used: 0, closing: 0, hasClosingData: false, added: 0, removed: 0 };
  }
  const opening = itemQuantities.opening?.value || 0;
  const closing = itemQuantities.closing?.value || 0;
  const added = itemQuantities.added?.value || 0;
  let removed = 0;
  if (Array.isArray(itemQuantities.adjustments)) {
    itemQuantities.adjustments.forEach((adj) => {
      const value = Number(adj?.value) || 0;
      if (adj?.reason === 'pulled-out' || adj?.reason === 'wastage') removed += value;
    });
  }
  const hasClosingData = itemQuantities.closing && itemQuantities.closing.checked;
  const used = hasClosingData ? opening + added - closing : 0;
  return { used, closing, hasClosingData, added, removed };
}

function formatNumberWithCommas(num) {
  if (num === null || num === undefined) return '0';
  const n = Number(num);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
}

export function orderViewFormatQty(n, item) {
  const u = item.unit ? ` ${item.unit}` : '';
  const num = Number(n);
  if (!Number.isFinite(num)) return `0${u}`;
  const unit = String(item?.unit || '')
    .toLowerCase()
    .trim();
  const wholeUnit =
    /^(pcs|pc|ea|each|ct|count|bag|bags|box|boxes|pack|packs|bottle|bottles|cup|cups)$/.test(unit);
  const rounded = wholeUnit ? Math.round(num) : Math.round(num * 10) / 10;
  return formatNumberWithCommas(rounded) + u;
}

export function itemLeadTimeDays(item) {
  const n = Number(item?.leadTimeDays);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LEAD_TIME_DAYS;
}

export function baselineWeekStartsFor(today, orderUsageBaseline = 'prev-week') {
  if (orderUsageBaseline === 'rolling-avg') return lastCompleteWeekStarts(today, 4);
  if (orderUsageBaseline === 'two-weeks-ago') return [lastCompleteWeekStart(today, 2)];
  return [lastCompleteWeekStart(today, 1)];
}

export function formatOrderViewRunOutCell(runResult, daysOut = null, today = new Date()) {
  const baseTitle =
    'Stock is the latest completed count (rolled forward with typical usage if the count is older). Daily use follows the selected baseline week (Mon-Sun), repeating every week.';
  if (runResult === null) {
    return {
      runOutPrimary: '-',
      runOutSecondary: '',
      title: `${baseTitle} No usage in baseline week and stock on hand - cannot project run-out.`,
    };
  }
  if (runResult.beyondHorizon) {
    return {
      runOutPrimary: '-',
      runOutSecondary: '',
      title: `${baseTitle} Not depleted within 730-day projection (very low daily usage vs stock).`,
    };
  }
  if (runResult.outNow) {
    if (daysOut != null && daysOut > 0) {
      const outSince = addDays(today, -(daysOut - 1));
      const short = outSince.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const long = outSince.toLocaleDateString(undefined, { dateStyle: 'long' });
      const daysOutLabel = daysOut === 1 ? '1 Day Out' : `${daysOut} Days Out`;
      return {
        runOutPrimary: short,
        runOutSecondary: daysOutLabel,
        title: `Out of stock for ${daysOutLabel} (since ${long}). ${baseTitle}`,
      };
    }
    const title = runResult.noBaselineUsage
      ? `${baseTitle} Stock at or below zero. No usage in baseline week - often because the item was already out.`
      : `${baseTitle} Stock at or below zero.`;
    return { runOutPrimary: '-', runOutSecondary: '', title };
  }
  const { date, daysUntil } = runResult;
  const short = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const long = date.toLocaleDateString(undefined, { dateStyle: 'long' });
  const inDaysLabel = daysUntil === 1 ? 'In 1 Day' : `In ${daysUntil} Days`;
  return {
    runOutPrimary: short,
    runOutSecondary: inDaysLabel,
    title: `Projected run-out ${long} (${daysUntil === 1 ? '1 day' : `${daysUntil} days`} from today). ${baseTitle}`,
  };
}

export function computeDaysOutOfStock(stockByDate, today, effectiveStock) {
  if (effectiveStock > 0) return null;
  let daysOut = 0;
  for (let i = 0; i <= STOCK_LOOKBACK_DAYS; i++) {
    const date = addDays(today, -i);
    const key = getDateKey(date);
    const q = stockByDate[key];
    if (!q) break;
    const closingChecked = !!(q.closing && q.closing.checked);
    const openingChecked = !!(q.opening && q.opening.checked);
    if (closingChecked) {
      if ((Number(q.closing.value) || 0) > 0) break;
      daysOut++;
      continue;
    }
    if (openingChecked) {
      if ((Number(q.opening.value) || 0) + (Number(q.added?.value) || 0) > 0) break;
      daysOut++;
      continue;
    }
    break;
  }
  if (daysOut === 0) return 1;
  return daysOut;
}

export function usagePatternForWeeks(fetched, branch, itemId, weekStarts) {
  const weekResults = weekStarts.map((weekStart) => {
    const dates = weekDates(weekStart);
    const used = [];
    const censored = [];
    const hasClosing = [];
    for (let i = 0; i < 7; i++) {
      const iq = fetched[branch]?.[getDateKey(dates[i])]?.[itemId];
      const day = computeDayUsageFromItemQuantities(iq);
      used.push(day.used);
      censored.push(isCensoredDay(day));
      hasClosing.push(day.hasClosingData);
    }
    const uplifted = upliftCensoredPattern(used, censored);
    return {
      used,
      censored,
      hasClosing,
      recordedTotal: used.reduce((a, b) => a + (Number(b) || 0), 0),
      ...uplifted,
    };
  });
  if (weekResults.length === 1) return weekResults[0];
  const pattern = averageWeekdayPatterns(weekResults.map((w) => w.pattern));
  return {
    used: pattern,
    censored: weekResults.reduce(
      (acc, w) => acc.map((c, i) => c || w.censored[i]),
      [false, false, false, false, false, false, false]
    ),
    hasClosing: weekResults.reduce(
      (acc, w) => acc.map((c, i) => c || w.hasClosing[i]),
      [false, false, false, false, false, false, false]
    ),
    recordedTotal: pattern.reduce((a, b) => a + (Number(b) || 0), 0),
    pattern,
    zeroDays: Math.max(0, ...weekResults.map((w) => w.zeroDays || 0)),
    uplifted: weekResults.some((w) => w.uplifted),
  };
}

export function buildOrderViewMetrics({
  item,
  today,
  used,
  censored,
  hasClosing,
  stockPick,
  stockByDate = {},
  coverageDates,
  applyLeadTime,
  applyBuffer,
  skipUplift = false,
  zeroDaysHint = 0,
  upliftedHint = false,
}) {
  const recordedTotal = used.reduce((a, b) => a + (Number(b) || 0), 0);
  const { pattern, zeroDays, uplifted } = skipUplift
    ? { pattern: used.map((n) => Number(n) || 0), zeroDays: zeroDaysHint, uplifted: upliftedHint }
    : upliftCensoredPattern(used, censored);
  const needsCount = !stockPick?.date;
  const ageDays = countAgeDays(stockPick?.date, today);
  const stale = ageDays != null && ageDays >= 3;
  const countedQty = needsCount ? 0 : stockPick.qty;
  const effectiveStock = needsCount
    ? 0
    : rollForwardStock(countedQty, pattern, stockPick.date, stockPick.kind, today);

  let projected = null;
  let rawNeed = null;
  let negativeNeed = false;
  if (!needsCount) {
    const parts = computeProjectedNeed({
      pattern,
      coverageDates,
      leadTimeDays: itemLeadTimeDays(item),
      bufferPct: DEFAULT_BUFFER_PCT,
      applyLeadTime,
      applyBuffer,
    });
    rawNeed = parts.rawNeed;
    projected = parts.projected;
    if (typeof projected === 'number' && projected < 0) {
      negativeNeed = true;
      projected = 0;
      if (typeof rawNeed === 'number' && rawNeed < 0) rawNeed = 0;
    }
  }

  const suggested = projected == null ? null : computeSuggestedOrder(projected, effectiveStock, 0);
  const runRaw = computeRunOutDate(effectiveStock, pattern, today);
  const daysOut = computeDaysOutOfStock(stockByDate, today, effectiveStock);
  const runOut = formatOrderViewRunOutCell(runRaw, daysOut, today);
  const runOutUrgent = effectiveStock <= 0;
  const runOutBeforeDelivery =
    !!runRaw &&
    (runRaw.outNow === true ||
      (typeof runRaw.daysUntil === 'number' && runRaw.daysUntil <= itemLeadTimeDays(item)));

  const warnReasons = [];
  if (needsCount) warnReasons.push('No count this period - cannot forecast from stock.');
  else if (stale) warnReasons.push(`Count is ${ageDays} days old.`);
  if (zeroDays > 0) {
    warnReasons.push(
      uplifted
        ? `Usage may be understated - at zero ${zeroDays} of 7 days; those days were filled with the rest of the week's average.`
        : `At zero ${zeroDays} of 7 days in the usage week.`
    );
  }
  if (runOutBeforeDelivery) warnReasons.push('Likely to run out before the next delivery lands.');
  if (negativeNeed) {
    warnReasons.push(
      'Usage data looks wrong (need went negative) — check opening/closing counts.'
    );
  }

  const hugeValue = [recordedTotal, effectiveStock, projected, suggested].some(
    (x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) >= ORDER_VIEW_HUGE_VALUE_THRESHOLD
  );

  let runoutDate = null;
  if (runRaw?.date) runoutDate = getDateKey(runRaw.date);
  else if (runRaw?.outNow && daysOut != null && daysOut > 0) {
    runoutDate = getDateKey(addDays(today, -(daysOut - 1)));
  }

  return {
    recordedTotal,
    pattern,
    zeroDays,
    uplifted,
    needsCount,
    ageDays,
    stale,
    stockPick,
    countedQty,
    effectiveStock,
    rawNeed,
    projected,
    suggested,
    daysOut,
    missingBaseline: false,
    hugeValue,
    runOutPrimary: runOut.runOutPrimary,
    runOutSecondary: runOut.runOutSecondary,
    runOutTitle: runOut.title,
    runOutUrgent,
    runoutDate,
    warnReasons,
  };
}

export function formatStockAsOfLabel(stockPick, ageDays) {
  if (!stockPick?.date) return null;
  const short = stockPick.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  let label = short;
  if (ageDays >= 2) label += ` · ${ageDays}d ago`;
  return label;
}

/** 'opening' | 'closing' from a stock pick (default closing). */
export function stockCountKindFromPick(stockPick) {
  return stockPick?.kind === 'opening' ? 'opening' : 'closing';
}

export function formatOrderViewStockSub({ needsCount, stockPick, ageDays, extras = [], commonAsOf = null }) {
  if (needsCount || !stockPick?.date) {
    return extras.length ? extras.join(' · ') : 'No count';
  }
  const parts = [];
  const asOf = formatStockAsOfLabel(stockPick, ageDays);
  if (asOf && asOf !== commonAsOf) parts.push(asOf);
  if (extras.length) parts.push(...extras);
  return parts.join(' · ');
}

export function decorateOrderViewQty(metrics, item, today, commonAsOf = null) {
  const stockDisplay = metrics.needsCount ? '-' : orderViewFormatQty(metrics.effectiveStock, item);
  const stockSub = formatOrderViewStockSub({ ...metrics, commonAsOf });
  const projectedDisplay = metrics.projected == null ? '-' : orderViewFormatQty(metrics.projected, item);
  const suggestedDisplay = metrics.suggested == null ? '-' : orderViewFormatQty(metrics.suggested, item);
  const baselineTotalDisplay = orderViewFormatQty(metrics.recordedTotal, item);
  return {
    ...metrics,
    stockDisplay,
    stockSub,
    projectedDisplay,
    suggestedDisplay,
    baselineTotalDisplay,
  };
}

export function pickNewestStockPick(branchSlices) {
  let best = null;
  for (const slice of branchSlices) {
    const pick = slice.stockPick;
    if (!pick?.date) continue;
    if (!best || pick.date > best.date) {
      best = pick;
      continue;
    }
    if (pick.date.getTime() === best.date.getTime() && pick.kind === 'closing' && best.kind === 'opening') {
      best = pick;
    }
  }
  return best;
}

export function computeCommonStockAsOf(rows) {
  const labels = [];
  for (const row of rows) {
    if (row.needsCount || !row.stockPick?.date) return null;
    labels.push(formatStockAsOfLabel(row.stockPick, row.ageDays));
  }
  if (!labels.length) return null;
  return labels.every((l) => l === labels[0]) ? labels[0] : null;
}

export function applyOrderViewStockSubs(rows, commonAsOf) {
  for (const row of rows) {
    const extras = [];
    if (row.needsCount && row.branches?.some((b) => !b.needsCount)) extras.push('missing a location');
    row.stockSub = formatOrderViewStockSub({
      needsCount: row.needsCount && row.branches?.every((b) => b.needsCount),
      stockPick: row.stockPick,
      ageDays: row.ageDays,
      extras,
      commonAsOf,
    });
    if (row.branches) {
      for (const slice of row.branches) {
        slice.stockSub = formatOrderViewStockSub({
          needsCount: slice.needsCount,
          stockPick: slice.stockPick,
          ageDays: slice.ageDays,
          commonAsOf,
        });
      }
    }
  }
}

export function orderViewDateKeysFor(today, orderUsageBaseline = 'prev-week', asOf = null) {
  const baselineWeekStarts = baselineWeekStartsFor(today, orderUsageBaseline);
  const dateKeys = new Set();
  for (const weekStart of baselineWeekStarts) {
    for (const date of weekDates(weekStart)) dateKeys.add(getDateKey(date));
  }
  for (let i = 0; i <= STOCK_LOOKBACK_DAYS; i++) {
    dateKeys.add(getDateKey(addDays(today, -i)));
  }
  if (asOf) {
    const asOfDay = startOfDay(asOf);
    for (let i = 0; i <= STOCK_LOOKBACK_DAYS; i++) {
      dateKeys.add(getDateKey(addDays(asOfDay, -i)));
    }
  }
  return dateKeys;
}

export async function fetchDailyQuantitiesForBranchDate(branch, dateStr, firestore = db) {
  const docRef = doc(firestore, 'inventory-quantities', branch, 'daily-quantities', dateStr);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return {};
  return docSnap.data().quantities || {};
}

/**
 * @param {object} cache - mutable { [branch]: { [dateStr]: quantities } }
 */
export async function fetchOrderViewQuantities(branchesInScope, dateKeys, cache = {}, firestore = db) {
  const missing = [];
  for (const dateStr of dateKeys) {
    for (const branch of branchesInScope) {
      if (cache[branch]?.[dateStr] === undefined) missing.push({ branch, dateStr });
    }
  }
  if (missing.length) {
    await Promise.all(
      missing.map(({ branch, dateStr }) =>
        fetchDailyQuantitiesForBranchDate(branch, dateStr, firestore).then((quantities) => {
          if (!cache[branch]) cache[branch] = {};
          cache[branch][dateStr] = quantities || {};
        })
      )
    );
  }
  const fetched = {};
  for (const branch of branchesInScope) {
    fetched[branch] = {};
    for (const dateStr of dateKeys) {
      const cached = cache[branch]?.[dateStr];
      if (cached === undefined) return null;
      fetched[branch][dateStr] = cached;
    }
  }
  return fetched;
}

export async function loadMasterItemsForOrderView(firestore = db) {
  const querySnapshot = await getDocs(collection(firestore, 'inventory', '_config', 'items'));
  return querySnapshot.docs.map((d) => {
    const data = d.data();
    if (data && data.subtitle && !data.description) data.description = data.subtitle;
    return {
      id: d.id,
      displayOrder: data.displayOrder ?? 0,
      categoryOrder: data.categoryOrder ?? 0,
      ...data,
      restockAmount: data.restockAmount || data.defaultRestockLevel || 0,
    };
  });
}

export async function loadCategoryDocsForOrderView(firestore = db) {
  const snap = await getDocs(collection(firestore, 'inventory', '_config', 'categories'));
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return { id: d.id, name: data.name || d.id, order: typeof data.order === 'number' ? data.order : 0 };
  });
}

/**
 * Build Order View snapshot (item rows with branch slices).
 * Same structure Inventory Admin renders.
 */
export function buildOrderViewSnapshot(
  fetched,
  today,
  branchesInScope,
  orderItems,
  {
    orderHorizon = defaultHorizonForToday(today),
    orderDemandBuffer = true,
    orderUsageBaseline = 'prev-week',
    /** When set (e.g. plan Monday), roll stock to this date and use full-week coverage. */
    asOf = null,
  } = {}
) {
  const stockAsOf = asOf ? startOfDay(asOf) : startOfDay(today);
  const todayKey = getDateKey(today);
  const asOfKey = getDateKey(stockAsOf);
  // Baseline usage follows calendar today so Fri–Sun next-week plans still use a complete week.
  const baselineWeekStarts = baselineWeekStartsFor(today, orderUsageBaseline);
  const coverageDates = asOf
    ? coverageDatesForPlanAsOf(stockAsOf, orderHorizon)
    : coverageDatesForHorizon(today, orderHorizon);
  const applyLeadTime = true;
  const applyBuffer = orderDemandBuffer;
  const oldestBaseline = baselineWeekStarts[baselineWeekStarts.length - 1];
  const newestBaselineEnd = addDays(baselineWeekStarts[0], 6);
  const planAnchor = asOf ? planWeekStart(stockAsOf) : planWeekStart(today);

  const meta = {
    todayKey,
    asOfKey,
    baselineLabelStart: getDateKey(oldestBaseline),
    baselineLabelEnd: getDateKey(newestBaselineEnd),
    coverageLabelStart: coverageDates[0] ? getDateKey(coverageDates[0]) : '',
    coverageLabelEnd: coverageDates.length ? getDateKey(coverageDates[coverageDates.length - 1]) : '',
    planWeekStart: getDateKey(planAnchor),
    planWeekEnd: getDateKey(addDays(planAnchor, 6)),
    orderHorizon,
    orderDemandBuffer,
    orderUsageBaseline,
    rollingAvg: orderUsageBaseline === 'rolling-avg',
    mondayAsOf: !!asOf,
  };

  const orderRows = [];
  for (const item of orderItems) {
    const branchSlices = [];

    for (const branch of branchesInScope) {
      if (!isMasterItemEnabledForBranch(item, branch)) continue;

      const usage = usagePatternForWeeks(fetched, branch, item.id, baselineWeekStarts);
      const stockByDate = {};
      // Look back from the later of calendar today and stockAsOf so Fri→next-Mon still sees counts.
      const lookbackFrom =
        startOfDay(today) > stockAsOf ? startOfDay(today) : stockAsOf;
      for (let i = 0; i <= STOCK_LOOKBACK_DAYS; i++) {
        const date = addDays(lookbackFrom, -i);
        const key = getDateKey(date);
        const iq = fetched[branch]?.[key]?.[item.id];
        if (iq) stockByDate[key] = iq;
      }

      // Only counts on/before stockAsOf — Wednesday counts must not become Monday opening.
      const stockPick = pickLatestStock(stockByDate, stockAsOf);
      const metrics = decorateOrderViewQty(
        buildOrderViewMetrics({
          item,
          today: stockAsOf,
          used: usage.used,
          censored: usage.censored,
          hasClosing: usage.hasClosing,
          stockPick,
          stockByDate,
          coverageDates,
          applyLeadTime,
          applyBuffer,
          skipUplift: baselineWeekStarts.length > 1,
          zeroDaysHint: usage.zeroDays,
          upliftedHint: usage.uplifted,
        }),
        item,
        stockAsOf
      );
      branchSlices.push({
        branch,
        branchLabel: getBranchDisplayName(branch),
        ...metrics,
      });
    }

    if (!branchSlices.length) continue;

    const pattern = [0, 0, 0, 0, 0, 0, 0];
    for (const slice of branchSlices) {
      for (let i = 0; i < 7; i++) pattern[i] += Number(slice.pattern[i]) || 0;
    }
    const effectiveStock = branchSlices.reduce(
      (s, b) => s + (b.needsCount ? 0 : Number(b.effectiveStock) || 0),
      0
    );
    const recordedTotal = branchSlices.reduce((s, b) => s + (Number(b.recordedTotal) || 0), 0);
    const projected = branchSlices.every((b) => b.projected == null)
      ? null
      : branchSlices.reduce((s, b) => s + (Number(b.projected) || 0), 0);
    const suggested = branchSlices.every((b) => b.suggested == null)
      ? null
      : branchSlices.reduce((s, b) => s + (Number(b.suggested) || 0), 0);
    const needsCount = branchSlices.some((b) => b.needsCount);
    const stale = branchSlices.some((b) => b.stale);
    const zeroDays = Math.max(0, ...branchSlices.map((b) => b.zeroDays || 0));
    const ageDays = branchSlices.reduce((worst, b) => {
      if (b.ageDays == null) return worst;
      return worst == null || b.ageDays > worst ? b.ageDays : worst;
    }, null);
    const warnReasons = [...new Set(branchSlices.flatMap((b) => b.warnReasons || []))];
    const hugeValue = branchSlices.some((b) => b.hugeValue);
    const runRaw = computeRunOutDate(effectiveStock, pattern, stockAsOf);
    const daysOut =
      effectiveStock <= 0 ? Math.max(0, ...branchSlices.map((b) => b.daysOut || 0)) || 1 : null;
    const runOut = formatOrderViewRunOutCell(runRaw, daysOut, stockAsOf);
    const runOutUrgent = effectiveStock <= 0;
    let runoutDate = null;
    if (runRaw?.date) runoutDate = getDateKey(runRaw.date);
    else if (runRaw?.outNow && daysOut != null && daysOut > 0) {
      runoutDate = getDateKey(addDays(stockAsOf, -(daysOut - 1)));
    }

    const aggregate = decorateOrderViewQty(
      {
        recordedTotal,
        pattern,
        zeroDays,
        needsCount,
        ageDays,
        stale,
        stockPick: pickNewestStockPick(branchSlices),
        effectiveStock,
        projected,
        suggested,
        daysOut,
        hugeValue,
        runOutPrimary: runOut.runOutPrimary,
        runOutSecondary: runOut.runOutSecondary,
        runOutTitle: runOut.title,
        runOutUrgent,
        runoutDate,
        warnReasons,
      },
      item,
      stockAsOf
    );

    orderRows.push({
      item,
      branches: branchSlices,
      ...aggregate,
    });
  }

  const commonStockAsOf = computeCommonStockAsOf(orderRows);
  applyOrderViewStockSubs(orderRows, commonStockAsOf);
  meta.commonStockAsOf = commonStockAsOf;

  return { rows: orderRows, meta };
}

/**
 * Flat per-branch rows for Purchasing Plan.
 */
export function flattenBranchRows(snapshot) {
  const out = [];
  for (const row of snapshot.rows || []) {
    for (const slice of row.branches || []) {
      out.push({
        itemId: row.item.id,
        item: row.item,
        branch: slice.branch,
        branchLabel: slice.branchLabel,
        unit: row.item.unit || 'pcs',
        effectiveStock: slice.effectiveStock,
        projected: slice.projected,
        suggested: slice.suggested,
        runOutPrimary: slice.runOutPrimary,
        runOutSecondary: slice.runOutSecondary,
        runOutTitle: slice.runOutTitle,
        runOutUrgent: slice.runOutUrgent,
        runoutDate: slice.runoutDate,
        ageDays: slice.ageDays,
        needsCount: slice.needsCount,
        stale: slice.stale,
        stockSub: slice.stockSub,
        stockPick: slice.stockPick,
        warnReasons: slice.warnReasons || [],
      });
    }
  }
  return out;
}

/**
 * High-level API for Purchasing (and any consumer).
 * Defaults match a normal Inventory Order View load.
 * Pass `branchOptions` to compute each branch with its own usage/horizon/buffer.
 */
export async function loadOrderViewFeed({
  branches = CORE_BRANCHES,
  today = new Date(),
  orderHorizon = defaultHorizonForToday(today),
  orderUsageBaseline = 'prev-week',
  orderDemandBuffer = true,
  branchOptions = null,
  firestore = db,
  quantityCache = {},
  masterItems: preloadedMaster = null,
  categoryDocs: preloadedCategories = null,
  /** Purchasing: plan Monday — full-week need + stock rolled to Monday opening. */
  asOf = null,
} = {}) {
  const [masterItems, categoryDocs] = await Promise.all([
    preloadedMaster || loadMasterItemsForOrderView(firestore),
    preloadedCategories ||
      loadCategoryDocsForOrderView(firestore).catch(() => []),
  ]);
  setCategoryOrderMap(buildCategoryOrderMap(categoryDocs, masterItems));
  const branchesInScope = branches.filter(Boolean);
  const orderItems = filterOrderViewItems(masterItems, branchesInScope).sort(compareOrderViewMasterItems);

  const dateKeys = new Set();
  if (branchOptions) {
    for (const branch of branchesInScope) {
      const baseline = branchOptions[branch]?.orderUsageBaseline || orderUsageBaseline;
      for (const key of orderViewDateKeysFor(today, baseline, asOf)) dateKeys.add(key);
    }
  } else {
    for (const key of orderViewDateKeysFor(today, orderUsageBaseline, asOf)) dateKeys.add(key);
  }

  const fetched = await fetchOrderViewQuantities(branchesInScope, dateKeys, quantityCache, firestore);
  if (!fetched) throw new Error('Failed to load order view quantities');

  if (branchOptions) {
    const branchRows = [];
    const byBranch = {};
    let planWeekStartKey = '';
    let planWeekEndKey = '';
    for (const branch of branchesInScope) {
      const opts = {
        orderHorizon,
        orderDemandBuffer,
        orderUsageBaseline,
        asOf,
        ...(branchOptions[branch] || {}),
      };
      const snapshot = buildOrderViewSnapshot(fetched, today, [branch], orderItems, opts);
      branchRows.push(...flattenBranchRows(snapshot));
      byBranch[branch] = snapshot.meta;
      planWeekStartKey = snapshot.meta.planWeekStart;
      planWeekEndKey = snapshot.meta.planWeekEnd;
    }
    return {
      snapshot: { rows: [], meta: { byBranch, planWeekStart: planWeekStartKey, planWeekEnd: planWeekEndKey } },
      branchRows,
      masterItems,
      meta: {
        byBranch,
        planWeekStart: planWeekStartKey,
        planWeekEnd: planWeekEndKey,
        asOfKey: asOf ? getDateKey(asOf) : null,
        mondayAsOf: !!asOf,
      },
    };
  }

  const snapshot = buildOrderViewSnapshot(fetched, today, branchesInScope, orderItems, {
    orderHorizon,
    orderDemandBuffer,
    orderUsageBaseline,
    asOf,
  });

  return {
    snapshot,
    branchRows: flattenBranchRows(snapshot),
    masterItems,
    meta: snapshot.meta,
  };
}
