import * as shared from './shared.js';
import {
    createAutocomplete,
    getItemMatches,
    getPaidByMatches,
    buildSupplierMatchList,
} from './autocomplete.js';

// Pagination state
let currentPage = 1;
let itemsPerPage = 25;
let totalFilteredExpenses = [];

// View state
let dateRangeInput = null;
let adminRefreshIntervalId = null;
let adminRefreshInFlight = false;

/** @type {HTMLElement | null} */
let adminExpenseModalEl = null;
/** @type {HTMLElement | null} */
let adminSupplierModalEl = null;
let adminPendingReceiptUrl = null;
let adminSupplierExpenseSort = { column: 'date', direction: 'desc' };
let adminSupplierExpensePage = 1;
let adminConfirmationCallback = null;

function getActiveDataTable() {
    return document.querySelector('.view-btn[data-table].active')?.dataset.table || 'expenses';
}

function escapeHtml(text) {
    if (text == null) return '';
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
}

function closeAdminExpenseModal() {
    if (adminExpenseModalEl?.parentNode) {
        adminExpenseModalEl.parentNode.removeChild(adminExpenseModalEl);
    }
    adminExpenseModalEl = null;
    adminPendingReceiptUrl = null;
}

function closeAdminSupplierModal() {
    if (adminSupplierModalEl?.parentNode) {
        adminSupplierModalEl.parentNode.removeChild(adminSupplierModalEl);
    }
    adminSupplierModalEl = null;
}

function setupAdminConfirmationModal() {
    if (window._adminConfirmationWired) return;
    window._adminConfirmationWired = true;
    const overlay = document.getElementById('confirmationModalOverlay');
    const cancel = document.getElementById('confirmationCancelBtn');
    const action = document.getElementById('confirmationActionBtn');
    cancel?.addEventListener('click', () => {
        adminConfirmationCallback = null;
        overlay?.classList.remove('show');
        document.body.style.overflow = '';
    });
    action?.addEventListener('click', async () => {
        const cb = adminConfirmationCallback;
        adminConfirmationCallback = null;
        overlay?.classList.remove('show');
        document.body.style.overflow = '';
        if (typeof cb === 'function') await cb();
    });
    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) {
            adminConfirmationCallback = null;
            overlay.classList.remove('show');
            document.body.style.overflow = '';
        }
    });
}

function showAdminConfirmation(title, message, actionText, callback) {
    setupAdminConfirmationModal();
    const overlay = document.getElementById('confirmationModalOverlay');
    const titleEl = document.getElementById('confirmationTitle');
    const messageEl = document.getElementById('confirmationMessage');
    const actionBtn = document.getElementById('confirmationActionBtn');
    if (!overlay || !titleEl || !messageEl || !actionBtn) {
        if (window.confirm(message)) callback?.();
        return;
    }
    titleEl.textContent = title;
    messageEl.textContent = message;
    actionBtn.textContent = actionText;
    adminConfirmationCallback = callback;
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
}

// Load data from localStorage first, then sync with Firebase
async function loadData() {
    console.log('Loading data...');

    // Phase 1: Load from localStorage immediately (instant)
    const hasLocalData = shared.loadFromLocalStorage();

    if (hasLocalData) {
        const expenses = shared.getExpenses();
        const suppliers = shared.getSuppliers();
        console.log('Loaded from localStorage:', expenses.length, 'expenses,', suppliers.length, 'suppliers');

        // Render immediately with local data using the proper filtered render
        totalFilteredExpenses = [...expenses];
        renderFilteredTable(expenses);
        updateFilteredSummary(expenses);
        refreshMonthDropdown();
    }

    // Phase 2: Initialize Firebase in background (non-blocking)
    try {
        const firebaseReady = await shared.initializeFirebase();
        if (firebaseReady) {
            // Phase 3: Sync with Firebase and update if there are changes
            const hasChanges = await shared.fetchFromFirebase();

            if (hasChanges) {
                const expenses = shared.getExpenses();
                const suppliers = shared.getSuppliers();
                console.log('Updated from Firebase:', expenses.length, 'expenses,', suppliers.length, 'suppliers');

                // Re-render with updated data using the proper filtered render
                totalFilteredExpenses = [...expenses];
                renderFilteredTable(expenses);
                updateFilteredSummary(expenses);
                refreshMonthDropdown();
            } else {
                console.log('Local data was already up to date');
            }
        } else {
            console.log('Firebase not available - running in offline mode');
        }

        return true;
    } catch (error) {
        console.error('Firebase sync failed:', error);
        // Don't return false - we still have local data
        return hasLocalData;
    }
}

// Simple table render - show ALL data
function renderTable() {
    const tbody = document.getElementById('expenseTableBody');
    if (!tbody) {
        console.error('Table body not found');
        return;
    }

    const expenses = shared.getExpenses();
    console.log('Rendering table with', expenses.length, 'expenses');
    tbody.innerHTML = '';

    if (expenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9">No expenses found</td></tr>';
        return;
    }

    // Sort by date descending (newest first) before displaying
    const sortedExpenses = [...expenses].sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
    });

    sortedExpenses.slice(0, 500).forEach((expense) => {
        const row = document.createElement('tr');
        row.className = 'data-table-clickable-row';
        row.dataset.expenseId = expense.id;

        const itemsText = expense.items ? expense.items.map((i) => i.name).join(', ') : 'No items';
        const itemsShort = itemsText.length > 50 ? itemsText.substring(0, 50) + '...' : itemsText;
        const vatText = expense.vatAmount > 0 ? `₱${expense.vatAmount.toFixed(2)}` : 'No VAT';

        row.innerHTML = `
            <td><input type="checkbox" onchange="updateBulkActionBar()" onclick="handleCheckboxClick(event)"></td>
            <td>${escapeHtml(expense.date || 'No date')}</td>
            <td><strong>${escapeHtml(expense.supplierName || 'No supplier')}</strong></td>
            <td title="${escapeHtml(itemsText)}">${escapeHtml(itemsShort)}</td>
            <td>${escapeHtml(expense.expenseCategory || 'General')}</td>
            <td>₱${(expense.totalAmount || 0).toLocaleString()}</td>
            <td>${escapeHtml(expense.branch || 'No branch')}</td>
            <td>${escapeHtml(expense.paymentMethod || 'Cash')}</td>
            <td>${escapeHtml(vatText)}</td>
        `;

        tbody.appendChild(row);
    });

    console.log('Table rendered successfully');
}

