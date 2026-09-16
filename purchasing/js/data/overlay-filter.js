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

/** True when a week snapshot has at least one on-plan budget line. */
export function weekHasOnPlanBudget(week) {
  return (week?.lines || []).some((l) => l && l.onPlan);
}

/**
 * Prefer an existing non-empty past week over an empty archive write.
 * Prevents Fri rollover from clobbering a real week with lines:[] / onPlan:false.
 */
export function preferNonEmptyPastWeek(existing, incoming) {
  if (!incoming?.id) return existing || null;
  if (!existing?.id || existing.id !== incoming.id) return incoming;
  const existingHas = weekHasOnPlanBudget(existing);
  const incomingHas = weekHasOnPlanBudget(incoming);
  if (existingHas && !incomingHas) return existing;
  return incoming;
}
