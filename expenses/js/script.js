// Import shared utilities with version for cache busting
// Static import with versioned URL to avoid caching issues; keep in sync with index.html
import * as shared from './shared.js?v=1.5.16';

// Helper function to get today's date in local timezone (YYYY-MM-DD format)
function getTodayLocal() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Local state for UI
let itemCounter = 0;
let selectedDate = getTodayLocal(); // Default to today (local timezone)
let selectedBranch = localStorage.getItem('expense-selected-branch') || 'SM North';

// Main initialization
document.addEventListener('DOMContentLoaded', async function () {
    // Phase 1: Load from localStorage first (instant)
    const hasLocalData = shared.loadFromLocalStorage();

    if (hasLocalData) {
        // Immediately show UI with local data
        loadDashboard();
    }

    // Phase 2: Initialize Firebase (in background)
    const firebaseInitialized = await shared.initializeFirebase();

    if (firebaseInitialized) {
        // Phase 3: Background Firebase sync (non-blocking)
        const hasChanges = await shared.initializeFirebaseSync();
        
        if (hasChanges) {
            // Re-render with updated data
            loadDashboard();
        }
    } else {
        console.log('Running in offline mode - Firebase not available');
        showSyncStatus('⚠ Offline mode', 'error');
    }

    // Initialize date picker and branch select
    initializeDatePicker();
    initializeBranchSelect();

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

// Force sync before page unload - now handled by shared.js

// Initialize Firebase background sync
// initializeFirebaseSync function removed - now using shared.js initializeFirebaseSync()

// loadFromLocalStorage function removed - now using shared.loadFromLocalStorage()

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

// syncToFirebase function removed - now using shared.js sync functions

// syncCollectionToFirebase function removed - now using shared.js sync functions

// fetchFromFirebase function removed - now using shared.js fetchFromFirebase()

// mergeData function removed - now using shared.js mergeData()

// Operation queue functions removed - now using shared.js sync system

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
    const allExpenses = shared.getExpenses(); // Get expenses from shared module
    
    // Filter by selected date and branch
    const filteredExpenses = allExpenses.filter(expense => 
        expense.date === selectedDate && expense.branch === selectedBranch
    );

    if (filteredExpenses.length === 0 && allExpenses.length > 0) {
        expenseList.innerHTML = `
            <div class="summary-card">
                <div class="summary-title">${formatDateDisplay(selectedDate)} Expenses</div>
                <div class="summary-amount">₱0.00</div>
                <div class="summary-count">0 transactions</div>
            </div>
            <div class="empty-state">
                <p>No expenses recorded for ${formatDateDisplay(selectedDate)} at ${selectedBranch}</p>
            </div>
        `;
        return;
    }

    if (allExpenses.length === 0) {
        expenseList.innerHTML = `
            <div class="summary-card">
                <div class="summary-title">${formatDateDisplay(selectedDate)} Expenses</div>
                <div class="summary-amount">₱0.00</div>
                <div class="summary-count">0 transactions</div>
            </div>
            <div class="empty-state">
                <p>No expenses recorded yet</p>
                <p style="font-size: 14px;">Click the + button to add your first expense</p>
            </div>
        `;
        return;
    }

    const filteredTotal = filteredExpenses.reduce((sum, expense) => sum + expense.totalAmount, 0);
    const summaryTitle = formatDateDisplay(selectedDate) + " Expenses";

    // Sort expenses by date (newest first)
    const sortedExpenses = [...filteredExpenses].sort((a, b) => new Date(b.date) - new Date(a.date));

    const summaryCard = `
    <div class="summary-card">
        <div class="summary-title">${summaryTitle}</div>
        <div class="summary-amount">₱${filteredTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="summary-count">${filteredExpenses.length} ${filteredExpenses.length === 1 ? 'transaction' : 'transactions'}</div>
    </div>
`;

    const expenseCards = sortedExpenses.map(expense => {
        const itemsText = expense.items.length > 3
            ? `${expense.items.slice(0, 3).map(item => item.name).join(', ')} + ${expense.items.length - 3} more`
            : expense.items.map(item => item.name).join(', ');

        const isToday = expense.date === getTodayLocal();

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

function formatDateDisplay(dateString) {
    const date = new Date(dateString + 'T00:00:00'); // Parse as local time
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Compare dates in local timezone
    if (date.getTime() === today.getTime()) {
        return "Today's";
    }
    
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });
}

function initializeDatePicker() {
    const prevBtn = document.getElementById('prevDate');
    const nextBtn = document.getElementById('nextDate');
    const dateDisplay = document.getElementById('dateDisplay');

    // Initialize with selected date
    updateDateDisplay();

    // Previous date button
    if (prevBtn) prevBtn.addEventListener('click', () => {
        const date = new Date(selectedDate);
        date.setDate(date.getDate() - 1);
        selectedDate = date.toISOString().split('T')[0];
        updateDateDisplay();
        loadDashboard();
    });

    // Next date button
    if (nextBtn) nextBtn.addEventListener('click', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const date = new Date(selectedDate + 'T00:00:00'); // Parse as local time
        date.setHours(0, 0, 0, 0);

        // Don't allow going beyond today
        if (date < today) {
            const nextDate = new Date(selectedDate + 'T00:00:00');
            nextDate.setDate(nextDate.getDate() + 1);
            selectedDate = getTodayLocal(); // Use local time helper
            const year = nextDate.getFullYear();
            const month = String(nextDate.getMonth() + 1).padStart(2, '0');
            const day = String(nextDate.getDate()).padStart(2, '0');
            selectedDate = `${year}-${month}-${day}`;
            updateDateDisplay();
            loadDashboard();
        }
    });

    // Click on date to open calendar picker
    if (dateDisplay) dateDisplay.addEventListener('click', () => {
        openDateModal();
    });
}

function updateDateDisplay() {
    const dateDisplay = document.getElementById('dateDisplay');
    if (!dateDisplay) return;

    const date = new Date(selectedDate);
    const displayText = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });

    dateDisplay.textContent = displayText;

    // Update next button state
    const nextBtn = document.getElementById('nextDate');
    if (nextBtn) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selectedDateCopy = new Date(selectedDate + 'T00:00:00'); // Parse as local time
        selectedDateCopy.setHours(0, 0, 0, 0);

        if (selectedDateCopy.getTime() >= today.getTime()) {
            nextBtn.style.opacity = '0.3';
            nextBtn.style.cursor = 'not-allowed';
            nextBtn.disabled = true;
        } else {
            nextBtn.style.opacity = '1';
            nextBtn.style.cursor = 'pointer';
            nextBtn.disabled = false;
        }
    }
}