function renderSuppliers() {
    const tbody = document.getElementById('supplierTableBody');
    if (!tbody) return;

    const suppliers = shared.getSuppliers();

    // Store for pagination (reuse the same pagination variables)
    totalFilteredExpenses = [...suppliers]; // Reusing the same variable for simplicity

    // Apply sorting for suppliers
    if (currentSort.column) {
        totalFilteredExpenses.sort((a, b) => {
            let aVal, bVal;

            switch (currentSort.column) {
                case 'name':
                    aVal = (a.name || '').toLowerCase();
                    bVal = (b.name || '').toLowerCase();
                    break;
                case 'business':
                    aVal = (a.businessName || '').toLowerCase();
                    bVal = (b.businessName || '').toLowerCase();
                    break;
                case 'tin':
                    aVal = a.tin || '';
                    bVal = b.tin || '';
                    break;
                case 'vat':
                    aVal = a.isVatRegistered ? 1 : 0;
                    bVal = b.isVatRegistered ? 1 : 0;
                    break;
                case 'transactions':
                    // Calculate transaction count for each supplier
                    const expenses = shared.getExpenses();
                    aVal = expenses.filter(e => e.supplierName === a.name).length;
                    bVal = expenses.filter(e => e.supplierName === b.name).length;
                    break;
                case 'total':
                    // Calculate total amount for each supplier
                    const allExpenses = shared.getExpenses();
                    aVal = allExpenses.filter(e => e.supplierName === a.name).reduce((sum, e) => sum + (e.totalAmount || 0), 0);
                    bVal = allExpenses.filter(e => e.supplierName === b.name).reduce((sum, e) => sum + (e.totalAmount || 0), 0);
                    break;
                default:
                    aVal = '';
                    bVal = '';
            }

            if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    console.log('Rendering suppliers table with', totalFilteredExpenses.length, 'suppliers');
    tbody.innerHTML = '';

    if (totalFilteredExpenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No suppliers found</td></tr>';
        return;
    }

    // Calculate pagination
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFilteredExpenses.length);
    const pageSuppliers = totalFilteredExpenses.slice(startIndex, endIndex);

    // Pre-calculate expenses for efficiency
    const expenses = shared.getExpenses();

    pageSuppliers.forEach(supplier => {
        const supplierExpenses = expenses.filter(e => e.supplierName === supplier.name);
        const transactionCount = supplierExpenses.length;
        const totalAmount = supplierExpenses.reduce((sum, e) => sum + (e.totalAmount || 0), 0);

        const row = document.createElement('tr');
        row.className = 'data-table-clickable-row';
        row.dataset.supplierId = supplier.id;
        row.dataset.supplierName = supplier.name;
        row.innerHTML = `
            <td style="width: 30px; max-width: 30px; text-align: center;"><input type="checkbox" onchange="updateBulkActionBar()" onclick="handleCheckboxClick(event)"></td>
            <td style="width: 220px; max-width: 220px;"><strong>${escapeHtml(supplier.name || 'No name')}</strong></td>
            <td style="width: 220px; max-width: 220px;">${escapeHtml(supplier.businessName || '-')}</td>
            <td style="width: 160px; max-width: 160px;">${escapeHtml(supplier.tin || '-')}</td>
            <td style="width: 140px; max-width: 140px;">${supplier.isVatRegistered ? 'VAT Registered' : 'Not Registered'}</td>
            <td style="width: 60px; max-width: 60px; text-align: center;">${transactionCount}</td>
            <td style="width: 100px; max-width: 100px; text-align: right;">₱${totalAmount.toLocaleString()}</td>
        `;
        tbody.appendChild(row);
    });

    refreshPagination('suppliers');
    
    // Set up sorting for suppliers table
    setupSuppliersTableSorting();
}

function updateSummary() {
    const container = document.getElementById('summaryCards');
    if (!container) return;

    const expenses = shared.getExpenses();
    const total = expenses.reduce((sum, e) => sum + (e.totalAmount || 0), 0);
    const supplierCount = new Set(expenses.map(e => e.supplierName)).size;

    container.innerHTML = `
        <div class="summary-card">
            <div class="card-title">Total Expenses</div>
            <div class="card-value">₱${total.toLocaleString()}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Total Transactions</div>
            <div class="card-value">${expenses.length}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Suppliers</div>
            <div class="card-value">${supplierCount}</div>
        </div>
    `;
}

// This DOMContentLoaded listener is removed - using the one below instead

// Format date range display
function formatDateRange(startDate, endDate) {
    const startMonth = startDate.toLocaleString('en-US', { month: 'short' });
    const startDay = startDate.getDate();
    const startYear = startDate.getFullYear();

    const endMonth = endDate.toLocaleString('en-US', { month: 'short' });
    const endDay = endDate.getDate();
    const endYear = endDate.getFullYear();

    // Same year and month
    if (startYear === endYear && startMonth === endMonth) {
        return `${startMonth} ${startDay} - ${endDay}, ${endYear}`;
    }
    // Same year, different months
    else if (startYear === endYear) {
        return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${endYear}`;
    }
    // Different years
    else {
        return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`;
    }
}

// Initialize flatpickr
function initializeDateRangePicker() {
    console.log('[DatePicker] Initializing...');
    dateRangeInput = document.getElementById('dateRange');
    
    if (!dateRangeInput) {
        console.error('[DatePicker] ERROR: dateRange input not found!');
        return false;
    }
    
    if (typeof flatpickr === 'undefined') {
        console.error('[DatePicker] ERROR: flatpickr library not loaded!');
        return false;
    }
    
    try {
        const fp = flatpickr("#dateRange", {
            mode: "range",
            dateFormat: "M j, Y",
            defaultDate: [
                new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
                new Date()
            ],
            onChange: function (selectedDates) {
                console.log('[DatePicker] Date changed:', selectedDates);
                // Clear all active shortcut buttons when custom date is selected
                document.querySelectorAll('.date-shortcut-btn').forEach(btn => {
                    btn.classList.remove('active');
                });

                // Add custom range styling and format display
                if (selectedDates.length === 2) {
                    dateRangeInput.classList.add('custom-range');
                    // Override the display with our custom format
                    setTimeout(() => {
                        dateRangeInput.value = formatDateRange(selectedDates[0], selectedDates[1]);
                    }, 10);
                    
                    filterAndRender();
                }
            },
            onReady: function (selectedDates) {
                console.log('[DatePicker] Ready with dates:', selectedDates);
                // Format initial display too
                if (selectedDates.length === 2) {
                    setTimeout(() => {
                        dateRangeInput.value = formatDateRange(selectedDates[0], selectedDates[1]);
                    }, 10);
                }
            }
        });
        
        console.log('[DatePicker] ✓ Initialized successfully');
        return true;
    } catch (error) {
        console.error('[DatePicker] ERROR during initialization:', error);
        return false;
    }
}

// Create date shortcuts
function createDateShortcuts() {
    console.log('[Shortcuts] Creating shortcuts...');
    const shortcutsContainer = document.getElementById("dateShortcuts");
    const monthDropdown = document.getElementById("monthDropdown");
    
    if (!shortcutsContainer) {
        console.error('[Shortcuts] ERROR: dateShortcuts container not found!');
        return;
    }
    
    shortcutsContainer.innerHTML = "";

    // Create "All Data" button
    const allDataBtn = document.createElement("button");
    allDataBtn.innerText = "All Data";
    allDataBtn.className = "date-shortcut-btn";
    allDataBtn.onclick = () => setDateRangeShortcut("All Data");
    shortcutsContainer.appendChild(allDataBtn);

// Populate month dropdown with months that have data
    if (monthDropdown) {
    monthDropdown.innerHTML = '<option value="">Select Month</option>';
    
    const monthsWithData = getMonthsWithData();
    
    monthsWithData.forEach(month => {
        const option = document.createElement("option");
        // Create a proper date string that won't cause timezone issues
        const year = month.date.getFullYear();
        const monthNum = month.date.getMonth() + 1; // Convert to 1-indexed for display
        const day = month.date.getDate();
        option.value = `${year}-${monthNum.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        option.textContent = month.label;
        monthDropdown.appendChild(option);
    });
    
        // Add event listener for month selection
        monthDropdown.addEventListener('change', (e) => {
            if (e.target.value) {
                // Parse the date string properly to avoid timezone issues
                const [year, month, day] = e.target.value.split('-').map(Number);
                const selectedDate = new Date(year, month - 1, day); // month - 1 because JS months are 0-indexed
                setMonthRange(selectedDate);
            }
        });
        
        console.log('[Shortcuts] ✓ Created month dropdown with', monthsWithData.length, 'months with data');
    }
}

// Function to refresh month dropdown (call this when data changes)
function refreshMonthDropdown() {
    const monthDropdown = document.getElementById("monthDropdown");
    if (!monthDropdown) return;
    
    monthDropdown.innerHTML = '<option value="">Select Month</option>';
    
    const monthsWithData = getMonthsWithData();
    
    monthsWithData.forEach(month => {
        const option = document.createElement("option");
        // Create a proper date string that won't cause timezone issues
        const year = month.date.getFullYear();
        const monthNum = month.date.getMonth() + 1; // Convert to 1-indexed for display
        const day = month.date.getDate();
        option.value = `${year}-${monthNum.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        option.textContent = month.label;
        monthDropdown.appendChild(option);
    });
    
    // Re-add the event listener
    monthDropdown.addEventListener('change', (e) => {
        if (e.target.value) {
            // Parse the date string properly to avoid timezone issues
            const [year, month, day] = e.target.value.split('-').map(Number);
            const selectedDate = new Date(year, month - 1, day); // month - 1 because JS months are 0-indexed
            setMonthRange(selectedDate);
        }
    });
    
    console.log('[refreshMonthDropdown] Refreshed with', monthsWithData.length, 'months');
}

function getMonthsWithData() {
    const expenses = shared.getExpenses();
    console.log('[getMonthsWithData] Total expenses:', expenses.length);
    
    const monthMap = new Map();
    
    // Group expenses by month/year
    expenses.forEach(expense => {
        if (expense.date) {
            console.log('[getMonthsWithData] Processing expense date:', expense.date);
            const date = new Date(expense.date);
            
            // Check if date is valid
            if (isNaN(date.getTime())) {
                console.warn('[getMonthsWithData] Invalid date:', expense.date);
                return;
            }
            
            const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
            
            if (!monthMap.has(monthKey)) {
                monthMap.set(monthKey, {
                    date: new Date(date.getFullYear(), date.getMonth(), 1),
                    count: 0
                });
            }
            monthMap.get(monthKey).count++;
        } else {
            console.warn('[getMonthsWithData] Expense missing date:', expense);
        }
    });
    
    // Convert to array and sort by date (newest first)
    const months = Array.from(monthMap.values())
        .map(month => ({
            label: month.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            date: month.date,
            count: month.count
        }))
        .sort((a, b) => b.date - a.date);
    
    console.log('[getMonthsWithData] Found months with data:', months.map(m => `${m.label} (${m.count} expenses)`));
    return months;
}

function setDateRangeShortcut(type) {
    console.log('[Shortcut] Clicked:', type);
    
    if (!dateRangeInput || !dateRangeInput._flatpickr) {
        console.error('[Shortcut] ERROR: Date picker not initialized!');
        return;
    }
    
    const now = new Date();
    let start, end;

    switch (type) {
        case "All Data":
            const earliestDate = findEarliestDataDate();
            start = earliestDate || new Date(now.getFullYear() - 5, 0, 1);
            end = now;
            break;
        default:
            console.error('[Shortcut] Unknown type:', type);
            return;
    }

    dateRangeInput._flatpickr.setDate([start, end]);

    // Format the display
    setTimeout(() => {
        dateRangeInput.value = "All Data";
    }, 10);

    // Add active state to clicked shortcut
    document.querySelectorAll('.date-shortcut-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === type);
    });

    // Remove custom range styling when using shortcuts
    dateRangeInput.classList.remove('custom-range');

    filterAndRender();
}

function setMonthRange(monthDate) {
    console.log('[Month] Selected:', monthDate);
    
    if (!dateRangeInput || !dateRangeInput._flatpickr) {
        console.error('[Month] ERROR: Date picker not initialized!');
        return;
    }

    // Calculate start and end of the month
    const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

    // Clear any existing selections and set new dates
    dateRangeInput._flatpickr.clear();
    dateRangeInput._flatpickr.setDate([start, end]);

    // Update the input value with month format
    const monthName = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    dateRangeInput.value = monthName;

    // Update active button
    document.querySelectorAll('.date-shortcut-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // Remove custom range styling
    dateRangeInput.classList.remove('custom-range');

        filterAndRender();
}

function findEarliestDataDate() {
    const expenses = shared.getExpenses();
    if (expenses.length === 0) return null;

    // Find the earliest date from expenses
    const dates = expenses.map(expense => new Date(expense.date)).filter(d => !isNaN(d));
    
    if (dates.length === 0) return null;
    
    return new Date(Math.min(...dates));
}

function setDefaultDateRange() {
    setDateRangeShortcut("All Data");
}

function startAdminPeriodicRefresh() {
    if (adminRefreshIntervalId) return; // Avoid duplicates

    // Poll every 2 minutes; long enough to reduce load, short enough to stay fresh.
    const refreshMs = 2 * 60 * 1000;
    console.log(`[AdminRefresh] Starting periodic refresh every ${refreshMs}ms`);

    adminRefreshIntervalId = setInterval(async () => {
        if (adminRefreshInFlight) return;
        adminRefreshInFlight = true;

        try {
            const changed = await shared.fetchFromFirebase();
            if (!changed) return;

            const activeBtn = document.querySelector('.view-btn[data-table].active');
            const activeTable = activeBtn?.dataset.table || 'expenses';

            if (activeTable === 'expenses') {
                // Re-apply current filter state (flatpickr date range + selectors).
                filterAndRender();
            } else if (activeTable === 'suppliers') {
                currentPage = 1;
                renderSuppliers();
                // Suppliers view doesn't call the filtered summary path, so update overall summary too.
                updateSummary();
            }
        } catch (error) {
            console.warn('[AdminRefresh] Periodic refresh failed:', error);
        } finally {
            adminRefreshInFlight = false;
        }
    }, refreshMs);

    window.addEventListener('beforeunload', () => {
        if (adminRefreshIntervalId) {
            clearInterval(adminRefreshIntervalId);
            adminRefreshIntervalId = null;
        }
    });
}

async function initialize() {
    console.log('=== INITIALIZING ADMIN INTERFACE ===');

    // Set default sorting BEFORE loading data
    currentSort = { column: 'date', direction: 'desc' };
    console.log('[1/8] ✓ Set default sorting');

    // Initialize date range picker first
    const pickerSuccess = initializeDateRangePicker();
    if (!pickerSuccess) {
        console.error('[2/8] ✗ Date picker initialization failed');
    } else {
        console.log('[2/8] ✓ Date picker initialized');
    }

    // Create date shortcuts
    createDateShortcuts();
    console.log('[3/8] ✓ Created date shortcuts');

    // Load data first (localStorage then Firebase)
    console.log('[4/8] Loading data...');
    const success = await loadData();

    if (!success) {
        console.error('[4/8] ✗ Failed to load any data');
        document.getElementById('summaryCards').innerHTML = '<div class="summary-card"><div class="card-title">Error</div><div class="card-value">No data available</div></div>';
        return;
    }
    console.log('[4/8] ✓ Data loaded');

    // Set up all event listeners
    console.log('[5/8] Setting up event listeners...');
    setupEventListeners();
    console.log('[5/8] ✓ Event listeners setup');

    // Update header visual state for default date sorting
    const dateHeader = document.querySelector('.data-table th[data-sort="date"]');
    if (dateHeader) {
        dateHeader.classList.add('sorted-desc');
    }
    console.log('[6/8] ✓ Updated table header');

    // Initialize pagination containers immediately
    setupPagination('expenses');
    setupPagination('suppliers');
    console.log('[7/8] ✓ Setup pagination');
    
    // Set default after a small delay to ensure flatpickr is ready
    setTimeout(() => {
        console.log('[8/8] Setting default date range...');
        setDefaultDateRange();
        console.log('[8/8] ✓ Default date range set');
        console.log('=== ✓ INITIALIZATION COMPLETE ===');

        // Start polling after we know the UI and flatpickr are ready.
        startAdminPeriodicRefresh();
    }, 100);
}

function setupEventListeners() {
    console.log('[EventListeners] Setting up...');

    // Table type switching buttons (Expenses/Suppliers/Analytics)
    const tableBtns = document.querySelectorAll('.view-btn[data-table]');
    console.log('[EventListeners] Found', tableBtns.length, 'table buttons:', Array.from(tableBtns).map(b => b.dataset.table));
    
    tableBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('[EventListeners] Table type button clicked:', btn.dataset.table);

            // Update button states
            document.querySelectorAll('.view-btn[data-table]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Hide all views
            document.querySelectorAll('.data-view').forEach(view => view.classList.add('hidden'));

            const filterSection = document.getElementById('adminFilterSection');
            const mainControls = document.querySelector('.main-controls');
            const addExpenseBtn = document.getElementById('addExpenseBtn');
            const tableControls = document.querySelector('.table-controls');

            if (mainControls) mainControls.style.display = 'flex';

            if (btn.dataset.table === 'expenses') {
                if (filterSection) filterSection.style.display = '';
                if (addExpenseBtn) addExpenseBtn.style.display = 'inline-flex';
                if (tableControls) tableControls.style.display = 'flex';
            } else if (btn.dataset.table === 'suppliers') {
                if (filterSection) filterSection.style.display = 'none';
                if (addExpenseBtn) addExpenseBtn.style.display = 'none';
                if (tableControls) tableControls.style.display = 'flex';
            } else {
                if (filterSection) filterSection.style.display = 'none';
                if (addExpenseBtn) addExpenseBtn.style.display = 'none';
                if (tableControls) tableControls.style.display = 'none';
            }

            // Show selected view
            const targetView = document.getElementById(`${btn.dataset.table}View`);
            if (targetView) {
                targetView.classList.remove('hidden');

                // Render appropriate content
                if (btn.dataset.table === 'expenses') {
                    // Reset pagination for expenses - just show filtered table
                    currentPage = 1;
                    if (dateRangeInput && dateRangeInput._flatpickr) {
                        filterAndRender();
                    } else {
                        const expenses = shared.getExpenses();
                        renderFilteredTable(expenses);
                        updateFilteredSummary(expenses);
                    }
                } else if (btn.dataset.table === 'suppliers') {
                    // Reset pagination and sorting for suppliers
                    currentPage = 1;
                    currentSort = { column: 'transactions', direction: 'desc' };
                    // Clear sort indicators
                    document.querySelectorAll('.data-table th[data-sort]').forEach(h => {
                        h.classList.remove('sorted-asc', 'sorted-desc');
                    });
                    renderSuppliers();
                } else if (btn.dataset.table === 'analytics') {
                    targetView.innerHTML = '<div style="padding: 2rem;">Analytics coming soon...</div>';
                }
            }

            const selAllExp = document.getElementById('selectAllExpenses');
            const selAllSup = document.getElementById('selectAllSuppliers');
            if (selAllExp) selAllExp.checked = false;
            if (selAllSup) selAllSup.checked = false;
            updateBulkActionBar();
        });
    });

    // Add expense button
    const addBtn = document.getElementById('addExpenseBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            console.log('Add expense clicked');
            window.addExpense();
        });
    }

    // Import CSV button
    const importBtn = document.getElementById('importBtn');
    const fileInput = document.getElementById('fileInput');
    
    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            handleCSVImport(e.target);
        });
    }

    // Export CSV button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            exportExpensesToCSV();
        });
    }

    // Note: Date shortcuts are now handled by createDateShortcuts and setDateRangeShortcut functions

    // Setup table sorting
    setupTableSorting();
    
    // Branch selector
    const branchSelector = document.getElementById('branchSelector');
    if (branchSelector) {
        branchSelector.addEventListener('change', () => {
            console.log('Branch changed, re-filtering...');
            filterAndRender();
        });
    }
    
    // Category selector
    const categorySelector = document.getElementById('categorySelector');
    if (categorySelector) {
        categorySelector.addEventListener('change', () => {
            console.log('Category changed, re-filtering...');
            filterAndRender();
        });
    }
    
    
    // Add clear filters functionality
    addClearFiltersButton();

    setupAdminConfirmationModal();
    const selAllSuppliers = document.getElementById('selectAllSuppliers');
    if (selAllSuppliers) {
        selAllSuppliers.addEventListener('change', () => {
            document.querySelectorAll('#supplierTableBody input[type="checkbox"]').forEach((cb) => {
                cb.checked = selAllSuppliers.checked;
            });
            updateBulkActionBar();
        });
    }

    setupExpenseTableRowActivation();
    setupSupplierTableRowActivation();

    console.log('Event listeners set up successfully');
}

