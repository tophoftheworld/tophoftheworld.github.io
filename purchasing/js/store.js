import { THIS_WEEK_ID } from './data/seed.js?v=96';
import {
  weekTotal,
  spentBuckets,
  isLockedStatus,
  lineUnitRate,
  recalcLineCost,
  lineAmount,
} from './compute.js?v=96';
import {
  fetchThisWeekFromOrderView,
  extractOverlayFromWeek,
  saveOverlay,
  OVERLAY_KEY,
  rebuildWeekFromRemoteOverlay,
  isManualPlanLine,
  ensureBranchFeed,
  pendingCoreBranches,
  saveLastOpenLoc,
  loadLastOpenLoc,
  isBranchFeedLoaded,
  reloadBranchFeed,
  CORE_BRANCHES,
} from './data/order-feed.js?v=96';
import {
  loadPastWeeksRemote,
  peekLocalPastWeeks,
  savePastWeeksRemote,
  clearLiveOverlay,
  subscribeLiveOverlay,
  setAckedOverlay,
  getAckedOverlay,
  mergeOverlays,
  cancelPendingOverlaySave,
  hasPendingOverlaySave,
} from './data/plan-sync.js?v=96';
import { preferNonEmptyPastWeek } from './data/overlay-filter.js?v=96';
import { savePrefsFromLine } from './data/item-prefs.js?v=96';
import { savePrefsFromCustomLine } from './data/custom-items.js?v=96';
import { siblingSharesRate } from './data/rate-scope.js?v=96';
import {
  readLiveWeekCache,
  writeLiveWeekCache,
} from './data/last-route.js?v=96';

let state = null;
const listeners = new Set();
let liveOverlayUnsub = null;
let applyingRemote = false;
/** True when this tab has local plan edits not yet acked by the server. */
let overlayDirty = false;

