import { db, collection, addDoc, updateDoc, doc, getDocs, query, orderBy, limit, setDoc, getDoc, onSnapshot, deleteDoc, serverTimestamp } from './firebase-setup.js';
import { menuData } from './menu-data.js';
import { isCupItem } from './cup-count.js';
import { filterPosSelectableEvents, manilaTodayYmd, manilaYmdFromDate, shouldAutoArchiveEvent } from './event-window.js?v=4';
import {
    getPendingOrders,
    readOrderHistory,
    writeOrderHistory,
    markOrderSyncedInList,
    enqueueOutbox,
    removeFromOutbox,
    bumpOutboxAttempt,
    syncOutboxFromHistory,
    readOutbox,
    patchOrderNeedsSync
} from './order-sync-core.js?v=1';

function getActivePosMenu() {
    if (typeof window !== 'undefined' && window.__posMenu) return window.__posMenu;
    return menuData;
}

let menuItemsMap = new Map();
let flushInProgress = false;
let flushQueued = false;
let backoffTimer = null;
let backoffMs = 1000;
const BACKOFF_MAX_MS = 30000;

let lastSyncedAt = null;
let lastSyncError = null;
const syncStatusListeners = new Set();

function getStorage() {
    return typeof localStorage !== 'undefined' ? localStorage : null;
}

function emitSyncStatus() {
    const status = getSyncStatus();
    syncStatusListeners.forEach((fn) => {
        try { fn(status); } catch (err) { console.error(err); }
    });
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos-sync-status', { detail: status }));
    }
}

export function getSyncStatus() {
    const storage = getStorage();
    const pending = storage
        ? getPendingOrders(readOrderHistory(storage)).length
        : 0;
    return {
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
        pending,
        syncing: flushInProgress,
        lastSyncedAt,
        lastError: lastSyncError
    };
}

export function onSyncStatusChange(fn) {
    syncStatusListeners.add(fn);
    try { fn(getSyncStatus()); } catch (_) { /* ignore */ }
    return () => syncStatusListeners.delete(fn);
}

