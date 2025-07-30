import * as shared from './shared.js';

// Pagination state
let currentPage = 1;
let itemsPerPage = 25;
let totalFilteredExpenses = [];

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
            <td><input type="checkbox"></td>
            <td>${expense.date || 'No date'}</td>
            <td>${expense.supplierName || 'No supplier'}</td>
            <td title="${itemsText}">${itemsText.length > 50 ? itemsText.substring(0, 50) + '...' : itemsText}</td>
            <td>₱${(expense.totalAmount || 0).toLocaleString()}</td>
            <td>${expense.branch || 'No branch'}</td>
            <td>${expense.paymentMethod || 'Cash'}</td>
            <td>${vatText}</td>
            <td>
                <button onclick="alert('View: ${expense.supplierName}')">View</button>
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
            <td><input type="checkbox"></td>
            <td><strong>${supplier.name || 'No name'}</strong></td>
            <td>${supplier.businessName || '-'}</td>
            <td>${supplier.tin || '-'}</td>
            <td>${supplier.isVatRegistered ? 'VAT Registered' : 'Not Registered'}</td>
            <td>${transactionCount}</td>
            <td>₱${totalAmount.toLocaleString()}</td>
            <td>
                <button onclick="alert('View supplier: ${supplier.name}')">View</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    refreshPagination('suppliers');
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

// Initialize
document.addEventListener('DOMContentLoaded', async function () {
    console.log('DOMContentLoaded fired - Admin starting...');

    // Load data (localStorage first, then Firebase)
    const success = await loadData();

    if (!success) {
        console.error('Failed to load any data');
        document.getElementById('summaryCards').innerHTML = '<div class="summary-card"><div class="card-title">Error</div><div class="card-value">No data available</div></div>';
        return;
    }

    // Set up view switching
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update button states
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Hide all views
            document.querySelectorAll('.data-view').forEach(view => view.classList.add('hidden'));

            // Show selected view
            const targetView = document.getElementById(`${btn.dataset.view}View`);
            if (targetView) {
                targetView.classList.remove('hidden');

                // Render appropriate content
                if (btn.dataset.view === 'expenses') {
                    renderTable();
                } else if (btn.dataset.view === 'suppliers') {
                    renderSuppliers();
                } else if (btn.dataset.view === 'analytics') {
                    targetView.innerHTML = '<div style="padding: 2rem;">Analytics coming soon...</div>';
                }
            }
        });
    });

    // Set up other buttons
    document.getElementById('addExpenseBtn')?.addEventListener('click', () => {
        window.open('index.html', '_blank');
    });
});

async function initialize() {
    console.log('Initializing admin interface...');

    // Set default sorting BEFORE loading data
    currentSort = { column: 'date', direction: 'desc' };

    // Load data first (localStorage then Firebase)
    const success = await loadData();

    if (!success) {
        console.error('Failed to load any data');
        document.getElementById('summaryCards').innerHTML = '<div class="summary-card"><div class="card-title">Error</div><div class="card-value">No data available</div></div>';
        return;
    }

    // Set up all event listeners FIRST
    setupEventListeners();

    // Update header visual state for default date sorting
    const dateHeader = document.querySelector('.data-table th[data-sort="date"]');
    if (dateHeader) {
        dateHeader.classList.add('sorted-desc');
    }

    console.log('Admin interface initialized successfully');

    // Set "All Data" as active by default and show paginated data immediately
    const allDataBtn = document.querySelector('.date-shortcut-btn[data-range="all"]');
    if (allDataBtn) {
        allDataBtn.classList.add('active');
    }

    // Initialize pagination containers immediately
    setupPagination('expenses');
    setupPagination('suppliers');
}

