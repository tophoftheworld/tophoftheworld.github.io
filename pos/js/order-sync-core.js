/**
 * Pure POS order sync helpers (no Firebase). Safe for node tests.
 */

export const ORDER_HISTORY_KEY = 'orderHistory';
export const OUTBOX_KEY = 'posSyncOutbox';

export function parseTs(value) {
  if (!value) return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** Local pending changes win when remote timestamp is missing/invalid or not newer. */
export function localWinsOverRemote(local, remote) {
  if (!local?.needsSync) return false;
  const localTs = parseTs(local.lastModified);
  const remoteTs = parseTs(remote?.lastModified);
  if (Number.isNaN(remoteTs)) return true;
  if (Number.isNaN(localTs)) return false;
  return localTs >= remoteTs;
}

/**
 * Merge a remote order into a local history array (immutable).
 * @returns {{ orderHistory: object[], changed: boolean }}
 */
export function mergeRemoteOrder(orderHistory, remote, { editingId } = {}) {
  if (!remote?.id) return { orderHistory, changed: false };
  if (editingId && remote.id === editingId) {
    return { orderHistory, changed: false };
  }

  const list = Array.isArray(orderHistory) ? orderHistory : [];
  const idx = list.findIndex((o) => o.id === remote.id);

  if (idx === -1) {
    return {
      orderHistory: [...list, { ...remote, needsSync: false }],
      changed: true
    };
  }

  const local = list[idx];
  if (localWinsOverRemote(local, remote)) {
    return { orderHistory: list, changed: false };
  }

  const next = list.slice();
  next[idx] = { ...remote, needsSync: false };
  return { orderHistory: next, changed: true };
}

/** Soft-delete from a remote removal, unless local has newer pending changes. */
export function applyRemoteRemoval(orderHistory, orderId, { editingId } = {}) {
  if (!orderId || (editingId && orderId === editingId)) {
    return { orderHistory, changed: false };
  }
  const list = Array.isArray(orderHistory) ? orderHistory : [];
  const idx = list.findIndex((o) => o.id === orderId);
  if (idx === -1) return { orderHistory: list, changed: false };

  const local = list[idx];
  if (local.needsSync && local.status !== 'deleted') {
    return { orderHistory: list, changed: false };
  }
  if (local.status === 'deleted' && !local.needsSync) {
    return { orderHistory: list, changed: false };
  }

  const next = list.slice();
  next[idx] = {
    ...local,
    status: 'deleted',
    needsSync: false,
    lastModified: new Date().toISOString()
  };
  return { orderHistory: next, changed: true };
}

export function markOrderSyncedInList(orderHistory, orderId) {
  const list = Array.isArray(orderHistory) ? orderHistory : [];
  const idx = list.findIndex((o) => o.id === orderId);
  if (idx === -1) return list;
  const next = list.slice();
  next[idx] = { ...next[idx], needsSync: false };
  return next;
}

export function getPendingOrders(orderHistory) {
  return (orderHistory || []).filter((o) => o.needsSync === true);
}

export function filterOrdersForClear(orders, { eventKey, dateStr, getDateStr }) {
  return (orders || []).filter((order) => {
    const orderDate = getDateStr(new Date(order.timestamp));
    const sameDate = orderDate === dateStr;
    const sameEvent = (order.event || '') === (eventKey || '');
    return !(sameDate && sameEvent);
  });
}

export function generateOrderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  }
  return `ORD${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

export function readOrderHistory(storage) {
  try {
    return JSON.parse(storage.getItem(ORDER_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

export function writeOrderHistory(orders, storage) {
  storage.setItem(ORDER_HISTORY_KEY, JSON.stringify(orders));
}

/** Re-read storage and patch only needsSync for one id (avoids stale snapshot wipe). */
export function patchOrderNeedsSync(orderId, needsSync, storage) {
  const orders = readOrderHistory(storage);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return orders;
  orders[idx] = { ...orders[idx], needsSync };
  writeOrderHistory(orders, storage);
  return orders;
}

export function readOutbox(storage) {
  try {
    return JSON.parse(storage.getItem(OUTBOX_KEY) || '[]');
  } catch {
    return [];
  }
}

export function writeOutbox(entries, storage) {
  storage.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

export function enqueueOutbox(orderId, storage) {
  if (!orderId) return readOutbox(storage);
  const box = readOutbox(storage);
  const existing = box.find((e) => e.orderId === orderId);
  if (existing) return box;
  box.push({
    orderId,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  });
  writeOutbox(box, storage);
  return box;
}

export function removeFromOutbox(orderId, storage) {
  const box = readOutbox(storage).filter((e) => e.orderId !== orderId);
  writeOutbox(box, storage);
  return box;
}

export function bumpOutboxAttempt(orderId, storage) {
  const box = readOutbox(storage);
  const entry = box.find((e) => e.orderId === orderId);
  if (entry) {
    entry.attempts = (entry.attempts || 0) + 1;
    entry.lastAttemptAt = new Date().toISOString();
    writeOutbox(box, storage);
  }
  return box;
}

/** Ensure every needsSync order is in the outbox. */
export function syncOutboxFromHistory(orderHistory, storage) {
  const pending = getPendingOrders(orderHistory);
  for (const order of pending) {
    enqueueOutbox(order.id, storage);
  }
  return readOutbox(storage);
}

export function resolveEventSelectorState({
  activeEvents,
  currentValue,
  allowAutoSwitch,
  confirmSwitch
}) {
  const active = activeEvents || [];
  const hasActive = active.length > 0;
  const currentStillActive = active.some((e) => e.key === currentValue);

  if (hasActive && currentStillActive) {
    return { action: 'keep', eventKey: currentValue, events: active };
  }

  if (hasActive && currentValue && !currentStillActive) {
    if (!allowAutoSwitch) {
      const ok = typeof confirmSwitch === 'function'
        ? confirmSwitch(currentValue, active[0])
        : false;
      if (ok) {
        return { action: 'switch', eventKey: active[0].key, events: active };
      }
      // Keep current event visible even if out of window
      return {
        action: 'keep-orphaned',
        eventKey: currentValue,
        events: active,
        orphanedKey: currentValue
      };
    }
    return { action: 'switch', eventKey: active[0].key, events: active };
  }

  if (hasActive && !currentValue) {
    return { action: 'switch', eventKey: active[0].key, events: active };
  }

  // No active events — never clear an existing currentEvent
  if (currentValue) {
    return {
      action: 'keep-orphaned',
      eventKey: currentValue,
      events: [],
      orphanedKey: currentValue
    };
  }

  return { action: 'empty', eventKey: currentValue || '', events: [] };
}
