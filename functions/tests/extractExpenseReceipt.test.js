/**
 * Unit tests for receipt extraction normalizers (no Gemini network calls).
 * Run: node tests/extractExpenseReceipt.test.js
 */
const assert = require('assert');
const {
  normalizeParsed,
  coerceReceiptDateYear,
  normalizeDate,
  stripDataUrl,
  detectMimeType
} = require('../extractExpenseReceipt');

const FIXED_NOW = new Date(2026, 6, 23); // Jul 23, 2026 local

function testNormalizeParsedHappyPath() {
  const parsed = normalizeParsed(
    {
      supplierName: '  Matcha Store  ',
      tin: '123456789012',
      invoiceNumber: 'OR-1001',
      date: '07/22/2026',
      totalAmount: '100.00',
      vatExemptAmount: 0,
      suggestedCategory: 'Supplies',
      items: [
        { name: 'Milk', quantity: 2, price: 50, total: 100 },
        { name: '  ', quantity: 1, price: 1 }
      ],
      printedVat: { vatableSale: 89.29, vatAmount: 10.71 }
    },
    FIXED_NOW
  );

  assert.strictEqual(parsed.supplierName, 'Matcha Store');
  assert.strictEqual(parsed.tin, '123-456-789-012');
  assert.strictEqual(parsed.invoiceNumber, 'OR-1001');
  assert.strictEqual(parsed.date, '2026-07-22');
  assert.strictEqual(parsed.totalAmount, 100);
  assert.strictEqual(parsed.suggestedCategory, 'Supplies');
  assert.strictEqual(parsed.items.length, 1);
  assert.strictEqual(parsed.items[0].name, 'Milk');
  assert.strictEqual(parsed.printedVat.vatAmount, 10.71);
}

function testNormalizeParsedDropsUnreconciledItems() {
  const parsed = normalizeParsed({
    totalAmount: 500,
    items: [{ name: 'A', quantity: 1, price: 10, total: 10 }]
  });
  assert.strictEqual(parsed.items.length, 0);
  assert.strictEqual(parsed.totalAmount, 500);
}

function testNormalizeParsedEmpty() {
  const parsed = normalizeParsed(null);
  assert.strictEqual(parsed.supplierName, '');
  assert.strictEqual(parsed.totalAmount, 0);
  assert.deepStrictEqual(parsed.items, []);
}

function testEuropeanDayFirstDate() {
  const parsed = normalizeParsed({ date: '22/07/2026' }, FIXED_NOW);
  assert.strictEqual(parsed.date, '2026-07-22');
}

function testWrongYearForcedToCurrent() {
  // OCR misread year as 2025 mid-year → force 2026
  assert.strictEqual(coerceReceiptDateYear('2025-07-20', FIXED_NOW), '2026-07-20');
  assert.strictEqual(coerceReceiptDateYear('2024-07-20', FIXED_NOW), '2026-07-20');
  assert.strictEqual(normalizeDate('07/20/2025', FIXED_NOW), '2026-07-20');
}

function testPreviousYearKeptWithinLookback() {
  const earlyJan = new Date(2026, 0, 10); // Jan 10, 2026
  assert.strictEqual(coerceReceiptDateYear('2025-12-15', earlyJan), '2025-12-15');
  // Old previous-year date outside ~3 months → force current year; March is still
  // far future from Jan 10 so final clamp uses today.
  assert.strictEqual(coerceReceiptDateYear('2025-03-01', earlyJan), '2026-01-10');
  // Same forced past date mid-year stays on the forced current-year day.
  assert.strictEqual(coerceReceiptDateYear('2025-03-01', FIXED_NOW), '2026-03-01');
}

function testCurrentYearUnchanged() {
  assert.strictEqual(coerceReceiptDateYear('2026-07-22', FIXED_NOW), '2026-07-22');
}

function testFutureDateClampedToToday() {
  const midSep = new Date(2026, 8, 11); // Sep 11, 2026
  // Current-year far-future (permit / misread month) → today
  assert.strictEqual(coerceReceiptDateYear('2026-11-05', midSep), '2026-09-11');
  // Old year forced into far-future current year → today
  assert.strictEqual(coerceReceiptDateYear('2024-11-05', midSep), '2026-09-11');
  // Within 7-day slack stays
  assert.strictEqual(coerceReceiptDateYear('2026-09-15', midSep), '2026-09-15');
}

function testSolaireStyleRestaurantVat() {
  // Mimics bad OCR: Meals = VATable net only; total missing VAT; exempt 0
  const parsed = normalizeParsed(
    {
      supplierName: 'Sureste Properties Inc.',
      date: '04/18/2024',
      totalAmount: 7784.79,
      vatExemptAmount: 0,
      items: [
        { name: 'Meals', quantity: 1, price: 6955.36, total: 6955.36 },
        { name: 'Service charge', quantity: 1, price: 695.54, total: 695.54 },
        { name: 'Local Tax', quantity: 1, price: 133.89, total: 133.89 }
      ],
      printedVat: { vatableSale: 6955.36, vatAmount: 834.64 }
    },
    FIXED_NOW
  );

  assert.strictEqual(parsed.date, '2026-04-18'); // year coerced
  assert.strictEqual(parsed.items.find((i) => i.name === 'Meals').total, 7790);
  assert.strictEqual(parsed.vatExemptAmount, 829.43); // SC + local tax
  assert.strictEqual(parsed.totalAmount, 8619.43);
  // Form VAT math: (8619.43 - 829.43) / 1.12 ≈ 6955.36
  const taxable = parsed.totalAmount - parsed.vatExemptAmount;
  assert.ok(Math.abs(taxable / 1.12 - 6955.36) < 0.02);
}

testNormalizeParsedHappyPath();
testNormalizeParsedDropsUnreconciledItems();
testNormalizeParsedEmpty();
testEuropeanDayFirstDate();
testWrongYearForcedToCurrent();
testPreviousYearKeptWithinLookback();
testCurrentYearUnchanged();
testFutureDateClampedToToday();
testSolaireStyleRestaurantVat();

function testStripAndDetectPdfMime() {
  const pdfData = 'data:application/pdf;base64,JVBERi0x';
  assert.strictEqual(stripDataUrl(pdfData), 'JVBERi0x');
  assert.strictEqual(detectMimeType(pdfData), 'application/pdf');
  assert.strictEqual(detectMimeType('raw', 'application/pdf'), 'application/pdf');
  assert.strictEqual(
    stripDataUrl('data:image/jpeg;base64,abc'),
    'abc'
  );
}

testStripAndDetectPdfMime();
console.log('extractExpenseReceipt tests passed');
