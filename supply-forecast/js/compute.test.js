/**
 * Run: node supply-forecast/js/compute.test.js
 */
import assert from 'node:assert/strict';
import {
  enabledDays,
  totalCups,
  needForDay,
  needMatrix,
  formatQty,
  formatNumber,
  formatCups,
  formatPack,
  formatNeed,
  packCount,
  weekStartFromPickedDate,
  datesForWeek,
  toDateKey,
  formatShortDate,
  formatDateLong,
  formatWeekdayLong,
  formatWeekRange,
  matchaGramsPerCup,
  allocateDayNeed,
  needMatrixFromState,
  milkMixRows,
  milkPctSum,
  levelPctSum,
  mixPctSum,
  pctFromCups,
  weekMixCups,
  revenueForDay,
  revenueMatrixFromState,
  addonRevenueForDay,
  formatMoney,
  menuMixRows,
  applyBufferedQty,
  totalColumnQty,
  formatQtyTotal,
  formatNeedTotal,
  buildForecastSnapshot,
  forecastSnapshotFilename,
} from './compute.js';
import { defaultDays, defaultState, normalizeNeedBufferPct, MILK_LINE_ID } from './defaults.js';
import { normalizeState, normalizeDrinkLines } from './store.js';

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

test('default days Wed–Sun enabled', () => {
  const days = defaultDays();
  assert.equal(days.length, 7);
  assert.deepEqual(
    days.filter((d) => d.enabled).map((d) => d.id),
    ['wed', 'thu', 'fri', 'sat', 'sun']
  );
});

test('default state has milk role and milkMix', () => {
  const s = defaultState();
  assert.ok(s.weekStart);
  assert.ok(s.eventId);
  assert.equal(s.ingredients.filter((i) => i.role === 'milk').length, 2);
  assert.equal(milkPctSum(s.milkMix), 100);
  assert.equal(s.ingredients.find((i) => i.id === 'oatside').role, 'milk');
  assert.equal(s.drinkMix[0].price, 0);
});

test('needForDay multiplies cups × qtyPerCup', () => {
  assert.equal(needForDay(150, { qtyPerCup: 4 }), 600);
});

test('enabledDays drops disabled; totalCups sums enabled only', () => {
  const days = defaultDays().map((d) => {
    if (d.id === 'wed') return { ...d, cups: 150 };
    if (d.id === 'thu') return { ...d, cups: 200 };
    return d;
  });
  assert.equal(enabledDays(days).length, 5);
  assert.equal(totalCups(days), 350);
});

test('needMatrix legacy still works', () => {
  const days = defaultDays().map((d) => ({ ...d, cups: d.id === 'wed' ? 100 : 0 }));
  const matrix = needMatrix(days, [{ id: 'x', qtyPerCup: 4, name: 'X', unit: 'g' }]);
  assert.equal(matrix.rows[0].byDay[0], 400);
});

test('matchaGramsPerCup from level mix', () => {
  assert.equal(matchaGramsPerCup({ l1: 100, l2: 0, l3: 0 }), 4);
  assert.equal(matchaGramsPerCup({ l1: 50, l2: 50, l3: 0 }), 5);
});

test('allocateDayNeed applies milkMix and matcha levels', () => {
  const state = defaultState();
  state.milkMix = [
    { ingredientId: 'dairy', pct: 30 },
    { ingredientId: 'oatside', pct: 70 },
  ];
  state.levelMix = { l1: 100, l2: 0, l3: 0 };
  const need = allocateDayNeed(100, state);
  assert.equal(need.matcha, 400);
  assert.ok(Math.abs(need.oatside - 100 * 130 * 0.7) < 1e-6);
  assert.ok(Math.abs(need.dairy - 100 * 130 * 0.3) < 1e-6);
});

test('allocateDayNeed splits 50/50 by pct', () => {
  const state = defaultState();
  state.drinks.push({
    id: 'hojicha',
    name: 'Hojicha',
    lines: [{ ingredientId: 'matcha', qtyPerCup: 4 }],
  });
  state.menuDrinkIds = ['signature-latte', 'hojicha'];
  state.drinkMix = [
    { drinkId: 'signature-latte', pct: 50, cups: 0, price: 0 },
    { drinkId: 'hojicha', pct: 50, cups: 0, price: 0 },
  ];
  state.milkMix = [
    { ingredientId: 'dairy', pct: 0 },
    { ingredientId: 'oatside', pct: 100 },
  ];
  const need = allocateDayNeed(100, state);
  assert.equal(need.matcha, 400);
  assert.equal(need.oatside, 50 * 130);
});

test('needMatrixFromState builds rows', () => {
  const state = defaultState();
  state.days = state.days.map((d) =>
    d.id === 'thu' ? { ...d, enabled: true, cups: 100 } : { ...d, enabled: false, cups: 0 }
  );
  const matrix = needMatrixFromState(state);
  assert.equal(matrix.totalCups, 100);
  assert.ok(matrix.rows.some((r) => r.ingredient.id === 'matcha' && r.total === 400));
});

