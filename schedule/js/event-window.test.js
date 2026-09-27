import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDaysYmd,
  filterScheduleEventsForDate,
  isScheduleEventVisibleOnDate
} from './event-window.js';

const DAY = '2026-09-19';

test('addDaysYmd shifts calendar days', () => {
  assert.equal(addDaysYmd('2026-09-19', -1), '2026-09-18');
  assert.equal(addDaysYmd('2026-09-19', 1), '2026-09-20');
});

test('dated event visible before and during period, hidden after egress', () => {
  const ev = { startDate: '2026-09-20', endDate: '2026-09-21' };
  assert.equal(isScheduleEventVisibleOnDate(ev, '2026-09-18'), true); // advance booking
  assert.equal(isScheduleEventVisibleOnDate(ev, '2026-09-19'), true);
  assert.equal(isScheduleEventVisibleOnDate(ev, '2026-09-20'), true);
  assert.equal(isScheduleEventVisibleOnDate(ev, '2026-09-21'), true);
  assert.equal(isScheduleEventVisibleOnDate(ev, '2026-09-22'), true); // egress
  assert.equal(isScheduleEventVisibleOnDate(ev, '2026-09-23'), false);
});

test('undated stays selectable; archived hidden', () => {
  assert.equal(isScheduleEventVisibleOnDate({ key: 'undated' }, DAY), true);
  assert.equal(isScheduleEventVisibleOnDate({ startDate: DAY, archived: true }, DAY), false);
});

test('filterScheduleEventsForDate drops past events but keeps upcoming', () => {
  const keys = filterScheduleEventsForDate(
    [
      { key: 'past', startDate: '2026-09-01', endDate: '2026-09-10' },
      { key: 'now', startDate: '2026-09-18', endDate: '2026-09-20' },
      { key: 'soon', startDate: '2026-10-01' },
      { key: 'undated' },
      { key: 'archived', startDate: DAY, archived: true }
    ],
    DAY
  ).map((e) => e.key);
  assert.deepEqual(keys, ['now', 'soon', 'undated']);
});
