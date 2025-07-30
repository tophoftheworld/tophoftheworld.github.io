// Global state
let expenses = [];
let suppliers = [];
let itemCounter = 0;
let currentFilter = 'all'; // Track current filter

// Firebase dependencies - imported at module level
let db;
let collection, doc, getDocs, setDoc, deleteDoc, query, where, orderBy, serverTimestamp, writeBatch;

// Firebase Sync Functions
let syncInProgress = false;
let pendingOperations = [];

// Debouncing for Firebase sync
let syncTimeout = null;
let hasPendingChanges = false;
const SYNC_DEBOUNCE_DELAY = 3000; // 3 seconds

// Initialize Firebase and load dependencies
async function initializeFirebase() {
    try {
        // Import Firebase configuration
        const firebaseConfig = await import('./firebase-config.js');
        db = firebaseConfig.db;

        // Make db available globally for testing
        window.db = db;

        // Import Firestore functions
        const firestoreModule = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
        collection = firestoreModule.collection;
        doc = firestoreModule.doc;
        getDocs = firestoreModule.getDocs;
        setDoc = firestoreModule.setDoc;
        deleteDoc = firestoreModule.deleteDoc;
        query = firestoreModule.query;
        where = firestoreModule.where;
        orderBy = firestoreModule.orderBy;
        serverTimestamp = firestoreModule.serverTimestamp;
        writeBatch = firestoreModule.writeBatch;

        console.log('Firebase initialized successfully');
        console.log('Database object:', db);
        return true;
    } catch (error) {
        console.error('Firebase initialization failed:', error);
        return false;
    }
}

// Main initialization
document.addEventListener('DOMContentLoaded', async function () {
    // Phase 1: Load from localStorage first (instant)
    const hasLocalData = loadFromLocalStorage();

    // Immediately show UI with local data
    loadDashboard();

    // Phase 2: Initialize Firebase (in background)
    const firebaseInitialized = await initializeFirebase();

    if (firebaseInitialized) {
        // Phase 3: Background Firebase sync (non-blocking)
        setTimeout(() => {
            initializeFirebaseSync();
        }, 100);
    } else {
        console.log('Running in offline mode - Firebase not available');
        showSyncStatus('⚠ Offline mode', 'error');
    }

    // Rest of initialization...
    if (document.getElementById('supplierName')) {
        setupSupplierAutocomplete();
    }

    if (document.getElementById('expenseDate')) {
        document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
        addItemRow();
    }

    const expenseForm = document.getElementById('expenseForm');
    if (expenseForm) {
        expenseForm.addEventListener('submit', handleFormSubmission);
    }

    const paidByInput = document.getElementById('paidBy');
    if (paidByInput) {
        createAutocomplete(
            paidByInput,
            getPaidByMatches,
            (payerName, inputElement) => {
                inputElement.value = payerName;
            },
            true
        );
    }
});

// Force sync before page unload
window.addEventListener('beforeunload', function (e) {
    if (hasPendingChanges && syncTimeout) {
        // Clear the timeout and sync immediately
        clearTimeout(syncTimeout);
        syncTimeout = null;

        // Force immediate sync (this is synchronous)
        syncToFirebase();
        hasPendingChanges = false;

        console.log('Forced sync before page unload');
    }
});

// Initialize Firebase background sync
async function initializeFirebaseSync() {
    if (!db) {
        console.log('Database not available, skipping sync');
        return;
    }

    try {
        // Fetch latest data from Firebase in background
        await fetchFromFirebase();

        // Set up periodic sync every 5 minutes
        setInterval(fetchFromFirebase, 5 * 60 * 1000);

        console.log('Firebase sync initialized');
    } catch (error) {
        console.error('Failed to initialize Firebase sync:', error);
        showSyncStatus('⚠ Offline mode', 'error');
    }
}

function loadFromLocalStorage() {
    try {
        const savedExpenses = localStorage.getItem('expenseTracker_expenses');
        const savedSuppliers = localStorage.getItem('expenseTracker_suppliers');

        if (savedExpenses) {
            expenses = JSON.parse(savedExpenses);
            console.log('Loaded expenses from localStorage:', expenses.length, 'items');
        }

        if (savedSuppliers) {
            suppliers = JSON.parse(savedSuppliers);
            console.log('Loaded suppliers from localStorage:', suppliers.length, 'items');
        }

        return expenses.length > 0 || suppliers.length > 0;
    } catch (error) {
        console.error('Failed to load from localStorage:', error);
        return false;
    }
}

// Enhanced data structure for Firebase sync
function enhanceDataForSync(item, type) {
    const now = new Date().toISOString();
    return {
        ...item,
        syncedAt: now,
        deviceId: getDeviceId(),
        type: type // 'expense' or 'supplier'
    };
}

function getDeviceId() {
    let deviceId = localStorage.getItem('expenseTracker_deviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('expenseTracker_deviceId', deviceId);
    }
    return deviceId;
}

window.syncToFirebase = syncToFirebase;

async function syncToFirebase() {
    if (!db || syncInProgress) {
        console.log('Database not available or sync in progress');
        return;
    }

    syncInProgress = true;

    try {
        console.log('Starting Firebase sync...');

        // Sync expenses with batch writes for better performance
        const batch = writeBatch(db);

        expenses.forEach(expense => {
            const docRef = doc(db, 'expenses', expense.id);
            batch.set(docRef, {
                ...expense,
                syncedAt: serverTimestamp(),
                deviceId: getDeviceId()
            });
        });

        suppliers.forEach(supplier => {
            const docRef = doc(db, 'suppliers', supplier.id);
            batch.set(docRef, {
                ...supplier,
                syncedAt: serverTimestamp(),
                deviceId: getDeviceId()
            });
        });

        await batch.commit();
        console.log('Firebase sync completed successfully');
        showSyncStatus('✓ Synced', 'success');

    } catch (error) {
        console.error('Firebase sync failed:', error);
        showSyncStatus('⚠ Sync failed - will retry', 'error');

        // Queue for retry
        setTimeout(() => {
            if (!syncInProgress) {
                syncToFirebase();
            }
        }, 5000);
        
        // Clear pending changes flag on successful sync
        hasPendingChanges = false;
    } finally {
        syncInProgress = false;
    }
}

async function syncCollectionToFirebase(collectionName, dataArray) {
    const collectionRef = collection(db, collectionName);

    for (const item of dataArray) {
        try {
            const enhancedItem = enhanceDataForSync(item, collectionName.slice(0, -1)); // Remove 's' from collection name
            await setDoc(doc(collectionRef, item.id), enhancedItem);
        } catch (error) {
            console.error(`Failed to sync ${collectionName} item ${item.id}:`, error);
            throw error;
        }
    }
}

// Fetch latest data from Firebase
async function fetchFromFirebase() {
    if (!db) {
        console.log('Database not available for fetching');
        return;
    }

    try {
        console.log('Fetching data from Firebase...');

        const [expensesSnapshot, suppliersSnapshot] = await Promise.all([
            getDocs(collection(db, 'expenses')),
            getDocs(collection(db, 'suppliers'))
        ]);

        const firebaseExpenses = expensesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        const firebaseSuppliers = suppliersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Merge with local data (smart conflict resolution)
        const mergeResult = mergeData(
            { expenses, suppliers },
            { expenses: firebaseExpenses, suppliers: firebaseSuppliers }
        );

        if (mergeResult.hasChanges) {
            expenses = mergeResult.expenses;
            suppliers = mergeResult.suppliers;
            saveToLocalStorage();
            loadDashboard();

            console.log('Data updated from Firebase');
            showSyncStatus('↓ Updated', 'success');
        } else {
            console.log('Local data is up to date');
        }

    } catch (error) {
        console.error('Failed to fetch from Firebase:', error);
        showSyncStatus('⚠ Fetch failed', 'error');
    }
}

// Smart data merging with conflict resolution
function mergeData(localData, firebaseData) {
    let hasChanges = false;
    const mergedExpenses = [...localData.expenses];
    const mergedSuppliers = [...localData.suppliers];

    // Merge expenses
    firebaseData.expenses.forEach(firebaseItem => {
        const localIndex = mergedExpenses.findIndex(item => item.id === firebaseItem.id);

        if (localIndex === -1) {
            // New item from Firebase
            mergedExpenses.push(firebaseItem);
            hasChanges = true;
        } else {
            // Conflict resolution: use newer timestamp
            const localItem = mergedExpenses[localIndex];
            const firebaseUpdated = new Date(firebaseItem.updatedAt || firebaseItem.createdAt);
            const localUpdated = new Date(localItem.updatedAt || localItem.createdAt);

            if (firebaseUpdated > localUpdated) {
                mergedExpenses[localIndex] = firebaseItem;
                hasChanges = true;
            }
        }
    });

    // Merge suppliers (same logic)
    firebaseData.suppliers.forEach(firebaseItem => {
        const localIndex = mergedSuppliers.findIndex(item => item.id === firebaseItem.id);

        if (localIndex === -1) {
            mergedSuppliers.push(firebaseItem);
            hasChanges = true;
        } else {
            const localItem = mergedSuppliers[localIndex];
            const firebaseUpdated = new Date(firebaseItem.updatedAt || firebaseItem.createdAt);
            const localUpdated = new Date(localItem.updatedAt || localItem.createdAt);

            if (firebaseUpdated > localUpdated) {
                mergedSuppliers[localIndex] = firebaseItem;
                hasChanges = true;
            }
        }
    });

    // Deduplicate suppliers by name, keeping most complete version
    const deduplicatedSuppliers = [];
    const seenNames = new Map();

    mergedSuppliers.forEach(supplier => {
        const existing = seenNames.get(supplier.name);
        if (!existing) {
            seenNames.set(supplier.name, supplier);
            deduplicatedSuppliers.push(supplier);
        } else {
            // Keep the one with more complete data
            const existingScore = (existing.tin ? 1 : 0) + (existing.businessName ? 1 : 0) + (existing.address ? 1 : 0);
            const currentScore = (supplier.tin ? 1 : 0) + (supplier.businessName ? 1 : 0) + (supplier.address ? 1 : 0);

            if (currentScore > existingScore) {
                const index = deduplicatedSuppliers.findIndex(s => s.id === existing.id);
                deduplicatedSuppliers[index] = supplier;
                seenNames.set(supplier.name, supplier);
            }
        }
    });

    return {
        expenses: mergedExpenses,
        suppliers: deduplicatedSuppliers,
        hasChanges
    };
}

// Operation queue for offline/failed syncs
function queueOperation(type, data) {
    pendingOperations.push({
        type,
        data,
        timestamp: Date.now()
    });

    // Retry after delay
    setTimeout(processPendingOperations, 5000);
}

async function processPendingOperations() {
    if (pendingOperations.length === 0 || syncInProgress) return;

    console.log(`Processing ${pendingOperations.length} pending operations`);

    for (let i = pendingOperations.length - 1; i >= 0; i--) {
        const operation = pendingOperations[i];

        try {
            if (operation.type === 'sync') {
                await syncToFirebase();
                pendingOperations.splice(i, 1);
            }
        } catch (error) {
            console.error('Failed to process pending operation:', error);
        }
    }
}

// Visual sync status indicator
function showSyncStatus(message, type) {
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

// Navigation functions
function showDashboard() {
    closeExpenseModal();
    loadDashboard();
}

function showAddExpenseModal() {
    // Store current scroll position
    const scrollY = window.scrollY;

    document.getElementById('expenseModalOverlay').classList.add('show');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;

    resetForm();
}

function closeExpenseModal() {
    document.getElementById('expenseModalOverlay').classList.remove('show');

    // Restore scroll position
    const scrollY = document.body.style.top;
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';

    if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1);
    }
}