test('milkMixRows and levelPctSum', () => {
  const state = defaultState();
  assert.equal(milkMixRows(state).length, 2);
  assert.equal(levelPctSum({ l1: 50, l2: 60, l3: 0 }), 110);
  assert.equal(menuMixRows(state)[0].weight, 100);
});

test('formatQty switches g to kg and ml to L at ≥ 1000', () => {
  assert.equal(formatQty(1000, 'g'), '1 kg');
  assert.equal(formatQty(19500, 'ml'), '19.5 L');
});

test('formatPack round up', () => {
  assert.equal(formatPack(87100, 6000, 'box', true), '15 boxes');
  assert.equal(formatNeed(87100, {
    unit: 'ml',
    packSize: 6000,
    packLabel: 'box',
    packRoundUp: true,
  }).pack, '15 boxes');
  assert.equal(packCount(6000, 6000), 1);
  assert.equal(formatNumber(1350), '1,350');
  assert.equal(formatCups(1350), '1,350');
});

test('formatNumber limits to 2 decimal places', () => {
  assert.equal(formatNumber(611.053), '611.05');
  assert.equal(formatNumber(12.434), '12.43');
});

test('applyBufferedQty rounds buffered totals up to whole numbers', () => {
  assert.equal(applyBufferedQty(611.053, 10), 673);
  assert.equal(applyBufferedQty(150, 10), 165);
  assert.equal(applyBufferedQty(100, 0), 100);
});

test('totalColumnQty always rounds week totals up with no decimals', () => {
  assert.equal(totalColumnQty(611.053, 0), 612);
  assert.equal(totalColumnQty(611.053, 10), 673);
  assert.equal(formatQtyTotal(12430, 'ml'), '13 L');
  assert.equal(formatQtyTotal(611.053, 'g'), '612 g');
  assert.equal(formatNeedTotal(12430, { unit: 'ml', packSize: 6000, packLabel: 'box' }).primary, '13 L');
});

test('normalizeNeedBufferPct is a whole number rounded up', () => {
  assert.equal(normalizeNeedBufferPct(10.3), 11);
  assert.equal(normalizeNeedBufferPct(10), 10);
  assert.equal(normalizeNeedBufferPct(0), 0);
  assert.equal(normalizeNeedBufferPct(-5), 0);
});

test('buildForecastSnapshot summarizes week totals only', () => {
  const state = normalizeState({
    ...defaultState(),
    eventName: 'Marquis Debut',
    eventServiceType: 'planning',
    weekStart: '2025-09-01',
    needBufferPct: 10,
    days: defaultDays().map((d, i) => ({ ...d, enabled: i >= 2 && i <= 4, cups: i === 4 ? 150 : 0 })),
  });
  const text = buildForecastSnapshot(state, { generatedAt: new Date('2026-09-01T14:00:00') });
  assert.match(text, /Marquis Debut/);
  assert.match(text, /Planning only/);
  assert.match(text, /Buffer: 10%/);
  assert.match(text, /Target cups \(week total\): 165/);
  assert.doesNotMatch(text, /Est\. revenue/);
  assert.match(text, /Ingredients/);
  assert.match(text, /Generated/);
  assert.equal(forecastSnapshotFilename(state), 'marquis-debut-2025-09-01-snapshot.png');
});

test('normalizeState migrates dairy_milk/oat_milk and oatPct', () => {
  const state = normalizeState({
    eventName: 'MMF',
    oatPct: 70,
    ingredients: [
      { id: 'matcha', name: 'Matcha', unit: 'g', role: 'matcha' },
      { id: 'dairy', name: 'Dairy milk', unit: 'ml', role: 'dairy_milk' },
      { id: 'oatside', name: 'Milk (Oatside)', unit: 'ml', role: 'oat_milk', packSize: 6000 },
    ],
    drinks: [
      {
        id: 'signature-latte',
        name: 'Signature Latte',
        lines: [
          { ingredientId: 'matcha', qtyPerCup: 4 },
          { ingredientId: 'oatside', qtyPerCup: 130 },
        ],
      },
    ],
  });
  assert.equal(state.ingredients.find((i) => i.id === 'dairy').role, 'milk');
  assert.equal(state.ingredients.find((i) => i.id === 'oatside').role, 'milk');
  assert.equal(state.milkMix.find((m) => m.ingredientId === 'oatside').pct, 70);
  assert.equal(state.milkMix.find((m) => m.ingredientId === 'dairy').pct, 30);
  const latte = state.drinks.find((d) => d.id === 'signature-latte');
  assert.deepEqual(
    latte.lines.map((l) => [l.ingredientId, l.qtyPerCup]),
    [
      ['matcha', 4],
      [MILK_LINE_ID, 130],
    ]
  );
});

test('default drink recipe uses generic Milk line', () => {
  const s = defaultState();
  assert.ok(s.drinks[0].lines.some((l) => l.ingredientId === '__milk__' && l.qtyPerCup === 130));
  assert.ok(!s.drinks[0].lines.some((l) => l.ingredientId === 'oatside' || l.ingredientId === 'dairy'));
});

