// shared.js - Common utilities for both mobile and admin apps

// Global state - will be initialized by each app
export let expenses = [];
export let suppliers = [];

/** Canonical expense categories (single source for mobile + admin). */
export const EXPENSE_CATEGORY_OPTIONS = [
    'Supplies',
    'Staff',
    'Rent & Utilities',
    'Marketing',
    'Equipment',
    'Operations',
];

export const DEFAULT_EXPENSE_CATEGORY = 'Supplies';

/** Option values for an expense form select: canonical list plus legacy value if not in list. */
export function getExpenseCategorySelectOptionValues(currentValue) {
    const v = (currentValue || '').trim();
    const extras = v && !EXPENSE_CATEGORY_OPTIONS.includes(v) ? [v] : [];
    return [...EXPENSE_CATEGORY_OPTIONS, ...extras];
}

/** Distinct category values for admin filter: canonical order, then any other values seen in data (sorted). */
export function getExpenseCategoryFilterOptionValues(expensesArray) {
    const fromData = new Set();
    for (const e of expensesArray || []) {
        const c = (e && e.expenseCategory != null ? String(e.expenseCategory) : '').trim();
        if (c) fromData.add(c);
    }
    const legacy = [...fromData].filter((c) => !EXPENSE_CATEGORY_OPTIONS.includes(c)).sort((a, b) =>
        a.localeCompare(b)
    );
    return [...EXPENSE_CATEGORY_OPTIONS, ...legacy];
}

// Firebase dependencies - will be imported at module level
let db;
let app = null;
let storage = null;
let storageRefFn = null;
let uploadBytesFn = null;
let getDownloadURLFn = null;
let firebaseInitPromise = null;
let collection, doc, getDocs, getDoc, setDoc, deleteDoc, query, where, orderBy, serverTimestamp, writeBatch;

// Firebase Sync State
let syncInProgress = false;
let pendingOperations = [];
let syncTimeout = null;
let hasPendingChanges = false;
const SYNC_DEBOUNCE_DELAY = 3000; // 3 seconds
let deletionInProgress = false; // Prevent fetchFromFirebase during deletions
let deletedSupplierIds = new Set(); // Track deleted supplier IDs to prevent restoration
let deletedExpenseIds = new Set(); // Track deleted expense IDs to prevent restoration
const DELETION_TRACKING_TTL = 5 * 60 * 1000; // 5 minutes - short-lived client hint; tombstones below are permanent
let deletionTimestamps = new Map(); // Track when each supplier was deleted (supplierId -> timestamp)
let expenseDeletionTimestamps = new Map(); // Track when each expense was deleted (expenseId -> timestamp)

const PENDING_SYNC_EXPENSE_STORAGE_KEY = 'expenseTracker_pendingSyncIds';
/** Expense ids written locally but not yet confirmed on Firebase. */
let pendingSyncExpenseIds = new Set();

function persistPendingSyncExpenseIds() {
    try {
        localStorage.setItem(
            PENDING_SYNC_EXPENSE_STORAGE_KEY,
            JSON.stringify({ ids: Array.from(pendingSyncExpenseIds) })
        );
    } catch (error) {
        console.warn('Failed to persist pending sync expense ids:', error);
    }
}

function loadPendingSyncExpenseIdsFromStorage() {
    try {
        const raw = localStorage.getItem(PENDING_SYNC_EXPENSE_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        (data.ids || []).forEach((id) => {
            if (id) pendingSyncExpenseIds.add(id);
        });
    } catch (error) {
        console.warn('Failed to load pending sync expense ids:', error);
    }
}

function markExpensePendingSync(expenseId) {
    if (!expenseId) return;
    pendingSyncExpenseIds.add(expenseId);
    persistPendingSyncExpenseIds();
}

function clearExpensesPendingSync(expenseIds) {
    let changed = false;
    for (const id of expenseIds) {
        if (pendingSyncExpenseIds.delete(id)) changed = true;
    }
    if (changed) persistPendingSyncExpenseIds();
}

export function isExpensePendingSync(expenseId) {
    return pendingSyncExpenseIds.has(expenseId);
}

export function isSyncInProgress() {
    return syncInProgress;
}

export async function refreshExpensesFromRemote() {
    if (!db) return false;
    return fetchFromFirebase();
}

let firebasePollIntervalId = null;
const FIREBASE_POLL_VISIBLE_MS = 60 * 1000;
const FIREBASE_POLL_HIDDEN_MS = 5 * 60 * 1000;

function scheduleFirebasePoll() {
    if (firebasePollIntervalId) {
        clearInterval(firebasePollIntervalId);
        firebasePollIntervalId = null;
    }
    if (!db) return;
    const intervalMs =
        typeof document !== 'undefined' && document.visibilityState === 'hidden'
            ? FIREBASE_POLL_HIDDEN_MS
            : FIREBASE_POLL_VISIBLE_MS;
    firebasePollIntervalId = setInterval(() => {
        fetchFromFirebase()
            .then(() => {
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('expense-remote-updated'));
                }
            })
            .catch((err) => {
                console.warn('Periodic Firebase fetch failed:', err);
            });
    }, intervalMs);
}

function setupFirebasePollVisibilityHandler() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
        scheduleFirebasePoll();
    });
}

/** Supplier ids with a server tombstone (or local delete) — never re-merge from Firebase. Persisted. */
const PERMANENT_SUPPLIER_TOMBSTONE_STORAGE_KEY = 'expenseTracker_permanentSupplierTombstones';
let supplierTombstoneIds = new Set();

function persistPermanentSupplierTombstones() {
    try {
        localStorage.setItem(
            PERMANENT_SUPPLIER_TOMBSTONE_STORAGE_KEY,
            JSON.stringify({ ids: Array.from(supplierTombstoneIds) })
        );
    } catch (error) {
        console.warn('Failed to persist permanent supplier tombstones:', error);
    }
}

function loadPermanentSupplierTombstonesFromStorage() {
    try {
        const raw = localStorage.getItem(PERMANENT_SUPPLIER_TOMBSTONE_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        (data.ids || []).forEach((id) => {
            if (id) supplierTombstoneIds.add(id);
        });
    } catch (error) {
        console.warn('Failed to load permanent supplier tombstones:', error);
    }
}

/** Record supplier ids as permanently removed (merge/delete). Survives TTL cleanup. */
export function addPermanentSupplierTombstones(supplierIds) {
    if (!supplierIds?.length) return;
    let added = false;
    for (const id of supplierIds) {
        if (id && !supplierTombstoneIds.has(id)) {
            supplierTombstoneIds.add(id);
            added = true;
        }
    }
    if (added) persistPermanentSupplierTombstones();
}

/** Single-id convenience wrapper. */
export function addPermanentSupplierTombstone(supplierId) {
    if (supplierId) addPermanentSupplierTombstones([supplierId]);
}


// Server-side deletion propagation (prevents resurrecting deleted records from stale devices)
const COL_EXPENSE_DELETIONS = 'expense_deletions';
const COL_SUPPLIER_DELETIONS = 'supplier_deletions';
const FIRESTORE_BATCH_OP_LIMIT = 400;

function tombstonePayload() {
    return { deletedAt: serverTimestamp(), deviceId: getDeviceId() };
}

async function commitBatchOps(ops) {
    if (!db || !ops.length) {
        return;
    }
    for (let i = 0; i < ops.length; i += FIRESTORE_BATCH_OP_LIMIT) {
        const chunk = ops.slice(i, i + FIRESTORE_BATCH_OP_LIMIT);
        const batch = writeBatch(db);
        for (const op of chunk) {
            if (op.kind === 'set') {
                batch.set(op.ref, op.data, { merge: op.merge === true });
            } else {
                batch.delete(op.ref);
            }
        }
        await batch.commit();
    }
}
// Initialize Firebase and load dependencies
export async function initializeFirebase() {
    if (firebaseInitPromise) {
        return firebaseInitPromise;
    }

    try {
        // Already initialized
        if (db && storage && storageRefFn && uploadBytesFn && getDownloadURLFn) {
            return true;
        }

        firebaseInitPromise = (async () => {
        // Import Firebase configuration
        const firebaseConfig = await import('./firebase-config.js');
        const result = await firebaseConfig.initializeFirebaseConfig();
        
        if (!result) {
            console.log('Firebase config initialization failed');
            return false;
        }
        
        db = result.db;
        app = result.app;

        // Make db available globally for testing
        window.db = db;

        // Import Firestore functions
        const firestoreModule = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
        collection = firestoreModule.collection;
        doc = firestoreModule.doc;
        getDocs = firestoreModule.getDocs;
        getDoc = firestoreModule.getDoc;
        setDoc = firestoreModule.setDoc;
        deleteDoc = firestoreModule.deleteDoc;
        query = firestoreModule.query;
        where = firestoreModule.where;
        orderBy = firestoreModule.orderBy;
        serverTimestamp = firestoreModule.serverTimestamp;
        writeBatch = firestoreModule.writeBatch;

        // Import Storage functions (for receipt image URL migration / storage uploads)
        const storageModule = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js');
        storage = storageModule.getStorage(app);
        storageRefFn = storageModule.ref;
        uploadBytesFn = storageModule.uploadBytes;
        getDownloadURLFn = storageModule.getDownloadURL;

        console.log('Firebase initialized successfully');
        console.log('Database object:', db);
        setupBeforeUnloadSync();
        return true;
        })();

        const ok = await firebaseInitPromise;
        firebaseInitPromise = null;
        return ok;
    } catch (error) {
        console.error('Firebase initialization failed:', error);
        firebaseInitPromise = null;
        return false;
    }
}

// Data Management Functions
export function setExpenses(newExpenses) {
    const normalizedExpenses = normalizeExpensesReceiptState(newExpenses);
    expenses.length = 0;
    expenses.push(...normalizedExpenses);
}

export function setSuppliers(newSuppliers) {
    suppliers.length = 0;
    suppliers.push(...newSuppliers);
}

export function getExpenses() {
    return [...expenses];
}

// Approximate byte size of a base64 data URL.
function dataUrlByteSize(dataUrl) {
    if (typeof dataUrl !== 'string') return 0;
    const commaIdx = dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    // Each base64 char encodes 6 bits; 4 chars = 3 bytes.
    return Math.floor((base64.length * 3) / 4);
}

// Compress image before upload. Targets ~400-800KB at a readable resolution
// (up to ~1600px) so receipt text stays legible while uploads stay fast.
export async function compressImage(
    file,
    maxWidth = 1600,
    maxHeight = 1600,
    quality = 0.85,
    targetBytes = 800 * 1024
) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const qualityFloor = 0.5;
                const maxDimensionSteps = 3;

                let dataUrl = '';
                let q = quality;
                let dimensionStep = 0;

                while (dimensionStep <= maxDimensionSteps) {
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    q = quality;
                    dataUrl = canvas.toDataURL('image/jpeg', q);
                    while (dataUrlByteSize(dataUrl) > targetBytes && q > qualityFloor) {
                        q = Math.max(qualityFloor, q - 0.1);
                        dataUrl = canvas.toDataURL('image/jpeg', q);
                    }

                    if (dataUrlByteSize(dataUrl) <= targetBytes || dimensionStep === maxDimensionSteps) {
                        break;
                    }

                    // Still over target at quality floor — step dimensions down and retry.
                    width = Math.max(1, Math.round(width * 0.85));
                    height = Math.max(1, Math.round(height * 0.85));
                    dimensionStep += 1;
                }

                const finalKb = Math.round(dataUrlByteSize(dataUrl) / 1024);
                console.log(`[Receipt] compressed to ${finalKb}KB at ${width}x${height} q=${q.toFixed(2)}`);

                resolve(dataUrl);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Load an image for canvas operations (data URL or http(s)).
 * Remote URLs are fetched as blob to avoid tainted canvas when rotating.
 */
async function loadImageForCanvas(src) {
    if (typeof src !== 'string' || !src) {
        throw new Error('Invalid image source');
    }
    if (src.startsWith('data:')) {
        return await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('Failed to load image'));
            im.src = src;
        });
    }
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) {
        throw new Error('Failed to fetch image');
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    try {
        return await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('Failed to decode image'));
            im.src = objUrl;
        });
    } finally {
        URL.revokeObjectURL(objUrl);
    }
}

/**
 * Rotate receipt image 90°. direction 1 = clockwise, -1 = counter-clockwise.
 * Returns a new JPEG data URL.
 */
export async function rotateReceiptImage(src, direction, quality = 0.85) {
    const img = await loadImageForCanvas(src);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) {
        throw new Error('Invalid image dimensions');
    }
    const canvas = document.createElement('canvas');
    canvas.width = h;
    canvas.height = w;
    const ctx = canvas.getContext('2d');
    if (direction === 1) {
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, 0, 0);
    } else if (direction === -1) {
        ctx.translate(0, canvas.height);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, 0, 0);
    } else {
        throw new Error('direction must be 1 or -1');
    }
    return canvas.toDataURL('image/jpeg', quality);
}

// Fetch receipt image from Firebase for an expense
export async function fetchReceiptImageFromFirebase(expenseId) {
    if (!db || !expenseId) {
        return null;
    }
    
    try {
        // Add timeout to prevent endless loading (15 seconds)
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Receipt fetch timeout')), 15000);
        });
        
        const expenseRef = doc(db, 'expenses', expenseId);
        const fetchPromise = getDoc(expenseRef);
        
        const expenseSnap = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (expenseSnap.exists()) {
            const expenseData = expenseSnap.data();
            const receiptImage = await resolveReceiptUrlForExpense(expenseId, expenseData.receiptImage || null);
            if (receiptImage) {
                const updatedExpenses = expenses.map((expense) =>
                    expense.id === expenseId
                        ? normalizeExpenseReceiptState({ ...expense, receiptImage, hasReceiptImage: true })
                        : expense
                );
                setExpenses(updatedExpenses);
            }
            return receiptImage;
        }
        
        return null;
    } catch (error) {
        if (error.message === 'Receipt fetch timeout') {
            console.warn('Receipt image fetch timed out for expense:', expenseId);
        } else {
            console.error('Failed to fetch receipt image from Firebase:', error);
        }
        return null;
    }
}

// Upload a receipt image (stored as a data URL) to Firebase Storage, then return a public download URL.
// The calling code stores the URL in Firestore under `expenses.receiptImage`.
export async function uploadReceiptImageToStorage(expenseId, receiptDataUrl) {
    if (!expenseId || !receiptDataUrl || typeof receiptDataUrl !== 'string') {
        return null;
    }

    // Ensure Firebase (Firestore + Storage) is initialized.
    if (!db || !storage || !storageRefFn || !uploadBytesFn || !getDownloadURLFn) {
        const ok = await initializeFirebase();
        if (!ok) return null;
    }

    try {
        const mimeMatch = receiptDataUrl.match(/^data:([^;]+);base64,/);
        const contentType = mimeMatch?.[1] || 'image/jpeg';

        // Convert data URL -> Blob in-browser
        const blob = await (await fetch(receiptDataUrl)).blob();

        const fileRef = storageRefFn(storage, `expense-receipts/${expenseId}`);
        await uploadBytesFn(fileRef, blob, { contentType });
        const downloadUrl = await getDownloadURLFn(fileRef);

        cacheReceiptUrlForExpense(expenseId, downloadUrl);
        return downloadUrl;
    } catch (error) {
        console.warn('[ReceiptUpload] Failed to upload receipt image:', error);
        return null;
    }
}

const RECEIPT_URL_CACHE_KEY = 'expenseTracker_receiptUrls';

