/**
 * Run: node purchasing/js/data/rate-scope.test.js
 */
import assert from 'node:assert/strict';
import { sameSupplierForRate, siblingSharesRate, rateForSupplier } from './rate-scope.js?v=96';

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

test('same supplier id matches even if names differ', () => {
  assert.equal(
    sameSupplierForRate(
      { supplierId: 'sr', supplierName: 'S&R - Shaw' },
      { supplierId: 'sr', supplierName: 'S&R Shaw' }
    ),
    true
  );
});

test('different supplier ids do not share a rate', () => {
  assert.equal(
    sameSupplierForRate(
      { supplierId: 'sr', supplierName: 'S&R - Shaw' },
      { supplierId: 'arlene', supplierName: "Arlene's Dairyhouse" }
    ),
    false
  );
});

test('unassigned names do not share a rate', () => {
  assert.equal(
    sameSupplierForRate(
      { supplierName: 'Unassigned' },
      { supplierName: 'Unassigned' }
    ),
    false
  );
});

test('sibling with same item and different supplier does not share rate', () => {
  const source = {
    id: 'a',
    itemId: 'whip',
    supplierId: 'sr',
    status: 'planned',
  };
  const other = {
    id: 'b',
    itemId: 'whip',
    supplierId: 'arlene',
    status: 'planned',
  };
  assert.equal(siblingSharesRate(source, other), false);
});

test('sibling with same item and same supplier shares rate', () => {
  const source = {
    id: 'a',
    itemId: 'whip',
    supplierId: 'sr',
    status: 'planned',
  };
  const other = {
    id: 'c',
    itemId: 'whip',
    supplierId: 'sr',
    status: 'planned',
    location: 'Uptown',
  };
  assert.equal(siblingSharesRate(source, other), true);
});

test('rateForSupplier does not leak another supplier lastPaidRate', () => {
  const pref = {
    lastPaidRate: 467,
    supplierHistory: {
      sr: { lastPaidRate: 467 },
    },
  };
  assert.equal(rateForSupplier(pref, 'sr'), 467);
  assert.equal(rateForSupplier(pref, 'arlene'), null);
  assert.equal(rateForSupplier(pref, null), 467);
});

if (failed) process.exit(1);
console.log('rate-scope tests passed');
