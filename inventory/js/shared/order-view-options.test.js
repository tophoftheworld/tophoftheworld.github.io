/**
 * Run: node inventory/js/shared/order-view-options.test.js
 */
import assert from 'node:assert/strict';
import { getDateKey, lastCompleteWeekStart, lastCompleteWeekStarts, addDays, formatDateRange } from './forecast.js';
import {
  baselineChoices,
  compactBaselineChoices,
  compactHorizonChoices,
  horizonChoices,
  loadBranchForecastOptions,
  loadBranchForecastMap,
  loadOrderViewOptions,
  replaceBranchForecastMap,
  sanitizeOrderViewOptions,
} from './order-view-options.js';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

function d(iso) {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
}

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

test('defaults match Order View: last week, entire week, 20% buffer on', () => {
  const opts = loadOrderViewOptions(d('2026-08-31'));
  assert.equal(opts.orderUsageBaseline, 'prev-week');
  assert.equal(opts.orderHorizon, 'week');
  assert.equal(opts.orderDemandBuffer, true);
});

test('usage labels include last week, 2 weeks ago, and 4-week average ranges', () => {
  const wed = d('2026-08-26');
  const choices = baselineChoices(wed);
  assert.deepEqual(
    choices.map((c) => c.value),
    ['prev-week', 'two-weeks-ago', 'rolling-avg']
  );
  const lastWeekStart = lastCompleteWeekStart(wed, 1);
  const twoAgoStart = lastCompleteWeekStart(wed, 2);
  const fourStarts = lastCompleteWeekStarts(wed, 4);
  assert.ok(choices[0].label.startsWith('Last week ('));
  assert.ok(choices[0].label.includes(formatDateRange(lastWeekStart, addDays(lastWeekStart, 6))));
  assert.ok(choices[1].label.startsWith('2 weeks ago ('));
  assert.ok(choices[1].label.includes(formatDateRange(twoAgoStart, addDays(twoAgoStart, 6))));
  assert.ok(choices[2].label.startsWith('4-week average ('));
  assert.ok(
    choices[2].label.includes(
      formatDateRange(fourStarts[fourStarts.length - 1], addDays(fourStarts[0], 6))
    )
  );
});

test('plan-for labels cover entire week and both halves of the anchored week', () => {
  const mon = d('2026-08-31');
  assert.equal(getDateKey(mon), '2026-08-31');
  const choices = horizonChoices(mon);
  assert.deepEqual(
    choices.map((c) => c.value),
    ['week', 'wave1', 'wave2']
  );
  assert.match(choices[0].label, /Entire week/);
  assert.match(choices[1].label, /Mon–Thu/);
  assert.match(choices[2].label, /Fri–Sun/);
});

test('compact labels keep the same values with shorter text', () => {
  const wed = d('2026-08-26');
  const compactB = compactBaselineChoices(wed);
  const compactH = compactHorizonChoices(wed);
  assert.deepEqual(
    compactB.map((c) => c.value),
    baselineChoices(wed).map((c) => c.value)
  );
  assert.ok(compactB[1].label.startsWith('2w ago ·'));
  assert.ok(compactH[0].label.startsWith('Week ·'));
  assert.ok(!compactH[0].label.startsWith('Entire week'));
});

test('sanitize keeps valid branch options and falls back otherwise', () => {
  const today = d('2026-08-31');
  const ok = sanitizeOrderViewOptions(
    { orderUsageBaseline: 'two-weeks-ago', orderHorizon: 'wave1', orderDemandBuffer: false },
    today
  );
  assert.equal(ok.orderUsageBaseline, 'two-weeks-ago');
  assert.equal(ok.orderHorizon, 'wave1');
  assert.equal(ok.orderDemandBuffer, false);
  const bad = sanitizeOrderViewOptions({ orderUsageBaseline: 'nope', orderHorizon: 'today' }, today);
  assert.equal(bad.orderUsageBaseline, 'prev-week');
  assert.equal(bad.orderHorizon, 'week');
  assert.equal(bad.orderDemandBuffer, true);
});

test('unset branch options fall back to global Order View defaults', () => {
  const opts = loadBranchForecastOptions('podium', d('2026-08-31'));
  assert.deepEqual(opts, loadOrderViewOptions(d('2026-08-31')));
});

test('replaceBranchForecastMap sanitizes and overwrites the shared map', () => {
  const today = d('2026-08-31');
  const before = loadBranchForecastMap();
  try {
    const next = replaceBranchForecastMap(
      {
        podium: { orderUsageBaseline: 'rolling-avg', orderHorizon: 'wave2', orderDemandBuffer: false },
        junk: { orderUsageBaseline: 'nope', orderHorizon: 'wave1' },
      },
      today
    );
    assert.equal(next.podium.orderUsageBaseline, 'rolling-avg');
    assert.equal(next.podium.orderHorizon, 'wave2');
    assert.equal(next.podium.orderDemandBuffer, false);
    assert.equal(next.junk.orderUsageBaseline, 'prev-week');
    assert.equal(next.junk.orderHorizon, 'wave1');
    assert.deepEqual(loadBranchForecastOptions('podium', today), next.podium);
  } finally {
    replaceBranchForecastMap(before, today);
  }
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