test('normalizeDrinkLines keeps a new ingredient after milk', () => {
  const ingredients = [
    { id: 'matcha', role: 'matcha' },
    { id: 'sugar', role: null },
    { id: 'cream', role: null },
    { id: 'dairy', role: 'milk' },
  ];
  const lines = normalizeDrinkLines(
    [
      { ingredientId: 'matcha', qtyPerCup: 4 },
      { ingredientId: 'sugar', qtyPerCup: 6 },
      { ingredientId: MILK_LINE_ID, qtyPerCup: 130 },
      { ingredientId: 'cream', qtyPerCup: 0 },
    ],
    ingredients
  );
  assert.deepEqual(
    lines.map((l) => [l.ingredientId, l.qtyPerCup]),
    [
      ['matcha', 4],
      ['sugar', 6],
      [MILK_LINE_ID, 130],
      ['cream', 0],
    ]
  );
});

test('normalizeDrinkLines coalesces milk SKUs in place without moving later lines', () => {
  const ingredients = [
    { id: 'matcha', role: 'matcha' },
    { id: 'dairy', role: 'milk' },
    { id: 'oatside', role: 'milk' },
    { id: 'sugar', role: null },
  ];
  const lines = normalizeDrinkLines(
    [
      { ingredientId: 'matcha', qtyPerCup: 4 },
      { ingredientId: 'oatside', qtyPerCup: 100 },
      { ingredientId: 'dairy', qtyPerCup: 30 },
      { ingredientId: 'sugar', qtyPerCup: 6 },
    ],
    ingredients
  );
  assert.deepEqual(lines, [
    { ingredientId: 'matcha', qtyPerCup: 4 },
    { ingredientId: MILK_LINE_ID, qtyPerCup: 130 },
    { ingredientId: 'sugar', qtyPerCup: 6 },
  ]);
});

test('week dates snap to Monday', () => {
  assert.equal(weekStartFromPickedDate('2026-04-01'), '2026-03-30');
  const dates = datesForWeek('2026-03-30');
  assert.equal(toDateKey(dates.wed), '2026-04-01');
  assert.equal(formatShortDate(dates.wed), 'Apr 1');
  assert.equal(formatDateLong(dates.wed), 'April 1st');
  assert.equal(formatWeekdayLong(dates.wed), 'Wednesday');
  assert.match(formatWeekRange('2026-03-30'), /Mar 30/);
});

test('pctFromCups and weekMixCups stay linked', () => {
  assert.equal(weekMixCups(50, 200), 100);
  assert.equal(pctFromCups(100, 200, 0), 50);
  assert.equal(pctFromCups(25, 0, 100), 25);
});

test('revenueForDay uses price and mix', () => {
  const state = defaultState();
  state.days = state.days.map((d) => ({ ...d, cups: d.enabled ? 100 : 0 }));
  state.drinkMix = [{ drinkId: 'signature-latte', pct: 100, cups: 0, price: 250 }];
  assert.equal(revenueForDay(100, state), 25000);
  const matrix = revenueMatrixFromState(state);
  assert.ok(matrix.total > 0);
  assert.equal(formatMoney(1350), '₱1,350');
  assert.equal(formatMoney(1350.5), '₱1,350.50');
});

test('addonRevenueForDay uses milk and level mix', () => {
  const state = defaultState();
  state.addonPrices = { oat: 50, l1: 0, l2: 30, l3: 0 };
  state.milkMix = [
    { ingredientId: 'dairy', pct: 30 },
    { ingredientId: 'oatside', pct: 70 },
  ];
  state.levelMix = { l1: 0, l2: 100, l3: 0 };
  assert.equal(addonRevenueForDay(100, state), 6500);
});

test('planning events skip revenue', () => {
  const state = defaultState();
  state.eventServiceType = 'planning';
  state.drinkMix = [{ drinkId: 'signature-latte', pct: 100, cups: 0, price: 250 }];
  state.days = state.days.map((d) => ({ ...d, cups: d.enabled ? 100 : 0 }));
  assert.equal(revenueForDay(100, state), 0);
  assert.equal(menuMixRows(state)[0].totalRevenue, 0);
});

test('package service skips revenue', () => {
  const state = defaultState();
  state.eventServiceType = 'package';
  state.drinkMix = [{ drinkId: 'signature-latte', pct: 100, cups: 0, price: 250 }];
  assert.equal(revenueForDay(100, state), 0);
});

test('normalizeState migrates cups mode to pct', () => {
  const state = normalizeState({
    menuMode: 'cups',
    drinkMix: [
      { drinkId: 'signature-latte', pct: 0, cups: 30 },
      { drinkId: 'other', pct: 0, cups: 70 },
    ],
    menuDrinkIds: ['signature-latte', 'other'],
    drinks: [
      { id: 'signature-latte', name: 'A', lines: [] },
      { id: 'other', name: 'B', lines: [] },
    ],
  });
  assert.ok(Math.abs(state.drinkMix[0].pct - 30) < 0.01);
  assert.ok(Math.abs(state.drinkMix[1].pct - 70) < 0.01);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