function readReceiptUrlCache() {
    try {
        const raw = localStorage.getItem(RECEIPT_URL_CACHE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function getCachedReceiptUrl(expenseId) {
    if (!expenseId) return null;
    const url = readReceiptUrlCache()[expenseId];
    return hasReceiptUrlValue(url) && !isReceiptDataUrl(url) ? url : null;
}

export function cacheReceiptUrlForExpense(expenseId, url) {
    if (!expenseId || !hasReceiptUrlValue(url) || isReceiptDataUrl(url)) return;
    try {
        const cache = readReceiptUrlCache();
        if (cache[expenseId] === url) return;
        cache[expenseId] = url;
        localStorage.setItem(RECEIPT_URL_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
        console.warn('Failed to cache receipt URL:', error);
    }
}

function removeCachedReceiptUrl(expenseId) {
    if (!expenseId) return;
    try {
        const cache = readReceiptUrlCache();
        if (!cache[expenseId]) return;
        delete cache[expenseId];
        localStorage.setItem(RECEIPT_URL_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
        console.warn('Failed to remove cached receipt URL:', error);
    }
}

async function getStorageReceiptDownloadUrl(expenseId) {
    if (!expenseId) return null;
    if (!storage || !storageRefFn || !getDownloadURLFn) {
        const ok = await initializeFirebase();
        if (!ok) return null;
    }
    try {
        const fileRef = storageRefFn(storage, `expense-receipts/${expenseId}`);
        return await getDownloadURLFn(fileRef);
    } catch {
        return null;
    }
}

/** Resolve receipt URL: Firestore field → local cache → Firebase Storage file. */
async function resolveReceiptUrlForExpense(expenseId, firestoreUrl = null) {
    if (!expenseId) return null;
    if (hasReceiptUrlValue(firestoreUrl)) {
        if (!isReceiptDataUrl(firestoreUrl)) {
            cacheReceiptUrlForExpense(expenseId, firestoreUrl);
        }
        return firestoreUrl;
    }
    const cached = getCachedReceiptUrl(expenseId);
    if (cached) return cached;
    const storageUrl = await getStorageReceiptDownloadUrl(expenseId);
    if (hasReceiptUrlValue(storageUrl)) {
        cacheReceiptUrlForExpense(expenseId, storageUrl);
        return storageUrl;
    }
    return null;
}

function applyCachedReceiptUrlsToExpenses(expenseList) {
    return expenseList.map((expense) => {
        if (!expense?.id || !expense.hasReceiptImage || hasReceiptUrlValue(expense.receiptImage)) {
            if (expense?.id && hasReceiptUrlValue(expense.receiptImage) && !isReceiptDataUrl(expense.receiptImage)) {
                cacheReceiptUrlForExpense(expense.id, expense.receiptImage);
            }
            return expense;
        }
        const cached = getCachedReceiptUrl(expense.id);
        if (!cached) return expense;
        return normalizeExpenseReceiptState({ ...expense, receiptImage: cached, hasReceiptImage: true });
    });
}

/** Restore receipt URLs from cache, Firestore, and Storage for all expenses that need them. */
export async function rehydrateAllExpenseReceiptUrls() {
    let didMutate = false;
    for (let i = 0; i < expenses.length; i++) {
        const e = expenses[i];
        if (!e?.id || deletedExpenseIds.has(e.id)) continue;
        if (!e.hasReceiptImage) continue;

        if (hasReceiptUrlValue(e.receiptImage) && !isReceiptDataUrl(e.receiptImage)) {
            cacheReceiptUrlForExpense(e.id, e.receiptImage);
            continue;
        }

        const url = await resolveReceiptUrlForExpense(
            e.id,
            hasReceiptUrlValue(e.receiptImage) ? e.receiptImage : null
        );
        if (url) {
            expenses[i] = normalizeExpenseReceiptState({ ...e, receiptImage: url, hasReceiptImage: true });
            didMutate = true;
        }
    }
    if (didMutate) {
        setExpenses(expenses);
        hasPendingChanges = true;
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('expense-receipts-updated'));
        }
    }
    return didMutate;
}

export function getSuppliers() {
    return [...suppliers];
}

/** Match an expense to a supplier row: supplierId only (no name fallback). */
export function expenseBelongsToSupplier(expense, supplier) {
    return !!(expense?.supplierId && supplier?.id && expense.supplierId === supplier.id);
}

export function normalizeSupplierNameKey(name) {
    return (name || '').trim().toLowerCase();
}

/** Suppliers whose display name normalizes to the same key (for migration UI). */
export function groupSuppliersByNormalizedName(supplierList) {
    /** @type {Map<string, object[]>} */
    const map = new Map();
    for (const s of supplierList || []) {
        const k = normalizeSupplierNameKey(s.name);
        if (!k) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(s);
    }
    return map;
}

/**
 * Pure analysis for supplierId migration (Firestore or localStorage).
 * @returns {{ withId: object[], assignable: { expense: object, supplierId: string, supplier: object }[], ambiguous: { key: string, suppliers: object[], expenses: object[] }[], orphans: object[] }}
 */
export function analyzeSupplierIdMigration(supplierList, expenseList) {
    const withId = [];
    const assignable = [];
    /** @type {Map<string, { key: string, suppliers: object[], expenses: object[] }>} */
    const ambiguousMap = new Map();
    const orphans = [];

    const byName = groupSuppliersByNormalizedName(supplierList);

    for (const expense of expenseList || []) {
        if (expense.supplierId) {
            withId.push(expense);
            continue;
        }
        const key = normalizeSupplierNameKey(expense.supplierName);
        if (!key) {
            orphans.push(expense);
            continue;
        }
        const matches = byName.get(key) || [];
        if (matches.length === 0) {
            orphans.push(expense);
        } else if (matches.length === 1) {
            assignable.push({ expense, supplierId: matches[0].id, supplier: matches[0] });
        } else {
            if (!ambiguousMap.has(key)) {
                ambiguousMap.set(key, { key, suppliers: matches, expenses: [] });
            }
            ambiguousMap.get(key).expenses.push(expense);
        }
    }

    return {
        withId,
        assignable,
        ambiguous: Array.from(ambiguousMap.values()),
        orphans
    };
}

/**
 * Merge denormalized supplier fields onto an expense (migration + consistency).
 */
export function applySupplierSnapshotToExpense(expense, supplier) {
    if (!supplier?.id) return { ...expense };
    return {
        ...expense,
        supplierId: supplier.id,
        supplierName: supplier.name,
        businessName: supplier.businessName || expense.businessName || '',
        tin: supplier.tin || expense.tin || '',
        address: supplier.address || expense.address || '',
        isVatRegistered: !!supplier.isVatRegistered,
        updatedAt: new Date().toISOString()
    };
}

/**
 * Build updated expense list after migration choices.
 * @param {object[]} expenseList
 * @param {object[]} supplierList
 * @param {Record<string, string>} nameKeyToSupplierId - normalized name -> chosen supplier id for ambiguous groups
 */
export function buildExpensesWithResolvedSupplierIds(expenseList, supplierList, nameKeyToSupplierId = {}) {
    const byId = new Map((supplierList || []).map((s) => [s.id, s]));
    const analysis = analyzeSupplierIdMigration(supplierList, expenseList);
    const assignByExpenseId = new Map(analysis.assignable.map((a) => [a.expense.id, a]));

    return expenseList.map((expense) => {
        if (expense.supplierId) return expense;

        const key = normalizeSupplierNameKey(expense.supplierName);
        if (!key) return expense;

        const single = assignByExpenseId.get(expense.id);
        if (single) {
            const sup = byId.get(single.supplierId);
            return sup ? applySupplierSnapshotToExpense(expense, sup) : { ...expense, supplierId: single.supplierId };
        }

        const chosenId = nameKeyToSupplierId[key];
        if (chosenId) {
            const sup = byId.get(chosenId);
            return sup ? applySupplierSnapshotToExpense(expense, sup) : { ...expense, supplierId: chosenId };
        }

        return expense;
    });
}

export function addExpense(expense) {
    if (!expense.isPettyCash && expense.supplierName && expense.supplierName.trim()) {
        const sid = saveSupplierIfNew(expense);
        if (sid) expense.supplierId = expense.supplierId || sid;
    }
    // Upsert by id so a double-tapped Save can't create a duplicate local row.
    const existingIndex = expense.id ? expenses.findIndex((e) => e.id === expense.id) : -1;
    if (existingIndex >= 0) {
        expenses[existingIndex] = expense;
    } else {
        expenses.push(expense);
    }
    if (hasReceiptUrlValue(expense.receiptImage) && !isReceiptDataUrl(expense.receiptImage)) {
        cacheReceiptUrlForExpense(expense.id, expense.receiptImage);
    }
    markExpensePendingSync(expense.id);
    saveToLocalStorage();
    invalidateItemMatchesCache();
}

export function updateExpense(expenseId, updatedExpense) {
    const index = expenses.findIndex(e => e.id === expenseId);
    if (index > -1) {
        updatedExpense.updatedAt = new Date().toISOString();
        if (
            !updatedExpense.isPettyCash &&
            updatedExpense.supplierName &&
            updatedExpense.supplierName.trim()
        ) {
            const knownId = updatedExpense.supplierId;
            const supplierRowKnown =
                knownId && suppliers.some((s) => s.id === knownId);
            // Avoid saveSupplierIfNew when this expense already links to a real supplier row.
            // Otherwise (e.g. admin edit updates expenses before updateSupplier), a renamed
            // supplier name can fail name-match against the not-yet-updated row and create a duplicate.
            if (!supplierRowKnown) {
                const sid = saveSupplierIfNew(updatedExpense);
                if (sid) updatedExpense.supplierId = updatedExpense.supplierId || sid;
            }
        }
        expenses[index] = updatedExpense;
        if (hasReceiptUrlValue(updatedExpense.receiptImage) && !isReceiptDataUrl(updatedExpense.receiptImage)) {
            cacheReceiptUrlForExpense(expenseId, updatedExpense.receiptImage);
        }
        markExpensePendingSync(expenseId);
        saveToLocalStorage();
        invalidateItemMatchesCache();
        return true;
    }
    return false;
}

export async function deleteExpense(expenseId) {
    const index = expenses.findIndex(e => e.id === expenseId);
    if (index > -1) {
        const expense = expenses[index];
        
        // Set deletion flag to prevent fetchFromFirebase from running
        deletionInProgress = true;
        
        // Track deletion immediately with permanent timestamp
        deletedExpenseIds.add(expenseId);
        pendingSyncExpenseIds.delete(expenseId);
        removeCachedReceiptUrl(expenseId);
        persistPendingSyncExpenseIds();
        expenseDeletionTimestamps.set(expenseId, Date.now());
        
        // Persist deletion tracking to localStorage immediately
        try {
            const trackingData = {
                ids: Array.from(deletedExpenseIds),
                timestamps: Object.fromEntries(expenseDeletionTimestamps)
            };
            localStorage.setItem('expenseTracker_deletedExpenses', JSON.stringify(trackingData));
            invalidateItemMatchesCache();
            console.log('Deletion tracking saved to localStorage for expense:', expenseId);
        } catch (error) {
            console.warn('Failed to save expense deletion tracking:', error);
        }
        
        try {
            // Remove from local array FIRST to prevent it from being displayed
            expenses.splice(index, 1);
            
            // Force immediate localStorage save to ensure deletion is persisted locally
            try {
                const expensesForStorage = stripReceiptImagesForStorage(expenses);
                const expensesJson = JSON.stringify(expensesForStorage);
                const suppliersJson = JSON.stringify(suppliers);
                localStorage.setItem('expenseTracker_expenses', expensesJson);
                localStorage.setItem('expenseTracker_suppliers', suppliersJson);
                console.log('Expense removed from localStorage:', expenseId);
            } catch (error) {
                console.error('Failed to save to localStorage:', error);
            }
            
        // Write a deletion tombstone so other devices won't resurrect this expense.
        if (db) {
            try {
                await setDoc(
                    doc(db, COL_EXPENSE_DELETIONS, expenseId),
                    tombstonePayload(),
                    { merge: true }
                );
            } catch (error) {
                console.warn('Failed to write expense deletion tombstone:', error);
            }
        }
        
            // DELETE EXPENSE FROM FIREBASE - fire and forget for speed
            // Don't wait for sync, just mark for deletion and let background sync handle it
            if (db) {
                // Delete from Firebase asynchronously without blocking
                deleteDoc(doc(db, 'expenses', expenseId)).then(() => {
                    console.log('Expense successfully deleted from Firebase:', expenseId);
                }).catch(error => {
                    console.error('Failed to delete expense from Firebase:', error);
                    // Even if Firebase deletion fails, we still track it locally
                    // syncToFirebase() will handle the deletion on next sync
                });
            }
            
            // Mark for background sync instead of waiting
            if (db) {
                hasPendingChanges = true;
            }
            
            return true;
        } finally {
            // Clear deletion flag quickly - deletion tracking will prevent restoration
            setTimeout(() => {
                deletionInProgress = false;
                console.log('Deletion flag cleared for expense:', expenseId);
            }, 500); // Reduced to 500ms - deletion tracking handles prevention
        }
    }
    return false;
}

export function addSupplier(supplier) {
    suppliers.push(supplier);
    saveToLocalStorage();
}

export function updateSupplier(supplierId, updatedSupplier) {
    const index = suppliers.findIndex(s => s.id === supplierId);
    if (index > -1) {
        updatedSupplier.updatedAt = new Date().toISOString();
        suppliers[index] = updatedSupplier;
        saveToLocalStorage();
        return true;
    }
    return false;
}

/**
 * @param {boolean} deleteAssociatedExpenses
 * @param {{ skipPostDeleteSync?: boolean }} [options] - If skipPostDeleteSync, skip full sync after delete (caller must sync). Used by merge.
 */
export async function deleteSupplier(supplierId, deleteAssociatedExpenses = true, options = {}) {
    const skipPostDeleteSync = Boolean(options && options.skipPostDeleteSync);
    const index = suppliers.findIndex(s => s.id === supplierId);
    if (index > -1) {
        const supplier = suppliers[index];
        
        // Set deletion flag to prevent fetchFromFirebase from running
        deletionInProgress = true;
        
        // Track deletion immediately
        deletedSupplierIds.add(supplierId);
        deletionTimestamps.set(supplierId, Date.now());
        addPermanentSupplierTombstone(supplierId);

        // Persist deletion tracking to localStorage
        try {
            const trackingData = {
                ids: Array.from(deletedSupplierIds),
                timestamps: Object.fromEntries(deletionTimestamps)
            };
            localStorage.setItem('expenseTracker_deletedSuppliers', JSON.stringify(trackingData));
        } catch (error) {
            console.warn('Failed to save deletion tracking:', error);
        }

        // Write a supplier deletion tombstone so other devices don't resurrect it.
        if (db) {
            try {
                await setDoc(
                    doc(db, COL_SUPPLIER_DELETIONS, supplierId),
                    tombstonePayload(),
                    { merge: true }
                );
            } catch (error) {
                console.warn('Failed to write supplier deletion tombstone:', error);
            }
        }
        
        try {
            // Delete associated expenses if requested
            if (deleteAssociatedExpenses) {
                const expensesToDelete = expenses.filter((e) => e.supplierId === supplierId);

                // Mark associated expenses as deleted (permanent) for cross-device safety.
                if (expensesToDelete.length > 0) {
                    const now = Date.now();
                    expensesToDelete.forEach(expense => {
                        deletedExpenseIds.add(expense.id);
                        expenseDeletionTimestamps.set(expense.id, now);
                    });

                    // Persist expense deletion tracking to localStorage immediately.
                    try {
                        const trackingData = {
                            ids: Array.from(deletedExpenseIds),
                            timestamps: Object.fromEntries(expenseDeletionTimestamps)
                        };
                        localStorage.setItem('expenseTracker_deletedExpenses', JSON.stringify(trackingData));
                    } catch (error) {
                        console.warn('Failed to save expense deletion tracking for supplier delete:', error);
                    }

                    // Write tombstones for those expenses (prevents resurrecting from stale devices).
                    if (db) {
                        try {
                            const ops = expensesToDelete.map(expense => ({
                                kind: 'set',
                                ref: doc(db, COL_EXPENSE_DELETIONS, expense.id),
                                data: tombstonePayload(),
                                merge: true
                            }));
                            await commitBatchOps(ops);
                        } catch (error) {
                            console.warn('Failed to write expense deletion tombstones:', error);
                        }
                    }
                }
                
                // Delete expenses from Firebase
                if (db && expensesToDelete.length > 0) {
                    try {
                        const ops = expensesToDelete.map(expense => ({
                            kind: 'delete',
                            ref: doc(db, 'expenses', expense.id)
                        }));
                        await commitBatchOps(ops);
                        console.log(`Deleted ${expensesToDelete.length} associated expense(s) from Firebase`);
                    } catch (error) {
                        console.error('Failed to delete associated expenses from Firebase:', error);
                    }
                }
                
                // Remove expenses from local array
                expensesToDelete.forEach(expense => {
                    const expenseIndex = expenses.findIndex(e => e.id === expense.id);
                    if (expenseIndex > -1) {
                        expenses.splice(expenseIndex, 1);
                    }
                });
                
                if (expensesToDelete.length > 0) {
                    console.log(
                        `Deleted ${expensesToDelete.length} associated expense(s) for supplier "${supplier.name}"`
                    );
                }
            }
            
            // DELETE SUPPLIER FROM FIREBASE - before removing from local array
            // This ensures Firebase deletion completes before any sync can run
            if (db) {
                try {
                    const supplierRef = doc(db, 'suppliers', supplierId);
                    await deleteDoc(supplierRef);
                    console.log('Supplier deleted from Firebase:', supplierId);
                } catch (error) {
                    console.error('Failed to delete supplier from Firebase:', error);
                    // Even if Firebase deletion fails, we still track it locally
                    // syncToFirebase() will handle the deletion on next sync
                }
            }
            
            // Remove from local array
            suppliers.splice(index, 1);
            
            // Force immediate sync to ensure deletion is persisted
            // Don't use saveToLocalStorage() here to avoid debounce delay
            try {
                const expensesForStorage = stripReceiptImagesForStorage(expenses);
                const expensesJson = JSON.stringify(expensesForStorage);
                const suppliersJson = JSON.stringify(suppliers);
                localStorage.setItem('expenseTracker_expenses', expensesJson);
                localStorage.setItem('expenseTracker_suppliers', suppliersJson);
            } catch (error) {
                console.error('Failed to save to localStorage:', error);
            }
            
            // Trigger immediate sync to Firebase (merge passes skipPostDeleteSync and syncs once at end)
            if (db && !skipPostDeleteSync && !syncInProgress) {
                await syncToFirebase();
            } else {
                hasPendingChanges = true;
            }
            
            return true;
        } finally {
            // Clear deletion flag after a short delay to ensure deletion is fully processed
            setTimeout(() => {
                deletionInProgress = false;
            }, 1000);
        }
    }
    return false;
}

/**
 * Merge source suppliers into a target. Rewrites expenses to the target supplier identity
 * and deletes merged supplier rows (same behavior as mobile performSupplierMerge).
 * @param {((step: number, total: number, message: string) => void) | null} onProgress - optional UI progress (step 1..total)
 */
export async function mergeSuppliersIntoTarget(targetSupplierId, sourceSupplierIds, onProgress = null) {
    if (!targetSupplierId || !sourceSupplierIds?.length) {
        return { success: false, error: 'Invalid arguments', deleted: 0, transferred: 0 };
    }

    const target = suppliers.find((s) => s.id === targetSupplierId);
    if (!target) {
        return { success: false, error: 'Target supplier not found', deleted: 0, transferred: 0 };
    }

    const idSet = new Set(sourceSupplierIds.filter((id) => id && id !== targetSupplierId));
    const sources = [...idSet].map((id) => suppliers.find((s) => s.id === id)).filter(Boolean);
    if (!sources.length) {
        return { success: false, error: 'No suppliers to merge', deleted: 0, transferred: 0 };
    }

    const report = (step, total, message) => {
        if (typeof onProgress === 'function') {
            try {
                onProgress(step, total, message);
            } catch (e) {
                console.warn('merge onProgress:', e);
            }
        }
    };

    const sourceIdSet = new Set(sources.map((s) => s.id));

    let transferred = 0;
    const now = new Date().toISOString();
    const updatedExpenses = expenses.map((expense) => {
        if (sourceIdSet.has(expense.supplierId)) {
            transferred++;
            return {
                ...expense,
                supplierId: target.id,
                supplierName: target.name,
                businessName: target.businessName || expense.businessName,
                tin: target.tin || expense.tin,
                address: target.address || expense.address,
                isVatRegistered: target.isVatRegistered,
                updatedAt: now,
            };
        }
        return expense;
    });

    const supplierIdsToRemove = new Set(sources.map((s) => s.id));
    const suppliersToDelete = [...sources];
    const sourceNamesLower = new Set(sources.map((s) => s.name.toLowerCase()));
    sourceNamesLower.forEach((nameToMatch) => {
        suppliers.forEach((supplier) => {
            if (
                supplier.id !== target.id &&
                !supplierIdsToRemove.has(supplier.id) &&
                supplier.name.toLowerCase() === nameToMatch
            ) {
                const hasExpenses = updatedExpenses.some((e) => e.supplierId === supplier.id);
                if (!hasExpenses) {
                    suppliersToDelete.push(supplier);
                    supplierIdsToRemove.add(supplier.id);
                }
            }
        });
    });

    const uniqueSuppliersToDelete = suppliersToDelete.filter(
        (supplier, index, self) => index === self.findIndex((s) => s.id === supplier.id)
    );

    const totalSteps = 1 + uniqueSuppliersToDelete.length;
    report(1, totalSteps, 'Saving merged expenses…');

    setExpenses(updatedExpenses);
    saveToLocalStorage();
    invalidateItemMatchesCache();

    let deleted = 0;
    for (let i = 0; i < uniqueSuppliersToDelete.length; i++) {
        const supplier = uniqueSuppliersToDelete[i];
        const step = 2 + i;
        const nm = supplier.name || supplier.id;
        report(step, totalSteps, `Removing "${nm}"…`);
        const ok = await deleteSupplier(supplier.id, false, { skipPostDeleteSync: true });
        if (ok) deleted++;
    }

    try {
        if (db && !syncInProgress) {
            await syncToFirebase();
        } else if (db) {
            hasPendingChanges = true;
        }
    } catch (err) {
        console.error('mergeSuppliersIntoTarget: final sync failed', err);
        if (db) hasPendingChanges = true;
    }

    return { success: true, deleted, transferred };
}

// Optimized bulk deletion function - deletes multiple suppliers efficiently
// progressCallback: optional function(current, total, message) called to report progress
// deleteAssociatedExpenses: if true, also deletes all expenses associated with the suppliers
export async function deleteSuppliersBulk(supplierIds, progressCallback = null, deleteAssociatedExpenses = true) {
    if (!supplierIds || supplierIds.length === 0) {
        return { success: false, deleted: 0, failed: 0, errors: [], expensesDeleted: 0 };
    }

    const total = supplierIds.length;
    
    // Set deletion flag to prevent fetchFromFirebase from running
    deletionInProgress = true;

    const results = {
        success: true,
        deleted: 0,
        failed: 0,
        errors: [],
        expensesDeleted: 0
    };

    try {
        // Progress: Tracking deletions
        if (progressCallback) {
            progressCallback(0, total, 'Preparing deletions...');
        }

        // Find suppliers and collect associated expenses
        const suppliersToDelete = [];
        const expensesToDelete = [];
        
        supplierIds.forEach(supplierId => {
            const supplier = suppliers.find(s => s.id === supplierId);
            if (supplier) {
                suppliersToDelete.push(supplier);
                
                // Collect associated expenses if requested
                if (deleteAssociatedExpenses) {
                    const supplierExpenses = expenses.filter((e) => e.supplierId === supplierId);
                    expensesToDelete.push(...supplierExpenses);
                }
            }
        });

        // Track all deletions immediately
        const now = Date.now();
        supplierIds.forEach(supplierId => {
            deletedSupplierIds.add(supplierId);
            deletionTimestamps.set(supplierId, now);
        });
        addPermanentSupplierTombstones(supplierIds);

        // Persist deletion tracking to localStorage
        try {
            const trackingData = {
                ids: Array.from(deletedSupplierIds),
                timestamps: Object.fromEntries(deletionTimestamps)
            };
            localStorage.setItem('expenseTracker_deletedSuppliers', JSON.stringify(trackingData));
        } catch (error) {
            console.warn('Failed to save deletion tracking:', error);
        }

        // Progress: Preparing batch
        if (progressCallback) {
            const expenseMsg = deleteAssociatedExpenses && expensesToDelete.length > 0
                ? ` and ${expensesToDelete.length} expense${expensesToDelete.length === 1 ? '' : 's'}`
                : '';
            progressCallback(Math.floor(total * 0.1), total, `Preparing batch deletion${expenseMsg}...`);
        }

        // Delete all suppliers and associated expenses from Firebase in batches
        if (db) {
            try {
                const ops = [];
                const suppliersToRemove = [];

                supplierIds.forEach((supplierId) => {
                    ops.push({
                        kind: 'set',
                        ref: doc(db, COL_SUPPLIER_DELETIONS, supplierId),
                        data: tombstonePayload(),
                        merge: true
                    });
                });
                
                // Add expense deletions to batch if requested
                if (deleteAssociatedExpenses && expensesToDelete.length > 0) {
                    expensesToDelete.forEach(expense => {
                        ops.push({
                            kind: 'delete',
                            ref: doc(db, 'expenses', expense.id)
                        });
                    });
                }
                
                // Find suppliers in local array and prepare batch deletions
                supplierIds.forEach((supplierId, idx) => {
                    const index = suppliers.findIndex(s => s.id === supplierId);
                    if (index > -1) {
                        suppliersToRemove.push({ index, id: supplierId });
                        ops.push({
                            kind: 'delete',
                            ref: doc(db, 'suppliers', supplierId)
                        });
                    }
                    
                    // Progress: Building batch
                    if (progressCallback && idx % Math.max(1, Math.floor(total / 4)) === 0) {
                        progressCallback(Math.floor(total * 0.2) + Math.floor(idx / total * 0.2), total, `Preparing deletion ${idx + 1} of ${total}...`);
                    }
                });

                // Progress: Committing to Firebase
                if (progressCallback) {
                    const expenseMsg = deleteAssociatedExpenses && expensesToDelete.length > 0
                        ? ` and ${expensesToDelete.length} expense${expensesToDelete.length === 1 ? '' : 's'}`
                        : '';
                    progressCallback(Math.floor(total * 0.4), total, `Deleting ${suppliersToRemove.length} supplier${suppliersToRemove.length === 1 ? '' : 's'}${expenseMsg} from Firebase...`);
                }

                // Commit all deletions in one batch operation
                if (ops.length > 0) {
                    await commitBatchOps(ops);
                    console.log(`Bulk deleted ${suppliersToRemove.length} suppliers${deleteAssociatedExpenses && expensesToDelete.length > 0 ? ` and ${expensesToDelete.length} expenses` : ''} from Firebase`);
                    
                    // Progress: Updating local state
                    if (progressCallback) {
                        progressCallback(Math.floor(total * 0.6), total, 'Updating local data...');
                    }
                    
                    // Remove expenses from local array
                    if (deleteAssociatedExpenses && expensesToDelete.length > 0) {
                        expensesToDelete.forEach(expense => {
                            const expenseIndex = expenses.findIndex(e => e.id === expense.id);
                            if (expenseIndex > -1) {
                                expenses.splice(expenseIndex, 1);
                            }
                        });
                        results.expensesDeleted = expensesToDelete.length;
                    }
                    
                    // Remove suppliers from local array (in reverse order to maintain indices)
                    suppliersToRemove.sort((a, b) => b.index - a.index);
                    suppliersToRemove.forEach(({ index }) => {
                        suppliers.splice(index, 1);
                    });
                    
                    results.deleted = suppliersToRemove.length;
                }

                // Handle suppliers not found in local array (already deleted or invalid)
                const foundIds = new Set(suppliersToRemove.map(s => s.id));
                supplierIds.forEach(supplierId => {
                    if (!foundIds.has(supplierId)) {
                        results.failed++;
                        results.errors.push(`Supplier ${supplierId} not found in local array`);
                    }
                });

            } catch (error) {
                console.error('Failed to bulk delete suppliers from Firebase:', error);
                results.success = false;
                results.failed = supplierIds.length;
                results.errors.push(`Firebase batch deletion failed: ${error.message}`);
                
                // Progress: Error handling
                if (progressCallback) {
                    progressCallback(Math.floor(total * 0.5), total, 'Error occurred, cleaning up...');
                }
                
                // Even if Firebase deletion fails, still remove from local array if they exist
                supplierIds.forEach(supplierId => {
                    const index = suppliers.findIndex(s => s.id === supplierId);
                    if (index > -1) {
                        suppliers.splice(index, 1);
                        results.deleted++;
                    }
                });
                
                // Also remove expenses from local array if deletion was requested
                if (deleteAssociatedExpenses && expensesToDelete.length > 0) {
                    expensesToDelete.forEach(expense => {
                        const expenseIndex = expenses.findIndex(e => e.id === expense.id);
                        if (expenseIndex > -1) {
                            expenses.splice(expenseIndex, 1);
                        }
                    });
                    results.expensesDeleted = expensesToDelete.length;
                }
            }
        } else {
            // No Firebase - just remove from local array
            if (progressCallback) {
                const expenseMsg = deleteAssociatedExpenses && expensesToDelete.length > 0
                    ? ` and ${expensesToDelete.length} expense${expensesToDelete.length === 1 ? '' : 's'}`
                    : '';
                progressCallback(Math.floor(total * 0.3), total, `Removing from local storage${expenseMsg}...`);
            }
            
            // Remove expenses from local array if requested
            if (deleteAssociatedExpenses && expensesToDelete.length > 0) {
                expensesToDelete.forEach(expense => {
                    const expenseIndex = expenses.findIndex(e => e.id === expense.id);
                    if (expenseIndex > -1) {
                        expenses.splice(expenseIndex, 1);
                    }
                });
                results.expensesDeleted = expensesToDelete.length;
            }
            
            supplierIds.forEach((supplierId, idx) => {
                const index = suppliers.findIndex(s => s.id === supplierId);
                if (index > -1) {
                    suppliers.splice(index, 1);
                    results.deleted++;
                } else {
                    results.failed++;
                }
                
                // Progress: Local deletion
                if (progressCallback) {
                    progressCallback(Math.floor(total * 0.3) + Math.floor((idx + 1) / total * 0.3), total, `Removing supplier ${idx + 1} of ${total}...`);
                }
            });
        }

        // Progress: Saving to localStorage
        if (progressCallback) {
            progressCallback(Math.floor(total * 0.8), total, 'Saving changes...');
        }

        // Save to localStorage
        try {
            const expensesForStorage = stripReceiptImagesForStorage(expenses);
            const expensesJson = JSON.stringify(expensesForStorage);
            const suppliersJson = JSON.stringify(suppliers);
            localStorage.setItem('expenseTracker_expenses', expensesJson);
            localStorage.setItem('expenseTracker_suppliers', suppliersJson);
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }

        // Progress: Syncing to Firebase
        if (progressCallback) {
            progressCallback(Math.floor(total * 0.9), total, 'Syncing to Firebase...');
        }

        // Trigger ONE sync to Firebase at the end (instead of after each deletion)
        if (db && !syncInProgress && results.deleted > 0) {
            await syncToFirebase();
        } else if (results.deleted > 0) {
            // Mark for sync if sync is in progress
            hasPendingChanges = true;
        }

        // Progress: Complete
        if (progressCallback) {
            progressCallback(total, total, 'Deletion complete');
        }

        return results;
    } finally {
        // Clear deletion flag after a short delay to ensure deletion is fully processed
        setTimeout(() => {
            deletionInProgress = false;
        }, 1000);
    }
}

// Storage Functions
export function loadFromLocalStorage() {
    try {
        const savedExpenses = localStorage.getItem('expenseTracker_expenses');
        const savedSuppliers = localStorage.getItem('expenseTracker_suppliers');
        
        // Check if localStorage was completely cleared (no expenses AND no suppliers)
        const isLocalStorageEmpty = !savedExpenses && !savedSuppliers;

        // No local expenses means nothing to protect — allow Firebase to restore them.
        let hasNoLocalExpenses = !savedExpenses;
        if (savedExpenses) {
            try {
                hasNoLocalExpenses = JSON.parse(savedExpenses).length === 0;
            } catch {
                hasNoLocalExpenses = true;
            }
        }

        // Permanent supplier tombstones must load before suppliers so merged-away rows stay out of memory.
        if (isLocalStorageEmpty || hasNoLocalExpenses) {
            if (isLocalStorageEmpty) {
                console.log('LocalStorage was cleared - resetting deletion tracking to allow Firebase restore');
            } else {
                console.log('No local expenses - clearing expense deletion tracking to allow Firebase restore');
            }
            deletedExpenseIds.clear();
            expenseDeletionTimestamps.clear();
            localStorage.removeItem('expenseTracker_deletedExpenses');
            if (isLocalStorageEmpty) {
                deletedSupplierIds.clear();
                deletionTimestamps.clear();
                supplierTombstoneIds.clear();
                localStorage.removeItem('expenseTracker_deletedSuppliers');
                localStorage.removeItem(PERMANENT_SUPPLIER_TOMBSTONE_STORAGE_KEY);
            }
        } else {
            loadPermanentSupplierTombstonesFromStorage();
        }

        loadPendingSyncExpenseIdsFromStorage();

        if (savedExpenses) {
            const parsedExpenses = JSON.parse(savedExpenses);
            setExpenses(applyCachedReceiptUrlsToExpenses(parsedExpenses));
            console.log('Loaded expenses from localStorage:', expenses.length, 'items');
        }

        if (savedSuppliers) {
            const parsedSuppliers = JSON.parse(savedSuppliers);
            const filteredSuppliers = parsedSuppliers.filter((s) => !supplierTombstoneIds.has(s.id));
            if (filteredSuppliers.length !== parsedSuppliers.length) {
                setSuppliers(filteredSuppliers);
                try {
                    localStorage.setItem('expenseTracker_suppliers', JSON.stringify(filteredSuppliers));
                } catch (e) {
                    console.warn('Failed to persist suppliers after tombstone filter:', e);
                }
                console.log(
                    'Loaded suppliers from localStorage (dropped',
                    parsedSuppliers.length - filteredSuppliers.length,
                    'tombstoned row(s)):',
                    filteredSuppliers.length,
                    'items'
                );
            } else {
                setSuppliers(parsedSuppliers);
                console.log('Loaded suppliers from localStorage:', suppliers.length, 'items');
            }
        }

        // Load deletion tracking BEFORE processing expenses to prevent deleted items from being restored
        try {
            // Load supplier deletion tracking
            const supplierTrackingData = localStorage.getItem('expenseTracker_deletedSuppliers');
            if (supplierTrackingData) {
                const tracking = JSON.parse(supplierTrackingData);
                const now = Date.now();
                
                // Only keep recent deletions (within TTL)
                tracking.ids.forEach(id => {
                    const deletedAt = tracking.timestamps[id] || 0;
                    if (now - deletedAt < DELETION_TRACKING_TTL) {
                        deletedSupplierIds.add(id);
                        deletionTimestamps.set(id, deletedAt);
                    }
                });
            }
            
            // Load expense deletion tracking
            const expenseTrackingData = localStorage.getItem('expenseTracker_deletedExpenses');
            if (expenseTrackingData) {
                const tracking = JSON.parse(expenseTrackingData);
                
                // Keep ALL expense deletions permanently (no TTL check)
                // This ensures deleted expenses never get restored from Firebase
                tracking.ids.forEach(id => {
                    const deletedAt = tracking.timestamps[id] || 0;
                    deletedExpenseIds.add(id);
                    expenseDeletionTimestamps.set(id, deletedAt);
                    console.log('Loaded deleted expense ID from localStorage (permanent):', id);
                });
                
                console.log('Loaded expense deletion tracking:', deletedExpenseIds.size, 'deleted expenses');
            }
            
            // Clean up old deletions
            cleanupOldDeletions();
            
            // Remove deleted expenses from loaded expenses
            if (deletedExpenseIds.size > 0 && expenses.length > 0) {
                const originalLength = expenses.length;
                const filteredExpenses = expenses.filter(expense => {
                    if (deletedExpenseIds.has(expense.id)) {
                        const deletionTime = expenseDeletionTimestamps.get(expense.id) || 0;
                        console.log('Filtering out deleted expense from localStorage:', expense.id, { deletionTime });
                        // Expense deletions are permanent and should never be restored from localStorage.
                        return false;
                    }
                    return true;
                });
                
                if (filteredExpenses.length < originalLength) {
                    console.log('Filtered out', originalLength - filteredExpenses.length, 'deleted expenses from localStorage');
                    setExpenses(filteredExpenses);
                    // Save the filtered expenses back to localStorage
                    try {
                        const expensesForStorage = stripReceiptImagesForStorage(filteredExpenses);
                        localStorage.setItem('expenseTracker_expenses', JSON.stringify(expensesForStorage));
                    } catch (error) {
                        console.warn('Failed to save filtered expenses:', error);
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to load deletion tracking:', error);
        }

        return expenses.length > 0 || suppliers.length > 0;
    } catch (error) {
        console.error('Failed to load from localStorage:', error);
        return false;
    }
}

// Helper function to strip receipt images from expenses before saving to localStorage
function stripReceiptImagesForStorage(expensesArray) {
    const normalizedExpenses = normalizeExpensesReceiptState(expensesArray);
    return normalizedExpenses.map(expense => {
        const { receiptImage, ...expenseWithoutImage } = expense;
        // Add flag to indicate receipt exists in Firebase
        if (receiptImage) {
            expenseWithoutImage.hasReceiptImage = true;
        }
        return expenseWithoutImage;
    });
}

// Clean up old deletion tracking entries
function cleanupOldDeletions() {
    const now = Date.now();
    const supplierToRemove = [];
    // NOTE: expenseToRemove is not used - expense deletions are kept permanently
    
    // Clean up old supplier deletions (never drop ids that still have a permanent tombstone)
    deletedSupplierIds.forEach(id => {
        if (supplierTombstoneIds.has(id)) return;
        const deletedAt = deletionTimestamps.get(id) || 0;
        if (now - deletedAt >= DELETION_TRACKING_TTL) {
            supplierToRemove.push(id);
        }
    });
    
    supplierToRemove.forEach(id => {
        deletedSupplierIds.delete(id);
        deletionTimestamps.delete(id);
    });
    
    // NOTE: Expense deletions are kept PERMANENTLY - never clean them up
    // This ensures that once an expense is deleted, it stays deleted forever
    // and will never be restored from Firebase, even after page refresh
    // We do NOT process expenseToRemove - expense deletions are permanent
    
    // Persist cleaned tracking for suppliers only
    if (supplierToRemove.length > 0) {
        try {
            const trackingData = {
                ids: Array.from(deletedSupplierIds),
                timestamps: Object.fromEntries(deletionTimestamps)
            };
            localStorage.setItem('expenseTracker_deletedSuppliers', JSON.stringify(trackingData));
        } catch (error) {
            console.warn('Failed to save cleaned supplier deletion tracking:', error);
        }
    }
    
    // Expense deletions are never cleaned up - they persist permanently
}

export function saveToLocalStorage() {
    try {
        // Strip receipt images from expenses before saving to localStorage to prevent quota exceeded errors
        // Receipt images are stored in Firebase, so we only need a flag in localStorage
        for (const e of expenses) {
            if (e?.id && hasReceiptUrlValue(e.receiptImage) && !isReceiptDataUrl(e.receiptImage)) {
                cacheReceiptUrlForExpense(e.id, e.receiptImage);
            }
        }
        setExpenses(expenses);
        const expensesForStorage = stripReceiptImagesForStorage(expenses);
        const expensesJson = JSON.stringify(expensesForStorage);
        const suppliersJson = JSON.stringify(suppliers);
        
        localStorage.setItem('expenseTracker_expenses', expensesJson);
        localStorage.setItem('expenseTracker_suppliers', suppliersJson);
        console.log('Data saved to localStorage (receipt images excluded)');

        // Mark that we have pending changes
        hasPendingChanges = true;

        // Clear existing timeout if there is one
        if (syncTimeout) {
            clearTimeout(syncTimeout);
        }

        // Set new timeout for debounced sync
        syncTimeout = setTimeout(() => {
            syncTimeout = null;
            if (hasPendingChanges && db) {
                syncToFirebase();
            }
        }, SYNC_DEBOUNCE_DELAY);

        console.log('Sync scheduled for 3 seconds from now');
    } catch (error) {
        console.error('Failed to save to localStorage:', error);
        
        // Handle quota exceeded error specifically
        if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
            console.warn('localStorage quota exceeded. Data size:', {
                expenses: expenses.length,
                suppliers: suppliers.length,
                expensesSize: new Blob([JSON.stringify(expenses)]).size,
                suppliersSize: new Blob([JSON.stringify(suppliers)]).size
            });
            
            // Try to show user-friendly error message if showSyncStatus exists
            if (typeof showSyncStatus === 'function') {
                showSyncStatus('⚠ Storage full - syncing to Firebase only', 'error');
            }
            
            // Force immediate Firebase sync since localStorage is full
            if (db && hasPendingChanges) {
                console.log('Forcing immediate Firebase sync due to localStorage quota exceeded');
                syncToFirebase();
            }
        }
    }
}

/**
 * localStorage strips receiptImage; restore URL from Firestore before sync so in-memory state
 * and any code paths still see the URL. Merge writes already prevent wiping the server field.
 */
async function rehydrateStrippedReceiptUrlsFromFirestore() {
    return rehydrateAllExpenseReceiptUrls();
}

function hasReceiptUrlValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeExpenseReceiptState(expense) {
    if (!expense || typeof expense !== 'object') return expense;
    const normalized = { ...expense };
    const hasUrl = hasReceiptUrlValue(normalized.receiptImage);
    if (hasUrl) {
        normalized.hasReceiptImage = true;
    } else if (normalized.receiptImage === null) {
        normalized.hasReceiptImage = false;
    } else if (normalized.hasReceiptImage === true) {
        normalized.hasReceiptImage = true;
    } else if (normalized.hasReceiptImage === false) {
        normalized.hasReceiptImage = false;
    }
    return normalized;
}

function normalizeExpensesReceiptState(expensesArray = []) {
    return expensesArray.map((expense) => normalizeExpenseReceiptState(expense));
}

function isReceiptDataUrl(value) {
    return typeof value === 'string' && value.startsWith('data:');
}

async function enrichExpenseWithServerReceiptUrl(expense) {
    if (!db || !expense?.id) return normalizeExpenseReceiptState(expense);
    const normalizedExpense = normalizeExpenseReceiptState(expense);
    if (
        normalizedExpense.hasReceiptImage !== true ||
        hasReceiptUrlValue(normalizedExpense.receiptImage) ||
        normalizedExpense.receiptImage === null
    ) {
        return normalizedExpense;
    }
    try {
        const snap = await getDoc(doc(db, 'expenses', normalizedExpense.id));
        const serverUrl = snap.exists() ? snap.data()?.receiptImage : null;
        const resolved = await resolveReceiptUrlForExpense(normalizedExpense.id, serverUrl);
        if (hasReceiptUrlValue(resolved)) {
            return normalizeExpenseReceiptState({
                ...normalizedExpense,
                receiptImage: resolved,
                hasReceiptImage: true
            });
        }
    } catch (error) {
        console.warn('[Sync] Failed server receipt fallback for expense:', normalizedExpense.id, error);
    }
    return normalizedExpense;
}

/** Upload inline receipt data URLs before Firestore write; never send base64 in a document. */
async function prepareExpenseForFirestoreSync(rawExpense) {
    let expense = await enrichExpenseWithServerReceiptUrl(rawExpense);
    expense = normalizeExpenseReceiptState(expense);

    if (isReceiptDataUrl(expense.receiptImage)) {
        const url = await uploadReceiptImageToStorage(expense.id, expense.receiptImage);
        if (url) {
            expense = normalizeExpenseReceiptState({
                ...expense,
                receiptImage: url,
                hasReceiptImage: true
            });
        }
    } else if (expense.hasReceiptImage && !hasReceiptUrlValue(expense.receiptImage)) {
        const resolved = await resolveReceiptUrlForExpense(expense.id);
        if (resolved) {
            expense = normalizeExpenseReceiptState({
                ...expense,
                receiptImage: resolved,
                hasReceiptImage: true
            });
        }
    } else if (hasReceiptUrlValue(expense.receiptImage)) {
        cacheReceiptUrlForExpense(expense.id, expense.receiptImage);
    }

    const idx = expenses.findIndex((e) => e.id === expense.id);
    if (idx >= 0) {
        expenses[idx] = expense;
    }
    return expense;
}

function buildFirestoreExpensePayload(expense) {
    const data = {
        ...expense,
        syncedAt: serverTimestamp(),
        deviceId: getDeviceId()
    };
    // Firestore documents are capped at 1 MiB — never write base64 receipt blobs.
    if (isReceiptDataUrl(data.receiptImage) || !hasReceiptUrlValue(data.receiptImage)) {
        delete data.receiptImage;
        if (expense.hasReceiptImage) {
            data.hasReceiptImage = true;
        }
    } else {
        data.hasReceiptImage = true;
        cacheReceiptUrlForExpense(expense.id, data.receiptImage);
    }
    return data;
}

/** Cancel debounced sync and push to Firebase immediately. */
export async function flushPendingSync() {
    if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
    }
    if (!db) {
        return { ok: false, reason: 'offline' };
    }
    if (!hasPendingChanges) {
        hasPendingChanges = true;
    }
    try {
        await syncToFirebase();
        return { ok: !hasPendingChanges };
    } catch (error) {
        console.error('flushPendingSync failed:', error);
        hasPendingChanges = true;
        return { ok: false, reason: error?.message || 'sync-failed' };
    }
}

// Persist the current expenses/suppliers to localStorage WITHOUT scheduling a full sync.
// Used by the fast single-expense sync path so it doesn't trigger a heavy full sync.
function persistExpensesToLocalStorageOnly() {
    try {
        const expensesForStorage = stripReceiptImagesForStorage(expenses);
        localStorage.setItem('expenseTracker_expenses', JSON.stringify(expensesForStorage));
        localStorage.setItem('expenseTracker_suppliers', JSON.stringify(suppliers));
    } catch (error) {
        console.warn('Failed to persist expenses to localStorage:', error);
    }
}

/**
 * Fast path: sync a single expense (and its supplier) to Firebase.
 * Uploads the receipt to Storage if needed and only clears pending state once the
 * receipt URL is confirmed, so "synced" never lies about a missing photo.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function syncExpenseToFirebase(expenseId) {
    if (!expenseId) return { ok: false, reason: 'no-id' };
    if (!db) {
        const ok = await initializeFirebase();
        if (!ok) return { ok: false, reason: 'offline' };
    }
    if (deletedExpenseIds.has(expenseId)) return { ok: false, reason: 'deleted' };

    const idx = expenses.findIndex((e) => e.id === expenseId);
    if (idx < 0) return { ok: false, reason: 'not-found' };

    try {
        const hadInlineReceipt = isReceiptDataUrl(expenses[idx].receiptImage);
        const prepared = await prepareExpenseForFirestoreSync(expenses[idx]);
        expenses[idx] = prepared;

        const receiptExpected = prepared.hasReceiptImage === true || hadInlineReceipt;
        const receiptResolved =
            hasReceiptUrlValue(prepared.receiptImage) && !isReceiptDataUrl(prepared.receiptImage);

        // Write the expense document (metadata + resolved URL when available).
        await setDoc(
            doc(db, 'expenses', prepared.id),
            buildFirestoreExpensePayload(prepared),
            { merge: true }
        );

        // Write its supplier if present locally and not tombstoned.
        if (prepared.supplierId) {
            const supplier = suppliers.find((s) => s.id === prepared.supplierId);
            if (supplier && !deletedSupplierIds.has(supplier.id) && !supplierTombstoneIds.has(supplier.id)) {
                await setDoc(
                    doc(db, 'suppliers', supplier.id),
                    { ...supplier, syncedAt: serverTimestamp(), deviceId: getDeviceId() },
                    { merge: true }
                );
            }
        }

        persistExpensesToLocalStorageOnly();

        if (receiptExpected && !receiptResolved) {
            // Metadata is in Firebase but the photo isn't — keep it pending so the badge stays honest.
            markExpensePendingSync(prepared.id);
            return { ok: false, reason: 'receipt-upload-failed' };
        }

        clearExpensesPendingSync([prepared.id]);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('expense-sync-updated'));
        }
        return { ok: true };
    } catch (error) {
        console.error('syncExpenseToFirebase failed:', error);
        markExpensePendingSync(expenseId);
        return { ok: false, reason: error?.message || 'sync-failed' };
    }
}

// Firebase Sync Functions
export async function syncToFirebase() {
    if (!db || syncInProgress) {
        console.log('Database not available or sync in progress');
        return;
    }

    syncInProgress = true;

    try {
        console.log('Starting Firebase sync...');

        // Clean up old deletions before syncing
        cleanupOldDeletions();

        // Refresh server-side tombstones so cross-device deletions can't be resurrected
        // during this sync, even if this device hasn't fetched recently.
        try {
            const [expenseDeletionsSnapshot, supplierDeletionsSnapshot] = await Promise.all([
                getDocs(collection(db, COL_EXPENSE_DELETIONS)),
                getDocs(collection(db, COL_SUPPLIER_DELETIONS))
            ]);

            const now = Date.now();
            const toMillis = (ts) => {
                if (!ts) return now;
                if (typeof ts.toMillis === 'function') return ts.toMillis();
                if (typeof ts.seconds === 'number') return ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6;
                return now;
            };

            expenseDeletionsSnapshot.docs.forEach(tombstoneDoc => {
                const deletedAtMs = toMillis(tombstoneDoc.data()?.deletedAt);
                deletedExpenseIds.add(tombstoneDoc.id);
                expenseDeletionTimestamps.set(tombstoneDoc.id, deletedAtMs);
            });

            addPermanentSupplierTombstones(supplierDeletionsSnapshot.docs.map((d) => d.id));
            supplierDeletionsSnapshot.docs.forEach(tombstoneDoc => {
                const deletedAtMs = toMillis(tombstoneDoc.data()?.deletedAt);
                deletedSupplierIds.add(tombstoneDoc.id);
                deletionTimestamps.set(tombstoneDoc.id, deletedAtMs);
            });

            // Persist updated deletion tracking so reloads remain consistent.
            try {
                const expenseTracking = {
                    ids: Array.from(deletedExpenseIds),
                    timestamps: Object.fromEntries(expenseDeletionTimestamps)
                };
                localStorage.setItem('expenseTracker_deletedExpenses', JSON.stringify(expenseTracking));
            } catch (error) {
                console.warn('Failed to persist expense deletion tracking from tombstones during sync:', error);
            }

            try {
                const supplierTracking = {
                    ids: Array.from(deletedSupplierIds),
                    timestamps: Object.fromEntries(deletionTimestamps)
                };
                localStorage.setItem('expenseTracker_deletedSuppliers', JSON.stringify(supplierTracking));
            } catch (error) {
                console.warn('Failed to persist supplier deletion tracking from tombstones during sync:', error);
            }
        } catch (error) {
            console.warn('Failed to refresh tombstones during sync:', error);
        }

        // Fetch current Firebase suppliers to find what needs to be deleted
        let firebaseSupplierIds = new Set();
        if (db) {
            try {
                const suppliersSnapshot = await getDocs(collection(db, 'suppliers'));
                firebaseSupplierIds = new Set(suppliersSnapshot.docs.map(doc => doc.id));
            } catch (error) {
                console.warn('Failed to fetch Firebase suppliers for deletion check:', error);
            }
        }

        // Build operations list and commit in chunks to respect Firestore batch limits.
        // Tombstoned items are never recreated.
        const ops = [];
        const syncedExpenseIds = [];

        // Track local expense IDs
        const localExpenseIds = new Set();

        // Track local supplier IDs
        const localSupplierIds = new Set();

        setExpenses(expenses);

        for (const rawExpense of expenses) {
            localExpenseIds.add(rawExpense.id);
            if (deletedExpenseIds.has(rawExpense.id)) {
                continue; // deleted remotely; never recreate on this device
            }
            // Only push writes for expenses that still need syncing. Everything else is
            // already on the server, so re-writing it every sync is wasteful/slow.
            if (!pendingSyncExpenseIds.has(rawExpense.id)) {
                continue;
            }
            // prepareExpenseForFirestoreSync uploads the receipt to Storage and resolves its URL.
            const expense = await prepareExpenseForFirestoreSync(rawExpense);
            ops.push({
                kind: 'set',
                ref: doc(db, 'expenses', expense.id),
                merge: true,
                data: buildFirestoreExpensePayload(expense)
            });
            // Only clear pending once the receipt is confirmed (or there is no receipt),
            // so a synced badge never hides a missing photo.
            const receiptExpected = expense.hasReceiptImage === true;
            const receiptResolved =
                hasReceiptUrlValue(expense.receiptImage) && !isReceiptDataUrl(expense.receiptImage);
            if (!receiptExpected || receiptResolved) {
                syncedExpenseIds.push(expense.id);
            }
        }
        
        // Get Firebase expense IDs for deletion check
        let firebaseExpenseIds = new Set();
        if (db) {
            try {
                const expensesSnapshot = await getDocs(collection(db, 'expenses'));
                firebaseExpenseIds = new Set(expensesSnapshot.docs.map(doc => doc.id));
            } catch (error) {
                console.warn('Failed to fetch Firebase expenses for deletion check:', error);
            }
        }
        
        // Delete expenses from Firebase that:
        // 1. Are in Firebase but not in local array (was deleted locally), OR
        // 2. Are explicitly in deletion tracking (explicitly marked for deletion)
        let expenseDeletionCount = 0;
        firebaseExpenseIds.forEach(expenseId => {
            const isNotInLocal = !localExpenseIds.has(expenseId);
            const isInDeletionTracking = deletedExpenseIds.has(expenseId);

            // Delete if expense was removed from local OR explicitly marked for deletion
            if (isNotInLocal || isInDeletionTracking) {
                ops.push({
                    kind: 'delete',
                    ref: doc(db, 'expenses', expenseId)
                });
                expenseDeletionCount++;
                const reason = isInDeletionTracking ? 'deletion tracking' : 'not in local array';
                console.log(`Marking expense for deletion in Firebase (${reason}):`, expenseId);
            }
        });

        // Sync suppliers that exist locally (tombstoned suppliers are skipped)
        suppliers.forEach(supplier => {
            localSupplierIds.add(supplier.id);
            if (deletedSupplierIds.has(supplier.id) || supplierTombstoneIds.has(supplier.id)) {
                return; // deleted remotely; never recreate on this device
            }
            ops.push({
                kind: 'set',
                ref: doc(db, 'suppliers', supplier.id),
                merge: true,
                data: {
                    ...supplier,
                    syncedAt: serverTimestamp(),
                    deviceId: getDeviceId()
                }
            });
        });

        // Delete suppliers from Firebase that:
        // 1. Are in Firebase but not in local array (was deleted locally), OR
        // 2. Are explicitly in deletion tracking (explicitly marked for deletion)
        let deletionCount = 0;
        firebaseSupplierIds.forEach(supplierId => {
            const isNotInLocal = !localSupplierIds.has(supplierId);
            const isInDeletionTracking =
                deletedSupplierIds.has(supplierId) || supplierTombstoneIds.has(supplierId);

            // Delete if supplier was removed from local OR explicitly marked for deletion
            if (isNotInLocal || isInDeletionTracking) {
                ops.push({
                    kind: 'delete',
                    ref: doc(db, 'suppliers', supplierId)
                });
                deletionCount++;
                const reason = isInDeletionTracking ? 'deletion tracking' : 'not in local array';
                console.log(`Marking supplier for deletion in Firebase (${reason}):`, supplierId);
            }
        });

        await commitBatchOps(ops);
        clearExpensesPendingSync(syncedExpenseIds);
        if (typeof window !== 'undefined' && syncedExpenseIds.length > 0) {
            window.dispatchEvent(new CustomEvent('expense-sync-updated'));
        }
        console.log('Firebase sync completed successfully', { 
            expenses: expenses.length, 
            suppliers: suppliers.length,
            supplierDeletions: deletionCount,
            expenseDeletions: expenseDeletionCount
        });
        showSyncStatus('✓ Synced', 'success');

        // Clear deletion tracking for successfully synced supplier deletions.
        // Expense deletions are permanent; never clear `deletedExpenseIds` to avoid resurrection.
        if (deletionCount > 0) {
            // Re-fetch to verify deletions
            try {
                const suppliersSnapshot = await getDocs(collection(db, 'suppliers'));
                const remainingIds = new Set(suppliersSnapshot.docs.map(doc => doc.id));
                
                deletedSupplierIds.forEach(id => {
                    // If supplier is not in Firebase anymore and not in local, clear tracking
                    if (!remainingIds.has(id) && !localSupplierIds.has(id)) {
                        deletedSupplierIds.delete(id);
                        deletionTimestamps.delete(id);
                    }
                });
                
                // Persist updated supplier tracking
                try {
                    const trackingData = {
                        ids: Array.from(deletedSupplierIds),
                        timestamps: Object.fromEntries(deletionTimestamps)
                    };
                    localStorage.setItem('expenseTracker_deletedSuppliers', JSON.stringify(trackingData));
                } catch (error) {
                    console.warn('Failed to persist supplier deletion tracking:', error);
                }
            } catch (error) {
                console.warn('Failed to verify deletions:', error);
            }
        }

        // Clear pending changes flag on successful sync
        hasPendingChanges = false;
    } catch (error) {
        console.error('Firebase sync failed:', error);
        showSyncStatus('⚠ Sync failed - will retry', 'error');
        hasPendingChanges = true;

        // Queue for retry
        setTimeout(() => {
            if (!syncInProgress && hasPendingChanges) {
                syncToFirebase();
            }
        }, 5000);
    } finally {
        syncInProgress = false;
    }
}

// Strip heavy/legacy receipt blobs from a remote expense so the feed stays text-only.
// Keeps an http(s) receipt URL if present; otherwise just the hasReceiptImage flag.
function sanitizeExpenseFromRemote(rawDoc) {
    const { receiptImage, ...rest } = rawDoc;
    const clean = { ...rest };
    if (isReceiptDataUrl(receiptImage)) {
        // Never keep base64 blobs in memory/localStorage (huge + slow).
        clean.hasReceiptImage = true;
    } else if (hasReceiptUrlValue(receiptImage)) {
        clean.receiptImage = receiptImage;
        clean.hasReceiptImage = true;
    } else if (rest.hasReceiptImage) {
        clean.hasReceiptImage = true;
    }
    return clean;
}

export async function fetchFromFirebase(options = {}) {
    const { rehydrateReceipts = false } = options;
    if (!db) {
        console.log('Database not available for fetching');
        return;
    }

    // Don't fetch while deletions are in progress
    if (deletionInProgress) {
        console.log('Skipping fetch - deletion in progress');
        return;
    }

    try {
        console.log('Fetching data from Firebase...');

        const [expensesSnapshot, suppliersSnapshot, expenseDeletionsSnapshot, supplierDeletionsSnapshot] = await Promise.all([
            getDocs(collection(db, 'expenses')),
            getDocs(collection(db, 'suppliers')),
            getDocs(collection(db, COL_EXPENSE_DELETIONS)),
            getDocs(collection(db, COL_SUPPLIER_DELETIONS))
        ]);

        // Apply server-side tombstones to prevent cross-device resurrection.
        const now = Date.now();
        const toMillis = (ts) => {
            if (!ts) return now;
            if (typeof ts.toMillis === 'function') return ts.toMillis();
            if (typeof ts.seconds === 'number') return ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6;
            return now;
        };

        expenseDeletionsSnapshot.docs.forEach(tombstoneDoc => {
            const deletedAtMs = toMillis(tombstoneDoc.data()?.deletedAt);
            deletedExpenseIds.add(tombstoneDoc.id);
            expenseDeletionTimestamps.set(tombstoneDoc.id, deletedAtMs);
        });

        addPermanentSupplierTombstones(supplierDeletionsSnapshot.docs.map((d) => d.id));
        supplierDeletionsSnapshot.docs.forEach(tombstoneDoc => {
            const deletedAtMs = toMillis(tombstoneDoc.data()?.deletedAt);
            deletedSupplierIds.add(tombstoneDoc.id);
            deletionTimestamps.set(tombstoneDoc.id, deletedAtMs);
        });

        // Persist updated deletion tracking so reloads remain consistent.
        try {
            const expenseTracking = {
                ids: Array.from(deletedExpenseIds),
                timestamps: Object.fromEntries(expenseDeletionTimestamps)
            };
            localStorage.setItem('expenseTracker_deletedExpenses', JSON.stringify(expenseTracking));
        } catch (error) {
            console.warn('Failed to persist expense deletion tracking from tombstones:', error);
        }

        try {
            const supplierTracking = {
                ids: Array.from(deletedSupplierIds),
                timestamps: Object.fromEntries(deletionTimestamps)
            };
            localStorage.setItem('expenseTracker_deletedSuppliers', JSON.stringify(supplierTracking));
        } catch (error) {
            console.warn('Failed to persist supplier deletion tracking from tombstones:', error);
        }

        const firebaseExpenses = expensesSnapshot.docs.map(doc => sanitizeExpenseFromRemote({
            id: doc.id,
            ...doc.data()
        }));
        const normalizedFirebaseExpenses = normalizeExpensesReceiptState(firebaseExpenses);

        const firebaseSuppliers = suppliersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Merge with local data (smart conflict resolution)
        const mergeResult = mergeData(
            { expenses, suppliers },
            { expenses: normalizedFirebaseExpenses, suppliers: firebaseSuppliers }
        );

        if (mergeResult.hasChanges) {
            const normalizedMergedExpenses = normalizeExpensesReceiptState(mergeResult.expenses);
            setExpenses(normalizedMergedExpenses);
            setSuppliers(mergeResult.suppliers);
            saveToLocalStorage();
            console.log('Data updated from Firebase');
            showSyncStatus('↓ Updated', 'success');
        } else {
            console.log('Local data is up to date');
        }

        // Feed only needs text data; receipts are loaded lazily when an expense is opened.
        // Only rehydrate receipt URLs when explicitly requested (e.g. startup).
        if (rehydrateReceipts) {
            await rehydrateAllExpenseReceiptUrls();
        }
        return mergeResult.hasChanges;

    } catch (error) {
        console.error('Failed to fetch from Firebase:', error);
        showSyncStatus('⚠ Fetch failed', 'error');
        return false;
    }
}

// Smart data merging with conflict resolution
function mergeData(localData, firebaseData) {
    let hasChanges = false;
    const mergedExpenses = [...localData.expenses];
    const mergedSuppliers = [...localData.suppliers];
    
    // If local expenses are empty, allow Firebase expenses to be restored even when suppliers exist locally.
    const isLocalDataEmpty = localData.expenses.length === 0;

    // Merge expenses
    firebaseData.expenses.forEach(firebaseItem => {
        // Check if this expense was deleted locally
        // BUT: If local data is empty, ignore deletion tracking to allow full restore
        const wasDeleted = !isLocalDataEmpty && deletedExpenseIds.has(firebaseItem.id);
        
        if (wasDeleted) {
            // Expense was deleted - don't restore it if we have local data
            // This ensures deletions persist even if Firebase sync hasn't completed yet
            console.log('Skipping deleted expense from Firebase (permanent deletion):', firebaseItem.id);
            return;
        }
        
        const localIndex = mergedExpenses.findIndex(item => item.id === firebaseItem.id);

        if (localIndex === -1) {
            // New item from Firebase - only add if it wasn't deleted
            if (!wasDeleted) {
                mergedExpenses.push(firebaseItem);
                hasChanges = true;
            }
        } else {
            // Expense exists in both - check if it was deleted
            if (wasDeleted) {
                // Don't overwrite local deletion with Firebase data
                console.log('Skipping merge for deleted expense:', firebaseItem.id);
                return;
            }
            
            // Conflict resolution: use newer timestamp
            const localItem = mergedExpenses[localIndex];
            const firebaseUpdated = new Date(firebaseItem.updatedAt || firebaseItem.createdAt);
            const localUpdated = new Date(localItem.updatedAt || localItem.createdAt);
            const firebaseHasUrl = hasReceiptUrlValue(firebaseItem?.receiptImage);
            const localHasUrl = hasReceiptUrlValue(localItem?.receiptImage);

            if (firebaseUpdated > localUpdated) {
                const mergedFirebaseWinner = { ...firebaseItem };
                if (!firebaseHasUrl && localHasUrl) {
                    mergedFirebaseWinner.receiptImage = localItem.receiptImage;
                    mergedFirebaseWinner.hasReceiptImage = true;
                } else if (!firebaseHasUrl && !localHasUrl && (localItem.hasReceiptImage || firebaseItem.hasReceiptImage)) {
                    mergedFirebaseWinner.hasReceiptImage = true;
                }
                mergedExpenses[localIndex] = normalizeExpenseReceiptState(mergedFirebaseWinner);
                hasChanges = true;
            } else if (!localHasUrl && firebaseHasUrl) {
                const mergedLocalWinner = normalizeExpenseReceiptState({
                    ...localItem,
                    receiptImage: firebaseItem.receiptImage,
                    hasReceiptImage: true
                });
                mergedExpenses[localIndex] = mergedLocalWinner;
                hasChanges = true;
            } else if (localHasUrl && !firebaseHasUrl && firebaseUpdated.getTime() === localUpdated.getTime()) {
                // Same revision — keep local receipt URL if Firebase row lost the field.
                mergedExpenses[localIndex] = normalizeExpenseReceiptState({
                    ...localItem,
                    hasReceiptImage: true
                });
            }
        }
    });
    
    // Remove any expenses that were deleted from the merged array (permanent removal)
    for (let i = mergedExpenses.length - 1; i >= 0; i--) {
        const expenseId = mergedExpenses[i].id;
        if (deletedExpenseIds.has(expenseId)) {
            // Always remove deleted expenses, regardless of TTL
            console.log('Removing deleted expense from merged array:', expenseId);
            mergedExpenses.splice(i, 1);
            hasChanges = true;
        }
    }

    // Clean up old deletions before merging
    cleanupOldDeletions();

    // Merge suppliers with smart logic
    firebaseData.suppliers.forEach(firebaseItem => {
        const tombstoned = !isLocalDataEmpty && supplierTombstoneIds.has(firebaseItem.id);
        if (tombstoned) {
            const localIndex = mergedSuppliers.findIndex(item => item.id === firebaseItem.id);
            if (localIndex !== -1) {
                mergedSuppliers.splice(localIndex, 1);
                hasChanges = true;
                console.log('Removed tombstoned supplier from merged data:', firebaseItem.id, firebaseItem.name);
            }
            return;
        }

        const localIndex = mergedSuppliers.findIndex(item => item.id === firebaseItem.id);

        if (localIndex === -1) {
            // Supplier exists in Firebase but not locally
            // Firebase is the source of truth - add it unless it was recently deleted locally
            
            // Check if this supplier was recently deleted locally (within TTL)
            // BUT: If local data is empty, ignore deletion tracking to allow full restore
            const wasRecentlyDeleted = !isLocalDataEmpty && deletedSupplierIds.has(firebaseItem.id);
            const deletionTime = deletionTimestamps.get(firebaseItem.id) || 0;
            const timeSinceDeletion = Date.now() - deletionTime;
            
            if (wasRecentlyDeleted && timeSinceDeletion < DELETION_TRACKING_TTL) {
                // Recently deleted locally - don't restore it (deletion is still in progress)
                console.log('Skipping recently deleted supplier from Firebase:', firebaseItem.id, firebaseItem.name);
                return;
            }
            
            // Add supplier from Firebase (source of truth)
            // Suppliers are independent entities and should exist regardless of local expenses
            mergedSuppliers.push(firebaseItem);
            hasChanges = true;
            console.log('Adding supplier from Firebase:', firebaseItem.id, firebaseItem.name);
        } else {
            // Supplier exists in both - merge/update logic
            const localItem = mergedSuppliers[localIndex];
            
            // Don't overwrite local if it was recently deleted (unless local data is empty)
            const wasRecentlyDeleted = !isLocalDataEmpty && deletedSupplierIds.has(firebaseItem.id);
            if (wasRecentlyDeleted) {
                console.log('Skipping merge for recently deleted supplier:', firebaseItem.id);
                return;
            }
            
            // If local data is empty, always use Firebase (full restore)
            if (isLocalDataEmpty) {
                mergedSuppliers[localIndex] = firebaseItem;
                hasChanges = true;
                return;
            }
            
            // Conflict resolution: use newer timestamp
            const firebaseUpdated = new Date(firebaseItem.updatedAt || firebaseItem.createdAt);
            const localUpdated = new Date(localItem.updatedAt || localItem.createdAt);

            if (firebaseUpdated > localUpdated) {
                mergedSuppliers[localIndex] = firebaseItem;
                hasChanges = true;
            }
        }
    });

    return {
        expenses: mergedExpenses,
        suppliers: mergedSuppliers,
        hasChanges
    };
}

// Device Management
export function getDeviceId() {
    let deviceId = localStorage.getItem('expenseTracker_deviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('expenseTracker_deviceId', deviceId);
    }
    return deviceId;
}

// Utility Functions
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Date Utility Functions
export function getTodayLocal() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function formatDate(dateString) {
    const date = new Date(dateString);
    const currentYear = new Date().getFullYear();
    const dateYear = date.getFullYear();

    if (dateYear === currentYear) {
        // Same year - show just month and day
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    } else {
        // Different year - include year but no weekday
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
}

export function formatDateDisplay(dateString, showToday = true) {
    if (!dateString) return '';
    
    const date = new Date(dateString + 'T00:00:00'); // Parse as local time
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (showToday && date.getTime() === today.getTime()) {
        return "Today's";
    }
    
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });
}

export function getThisWeekRange() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    return {
        start: startOfWeek.toISOString().split('T')[0],
        end: endOfWeek.toISOString().split('T')[0]
    };
}

// Currency Formatting Functions
export function formatCurrency(amount) {
    const numAmount = parseFloat(amount) || 0;
    return '₱' + numAmount.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    });
}

export function formatPesoInput(input) {
    let value = input.value.replace(/[₱,]/g, '');
    if (value && !isNaN(value)) {
        input.value = formatCurrency(value);
    }
}

export function getPesoValue(input) {
    if (typeof input === 'string') {
        // If input is a string, parse it directly
        return parseFloat(input.replace(/[₱,]/g, '')) || 0;
    }
    // If input is an input element, get its value
    return parseFloat(input.value.replace(/[₱,]/g, '')) || 0;
}

// CSV Functions
export function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

export function parseExpenseFromCSV(headers, values) {
    const data = {};

    // Map CSV columns to data object
    headers.forEach((header, index) => {
        data[header.toLowerCase().replace(/[^a-z0-9]/g, '')] = values[index] || '';
    });

    console.log('Mapped data:', data);

    // Detect format type - check for different CSV formats
    const hasAccountingColumns = headers.some(h =>
        h.toLowerCase().includes('particulars') ||
        h.toLowerCase().includes('vatable') ||
        h.toLowerCase().includes('input') ||
        h.toLowerCase().includes('grosstaxable')
    );

    const hasMatchaneseFormat = headers.some(h =>
        h.toLowerCase().replace(/"/g, '').includes('item') &&
        headers.some(h2 => h2.toLowerCase().replace(/"/g, '').includes('supplier')) &&
        headers.some(h3 => h3.toLowerCase().replace(/"/g, '').includes('paid via')) &&
        headers.some(h4 => h4.toLowerCase().replace(/"/g, '').includes('category'))
    );

    const hasStandardColumns = headers.some(h =>
        h.toLowerCase().includes('item') &&
        headers.some(h2 => h2.toLowerCase().includes('supplier'))
    );

    console.log('Format detection:', {
        hasAccountingColumns,
        hasMatchaneseFormat,
        hasStandardColumns,
        headers
    });

    // Prioritize formats in order: Matchanese > Accounting > Standard
    if (hasMatchaneseFormat) {
        console.log('Using Matchanese format parser');
        return parseMatchaneseFormatCSV(data, headers, values);
    } else if (hasAccountingColumns && !hasStandardColumns) {
        console.log('Using Accounting format parser');
        return parseAccountingFormatCSV(data, headers, values);
    } else {
        console.log('Using Standard format parser');
        return parseStandardFormatCSV(data);
    }
}

function parseAccountingFormatCSV(data, headers, values) {
    console.log('Parsing accounting format with values:', values);

    // Skip completely empty rows
    if (values.every(val => !val || val.trim() === '')) {
        console.log('Skipping empty row');
        return null;
    }

    // Parse date - try different positions
    let dateStr = '';
    for (let i = 1; i < Math.min(values.length, 5); i++) {
        if (values[i] && values[i].includes('-') && values[i].length > 5) {
            dateStr = values[i];
            break;
        }
    }

    let parsedDate;
    try {
        if (dateStr.includes('-')) {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const day = parts[0];
                const month = parts[1];
                const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];

                const monthMap = {
                    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
                    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
                    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
                };
                const monthNum = monthMap[month.toLowerCase()] || '01';
                parsedDate = new Date(`${year}-${monthNum}-${day.padStart(2, '0')}`);
            }
        }

        if (!parsedDate || isNaN(parsedDate.getTime())) {
            console.log('No valid date found, skipping row');
            return null;
        }
    } catch (error) {
        console.log('Date parsing error:', error);
        return null;
    }

    // Direct column mapping - branch should be in a consistent position
    const branchName = values[2] && values[2].trim() ? values[2].trim() : 'Imported';
    const supplierName = values[3] && values[3].trim() ? values[3].trim() : 'Unknown Supplier';
    const tin = values[4] && values[4].trim() ? values[4].trim() : '';
    const address = values[5] && values[5].trim() ? values[5].trim() : '';
    const particulars = values[6] && values[6].trim() ? values[6].trim() : 'Various Items';

    // Find amount - look for parentheses pattern like (531.00)
    let amountStr = '';
    for (let i = 7; i < values.length; i++) {
        if (values[i] && values[i].includes('(') && values[i].includes(')')) {
            amountStr = values[i];
            break;
        }
    }

    if (!amountStr) {
        console.log('No amount found, skipping row');
        return null;
    }

    // Clean amount
    amountStr = amountStr.replace(/[()₱,]/g, '');
    const amount = Math.abs(parseFloat(amountStr)) || 0;

    // Parse items from particulars - split by comma, & or semicolon
    let itemNames = [];
    if (particulars && particulars.length > 0) {
        itemNames = particulars.split(/[,&;]/)
            .map(item => item.trim())
            .filter(item => item.length > 0 && item !== '-' && item !== 'N/A');
    }

    if (itemNames.length === 0) {
        itemNames = ['Various Items'];
    }

    // Create items from particulars
    const items = itemNames.map(itemName => ({
        name: itemName,
        quantity: 1,
        price: amount / itemNames.length,
        total: amount / itemNames.length
    }));

    // Calculate VAT breakdown from the CSV data
    const vatableSale = parseFloat(data.vatablesales || data.vatablesale || '') || 0;
    const vatAmount = parseFloat(data.inputvat || '') || 0;

    const expense = {
        id: generateId(),
        date: parsedDate.toISOString().split('T')[0],
        branch: branchName,
        supplierName: supplierName,
        businessName: supplierName, // Use same name for business name from CSV
        tin: tin,
        address: address,
        invoiceNumber: '',
        expenseCategory: 'Supplies', // Default category for CSV imports
        items: items,
        totalAmount: amount,
        vatExemptAmount: 0,
        vatableSale: vatableSale,
        vatAmount: vatAmount,
        isVatRegistered: vatAmount > 0,
        paymentMethod: 'Cash',
        paidBy: '',
        notes: 'Imported from accounting CSV',
        receiptImage: null,
        createdAt: new Date().toISOString()
    };

    console.log('Created expense:', expense);
    return expense;
}

function parseMatchaneseFormatCSV(data, headers, values) {
    console.log('Parsing Matchanese format with values:', values);

    // Skip completely empty rows
    if (values.every(val => !val || val.trim() === '')) {
        console.log('Skipping empty row');
        return null;
    }

    // Parse date - handle "September 23, 2025" format
    const dateStr = data.date || '';
    let parsedDate;

    try {
        // Handle "September 23, 2025" format
        parsedDate = new Date(dateStr);
        if (isNaN(parsedDate.getTime())) {
            console.warn('Invalid date format:', dateStr);
            parsedDate = new Date();
        }
    } catch (error) {
        console.warn('Date parsing error:', error);
        parsedDate = new Date();
    }

    // Parse amount - remove peso sign, commas, and any other currency symbols
    const amountStr = (data.amount || '').replace(/[₱,â‚±]/g, '');
    const amount = parseFloat(amountStr) || 0;

    if (amount === 0) {
        console.warn('Invalid amount:', data.amount);
        return null;
    }

    // Map payment method from "Paid Via" column
    const paidVia = (data.paidvia || 'cash').toLowerCase().replace(/[^a-z]/g, '');
    const paymentMethodMap = {
        'cash': 'Cash',
        'noncash': 'Credit Card',
        'gcash': 'GCash',
        'grab': 'GrabPay',
        'credit': 'Credit Card',
        'debit': 'Debit Card',
        'bank': 'Bank Transfer',
        'online': 'Bank Transfer'
    };
    const paymentMethod = paymentMethodMap[paidVia] || 'Cash';

    // Parse items from "Item" column
    let itemsText = data.item || '';
    if (!itemsText.trim()) {
        itemsText = 'Various Items';
    }
    
    // Split items by comma and clean them up
    const itemNames = itemsText.split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);

    // Create items array - distribute total amount evenly across items
    const itemCount = itemNames.length;
    const pricePerItem = itemCount > 0 ? amount / itemCount : amount;

    const items = itemNames.map(itemName => ({
        name: itemName,
        quantity: 1,
        price: pricePerItem,
        total: pricePerItem
    }));

    // Fallback if no valid items found
    if (items.length === 0) {
        items.push({
            name: 'Imported Item',
            quantity: 1,
            price: amount,
            total: amount
        });
    }

    // Create expense object - always set branch to "Podium" as specified
    const expense = {
        id: generateId(),
        date: parsedDate.toISOString().split('T')[0],
        branch: 'Podium', // Always Podium branch as specified
        supplierName: data.supplier || 'Unknown Supplier',
        businessName: data.supplier || '', // Use supplier name as business name
        tin: data.tin || '',
        address: data.address || '',
        invoiceNumber: data.invoiceno || '',
        items: items,
        totalAmount: amount,
        vatExemptAmount: 0,
        vatableSale: 0,
        vatAmount: 0,
        isVatRegistered: false,
        paymentMethod: paymentMethod,
        paidBy: data.purchasee || 'Store',
        notes: 'Imported from Matchanese Finance Tracking CSV',
        receiptImage: null,
        createdAt: new Date().toISOString()
    };

    console.log('Created Matchanese expense:', expense);
    return expense;
}

function parseStandardFormatCSV(data) {
    // Parse date
    const dateStr = data.date || '';
    let parsedDate;

    try {
        // Handle "April 1, 2025" format
        parsedDate = new Date(dateStr);
        if (isNaN(parsedDate.getTime())) {
            console.warn('Invalid date format:', dateStr);
            parsedDate = new Date();
        }
    } catch (error) {
        console.warn('Date parsing error:', error);
        parsedDate = new Date();
    }

    // Parse amount - remove peso sign, commas, and any other currency symbols
    const amountStr = (data.amount || '').replace(/[₱,â‚±]/g, '');
    const amount = parseFloat(amountStr) || 0;

    if (amount === 0) {
        console.warn('Invalid amount:', data.amount);
        return null;
    }

    // Map payment method
    const paymentMethodMap = {
        'cash': 'Cash',
        'gcash': 'GCash',
        'grab': 'GrabPay',
        'credit': 'Credit Card',
        'debit': 'Debit Card',
        'bank': 'Bank Transfer',
        'online': 'Bank Transfer'
    };

    const paidVia = (data.paidvia || data.paymentmethod || 'cash').toLowerCase().replace(/[^a-z]/g, '');
    const paymentMethod = paymentMethodMap[paidVia] || (paidVia.includes('noncash') ? 'Credit Card' : 'Cash');

    // Parse items - handle empty item field
    let itemsText = data.item || '';
    if (!itemsText.trim()) {
        // If item is empty, use supplier name or "Various Items"
        itemsText = data.supplier || 'Various Items';
    }
    const itemNames = itemsText.split(',').map(item => item.trim()).filter(item => item.length > 0);

    // Create items array - distribute total amount evenly across items
    const itemCount = itemNames.length;
    const pricePerItem = itemCount > 0 ? amount / itemCount : amount;

    const items = itemNames.map(itemName => ({
        name: itemName,
        quantity: 1,
        price: pricePerItem,
        total: pricePerItem
    }));

    // Fallback if no valid items found
    if (items.length === 0) {
        items.push({
            name: 'Imported Item',
            quantity: 1,
            price: amount,
            total: amount
        });
    }

    // Create expense object
    return {
        id: generateId(),
        date: parsedDate.toISOString().split('T')[0],
        branch: data.branch || 'Uncategorized',
        supplierName: data.supplier || 'Unknown Supplier',
        businessName: '',
        tin: data.tin || '',
        address: data.address || '',
        invoiceNumber: data.invoiceno || '',
        items: items,
        totalAmount: amount,
        paymentMethod: paymentMethod,
        paidBy: data.purchasee || '',
        notes: 'Imported from CSV',
        receiptImage: null,
        createdAt: new Date().toISOString()
    };
}

export function findSimilarExpense(newExpense, tolerancePercent = 0.05) {
    const newDate = newExpense.date;
    const newAmount = newExpense.totalAmount;
    const tolerance = newAmount * tolerancePercent;

    return expenses.find(existingExpense => {
        // Check if dates match
        if (existingExpense.date !== newDate) return false;

        // Check if amounts are within tolerance
        const amountDiff = Math.abs(existingExpense.totalAmount - newAmount);
        return amountDiff <= tolerance;
    });
}

export function mergeExpenseData(existingExpense, newExpense) {
    // Determine which expense has more detailed supplier information
    const existingHasFullSupplier = existingExpense.tin && existingExpense.address;
    const newHasFullSupplier = newExpense.tin && newExpense.address;

    // Determine which expense has more detailed items
    const existingItemCount = existingExpense.items.length;
    const newItemCount = newExpense.items.length;

    // Check if existing items are generic/summarized
    const existingHasGenericItems = existingExpense.items.some(item =>
        item.name.toLowerCase().includes('various') ||
        item.name.toLowerCase().includes('goods') ||
        item.name.toLowerCase().includes('items') ||
        item.name.toLowerCase().includes('supplies')
    );

    // Check if new items are more specific
    const newHasSpecificItems = !newExpense.items.some(item =>
        item.name.toLowerCase().includes('various') ||
        item.name.toLowerCase().includes('goods') ||
        item.name.toLowerCase().includes('items')
    );

    let mergedExpense = { ...existingExpense };
    mergedExpense.supplierId = existingExpense.supplierId || newExpense.supplierId;

    // Use supplier details from the more complete source (usually accounting CSV)
    if (existingHasFullSupplier && !newHasFullSupplier) {
        // Keep existing supplier details (from accounting CSV)
        console.log('Using existing supplier details (more complete)');
    } else if (newHasFullSupplier && !existingHasFullSupplier) {
        // Use new supplier details
        mergedExpense.supplierName = newExpense.supplierName;
        mergedExpense.businessName = newExpense.businessName;
        mergedExpense.tin = newExpense.tin;
        mergedExpense.address = newExpense.address;
        console.log('Using new supplier details (more complete)');
    }

    // Use items from the more detailed source
    if ((newItemCount > existingItemCount) ||
        (existingHasGenericItems && newHasSpecificItems) ||
        (newItemCount > 1 && existingItemCount === 1)) {

        mergedExpense.items = newExpense.items;
        console.log('Using new items list (more detailed)');
    } else {
        console.log('Keeping existing items list');
    }

    // Use other details from new expense if they're more complete
    if (newExpense.invoiceNumber && !existingExpense.invoiceNumber) {
        mergedExpense.invoiceNumber = newExpense.invoiceNumber;
    }

    if (newExpense.paymentMethod && newExpense.paymentMethod !== 'Cash') {
        mergedExpense.paymentMethod = newExpense.paymentMethod;
    }

    if (newExpense.paidBy && !existingExpense.paidBy) {
        mergedExpense.paidBy = newExpense.paidBy;
    }

    // Keep VAT information from accounting CSV (existing) as it's more accurate
    // Only update if existing doesn't have VAT info
    if (!existingExpense.isVatRegistered && newExpense.isVatRegistered) {
        mergedExpense.isVatRegistered = newExpense.isVatRegistered;
        mergedExpense.vatableSale = newExpense.vatableSale;
        mergedExpense.vatAmount = newExpense.vatAmount;
        mergedExpense.vatExemptAmount = newExpense.vatExemptAmount;
    }

    // Add note about merge
    const existingNotes = existingExpense.notes || '';
    if (!existingNotes.includes('Merged')) {
        mergedExpense.notes = existingNotes ?
            `${existingNotes} | Merged with additional CSV data` :
            'Merged with additional CSV data';
    }

    mergedExpense.updatedAt = new Date().toISOString();

    if (!mergedExpense.supplierId && mergedExpense.supplierName?.trim()) {
        const sid = saveSupplierIfNew(mergedExpense);
        if (sid) mergedExpense.supplierId = sid;
    }

    return mergedExpense;
}

// Supplier Helper Functions
/** Ensure a supplier row exists for this expense; returns supplier id or null. */
export function saveSupplierIfNew(expense) {
    const supplierName = (expense.supplierName || '').trim();
    const businessName = (expense.businessName || '').trim();

    if (!supplierName) return null;

    const existingSupplier = suppliers.find(
        (s) =>
            s.name.toLowerCase() === supplierName.toLowerCase() ||
            (businessName && s.businessName.toLowerCase() === businessName.toLowerCase())
    );

    if (existingSupplier) {
        return existingSupplier.id;
    }

    const newSupplier = {
        id: generateId(),
        name: supplierName,
        businessName: businessName || '',
        tin: expense.tin || '',
        address: expense.address || '',
        isVatRegistered: expense.isVatRegistered || false,
        createdAt: new Date().toISOString()
    };

    suppliers.push(newSupplier);
    saveToLocalStorage();
    return newSupplier.id;
}

// Autocomplete Helper Functions
// Cache for item matches to improve performance
let itemMatchesCache = null;
let itemMatchesCacheTimestamp = 0;
const ITEM_MATCHES_CACHE_TTL = 30000; // 30 seconds

export function getItemMatches(query, currentSupplier = '') {
    const queryLower = query.toLowerCase().trim();
    const now = Date.now();
    
    // Invalidate cache if expired or if expenses might have changed
    if (!itemMatchesCache || (now - itemMatchesCacheTimestamp) > ITEM_MATCHES_CACHE_TTL) {
        // Build cache of all unique items
        const allItems = new Map();

        expenses.forEach(expense => {
            expense.items.forEach(item => {
                const key = item.name.toLowerCase();
                if (!allItems.has(key)) {
                    allItems.set(key, {
                        id: item.name, // Use actual name as ID instead of lowercase
                        name: item.name,
                        suppliers: new Set(),
                        frequency: 0
                    });
                }
                allItems.get(key).suppliers.add(expense.supplierName);
                allItems.get(key).frequency++;
            });
        });

        itemMatchesCache = Array.from(allItems.values());
        itemMatchesCacheTimestamp = now;
    }

    // Early exit for empty query - return limited results
    if (!queryLower) {
        return itemMatchesCache
            .slice(0, 10)
            .map(item => ({
                ...item,
                priority: 5,
                secondarySort: -item.frequency,
                display: item.name
            }))
            .sort((a, b) => {
                if (a.secondarySort !== b.secondarySort) return a.secondarySort - b.secondarySort;
                return a.name.localeCompare(b.name);
            });
    }

    // Filter FIRST, then map - much more efficient for longer queries
    const matchingItems = [];
    const queryLength = queryLower.length;
    
    for (const item of itemMatchesCache) {
        const name = item.name.toLowerCase();
        let priority = 999;
        let matches = false;

        // Quick checks - order matters for performance
        if (name === queryLower) {
            priority = 1;
            matches = true;
        } else if (name.startsWith(queryLower)) {
            priority = 2;
            matches = true;
        } else if (queryLength >= 3 && name.includes(queryLower)) {
            // Only do word-based matching for longer queries (more expensive)
            if (name.split(' ').some(word => word.startsWith(queryLower))) {
                priority = 3;
                matches = true;
            } else {
                priority = 4;
                matches = true;
            }
        }

        if (matches) {
            // Boost priority if item was ordered from current supplier
            if (currentSupplier && item.suppliers.has(currentSupplier)) {
                priority = Math.max(1, priority - 1);
            }

            matchingItems.push({
                ...item,
                priority,
                secondarySort: -item.frequency,
                display: item.name
            });
        }
    }

    // Sort and limit results
    return matchingItems
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (a.secondarySort !== b.secondarySort) return a.secondarySort - b.secondarySort;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 10); // Limit to 10 suggestions
}

// Function to invalidate item matches cache (call when expenses are added/updated/deleted)
export function invalidateItemMatchesCache() {
    itemMatchesCache = null;
    itemMatchesCacheTimestamp = 0;
}

export function getPaidByMatches(query) {
    // Get all unique payers from expenses
    const allPayers = new Map();

    expenses.forEach(expense => {
        const payer = expense.paidBy.trim();
        if (payer) {
            const key = payer.toLowerCase();
            if (!allPayers.has(key)) {
                allPayers.set(key, {
                    id: payer, // Use actual name as ID
                    name: payer,
                    frequency: 0
                });
            }
            allPayers.get(key).frequency++;
        }
    });

    const payers = Array.from(allPayers.values()).map(payer => {
        const name = payer.name.toLowerCase();
        let priority = 999;

        if (name === query) priority = 1;
        else if (name.startsWith(query)) priority = 2;
        else if (name.split(' ').some(word => word.startsWith(query))) priority = 3;
        else if (query && name.includes(query)) priority = 4;
        else if (!query) priority = 5;

        return { ...payer, priority, display: payer.name };
    });

    return payers
        .filter(payer => payer.priority < 999)
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return -a.frequency + b.frequency; // Sort by frequency desc
        })
        .slice(0, 8);
}

export function getSupplierMatches(query) {
    const allSuppliers = suppliers.map(supplier => {
        const name = supplier.name.toLowerCase();
        const businessName = (supplier.businessName || '').toLowerCase();
        let priority = 999;

        if (name.startsWith(query)) priority = 1;
        else if (businessName.startsWith(query)) priority = 2;
        else if (name.split(' ').some(word => word.startsWith(query))) priority = 3;
        else if (businessName.split(' ').some(word => word.startsWith(query))) priority = 4;
        else if (name.includes(query)) priority = 5;
        else if (businessName.includes(query)) priority = 6;
        else if (!query) priority = 7; // Show all when no query

        return {
            ...supplier,
            priority,
            display: `<div style="font-weight: 500;">${supplier.name}</div><div style="font-size: 12px; color: #666;">${supplier.businessName || 'No business name'}</div>`
        };
    });

    return allSuppliers
        .filter(supplier => supplier.priority < 999)
        .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

// Expense Object Creation Function
// This is the single source of truth for creating/updating expense objects
// Solves Steps 3, 4, 5, and 6: standardizes total calculation, VAT calculation, and validation
export function createExpenseObject(data, options = {}) {
    const {
        existingExpense = null,
        isEditing = false,
        calculateTotalFromItems = true,
        autoCalculateVAT = true,
        validate = true
    } = options;

    // Extract data (supports both FormData and plain objects)
    const getValue = (key, defaultValue = '') => {
        if (data instanceof FormData) {
            return data.get(key) || defaultValue;
        }
        return data[key] !== undefined ? data[key] : defaultValue;
    };

    const isPettyCash = (() => {
        if (data instanceof FormData) {
            return data.get('isPettyCash') === 'on' || data.get('isPettyCash') === 'true';
        }
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const v = data.isPettyCash;
            if (v === true || v === 'true') return true;
            if (v === false || v === 'false') return false;
        }
        return Boolean(existingExpense?.isPettyCash);
    })();

    const explicitId = getValue('id', null);

    // Process items - ensure they have correct totals
    let items = [];
    if (data.items && Array.isArray(data.items)) {
        items = data.items.map(item => ({
            name: (item.name || '').trim(),
            quantity: parseFloat(item.quantity) || 1,
            price: parseFloat(item.price) || 0,
            total: calculateItemTotal(item.quantity, item.price)
        })).filter(item => item.name); // Remove empty items
    }

    // Calculate total amount
    let totalAmount;
    if (calculateTotalFromItems && items.length > 0) {
        totalAmount = calculateExpenseTotal(items);
    } else {
        // Use provided total or calculate from items
        totalAmount = parseFloat(getValue('totalAmount')) || 
                     (items.length > 0 ? calculateExpenseTotal(items) : 0);
    }

    // Get VAT exempt amount
    let vatExemptAmount = parseFloat(getValue('vatExemptAmount')) || 
                           (existingExpense?.vatExemptAmount || 0);

    // Get supplier information for VAT calculation
    let supplierName = getValue('supplierName', existingExpense?.supplierName || '').trim();
    const allSuppliers = getSuppliers();
    let supplierId = '';
    if (data instanceof FormData) {
        supplierId = ((data.get('supplierId') || '') + '').trim();
    } else if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'supplierId')) {
        const v = data.supplierId;
        supplierId = v == null || v === '' ? '' : String(v).trim();
    } else {
        supplierId = (existingExpense?.supplierId && String(existingExpense.supplierId).trim()) || '';
    }
    let supplier = supplierId
        ? allSuppliers.find((s) => s.id === supplierId)
        : null;
    if (!supplier && supplierName) {
        supplier = allSuppliers.find((s) => s.name.toLowerCase() === supplierName.toLowerCase());
        if (supplier) supplierId = supplier.id;
    }

    // Calculate VAT if auto-calculate is enabled
    let vatBreakdown = {
        vatableSale: existingExpense?.vatableSale || 0,
        vatAmount: existingExpense?.vatAmount || 0,
        isVatRegistered: existingExpense?.isVatRegistered || false
    };

    if (autoCalculateVAT && !isPettyCash) {
        // Check if VAT computation is explicitly disabled
        const vatComputationExplicitlyDisabled = getValue('vatComputationEnabled') === 'false' || 
                                                 getValue('vatComputationEnabled') === false;
        
        // Auto-enable VAT computation if supplier is VAT registered (unless explicitly disabled)
        // If supplier is VAT registered, default to enabled unless explicitly set to false
        const vatComputationEnabled = vatComputationExplicitlyDisabled ? false :
                                     (supplier?.isVatRegistered ? true :
                                     (getValue('vatComputationEnabled') === 'true' || 
                                      getValue('vatComputationEnabled') === true ||
                                      getValue('vatComputationEnabled') === 'checked' ||
                                      (existingExpense?.isVatRegistered && getValue('vatComputationEnabled') === '')));

        // Calculate VAT if VAT computation is enabled and (supplier is VAT registered or no supplier found)
        if (vatComputationEnabled && (supplier?.isVatRegistered || !supplier)) {
            vatBreakdown = calculateVATFromSupplier(totalAmount, vatExemptAmount, supplier);
        } else if (supplier && !supplier.isVatRegistered) {
            // Supplier is not VAT registered and VAT not enabled - clear VAT
            vatBreakdown = {
                vatableSale: 0,
                vatAmount: 0,
                isVatRegistered: false
            };
        } else if (!vatComputationEnabled) {
            // VAT computation explicitly disabled - clear VAT
            vatBreakdown = {
                vatableSale: 0,
                vatAmount: 0,
                isVatRegistered: false
            };
        }
        // If expense had VAT and supplier still registered, preserve (handled by existingExpense default above)
    }

    if (isPettyCash) {
        vatBreakdown = { vatableSale: 0, vatAmount: 0, isVatRegistered: false };
        vatExemptAmount = 0;
    }

    const allocationVal = getValue('allocation', existingExpense?.allocation || 'Store');
    const branchVal =
        allocationVal !== 'Store'
            ? null
            : (() => {
                  const b = getValue('branch', existingExpense?.branch ?? '');
                  return b === '' || b == null ? null : b;
              })();

    // Build expense object
    const expense = {
        id: isEditing && existingExpense ? existingExpense.id : (explicitId || existingExpense?.id || generateId()),
        date: getValue('date', existingExpense?.date || getTodayLocal()),
        branch: branchVal,
        allocation: allocationVal,
        isPettyCash,
        supplierName: supplierName,
        ...(isPettyCash || !supplierId ? {} : { supplierId }),
        businessName: getValue('businessName', existingExpense?.businessName || ''),
        tin: getValue('tin', existingExpense?.tin || ''),
        address: getValue('address', existingExpense?.address || ''),
        invoiceNumber: getValue('invoiceNumber', existingExpense?.invoiceNumber || ''),
        expenseCategory: getValue('expenseCategory', existingExpense?.expenseCategory || DEFAULT_EXPENSE_CATEGORY),
        items: items,
        totalAmount: totalAmount,
        vatExemptAmount: vatExemptAmount,
        vatableSale: vatBreakdown.vatableSale,
        vatAmount: vatBreakdown.vatAmount,
        isVatRegistered: vatBreakdown.isVatRegistered,
        paidBy: (() => {
            const paidBy = getValue('paidBy', existingExpense?.paidBy || 'Company');
            return allocationVal === 'Store' ? paidBy : 'Company';
        })(),
        notes: getValue('notes', existingExpense?.notes || ''),
        receiptImage: getValue('receiptImage', existingExpense?.receiptImage || null),
        vatComputationEnabled: isPettyCash
            ? false
            : getValue('vatComputationEnabled') !== undefined
              ? getValue('vatComputationEnabled') === 'true' || getValue('vatComputationEnabled') === true
              : existingExpense?.vatComputationEnabled !== undefined
                ? existingExpense.vatComputationEnabled
                : undefined,
        createdAt: isEditing && existingExpense ? 
                   (existingExpense.createdAt || new Date().toISOString()) : 
                   new Date().toISOString(),
        updatedAt: new Date().toISOString() // Always set updatedAt, even for new expenses
    };

    const normalizedExpense = normalizeExpenseReceiptState(expense);

    if (isPettyCash) {
        normalizedExpense.supplierId = null;
        normalizedExpense.businessName = '';
        normalizedExpense.tin = '';
        normalizedExpense.address = '';
    }

    // Validate if requested
    if (validate) {
        const errors = validateExpense(normalizedExpense);
        if (errors.length > 0) {
            return {
                success: false,
                errors: errors,
                expense: null
            };
        }
    }

    return {
        success: true,
        errors: [],
        expense: normalizedExpense
    };
}

