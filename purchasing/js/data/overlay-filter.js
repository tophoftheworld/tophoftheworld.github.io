/** Typed-in / budget / fee lines \u2014 not Inventory Order View suggestions. */
export function isManualPlanLine(line) {
  if (!line) return false;
  if (line.source === 'manual') return true;
  if (!line.itemId) return true;
  if (line.kind === 'budget' || line.kind === 'deliveryFee') return true;
  return false;
}

/** Overlay that is real plan work \u2014 not a leftover Suggested row from an older stock snapshot. */
export function overlayKeepsLine(saved) {
  if (!saved || typeof saved !== 'object') return false;
  if (saved.onPlan) return true;
  if (saved.frozen) return true;
  if (saved.status && saved.status !== 'planned') return true;
  if (saved.actualCost != null) return true;
  if (Array.isArray(saved.linkedExpenseIds) && saved.linkedExpenseIds.length) return true;
  if (Array.isArray(saved.linkedExpenseLinks) && saved.linkedExpenseLinks.length) return true;
  // Monday-as-of metrics snapshotted for the live week (suggested rows included).
  if (saved.metricsSnapshotted) return true;
  return false;
}

/** True when overlay already holds frozen Monday stock/need/suggested. */
export function hasFrozenPlanMetrics(saved) {
  if (!saved || typeof saved !== 'object') return false;
  if (saved.metricsSnapshotted) return true;
  return (
    saved.stockQty != null ||
    saved.needQty != null ||
    (saved.suggestedQty != null && (saved.onPlan || saved.qtyEdited))
  );
}

/**
 * Freeze Monday stock/need/suggested only once the plan week has started.
 * Fri\u2013Sun (planning next week) stays live so new counts (e.g. Sat opening) refresh.
 */
export function shouldFreezePlanMetrics({ weekStart, todayKey } = {}) {
  if (!weekStart || !todayKey) return false;
  return todayKey >= weekStart;
}

export function shouldIncludeOrderViewRow(row, saved) {
  if (overlayKeepsLine(saved)) return true;
  if (row?.needsCount) return true;
  return row?.suggested != null && Number(row.suggested) > 0;
}

/**
 * Whether a dated overlay/week is still the current working week.
 * ISO dates compare lexicographically (YYYY-MM-DD).
 */
export function isoWeekStillOpen(weekEnd, todayKey) {
  return !!(weekEnd && todayKey && todayKey <= weekEnd);
}

/**
 * Archive when the live plan week has moved past the overlay's weekStart.
 * Friday rollover must freeze this week's budget and open next week.
 */
export function shouldArchiveOverlayForLiveWeek({
  overlayWeekStart,
  overlayWeekEnd,
  liveWeekStart,
  todayKey,
} = {}) {
  if (!overlayWeekStart || !liveWeekStart) return false;
  if (overlayWeekStart === liveWeekStart) return false;
  return true;
}

function addDaysKey(key, n) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + n);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Dates for the live week. The overlay's own week wins so a pending (failed)
 * rollover never relabels last week's budget as the upcoming plan week.
 */
export function resolveLiveWeekBounds({
  overlayWeekStart,
  overlayWeekEnd,
  planWeekStart,
  planWeekEnd,
} = {}) {
  if (overlayWeekStart) {
    return {
      weekStart: overlayWeekStart,
      weekEnd: overlayWeekEnd || addDaysKey(overlayWeekStart, 6),
    };
  }
  return { weekStart: planWeekStart || null, weekEnd: planWeekEnd || null };
}

/** True if overlay has any real plan work worth archiving. */
export function overlayHasPlanEdits(overlay) {
  if (!overlay || typeof overlay !== 'object') return false;
  if (overlay.weekStatus && overlay.weekStatus !== 'draft') return true;
  if (Number(overlay.released) > 0) return true;
  const manuals = overlay.manualLines || {};
  for (const snap of Object.values(manuals)) {
    if (overlayKeepsLine(snap)) return true;
  }
  for (const saved of Object.values(overlay.lines || {})) {
    if (overlayKeepsLine(saved) || saved?.qtyEdited) return true;
  }
  return false;
}

