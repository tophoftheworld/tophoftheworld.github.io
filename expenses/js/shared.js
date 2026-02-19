// shared.js - Common utilities for both mobile and admin apps

// Global state - will be initialized by each app
export let expenses = [];
export let suppliers = [];

// Firebase dependencies - will be imported at module level
let db;
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
const DELETION_TRACKING_TTL = 5 * 60 * 1000; // 5 minutes - after this, allow restoration from other devices
let deletionTimestamps = new Map(); // Track when each supplier was deleted (supplierId -> timestamp)
let expenseDeletionTimestamps = new Map(); // Track when each expense was deleted (expenseId -> timestamp)

// Initialize Firebase and load dependencies
export async function initializeFirebase() {
    try {
        // Import Firebase configuration
        const firebaseConfig = await import('./firebase-config.js');
        const result = await firebaseConfig.initializeFirebaseConfig();
        
        if (!result) {
            console.log('Firebase config initialization failed');
            return false;
        }
        
        db = result.db;

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

// Compress image before upload to reduce file size
export async function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                // Calculate new dimensions
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = width * ratio;
                    height = height * ratio;
                }
                
                // Create canvas and compress
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to base64 with compression
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
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
            return expenseData.receiptImage || null;
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

export function getSuppliers() {
    return [...suppliers];
}

export function addExpense(expense) {
    expenses.push(expense);
    
    // Automatically create supplier if it doesn't exist
    // This ensures ALL suppliers are always in the list
    if (expense.supplierName && expense.supplierName.trim()) {
        saveSupplierIfNew(expense);
    }
    
    saveToLocalStorage();
    invalidateItemMatchesCache();
}

export function updateExpense(expenseId, updatedExpense) {
    const index = expenses.findIndex(e => e.id === expenseId);
    if (index > -1) {
        updatedExpense.updatedAt = new Date().toISOString();
        expenses[index] = updatedExpense;
        
        // Automatically create supplier if it doesn't exist
        // This ensures ALL suppliers are always in the list
        if (updatedExpense.supplierName && updatedExpense.supplierName.trim()) {
            saveSupplierIfNew(updatedExpense);
        }
        
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

export async function deleteSupplier(supplierId, deleteAssociatedExpenses = true) {
    const index = suppliers.findIndex(s => s.id === supplierId);
    if (index > -1) {
        const supplier = suppliers[index];
        
        // Set deletion flag to prevent fetchFromFirebase from running
        deletionInProgress = true;
        
        // Track deletion immediately
        deletedSupplierIds.add(supplierId);
        deletionTimestamps.set(supplierId, Date.now());
        
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
        
        try {
            // Delete associated expenses if requested
            if (deleteAssociatedExpenses) {
                const supplierName = supplier.name;
                const expensesToDelete = expenses.filter(e => 
                    e.supplierName.toLowerCase() === supplierName.toLowerCase()
                );
                
                // Delete expenses from Firebase
                if (db && expensesToDelete.length > 0) {
                    try {
                        const batch = writeBatch(db);
                        expensesToDelete.forEach(expense => {
                            const expenseRef = doc(db, 'expenses', expense.id);
                            batch.delete(expenseRef);
                        });
                        await batch.commit();
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
                    console.log(`Deleted ${expensesToDelete.length} associated expense(s) for supplier "${supplierName}"`);
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
            
            // Trigger immediate sync to Firebase
            if (db && !syncInProgress) {
                await syncToFirebase();
            } else {
                // Mark for sync if sync is in progress
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
                    const supplierExpenses = expenses.filter(e => 
                        e.supplierName.toLowerCase() === supplier.name.toLowerCase()
                    );
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
                const batch = writeBatch(db);
                const suppliersToRemove = [];
                
                // Add expense deletions to batch if requested
                if (deleteAssociatedExpenses && expensesToDelete.length > 0) {
                    expensesToDelete.forEach(expense => {
                        const expenseRef = doc(db, 'expenses', expense.id);
                        batch.delete(expenseRef);
                    });
                }
                
                // Find suppliers in local array and prepare batch deletions
                supplierIds.forEach((supplierId, idx) => {
                    const index = suppliers.findIndex(s => s.id === supplierId);
                    if (index > -1) {
                        suppliersToRemove.push({ index, id: supplierId });
                        const supplierRef = doc(db, 'suppliers', supplierId);
                        batch.delete(supplierRef);
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
                if (suppliersToRemove.length > 0 || (deleteAssociatedExpenses && expensesToDelete.length > 0)) {
                    await batch.commit();
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

        // Load deletion tracking BEFORE processing expenses to prevent deleted items from being restored
        // BUT: If localStorage was completely cleared, clear deletion tracking to allow full restore from Firebase
        try {
            // If localStorage was cleared, reset deletion tracking to allow restoration from Firebase
            if (isLocalStorageEmpty) {
                console.log('LocalStorage was cleared - resetting deletion tracking to allow Firebase restore');
                deletedExpenseIds.clear();
                expenseDeletionTimestamps.clear();
                deletedSupplierIds.clear();
                deletionTimestamps.clear();
                // Clear deletion tracking from localStorage
                localStorage.removeItem('expenseTracker_deletedExpenses');
                localStorage.removeItem('expenseTracker_deletedSuppliers');
            }
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
                        const timeSinceDeletion = Date.now() - deletionTime;
                        if (timeSinceDeletion < DELETION_TRACKING_TTL) {
                            console.log('Filtering out deleted expense from localStorage:', expense.id);
                            return false;
                        }
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
    return expensesArray.map(expense => {
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
    
    // Clean up old supplier deletions
    deletedSupplierIds.forEach(id => {
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
            if (hasPendingChanges && db) {
                syncToFirebase();
                hasPendingChanges = false;
            }
            syncTimeout = null;
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

        // Sync expenses with batch writes for better performance
        const batch = writeBatch(db);
        
        // Track local expense IDs
        const localExpenseIds = new Set();

        expenses.forEach(expense => {
            localExpenseIds.add(expense.id);
            const docRef = doc(db, 'expenses', expense.id);
            batch.set(docRef, {
                ...expense,
                syncedAt: serverTimestamp(),
                deviceId: getDeviceId()
            });
        });
        
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
                const expenseRef = doc(db, 'expenses', expenseId);
                batch.delete(expenseRef);
                expenseDeletionCount++;
                const reason = isInDeletionTracking ? 'deletion tracking' : 'not in local array';
                console.log(`Marking expense for deletion in Firebase (${reason}):`, expenseId);
            }
        });

        // Sync suppliers that exist locally
        const localSupplierIds = new Set();
        suppliers.forEach(supplier => {
            localSupplierIds.add(supplier.id);
            const docRef = doc(db, 'suppliers', supplier.id);
            batch.set(docRef, {
                ...supplier,
                syncedAt: serverTimestamp(),
                deviceId: getDeviceId()
            });
        });

        // Delete suppliers from Firebase that:
        // 1. Are in Firebase but not in local array (was deleted locally), OR
        // 2. Are explicitly in deletion tracking (explicitly marked for deletion)
        let deletionCount = 0;
        firebaseSupplierIds.forEach(supplierId => {
            const isNotInLocal = !localSupplierIds.has(supplierId);
            const isInDeletionTracking = deletedSupplierIds.has(supplierId);
            
            // Delete if supplier was removed from local OR explicitly marked for deletion
            if (isNotInLocal || isInDeletionTracking) {
                const supplierRef = doc(db, 'suppliers', supplierId);
                batch.delete(supplierRef);
                deletionCount++;
                const reason = isInDeletionTracking ? 'deletion tracking' : 'not in local array';
                console.log(`Marking supplier for deletion in Firebase (${reason}):`, supplierId);
            }
        });

        await batch.commit();
        console.log('Firebase sync completed successfully', { 
            expenses: expenses.length, 
            suppliers: suppliers.length,
            supplierDeletions: deletionCount,
            expenseDeletions: expenseDeletionCount
        });
        showSyncStatus('✓ Synced', 'success');

        // Clear deletion tracking for successfully synced deletions
        // Only clear if deletion was successful (supplier/expense not in local and not in Firebase anymore)
        if (deletionCount > 0 || expenseDeletionCount > 0) {
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
                
                // Also verify expense deletions
                try {
                    const expensesSnapshot = await getDocs(collection(db, 'expenses'));
                    const remainingExpenseIds = new Set(expensesSnapshot.docs.map(doc => doc.id));
                    
                    deletedExpenseIds.forEach(id => {
                        // If expense is not in Firebase anymore and not in local, clear tracking
                        if (!remainingExpenseIds.has(id) && !localExpenseIds.has(id)) {
                            deletedExpenseIds.delete(id);
                            expenseDeletionTimestamps.delete(id);
                        }
                    });
                    
                    // Persist updated expense tracking
                    try {
                        const trackingData = {
                            ids: Array.from(deletedExpenseIds),
                            timestamps: Object.fromEntries(expenseDeletionTimestamps)
                        };
                        localStorage.setItem('expenseTracker_deletedExpenses', JSON.stringify(trackingData));
                    } catch (error) {
                        console.warn('Failed to persist expense deletion tracking:', error);
                    }
                } catch (error) {
                    console.warn('Failed to verify expense deletions:', error);
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

    // Don't fetch while deletions are in progress
    if (deletionInProgress) {
        console.log('Skipping fetch - deletion in progress');
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
    
    // If local data is completely empty, allow all Firebase data to be restored
    // (deletion tracking should have been cleared in loadFromLocalStorage if localStorage was empty)
    const isLocalDataEmpty = localData.expenses.length === 0 && localData.suppliers.length === 0;

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

            if (firebaseUpdated > localUpdated) {
                mergedExpenses[localIndex] = firebaseItem;
                hasChanges = true;
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
    const vatExemptAmount = parseFloat(getValue('vatExemptAmount')) || 
                           (existingExpense?.vatExemptAmount || 0);

    // Get supplier information for VAT calculation
    const supplierName = getValue('supplierName', existingExpense?.supplierName || '').trim();
    const allSuppliers = getSuppliers();
    const supplier = supplierName ? allSuppliers.find(s => 
        s.name.toLowerCase() === supplierName.toLowerCase()
    ) : null;

    // Calculate VAT if auto-calculate is enabled
    let vatBreakdown = {
        vatableSale: existingExpense?.vatableSale || 0,
        vatAmount: existingExpense?.vatAmount || 0,
        isVatRegistered: existingExpense?.isVatRegistered || false
    };

    if (autoCalculateVAT) {
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

    // Build expense object
    const expense = {
        id: isEditing && existingExpense ? existingExpense.id : (existingExpense?.id || generateId()),
        date: getValue('date', existingExpense?.date || getTodayLocal()),
        branch: getValue('branch', existingExpense?.branch || null),
        allocation: getValue('allocation', existingExpense?.allocation || 'Store'),
        supplierName: supplierName,
        businessName: getValue('businessName', existingExpense?.businessName || ''),
        tin: getValue('tin', existingExpense?.tin || ''),
        address: getValue('address', existingExpense?.address || ''),
        invoiceNumber: getValue('invoiceNumber', existingExpense?.invoiceNumber || ''),
        expenseCategory: getValue('expenseCategory', existingExpense?.expenseCategory || 'Supplies'),
        items: items,
        totalAmount: totalAmount,
        vatExemptAmount: vatExemptAmount,
        vatableSale: vatBreakdown.vatableSale,
        vatAmount: vatBreakdown.vatAmount,
        isVatRegistered: vatBreakdown.isVatRegistered,
        paidBy: (() => {
            const allocation = getValue('allocation', existingExpense?.allocation || 'Store');
            const paidBy = getValue('paidBy', existingExpense?.paidBy || 'Company');
            // If allocation is non-store, always Company
            return allocation === 'Store' ? paidBy : 'Company';
        })(),
        notes: getValue('notes', existingExpense?.notes || ''),
        receiptImage: getValue('receiptImage', existingExpense?.receiptImage || null),
        vatComputationEnabled: getValue('vatComputationEnabled') !== undefined ? 
                               (getValue('vatComputationEnabled') === 'true' || getValue('vatComputationEnabled') === true) :
                               (existingExpense?.vatComputationEnabled !== undefined ? existingExpense.vatComputationEnabled : undefined),
        createdAt: isEditing && existingExpense ? 
                   (existingExpense.createdAt || new Date().toISOString()) : 
                   new Date().toISOString(),
        updatedAt: new Date().toISOString() // Always set updatedAt, even for new expenses
    };

    // Validate if requested
    if (validate) {
        const errors = validateExpense(expense);
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
        expense: expense
    };
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
        // Match expenses by old supplier name
        if (expense.supplierName.toLowerCase() === oldSupplier.name.toLowerCase()) {
            // Update supplier fields in expense
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
    const expenseCount = allExpenses.filter(expense =>
        expense.supplierName.toLowerCase() === supplier.name.toLowerCase()
    ).length;

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