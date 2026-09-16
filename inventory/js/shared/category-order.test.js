/**
 * Run: node inventory/js/shared/category-order.test.js
 */
import assert from 'node:assert/strict';
import {
  buildCategoryOrderMap,
  compareCategoryNames,
  compareItemsByCategoryOrder,
  uniqueSortedCategoryNames,
} from './category-order.js';

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

const catalog = [
  { name: 'Base Ingredients', order: 0 },
  { name: 'Packaging & Consumables', order: 1 },
  { name: 'Liquid Ingredients', order: 2 },
  { name: 'Dry Ingredients', order: 3 },
  { name: 'Desserts', order: 4 },
  { name: 'Dessert Ingredients', order: 5 },
];

const items = [
  { name: 'Matcha Powder', category: 'Base Ingredients', categoryOrder: 0, displayOrder: 0 },
  { name: 'Whipping Cream', category: 'Dessert Ingredients', categoryOrder: 1, displayOrder: 0 },
  { name: 'Cups', category: 'Packaging & Consumables', categoryOrder: 1, displayOrder: 0 },
  { name: 'Ice Cream', category: 'Desserts', categoryOrder: 4, displayOrder: 0 },
];

test('catalog order puts Dessert Ingredients last even when item categoryOrder is 1', () => {
  const map = buildCategoryOrderMap(catalog, items);
  const names = uniqueSortedCategoryNames(items, map);
  assert.deepEqual(names, [
    'Base Ingredients',
    'Packaging & Consumables',
    'Desserts',
    'Dessert Ingredients',
  ]);
});

test('without catalog, item categoryOrder + name puts Dessert Ingredients second', () => {
  const map = buildCategoryOrderMap([], items);
  const names = uniqueSortedCategoryNames(items, map);
  assert.deepEqual(names, [
    'Base Ingredients',
    'Dessert Ingredients',
    'Packaging & Consumables',
    'Desserts',
  ]);
});

test('alphabetical names also put Dessert Ingredients second', () => {
  const names = ['Packaging & Consumables', 'Dessert Ingredients', 'Base Ingredients', 'Desserts']
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, [
    'Base Ingredients',
    'Dessert Ingredients',
    'Desserts',
    'Packaging & Consumables',
  ]);
  const map = buildCategoryOrderMap(catalog, []);
  const ordered = [...names].sort((a, b) => compareCategoryNames(a, b, map));
  assert.deepEqual(ordered, [
    'Base Ingredients',
    'Packaging & Consumables',
    'Desserts',
    'Dessert Ingredients',
  ]);
});

test('item sort follows catalog, then displayOrder within a category', () => {
  const map = buildCategoryOrderMap(catalog, items);
  const sorted = [
    { name: 'Whipping Cream', category: 'Dessert Ingredients', categoryOrder: 1, displayOrder: 0 },
    { name: 'Matcha Powder', category: 'Base Ingredients', categoryOrder: 0, displayOrder: 1 },
    { name: 'Hojicha Powder', category: 'Base Ingredients', categoryOrder: 0, displayOrder: 0 },
  ].sort((a, b) => compareItemsByCategoryOrder(a, b, map));
  assert.deepEqual(sorted.map((i) => i.name), [
    'Hojicha Powder',
    'Matcha Powder',
    'Whipping Cream',
  ]);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