// Dashboard functions
function loadDashboard() {
    const expenseList = document.getElementById('expenseList');
    
    if (expenses.length === 0) {
        expenseList.innerHTML = `
            <div class="empty-state">
                <p>No expenses recorded yet</p>
                <p style="font-size: 14px;">Click the + button to add your first expense</p>
            </div>
        `;
        return;
    }

    // Calculate summary based on current filter
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const thisWeek = getThisWeekRange();

    let filteredExpenses, summaryTitle;
    if (currentFilter === 'today') {
        filteredExpenses = expenses.filter(expense => expense.date === today);
        summaryTitle = "Today's Expenses";
    } else if (currentFilter === 'week') {
        filteredExpenses = expenses.filter(expense =>
            expense.date >= thisWeek.start && expense.date <= thisWeek.end
        );
        summaryTitle = "This Week's Expenses";
    } else if (currentFilter === 'month') {
        filteredExpenses = expenses.filter(expense => expense.date.startsWith(thisMonth));
        summaryTitle = "This Month's Expenses";
    } else {
        filteredExpenses = expenses; // all expenses
        summaryTitle = "All Expenses";
    }

    const filteredTotal = filteredExpenses.reduce((sum, expense) => sum + expense.totalAmount, 0);

    // Sort expenses by date (newest first) and filter based on current filter
    let expensesToShow;
    if (currentFilter === 'today') {
        expensesToShow = expenses.filter(expense => expense.date === today);
    } else if (currentFilter === 'week') {
        expensesToShow = expenses.filter(expense =>
            expense.date >= thisWeek.start && expense.date <= thisWeek.end
        );
    } else if (currentFilter === 'month') {
        expensesToShow = expenses.filter(expense => expense.date.startsWith(thisMonth));
    } else {
        expensesToShow = expenses; // all expenses
    }

    const sortedExpenses = [...expensesToShow].sort((a, b) => new Date(b.date) - new Date(a.date));

    const summaryCard = `
    <div class="summary-card" onclick="showSummaryOptions()">
        <div class="summary-title">${summaryTitle}</div>
        <div class="summary-amount">₱${filteredTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="summary-count">${filteredExpenses.length} ${filteredExpenses.length === 1 ? 'transaction' : 'transactions'}</div>
    </div>
`;

    const expenseCards = sortedExpenses.map(expense => {
        const itemsText = expense.items.length > 3
            ? `${expense.items.slice(0, 3).map(item => item.name).join(', ')} + ${expense.items.length - 3} more`
            : expense.items.map(item => item.name).join(', ');

        const isToday = expense.date === today;

        return `
            <div class="expense-card">
                <div class="expense-header">
                    <div class="expense-header-content" onclick="viewExpense('${expense.id}')">
                        <div class="expense-left">
                            <div class="expense-supplier">${expense.supplierName}</div>
                            <div class="expense-items">${itemsText}</div>
                        </div>
                        <div class="expense-right">
                            <div class="expense-amount">₱${expense.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                    </div>
                    <div class="expense-card-actions">
                        <button class="expense-action-btn edit" onclick="editExpense('${expense.id}', event)" title="Edit expense">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path>
                            </svg>
                        </button>
                        <button class="expense-action-btn delete" onclick="deleteExpense('${expense.id}', event)" title="Delete expense">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3,6 5,6 21,6"></polyline>
                                <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="expense-footer" onclick="viewExpense('${expense.id}')">
                   <div class="expense-branch">${expense.branch} • ${expense.paymentMethod}${expense.invoiceNumber ? ' • #' + expense.invoiceNumber : ''}${expense.isVatRegistered && expense.vatAmount > 0 ? ' • VAT' : ''}</div>
                    <div class="expense-date">${isToday ? 'Today' : formatDate(expense.date)}</div>
                </div>
            </div>
        `;
    }).join('');

    expenseList.innerHTML = summaryCard + expenseCards;
}