// Validation Functions
export function validateExpense(expense) {
    const errors = [];

    if (!expense.supplierName || expense.supplierName.trim() === '') {
        errors.push('Supplier / payee name is required');
    }

    if (!expense.items || expense.items.length === 0) {
        errors.push('At least one item is required');
    }

    if (!expense.totalAmount || expense.totalAmount <= 0) {
        errors.push('Total amount must be greater than 0');
    }

    if (!expense.date || expense.date === '') {
        errors.push('Date is required');
    }

    if (expense.vatExemptAmount && expense.vatExemptAmount > expense.totalAmount) {
        errors.push('VAT exempt amount cannot exceed total amount');
    }

    return errors;
}

export function validateSupplier(supplier, excludeSupplierId = null) {
    const errors = [];

    if (!supplier.name || supplier.name.trim() === '') {
        errors.push('Supplier name is required');
    }

    // Check for duplicate names (excluding current supplier if editing)
    const existingSupplier = suppliers.find(s =>
        s.name.toLowerCase() === supplier.name.toLowerCase() &&
        s.id !== excludeSupplierId
    );

    if (existingSupplier) {
        errors.push('A supplier with this name already exists');
    }

    return errors;
}

// Supplier Object Creation Function
// Creates a supplier object with validation and defaults
export function createSupplierObject(data, options = {}) {
    const {
        existingSupplier = null,
        isEditing = false,
        validate = true
    } = options;

    // Extract data (supports both FormData and plain objects)
    const getValue = (key, defaultValue = '') => {
        if (data instanceof FormData) {
            return data.get(key) || defaultValue;
        }
        return data[key] !== undefined ? data[key] : defaultValue;
    };

    const supplier = {
        id: isEditing && existingSupplier ? existingSupplier.id : generateId(),
        name: (getValue('name') || '').trim(),
        businessName: (getValue('businessName') || '').trim(),
        tin: (getValue('tin') || '').trim(),
        address: (getValue('address') || '').trim(),
        isVatRegistered: getValue('isVatRegistered') === 'true' || 
                        getValue('isVatRegistered') === true ||
                        getValue('isVatRegistered') === 'checked' ||
                        false,
        createdAt: isEditing && existingSupplier ? 
                   (existingSupplier.createdAt || new Date().toISOString()) : 
                   new Date().toISOString(),
        updatedAt: new Date().toISOString() // Always set updatedAt, even for new suppliers
    };

    // Validate if requested
    if (validate) {
        const excludeSupplierId = isEditing && existingSupplier ? existingSupplier.id : null;
        const errors = validateSupplier(supplier, excludeSupplierId);
        if (errors.length > 0) {
            return {
                success: false,
                errors: errors,
                supplier: null
            };
        }
    }

    return {
        success: true,
        errors: [],
        supplier: supplier
    };
}

