/**
 * Run: node pos/js/event-window.test.js
 */
import assert from 'node:assert/strict';
import { addDaysYmd, classifyDashboardEvent, filterPosSelectableEvents, groupDashboardEvents, isPosEventVisible, shouldAutoArchiveEvent } from './event-window.js';

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

const TODAY = '2026-09-18';

test('addDaysYmd stays on calendar days', () => {
  assert.equal(addDaysYmd(TODAY, -2), '2026-09-16');
  assert.equal(addDaysYmd(TODAY, 2), '2026-09-20');
});

test('shows events 2 days ago and 2 days from now', () => {
  assert.equal(isPosEventVisible({ startDate: '2026-09-16' }, TODAY), true);
  assert.equal(isPosEventVisible({ startDate: '2026-09-20' }, TODAY), true);
});

test('hides events more than 2 days ago or more than 2 days from now', () => {
  assert.equal(isPosEventVisible({ startDate: '2026-09-15' }, TODAY), false);
  assert.equal(isPosEventVisible({ startDate: '2026-09-21' }, TODAY), false);
});

test('keeps a multi-day event while it overlaps the window', () => {
  const ube = { startDate: '2026-09-18', endDate: '2026-10-04' };
  assert.equal(isPosEventVisible(ube, TODAY), true);
  assert.equal(isPosEventVisible(ube, '2026-10-06'), true);
  assert.equal(isPosEventVisible(ube, '2026-10-07'), false);
  assert.equal(isPosEventVisible(ube, '2026-09-15'), false);
});

test('undated events stay available; archived events do not', () => {
  assert.equal(isPosEventVisible({ key: 'popup-undated' }, TODAY), true);
  assert.equal(isPosEventVisible({ startDate: TODAY, archived: true }, TODAY), false);
});

test('filterPosSelectableEvents drops out-of-window popups', () => {
  const keys = filterPosSelectableEvents(
    [
      { key: 'past', startDate: '2026-09-11' },
      { key: 'now', startDate: '2026-09-18', endDate: '2026-10-04' },
      { key: 'soon', startDate: '2026-09-25' },
      { key: 'archived', startDate: TODAY, archived: true }
    ],
    TODAY
  ).map((e) => e.key);
  assert.deepEqual(keys, ['now']);
});

test('dashboard groups current, upcoming, past, and archived', () => {
  const groups = groupDashboardEvents(
    [
      { key: 'past', name: 'Wellness', startDate: '2026-09-11', endDate: '2026-09-13' },
      { key: 'now', name: 'Ube Craze', startDate: '2026-09-18', endDate: '2026-10-04' },
      { key: 'soon', name: 'Coffee Fair', startDate: '2026-09-25', endDate: '2026-09-27' },
      { key: 'later', name: 'Food Row', startDate: '2026-10-05', endDate: '2026-10-11' },
      { key: 'archived', name: 'Old Fest', startDate: TODAY, archived: true }
    ],
    TODAY
  );
  assert.deepEqual(groups.current.map((e) => e.key), ['now']);
  assert.deepEqual(groups.upcoming.map((e) => e.key), ['soon', 'later']);
  assert.deepEqual(groups.past.map((e) => e.key), ['past']);
  assert.deepEqual(groups.archived.map((e) => e.key), ['archived']);
  assert.equal(classifyDashboardEvent({ startDate: '2026-09-20' }, TODAY), 'current');
  assert.equal(classifyDashboardEvent({ startDate: '2026-09-21' }, TODAY), 'upcoming');
});

test('auto-archives events a week after their scheduled end', () => {
  assert.equal(shouldAutoArchiveEvent({ startDate: '2026-09-11', endDate: '2026-09-13' }, TODAY), false);
  assert.equal(shouldAutoArchiveEvent({ startDate: '2026-09-10', endDate: '2026-09-11' }, TODAY), true);
  assert.equal(shouldAutoArchiveEvent({ startDate: '2026-09-18', endDate: '2026-10-04' }, TODAY), false);
  assert.equal(shouldAutoArchiveEvent({ startDate: '2026-09-01', endDate: '2026-09-10' }, TODAY), true);
  assert.equal(shouldAutoArchiveEvent({ startDate: '2026-09-01', archived: true }, TODAY), false);
  assert.equal(shouldAutoArchiveEvent({ startDate: '2026-09-01', endDate: '2026-09-10', autoArchiveExempt: true }, TODAY), false);
  assert.equal(shouldAutoArchiveEvent({ key: 'undated' }, TODAY), false);
});

if (failed) process.exit(1);
console.log('All tests passed');
