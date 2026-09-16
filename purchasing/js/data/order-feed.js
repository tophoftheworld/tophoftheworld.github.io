import {
  loadOrderViewFeed,
  formatStockAsOfLabel,
  stockCountKindFromPick,
  CORE_BRANCHES,
  loadCategoryDocsForOrderView,
} from '../../../inventory/js/shared/order-view-feed.js?v=105';
import {
  loadForecastOptionsForBranches,
  loadBranchForecastMap,
  replaceBranchForecastMap,
} from '../../../inventory/js/shared/order-view-options.js?v=105';
import {
  planWeekStart,
  addDays,
  getDateKey,
  startOfWeekMonday,
  getIndexFromMondayForDate,
} from '../../../inventory/js/shared/forecast.js?v=105';
import { THIS_WEEK_ID } from './seed.js?v=96';
import { getItemPref, getSupplierRate } from './item-prefs.js?v=96';
import { getLiveMasterItems, setLocationMetaCache } from './catalog.js?v=96';
import { sanitizeLineCost, derivedRate, isAbsurdRate } from '../compute.js?v=96';
import {
  overlayKeepsLine,
  shouldIncludeOrderViewRow,
  overlayHasPlanEdits,
  overlayHasOnPlanBudget,
  weekHasOnPlanBudget,
  isManualPlanLine,
  shouldArchiveOverlayForLiveWeek,
  hasFrozenPlanMetrics,
  shouldFreezePlanMetrics,
} from './overlay-filter.js?v=96';
import {
  OVERLAY_KEY,
  emptyOverlay,
  loadLiveOverlay,
  saveLiveOverlay,
  savePastWeekRemote,
  getAckedOverlay,
} from './plan-sync.js?v=96';

export {
  overlayKeepsLine,
  shouldIncludeOrderViewRow,
  overlayHasPlanEdits,
  overlayHasOnPlanBudget,
  weekHasOnPlanBudget,
  isManualPlanLine,
} from './overlay-filter.js?v=96';
export { OVERLAY_KEY, emptyOverlay } from './plan-sync.js?v=96';
export { CORE_BRANCHES } from '../../../inventory/js/shared/order-view-feed.js?v=105';

export const LAST_OPEN_LOC_KEY = 'purchasing-last-open-loc';

export function overlayKey(itemId, location) {
  return `${itemId}|${location}`;
}

export function manualOverlayKey(lineId) {
  return `manual|${lineId}`;
}

export function archivedWeekId(weekStart) {
  return `week-${weekStart}`;
}

/** Sync cache of last loaded overlay for sync saveOverlay callers. */
let cachedOverlay = null;
/** Last Order View feed \u2014 reuse when applying a remote overlay without refetch. */
let cachedFeed = null;
let quantityCache = {};
let cachedCategoryDocs = null;
/** @type {Set<string>} */
const loadedBranches = new Set();
/** @type {Set<string>} */
const loadingBranches = new Set();

export async function loadOverlay() {
  cachedOverlay = await loadLiveOverlay();
  setLocationMetaCache(cachedOverlay?.locationMeta);
  return cachedOverlay;
}

export function saveOverlay(overlay, opts) {
  cachedOverlay = overlay;
  setLocationMetaCache(overlay?.locationMeta);
  return saveLiveOverlay(overlay, opts);
}

export function getCachedOrderViewFeed() {
  return cachedFeed;
}

export function getCachedOverlay() {
  return cachedOverlay;
}

export function getLoadedBranches() {
  return new Set(loadedBranches);
}

export function isBranchFeedLoaded(branch) {
  if (!CORE_BRANCHES.includes(branch)) return true;
  return loadedBranches.has(branch);
}

export function isBranchFeedLoading(branch) {
  return loadingBranches.has(branch);
}

export function loadLastOpenLoc() {
  try {
    const saved = localStorage.getItem(LAST_OPEN_LOC_KEY);
    if (saved) return saved;
  } catch (_) {
    /* ignore */
  }
  return 'podium';
}

export function saveLastOpenLoc(loc) {
  if (!loc) return;
  try {
    localStorage.setItem(LAST_OPEN_LOC_KEY, loc);
  } catch (_) {
    /* ignore */
  }
}

function applyBranchForecastFromOverlay(overlay) {
  if (!overlay?.branchForecast || typeof overlay.branchForecast !== 'object') return;
  if (!Object.keys(overlay.branchForecast).length) return;
  replaceBranchForecastMap(overlay.branchForecast);
}

function branchForecastForOverlay() {
  return loadBranchForecastMap();
}