// Update expenses when supplier information changes
// This is called when editing a supplier to update all related expenses
export function updateExpensesForSupplier(oldSupplier, newSupplier) {
    if (!oldSupplier || !newSupplier) return { updated: 0 };

    const allExpenses = getExpenses();
    let updatedCount = 0;

    allExpenses.forEach(expense => {
        if (expense.supplierId === oldSupplier.id) {
            expense.supplierId = newSupplier.id;
            expense.supplierName = newSupplier.name;
            expense.businessName = newSupplier.businessName || expense.businessName;
            expense.tin = newSupplier.tin || expense.tin;
            expense.address = newSupplier.address || expense.address;
            expense.isVatRegistered = newSupplier.isVatRegistered || false;

            // Recalculate VAT if supplier VAT status changed
            if (oldSupplier.isVatRegistered !== newSupplier.isVatRegistered) {
                if (!newSupplier.isVatRegistered) {
                    // Supplier no longer VAT registered - clear VAT
                    expense.vatExemptAmount = 0;
                    expense.vatableSale = 0;
                    expense.vatAmount = 0;
                } else if (newSupplier.isVatRegistered && expense.vatableSale === 0) {
                    // Supplier newly VAT registered - recalculate VAT using shared function
                    const vatBreakdown = calculateVATFromSupplier(
                        expense.totalAmount,
                        expense.vatExemptAmount || 0,
                        newSupplier
                    );
                    expense.vatableSale = vatBreakdown.vatableSale;
                    expense.vatAmount = vatBreakdown.vatAmount;
                }
            }

            // Update the expense
            updateExpense(expense.id, expense);
            updatedCount++;
        }
    });

    return { updated: updatedCount };
}