function initializeBranchSelect() {
    const branchSelect = document.getElementById('branchSelect');
    if (!branchSelect) {
        console.warn('Branch select element not found');
        return;
    }

    // Load from localStorage again to ensure we have the latest value
    const savedBranch = localStorage.getItem('expense-selected-branch');
    if (savedBranch) {
        selectedBranch = savedBranch;
    }

    // Set initial value on the select element
    branchSelect.value = selectedBranch;
    
    // Verify the value was set
    if (branchSelect.value !== selectedBranch) {
        console.warn('Failed to set branch select value, trying again...');
        setTimeout(() => {
            branchSelect.value = selectedBranch;
        }, 100);
    }

    branchSelect.addEventListener('change', (e) => {
        selectedBranch = e.target.value;
        localStorage.setItem('expense-selected-branch', selectedBranch);
        console.log('Branch saved to localStorage:', selectedBranch);
        loadDashboard();
    });
}

function openDateModal() {
    const modal = document.getElementById('dateModalOverlay');
    if (!modal) return;

    const currentDate = new Date(selectedDate);
    let viewMonth = currentDate.getMonth();
    let viewYear = currentDate.getFullYear();

    const modalMonthYear = document.getElementById('modalMonthYear');
    const dateGrid = document.getElementById('dateGrid');
    const modalPrevMonth = document.getElementById('modalPrevMonth');
    const modalNextMonth = document.getElementById('modalNextMonth');
    const todayBtn = document.getElementById('todayBtn');
    const cancelBtn = document.getElementById('dateCancelBtn');

    function renderCalendar() {
        if (!modalMonthYear || !dateGrid) return;

        const firstDay = new Date(viewYear, viewMonth, 1);
        const lastDay = new Date(viewYear, viewMonth + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();

        modalMonthYear.textContent = firstDay.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });

        dateGrid.innerHTML = '';

        // Empty cells for days before month starts
        for (let i = 0; i < startingDayOfWeek; i++) {
            const cell = document.createElement('div');
            cell.className = 'date-cell other-month';
            dateGrid.appendChild(cell);
        }

        // Days of the month
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let day = 1; day <= daysInMonth; day++) {
            const cell = document.createElement('div');
            const cellDate = new Date(viewYear, viewMonth, day);
            cellDate.setHours(0, 0, 0, 0);
            // Format as local date string (YYYY-MM-DD)
            const year = cellDate.getFullYear();
            const month = String(cellDate.getMonth() + 1).padStart(2, '0');
            const dayStr = String(cellDate.getDate()).padStart(2, '0');
            const dateString = `${year}-${month}-${dayStr}`;

            cell.textContent = day;
            cell.className = 'date-cell';

            // Check if this is the selected date
            if (dateString === selectedDate) {
                cell.classList.add('selected');
            }

            // Check if this is today
            if (cellDate.getTime() === today.getTime()) {
                cell.classList.add('today');
            }

            // Disable future dates
            if (cellDate > today) {
                cell.classList.add('disabled');
            } else {
                cell.addEventListener('click', () => {
                    selectedDate = dateString;
                    updateDateDisplay();
                    loadDashboard();
                    closeDateModal();
                });
            }

            dateGrid.appendChild(cell);
        }
    }

    if (modalPrevMonth) {
        modalPrevMonth.onclick = () => {
            viewMonth--;
            if (viewMonth < 0) {
                viewMonth = 11;
                viewYear--;
            }
            renderCalendar();
        };
    }

    if (modalNextMonth) {
        modalNextMonth.onclick = () => {
            viewMonth++;
            if (viewMonth > 11) {
                viewMonth = 0;
                viewYear++;
            }
            renderCalendar();
        };
    }

    if (todayBtn) {
        todayBtn.onclick = () => {
            selectedDate = getTodayLocal();
            updateDateDisplay();
            loadDashboard();
            closeDateModal();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = closeDateModal;
    }

    // Close on overlay click
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeDateModal();
        }
    };

    renderCalendar();
    modal.style.display = 'flex';
}