function scheduleBackoffRetry() {
    if (backoffTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(BACKOFF_MAX_MS, backoffMs * 2);
    backoffTimer = setTimeout(() => {
        backoffTimer = null;
        syncAllPendingOrders();
    }, delay);
}

function resetBackoff() {
    backoffMs = 1000;
    if (backoffTimer) {
        clearTimeout(backoffTimer);
        backoffTimer = null;
    }
}

/** Manila YMD for order folder keys (exported for callers / tests). */
export function getOrderDateString(date = new Date()) {
    return manilaYmdFromDate(date);
}

export async function initializeMenuItems() {
    try {
        const menuItems = menuData.items.map(item => ({
            id: item.categoryId + '-' + item.name.replace(/<[^>]*>/g, '').toLowerCase().replace(/\s+/g, '-'),
            name: item.name.replace(/<[^>]*>/g, ''),
            displayName: item.name,
            description: item.description,
            basePrice: item.price,
            categoryId: item.categoryId,
            type: item.type
        }));

        for (const item of menuItems) {
            const docRef = doc(db, 'menu-items', item.id);
            await setDoc(docRef, item);
            menuItemsMap.set(item.id, item);
        }
    } catch (error) {
        console.error('Error initializing menu items:', error);
    }
}

export async function saveOrderToFirebase(order) {
    try {
        const orderDate = getOrderDateString(new Date(order.timestamp));
        const optimizedOrder = {
            id: order.id,
            items: order.items.map(item => ({
                menuItemId: getMenuItemId(item),
                quantity: item.quantity,
                customizations: item.customizations,
                price: item.price,
                basePrice: item.basePrice,
                name: item.name ? item.name.replace(/<[^>]*>/g, '') : null,
                categoryId: item.categoryId || null,
                type: item.type || null,
                countsAsCup: isCupItem(item, getActivePosMenu()),
                prepared: Boolean(item.prepared)
            })),
            total: order.total,
            paymentMethod: order.paymentMethod,
            timestamp: order.timestamp,
            status: order.status,
            customerName: order.customerName || '',
            lastModified: order.lastModified || order.timestamp,
            event: order.event || window.currentEvent || 'pop-up',
            readyAt: order.readyAt || null
        };

        const orderRef = doc(db, `pos-orders/${order.event || window.currentEvent || 'pop-up'}`, orderDate, order.id);
        await setDoc(orderRef, optimizedOrder);
        return order.id;
    } catch (error) {
        console.error('Error saving to Firebase:', error);
        throw error;
    }
}

export async function updateOrderInFirebase(orderId, orderDate, updates) {
    try {
        const documentId = updates.firebaseId || orderId;
        const orderRef = doc(db, `pos-orders/${window.currentEvent || 'pop-up'}`, orderDate, documentId);
        await updateDoc(orderRef, updates);
        console.log('Order updated in Firebase:', documentId);
    } catch (error) {
        console.error('Error updating Firebase:', error);
    }
}

function getLocalDateString(date = new Date()) {
    return getOrderDateString(date);
}

export async function loadOrdersFromFirebase(date) {
    try {
        const orderDate = getOrderDateString(date);
        const q = query(
            collection(db, `pos-orders/${window.currentEvent || 'pop-up'}`, orderDate),
            orderBy('timestamp', 'desc')
        );

        const querySnapshot = await getDocs(q);
        const firebaseOrders = [];

        querySnapshot.forEach((document) => {
            const orderData = document.data();
            const fullItems = (orderData.items || []).map(item => {
                const menuItem = item.menuItemId ? menuItemsMap.get(item.menuItemId) : null;
                if (menuItem) {
                    return {
                        ...menuItem,
                        ...item,
                        name: menuItem.name || item.name || `Item ${item.menuItemId}`,
                        price: item.price || menuItem.basePrice,
                        basePrice: item.basePrice || menuItem.basePrice
                    };
                }
                return {
                    ...item,
                    name: item.name || (item.menuItemId ? item.menuItemId.split('-').slice(1).join(' ') : 'Unknown Item'),
                    price: item.price || 0,
                    basePrice: item.basePrice || 0
                };
            });

            firebaseOrders.push({
                firebaseId: document.id,
                ...orderData,
                items: fullItems
            });
        });

        return firebaseOrders;
    } catch (error) {
        console.error('Error loading from Firebase:', error);
        return [];
    }
}

function getMenuItemId(item) {
    if (!item.name) {
        console.warn('Item with missing name detected:', item);
        return 'unknown-item-' + (item.id || Date.now());
    }

    const cleanName = item.name.replace(/<[^>]*>/g, '');
    const categoryId = item.categoryId
        || menuData.items.find(m => m.name.replace(/<[^>]*>/g, '') === cleanName)?.categoryId
        || menuData.items.find(m => m.name.includes(cleanName))?.categoryId
        || 'unknown';
    return categoryId + '-' + cleanName.toLowerCase().replace(/\s+/g, '-');
}

export async function syncOrderToFirebase(order) {
    try {
        const orderDate = getOrderDateString(new Date(order.timestamp));
        console.log(`Syncing order ${order.id} to Firebase...`);

        const firebaseOrder = {
            id: order.id,
            items: (order.items || []).map(item => ({
                menuItemId: getMenuItemId(item),
                quantity: item.quantity,
                customizations: item.customizations,
                price: item.price,
                basePrice: item.basePrice,
                name: item.name ? item.name.replace(/<[^>]*>/g, '') : null,
                categoryId: item.categoryId || null,
                type: item.type || null,
                countsAsCup: isCupItem(item, getActivePosMenu()),
                prepared: Boolean(item.prepared)
            })),
            total: order.total,
            paymentMethod: order.paymentMethod,
            timestamp: order.timestamp,
            status: order.status,
            customerName: order.customerName || '',
            lastModified: order.lastModified || order.timestamp || new Date().toISOString(),
            event: order.event || 'pop-up',
            readyAt: order.readyAt || null
        };

        const orderRef = doc(db, `pos-orders/${order.event || 'pop-up'}`, orderDate, order.id);
        await setDoc(orderRef, firebaseOrder);

        console.log(`Successfully synced order ${order.id}`);
        return true;
    } catch (error) {
        console.error(`Failed to sync order ${order.id}:`, error);
        lastSyncError = error?.message || String(error);
        return false;
    }
}

/**
 * Flush pending orders safely:
 * - mutex (no overlapping flushes)
 * - includes soft-deletes
 * - re-reads localStorage per success (never stale whole-array overwrite)
 * - durable outbox
 * - does NOT hard-gate on navigator.onLine
 */
export async function syncAllPendingOrders() {
    if (flushInProgress) {
        flushQueued = true;
        return { synced: 0, failed: 0, skipped: true };
    }

    const storage = getStorage();
    if (!storage) return { synced: 0, failed: 0 };

    flushInProgress = true;
    emitSyncStatus();

    let syncedCount = 0;
    let failCount = 0;

    try {
        console.log('Starting background sync of all pending orders...');

        const history = readOrderHistory(storage);
        syncOutboxFromHistory(history, storage);

        const outbox = readOutbox(storage);
        if (outbox.length === 0) {
            console.log('No orders need syncing');
            resetBackoff();
            lastSyncError = null;
            return { synced: 0, failed: 0 };
        }

        console.log(`Found ${outbox.length} outbox entries to sync`);

        for (const entry of outbox) {
            const fresh = readOrderHistory(storage);
            const order = fresh.find((o) => o.id === entry.orderId);

            if (!order) {
                removeFromOutbox(entry.orderId, storage);
                continue;
            }
            if (!order.needsSync) {
                removeFromOutbox(entry.orderId, storage);
                continue;
            }

            const success = await syncOrderToFirebase(order);
            if (success) {
                const after = markOrderSyncedInList(readOrderHistory(storage), order.id);
                writeOrderHistory(after, storage);
                removeFromOutbox(order.id, storage);
                syncedCount += 1;
                lastSyncedAt = new Date().toISOString();
                lastSyncError = null;

                if (typeof window !== 'undefined' && typeof window.__posOnOrderSynced === 'function') {
                    try { window.__posOnOrderSynced(order.id); } catch (_) { /* ignore */ }
                }
            } else {
                bumpOutboxAttempt(order.id, storage);
                failCount += 1;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (failCount > 0) {
            scheduleBackoffRetry();
        } else {
            resetBackoff();
        }

        console.log(`Successfully synced ${syncedCount}; failed ${failCount}`);
        return { synced: syncedCount, failed: failCount };
    } finally {
        flushInProgress = false;
        emitSyncStatus();
        if (flushQueued) {
            flushQueued = false;
            queueMicrotask(() => { syncAllPendingOrders(); });
        }
    }
}

/** Enqueue an order for durable sync and kick a flush. */
export function queueOrderSync(orderId) {
    const storage = getStorage();
    if (!storage || !orderId) return;
    enqueueOutbox(orderId, storage);
    emitSyncStatus();
    syncAllPendingOrders();
}

export function markLocalOrderSynced(orderId) {
    const storage = getStorage();
    if (!storage || !orderId) return;
    patchOrderNeedsSync(orderId, false, storage);
    removeFromOutbox(orderId, storage);
    emitSyncStatus();
}

function ymdOrNull(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null;
}

function indexOpsEventsByBranch(snapshot) {
    const byBranchId = new Map();
    const byKey = new Map();
    const byOpsId = new Map();
    snapshot.forEach((d) => {
        const data = d.data() || {};
        const rec = { id: d.id, ...data };
        byOpsId.set(d.id, rec);
        if (data.links?.branchId) byBranchId.set(data.links.branchId, rec);
        const key = data.links?.branchKey || data.key;
        if (!key) return;
        const prev = byKey.get(key);
        if (!prev || (prev.status === 'cancelled' && rec.status !== 'cancelled')) {
            byKey.set(key, rec);
        }
    });
    return { byBranchId, byKey, byOpsId };
}

function resolveEventDates(branchId, data, opsIndex) {
    const ops =
        (data.opsEventId && opsIndex.byOpsId.get(data.opsEventId)) ||
        opsIndex.byBranchId.get(branchId) ||
        opsIndex.byKey.get(data.key) ||
        null;
    const startDate = ymdOrNull(data.startDate) || ymdOrNull(ops?.startDate);
    const endDate = ymdOrNull(data.endDate) || ymdOrNull(ops?.endDate) || startDate;
    return { startDate, endDate };
}

async function autoArchiveEndedEvents(events) {
    const todayYmd = manilaTodayYmd();
    const due = (events || []).filter((event) => event.id && shouldAutoArchiveEvent(event, todayYmd));
    if (!due.length) return;
    const now = new Date().toISOString();
    await Promise.all(due.map(async (event) => {
        try {
            await updateDoc(doc(db, 'branches', event.id), {
                archived: true,
                status: 'archived',
                autoArchivedAt: now,
                lastModified: now
            });
            event.archived = true;
        } catch (err) {
            console.warn('Auto-archive skipped for', event.key || event.id, err);
        }
    }));
}

/** @returns {Promise<{ ok: boolean, events: object[], error?: Error }>} */
export async function loadEventsFromFirebaseResult() {
    try {
        const branchesRef = collection(db, 'branches');
        const [snapshot, opsSnap] = await Promise.all([
            getDocs(branchesRef),
            getDocs(collection(db, 'opsEvents')).catch((err) => {
                console.warn('opsEvents date join skipped:', err);
                return { forEach() {} };
            })
        ]);
        const opsIndex = indexOpsEventsByBranch(opsSnap);
        const events = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Pop-ups always; bar/service branches only when they have a package POS menu.
            const isPopup = data.type === 'popup';
            const isPackageService =
                data.type === 'service' &&
                (data.serviceType === 'package' || !!data.customMenu);
            if (isPopup || isPackageService) {
                const { startDate, endDate } = resolveEventDates(docSnap.id, data, opsIndex);
                events.push({
                    id: docSnap.id,
                    key: data.key,
                    name: data.name,
                    type: data.type,
                    serviceType:
                        data.serviceType ||
                        (isPackageService ? 'package' : 'popup'),
                    archived: data.archived || false,
                    autoArchiveExempt: data.autoArchiveExempt || false,
                    customMenu: data.customMenu || null,
                    createdAt: data.createdAt || null,
                    startDate,
                    endDate
                });
            }
        });
        await autoArchiveEndedEvents(events);
        return { ok: true, events };
    } catch (error) {
        console.error('Error loading events:', error);
        return { ok: false, events: [], error };
    }
}

export async function loadEventsFromFirebase() {
    const result = await loadEventsFromFirebaseResult();
    return result.events;
}

export { filterPosSelectableEvents, manilaYmdFromDate, getLocalDateString };

export async function saveEventToFirebase(eventData) {
    try {
        const docRef = await addDoc(collection(db, 'branches'), eventData);
        const saved = { id: docRef.id, ...eventData };
        try {
            const mod = await import('../../shared/js/ops-events.js');
            await mod.createOpsEventFromBranch(
                db,
                { getDocs, collection, doc, addDoc, updateDoc, setDoc, deleteDoc },
                saved,
                { createdBy: 'pos-sync' }
            );
        } catch (err) {
            console.warn('opsEvents dual-write skipped:', err);
        }
        return saved;
    } catch (error) {
        console.error('Error saving event:', error);
        throw error;
    }
}

let unsubscribeOrderListener = null;
let unsubscribeLiveSessionListener = null;

/**
 * Shared day subscription used by POS, queue strip, and dashboard.
 * handlers: { onAdded?, onModified?, onRemoved?, onDoc?, onError? }
 * onDoc(doc, changeType) is called for every change when provided.
 */
export function subscribeToDayOrders(event, date, handlers = {}) {
    const dateStr = typeof date === 'string' ? date : getOrderDateString(date);
    const eventKey = event || 'pop-up';
    const ordersRef = collection(db, `pos-orders/${eventKey}/${dateStr}`);

    console.log(`Subscribing to real-time orders for ${eventKey} / ${dateStr}`);

    const unsub = onSnapshot(ordersRef, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (typeof handlers.onDoc === 'function') {
                handlers.onDoc(change.doc, change.type);
            }
            if (change.type === 'added' && typeof handlers.onAdded === 'function') {
                handlers.onAdded(change.doc);
            } else if (change.type === 'modified' && typeof handlers.onModified === 'function') {
                handlers.onModified(change.doc);
            } else if (change.type === 'removed' && typeof handlers.onRemoved === 'function') {
                handlers.onRemoved(change.doc);
            }
            // Back-compat: single onUpdate for added/modified
            if ((change.type === 'added' || change.type === 'modified') && typeof handlers.onUpdate === 'function') {
                handlers.onUpdate(change.doc);
            }
        });
    }, (error) => {
        console.error('Order listener error:', error);
        if (typeof handlers.onError === 'function') handlers.onError(error);
    });

    return unsub;
}