function forecastMapsEqual(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function stockPickDateKey(pick) {
  if (!pick) return null;
  if (pick.dateKey) return pick.dateKey;
  if (pick.date) return getDateKey(pick.date);
  return null;
}

/** Live Monday stock: actual when a count exists on plan Monday; else forecasted roll-forward. */
function liveMondayStockMode(row, mondayKey) {
  if (!mondayKey) return 'forecast';
  return stockPickDateKey(row?.stockPick) === mondayKey ? 'actual' : 'forecast';
}

/**
 * Prefer explicit stockMode; else infer from Monday count date / legacy Mon labels.
 * @returns {'forecast'|'actual'|null}
 */
function inferStockMode(saved, weekStart = null) {
  if (saved?.stockMode === 'forecast' || saved?.stockMode === 'actual') return saved.stockMode;
  if (weekStart && saved?.lastCountedAt && saved.lastCountedAt === weekStart) return 'actual';
  if (
    saved?.metricsSnapshotted ||
    saved?.stockAsOfLabel === 'Mon' ||
    saved?.stockAsOfLabel === 'Mon opening' ||
    (saved?.stockAsOfLabel && /Opening/i.test(String(saved.stockAsOfLabel)))
  ) {
    return 'forecast';
  }
  return null;
}

function mondayStockAsOfLabel(mode, legacyLabel) {
  if (mode === 'forecast' || mode === 'actual') return null;
  if (
    legacyLabel === 'Mon opening' ||
    legacyLabel === 'Mon' ||
    (legacyLabel && /Opening/i.test(String(legacyLabel)))
  ) {
    return null;
  }
  return legacyLabel || null;
}

function mondayStockCountKind(mode, saved) {
  if (mode === 'forecast') return 'forecast';
  if (mode === 'actual') return 'opening';
  return (
    saved?.stockCountKind ||
    (saved?.metricsSnapshotted || /Opening/i.test(String(saved?.stockAsOfLabel || ''))
      ? 'opening'
      : null)
  );
}

/** Core branches that already have real plan work in the overlay. */
export function branchesWithPlanWork(overlay) {
  const out = new Set();
  for (const [key, saved] of Object.entries(overlay?.lines || {})) {
    if (!overlayKeepsLine(saved)) continue;
    const loc = key.split('|')[1];
    if (CORE_BRANCHES.includes(loc)) out.add(loc);
  }
  return [...out];
}

/**
 * Branches to fetch first: last-open + any with on-plan work.
 * Avoids waiting on every store before the Plan tab is usable.
 */
export function resolvePriorityBranches(overlay, preferred = null) {
  const needed = new Set();
  for (const b of branchesWithPlanWork(overlay)) needed.add(b);
  const last = preferred || loadLastOpenLoc();
  if (CORE_BRANCHES.includes(last)) needed.add(last);
  if (!needed.size) needed.add(CORE_BRANCHES.includes('podium') ? 'podium' : CORE_BRANCHES[0]);
  return CORE_BRANCHES.filter((b) => needed.has(b));
}

function emptyFeedShell() {
  return {
    snapshot: { rows: [], meta: {} },
    branchRows: [],
    masterItems: getLiveMasterItems() || [],
    meta: { byBranch: {}, planWeekStart: '', planWeekEnd: '' },
  };
}

function mergeFeeds(base, next) {
  const a = base || emptyFeedShell();
  const b = next || emptyFeedShell();
  const nextBranches = new Set(Object.keys(b.meta?.byBranch || {}));
  const retained = (a.branchRows || []).filter((row) => !nextBranches.has(row.branch));
  const byBranch = { ...(a.meta?.byBranch || {}), ...(b.meta?.byBranch || {}) };
  return {
    snapshot: b.snapshot || a.snapshot,
    branchRows: [...retained, ...(b.branchRows || [])],
    masterItems: b.masterItems?.length ? b.masterItems : a.masterItems,
    meta: {
      byBranch,
      planWeekStart: b.meta?.planWeekStart || a.meta?.planWeekStart || '',
      planWeekEnd: b.meta?.planWeekEnd || a.meta?.planWeekEnd || '',
      loadedBranches: [...loadedBranches],
    },
  };
}

async function loadFeedForBranches(branches) {
  const list = (branches || []).filter((b) => CORE_BRANCHES.includes(b));
  if (!list.length) return emptyFeedShell();

  for (const b of list) loadingBranches.add(b);
  try {
    if (!cachedCategoryDocs) {
      cachedCategoryDocs = await loadCategoryDocsForOrderView().catch(() => []);
    }
    const today = new Date();
    const asOf = planWeekStart(today);
    const branchOptions = loadForecastOptionsForBranches(CORE_BRANCHES);
    const feed = await loadOrderViewFeed({
      branches: list,
      branchOptions,
      quantityCache,
      masterItems: getLiveMasterItems() || undefined,
      categoryDocs: cachedCategoryDocs,
      asOf,
    });
    for (const b of list) loadedBranches.add(b);
    cachedFeed = mergeFeeds(cachedFeed, feed);
    if (cachedFeed?.meta) {
      cachedFeed.meta.loadedBranches = [...loadedBranches];
      cachedFeed.meta.asOfKey = getDateKey(asOf);
      cachedFeed.meta.mondayAsOf = true;
    }
    return feed;
  } finally {
    for (const b of list) loadingBranches.delete(b);
  }
}

function attachLoadedMeta(week) {
  if (!week) return week;
  week.liveMeta = {
    ...(week.liveMeta || {}),
    loadedBranches: [...loadedBranches],
    loadingBranches: [...loadingBranches],
  };
  return week;
}

export function isPlanHorizonRolloverDay(today = new Date()) {
  return getIndexFromMondayForDate(today) >= 4;
}

/**
 * Decide whether live overlay belongs to a prior plan week that must be archived.
 * @returns {{ archiveWeekStart: string, archiveWeekEnd: string } | null}
 */
export function resolveOverlayArchiveBounds(overlay, liveWeekStart, today = new Date()) {
  if (!overlay || !liveWeekStart) return null;

  if (overlay.weekStart && overlay.weekStart !== liveWeekStart) {
    const start = overlay.weekStart;
    const end =
      overlay.weekEnd ||
      getDateKey(addDays(new Date(`${start}T12:00:00`), 6));
    if (
      !shouldArchiveOverlayForLiveWeek({
        overlayWeekStart: start,
        overlayWeekEnd: end,
        liveWeekStart,
        todayKey: getDateKey(today),
      })
    ) {
      return null;
    }
    return { archiveWeekStart: start, archiveWeekEnd: end };
  }

  // Legacy overlay (no weekStart): on Fri\u2013Sun archive the calendar week so next week can open.
  if (
    !overlay.weekStart &&
    overlayHasPlanEdits(overlay) &&
    isPlanHorizonRolloverDay(today)
  ) {
    const calMonday = startOfWeekMonday(today);
    const archiveWeekStart = getDateKey(calMonday);
    const archiveWeekEnd = getDateKey(addDays(calMonday, 6));
    if (archiveWeekStart === liveWeekStart) return null;
    return {
      archiveWeekStart,
      archiveWeekEnd,
    };
  }

  return null;
}

function isManualPersistLine(line) {
  return isManualPlanLine(line);
}

function snapshotManualLine(line) {
  return {
    id: line.id,
    kind: line.kind || 'item',
    itemId: line.itemId ?? null,
    freeTextName: line.freeTextName ?? null,
    itemName: line.itemName || '',
    location: line.location,
    category: line.category || 'Other',
    categoryOrder: line.categoryOrder ?? 999,
    displayOrder: line.displayOrder ?? 0,
    qty: line.qty,
    suggestedQty: line.suggestedQty,
    qtyEdited: !!line.qtyEdited,
    unit: line.unit || 'pcs',
    unitRate: line.unitRate ?? null,
    estimatedCost: Number(line.estimatedCost) || 0,
    costSet: !!line.costSet,
    supplierId: line.supplierId ?? null,
    supplierName: line.supplierName || '\u2014',
    status: line.status || 'planned',
    frozen: !!line.frozen,
    onPlan: !!line.onPlan,
    source: line.source || 'manual',
    rateLocked: !!line.rateLocked,
    lastPaidRate: line.lastPaidRate ?? null,
    lastPaidDate: line.lastPaidDate ?? null,
    actualCost: line.actualCost ?? null,
    linkedExpenseIds: line.linkedExpenseIds || [],
    linkedExpenseLinks: Array.isArray(line.linkedExpenseLinks) ? line.linkedExpenseLinks : [],
    needQty: line.needQty ?? null,
    stockQty: line.stockQty ?? null,
    updatedAt: line.updatedAt || null,
    updatedBy: line.updatedBy || null,
  };
}

/** Apply a manual catalog add onto an existing Order View feed line so + Add stays visible. */
function applyManualSnapToFeedLine(feedLine, snap) {
  if (!feedLine || !snap) return feedLine;
  feedLine.onPlan = snap.onPlan != null ? !!snap.onPlan : true;
  if (snap.qty != null) {
    feedLine.qty = Number(snap.qty) || 0;
    feedLine.qtyEdited = true;
  }
  if (snap.estimatedCost != null) {
    feedLine.estimatedCost = Number(snap.estimatedCost) || 0;
    feedLine.costSet = !!snap.costSet || feedLine.estimatedCost > 0;
  }
  if (snap.unitRate != null) feedLine.unitRate = snap.unitRate;
  if (snap.supplierId != null) feedLine.supplierId = snap.supplierId;
  if (snap.supplierName) feedLine.supplierName = snap.supplierName;
  if (snap.status) feedLine.status = snap.status;
  if (snap.frozen != null) feedLine.frozen = !!snap.frozen;
  if (snap.rateLocked != null) feedLine.rateLocked = !!snap.rateLocked;
  if (snap.actualCost != null) feedLine.actualCost = snap.actualCost;
  if (Array.isArray(snap.linkedExpenseIds)) feedLine.linkedExpenseIds = snap.linkedExpenseIds;
  if (Array.isArray(snap.linkedExpenseLinks)) feedLine.linkedExpenseLinks = snap.linkedExpenseLinks;
  if (snap.updatedAt) feedLine.updatedAt = snap.updatedAt;
  if (snap.updatedBy) feedLine.updatedBy = snap.updatedBy;
  return feedLine;
}

function rehydrateManualLine(snap) {
  return {
    id: snap.id || `manual-${Date.now()}`,
    kind: snap.kind || 'item',
    itemId: snap.itemId ?? null,
    freeTextName: snap.freeTextName ?? null,
    itemName: snap.itemName || snap.freeTextName || 'Custom item',
    location: snap.location,
    category: snap.category || 'Other',
    categoryOrder: snap.categoryOrder ?? 999,
    displayOrder: snap.displayOrder ?? 0,
    qty: Number(snap.qty) || (snap.kind === 'budget' ? 1 : 0),
    suggestedQty: snap.suggestedQty ?? snap.qty,
    qtyEdited: !!snap.qtyEdited,
    unit: snap.unit || 'pcs',
    unitRate: snap.unitRate ?? null,
    estimatedCost: Number(snap.estimatedCost) || 0,
    costSet: !!snap.costSet || Number(snap.estimatedCost) > 0,
    supplierId: snap.supplierId ?? null,
    supplierName: snap.supplierName || 'Unassigned',
    supplierOptions: [],
    source: snap.source || 'manual',
    status: snap.status || 'planned',
    onPlan: snap.onPlan != null ? !!snap.onPlan : true,
    needQty: snap.needQty ?? null,
    stockQty: snap.stockQty ?? null,
    runoutDate: null,
    lastCountedAt: null,
    countAgeDays: null,
    lastPaidRate: snap.lastPaidRate ?? null,
    lastPaidDate: snap.lastPaidDate ?? null,
    linkedExpenseIds: snap.linkedExpenseIds || [],
    linkedExpenseLinks: Array.isArray(snap.linkedExpenseLinks) ? snap.linkedExpenseLinks : [],
    attachedLineIds: [],
    frozen: !!snap.frozen,
    actualCost: snap.actualCost ?? null,
    rateLocked: !!snap.rateLocked,
    needsCount: false,
    updatedAt: snap.updatedAt || null,
    updatedBy: snap.updatedBy || null,
  };
}

function rehydrateOverlaySavedLine(itemId, location, saved) {
  return {
    id: saved.id || `live-${itemId}-${location}`,
    kind: saved.kind || 'item',
    itemId,
    freeTextName: saved.freeTextName ?? null,
    itemName: saved.itemName || itemId,
    location,
    category: saved.category || 'Other',
    categoryOrder: saved.categoryOrder ?? 999,
    displayOrder: saved.displayOrder ?? 0,
    qty: Number(saved.qty) || 0,
    suggestedQty: saved.suggestedQty ?? saved.qty ?? 0,
    qtyEdited: !!saved.qtyEdited,
    unit: saved.unit || 'pcs',
    unitRate: saved.unitRate ?? null,
    estimatedCost: Number(saved.estimatedCost) || 0,
    costSet: !!saved.costSet || Number(saved.estimatedCost) > 0,
    supplierId: saved.supplierId ?? null,
    supplierName: saved.supplierName || 'Unassigned',
    supplierOptions: [],
    source: saved.source || 'order-view',
    status: saved.status || 'planned',
    onPlan: saved.onPlan != null ? !!saved.onPlan : true,
    needQty: saved.needQty ?? null,
    stockQty: saved.stockQty ?? null,
    ...(() => {
      const stockMode = inferStockMode(saved, null);
      return {
        stockMode,
        stockAsOfLabel: mondayStockAsOfLabel(stockMode, saved.stockAsOfLabel),
        stockCountKind: mondayStockCountKind(stockMode, saved),
      };
    })(),
    stockSub: saved.stockSub || '',
    runoutDate: saved.runoutDate ?? null,
    runOutPrimary: saved.runOutPrimary ?? null,
    runOutSecondary: saved.runOutSecondary ?? null,
    runOutTitle: saved.runOutTitle ?? null,
    runOutUrgent: !!saved.runOutUrgent,
    lastCountedAt: saved.lastCountedAt ?? null,
    countAgeDays: saved.countAgeDays ?? null,
    lastPaidRate: saved.unitRate ?? saved.lastPaidRate ?? null,
    lastPaidDate: saved.lastPaidDate ?? null,
    linkedExpenseIds: saved.linkedExpenseIds || [],
    linkedExpenseLinks: Array.isArray(saved.linkedExpenseLinks) ? saved.linkedExpenseLinks : [],
    attachedLineIds: [],
    frozen: !!saved.frozen || (saved.status && saved.status !== 'planned'),
    actualCost: saved.actualCost ?? null,
    rateLocked: !!saved.rateLocked,
    needsCount: !!saved.needsCount,
    metricsSnapshotted: saved.metricsSnapshotted !== false,
    warnReasons: saved.warnReasons || [],
    updatedAt: saved.updatedAt || null,
    updatedBy: saved.updatedBy || null,
  };
}

/**
 * Extract purchasing-only fields from a live week for Firebase / localStorage.
 * Retains overlay.lines for core branches not yet loaded in the feed so a
 * partial Order View boot cannot drop other locations' plan work.
 */
export function extractOverlayFromWeek(week, { priorOverlay = null } = {}) {
  const prior =
    priorOverlay ||
    cachedOverlay ||
    getAckedOverlay() ||
    emptyOverlay();
  const overlay = {
    weekStart: week.weekStart || prior.weekStart || null,
    weekEnd: week.weekEnd || prior.weekEnd || null,
    weekStatus: week.status,
    released: week.released || 0,
    spent: week.spent || 0,
    returned: week.returned || 0,
    settledAt: week.settledAt || null,
    updatedAt: week.updatedAt || prior.updatedAt || null,
    updatedBy: week.updatedBy || prior.updatedBy || null,
    lines: {},
    manualLines: {},
    branchForecast: branchForecastForOverlay(),
    locationMeta: {
      ...(prior.locationMeta || {}),
      ...(week.locationMeta || {}),
    },
    offPlanExpenses: Array.isArray(week.offPlanExpenses) ? week.offPlanExpenses : [],
  };
  for (const line of week.lines || []) {
    if (isManualPersistLine(line)) {
      overlay.manualLines[line.id] = snapshotManualLine(line);
      continue;
    }
    if (!line.itemId) continue;
    const saved = {
      onPlan: !!line.onPlan,
      estimatedCost: Number(line.estimatedCost) || 0,
      costSet: !!line.costSet || Number(line.estimatedCost) > 0,
      unitRate: line.unitRate ?? null,
      supplierId: line.supplierId ?? null,
      supplierName: line.supplierName || '\u2014',
      status: line.status || 'planned',
      frozen: !!line.frozen,
      qty: line.qty,
      qtyEdited: !!line.qtyEdited,
      rateLocked: !!line.rateLocked,
      actualCost: line.actualCost ?? null,
      linkedExpenseIds: line.linkedExpenseIds || [],
      linkedExpenseLinks: Array.isArray(line.linkedExpenseLinks) ? line.linkedExpenseLinks : [],
      itemName: line.itemName || '',
      unit: line.unit || 'pcs',
      category: line.category || 'Other',
      categoryOrder: line.categoryOrder ?? 999,
      displayOrder: line.displayOrder ?? 0,
      suggestedQty: line.suggestedQty,
      needQty: line.needQty ?? null,
      stockQty: line.stockQty ?? null,
      stockMode: line.stockMode || null,
      stockAsOfLabel: line.stockAsOfLabel || null,
      stockCountKind: line.stockCountKind || null,
      stockSub: line.stockSub || '',
      lastCountedAt: line.lastCountedAt ?? null,
      countAgeDays: line.countAgeDays ?? null,
      runoutDate: line.runoutDate ?? null,
      runOutPrimary: line.runOutPrimary ?? null,
      runOutSecondary: line.runOutSecondary ?? null,
      runOutTitle: line.runOutTitle ?? null,
      runOutUrgent: !!line.runOutUrgent,
      needsCount: !!line.needsCount,
      warnReasons: line.warnReasons || [],
      metricsSnapshotted: line.metricsSnapshotted !== false,
      updatedAt: line.updatedAt || null,
      updatedBy: line.updatedBy || null,
    };
    if (!overlayKeepsLine(saved)) continue;
    overlay.lines[overlayKey(line.itemId, line.location)] = saved;
  }

  // Keep plan lines for core branches whose Order View feed is not loaded yet.
  for (const [key, saved] of Object.entries(prior.lines || {})) {
    if (overlay.lines[key]) continue;
    const loc = key.split('|')[1];
    if (CORE_BRANCHES.includes(loc) && !loadedBranches.has(loc) && overlayKeepsLine(saved)) {
      overlay.lines[key] = saved;
    }
  }
  // Manual lines are always fully present in week.lines when loaded; if week was
  // built from a partial mapFeedToWeek they are already in overlay.manualLines.
  // Retain prior manuals not present only when week came from cache stub.
  if (week.fromCacheStub || week.fromCache) {
    for (const [id, snap] of Object.entries(prior.manualLines || {})) {
      if (!overlay.manualLines[id] && overlayKeepsLine(snap)) {
        overlay.manualLines[id] = snap;
      }
    }
  }
  return overlay;
}

/**
 * Build a frozen past-week snapshot from an overlay + optional live-mapped week.
 * Used when the plan horizon rolls forward so unfinished work stays in the picker.
 */
export function buildArchivedWeekFromOverlay(
  overlay,
  { weekStart, weekEnd, mappedWeek = null } = {}
) {
  const start = weekStart || overlay.weekStart;
  const end =
    weekEnd ||
    overlay.weekEnd ||
    (start ? getDateKey(addDays(new Date(`${start}T12:00:00`), 6)) : null);

  let lines = [];
  if (mappedWeek?.lines?.length) {
    lines = mappedWeek.lines.map((l) => ({ ...l }));
  } else {
    for (const [key, saved] of Object.entries(overlay.lines || {})) {
      const [itemId, location] = key.split('|');
      lines.push({
        id: `arch-${itemId}-${location}`,
        kind: 'item',
        itemId,
        itemName: saved.itemName || itemId,
        freeTextName: null,
        location,
        category: saved.category || 'Other',
        categoryOrder: saved.categoryOrder ?? 999,
        displayOrder: saved.displayOrder ?? 0,
        qty: Number(saved.qty) || 0,
        suggestedQty: saved.suggestedQty ?? saved.qty ?? 0,
        qtyEdited: !!saved.qtyEdited,
        unit: saved.unit || 'pcs',
        unitRate: saved.unitRate ?? null,
        estimatedCost: Number(saved.estimatedCost) || 0,
        costSet: !!saved.costSet || Number(saved.estimatedCost) > 0,
        supplierId: saved.supplierId ?? null,
        supplierName: saved.supplierName || 'Unassigned',
        supplierOptions: [],
        source: 'archived',
        status: saved.status || 'planned',
        onPlan: saved.onPlan != null ? !!saved.onPlan : false,
        needQty: saved.needQty ?? null,
        stockQty: saved.stockQty ?? null,
        ...(() => {
          const stockMode = inferStockMode(saved, start);
          return {
            stockMode,
            stockAsOfLabel: mondayStockAsOfLabel(stockMode, saved.stockAsOfLabel),
            stockCountKind: mondayStockCountKind(stockMode, saved),
          };
        })(),
        stockSub: saved.stockSub || '',
        runoutDate: saved.runoutDate ?? null,
        runOutPrimary: saved.runOutPrimary ?? null,
        runOutSecondary: saved.runOutSecondary ?? null,
        runOutTitle: saved.runOutTitle ?? null,
        runOutUrgent: !!saved.runOutUrgent,
        lastCountedAt: saved.lastCountedAt ?? null,
        countAgeDays: saved.countAgeDays ?? null,
        lastPaidRate: saved.unitRate ?? null,
        lastPaidDate: null,
        linkedExpenseIds: saved.linkedExpenseIds || [],
        linkedExpenseLinks: Array.isArray(saved.linkedExpenseLinks) ? saved.linkedExpenseLinks : [],
        attachedLineIds: [],
        frozen: !!saved.frozen || (saved.status && saved.status !== 'planned'),
        actualCost: saved.actualCost ?? null,
        rateLocked: !!saved.rateLocked,
        needsCount: !!saved.needsCount,
        metricsSnapshotted: saved.metricsSnapshotted !== false,
        warnReasons: saved.warnReasons || [],
        updatedAt: saved.updatedAt || null,
        updatedBy: saved.updatedBy || null,
      });
    }
    for (const snap of Object.values(overlay.manualLines || {})) {
      if (!overlayKeepsLine(snap)) continue;
      lines.push(rehydrateManualLine(snap));
    }
  }

  return {
    id: archivedWeekId(start),
    weekStart: start,
    weekEnd: end,
    status: overlay.weekStatus || mappedWeek?.status || 'draft',
    settledAt: overlay.settledAt || null,
    released: Number(overlay.released) || Number(mappedWeek?.released) || 0,
    spent: Number(overlay.spent) || Number(mappedWeek?.spent) || 0,
    returned: Number(overlay.returned) || Number(mappedWeek?.returned) || 0,
    buffer: 0,
    bufferManual: true,
    lines,
    offPlanExpenses: Array.isArray(overlay.offPlanExpenses) ? overlay.offPlanExpenses : [],
    archived: true,
    liveMeta: { mondayAsOf: true, asOfKey: start },
    updatedAt: overlay.updatedAt || null,
    updatedBy: overlay.updatedBy || null,
  };
}

function unassignedSupplier() {
  return { id: null, name: 'Unassigned' };
}

function resolveSupplier(saved, prefs) {
  if (saved.supplierId || (saved.supplierName && saved.supplierName !== '\u2014')) {
    return { id: saved.supplierId ?? null, name: saved.supplierName };
  }
  const primaryId = prefs?.primarySupplierId || prefs?.lastSupplierId;
  const primaryName = prefs?.lastSupplierName;
  if (primaryId || primaryName) {
    return { id: primaryId ?? null, name: primaryName || 'Unassigned' };
  }
  return unassignedSupplier();
}

function resolveUnitRate(saved, prefs, supplierId, qty) {
  if (saved.unitRate != null && saved.unitRate > 0 && !isAbsurdRate(saved.unitRate, qty)) {
    return Number(saved.unitRate);
  }
  const fromSupplier = getSupplierRate(prefs?.itemId || saved.itemId, supplierId);
  if (fromSupplier != null && !isAbsurdRate(fromSupplier, qty)) return fromSupplier;
  if (
    !supplierId &&
    prefs?.lastPaidRate != null &&
    !isAbsurdRate(prefs.lastPaidRate, qty)
  ) {
    return Number(prefs.lastPaidRate);
  }
  if (saved.estimatedCost > 0 && qty > 0) {
    const implied = saved.estimatedCost / qty;
    if (!isAbsurdRate(implied, qty)) return implied;
  }
  return null;
}

/**
 * Map Order View branch rows → purchasing week lines.
 * Monday stock/need/suggested freeze from overlay when already snapshotted;
 * live feed fills blanks for new rows only.
 */
export function mapFeedToWeek(feed, overlay = {}) {
  const today = new Date();
  const weekStart = planWeekStart(today);
  const weekEnd = addDays(weekStart, 6);
  const todayKey = getDateKey(today);
  const liveWeekStart = overlay.weekStart || getDateKey(weekStart);
  const allowFreeze = shouldFreezePlanMetrics({
    weekStart: liveWeekStart,
    todayKey,
  });
  const lineOverlay = overlay.lines || {};
  const manualByItemLoc = new Map();
  for (const snap of Object.values(overlay.manualLines || {})) {
    if (!snap?.itemId || !overlayKeepsLine(snap)) continue;
    manualByItemLoc.set(overlayKey(snap.itemId, snap.location), snap);
  }

  const rows = (feed.branchRows || []).filter((row) => {
    const key = overlayKey(row.itemId, row.branch);
    if (shouldIncludeOrderViewRow(row, lineOverlay[key])) return true;
    // Catalog + Add in manualLines should still surface the Order View row.
    return manualByItemLoc.has(key);
  });

  const lines = rows.map((row) => {
    const key = overlayKey(row.itemId, row.branch);
    const saved = lineOverlay[key] || {};
    const prefs = getItemPref(row.itemId) || { itemId: row.itemId };

    const supplier = resolveSupplier(saved, prefs);

    const liveSuggested = row.suggested == null ? 0 : Number(row.suggested) || 0;
    const freezeMetrics = allowFreeze && hasFrozenPlanMetrics(saved);
    const suggested = freezeMetrics && saved.suggestedQty != null
      ? Number(saved.suggestedQty) || 0
      : liveSuggested;
    const frozen = saved.frozen || (saved.status && saved.status !== 'planned');
    const qtyEdited = !!saved.qtyEdited;
    const qty =
      (frozen || qtyEdited) && saved.qty != null ? Number(saved.qty) : suggested;

    const unitRate = resolveUnitRate(saved, prefs, supplier.id, qty);
    const lastPaidRate = unitRate ?? (prefs.lastPaidRate != null ? Number(prefs.lastPaidRate) : null);
    const lastPaidDate = prefs.lastPaidDate || null;

    let estimatedCost = 0;
    const hasSavedCost =
      saved.costSet ||
      saved.rateLocked ||
      (saved.estimatedCost != null && Number(saved.estimatedCost) > 0);
    const keepSavedCost = (frozen || qtyEdited) && hasSavedCost;

    if (keepSavedCost) {
      const raw = Number(saved.estimatedCost) || 0;
      const sanitized = sanitizeLineCost(
        { qty, estimatedCost: raw, unitRate: saved.unitRate },
        lastPaidRate
      );
      estimatedCost = sanitized.estimatedCost ?? raw;
    } else if (unitRate != null && qty > 0) {
      estimatedCost = Math.round(qty * unitRate);
    }

    const finalUnitRate =
      unitRate ??
      derivedRate(qty, estimatedCost) ??
      (lastPaidRate != null && !isAbsurdRate(lastPaidRate, qty) ? lastPaidRate : null);

    const liveNeed =
      row.projected == null ? null : Math.max(0, Number(row.projected) || 0);
    const liveStock = row.needsCount ? null : row.effectiveStock;
    const needQty = freezeMetrics && saved.needQty !== undefined ? saved.needQty : liveNeed;

    // Purchasing stock is Monday opening: forecasted until a real Monday count exists.
    const mondayKey = feed.meta?.asOfKey || liveWeekStart || null;
    const mondayStock = !!(feed.meta?.mondayAsOf || feed.meta?.asOfKey);
    const liveStockMode = mondayStock ? liveMondayStockMode(row, mondayKey) : null;
    const savedStockMode = inferStockMode(saved, mondayKey);

    let stockQty;
    let stockMode = null;
    let useFrozenStockMeta = false;
    if (mondayStock) {
      if (liveStockMode === 'actual') {
        stockQty = liveStock;
        stockMode = 'actual';
      } else if (freezeMetrics && savedStockMode === 'actual' && 'stockQty' in saved) {
        stockQty = saved.stockQty;
        stockMode = 'actual';
        useFrozenStockMeta = true;
      } else {
        // Forecast stays live through Fri\u2013Sun planning and until Monday is counted.
        stockQty = liveStock;
        stockMode = 'forecast';
      }
    } else {
      stockQty = freezeMetrics && 'stockQty' in saved ? saved.stockQty : liveStock;
    }

    const liveCountedAt = row.stockPick?.date ? getDateKey(row.stockPick.date) : null;
    const lastCountedAt =
      useFrozenStockMeta && saved.lastCountedAt != null ? saved.lastCountedAt : liveCountedAt;
    const stockAsOfLabel = mondayStock
      ? null
      : freezeMetrics && saved.stockAsOfLabel
        ? saved.stockAsOfLabel
        : row.stockPick?.date != null
          ? formatStockAsOfLabel(row.stockPick, row.ageDays)
          : null;
    const stockCountKind = mondayStock
      ? stockMode === 'actual'
        ? 'opening'
        : 'forecast'
      : freezeMetrics && saved.stockCountKind
        ? saved.stockCountKind
        : row.stockPick
          ? stockCountKindFromPick(row.stockPick)
          : null;

    return {
      id: `live-${row.itemId}-${row.branch}`,
      kind: 'item',
      itemId: row.itemId,
      itemName: row.item.description
        ? `${row.item.name} (${row.item.description})`
        : row.item.name || 'Unknown item',
      freeTextName: null,
      location: row.branch,
      category: row.item.category || 'Other',
      categoryOrder: row.item.categoryOrder ?? 999,
      displayOrder: row.item.displayOrder ?? row.item.order ?? 0,
      qty,
      suggestedQty: suggested,
      qtyEdited,
      unit: row.unit || 'pcs',
      unitRate: finalUnitRate,
      estimatedCost,
      costSet: !!saved.costSet || estimatedCost > 0,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name || 'Unassigned',
      supplierOptions: [],
      source: 'order-view',
      status: saved.status || 'planned',
      onPlan: saved.onPlan != null ? !!saved.onPlan : false,
      needQty,
      stockQty,
      stockMode,
      runoutDate: freezeMetrics && saved.runoutDate != null ? saved.runoutDate : row.runoutDate,
      runOutPrimary:
        freezeMetrics && saved.runOutPrimary != null ? saved.runOutPrimary : row.runOutPrimary,
      runOutSecondary:
        freezeMetrics && saved.runOutSecondary != null
          ? saved.runOutSecondary
          : row.runOutSecondary,
      runOutTitle: freezeMetrics && saved.runOutTitle != null ? saved.runOutTitle : row.runOutTitle,
      runOutUrgent: freezeMetrics && saved.runOutUrgent != null
        ? !!saved.runOutUrgent
        : !!row.runOutUrgent,
      stockAsOfLabel,
      stockCountKind,
      stockSub: freezeMetrics && saved.stockSub != null ? saved.stockSub : row.stockSub || '',
      lastCountedAt,
      countAgeDays:
        useFrozenStockMeta && saved.countAgeDays != null ? saved.countAgeDays : row.ageDays,
      lastPaidRate,
      lastPaidDate,
      linkedExpenseIds: saved.linkedExpenseIds || [],
      linkedExpenseLinks: Array.isArray(saved.linkedExpenseLinks) ? saved.linkedExpenseLinks : [],
      attachedLineIds: [],
      frozen: !!frozen,
      actualCost: saved.actualCost ?? null,
      rateLocked: !!saved.rateLocked,
      needsCount: useFrozenStockMeta ? !!saved.needsCount : !!row.needsCount,
      warnReasons: freezeMetrics && saved.warnReasons ? saved.warnReasons : row.warnReasons || [],
      metricsSnapshotted: allowFreeze,
      updatedAt: saved.updatedAt || null,
      updatedBy: saved.updatedBy || null,
    };
  });

  const lineByItemLoc = new Map();
  for (const line of lines) {
    if (line.itemId) lineByItemLoc.set(overlayKey(line.itemId, line.location), line);
  }

  const manualSnaps = overlay.manualLines || {};
  for (const snap of Object.values(manualSnaps)) {
    // Drop removed custom/budget lines (legacy onPlan:false leftovers).
    if (!overlayKeepsLine(snap)) continue;
    if (snap.itemId) {
      const feedLine = lineByItemLoc.get(overlayKey(snap.itemId, snap.location));
      if (feedLine) {
        // Catalog + Add matched an Order View row \u2014 merge onto the feed line
        // instead of silently dropping the manual add.
        applyManualSnapToFeedLine(feedLine, snap);
        continue;
      }
    }
    lines.push(rehydrateManualLine(snap));
  }

  for (const [key, saved] of Object.entries(lineOverlay)) {
    if (!overlayKeepsLine(saved) || lineByItemLoc.has(key)) continue;
    const sep = key.indexOf('|');
    if (sep < 0) continue;
    const itemId = key.slice(0, sep);
    const location = key.slice(sep + 1);
    if (!itemId || !location) continue;
    const line = rehydrateOverlaySavedLine(itemId, location, saved);
    lines.push(line);
    lineByItemLoc.set(key, line);
  }

  const status = overlay.weekStatus || 'draft';
  const resolvedStart =
    overlay.weekStart && overlay.weekStart === getDateKey(weekStart)
      ? overlay.weekStart
      : feed.meta?.planWeekStart || getDateKey(weekStart);
  const resolvedEnd =
    overlay.weekEnd && overlay.weekStart === getDateKey(weekStart)
      ? overlay.weekEnd
      : feed.meta?.planWeekEnd || getDateKey(weekEnd);
  const locationMeta = overlay.locationMeta || {};
  setLocationMetaCache(locationMeta);
  return attachLoadedMeta({
    id: THIS_WEEK_ID,
    weekStart: resolvedStart,
    weekEnd: resolvedEnd,
    status,
    settledAt: overlay.settledAt || null,
    released: Number(overlay.released) || 0,
    spent: Number(overlay.spent) || 0,
    returned: Number(overlay.returned) || 0,
    buffer: 0,
    bufferManual: true,
    lines,
    offPlanExpenses: Array.isArray(overlay.offPlanExpenses) ? overlay.offPlanExpenses : [],
    locationMeta,
    liveMeta: feed.meta || null,
    archived: false,
    updatedAt: overlay.updatedAt || null,
    updatedBy: overlay.updatedBy || null,
  });
}

/**
 * Load live week from Order View, archiving prior unfinished overlay when the plan horizon rolls.
 * Loads last-open (+ plan-work) branches first unless `branches` is passed.
 * @returns {{ thisWeek: object, archivedWeek: object | null, priorityBranches: string[] }}
 */
export async function fetchThisWeekFromOrderView({ branches = null, full = false } = {}) {
  const overlay = await loadOverlay();
  applyBranchForecastFromOverlay(overlay);

  const priority = full
    ? [...CORE_BRANCHES]
    : branches?.length
      ? branches.filter((b) => CORE_BRANCHES.includes(b))
      : resolvePriorityBranches(overlay);

  // Reset feed caches when doing a full/priority boot so stale branches don't linger.
  if (!branches || full) {
    cachedFeed = null;
    loadedBranches.clear();
  }

  await loadFeedForBranches(priority);

  const today = new Date();
  const liveWeekStart =
    cachedFeed?.meta?.planWeekStart || getDateKey(planWeekStart(today));
  const liveWeekEnd =
    cachedFeed?.meta?.planWeekEnd || getDateKey(addDays(planWeekStart(today), 6));

  const archiveBounds = resolveOverlayArchiveBounds(overlay, liveWeekStart, today);
  if (archiveBounds) {
    // Load every branch with plan work so archive isn't missing SM North / MOA lines.
    const planBranches = branchesWithPlanWork(overlay);
    const missing = planBranches.filter((b) => !loadedBranches.has(b));
    if (missing.length) await loadFeedForBranches(missing);

    // Archive from overlay snapshot only \u2014 never remap through next week's live feed.
    // Metrics-only overlays must not create a \u20B10 past week; require onPlan lines.
    // savePastWeekRemote also refuses to overwrite a non-empty week with an empty one.
    let archivedWeek = null;
    if (overlayHasOnPlanBudget(overlay)) {
      archivedWeek = buildArchivedWeekFromOverlay(overlay, {
        weekStart: archiveBounds.archiveWeekStart,
        weekEnd: archiveBounds.archiveWeekEnd,
        mappedWeek: null,
      });
      if (weekHasOnPlanBudget(archivedWeek)) {
        archivedWeek = (await savePastWeekRemote(archivedWeek)) || archivedWeek;
      } else {
        archivedWeek = null;
      }
    }
    const fresh = emptyOverlay(liveWeekStart, liveWeekEnd);
    fresh.branchForecast = branchForecastForOverlay();
    await saveOverlay(fresh, { flush: true, replace: true });
    const thisWeek = mapFeedToWeek(cachedFeed, fresh);
    await seedOverlayMetricsIfNeeded(fresh, thisWeek);
    return { thisWeek, archivedWeek, priorityBranches: priority };
  }

  const thisWeek = mapFeedToWeek(cachedFeed, overlay);
  await seedOverlayMetricsIfNeeded(overlay, thisWeek);
  return { thisWeek, archivedWeek: null, priorityBranches: priority };
}

/** Persist Monday stock/need/suggested once the plan week has started (not Fri\u2013Sun ahead).
 * Also upgrades frozen forecast stock → actual Monday count when that count appears. */
async function seedOverlayMetricsIfNeeded(overlay, thisWeek) {
  if (!thisWeek?.lines?.length) return;
  const todayKey = getDateKey(new Date());
  const weekStart = thisWeek.weekStart || overlay?.weekStart;
  if (!shouldFreezePlanMetrics({ weekStart, todayKey })) return;
  let needsSeed = false;
  for (const line of thisWeek.lines) {
    if (!line.itemId || isManualPlanLine(line)) continue;
    const key = overlayKey(line.itemId, line.location);
    const saved = overlay?.lines?.[key];
    if (!hasFrozenPlanMetrics(saved)) {
      needsSeed = true;
      break;
    }
    if (line.stockMode === 'actual' && inferStockMode(saved, weekStart) !== 'actual') {
      needsSeed = true;
      break;
    }
  }
  if (!needsSeed) return;
  const next = extractOverlayFromWeek(thisWeek, { priorOverlay: overlay });
  next.weekStart = thisWeek.weekStart || overlay?.weekStart || next.weekStart;
  next.weekEnd = thisWeek.weekEnd || overlay?.weekEnd || next.weekEnd;
  try {
    await saveOverlay(next, { flush: true });
  } catch (err) {
    console.warn('Could not seed purchasing Monday metrics', err);
  }
}

/**
 * Fetch one more core branch into the cached feed and remap the live week.
 * @returns {object | null} remapped thisWeek, or null if already loaded / not a core branch
 */
export async function ensureBranchFeed(branch) {
  if (!CORE_BRANCHES.includes(branch)) return null;
  if (loadedBranches.has(branch)) {
    return cachedFeed ? mapFeedToWeek(cachedFeed, cachedOverlay || emptyOverlay()) : null;
  }
  if (loadingBranches.has(branch)) return null;

  await loadFeedForBranches([branch]);
  const overlay = cachedOverlay || (await loadOverlay());
  return mapFeedToWeek(cachedFeed, overlay);
}

/**
 * Force-refetch one branch (e.g. after forecast option change).
 */
export async function reloadBranchFeed(branch) {
  if (!CORE_BRANCHES.includes(branch)) return null;
  loadedBranches.delete(branch);
  if (quantityCache[branch]) delete quantityCache[branch];
  if (cachedFeed) {
    cachedFeed = {
      ...cachedFeed,
      branchRows: (cachedFeed.branchRows || []).filter((r) => r.branch !== branch),
      meta: {
        ...(cachedFeed.meta || {}),
        byBranch: { ...(cachedFeed.meta?.byBranch || {}) },
      },
    };
    delete cachedFeed.meta.byBranch[branch];
  }
  return ensureBranchFeed(branch);
}

/** Remaining core branches not yet fetched (for background warm-up). */
export function pendingCoreBranches() {
  return CORE_BRANCHES.filter((b) => !loadedBranches.has(b));
}

/**
 * Apply a remote overlay onto the cached Order View feed.
 * Reloads loaded branches when forecast options changed.
 * @returns {{ thisWeek: object, feedReloaded: boolean } | null}
 */
export async function rebuildWeekFromRemoteOverlay(overlay) {
  const prevForecast = cachedOverlay?.branchForecast;
  const nextForecast = overlay?.branchForecast;
  const forecastChanged = !forecastMapsEqual(prevForecast, nextForecast);

  cachedOverlay = overlay || emptyOverlay();
  setLocationMetaCache(cachedOverlay?.locationMeta);
  applyBranchForecastFromOverlay(cachedOverlay);

  const branches = loadedBranches.size
    ? [...loadedBranches]
    : resolvePriorityBranches(cachedOverlay);

  if (forecastChanged || !cachedFeed) {
    // Forecast change invalidates quantity math \u2014 refetch currently loaded branches.
    const toReload = [...branches];
    for (const b of toReload) loadedBranches.delete(b);
    quantityCache = {};
    cachedFeed = null;
    await loadFeedForBranches(toReload.length ? toReload : resolvePriorityBranches(cachedOverlay));
    return {
      thisWeek: mapFeedToWeek(cachedFeed, cachedOverlay),
      feedReloaded: true,
    };
  }

  return {
    thisWeek: mapFeedToWeek(cachedFeed, cachedOverlay),
    feedReloaded: false,
  };
}
