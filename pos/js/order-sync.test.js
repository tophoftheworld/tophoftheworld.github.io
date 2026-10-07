/**
 * Run: node pos/js/order-sync.test.js
 */
import assert from 'node:assert/strict';
import {
  mergeRemoteOrder,
  applyRemoteRemoval,
  localWinsOverRemote,
  markOrderSyncedInList,
  getPendingOrders,
  filterOrdersForClear,
  resolveEventSelectorState,
  enqueueOutbox,
  removeFromOutbox,
  readOutbox,
  syncOutboxFromHistory,
  patchOrderNeedsSync,
  generateOrderId,
  ORDER_HISTORY_KEY,
  OUTBOX_KEY
} from './order-sync-core.js';
import { manilaYmdFromDate } from './event-window.js';

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

function memoryStorage(seed = {}) {
  const map = { ...seed };
  return {
    getItem(k) { return map[k] ?? null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; }
  };
}

test('local wins when needsSync and remote lastModified missing', () => {
  const local = { id: 'A', needsSync: true, lastModified: '2026-09-22T10:00:00.000Z', total: 100 };
  const remote = { id: 'A', lastModified: undefined, total: 50 };
  assert.equal(localWinsOverRemote(local, remote), true);
  const { orderHistory, changed } = mergeRemoteOrder([local], remote);
  assert.equal(changed, false);
  assert.equal(orderHistory[0].total, 100);
});

test('local wins when needsSync and local lastModified >= remote', () => {
  const local = { id: 'A', needsSync: true, lastModified: '2026-09-22T12:00:00.000Z', total: 100 };
  const remote = { id: 'A', lastModified: '2026-09-22T11:00:00.000Z', total: 50 };
  const { changed, orderHistory } = mergeRemoteOrder([local], remote);
  assert.equal(changed, false);
  assert.equal(orderHistory[0].total, 100);
});

test('remote wins when local is synced', () => {
  const local = { id: 'A', needsSync: false, lastModified: '2026-09-22T12:00:00.000Z', total: 100 };
  const remote = { id: 'A', lastModified: '2026-09-22T11:00:00.000Z', total: 50 };
  const { changed, orderHistory } = mergeRemoteOrder([local], remote);
  assert.equal(changed, true);
  assert.equal(orderHistory[0].total, 50);
  assert.equal(orderHistory[0].needsSync, false);
});

test('merge skips order mid-edit', () => {
  const local = { id: 'A', needsSync: false, total: 100 };
  const remote = { id: 'A', total: 50 };
  const { changed } = mergeRemoteOrder([local], remote, { editingId: 'A' });
  assert.equal(changed, false);
});

test('pending includes deleted orders', () => {
  const pending = getPendingOrders([
    { id: '1', needsSync: true, status: 'deleted' },
    { id: '2', needsSync: true, status: 'pending' },
    { id: '3', needsSync: false, status: 'pending' }
  ]);
  assert.equal(pending.length, 2);
});

test('patchOrderNeedsSync does not wipe concurrent sales (stale-flush guard)', () => {
  const storage = memoryStorage({
    [ORDER_HISTORY_KEY]: JSON.stringify([
      { id: 'OLD', needsSync: true, total: 10 },
      { id: 'NEW', needsSync: true, total: 99 }
    ])
  });
  // Simulate flush marking OLD synced after NEW was added
  patchOrderNeedsSync('OLD', false, storage);
  const after = JSON.parse(storage.getItem(ORDER_HISTORY_KEY));
  assert.equal(after.length, 2);
  assert.equal(after.find((o) => o.id === 'NEW').total, 99);
  assert.equal(after.find((o) => o.id === 'OLD').needsSync, false);
});

test('outbox enqueue/remove and sync from history', () => {
  const storage = memoryStorage();
  syncOutboxFromHistory([
    { id: 'A', needsSync: true },
    { id: 'B', needsSync: false },
    { id: 'C', needsSync: true, status: 'deleted' }
  ], storage);
  let box = readOutbox(storage);
  assert.equal(box.length, 2);
  removeFromOutbox('A', storage);
  box = readOutbox(storage);
  assert.equal(box.length, 1);
  assert.equal(box[0].orderId, 'C');
  enqueueOutbox('A', storage);
  assert.equal(readOutbox(storage).length, 2);
});

test('clearDateData scoped to event+date only', () => {
  const orders = [
    { id: '1', event: 'popup-a', timestamp: '2026-09-22T08:00:00.000Z' },
    { id: '2', event: 'popup-b', timestamp: '2026-09-22T09:00:00.000Z' },
    { id: '3', event: 'popup-a', timestamp: '2026-09-21T08:00:00.000Z' }
  ];
  const kept = filterOrdersForClear(orders, {
    eventKey: 'popup-a',
    dateStr: '2026-09-22',
    getDateStr: (d) => manilaYmdFromDate(d)
  });
  assert.equal(kept.length, 2);
  assert.ok(kept.some((o) => o.id === '2'));
  assert.ok(kept.some((o) => o.id === '3'));
  assert.ok(!kept.some((o) => o.id === '1'));
});

test('event selector never clears currentEvent on empty/failed list', () => {
  const state = resolveEventSelectorState({
    activeEvents: [],
    currentValue: 'popup-sm-aura',
    allowAutoSwitch: false
  });
  assert.equal(state.action, 'keep-orphaned');
  assert.equal(state.eventKey, 'popup-sm-aura');
});

test('event selector does not auto-switch without confirm', () => {
  const state = resolveEventSelectorState({
    activeEvents: [{ key: 'popup-new', name: 'New' }],
    currentValue: 'popup-old',
    allowAutoSwitch: false,
    confirmSwitch: () => false
  });
  assert.equal(state.action, 'keep-orphaned');
  assert.equal(state.eventKey, 'popup-old');
});

test('remote removal soft-deletes unless local pending newer', () => {
  const synced = [{ id: 'A', needsSync: false, status: 'pending' }];
  const { changed, orderHistory } = applyRemoteRemoval(synced, 'A');
  assert.equal(changed, true);
  assert.equal(orderHistory[0].status, 'deleted');

  const pending = [{ id: 'B', needsSync: true, status: 'pending' }];
  const r2 = applyRemoteRemoval(pending, 'B');
  assert.equal(r2.changed, false);
});

test('order ids are longer than 5 chars', () => {
  const id = generateOrderId();
  assert.ok(id.length >= 12);
});

test('Manila YMD helper returns YYYY-MM-DD', () => {
  const ymd = manilaYmdFromDate(new Date('2026-09-22T16:30:00+08:00'));
  assert.match(ymd, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(ymd, '2026-09-22');
});

test('markOrderSyncedInList only touches one order', () => {
  const list = [
    { id: 'A', needsSync: true },
    { id: 'B', needsSync: true }
  ];
  const next = markOrderSyncedInList(list, 'A');
  assert.equal(next[0].needsSync, false);
  assert.equal(next[1].needsSync, true);
  assert.equal(list[0].needsSync, true); // immutable
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