function setupExpenseTableRowActivation() {
    const tbody = document.getElementById('expenseTableBody');
    if (!tbody || tbody.dataset.clickDelegation === '1') return;
    tbody.dataset.clickDelegation = '1';
    tbody.addEventListener('click', (e) => {
        if (e.target.closest('input[type="checkbox"]')) return;
        const tr = e.target.closest('tr[data-expense-id]');
        if (!tr?.dataset.expenseId) return;
        window.viewExpense(tr.dataset.expenseId);
    });
}

function setupSupplierTableRowActivation() {
    const tbody = document.getElementById('supplierTableBody');
    if (!tbody || tbody.dataset.clickDelegation === '1') return;
    tbody.dataset.clickDelegation = '1';
    tbody.addEventListener('click', (e) => {
        if (e.target.closest('input[type="checkbox"]')) return;
        const tr = e.target.closest('tr[data-supplier-id]');
        if (!tr?.dataset.supplierName) return;
        window.viewSupplierDetails(tr.dataset.supplierName);
    });
}

function refreshAdminTables() {
    const tab = getActiveDataTable();
    if (tab === 'expenses') {
        const activeBtn = document.querySelector('.date-shortcut-btn.active');
        if (activeBtn) activeBtn.click();
        else {
            const expenses = shared.getExpenses();
            renderFilteredTable(expenses);
            updateFilteredSummary(expenses);
        }
    } else if (tab === 'suppliers') {
        renderSuppliers();
        updateSummary();
    }
    updateBulkActionBar();
}

// Add clear filters button functionality
function addClearFiltersButton() {
    const tableSearch = document.querySelector('.table-search');
    if (tableSearch) {
        // Check if clear button already exists
        if (document.getElementById('clearFiltersBtn')) return;
        
        const clearBtn = document.createElement('button');
        clearBtn.id = 'clearFiltersBtn';
        clearBtn.className = 'action-btn secondary';
        clearBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3,6 5,6 21,6"></polyline>
                <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
            Clear Filters
        `;
        
        clearBtn.addEventListener('click', () => {
            clearAllFilters();
        });
        
        tableSearch.appendChild(clearBtn);
    }
}

// Clear all filters function
function clearAllFilters() {
    // Reset branch selector
    const branchSelector = document.getElementById('branchSelector');
    if (branchSelector) {
        branchSelector.value = 'all';
    }
    
    // Reset category selector
    const categorySelector = document.getElementById('categorySelector');
    if (categorySelector) {
        categorySelector.value = 'all';
    }
    
    
    // Reset date range to "All Data"
    if (dateRangeInput && dateRangeInput._flatpickr) {
        setDateRangeShortcut("All Data");
    }
    
    console.log('All filters cleared');
}

// Update filter indicators to show active filters
function updateFilterIndicators(selectedBranch, selectedCategory) {
    const clearBtn = document.getElementById('clearFiltersBtn');
    if (!clearBtn) return;
    
    let activeFilters = 0;
    let filterText = [];
    
    if (selectedBranch !== 'all') {
        activeFilters++;
        filterText.push(`Branch: ${selectedBranch}`);
    }
    
    if (selectedCategory !== 'all') {
        activeFilters++;
        filterText.push(`Category: ${selectedCategory}`);
    }
    
    // Update button text and visibility
    if (activeFilters > 0) {
        clearBtn.style.display = 'flex';
        clearBtn.title = `Active filters: ${filterText.join(', ')}`;
        
        // Update button text to show count
        const svg = clearBtn.querySelector('svg');
        clearBtn.innerHTML = '';
        if (svg) {
            clearBtn.appendChild(svg);
        }
        clearBtn.appendChild(document.createTextNode(`Clear Filters (${activeFilters})`));
    } else {
        clearBtn.style.display = 'none';
    }
}

// Filter and render based on current filters
function filterAndRender() {
    if (!dateRangeInput || !dateRangeInput._flatpickr) {
        console.log('Date range picker not ready yet');
        return;
    }

    const [start, end] = dateRangeInput._flatpickr.selectedDates;
    if (!start || !end) {
        console.log('No date range selected');
        return;
    }

    // Get selected filters
    const branchSelector = document.getElementById('branchSelector');
    const categorySelector = document.getElementById('categorySelector');
    
    const selectedBranch = branchSelector ? branchSelector.value : 'all';
    const selectedCategory = categorySelector ? categorySelector.value : 'all';
    
    console.log('Filter values:', { selectedBranch, selectedCategory });
    
    const expenses = shared.getExpenses();
    console.log('Total expenses loaded:', expenses.length);
    
    // Filter expenses by all criteria
    const filteredExpenses = expenses.filter(expense => {
        if (!expense.date) return false;
        
        // Date filter
        const expenseDate = new Date(expense.date);
        const dateMatch = expenseDate >= start && expenseDate <= end;
        
        // Branch filter
        let branchMatch = true;
        if (selectedBranch !== 'all') {
            branchMatch = expense.branch === selectedBranch;
        }
        
        // Category filter
        let categoryMatch = true;
        if (selectedCategory !== 'all') {
            categoryMatch = (expense.expenseCategory || 'General') === selectedCategory;
        }
        
        return dateMatch && branchMatch && categoryMatch;
    });

    console.log(`Filtered ${filteredExpenses.length} expenses from ${expenses.length} total`);

    // Reset to page 1 when filtering
    currentPage = 1;

    // Update filter indicators
    updateFilterIndicators(selectedBranch, selectedCategory);

    // Always render as individual entries (no aggregation)
    renderFilteredTable(filteredExpenses);
    updateFilteredSummary(filteredExpenses);
}

// Render weekly aggregated view
function renderWeeklyView(filteredExpenses) {
    // Group expenses by week
    const weeklyData = {};
    
    filteredExpenses.forEach(expense => {
        if (!expense.date) return;
        
        const date = new Date(expense.date);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
        
        const weekKey = weekStart.toISOString().split('T')[0];
        
        if (!weeklyData[weekKey]) {
            weeklyData[weekKey] = {
                expenses: [],
                total: 0,
                weekStart: weekStart
            };
        }
        
        weeklyData[weekKey].expenses.push(expense);
        weeklyData[weekKey].total += expense.totalAmount || 0;
    });
    
    // Convert to array and sort by week
    const weeks = Object.values(weeklyData).sort((a, b) => b.weekStart - a.weekStart);
    
    // Store for pagination
    totalFilteredExpenses = weeks;
    
    const tbody = document.getElementById('expenseTableBody');
    tbody.innerHTML = '';
    
    if (weeks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9">No expenses found for this date range</td></tr>';
        setupPagination('expenses');
        return;
    }
    
    // Paginate
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, weeks.length);
    const pageWeeks = weeks.slice(startIndex, endIndex);
    
    pageWeeks.forEach(week => {
        const weekEnd = new Date(week.weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="checkbox"></td>
            <td colspan="2">${week.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
            <td>${week.expenses.length} expenses</td>
            <td><strong>₱${week.total.toLocaleString()}</strong></td>
            <td colspan="3">-</td>
            <td><button onclick="alert('View weekly details')">View</button></td>
        `;
        tbody.appendChild(row);
    });
    
    refreshPagination('expenses');
}

