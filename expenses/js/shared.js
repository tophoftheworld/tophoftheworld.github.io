// shared.js - Common utilities for both mobile and admin apps

// Global state - will be initialized by each app
export let expenses = [];
export let suppliers = [];

// Firebase dependencies - will be imported at module level
let db;
let collection, doc, getDocs, setDoc, deleteDoc, query, where, orderBy, serverTimestamp, writeBatch;

// Firebase Sync State
let syncInProgress = false;
let pendingOperations = [];
let syncTimeout = null;
let hasPendingChanges = false;
const SYNC_DEBOUNCE_DELAY = 3000; // 3 seconds

// Initialize Firebase and load dependencies
export async function initializeFirebase() {
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

// Data Management Functions
export function setExpenses(newExpenses) {
    expenses.length = 0;
    expenses.push(...newExpenses);
}

export function setSuppliers(newSuppliers) {
    suppliers.length = 0;
    suppliers.push(...newSuppliers);
}

export function getExpenses() {
    return [...expenses];
}

export function getSuppliers() {
    return [...suppliers];
}

export function addExpense(expense) {
    expenses.push(expense);
    saveToLocalStorage();
}

export function updateExpense(expenseId, updatedExpense) {
    const index = expenses.findIndex(e => e.id === expenseId);
    if (index > -1) {
        updatedExpense.updatedAt = new Date().toISOString();
        expenses[index] = updatedExpense;
        saveToLocalStorage();
        return true;
    }
    return false;
}

export function deleteExpense(expenseId) {
    const index = expenses.findIndex(e => e.id === expenseId);
    if (index > -1) {
        expenses.splice(index, 1);
        saveToLocalStorage();
        return true;
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

export function deleteSupplier(supplierId) {
    const index = suppliers.findIndex(s => s.id === supplierId);
    if (index > -1) {
        suppliers.splice(index, 1);
        saveToLocalStorage();
        return true;
    }
    return false;
}

// Storage Functions
export function loadFromLocalStorage() {
    try {
        const savedExpenses = localStorage.getItem('expenseTracker_expenses');
        const savedSuppliers = localStorage.getItem('expenseTracker_suppliers');

        if (savedExpenses) {
            const parsedExpenses = JSON.parse(savedExpenses);
            setExpenses(parsedExpenses);
            console.log('Loaded expenses from localStorage:', expenses.length, 'items');
        }

        if (savedSuppliers) {
            const parsedSuppliers = JSON.parse(savedSuppliers);
            setSuppliers(parsedSuppliers);
            console.log('Loaded suppliers from localStorage:', suppliers.length, 'items');
        }

        return expenses.length > 0 || suppliers.length > 0;
    } catch (error) {
        console.error('Failed to load from localStorage:', error);
        return false;
    }
}

export function saveToLocalStorage() {
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
            if (hasPendingChanges && db) {
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

// Firebase Sync Functions
export async function syncToFirebase() {
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

        // Clear pending changes flag on successful sync
        hasPendingChanges = false;
    } catch (error) {
        console.error('Firebase sync failed:', error);
        showSyncStatus('⚠ Sync failed - will retry', 'error');

        // Queue for retry
        setTimeout(() => {
            if (!syncInProgress) {
                syncToFirebase();
            }
        }, 5000);
    } finally {
        syncInProgress = false;
    }
}

export async function fetchFromFirebase() {
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
            setExpenses(mergeResult.expenses);
            setSuppliers(mergeResult.suppliers);
            saveToLocalStorage();

            console.log('Data updated from Firebase');
            showSyncStatus('↓ Updated', 'success');
            return true; // Indicate changes were made
        } else {
            console.log('Local data is up to date');
            return false; // No changes
        }

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

export function formatPesoInput(input) {
    let value = input.value.replace(/[₱,]/g, '');
    if (value && !isNaN(value)) {
        input.value = '₱' + parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
}

export function getPesoValue(input) {
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

// Supplier Helper Functions
export function saveSupplierIfNew(expense) {
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
        saveToLocalStorage();
    }
}

// Autocomplete Helper Functions
export function getItemMatches(query, currentSupplier = '') {
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

// Validation Functions
export function validateExpense(expense) {
    const errors = [];

    if (!expense.supplierName || expense.supplierName.trim() === '') {
        errors.push('Supplier name is required');
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

export function validateSupplier(supplier) {
    const errors = [];

    if (!supplier.name || supplier.name.trim() === '') {
        errors.push('Supplier name is required');
    }

    // Check for duplicate names (excluding current supplier if editing)
    const existingSupplier = suppliers.find(s =>
        s.name.toLowerCase() === supplier.name.toLowerCase() &&
        s.id !== supplier.id
    );

    if (existingSupplier) {
        errors.push('A supplier with this name already exists');
    }

    return errors;
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

// Force sync before page unload
export function setupBeforeUnloadSync() {
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

        // Set up periodic sync every 5 minutes
        setInterval(fetchFromFirebase, 5 * 60 * 1000);

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