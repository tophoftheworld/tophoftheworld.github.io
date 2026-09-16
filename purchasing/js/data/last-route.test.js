/**
 * Run: node purchasing/js/data/last-route.test.js
 */
import assert from 'node:assert/strict';
import { slimLiveWeekForCache } from './last-route.js?v=96';

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

test('slim cache keeps on-plan and manual lines', () => {
  const week = {
    id: 'this-week',
    lines: [
      { id: 'a', onPlan: true, itemId: 'matcha', location: 'podium' },
      { id: 'b', onPlan: false, itemId: 'cups', location: 'podium', suggestedQty: 12 },
      { id: 'c', source: 'manual', onPlan: true, freeTextName: 'Ice' },
      { id: 'd', frozen: true, onPlan: false, itemId: 'milk', location: 'podium' },
    ],
  };
  const slim = slimLiveWeekForCache(week);
  assert.equal(slim.lines.length, 3);
  assert.deepEqual(
    slim.lines.map((l) => l.id),
    ['a', 'c', 'd']
  );
});

test('slim cache drops suggested-only Order View rows', () => {
  const week = {
    id: 'this-week',
    lines: Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`,
      onPlan: false,
      itemId: `item-${i}`,
      location: 'podium',
      suggestedQty: 1,
      source: 'order-view',
    })),
  };
  const slim = slimLiveWeekForCache(week);
  assert.equal(slim.lines.length, 0);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