// Render monthly aggregated view
function renderMonthlyView(filteredExpenses) {
    // Group expenses by month
    const monthlyData = {};
    
    filteredExpenses.forEach(expense => {
        if (!expense.date) return;
        
        const date = new Date(expense.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = {
                expenses: [],
                total: 0,
                date: new Date(date.getFullYear(), date.getMonth(), 1)
            };
        }
        
        monthlyData[monthKey].expenses.push(expense);
        monthlyData[monthKey].total += expense.totalAmount || 0;
    });
    
    // Convert to array and sort by month
    const months = Object.values(monthlyData).sort((a, b) => b.date - a.date);
    
    // Store for pagination
    totalFilteredExpenses = months;
    
    const tbody = document.getElementById('expenseTableBody');
    tbody.innerHTML = '';
    
    if (months.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9">No expenses found for this date range</td></tr>';
        setupPagination('expenses');
        return;
    }
    
    // Paginate
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, months.length);
    const pageMonths = months.slice(startIndex, endIndex);
    
    pageMonths.forEach(month => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="checkbox"></td>
            <td colspan="2">${month.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</td>
            <td>${month.expenses.length} expenses</td>
            <td><strong>₱${month.total.toLocaleString()}</strong></td>
            <td colspan="3">-</td>
            <td><button onclick="alert('View monthly details')">View</button></td>
        `;
        tbody.appendChild(row);
    });
    
    refreshPagination('expenses');
}

// Run initialization
console.log('Script loaded, checking DOM state...');
if (document.readyState === 'loading') {
    console.log('DOM still loading, waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    console.log('DOM already loaded, initializing immediately...');
    setTimeout(initialize, 100);
}

function renderFilteredTable(filteredExpenses) {
    const tbody = document.getElementById('expenseTableBody');
    if (!tbody) {
        console.error('Table body not found');
        return;
    }

    // Store for pagination
    totalFilteredExpenses = [...filteredExpenses];

    // Apply sorting
    if (currentSort.column) {
        totalFilteredExpenses.sort((a, b) => {
            let aVal, bVal;

            switch (currentSort.column) {
                case 'date':
                    aVal = a.date || '';
                    bVal = b.date || '';
                    break;
                case 'supplier':
                    aVal = (a.supplierName || '').toLowerCase();
                    bVal = (b.supplierName || '').toLowerCase();
                    break;
                case 'amount':
                    aVal = a.totalAmount || 0;
                    bVal = b.totalAmount || 0;
                    break;
                case 'branch':
                    aVal = (a.branch || '').toLowerCase();
                    bVal = (b.branch || '').toLowerCase();
                    break;
                case 'payment':
                    aVal = (a.paymentMethod || '').toLowerCase();
                    bVal = (b.paymentMethod || '').toLowerCase();
                    break;
                case 'vat':
                    aVal = a.vatAmount || 0;
                    bVal = b.vatAmount || 0;
                    break;
                default:
                    aVal = '';
                    bVal = '';
            }

            if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    console.log('Rendering filtered table with', totalFilteredExpenses.length, 'expenses');
    tbody.innerHTML = '';

    if (totalFilteredExpenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9">No expenses found for this date range</td></tr>';
        setupPagination('expenses');
        return;
    }

    // Calculate pagination
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFilteredExpenses.length);
    const pageExpenses = totalFilteredExpenses.slice(startIndex, endIndex);

    pageExpenses.forEach((expense) => {
        const row = document.createElement('tr');
        row.className = 'data-table-clickable-row';
        row.dataset.expenseId = expense.id;

        const itemsText = expense.items ? expense.items.map((i) => i.name).join(', ') : 'No items';
        const itemsShort = itemsText.length > 50 ? itemsText.substring(0, 50) + '...' : itemsText;
        const vatText = expense.vatAmount > 0 ? `₱${expense.vatAmount.toFixed(2)}` : 'No VAT';

        row.innerHTML = `
            <td><input type="checkbox" onchange="updateBulkActionBar()" onclick="handleCheckboxClick(event)"></td>
            <td>${escapeHtml(formatDate(expense.date))}</td>
            <td><strong>${escapeHtml(expense.supplierName || 'No supplier')}</strong></td>
            <td title="${escapeHtml(itemsText)}">${escapeHtml(itemsShort)}</td>
            <td>${escapeHtml(expense.expenseCategory || 'General')}</td>
            <td>₱${(expense.totalAmount || 0).toLocaleString()}</td>
            <td>${escapeHtml(expense.branch || 'No branch')}</td>
            <td>${escapeHtml(expense.paymentMethod || 'Cash')}</td>
            <td>${escapeHtml(vatText)}</td>
        `;

        tbody.appendChild(row);
    });

    refreshPagination('expenses');
    console.log('Filtered table rendered successfully');
}

function updateFilteredSummary(filteredExpenses) {
    const container = document.getElementById('summaryCards');
    if (!container) return;

    const total = filteredExpenses.reduce((sum, e) => sum + (e.totalAmount || 0), 0);
    const supplierCount = new Set(filteredExpenses.map(e => e.supplierName)).size;

    container.innerHTML = `
        <div class="summary-card">
            <div class="card-title">Total Expenses</div>
            <div class="card-value">₱${total.toLocaleString()}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Total Transactions</div>
            <div class="card-value">${filteredExpenses.length}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Suppliers</div>
            <div class="card-value">${supplierCount}</div>
        </div>
    `;
}

// Add sorting functionality
let currentSort = { column: null, direction: 'asc' };

function setupTableSorting() {
    document.querySelectorAll('.data-table th[data-sort]').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;

            // Toggle direction if same column, otherwise start with asc
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }

            // Update header visual states
            document.querySelectorAll('.data-table th[data-sort]').forEach(h => {
                h.classList.remove('sorted-asc', 'sorted-desc');
            });
            header.classList.add(`sorted-${currentSort.direction}`);

            // Re-render with current filter
            filterAndRender();
        });
    });
}

function setupSuppliersTableSorting() {
    // Remove existing event listeners to avoid duplicates
    document.querySelectorAll('#supplierTableHeaders th[data-sort]').forEach(header => {
        header.replaceWith(header.cloneNode(true));
    });

    // Add new event listeners
    document.querySelectorAll('#supplierTableHeaders th[data-sort]').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;

            // Toggle direction if same column, otherwise start with asc
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }

            // Update header visual states for suppliers table only
            document.querySelectorAll('#supplierTableHeaders th[data-sort]').forEach(h => {
                h.classList.remove('sorted-asc', 'sorted-desc');
            });
            header.classList.add(`sorted-${currentSort.direction}`);

            // Re-render suppliers table with new sort
            renderSuppliers();
        });
    });
}

function formatDate(dateString) {
    if (!dateString) return 'No date';

    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString; // Invalid date

        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch (error) {
        return dateString;
    }
}

function setupPagination(viewType = 'expenses') {
    const containerId = viewType === 'suppliers' ? 'suppliersPaginationControls' : 'expensesPaginationControls';
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Pagination container ${containerId} not found`);
        return;
    }

    const totalPages = Math.ceil(totalFilteredExpenses.length / itemsPerPage);
    const entityName = viewType === 'suppliers' ? 'suppliers' : 'expenses';

    container.innerHTML = `
        <div class="pagination-info">
            Showing ${Math.min((currentPage - 1) * itemsPerPage + 1, totalFilteredExpenses.length)}-${Math.min(currentPage * itemsPerPage, totalFilteredExpenses.length)} of ${totalFilteredExpenses.length} ${entityName}
        </div>
        <div class="pagination-controls">
            <select id="itemsPerPageSelect_${viewType}" class="items-per-page">
                <option value="10" ${itemsPerPage === 10 ? 'selected' : ''}>10 per page</option>
                <option value="25" ${itemsPerPage === 25 ? 'selected' : ''}>25 per page</option>
                <option value="50" ${itemsPerPage === 50 ? 'selected' : ''}>50 per page</option>
                <option value="100" ${itemsPerPage === 100 ? 'selected' : ''}>100 per page</option>
                <option value="250" ${itemsPerPage === 250 ? 'selected' : ''}>250 per page</option>
                <option value="500" ${itemsPerPage === 500 ? 'selected' : ''}>500 per page</option>
            </select>
            <div class="page-controls">
                <button id="prevPage_${viewType}" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
                <span class="page-indicator">Page ${currentPage} of ${Math.max(1, totalPages)}</span>
                <button id="nextPage_${viewType}" ${currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}>Next</button>
            </div>
        </div>
    `;

    // Setup event listeners with unique IDs
    document.getElementById(`itemsPerPageSelect_${viewType}`)?.addEventListener('change', (e) => {
        itemsPerPage = parseInt(e.target.value);
        currentPage = 1;

        // Re-render based on view type
        if (viewType === 'suppliers') {
            renderSuppliers();
        } else {
            const activeBtn = document.querySelector('.date-shortcut-btn.active');
            if (activeBtn) {
                activeBtn.click();
            } else {
                renderFilteredTable(totalFilteredExpenses);
            }
        }
    });

    document.getElementById(`prevPage_${viewType}`)?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            if (viewType === 'suppliers') {
                renderSuppliers();
            } else {
                // Always re-render the filtered table directly
                renderFilteredTable(totalFilteredExpenses);
            }
        }
    });

    document.getElementById(`nextPage_${viewType}`)?.addEventListener('click', (e) => {
        e.preventDefault();
        const totalPages = Math.ceil(totalFilteredExpenses.length / itemsPerPage);
        console.log(`Next page clicked. Current: ${currentPage}, Total: ${totalPages}`);
        if (currentPage < totalPages) {
            currentPage++;
            console.log(`Moving to page ${currentPage}`);
            if (viewType === 'suppliers') {
                renderSuppliers();
            } else {
                // Always re-render the filtered table directly
                renderFilteredTable(totalFilteredExpenses);
            }
        } else {
            console.log('Already on last page');
        }
    });
}

function refreshPagination(viewType = 'expenses') {
    const containerId = viewType === 'suppliers' ? 'suppliersPaginationControls' : 'expensesPaginationControls';
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(totalFilteredExpenses.length / itemsPerPage);
    const entityName = viewType === 'suppliers' ? 'suppliers' : 'expenses';

    // Update just the text content, not the entire HTML
    const paginationInfo = container.querySelector('.pagination-info');
    const pageIndicator = container.querySelector('.page-indicator');
    const prevBtn = container.querySelector(`#prevPage_${viewType}`);
    const nextBtn = container.querySelector(`#nextPage_${viewType}`);

    if (paginationInfo) {
        paginationInfo.textContent = `Showing ${Math.min((currentPage - 1) * itemsPerPage + 1, totalFilteredExpenses.length)}-${Math.min(currentPage * itemsPerPage, totalFilteredExpenses.length)} of ${totalFilteredExpenses.length} ${entityName}`;
    }

    if (pageIndicator) {
        pageIndicator.textContent = `Page ${currentPage} of ${Math.max(1, totalPages)}`;
    }

    if (prevBtn) {
        prevBtn.disabled = currentPage === 1;
    }

    if (nextBtn) {
        nextBtn.disabled = currentPage === totalPages || totalPages === 0;
    }
}

// CSV Export Functions
function exportExpensesToCSV() {
    // Get the currently filtered expenses
    let expensesToExport = [];
    
    if (dateRangeInput && dateRangeInput._flatpickr && dateRangeInput._flatpickr.selectedDates.length === 2) {
        // Export filtered expenses if date range is selected
        const [start, end] = dateRangeInput._flatpickr.selectedDates;
        const branchSelector = document.getElementById('branchSelector');
        const categorySelector = document.getElementById('categorySelector');
        
        const selectedBranch = branchSelector ? branchSelector.value : 'all';
        const selectedCategory = categorySelector ? categorySelector.value : 'all';
        
        const allExpenses = shared.getExpenses();
        expensesToExport = allExpenses.filter(expense => {
            if (!expense.date) return false;
            
            // Date filter
            const expenseDate = new Date(expense.date);
            const dateMatch = expenseDate >= start && expenseDate <= end;
            
            // Branch filter
            let branchMatch = true;
            if (selectedBranch !== 'all') {
                branchMatch = expense.branch === selectedBranch;
            }
            
            // Category filter
            let categoryMatch = true;
            if (selectedCategory !== 'all') {
                categoryMatch = (expense.expenseCategory || 'General') === selectedCategory;
            }
            
            return dateMatch && branchMatch && categoryMatch;
        });
    } else {
        // Export all expenses if no filters are applied
        expensesToExport = shared.getExpenses();
    }
    
    if (expensesToExport.length === 0) {
        shared.showToast('No expenses to export');
        return;
    }
    
    // Prepare data for CSV export
    const csvData = expensesToExport.map(expense => {
        const itemsText = expense.items ? expense.items.map(i => `${i.name} (${i.quantity}x ₱${i.price})`).join('; ') : 'No items';
        
        return {
            'Date': expense.date || '',
            'Supplier Name': expense.supplierName || '',
            'Business Name': expense.businessName || '',
            'TIN': expense.tin || '',
            'Address': expense.address || '',
            'Invoice Number': expense.invoiceNumber || '',
            'Items': itemsText,
            'Category': expense.expenseCategory || 'General',
            'Total Amount': expense.totalAmount || 0,
            'VAT Exempt Amount': expense.vatExemptAmount || 0,
            'VATable Sale': expense.vatableSale || 0,
            'VAT Amount': expense.vatAmount || 0,
            'VAT Registered': expense.isVatRegistered ? 'Yes' : 'No',
            'Branch': expense.branch || '',
            'Payment Method': expense.paymentMethod || '',
            'Paid By': expense.paidBy || '',
            'Notes': expense.notes || '',
            'Created At': expense.createdAt || '',
            'Updated At': expense.updatedAt || ''
        };
    });
    
    // Generate filename with current date and filter info
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    let filename = `matchanese-expenses-${dateStr}`;
    
    // Add filter info to filename if filters are applied
    const branchSelector = document.getElementById('branchSelector');
    const categorySelector = document.getElementById('categorySelector');
    
    if (branchSelector && branchSelector.value !== 'all') {
        filename += `-${branchSelector.value.replace(/\s+/g, '')}`;
    }
    
    if (categorySelector && categorySelector.value !== 'all') {
        filename += `-${categorySelector.value.replace(/\s+/g, '')}`;
    }
    
    if (dateRangeInput && dateRangeInput._flatpickr && dateRangeInput._flatpickr.selectedDates.length === 2) {
        const [start, end] = dateRangeInput._flatpickr.selectedDates;
        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];
        filename += `-${startStr}-to-${endStr}`;
    }
    
    filename += '.csv';
    
    // Export the data
    shared.exportToCSV(csvData, filename);
    shared.showToast(`Exported ${expensesToExport.length} expenses to ${filename}`);
}