/**
 * True when a saved overlay line is real budget work (not a Monday metrics freeze).
 * qtyEdited / frozen / status / costs survive even if onPlan was dropped.
 */
export function overlayLineIsBudget(saved) {
  if (!saved || typeof saved !== 'object') return false;
  if (saved.onPlan) return true;
  if (saved.qtyEdited) return true;
  if (saved.frozen) return true;
  if (saved.status && saved.status !== 'planned') return true;
  if (saved.actualCost != null) return true;
  if (Array.isArray(saved.linkedExpenseIds) && saved.linkedExpenseIds.length) return true;
  if (Array.isArray(saved.linkedExpenseLinks) && saved.linkedExpenseLinks.length) return true;
  if (saved.kind === 'budget' || saved.kind === 'deliveryFee') return true;
  return false;
}

/**
 * True when the live overlay has at least one on-plan budget line.
 * Metrics-only snapshots must not create a \u20B10 past week on Friday rollover.
 */
export function overlayHasOnPlanBudget(overlay) {
  if (!overlay || typeof overlay !== 'object') return false;
  for (const saved of Object.values(overlay.lines || {})) {
    if (saved?.onPlan) return true;
  }
  for (const snap of Object.values(overlay.manualLines || {})) {
    if (snap?.onPlan) return true;
  }
  return false;
}

/**
 * True when the overlay has budget work worth freezing into a past week.
 * Broader than overlayHasOnPlanBudget so a dropped onPlan flag cannot skip archive.
 */
export function overlayHasArchivableBudget(overlay) {
  if (!overlay || typeof overlay !== 'object') return false;
  if (overlay.weekStatus && overlay.weekStatus !== 'draft') return true;
  if (Number(overlay.released) > 0) return true;
  for (const saved of Object.values(overlay.lines || {})) {
    if (overlayLineIsBudget(saved)) return true;
  }
  for (const snap of Object.values(overlay.manualLines || {})) {
    if (overlayLineIsBudget(snap)) return true;
  }
  return false;
}

/** True when a week snapshot has at least one on-plan budget line. */
export function weekHasOnPlanBudget(week) {
  return (week?.lines || []).some((l) => l && l.onPlan);
}

/** On-plan budget weight: total cost, then line count (stale-tab guard). */
export function weekOnPlanBudgetScore(week) {
  let cost = 0;
  let count = 0;
  for (const line of week?.lines || []) {
    if (!line?.onPlan) continue;
    count += 1;
    cost += Number(line.estimatedCost) || Number(line.actualCost) || 0;
  }
  return { cost, count };
}

/**
 * Prefer the richer past-week snapshot.
 * Empty never overwrites non-empty; when both have on-plan, higher cost wins
 * (tie: more on-plan lines). Prevents a stale tab from clobbering ₱74k with ₱40k.
 */
export function preferNonEmptyPastWeek(existing, incoming) {
  if (!incoming?.id) return existing || null;
  if (!existing?.id || existing.id !== incoming.id) return incoming;
  const existingScore = weekOnPlanBudgetScore(existing);
  const incomingScore = weekOnPlanBudgetScore(incoming);
  if (existingScore.cost > incomingScore.cost) return existing;
  if (incomingScore.cost > existingScore.cost) return incoming;
  if (existingScore.count > incomingScore.count) return existing;
  return incoming;
}

/**
 * Friday rollover may replace live only when:
 * - overlay has no archivable budget (true blank → open next week), or
 * - archivedWeek was saved and has on-plan budget.
 */
export function canReplaceLiveOverlay({ overlay, archivedWeek } = {}) {
  if (!overlayHasArchivableBudget(overlay)) return true;
  return !!(archivedWeek?.id && weekHasOnPlanBudget(archivedWeek));
}