// Check if supplier can be deleted (has expenses)
export function canDeleteSupplier(supplierId) {
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        return { canDelete: false, reason: 'Supplier not found', expenseCount: 0 };
    }

    const allExpenses = getExpenses();
    const expenseCount = allExpenses.filter((expense) => expense.supplierId === supplierId).length;

    if (expenseCount > 0) {
        return {
            canDelete: false,
            reason: `Supplier has ${expenseCount} expense${expenseCount === 1 ? '' : 's'}`,
            expenseCount: expenseCount
        };
    }

    return { canDelete: true, reason: '', expenseCount: 0 };
}

// Item and Total Calculation Functions
export function calculateItemTotal(quantity, price) {
    const qty = parseFloat(quantity) || 0;
    const prc = parseFloat(price) || 0;
    return qty * prc;
}

export function calculateExpenseTotal(items) {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((sum, item) => {
        const itemTotal = calculateItemTotal(item.quantity, item.price);
        return sum + itemTotal;
    }, 0);
}

// VAT Calculation Functions
export function calculateVatBreakdown(totalAmount, vatExemptAmount = 0, isVatRegistered = false) {
    if (!isVatRegistered || totalAmount <= 0) {
        return {
            totalAmount,
            vatExemptAmount: 0,
            taxableAmount: 0,
            vatableSale: 0,
            vatAmount: 0,
            isVatRegistered: false
        };
    }

    const taxableAmount = totalAmount - vatExemptAmount;
    const vatableSale = taxableAmount / 1.12; // Remove 12% VAT from taxable amount
    const vatAmount = taxableAmount - vatableSale;

    return {
        totalAmount,
        vatExemptAmount,
        taxableAmount,
        vatableSale,
        vatAmount,
        isVatRegistered: true
    };
}

