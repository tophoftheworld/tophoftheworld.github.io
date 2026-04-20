import * as shared from './shared.js?v=1.5.57';
import {
    createAutocomplete,
    getItemMatches,
    buildSupplierMatchList,
} from './autocomplete.js?v=1.5.42';

const ADMIN_PAID_BY_OPTIONS = ['Store Cash', 'Company'];

function normalizeAdminPaidBy(value) {
    const v = (value || '').trim();
    return ADMIN_PAID_BY_OPTIONS.includes(v) ? v : 'Company';
}

function adminBuildExpenseCategoryOptionsHtml(expenseCategoryRaw) {
    const selectedVal =
        expenseCategoryRaw != null && String(expenseCategoryRaw).trim() !== ''
            ? String(expenseCategoryRaw).trim()
            : shared.DEFAULT_EXPENSE_CATEGORY;
    const vals = shared.getExpenseCategorySelectOptionValues(selectedVal);
    return vals
        .map(
            (v) =>
                `<option value="${escapeHtml(v)}"${v === selectedVal ? ' selected' : ''}>${escapeHtml(v)}</option>`
        )
        .join('');
}

function populateAdminCategoryFilter() {
    const sel = document.getElementById('categorySelector');
    if (!sel) return;
    const prev = sel.value;
    const expenses = shared.getExpenses();
    const filterVals = shared.getExpenseCategoryFilterOptionValues(expenses);
    const parts = ['<option value="all">All Categories</option>'];
    for (const v of filterVals) {
        parts.push(`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`);
    }
    sel.innerHTML = parts.join('');
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else sel.value = 'all';
}

