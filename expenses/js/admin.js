import * as shared from './shared.js';


// Pagination state
let currentPage = 1;
let itemsPerPage = 25;
let totalFilteredExpenses = [];

// View state
let dateRangeInput = null;

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

    sortedExpenses.slice(0, 500).forEach(expense => {
        const row = document.createElement('tr');

        const itemsText = expense.items ? expense.items.map(i => i.name).join(', ') : 'No items';
        const vatText = expense.vatAmount > 0 ? `₱${expense.vatAmount.toFixed(2)}` : 'No VAT';

        row.innerHTML = `
            <td><input type="checkbox" onchange="updateBulkEditButton()" onclick="handleCheckboxClick(event)"></td>
            <td>${expense.date || 'No date'}</td>
            <td>${expense.supplierName || 'No supplier'}</td>
            <td title="${itemsText}">${itemsText.length > 50 ? itemsText.substring(0, 50) + '...' : itemsText}</td>
            <td>${expense.expenseCategory || 'General'}</td>
            <td>₱${(expense.totalAmount || 0).toLocaleString()}</td>
            <td>${expense.branch || 'No branch'}</td>
            <td>${expense.paymentMethod || 'Cash'}</td>
            <td>${vatText}</td>
             <td>
                 <button onclick="window.viewExpense('${expense.id}')">View</button>
             </td>
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
        tbody.innerHTML = '<tr><td colspan="8">No suppliers found</td></tr>';
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
        row.innerHTML = `
            <td style="width: 30px; max-width: 30px; text-align: center;"><input type="checkbox" onchange="updateBulkEditButton()" onclick="handleCheckboxClick(event)"></td>
            <td style="width: 220px; max-width: 220px;"><strong>${supplier.name || 'No name'}</strong></td>
            <td style="width: 220px; max-width: 220px;">${supplier.businessName || '-'}</td>
            <td style="width: 160px; max-width: 160px;">${supplier.tin || '-'}</td>
            <td style="width: 140px; max-width: 140px;">${supplier.isVatRegistered ? 'VAT Registered' : 'Not Registered'}</td>
            <td style="width: 60px; max-width: 60px; text-align: center;">${transactionCount}</td>
            <td style="width: 100px; max-width: 100px; text-align: right;">₱${totalAmount.toLocaleString()}</td>
            <td style="width: 50px; max-width: 50px; text-align: center;">
                <button onclick="viewSupplierDetails('${supplier.name}')">View</button>
            </td>
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

            // Show/hide date filter controls based on tab
            const dateFilterControls = document.querySelector('.main-controls');
            const tableControls = document.querySelector('.table-controls');
            
            if (btn.dataset.table === 'expenses') {
                // Show date filters and action buttons for expenses
                if (dateFilterControls) dateFilterControls.style.display = 'flex';
                if (tableControls) tableControls.style.display = 'flex';
            } else {
                // Hide date filters and action buttons for suppliers and analytics
                if (dateFilterControls) dateFilterControls.style.display = 'none';
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
    
    console.log('Event listeners set up successfully');
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

    pageExpenses.forEach(expense => {
        const row = document.createElement('tr');

        const itemsText = expense.items ? expense.items.map(i => i.name).join(', ') : 'No items';
        const vatText = expense.vatAmount > 0 ? `₱${expense.vatAmount.toFixed(2)}` : 'No VAT';

        row.innerHTML = `
            <td><input type="checkbox" onchange="updateBulkEditButton()" onclick="handleCheckboxClick(event)"></td>
            <td>${formatDate(expense.date)}</td>
            <td><strong>${expense.supplierName || 'No supplier'}</strong></td>
            <td title="${itemsText}">${itemsText.length > 50 ? itemsText.substring(0, 50) + '...' : itemsText}</td>
            <td>${expense.expenseCategory || 'General'}</td>
            <td>₱${(expense.totalAmount || 0).toLocaleString()}</td>
            <td>${expense.branch || 'No branch'}</td>
            <td>${expense.paymentMethod || 'Cash'}</td>
            <td>${vatText}</td>
             <td>
                 <button onclick="window.viewExpense('${expense.id}')">View</button>
             </td>
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

window.deleteExpenseFromDetail = function(expenseId) {
    if (confirm('Are you sure you want to delete this expense? This action cannot be undone.')) {
        const success = shared.deleteExpense(expenseId);
        if (success) {
            shared.showToast('Expense deleted successfully');
            shared.closeExpenseDetailModal();
            
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
            shared.showToast('Failed to delete expense');
        }
    }
};

window.viewSupplierFromExpense = function(supplierName) {
    // Switch to suppliers view and filter by this supplier
    const suppliersBtn = document.querySelector('.view-btn[data-view="suppliers"]');
    if (suppliersBtn) {
        suppliersBtn.click();
        // TODO: Add filtering by supplier name
        shared.showToast(`Viewing supplier: ${supplierName}`);
    }
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
window.showBulkEditModal = function() {
    const selectedExpenses = getSelectedExpenses();
    
    if (selectedExpenses.length === 0) {
        shared.showToast('Please select expenses to edit');
        return;
    }
    
    showBulkEditModalDialog(selectedExpenses);
};

function getSelectedExpenses() {
    const checkboxes = document.querySelectorAll('#expenseTableBody input[type="checkbox"]:checked');
    const selectedIds = Array.from(checkboxes).map(cb => {
        const row = cb.closest('tr');
        const viewButton = row.querySelector('button[onclick*="viewExpense"]');
        if (viewButton) {
            const onclick = viewButton.getAttribute('onclick');
            const match = onclick.match(/viewExpense\('([^']+)'\)/);
            return match ? match[1] : null;
        }
        return null;
    }).filter(id => id !== null);
    
    return shared.getExpenses().filter(expense => selectedIds.includes(expense.id));
}

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
    
    // Refresh the admin interface
    const activeBtn = document.querySelector('.date-shortcut-btn.active');
    if (activeBtn) {
        activeBtn.click();
    } else {
        const expenses = shared.getExpenses();
        renderFilteredTable(expenses);
        updateFilteredSummary(expenses);
    }
};

// Select all functionality - only selects items on current page
window.toggleSelectAll = function() {
    const selectAllCheckbox = document.getElementById('selectAllExpenses');
    const checkboxes = document.querySelectorAll('#expenseTableBody input[type="checkbox"]');
    
    if (!selectAllCheckbox) {
        console.error('Select all checkbox not found');
        return;
    }
    
    checkboxes.forEach(checkbox => {
        if (checkbox) {
            checkbox.checked = selectAllCheckbox.checked;
        }
    });
    
    updateBulkEditButton();
};

// Shift+click selection functionality
let lastSelectedCheckbox = null;

window.handleCheckboxClick = function(event) {
    if (event.shiftKey && lastSelectedCheckbox && lastSelectedCheckbox !== event.target) {
        // Find all checkboxes in the table
        const allCheckboxes = Array.from(document.querySelectorAll('#expenseTableBody input[type="checkbox"]'));
        const currentIndex = allCheckboxes.indexOf(event.target);
        const lastIndex = allCheckboxes.indexOf(lastSelectedCheckbox);
        
        // Determine the range
        const startIndex = Math.min(currentIndex, lastIndex);
        const endIndex = Math.max(currentIndex, lastIndex);
        
        // Select all checkboxes in the range
        for (let i = startIndex; i <= endIndex; i++) {
            allCheckboxes[i].checked = true;
        }
        
        updateBulkEditButton();
    } else {
        // Regular click - just update the last selected
        lastSelectedCheckbox = event.target;
    }
};

// Update bulk edit button visibility and text
window.updateBulkEditButton = function() {
    const checkboxes = document.querySelectorAll('#expenseTableBody input[type="checkbox"]:checked');
    const bulkEditBtn = document.getElementById('bulkEditBtn');
    
    if (bulkEditBtn) {
        if (checkboxes.length > 0) {
            bulkEditBtn.style.display = 'flex';
            
            // Update button text dynamically
            const count = checkboxes.length;
            let buttonText;
            if (count === 1) {
                buttonText = 'Edit';
            } else {
                buttonText = `Edit ${count} Entries`;
            }
            
            // Update the text content (keep the SVG icon)
            const svg = bulkEditBtn.querySelector('svg');
            bulkEditBtn.innerHTML = '';
            if (svg) {
                bulkEditBtn.appendChild(svg);
            }
            bulkEditBtn.appendChild(document.createTextNode(buttonText));
        } else {
            bulkEditBtn.style.display = 'none';
        }
    }
};

// View supplier details function
window.viewSupplierDetails = function(supplierName) {
    const supplier = shared.getSuppliers().find(s => s.name === supplierName);
    if (!supplier) {
        shared.showToast('Supplier not found');
        return;
    }

    // Get all expenses for this supplier
    const supplierExpenses = shared.getExpenses().filter(e => e.supplierName === supplierName);
    const totalAmount = supplierExpenses.reduce((sum, e) => sum + (e.totalAmount || 0), 0);

    // Create a simple modal to show supplier details
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        border-radius: 16px;
        max-width: 600px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
    `;
    
    modalContent.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 1.5rem; border-bottom: 1px solid #e5e5e5; background: #f8f9fa; position: sticky; top: 0; z-index: 10;">
            <h2 style="margin: 0; font-size: 1.5rem; font-weight: 600; color: #333;">Supplier Details</h2>
            <button onclick="this.closest('div').parentElement.parentElement.remove()" style="background: none; border: none; cursor: pointer; padding: 4px; color: #666; font-size: 1.5rem; display: flex; align-items: center; justify-content: center; border-radius: 6px;">×</button>
        </div>
        <div style="padding: 1.5rem;">
            <div style="margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #f0f0f0;">
                <h3 style="font-size: 1.1rem; font-weight: 600; color: #2b9348; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid rgba(43, 147, 72, 0.2);">Basic Information</h3>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="font-weight: 500; color: #666;">Supplier Name</span>
                    <span style="font-weight: 600; color: #333;">${supplier.name}</span>
                </div>
                ${supplier.businessName ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="font-weight: 500; color: #666;">Business Name</span>
                    <span style="font-weight: 600; color: #333;">${supplier.businessName}</span>
                </div>
                ` : ''}
                ${supplier.tin ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="font-weight: 500; color: #666;">TIN</span>
                    <span style="font-weight: 600; color: #333;">${supplier.tin}</span>
                </div>
                ` : ''}
                ${supplier.address ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="font-weight: 500; color: #666;">Address</span>
                    <span style="font-weight: 600; color: #333; text-align: right; max-width: 60%;">${supplier.address}</span>
                </div>
                ` : ''}
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="font-weight: 500; color: #666;">VAT Status</span>
                    <span style="font-weight: 600; color: #333;">${supplier.isVatRegistered ? 'VAT Registered' : 'Not VAT Registered'}</span>
                </div>
            </div>
            <div style="margin-bottom: 1.5rem;">
                <h3 style="font-size: 1.1rem; font-weight: 600; color: #2b9348; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid rgba(43, 147, 72, 0.2);">Transaction Summary</h3>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="font-weight: 500; color: #666;">Total Transactions</span>
                    <span style="font-weight: 600; color: #333;">${supplierExpenses.length}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="font-weight: 500; color: #666;">Total Amount</span>
                    <span style="font-weight: 600; color: #2b9348; font-size: 1.1rem;">₱${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            </div>
        </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
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

// Unified expense modal for both viewing and editing
function showExpenseModal(expense, isNew = false) {
    const isEditing = isNew;
    const modalTitle = isNew ? 'Add New Expense' : 'Expense Details';
    
    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        border-radius: 16px;
        max-width: 600px;
        width: 90%;
        max-height: 90vh;
        overflow: hidden;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
    `;
    
    modalContent.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 1.5rem; border-bottom: 1px solid #e5e5e5; background: #f8f9fa; border-radius: 16px 16px 0 0;">
            <h2 style="margin: 0; font-size: 1.5rem; font-weight: 600; color: #333;">${modalTitle}</h2>
            <div style="display: flex; gap: 0.5rem;">
                ${!isNew ? `
                <button onclick="toggleEditMode('${expense.id}')" style="background: white; border: 1px solid #e5e5e5; border-radius: 6px; padding: 8px; cursor: pointer; color: #2b9348; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;" title="Edit expense">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path>
                    </svg>
                </button>
                <button onclick="deleteExpenseFromDetail('${expense.id}')" style="background: white; border: 1px solid #e5e5e5; border-radius: 6px; padding: 8px; cursor: pointer; color: #dc3545; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;" title="Delete expense">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"></polyline>
                        <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                </button>
                ` : ''}
                <button onclick="this.closest('div').parentElement.parentElement.remove()" style="background: none; border: none; cursor: pointer; padding: 4px; color: #666; font-size: 1.5rem; display: flex; align-items: center; justify-content: center; border-radius: 6px;">×</button>
            </div>
        </div>
        <div style="padding: 1.5rem; overflow-y: auto; max-height: calc(90vh - 80px);">
            ${generateExpenseForm(expense, isEditing)}
        </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Add calculation functions for existing items if editing
    if (isEditing && expense.items) {
        expense.items.forEach((item, index) => {
            window[`calculateItemTotal_${index}`] = function() {
                const qtyInput = document.querySelector(`input[name="itemQty_${index}"]`);
                const priceInput = document.querySelector(`input[name="itemPrice_${index}"]`);
                const totalInput = document.querySelector(`input[name="itemTotal_${index}"]`);
                if (qtyInput && priceInput && totalInput) {
                    const qty = parseFloat(qtyInput.value) || 0;
                    const price = parseFloat(priceInput.value) || 0;
                    const total = shared.calculateItemTotal(qty, price);
                    totalInput.value = total.toFixed(2);
                }
                // Recalculate overall total when item prices change
                if (typeof calculateOverallTotal === 'function') {
                    calculateOverallTotal();
                }
            };
        });
    }
    
    // Add overall total calculation function (must be defined before modal is shown)
    window.calculateOverallTotal = function() {
        const itemRows = document.querySelectorAll('#itemsContainer .item-row');
        const items = [];
        let hasAnyPrice = false;
        
        itemRows.forEach((row, index) => {
            const nameInput = row.querySelector(`input[name="itemName_${index}"]`);
            const qtyInput = row.querySelector(`input[name="itemQty_${index}"]`);
            const priceInput = row.querySelector(`input[name="itemPrice_${index}"]`);
            
            if (nameInput && nameInput.value.trim()) {
                const qty = parseFloat(qtyInput?.value) || 1;
                const price = parseFloat(priceInput?.value) || 0;
                
                if (price > 0) {
                    hasAnyPrice = true;
                }
                
                items.push({ quantity: qty, price: price });
            }
        });
        
        const overallTotalInput = document.getElementById('overallTotalAmountInput');
        if (overallTotalInput) {
            // Only auto-calculate if at least one item has a price
            if (hasAnyPrice && items.length > 0) {
                const calculatedTotal = shared.calculateExpenseTotal(items);
                overallTotalInput.value = calculatedTotal.toFixed(2);
            }
            // If no prices, keep manual entry (don't overwrite)
        }
        
        // Update VAT display
        if (typeof updateVatDisplay === 'function') {
            updateVatDisplay();
        }
    };
    
    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Generate the expense form content
function generateExpenseForm(expense, isEditing) {
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toISOString().split('T')[0];
    };

    return `
        <form id="expenseForm" onsubmit="saveExpense(event, '${expense.id}')">
            <!-- Basic Information -->
            <div style="margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #f0f0f0;">
                <h3 style="font-size: 1.1rem; font-weight: 600; color: #2b9348; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid rgba(43, 147, 72, 0.2);">Basic Information</h3>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Date</label>
                    <input type="date" name="date" value="${formatDate(expense.date)}" required style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem;" ${!isEditing ? 'readonly' : ''}>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Branch</label>
                    <select name="branch" required style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem; ${!isEditing ? 'background-color: #f8f9fa; color: #666;' : ''}" ${!isEditing ? 'disabled' : ''}>
                        <option value="SM North" ${expense.branch === 'SM North' ? 'selected' : ''}>SM North</option>
                        <option value="Podium" ${expense.branch === 'Podium' ? 'selected' : ''}>Podium</option>
                        <option value="BGC" ${expense.branch === 'BGC' ? 'selected' : ''}>BGC</option>
                        <option value="Makati" ${expense.branch === 'Makati' ? 'selected' : ''}>Makati</option>
                    </select>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Expense Category</label>
                    <select name="expenseCategory" required style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem; ${!isEditing ? 'background-color: #f8f9fa; color: #666;' : ''}" ${!isEditing ? 'disabled' : ''}>
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
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Payment Method</label>
                    <select name="paymentMethod" required style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem; ${!isEditing ? 'background-color: #f8f9fa; color: #666;' : ''}" ${!isEditing ? 'disabled' : ''}>
                        <option value="Cash" ${expense.paymentMethod === 'Cash' ? 'selected' : ''}>Cash</option>
                        <option value="GCash" ${expense.paymentMethod === 'GCash' ? 'selected' : ''}>GCash</option>
                        <option value="Credit Card" ${expense.paymentMethod === 'Credit Card' ? 'selected' : ''}>Credit Card</option>
                        <option value="Debit Card" ${expense.paymentMethod === 'Debit Card' ? 'selected' : ''}>Debit Card</option>
                        <option value="Bank Transfer" ${expense.paymentMethod === 'Bank Transfer' ? 'selected' : ''}>Bank Transfer</option>
                    </select>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Paid By</label>
                    <input type="text" name="paidBy" value="${expense.paidBy || ''}" placeholder="Person who paid" style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem;" ${!isEditing ? 'readonly' : ''}>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Invoice Number</label>
                    <input type="text" name="invoiceNumber" value="${expense.invoiceNumber || ''}" placeholder="Invoice/reference number" style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem;" ${!isEditing ? 'readonly' : ''}>
                </div>
            </div>

            <!-- Supplier Information -->
            <div style="margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #f0f0f0;">
                <h3 style="font-size: 1.1rem; font-weight: 600; color: #2b9348; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid rgba(43, 147, 72, 0.2);">Supplier Information</h3>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Supplier Name *</label>
                    <input type="text" name="supplierName" value="${expense.supplierName || ''}" required placeholder="Enter supplier name" style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem;" ${!isEditing ? 'readonly' : ''}>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Business Name</label>
                    <input type="text" name="businessName" value="${expense.businessName || ''}" placeholder="Enter business name" style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem;" ${!isEditing ? 'readonly' : ''}>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">TIN</label>
                    <input type="text" name="tin" value="${expense.tin || ''}" placeholder="Tax Identification Number" style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem;" ${!isEditing ? 'readonly' : ''}>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">Address</label>
                    <textarea name="address" placeholder="Supplier address" style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem; min-height: 60px; resize: vertical;" ${!isEditing ? 'readonly' : ''}>${expense.address || ''}</textarea>
                </div>
            </div>

            <!-- Items -->
            <div style="margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #f0f0f0;">
                <h3 style="font-size: 1.1rem; font-weight: 600; color: #2b9348; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid rgba(43, 147, 72, 0.2);">Items Purchased</h3>
                <div id="itemsContainer">
                    ${expense.items.map((item, index) => `
                        <div class="item-row" style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem; align-items: end;">
                            <div style="flex: 2;">
                                <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.25rem; font-size: 0.8rem;">Item Name</label>
                                <input type="text" name="itemName_${index}" value="${item.name}" placeholder="Item name" required style="width: 100%; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 0.85rem;" ${!isEditing ? 'readonly' : ''}>
                            </div>
                            <div style="flex: 1;">
                                <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.25rem; font-size: 0.8rem;">Qty</label>
                                <input type="number" name="itemQty_${index}" value="${item.quantity}" min="1" step="1" style="width: 100%; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 0.85rem;" ${!isEditing ? 'readonly' : `onchange="calculateItemTotal_${index}()" oninput="calculateItemTotal_${index}()"`}>
                            </div>
                            <div style="flex: 1;">
                                <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.25rem; font-size: 0.8rem;">Price</label>
                                <input type="number" name="itemPrice_${index}" value="${item.price}" min="0" step="0.01" style="width: 100%; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 0.85rem;" ${!isEditing ? 'readonly' : `onchange="calculateItemTotal_${index}()" oninput="calculateItemTotal_${index}()"`}>
                            </div>
                            <div style="flex: 1;">
                                <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.25rem; font-size: 0.8rem;">Total</label>
                                <input type="number" name="itemTotal_${index}" value="${item.total}" min="0" step="0.01" readonly style="width: 100%; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 0.85rem; background-color: ${!isEditing ? '#f8f9fa' : '#f8f9fa'};">
                            </div>
                            ${isEditing ? `<button type="button" onclick="removeItem(this)" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 0.5rem; cursor: pointer; height: fit-content;">×</button>` : ''}
                        </div>
                    `).join('')}
                </div>
                ${isEditing ? `<button type="button" onclick="addItem()" style="background: #2b9348; color: white; border: none; border-radius: 6px; padding: 0.75rem 1rem; cursor: pointer; font-size: 0.9rem; margin-top: 0.5rem;">+ Add Item</button>` : ''}
                
                <div style="margin-top: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 600; color: #333;">Total Amount:</span>
                        ${isEditing ? `
                            <input type="number" id="overallTotalAmountInput" name="totalAmount" value="${(expense.totalAmount || 0).toFixed(2)}" min="0" step="0.01" style="width: 150px; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 1.1rem; font-weight: 600; color: #2b9348; text-align: right;" onchange="calculateOverallTotal()" oninput="calculateOverallTotal()">
                        ` : `
                            <span style="font-weight: 600; color: #2b9348; font-size: 1.1rem;">₱${(expense.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        `}
                    </div>
                    ${isEditing ? `
                        <small style="color: #999; font-size: 0.85rem; margin-top: 0.5rem; display: block;">
                            ${expense.items && expense.items.some(item => item.price > 0) ? 
                                'Total auto-calculates from items. Enter item prices to update.' : 
                                'No item prices entered. Enter total manually or add prices to items.'}
                        </small>
                    ` : ''}
                </div>
            </div>

            <!-- VAT Information (show if expense has VAT or if editing) -->
            ${(expense.isVatRegistered || expense.vatAmount > 0 || expense.vatableSale > 0 || isEditing) ? `
            <div style="margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #f0f0f0;">
                <h3 style="font-size: 1.1rem; font-weight: 600; color: #2b9348; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid rgba(43, 147, 72, 0.2);">VAT Information</h3>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.5rem;">VAT Exempt Amount</label>
                    <input type="number" name="vatExemptAmount" value="${expense.vatExemptAmount || 0}" min="0" step="0.01" style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem;" ${!isEditing ? 'readonly' : ''}>
                    <small style="color: #999; font-size: 0.85rem; margin-top: 0.25rem; display: block;">Amount that is exempt from VAT (if any)</small>
                </div>
                ${expense.isVatRegistered && expense.vatAmount > 0 ? `
                <div style="margin-top: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span style="color: #666;">VATable Sale:</span>
                        <span style="font-weight: 500;">₱${(expense.vatableSale || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span style="color: #666;">VAT Amount (12%):</span>
                        <span style="font-weight: 500; color: #2b9348;">₱${(expense.vatAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding-top: 0.5rem; border-top: 1px solid #e5e5e5; margin-top: 0.5rem;">
                        <span style="font-weight: 600; color: #333;">VAT Registered:</span>
                        <span style="font-weight: 600; color: #2b9348;">Yes</span>
                    </div>
                </div>
                ` : ''}
            </div>
            ` : ''}

            <!-- Notes -->
            <div style="margin-bottom: 1.5rem;">
                <h3 style="font-size: 1.1rem; font-weight: 600; color: #2b9348; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid rgba(43, 147, 72, 0.2);">Notes</h3>
                <textarea name="notes" placeholder="Additional notes..." style="width: 100%; padding: 0.75rem; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 0.9rem; min-height: 80px; resize: vertical;" ${!isEditing ? 'readonly' : ''}>${expense.notes || ''}</textarea>
            </div>

            ${isEditing ? `
            <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #f0f0f0;">
                <button type="button" onclick="this.closest('div').parentElement.parentElement.remove()" style="padding: 0.75rem 1.5rem; border: 1px solid #e5e5e5; background: white; border-radius: 6px; cursor: pointer; font-size: 0.9rem;">Cancel</button>
                <button type="submit" style="padding: 0.75rem 1.5rem; border: none; background: #2b9348; color: white; border-radius: 6px; cursor: pointer; font-size: 0.9rem;">Save Expense</button>
            </div>
            ` : ''}
        </form>
    `;
}

// Toggle edit mode
window.toggleEditMode = function(expenseId) {
    const expense = shared.getExpenses().find(e => e.id === expenseId);
    if (!expense) {
        shared.showToast('Expense not found');
        return;
    }
    
    // Close current modal and open in edit mode
    document.querySelector('.expense-modal-overlay')?.remove();
    showExpenseModal(expense, true);
};

// Add item function
window.addItem = function() {
    const container = document.getElementById('itemsContainer');
    const itemCount = container.children.length;
    
    const itemRow = document.createElement('div');
    itemRow.className = 'item-row';
    itemRow.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.75rem; align-items: end;';
    itemRow.innerHTML = `
        <div style="flex: 2;">
            <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.25rem; font-size: 0.8rem;">Item Name</label>
            <input type="text" name="itemName_${itemCount}" placeholder="Item name" required style="width: 100%; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 0.85rem;">
        </div>
        <div style="flex: 1;">
            <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.25rem; font-size: 0.8rem;">Qty</label>
            <input type="number" name="itemQty_${itemCount}" value="1" min="1" step="1" style="width: 100%; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 0.85rem;" onchange="calculateItemTotal_${itemCount}()" oninput="calculateItemTotal_${itemCount}()">
        </div>
        <div style="flex: 1;">
            <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.25rem; font-size: 0.8rem;">Price</label>
            <input type="number" name="itemPrice_${itemCount}" value="0" min="0" step="0.01" style="width: 100%; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 0.85rem;" onchange="calculateItemTotal_${itemCount}()" oninput="calculateItemTotal_${itemCount}()">
        </div>
        <div style="flex: 1;">
            <label style="display: block; font-weight: 500; color: #666; margin-bottom: 0.25rem; font-size: 0.8rem;">Total</label>
            <input type="number" name="itemTotal_${itemCount}" value="0" min="0" step="0.01" readonly style="width: 100%; padding: 0.5rem; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 0.85rem; background-color: #f8f9fa;">
        </div>
        <button type="button" onclick="removeItem(this)" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 0.5rem; cursor: pointer; height: fit-content;">×</button>
    `;
    
    // Create calculation function for this item using shared function
    window[`calculateItemTotal_${itemCount}`] = function() {
        const qtyInput = document.querySelector(`input[name="itemQty_${itemCount}"]`);
        const priceInput = document.querySelector(`input[name="itemPrice_${itemCount}"]`);
        const totalInput = document.querySelector(`input[name="itemTotal_${itemCount}"]`);
        
        if (qtyInput && priceInput && totalInput) {
            const qty = parseFloat(qtyInput.value) || 0;
            const price = parseFloat(priceInput.value) || 0;
            const total = shared.calculateItemTotal(qty, price);
            totalInput.value = total.toFixed(2);
        }
        // Recalculate overall total when item prices change
        if (typeof calculateOverallTotal === 'function') {
            calculateOverallTotal();
        }
    };
    
    container.appendChild(itemRow);
    
    // Recalculate overall total after adding item
    if (typeof calculateOverallTotal === 'function') {
        calculateOverallTotal();
    }
};

// Remove item function
window.removeItem = function(button) {
    button.closest('.item-row').remove();
};

// Save expense function
window.saveExpense = function(event, expenseId) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const isNew = !shared.getExpenses().find(e => e.id === expenseId);
    const existingExpense = isNew ? null : shared.getExpenses().find(e => e.id === expenseId);
    
    // Collect items using shared calculation
    const items = [];
    const itemRows = document.querySelectorAll('.item-row');
    let hasAnyPrice = false;
    
    itemRows.forEach((row, index) => {
        const name = formData.get(`itemName_${index}`);
        if (name && name.trim()) {
            const qty = parseFloat(formData.get(`itemQty_${index}`)) || 1;
            const price = parseFloat(formData.get(`itemPrice_${index}`)) || 0;
            
            if (price > 0) {
                hasAnyPrice = true;
            }
            
            items.push({
                name: name.trim(),
                quantity: qty,
                price: price,
                total: shared.calculateItemTotal(qty, price)
            });
        }
    });
    
    // Add items to formData for createExpenseObject
    formData.items = items;
    
    // Only auto-calculate total from items if at least one item has a price
    // If all items have price = 0, use manual total input
    const calculateTotalFromItems = hasAnyPrice && items.length > 0;
    
    // Create expense using shared function
    const result = shared.createExpenseObject(formData, {
        existingExpense: existingExpense,
        isEditing: !isNew,
        calculateTotalFromItems: calculateTotalFromItems, // Only calculate if items have prices
        autoCalculateVAT: true,
        validate: true
    });
    
    // Check for validation errors
    if (!result.success) {
        shared.showToast(result.errors.join(', '));
        return;
    }
    
    const expenseData = result.expense;
    // Ensure ID matches (form might have different ID structure)
    expenseData.id = expenseId;
    
    if (isNew) {
        shared.addExpense(expenseData);
        shared.showToast('Expense added successfully');
    } else {
        shared.updateExpense(expenseId, expenseData);
        shared.showToast('Expense updated successfully');
    }
    
    // Close modal and refresh table
    event.target.closest('div').parentElement.parentElement.remove();
    
    // Refresh the admin interface
    const activeBtn = document.querySelector('.date-shortcut-btn.active');
    if (activeBtn) {
        activeBtn.click();
    } else {
        const expenses = shared.getExpenses();
        renderFilteredTable(expenses);
        updateFilteredSummary(expenses);
    }
};

// Make shared functions available globally for the modal
window.shared = shared;
window.closeExpenseDetailModal = function() {
    // This function can be used if needed, but the modal is self-contained
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

