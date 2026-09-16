/**
 * Run: node purchasing/js/data/order-feed-overlay.test.js
 */
import assert from 'node:assert/strict';
import {
  overlayKeepsLine,
  shouldIncludeOrderViewRow,
  overlayHasPlanEdits,
  overlayHasOnPlanBudget,
  isManualPlanLine,
  shouldArchiveOverlayForLiveWeek,
  hasFrozenPlanMetrics,
  shouldFreezePlanMetrics,
  weekHasOnPlanBudget,
  preferNonEmptyPastWeek,
} from './overlay-filter.js?v=96';

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`fail  ${name}`);
    console.error(err);
  }
}

test('leftover suggested overlay does not keep a zero-order row after stock catches up', () => {
  const leftover = {
    onPlan: false,
    costSet: true,
    estimatedCost: 1200,
    qty: 0,
    suggestedQty: 0,
    status: 'planned',
  };
  assert.equal(overlayKeepsLine(leftover), false);
  assert.equal(
    shouldIncludeOrderViewRow({ suggested: 0, needsCount: false }, leftover),
    false
  );
});

test('on-plan lines stay even when suggested order is now 0', () => {
  const onPlan = { onPlan: true, qty: 200, suggestedQty: 0, status: 'planned' };
  assert.equal(overlayKeepsLine(onPlan), true);
  assert.equal(shouldIncludeOrderViewRow({ suggested: 0 }, onPlan), true);
});

test('live suggestions and missing counts still appear', () => {
  assert.equal(shouldIncludeOrderViewRow({ suggested: 50 }, null), true);
  assert.equal(shouldIncludeOrderViewRow({ suggested: 0, needsCount: true }, null), true);
});

test('auto cost on suggested rows is not plan work worth archiving', () => {
  assert.equal(
    overlayHasPlanEdits({
      weekStatus: 'draft',
      lines: { 'hojicha|podium': { onPlan: false, costSet: true, estimatedCost: 900 } },
    }),
    false
  );
  assert.equal(
    overlayHasPlanEdits({
      weekStatus: 'draft',
      lines: { 'matcha|podium': { onPlan: true } },
    }),
    true
  );
});

test('custom/budget adds are manual plan lines', () => {
  assert.equal(isManualPlanLine({ source: 'manual', itemId: null, onPlan: true }), true);
  assert.equal(isManualPlanLine({ kind: 'budget', itemId: null, qty: 1 }), true);
  assert.equal(isManualPlanLine({ source: 'order-view', itemId: 'matcha' }), false);
});

test('removed custom add (onPlan false) is not plan work and should not stay in Suggested', () => {
  const removed = {
    onPlan: false,
    source: 'manual',
    kind: 'budget',
    suggestedQty: 1,
    estimatedCost: 760,
    status: 'planned',
  };
  assert.equal(isManualPlanLine(removed), true);
  assert.equal(overlayKeepsLine(removed), false);
  assert.equal(
    overlayHasPlanEdits({
      weekStatus: 'draft',
      manualLines: { 'line-1': removed },
    }),
    false
  );
  assert.equal(
    overlayHasPlanEdits({
      weekStatus: 'draft',
      manualLines: { 'line-1': { ...removed, onPlan: true } },
    }),
    true
  );
});

test('manual catalog add with onPlan keeps a zero-suggested Order View row via overlay.lines', () => {
  // After remapping, catalog + Add is promoted onto overlay.lines / feed line.
  const promoted = { onPlan: true, qty: 100, status: 'planned' };
  assert.equal(shouldIncludeOrderViewRow({ suggested: 0, needsCount: false }, promoted), true);
});

test('Friday rollover archives prior week so next week can open live', () => {
  assert.equal(
    shouldArchiveOverlayForLiveWeek({
      overlayWeekStart: '2026-09-07',
      overlayWeekEnd: '2026-09-13',
      liveWeekStart: '2026-09-14',
      todayKey: '2026-09-11',
    }),
    true
  );
});

