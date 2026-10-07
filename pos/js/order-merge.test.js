/**
 * Run: node pos/js/order-merge.test.js
 * Alias coverage for merge rules (also covered in order-sync.test.js).
 */
import assert from 'node:assert/strict';
import { mergeRemoteOrder, localWinsOverRemote } from './order-sync-core.js';

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

test('equal timestamps: local pending wins (>=)', () => {
  const ts = '2026-09-22T10:00:00.000Z';
  const local = { id: 'X', needsSync: true, lastModified: ts, items: [1] };
  const remote = { id: 'X', lastModified: ts, items: [2] };
  assert.equal(localWinsOverRemote(local, remote), true);
  const { changed } = mergeRemoteOrder([local], remote);
  assert.equal(changed, false);
});

test('new remote order is appended', () => {
  const { orderHistory, changed } = mergeRemoteOrder(
    [{ id: 'A', needsSync: false }],
    { id: 'B', total: 40 }
  );
  assert.equal(changed, true);
  assert.equal(orderHistory.length, 2);
  assert.equal(orderHistory[1].id, 'B');
  assert.equal(orderHistory[1].needsSync, false);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
