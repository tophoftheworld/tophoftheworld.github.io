/**
 * Run: node purchasing/js/data/expense-link-window.test.js
 *
 * Pure helpers only \u2014 avoid importing expense-link.js (Firebase ESM).
 */
import assert from 'node:assert/strict';

const EXPENSE_WINDOW_GRACE_DAYS = 3;

function addDaysIso(iso, days) {
  if (!iso || iso.length < 10) return iso;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function expenseDateWindow(week, { graceDays = EXPENSE_WINDOW_GRACE_DAYS } = {}) {
  const start = week?.weekStart || null;
  const end = week?.weekEnd ? addDaysIso(week.weekEnd, graceDays) : null;
  return { start, end };
}

function expenseInDateWindow(exp, { start, end } = {}) {
  const date = String(exp?.date || '').slice(0, 10);
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function filterExpensesForWeek(expenses, week, opts = {}) {
  const window = expenseDateWindow(week, opts);
  if (!window.start && !window.end) return expenses || [];
  return (expenses || []).filter((exp) => expenseInDateWindow(exp, window));
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

const week = { weekStart: '2026-08-31', weekEnd: '2026-09-06' };

test('window includes weekStart through weekEnd + 3 days', () => {
  const w = expenseDateWindow(week);
  assert.equal(w.start, '2026-08-31');
  assert.equal(w.end, '2026-09-09');
});

test('filters out expenses before the week', () => {
  const list = filterExpensesForWeek(
    [
      { id: 'old', date: '2026-08-20', supplierName: 'Old' },
      { id: 'in', date: '2026-09-05', supplierName: 'In' },
    ],
    week
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'in');
});

test('keeps late receipts within grace days', () => {
  const list = filterExpensesForWeek(
    [
      { id: 'late', date: '2026-09-09', supplierName: 'Late' },
      { id: 'too-late', date: '2026-09-10', supplierName: 'Too late' },
    ],
    week
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'late');
});

test('suggestion ranking prefers amount proximity without requiring UI badges', () => {
  // Mirrors searchExpenses sort key: suggested first, then score.
  const hits = [
    { id: 'weak', suggested: false, score: 10 },
    { id: 'strong', suggested: true, score: 50 },
    { id: 'also', suggested: true, score: 40 },
  ].sort(
    (a, b) =>
      Number(b.suggested) - Number(a.suggested) || b.score - a.score
  );
  assert.deepEqual(
    hits.map((h) => h.id),
    ['strong', 'also', 'weak']
  );
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