/** Inline green check (saved supplier), not “verified” in a legal sense */
const ADMIN_SUPPLIER_SAVED_CHECK_SVG = `<svg class="admin-supplier-saved-check-svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#2b9348"/><path d="M7 12l3 3 7-7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function adminSetSupplierVerifiedDetailRows(tin, address) {
    const tinRow = document.getElementById('adminSupplierVerifiedTinRow');
    const addrRow = document.getElementById('adminSupplierVerifiedAddrRow');
    const tinEl = document.getElementById('adminSupplierVerifiedTin');
    const addrEl = document.getElementById('adminSupplierVerifiedAddr');
    const t = (tin || '').trim();
    const a = (address || '').trim();
    if (tinRow && tinEl) {
        if (t) {
            tinEl.textContent = t;
            tinRow.classList.remove('admin-hidden');
        } else {
            tinEl.textContent = '';
            tinRow.classList.add('admin-hidden');
        }
    }
    if (addrRow && addrEl) {
        if (a) {
            addrEl.textContent = a;
            addrRow.classList.remove('admin-hidden');
        } else {
            addrEl.textContent = '';
            addrRow.classList.add('admin-hidden');
        }
    }
}

// Pagination state
let currentPage = 1;
let itemsPerPage = 25;
let totalFilteredExpenses = [];

/** Expenses table sort; default newest-first. Shared state with suppliers table (reset when switching tabs). */
let currentSort = { column: 'date', direction: 'desc' };

// View state
let dateRangeInput = null;
let adminRefreshIntervalId = null;
let adminRefreshInFlight = false;

/** @type {HTMLElement | null} */
let adminExpenseModalEl = null;
/** @type {HTMLElement | null} */
let adminSupplierModalEl = null;
let adminPendingReceiptUrl = null;
let adminExpenseModalDirty = false;
let adminSupplierExpenseSort = { column: 'date', direction: 'desc' };
let adminSupplierExpensePage = 1;
let adminConfirmationCallback = null;
/** Target supplier id while single-supplier merge modal is open */
let adminMergeTargetId = null;

function hideAdminSingleMergeProgressUI() {
    const modal = document.getElementById('mergeSupplierModalOverlay');
    const progress = document.getElementById('mergeModalProgress');
    modal?.classList.remove('merge-in-progress');
    progress?.classList.remove('is-visible');
    progress?.setAttribute('aria-hidden', 'true');
}

function setAdminSingleMergeProgressVisible(visible) {
    const modal = document.getElementById('mergeSupplierModalOverlay');
    const progress = document.getElementById('mergeModalProgress');
    modal?.classList.toggle('merge-in-progress', visible);
    progress?.classList.toggle('is-visible', visible);
    progress?.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function updateAdminSingleMergeProgressUI(step, total, message) {
    const stepEl = document.getElementById('mergeModalProgressStep');
    const countEl = document.getElementById('mergeModalProgressCount');
    if (stepEl) stepEl.textContent = message || '';
    if (countEl) countEl.textContent = total ? `Step ${step} of ${total}` : '';
}

function hideAdminBulkMergeProgressUI() {
    const overlay = document.getElementById('bulkMergeModalOverlay');
    const progress = document.getElementById('bulkMergeModalProgress');
    overlay?.classList.remove('merge-in-progress');
    progress?.classList.remove('is-visible');
    progress?.setAttribute('aria-hidden', 'true');
}

function setAdminBulkMergeProgressVisible(visible) {
    const overlay = document.getElementById('bulkMergeModalOverlay');
    const progress = document.getElementById('bulkMergeModalProgress');
    overlay?.classList.toggle('merge-in-progress', visible);
    progress?.classList.toggle('is-visible', visible);
    progress?.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function updateAdminBulkMergeProgressUI(step, total, message) {
    const stepEl = document.getElementById('bulkMergeProgressStep');
    const countEl = document.getElementById('bulkMergeProgressCount');
    if (stepEl) stepEl.textContent = message || '';
    if (countEl) countEl.textContent = total ? `Step ${step} of ${total}` : '';
}

function closeAdminMergeSupplierModal() {
    const modal = document.getElementById('mergeSupplierModalOverlay');
    if (modal?.classList.contains('merge-in-progress')) return;
    hideAdminSingleMergeProgressUI();
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
    adminMergeTargetId = null;
}
window.closeAdminMergeSupplierModal = closeAdminMergeSupplierModal;

/** Dim full UI + spinner during merge (admin uses same classes as mobile expenses app). */
let adminBusyOverlayEl = null;

function showAdminBusyOverlay(message = 'Working…') {
    if (!adminBusyOverlayEl) {
        adminBusyOverlayEl = document.createElement('div');
        adminBusyOverlayEl.id = 'adminBusyOverlay';
        adminBusyOverlayEl.className = 'app-busy-overlay';
        adminBusyOverlayEl.setAttribute('aria-busy', 'true');
        adminBusyOverlayEl.setAttribute('role', 'status');
        adminBusyOverlayEl.innerHTML = `<div class="app-busy-modal" role="dialog" aria-modal="true" aria-live="polite">
        <div class="app-busy-spinner" aria-hidden="true"></div>
        <p class="app-busy-message"></p>
    </div>`;
        document.body.appendChild(adminBusyOverlayEl);
    }
    const msgEl = adminBusyOverlayEl.querySelector('.app-busy-message');
    if (msgEl) msgEl.textContent = message;
    adminBusyOverlayEl.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function updateAdminBusyOverlayMessage(message) {
    const el = adminBusyOverlayEl?.querySelector('.app-busy-message');
    if (el) el.textContent = message;
}

function hideAdminBusyOverlay() {
    if (adminBusyOverlayEl) {
        adminBusyOverlayEl.classList.remove('show');
    }
    document.body.style.overflow = '';
}

function setupAdminSingleMergeModal() {
    if (window._adminSingleMergeWired) return;
    window._adminSingleMergeWired = true;
    const overlay = document.getElementById('mergeSupplierModalOverlay');
    overlay?.addEventListener('click', (e) => {
        if (overlay.classList.contains('merge-in-progress')) return;
        if (e.target === overlay || e.target.closest('#mergeModalCloseBtn')) {
            closeAdminMergeSupplierModal();
        }
    });
}

function showAdminMergeSupplierModal(targetSupplierId) {
    setupAdminSingleMergeModal();
    const allSuppliers = shared.getSuppliers();
    const targetSupplier = allSuppliers.find((s) => s.id === targetSupplierId);
    if (!targetSupplier) {
        shared.showToast('Supplier not found');
        return;
    }
    const otherSuppliers = allSuppliers.filter((s) => s.id !== targetSupplierId);
    if (otherSuppliers.length === 0) {
        shared.showToast('No other suppliers available to merge');
        return;
    }

    adminMergeTargetId = targetSupplierId;
    const modal = document.getElementById('mergeSupplierModalOverlay');
    const content = document.getElementById('mergeSupplierContent');
    const title = modal?.querySelector('.modal-title');
    if (!modal || !content) return;
    if (title) title.textContent = `Merge suppliers into ${targetSupplier.name}`;

    content.innerHTML = `
    <div class="merge-info">
        <p>Select suppliers to merge into <strong>${escapeHtml(targetSupplier.name)}</strong>. All expenses from selected suppliers will point to this supplier.</p>
    </div>
    <div class="merge-search-container">
        <div class="form-group">
            <input type="text" id="mergeSupplierSearch" placeholder="Search suppliers..." style="margin-bottom: 0;">
        </div>
    </div>
    <div class="merge-supplier-list" id="mergeSupplierList">
        ${otherSuppliers
            .map((s) => {
                const supplierExpenseCount = shared
                    .getExpenses()
                    .filter((e) => shared.expenseBelongsToSupplier(e, s)).length;
                const sn = (s.name || '').toLowerCase().replace(/"/g, '');
                const sb = (s.businessName || '').toLowerCase().replace(/"/g, '');
                return `
                <div class="merge-supplier-item" data-supplier-name="${sn}" data-supplier-business="${sb}">
                    <label class="merge-checkbox-container">
                        <input type="checkbox" value="${escapeHtml(s.id)}" class="merge-supplier-checkbox">
                        <span class="merge-checkmark"></span>
                        <div class="merge-supplier-info">
                            <div class="merge-supplier-name">${escapeHtml(s.name)}</div>
                            ${s.businessName ? `<div class="merge-supplier-business">${escapeHtml(s.businessName)}</div>` : ''}
                            <div class="merge-supplier-count">${supplierExpenseCount} expense${supplierExpenseCount === 1 ? '' : 's'}</div>
                        </div>
                    </label>
                </div>`;
            })
            .join('')}
    </div>
    <div class="merge-actions">
        <button type="button" class="cancel-btn" id="mergeCancelBtn">Cancel</button>
        <button type="button" class="merge-btn" id="mergeExecuteBtn">Merge selected</button>
    </div>`;

    document.getElementById('mergeCancelBtn')?.addEventListener('click', closeAdminMergeSupplierModal);
    document.getElementById('mergeExecuteBtn')?.addEventListener('click', executeAdminMergeSelected);

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
        const searchInput = document.getElementById('mergeSupplierSearch');
        const supplierItems = document.querySelectorAll('#mergeSupplierList .merge-supplier-item');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                const query = this.value.toLowerCase().trim();
                supplierItems.forEach((item) => {
                    const supplierName = item.getAttribute('data-supplier-name') || '';
                    const supplierBusiness = item.getAttribute('data-supplier-business') || '';
                    const matches = supplierName.includes(query) || supplierBusiness.includes(query);
                    item.style.display = matches || query === '' ? 'block' : 'none';
                });
                const visibleItems = Array.from(supplierItems).filter((item) => item.style.display !== 'none');
                let noResultsMsg = document.getElementById('noMergeResults');
                if (visibleItems.length === 0 && query !== '') {
                    if (!noResultsMsg) {
                        noResultsMsg = document.createElement('div');
                        noResultsMsg.id = 'noMergeResults';
                        noResultsMsg.className = 'no-results-message';
                        noResultsMsg.textContent = 'No suppliers match your search.';
                        document.getElementById('mergeSupplierList')?.appendChild(noResultsMsg);
                    }
                } else if (noResultsMsg) {
                    noResultsMsg.remove();
                }
            });
        }
    }, 50);
}
window.showAdminMergeSupplierModal = showAdminMergeSupplierModal;

function executeAdminMergeSelected() {
    const targetId = adminMergeTargetId;
    if (!targetId) return;
    const selectedIds = Array.from(document.querySelectorAll('.merge-supplier-checkbox:checked')).map(
        (cb) => cb.value
    );
    if (selectedIds.length === 0) {
        shared.showToast('Select at least one supplier to merge');
        return;
    }
    const all = shared.getSuppliers();
    const target = all.find((s) => s.id === targetId);
    if (!target) return;
    const names = selectedIds
        .map((id) => all.find((s) => s.id === id)?.name)
        .filter(Boolean);
    showAdminConfirmation(
        'Confirm merge',
        `Merge ${names.join(', ')} into ${target.name}? This cannot be undone.`,
        'Merge',
        async () => {
            setAdminSingleMergeProgressVisible(true);
            updateAdminSingleMergeProgressUI(1, 1, 'Preparing merge…');
            try {
                const r = await shared.mergeSuppliersIntoTarget(
                    targetId,
                    selectedIds,
                    (step, total, msg) => updateAdminSingleMergeProgressUI(step, total, msg)
                );
                if (r.success) {
                    shared.showToast(
                        `Merged suppliers; ${r.transferred} expense row(s) updated${r.deleted ? `; ${r.deleted} supplier row(s) removed` : ''}`
                    );
                    setAdminSingleMergeProgressVisible(false);
                    hideAdminSingleMergeProgressUI();
                    closeAdminMergeSupplierModal();
                    closeAdminSupplierModal();
                    refreshAdminTables();
                } else {
                    shared.showToast(r.error || 'Merge failed');
                }
            } catch (err) {
                console.error('Admin merge', err);
                shared.showToast('Merge failed. Please try again.');
            } finally {
                setAdminSingleMergeProgressVisible(false);
                hideAdminSingleMergeProgressUI();
            }
        }
    );
}

function adminPromptDeleteSupplier(supplierId) {
    const supplier = shared.getSuppliers().find((s) => s.id === supplierId);
    if (!supplier) {
        shared.showToast('Supplier not found');
        return;
    }
    if (!shared.canDeleteSupplier) {
        shared.showToast('Please refresh the page (Ctrl+Shift+R)');
        return;
    }
    const can = shared.canDeleteSupplier(supplierId);
    if (!can.canDelete) {
        showAdminConfirmation(
            'Cannot delete supplier',
            `Cannot delete "${supplier.name}" because ${can.reason}. Merge with another supplier or remove those expenses first.`,
            'OK',
            () => {}
        );
        return;
    }
    showAdminConfirmation(
        'Delete supplier',
        `Permanently delete "${supplier.name}" and all linked expenses? This cannot be undone.`,
        'Delete',
        async () => {
            showAdminBusyOverlay('Deleting supplier…');
            try {
                const ok = await shared.deleteSupplier(supplierId);
                if (ok) {
                    shared.showToast('Supplier deleted');
                    closeAdminSupplierModal();
                    refreshAdminTables();
                } else {
                    shared.showToast('Delete failed');
                }
            } finally {
                hideAdminBusyOverlay();
            }
        }
    );
}

function closeAdminSupplierEditOverlay() {
    document.getElementById('adminSupplierEditOverlay')?.remove();
}

function openAdminSupplierEditModal(supplierId) {
    const supplier = shared.getSuppliers().find((s) => s.id === supplierId);
    if (!supplier) {
        shared.showToast('Supplier not found');
        return;
    }
    closeAdminSupplierEditOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'adminSupplierEditOverlay';
    overlay.className = 'admin-supplier-edit-overlay';
    overlay.innerHTML = `
        <div class="admin-supplier-edit-dialog" role="dialog" aria-labelledby="adminSupplierEditTitle">
            <div class="admin-supplier-edit-header">
                <h2 id="adminSupplierEditTitle">Edit supplier</h2>
                <button type="button" class="admin-modal-icon-btn" aria-label="Close" data-admin-edit-close>&times;</button>
            </div>
            <form class="admin-supplier-edit-form" id="adminSupplierEditForm">
                <div class="admin-field">
                    <label for="adminEditSupName">Supplier name</label>
                    <input type="text" id="adminEditSupName" required value="${escapeHtml(supplier.name)}">
                </div>
                <div class="admin-field">
                    <label for="adminEditSupBiz">Business name</label>
                    <input type="text" id="adminEditSupBiz" value="${escapeHtml(supplier.businessName || '')}">
                </div>
                <div class="admin-field">
                    <label for="adminEditSupTin">TIN</label>
                    <input type="text" id="adminEditSupTin" value="${escapeHtml(supplier.tin || '')}">
                </div>
                <div class="admin-field">
                    <label for="adminEditSupAddr">Address</label>
                    <textarea id="adminEditSupAddr" rows="2">${escapeHtml(supplier.address || '')}</textarea>
                </div>
                <label class="admin-supplier-edit-vat">
                    <input type="checkbox" id="adminEditSupVat" ${supplier.isVatRegistered ? 'checked' : ''}>
                    VAT registered
                </label>
                <div class="admin-supplier-edit-actions">
                    <button type="button" class="action-btn secondary" data-admin-edit-cancel>Cancel</button>
                    <button type="submit" class="action-btn primary">Save</button>
                </div>
            </form>
        </div>`;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAdminSupplierEditOverlay();
    });
    overlay.querySelector('[data-admin-edit-close]')?.addEventListener('click', closeAdminSupplierEditOverlay);
    overlay.querySelector('[data-admin-edit-cancel]')?.addEventListener('click', closeAdminSupplierEditOverlay);

    overlay.querySelector('#adminSupplierEditForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const existingSupplier = shared.getSuppliers().find((s) => s.id === supplierId);
        if (!existingSupplier) {
            shared.showToast('Supplier not found');
            return;
        }
        const supplierData = {
            name: document.getElementById('adminEditSupName')?.value?.trim() || '',
            businessName: document.getElementById('adminEditSupBiz')?.value?.trim() || '',
            tin: document.getElementById('adminEditSupTin')?.value?.trim() || '',
            address: document.getElementById('adminEditSupAddr')?.value?.trim() || '',
            isVatRegistered: !!document.getElementById('adminEditSupVat')?.checked,
        };
        const result = shared.createSupplierObject(supplierData, {
            existingSupplier,
            isEditing: supplierId,
            validate: true,
        });
        if (!result.success) {
            shared.showToast(result.errors.join(', '));
            return;
        }
        const success = shared.updateSupplier(supplierId, result.supplier);
        if (!success) {
            shared.showToast('Failed to update supplier');
            return;
        }
        const updateResult = shared.updateExpensesForSupplier(existingSupplier, result.supplier);
        const expenseMsg =
            updateResult.updated > 0
                ? ` Updated ${updateResult.updated} expense${updateResult.updated === 1 ? '' : 's'}.`
                : '';
        shared.showToast(`Supplier saved.${expenseMsg}`);
        closeAdminSupplierEditOverlay();
        refreshAdminTables();
    });

    document.body.appendChild(overlay);
}

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
    adminExpenseModalDirty = false;
}

function markAdminExpenseModalDirty() {
    adminExpenseModalDirty = true;
}

function requestCloseAdminExpenseModal() {
    if (adminExpenseModalDirty) {
        const ok = window.confirm('You have unsaved changes. Close anyway?');
        if (!ok) return;
    }
    closeAdminExpenseModal();
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
        if (typeof cb !== 'function') return;
        try {
            await cb();
        } catch (err) {
            console.error('Admin confirmation action', err);
            shared.showToast('Something went wrong. Please try again.');
        }
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

function renderAdminDataSnapshot(contextLabel) {
    const expenses = shared.getExpenses();
    const suppliers = shared.getSuppliers();
    console.log(`[Startup] ${contextLabel}:`, expenses.length, 'expenses,', suppliers.length, 'suppliers');
    totalFilteredExpenses = [...expenses];
    renderFilteredTable(expenses);
    updateFilteredSummary(expenses);
    refreshMonthDropdown();
    populateAdminCategoryFilter();
}

function loadLocalDataAndRender() {
    console.log('[Startup] Loading local cache...');
    const hasLocalData = shared.loadFromLocalStorage();
    if (hasLocalData) {
        renderAdminDataSnapshot('Local cache rendered');
    } else {
        console.log('[Startup] No local cache found');
    }
    return hasLocalData;
}

async function syncRemoteDataInBackground(startedAtMs) {
    const syncStartMs = performance.now();
    console.log('[Startup] Starting background Firebase sync...');
    try {
        const firebaseReady = await shared.initializeFirebase();
        if (!firebaseReady) {
            console.log('[Startup] Firebase unavailable (offline mode)');
            return;
        }

        const hasChanges = await shared.fetchFromFirebase();
        if (hasChanges) {
            renderAdminDataSnapshot('Firebase sync applied');
        } else {
            console.log('[Startup] Firebase sync: no changes');
            populateAdminCategoryFilter();
        }

        const vatBackfillUpdated = shared.runLegacyExpenseVatBackfillOnce();
        if (vatBackfillUpdated > 0) {
            console.log(`[Startup] VAT backfill updated ${vatBackfillUpdated} expense(s)`);
            refreshAdminTables();
        }
    } catch (error) {
        console.error('[Startup] Background Firebase sync failed:', error);
    } finally {
        const remoteMs = Math.round(performance.now() - syncStartMs);
        const totalMs = Math.round(performance.now() - startedAtMs);
        console.log(`[StartupTiming] remote_sync_complete=${remoteMs}ms total_since_boot=${totalMs}ms`);
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
        const vatLbl = shared.formatExpenseVatColumnLabel(expense);
        const vatText = vatLbl.title
            ? `<span title="${escapeHtml(vatLbl.title)}">${escapeHtml(vatLbl.text)}</span>`
            : escapeHtml(vatLbl.text);
        const supplierCell = `<strong>${escapeHtml((expense.supplierName || '').trim() || 'No supplier')}</strong>`;
        const payMethod = expense.paymentMethod ? escapeHtml(expense.paymentMethod) : '—';

        row.innerHTML = `
            <td><input type="checkbox" onchange="updateBulkActionBar()" onclick="handleCheckboxClick(event)"></td>
            <td>${escapeHtml(expense.date || 'No date')}</td>
            <td>${supplierCell}</td>
            <td title="${escapeHtml(itemsText)}">${escapeHtml(itemsShort)}</td>
            <td>${escapeHtml(expense.expenseCategory || shared.DEFAULT_EXPENSE_CATEGORY)}</td>
            <td>₱${(expense.totalAmount || 0).toLocaleString()}</td>
            <td>${escapeHtml(expense.branch || 'No branch')}</td>
            <td>${payMethod}</td>
            <td>${vatText}</td>
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
                case 'transactions': {
                    const expenses = shared.getExpenses();
                    aVal = expenses.filter((e) => shared.expenseBelongsToSupplier(e, a)).length;
                    bVal = expenses.filter((e) => shared.expenseBelongsToSupplier(e, b)).length;
                    break;
                }
                case 'total': {
                    const allExpenses = shared.getExpenses();
                    aVal = allExpenses
                        .filter((e) => shared.expenseBelongsToSupplier(e, a))
                        .reduce((sum, e) => sum + (e.totalAmount || 0), 0);
                    bVal = allExpenses
                        .filter((e) => shared.expenseBelongsToSupplier(e, b))
                        .reduce((sum, e) => sum + (e.totalAmount || 0), 0);
                    break;
                }
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
        const supplierExpenses = expenses.filter((e) => shared.expenseBelongsToSupplier(e, supplier));
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
    const supplierCount = new Set(expenses.filter((e) => e.supplierId).map((e) => e.supplierId)).size;
    const unassignedCount = expenses.filter((e) => !e.supplierId).length;

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
            <div class="card-title">Suppliers (by ID)</div>
            <div class="card-value">${supplierCount}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Unassigned expenses</div>
            <div class="card-value" title="No supplierId — run migration tool">${unassignedCount}</div>
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
    
        bindMonthDropdownChangeListener(monthDropdown);
        
        console.log('[Shortcuts] ✓ Created month dropdown with', monthsWithData.length, 'months with data');
    }
}

