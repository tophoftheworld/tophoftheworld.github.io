/**
 * Run: node inventory/js/shared/forecast.test.js
 */
import assert from 'node:assert/strict';
import {
  startOfWeekMonday,
  lastCompleteWeekStart,
  lastCompleteWeekStarts,
  getDateKey,
  getIndexFromMondayForDate,
  planWeekStart,
  planWeekDates,
  sliceOfPlanWeek,
  coverageDatesForHorizon,
  coverageDatesForPlanAsOf,
  defaultHorizonForToday,
  computeProjectedNeed,
  computeSuggestedOrder,
  upliftCensoredPattern,
  pickLatestStock,
  rollForwardStock,
  countAgeDays,
  formatDateRange,
  migrateStoredHorizon,
  averageWeekdayPatterns,
  restockLookbackDates,
  suggestRestockFromUsage,
  DEFAULT_BUFFER_PCT
} from './forecast.js';

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

function keys(dates) {
  return dates.map(getDateKey);
}

test('week is Monday–Sunday; Sunday belongs to the week that started last Monday', () => {
  const sun = d('2026-08-23');
  const sat = d('2026-08-22');
  const mon = d('2026-08-24');
  assert.equal(getDateKey(startOfWeekMonday(sun)), '2026-08-17');
  assert.equal(getDateKey(startOfWeekMonday(sat)), '2026-08-17');
  assert.equal(getDateKey(startOfWeekMonday(mon)), '2026-08-24');
  assert.equal(getIndexFromMondayForDate(sun), 6);
});

test('last complete week on Sunday is still the previous Mon–Sun, not this week', () => {
  const sun = d('2026-08-23');
  assert.equal(getDateKey(lastCompleteWeekStart(sun, 1)), '2026-08-10');
  assert.equal(getDateKey(lastCompleteWeekStart(d('2026-08-24'), 1)), '2026-08-17');
});

test('Sunday Aug 23 plans next full week Aug 24–30, default entire week', () => {
  const sun = d('2026-08-23');
  assert.equal(getDateKey(planWeekStart(sun)), '2026-08-24');
  assert.equal(defaultHorizonForToday(sun), 'week');
  assert.deepEqual(keys(planWeekDates(sun)), [
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
    '2026-08-30'
  ]);
  assert.deepEqual(keys(coverageDatesForHorizon(sun, 'week')), keys(planWeekDates(sun)));
});

test('Wednesday in the current week stays on this Mon–Sun; remaining days only', () => {
  const wed = d('2026-08-19');
  assert.equal(getDateKey(planWeekStart(wed)), '2026-08-17');
  assert.deepEqual(keys(planWeekDates(wed)), [
    '2026-08-17',
    '2026-08-18',
    '2026-08-19',
    '2026-08-20',
    '2026-08-21',
    '2026-08-22',
    '2026-08-23'
  ]);
  assert.deepEqual(keys(coverageDatesForHorizon(wed, 'week')), [
    '2026-08-19',
    '2026-08-20',
    '2026-08-21',
    '2026-08-22',
    '2026-08-23'
  ]);
});

test('halves of the anchored week are Mon–Thu and Fri–Sun, never leftover Fri–Mon', () => {
  const sun = d('2026-08-23');
  const weekStart = planWeekStart(sun);
  assert.deepEqual(keys(sliceOfPlanWeek(weekStart, 'wave1')), [
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27'
  ]);
  assert.deepEqual(keys(sliceOfPlanWeek(weekStart, 'wave2')), [
    '2026-08-28',
    '2026-08-29',
    '2026-08-30'
  ]);
  assert.deepEqual(keys(coverageDatesForHorizon(sun, 'wave2')), [
    '2026-08-28',
    '2026-08-29',
    '2026-08-30'
  ]);
  assert.notEqual(formatDateRange(coverageDatesForHorizon(sun, 'week')[0], coverageDatesForHorizon(sun, 'week').at(-1)), 'Aug 23–24');
});

test('Monday also defaults to entire week of the week that just started', () => {
  const mon = d('2026-08-24');
  assert.equal(getDateKey(planWeekStart(mon)), '2026-08-24');
  assert.equal(defaultHorizonForToday(mon), 'week');
  assert.equal(coverageDatesForHorizon(mon, 'week').length, 7);
});

test('need = coverage + lead-time day, then × 1.2 buffer', () => {
  const pattern = [10, 11, 12, 13, 14, 15, 16];
  const coverage = coverageDatesForHorizon(d('2026-08-24'), 'wave1');
  const { coverageNeed, leadNeed, rawNeed, projected, leadDates } = computeProjectedNeed({
    pattern,
    coverageDates: coverage,
    leadTimeDays: 1,
    bufferPct: DEFAULT_BUFFER_PCT
  });
  assert.equal(coverageNeed, 46);
  assert.deepEqual(keys(leadDates), ['2026-08-28']);
  assert.equal(leadNeed, 14);
  assert.equal(rawNeed, 60);
  assert.equal(projected, 72);
  assert.equal(computeSuggestedOrder(72, 50), 22);
  assert.equal(computeSuggestedOrder(72, 80), 0);
});

test('suggested order never goes negative when stock covers need', () => {
  assert.equal(computeSuggestedOrder(-50, 10), 0);
  assert.equal(computeSuggestedOrder(0, 10), 0);
});