// CSV Import Functions
function handleCSVImport(input) {
    const file = input.files[0];
    
    if (!file) {
        return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
        shared.showToast('Please select a CSV file');
        return;
    }

    showImportProgress();

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            parseAndImportCSV(e.target.result);
        } catch (error) {
            console.error('Import error:', error);
            shared.showToast('Error reading CSV file');
            hideImportProgress();
        }
    };
    reader.readAsText(file);
}

function parseAndImportCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
        shared.showToast('CSV file appears to be empty');
        hideImportProgress();
        return;
    }

    const headers = shared.parseCSVLine(lines[0]);

    const importedExpenses = [];
    let successCount = 0;
    let errorCount = 0;

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
        try {
            const values = shared.parseCSVLine(lines[i]);

            // Skip empty rows - check if all values are empty
            if (values.every(val => !val || val.trim() === '')) {
                console.log(`Skipping empty row ${i + 1}`);
                continue;
            }

            const expense = shared.parseExpenseFromCSV(headers, values);

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
        const originalExpenses = [...shared.getExpenses()];

        // Process all imported expenses
        const expensesToAdd = [];

        importedExpenses.forEach(newExpense => {
            // Only compare against ORIGINAL expenses, not newly imported ones
            const similarExpense = originalExpenses.find(existingExpense => {
                const newDate = newExpense.date;
                const newAmount = newExpense.totalAmount;
                const tolerance = newAmount * 0.05; // 5% tolerance

                // Check if dates match
                if (existingExpense.date !== newDate) return false;

                // Check if amounts are within tolerance
                const amountDiff = Math.abs(existingExpense.totalAmount - newAmount);
                return amountDiff <= tolerance;
            });

            if (similarExpense) {
                // Merge with existing expense
                const mergedExpense = shared.mergeExpenseData(similarExpense, newExpense);
                const index = originalExpenses.findIndex(e => e.id === similarExpense.id);
                if (index > -1) {
                    originalExpenses[index] = mergedExpense;
                }
                mergedCount++;
                console.log(`Merged expense: ${newExpense.supplierName} - ${newExpense.date}`);
            } else {
                // Add as new expense
                expensesToAdd.push(newExpense);
                newCount++;
                console.log(`New expense: ${newExpense.supplierName} - ${newExpense.date}`);
            }
        });

        // Update the expenses array
        shared.setExpenses([...originalExpenses, ...expensesToAdd]);

        // Extract and save new suppliers from all processed expenses
        importedExpenses.forEach(expense => shared.saveSupplierIfNew(expense));

        // Show detailed import results
        let message = `Import completed! `;
        if (newCount > 0) message += `${newCount} new expenses added`;
        if (mergedCount > 0) {
            if (newCount > 0) message += `, `;
            message += `${mergedCount} expenses merged with existing data`;
        }
        if (errorCount > 0) {
            message += `, ${errorCount} rows skipped due to errors`;
        }

        shared.showToast(message);
        
        // Refresh the admin interface
        const activeBtn = document.querySelector('.date-shortcut-btn.active');
        if (activeBtn) {
            activeBtn.click();
        } else {
            const expenses = shared.getExpenses();
            renderFilteredTable(expenses);
            updateFilteredSummary(expenses);
        }
    } else {
        shared.showToast('No valid expenses found in CSV file');
    }

    hideImportProgress();
}