function handleMonthDropdownChange(e) {
    if (!e.target.value) return;
    const [year, month, day] = e.target.value.split('-').map(Number);
    const selectedDate = new Date(year, month - 1, day);
    setMonthRange(selectedDate);
}

function bindMonthDropdownChangeListener(monthDropdown) {
    if (!monthDropdown || monthDropdown.dataset.changeBound === '1') return;
    monthDropdown.addEventListener('change', handleMonthDropdownChange);
    monthDropdown.dataset.changeBound = '1';
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
    
    bindMonthDropdownChangeListener(monthDropdown);
    
}

function getMonthsWithData() {
    const expenses = shared.getExpenses();
    const monthMap = new Map();
    
    // Group expenses by month/year
    expenses.forEach(expense => {
        if (expense.date) {
            const date = new Date(expense.date);
            
            // Check if date is valid
            if (isNaN(date.getTime())) {
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
    updateAdminBusyOverlayMessage('Loading Dashboard');
    const bootStartMs = performance.now();

    try {
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

        // Critical path: local data only (first interactive paint)
        console.log('[4/8] Loading local data...');
        const hasLocalData = loadLocalDataAndRender();
        if (hasLocalData) {
            const localMs = Math.round(performance.now() - bootStartMs);
            console.log(`[StartupTiming] local_render_complete=${localMs}ms`);
        }

        if (!hasLocalData) {
            console.error('[4/8] ✗ Failed to load any data');
            document.getElementById('summaryCards').innerHTML = '<div class="summary-card"><div class="card-title">Error</div><div class="card-value">No data available</div></div>';
            return;
        }
        console.log('[4/8] ✓ Local data loaded');

        // Set up all event listeners
        console.log('[5/8] Setting up event listeners...');
        setupEventListeners();
        setupAdminSingleMergeModal();
        console.log('[5/8] ✓ Event listeners setup');

        // Update header visual state for default date sorting
        const dateHeader = document.querySelector('#expenseTableHeaders th[data-sort="date"]');
        if (dateHeader) {
            dateHeader.classList.add('sorted-desc');
        }
        console.log('[6/8] ✓ Updated table header');

        // Initialize pagination containers immediately
        setupPagination('expenses');
        setupPagination('suppliers');
        console.log('[7/8] ✓ Setup pagination');

        // Set default after a small delay to ensure flatpickr is ready
        await new Promise((resolve) => {
            setTimeout(() => {
                console.log('[8/8] Setting default date range...');
                setDefaultDateRange();
                console.log('[8/8] ✓ Default date range set');
                console.log('=== ✓ INITIALIZATION COMPLETE ===');

                // Start polling after we know the UI and flatpickr are ready.
                startAdminPeriodicRefresh();
                resolve();
            }, 100);
        });
        const interactiveMs = Math.round(performance.now() - bootStartMs);
        console.log(`[StartupTiming] interactive_ready=${interactiveMs}ms`);
    } finally {
        hideAdminBusyOverlay();
    }

    // Background phase: network sync and non-critical maintenance work.
    syncRemoteDataInBackground(bootStartMs);
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
                    currentSort = { column: 'date', direction: 'desc' };
                    document.querySelectorAll('#expenseTableHeaders th[data-sort]').forEach((h) => {
                        h.classList.remove('sorted-asc', 'sorted-desc');
                    });
                    document.querySelector('#expenseTableHeaders th[data-sort="date"]')?.classList.add('sorted-desc');
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
                    document.querySelectorAll('#supplierTableHeaders th[data-sort]').forEach((h) => {
                        h.classList.remove('sorted-asc', 'sorted-desc');
                    });
                    renderSuppliers();
                    document
                        .querySelector('#supplierTableHeaders th[data-sort="transactions"]')
                        ?.classList.add('sorted-desc');
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
        // Preserve current date/filter state after modal saves/edits.
        // Re-triggering shortcut button clicks can unexpectedly reset custom ranges.
        if (dateRangeInput && dateRangeInput._flatpickr) {
            filterAndRender();
        } else {
            const expenses = shared.getExpenses();
            renderFilteredTable(expenses);
            updateFilteredSummary(expenses);
        }
    } else if (tab === 'suppliers') {
        renderSuppliers();
        updateSummary();
    }
    updateBulkActionBar();
    // Merges/deletes can run while Expenses or Analytics is active; keep supplier table in sync.
    if (tab !== 'suppliers' && document.getElementById('supplierTableBody')) {
        renderSuppliers();
        updateSummary();
    }
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
            categoryMatch = (expense.expenseCategory || shared.DEFAULT_EXPENSE_CATEGORY) === selectedCategory;
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
async function startAdminInitialization() {
    showAdminBusyOverlay('Loading Dashboard');
    try {
        await initialize();
    } catch (error) {
        console.error('Admin initialization failed:', error);
        hideAdminBusyOverlay();
    }
}
if (document.readyState === 'loading') {
    console.log('DOM still loading, waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', startAdminInitialization);
} else {
    console.log('DOM already loaded, initializing immediately...');
    setTimeout(startAdminInitialization, 100);
}

function renderFilteredTable(filteredExpenses) {
    const tbody = document.getElementById('expenseTableBody');
    if (!tbody) {
        console.error('Table body not found');
        return;
    }

    // Store for pagination
    totalFilteredExpenses = [...filteredExpenses];

    const expenseTableSortColumns = new Set(['date', 'supplier', 'category', 'amount', 'branch', 'payment', 'vat']);
    if (!currentSort.column || !expenseTableSortColumns.has(currentSort.column)) {
        currentSort = { column: 'date', direction: 'desc' };
        document.querySelectorAll('#expenseTableHeaders th[data-sort]').forEach((h) => {
            h.classList.remove('sorted-asc', 'sorted-desc');
        });
        document.querySelector('#expenseTableHeaders th[data-sort="date"]')?.classList.add('sorted-desc');
    }

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
                case 'category':
                    aVal = (a.expenseCategory || '').toLowerCase();
                    bVal = (b.expenseCategory || '').toLowerCase();
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
        const vatLbl = shared.formatExpenseVatColumnLabel(expense);
        const vatText = vatLbl.title
            ? `<span title="${escapeHtml(vatLbl.title)}">${escapeHtml(vatLbl.text)}</span>`
            : escapeHtml(vatLbl.text);
        const supplierCell = `<strong>${escapeHtml((expense.supplierName || '').trim() || 'No supplier')}</strong>`;
        const payMethod = expense.paymentMethod ? escapeHtml(expense.paymentMethod) : '—';

        row.innerHTML = `
            <td><input type="checkbox" onchange="updateBulkActionBar()" onclick="handleCheckboxClick(event)"></td>
            <td>${escapeHtml(formatDate(expense.date))}</td>
            <td>${supplierCell}</td>
            <td title="${escapeHtml(itemsText)}">${escapeHtml(itemsShort)}</td>
            <td>${escapeHtml(expense.expenseCategory || shared.DEFAULT_EXPENSE_CATEGORY)}</td>
            <td>₱${(expense.totalAmount || 0).toLocaleString()}</td>
            <td>${escapeHtml(expense.branch || 'No branch')}</td>
            <td>${payMethod}</td>
            <td>${vatText}</td>
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
    const supplierCount = new Set(
        filteredExpenses.filter((e) => e.supplierId).map((e) => e.supplierId)
    ).size;
    const unassignedCount = filteredExpenses.filter((e) => !e.supplierId).length;

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
            <div class="card-title">Suppliers (by ID)</div>
            <div class="card-value">${supplierCount}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Unassigned expenses</div>
            <div class="card-value" title="No supplierId — run migration tool">${unassignedCount}</div>
        </div>
    `;
}

// Add sorting functionality
function setupTableSorting() {
    document.querySelectorAll('#expenseTableHeaders th[data-sort]').forEach((header) => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;

            // Toggle direction if same column, otherwise start with asc
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }

            document.querySelectorAll('#expenseTableHeaders th[data-sort]').forEach((h) => {
                h.classList.remove('sorted-asc', 'sorted-desc');
            });
            header.classList.add(`sorted-${currentSort.direction}`);

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
                categoryMatch = (expense.expenseCategory || shared.DEFAULT_EXPENSE_CATEGORY) === selectedCategory;
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
            'Supplier Name': expense.isPettyCash ? 'Petty cash voucher' : expense.supplierName || '',
            'Business Name': expense.businessName || '',
            'TIN': expense.tin || '',
            'Address': expense.address || '',
            'Invoice Number': expense.invoiceNumber || '',
            'Items': itemsText,
            'Category': expense.expenseCategory || shared.DEFAULT_EXPENSE_CATEGORY,
            'Total Amount': expense.totalAmount || 0,
            'VAT Exempt Amount': expense.vatExemptAmount || 0,
            'VATable Sale': expense.vatableSale || 0,
            'VAT Amount': expense.vatAmount || 0,
            'VAT Registered': expense.isVatRegistered ? 'Yes' : 'No',
            'Branch': expense.branch || '',
            'Allocation': expense.allocation || '',
            'Is Petty Cash': expense.isPettyCash ? 'Yes' : 'No',
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
            showAdminBusyOverlay('Deleting expense…');
            try {
                const ok = await shared.deleteExpense(expenseId);
                if (ok) {
                    shared.showToast('Expense deleted');
                    closeAdminExpenseModal();
                    refreshAdminTables();
                } else shared.showToast('Failed to delete expense');
            } finally {
                hideAdminBusyOverlay();
            }
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
                const n = selected.length;
                showAdminBusyOverlay('Deleting expenses…');
                try {
                    for (let i = 0; i < n; i++) {
                        updateAdminBusyOverlayMessage(`Deleting expenses… ${i + 1} / ${n}`);
                        await shared.deleteExpense(selected[i].id);
                    }
                    shared.showToast(`Deleted ${n} expense(s)`);
                    refreshAdminTables();
                } finally {
                    hideAdminBusyOverlay();
                }
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
                showAdminBusyOverlay('Deleting suppliers…');
                try {
                    const r = await shared.deleteSuppliersBulk(
                        ids,
                        (_cur, _total, msg) => {
                            if (msg) updateAdminBusyOverlayMessage(msg);
                        },
                        true
                    );
                    shared.showToast(`Removed ${r.deleted} supplier(s)`);
                    refreshAdminTables();
                } finally {
                    hideAdminBusyOverlay();
                }
            }
        );
    }
};

function ensureBulkMergeModalWired() {
    if (window._bulkMergeWired) return;
    window._bulkMergeWired = true;
    const closeBtn = document.getElementById('bulkMergeModalCloseBtn');
    const overlay = document.getElementById('bulkMergeModalOverlay');
    closeBtn?.addEventListener('click', () => {
        if (overlay?.classList.contains('merge-in-progress')) return;
        closeBulkMergeModal();
    });
    overlay?.addEventListener('click', (e) => {
        if (overlay.classList.contains('merge-in-progress')) return;
        if (e.target === overlay) closeBulkMergeModal();
    });
}

window.closeBulkMergeModal = function () {
    const overlay = document.getElementById('bulkMergeModalOverlay');
    if (overlay?.classList.contains('merge-in-progress')) return;
    hideAdminBulkMergeProgressUI();
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
            setAdminBulkMergeProgressVisible(true);
            updateAdminBulkMergeProgressUI(1, 1, 'Preparing merge…');
            try {
                const r = await shared.mergeSuppliersIntoTarget(
                    targetId,
                    sourceIds,
                    (step, total, msg) => updateAdminBulkMergeProgressUI(step, total, msg)
                );
                if (r.success) {
                    shared.showToast(`Merged suppliers; ${r.transferred} expense row(s) updated`);
                    setAdminBulkMergeProgressVisible(false);
                    hideAdminBulkMergeProgressUI();
                    closeBulkMergeModal();
                    refreshAdminTables();
                } else {
                    shared.showToast(r.error || 'Merge failed');
                }
            } catch (err) {
                console.error('Admin bulk merge', err);
                shared.showToast('Merge failed. Please try again.');
            } finally {
                setAdminBulkMergeProgressVisible(false);
                hideAdminBulkMergeProgressUI();
            }
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
                <select id="bulkEditPaidBy" style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
                    <option value="">-- Keep current --</option>
                    <option value="Store Cash">Store Cash</option>
                    <option value="Company">Company</option>
                </select>
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
        if (paidBy === 'Store Cash' || paidBy === 'Company') updates.paidBy = paidBy;
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
        let list = shared.getExpenses().filter((e) => shared.expenseBelongsToSupplier(e, supplier));
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
                <td>${escapeHtml(e.expenseCategory || shared.DEFAULT_EXPENSE_CATEGORY)}</td>
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
    const totalTransactions = supplierExpenses.length;
    const averageAmount = totalTransactions > 0 ? totalAmount / totalTransactions : 0;
    const dateVals = supplierExpenses
        .map((e) => {
            const t = new Date(e.date).getTime();
            return Number.isNaN(t) ? null : t;
        })
        .filter((t) => t != null);
    const firstTs = dateVals.length ? Math.min(...dateVals) : null;
    const lastTs = dateVals.length ? Math.max(...dateVals) : null;
    const firstPurchase =
        firstTs != null
            ? formatDate(new Date(firstTs).toISOString().split('T')[0])
            : null;
    const lastPurchase =
        lastTs != null ? formatDate(new Date(lastTs).toISOString().split('T')[0]) : null;

    const mergeSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/><path d="m9 9 6 6"/><path d="M15 9H9v6"/></svg>`;
    const editSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`;
    const delSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3,6 5,6 21,6"/><path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

    modal.innerHTML = `
        <div class="admin-supplier-modal-shell" data-supplier-id="${escapeHtml(supplier.id)}">
            <div class="admin-supplier-modal-header">
                <div class="admin-supplier-modal-head-text">
                    <h2>Supplier</h2>
                    <p class="admin-supplier-modal-head-name muted">${escapeHtml(supplier.name)}</p>
                </div>
                <div class="admin-supplier-modal-header-actions">
                    <button type="button" class="admin-modal-icon-btn" title="Merge into this supplier" data-admin-supplier-merge>${mergeSvg}</button>
                    <button type="button" class="admin-modal-icon-btn" title="Edit supplier" data-admin-supplier-edit>${editSvg}</button>
                    <button type="button" class="admin-modal-icon-btn danger" title="Delete supplier" data-admin-supplier-delete>${delSvg}</button>
                    <button type="button" class="admin-modal-icon-btn" aria-label="Close" data-admin-supplier-close>&times;</button>
                </div>
            </div>
            <div class="admin-supplier-modal-body">
                <div class="admin-supplier-detail-grid">
                    <div class="admin-supplier-detail-card">
                        <h3 class="admin-supplier-detail-card-title">Information</h3>
                        <dl class="admin-supplier-detail-dl">
                            <div class="admin-supplier-detail-row"><dt>Supplier name</dt><dd>${escapeHtml(supplier.name)}</dd></div>
                            ${
                                supplier.isVatRegistered
                                    ? `<div class="admin-supplier-detail-row"><dt>VAT</dt><dd><span class="admin-vat-badge">VAT registered</span></dd></div>`
                                    : `<div class="admin-supplier-detail-row"><dt>VAT</dt><dd>Not registered</dd></div>`
                            }
                            ${
                                supplier.businessName
                                    ? `<div class="admin-supplier-detail-row"><dt>Business name</dt><dd>${escapeHtml(supplier.businessName)}</dd></div>`
                                    : ''
                            }
                            ${
                                supplier.tin
                                    ? `<div class="admin-supplier-detail-row"><dt>TIN</dt><dd>${escapeHtml(supplier.tin)}</dd></div>`
                                    : ''
                            }
                            ${
                                supplier.address
                                    ? `<div class="admin-supplier-detail-row"><dt>Address</dt><dd>${escapeHtml(supplier.address)}</dd></div>`
                                    : ''
                            }
                        </dl>
                    </div>
                    <div class="admin-supplier-detail-card">
                        <h3 class="admin-supplier-detail-card-title">Transaction summary</h3>
                        <dl class="admin-supplier-detail-dl">
                            <div class="admin-supplier-detail-row"><dt>Transactions</dt><dd>${totalTransactions}</dd></div>
                            <div class="admin-supplier-detail-row"><dt>Total amount</dt><dd class="admin-supplier-detail-amount">₱${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
                            <div class="admin-supplier-detail-row"><dt>Average</dt><dd>₱${averageAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
                            ${
                                firstPurchase
                                    ? `<div class="admin-supplier-detail-row"><dt>First purchase</dt><dd>${escapeHtml(firstPurchase)}</dd></div>`
                                    : ''
                            }
                            ${
                                lastPurchase
                                    ? `<div class="admin-supplier-detail-row"><dt>Last purchase</dt><dd>${escapeHtml(lastPurchase)}</dd></div>`
                                    : ''
                            }
                        </dl>
                    </div>
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

    const sid = supplier.id;
    modal.querySelector('[data-admin-supplier-close]')?.addEventListener('click', closeAdminSupplierModal);
    modal.querySelector('[data-admin-supplier-merge]')?.addEventListener('click', () => {
        closeAdminSupplierModal();
        setTimeout(() => showAdminMergeSupplierModal(sid), 150);
    });
    modal.querySelector('[data-admin-supplier-edit]')?.addEventListener('click', () => {
        closeAdminSupplierModal();
        setTimeout(() => openAdminSupplierEditModal(sid), 150);
    });
    modal.querySelector('[data-admin-supplier-delete]')?.addEventListener('click', () => {
        adminPromptDeleteSupplier(sid);
    });
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
        allocation: 'Store',
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
        isPettyCash: false,
        paidBy: 'Store Cash',
        notes: '',
        receiptImage: null,
        expenseCategory: shared.DEFAULT_EXPENSE_CATEGORY,
        createdAt: new Date().toISOString()
    };
    
    showExpenseModal(newExpense, true);
};

function applyAdminSupplierFieldNameMode(verified) {
    const hSn = document.getElementById('adminHSupplierName');
    const hBn = document.getElementById('adminHBusinessName');
    const hTin = document.getElementById('adminHTin');
    const hAddr = document.getElementById('adminHAddress');
    const mSn = document.getElementById('adminSupplierName');
    const mBn = document.getElementById('adminBusinessName');
    const mTin = document.getElementById('adminTin');
    const mAd = document.getElementById('adminAddress');
    if (verified) {
        if (mSn) {
            mSn.removeAttribute('name');
            mSn.removeAttribute('required');
        }
        if (mBn) mBn.removeAttribute('name');
        if (mTin) mTin.removeAttribute('name');
        if (mAd) mAd.removeAttribute('name');
        if (hSn) {
            hSn.setAttribute('name', 'supplierName');
            hSn.setAttribute('required', 'required');
        }
        if (hBn) hBn.setAttribute('name', 'businessName');
        if (hTin) hTin.setAttribute('name', 'tin');
        if (hAddr) hAddr.setAttribute('name', 'address');
    } else {
        if (hSn) {
            hSn.removeAttribute('name');
            hSn.removeAttribute('required');
        }
        if (hBn) hBn.removeAttribute('name');
        if (hTin) hTin.removeAttribute('name');
        if (hAddr) hAddr.removeAttribute('name');
        if (mSn) {
            mSn.setAttribute('name', 'supplierName');
            mSn.setAttribute('required', 'required');
        }
        if (mBn) mBn.setAttribute('name', 'businessName');
        if (mTin) mTin.setAttribute('name', 'tin');
        if (mAd) mAd.setAttribute('name', 'address');
    }
}

function adminEnterSupplierVerifiedMode(supplier) {
    const vWrap = document.getElementById('adminSupplierVerifiedWrap');
    const mWrap = document.getElementById('adminSupplierManualWrap');
    const nameEl = document.getElementById('adminSupplierVerifiedName');
    const bizEl = document.getElementById('adminSupplierVerifiedBiz');
    const hSn = document.getElementById('adminHSupplierName');
    const hBn = document.getElementById('adminHBusinessName');
    const hTin = document.getElementById('adminHTin');
    const hAddr = document.getElementById('adminHAddress');
    const mSn = document.getElementById('adminSupplierName');
    const mBn = document.getElementById('adminBusinessName');
    const mTin = document.getElementById('adminTin');
    const mAd = document.getElementById('adminAddress');
    if (!vWrap || !mWrap || !supplier) return;
    if (nameEl) nameEl.textContent = supplier.name || '';
    if (bizEl) bizEl.textContent = supplier.businessName || '';
    adminSetSupplierVerifiedDetailRows(supplier.tin, supplier.address);
    if (hSn) hSn.value = supplier.name || '';
    if (hBn) hBn.value = supplier.businessName || '';
    if (hTin) hTin.value = supplier.tin || '';
    if (hAddr) hAddr.value = supplier.address || '';
    if (mSn) mSn.value = supplier.name || '';
    if (mBn) mBn.value = supplier.businessName || '';
    if (mTin) mTin.value = supplier.tin || '';
    if (mAd) mAd.value = supplier.address || '';
    vWrap.classList.remove('admin-hidden');
    mWrap.classList.add('admin-hidden');
    applyAdminSupplierFieldNameMode(true);
    adminSyncPettyCashUI();
    if (supplier.isVatRegistered) {
        const cb = document.getElementById('adminVatComputationEnabled');
        const track = document.getElementById('adminVatToggleTrack');
        const shell = document.getElementById('adminVatToggleShell');
        if (cb) cb.checked = true;
        if (track) track.classList.add('active');
        if (shell) shell.setAttribute('aria-checked', 'true');
    }
    markAdminExpenseModalDirty();
}

function adminLeaveSupplierVerifiedMode() {
    const vWrap = document.getElementById('adminSupplierVerifiedWrap');
    const mWrap = document.getElementById('adminSupplierManualWrap');
    const mSn = document.getElementById('adminSupplierName');
    const mBn = document.getElementById('adminBusinessName');
    const mTin = document.getElementById('adminTin');
    const mAd = document.getElementById('adminAddress');
    const hSn = document.getElementById('adminHSupplierName');
    const hBn = document.getElementById('adminHBusinessName');
    const hTin = document.getElementById('adminHTin');
    const hAddr = document.getElementById('adminHAddress');
    if (!vWrap || !mWrap) return;
    vWrap.classList.add('admin-hidden');
    mWrap.classList.remove('admin-hidden');
    if (hSn) hSn.value = '';
    if (hBn) hBn.value = '';
    if (hTin) hTin.value = '';
    if (hAddr) hAddr.value = '';
    if (mSn) mSn.value = '';
    if (mBn) mBn.value = '';
    if (mTin) mTin.value = '';
    if (mAd) mAd.value = '';
    applyAdminSupplierFieldNameMode(false);
    if (mSn) mSn.focus();
    adminSyncPettyCashUI();
    adminSyncVatSection();
    markAdminExpenseModalDirty();
}

function adminApplySupplierRecord(supplier) {
    adminEnterSupplierVerifiedMode(supplier);
}

function wireAdminSupplierClearButton() {
    document.getElementById('adminSupplierClearBtn')?.addEventListener('click', () => {
        adminLeaveSupplierVerifiedMode();
    });
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
    modalBody.querySelectorAll('.admin-item-name-input').forEach((inp) => {
        wireAdminItemAutocomplete(inp, modalBody);
    });
}

function initAdminReceiptPanel(expense, isEditing, expenseId) {
    const mount = document.getElementById('adminReceiptPanelMount');
    if (!mount) return;
    const applyReceiptUrlToMemory = (url) => {
        if (!url) return;
        const nextExpenses = shared.getExpenses().map((item) =>
            item.id === expenseId
                ? { ...item, receiptImage: url, hasReceiptImage: true }
                : item
        );
        shared.setExpenses(nextExpenses);
    };
    const renderReceiptFrame = (url) => {
        mount.innerHTML = `<div class="admin-receipt-frame"><img src="${url}" alt="Receipt" class="admin-receipt-preview-full"/></div>`;
        const img = mount.querySelector('img');
        img?.addEventListener('error', async () => {
            if (!expense?.hasReceiptImage) {
                mount.innerHTML = '<p class="muted">Failed to load receipt</p>';
                return;
            }
            const fallbackUrl = await shared.fetchReceiptImageFromFirebase(expenseId);
            if (!fallbackUrl || fallbackUrl === url) {
                mount.innerHTML = '<p class="muted">Failed to load receipt</p>';
                return;
            }
            applyReceiptUrlToMemory(fallbackUrl);
            renderReceiptFrame(fallbackUrl);
        });
    };
    const loadReceiptFallback = async () => {
        mount.innerHTML = '<p class="muted">Loading receipt…</p>';
        const url = await shared.fetchReceiptImageFromFirebase(expenseId);
        if (!url) {
            mount.innerHTML = '<p class="muted">No receipt found</p>';
            return null;
        }
        applyReceiptUrlToMemory(url);
        return url;
    };

    if (!isEditing) {
        if (expense.receiptImage) {
            renderReceiptFrame(expense.receiptImage);
        } else if (expense.hasReceiptImage) {
            loadReceiptFallback().then((url) => {
                if (url) renderReceiptFrame(url);
            });
        } else {
            mount.innerHTML = '<p class="muted">No receipt attached</p>';
        }
        return;
    }

    mount.innerHTML = `
        <div class="admin-receipt-editor-wrap">
            <div class="admin-receipt-upload-stack">
                <div class="admin-receipt-upload" id="adminReceiptDrop">
                    <input type="file" id="adminReceiptInput" accept="image/*" style="display:none" />
                    <div class="admin-receipt-upload-content">Click or drag to upload / replace receipt</div>
                    <img id="adminReceiptPreview" class="admin-receipt-preview" style="display:none" alt="" />
                </div>
            </div>
            <div class="admin-receipt-actions" id="adminReceiptActions" style="display:none">
                <button type="button" class="action-btn secondary admin-receipt-rotate-btn" id="adminReceiptRotateLeft" title="Rotate left">↺</button>
                <button type="button" class="action-btn secondary admin-receipt-rotate-btn" id="adminReceiptRotateRight" title="Rotate right">↻</button>
                <button type="button" class="action-btn secondary" id="adminRemoveReceiptBtn">Remove image</button>
            </div>
        </div>`;

    const input = document.getElementById('adminReceiptInput');
    const drop = document.getElementById('adminReceiptDrop');
    const preview = document.getElementById('adminReceiptPreview');
    const actionsRow = document.getElementById('adminReceiptActions');
    const rm = document.getElementById('adminRemoveReceiptBtn');
    const rotL = document.getElementById('adminReceiptRotateLeft');
    const rotR = document.getElementById('adminReceiptRotateRight');

    const showPreview = (src, userAction = false) => {
        if (!src) return;
        adminPendingReceiptUrl = src;
        window.adminReceiptRemove = false;
        preview.src = src;
        delete preview.dataset.receiptRetry;
        preview.style.display = 'block';
        drop.classList.add('has-file');
        if (actionsRow) actionsRow.style.display = 'flex';
        applyReceiptUrlToMemory(src);
        if (userAction) markAdminExpenseModalDirty();
    };

    if (expense.receiptImage) showPreview(expense.receiptImage, false);
    else if (expense.hasReceiptImage) {
        loadReceiptFallback().then((url) => {
            if (url) showPreview(url, false);
        });
    }

    preview?.addEventListener('error', async () => {
        if (!expense?.hasReceiptImage || preview.dataset.receiptRetry === '1') {
            return;
        }
        preview.dataset.receiptRetry = '1';
        const fallbackUrl = await shared.fetchReceiptImageFromFirebase(expenseId);
        if (fallbackUrl) showPreview(fallbackUrl, false);
    });

    const processReceiptFile = async (f) => {
        if (!f || !f.type?.startsWith('image/')) {
            shared.showToast('Please choose an image file');
            return;
        }
        try {
            const dataUrl = await shared.compressImage(f);
            const url = await shared.uploadReceiptImageToStorage(expenseId, dataUrl);
            showPreview(url || dataUrl, true);
        } catch (err) {
            console.warn(err);
            shared.showToast('Receipt upload failed');
        }
    };

    drop.addEventListener('click', () => input?.click());
    input?.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        await processReceiptFile(f);
    });
    drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('admin-receipt-dragover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('admin-receipt-dragover'));
    drop.addEventListener('drop', async (e) => {
        e.preventDefault();
        drop.classList.remove('admin-receipt-dragover');
        const f = e.dataTransfer?.files?.[0];
        if (f) await processReceiptFile(f);
    });
    const setRotateBusy = (busy) => {
        [rotL, rotR].forEach((b) => {
            if (b) b.disabled = busy;
        });
    };

    const applyRotation = async (direction) => {
        const src = adminPendingReceiptUrl || preview?.src;
        if (!src) return;
        setRotateBusy(true);
        try {
            const dataUrl = await shared.rotateReceiptImage(src, direction);
            const url = await shared.uploadReceiptImageToStorage(expenseId, dataUrl);
            showPreview(url || dataUrl, true);
        } catch (err) {
            console.warn(err);
            shared.showToast('Could not rotate image');
        } finally {
            setRotateBusy(false);
        }
    };

    rotL?.addEventListener('click', (e) => {
        e.stopPropagation();
        applyRotation(-1);
    });
    rotR?.addEventListener('click', (e) => {
        e.stopPropagation();
        applyRotation(1);
    });

    rm?.addEventListener('click', (e) => {
        e.stopPropagation();
        preview.style.display = 'none';
        adminPendingReceiptUrl = null;
        window.adminReceiptRemove = true;
        if (actionsRow) actionsRow.style.display = 'none';
        drop.classList.remove('has-file');
        if (input) input.value = '';
        markAdminExpenseModalDirty();
    });
}

function adminSyncAllocationBranchPaidUI() {
    const allocationSelect = document.getElementById('adminAllocationSelect');
    const branchPaidRow = document.getElementById('adminBranchPaidRow');
    const branchSelect = document.querySelector('#adminBranchFieldGroup select[name="branch"]');
    const paidSelect = document.getElementById('adminPaidBy');
    if (!allocationSelect) return;
    const isStore = allocationSelect.value === 'Store';
    if (branchPaidRow) branchPaidRow.style.display = isStore ? '' : 'none';
    if (branchSelect) branchSelect.required = isStore;
    if (paidSelect) {
        if (isStore) paidSelect.required = true;
        else {
            paidSelect.required = false;
            paidSelect.value = 'Company';
        }
    }
}

function adminSyncPettyCashUI() {
    const wrap = document.getElementById('adminSupplierSectionWrap');
    if (!wrap) return;
    wrap.classList.remove('admin-hidden');
    const petty = Boolean(document.getElementById('adminPettyCash')?.checked);

    // Petty vouchers only need payee name; business / TIN / address are not stored for petty.
    const manualExtras = document.getElementById('adminSupplierExtraFieldsManual');
    if (manualExtras) manualExtras.classList.toggle('admin-hidden', petty);
    const verifiedExtras = document.getElementById('adminSupplierVerifiedExtras');
    if (verifiedExtras) verifiedExtras.classList.toggle('admin-hidden', petty);

    const vWrap = document.getElementById('adminSupplierVerifiedWrap');
    const verifiedShown = vWrap && !vWrap.classList.contains('admin-hidden');
    applyAdminSupplierFieldNameMode(verifiedShown);
    adminSyncVatSection();
}

/** Show/hide VAT fields (non–petty cash); hide when supplier is not VAT-registered (mobile parity). */
function adminSyncVatSection() {
    const section = document.getElementById('adminVatSection');
    if (!section) return;
    const petty = Boolean(document.getElementById('adminPettyCash')?.checked);
    if (petty) {
        section.classList.add('admin-hidden');
        return;
    }
    const name = (
        document.getElementById('adminHSupplierName')?.value ||
        document.getElementById('adminSupplierName')?.value ||
        ''
    ).trim();
    const sup = name
        ? shared.getSuppliers().find((s) => s.name.toLowerCase() === name.toLowerCase())
        : null;
    if (sup && !sup.isVatRegistered) {
        section.classList.add('admin-hidden');
        return;
    }
    section.classList.remove('admin-hidden');
    adminUpdateVatPreview();
}

function adminToggleVatComputation() {
    const cb = document.getElementById('adminVatComputationEnabled');
    const track = document.getElementById('adminVatToggleTrack');
    const shell = document.getElementById('adminVatToggleShell');
    if (!cb || !track) return;
    cb.checked = !cb.checked;
    track.classList.toggle('active', cb.checked);
    if (shell) shell.setAttribute('aria-checked', String(cb.checked));
    adminUpdateVatPreview();
}
window.adminToggleVatComputation = adminToggleVatComputation;

/** Live 12% VAT-inclusive breakdown when toggle is on (mobile-style). */
function adminUpdateVatPreview() {
    const section = document.getElementById('adminVatSection');
    const panel = document.getElementById('adminVatBreakdownPanel');
    const offNote = document.getElementById('adminVatOffNote');
    const cb = document.getElementById('adminVatComputationEnabled');
    const totalEl = document.getElementById('adminVatDispTotal');
    const taxEl = document.getElementById('adminVatDispTaxable');
    const vatSaleEl = document.getElementById('adminVatDispVatable');
    const vatEl = document.getElementById('adminVatDispVat');

    if (!section || section.classList.contains('admin-hidden')) return;

    const petty = Boolean(document.getElementById('adminPettyCash')?.checked);
    if (petty) return;

    const includeVat = cb?.checked !== false;
    const totalInput = document.getElementById('adminTotalAmountInput');
    const total = totalInput ? shared.getPesoValue(totalInput) : 0;
    const exempt = parseFloat(document.getElementById('adminVatExemptAmount')?.value) || 0;

    const name = (
        document.getElementById('adminHSupplierName')?.value ||
        document.getElementById('adminSupplierName')?.value ||
        ''
    ).trim();
    const sup = name
        ? shared.getSuppliers().find((s) => s.name.toLowerCase() === name.toLowerCase())
        : null;

    const setDash = () => {
        if (totalEl) totalEl.textContent = '—';
        if (taxEl) taxEl.textContent = '—';
        if (vatSaleEl) vatSaleEl.textContent = '—';
        if (vatEl) vatEl.textContent = '—';
    };

    if (!includeVat) {
        panel?.classList.add('admin-hidden');
        if (offNote) {
            offNote.classList.remove('admin-hidden');
            offNote.textContent = 'VAT off for this expense.';
        }
        return;
    }

    if (offNote) {
        offNote.classList.add('admin-hidden');
        offNote.textContent = '';
    }
    panel?.classList.remove('admin-hidden');

    if (!sup?.isVatRegistered) {
        panel?.classList.add('admin-hidden');
        if (offNote) {
            offNote.classList.remove('admin-hidden');
            offNote.textContent = 'Select a VAT-registered supplier to see the breakdown.';
        }
        return;
    }

    if (exempt > total) {
        setDash();
        if (offNote) {
            offNote.classList.remove('admin-hidden');
            offNote.textContent = 'VAT-exempt cannot exceed total.';
        }
        return;
    }

    const b = shared.calculateVatBreakdown(total, exempt, true);
    if (totalEl) totalEl.textContent = shared.formatCurrency(b.totalAmount);
    if (taxEl) taxEl.textContent = shared.formatCurrency(b.taxableAmount);
    if (vatSaleEl) vatSaleEl.textContent = shared.formatCurrency(b.vatableSale);
    if (vatEl) vatEl.textContent = shared.formatCurrency(b.vatAmount);
}

function adminIsLineItemEntryVisible() {
    const container = document.getElementById('itemsContainer');
    if (!container) return false;
    return Boolean(container.querySelector('.admin-item-metrics-breakdown:not(.admin-hidden)'));
}

/** Match mobile: tap ⋯ on any row to show qty/price on all rows and switch to line-based entry. */
window.adminShowAllItemBreakdowns = function adminShowAllItemBreakdowns() {
    document.querySelectorAll('#itemsContainer .admin-item-metrics-breakdown').forEach((el) => {
        el.classList.remove('admin-hidden');
    });
    document.querySelectorAll('#itemsContainer .admin-add-price-btn').forEach((el) => {
        el.classList.add('admin-hidden');
    });
    const totalInput = document.getElementById('adminTotalAmountInput');
    if (totalInput) {
        totalInput.value = '';
        adminSetManualTotalInputState(totalInput);
    }
    adminUpdateTotalsFromItems();
    const firstQty = document.querySelector('#itemsContainer .item-row input[name^="itemQty_"]');
    if (firstQty) {
        firstQty.focus();
        firstQty.select();
    }
};

function adminUpdateTotalsFromItems() {
    const totalInput = document.getElementById('adminTotalAmountInput');
    if (!totalInput) return;
    if (!adminIsLineItemEntryVisible()) {
        adminSetManualTotalInputState(totalInput);
        adminUpdateVatPreview();
        return;
    }
    const rows = document.querySelectorAll('#itemsContainer .item-row');
    let sum = 0;
    let hasAnyPrice = false;
    rows.forEach((row) => {
        const qtyInput = row.querySelector('input[name^="itemQty_"]');
        const priceInput = row.querySelector('input[name^="itemPrice_"]');
        const lineEl = row.querySelector('.admin-item-line-total-display');
        const qty = parseFloat(qtyInput?.value) || 0;
        const price = parseFloat(priceInput?.value) || 0;
        if (price > 0) hasAnyPrice = true;
        const lineTotal = shared.calculateItemTotal(qty, price);
        sum += lineTotal;
        if (lineEl) lineEl.textContent = shared.formatCurrency(lineTotal);
    });
    if (hasAnyPrice) {
        totalInput.readOnly = true;
        totalInput.style.backgroundColor = '#f8f9fa';
        totalInput.style.cursor = 'not-allowed';
        totalInput.style.opacity = '0.7';
        totalInput.value = shared.formatCurrency(sum);
    } else {
        adminSetManualTotalInputState(totalInput);
        const raw = (totalInput.value || '').trim();
        if (raw && raw !== '₱0.00') {
            const cur = shared.getPesoValue(totalInput);
            totalInput.value = cur > 0 ? shared.formatCurrency(cur) : '';
        }
    }
    adminUpdateVatPreview();
}

function adminSetManualTotalInputState(totalInput) {
    if (!totalInput) return;
    totalInput.readOnly = false;
    totalInput.style.backgroundColor = '';
    totalInput.style.cursor = '';
    totalInput.style.opacity = '1';
}

function adminBindAdminItemTotalRecalc(modalBody) {
    const container = modalBody.querySelector('#itemsContainer');
    const totalInput = modalBody.querySelector('#adminTotalAmountInput');
    if (!container || !totalInput) return;
    const sync = () => adminUpdateTotalsFromItems();
    container.addEventListener('input', sync);
    container.addEventListener('change', sync);
    totalInput.addEventListener('input', () => adminUpdateVatPreview());
    totalInput.addEventListener('blur', () => {
        if (!totalInput.readOnly) {
            const v = shared.getPesoValue(totalInput);
            totalInput.value = v > 0 ? shared.formatCurrency(v) : '';
        }
        adminUpdateVatPreview();
    });
    sync();
}

// Unified expense modal for both viewing and editing
function showExpenseModal(expense, isNew = false) {
    closeAdminExpenseModal();
    adminPendingReceiptUrl = expense.receiptImage || null;
    window.adminReceiptRemove = false;

    const isEditing = isNew;
    const matchedSupplierForModal = shared.getSuppliers().find(
        (s) => (s.name || '').toLowerCase() === (expense.supplierName || '').toLowerCase()
    );
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

    adminExpenseModalDirty = false;
    shell.addEventListener('input', (e) => {
        if (e.target.closest('.admin-expense-modal-shell')) markAdminExpenseModalDirty();
    });
    shell.addEventListener('change', (e) => {
        if (e.target.closest('.admin-expense-modal-shell')) markAdminExpenseModalDirty();
    });

    shell.querySelector('[data-close-exp-modal]')?.addEventListener('click', requestCloseAdminExpenseModal);
    shell.addEventListener('click', (e) => {
        if (e.target === shell) requestCloseAdminExpenseModal();
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
        wireAdminSupplierClearButton();
        applyAdminSupplierFieldNameMode(Boolean(matchedSupplierForModal));
        adminSyncAllocationBranchPaidUI();
        adminSyncPettyCashUI();
        document.getElementById('adminAllocationSelect')?.addEventListener('change', adminSyncAllocationBranchPaidUI);
        document.getElementById('adminPettyCash')?.addEventListener('change', adminSyncPettyCashUI);
        adminBindAdminItemTotalRecalc(modalBody);
        document.getElementById('adminSupplierName')?.addEventListener('blur', () => adminSyncVatSection());
        document.getElementById('adminVatExemptAmount')?.addEventListener('input', () => adminUpdateVatPreview());
        document.getElementById('adminVatExemptAmount')?.addEventListener('change', () => adminUpdateVatPreview());
        adminUpdateVatPreview();
    }
}

// Generate the expense form content
function generateExpenseForm(expense, isEditing) {
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toISOString().split('T')[0];
    };

    const formatViewerDate = (dateStr) => {
        if (!dateStr) return '—';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return escapeHtml(String(dateStr));
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const fmtMoney = (n) =>
        (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const matchedSupplier = shared.getSuppliers().find(
        (s) => (s.name || '').toLowerCase() === (expense.supplierName || '').toLowerCase()
    );
    const supplierVerifiedInitially = Boolean(isEditing && matchedSupplier);
    const isPetty = Boolean(expense.isPettyCash);
    const supplierFieldRequired = true;

    const paidByNorm = normalizeAdminPaidBy(expense.paidBy);
    const allocationViewer = expense.allocation || 'Store';
    const paidByViewer =
        allocationViewer !== 'Store' ? 'Company' : paidByNorm === 'Company' ? 'Company' : 'Store Cash';

    const hSnAttr = supplierVerifiedInitially
        ? supplierFieldRequired
            ? 'name="supplierName" required'
            : 'name="supplierName"'
        : '';
    const hBnAttr = supplierVerifiedInitially ? 'name="businessName"' : '';
    const hTinAttr = supplierVerifiedInitially ? 'name="tin"' : '';
    const hAddrAttr = supplierVerifiedInitially ? 'name="address"' : '';

    const mSnManualAttrs = supplierVerifiedInitially
        ? ''
        : supplierFieldRequired
          ? 'name="supplierName" required'
          : 'name="supplierName"';
    const mBnAttr = supplierVerifiedInitially ? '' : 'name="businessName"';
    const mTinAttr = supplierVerifiedInitially ? '' : 'name="tin"';
    const mAddrAttr = supplierVerifiedInitially ? '' : 'name="address"';

    let supplierSectionHtml = '';
    if (!isEditing && isPetty) {
        const snPetty = (expense.supplierName || '').trim();
        supplierSectionHtml = `
            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Supplier Information</h3>
                <div class="admin-petty-cash-badge" role="status">Petty cash voucher</div>
                <div class="admin-supplier-verified-card admin-supplier-verified-card--detail">
                    <div class="admin-supplier-verified-header">
                        <strong>${escapeHtml(snPetty || '—')}</strong>
                    </div>
                </div>
            </div>`;
    } else if (!isEditing && matchedSupplier) {
        const dTin = (matchedSupplier.tin || '').trim();
        const dAddr = (matchedSupplier.address || '').trim();
        supplierSectionHtml = `
            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Supplier Information</h3>
                <div class="admin-supplier-verified-card admin-supplier-verified-card--detail admin-supplier-verified-card--clickable" role="button" tabindex="0" onclick='viewSupplierFromExpense(${JSON.stringify(matchedSupplier.name)})' onkeydown='if(event.key==="Enter"||event.key===" "){event.preventDefault();viewSupplierFromExpense(${JSON.stringify(matchedSupplier.name)});}'>
                    <div class="admin-supplier-verified-header">
                        <div class="admin-supplier-verified-name-row">
                            <strong>${escapeHtml(matchedSupplier.name)}</strong>
                            ${ADMIN_SUPPLIER_SAVED_CHECK_SVG}
                        </div>
                    </div>
                    ${
                        (matchedSupplier.businessName || '').trim()
                            ? `<div class="admin-supplier-business-line"><span>${escapeHtml(matchedSupplier.businessName)}</span></div>`
                            : ''
                    }
                    <dl class="admin-supplier-details">
                        ${
                            dTin
                                ? `<div class="admin-supplier-detail-row"><dt>TIN</dt><dd>${escapeHtml(dTin)}</dd></div>`
                                : ''
                        }
                        ${
                            dAddr
                                ? `<div class="admin-supplier-detail-row"><dt>Address</dt><dd>${escapeHtml(dAddr)}</dd></div>`
                                : ''
                        }
                    </dl>
                </div>
            </div>`;
    } else if (!isEditing && !matchedSupplier) {
        const sn = (expense.supplierName || '').trim();
        const biz = (expense.businessName || '').trim();
        const tin = (expense.tin || '').trim();
        const addr = (expense.address || '').trim();
        const openAttrs = sn
            ? ` role="button" tabindex="0" onclick='viewSupplierFromExpense(${JSON.stringify(expense.supplierName)})' onkeydown='if(event.key==="Enter"||event.key===" "){event.preventDefault();viewSupplierFromExpense(${JSON.stringify(expense.supplierName)});}'`
            : '';
        const cardClass = `admin-supplier-verified-card admin-supplier-verified-card--detail${sn ? ' admin-supplier-verified-card--clickable' : ''}`;
        supplierSectionHtml = `
            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Supplier Information</h3>
                <div class="${cardClass}"${openAttrs}>
                    <div class="admin-supplier-verified-header">
                        <strong>${escapeHtml(sn || '—')}</strong>
                    </div>
                    ${
                        biz
                            ? `<div class="admin-supplier-business-line"><span>${escapeHtml(biz)}</span></div>`
                            : ''
                    }
                    <dl class="admin-supplier-details">
                        ${
                            tin
                                ? `<div class="admin-supplier-detail-row"><dt>TIN</dt><dd>${escapeHtml(tin)}</dd></div>`
                                : ''
                        }
                        ${
                            addr
                                ? `<div class="admin-supplier-detail-row"><dt>Address</dt><dd>${escapeHtml(addr)}</dd></div>`
                                : ''
                        }
                    </dl>
                </div>
            </div>`;
    } else {
        supplierSectionHtml = `
            <div id="adminSupplierSectionWrap" class="admin-form-section-inner">
            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Supplier Information</h3>
                <div id="adminSupplierVerifiedWrap" class="${supplierVerifiedInitially ? '' : 'admin-hidden'}">
                    <div class="admin-supplier-verified-card">
                        <div class="admin-supplier-verified-header">
                            <div class="admin-supplier-verified-name-row">
                                <strong id="adminSupplierVerifiedName">${supplierVerifiedInitially ? escapeHtml(matchedSupplier.name) : ''}</strong>
                                ${ADMIN_SUPPLIER_SAVED_CHECK_SVG}
                            </div>
                            <button type="button" class="admin-supplier-clear-btn" id="adminSupplierClearBtn" aria-label="Change supplier">&times;</button>
                        </div>
                        <div id="adminSupplierVerifiedExtras">
                        <div class="admin-supplier-business-line">
                            <span id="adminSupplierVerifiedBiz">${supplierVerifiedInitially ? escapeHtml(matchedSupplier.businessName || '') : ''}</span>
                        </div>
                        <dl class="admin-supplier-details">
                            <div id="adminSupplierVerifiedTinRow" class="admin-supplier-detail-row ${supplierVerifiedInitially && (matchedSupplier.tin || '').trim() ? '' : 'admin-hidden'}">
                                <dt>TIN</dt>
                                <dd id="adminSupplierVerifiedTin">${supplierVerifiedInitially && (matchedSupplier.tin || '').trim() ? escapeHtml(matchedSupplier.tin) : ''}</dd>
                            </div>
                            <div id="adminSupplierVerifiedAddrRow" class="admin-supplier-detail-row ${supplierVerifiedInitially && (matchedSupplier.address || '').trim() ? '' : 'admin-hidden'}">
                                <dt>Address</dt>
                                <dd id="adminSupplierVerifiedAddr">${supplierVerifiedInitially && (matchedSupplier.address || '').trim() ? escapeHtml(matchedSupplier.address) : ''}</dd>
                            </div>
                        </dl>
                        </div>
                    </div>
                    <input type="hidden" id="adminHSupplierName" ${hSnAttr} value="${supplierVerifiedInitially ? escapeHtml(matchedSupplier.name) : ''}">
                    <input type="hidden" id="adminHBusinessName" ${hBnAttr} value="${supplierVerifiedInitially ? escapeHtml(matchedSupplier.businessName || '') : ''}">
                    <input type="hidden" id="adminHTin" ${hTinAttr} value="${supplierVerifiedInitially ? escapeHtml(matchedSupplier.tin || '') : ''}">
                    <input type="hidden" id="adminHAddress" ${hAddrAttr} value="${supplierVerifiedInitially ? escapeHtml(matchedSupplier.address || '') : ''}">
                </div>
                <div id="adminSupplierManualWrap" class="${supplierVerifiedInitially ? 'admin-hidden' : ''}">
                    <div class="admin-field">
                        <label>Supplier Name *</label>
                        <input type="text" id="adminSupplierName" ${mSnManualAttrs} value="${escapeHtml(expense.supplierName || '')}" placeholder="Supplier name">
                    </div>
                    <div id="adminSupplierExtraFieldsManual">
                    <div class="admin-field">
                        <label>Business Name</label>
                        <input type="text" id="adminBusinessName" ${mBnAttr} value="${escapeHtml(expense.businessName || '')}" placeholder="Business name">
                    </div>
                    <div class="admin-field">
                        <label>TIN</label>
                        <input type="text" id="adminTin" ${mTinAttr} value="${escapeHtml(expense.tin || '')}" placeholder="TIN">
                    </div>
                    <div class="admin-field">
                        <label>Address</label>
                        <textarea id="adminAddress" ${mAddrAttr} placeholder="Address">${escapeHtml(expense.address || '')}</textarea>
                    </div>
                    </div>
                </div>
            </div>
            </div>`;
    }

    const branchLabel = expense.branch ? escapeHtml(expense.branch) : '—';
    const categoryLabel = escapeHtml(expense.expenseCategory || shared.DEFAULT_EXPENSE_CATEGORY);
    const allocationLabel = escapeHtml(allocationViewer);
    const invoiceDisplay = expense.invoiceNumber ? escapeHtml(expense.invoiceNumber) : '—';
    const allocSel = (val) => (allocationViewer === val ? 'selected' : '');
    const branchSel = (val) => (expense.branch === val ? 'selected' : '');

    const vatViewLbl = shared.formatExpenseVatColumnLabel(expense);
    const vatExemptView = Number(expense.vatExemptAmount) || 0;
    const vatExemptVal = Number(expense.vatExemptAmount) || 0;
    const vatToggleOn = expense.vatComputationEnabled !== false;
    const adminVatEditSectionHtml = isEditing
        ? `<div class="admin-form-section admin-vat-form-section" id="adminVatSection">
                <div class="admin-vat-header">
                    <h3 class="admin-form-section-title admin-vat-title">VAT</h3>
                    <button type="button" class="admin-vat-toggle-btn" id="adminVatToggleShell" role="switch" aria-checked="${vatToggleOn}" aria-label="Include VAT in computation" onclick="adminToggleVatComputation()">
                        <input type="checkbox" id="adminVatComputationEnabled" style="position:absolute;opacity:0;width:0;height:0;pointer-events:none" ${vatToggleOn ? 'checked' : ''} tabindex="-1" />
                        <div class="admin-toggle-track ${vatToggleOn ? 'active' : ''}" id="adminVatToggleTrack" aria-hidden="true">
                            <div class="admin-toggle-thumb">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="admin-toggle-icon">
                                    <polyline points="20,6 9,17 4,12"></polyline>
                                </svg>
                            </div>
                        </div>
                    </button>
                </div>
                <p id="adminVatOffNote" class="admin-vat-off-note admin-hidden" aria-live="polite"></p>
                <div id="adminVatBreakdownPanel" class="admin-vat-breakdown">
                    <div class="admin-vat-row"><span>Total amount</span><span id="adminVatDispTotal">—</span></div>
                    <div class="admin-vat-row admin-vat-row--exempt">
                        <label class="admin-vat-exempt-label" for="adminVatExemptAmount">Less: VAT-exempt</label>
                        <input type="number" name="vatExemptAmount" id="adminVatExemptAmount" class="admin-vat-exempt-input" min="0" step="0.01" value="${vatExemptVal}" inputmode="decimal" placeholder="0" />
                    </div>
                    <div class="admin-vat-row"><span>Taxable amount</span><span id="adminVatDispTaxable">—</span></div>
                    <div class="admin-vat-row"><span>VATable sale</span><span id="adminVatDispVatable">—</span></div>
                    <div class="admin-vat-row admin-vat-row--total"><span>VAT (12%)</span><span id="adminVatDispVat">—</span></div>
                </div>
            </div>`
        : '';

    const adminVatViewSummaryHtml =
        !isEditing && !isPetty
            ? `<div class="admin-form-section admin-vat-view-summary">
                <h3 class="admin-form-section-title">VAT</h3>
                <div class="admin-exp-view-grid">
                    ${
                        (Number(expense.vatAmount) || 0) > 0
                            ? `
                    ${
                        vatExemptView > 0
                            ? `<div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">VAT-exempt portion</span>
                        <span class="admin-exp-view-value">₱${fmtMoney(vatExemptView)}</span>
                    </div>`
                            : ''
                    }
                    <div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">VATable sale</span>
                        <span class="admin-exp-view-value">₱${fmtMoney(expense.vatableSale)}</span>
                    </div>
                    <div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">VAT (12%)</span>
                        <span class="admin-exp-view-value">₱${fmtMoney(expense.vatAmount)}</span>
                    </div>`
                            : `<div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">VAT</span>
                        <span class="admin-exp-view-value" title="${escapeHtml(vatViewLbl.title)}">${escapeHtml(vatViewLbl.text)}</span>
                    </div>`
                    }
                </div>
            </div>`
            : '';

    const basicInfoSectionHtml = !isEditing
        ? `
            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Basic Information</h3>
                <div class="admin-exp-view-grid">
                    <div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">Date</span>
                        <span class="admin-exp-view-value">${formatViewerDate(expense.date)}</span>
                    </div>
                    <div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">Allocation</span>
                        <span class="admin-exp-view-value">${allocationLabel}</span>
                    </div>
                    ${
                        allocationViewer === 'Store'
                            ? `<div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">Branch</span>
                        <span class="admin-exp-view-value">${branchLabel}</span>
                    </div>`
                            : ''
                    }
                    <div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">Expense category</span>
                        <span class="admin-exp-view-value">${categoryLabel}</span>
                    </div>
                    <div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">Paid by</span>
                        <span class="admin-exp-view-value">${escapeHtml(paidByViewer)}</span>
                    </div>
                    <div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">Invoice number</span>
                        <span class="admin-exp-view-value">${invoiceDisplay}</span>
                    </div>
                    ${
                        isPetty
                            ? `<div class="admin-exp-view-field">
                        <span class="admin-exp-view-label">Petty cash</span>
                        <span class="admin-exp-view-value">Yes</span>
                    </div>`
                            : ''
                    }
                </div>
            </div>`
        : `
            <div class="admin-form-section">
                <h3 class="admin-form-section-title">Basic Information</h3>
                <div class="admin-field-row">
                    <div class="admin-field">
                        <label>Date</label>
                        <input type="date" name="date" value="${formatDate(expense.date)}" required>
                    </div>
                    <div class="admin-field">
                        <label>Allocation</label>
                        <select name="allocation" id="adminAllocationSelect" required>
                            <option value="Store" ${allocSel('Store')}>Store</option>
                            <option value="General" ${allocSel('General')}>General</option>
                            <option value="Workshop" ${allocSel('Workshop')}>Workshop</option>
                            <option value="Popup" ${allocSel('Popup')}>Popup</option>
                            <option value="Bar Service" ${allocSel('Bar Service')}>Bar Service</option>
                        </select>
                    </div>
                </div>
                <div class="admin-field-row" id="adminBranchPaidRow">
                    <div class="admin-field" id="adminBranchFieldGroup">
                        <label>Branch</label>
                        <select name="branch">
                            <option value="SM North" ${branchSel('SM North')}>SM North</option>
                            <option value="Podium" ${branchSel('Podium')}>Podium</option>
                            <option value="Mall of Asia" ${branchSel('Mall of Asia')}>Mall of Asia</option>
                            <option value="BGC" ${branchSel('BGC')}>BGC</option>
                            <option value="Makati" ${branchSel('Makati')}>Makati</option>
                        </select>
                    </div>
                    <div class="admin-field" id="adminPaidByFieldGroup">
                        <label>Paid By</label>
                        <select id="adminPaidBy" name="paidBy" required>
                            <option value="Store Cash" ${paidByNorm === 'Store Cash' ? 'selected' : ''}>Store Cash</option>
                            <option value="Company" ${paidByNorm === 'Company' ? 'selected' : ''}>Company</option>
                        </select>
                    </div>
                </div>
                <div class="admin-field-row">
                    <div class="admin-field">
                        <label>Expense Category</label>
                        <select name="expenseCategory" required>
                            ${adminBuildExpenseCategoryOptionsHtml(expense.expenseCategory)}
                        </select>
                    </div>
                    <div class="admin-field">
                        <label>Invoice Number</label>
                        <input type="text" name="invoiceNumber" value="${escapeHtml(expense.invoiceNumber || '')}" placeholder="Invoice/reference">
                    </div>
                </div>
                <div class="admin-field admin-field--checkbox">
                    <label class="admin-checkbox-label"><input type="checkbox" name="isPettyCash" id="adminPettyCash" value="1" ${isPetty ? 'checked' : ''}> Petty cash</label>
                </div>
            </div>`;

    const expenseHasLineTotal = Number(expense.totalAmount) > 0;
    const adminLineModeInitially =
        isEditing &&
        Array.isArray(expense.items) &&
        expense.items.some((i) => Number(i.price) > 0);
    const adminAddPriceBtnSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>`;
    const itemsRowsHtml = !isEditing
        ? expense.items
              .map((item) => {
                  const q = Number(item.quantity) || 0;
                  const p = Number(item.price) || 0;
                  const t =
                      item.total != null && item.total !== ''
                          ? Number(item.total)
                          : q * p;
                  const lineAmountMissing = p === 0 && t === 0;
                  const showDash = expenseHasLineTotal && lineAmountMissing;
                  const priceCell = showDash ? '—' : `₱${fmtMoney(p)}`;
                  const totalCell = showDash ? '—' : `₱${fmtMoney(t)}`;
                  return `
                            <article class="admin-item-view-row">
                                <div class="admin-item-view-name">${escapeHtml(item.name || '—')}</div>
                                <div class="admin-item-view-meta">
                                    <span><span class="admin-item-view-k">Qty</span>${q}</span>
                                    <span><span class="admin-item-view-k">Price</span>${priceCell}</span>
                                    <span class="admin-item-view-line-total">${totalCell}</span>
                                </div>
                            </article>`;
              })
              .join('')
        : expense.items
              .map(
                  (item, index) => {
                      const lineT = shared.calculateItemTotal(item.quantity, item.price);
                      const metricsHiddenClass = adminLineModeInitially ? '' : 'admin-hidden';
                      const expandBtnHiddenClass = adminLineModeInitially ? 'admin-hidden' : '';
                      return `
                            <div class="admin-item-card item-row">
                                <div class="admin-item-card-body">
                                    <div class="admin-item-field admin-item-field-item">
                                        <label class="admin-mini-label">Item</label>
                                        <div class="admin-item-name-row">
                                            <input type="text" class="admin-item-name-input" name="itemName_${index}" value="${escapeHtml(item.name)}" placeholder="What did you buy?" required>
                                            <button type="button" class="admin-add-price-btn ${expandBtnHiddenClass}" onclick="adminShowAllItemBreakdowns()" title="Enter quantity and unit price" aria-label="Enter quantity and unit price">${adminAddPriceBtnSvg}</button>
                                        </div>
                                    </div>
                                    <div class="admin-item-metrics admin-item-metrics-breakdown ${metricsHiddenClass}">
                                        <div class="admin-item-field">
                                            <label class="admin-mini-label">Qty</label>
                                            <input type="number" name="itemQty_${index}" value="${item.quantity}" min="1" step="1">
                                        </div>
                                        <div class="admin-item-field">
                                            <label class="admin-mini-label">Price</label>
                                            <input type="number" name="itemPrice_${index}" value="${item.price}" min="0" step="0.01">
                                        </div>
                                        <div class="admin-item-field admin-item-field-total-computed">
                                            <label class="admin-mini-label">Total</label>
                                            <div class="admin-item-line-total-display" aria-live="polite">${escapeHtml(shared.formatCurrency(lineT))}</div>
                                        </div>
                                    </div>
                                    <button type="button" class="admin-item-remove" onclick="removeItem(this)" aria-label="Remove item">×</button>
                                </div>
                            </div>`;
                  }
              )
              .join('');

    const notesColumnHtml = !isEditing
        ? `
                    <div class="admin-notes-column">
                        <h3 class="admin-form-section-title">Notes</h3>
                        <div class="admin-notes-display">${
                            expense.notes
                                ? escapeHtml(expense.notes)
                                : '<span class="admin-notes-empty muted">No notes</span>'
                        }</div>
                    </div>`
        : `
                    <div class="admin-notes-column">
                        <h3 class="admin-form-section-title">Notes</h3>
                        <textarea class="admin-notes-textarea" name="notes" placeholder="Notes" rows="6">${escapeHtml(
                            expense.notes || ''
                        )}</textarea>
                    </div>`;

    const itemsContainerClass = !isEditing ? ' id="itemsContainer" class="admin-item-view-list"' : ' id="itemsContainer"';

    return `
        <form id="expenseForm" onsubmit="saveExpense(event, '${expense.id}')">
            ${basicInfoSectionHtml}

            ${supplierSectionHtml}

            <div class="admin-form-section admin-items-notes-section">
                <div class="admin-items-notes-layout">
                    <div class="admin-items-column">
                        <h3 class="admin-form-section-title">Items Purchased</h3>
                        <div${itemsContainerClass}>
                            ${itemsRowsHtml}
                        </div>
                        ${isEditing ? '<button type="button" class="action-btn secondary admin-add-item" onclick="addItem()">+ Add Item</button>' : ''}
                        ${
                            isEditing
                                ? `<div class="admin-total-pill admin-total-pill--editable">
                            <span>Total Amount</span>
                            <input type="text" id="adminTotalAmountInput" class="admin-total-amount-input" inputmode="decimal"
                                value="${escapeHtml(shared.formatCurrency(expense.totalAmount || 0))}"
                                placeholder="₱0.00" autocomplete="off" />
                        </div>`
                                : `<div class="admin-total-pill admin-total-pill--view">
                            <span>Total Amount</span>
                            <strong>₱${fmtMoney(expense.totalAmount)}</strong>
                        </div>`
                        }
                        ${adminVatEditSectionHtml}
                    </div>
                    ${notesColumnHtml}
                </div>
            </div>

            ${adminVatViewSummaryHtml}

            ${
                isEditing
                    ? `<div class="admin-form-actions">
                <button type="button" class="action-btn secondary" onclick="requestCloseAdminExpenseModal()">Cancel</button>
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
    const lineMode = Boolean(container.querySelector('.admin-item-metrics-breakdown:not(.admin-hidden)'));
    const metricsHiddenClass = lineMode ? '' : 'admin-hidden';
    const expandBtnHiddenClass = lineMode ? 'admin-hidden' : '';
    const adminAddPriceBtnSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>`;

    const itemRow = document.createElement('div');
    itemRow.className = 'admin-item-card item-row';
    itemRow.innerHTML = `
        <div class="admin-item-card-body">
            <div class="admin-item-field admin-item-field-item">
                <label class="admin-mini-label">Item</label>
                <div class="admin-item-name-row">
                    <input type="text" class="admin-item-name-input" name="itemName_${itemCount}" placeholder="What did you buy?" required>
                    <button type="button" class="admin-add-price-btn ${expandBtnHiddenClass}" onclick="adminShowAllItemBreakdowns()" title="Enter quantity and unit price" aria-label="Enter quantity and unit price">${adminAddPriceBtnSvg}</button>
                </div>
            </div>
            <div class="admin-item-metrics admin-item-metrics-breakdown ${metricsHiddenClass}">
                <div class="admin-item-field">
                    <label class="admin-mini-label">Qty</label>
                    <input type="number" name="itemQty_${itemCount}" value="1" min="1" step="1">
                </div>
                <div class="admin-item-field">
                    <label class="admin-mini-label">Price</label>
                    <input type="number" name="itemPrice_${itemCount}" value="0" min="0" step="0.01">
                </div>
                <div class="admin-item-field admin-item-field-total-computed">
                    <label class="admin-mini-label">Total</label>
                    <div class="admin-item-line-total-display" aria-live="polite">${shared.formatCurrency(0)}</div>
                </div>
            </div>
            <button type="button" class="admin-item-remove" onclick="removeItem(this)" aria-label="Remove item">×</button>
        </div>`;

    container.appendChild(itemRow);
    const modalBody = document.querySelector('.admin-expense-modal-body');
    const nameInp = itemRow.querySelector('.admin-item-name-input');
    if (modalBody && nameInp) wireAdminItemAutocomplete(nameInp, modalBody);
    adminUpdateTotalsFromItems();
};

// Remove item function
window.removeItem = function(button) {
    button.closest('.item-row').remove();
    adminUpdateTotalsFromItems();
};

// Save expense function
window.saveExpense = function(event, expenseId) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const existingExpense = shared.getExpenses().find((e) => e.id === expenseId) || null;
    const isNew = !existingExpense;

    // Collect items
    const items = [];
    const itemRows = document.querySelectorAll('.item-row');

    itemRows.forEach((row) => {
        const nameInput = row.querySelector('input[name^="itemName_"]');
        const qtyInput = row.querySelector('input[name^="itemQty_"]');
        const priceInput = row.querySelector('input[name^="itemPrice_"]');

        const name = (nameInput?.value || '').trim();
        const qty = parseFloat(qtyInput?.value) || 1;
        const price = parseFloat(priceInput?.value) || 0;
        const total = shared.calculateItemTotal(qty, price);

        if (name) {
            items.push({
                name,
                quantity: qty,
                price,
                total
            });
        }
    });

    const totalInputEl = document.getElementById('adminTotalAmountInput');
    const totalAmount = totalInputEl ? shared.getPesoValue(totalInputEl) : 0;

    const allocation = (formData.get('allocation') || 'Store').toString();
    const isPettyCash = Boolean(document.getElementById('adminPettyCash')?.checked);
    let supplierNameRaw = (formData.get('supplierName') || '').toString();
    const resolvedSupplier = isPettyCash
        ? null
        : shared.getSuppliers().find(
              (s) => (s.name || '').toLowerCase() === supplierNameRaw.trim().toLowerCase()
          );

    const vatSectionEl = document.getElementById('adminVatSection');
    const vatHidden = vatSectionEl?.classList.contains('admin-hidden');
    let vatExemptAmount = isPettyCash
        ? 0
        : parseFloat(document.getElementById('adminVatExemptAmount')?.value) || 0;
    let vatComputationEnabled = isPettyCash
        ? false
        : document.getElementById('adminVatComputationEnabled')?.checked === true;
    if (!isPettyCash && vatHidden && resolvedSupplier && !resolvedSupplier.isVatRegistered) {
        vatComputationEnabled = false;
        vatExemptAmount = 0;
    }

    const expensePayload = {
        id: expenseId,
        date: formData.get('date'),
        allocation,
        branch: allocation === 'Store' ? formData.get('branch') : null,
        isPettyCash,
        supplierName: supplierNameRaw.trim(),
        ...(isPettyCash || !resolvedSupplier ? {} : { supplierId: resolvedSupplier.id }),
        businessName: isPettyCash ? '' : formData.get('businessName'),
        tin: isPettyCash ? '' : formData.get('tin'),
        address: isPettyCash ? '' : formData.get('address'),
        invoiceNumber: formData.get('invoiceNumber'),
        expenseCategory: formData.get('expenseCategory') || existingExpense?.expenseCategory || shared.DEFAULT_EXPENSE_CATEGORY,
        items,
        totalAmount,
        vatExemptAmount,
        vatComputationEnabled,
        paidBy: allocation === 'Store' ? normalizeAdminPaidBy(formData.get('paidBy')) : 'Company',
        notes: formData.get('notes'),
        receiptImage: (() => {
            if (window.adminReceiptRemove) return null;
            if (adminPendingReceiptUrl) return adminPendingReceiptUrl;
            return existingExpense?.receiptImage || null;
        })()
    };

    const result = shared.createExpenseObject(expensePayload, {
        existingExpense: isNew ? null : existingExpense,
        isEditing: !isNew,
        calculateTotalFromItems: false,
        autoCalculateVAT: true,
        validate: true
    });

    if (!result.success || !result.expense) {
        shared.showToast((result.errors && result.errors.join(', ')) || 'Could not save expense');
        return;
    }

    const expense = result.expense;
    if (existingExpense?.paymentMethod) {
        expense.paymentMethod = existingExpense.paymentMethod;
    }
    if (isNew) {
        expense.createdAt = new Date().toISOString();
    } else if (existingExpense?.createdAt) {
        expense.createdAt = existingExpense.createdAt;
    }

    if (isPettyCash) {
        expense.supplierId = null;
    }

    if (isNew) {
        shared.addExpense(expense);
        shared.showToast('Expense added successfully');
    } else {
        shared.updateExpense(expenseId, expense);
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
window.requestCloseAdminExpenseModal = requestCloseAdminExpenseModal;

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