function notifyListeners() {
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

export function isOverlayDirty() {
  return overlayDirty;
}

function mergePastWeeks(existing, archivedWeek) {
  const byId = new Map();
  for (const w of existing || []) {
    if (!w?.id || w.id === THIS_WEEK_ID) continue;
    byId.set(w.id, w);
  }
  if (archivedWeek?.id) {
    const prev = byId.get(archivedWeek.id);
    byId.set(archivedWeek.id, preferNonEmptyPastWeek(prev, archivedWeek));
  }
  return [...byId.values()].sort((a, b) =>
    String(b.weekStart || '').localeCompare(String(a.weekStart || ''))
  );
}

/**
 * Instant paint from localStorage before Firebase / Order View finish.
 * Read-only \u2014 never flushes this cache to Firebase.
 * Returns true when state was hydrated from cache.
 */
export function tryHydrateFromLocalCache() {
  if (state) return false;
  const live = readLiveWeekCache();
  const past = peekLocalPastWeeks();
  if (!live && !past.length) return false;

  const thisWeek =
    live && live.id === THIS_WEEK_ID
      ? { ...live, fromCache: true }
      : {
          id: THIS_WEEK_ID,
          weekStart: live?.weekStart || null,
          weekEnd: live?.weekEnd || null,
          status: 'draft',
          lines: [],
          released: 0,
          spent: 0,
          returned: 0,
          offPlanExpenses: [],
          fromCacheStub: true,
        };

  state = {
    version: 7,
    live: true,
    fromCache: true,
    weeks: [thisWeek, ...past.filter((w) => w.id !== THIS_WEEK_ID)],
  };
  notifyListeners();
  return true;
}

/**
 * Load live week from Order View + remote overlay.
 * Never persists cached/hydrated state \u2014 loading is not a save.
 * @param {{ persist?: boolean, full?: boolean }} [opts]
 */
export async function loadStateFromOrderView({ persist = false, full = false } = {}) {
  // Paint the live week as soon as Order View returns; past weeks can land after.
  const feedPromise = fetchThisWeekFromOrderView({ full });
  const pastPromise = loadPastWeeksRemote();
  const { thisWeek, archivedWeek } = await feedPromise;
  const existingPast = (state?.weeks || []).filter((w) => w.id !== THIS_WEEK_ID);
  state = {
    version: 7,
    live: true,
    weeks: [thisWeek, ...existingPast],
  };
  writeLiveWeekCache(thisWeek);
  overlayDirty = false;
  if (persist) persistOverlayOnly({ flush: true });
  notifyListeners();

  const past = await pastPromise;
  const mergedPast = mergePastWeeks(past, archivedWeek);
  if (archivedWeek?.id) {
    await savePastWeeksRemote(mergedPast);
  }
  const live = getThisWeek() || thisWeek;
  state = {
    version: 7,
    live: true,
    weeks: [live, ...mergedPast],
  };
  notifyListeners();
  return state;
}

/** Load one core branch’s Order View data into the live week (on expand). */
export async function ensureBranchLoaded(branch, { remember = true } = {}) {
  if (!branch || !CORE_BRANCHES.includes(branch)) return state;
  if (isBranchFeedLoaded(branch)) return state;
  if (remember) saveLastOpenLoc(branch);
  const thisWeek = await ensureBranchFeed(branch);
  if (!thisWeek || !state) return state;
  const past = (state.weeks || []).filter((w) => w.id !== THIS_WEEK_ID);
  state = { ...state, weeks: [thisWeek, ...past] };
  notifyListeners();
  return state;
}

/** Refetch one branch after forecast controls change. */
export async function reloadBranchLoaded(branch) {
  if (!branch || !CORE_BRANCHES.includes(branch)) return state;
  saveLastOpenLoc(branch);
  const thisWeek = await reloadBranchFeed(branch);
  if (!thisWeek || !state) return state;
  const past = (state.weeks || []).filter((w) => w.id !== THIS_WEEK_ID);
  state = { ...state, weeks: [thisWeek, ...past] };
  notifyListeners();
  return state;
}

/** Warm remaining core branches after first paint (non-blocking). */
export async function warmRemainingBranches() {
  const pending = pendingCoreBranches();
  for (const branch of pending) {
    try {
      await ensureBranchLoaded(branch, { remember: false });
    } catch (err) {
      console.warn('Could not warm purchasing branch', branch, err);
    }
  }
  return state;
}

export { loadLastOpenLoc, saveLastOpenLoc, isBranchFeedLoaded, CORE_BRANCHES };

function persistOverlayOnly({ flush = false } = {}) {
  if (applyingRemote) return Promise.resolve();
  const week = getThisWeek();
  if (!week) return Promise.resolve();
  overlayDirty = true;
  return Promise.resolve(saveOverlay(extractOverlayFromWeek(week), { flush })).then(
    (result) => {
      if (flush && result) overlayDirty = false;
      return result;
    }
  );
}

function persistPastWeeks() {
  const past = (state?.weeks || []).filter((w) => w.id !== THIS_WEEK_ID);
  return savePastWeeksRemote(past).catch((err) =>
    console.warn('Could not persist past purchasing weeks', err)
  );
}

export function persist() {
  const savePromise = persistOverlayOnly();
  const editingPast = (state?.weeks || []).some(
    (w) => w.id !== THIS_WEEK_ID && w.status !== 'settled'
  );
  if (editingPast) persistPastWeeks();
  notifyListeners();
  return savePromise;
}

/** Flush debounced Firebase writes (e.g. before unload). Only when dirty. */
export function flushPersist() {
  if (overlayDirty || hasPendingOverlaySave()) {
    persistOverlayOnly({ flush: true });
  }
  persistPastWeeks();
}

/** Clear live plan edits (Firebase + local cache) and reload from Order View. */
export async function clearThisWeekPlan() {
  try {
    localStorage.removeItem(OVERLAY_KEY);
  } catch (_) {
    /* ignore */
  }
  const thisWeek = getThisWeek();
  await clearLiveOverlay(thisWeek?.weekStart || null, thisWeek?.weekEnd || null);
  overlayDirty = false;
  await loadStateFromOrderView({ persist: false });
  return state;
}

/** @deprecated use clearThisWeekPlan */
export async function resetDemo() {
  return clearThisWeekPlan();
}

/**
 * Apply a remote liveOverlay snapshot (other browser’s edits).
 * If this tab has dirty local edits, merge local + remote instead of replacing
 * (including echoes of our own writes that raced with newer local edits).
 */
export async function applyRemoteOverlay(overlay, { isEcho = false } = {}) {
  if (!state) return null;
  applyingRemote = true;
  try {
    let toApply = overlay;
    if (overlayDirty) {
      const week = getThisWeek();
      const local = week ? extractOverlayFromWeek(week) : null;
      if (local) {
        toApply = mergeOverlays(getAckedOverlay() || {}, local, overlay);
      }
      // Keep dirty \u2014 still need to push if we have unacked local edits.
      // Echo of an older write must not clear dirty or drop newer local adds.
      if (isEcho) {
        setAckedOverlay(overlay);
      }
    } else if (!isEcho) {
      setAckedOverlay(overlay);
      cancelPendingOverlaySave();
      overlayDirty = false;
    } else {
      setAckedOverlay(overlay);
      if (!hasPendingOverlaySave()) overlayDirty = false;
    }

    const rebuilt = await rebuildWeekFromRemoteOverlay(toApply);
    if (!rebuilt?.thisWeek) return null;
    const past = (state.weeks || []).filter((w) => w.id !== THIS_WEEK_ID);
    state = {
      ...state,
      fromCache: false,
      weeks: [rebuilt.thisWeek, ...past],
    };
    writeLiveWeekCache(rebuilt.thisWeek);
    notifyListeners();

    if (overlayDirty && !isEcho) {
      applyingRemote = false;
      await persistOverlayOnly({ flush: true });
    }
    return state;
  } finally {
    applyingRemote = false;
  }
}

/** Start Firestore listener for shared live overlay. */
export function startLiveOverlaySync() {
  if (liveOverlayUnsub) return liveOverlayUnsub;
  liveOverlayUnsub = subscribeLiveOverlay((overlay, meta = {}) => {
    applyRemoteOverlay(overlay, meta).catch((err) =>
      console.warn('Could not apply remote purchasing overlay', err)
    );
  });
  return liveOverlayUnsub;
}

export function stopLiveOverlaySync() {
  if (liveOverlayUnsub) {
    liveOverlayUnsub();
    liveOverlayUnsub = null;
  }
}

export function getWeek(id) {
  if (!state?.weeks) return null;
  const target = id || THIS_WEEK_ID;
  return state.weeks.find((w) => w.id === target) || null;
}

export function getThisWeek() {
  return getWeek(THIS_WEEK_ID);
}

export function pastWeeks() {
  if (!state?.weeks) return [];
  return state.weeks
    .filter((w) => w.id !== THIS_WEEK_ID)
    .sort((a, b) => {
      const aOpen = a.status !== 'settled' ? 0 : 1;
      const bOpen = b.status !== 'settled' ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return String(b.weekStart || '').localeCompare(String(a.weekStart || ''));
    });
}

export function isThisWeek(week) {
  return week?.id === THIS_WEEK_ID;
}

/** Live plan week or unfinished archived snapshot. */
export function canEditPlan(week) {
  return !!week && week.status !== 'settled';
}

export function canActOnWeek(week) {
  return !!week && ['draft', 'ordered'].includes(week.status);
}

function applyUnitRateToLine(line, unitRate) {
  if (unitRate == null || unitRate <= 0) return;
  line.unitRate = unitRate;
  if (line.qty > 0) {
    line.estimatedCost = Math.round(line.qty * unitRate);
    line.costSet = true;
  }
}

export function updateLine(weekId, lineId, patch, { propagateRate = false, savePrefs = false } = {}) {
  const week = getWeek(weekId);
  if (!week || !canEditPlan(week)) return null;
  const line = week.lines.find((l) => l.id === lineId);
  if (!line || line.frozen || line.status !== 'planned') return null;

  if (patch.qty != null && patch.qtyEdited === undefined) {
    const suggested = line.suggestedQty;
    patch.qtyEdited =
      suggested != null ? Number(patch.qty) !== Number(suggested) : true;
  }
  if (patch.estimatedCost != null && patch.costSet === undefined) {
    patch.costSet = true;
  }

  const qtyChanging = patch.qty != null;
  const unitRateChanging = patch.unitRate != null;

  Object.assign(line, patch);

  if (qtyChanging && !unitRateChanging) {
    const rate = lineUnitRate(line) ?? line.lastPaidRate;
    if (rate != null && rate > 0) {
      const recalc = recalcLineCost({ ...line, unitRate: rate }, 'qty');
      line.unitRate = recalc.unitRate;
      line.estimatedCost = recalc.estimatedCost;
      line.costSet = true;
    }
  } else if (unitRateChanging && line.unitRate > 0 && line.qty > 0) {
    line.estimatedCost = Math.round(line.qty * line.unitRate);
    line.costSet = true;
  }

  if (propagateRate && line.itemId && line.unitRate > 0) {
    applyRateToSiblings(week, line);
  }

  persist();
  if (savePrefs) {
    saveLinePrefs(line);
  }
  return line;
}

function saveLinePrefs(line) {
  if (line.itemId) {
    savePrefsFromLine(line).catch(() => {});
  } else {
    savePrefsFromCustomLine(line).catch(() => {});
  }
}

function applyRateToSiblings(week, source) {
  const rate = lineUnitRate(source);
  if (rate == null) return;
  source.unitRate = rate;
  source.costSet = true;
  for (const sibling of week.lines) {
    if (!siblingSharesRate(source, sibling)) continue;
    applyUnitRateToLine(sibling, rate);
  }
}

function applyExistingRateToLine(week, line) {
  if (!line.itemId) return;
  // Keep an explicit rate the user (or modal) already set.
  if (line.unitRate != null && Number(line.unitRate) > 0) {
    if (line.qty > 0 && !(Number(line.estimatedCost) > 0)) {
      applyUnitRateToLine(line, Number(line.unitRate));
    }
    return;
  }
  const sibling = week.lines.find(
    (l) =>
      siblingSharesRate(line, l) &&
      l.qty > 0 &&
      (lineUnitRate(l) != null || l.estimatedCost > 0)
  );
  const rate =
    (sibling ? lineUnitRate(sibling) : null) ??
    line.lastPaidRate;
  if (rate) applyUnitRateToLine(line, rate);
}

export function setBuffer() {
  return null;
}

/** Fully remove a line from the week (custom/budget adds). */
export function removeLine(weekId, lineId) {
  const week = getWeek(weekId);
  if (!week || !canEditPlan(week)) return null;
  const idx = week.lines.findIndex((l) => l.id === lineId);
  if (idx < 0) return null;
  const line = week.lines[idx];
  if (line.frozen || line.status !== 'planned') return null;
  week.lines.splice(idx, 1);
  persist();
  return line;
}

export function setLineOnPlan(weekId, lineId, onPlan) {
  const week = getWeek(weekId);
  if (!week || !canEditPlan(week)) return null;
  const line = week.lines.find((l) => l.id === lineId);
  if (!line || line.frozen || line.status !== 'planned') return null;

  // Custom / budget adds are not Inventory suggestions \u2014 remove means delete.
  if (!onPlan && isManualPlanLine(line)) {
    return removeLine(weekId, lineId);
  }

  line.onPlan = onPlan;
  persist();
  return line;
}

export function addLine(weekId, lineData) {
  const week = getWeek(weekId);
  if (!week || !canEditPlan(week)) return null;
  if (lineData.itemId) applyExistingRateToLine(week, lineData);
  if (lineData.unitRate > 0 && lineData.qty > 0 && !lineData.estimatedCost) {
    lineData.estimatedCost = Math.round(lineData.qty * lineData.unitRate);
    lineData.costSet = true;
  }
  week.lines.push(lineData);
  persist();
  saveLinePrefs(lineData);
  return lineData;
}

export function setLineStatus(weekId, lineId, status) {
  const week = getWeek(weekId);
  if (!week || week.status === 'settled') return null;
  if (!['planned', 'ordered', 'delivered'].includes(status)) return null;
  const line = week.lines.find((l) => l.id === lineId);
  if (!line || !line.onPlan) return null;
  line.status = status;
  line.frozen = status !== 'planned';
  syncWeekFulfillment(week);
  persist();
  if (status === 'ordered' || status === 'delivered') {
    saveLinePrefs(line);
  }
  return line;
}

export function setLinesStatus(weekId, lineIds, status) {
  const week = getWeek(weekId);
  if (!week || week.status === 'settled') return 0;
  if (!['planned', 'ordered', 'delivered'].includes(status)) return 0;
  const idSet = new Set(lineIds);
  let n = 0;
  for (const line of week.lines) {
    if (!idSet.has(line.id) || !line.onPlan) continue;
    line.status = status;
    line.frozen = status !== 'planned';
    n += 1;
    if (status === 'ordered' || status === 'delivered') {
      saveLinePrefs(line);
    }
  }
  if (n) {
    syncWeekFulfillment(week);
    persist();
  }
  return n;
}

function syncWeekFulfillment(week) {
  const locked = week.lines.some((l) => l.onPlan && isLockedStatus(l.status));
  if (locked) {
    if (week.status === 'draft') week.status = 'ordered';
    if (!week.released) week.released = weekTotal(week);
  } else if (week.status === 'ordered') {
    week.status = 'draft';
    week.released = 0;
  }
  refreshSpent(week);
}

function refreshSpent(week) {
  const { bought, offPlan } = spentBuckets(week);
  week.spent =
    bought.reduce((s, l) => s + (l.actualCost ?? l.estimatedCost ?? 0), 0) +
    offPlan.reduce((s, e) => s + (e.amount || 0), 0);
}

export function settleWeek(weekId) {
  const week = getWeek(weekId);
  if (!week || week.status !== 'ordered') return null;
  const released = week.released || weekTotal(week);
  const spent = Number(week.spent) || 0;
  const balance = released - spent - (Number(week.returned) || 0);
  week.released = released;
  week.returned = Math.max(0, balance);
  week.status = 'settled';
  week.settledAt = new Date().toISOString();
  persist();
  if (week.id !== THIS_WEEK_ID) persistPastWeeks();
  return week;
}

function syncLinkedExpenseIds(line) {
  line.linkedExpenseIds = (line.linkedExpenseLinks || []).map((l) => l.id).filter(Boolean);
}

function resumActualCost(line) {
  const links = line.linkedExpenseLinks || [];
  if (!links.length) {
    line.actualCost = null;
    return;
  }
  line.actualCost = links.reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

/** Ensure linkedExpenseLinks exists; migrate from linkedExpenseIds if needed. */
export function ensureLinkedExpenseLinks(line) {
  if (!line) return [];
  const links = Array.isArray(line.linkedExpenseLinks) ? line.linkedExpenseLinks.filter((l) => l?.id) : [];
  const ids = Array.isArray(line.linkedExpenseIds) ? line.linkedExpenseIds.filter(Boolean) : [];
  if (links.length) {
    line.linkedExpenseLinks = links;
    syncLinkedExpenseIds(line);
    resumActualCost(line);
    return line.linkedExpenseLinks;
  }
  if (!ids.length) {
    line.linkedExpenseLinks = [];
    return [];
  }
  line.linkedExpenseLinks = ids.map((id, i) => ({
    id,
    amount: i === 0 && line.actualCost != null ? Number(line.actualCost) || 0 : 0,
    date: '',
    supplierName: '',
    branch: '',
    paidBy: '',
    allocation: '',
    hasReceiptImage: false,
  }));
  syncLinkedExpenseIds(line);
  resumActualCost(line);
  return line.linkedExpenseLinks;
}

/** Snapshot fields needed to verify the right expense on Reconcile rows. */
function expenseLinkSnapshot(expense, amount) {
  return {
    id: expense.id,
    amount: Number(amount) || 0,
    date: expense.date || '',
    supplierName: expense.supplierName || '',
    branch: String(expense.branch || expense.eventName || '').trim(),
    paidBy: String(expense.paidBy || '').trim(),
    allocation: String(expense.allocation || '').trim(),
    hasReceiptImage: Boolean(expense.hasReceiptImage || expense.receiptImage),
  };
}

/** Fill missing link snapshots from loaded expenses (date/supplier/amount/branch/paidBy). */
export function hydrateLinkedExpenseLinks(line, expenses) {
  ensureLinkedExpenseLinks(line);
  if (!expenses?.length || !line.linkedExpenseLinks?.length) return line.linkedExpenseLinks;
  const byId = new Map(expenses.map((e) => [e.id, e]));
  line.linkedExpenseLinks = line.linkedExpenseLinks.map((link) => {
    const exp = byId.get(link.id);
    if (!exp) return link;
    const snap = expenseLinkSnapshot(exp, Number(exp.totalAmount) || Number(link.amount) || 0);
    return {
      ...snap,
      // Prefer fresh expense data; keep prior snapshot only if expense field empty
      branch: snap.branch || link.branch || '',
      paidBy: snap.paidBy || link.paidBy || '',
      allocation: snap.allocation || link.allocation || '',
    };
  });
  syncLinkedExpenseIds(line);
  resumActualCost(line);
  return line.linkedExpenseLinks;
}

export function hydrateWeekExpenseLinks(weekId, expenses) {
  const week = getWeek(weekId);
  if (!week) return;
  for (const line of week.lines || []) {
    hydrateLinkedExpenseLinks(line, expenses);
  }
  persist();
  if (week.id !== THIS_WEEK_ID) persistPastWeeks();
}

/** Link an expense to a plan line (works on ordered/delivered / frozen lines). */
export function linkLineToExpense(weekId, lineId, expense, { actualCost = null } = {}) {
  const week = getWeek(weekId);
  if (!week || week.status === 'settled') return null;
  const line = week.lines.find((l) => l.id === lineId);
  if (!line || !line.onPlan) return null;
  ensureLinkedExpenseLinks(line);
  const amount =
    actualCost != null
      ? Number(actualCost)
      : Number(expense.totalAmount) || lineAmount(line);
  const snap = expenseLinkSnapshot(expense, amount);
  const idx = line.linkedExpenseLinks.findIndex((l) => l.id === expense.id);
  if (idx >= 0) line.linkedExpenseLinks[idx] = snap;
  else line.linkedExpenseLinks.push(snap);
  syncLinkedExpenseIds(line);
  resumActualCost(line);
  if (line.status === 'planned') {
    line.status = 'delivered';
    line.frozen = true;
    syncWeekFulfillment(week);
  }
  refreshSpent(week);
  persist();
  return line;
}

export function unlinkLineExpense(weekId, lineId, expenseId = null) {
  const week = getWeek(weekId);
  if (!week || week.status === 'settled') return null;
  const line = week.lines.find((l) => l.id === lineId);
  if (!line) return null;
  ensureLinkedExpenseLinks(line);
  if (expenseId) {
    line.linkedExpenseLinks = (line.linkedExpenseLinks || []).filter((l) => l.id !== expenseId);
  } else {
    line.linkedExpenseLinks = [];
  }
  syncLinkedExpenseIds(line);
  resumActualCost(line);
  refreshSpent(week);
  persist();
  return line;
}

/** Record an expense that was bought but not on the budget. */
export function addOffPlanExpense(weekId, entry) {
  const week = getWeek(weekId);
  if (!week || week.status === 'settled') return null;
  if (!week.offPlanExpenses) week.offPlanExpenses = [];
  const row = {
    id: entry.id || `off-${Date.now()}`,
    date: entry.date || new Date().toISOString().slice(0, 10),
    supplierName: entry.supplierName || '',
    location: entry.location || '',
    amount: Number(entry.amount) || 0,
    reason: entry.reason || '',
    expenseId: entry.expenseId || null,
  };
  week.offPlanExpenses.push(row);
  refreshSpent(week);
  persist();
  return row;
}

export function removeOffPlanExpense(weekId, offPlanId) {
  const week = getWeek(weekId);
  if (!week || week.status === 'settled') return null;
  week.offPlanExpenses = (week.offPlanExpenses || []).filter((e) => e.id !== offPlanId);
  refreshSpent(week);
  persist();
  return week;
}

export function getPriorWeekTotal(week) {
  if (!state?.weeks) return null;
  const settled = state.weeks
    .filter((w) => w.status === 'settled' && w.id !== week.id)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  if (settled.length) return weekTotal(settled[0]);
  return null;
}