// VAT Calculation with Supplier Lookup
export function calculateVATFromSupplier(totalAmount, vatExemptAmount, supplier) {
    const isVatRegistered = supplier?.isVatRegistered || false;
    return calculateVatBreakdown(totalAmount, vatExemptAmount, isVatRegistered);
}

/** Resolve supplier row for an expense (by id, then name). */
export function resolveExpenseSupplier(expense) {
    if (!expense || expense.isPettyCash) return null;
    const list = getSuppliers();
    if (expense.supplierId) {
        return list.find((s) => s.id === expense.supplierId) || null;
    }
    const name = (expense.supplierName || '').trim();
    if (!name) return null;
    return list.find((s) => s.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Admin table VAT column: expense-level values only.
 * "—" here can mean computation was excluded for this line (not vatExemptAmount).
 */
export function formatExpenseVatColumnLabel(expense) {
    const amt = Number(expense?.vatAmount) || 0;
    if (amt > 0) {
        return { text: `₱${amt.toFixed(2)}`, title: '' };
    }
    if (expense?.isPettyCash) {
        return { text: 'No VAT', title: 'Petty cash voucher' };
    }
    if (expense?.vatComputationEnabled === false) {
        return {
            text: '—',
            title: 'VAT computation excluded for this expense (distinct from VAT-exempt purchase amount).'
        };
    }
    const sup = resolveExpenseSupplier(expense);
    if (
        sup?.isVatRegistered &&
        (expense.vatComputationEnabled === true || expense.vatComputationEnabled === undefined)
    ) {
        return {
            text: '—',
            title: 'No VAT amount stored while supplier is VAT-registered and computation is on — open the expense and save to recalculate, or verify supplier link.'
        };
    }
    return { text: 'No VAT', title: '' };
}

const LEGACY_VAT_BACKFILL_KEY = 'expenseTracker_vatBackfill_v1_done';

/**
 * One-time: recompute VAT for legacy expenses linked to a VAT-registered supplier
 * with computation left on (or unset) but vatAmount still zero.
 */
export function runLegacyExpenseVatBackfillOnce() {
    if (typeof localStorage === 'undefined') return 0;
    if (localStorage.getItem(LEGACY_VAT_BACKFILL_KEY) === '1') return 0;
    let updated = 0;
    const snapshot = [...expenses];
    for (const exp of snapshot) {
        if (exp.isPettyCash) continue;
        if ((Number(exp.vatAmount) || 0) > 0) continue;
        if (exp.vatComputationEnabled === false) continue;
        const sup = resolveExpenseSupplier(exp);
        if (!sup?.isVatRegistered) continue;
        const result = createExpenseObject(
            {
                id: exp.id,
                date: exp.date,
                branch: exp.branch,
                allocation: exp.allocation,
                isPettyCash: false,
                supplierName: exp.supplierName,
                supplierId: exp.supplierId,
                businessName: exp.businessName,
                tin: exp.tin,
                address: exp.address,
                invoiceNumber: exp.invoiceNumber,
                expenseCategory: exp.expenseCategory,
                items: exp.items,
                totalAmount: exp.totalAmount,
                vatExemptAmount: exp.vatExemptAmount || 0,
                vatComputationEnabled: true,
                paidBy: exp.paidBy,
                notes: exp.notes,
                receiptImage: exp.receiptImage
            },
            {
                existingExpense: exp,
                isEditing: true,
                calculateTotalFromItems: false,
                autoCalculateVAT: true,
                validate: false
            }
        );
        if (!result.success || !result.expense) continue;
        if ((Number(result.expense.vatAmount) || 0) <= 0) continue;
        const idx = expenses.findIndex((e) => e.id === exp.id);
        if (idx === -1) continue;
        const merged = {
            ...result.expense,
            paymentMethod: exp.paymentMethod,
            createdAt: exp.createdAt
        };
        expenses[idx] = merged;
        updated++;
    }
    if (updated > 0) {
        try {
            saveToLocalStorage();
        } catch (e) {
            console.warn('VAT backfill save failed', e);
        }
    }
    try {
        localStorage.setItem(LEGACY_VAT_BACKFILL_KEY, '1');
    } catch (e) {
        /* ignore */
    }
    return updated;
}

// UI Helper Functions
export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) {
        console.warn('Toast element not found');
        return;
    }

    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

export function showSyncStatus(message, type) {
    // Create or update sync indicator
    let indicator = document.getElementById('syncIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'syncIndicator';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            z-index: 3000;
            transition: all 0.3s ease;
            pointer-events: none;
        `;
        document.body.appendChild(indicator);
    }

    indicator.textContent = message;

    if (type === 'success') {
        indicator.style.background = '#e8f5e8';
        indicator.style.color = '#439407';
        indicator.style.border = '1px solid #d4edda';
    } else if (type === 'error') {
        indicator.style.background = '#fdf2f2';
        indicator.style.color = '#dc3545';
        indicator.style.border = '1px solid #f5c6cb';
    }

    indicator.style.opacity = '1';

    // Hide after 3 seconds
    setTimeout(() => {
        if (indicator) {
            indicator.style.opacity = '0';
            setTimeout(() => {
                if (indicator && indicator.parentNode) {
                    indicator.parentNode.removeChild(indicator);
                }
            }, 300);
        }
    }, 3000);
}

// Data Export Functions
export function exportToCSV(data, filename) {
    const csvContent = convertToCSV(data);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');

    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function convertToCSV(data) {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [];

    // Add headers
    csvRows.push(headers.join(','));

    // Add data rows
    data.forEach(row => {
        const values = headers.map(header => {
            const value = row[header] || '';
            // Escape quotes and wrap in quotes if contains comma or quote
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csvRows.push(values.join(','));
    });

    return csvRows.join('\n');
}

function triggerBackgroundSyncFlush() {
    if (!hasPendingChanges || !db) return;
    if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
    }
    syncToFirebase();
    console.log('Forced background sync flush');
}

// Force sync when the page is hidden or unloaded (mobile-friendly).
export function setupBeforeUnloadSync() {
    window.addEventListener('beforeunload', triggerBackgroundSyncFlush);
    window.addEventListener('pagehide', triggerBackgroundSyncFlush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            triggerBackgroundSyncFlush();
        }
    });
}

// Initialize Firebase background sync
export async function initializeFirebaseSync() {
    if (!db) {
        console.log('Database not available, skipping sync');
        return;
    }

    try {
        // Fetch latest data from Firebase in background
        const hasChanges = await fetchFromFirebase();

        // Push local-only rows that never reached the server (failed sync, closed before debounce).
        if (expenses.length > 0 || suppliers.length > 0) {
            hasPendingChanges = true;
            await syncToFirebase();
        }

        // Set up periodic sync (60s visible / 5min hidden)
        scheduleFirebasePoll();
        setupFirebasePollVisibilityHandler();

        console.log('Firebase sync initialized');
        return hasChanges;
    } catch (error) {
        console.error('Failed to initialize Firebase sync:', error);
        showSyncStatus('⚠ Offline mode', 'error');
        return false;
    }
}

// Debug Functions
export function debugDates() {
    console.log('=== DATE DEBUG ===');
    console.log('Total expenses loaded:', expenses.length);

    // Check date formats
    const dates = expenses.map(e => e.date).filter(d => d); // Remove null/undefined
    console.log('Dates found:', dates.length);
    console.log('Sample dates:', dates.slice(0, 20));
    console.log('Last 10 dates:', dates.slice(-10));

    // Check for different date formats
    const dateFormats = {};
    dates.forEach(date => {
        const format = date.length + '_' + (date.includes('T') ? 'ISO' : 'DATE');
        dateFormats[format] = (dateFormats[format] || 0) + 1;
    });
    console.log('Date formats found:', dateFormats);

    // Sort dates and show range
    const sortedDates = dates.sort();
    console.log('First date:', sortedDates[0]);
    console.log('Last date:', sortedDates[sortedDates.length - 1]);

    // Count by month
    const months = {};
    dates.forEach(date => {
        const month = date.substring(0, 7); // YYYY-MM
        months[month] = (months[month] || 0) + 1;
    });
    console.log('Expenses by month:', months);

    // Check for recent dates
    const recent = dates.filter(date => date >= '2025-04-01');
    console.log('Dates after April 1, 2025:', recent.length);
    console.log('Recent dates sample:', recent.slice(0, 10));
}

// Clear all data (for testing/reset)
export function clearAllData() {
    expenses.length = 0;
    suppliers.length = 0;
    localStorage.removeItem('expenseTracker_expenses');
    localStorage.removeItem('expenseTracker_suppliers');
    localStorage.removeItem('expenseTracker_deviceId');
    console.log('All data cleared');
}

// Expense Detail Modal Functions
export function viewExpense(expenseId) {
    const expense = expenses.find(e => e.id === expenseId);
    if (!expense) {
        showToast('Expense not found');
        return;
    }

    showExpenseDetailModal(expense);
}

export function showExpenseDetailModal(expense) {
    const modal = document.getElementById('expenseDetailModalOverlay');
    const content = document.getElementById('expenseDetailContent');

    if (!modal || !content) {
        console.error('Expense detail modal elements not found');
        return;
    }

    // Set content to flex row layout for 2-column display
    content.style.cssText = 'display: flex; flex-direction: row; flex: 1; overflow: hidden; padding: 0; min-height: 0; height: 100%;';

    // Format the date
    const expenseDate = new Date(expense.date);
    const isToday = expense.date === new Date().toISOString().split('T')[0];
    const formattedDate = isToday ? 'Today' : formatDate(expense.date);

    // Update modal header to include action buttons
    const modalHeader = modal.querySelector('.modal-header');
    const existingActionButtons = modalHeader.querySelector('.modal-action-buttons');
    if (existingActionButtons) {
        existingActionButtons.remove();
    }

    // Add action buttons before the close button
    const actionButtons = document.createElement('div');
    actionButtons.className = 'modal-action-buttons';
    actionButtons.innerHTML = `
        <button class="modal-action-btn edit" onclick="editExpenseFromDetail('${expense.id}')" title="Edit expense">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path>
            </svg>
        </button>
        <button class="modal-action-btn delete" onclick="deleteExpenseFromDetail('${expense.id}')" title="Delete expense">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3,6 5,6 21,6"></polyline>
                <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
        </button>
    `;

    const headerActions = modalHeader.querySelector('.modal-header-actions');
    headerActions.insertBefore(actionButtons, headerActions.firstChild);

    // Generate content with 2-pane layout - EXACTLY like edit expense modal
    content.innerHTML = `
        <div style="display: flex; flex: 1; overflow: hidden;">
            <div style="flex: 1; padding: 1.5rem; overflow-y: auto; border-right: 1px solid #e5e5e5;">
                <!-- Basic Information -->
                <div class="expense-detail-section">
                    <h3>Basic Information</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: #333; margin-bottom: 0.25rem;">${formattedDate}</div>
                            <div style="font-size: 0.875rem; color: #666;">Date</div>
                        </div>
                        ${expense.allocation ? `
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: #333; margin-bottom: 0.25rem;">${expense.allocation}</div>
                            <div style="font-size: 0.875rem; color: #666;">Allocation</div>
                        </div>
                        ` : '<div></div>'}
                        ${expense.branch && expense.allocation === 'Store' ? `
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: #333; margin-bottom: 0.25rem;">${expense.branch}</div>
                            <div style="font-size: 0.875rem; color: #666;">Branch</div>
                        </div>
                        ` : ''}
                        ${expense.paidBy ? `
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: #333; margin-bottom: 0.25rem;">${expense.paidBy}</div>
                            <div style="font-size: 0.875rem; color: #666;">Paid By</div>
                        </div>
                        ` : ''}
                        ${expense.expenseCategory ? `
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: #333; margin-bottom: 0.25rem;">${expense.expenseCategory}</div>
                            <div style="font-size: 0.875rem; color: #666;">Expense Category</div>
                        </div>
                        ` : ''}
                        ${expense.invoiceNumber ? `
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: #333; margin-bottom: 0.25rem;">${expense.invoiceNumber}</div>
                            <div style="font-size: 0.875rem; color: #666;">Invoice Number</div>
                        </div>
                        ` : ''}
                    </div>
                </div>

                <!-- Supplier Information -->
                <div class="expense-detail-section">
                    <h3>Supplier Information</h3>
                    <div class="expense-detail-row supplier-clickable" onclick="viewSupplierFromExpense('${expense.supplierName}')">
                        <div class="expense-detail-label">Supplier Name</div>
                        <div class="expense-detail-value supplier-link">${expense.supplierName}</div>
                    </div>
                    ${expense.businessName ? `
                    <div class="expense-detail-row">
                        <div class="expense-detail-label">Business Name</div>
                        <div class="expense-detail-value">${expense.businessName}</div>
                    </div>
                    ` : ''}
                    ${expense.tin ? `
                    <div class="expense-detail-row">
                        <div class="expense-detail-label">TIN</div>
                        <div class="expense-detail-value">${expense.tin}</div>
                    </div>
                    ` : ''}
                    ${expense.address ? `
                    <div class="expense-detail-row">
                        <div class="expense-detail-label">Address</div>
                        <div class="expense-detail-value">${expense.address}</div>
                    </div>
                    ` : ''}
                </div>

                <!-- Financial Information -->
                <div class="expense-detail-section">
                    <h3>Financial Information</h3>
                    <div class="expense-detail-row">
                        <div class="expense-detail-label">Total Amount</div>
                        <div class="expense-detail-value amount">₱${(expense.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    ${expense.isVatRegistered ? `
                    <div class="expense-detail-row">
                        <div class="expense-detail-label">VAT Status</div>
                        <div class="expense-detail-value">VAT Registered</div>
                    </div>
                    ${expense.vatableSale > 0 ? `
                    <div class="expense-detail-row">
                        <div class="expense-detail-label">VATable Sale</div>
                        <div class="expense-detail-value">₱${expense.vatableSale.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    ` : ''}
                    ${expense.vatAmount > 0 ? `
                    <div class="expense-detail-row">
                        <div class="expense-detail-label">VAT Amount</div>
                        <div class="expense-detail-value">₱${expense.vatAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    ` : ''}
                    ${expense.vatExemptAmount > 0 ? `
                    <div class="expense-detail-row">
                        <div class="expense-detail-label">VAT Exempt Amount</div>
                        <div class="expense-detail-value">₱${expense.vatExemptAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    ` : ''}
                    ` : ''}
                </div>

                <!-- Items Purchased -->
                <div class="expense-detail-section">
                    <h3>Items Purchased (${expense.items.length} item${expense.items.length === 1 ? '' : 's'})</h3>
                    <div class="expense-detail-items">
                        ${expense.items.map(item => `
                            <div class="expense-detail-item">
                                <div class="expense-detail-item-name">${item.name}</div>
                                <div class="expense-detail-item-details">
                                    <div class="expense-detail-item-qty-price">
                                        <span>Qty: ${item.quantity}</span>
                                        ${item.price > 0 ? `<span>₱${item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each</span>` : ''}
                                    </div>
                                    ${item.total > 0 ? `<div class="expense-detail-item-total">₱${item.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                ${expense.notes ? `
                <!-- Notes -->
                <div class="expense-detail-section">
                    <h3>Notes</h3>
                    <div class="expense-detail-notes">${expense.notes}</div>
                </div>
                ` : ''}
            </div>
            
            <div style="flex: 1; padding: 1.5rem; overflow-y: auto; background: #f8f9fa;">
                <!-- Receipt -->
                <div style="height: 100%; display: flex; flex-direction: column;">
                    <h3 style="font-size: 1.1rem; font-weight: 600; color: #2b9348; margin: 0 0 1.5rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid rgba(43, 147, 72, 0.2);">Receipt Photo</h3>
                    <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
                        ${expense.receiptImage ? `
                            <div style="border: 2px solid #ddd; border-radius: 8px; padding: 20px; text-align: center; position: relative; aspect-ratio: 3/4; min-height: 0; display: flex; align-items: center; justify-content: center; background: white;">
                                <img src="${expense.receiptImage}" alt="Receipt" style="width: 100%; height: 100%; border-radius: 8px; object-fit: contain; max-width: 100%; max-height: 100%; cursor: pointer;" onclick="viewReceiptFullscreen('${expense.receiptImage}')">
                            </div>
                        ` : `
                            <div style="border: 2px dashed #ddd; border-radius: 8px; padding: 20px; text-align: center; aspect-ratio: 3/4; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: white; color: #999;">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 1rem;">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                    <polyline points="21,15 16,10 5,21"></polyline>
                                </svg>
                                <div>No receipt attached</div>
                            </div>
                        `}
                </div>
            </div>
        </div>
    `;

    // Store current scroll position
    const scrollY = window.scrollY;

    modal.style.display = 'flex';
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
}

export function closeExpenseDetailModal() {
    const modal = document.getElementById('expenseDetailModalOverlay');
    if (!modal) return;

    modal.style.display = 'none';
    modal.classList.remove('show');

    // Restore scroll position
    const scrollY = document.body.style.top;
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    window.scrollTo(0, parseInt(scrollY || '0') * -1);
}

export function editExpenseFromDetail(expenseId) {
    // This will be implemented in the specific app (mobile or admin)
    console.log('Edit expense:', expenseId);
}

export function deleteExpenseFromDetail(expenseId) {
    // This will be implemented in the specific app (mobile or admin)
    console.log('Delete expense:', expenseId);
}

export function viewSupplierFromExpense(supplierName) {
    // This will be implemented in the specific app (mobile or admin)
    console.log('View supplier:', supplierName);
}

export function viewReceiptFullscreen(imageSrc) {
    // This will be implemented in the specific app (mobile or admin)
    console.log('View receipt fullscreen:', imageSrc);
}

// Manual Firebase initialization for testing
export async function initFirebaseManually() {
    try {
        console.log('Manually initializing Firebase...');
        const result = await initializeFirebase();
        if (result) {
            console.log('✅ Manual Firebase initialization successful!');
            console.log('Database object:', window.db);

            // Test a simple read operation
            const testCollection = collection(window.db, 'expenses');
            const snapshot = await getDocs(testCollection);
            console.log('✅ Firebase read test successful, found', snapshot.docs.length, 'documents');
        } else {
            console.log('❌ Manual Firebase initialization failed');
        }
        return result;
    } catch (error) {
        console.error('❌ Manual initialization error:', error);
        return false;
    }
}