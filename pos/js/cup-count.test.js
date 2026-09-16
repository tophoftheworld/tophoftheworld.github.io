/**
 * Run: node pos/js/cup-count.test.js
 */
import assert from 'node:assert/strict';
import { isCupItem, countCupsInItems } from './cup-count.js';

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

const menu = {
  categories: [
    { id: 'matcha-lattes', name: 'Matcha Lattes', countsAsCup: true },
    { id: 'merch', name: 'Merch', countsAsCup: false },
    { id: 'retail-matchanese', name: 'Retail', countsAsCup: false },
    { id: 'untagged', name: 'Untagged' },
  ],
  items: [
    { categoryId: 'matcha-lattes', name: 'signature latte', countsAsCup: true },
    { categoryId: 'merch', name: 'Shirt', countsAsCup: false },
  ],
};

test('only the countsAsCup tag on the line item counts', () => {
  assert.equal(isCupItem({ name: 'Shirt', countsAsCup: true }), true);
  assert.equal(isCupItem({ name: 'signature latte', countsAsCup: false }), false);
});

test('category tag is used when the line item has no tag', () => {
  assert.equal(isCupItem({ categoryId: 'matcha-lattes' }, menu), true);
  assert.equal(isCupItem({ categoryId: 'merch' }, menu), false);
  assert.equal(isCupItem({ categoryId: 'retail-matchanese', type: 'Iced' }, menu), false);
});

test('no tag and no matching menu category is not a cup', () => {
  assert.equal(isCupItem({ name: 'signature latte' }), false);
  assert.equal(isCupItem({ categoryId: 'matcha-lattes' }), false);
  assert.equal(isCupItem({ menuItemId: 'matcha-lattes-signature-latte' }, menu), false);
  assert.equal(isCupItem({ type: 'Iced' }, menu), false);
  assert.equal(isCupItem({ categoryId: 'untagged' }, menu), false);
});

test('countCupsInItems uses the menu tags', () => {
  assert.equal(countCupsInItems([
    { categoryId: 'matcha-lattes', quantity: 2 },
    { categoryId: 'merch', quantity: 3 },
    { name: 'mystery', quantity: 9 },
  ], menu), 2);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