function formatDate(dateString) {
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

function viewExpense(expenseId) {
    const expense = expenses.find(e => e.id === expenseId);
    if (!expense) {
        showToast('Expense not found');
        return;
    }

    showExpenseDetailModal(expense);
}

function showExpenseDetailModal(expense) {
    const modal = document.getElementById('expenseDetailModalOverlay');
    const content = document.getElementById('expenseDetailContent');

    // Format the date
    const expenseDate = new Date(expense.date);
    const isToday = expense.date === new Date().toISOString().split('T')[0];
    const formattedDate = isToday ? 'Today' : formatDate(expense.date);

    // Update modal header to include action buttons
    const modalHeader = modal.querySelector('.modal-header');
    const existingActions = modalHeader.querySelector('.modal-header-actions');

    // Remove any existing action buttons
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

    existingActions.insertBefore(actionButtons, existingActions.firstChild);

    // Build the content
    content.innerHTML = `
        <!-- Basic Information -->
        <div class="expense-detail-section">
            <h3>Basic Information</h3>
            <div class="expense-detail-row">
                <div class="expense-detail-label">Date</div>
                <div class="expense-detail-value">${formattedDate}</div>
            </div>
            <div class="expense-detail-row">
                <div class="expense-detail-label">Branch</div>
                <div class="expense-detail-value">${expense.branch}</div>
            </div>
            <div class="expense-detail-row">
                <div class="expense-detail-label">Total Amount</div>
                <div class="expense-detail-value amount">₱${expense.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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

        <!-- Payment Information -->
        <div class="expense-detail-section">
            <h3>Payment Information</h3>
            <div class="expense-detail-row">
                <div class="expense-detail-label">Payment Method</div>
                <div class="expense-detail-value">${expense.paymentMethod}</div>
            </div>
            ${expense.paidBy ? `
            <div class="expense-detail-row">
                <div class="expense-detail-label">Paid By</div>
                <div class="expense-detail-value">${expense.paidBy}</div>
            </div>
            ` : ''}
            ${expense.invoiceNumber ? `
            <div class="expense-detail-row">
                <div class="expense-detail-label">Invoice Number</div>
                <div class="expense-detail-value">${expense.invoiceNumber}</div>
            </div>
            ` : ''}
        </div>

        ${expense.isVatRegistered && expense.vatAmount > 0 ? `
        <!-- VAT Information -->
        <div class="expense-detail-section">
            <h3>VAT Information</h3>
            <div class="expense-detail-row">
                <div class="expense-detail-label">VAT Registered</div>
                <div class="expense-detail-value">
                    <div class="vat-registered-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                        Yes
                    </div>
                </div>
            </div>
            ${expense.vatExemptAmount > 0 ? `
            <div class="expense-detail-row">
                <div class="expense-detail-label">VAT Exempt Amount</div>
                <div class="expense-detail-value">₱${expense.vatExemptAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            ` : ''}
            <div class="expense-detail-row">
                <div class="expense-detail-label">Taxable Amount</div>
                <div class="expense-detail-value">₱${((expense.totalAmount || 0) - (expense.vatExemptAmount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div class="expense-detail-row">
                <div class="expense-detail-label">Vatable Sale</div>
                <div class="expense-detail-value">₱${(expense.vatableSale || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div class="expense-detail-row">
                <div class="expense-detail-label">VAT Amount (12%)</div>
                <div class="expense-detail-value amount">₱${(expense.vatAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
        </div>
        ` : ''}

        ${expense.notes ? `
        <!-- Notes -->
        <div class="expense-detail-section">
            <h3>Notes</h3>
            <div class="expense-detail-value">${expense.notes}</div>
        </div>
        ` : ''}

        <!-- Receipt -->
        <div class="expense-detail-section">
            <h3>Receipt</h3>
            ${expense.receiptImage ? `
                <div class="expense-detail-receipt">
                    <img src="${expense.receiptImage}" alt="Receipt" onclick="viewReceiptFullscreen('${expense.receiptImage}')">
                </div>
            ` : `
                <div class="expense-detail-no-receipt">No receipt attached</div>
            `}
        </div>
    `;

    // Store current scroll position
    const scrollY = window.scrollY;

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
}

function closeExpenseDetailModal() {
    const modal = document.getElementById('expenseDetailModalOverlay');
    modal.classList.remove('show');

    // Restore scroll position
    const scrollY = document.body.style.top;
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';

    if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1);
    }
}

function viewReceiptFullscreen(imageSrc) {
    // Create a simple fullscreen image viewer
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 3000;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    `;

    const img = document.createElement('img');
    img.src = imageSrc;
    img.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
    `;

    overlay.appendChild(img);
    document.body.appendChild(overlay);

    overlay.onclick = function () {
        document.body.removeChild(overlay);
    };
}

function resetForm() {
    // Clear editing state
    delete window.editingExpenseId;
    document.querySelector('.modal-title').textContent = 'Add Expense';

    document.getElementById('expenseForm').reset();

    // Reset date and branch if they exist
    const dateInput = document.getElementById('expenseDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const branchInput = document.getElementById('branch');
    if (branchInput) branchInput.value = 'SM North';

    // Clear containers
    document.getElementById('itemsContainer').innerHTML = '';
    const totalInput = document.getElementById('totalAmountInput');
    if (totalInput) totalInput.value = '';

    // Reset counter
    itemCounter = 0;

    // Add first item row
    addItemRow();

    // Re-setup autocomplete for supplier (since form was reset)
    setupSupplierAutocomplete();

    // Re-setup paid by autocomplete
    const paidByInput = document.getElementById('paidBy');
    if (paidByInput) {
        createAutocomplete(
            paidByInput,
            getPaidByMatches,
            (payerName, inputElement) => {
                inputElement.value = payerName;
            },
            true
        );
    }

    // Reset VAT section
    const vatSection = document.getElementById('vatSection');
    const vatToggle = document.getElementById('vatComputationEnabled');
    const vatToggleTrack = document.getElementById('vatToggleTrack');
    const vatDetailsSection = document.getElementById('vatDetailsSection');

    if (vatSection) {
        // For new expenses, assume VAT registered by default so users can input if needed
        vatSection.style.display = 'block';
        if (vatToggle) vatToggle.checked = true;
        if (vatToggleTrack) vatToggleTrack.classList.add('active');
        if (vatDetailsSection) vatDetailsSection.style.display = 'block';

        const vatExemptInput = document.getElementById('vatExemptAmount');
        if (vatExemptInput) vatExemptInput.value = '';

        const vatBreakdown = document.getElementById('vatBreakdown');
        if (vatBreakdown) vatBreakdown.style.display = 'none';
    }

    // Clear receipt data
    removeReceipt({ stopPropagation: () => { } });
    window.currentReceiptData = null;
}

// Receipt upload
function handleReceiptUpload(input) {
    const file = input.files[0];
    if (file) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            showToast('Please select an image file');
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            showToast('Image size must be less than 5MB');
            return;
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            const preview = document.getElementById('receiptPreview');
            const uploadText = document.getElementById('receiptUploadText');
            const uploadArea = document.querySelector('.receipt-upload');
            const removeBtn = document.getElementById('removeReceiptBtn');

            preview.src = e.target.result;
            preview.style.display = 'block';
            uploadText.textContent = file.name;
            uploadArea.classList.add('has-file');
            removeBtn.style.display = 'block';

            // Store the image data for saving
            window.currentReceiptData = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

function removeReceipt(event) {
    event.stopPropagation();

    const preview = document.getElementById('receiptPreview');
    const uploadText = document.getElementById('receiptUploadText');
    const uploadArea = document.querySelector('.receipt-upload');
    const removeBtn = document.getElementById('removeReceiptBtn');
    const input = document.getElementById('receiptInput');

    preview.style.display = 'none';
    preview.src = '';
    uploadText.textContent = 'Tap to add receipt photo';
    uploadArea.classList.remove('has-file');
    removeBtn.style.display = 'none';
    input.value = '';

    // Clear stored image data
    window.currentReceiptData = null;
}

function createAutocomplete(inputElement, getMatches, onSelect, showOnFocus = false) {
    if (!inputElement) return;

    const formGroup = inputElement.parentElement;
    let dropdown = formGroup.querySelector('.autocomplete-dropdown');

    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'autocomplete-dropdown hidden';

        // For item inputs, append to modal content to escape stacking context hell
        if (inputElement.name === 'itemName') {
            document.querySelector('.modal-content').appendChild(dropdown);
            dropdown.style.position = 'absolute';
            dropdown.style.zIndex = '99999';
        } else {
            formGroup.style.position = 'relative';
            formGroup.appendChild(dropdown);
        }
    }

    // Create unique ID if input doesn't have one
    if (!inputElement.id) {
        inputElement.id = 'autocomplete_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function updateDropdown(query = '') {
        const matches = getMatches(query);

        if (matches.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }

        dropdown.innerHTML = matches.map((match, index) =>
            `<div class="autocomplete-item" onclick="selectAutocompleteItem('${encodeURIComponent(match.id)}', '${inputElement.id}')">${match.display}</div>`
        ).join('');

        // Position item dropdowns manually
        if (inputElement.name === 'itemName') {
            const rect = inputElement.getBoundingClientRect();
            const modalRect = document.querySelector('.expense-modal').getBoundingClientRect();
            dropdown.style.top = (rect.bottom - modalRect.top + document.querySelector('.expense-modal').scrollTop) + 'px';
            dropdown.style.left = (rect.left - modalRect.left) + 'px';
            dropdown.style.width = rect.width + 'px';
        }

        dropdown.classList.remove('hidden');
    }

    // Store the onSelect callback for this input
    inputElement._autocompleteSelect = onSelect;

    inputElement.addEventListener('input', function () {
        const query = this.value.toLowerCase().trim();
        updateDropdown(query);
    });

    if (showOnFocus) {
        inputElement.addEventListener('focus', function () {
            setTimeout(() => {
                if (document.activeElement === this && this.value.trim() === '') {
                    updateDropdown('');
                }
            }, 100);
        });
    }

    // Hide dropdown when clicking outside
    function hideDropdownHandler(e) {
        if (!inputElement.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    }

    document.addEventListener('click', hideDropdownHandler);
    document.addEventListener('touchend', hideDropdownHandler);

    // Hide dropdown when input loses focus
    inputElement.addEventListener('blur', function () {
        setTimeout(() => {
            dropdown.classList.add('hidden');
        }, 150);
    });

    // Reposition on scroll for item inputs
    if (inputElement.name === 'itemName') {
        document.querySelector('.expense-modal').addEventListener('scroll', function () {
            if (!dropdown.classList.contains('hidden')) {
                updateDropdown(inputElement.value.toLowerCase().trim());
            }
        });
    }
}

function getItemMatches(query, currentSupplier = '') {
    // Get all unique items from expenses
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
    
    // Convert to array and filter/sort
    const items = Array.from(allItems.values()).map(item => {
        const name = item.name.toLowerCase();
        let priority = 999;

        // Priority 1: Exact match
        if (name === query) priority = 1;
        // Priority 2: Starts with query
        else if (name.startsWith(query)) priority = 2;
        // Priority 3: Word starts with query
        else if (name.split(' ').some(word => word.startsWith(query))) priority = 3;
        // Priority 4: Contains query
        else if (query && name.includes(query)) priority = 4;
        // Priority 5: No query (show all)
        else if (!query) priority = 5;

        // Boost priority if item was ordered from current supplier
        if (currentSupplier && item.suppliers.has(currentSupplier)) {
            priority = Math.max(1, priority - 1);
        }

        // Secondary sort by frequency
        const secondarySort = -item.frequency;

        return { ...item, priority, secondarySort, display: item.name };
    });

    return items
        .filter(item => item.priority < 999)
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (a.secondarySort !== b.secondarySort) return a.secondarySort - b.secondarySort;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 10); // Limit to 10 suggestions
}

function getPaidByMatches(query) {
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

function selectAutocompleteItem(itemId, inputId) {
    if (!inputId || !itemId) return;

    const decodedItemId = decodeURIComponent(itemId);
    const inputElement = document.getElementById(inputId);

    if (!inputElement) return;

    const callback = inputElement._autocompleteSelect;
    if (callback) {
        callback(decodedItemId, inputElement);
    }

    const dropdown = inputElement.parentElement.querySelector('.autocomplete-dropdown');
    if (dropdown) {
        dropdown.classList.add('hidden');

        // Reset z-index for item inputs
        if (inputElement.name === 'itemName') {
            const formGroup = inputElement.closest('.form-group');
            if (formGroup) {
                formGroup.style.zIndex = '';
            }
        }
    }
}

function setupSupplierAutocomplete() {
    const supplierInput = document.getElementById('supplierName');

    createAutocomplete(
        supplierInput,
        (query) => {
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
        },
        (supplierId) => selectSupplier(supplierId),
        true // Show on focus
    );
}

function setupItemInputAutocomplete(nameInput) {
    if (!nameInput) return;

    createAutocomplete(
        nameInput,
        (query) => {
            // Get current supplier for prioritization
            const supplierInput = document.getElementById('supplierName');
            const currentSupplier = supplierInput ? supplierInput.value : '';
            return getItemMatches(query, currentSupplier);
        },
        (itemName, inputElement) => {
            // Simply set the item name directly
            inputElement.value = itemName;
        },
        true // Show on focus
    );
}

function selectSupplier(supplierId) {
    const supplier = suppliers.find(s => s.id === supplierId);
    if (supplier) {
        const supplierInput = document.getElementById('supplierName');
        const dropdown = supplierInput.parentElement.querySelector('.autocomplete-dropdown');
        const formGroup = supplierInput.parentElement;

        supplierInput.value = supplier.name;
        supplierInput.classList.add('supplier-selected');
        supplierInput.setAttribute('data-supplier-id', supplier.id);

        if (dropdown) {
            dropdown.classList.add('hidden');
        }

        // Show VAT section logic
        const vatSection = document.getElementById('vatSection');
        const vatToggle = document.getElementById('vatComputationEnabled');
        const vatToggleTrack = document.getElementById('vatToggleTrack');
        const vatDetailsSection = document.getElementById('vatDetailsSection');

        if (vatSection) {
            if (supplier.isVatRegistered) {
                // Supplier is VAT registered - show section with toggle enabled by default
                vatSection.style.display = 'block';
                vatToggle.checked = true;
                vatToggleTrack.classList.add('active');
                vatDetailsSection.style.display = 'block';
                updateVatCalculation();
            } else {
                // Supplier is not VAT registered - hide section completely
                vatSection.style.display = 'none';
            }
        }

        let clearBtn = formGroup.querySelector('.supplier-clear-btn');
        if (!clearBtn) {
            clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'supplier-clear-btn';
            clearBtn.innerHTML = '×';
            clearBtn.onclick = clearSelectedSupplier;
            formGroup.appendChild(clearBtn);
        }
    }
}

function clearSelectedSupplier() {
    const supplierInput = document.getElementById('supplierName');
    const formGroup = supplierInput.parentElement;
    const clearBtn = formGroup.querySelector('.supplier-clear-btn');

    // Clear input and styling
    supplierInput.value = '';
    supplierInput.classList.remove('supplier-selected');
    supplierInput.removeAttribute('data-supplier-id');

    // Remove clear button
    if (clearBtn) {
        clearBtn.remove();
    }

    // Clear other fields if they exist
    const businessNameInput = document.getElementById('businessName');
    if (businessNameInput) businessNameInput.value = '';

    const tinInput = document.getElementById('tin');
    if (tinInput) tinInput.value = '';

    const addressInput = document.getElementById('address');
    if (addressInput) addressInput.value = '';

    // Hide supplier section if it exists
    const supplierSection = document.getElementById('supplierSection');
    if (supplierSection) supplierSection.classList.remove('show');

    // Focus back on input
    supplierInput.focus();
}

function addItemRow() {
    // Force close all autocomplete dropdowns first
    document.querySelectorAll('.autocomplete-dropdown').forEach(dropdown => {
        dropdown.classList.add('hidden');
    });

    const container = document.getElementById('itemsContainer');
    const itemId = ++itemCounter;

    const itemRow = document.createElement('div');
    itemRow.className = 'item-row';
    itemRow.setAttribute('data-item-id', itemId);

    // Add mobile-specific attributes
    itemRow.style.touchAction = 'manipulation';
    itemRow.style.position = 'relative';
    itemRow.style.zIndex = '1';

    const showRemoveBtn = container.children.length > 0;

    // Check if we're in total-only mode more reliably
    const totalInput = document.getElementById('totalAmountInput');
    const existingItems = document.querySelectorAll('.item-row');
    const hasHiddenBreakdowns = existingItems.length > 0 &&
        existingItems[0].querySelector('.item-breakdown').style.display === 'none';

    // Always start in total-only mode (hide breakdowns by default)
    const isInTotalMode = true;
    const breakdownStyle = 'style="display: none;"';
    const showPriceBtn = '';

    itemRow.innerHTML = `
        ${showRemoveBtn ? `<button type="button" class="remove-item-btn" onclick="removeItemRow(${itemId})" style="touch-action: manipulation; pointer-events: auto;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3,6 5,6 21,6"></polyline>
                <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
        </button>` : ''}
        <div class="form-group" style="position: relative; z-index: 2;">
            <label>Item Name</label>
            <div class="item-name-row">
                <input type="text" name="itemName" required placeholder="Enter item name" style="flex: 1; touch-action: manipulation;">
                <button type="button" class="add-price-btn" ${showPriceBtn} onclick="showItemBreakdown(${itemId})" style="touch-action: manipulation; pointer-events: auto;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="19" cy="12" r="1"></circle>
                        <circle cx="5" cy="12" r="1"></circle>
                    </svg>
                </button>
            </div>
        </div>
        <div class="form-row item-breakdown" ${breakdownStyle}>
            <div class="form-group quantity-group">
                <label>Qty</label>
                <input type="number" name="itemQuantity" min="1" step="any" value="1" inputmode="numeric" onchange="updateFromItems()" onfocus="this.select()" style="touch-action: manipulation;">
            </div>
            <div class="form-group price-group">
                <label>Unit Price</label>
                <input type="text" name="itemPrice" placeholder="₱0.00" inputmode="decimal" onchange="formatPesoInput(this); updateFromItems()" onblur="formatPesoInput(this)" style="touch-action: manipulation;">
            </div>
        </div>
    `;

    container.appendChild(itemRow);

    // Setup autocomplete for the new item input
    const nameInput = itemRow.querySelector('[name="itemName"]');
    setupItemInputAutocomplete(nameInput);

    // Don't auto-focus to prevent autocomplete from showing immediately
    // setTimeout(() => nameInput.focus(), 100);
}

function removeItemRow(itemId) {
    const itemRow = document.querySelector(`[data-item-id="${itemId}"]`);
    const container = document.getElementById('itemsContainer');

    if (itemRow) {
        itemRow.remove();

        // If no items left, add one automatically
        if (container.children.length === 0) {
            addItemRow();
        }
    }
}

function showItemBreakdown(itemId) {
    // Show breakdown for ALL items, not just the clicked one
    const allItemRows = document.querySelectorAll('.item-row');

    allItemRows.forEach(row => {
        const breakdown = row.querySelector('.item-breakdown');
        const priceBtn = row.querySelector('.add-price-btn');

        breakdown.style.display = 'flex';
        if (priceBtn) priceBtn.style.display = 'none';
    });

    // Clear the total to switch back to calculated mode
    document.getElementById('totalAmountInput').value = '';

    // Focus on the clicked item's quantity field
    const clickedItemRow = document.querySelector(`[data-item-id="${itemId}"]`);
    const quantityInput = clickedItemRow.querySelector('[name="itemQuantity"]');
    quantityInput.focus();
    quantityInput.select();

    updateFromItems();
}

function handleFormSubmission(e) {
    e.preventDefault();

    // Check if we're editing an existing expense
    const isEditing = window.editingExpenseId;

    // Helper function to safely get element value
    function getElementValue(id, defaultValue = '') {
        const element = document.getElementById(id);
        return element ? element.value : defaultValue;
    }

    const items = [];
    const itemRows = document.querySelectorAll('.item-row');
    const totalAmountInput = document.getElementById('totalAmountInput');
    const totalAmount = totalAmountInput ? parseFloat(totalAmountInput.value.replace(/[₱,]/g, '')) || 0 : 0;

    itemRows.forEach(row => {
        const name = row.querySelector('[name="itemName"]').value;
        const quantity = parseFloat(row.querySelector('[name="itemQuantity"]').value) || 1;
        const price = parseFloat(row.querySelector('[name="itemPrice"]').value.replace(/[₱,]/g, '')) || 0;

        if (name) {
            items.push({
                name,
                quantity,
                price,
                total: quantity * price
            });
        }
    });

    if (items.length === 0) {
        showToast('Please add at least one item');
        return;
    }

    if (totalAmount === 0) {
        showToast('Please enter a total amount');
        return;
    }

    // Validate required fields
    if (!getElementValue('supplierName')) {
        showToast('Please enter a supplier name');
        return;
    }

    // Create the expense object
    const expense = {
        id: isEditing ? window.editingExpenseId : generateId(),
        date: getElementValue('expenseDate', new Date().toISOString().split('T')[0]),
        branch: getElementValue('branch', 'SM North'),
        supplierName: getElementValue('supplierName'),
        businessName: getElementValue('businessName'),
        tin: getElementValue('tin'),
        address: getElementValue('address'),
        invoiceNumber: getElementValue('invoiceNumber'),
        items,
        totalAmount,
        vatExemptAmount: parseFloat(getElementValue('vatExemptAmount')) || 0,
        paymentMethod: getElementValue('paymentMethod', 'Cash'),
        paidBy: getElementValue('paidBy'),
        notes: getElementValue('notes'),
        receiptImage: window.currentReceiptData || null,
        createdAt: isEditing ?
            (expenses.find(e => e.id === window.editingExpenseId)?.createdAt || new Date().toISOString()) :
            new Date().toISOString()
    };

    // Calculate VAT breakdown if VAT computation is enabled
    const supplier = suppliers.find(s => s.name.toLowerCase() === expense.supplierName.toLowerCase());
    const vatComputationEnabled = document.getElementById('vatComputationEnabled')?.checked || false;

    if (vatComputationEnabled && (supplier?.isVatRegistered || !supplier)) {
        const taxableAmount = totalAmount - (expense.vatExemptAmount || 0);
        expense.vatableSale = taxableAmount / 1.12;
        expense.vatAmount = taxableAmount - expense.vatableSale;
        expense.isVatRegistered = true;
    } else {
        expense.vatableSale = 0;
        expense.vatAmount = 0;
        expense.isVatRegistered = false;
    }

    if (isEditing) {
        // Update existing expense
        const index = expenses.findIndex(e => e.id === window.editingExpenseId);
        if (index > -1) {
            expense.updatedAt = new Date().toISOString(); // Add update timestamp
            expenses[index] = expense;
            saveToLocalStorage(); // Add this line
            showToast('Expense updated successfully!');
        }

        // Clear editing state
        delete window.editingExpenseId;
        document.querySelector('.modal-title').textContent = 'Add Expense';
    } else {
        // Create new expense
        expenses.push(expense);
        showToast('Expense saved successfully!');
    }

    // Save to localStorage and sync
    saveToLocalStorage();

    // Check if supplier is new and show add supplier modal
    const supplierName = expense.supplierName.trim();
    const existingSupplier = suppliers.find(s =>
        s.name.toLowerCase() === supplierName.toLowerCase()
    );

    if (!existingSupplier && !isEditing) {
        // Don't save the supplier yet - let the modal handle it
        setTimeout(() => {
            closeExpenseModal();
            loadDashboard();

            // Show add supplier details modal after a short delay
            setTimeout(() => {
                showAddSupplierModal(supplierName);
            }, 400);
        }, 300);
    } else {
        // For existing suppliers or when editing, save normally
        saveSupplierIfNew(expense);
        setTimeout(() => {
            closeExpenseModal();
            loadDashboard();
        }, 300);
    }

    setTimeout(() => {
        closeExpenseModal();
        loadDashboard();
    }, 300);
}

function saveSupplierIfNew(expense) {
    const supplierName = expense.supplierName.trim();
    const businessName = expense.businessName.trim();

    if (!supplierName) return;

    // Check if supplier already exists
    const existingSupplier = suppliers.find(s =>
        s.name.toLowerCase() === supplierName.toLowerCase() ||
        (businessName && s.businessName.toLowerCase() === businessName.toLowerCase())
    );

    if (!existingSupplier) {
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
        
    }
}

// Add sample data for testing
function addSampleData() {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const sampleExpenses = [
        {
            id: generateId(),
            date: today,
            branch: 'SM North',
            supplierName: 'Metro Supermarket',
            businessName: 'Metro Retail Stores Group Inc.',
            tin: '123-456-789-000',
            address: 'SM North EDSA, Quezon City',
            invoiceNumber: 'INV-2024-001',
            items: [
                { name: 'Coffee Beans', quantity: 5, price: 250, total: 1250 },
                { name: 'Milk', quantity: 10, price: 85, total: 850 },
                { name: 'Sugar', quantity: 2, price: 45, total: 90 }
            ],
            totalAmount: 2190,
            paymentMethod: 'Credit Card',
            paidBy: 'John Doe',
            notes: 'Monthly supplies for cafe',
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            date: today,
            branch: 'Podium',
            supplierName: 'Puregold',
            businessName: 'Puregold Price Club Inc.',
            tin: '987-654-321-000',
            address: 'The Podium, Ortigas Center',
            invoiceNumber: 'REF-240615',
            items: [
                { name: 'Cleaning Supplies', quantity: 3, price: 120, total: 360 },
                { name: 'Paper Towels', quantity: 5, price: 65, total: 325 }
            ],
            totalAmount: 685,
            paymentMethod: 'GCash',
            paidBy: 'Jane Smith',
            notes: 'Store maintenance supplies',
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            date: yesterdayStr,
            branch: 'Makati',
            supplierName: 'Office Warehouse',
            businessName: 'Office Warehouse Inc.',
            tin: '555-666-777-000',
            address: 'Makati Avenue, Makati City',
            items: [
                { name: 'Receipt Paper', quantity: 10, price: 45, total: 450 },
                { name: 'Pens', quantity: 20, price: 15, total: 300 },
                { name: 'Notebooks', quantity: 5, price: 80, total: 400 }
            ],
            totalAmount: 1150,
            paymentMethod: 'Cash',
            paidBy: 'Mark Johnson',
            notes: 'Office supplies restock',
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            date: yesterdayStr,
            branch: 'BGC',
            supplierName: 'FoodSource Co.',
            businessName: 'FoodSource Corporation',
            tin: '111-222-333-000',
            address: 'BGC, Taguig City',
            items: [
                { name: 'Bread', quantity: 20, price: 25, total: 500 },
                { name: 'Pastries', quantity: 15, price: 35, total: 525 }
            ],
            totalAmount: 1025,
            paymentMethod: 'Debit Card',
            paidBy: 'Sarah Lee',
            notes: 'Daily pastry supplies',
            createdAt: new Date().toISOString()
        }
    ];

    expenses = sampleExpenses;
    saveToLocalStorage();

    // Also create sample suppliers
    const sampleSuppliers = [
        {
            id: generateId(),
            name: 'Metro Supermarket',
            businessName: 'Metro Retail Stores Group Inc.',
            tin: '123-456-789-000',
            address: 'SM North EDSA, Quezon City',
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            name: 'Puregold',
            businessName: 'Puregold Price Club Inc.',
            tin: '987-654-321-000',
            address: 'The Podium, Ortigas Center',
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            name: 'Office Warehouse',
            businessName: 'Office Warehouse Inc.',
            tin: '555-666-777-000',
            address: 'Makati Avenue, Makati City',
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            name: 'FoodSource Co.',
            businessName: 'FoodSource Corporation',
            tin: '111-222-333-000',
            address: 'BGC, Taguig City',
            createdAt: new Date().toISOString()
        }
    ];

    suppliers = sampleSuppliers;
    saveToLocalStorage();
}

// Utility functions
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function resetData() {
    expenses = [];
    suppliers = [];
    saveToLocalStorage();
    loadDashboard();
    showToast('Data cleared!');
}

// function handleTotalChange() {
//     const totalInput = document.getElementById('totalAmountInput');
//     const itemRows = document.querySelectorAll('.item-row');

//     // Get numeric value, removing peso sign and commas
//     const numericValue = parseFloat(totalInput.value.replace(/[₱,]/g, '')) || 0;

//     // If user manually enters a total, hide the price breakdown and show price buttons
//     if (numericValue > 0) {
//         itemRows.forEach(row => {
//             const breakdown = row.querySelector('.item-breakdown');
//             const priceBtn = row.querySelector('.add-price-btn');
//             breakdown.style.display = 'none';
//             if (priceBtn) priceBtn.style.display = 'block';
//         });
//     }
// }

function updateFromItems() {
    const itemRows = document.querySelectorAll('.item-row');
    let total = 0;

    itemRows.forEach(row => {
        const breakdown = row.querySelector('.item-breakdown');
        breakdown.style.display = 'flex';

        const quantity = parseFloat(row.querySelector('[name="itemQuantity"]').value) || 0;
        const priceInput = row.querySelector('[name="itemPrice"]');
        const price = getPesoValue(priceInput);
        total += quantity * price;
    });

    document.getElementById('totalAmountInput').value = total.toFixed(2);
}

function showItemDetails(itemId) {
    const details = document.getElementById(`itemDetails${itemId}`);
    details.classList.add('show');
}

function formatTotal() {
    const input = document.getElementById('totalAmountInput');
    // Remove peso sign and commas before parsing
    let value = parseFloat(input.value.replace(/[₱,]/g, '')) || 0;
    input.value = value.toFixed(2);
}

function formatPesoInput(input) {
    let value = input.value.replace(/[₱,]/g, '');
    if (value && !isNaN(value)) {
        input.value = '₱' + parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
}

function getPesoValue(input) {
    return parseFloat(input.value.replace(/[₱,]/g, '')) || 0;
}

function handleCSVImport(input) {
    const file = input.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
        showToast('Please select a CSV file');
        return;
    }

    showImportProgress();

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            parseAndImportCSV(e.target.result);
        } catch (error) {
            console.error('Import error:', error);
            showToast('Error reading CSV file');
            hideImportProgress();
        }
    };
    reader.readAsText(file);

    // Clear the input
    input.value = '';
}

function findSimilarExpense(newExpense, tolerancePercent = 0.05) {
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

function mergeExpenseData(existingExpense, newExpense) {
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

    return mergedExpense;
}

function parseAndImportCSV(csvText) {
    console.log('Raw CSV text:', csvText.substring(0, 500));

    const lines = csvText.split('\n').filter(line => line.trim());
    console.log('Total lines:', lines.length);

    if (lines.length < 2) {
        showToast('CSV file appears to be empty');
        hideImportProgress();
        return;
    }

    const headers = parseCSVLine(lines[0]);
    console.log('Parsed headers:', headers);

    const importedExpenses = [];
    let successCount = 0;
    let errorCount = 0;

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
        try {
            const values = parseCSVLine(lines[i]);

            // Skip empty rows - check if all values are empty
            if (values.every(val => !val || val.trim() === '')) {
                continue;
            }

            // Skip rows with insufficient meaningful data
            if (values.length < 4) {
                errorCount++;
                continue;
            }

            const expense = parseExpenseFromCSV(headers, values);

            if (expense) {
                importedExpenses.push(expense);
                successCount++;
            } else {
                errorCount++;
            }

            updateImportProgress(i, lines.length - 1);

        } catch (error) {
            console.error(`Error parsing line ${i + 1}:`, error);
            errorCount++;
        }
    }

    console.log('Import results:', { successCount, errorCount, importedExpenses: importedExpenses.length });

    // Process imported expenses for duplicates and merging
    if (importedExpenses.length > 0) {
        let newCount = 0;
        let mergedCount = 0;
        let skippedCount = 0;

        // Store the original expenses array to compare against (before import)
        const originalExpenses = [...expenses];

        // Process all imported expenses
        const expensesToAdd = [];

        importedExpenses.forEach(newExpense => {
            // Only compare against ORIGINAL expenses, not newly imported ones
            const similarExpense = originalExpenses.find(existingExpense => {
                const newDate = newExpense.date;
                const newAmount = newExpense.totalAmount;
                const tolerance = newAmount * 0.05;

                // Check if dates match and amounts are within tolerance
                if (existingExpense.date !== newDate) return false;
                const amountDiff = Math.abs(existingExpense.totalAmount - newAmount);
                return amountDiff <= tolerance;
            });

            if (similarExpense) {
                // Found a similar expense in original data, merge it
                const mergedExpense = mergeExpenseData(similarExpense, newExpense);

                // Update the existing expense in the main array
                const index = expenses.findIndex(e => e.id === similarExpense.id);
                if (index > -1) {
                    expenses[index] = mergedExpense;
                    mergedCount++;
                    console.log(`Merged expense: ${newExpense.supplierName} - ₱${newExpense.totalAmount}`);
                }
            } else {
                // No similar expense found in original data, add as new
                if (!newExpense.isVatRegistered) {
                    newExpense.vatableSale = 0;
                    newExpense.vatAmount = 0;
                    newExpense.vatExemptAmount = 0;
                    newExpense.isVatRegistered = false;
                }

                expensesToAdd.push(newExpense);
                newCount++;
                console.log(`Added new expense: ${newExpense.supplierName} - ₱${newExpense.totalAmount}`);
            }
        });

        // Add all new expenses at once
        expenses.push(...expensesToAdd);

        // Extract and save new suppliers from all processed expenses
        importedExpenses.forEach(expense => saveSupplierIfNew(expense));

        saveToLocalStorage();

        // Show detailed import results
        let message = `Import completed! `;
        if (newCount > 0) message += `${newCount} new expenses added`;
        if (mergedCount > 0) {
            if (newCount > 0) message += `, `;
            message += `${mergedCount} expenses merged`;
        }
        if (errorCount > 0) {
            message += `, ${errorCount} errors`;
        }

        showToast(message);
        loadDashboard();
    } else {
        showToast('No valid expenses found in CSV file');
    }

    hideImportProgress();
}

function parseCSVLine(line) {
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

// function parseExpenseFromCSV(headers, values) {
//     const data = {};

//     // Map CSV columns to data object
//     headers.forEach((header, index) => {
//         data[header.toLowerCase().replace(/[^a-z0-9]/g, '')] = values[index] || '';
//     });

//     // Parse date
//     const dateStr = data.date || '';
//     let parsedDate;

//     try {
//         // Handle "April 1, 2025" format
//         parsedDate = new Date(dateStr);
//         if (isNaN(parsedDate.getTime())) {
//             console.warn('Invalid date format:', dateStr);
//             parsedDate = new Date();
//         }
//     } catch (error) {
//         console.warn('Date parsing error:', error);
//         parsedDate = new Date();
//     }

//     // Parse amount - remove peso sign, commas
//     const amountStr = (data.amount || '').replace(/[₱,]/g, '');
//     const amount = parseFloat(amountStr) || 0;

//     if (amount === 0) {
//         console.warn('Invalid amount:', data.amount);
//         return null;
//     }

//     // Map payment method
//     const paymentMethodMap = {
//         'cash': 'Cash',
//         'gcash': 'GCash',
//         'credit': 'Credit Card',
//         'debit': 'Debit Card',
//         'bank': 'Bank Transfer'
//     };

//     const paidVia = (data.paidvia || 'cash').toLowerCase();
//     const paymentMethod = paymentMethodMap[paidVia] || 'Cash';

//     // Parse items from comma-separated list
//     const itemsText = data.item || 'Imported Item';
//     const itemNames = itemsText.split(',').map(item => item.trim()).filter(item => item.length > 0);

//     // Create items array - distribute total amount evenly across items
//     const itemCount = itemNames.length;
//     const pricePerItem = itemCount > 0 ? amount / itemCount : amount;

//     const items = itemNames.map(itemName => ({
//         name: itemName,
//         quantity: 1,
//         price: pricePerItem,
//         total: pricePerItem
//     }));

//     // Fallback if no valid items found
//     if (items.length === 0) {
//         items.push({
//             name: 'Imported Item',
//             quantity: 1,
//             price: amount,
//             total: amount
//         });
//     }

//     // Create expense object
//     return {
//         id: generateId(),
//         date: parsedDate.toISOString().split('T')[0],
//         branch: data.category || 'Imported',
//         supplierName: data.supplier || 'Unknown Supplier',
//         businessName: '',
//         tin: data.tin || '',
//         address: data.address || '',
//         invoiceNumber: data.invoiceno || '',
//         items: items,
//         totalAmount: amount,
//         paymentMethod: paymentMethod,
//         paidBy: data.purchasee || '',
//         notes: 'Imported from CSV',
//         receiptImage: null,
//         createdAt: new Date().toISOString()
//     };
// }

function parseExpenseFromCSV(headers, values) {
    const data = {};

    // Map CSV columns to data object
    headers.forEach((header, index) => {
        data[header.toLowerCase().replace(/[^a-z0-9]/g, '')] = values[index] || '';
    });

    console.log('Mapped data:', data);

    // Detect format type - check for accounting-specific patterns
    const hasAccountingColumns = headers.some(h =>
        h.toLowerCase().includes('particulars') ||
        h.toLowerCase().includes('vatable') ||
        h.toLowerCase().includes('input') ||
        h.toLowerCase().includes('grosstaxable')
    );

    const hasStandardColumns = headers.some(h =>
        h.toLowerCase().includes('item') &&
        headers.some(h2 => h2.toLowerCase().includes('supplier'))
    );

    // Prioritize accounting format if it has VAT-related columns
    const isAccountingFormat = hasAccountingColumns && !hasStandardColumns;

    console.log('Is accounting format:', isAccountingFormat);
    console.log('Headers for detection:', headers);

    if (isAccountingFormat) {
        return parseAccountingFormatCSV(data, headers, values);
    } else {
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

    // Check if supplier already exists
    const existingSupplier = suppliers.find(s =>
        s.name.toLowerCase() === supplierName.toLowerCase() ||
        (s.tin && tin && s.tin === tin)
    );

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

function showImportProgress() {
    // Create progress modal if it doesn't exist
    let modal = document.getElementById('importProgressModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'importProgressModal';
        modal.className = 'import-progress-modal';
        modal.innerHTML = `
            <div class="import-progress-content">
                <h3>Importing CSV...</h3>
                <div class="import-progress-bar">
                    <div class="import-progress-fill" id="importProgressFill"></div>
                </div>
                <div id="importProgressText">Processing...</div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function updateImportProgress(current, total) {
    const percentage = Math.round((current / total) * 100);
    const fill = document.getElementById('importProgressFill');
    const text = document.getElementById('importProgressText');

    if (fill) fill.style.width = percentage + '%';
    if (text) text.textContent = `Processing ${current} of ${total} rows...`;
}

function hideImportProgress() {
    const modal = document.getElementById('importProgressModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

function clearAllDropdowns() {
    document.querySelectorAll('.autocomplete-dropdown').forEach(dropdown => {
        dropdown.classList.add('hidden');
    });
}

// Clear dropdowns when scrolling the modal
document.addEventListener('DOMContentLoaded', function () {
    const modal = document.querySelector('.expense-modal');
    if (modal) {
        modal.addEventListener('scroll', clearAllDropdowns);
    }
});

// Tab switching functionality
function switchTab(tab) {
    // Update active tab styles
    document.querySelectorAll('.nav-tab').forEach(tabBtn => {
        tabBtn.classList.remove('active');
    });

    // Show correct page
    if (tab === 'expenses') {
        document.getElementById('dashboardPage').style.display = 'block';
        document.getElementById('suppliersPage').style.display = 'none';
        document.querySelectorAll('.nav-tab')[0].classList.add('active');
        loadDashboard();
    } else if (tab === 'suppliers') {
        document.getElementById('dashboardPage').style.display = 'none';
        document.getElementById('suppliersPage').style.display = 'block';
        document.querySelectorAll('.nav-tab')[1].classList.add('active');
        loadSuppliers();
    }
}

// Load suppliers list
function loadSuppliers() {
    const supplierList = document.getElementById('supplierList');

    if (suppliers.length === 0) {
        supplierList.innerHTML = `
            <div class="empty-state">
                <p>No suppliers found</p>
                <p style="font-size: 14px;">Suppliers will appear here after adding expenses</p>
            </div>
        `;
        return;
    }

    // Calculate supplier statistics
    const supplierStats = suppliers.map(supplier => {
        const supplierExpenses = expenses.filter(expense =>
            expense.supplierName.toLowerCase() === supplier.name.toLowerCase()
        );

        const totalExpenses = supplierExpenses.reduce((sum, expense) => sum + expense.totalAmount, 0);
        const expenseCount = supplierExpenses.length;

        return {
            ...supplier,
            totalExpenses,
            expenseCount,
            lastExpense: supplierExpenses.length > 0 ?
                Math.max(...supplierExpenses.map(e => new Date(e.date).getTime())) : 0
        };
    });

    // Sort by total expenses (highest first)
    const sortedSuppliers = supplierStats.sort((a, b) => b.totalExpenses - a.totalExpenses);

    const supplierCards = sortedSuppliers.map(supplier => {
        const lastExpenseDate = supplier.lastExpense > 0 ?
            formatDate(new Date(supplier.lastExpense).toISOString().split('T')[0]) : 'Never';

        return `
        <div class="supplier-card" onclick="viewSupplier('${supplier.id}')">
            <div class="supplier-header">
                <div class="supplier-left">
                    <div class="supplier-name">${supplier.name}</div>
                    ${supplier.businessName ? `<div class="supplier-business">${supplier.businessName}</div>` : ''}
                    ${supplier.address ? `<div class="supplier-address">${supplier.address}</div>` : ''}
                    ${supplier.isVatRegistered ? `
                    <div class="vat-registered-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                        VAT Registered
                    </div>
                    ` : ''}
                </div>
                <div class="supplier-count">${supplier.expenseCount}</div>
            </div>
            <div class="supplier-footer">
                <div class="supplier-details">${supplier.tin ? 'TIN: ' + supplier.tin : 'No TIN'}</div>
                <div class="supplier-total">₱${supplier.totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
        </div>
        `;
    }).join('');

    supplierList.innerHTML = supplierCards;
}

function viewSupplier(supplierId) {
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        showToast('Supplier not found');
        return;
    }

    showSupplierDetailModal(supplier);
}

function showSupplierDetailModal(supplier) {
    const modal = document.getElementById('supplierDetailModalOverlay');
    const content = document.getElementById('supplierDetailContent');

    // Get all expenses for this supplier
    const supplierExpenses = expenses.filter(expense =>
        expense.supplierName.toLowerCase() === supplier.name.toLowerCase()
    ).sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date, newest first

    // Calculate statistics
    const totalAmount = supplierExpenses.reduce((sum, expense) => sum + expense.totalAmount, 0);
    const totalTransactions = supplierExpenses.length;
    const averageAmount = totalTransactions > 0 ? totalAmount / totalTransactions : 0;

    // Get date range
    const dates = supplierExpenses.map(e => new Date(e.date));
    const firstTransaction = dates.length > 0 ? Math.min(...dates) : null;
    const lastTransaction = dates.length > 0 ? Math.max(...dates) : null;

    // Update modal header to include action buttons
    const modalHeader = modal.querySelector('.modal-header');
    const existingActions = modalHeader.querySelector('.modal-header-actions');

    // Remove any existing action buttons
    const existingActionButtons = modalHeader.querySelector('.modal-action-buttons');
    if (existingActionButtons) {
        existingActionButtons.remove();
    }

    // Add merge, edit, and delete buttons before the close button
    const actionButtons = document.createElement('div');
    actionButtons.className = 'modal-action-buttons';
    actionButtons.innerHTML = `
        <button class="modal-action-btn merge" onclick="mergeSupplierFromDetail('${supplier.id}')" title="Merge suppliers">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                <path d="m9 9 6 6"></path>
                <path d="M15 9H9v6"></path>
            </svg>
        </button>
        <button class="modal-action-btn edit" onclick="editSupplierFromDetail('${supplier.id}')" title="Edit supplier">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path>
            </svg>
        </button>
        <button class="modal-action-btn delete" onclick="deleteSupplierFromDetail('${supplier.id}')" title="Delete supplier">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3,6 5,6 21,6"></polyline>
                <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
        </button>
    `;

    existingActions.insertBefore(actionButtons, existingActions.firstChild);

    // Build the content
    content.innerHTML = `
        <!-- Supplier Information -->
        <div class="supplier-detail-section">
            <h3>Supplier Information</h3>
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">Supplier Name</div>
                <div class="supplier-detail-value">${supplier.name}</div>
            </div>
            ${supplier.isVatRegistered ? `
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">VAT Status</div>
                <div class="supplier-detail-value">
                    <div class="vat-registered-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                        VAT Registered
                    </div>
                </div>
            </div>
            ` : ''}
            ${supplier.businessName ? `
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">Business Name</div>
                <div class="supplier-detail-value">${supplier.businessName}</div>
            </div>
            ` : ''}
            ${supplier.tin ? `
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">TIN</div>
                <div class="supplier-detail-value">${supplier.tin}</div>
            </div>
            ` : ''}
            ${supplier.address ? `
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">Address</div>
                <div class="supplier-detail-value">${supplier.address}</div>
            </div>
            ` : ''}
        </div>

        <!-- Simple Transaction Summary -->
        <div class="supplier-detail-section">
            <h3>Transaction Summary</h3>
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">Total Transactions</div>
                <div class="supplier-detail-value">${totalTransactions}</div>
            </div>
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">Total Amount</div>
                <div class="supplier-detail-value amount">₱${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            ${firstTransaction ? `
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">First Purchase</div>
                <div class="supplier-detail-value">${formatDate(new Date(firstTransaction).toISOString().split('T')[0])}</div>
            </div>
            <div class="supplier-detail-row">
                <div class="supplier-detail-label">Last Purchase</div>
                <div class="supplier-detail-value">${formatDate(new Date(lastTransaction).toISOString().split('T')[0])}</div>
            </div>
            ` : ''}
        </div>

        <!-- Recent Transactions -->
        <div class="supplier-detail-section">
            <h3>Recent Transactions (${Math.min(10, totalTransactions)} of ${totalTransactions})</h3>
            ${supplierExpenses.length > 0 ? `
                <div class="supplier-transactions">
                    ${supplierExpenses.slice(0, 10).map(expense => {
        const itemsText = expense.items.length > 3
            ? `${expense.items.slice(0, 3).map(item => item.name).join(', ')} + ${expense.items.length - 3} more`
            : expense.items.map(item => item.name).join(', ');

        const today = new Date().toISOString().split('T')[0];
        const isToday = expense.date === today;
        const formattedDate = isToday ? 'Today' : formatDate(expense.date);

        return `
                            <div class="supplier-transaction-item" onclick="viewExpenseFromSupplier('${expense.id}')">
                                <div class="supplier-transaction-header">
                                    <div class="supplier-transaction-date">${formattedDate}</div>
                                    <div class="supplier-transaction-amount">₱${expense.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                </div>
                                <div class="supplier-transaction-items">${itemsText}</div>
                                <div class="supplier-transaction-footer">
                                    <span>${expense.branch} • ${expense.paymentMethod}</span>
                                    ${expense.invoiceNumber ? `<span>#${expense.invoiceNumber}</span>` : '<span></span>'}
                                </div>
                            </div>
                        `;
    }).join('')}
                </div>
            ` : `
                <div class="supplier-no-transactions">No transactions found</div>
            `}
        </div>
    `;

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
}

function closeSupplierDetailModal() {
    const modal = document.getElementById('supplierDetailModalOverlay');
    modal.classList.remove('show');
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
}

function viewExpenseFromSupplier(expenseId) {
    // Close supplier modal first
    closeSupplierDetailModal();

    // Wait a bit for the close animation, then show expense modal
    setTimeout(() => {
        viewExpense(expenseId);
    }, 300);
}

// Summary filter functionality
function showSummaryOptions() {
    // Check if options already exist
    let optionsDiv = document.getElementById('summaryOptions');
    if (optionsDiv) {
        // Toggle visibility
        if (optionsDiv.classList.contains('show')) {
            hideSummaryOptions();
            return;
        }
    } else {
        // Create the options div
        optionsDiv = document.createElement('div');
        optionsDiv.id = 'summaryOptions';
        optionsDiv.className = 'summary-options';

        // Insert after the summary card
        const summaryCard = document.querySelector('.summary-card');
        summaryCard.appendChild(optionsDiv);
    }

    // Calculate different time period summaries
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const thisWeek = getThisWeekRange();

    const todayExpenses = expenses.filter(expense => expense.date === today);
    const thisWeekExpenses = expenses.filter(expense =>
        expense.date >= thisWeek.start && expense.date <= thisWeek.end
    );
    const thisMonthExpenses = expenses.filter(expense =>
        expense.date.startsWith(thisMonth)
    );

    const todayTotal = todayExpenses.reduce((sum, expense) => sum + expense.totalAmount, 0);
    const thisWeekTotal = thisWeekExpenses.reduce((sum, expense) => sum + expense.totalAmount, 0);
    const thisMonthTotal = thisMonthExpenses.reduce((sum, expense) => sum + expense.totalAmount, 0);

    // Build options array, excluding the currently selected one
    const options = [];

    if (currentFilter !== 'all') {
        const allTotal = expenses.reduce((sum, expense) => sum + expense.totalAmount, 0);
        options.push(`
        <div class="summary-option" onclick="selectSummaryFilter('all', event)">
            <div class="summary-option-title">All Expenses</div>
            <div class="summary-option-amount">₱${allTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div class="summary-option-count">${expenses.length} ${expenses.length === 1 ? 'transaction' : 'transactions'}</div>
        </div>
    `);
    }

    if (currentFilter !== 'today') {
        options.push(`
            <div class="summary-option" onclick="selectSummaryFilter('today', event)">
                <div class="summary-option-title">Today's Expenses</div>
                <div class="summary-option-amount">₱${todayTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="summary-option-count">${todayExpenses.length} ${todayExpenses.length === 1 ? 'transaction' : 'transactions'}</div>
            </div>
        `);
    }

    if (currentFilter !== 'week') {
        options.push(`
            <div class="summary-option" onclick="selectSummaryFilter('week', event)">
                <div class="summary-option-title">This Week's Expenses</div>
                <div class="summary-option-amount">₱${thisWeekTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="summary-option-count">${thisWeekExpenses.length} ${thisWeekExpenses.length === 1 ? 'transaction' : 'transactions'}</div>
            </div>
        `);
    }

    if (currentFilter !== 'month') {
        options.push(`
            <div class="summary-option" onclick="selectSummaryFilter('month', event)">
                <div class="summary-option-title">This Month's Expenses</div>
                <div class="summary-option-amount">₱${thisMonthTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="summary-option-count">${thisMonthExpenses.length} ${thisMonthExpenses.length === 1 ? 'transaction' : 'transactions'}</div>
            </div>
        `);
    }

    optionsDiv.innerHTML = options.join('');

    // Show the options with animation and blur the expense cards
    setTimeout(() => {
        optionsDiv.classList.add('show');
        document.getElementById('expenseList').classList.add('options-expanded');
    }, 10);
}

function hideSummaryOptions() {
    const optionsDiv = document.getElementById('summaryOptions');
    const expenseList = document.getElementById('expenseList');

    if (optionsDiv) {
        optionsDiv.classList.remove('show');
    }

    if (expenseList) {
        expenseList.classList.remove('options-expanded');
    }

    setTimeout(() => {
        if (optionsDiv && optionsDiv.parentNode) {
            optionsDiv.remove();
        }
    }, 300);
}

function selectSummaryFilter(filter, event) {
    // Stop the click from bubbling up to the summary card
    if (event) {
        event.stopPropagation();
    }

    currentFilter = filter;

    // Immediately remove blur and hide options
    const expenseList = document.getElementById('expenseList');
    const optionsDiv = document.getElementById('summaryOptions');

    if (expenseList) {
        expenseList.classList.remove('options-expanded');
    }

    if (optionsDiv) {
        optionsDiv.remove();
    }

    // Immediately reload dashboard
    loadDashboard();
}
function getThisWeekRange() {
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

// Close summary options when clicking outside
document.addEventListener('click', function (e) {
    const summaryCard = e.target.closest('.summary-card');
    const summaryOptions = document.getElementById('summaryOptions');

    if (!summaryCard && summaryOptions && summaryOptions.classList.contains('show')) {
        hideSummaryOptions();
    }
});

// Global variable to track what we're confirming
let confirmationCallback = null;

function editExpense(expenseId, event) {
    event.stopPropagation();

    const expense = expenses.find(e => e.id === expenseId);
    if (!expense) {
        showToast('Expense not found');
        return;
    }

    // Show the add expense modal
    showAddExpenseModal();

    // Wait for modal to be visible, then populate fields
    setTimeout(() => {
        populateExpenseForm(expense);
    }, 100);
}

function populateExpenseForm(expense) {
    // Set basic fields
    document.getElementById('expenseDate').value = expense.date;
    document.getElementById('branch').value = expense.branch;
    document.getElementById('supplierName').value = expense.supplierName;
    document.getElementById('paymentMethod').value = expense.paymentMethod;
    document.getElementById('paidBy').value = expense.paidBy || '';
    document.getElementById('notes').value = expense.notes || '';
    document.getElementById('invoiceNumber').value = expense.invoiceNumber || '';
    document.getElementById('totalAmountInput').value = expense.totalAmount.toFixed(2);

    // Handle VAT information if supplier is VAT registered
    const supplier = suppliers.find(s => s.name.toLowerCase() === expense.supplierName.toLowerCase());
    if (supplier && supplier.isVatRegistered) {
        const vatSection = document.getElementById('vatSection');
        const vatExemptInput = document.getElementById('vatExemptAmount');
        if (vatSection && vatExemptInput) {
            vatSection.style.display = 'block';
            vatExemptInput.value = (expense.vatExemptAmount || 0).toFixed(2);
            updateVatCalculation();
        }
    }

    // Clear existing items
    document.getElementById('itemsContainer').innerHTML = '';
    itemCounter = 0;

    // Add items
    expense.items.forEach((item, index) => {
        addItemRow();
        const itemRows = document.querySelectorAll('.item-row');
        const currentRow = itemRows[itemRows.length - 1];

        currentRow.querySelector('[name="itemName"]').value = item.name;
        currentRow.querySelector('[name="itemQuantity"]').value = item.quantity;
        currentRow.querySelector('[name="itemPrice"]').value = item.price > 0 ? '₱' + item.price.toFixed(2) : '';

        // Show breakdown if price is set
        if (item.price > 0) {
            const breakdown = currentRow.querySelector('.item-breakdown');
            const priceBtn = currentRow.querySelector('.add-price-btn');
            breakdown.style.display = 'flex';
            if (priceBtn) priceBtn.style.display = 'none';
        }
    });

    // Handle receipt if exists
    if (expense.receiptImage) {
        const preview = document.getElementById('receiptPreview');
        const uploadText = document.getElementById('receiptUploadText');
        const uploadArea = document.querySelector('.receipt-upload');
        const removeBtn = document.getElementById('removeReceiptBtn');

        preview.src = expense.receiptImage;
        preview.style.display = 'block';
        uploadText.textContent = 'Receipt attached';
        uploadArea.classList.add('has-file');
        removeBtn.style.display = 'block';
        window.currentReceiptData = expense.receiptImage;
    }

    // Store the expense ID for updating instead of creating new
    window.editingExpenseId = expense.id;

    // Update modal title
    document.querySelector('.modal-title').textContent = 'Edit Expense';
}

function deleteExpense(expenseId, event) {
    event.stopPropagation();

    const expense = expenses.find(e => e.id === expenseId);
    if (!expense) {
        showToast('Expense not found');
        return;
    }

    // Show confirmation modal
    showConfirmationModal(
        'Delete Expense',
        `Are you sure you want to delete the expense for "${expense.supplierName}"? This action cannot be undone.`,
        'Delete',
        () => {
            // Remove expense from array
            const index = expenses.findIndex(e => e.id === expenseId);
            if (index > -1) {
                expenses.splice(index, 1);
                saveToLocalStorage(); 
                
                loadDashboard();
                showToast('Expense deleted successfully');
            }
        }
    );
}

function showConfirmationModal(title, message, actionText, callback) {
    const modal = document.getElementById('confirmationModalOverlay');
    const titleEl = document.getElementById('confirmationTitle');
    const messageEl = document.getElementById('confirmationMessage');
    const actionBtn = document.getElementById('confirmationActionBtn');

    titleEl.textContent = title;
    messageEl.textContent = message;
    actionBtn.textContent = actionText;

    confirmationCallback = callback;

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeConfirmationModal() {
    const modal = document.getElementById('confirmationModalOverlay');
    modal.classList.remove('show');
    document.body.style.overflow = '';
    confirmationCallback = null;
}

function confirmAction() {
    if (confirmationCallback) {
        confirmationCallback();
    }
    closeConfirmationModal();
}

function editExpenseFromDetail(expenseId) {
    // Close the detail modal first
    closeExpenseDetailModal();

    // Wait for close animation, then edit
    setTimeout(() => {
        editExpense(expenseId, { stopPropagation: () => { } });
    }, 300);
}

function deleteExpenseFromDetail(expenseId) {
    // Close the detail modal first
    closeExpenseDetailModal();

    // Wait for close animation, then show delete confirmation
    setTimeout(() => {
        deleteExpense(expenseId, { stopPropagation: () => { } });
    }, 300);
}

function showAddSupplierModal(supplierName = '') {
    const modal = document.getElementById('supplierModalOverlay');
    const form = document.getElementById('supplierForm');
    const title = modal.querySelector('.modal-title');

    // Reset form
    form.reset();
    delete window.editingSupplierId;

    // Reset toggle visual state
    const toggleTrack = document.querySelector('.toggle-track');
    if (toggleTrack) {
        toggleTrack.classList.remove('active');
    }

    if (supplierName) {
        // Adding new supplier from expense
        title.textContent = 'Add Supplier Details';
        document.getElementById('supplierModalName').value = supplierName;
        document.getElementById('supplierModalName').readOnly = true;
        document.getElementById('skipSupplierBtn').style.display = 'inline-block';
    } else {
        // Creating new supplier from scratch
        title.textContent = 'Add Supplier';
        document.getElementById('supplierModalName').readOnly = false;
        document.getElementById('skipSupplierBtn').style.display = 'none';
    }

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
}

function showEditSupplierModal(supplierId) {
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        showToast('Supplier not found');
        return;
    }

    const modal = document.getElementById('supplierModalOverlay');
    const form = document.getElementById('supplierForm');
    const title = modal.querySelector('.modal-title');

    // Populate form with supplier data
    title.textContent = 'Edit Supplier';
    document.getElementById('supplierModalName').value = supplier.name;
    document.getElementById('supplierModalName').readOnly = false;
    document.getElementById('supplierModalBusinessName').value = supplier.businessName || '';
    document.getElementById('supplierModalTin').value = supplier.tin || '';
    document.getElementById('supplierModalAddress').value = supplier.address || '';
    document.getElementById('supplierModalIsVatRegistered').checked = supplier.isVatRegistered || false;
    document.getElementById('skipSupplierBtn').style.display = 'none';

    // Update toggle visual state
    const toggleTrack = document.querySelector('.toggle-track');
    if (toggleTrack) {
        if (supplier.isVatRegistered) {
            toggleTrack.classList.add('active');
        } else {
            toggleTrack.classList.remove('active');
        }
    }

    // Store supplier ID for updating
    window.editingSupplierId = supplierId;

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
}

function closeSupplierModal() {
    const modal = document.getElementById('supplierModalOverlay');
    modal.classList.remove('show');
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    delete window.editingSupplierId;
}

function handleSupplierFormSubmission(e) {
    e.preventDefault();

    const isEditing = window.editingSupplierId;
    const supplierName = document.getElementById('supplierModalName').value.trim();
    const businessName = document.getElementById('supplierModalBusinessName').value.trim();
    const tin = document.getElementById('supplierModalTin').value.trim();
    const address = document.getElementById('supplierModalAddress').value.trim();
    const isVatRegistered = document.getElementById('supplierModalIsVatRegistered').checked;

    if (!supplierName) {
        showToast('Please enter a supplier name');
        return;
    }

    // Check for duplicates (exclude current supplier when editing)
    const existingSupplier = suppliers.find(s =>
        s.name.toLowerCase() === supplierName.toLowerCase() &&
        s.id !== isEditing
    );

    if (existingSupplier) {
        showToast('A supplier with this name already exists');
        return;
    }

    const supplier = {
        id: isEditing || generateId(),
        name: supplierName,
        businessName: businessName,
        tin: tin,
        address: address,
        isVatRegistered: isVatRegistered,
        createdAt: isEditing ?
            (suppliers.find(s => s.id === isEditing)?.createdAt || new Date().toISOString()) :
            new Date().toISOString()
    };

    

    // Update all expenses from this supplier when editing
    if (isEditing) {
        // Get the old supplier data BEFORE updating it
        const oldSupplier = suppliers.find(s => s.id === isEditing);
        const oldSupplierName = oldSupplier ? oldSupplier.name : '';

        // Then update all expenses that reference the old supplier name
        expenses.forEach(expense => {
            // Match by old supplier name first, then update to new name
            if (expense.supplierName.toLowerCase() === oldSupplierName.toLowerCase()) {
                // Update supplier name in expense
                expense.supplierName = supplier.name;
                expense.businessName = supplier.businessName;
                expense.tin = supplier.tin;
                expense.address = supplier.address;
                expense.isVatRegistered = supplier.isVatRegistered;

                // Recalculate VAT if supplier is no longer VAT registered
                if (!supplier.isVatRegistered) {
                    expense.vatExemptAmount = 0;
                    expense.vatableSale = 0;
                    expense.vatAmount = 0;
                } else if (supplier.isVatRegistered && expense.vatableSale === 0) {
                    // Recalculate VAT for newly VAT registered supplier
                    const taxableAmount = expense.totalAmount - (expense.vatExemptAmount || 0);
                    expense.vatableSale = taxableAmount / 1.12;
                    expense.vatAmount = taxableAmount - expense.vatableSale;
                }
            }
        });

        // Update the supplier AFTER updating expenses
        const index = suppliers.findIndex(s => s.id === isEditing);
        if (index > -1) {
            supplier.updatedAt = new Date().toISOString();
            suppliers[index] = supplier;
            saveToLocalStorage();
            showToast('Supplier updated successfully!');
        }
    } else {
        // Add new supplier
        suppliers.push(supplier);
        saveToLocalStorage();
        showToast('Supplier added successfully!');
    }

    setTimeout(() => {
        closeSupplierModal();
        // Refresh suppliers page if currently viewing it
        if (document.getElementById('suppliersPage').style.display !== 'none') {
            loadSuppliers();
        }
        // Close supplier detail modal if open
        const supplierDetailModal = document.getElementById('supplierDetailModalOverlay');
        if (supplierDetailModal.classList.contains('show')) {
            closeSupplierDetailModal();
        }
    }, 300);
}

function skipSupplierDetails() {
    const supplierName = document.getElementById('supplierModalName').value.trim();

    if (supplierName) {
        // Save basic supplier with just the name
        const basicSupplier = {
            id: generateId(),
            name: supplierName,
            businessName: '',
            tin: '',
            address: '',
            createdAt: new Date().toISOString()
        };

        suppliers.push(basicSupplier);
        saveToLocalStorage();
    }

    closeSupplierModal();
    showToast('Supplier saved with name only');
}

function editSupplierFromDetail(supplierId) {
    // Close the detail modal first
    closeSupplierDetailModal();

    // Wait for close animation, then edit
    setTimeout(() => {
        showEditSupplierModal(supplierId);
    }, 300);
}

// Debug function to clear storage - remove in production
function clearStorage() {
    localStorage.removeItem('expenseTracker_expenses');
    localStorage.removeItem('expenseTracker_suppliers');
    expenses = [];
    suppliers = [];
    showToast('Storage cleared! Page will reload.');
    setTimeout(() => location.reload(), 1000);
}

function showMergeSupplierModal(targetSupplierId) {
    const targetSupplier = suppliers.find(s => s.id === targetSupplierId);
    if (!targetSupplier) {
        showToast('Supplier not found');
        return;
    }

    const modal = document.getElementById('mergeSupplierModalOverlay');
    const content = document.getElementById('mergeSupplierContent');
    const title = modal.querySelector('.modal-title');

    title.textContent = `Merge Suppliers into ${targetSupplier.name}`;

    // Get other suppliers (excluding the target)
    const otherSuppliers = suppliers.filter(s => s.id !== targetSupplierId);

    if (otherSuppliers.length === 0) {
        showToast('No other suppliers available to merge');
        return;
    }

    // Build the supplier selection list
    content.innerHTML = `
    <div class="merge-info">
        <p>Select suppliers to merge into <strong>${targetSupplier.name}</strong>. All expenses from selected suppliers will be transferred to this supplier.</p>
    </div>
    
    <div class="merge-search-container">
        <div class="form-group">
            <input type="text" id="mergeSupplierSearch" placeholder="Search suppliers..." style="margin-bottom: 0;">
        </div>
    </div>
    
    <div class="merge-supplier-list" id="mergeSupplierList">
        ${otherSuppliers.map(supplier => {
        const supplierExpenseCount = expenses.filter(e =>
            e.supplierName.toLowerCase() === supplier.name.toLowerCase()
        ).length;

        return `
                <div class="merge-supplier-item" data-supplier-name="${supplier.name.toLowerCase()}" data-supplier-business="${(supplier.businessName || '').toLowerCase()}">
                    <label class="merge-checkbox-container">
                        <input type="checkbox" value="${supplier.id}" class="merge-supplier-checkbox">
                        <span class="merge-checkmark"></span>
                        <div class="merge-supplier-info">
                            <div class="merge-supplier-name">${supplier.name}</div>
                            ${supplier.businessName ? `<div class="merge-supplier-business">${supplier.businessName}</div>` : ''}
                            <div class="merge-supplier-count">${supplierExpenseCount} expense${supplierExpenseCount === 1 ? '' : 's'}</div>
                        </div>
                    </label>
                </div>
            `;
    }).join('')}
    </div>
    
    <div class="merge-actions">
        <button type="button" class="cancel-btn" onclick="closeMergeSupplierModal()">Cancel</button>
        <button type="button" class="merge-btn" onclick="executeMerge('${targetSupplierId}')">Merge Selected</button>
    </div>
`;

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';

    // Add search functionality after modal is shown
    setTimeout(() => {
        const searchInput = document.getElementById('mergeSupplierSearch');
        const supplierItems = document.querySelectorAll('.merge-supplier-item');

        if (searchInput) {
            searchInput.addEventListener('input', function () {
                const query = this.value.toLowerCase().trim();

                supplierItems.forEach(item => {
                    const supplierName = item.getAttribute('data-supplier-name');
                    const supplierBusiness = item.getAttribute('data-supplier-business');

                    const matches = supplierName.includes(query) ||
                        supplierBusiness.includes(query);

                    if (matches || query === '') {
                        item.style.display = 'block';
                    } else {
                        item.style.display = 'none';
                    }
                });

                // Show "no results" message if needed
                const visibleItems = Array.from(supplierItems).filter(item =>
                    item.style.display !== 'none'
                );

                let noResultsMsg = document.getElementById('noMergeResults');
                if (visibleItems.length === 0 && query !== '') {
                    if (!noResultsMsg) {
                        noResultsMsg = document.createElement('div');
                        noResultsMsg.id = 'noMergeResults';
                        noResultsMsg.className = 'no-results-message';
                        noResultsMsg.textContent = 'No suppliers found matching your search.';
                        document.getElementById('mergeSupplierList').appendChild(noResultsMsg);
                    }
                } else if (noResultsMsg) {
                    noResultsMsg.remove();
                }
            });
        }
    }, 100);
}

function closeMergeSupplierModal() {
    const modal = document.getElementById('mergeSupplierModalOverlay');
    modal.classList.remove('show');
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
}

function executeMerge(targetSupplierId) {
    const targetSupplier = suppliers.find(s => s.id === targetSupplierId);
    if (!targetSupplier) {
        showToast('Target supplier not found');
        return;
    }

    // Get selected suppliers to merge
    const selectedCheckboxes = document.querySelectorAll('.merge-supplier-checkbox:checked');
    const supplierIdsToMerge = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (supplierIdsToMerge.length === 0) {
        showToast('Please select at least one supplier to merge');
        return;
    }

    const suppliersToMerge = suppliers.filter(s => supplierIdsToMerge.includes(s.id));
    const supplierNamesToMerge = suppliersToMerge.map(s => s.name);

    // Show confirmation
    showConfirmationModal(
        'Confirm Merge',
        `Are you sure you want to merge ${supplierNamesToMerge.join(', ')} into ${targetSupplier.name}? This will transfer all expenses and cannot be undone.`,
        'Merge',
        () => {
            performSupplierMerge(targetSupplier, suppliersToMerge);
        }
    );
}

function performSupplierMerge(targetSupplier, suppliersToMerge) {
    let totalTransferred = 0;

    // Update all expenses from merged suppliers to reference the target supplier
    suppliersToMerge.forEach(supplierToMerge => {
        expenses.forEach(expense => {
            if (expense.supplierName.toLowerCase() === supplierToMerge.name.toLowerCase()) {
                expense.supplierName = targetSupplier.name;
                // Also update other supplier fields in the expense
                expense.businessName = targetSupplier.businessName || expense.businessName;
                expense.tin = targetSupplier.tin || expense.tin;
                expense.address = targetSupplier.address || expense.address;
                expense.isVatRegistered = targetSupplier.isVatRegistered;
                totalTransferred++;
            }
        });
    });

    // Remove the merged suppliers from the suppliers array
    const supplierIdsToRemove = suppliersToMerge.map(s => s.id);
    suppliers = suppliers.filter(s => !supplierIdsToRemove.includes(s.id));

    // Save to localStorage
    saveToLocalStorage();

    // Close modals and refresh
    closeMergeSupplierModal();
    closeSupplierDetailModal();

    showToast(`Merged ${suppliersToMerge.length} supplier${suppliersToMerge.length === 1 ? '' : 's'} and transferred ${totalTransferred} expense${totalTransferred === 1 ? '' : 's'}`);

    // Refresh suppliers page if currently viewing it
    if (document.getElementById('suppliersPage').style.display !== 'none') {
        loadSuppliers();
    }
}

function mergeSupplierFromDetail(supplierId) {
    // Close the detail modal first
    closeSupplierDetailModal();

    // Wait for close animation, then show merge modal
    setTimeout(() => {
        showMergeSupplierModal(supplierId);
    }, 300);
}

function deleteSupplierFromDetail(supplierId) {
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        showToast('Supplier not found');
        return;
    }

    // Check if supplier has any expenses
    const supplierExpenses = expenses.filter(expense =>
        expense.supplierName.toLowerCase() === supplier.name.toLowerCase()
    );

    if (supplierExpenses.length > 0) {
        showConfirmationModal(
            'Cannot Delete Supplier',
            `Cannot delete "${supplier.name}" because it has ${supplierExpenses.length} expense${supplierExpenses.length === 1 ? '' : 's'}. Please delete all expenses first or merge this supplier with another.`,
            'OK',
            () => {
                // Just close the confirmation modal
            }
        );
        return;
    }

    // Show confirmation for deletion
    showConfirmationModal(
        'Delete Supplier',
        `Are you sure you want to delete "${supplier.name}"? This action cannot be undone.`,
        'Delete',
        () => {
            // Remove supplier from array
            const index = suppliers.findIndex(s => s.id === supplierId);
            if (index > -1) {
                suppliers.splice(index, 1);
                saveToLocalStorage();

                // Close detail modal and refresh
                closeSupplierDetailModal();
                showToast('Supplier deleted successfully');

                // Refresh suppliers page if currently viewing it
                if (document.getElementById('suppliersPage').style.display !== 'none') {
                    loadSuppliers();
                }
            }
        }
    );
}

function saveToLocalStorage() {
    try {
        localStorage.setItem('expenseTracker_expenses', JSON.stringify(expenses));
        localStorage.setItem('expenseTracker_suppliers', JSON.stringify(suppliers));
        console.log('Data saved to localStorage');

        // Mark that we have pending changes
        hasPendingChanges = true;

        // Clear existing timeout if there is one
        if (syncTimeout) {
            clearTimeout(syncTimeout);
        }

        // Set new timeout for debounced sync
        syncTimeout = setTimeout(() => {
            if (hasPendingChanges) {
                syncToFirebase();
                hasPendingChanges = false;
            }
            syncTimeout = null;
        }, SYNC_DEBOUNCE_DELAY);

        console.log('Sync scheduled for 3 seconds from now');
    } catch (error) {
        console.error('Failed to save to localStorage:', error);
    }
}

function viewSupplierFromExpense(supplierName) {
    const supplier = suppliers.find(s =>
        s.name.toLowerCase() === supplierName.toLowerCase()
    );

    if (!supplier) {
        showToast('Supplier not found');
        return;
    }

    // Close expense detail modal first
    closeExpenseDetailModal();

    // Wait for close animation, then show supplier modal
    setTimeout(() => {
        showSupplierDetailModal(supplier);
    }, 300);
}


function updateVatCalculation() {
    const totalAmount = parseFloat(document.getElementById('totalAmountInput').value) || 0;
    const vatExemptInput = document.getElementById('vatExemptAmount');
    const vatExemptAmount = parseFloat(vatExemptInput.value) || 0;
    const vatSection = document.getElementById('vatSection');

    const vatComputationEnabled = document.getElementById('vatComputationEnabled')?.checked || false;
    if (!vatSection || vatSection.style.display === 'none' || totalAmount === 0 || !vatComputationEnabled) {
        document.getElementById('vatBreakdown').style.display = 'none';
        return;
    }

    // Validate exempt amount doesn't exceed total (but don't reset the field)
    if (vatExemptAmount > totalAmount) {
        // Just return without updating, let user see their input
        return;
    }

    // Calculate VAT breakdown
    const taxableAmount = totalAmount - vatExemptAmount;
    const vatableSale = taxableAmount / 1.12; // Remove 12% VAT from taxable amount
    const vatAmount = taxableAmount - vatableSale;

    // Update display
    document.getElementById('totalAmountVat').textContent =
        '₱' + totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('vatExemptAmountDisplay').textContent =
        '₱' + vatExemptAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('taxableAmountDisplay').textContent =
        '₱' + taxableAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('vatableSaleAmount').textContent =
        '₱' + vatableSale.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('vatAmountDisplay').textContent =
        '₱' + vatAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    document.getElementById('vatBreakdown').style.display = 'block';
}

// Update the total amount change handler
function handleTotalChange() {
    const totalInput = document.getElementById('totalAmountInput');
    const itemRows = document.querySelectorAll('.item-row');

    // Get numeric value, removing peso sign and commas
    const numericValue = parseFloat(totalInput.value.replace(/[₱,]/g, '')) || 0;

    // If user manually enters a total, hide the price breakdown and show price buttons
    if (numericValue > 0) {
        itemRows.forEach(row => {
            const breakdown = row.querySelector('.item-breakdown');
            const priceBtn = row.querySelector('.add-price-btn');
            breakdown.style.display = 'none';
            if (priceBtn) priceBtn.style.display = 'block';
        });
    }

    // Update VAT calculation
    updateVatCalculation();
}

function toggleVatRegistered() {
    const checkbox = document.getElementById('supplierModalIsVatRegistered');
    const toggleSwitch = checkbox.closest('.toggle-container').querySelector('.toggle-track');

    checkbox.checked = !checkbox.checked;

    if (checkbox.checked) {
        toggleSwitch.classList.add('active');
    } else {
        toggleSwitch.classList.remove('active');
    }
}
function toggleVatComputation() {
    const checkbox = document.getElementById('vatComputationEnabled');
    const track = document.getElementById('vatToggleTrack');
    const vatDetailsSection = document.getElementById('vatDetailsSection');

    checkbox.checked = !checkbox.checked;

    if (checkbox.checked) {
        track.classList.add('active');
        vatDetailsSection.style.display = 'block';
        updateVatCalculation();
    } else {
        track.classList.remove('active');
        vatDetailsSection.style.display = 'none';
        // Clear VAT breakdown when disabled
        document.getElementById('vatBreakdown').style.display = 'none';
    }
}

// Manual Firebase initialization for testing
window.initFirebaseManually = async function () {
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
};

// Make functions globally available for onclick handlers
window.switchTab = switchTab;
window.showAddExpenseModal = showAddExpenseModal;
window.closeExpenseModal = closeExpenseModal;
window.addItemRow = addItemRow;
window.removeItemRow = removeItemRow;
window.showItemBreakdown = showItemBreakdown;
window.handleReceiptUpload = handleReceiptUpload;
window.removeReceipt = removeReceipt;
window.handleCSVImport = handleCSVImport;
window.selectAutocompleteItem = selectAutocompleteItem;
window.clearSelectedSupplier = clearSelectedSupplier;
window.viewExpense = viewExpense;
window.closeExpenseDetailModal = closeExpenseDetailModal;
window.viewReceiptFullscreen = viewReceiptFullscreen;
window.editExpense = editExpense;
window.deleteExpense = deleteExpense;
window.editExpenseFromDetail = editExpenseFromDetail;
window.deleteExpenseFromDetail = deleteExpenseFromDetail;
window.confirmAction = confirmAction;
window.closeConfirmationModal = closeConfirmationModal;
window.viewSupplier = viewSupplier;
window.closeSupplierDetailModal = closeSupplierDetailModal;
window.viewExpenseFromSupplier = viewExpenseFromSupplier;
window.showSummaryOptions = showSummaryOptions;
window.selectSummaryFilter = selectSummaryFilter;
window.showAddSupplierModal = showAddSupplierModal;
window.closeSupplierModal = closeSupplierModal;
window.handleSupplierFormSubmission = handleSupplierFormSubmission;
window.skipSupplierDetails = skipSupplierDetails;
window.editSupplierFromDetail = editSupplierFromDetail;
window.deleteSupplierFromDetail = deleteSupplierFromDetail;
window.showMergeSupplierModal = showMergeSupplierModal;
window.closeMergeSupplierModal = closeMergeSupplierModal;
window.executeMerge = executeMerge;
window.mergeSupplierFromDetail = mergeSupplierFromDetail;
window.viewSupplierFromExpense = viewSupplierFromExpense;
window.updateVatCalculation = updateVatCalculation;
window.handleTotalChange = handleTotalChange;
window.toggleVatRegistered = toggleVatRegistered;
window.toggleVatComputation = toggleVatComputation;
window.formatPesoInput = formatPesoInput;
window.updateFromItems = updateFromItems;
window.formatTotal = formatTotal;