function closeDateModal() {
    const modal = document.getElementById('dateModalOverlay');
    if (modal) {
        modal.style.display = 'none';
    }
}

function viewExpense(expenseId) {
    const allExpenses = shared.getExpenses();
    const expense = allExpenses.find(e => e.id === expenseId);
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
    const isToday = expense.date === getTodayLocal();
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
    if (totalInput) {
        totalInput.value = '';
        // Unlock total input when modal is reset (no items = no prices)
        totalInput.readOnly = false;
        totalInput.style.backgroundColor = '';
        totalInput.style.cursor = '';
        totalInput.style.opacity = '1';
    }

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
    const expenses = shared.getExpenses();

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
    const expenses = shared.getExpenses();

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
    if (!supplierInput) return;

    createAutocomplete(
        supplierInput,
        (query) => {
            const allSuppliers = shared.getSuppliers();
            const queryLower = query.toLowerCase().trim();
            const suppliersList = allSuppliers.map(supplier => {
                const name = supplier.name.toLowerCase();
                const businessName = (supplier.businessName || '').toLowerCase();
                let priority = 999;

                if (!queryLower) {
                    priority = 7; // Show all when no query
                } else if (name.startsWith(queryLower)) {
                    priority = 1;
                } else if (businessName.startsWith(queryLower)) {
                    priority = 2;
                } else if (name.split(' ').some(word => word.startsWith(queryLower))) {
                    priority = 3;
                } else if (businessName.split(' ').some(word => word.startsWith(queryLower))) {
                    priority = 4;
                } else if (name.includes(queryLower)) {
                    priority = 5;
                } else if (businessName.includes(queryLower)) {
                    priority = 6;
                }

                return {
                    ...supplier,
                    priority,
                    display: `<div style="font-weight: 500;">${supplier.name}</div><div style="font-size: 12px; color: #666;">${supplier.businessName || 'No business name'}</div>`
                };
            });

            return suppliersList
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
    const allSuppliers = shared.getSuppliers();
    const supplier = allSuppliers.find(s => s.id === supplierId);
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
                <input type="text" name="itemPrice" placeholder="₱0.00" inputmode="decimal" onchange="formatPesoInput(this); updateFromItems()" onblur="formatPesoInput(this); updateFromItems()" oninput="updateFromItems()" style="touch-action: manipulation;">
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
    const totalInput = document.getElementById('totalAmountInput');
    if (totalInput) {
        totalInput.value = '';
        // Unlock total input when clearing (no prices = manual entry allowed)
        totalInput.readOnly = false;
        totalInput.style.backgroundColor = '';
        totalInput.style.cursor = '';
        totalInput.style.opacity = '1';
    }

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

    // Collect items from form
    const items = [];
    const itemRows = document.querySelectorAll('.item-row');
    const totalAmountInput = document.getElementById('totalAmountInput');
    const totalAmount = totalAmountInput ? shared.getPesoValue(totalAmountInput) : 0;

    itemRows.forEach(row => {
        const name = row.querySelector('[name="itemName"]').value;
        if (name && name.trim()) {
            const quantity = parseFloat(row.querySelector('[name="itemQuantity"]').value) || 1;
            const priceInput = row.querySelector('[name="itemPrice"]');
            const price = priceInput ? shared.getPesoValue(priceInput) : 0;
            items.push({
                name: name.trim(),
                quantity,
                price,
                total: shared.calculateItemTotal(quantity, price)
            });
        }
    });

    // Get existing expense data if editing
    const existingExpense = isEditing ? shared.getExpenses().find(e => e.id === window.editingExpenseId) : null;
    
    // Build data object for expense creation
    // Get branch from the branch selector dropdown (not hidden field)
    const branchSelect = document.getElementById('branchSelect');
    const selectedBranch = branchSelect ? branchSelect.value : 'SM North';
    
    const expenseData = {
        items: items,
        totalAmount: totalAmount, // Use provided total (mobile app has separate input)
        date: getElementValue('expenseDate', shared.getTodayLocal()),
        branch: selectedBranch,
        supplierName: getElementValue('supplierName'),
        businessName: getElementValue('businessName'),
        tin: getElementValue('tin'),
        address: getElementValue('address'),
        invoiceNumber: getElementValue('invoiceNumber'),
        expenseCategory: getElementValue('expenseCategory', 'General'),
        vatExemptAmount: parseFloat(getElementValue('vatExemptAmount')) || 0,
        paymentMethod: getElementValue('paymentMethod', 'Cash'),
        paidBy: getElementValue('paidBy'),
        notes: getElementValue('notes'),
        receiptImage: window.currentReceiptData || (existingExpense?.receiptImage || null),
        vatComputationEnabled: document.getElementById('vatComputationEnabled')?.checked || false
    };

    // Create expense using shared function
    const result = shared.createExpenseObject(expenseData, {
        existingExpense: existingExpense,
        isEditing: isEditing,
        calculateTotalFromItems: false, // Mobile app uses separate total input
        autoCalculateVAT: true,
        validate: true
    });

    // Check for validation errors
    if (!result.success) {
        showToast(result.errors.join(', '));
        return;
    }

    const expense = result.expense;

    if (isEditing) {
        // Update existing expense using shared function
        const success = shared.updateExpense(window.editingExpenseId, expense);
        if (success) {
            showToast('Expense updated successfully!');
        } else {
            showToast('Failed to update expense');
            return;
        }

        // Clear editing state
        delete window.editingExpenseId;
        document.querySelector('.modal-title').textContent = 'Add Expense';
    } else {
        // Create new expense using shared function
        shared.addExpense(expense);
        showToast('Expense saved successfully!');
    }

    // Check if supplier is new and show add supplier modal
    const supplierName = expense.supplierName.trim();
    const allSuppliers = shared.getSuppliers();
    const existingSupplier = allSuppliers.find(s =>
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
    const allSuppliers = shared.getSuppliers();
    const existingSupplier = allSuppliers.find(s =>
        s.name.toLowerCase() === supplierName.toLowerCase() ||
        (businessName && s.businessName.toLowerCase() === businessName.toLowerCase())
    );

    if (!existingSupplier) {
        const newSupplier = {
            id: shared.generateId(),
            name: supplierName,
            businessName: businessName || '',
            tin: expense.tin || '',
            address: expense.address || '',
            isVatRegistered: expense.isVatRegistered || false,
            createdAt: new Date().toISOString()
        };

        shared.addSupplier(newSupplier);
        
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
            id: shared.generateId(),
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
            id: shared.generateId(),
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
            id: shared.generateId(),
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
            id: shared.generateId(),
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
    // saveToLocalStorage() call removed - now handled by shared.js

    // Also create sample suppliers
    const sampleSuppliers = [
        {
            id: shared.generateId(),
            name: 'Metro Supermarket',
            businessName: 'Metro Retail Stores Group Inc.',
            tin: '123-456-789-000',
            address: 'SM North EDSA, Quezon City',
            createdAt: new Date().toISOString()
        },
        {
            id: shared.generateId(),
            name: 'Puregold',
            businessName: 'Puregold Price Club Inc.',
            tin: '987-654-321-000',
            address: 'The Podium, Ortigas Center',
            createdAt: new Date().toISOString()
        },
        {
            id: shared.generateId(),
            name: 'Office Warehouse',
            businessName: 'Office Warehouse Inc.',
            tin: '555-666-777-000',
            address: 'Makati Avenue, Makati City',
            createdAt: new Date().toISOString()
        },
        {
            id: shared.generateId(),
            name: 'FoodSource Co.',
            businessName: 'FoodSource Corporation',
            tin: '111-222-333-000',
            address: 'BGC, Taguig City',
            createdAt: new Date().toISOString()
        }
    ];

    suppliers = sampleSuppliers;
    // saveToLocalStorage() call removed - now handled by shared.js
}

// Utility functions
// generateId removed - using shared.generateId() instead

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
    // saveToLocalStorage() call removed - now handled by shared.js
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
    let hasAnyPrice = false;

    itemRows.forEach(row => {
        const breakdown = row.querySelector('.item-breakdown');
        breakdown.style.display = 'flex';

        const quantityInput = row.querySelector('[name="itemQuantity"]');
        const quantity = quantityInput ? (parseFloat(quantityInput.value) || 0) : 0;
        
        const priceInput = row.querySelector('[name="itemPrice"]');
        // Only get price if input exists and has a real value (not just placeholder or empty)
        let price = 0;
        if (priceInput && priceInput.value && priceInput.value.trim() !== '' && priceInput.value.trim() !== '₱0.00') {
            const parsedPrice = shared.getPesoValue(priceInput);
            // Only count as having a price if it's actually > 0
            if (parsedPrice > 0) {
                price = parsedPrice;
                hasAnyPrice = true;
            }
        }
        
        total += shared.calculateItemTotal(quantity, price);
    });

    const totalInput = document.getElementById('totalAmountInput');
    if (totalInput) {
        // Lock/unlock total input based on whether items have prices
        if (hasAnyPrice) {
            // Lock total input when items have prices (auto-calculated)
            totalInput.readOnly = true;
            totalInput.style.backgroundColor = '#f8f9fa';
            totalInput.style.cursor = 'not-allowed';
            totalInput.style.opacity = '0.7';
            
            // Auto-calculate and format total
            totalInput.value = shared.formatCurrency(total);
        } else {
            // Unlock total input when all items have price = 0 (manual entry allowed)
            totalInput.readOnly = false;
            totalInput.style.backgroundColor = '';
            totalInput.style.cursor = '';
            totalInput.style.opacity = '1';
            
            // Only format existing value if it exists and is not empty
            // Don't overwrite user's manual entry while they're typing
            const currentValue = totalInput.value.trim();
            if (currentValue && currentValue !== '₱0.00' && currentValue !== '') {
                const numericValue = shared.getPesoValue(totalInput);
                if (numericValue > 0) {
                    // Only format if there's a valid number
                    totalInput.value = shared.formatCurrency(numericValue);
                }
            }
        }
        
        updateVatCalculation();
    }
}
// Expose to global scope for inline event handlers
window.updateFromItems = updateFromItems;

function showItemDetails(itemId) {
    const details = document.getElementById(`itemDetails${itemId}`);
    details.classList.add('show');
}

function formatTotal() {
    const input = document.getElementById('totalAmountInput');
    if (!input) return;
    
    // Remove peso sign and commas before parsing
    let value = parseFloat(input.value.replace(/[₱,]/g, '')) || 0;
    
    // Format with peso sign and comma
    input.value = shared.formatCurrency(value);
}
// Expose to global scope for inline event handlers
window.formatTotal = formatTotal;

// formatPesoInput and getPesoValue removed - using shared functions instead
// Expose shared functions to global scope for inline event handlers
window.formatPesoInput = shared.formatPesoInput;

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

// findSimilarExpense removed - using shared.findSimilarExpense() instead

// mergeExpenseData removed - using shared.mergeExpenseData() instead

function parseAndImportCSV(csvText) {
    console.log('Raw CSV text:', csvText.substring(0, 500));

    const lines = csvText.split('\n').filter(line => line.trim());
    console.log('Total lines:', lines.length);

    if (lines.length < 2) {
        showToast('CSV file appears to be empty');
        hideImportProgress();
        return;
    }

    const headers = shared.parseCSVLine(lines[0]);
    console.log('Parsed headers:', headers);

    const importedExpenses = [];
    let successCount = 0;
    let errorCount = 0;

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
        try {
            const values = shared.parseCSVLine(lines[i]);

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
            // Temporarily set expenses to originalExpenses to search only in original data
            const currentExpenses = shared.getExpenses();
            shared.setExpenses(originalExpenses);
            const similarExpense = shared.findSimilarExpense(newExpense, 0.05);
            shared.setExpenses(currentExpenses); // Restore
            
            // Check if similar expense is in original expenses
            const similarInOriginal = similarExpense ? originalExpenses.find(e => e.id === similarExpense.id) : null;

            if (similarInOriginal) {
                // Found a similar expense in original data, merge it
                const mergedExpense = shared.mergeExpenseData(similarInOriginal, newExpense);

                // Update the existing expense in the main array
                const index = expenses.findIndex(e => e.id === similarInOriginal.id);
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
        expensesToAdd.forEach(expense => shared.addExpense(expense));

        // Extract and save new suppliers from all processed expenses
        importedExpenses.forEach(expense => saveSupplierIfNew(expense));

        // saveToLocalStorage() call removed - now handled by shared.js

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

// parseCSVLine removed - using shared.parseCSVLine() instead

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

    // Detect format type - check for different CSV formats
    const hasAccountingColumns = headers.some(h =>
        h.toLowerCase().includes('particulars') ||
        h.toLowerCase().includes('vatable') ||
        h.toLowerCase().includes('input') ||
        h.toLowerCase().includes('grosstaxable')
    );

    const hasMatchaneseFormat = headers.some(h =>
        h.toLowerCase().includes('item') &&
        headers.some(h2 => h2.toLowerCase().includes('supplier')) &&
        headers.some(h3 => h3.toLowerCase().includes('paid via')) &&
        headers.some(h4 => h4.toLowerCase().includes('category'))
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
        return parseMatchaneseFormatCSV(data, headers, values);
    } else if (hasAccountingColumns && !hasStandardColumns) {
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
    const allSuppliers = shared.getSuppliers();
    const existingSupplier = allSuppliers.find(s =>
        s.name.toLowerCase() === supplierName.toLowerCase() ||
        (s.tin && tin && s.tin === tin)
    );

    // Calculate VAT breakdown from the CSV data
    const vatableSale = parseFloat(data.vatablesales || data.vatablesale || '') || 0;
    const vatAmount = parseFloat(data.inputvat || '') || 0;

    const expense = {
        id: shared.generateId(),
        date: parsedDate.toISOString().split('T')[0],
        branch: branchName,
        supplierName: supplierName,
        businessName: supplierName, // Use same name for business name from CSV
        tin: tin,
        address: address,
        invoiceNumber: '',
        expenseCategory: 'General', // Default category for CSV imports
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
        id: shared.generateId(),
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
        id: shared.generateId(),
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
    const allSuppliers = shared.getSuppliers();
    const expenses = shared.getExpenses();

    if (allSuppliers.length === 0) {
        supplierList.innerHTML = `
            <div class="empty-state">
                <p>No suppliers found</p>
                <p style="font-size: 14px;">Suppliers will appear here after adding expenses</p>
            </div>
        `;
        return;
    }

    // Calculate supplier statistics
    const supplierStats = allSuppliers.map(supplier => {
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
    const allSuppliers = shared.getSuppliers();
    const supplier = allSuppliers.find(s => s.id === supplierId);
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
    const allExpenses = shared.getExpenses();
    const supplierExpenses = allExpenses.filter(expense =>
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

        const today = getTodayLocal();
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

// Removed filter functionality - now using date and branch filters only

// Close summary options when clicking outside
document.addEventListener('click', function (e) {
    const summaryCard = e.target.closest('.summary-card');
    const summaryOptions = document.getElementById('summaryOptions');

    if (!summaryCard && summaryOptions && summaryOptions.classList.contains('show')) {
        summaryOptions.classList.remove('show');
    }
});

// Global variable to track what we're confirming
let confirmationCallback = null;

function editExpense(expenseId, event) {
    event.stopPropagation();

    const allExpenses = shared.getExpenses();
    const expense = allExpenses.find(e => e.id === expenseId);
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
    const totalInput = document.getElementById('totalAmountInput');
    if (totalInput) {
        totalInput.value = shared.formatCurrency(expense.totalAmount || 0);
        // Check if items have prices to determine if input should be locked
        const hasItemPrices = expense.items && expense.items.some(item => item.price > 0);
        if (hasItemPrices) {
            totalInput.readOnly = true;
            totalInput.style.backgroundColor = '#f8f9fa';
            totalInput.style.cursor = 'not-allowed';
            totalInput.style.opacity = '0.7';
        } else {
            totalInput.readOnly = false;
            totalInput.style.backgroundColor = '';
            totalInput.style.cursor = '';
            totalInput.style.opacity = '1';
        }
    }

    // Handle VAT information if supplier is VAT registered
    const allSuppliers = shared.getSuppliers();
    const supplier = allSuppliers.find(s => s.name.toLowerCase() === expense.supplierName.toLowerCase());
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

    const allExpenses = shared.getExpenses();
    const expense = allExpenses.find(e => e.id === expenseId);
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
            // Remove expense using shared function
            const success = shared.deleteExpense(expenseId);
            if (success) {
                loadDashboard();
                showToast('Expense deleted successfully');
            } else {
                showToast('Failed to delete expense');
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
    const allSuppliers = shared.getSuppliers();
    const supplier = allSuppliers.find(s => s.id === supplierId);
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
    const allSuppliers = shared.getSuppliers();
    const existingSupplier = isEditing ? allSuppliers.find(s => s.id === isEditing) : null;

    // Collect form data
    const supplierData = {
        name: document.getElementById('supplierModalName').value,
        businessName: document.getElementById('supplierModalBusinessName').value,
        tin: document.getElementById('supplierModalTin').value,
        address: document.getElementById('supplierModalAddress').value,
        isVatRegistered: document.getElementById('supplierModalIsVatRegistered').checked
    };

    // Create supplier object using shared function
    const result = shared.createSupplierObject(supplierData, {
        existingSupplier: existingSupplier,
        isEditing: isEditing,
        validate: true
    });

    // Check for validation errors
    if (!result.success) {
        showToast(result.errors.join(', '));
        return;
    }

    const supplier = result.supplier;

    // Update all expenses from this supplier when editing
    if (isEditing && existingSupplier) {
        // Update expenses first, then supplier
        const updateResult = shared.updateExpensesForSupplier(existingSupplier, supplier);
        
        // Update the supplier
        const success = shared.updateSupplier(isEditing, supplier);
        if (success) {
            const expenseMsg = updateResult.updated > 0 ? 
                ` and updated ${updateResult.updated} expense${updateResult.updated === 1 ? '' : 's'}` : '';
            showToast(`Supplier updated successfully!${expenseMsg}`);
        } else {
            showToast('Failed to update supplier');
            return;
        }
    } else {
        // Add new supplier
        shared.addSupplier(supplier);
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
        // Create basic supplier using shared function
        const supplierData = {
            name: supplierName,
            businessName: '',
            tin: '',
            address: '',
            isVatRegistered: false
        };
        
        const result = shared.createSupplierObject(supplierData, {
            validate: false // Skip validation for basic supplier
        });
        
        if (result.success) {
            shared.addSupplier(result.supplier);
        }
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
    const allSuppliers = shared.getSuppliers();
    const targetSupplier = allSuppliers.find(s => s.id === targetSupplierId);
    if (!targetSupplier) {
        showToast('Supplier not found');
        return;
    }

    const modal = document.getElementById('mergeSupplierModalOverlay');
    const content = document.getElementById('mergeSupplierContent');
    const title = modal.querySelector('.modal-title');

    title.textContent = `Merge Suppliers into ${targetSupplier.name}`;

    // Get other suppliers (excluding the target)
    const otherSuppliers = allSuppliers.filter(s => s.id !== targetSupplierId);

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
        const allExpenses = shared.getExpenses();
        const supplierExpenseCount = allExpenses.filter(e =>
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
    const allSuppliers = shared.getSuppliers();
    const targetSupplier = allSuppliers.find(s => s.id === targetSupplierId);
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

    const suppliersToMerge = allSuppliers.filter(s => supplierIdsToMerge.includes(s.id));
    const supplierNamesToMerge = suppliersToMerge.map(s => s.name);

    // Show confirmation
    showConfirmationModal(
        'Confirm Merge',
        `Are you sure you want to merge ${supplierNamesToMerge.join(', ')} into ${targetSupplier.name}? This will transfer all expenses and cannot be undone.`,
        'Merge',
        async () => {
            await performSupplierMerge(targetSupplier, suppliersToMerge);
        }
    );
}
// Expose to global scope for inline event handlers
window.executeMerge = executeMerge;

async function performSupplierMerge(targetSupplier, suppliersToMerge) {
    let totalTransferred = 0;
    const expenses = shared.getExpenses();

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

    // Save updated expenses
    expenses.forEach(expense => {
        shared.updateExpense(expense.id, expense);
    });

    // Remove the merged suppliers using shared.js (await all deletions)
    const supplierIdsToRemove = suppliersToMerge.map(s => s.id);
    await Promise.all(supplierIdsToRemove.map(supplierId => shared.deleteSupplier(supplierId)));

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
// Expose to global scope for inline event handlers
window.mergeSupplierFromDetail = mergeSupplierFromDetail;

function deleteSupplierFromDetail(supplierId) {
    const allSuppliers = shared.getSuppliers();
    const supplier = allSuppliers.find(s => s.id === supplierId);
    if (!supplier) {
        showToast('Supplier not found');
        return;
    }

    // Check if supplier can be deleted using shared function
    if (!shared.canDeleteSupplier) {
        console.error('shared.canDeleteSupplier is not available. This usually means shared.js is cached. Please do a hard refresh (Ctrl+Shift+R or Cmd+Shift+R)');
        showToast('Error: Please refresh the page to load latest updates (Ctrl+Shift+R)');
        return;
    }
    const canDelete = shared.canDeleteSupplier(supplierId);
    
    if (!canDelete.canDelete) {
        showConfirmationModal(
            'Cannot Delete Supplier',
            `Cannot delete "${supplier.name}" because ${canDelete.reason}. Please delete all expenses first or merge this supplier with another.`,
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
        async () => {
            // Remove supplier from array and Firebase using shared function
            const success = await shared.deleteSupplier(supplierId);
            if (success) {
                // Close detail modal and refresh
                closeSupplierDetailModal();
                showToast('Supplier deleted successfully');

                // Refresh suppliers page if currently viewing it
                if (document.getElementById('suppliersPage').style.display !== 'none') {
                    loadSuppliers();
                }
            } else {
                showToast('Failed to delete supplier');
            }
        }
    );
}
// Expose to global scope for inline event handlers
window.deleteSupplierFromDetail = deleteSupplierFromDetail;

// saveToLocalStorage function removed - now using shared.js saveToLocalStorage()

function viewSupplierFromExpense(supplierName) {
    const allSuppliers = shared.getSuppliers();
    const supplier = allSuppliers.find(s =>
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
// Expose to global scope for inline event handlers
window.viewSupplierFromExpense = viewSupplierFromExpense;


function updateVatCalculation() {
    const totalAmountInput = document.getElementById('totalAmountInput');
    const totalAmount = totalAmountInput ? shared.getPesoValue(totalAmountInput) : 0;
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
// Expose to global scope for inline event handlers
window.updateVatCalculation = updateVatCalculation;

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
// Expose to global scope for inline event handlers
window.handleTotalChange = handleTotalChange;

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
// Expose to global scope for inline event handlers
window.toggleVatRegistered = toggleVatRegistered;
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
// Expose to global scope for inline event handlers
window.toggleVatComputation = toggleVatComputation;

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
// showSummaryOptions and selectSummaryFilter removed - functions not defined
window.showAddSupplierModal = showAddSupplierModal;
window.closeSupplierModal = closeSupplierModal;
window.handleSupplierFormSubmission = handleSupplierFormSubmission;
window.skipSupplierDetails = skipSupplierDetails;
window.editSupplierFromDetail = editSupplierFromDetail;
window.deleteSupplierFromDetail = deleteSupplierFromDetail;
window.showMergeSupplierModal = showMergeSupplierModal;
// Note: closeMergeSupplierModal, executeMerge, mergeSupplierFromDetail, viewSupplierFromExpense,
// updateVatCalculation, toggleVatRegistered, formatPesoInput, and updateFromItems are now
// exposed immediately after their definitions above for better reliability