function setupEventListeners() {
    console.log('Setting up event listeners...');

    // View switching buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('View button clicked:', btn.dataset.view);

            // Update button states
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Hide all views
            document.querySelectorAll('.data-view').forEach(view => view.classList.add('hidden'));

            // Show selected view
            const targetView = document.getElementById(`${btn.dataset.view}View`);
            if (targetView) {
                targetView.classList.remove('hidden');

                // Render appropriate content
                if (btn.dataset.view === 'expenses') {
                    // Reset pagination for expenses
                    currentPage = 1;
                    const activeBtn = document.querySelector('.date-shortcut-btn.active');
                    if (activeBtn) {
                        activeBtn.click();
                    } else {
                        const expenses = shared.getExpenses();
                        renderFilteredTable(expenses);
                    }
                } else if (btn.dataset.view === 'suppliers') {
                    // Reset pagination and sorting for suppliers
                    currentPage = 1;
                    currentSort = { column: 'transactions', direction: 'desc' };
                    // Clear sort indicators
                    document.querySelectorAll('.data-table th[data-sort]').forEach(h => {
                        h.classList.remove('sorted-asc', 'sorted-desc');
                    });
                    renderSuppliers();
                } else if (btn.dataset.view === 'analytics') {
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
            window.open('index.html', '_blank');
        });
    }

    // Date filter buttons - FIXED VERSION
    document.querySelectorAll('.date-shortcut-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Date filter clicked:', btn.textContent, 'range:', btn.dataset.range);

            // Update button states
            document.querySelectorAll('.date-shortcut-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Get the date range
            const range = btn.dataset.range;
            let filteredExpenses;
            const expenses = shared.getExpenses();

            const now = new Date();

            switch (range) {
                case 'today':
                    const today = now.toISOString().split('T')[0];
                    filteredExpenses = expenses.filter(expense => {
                        return expense.date && expense.date === today;
                    });
                    console.log('Today filter: looking for', today, 'found:', filteredExpenses.length);
                    break;

                case 'week':
                    const weekAgo = new Date(now);
                    weekAgo.setDate(now.getDate() - 7);
                    const weekAgoStr = weekAgo.toISOString().split('T')[0];
                    const todayStr = now.toISOString().split('T')[0];

                    filteredExpenses = expenses.filter(expense => {
                        if (!expense.date) return false;
                        return expense.date >= weekAgoStr && expense.date <= todayStr;
                    });
                    console.log('Week filter: from', weekAgoStr, 'to', todayStr, 'found:', filteredExpenses.length);
                    break;

                case 'month':
                    const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
                    filteredExpenses = expenses.filter(expense => {
                        return expense.date && expense.date.startsWith(currentMonth);
                    });
                    console.log('Month filter: looking for', currentMonth, 'found:', filteredExpenses.length);
                    break;

                case 'year':
                    const currentYear = now.getFullYear().toString();
                    console.log('Year filter: looking for year', currentYear);
                    console.log('Total expenses to check:', expenses.length);

                    filteredExpenses = expenses.filter(expense => {
                        if (!expense.date) {
                            return false;
                        }
                        const matches = expense.date.startsWith(currentYear);
                        if (!matches) {
                            // Log a few non-matching dates for debugging
                            console.log('Non-matching date:', expense.date);
                        }
                        return matches;
                    });

                    console.log('Year filter found:', filteredExpenses.length);
                    // Show some sample dates from filtered results
                    console.log('Sample filtered dates:', filteredExpenses.slice(0, 5).map(e => e.date));
                    break;

                case 'all':
                default:
                    filteredExpenses = [...expenses];
                    break;
            }

            // Reset to page 1 when filtering
            currentPage = 1;

            // Always render the filtered results
            renderFilteredTable(filteredExpenses);
            updateFilteredSummary(filteredExpenses);
        });
    });

    // Setup table sorting
    setupTableSorting();

    console.log('Event listeners set up successfully');
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
            <td><input type="checkbox"></td>
            <td>${formatDate(expense.date)}</td>
            <td><strong>${expense.supplierName || 'No supplier'}</strong></td>
            <td title="${itemsText}">${itemsText.length > 50 ? itemsText.substring(0, 50) + '...' : itemsText}</td>
            <td>₱${(expense.totalAmount || 0).toLocaleString()}</td>
            <td>${expense.branch || 'No branch'}</td>
            <td>${expense.paymentMethod || 'Cash'}</td>
            <td>${vatText}</td>
            <td>
                <button onclick="alert('View: ${expense.supplierName}')">View</button>
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
            const activeBtn = document.querySelector('.date-shortcut-btn.active');
            if (activeBtn) {
                activeBtn.click(); // Trigger current filter with new sort
            }
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
                const activeBtn = document.querySelector('.date-shortcut-btn.active');
                if (activeBtn) {
                    activeBtn.click();
                } else {
                    renderFilteredTable(totalFilteredExpenses);
                }
            }
        }
    });

    document.getElementById(`nextPage_${viewType}`)?.addEventListener('click', () => {
        const totalPages = Math.ceil(totalFilteredExpenses.length / itemsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
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

// Export for debugging
window.getExpenses = shared.getExpenses;
window.getSuppliers = shared.getSuppliers;
window.loadData = loadData;
window.initialize = initialize;
window.debugDates = shared.debugDates;