test('Wednesday entire-week need is only remaining days of this week', () => {
  const pattern = [10, 10, 10, 10, 10, 10, 10];
  const mon = computeProjectedNeed({
    pattern,
    coverageDates: coverageDatesForHorizon(d('2026-08-17'), 'week'),
    applyBuffer: false
  });
  const wed = computeProjectedNeed({
    pattern,
    coverageDates: coverageDatesForHorizon(d('2026-08-19'), 'week'),
    applyBuffer: false
  });
  assert.equal(mon.coverageNeed, 70);
  assert.equal(wed.coverageNeed, 50);
});

test('censored zero-stock days are replaced with the uncensored average', () => {
  const used = [10, 0, 10, 10, 10, 10, 10];
  const censored = [false, true, false, false, false, false, false];
  const { pattern, zeroDays, uplifted } = upliftCensoredPattern(used, censored);
  assert.equal(zeroDays, 1);
  assert.equal(uplifted, true);
  assert.equal(pattern[1], 10);
});

test('4-week average is the mean of each weekday', () => {
  const weeks = [
    [10, 10, 10, 10, 10, 10, 10],
    [20, 20, 20, 20, 20, 20, 20],
    [30, 30, 30, 30, 30, 30, 30],
    [40, 40, 40, 40, 40, 40, 40]
  ];
  assert.deepEqual(averageWeekdayPatterns(weeks), [25, 25, 25, 25, 25, 25, 25]);
  const starts = lastCompleteWeekStarts(d('2026-08-23'), 4);
  assert.deepEqual(starts.map(getDateKey), [
    '2026-08-10',
    '2026-08-03',
    '2026-07-27',
    '2026-07-20'
  ]);
});

test('latest stock prefers today opening over yesterday closing', () => {
  const picked = pickLatestStock(
    {
      '2026-08-22': { closing: { checked: true, value: 100 } },
      '2026-08-23': { opening: { checked: true, value: 80 }, added: { value: 5 } }
    },
    d('2026-08-23')
  );
  assert.equal(picked.qty, 85);
  assert.equal(picked.kind, 'opening');
  assert.equal(picked.dateKey, '2026-08-23');
});

test('stale closing is rolled forward through yesterday', () => {
  const pattern = [10, 10, 10, 10, 10, 10, 10];
  const rolled = rollForwardStock(100, pattern, d('2026-08-21'), 'closing', d('2026-08-23'));
  assert.equal(rolled, 90);
  assert.equal(countAgeDays(d('2026-08-21'), d('2026-08-23')), 2);
});

test('Friday next-week plan: full Mon–Sun coverage as of next Monday', () => {
  const fri = d('2026-09-11');
  const nextMon = planWeekStart(fri);
  assert.equal(getDateKey(nextMon), '2026-09-14');
  assert.deepEqual(keys(coverageDatesForPlanAsOf(nextMon, 'week')), [
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
    '2026-09-17',
    '2026-09-18',
    '2026-09-19',
    '2026-09-20',
  ]);
  // On Friday, calendar coverage for next week already equals the full next Mon–Sun.
  assert.deepEqual(
    keys(coverageDatesForHorizon(fri, 'week')),
    keys(coverageDatesForPlanAsOf(nextMon, 'week'))
  );
  // Mid-week this-week planning: as-of Monday keeps full week; calendar clips remaining days.
  const wed = d('2026-09-09');
  assert.deepEqual(keys(coverageDatesForPlanAsOf(d('2026-09-07'), 'week')).length, 7);
  assert.deepEqual(keys(coverageDatesForHorizon(wed, 'week')), [
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
  ]);
});

test('Friday count rolls forward to next Monday opening through Sunday', () => {
  const pattern = [10, 10, 10, 10, 10, 10, 10];
  // Fri closing 100 → Sat/Sun usage → Mon opening 80
  const monOpening = rollForwardStock(100, pattern, d('2026-09-11'), 'closing', d('2026-09-14'));
  assert.equal(monOpening, 80);
});

test('old today/buffered storage migrates to entire week', () => {
  assert.equal(migrateStoredHorizon('week', d('2026-08-23')), 'week');
  assert.equal(migrateStoredHorizon('wave1', d('2026-08-23')), 'wave1');
  assert.equal(migrateStoredHorizon('today', d('2026-08-23')), 'week');
  assert.equal(migrateStoredHorizon('buffered', d('2026-08-24')), 'week');
});

test('restock lookback is the 14 complete days ending yesterday', () => {
  const dates = restockLookbackDates(d('2026-09-01'), 14);
  assert.equal(dates.length, 14);
  assert.equal(getDateKey(dates[0]), '2026-08-18');
  assert.equal(getDateKey(dates[13]), '2026-08-31');
});

test('restock suggest is a 2-day supply from counted usage days', () => {
  const even = Array.from({ length: 14 }, () => ({ used: 100, hasClosingData: true }));
  assert.equal(suggestRestockFromUsage(even), 200);

  const sparse = [
    { used: 50, hasClosingData: true },
    { used: 0, hasClosingData: false },
    { used: 150, hasClosingData: true }
  ];
  assert.equal(suggestRestockFromUsage(sparse), 200);

  assert.equal(suggestRestockFromUsage([{ used: 50, hasClosingData: true }]), 100);
  assert.equal(suggestRestockFromUsage(Array.from({ length: 14 }, () => ({ used: 50 / 14, hasClosingData: true }))), 8);
  assert.equal(suggestRestockFromUsage([{ used: -20, hasClosingData: true }]), 0);
  assert.equal(suggestRestockFromUsage([{ used: 10, hasClosingData: false }]), null);
  assert.equal(suggestRestockFromUsage([]), null);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