test('same live week does not archive itself', () => {
  assert.equal(
    shouldArchiveOverlayForLiveWeek({
      overlayWeekStart: '2026-09-14',
      overlayWeekEnd: '2026-09-20',
      liveWeekStart: '2026-09-14',
      todayKey: '2026-09-11',
    }),
    false
  );
});

test('metricsSnapshotted keeps Monday freeze rows in the overlay', () => {
  const snap = {
    onPlan: false,
    suggestedQty: 12,
    stockQty: 4,
    needQty: 16,
    metricsSnapshotted: true,
    status: 'planned',
  };
  assert.equal(overlayKeepsLine(snap), true);
  assert.equal(hasFrozenPlanMetrics(snap), true);
  assert.equal(hasFrozenPlanMetrics({ onPlan: true, stockQty: 1 }), true);
  assert.equal(hasFrozenPlanMetrics({ onPlan: false, costSet: true }), false);
});

test('do not freeze Monday metrics before the plan week starts (Fri\u2013Sun stay live)', () => {
  assert.equal(
    shouldFreezePlanMetrics({ weekStart: '2026-09-14', todayKey: '2026-09-12' }),
    false
  );
  assert.equal(
    shouldFreezePlanMetrics({ weekStart: '2026-09-14', todayKey: '2026-09-13' }),
    false
  );
  assert.equal(
    shouldFreezePlanMetrics({ weekStart: '2026-09-14', todayKey: '2026-09-14' }),
    true
  );
  assert.equal(
    shouldFreezePlanMetrics({ weekStart: '2026-09-14', todayKey: '2026-09-16' }),
    true
  );
});

test('weekHasOnPlanBudget detects budget lines', () => {
  assert.equal(weekHasOnPlanBudget({ lines: [{ onPlan: false }, { onPlan: true }] }), true);
  assert.equal(weekHasOnPlanBudget({ lines: [{ onPlan: false }] }), false);
  assert.equal(weekHasOnPlanBudget({ lines: [] }), false);
});

test('preferNonEmptyPastWeek refuses empty overwrite of a real week', () => {
  const existing = {
    id: 'week-2026-09-07',
    lines: [{ onPlan: true, estimatedCost: 1000 }],
  };
  const emptyIncoming = {
    id: 'week-2026-09-07',
    lines: [{ onPlan: false, estimatedCost: 1000 }],
  };
  assert.equal(preferNonEmptyPastWeek(existing, emptyIncoming), existing);
  const richer = {
    id: 'week-2026-09-07',
    lines: [
      { onPlan: true, estimatedCost: 1000 },
      { onPlan: true, estimatedCost: 500 },
    ],
  };
  assert.equal(preferNonEmptyPastWeek(existing, richer), richer);
});

test('metrics-only overlay is not archive-worthy (would create a \u20B10 past week)', () => {
  const metricsOnly = {
    weekStatus: 'draft',
    lines: {
      'matcha|podium': {
        onPlan: false,
        metricsSnapshotted: true,
        costSet: true,
        estimatedCost: 8680,
        stockQty: 10,
        needQty: 20,
        suggestedQty: 10,
      },
    },
  };
  assert.equal(overlayHasPlanEdits(metricsOnly), true);
  assert.equal(overlayHasOnPlanBudget(metricsOnly), false);
  assert.equal(weekHasOnPlanBudget({ lines: Object.values(metricsOnly.lines) }), false);
});

test('overlay with onPlan lines is archive-worthy', () => {
  const withPlan = {
    weekStatus: 'draft',
    lines: {
      'matcha|podium': { onPlan: true, estimatedCost: 1000 },
    },
    manualLines: {
      fee1: { onPlan: true, kind: 'budget', estimatedCost: 2000 },
    },
  };
  assert.equal(overlayHasOnPlanBudget(withPlan), true);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