function showImportProgress() {
    // Create progress indicator
    let progressDiv = document.getElementById('importProgress');
    if (!progressDiv) {
        progressDiv = document.createElement('div');
        progressDiv.id = 'importProgress';
        progressDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 3000;
            text-align: center;
            min-width: 300px;
        `;
        progressDiv.innerHTML = `
            <div style="margin-bottom: 10px;">Importing CSV...</div>
            <div id="importProgressText">Processing rows...</div>
            <div style="margin-top: 10px; width: 100%; height: 4px; background: #f0f0f0; border-radius: 2px;">
                <div id="importProgressBar" style="width: 0%; height: 100%; background: #007bff; border-radius: 2px; transition: width 0.3s ease;"></div>
            </div>
        `;
        document.body.appendChild(progressDiv);
    }
    progressDiv.style.display = 'block';
}

function updateImportProgress(current, total) {
    const progressText = document.getElementById('importProgressText');
    const progressBar = document.getElementById('importProgressBar');
    
    if (progressText && progressBar) {
        const percentage = Math.round((current / total) * 100);
        progressText.textContent = `Processing row ${current} of ${total} (${percentage}%)`;
        progressBar.style.width = `${percentage}%`;
    }
}

function hideImportProgress() {
    const progressDiv = document.getElementById('importProgress');
    if (progressDiv) {
        progressDiv.style.display = 'none';
    }
}

// Admin-specific modal action implementations
window.editExpenseFromDetail = function(expenseId) {
    // For admin, we'll open the mobile app in a new tab for editing
    // This could be enhanced to have an inline edit modal in the future
    const editUrl = `index.html?edit=${expenseId}`;
    window.open(editUrl, '_blank');
};

window.deleteExpenseFromDetail = function (expenseId) {
    showAdminConfirmation(
        'Delete expense',
        'Permanently delete this expense? This cannot be undone.',
        'Delete',
        async () => {
            const ok = await shared.deleteExpense(expenseId);
            if (ok) {
                shared.showToast('Expense deleted');
                closeAdminExpenseModal();
                refreshAdminTables();
            } else shared.showToast('Failed to delete expense');
        }
    );
};

window.viewSupplierFromExpense = function (supplierName) {
    const suppliersBtn = document.querySelector('.view-btn[data-table="suppliers"]');
    if (!suppliersBtn) return;
    suppliersBtn.click();
    setTimeout(() => window.viewSupplierDetails(supplierName), 80);
};

window.viewReceiptFullscreen = function(imageSrc) {
    // Create a fullscreen image viewer
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        cursor: pointer;
    `;
    
    const img = document.createElement('img');
    img.src = imageSrc;
    img.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
        border-radius: 8px;
    `;
    
    overlay.appendChild(img);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });
};

// Bulk edit functionality
window.showBulkEditModal = function () {
    if (getActiveDataTable() !== 'expenses') {
        shared.showToast('Open the Expenses tab to bulk edit');
        return;
    }
    const selectedExpenses = getSelectedExpenses();

    if (selectedExpenses.length === 0) {
        shared.showToast('Please select expenses to edit');
        return;
    }

    showBulkEditModalDialog(selectedExpenses);
};

function getSelectedExpenses() {
    const ids = Array.from(document.querySelectorAll('#expenseTableBody tr[data-expense-id]'))
        .filter((tr) => tr.querySelector('input[type="checkbox"]:checked'))
        .map((tr) => tr.dataset.expenseId)
        .filter(Boolean);
    return shared.getExpenses().filter((expense) => ids.includes(expense.id));
}

function getSelectedSupplierIds() {
    return Array.from(document.querySelectorAll('#supplierTableBody tr[data-supplier-id]'))
        .filter((tr) => tr.querySelector('input[type="checkbox"]:checked'))
        .map((tr) => tr.dataset.supplierId)
        .filter(Boolean);
}

window.showBulkDeleteModal = function () {
    const tab = getActiveDataTable();
    if (tab === 'expenses') {
        const selected = getSelectedExpenses();
        if (!selected.length) {
            shared.showToast('Select expenses to delete');
            return;
        }
        showAdminConfirmation(
            'Delete expenses',
            `Permanently delete ${selected.length} expense(s)? This cannot be undone.`,
            'Delete',
            async () => {
                for (const e of selected) {
                    await shared.deleteExpense(e.id);
                }
                shared.showToast(`Deleted ${selected.length} expense(s)`);
                refreshAdminTables();
            }
        );
    } else if (tab === 'suppliers') {
        const ids = getSelectedSupplierIds();
        if (!ids.length) {
            shared.showToast('Select suppliers to delete');
            return;
        }
        showAdminConfirmation(
            'Delete suppliers',
            `Permanently delete ${ids.length} supplier(s) and ALL linked expenses? This cannot be undone.`,
            'Delete',
            async () => {
                const r = await shared.deleteSuppliersBulk(ids, null, true);
                shared.showToast(`Removed ${r.deleted} supplier(s)`);
                refreshAdminTables();
            }
        );
    }
};

function ensureBulkMergeModalWired() {
    if (window._bulkMergeWired) return;
    window._bulkMergeWired = true;
    const closeBtn = document.getElementById('bulkMergeModalCloseBtn');
    const overlay = document.getElementById('bulkMergeModalOverlay');
    closeBtn?.addEventListener('click', () => closeBulkMergeModal());
    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) closeBulkMergeModal();
    });
}

window.closeBulkMergeModal = function () {
    const overlay = document.getElementById('bulkMergeModalOverlay');
    overlay?.classList.remove('show');
    document.body.style.overflow = '';
};

window.showBulkMergeModal = function () {
    const ids = getSelectedSupplierIds();
    if (ids.length < 2) {
        shared.showToast('Select at least two suppliers to merge');
        return;
    }
    const suppliers = ids
        .map((id) => shared.getSuppliers().find((s) => s.id === id))
        .filter(Boolean);
    if (suppliers.length < 2) {
        shared.showToast('Suppliers not found');
        return;
    }

    ensureBulkMergeModalWired();
    const content = document.getElementById('bulkMergeContent');
    if (!content) return;

    const lines = suppliers
        .map((s, i) => {
            const checked = i === 0 ? 'checked' : '';
            return `<label class="admin-bulk-merge-target"><input type="radio" name="adminMergeTarget" value="${escapeHtml(s.id)}" ${checked}> <strong>${escapeHtml(s.name)}</strong>${s.businessName ? ` — ${escapeHtml(s.businessName)}` : ''}</label>`;
        })
        .join('');
    content.innerHTML = `
        <p style="margin-bottom:1rem;color:#555;">Expenses from merged suppliers will point at the target. Other selected supplier rows will be removed.</p>
        <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1.25rem;">${lines}</div>
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
            <button type="button" class="action-btn secondary" onclick="closeBulkMergeModal()">Cancel</button>
            <button type="button" class="action-btn primary" onclick="executeAdminBulkMerge()">Merge</button>
        </div>
    `;
    document.getElementById('bulkMergeModalOverlay')?.classList.add('show');
    document.body.style.overflow = 'hidden';
};

window.executeAdminBulkMerge = async function () {
    const ids = getSelectedSupplierIds();
    const selected = document.querySelector('input[name="adminMergeTarget"]:checked');
    const targetId = selected?.value;
    if (!targetId || ids.length < 2) {
        shared.showToast('Select a merge target');
        return;
    }
    const sourceIds = ids.filter((id) => id !== targetId);
    if (!sourceIds.length) {
        shared.showToast('Choose a target different from merged suppliers');
        return;
    }

    showAdminConfirmation(
        'Confirm merge',
        `Merge ${sourceIds.length} supplier(s) into the target? This cannot be undone.`,
        'Merge',
        async () => {
            closeBulkMergeModal();
            const r = await shared.mergeSuppliersIntoTarget(targetId, sourceIds);
            if (r.success) {
                shared.showToast(`Merged suppliers; ${r.transferred} expense row(s) updated`);
            } else {
                shared.showToast(r.error || 'Merge failed');
            }
            refreshAdminTables();
        }
    );
};

function showBulkEditModalDialog(expenses) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'bulk-edit-modal-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    `;
    
    // Create modal content
    const modal = document.createElement('div');
    modal.className = 'bulk-edit-modal';
    modal.style.cssText = `
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        max-height: 90vh;
        overflow: hidden;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
    `;
    
    modal.innerHTML = `
        <div class="modal-header" style="padding: 1.5rem; border-bottom: 1px solid #e5e5e5; background: #f8f9fa;">
            <h2 style="margin: 0; font-size: 1.25rem; font-weight: 600;">Bulk Edit Expenses</h2>
            <button onclick="closeBulkEditModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #666;">&times;</button>
        </div>
        <div class="modal-content" style="padding: 1.5rem;">
            <p style="margin-bottom: 1.5rem; color: #666;">Editing <strong>${expenses.length}</strong> selected expenses</p>
            
            <div class="form-group" style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Branch</label>
                <select id="bulkEditBranch" style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
                    <option value="">-- Keep current --</option>
                    <option value="SM North">SM North</option>
                    <option value="Podium">Podium</option>
                    <option value="BGC">BGC</option>
                    <option value="Makati">Makati</option>
                    <option value="Uncategorized">Uncategorized</option>
                </select>
            </div>
            
            <div class="form-group" style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Payment Method</label>
                <select id="bulkEditPayment" style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
                    <option value="">-- Keep current --</option>
                    <option value="Cash">Cash</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="GCash">GCash</option>
                    <option value="GrabPay">GrabPay</option>
                    <option value="Debit Card">Debit Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                </select>
            </div>
            
            <div class="form-group" style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Paid By</label>
                <input type="text" id="bulkEditPaidBy" placeholder="Leave empty to keep current" style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
            </div>
            
            <div class="form-group" style="margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Add Note</label>
                <input type="text" id="bulkEditNote" placeholder="Optional note to add to all expenses" style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
            </div>
            
            <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                <button onclick="closeBulkEditModal()" style="padding: 0.75rem 1.5rem; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer;">Cancel</button>
                <button onclick="applyBulkEdit()" style="padding: 0.75rem 1.5rem; border: none; background: #2b9348; color: white; border-radius: 6px; cursor: pointer;">Apply Changes</button>
            </div>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Store selected expenses for later use
    window.currentBulkEditExpenses = expenses;
}

window.closeBulkEditModal = function() {
    const overlay = document.querySelector('.bulk-edit-modal-overlay');
    if (overlay) {
        document.body.removeChild(overlay);
    }
    delete window.currentBulkEditExpenses;
};

window.applyBulkEdit = function() {
    const expenses = window.currentBulkEditExpenses;
    if (!expenses || expenses.length === 0) return;
    
    const branch = document.getElementById('bulkEditBranch').value;
    const payment = document.getElementById('bulkEditPayment').value;
    const paidBy = document.getElementById('bulkEditPaidBy').value;
    const note = document.getElementById('bulkEditNote').value;
    
    let updatedCount = 0;
    
    expenses.forEach(expense => {
        const updates = { ...expense };
        
        if (branch) updates.branch = branch;
        if (payment) updates.paymentMethod = payment;
        if (paidBy) updates.paidBy = paidBy;
        if (note) {
            updates.notes = updates.notes ? `${updates.notes} | ${note}` : note;
        }
        
        const success = shared.updateExpense(expense.id, updates);
        if (success) updatedCount++;
    });
    
    shared.showToast(`Successfully updated ${updatedCount} expenses`);
    closeBulkEditModal();

    const activeBtn = document.querySelector('.date-shortcut-btn.active');
    if (activeBtn) {
        activeBtn.click();
    } else {
        const expenses = shared.getExpenses();
        renderFilteredTable(expenses);
        updateFilteredSummary(expenses);
    }
    updateBulkActionBar();
};

// Select all functionality - only selects items on current page
window.toggleSelectAll = function () {
    const selectAllCheckbox = document.getElementById('selectAllExpenses');
    const checkboxes = document.querySelectorAll('#expenseTableBody input[type="checkbox"]');

    if (!selectAllCheckbox) {
        console.error('Select all checkbox not found');
        return;
    }

    checkboxes.forEach((checkbox) => {
        if (checkbox) checkbox.checked = selectAllCheckbox.checked;
    });

    updateBulkActionBar();
};

// Shift+click selection functionality
let lastSelectedCheckbox = null;

window.handleCheckboxClick = function (event) {
    const tbody = event.target.closest('#expenseTableBody, #supplierTableBody');
    if (
        event.shiftKey &&
        lastSelectedCheckbox &&
        lastSelectedCheckbox !== event.target &&
        tbody
    ) {
        const allCheckboxes = Array.from(tbody.querySelectorAll('input[type="checkbox"]'));
        const currentIndex = allCheckboxes.indexOf(event.target);
        const lastIndex = allCheckboxes.indexOf(lastSelectedCheckbox);
        const startIndex = Math.min(currentIndex, lastIndex);
        const endIndex = Math.max(currentIndex, lastIndex);
        for (let i = startIndex; i <= endIndex; i++) {
            allCheckboxes[i].checked = true;
        }
        updateBulkActionBar();
    } else {
        lastSelectedCheckbox = event.target;
    }
};

function setBulkButtonLabel(btn, svgMarkup, text) {
    if (!btn) return;
    btn.innerHTML = svgMarkup;
    btn.appendChild(document.createTextNode(text));
}

const bulkEditSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg>`;
const bulkMergeSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`;
const bulkDelSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"></polyline><path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

window.updateBulkActionBar = function () {
    const tab = getActiveDataTable();
    const bulkEditBtn = document.getElementById('bulkEditBtn');
    const bulkMergeBtn = document.getElementById('bulkMergeBtn');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

    if (tab === 'analytics') {
        if (bulkEditBtn) bulkEditBtn.style.display = 'none';
        if (bulkMergeBtn) bulkMergeBtn.style.display = 'none';
        if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';
        return;
    }

    if (tab === 'expenses') {
        if (bulkMergeBtn) bulkMergeBtn.style.display = 'none';
        const n = document.querySelectorAll('#expenseTableBody input[type="checkbox"]:checked').length;
        if (bulkEditBtn) {
            if (n > 0) {
                bulkEditBtn.style.display = 'inline-flex';
                const label = n === 1 ? 'Edit' : `Edit ${n} entries`;
                setBulkButtonLabel(bulkEditBtn, bulkEditSvg, label);
            } else bulkEditBtn.style.display = 'none';
        }
        if (bulkDeleteBtn) {
            if (n > 0) {
                bulkDeleteBtn.style.display = 'inline-flex';
                setBulkButtonLabel(bulkDeleteBtn, bulkDelSvg, n === 1 ? 'Delete' : `Delete ${n}`);
            } else bulkDeleteBtn.style.display = 'none';
        }
    } else if (tab === 'suppliers') {
        if (bulkEditBtn) bulkEditBtn.style.display = 'none';
        const n = document.querySelectorAll('#supplierTableBody input[type="checkbox"]:checked').length;
        if (bulkMergeBtn) {
            if (n >= 2) {
                bulkMergeBtn.style.display = 'inline-flex';
                setBulkButtonLabel(bulkMergeBtn, bulkMergeSvg, 'Merge');
            } else bulkMergeBtn.style.display = 'none';
        }
        if (bulkDeleteBtn) {
            if (n > 0) {
                bulkDeleteBtn.style.display = 'inline-flex';
                setBulkButtonLabel(bulkDeleteBtn, bulkDelSvg, n === 1 ? 'Delete' : `Delete ${n}`);
            } else bulkDeleteBtn.style.display = 'none';
        }
    }
};

/** @deprecated use updateBulkActionBar */
window.updateBulkEditButton = window.updateBulkActionBar;

// View supplier details function
window.viewSupplierDetails = function (supplierName) {
    closeAdminSupplierModal();
    const supplier = shared
        .getSuppliers()
        .find((s) => (s.name || '').toLowerCase() === (supplierName || '').toLowerCase());
    if (!supplier) {
        shared.showToast('Supplier not found');
        return;
    }

    const pageSize = 12;
    let sortCol = 'date';
    let sortDir = 'desc';
    let page = 1;

    function collectExpenses() {
        const nm = (supplier.name || '').toLowerCase();
        let list = shared.getExpenses().filter((e) => (e.supplierName || '').toLowerCase() === nm);
        list.sort((a, b) => {
            let av;
            let bv;
            if (sortCol === 'amount') {
                av = a.totalAmount || 0;
                bv = b.totalAmount || 0;
            } else {
                av = a.date || '';
                bv = b.date || '';
            }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return list;
    }

    function renderExpenseRows() {
        const list = collectExpenses();
        const total = list.length;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        if (page > pages) page = pages;
        const start = (page - 1) * pageSize;
        const slice = list.slice(start, start + pageSize);
        const tbody = document.getElementById('adminSupplierExpenseTbody');
        const pagerEl = document.getElementById('adminSupplierExpensePager');
        if (!tbody) return;
        tbody.innerHTML = slice
            .map(
                (e) => `
            <tr class="admin-supplier-exp-row" data-expense-id="${String(e.id).replace(/"/g, '')}">
                <td>${escapeHtml(e.date || '')}</td>
                <td>${escapeHtml(e.expenseCategory || 'General')}</td>
                <td style="text-align:right">₱${(e.totalAmount || 0).toLocaleString()}</td>
                <td>${escapeHtml(e.branch || '')}</td>
                <td>${escapeHtml((e.invoiceNumber || '').slice(0, 24))}</td>
            </tr>`
            )
            .join('');
        tbody.querySelectorAll('.admin-supplier-exp-row').forEach((tr) => {
            tr.addEventListener('click', () => {
                const id = tr.getAttribute('data-expense-id');
                closeAdminSupplierModal();
                window.viewExpense(id);
            });
        });
        if (pagerEl) {
            pagerEl.textContent = `Page ${page} / ${pages} · ${total} expense(s)`;
        }
    }

    const modal = document.createElement('div');
    modal.className = 'admin-supplier-modal-overlay';
    adminSupplierModalEl = modal;

    const supplierExpenses = collectExpenses();
    const totalAmount = supplierExpenses.reduce((sum, e) => sum + (e.totalAmount || 0), 0);

    modal.innerHTML = `
        <div class="admin-supplier-modal-shell">
            <div class="admin-supplier-modal-header">
                <h2>Supplier</h2>
                <button type="button" class="admin-modal-icon-btn" aria-label="Close">&times;</button>
            </div>
            <div class="admin-supplier-modal-body">
                <div class="admin-supplier-summary">
                    <p><strong>${escapeHtml(supplier.name)}</strong></p>
                    ${supplier.businessName ? `<p class="muted">${escapeHtml(supplier.businessName)}</p>` : ''}
                    ${supplier.tin ? `<p class="muted">TIN ${escapeHtml(supplier.tin)}</p>` : ''}
                    ${supplier.address ? `<p class="muted">${escapeHtml(supplier.address)}</p>` : ''}
                    <p>${supplier.isVatRegistered ? 'VAT Registered' : 'Not VAT Registered'}</p>
                    <p><strong>₱${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> · ${supplierExpenses.length} transactions</p>
                </div>
                <h3 class="admin-supplier-exp-heading">Expenses</h3>
                <div class="admin-supplier-exp-toolbar">
                    <button type="button" class="action-btn secondary admin-sort-date">Sort: date</button>
                    <button type="button" class="action-btn secondary admin-sort-amt">Sort: amount</button>
                    <button type="button" class="action-btn secondary admin-page-prev">Prev</button>
                    <button type="button" class="action-btn secondary admin-page-next">Next</button>
                </div>
                <p id="adminSupplierExpensePager" class="admin-supplier-pager"></p>
                <div class="admin-supplier-table-wrap">
                    <table class="data-table admin-supplier-exp-table">
                        <thead><tr><th>Date</th><th>Category</th><th style="text-align:right">Amount</th><th>Branch</th><th>Invoice</th></tr></thead>
                        <tbody id="adminSupplierExpenseTbody"></tbody>
                    </table>
                </div>
            </div>
        </div>`;

    modal.querySelector('.admin-modal-icon-btn')?.addEventListener('click', closeAdminSupplierModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAdminSupplierModal();
    });

    modal.querySelector('.admin-sort-date')?.addEventListener('click', () => {
        if (sortCol === 'date') sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else {
            sortCol = 'date';
            sortDir = 'desc';
        }
        page = 1;
        renderExpenseRows();
    });
    modal.querySelector('.admin-sort-amt')?.addEventListener('click', () => {
        if (sortCol === 'amount') sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else {
            sortCol = 'amount';
            sortDir = 'desc';
        }
        page = 1;
        renderExpenseRows();
    });
    modal.querySelector('.admin-page-prev')?.addEventListener('click', () => {
        if (page > 1) {
            page--;
            renderExpenseRows();
        }
    });
    modal.querySelector('.admin-page-next')?.addEventListener('click', () => {
        const list = collectExpenses();
        const pages = Math.max(1, Math.ceil(list.length / pageSize));
        if (page < pages) {
            page++;
            renderExpenseRows();
        }
    });

    document.body.appendChild(modal);
    renderExpenseRows();
};

// View expense details function with inline editing
window.viewExpense = function(expenseId) {
    const expense = shared.getExpenses().find(e => e.id === expenseId);
    if (!expense) {
        shared.showToast('Expense not found');
        return;
    }

    showExpenseModal(expense, false);
};

// Add new expense function
window.addExpense = function() {
    const newExpense = {
        id: shared.generateId(),
        date: new Date().toISOString().split('T')[0],
        branch: 'SM North',
        supplierName: '',
        businessName: '',
        tin: '',
        address: '',
        invoiceNumber: '',
        items: [{ name: '', quantity: 1, price: 0, total: 0 }],
        totalAmount: 0,
        vatExemptAmount: 0,
        vatableSale: 0,
        vatAmount: 0,
        isVatRegistered: false,
        paymentMethod: 'Cash',
        paidBy: '',
        notes: '',
        receiptImage: null,
        createdAt: new Date().toISOString()
    };
    
    showExpenseModal(newExpense, true);
};

window.adminUnlockSupplierFields = function () {
    document.querySelectorAll('.admin-supplier-field').forEach((el) => {
        el.readOnly = false;
    });
    document.getElementById('adminSupplierLockBanner')?.remove();
};

function adminApplySupplierRecord(supplier) {
    const sn = document.getElementById('adminSupplierName');
    const bn = document.getElementById('adminBusinessName');
    const tin = document.getElementById('adminTin');
    const ad = document.getElementById('adminAddress');
    if (sn) sn.value = supplier.name || '';
    if (bn) bn.value = supplier.businessName || '';
    if (tin) tin.value = supplier.tin || '';
    if (ad) ad.value = supplier.address || '';
}

function wireAdminItemAutocomplete(inputEl, modalBody) {
    createAutocomplete(
        inputEl,
        (q) => {
            const sn = document.getElementById('adminSupplierName');
            return getItemMatches(() => shared.getExpenses(), q, sn?.value || '');
        },
        (name, input) => {
            input.value = name;
        },
        { showOnFocus: true, modalBodyEl: modalBody, useFixedItemDropdown: true }
    );
}

function wireAdminExpenseAutocompletes(modalBody) {
    const sn = document.getElementById('adminSupplierName');
    if (sn) {
        createAutocomplete(
            sn,
            (q) => buildSupplierMatchList(() => shared.getSuppliers(), q),
            (supplierId) => {
                const supplier = shared.getSuppliers().find((s) => s.id === supplierId);
                if (supplier) adminApplySupplierRecord(supplier);
            },
            { showOnFocus: true, modalBodyEl: modalBody }
        );
    }
    const paid = document.getElementById('adminPaidBy');
    if (paid) {
        createAutocomplete(
            paid,
            (q) => getPaidByMatches(() => shared.getExpenses(), q),
            (name, input) => {
                input.value = name;
            },
            { showOnFocus: true, modalBodyEl: modalBody }
        );
    }
    modalBody.querySelectorAll('.admin-item-name-input').forEach((inp) => {
        wireAdminItemAutocomplete(inp, modalBody);
    });
}

function initAdminReceiptPanel(expense, isEditing, expenseId) {
    const mount = document.getElementById('adminReceiptPanelMount');
    if (!mount) return;

    if (!isEditing) {
        if (expense.receiptImage) {
            const u = JSON.stringify(expense.receiptImage);
            mount.innerHTML = `<div class="admin-receipt-frame"><img src="${expense.receiptImage}" alt="Receipt" class="admin-receipt-preview-full"/><p><button type="button" class="action-btn secondary" onclick="viewReceiptFullscreen(${u})">Fullscreen</button></p></div>`;
        } else if (expense.hasReceiptImage) {
            mount.innerHTML = '<p class="muted">Loading receipt…</p>';
            shared.fetchReceiptImageFromFirebase(expenseId).then((url) => {
                if (!url) mount.innerHTML = '<p class="muted">No receipt found</p>';
                else {
                    const u = JSON.stringify(url);
                    mount.innerHTML = `<div class="admin-receipt-frame"><img src="${url}" alt="Receipt" class="admin-receipt-preview-full"/><p><button type="button" class="action-btn secondary" onclick="viewReceiptFullscreen(${u})">Fullscreen</button></p></div>`;
                }
            });
        } else {
            mount.innerHTML = '<p class="muted">No receipt attached</p>';
        }
        return;
    }

    mount.innerHTML = `
        <div class="admin-receipt-upload" id="adminReceiptDrop">
            <input type="file" id="adminReceiptInput" accept="image/*" style="display:none" />
            <div class="admin-receipt-upload-content">Click to upload or replace receipt</div>
            <img id="adminReceiptPreview" class="admin-receipt-preview" style="display:none" alt="" />
        </div>
        <button type="button" class="action-btn secondary" id="adminRemoveReceiptBtn" style="display:none;margin-top:0.5rem">Remove receipt</button>`;

    const input = document.getElementById('adminReceiptInput');
    const drop = document.getElementById('adminReceiptDrop');
    const preview = document.getElementById('adminReceiptPreview');
    const rm = document.getElementById('adminRemoveReceiptBtn');

    const showPreview = (src) => {
        if (!src) return;
        adminPendingReceiptUrl = src;
        window.adminReceiptRemove = false;
        preview.src = src;
        preview.style.display = 'block';
        drop.classList.add('has-file');
        rm.style.display = 'inline-flex';
    };

    if (expense.receiptImage) showPreview(expense.receiptImage);

    drop.addEventListener('click', () => input?.click());
    input?.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
            const dataUrl = await shared.compressImage(f);
            const url = await shared.uploadReceiptImageToStorage(expenseId, dataUrl);
            showPreview(url || dataUrl);
        } catch (err) {
            console.warn(err);
            shared.showToast('Receipt upload failed');
        }
    });
    rm?.addEventListener('click', () => {
        preview.style.display = 'none';
        adminPendingReceiptUrl = null;
        window.adminReceiptRemove = true;
        rm.style.display = 'none';
        drop.classList.remove('has-file');
        if (input) input.value = '';
    });
}

// Unified expense modal for both viewing and editing
function showExpenseModal(expense, isNew = false) {
    closeAdminExpenseModal();
    adminPendingReceiptUrl = expense.receiptImage || null;
    window.adminReceiptRemove = false;

    const isEditing = isNew;
    const modalTitle = isNew ? 'Add New Expense' : 'Expense Details';

    const shell = document.createElement('div');
    shell.className = 'admin-expense-modal-overlay';
    adminExpenseModalEl = shell;

    shell.innerHTML = `
        <div class="admin-expense-modal-shell">
            <div class="admin-expense-modal-main">
                <div class="admin-expense-modal-header">
                    <h2 class="admin-expense-modal-title">${escapeHtml(modalTitle)}</h2>
                    <div class="admin-expense-modal-actions">
                        ${
                            !isNew
                                ? `<button type="button" class="admin-modal-icon-btn admin-edit-exp" title="Edit" data-expense-id="${escapeHtml(expense.id)}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg>
                        </button>
                        <button type="button" class="admin-modal-icon-btn danger" title="Delete" data-del="${escapeHtml(expense.id)}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"></polyline><path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path></svg>
                        </button>`
                                : ''
                        }
                        <button type="button" class="admin-modal-icon-btn" data-close-exp-modal aria-label="Close">&times;</button>
                    </div>
                </div>
                <div class="admin-expense-modal-body">
                    ${generateExpenseForm(expense, isEditing)}
                </div>
            </div>
            <div class="admin-expense-modal-receipt">
                <h3 class="admin-receipt-heading">Receipt</h3>
                <div id="adminReceiptPanelMount" class="admin-receipt-panel-inner"></div>
            </div>
        </div>`;

    document.body.appendChild(shell);

    shell.querySelector('[data-close-exp-modal]')?.addEventListener('click', closeAdminExpenseModal);
    shell.addEventListener('click', (e) => {
        if (e.target === shell) closeAdminExpenseModal();
    });
    shell.querySelector('.admin-edit-exp')?.addEventListener('click', () => {
        toggleEditMode(expense.id);
    });
    shell.querySelector('[data-del]')?.addEventListener('click', () => {
        deleteExpenseFromDetail(expense.id);
    });

    const modalBody = shell.querySelector('.admin-expense-modal-body');
    initAdminReceiptPanel(expense, isEditing, expense.id);
    if (isEditing && modalBody) {
        wireAdminExpenseAutocompletes(modalBody);
    }
}

// Generate the expense form content
function generateExpenseForm(expense, isEditing) {
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toISOString().split('T')[0];
    };

    const matchedSupplier = shared.getSuppliers().find(
        (s) => (s.name || '').toLowerCase() === (expense.supplierName || '').toLowerCase()
    );
    const supplierLocked = Boolean(isEditing && matchedSupplier);
    const supRead = !isEditing || supplierLocked;
    const supRoAttr = supRead ? 'readonly' : '';
    const supClass = supplierLocked ? 'class="admin-supplier-field"' : '';

    const supplierProfileBtn =
        !isEditing && matchedSupplier
            ? `<p class="admin-inline-link"><button type="button" class="admin-text-btn" onclick="viewSupplierFromExpense(${JSON.stringify(matchedSupplier.name)})">Open supplier profile</button></p>`
            : '';

    const supplierLockBanner = isEditing && supplierLocked
        ? `<div id="adminSupplierLockBanner" class="admin-banner-soft">Matched saved supplier. <button type="button" class="admin-text-btn" onclick="adminUnlockSupplierFields()">Change supplier</button></div>`
        : '';

    return `
        <form id="expenseForm" onsubmit="saveExpense(event, '${expense.id}')">
            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Basic Information</h3>
                <div class="admin-field">
                    <label>Date</label>
                    <input type="date" name="date" value="${formatDate(expense.date)}" required ${!isEditing ? 'readonly' : ''}>
                </div>
                <div class="admin-field">
                    <label>Branch</label>
                    <select name="branch" required ${!isEditing ? 'disabled' : ''} style="${!isEditing ? 'background:#f8f9fa' : ''}">
                        <option value="SM North" ${expense.branch === 'SM North' ? 'selected' : ''}>SM North</option>
                        <option value="Podium" ${expense.branch === 'Podium' ? 'selected' : ''}>Podium</option>
                        <option value="BGC" ${expense.branch === 'BGC' ? 'selected' : ''}>BGC</option>
                        <option value="Makati" ${expense.branch === 'Makati' ? 'selected' : ''}>Makati</option>
                    </select>
                </div>
                <div class="admin-field">
                    <label>Expense Category</label>
                    <select name="expenseCategory" required ${!isEditing ? 'disabled' : ''} style="${!isEditing ? 'background:#f8f9fa' : ''}">
                        <option value="General" ${(expense.expenseCategory || 'General') === 'General' ? 'selected' : ''}>General</option>
                        <option value="Matcha" ${(expense.expenseCategory || 'General') === 'Matcha' ? 'selected' : ''}>Matcha</option>
                        <option value="Suppliers" ${(expense.expenseCategory || 'General') === 'Suppliers' ? 'selected' : ''}>Suppliers</option>
                        <option value="Leasing" ${(expense.expenseCategory || 'General') === 'Leasing' ? 'selected' : ''}>Leasing</option>
                        <option value="Salaries" ${(expense.expenseCategory || 'General') === 'Salaries' ? 'selected' : ''}>Salaries</option>
                        <option value="Marketing" ${(expense.expenseCategory || 'General') === 'Marketing' ? 'selected' : ''}>Marketing</option>
                        <option value="Maintenance" ${(expense.expenseCategory || 'General') === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
                        <option value="Equipment" ${(expense.expenseCategory || 'General') === 'Equipment' ? 'selected' : ''}>Equipment</option>
                    </select>
                </div>
                <div class="admin-field">
                    <label>Payment Method</label>
                    <select name="paymentMethod" required ${!isEditing ? 'disabled' : ''} style="${!isEditing ? 'background:#f8f9fa' : ''}">
                        <option value="Cash" ${expense.paymentMethod === 'Cash' ? 'selected' : ''}>Cash</option>
                        <option value="GCash" ${expense.paymentMethod === 'GCash' ? 'selected' : ''}>GCash</option>
                        <option value="Credit Card" ${expense.paymentMethod === 'Credit Card' ? 'selected' : ''}>Credit Card</option>
                        <option value="Debit Card" ${expense.paymentMethod === 'Debit Card' ? 'selected' : ''}>Debit Card</option>
                        <option value="Bank Transfer" ${expense.paymentMethod === 'Bank Transfer' ? 'selected' : ''}>Bank Transfer</option>
                    </select>
                </div>
                <div class="admin-field">
                    <label>Paid By</label>
                    <input type="text" id="adminPaidBy" name="paidBy" value="${escapeHtml(expense.paidBy || '')}" placeholder="Person who paid" ${!isEditing ? 'readonly' : ''}>
                </div>
                <div class="admin-field">
                    <label>Invoice Number</label>
                    <input type="text" name="invoiceNumber" value="${escapeHtml(expense.invoiceNumber || '')}" placeholder="Invoice/reference" ${!isEditing ? 'readonly' : ''}>
                </div>
            </div>

            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Supplier Information</h3>
                ${supplierLockBanner}
                ${supplierProfileBtn}
                <div class="admin-field">
                    <label>Supplier Name *</label>
                    <input type="text" id="adminSupplierName" name="supplierName" value="${escapeHtml(expense.supplierName || '')}" required placeholder="Supplier name" ${supRoAttr} ${supClass}>
                </div>
                <div class="admin-field">
                    <label>Business Name</label>
                    <input type="text" id="adminBusinessName" name="businessName" value="${escapeHtml(expense.businessName || '')}" placeholder="Business name" ${supRoAttr} ${supClass}>
                </div>
                <div class="admin-field">
                    <label>TIN</label>
                    <input type="text" id="adminTin" name="tin" value="${escapeHtml(expense.tin || '')}" placeholder="TIN" ${supRoAttr} ${supClass}>
                </div>
                <div class="admin-field">
                    <label>Address</label>
                    <textarea id="adminAddress" name="address" placeholder="Address" ${supRoAttr} ${supClass}>${escapeHtml(expense.address || '')}</textarea>
                </div>
            </div>

            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Items Purchased</h3>
                <div id="itemsContainer">
                    ${expense.items
                        .map(
                            (item, index) => `
                        <div class="item-row admin-item-row">
                            <div style="flex:2">
                                <label class="admin-mini-label">Item</label>
                                <input type="text" class="admin-item-name-input" name="itemName_${index}" value="${escapeHtml(item.name)}" placeholder="Item name" required ${!isEditing ? 'readonly' : ''}>
                            </div>
                            <div style="flex:1">
                                <label class="admin-mini-label">Qty</label>
                                <input type="number" name="itemQty_${index}" value="${item.quantity}" min="1" step="1" ${!isEditing ? 'readonly' : ''}>
                            </div>
                            <div style="flex:1">
                                <label class="admin-mini-label">Price</label>
                                <input type="number" name="itemPrice_${index}" value="${item.price}" min="0" step="0.01" ${!isEditing ? 'readonly' : ''}>
                            </div>
                            <div style="flex:1">
                                <label class="admin-mini-label">Total</label>
                                <input type="number" name="itemTotal_${index}" value="${item.total}" min="0" step="0.01" ${!isEditing ? 'readonly' : ''}>
                            </div>
                            ${isEditing ? '<button type="button" class="admin-item-remove" onclick="removeItem(this)">×</button>' : ''}
                        </div>`
                        )
                        .join('')}
                </div>
                ${isEditing ? '<button type="button" class="action-btn secondary admin-add-item" onclick="addItem()">+ Add Item</button>' : ''}
                <div class="admin-total-pill">
                    <span>Total Amount</span>
                    <strong>₱${(expense.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
            </div>

            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Notes</h3>
                <textarea name="notes" placeholder="Notes" ${!isEditing ? 'readonly' : ''}>${escapeHtml(expense.notes || '')}</textarea>
            </div>

            ${
                isEditing
                    ? `<div class="admin-form-actions">
                <button type="button" class="action-btn secondary" onclick="closeAdminExpenseModal()">Cancel</button>
                <button type="submit" class="action-btn primary">Save Expense</button>
            </div>`
                    : ''
            }
        </form>`;
}

// Toggle edit mode
window.toggleEditMode = function (expenseId) {
    const expense = shared.getExpenses().find((e) => e.id === expenseId);
    if (!expense) {
        shared.showToast('Expense not found');
        return;
    }
    closeAdminExpenseModal();
    showExpenseModal(expense, true);
};

// Add item function
window.addItem = function () {
    const container = document.getElementById('itemsContainer');
    if (!container) return;
    const itemCount = container.children.length;

    const itemRow = document.createElement('div');
    itemRow.className = 'item-row admin-item-row';
    itemRow.innerHTML = `
        <div style="flex:2">
            <label class="admin-mini-label">Item</label>
            <input type="text" class="admin-item-name-input" name="itemName_${itemCount}" placeholder="Item name" required>
        </div>
        <div style="flex:1">
            <label class="admin-mini-label">Qty</label>
            <input type="number" name="itemQty_${itemCount}" value="1" min="1" step="1">
        </div>
        <div style="flex:1">
            <label class="admin-mini-label">Price</label>
            <input type="number" name="itemPrice_${itemCount}" value="0" min="0" step="0.01">
        </div>
        <div style="flex:1">
            <label class="admin-mini-label">Total</label>
            <input type="number" name="itemTotal_${itemCount}" value="0" min="0" step="0.01">
        </div>
        <button type="button" class="admin-item-remove" onclick="removeItem(this)">×</button>`;

    container.appendChild(itemRow);
    const modalBody = document.querySelector('.admin-expense-modal-body');
    const nameInp = itemRow.querySelector('.admin-item-name-input');
    if (modalBody && nameInp) wireAdminItemAutocomplete(nameInp, modalBody);
};

// Remove item function
window.removeItem = function(button) {
    button.closest('.item-row').remove();
};

// Save expense function
window.saveExpense = function(event, expenseId) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const existingExpense = shared.getExpenses().find(e => e.id === expenseId) || null;
    const isNew = !existingExpense;
    
    // Collect items
    const items = [];
    const itemRows = document.querySelectorAll('.item-row');

    // Use DOM queries instead of relying on positional index suffixes.
    itemRows.forEach((row) => {
        const nameInput = row.querySelector('input[name^="itemName_"]');
        const qtyInput = row.querySelector('input[name^="itemQty_"]');
        const priceInput = row.querySelector('input[name^="itemPrice_"]');
        const totalInput = row.querySelector('input[name^="itemTotal_"]');

        const name = (nameInput?.value || '').trim();
        const qty = parseFloat(qtyInput?.value) || 1;
        const price = parseFloat(priceInput?.value) || 0;
        const total = parseFloat(totalInput?.value) || 0;

        if (name) {
            items.push({
                name,
                quantity: qty,
                price,
                total
            });
        }
    });
    
    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => sum + item.total, 0);
    
    const expenseData = {
        ...(existingExpense || {
            allocation: 'Store',
            vatExemptAmount: 0,
            vatableSale: 0,
            vatAmount: 0,
            isVatRegistered: false,
            vatComputationEnabled: false,
            receiptImage: null
        }),
        id: expenseId,
        date: formData.get('date'),
        branch: formData.get('branch'),
        supplierName: formData.get('supplierName'),
        businessName: formData.get('businessName'),
        tin: formData.get('tin'),
        address: formData.get('address'),
        invoiceNumber: formData.get('invoiceNumber'),
        expenseCategory: formData.get('expenseCategory') || existingExpense?.expenseCategory || 'General',
        items: items,
        totalAmount: totalAmount,
        paymentMethod: formData.get('paymentMethod'),
        paidBy: formData.get('paidBy'),
        notes: formData.get('notes'),
        receiptImage: (() => {
            if (window.adminReceiptRemove) return null;
            if (adminPendingReceiptUrl) return adminPendingReceiptUrl;
            return existingExpense?.receiptImage || null;
        })(),
        createdAt: isNew ? new Date().toISOString() : existingExpense?.createdAt,
        updatedAt: new Date().toISOString(),
    };

    if (isNew) {
        shared.addExpense(expenseData);
        shared.showToast('Expense added successfully');
    } else {
        shared.updateExpense(expenseId, expenseData);
        shared.showToast('Expense updated successfully');
    }

    closeAdminExpenseModal();
    refreshAdminTables();
};

// Make shared functions available globally for the modal
window.shared = shared;
window.closeExpenseDetailModal = function () {
    closeAdminExpenseModal();
};

// Debug function availability
console.log('Function availability check:');
console.log('window.viewExpense:', typeof window.viewExpense);
console.log('window.closeExpenseDetailModal:', typeof window.closeExpenseDetailModal);
console.log('shared.viewExpense:', typeof shared.viewExpense);

// Export for debugging
window.getExpenses = shared.getExpenses;
window.getSuppliers = shared.getSuppliers;
window.loadData = loadData;
window.initialize = initialize;
window.debugDates = shared.debugDates;
window.exportExpensesToCSV = exportExpensesToCSV;