export function subscribeToOrders(event, date, onUpdate) {
    if (unsubscribeOrderListener) {
        unsubscribeOrderListener();
        unsubscribeOrderListener = null;
    }

    unsubscribeOrderListener = subscribeToDayOrders(event, date, {
        onUpdate,
        onRemoved: (docSnap) => {
            if (typeof onUpdate === 'function' && onUpdate.handleRemoved) {
                onUpdate.handleRemoved(docSnap);
            } else if (typeof window !== 'undefined' && typeof window.__posOnRemoteOrderRemoved === 'function') {
                window.__posOnRemoteOrderRemoved(docSnap);
            }
        }
    });

    return () => {
        if (unsubscribeOrderListener) {
            unsubscribeOrderListener();
            unsubscribeOrderListener = null;
        }
    };
}

function getLiveSessionDocRef(event) {
    const eventKey = event || 'pop-up';
    return doc(db, 'pos-live', eventKey, 'session', 'current');
}

export async function publishLiveSession(event, payload) {
    try {
        console.log('[GREETING_DEBUG][firebase-sync] publishLiveSession', {
            event: event || 'pop-up',
            customerName: payload?.customerName ?? null,
            nameGreetingId: payload?.nameGreetingId ?? null,
            status: payload?.status ?? null
        });
        const liveDocRef = getLiveSessionDocRef(event);
        await setDoc(liveDocRef, {
            event: event || 'pop-up',
            updatedAt: serverTimestamp(),
            ...payload
        }, { merge: true });
        return true;
    } catch (error) {
        console.error('[GREETING_DEBUG][firebase-sync] publish FAILED', error);
        console.error('Failed to publish live session:', error);
        return false;
    }
}

export async function clearLiveSession(event) {
    try {
        const liveDocRef = getLiveSessionDocRef(event);
        await deleteDoc(liveDocRef);
        return true;
    } catch (error) {
        console.error('Failed to clear live session:', error);
        return false;
    }
}

export function subscribeToLiveSession(event, onUpdate) {
    if (unsubscribeLiveSessionListener) {
        unsubscribeLiveSessionListener();
        unsubscribeLiveSessionListener = null;
    }

    const liveDocRef = getLiveSessionDocRef(event);

    unsubscribeLiveSessionListener = onSnapshot(liveDocRef, (snapshot) => {
        onUpdate(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    }, (error) => {
        console.error('Live session listener error:', error);
    });

    return () => {
        if (unsubscribeLiveSessionListener) {
            unsubscribeLiveSessionListener();
            unsubscribeLiveSessionListener = null;
        }
    };
}

// Wire online / visibility for retries
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        resetBackoff();
        emitSyncStatus();
        setTimeout(() => syncAllPendingOrders(), 500);
    });
    window.addEventListener('offline', () => emitSyncStatus());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            syncAllPendingOrders();
            emitSyncStatus();
        }
    });
}
