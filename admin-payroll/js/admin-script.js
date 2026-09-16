const APP_VERSION = "2.0.57"; // bump with index.html ?v= when shipping; v2 Firestore paths
console.log('✅ Admin Payroll script loaded - Version:', APP_VERSION);

// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
    getFirestore,
    collection,
    getDocs,
    getDocsFromServer,
    doc,
    getDoc,
    getDocFromServer,
    waitForPendingWrites,
    updateDoc,
    setDoc,
    query,
    where,
    orderBy,
    limit,
    documentId,
    deleteDoc,
    addDoc,
    serverTimestamp,
    deleteField
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { deleteObject, getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import {
    formatDate,
    generatePayrollPeriods,
    getPeriodDatesFromId,
    getNextPayrollPeriod,
    getPreviousPeriodIds,
    getPayDay
} from '../../shared/js/payrollPeriods.js?v=20260815-2';
import {
    loadBranchesFromFirebase,
    populateAttendanceBranchSelects,
    populateAttendanceBranchSelect,
    attendanceMatchesFilter,
    getBranchDisplayName
} from '../../shared/js/branches.js';
import {
    buildPayslipBranchData,
    buildPayslipBreakdownHtml,
    buildPayslipDocumentHtml,
    renderPayslipHtmlToPdf
} from '../../shared/js/payslipPdf.js?v=1';
import { markPeriodEarningPrepaid } from '../../shared/js/payrollPayments.js?v=20260915-1';

const PERIOD_EARNINGS_COLLECTION = 'payroll_period_earnings_v2';
const PRIOR_EARNINGS_TOGGLE_KEY = 'payroll_include_prior_earnings_v1';
const PERIOD_EARNINGS_KINDS = [
    { value: 'adjustment', label: 'Adjustment' },
    { value: 'salary_carry', label: 'Salary carry' },
    { value: 'cash_advance', label: 'Cash advance' },
    { value: 'reimbursement', label: 'Reimbursement' }
];

function isPriorEarningsToggleOn() {
    try {
        return localStorage.getItem(PRIOR_EARNINGS_TOGGLE_KEY) === '1';
    } catch {
        return false;
    }
}

function setPriorEarningsToggle(on) {
    try {
        localStorage.setItem(PRIOR_EARNINGS_TOGGLE_KEY, on ? '1' : '0');
    } catch { /* ignore */ }
}

function periodsForHelpers() {
    return (typeof window !== 'undefined' && Array.isArray(window.payrollPeriods) && window.payrollPeriods.length)
        ? window.payrollPeriods
        : generatePayrollPeriods();
}

function earningsKindLabel(kind, amount) {
    if (kind === 'cash_advance') return 'Cash Advance';
    if (kind === 'reimbursement') return 'Reimbursement';
    if (kind === 'salary_carry') return 'Salary Carry';
    if (kind === 'adjustment') return 'Adjustment';
    if (Number(amount) < 0) return 'Cash Advance';
    return 'Period Extra';
}

function sourceRequestCollectionForKind(kind, sourceCollection) {
    if (sourceCollection) return sourceCollection;
    if (kind === 'reimbursement') return 'reimbursement_requests';
    return 'cash_advance_requests';
}

function isEarningsOpen(line) {
    const status = line?.status;
    if (status === 'waived' || status === 'applied') return false;
    return true;
}

function payDayIsoFromPeriodId(periodId) {
    const dates = getPeriodDatesFromId(periodId);
    if (!dates?.endDate) return null;
    const payDay = getPayDay(dates.endDate);
    return `${payDay.getFullYear()}-${String(payDay.getMonth() + 1).padStart(2, '0')}-${String(payDay.getDate()).padStart(2, '0')}`;
}

// Firebase configuration - you'll need to replace this with your actual Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app); // Add this line

/** Same key as migration-tool; optional fast path for payroll period list. */
const MIGRATION_EARLIEST_CACHE_KEY = 'payroll_migration_v2_earliest_v1';
const PAYROLL_SUMMARY_CACHE_VERSION = 1;

let loadDataRunId = 0;
/** True while loadData main try runs — suppress nested hideLoading in findOldestRecordAcrossEmployees */
let payrollBulkLoadInProgress = false;
let summaryReconcileInProgress = false;
/** True while stale-while-revalidate microtask is running after full-cache fast path */
let fullCacheReconcileInProgress = false;
let summaryModeActive = false;

let backgroundRefreshSetupDone = false;
let visibilityRefreshDebounceTimer = null;
const VISIBILITY_REFRESH_DEBOUNCE_MS = 3000;

function readMigrationEarliestDateFromCache() {
    try {
        const raw = localStorage.getItem(MIGRATION_EARLIEST_CACHE_KEY);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (o.v !== 1 || o.projectId !== firebaseConfig.projectId || !o.globalEarliestYmd) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(o.globalEarliestYmd)) return null;
        const p = o.globalEarliestYmd.split('-').map((x) => parseInt(x, 10));
        return new Date(p[0], p[1] - 1, p[2]);
    } catch {
        return null;
    }
}

function populatePeriodEarningsEmployeeSelect() {
    const sel = document.getElementById('periodEarningsEmployeeId');
    if (!sel || !employees) return;
    const v = sel.value;
    sel.innerHTML = '<option value="">Select…</option>';
    Object.keys(employees)
        .sort((a, b) => (employees[a] || '').localeCompare(employees[b] || ''))
        .forEach((id) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `${employees[id]} (${id})`;
            sel.appendChild(opt);
        });
    if (v && employees[v]) sel.value = v;
}

function populatePeriodEarningsKindSelect() {
    const sel = document.getElementById('periodEarningsKind');
    if (!sel) return;
    const v = sel.value || 'adjustment';
    sel.innerHTML = PERIOD_EARNINGS_KINDS.map((k) =>
        `<option value="${k.value}">${k.label}</option>`
    ).join('');
    sel.value = PERIOD_EARNINGS_KINDS.some((k) => k.value === v) ? v : 'adjustment';
}

async function clearCashAdvanceRequestStamps(sourceRequestId, mode = 'waived', kind = null, sourceCollection = null) {
    if (!sourceRequestId) return;
    const collectionName = sourceRequestCollectionForKind(kind, sourceCollection);
    try {
        const requestRef = doc(db, collectionName, sourceRequestId);
        const snap = await getDoc(requestRef);
        if (!snap.exists()) {
            // Fallback: try the other collection once
            const alt = collectionName === 'reimbursement_requests' ? 'cash_advance_requests' : 'reimbursement_requests';
            const altRef = doc(db, alt, sourceRequestId);
            const altSnap = await getDoc(altRef);
            if (!altSnap.exists()) return;
            const patch = {
                appliedPeriodId: null,
                appliedPayDay: null,
                appliedEarningsId: null,
                appliedTarget: null,
                appliedAt: null
            };
            if (mode === 'waived') {
                patch.status = 'waived';
                patch.waivedAt = new Date().toISOString();
            }
            await updateDoc(altRef, patch);
            return;
        }
        const patch = {
            appliedPeriodId: null,
            appliedPayDay: null,
            appliedEarningsId: null,
            appliedTarget: null,
            appliedAt: null
        };
        if (mode === 'waived') {
            patch.status = 'waived';
            patch.waivedAt = new Date().toISOString();
        } else if (mode === 'sync') {
            delete patch.appliedPeriodId;
            delete patch.appliedPayDay;
            delete patch.appliedEarningsId;
            delete patch.appliedTarget;
            delete patch.appliedAt;
        }
        await updateDoc(requestRef, patch);
    } catch (err) {
        console.warn(`Could not update ${collectionName} stamps:`, err);
    }
}

async function syncCashAdvanceRequestAfterEdit(sourceRequestId, earningsId, periodId, kind = null, sourceCollection = null) {
    if (!sourceRequestId) return;
    const collectionName = sourceRequestCollectionForKind(kind, sourceCollection);
    try {
        await updateDoc(doc(db, collectionName, sourceRequestId), {
            appliedTarget: PERIOD_EARNINGS_COLLECTION,
            appliedPeriodId: periodId || null,
            appliedPayDay: payDayIsoFromPeriodId(periodId),
            appliedEarningsId: earningsId || null,
            appliedAt: new Date().toISOString(),
            status: 'approved'
        });
    } catch (err) {
        // Fallback try other collection
        try {
            const alt = collectionName === 'reimbursement_requests' ? 'cash_advance_requests' : 'reimbursement_requests';
            await updateDoc(doc(db, alt, sourceRequestId), {
                appliedTarget: PERIOD_EARNINGS_COLLECTION,
                appliedPeriodId: periodId || null,
                appliedPayDay: payDayIsoFromPeriodId(periodId),
                appliedEarningsId: earningsId || null,
                appliedAt: new Date().toISOString(),
                status: 'approved'
            });
        } catch (err2) {
            console.warn(`Could not sync request stamps after edit:`, err2);
        }
    }
}

async function reloadPayrollAfterEarningsChange() {
    const periodId = periodSelect?.value;
    if (periodId) await loadData(periodId);
    await refreshPeriodEarningsTable();
    if (currentEmployeeView) {
        const container = document.getElementById('employee-details-table');
        if (container) await loadEmployeeDetailsAsMainTable(currentEmployeeView, container);
        updateViewMode();
    }
}

function showConfirmModal({ title, message, detail = '', okText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const detailEl = document.getElementById('confirmDetail');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) return Promise.resolve(false);

    titleEl.textContent = title || 'Confirm';
    messageEl.textContent = message || '';
    if (detailEl) {
        if (detail) {
            detailEl.textContent = detail;
            detailEl.hidden = false;
        } else {
            detailEl.textContent = '';
            detailEl.hidden = true;
        }
    }
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    okBtn.className = danger ? 'submit-btn submit-btn--danger' : 'submit-btn';
    cancelBtn.style.display = 'inline-flex';

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    return new Promise((resolve) => {
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            modal.removeEventListener('click', handleOutside);
            document.removeEventListener('keydown', handleKey);
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            okBtn.className = 'submit-btn';
        };
        const handleOk = () => {
            cleanup();
            resolve(true);
        };
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };
        const handleOutside = (e) => {
            if (e.target === modal) handleCancel();
        };
        const handleKey = (e) => {
            if (e.key === 'Escape') handleCancel();
        };
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        modal.addEventListener('click', handleOutside);
        document.addEventListener('keydown', handleKey);
        okBtn.focus();
    });
}

let pendingPeriodEarningEdit = null;

function closeEditPeriodEarningModal() {
    const modal = document.getElementById('editPeriodEarningModal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    pendingPeriodEarningEdit = null;
}

function openEditPeriodEarningModal(docId, line) {
    pendingPeriodEarningEdit = { docId, line };
    const modal = document.getElementById('editPeriodEarningModal');
    const amountEl = document.getElementById('editPeriodEarningAmount');
    const noteEl = document.getElementById('editPeriodEarningNote');
    const titleEl = document.getElementById('editPeriodEarningTitle');
    if (!modal || !amountEl || !noteEl) return;
    const label = earningsKindLabel(line?.kind, line?.amount);
    if (titleEl) titleEl.textContent = `Edit ${label}`;
    amountEl.value = Number.isFinite(Number(line?.amount)) ? Number(line.amount) : '';
    noteEl.value = line?.note || '';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    amountEl.focus();
    amountEl.select();
}

async function submitEditPeriodEarning(ev) {
    ev.preventDefault();
    if (!pendingPeriodEarningEdit) return;
    const { docId, line } = pendingPeriodEarningEdit;
    const amount = parseFloat(document.getElementById('editPeriodEarningAmount')?.value, 10);
    const note = (document.getElementById('editPeriodEarningNote')?.value || '').trim();
    if (!Number.isFinite(amount)) {
        showToast('Enter a valid amount', 'error');
        return;
    }
    try {
        const patch = {
            amount,
            note: String(note).slice(0, 200),
            originPeriodId: line?.originPeriodId || line?.periodId || periodSelect.value
        };
        if (!line?.status) patch.status = 'open';
        await updateDoc(doc(db, PERIOD_EARNINGS_COLLECTION, docId), patch);
        if (line?.sourceRequestId) {
            await syncCashAdvanceRequestAfterEdit(
                line.sourceRequestId,
                docId,
                line.periodId || periodSelect.value,
                line.kind,
                line.sourceCollection
            );
        }
        closeEditPeriodEarningModal();
        showToast('Updated. Reloading payroll…');
        await reloadPayrollAfterEarningsChange();
    } catch (err) {
        console.error(err);
        showToast('Could not update', 'error');
    }
}

function editPeriodEarningLine(docId, line) {
    openEditPeriodEarningModal(docId, line);
}

async function waiveOrDeletePeriodEarningLine(docId, line) {
    const label = earningsKindLabel(line?.kind, line?.amount);
    const confirmed = await showConfirmModal({
        title: `Waive this ${label}?`,
        message: 'It will no longer affect payroll totals for this cutoff.',
        okText: 'Waive',
        danger: true
    });
    if (!confirmed) return;
    try {
        await updateDoc(doc(db, PERIOD_EARNINGS_COLLECTION, docId), {
            status: 'waived',
            waivedAt: new Date().toISOString()
        });
        if (line?.sourceRequestId) {
            await clearCashAdvanceRequestStamps(line.sourceRequestId, 'waived', line.kind, line.sourceCollection);
        }
        showToast('Waived. Reloading payroll…');
        await reloadPayrollAfterEarningsChange();
    } catch (err) {
        console.error(err);
        showToast('Could not waive line', 'error');
    }
}

async function deferPeriodEarningLine(docId, line) {
    const fromPeriodId = line?.periodId || periodSelect.value;
    const next = getNextPayrollPeriod(fromPeriodId, periodsForHelpers());
    if (!next?.id) {
        showToast('Could not resolve next cutoff', 'error');
        return;
    }
    const label = earningsKindLabel(line?.kind, line?.amount);
    const confirmed = await showConfirmModal({
        title: 'Defer to next cutoff?',
        message: `Move this ${label} to the next payroll period.`,
        detail: next.label || next.id,
        okText: 'Defer'
    });
    if (!confirmed) return;
    try {
        const payDayIso = payDayIsoFromPeriodId(next.id);
        await updateDoc(doc(db, PERIOD_EARNINGS_COLLECTION, docId), {
            periodId: next.id,
            originPeriodId: line?.originPeriodId || fromPeriodId,
            status: 'open',
            payDay: payDayIso,
            deferredAt: new Date().toISOString(),
            deferredFromPeriodId: fromPeriodId
        });
        if (line?.sourceRequestId) {
            await syncCashAdvanceRequestAfterEdit(line.sourceRequestId, docId, next.id, line.kind, line.sourceCollection);
        }
        showToast(`Deferred to ${next.label || next.id}. Reloading…`);
        await reloadPayrollAfterEarningsChange();
    } catch (err) {
        console.error(err);
        showToast('Could not defer', 'error');
    }
}

async function markPeriodEarningAsPrepaid(docId, line) {
    if (line?.kind !== 'reimbursement') {
        showToast('Only reimbursements can be marked prepaid', 'error');
        return;
    }
    if (line?.prePaid || Number(line?.prePaidAmount) > 0) {
        showToast('Already marked prepaid', 'error');
        return;
    }
    const amount = Math.abs(Number(line?.amount) || 0);
    if (amount <= 0) {
        showToast('Invalid reimbursement amount', 'error');
        return;
    }
    const confirmed = await showConfirmModal({
        title: 'Mark reimbursement as prepaid?',
        message: 'Keeps this line on the payslip, and adds the amount to paid for this period so the payroll transfer does not include it again.',
        detail: `₱${amount.toFixed(2)}`,
        okText: 'Mark prepaid'
    });
    if (!confirmed) return;
    try {
        const result = await markPeriodEarningPrepaid(db, {
            earningsDocId: docId,
            employeeId: line.employeeId || currentEmployeeView || null,
            periodId: line.periodId || periodSelect.value,
            amount,
            sourceRequestId: line.sourceRequestId || null,
            note: 'Already paid out (separate transfer)'
        });
        if (result.alreadyPrepaid) {
            showToast('Already marked prepaid');
        } else {
            const paymentData = result.paymentResult?.paymentData;
            const empId = line.employeeId || currentEmployeeView;
            if (paymentData && empId) {
                applyVerifiedPaymentToLocalState(
                    line.periodId || periodSelect.value,
                    empId,
                    paymentData
                );
            }
            showToast('Marked prepaid. Reloading…');
        }
        await reloadPayrollAfterEarningsChange();
    } catch (err) {
        console.error(err);
        showToast(err?.message || 'Could not mark prepaid', 'error');
    }
}

function bindPeriodEarningActionButtons(root) {
    if (!root) return;
    root.querySelectorAll('[data-pe-action]').forEach((btn) => {
        if (btn._peBound) return;
        btn._peBound = true;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = btn.getAttribute('data-pe-action');
            const docId = btn.getAttribute('data-doc-id');
            if (!docId) return;
            let line = null;
            try {
                const raw = btn.getAttribute('data-line') || '{}';
                line = raw.includes('%') ? JSON.parse(decodeURIComponent(raw)) : JSON.parse(raw);
            } catch {
                line = {};
            }
            line.id = docId;
            if (action === 'edit') await editPeriodEarningLine(docId, line);
            else if (action === 'waive') await waiveOrDeletePeriodEarningLine(docId, line);
            else if (action === 'defer') await deferPeriodEarningLine(docId, line);
            else if (action === 'mark_prepaid') await markPeriodEarningAsPrepaid(docId, line);
        });
    });
}

function periodEarningActionsHtml(line) {
    const encoded = encodeURIComponent(JSON.stringify({
        amount: line.amount,
        note: line.note || '',
        kind: line.kind || null,
        periodId: line.periodId || periodSelect?.value || null,
        originPeriodId: line.originPeriodId || null,
        sourceRequestId: line.sourceRequestId || null,
        sourceCollection: line.sourceCollection || null,
        status: line.status || null,
        fromPriorCutoff: !!line.fromPriorCutoff,
        employeeId: line.employeeId || null,
        prePaid: !!line.prePaid,
        prePaidAmount: Number(line.prePaidAmount || 0)
    }));
    const canMarkPrepaid = line.kind === 'reimbursement'
        && !line.prePaid
        && !(Number(line.prePaidAmount) > 0)
        && Number(line.amount) > 0;
    const prepaidBtn = canMarkPrepaid
        ? `<button type="button" class="action-btn" data-pe-action="mark_prepaid" data-doc-id="${escapeHtml(line.id)}" data-line="${encoded}" title="Count this reimbursement toward paid amount (already transferred separately)">Mark prepaid</button>`
        : '';
    return `
        <div class="action-buttons-container period-earning-actions">
            <button type="button" class="action-btn" data-pe-action="edit" data-doc-id="${escapeHtml(line.id)}" data-line="${encoded}">Edit</button>
            <button type="button" class="action-btn" data-pe-action="defer" data-doc-id="${escapeHtml(line.id)}" data-line="${encoded}" title="Move to next cutoff">Defer</button>
            ${prepaidBtn}
            <button type="button" class="action-btn action-btn--waive" data-pe-action="waive" data-doc-id="${escapeHtml(line.id)}" data-line="${encoded}">Waive</button>
        </div>
    `;
}

async function refreshPeriodEarningsTable() {
    const tbody = document.getElementById('periodEarningsTableBody');
    const periodId = periodSelect.value;
    if (!tbody || !periodId) return;
    tbody.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
    try {
        const q = query(collection(db, PERIOD_EARNINGS_COLLECTION), where('periodId', '==', periodId));
        const snap = await getDocs(q);
        tbody.innerHTML = '';
        const rows = [];
        snap.forEach((d) => {
            const r = d.data();
            if (r.status === 'waived') return;
            rows.push({ id: d.id, ...r });
        });
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6">No extra earnings for this period.</td></tr>';
            return;
        }
        rows.forEach((r) => {
            const name = employees[r.employeeId] || r.employeeId;
            const amt = Number(r.amount || 0);
            const kindLabel = earningsKindLabel(r.kind, amt);
            const prepaidNote = (r.prePaid || Number(r.prePaidAmount) > 0) ? ' [Prepaid]' : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(String(name))}</td>
                <td>${escapeHtml(String(r.employeeId || ''))}</td>
                <td style="${amt < 0 ? 'color:#b91c1c;' : ''}">₱${amt.toFixed(2)}</td>
                <td>${escapeHtml(String(kindLabel))}${prepaidNote}</td>
                <td>${escapeHtml(String(r.note || ''))}</td>
                <td>${periodEarningActionsHtml({ ...r, id: r.id })}</td>`;
            tbody.appendChild(tr);
        });
        tbody.querySelectorAll('[data-pe-action]').forEach((btn) => {
            btn._peBound = false;
        });
        bindPeriodEarningActionButtons(tbody);
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6">Error loading earnings.</td></tr>';
    }
}

async function openPeriodEarningsModal() {
    const modal = document.getElementById('periodEarningsModal');
    if (!modal) return;
    populatePeriodEarningsEmployeeSelect();
    populatePeriodEarningsKindSelect();
    const editId = document.getElementById('periodEarningsEditId');
    if (editId) editId.value = '';
    const submitBtn = document.querySelector('#periodEarningsForm button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Add line';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    await refreshPeriodEarningsTable();
}

function closePeriodEarningsModal() {
    const modal = document.getElementById('periodEarningsModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

async function submitPeriodEarning(ev) {
    ev.preventDefault();
    const periodId = periodSelect.value;
    const employeeId = document.getElementById('periodEarningsEmployeeId').value.trim();
    const amount = parseFloat(document.getElementById('periodEarningsAmount').value, 10);
    const note = document.getElementById('periodEarningsNote').value.trim();
    const kind = document.getElementById('periodEarningsKind')?.value || 'adjustment';
    const editId = document.getElementById('periodEarningsEditId')?.value?.trim() || '';
    if (!employeeId || !employees[employeeId]) {
        showToast('Select a valid employee', 'error');
        return;
    }
    if (!Number.isFinite(amount)) {
        showToast('Enter a valid amount', 'error');
        return;
    }
    try {
        if (editId) {
            await updateDoc(doc(db, PERIOD_EARNINGS_COLLECTION, editId), {
                employeeId,
                amount,
                note,
                kind,
                status: 'open'
            });
            showToast('Line updated. Reloading payroll…');
        } else {
            const finalAmount = kind === 'cash_advance'
                ? -Math.abs(amount)
                : (kind === 'reimbursement' ? Math.abs(amount) : amount);
            await addDoc(collection(db, PERIOD_EARNINGS_COLLECTION), {
                periodId,
                originPeriodId: periodId,
                employeeId,
                amount: finalAmount,
                note,
                kind,
                status: 'open',
                payDay: payDayIsoFromPeriodId(periodId),
                createdAt: serverTimestamp()
            });
            showToast('Line added. Reloading payroll…');
        }
        document.getElementById('periodEarningsAmount').value = '';
        document.getElementById('periodEarningsNote').value = '';
        if (document.getElementById('periodEarningsEditId')) {
            document.getElementById('periodEarningsEditId').value = '';
        }
        const submitBtn = document.querySelector('#periodEarningsForm button[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Add line';
        await loadData(periodSelect.value);
        await refreshPeriodEarningsTable();
    } catch (err) {
        console.error(err);
        showToast('Could not save earnings line', 'error');
    }
}

// Toast Notification Functions
function showToast(message, type = 'success', duration = 3000) {
    const toastContainer = document.getElementById('toastContainer');
    
    // If toast container doesn't exist, just use alert for now
    if (!toastContainer) {
        alert(message);
        return;
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Auto remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

// Employee data - loaded from Firebase
let employees = {};

// Debounce mechanism for updateViewMode to prevent multiple rapid calls
let updateViewModeTimeout = null;
let isUpdateViewModeRunning = false;

const importedNameMap = {
    "Acerr": "Acerr Franco",
    "Avi": "Laville Laborte",
    "Bea": "Beatrice Grace Boldo",
    "Charles": "Charles Francis Tan",
    "Denzel": "Denzel Genesis Fernandez",
    "Gab": "Gabrielle Hannah Catalan",
    "Ja": "Japhet Dizon",
    "Jas": "Jasmine Ferrer",
    "Lester": "John Lester Cal",
    "Liezel": "Liezel Acebedo",
    "Mae": "Sheila Mae Salvajan",
    "Paul": "Paul John Garin",
    "Raniel": "Raniel Buenaventura",
    "Raschel": "Raschel Joy Cruz",
    "Sarah": "Sarah Perpinan",
    "Toph": "Cristopher David", // assumed alias
    "rhobbie": "Rhobbie Ryza Saligumba"
};

let HOLIDAYS_2025 = {};
let holidaysLoaded = false;

// PayCalculator instance
let payCalculator = null;

/** @param {string} [periodId] if omitted, uses periodSelect.value */
function calcPeriodId(periodId) {
    if (periodId !== undefined && periodId !== null && periodId !== '') return periodId;
    return typeof periodSelect !== 'undefined' && periodSelect ? periodSelect.value : '';
}

function mergeEmpRates(employee, periodId) {
    if (!employee) return employee;
    return PayCalculator.mergeEmployeeRatesForPeriod(employee, calcPeriodId(periodId));
}

function employeeIncludesMealAllowance(employee, periodId) {
    const merged = mergeEmpRates(employee, periodId) || employee;
    if (typeof PayCalculator?.includesMealAllowance === 'function') {
        return PayCalculator.includesMealAllowance(merged);
    }
    return (merged?.payScheme || 'standard') !== 'inclusive';
}

function applyMealAllowanceControlState(checkboxEl, employee) {
    if (!checkboxEl) return;
    const includesMeal = employeeIncludesMealAllowance(employee);
    const label = document.querySelector(`label[for="${checkboxEl.id}"]`);
    if (!includesMeal) {
        checkboxEl.checked = false;
        checkboxEl.disabled = true;
        if (label) label.textContent = 'Meal already included in daily rate';
    } else {
        checkboxEl.disabled = false;
        if (label) label.textContent = 'Include meal allowance (₱150 full day / ₱75 half day)';
    }
}

function calcTotalPaySimple(dates, employee, periodId) {
    if (!payCalculator) {
        const t = employee?.totalPayWithBonus;
        return Number.isFinite(t) ? Number(t) : (Number(employee?.periodEarningsTotal) || 0);
    }
    const base = payCalculator.calculateTotalPay(dates || [], mergeEmpRates(employee, periodId), 'simple');
    return base + (Number(employee?.periodEarningsTotal) || 0);
}

function calcTotalPayDetailed(dates, employee, periodId) {
    if (!payCalculator) {
        const t = employee?.totalPayWithBonus;
        const base = Number.isFinite(t) ? Number(t) : 0;
        return { total: base, entries: [], breakdown: {} };
    }
    const result = payCalculator.calculateTotalPay(dates || [], mergeEmpRates(employee, periodId), 'detailed');
    const extras = Number(employee?.periodEarningsTotal) || 0;
    if (extras) {
        result.total = (Number(result.total) || 0) + extras;
        result.periodEarningsTotal = extras;
        result.periodEarningsLines = employee?.periodEarningsLines || [];
    }
    return result;
}

async function loadPeriodEarningsForPeriod(periodId) {
    const byEmployee = {};
    if (!periodId) return byEmployee;

    const pushLine = (d, fromPriorCutoff) => {
        const r = d.data();
        if (r.status === 'waived') return;
        if (fromPriorCutoff && !isEarningsOpen(r)) return;
        if (fromPriorCutoff && r.status === 'applied') return;
        const eid = r.employeeId;
        if (!eid) return;
        if (!byEmployee[eid]) {
            byEmployee[eid] = { total: 0, lines: [] };
        }
        // Skip if already loaded for current period (same doc)
        if (byEmployee[eid].lines.some((l) => l.id === d.id)) return;
        const amt = Number(r.amount) || 0;
        byEmployee[eid].total += amt;
        byEmployee[eid].lines.push({
            id: d.id,
            amount: amt,
            note: r.note || '',
            kind: r.kind || null,
            status: r.status || 'open',
            periodId: r.periodId || periodId,
            originPeriodId: r.originPeriodId || r.periodId || null,
            sourceRequestId: r.sourceRequestId || null,
            payDay: r.payDay || null,
            requestedAt: r.requestedAt || null,
            createdAt: r.createdAt || null,
            fromPriorCutoff: !!fromPriorCutoff
        });
    };

    try {
        const q = query(collection(db, PERIOD_EARNINGS_COLLECTION), where('periodId', '==', periodId));
        const snap = await getDocs(q);
        snap.forEach((d) => pushLine(d, false));

        if (isPriorEarningsToggleOn()) {
            const priorIds = getPreviousPeriodIds(periodId, 2, periodsForHelpers());
            for (const priorId of priorIds) {
                const pq = query(collection(db, PERIOD_EARNINGS_COLLECTION), where('periodId', '==', priorId));
                const pSnap = await getDocs(pq);
                pSnap.forEach((d) => {
                    const r = d.data();
                    // Only overlay still-open lines that remain on the prior period (not yet deferred forward)
                    if (r.status === 'waived' || r.status === 'applied') return;
                    pushLine(d, true);
                });
            }
        }
    } catch (err) {
        console.error('Failed to load period earnings:', err);
    }
    return byEmployee;
}

function applyPeriodEarningsToAttendanceData(attendanceData, earningsByEmployee) {
    Object.keys(attendanceData || {}).forEach((employeeId) => {
        const bucket = earningsByEmployee[employeeId];
        attendanceData[employeeId].periodEarningsTotal = bucket ? bucket.total : 0;
        attendanceData[employeeId].periodEarningsLines = bucket ? bucket.lines : [];
    });
    Object.keys(earningsByEmployee || {}).forEach((employeeId) => {
        if (attendanceData[employeeId]) return;
        const name = employees[employeeId] || employeeId;
        attendanceData[employeeId] = {
            id: employeeId,
            name,
            baseRate: 750,
            salesBonusEligible: false,
            payType: 'hourly',
            dates: [],
            periodEarningsTotal: earningsByEmployee[employeeId].total,
            periodEarningsLines: earningsByEmployee[employeeId].lines
        };
    });
}

/** Format request/created date for period-earning rows (local calendar day). */
function formatEarningsRequestDate(line) {
    const raw = line?.requestedAt || line?.createdAt;
    if (!raw) return '—';
    try {
        let d;
        if (typeof raw.toDate === 'function') d = raw.toDate();
        else if (typeof raw.toMillis === 'function') d = new Date(raw.toMillis());
        else if (typeof raw === 'string') d = new Date(raw.includes('T') ? raw : raw + 'T00:00:00');
        else if (typeof raw.seconds === 'number') d = new Date(raw.seconds * 1000);
        else d = new Date(raw);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
        return '—';
    }
}

function buildPeriodEarningsTableRowHtml(line, showSalesBonus) {
    const amt = Number(line.amount || 0);
    const label = earningsKindLabel(line.kind, amt);
    const priorTag = line.fromPriorCutoff ? ' · Prior cutoff' : '';
    const prepaidTag = (line.prePaid || Number(line.prePaidAmount) > 0) ? ' · Prepaid' : '';
    const dateLabel = formatEarningsRequestDate(line);
    const salesCell = showSalesBonus ? '<td>—</td>' : '';
    return `
        <td class="date-cell">
            <span class="date-day">${escapeHtml(dateLabel)}</span>
            ${line.fromPriorCutoff ? '<span class="leave-badge" style="background:#fef3c7;color:#92400e;">Prior</span>' : ''}
            ${(line.prePaid || Number(line.prePaidAmount) > 0) ? '<span class="leave-badge" style="background:#dbeafe;color:#1e40af;">Prepaid</span>' : ''}
        </td>
        <td><span class="deduction-label">${escapeHtml(label)}${priorTag}${prepaidTag}</span></td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        ${salesCell}
        <td class="deduction-amount" style="${amt < 0 ? 'color:#b91c1c;' : ''}">₱${amt.toFixed(2)}</td>
        <td class="action-cell">${periodEarningActionsHtml(line)}</td>
    `;
}

function appendPeriodEarningsRows(detailTableBody, lines, showSalesBonus) {
    if (!detailTableBody || !lines?.length) return;
    lines.forEach((line) => {
        if (line.status === 'waived') return;
        const isAdvance = line.kind === 'cash_advance' || (Number(line.amount) < 0 && line.kind !== 'reimbursement');
        const row = document.createElement('tr');
        row.className = isAdvance ? 'period-earning-row period-earning-row--advance' : 'period-earning-row';
        if (line.kind === 'reimbursement') row.classList.add('period-earning-row--reimbursement');
        if (line.fromPriorCutoff) row.classList.add('period-earning-row--prior');
        row.innerHTML = buildPeriodEarningsTableRowHtml(line, showSalesBonus);
        detailTableBody.appendChild(row);
    });
    bindPeriodEarningActionButtons(detailTableBody);
}

function upsertEmployeeRateHistory(rateHistory, periodId, fields) {
    const list = Array.isArray(rateHistory) ? [...rateHistory] : [];
    const idx = list.findIndex((r) => r && r.periodId === periodId);
    const entry = { periodId, ...fields };
    if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    else list.push(entry);
    return list;
}

const PAYMENTS_SUBCOL = 'payments';

function v2PaymentsCollRef(periodId) {
    return collection(db, 'payroll_periods_v2', periodId, PAYMENTS_SUBCOL);
}

function v2PaymentDocRef(periodId, employeeId) {
    return doc(db, 'payroll_periods_v2', periodId, PAYMENTS_SUBCOL, employeeId);
}

function periodPaymentsCacheKey(periodId) {
    return `payroll_period_payments_v2_${periodId}`;
}

function readPeriodPaymentsCacheMap(periodId) {
    const cacheKey = periodPaymentsCacheKey(periodId);
    try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const data = parsed?.data;
        if (!data || typeof data !== 'object') return null;
        return data;
    } catch (_) {
        return null;
    }
}

function writePeriodPaymentsCacheMap(periodId, data) {
    const cacheKey = periodPaymentsCacheKey(periodId);
    try {
        localStorage.setItem(cacheKey, JSON.stringify({
            data: data || {},
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn('Could not write period payments cache:', e);
    }
}

/** Balance from live period total minus accumulated payments.
 *  Surplus is overpayment only: cash actually paid above what is payable.
 *  A negative period net (advances/penalties) is not surplus. */
function getPaymentBalance(currentTotalPay, paymentData) {
    const total = Number(currentTotalPay) || 0;
    const paid = paymentData ? (Number(paymentData.paymentAmount) || 0) : 0;
    const payable = Math.max(0, Math.round(total * 100) / 100);
    let remaining = Math.round((payable - paid) * 100) / 100;
    if (Math.abs(remaining) < 0.01) remaining = 0;
    const surplus = (paid > 0 && remaining < 0) ? Math.round((-remaining) * 100) / 100 : 0;
    const due = remaining > 0 ? remaining : 0;
    return {
        total,
        paid,
        remaining: due,
        surplus,
        rawRemaining: Math.round((total - paid) * 100) / 100
    };
}

function getPaymentStatusKind(bal) {
    if (bal.surplus > 0) return 'surplus';
    if (bal.paid > 0 && bal.remaining <= 0) return 'paid';
    if (bal.paid > 0 && bal.remaining > 0) return 'partial';
    if (bal.remaining <= 0) return 'none';
    return 'unpaid';
}

function paymentStatusLabel(kind) {
    if (kind === 'surplus') return 'Surplus';
    if (kind === 'paid') return 'Paid';
    if (kind === 'partial') return 'Partial';
    if (kind === 'none') return 'No pay due';
    return 'Unpaid';
}

/** Remaining to pay (never negative). Use getPaymentBalance for surplus. */
function getPayableRemaining(currentTotalPay, paymentData) {
    return getPaymentBalance(currentTotalPay, paymentData).remaining;
}

function formatPayableCell(totalPay, paymentData) {
    const bal = getPaymentBalance(totalPay, paymentData);
    if (bal.surplus > 0) {
        return {
            amount: bal.surplus,
            className: 'surplus-amount',
            label: `₱${bal.surplus.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} surplus`
        };
    }
    const settled = bal.remaining <= 0;
    return {
        amount: bal.remaining,
        className: settled && bal.paid > 0 ? 'paid-amount' : (settled ? '' : 'payable-amount'),
        label: `₱${bal.remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    };
}

async function loadHolidays() {
    if (holidaysLoaded) return HOLIDAYS_2025;

    try {
        const holidayDoc = await getDoc(doc(db, "config", "holidays_2025"));
        if (holidayDoc.exists()) {
            HOLIDAYS_2025 = holidayDoc.data();
            holidaysLoaded = true;
            console.log("✅ Holidays loaded from Firebase");
        }
        return HOLIDAYS_2025;
    } catch (error) {
        console.error("Failed to load holidays:", error);
        return {};
    }
}

function getEmployeeIdFromImportedName(name) {
    const cleanName = name.replace(/^"|"$/g, '').trim().toLowerCase();
    const mappedName = Object.keys(importedNameMap).find(alias => alias.toLowerCase() === cleanName);

    if (!mappedName) return null;
    return Object.keys(employees).find(id => employees[id] === importedNameMap[mappedName]);
}

// document.getElementById('utakImportInput').addEventListener('change', handleUtakImport);

async function handleUtakImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    showLoading();

    const text = await file.text();
    const rows = text.split('\n').map(row => row.split(','));

    const header = rows[0].map(h => h.trim().replace(/^"|"$/g, ''));

    console.log("🪵 CSV Header Detected:", header); // <-- Debug here

    const expectedColumns = [
        "Staff", "In Date", "In Time", "Out Date", "Out time",
        "Total Duration Hours", "Total Duration Mins",
        "Break In Date", "Break In Time", "Break Out Date", "Break Out time",
        "Total Break Duration Hours", "Total Break Duration Mins"
    ];

    // Validate format
    if (!expectedColumns.every((col, i) => header[i]?.trim().toLowerCase() === col.toLowerCase())) {
        hideLoading();
        alert("Invalid CSV format. Please use the Utak export format.");
        return;
    }

    const updates = {};
    for (let i = 1; i < rows.length; i++) {
        console.log(`📄 Row ${i} raw values:`, rows[i]);

        const [rawStaff, rawInDate, rawInTime, rawOutDate, rawOutTime] = rows[i];
        if (!rawStaff || !rawInDate || !rawInTime || !rawOutDate || !rawOutTime) continue;

        const staff = rawStaff.replace(/^"|"$/g, '').trim();
        const inDate = rawInDate.replace(/^"|"$/g, '').trim();
        const inTime = rawInTime.replace(/^"|"$/g, '').trim();
        const outTime = rawOutTime.replace(/^"|"$/g, '').trim();

        const empId = getEmployeeIdFromImportedName(staff);
        if (!empId) {
            console.warn("⚠️ Unknown staff alias:", `"${staff}"`, i);
            continue;
        }

        const parsedDate = new Date(inDate);
        if (isNaN(parsedDate.getTime())) {
            console.warn(`⛔ Skipping row ${i}: Invalid date "${inDate}"`);
            continue;
        }
        const dateKey = formatDate(parsedDate);

        const timeInFormatted = inTime.replace(/\s+/g, ' ').trim();
        const timeOutFormatted = outTime.replace(/\s+/g, ' ').trim();

        if (!updates[empId]) updates[empId] = {};
        updates[empId][dateKey] = {
            clockIn: {
                time: timeInFormatted,
                branch: "Podium",
                shift: "Custom"
            },
            clockOut: {
                time: timeOutFormatted
            }
        };
    }

    if (Object.keys(updates).length === 0) {
        console.warn("⚠️ No valid updates found from CSV. Check name mapping or data range.");
        hideLoading();
        alert("CSV parsed but contains no valid records to import.");
        return;
    }


    // Push to Firebase
    const batch = [];
    for (const [empId, days] of Object.entries(updates)) {
        for (const [dateKey, entry] of Object.entries(days)) {
            const ref = doc(db, "attendance_v2", empId, "dates", dateKey);

            console.log("Writing to:", empId, dateKey, entry);

            if (!empId) {
                console.warn("⚠️ Unknown staff name:", staff);
                continue;
            }

            batch.push(setDoc(ref, entry, { merge: true }));
        }
    }

    try {
        await Promise.all(batch);
        // CSV import successful - no notification needed
        refreshBtn.dataset.forceRefresh = 'true';
        isInitialLoad = false;
        periodSelect.dispatchEvent(new Event('change'));

        localStorage.removeItem(getCacheKey(periodSelect.value, branchSelect.value));

        await loadData(); // Reload with fresh data
    } catch (error) {
        console.error("CSV import failed:", error);
        alert("❌ Import failed. Check console for details.");
    } finally {
        hideLoading();
    }
}

let currentEmployeeView = null; // null for all employees view, employeeId for single employee view

function convertTo12Hour(timeStr) {
    if (!timeStr) return null;
    const [hourStr, minStr] = timeStr.split(':');
    let hours = parseInt(hourStr, 10);
    const minutes = parseInt(minStr, 10);
    const meridian = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes.toString().padStart(2, '0')} ${meridian}`;
}

// Shift schedules
const SHIFT_SCHEDULES = {
    "Opening": { timeIn: "9:30 AM", timeOut: "6:30 PM" },
    "Adjusted Opening": { timeIn: "10:30 AM", timeOut: "7:30 PM" },
    "Opening Half-Day": { timeIn: "9:30 AM", timeOut: "1:30 PM" },
    "Midshift": { timeIn: "11:00 AM", timeOut: "8:00 PM" },
    "Closing": { timeIn: "1:00 PM", timeOut: "10:00 PM" },
    "Closing Half-Day": { timeIn: "6:00 PM", timeOut: "10:00 PM" },
    "Custom": { timeIn: null, timeOut: null }
};

// Sales bonus configuration
const SALES_BONUS_CONFIG = {
    baseQuotaPerStaff: 5000, // ₱5,000 per staff member
    bonusPerTier: 25,
    tierAmount: 2500,
    defaultStaffing: {
        weekday: 2.5,
        weekend: 3.0
    }
};

// DOM elements
const loadingOverlay = document.getElementById('loadingOverlay');
const mobileLoadingOverlay = document.getElementById('mobileLoadingOverlay');
const photoModal = document.getElementById('photoModal');
const modalImage = document.getElementById('modalImage');
const closeModal = document.getElementById('closeModal');
const periodSelect = document.getElementById('periodSelect');
const branchSelect = document.getElementById('branchSelect');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const employeeTableBody = document.getElementById('employeeTableBody');
const employeeCardsMobileEl = document.getElementById('employeeCardsMobile');
const employeeDetailMobileModal = document.getElementById('employeeDetailMobileModal');
const employeeDetailMobileClose = document.getElementById('employeeDetailMobileClose');
const employeeDetailMobileName = document.getElementById('employeeDetailMobileName');
const periodSelectModal = document.getElementById('periodSelectModal');
const periodSelectModalClose = document.getElementById('periodSelectModalClose');
const periodSelectModalList = document.getElementById('periodSelectModalList');
const mobileSummaryCard = document.getElementById('mobileSummaryCard');
const employeeDetailMobileSummary = document.getElementById('employeeDetailMobileSummary');
const employeeDetailMobileActions = document.getElementById('employeeDetailMobileActions');
const employeeDetailMobileDayCards = document.getElementById('employeeDetailMobileDayCards');
const employeeEditModal = document.getElementById('employeeEditModal');
const closeEditModal = document.getElementById('closeEditModal');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const employeeEditForm = document.getElementById('employeeEditForm');
const editEmployeeName = document.getElementById('editEmployeeName');
const editBaseRate = document.getElementById('editBaseRate');
const editPayScheme = document.getElementById('editPayScheme');
const editEmployeeId = document.getElementById('editEmployeeId');
const editNickname = document.getElementById('editNickname');

const shiftEditModal = document.getElementById('shiftEditModal');
const closeShiftEditModalBtn = document.getElementById('closeShiftEditModal');
const cancelShiftEditBtn = document.getElementById('cancelShiftEditBtn');
const shiftEditForm = document.getElementById('shiftEditForm');
const editShiftBranch = document.getElementById('editShiftBranch');
const editShiftSchedule = document.getElementById('editShiftSchedule');
const editShiftEmployeeId = document.getElementById('editShiftEmployeeId');
const editShiftDate = document.getElementById('editShiftDate');

const editShiftFixedPay = document.getElementById('editShiftFixedPay');
const editShiftFixedAmount = document.getElementById('editShiftFixedAmount');
const editShiftFixedAmountGroup = document.getElementById('editShiftFixedAmountGroup');

const batchEditModal = document.getElementById('batchEditModal');
const closeBatchEditModalBtn = document.getElementById('closeBatchEditModal');
const cancelBatchEditBtn = document.getElementById('cancelBatchEditBtn');
const batchEditForm = document.getElementById('batchEditForm');
const batchEditBranch = document.getElementById('batchEditBranch');
const batchEditShift = document.getElementById('batchEditShift');
const batchEditEmployeeId = document.getElementById('batchEditEmployeeId');

const addEmployeeBtn = document.getElementById('addEmployeeBtn');
const addEmployeeModal = document.getElementById('addEmployeeModal');
const closeAddEmployeeModal = document.getElementById('closeAddEmployeeModal');
const cancelAddEmployeeBtn = document.getElementById('cancelAddEmployeeBtn');
const addEmployeeForm = document.getElementById('addEmployeeForm');
const addEmployeeId = document.getElementById('addEmployeeId');
const addEmployeeName = document.getElementById('addEmployeeName');
const addBaseRate = document.getElementById('addBaseRate');
const addNickname = document.getElementById('addNickname');
const editSalesBonus = document.getElementById('editSalesBonus');
const addSalesBonus = document.getElementById('addSalesBonus');

const holidaysModal = document.getElementById('holidaysModal');
const closeHolidaysModal = document.getElementById('closeHolidaysModal');
const closeHolidaysBtn = document.getElementById('closeHolidaysBtn');
const addHolidayForm = document.getElementById('addHolidayForm');
const holidaysTableBody = document.getElementById('holidaysTableBody');

const addShiftModal = document.getElementById('addShiftModal');
const closeAddShiftModal = document.getElementById('closeAddShiftModal');
const cancelAddShiftBtn = document.getElementById('cancelAddShiftBtn');
const addShiftForm = document.getElementById('addShiftForm');
const addShiftDate = document.getElementById('addShiftDate');
const addShiftBranch = document.getElementById('addShiftBranch');
const addShiftSchedule = document.getElementById('addShiftSchedule');
const addShiftTimeIn = document.getElementById('addShiftTimeIn');
const addShiftTimeOut = document.getElementById('addShiftTimeOut');
const addShiftEmployeeId = document.getElementById('addShiftEmployeeId');
const addShiftDoublePay = document.getElementById('addShiftDoublePay');
const addShiftFixedPay = document.getElementById('addShiftFixedPay');
const addShiftFixedAmount = document.getElementById('addShiftFixedAmount');
const addShiftFixedAmountGroup = document.getElementById('addShiftFixedAmountGroup');
const addShiftMealAllowance = document.getElementById('addShiftMealAllowance');
const addShiftTranspoAllowance = document.getElementById('addShiftTranspoAllowance');
const addShiftOTPay = document.getElementById('addShiftOTPay');


const refreshIndicator = document.createElement('div');
refreshIndicator.className = 'refresh-indicator';
refreshIndicator.innerHTML = `
    <div class="refresh-spinner"></div>
    <div class="refresh-text">Refreshing data...</div>
`;
document.body.appendChild(refreshIndicator);

// Add these to your DOMContentLoaded event listener
closeEditModal.addEventListener('click', closeEditEmployeeModal);
cancelEditBtn.addEventListener('click', closeEditEmployeeModal);
employeeEditForm.addEventListener('submit', saveEmployeeChanges);
editPayScheme?.addEventListener('change', () => {
    const hint = document.getElementById('editPaySchemeHint');
    if (hint) {
        hint.textContent = editPayScheme.value === 'inclusive'
            ? 'Meal is already part of the daily rate, so it isn’t added again.'
            : '₱150 is added on top of the daily base (₱75 half day).';
    }
});

closeShiftEditModalBtn.addEventListener('click', closeShiftEditModal);
cancelShiftEditBtn.addEventListener('click', closeShiftEditModal);
const deleteShiftLogBtn = document.getElementById('deleteShiftLogBtn');
if (deleteShiftLogBtn) {
    deleteShiftLogBtn.addEventListener('click', async () => {
        const employeeId = document.getElementById('editShiftEmployeeId')?.value;
        const dateStr = document.getElementById('editShiftDate')?.value;
        const deleted = await deleteAttendanceEntry(employeeId, dateStr);
        if (deleted) closeShiftEditModal();
    });
}
const removeTimeInBtn = document.getElementById('removeTimeInBtn');
if (removeTimeInBtn) {
    removeTimeInBtn.addEventListener('click', async () => {
        const employeeId = document.getElementById('editShiftEmployeeId')?.value;
        const dateStr = document.getElementById('editShiftDate')?.value;
        const removed = await deletePunchFromEntry(employeeId, dateStr, 'in');
        if (removed) closeShiftEditModal();
    });
}
const removeTimeOutBtn = document.getElementById('removeTimeOutBtn');
if (removeTimeOutBtn) {
    removeTimeOutBtn.addEventListener('click', async () => {
        const employeeId = document.getElementById('editShiftEmployeeId')?.value;
        const dateStr = document.getElementById('editShiftDate')?.value;
        const removed = await deletePunchFromEntry(employeeId, dateStr, 'out');
        if (removed) closeShiftEditModal();
    });
}
shiftEditForm.addEventListener('submit', saveShiftChanges);

closeBatchEditModalBtn.addEventListener('click', closeBatchEditModal);
cancelBatchEditBtn.addEventListener('click', closeBatchEditModal);
batchEditForm.addEventListener('submit', saveBatchChanges);

addEmployeeBtn.addEventListener('click', openAddEmployeeModal);
closeAddEmployeeModal.addEventListener('click', closeAddEmployeeModalFunc);
cancelAddEmployeeBtn.addEventListener('click', closeAddEmployeeModalFunc);
addEmployeeForm.addEventListener('submit', saveNewEmployee);

const periodEarningsBtnEl = document.getElementById('periodEarningsBtn');
if (periodEarningsBtnEl) periodEarningsBtnEl.addEventListener('click', openPeriodEarningsModal);
const periodEarningsModalCloseEl = document.getElementById('periodEarningsModalClose');
if (periodEarningsModalCloseEl) periodEarningsModalCloseEl.addEventListener('click', closePeriodEarningsModal);
const periodEarningsFormEl = document.getElementById('periodEarningsForm');
if (periodEarningsFormEl) periodEarningsFormEl.addEventListener('submit', submitPeriodEarning);
const periodEarningsModalEl = document.getElementById('periodEarningsModal');
if (periodEarningsModalEl) {
    periodEarningsModalEl.addEventListener('click', (e) => {
        if (e.target === periodEarningsModalEl) closePeriodEarningsModal();
    });
}
const editPeriodEarningFormEl = document.getElementById('editPeriodEarningForm');
if (editPeriodEarningFormEl) editPeriodEarningFormEl.addEventListener('submit', submitEditPeriodEarning);
const editPeriodEarningCloseEl = document.getElementById('editPeriodEarningModalClose');
if (editPeriodEarningCloseEl) editPeriodEarningCloseEl.addEventListener('click', closeEditPeriodEarningModal);
const editPeriodEarningCancelEl = document.getElementById('editPeriodEarningCancel');
if (editPeriodEarningCancelEl) editPeriodEarningCancelEl.addEventListener('click', closeEditPeriodEarningModal);
const editPeriodEarningModalEl = document.getElementById('editPeriodEarningModal');
if (editPeriodEarningModalEl) {
    editPeriodEarningModalEl.addEventListener('click', (e) => {
        if (e.target === editPeriodEarningModalEl) closeEditPeriodEarningModal();
    });
}

closeAddShiftModal.addEventListener('click', closeAddShiftModalFunc);
cancelAddShiftBtn.addEventListener('click', closeAddShiftModalFunc);
addShiftForm.addEventListener('submit', saveNewShift);

// Add event listener for schedule changes to update time placeholders
console.log('Adding event listener to addShiftSchedule:', addShiftSchedule);
addShiftSchedule.addEventListener('change', function(e) {
    console.log('Schedule change event fired:', e.target.value);
    updateTimePlaceholders();
    toggleScheduledTimesFields('add', e.target.value);
});

// Add event listener for edit shift schedule changes
if (editShiftSchedule) {
    editShiftSchedule.addEventListener('change', function(e) {
        toggleScheduledTimesFields('edit', e.target.value);
    });
}

// Add event listener for fixed pay checkbox in add shift modal
addShiftFixedPay.addEventListener('change', function() {
    if (this.checked) {
        addShiftFixedAmountGroup.style.display = 'block';
        addShiftFixedAmount.required = true;
    } else {
        addShiftFixedAmountGroup.style.display = 'none';
        addShiftFixedAmount.required = false;
        addShiftFixedAmount.value = '';
    }
});

function togglePaidLeaveMode(modalType, isPaidLeave) {
    const workFields = document.getElementById(modalType === 'add' ? 'addShiftWorkFields' : 'editShiftWorkFields');
    const submitBtn = document.getElementById(modalType === 'add' ? 'addShiftSubmitBtn' : 'editShiftSubmitBtn');
    const requiredIds = modalType === 'add'
        ? ['addShiftBranch', 'addShiftSchedule', 'addShiftTimeIn', 'addShiftTimeOut']
        : ['editShiftBranch', 'editShiftSchedule'];

    if (workFields) {
        workFields.style.display = isPaidLeave ? 'none' : '';
    }
    requiredIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.required = !isPaidLeave;
    });
    if (submitBtn) {
        if (modalType === 'add') {
            submitBtn.textContent = isPaidLeave ? 'Add Leave' : 'Add Shift';
        } else {
            submitBtn.textContent = isPaidLeave ? 'Save Leave' : 'Save Changes';
        }
    }
}

const addShiftPaidLeave = document.getElementById('addShiftPaidLeave');
if (addShiftPaidLeave) {
    addShiftPaidLeave.addEventListener('change', function () {
        togglePaidLeaveMode('add', this.checked);
    });
}
const editShiftPaidLeave = document.getElementById('editShiftPaidLeave');
if (editShiftPaidLeave) {
    editShiftPaidLeave.addEventListener('change', function () {
        togglePaidLeaveMode('edit', this.checked);
    });
}


// Global data store
let attendanceData = {};
let filteredData = {};
let isInitialLoad = true;

async function clearAllTimeLogs() {
    const employeeIds = Object.keys(employees);

    for (const employeeId of employeeIds) {
        const attendanceRef = collection(db, "attendance_v2", employeeId, "dates");
        const snapshot = await getDocs(attendanceRef);

        const deletions = snapshot.docs.map(docSnap =>
            deleteDoc(doc(db, "attendance_v2", employeeId, "dates", docSnap.id))
        );

        await Promise.all(deletions);
        console.log(`🧹 Cleared logs for ${employeeId}`);
    }

    console.log("✅ All attendance logs cleared.");
}

function clearAllPeriodCaches() {
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('attendance_') || key.startsWith('payroll_summary_'))) {
            localStorage.removeItem(key);
        }
    }
    console.log("Cleared all period caches");
}

function getCacheKey(periodId, branchId) {
    try {
        let key = `attendance_${periodId}_${branchId}`;
        console.log("Generated key:", key);
        return key;
    } catch (e) {
        console.warn("Error generating cache key:", e);
        return `attendance_fallback_${Date.now()}`;
    }
}

function getSummaryCacheKey(periodId, branchId) {
    return `payroll_summary_${periodId}_${branchId}_v${PAYROLL_SUMMARY_CACHE_VERSION}`;
}

function saveSummaryToCache(periodId, branchId, attendance, paymentStatus = {}) {
    const cacheKey = getSummaryCacheKey(periodId, branchId);
    const employeesSummary = {};
    Object.entries(attendance || {}).forEach(([employeeId, employee]) => {
        employeesSummary[employeeId] = {
            id: employeeId,
            name: employee?.name || employees[employeeId] || employeeId,
            baseRate: Number(employee?.baseRate || 0),
            payType: employee?.payType || 'hourly',
            monthlySalary: Number(employee?.monthlySalary || 0),
            periodGross: employee?.periodGross ?? null,
            periodFixedAmount: Number(employee?.periodFixedAmount || 0),
            payScheme: employee?.payScheme === 'inclusive' ? 'inclusive' : 'standard',
            salesBonusEligible: !!employee?.salesBonusEligible,
            createdAt: employee?.createdAt || null,
            daysWorked: Number(employee?.daysWorked || 0),
            lateHours: Number(employee?.lateHours || 0),
            lastClockIn: employee?.lastClockIn ? new Date(employee.lastClockIn).toISOString() : null,
            lastClockInPhoto: employee?.lastClockInPhoto || null,
            totalPayWithBonus: Number(employee?.totalPayWithBonus || 0),
            payment: paymentStatus?.[employeeId] || null
        };
    });

    const payload = {
        version: APP_VERSION,
        schemaVersion: PAYROLL_SUMMARY_CACHE_VERSION,
        timestamp: Date.now(),
        periodId,
        branchId,
        employees: employeesSummary
    };
    try {
        localStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch (error) {
        console.warn('Could not save payroll summary cache:', error);
    }
}

function getSummaryFromCache(periodId, branchId) {
    const cacheKey = getSummaryCacheKey(periodId, branchId);
    try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== APP_VERSION || parsed.schemaVersion !== PAYROLL_SUMMARY_CACHE_VERSION) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        const isExpired = (Date.now() - (parsed.timestamp || 0)) > (24 * 60 * 60 * 1000);
        if (isExpired) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        return parsed;
    } catch (error) {
        console.warn('Error reading summary cache:', error);
        return null;
    }
}

function hydrateFromSummaryCache(summaryCache) {
    if (!summaryCache || !summaryCache.employees) return false;
    const hydrated = {};
    Object.entries(summaryCache.employees).forEach(([employeeId, summary]) => {
        hydrated[employeeId] = {
            id: employeeId,
            name: summary?.name || employees[employeeId] || employeeId,
            dates: [],
            lastClockIn: summary?.lastClockIn ? new Date(summary.lastClockIn) : null,
            lastClockInPhoto: summary?.lastClockInPhoto || null,
            daysWorked: Number(summary?.daysWorked || 0),
            lateHours: Number(summary?.lateHours || 0),
            baseRate: Number(summary?.baseRate || 0),
            salesBonusEligible: !!summary?.salesBonusEligible,
            payType: summary?.payType || 'hourly',
            monthlySalary: Number(summary?.monthlySalary || 0),
            periodGross: summary?.periodGross ?? null,
            periodFixedAmount: Number(summary?.periodFixedAmount || 0),
            payScheme: summary?.payScheme === 'inclusive' ? 'inclusive' : 'standard',
            totalPayWithBonus: Number(summary?.totalPayWithBonus || 0),
            createdAt: summary?.createdAt || null,
            _summaryOnly: true
        };
    });
    attendanceData = hydrated;
    window.paymentStatus = Object.fromEntries(
        Object.entries(summaryCache.employees)
            .filter(([, s]) => !!s?.payment)
            .map(([id, s]) => [id, s.payment])
    );
    return true;
}

function getEmployeeTotalPayForTable(employee, periodId) {
    const resolvedPayType =
        (typeof PayCalculator?.getRateForPeriod === 'function'
            ? PayCalculator.getRateForPeriod(employee, periodId).payType
            : null) ||
        employee?.payType ||
        'hourly';
    // Monthly/hybrid can have pay with zero attendance days (fixed cutoff amount)
    if (employee?.dates?.length > 0 || resolvedPayType === 'monthly' || resolvedPayType === 'hybrid') {
        return calcTotalPaySimple(employee?.dates || [], employee, periodId);
    }
    if (employee?._summaryOnly && Number.isFinite(employee.totalPayWithBonus)) {
        return Number(employee.totalPayWithBonus);
    }
    if (employee != null && Number.isFinite(employee.totalPayWithBonus)) {
        return Number(employee.totalPayWithBonus);
    }
    return calcTotalPaySimple(employee?.dates || [], employee || {}, periodId);
}

function getSelectedBranchFilter() {
    return isMobileLayout() ? 'all' : branchSelect.value;
}

function updatePayrollSummaryLabels(branchId) {
    const branchName = branchId === 'all'
        ? null
        : (branchSelect?.options?.[branchSelect.selectedIndex]?.text || getBranchName(branchId));
    const title = branchId === 'all' ? 'Total Payroll' : `${branchName} Payroll`;
    const subtitle = branchId === 'all' ? 'All branches · this period' : `${branchName} · this period`;

    const titleEl = document.getElementById('totalPayrollTitle');
    const subtitleEl = document.getElementById('totalPayrollSubtitle');
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;

    const mobileLabel = document.getElementById('mobileSummaryPayrollLabel');
    if (mobileLabel) mobileLabel.textContent = title;
}

function applyBranchFilterChange() {
    const periodId = periodSelect.value;
    const branchId = branchSelect.value;

    const summaryCache = getSummaryFromCache(periodId, branchId);
    if (summaryCache && hydrateFromSummaryCache(summaryCache)) {
        summaryModeActive = true;
        filterData({ skipPaymentFetch: true });
        queueMicrotask(() => {
            void loadPaymentDataAndRender({ forcePaymentRefresh: true });
        });
        return;
    }

    const cacheKey = getCacheKey(periodId, branchId);
    const cachedData = getFromCache(periodId, branchId);
    if (cachedData && validateCacheData(cacheKey, cachedData)) {
        attendanceData = JSON.parse(JSON.stringify(cachedData));
        summaryModeActive = false;
        Object.values(attendanceData).forEach((rec) => {
            if (rec && rec._summaryOnly) delete rec._summaryOnly;
        });
        filterData({ skipPaymentFetch: true });
        queueMicrotask(() => {
            void loadPaymentDataAndRender({ forcePaymentRefresh: true });
        });
        return;
    }

    summaryModeActive = false;
    filterData();
}

/** True if employee should count toward active headcount / unpaid (includes summary-only rows with no date rows). */
function getEmployeeCreatedAtMs(employee) {
    const createdAt = employee?.createdAt;
    if (!createdAt) return null;
    if (typeof createdAt.toMillis === 'function') return createdAt.toMillis();
    if (typeof createdAt.seconds === 'number') return createdAt.seconds * 1000;
    const parsed = new Date(createdAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/** Employees added after a cutoff ends should not appear on that past period. */
function employeeWasOnRosterForPeriod(employee, periodId) {
    const createdMs = getEmployeeCreatedAtMs(employee);
    if (createdMs == null) return true; // legacy records without createdAt
    try {
        const { endDate } = getPeriodDates(periodId);
        const periodEndMs = new Date(
            endDate.getFullYear(),
            endDate.getMonth(),
            endDate.getDate(),
            23, 59, 59, 999
        ).getTime();
        return createdMs <= periodEndMs;
    } catch (err) {
        return true;
    }
}

function employeeHasRosterPayActivity(employee, periodId) {
    if (!employee) return false;
    // Attendance in this period always counts (even if createdAt is missing/odd)
    if (employee.dates && employee.dates.some((d) => d && (d.timeIn || d.isPaidLeave))) return true;
    if (Number(employee.periodEarningsTotal)) return true;
    if (!employeeWasOnRosterForPeriod(employee, periodId)) return false;

    const pid = calcPeriodId(periodId);
    const payType =
        (typeof PayCalculator?.getRateForPeriod === 'function'
            ? PayCalculator.getRateForPeriod(employee, pid).payType
            : null) ||
        employee.payType ||
        'hourly';

    // Monthly / hybrid: owed even with zero shifts this cutoff
    if (payType === 'monthly' || payType === 'hybrid') {
        const total = getEmployeeTotalPayForTable(employee, pid);
        if (Number.isFinite(total) && total > 0) return true;
        // Still treat as active if configured with salary/fixed amount even before totals hydrate
        const rates =
            typeof PayCalculator?.getRateForPeriod === 'function'
                ? PayCalculator.getRateForPeriod(employee, pid)
                : employee;
        if (payType === 'monthly') {
            const monthly = Number(rates.monthlySalary) || 0;
            const periodGross = Number(rates.periodGross);
            if (Number.isFinite(periodGross) && periodGross > 0) return true;
            if (monthly > 0) return true;
        }
        if (payType === 'hybrid' && (Number(rates.periodFixedAmount) || 0) > 0) return true;
    }

    if (employee._summaryOnly) {
        if (Number(employee.daysWorked) > 0) return true;
        const t = employee.totalPayWithBonus;
        return Number.isFinite(t) && Number(t) > 0;
    }
    return false;
}

function saveToCache(cacheKey, data) {
    const cacheData = {
        timestamp: Date.now(),
        version: APP_VERSION,
        data: data
    };

    try {
        const serialized = JSON.stringify(cacheData);

        // Check if this would be a large cache entry
        const sizeInKB = Math.round(serialized.length / 1024);
        console.log(`Attempting to cache ${cacheKey} (${sizeInKB}KB)`);

        // If the cache is getting large, clear old ones first
        if (sizeInKB > 500) { // If over 500KB
            console.log('Large cache detected, clearing old caches first');
            clearOldPayrollPeriodCaches();
        }

        localStorage.setItem(cacheKey, serialized);

        // Add this key to our cache registry
        updateCacheRegistry(cacheKey);

        console.log(`Data cached for ${cacheKey} (${sizeInKB}KB)`);
    } catch (e) {
        console.warn('Cache storage failed, likely quota exceeded', e);

        // Try clearing old payroll caches first
        const clearedCount = clearOldPayrollPeriodCaches();

        if (clearedCount > 0) {
            // Try again after clearing old payroll caches
            try {
                localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                updateCacheRegistry(cacheKey);
                console.log('Successfully cached after clearing old payroll periods');
            } catch (retryError) {
                console.error('Cache storage failed even after clearing old payroll caches', retryError);
                // Last resort: clear ALL caches
                localStorage.clear();
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                    updateCacheRegistry(cacheKey);
                } catch (finalError) {
                    console.error('Cache storage failed completely', finalError);
                }
            }
        }
    }
}

// Modify the getFromCache function to be more tolerant of old cache data:
function getFromCache(periodId, branchId) {
    const cacheKey = getCacheKey(periodId, branchId);

    try {
        const cachedData = localStorage.getItem(cacheKey);
        if (!cachedData) {
            console.log(`No cache found for ${cacheKey}`);
            return null;
        }

        const parsedData = JSON.parse(cachedData);

        // Check version first - invalidate if version mismatch
        if (parsedData.version !== APP_VERSION) {
            console.log(`Cache version mismatch (cached: ${parsedData.version}, current: ${APP_VERSION}), invalidating`);
            localStorage.removeItem(cacheKey);
            return null;
        }

        // Increase the cache expiration time (from 4 hours to 24 hours)
        const cacheAge = Date.now() - parsedData.timestamp;
        const expirationTime = 24 * 60 * 60 * 1000; // 24 hours instead of 4 hours

        if (cacheAge > expirationTime) {
            console.log('Cache expired, removing');
            localStorage.removeItem(cacheKey);
            return null;
        }

        console.log(`Using cached data from ${new Date(parsedData.timestamp).toLocaleTimeString()}`);
        return parsedData.data;
    } catch (e) {
        console.warn('Error reading from cache', e);
        return null;
    }
}

function updateCacheRegistry(newKey) {
    try {
        // Get the current registry
        let registry = JSON.parse(localStorage.getItem('cache_registry') || '[]');

        // Add the new key if it doesn't exist
        if (!registry.includes(newKey)) {
            registry.push(newKey);

            // Store timestamp with key for smarter clearing
            const registryWithTimestamps = {};
            registry.forEach(key => {
                try {
                    const item = localStorage.getItem(key);
                    if (item) {
                        const parsed = JSON.parse(item);
                        registryWithTimestamps[key] = parsed.timestamp || Date.now();
                    }
                } catch (e) {
                    // If we can't parse, just use current time
                    registryWithTimestamps[key] = Date.now();
                }
            });

            // Save updated registry
            localStorage.setItem('cache_registry', JSON.stringify(registry));
            localStorage.setItem('cache_timestamps', JSON.stringify(registryWithTimestamps));
        }
    } catch (e) {
        console.warn('Error updating cache registry', e);
    }
}

function clearOldCaches() {
    try {
        // Get registry and timestamps
        const registry = JSON.parse(localStorage.getItem('cache_registry') || '[]');
        const timestamps = JSON.parse(localStorage.getItem('cache_timestamps') || '{}');

        // More aggressive: keep only 2 most recent caches instead of 5
        if (registry.length <= 2) {
            console.log('Cache size within limits, no clearing needed');
            return;
        }

        // Convert to array and sort by timestamp (oldest first)
        const keysByAge = Object.entries(timestamps)
            .sort(([, timeA], [, timeB]) => timeA - timeB)
            .map(([key]) => key);

        // Keep only last 2 caches (most recent)
        const keysToKeep = keysByAge.slice(-2);
        const keysToRemove = registry.filter(key => !keysToKeep.includes(key));

        // Remove old caches
        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            console.log(`Removed old cache: ${key}`);
        });

        // Update registry
        localStorage.setItem('cache_registry', JSON.stringify(keysToKeep));

        // Update timestamps
        const newTimestamps = {};
        keysToKeep.forEach(key => {
            newTimestamps[key] = timestamps[key];
        });
        localStorage.setItem('cache_timestamps', JSON.stringify(newTimestamps));

        console.log(`Cleared ${keysToRemove.length} old caches, keeping ${keysToKeep.length}`);
    } catch (e) {
        console.warn('Error clearing old caches', e);

        // Fallback: clear ALL attendance caches and start fresh
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && key.startsWith('attendance_')) {
                    localStorage.removeItem(key);
                    console.log(`Fallback: removed ${key}`);
                }
            }
            // Reset the registry
            localStorage.removeItem('cache_registry');
            localStorage.removeItem('cache_timestamps');
        } catch (clearError) {
            console.error('Failed to clear caches', clearError);
        }
    }
}

function clearOldPayrollPeriodCaches() {
    try {
        const currentPeriodId = periodSelect.value;
        const currentBranchId = branchSelect.value;
        const currentCacheKey = getCacheKey(currentPeriodId, currentBranchId);

        console.log('Clearing old payroll period caches, keeping current:', currentCacheKey);

        let removedCount = 0;

        // Get all localStorage keys
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);

            // Only target attendance cache keys
            if (key && key.startsWith('attendance_')) {
                // Keep the current period's cache
                if (key !== currentCacheKey) {
                    localStorage.removeItem(key);
                    removedCount++;
                    console.log(`Removed old payroll cache: ${key}`);
                }
            }
        }

        // Also clean up the registry
        localStorage.setItem('cache_registry', JSON.stringify([currentCacheKey]));
        localStorage.setItem('cache_timestamps', JSON.stringify({
            [currentCacheKey]: Date.now()
        }));

        console.log(`Cleared ${removedCount} old payroll period caches`);
        return removedCount;
    } catch (error) {
        console.error('Error clearing old payroll caches:', error);
        return 0;
    }
}


let oldestRecordFound = false;

async function initializePayrollPeriods() {
    try {
        const currentSelection = periodSelect.value;
        console.log("Preserving period selection:", currentSelection);

        // Don't show loading if it's the initial load
        const oldestDate = await findOldestRecordAcrossEmployees();

        // Get current date for the latest date
        const today = new Date();

        // Generate periods (0 = no artificial cap; see shared/js/payrollPeriods.js)
        if (oldestDate) {
            console.log(`Oldest record found: ${formatDate(oldestDate)}`);

            // We don't need to go back before the oldest record
            // Just use the exact date as the start
            window.payrollPeriods = generatePayrollPeriods(oldestDate, today, false, 0);
            console.log(`Generated ${window.payrollPeriods.length} payroll periods from ${formatDate(oldestDate)} to today`);

            // Log the range of periods for debugging
            if (window.payrollPeriods.length > 0) {
                const earliest = window.payrollPeriods[window.payrollPeriods.length - 1];
                const latest = window.payrollPeriods[0];
                console.log(`Period range: ${earliest.label} to ${latest.label}`);
            }
        } else {
            // Default to 3 periods if no data found
            window.payrollPeriods = generatePayrollPeriods();
            console.log("No records found, using default periods");
        }

        // Update dropdown and preserve selection
        updatePeriodDropdown();

        // Restore selection if it exists
        if (currentSelection && periodSelect.querySelector(`option[value="${currentSelection}"]`)) {
            periodSelect.value = currentSelection;
        }
    } catch (error) {
        console.error("Error initializing payroll periods:", error);
        // Fallback to default periods
        window.payrollPeriods = generatePayrollPeriods();
        updatePeriodDropdown();
    }
}

async function findOldestRecordAcrossEmployees() {
    if (!payrollBulkLoadInProgress && !isInitialLoad) {
        showLoading("Finding oldest attendance record...");
    }

    try {
        const employeeIds = Object.keys(employees);
        if (employeeIds.length === 0) {
            if (!payrollBulkLoadInProgress) hideLoading();
            return null;
        }

        const results = await Promise.all(
            employeeIds.map(async (employeeId) => {
                const attendanceRef = collection(db, "attendance_v2", employeeId, "dates");
                const q = query(attendanceRef, orderBy(documentId()), limit(1));
                const snapshot = await getDocs(q);
                if (snapshot.empty) return null;
                const ymd = snapshot.docs[0].id;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
                return new Date(
                    parseInt(ymd.slice(0, 4), 10),
                    parseInt(ymd.slice(5, 7), 10) - 1,
                    parseInt(ymd.slice(8, 10), 10)
                );
            })
        );

        let oldestDate = null;
        for (const d of results) {
            if (d && (!oldestDate || d < oldestDate)) oldestDate = d;
        }

        if (oldestDate) {
            console.log(`Oldest record found across all employees: ${formatDate(oldestDate)}`);
            if (!payrollBulkLoadInProgress) hideLoading();
            return oldestDate;
        }
        console.log("No records found across any employees");
        if (!payrollBulkLoadInProgress) hideLoading();
        return null;
    } catch (error) {
        console.error("Error finding oldest record:", error);
        if (!payrollBulkLoadInProgress) hideLoading();
        return null;
    }
}

async function loadAllEmployees() {
    try {
        const [v2Snapshot, legacySnapshot] = await Promise.all([
            getDocs(collection(db, "employees_v2")),
            getDocs(collection(db, "employees"))
        ]);

        employees = {};
        // Start with legacy employees, then let v2 override any duplicates.
        legacySnapshot.forEach(doc => {
            const data = doc.data();
            employees[doc.id] = data.name;
        });
        v2Snapshot.forEach(doc => {
            const data = doc.data();
            employees[doc.id] = data.name;
        });

        // console.log("Loaded employees from Firebase:", employees);
        return employees;
    } catch (error) {
        console.error("Error loading employees:", error);
        return {};
    }
}

/**
 * Load sales daily docs. When rangeStartYmd + rangeEndYmd (YYYY-MM-DD) are set, only docs in that id range are read.
 */
async function loadSalesData(branch = null, rangeStartYmd = null, rangeEndYmd = null) {
    try {
        const useRange = !!(rangeStartYmd && rangeEndYmd);
        let docs;

        if (branch === 'podium') {
            const col = collection(db, 'sales-data', 'podium', 'daily');
            const snapshot = useRange
                ? await getDocs(
                      query(
                          col,
                          where(documentId(), '>=', rangeStartYmd),
                          where(documentId(), '<=', rangeEndYmd)
                      )
                  )
                : await getDocs(col);
            docs = snapshot.docs;
        } else if (branch === 'smnorth' || branch === 'sm-north') {
            const col = collection(db, 'sales-data', 'sm-north', 'daily');
            const snapshot = useRange
                ? await getDocs(
                      query(
                          col,
                          where(documentId(), '>=', rangeStartYmd),
                          where(documentId(), '<=', rangeEndYmd)
                      )
                  )
                : await getDocs(col);
            docs = snapshot.docs;
        } else {
            const [smNorthSnapshot, podiumSnapshot] = await Promise.all([
                useRange
                    ? getDocs(
                          query(
                              collection(db, 'sales-data', 'sm-north', 'daily'),
                              where(documentId(), '>=', rangeStartYmd),
                              where(documentId(), '<=', rangeEndYmd)
                          )
                      )
                    : getDocs(collection(db, 'sales-data', 'sm-north', 'daily')),
                useRange
                    ? getDocs(
                          query(
                              collection(db, 'sales-data', 'podium', 'daily'),
                              where(documentId(), '>=', rangeStartYmd),
                              where(documentId(), '<=', rangeEndYmd)
                          )
                      )
                    : getDocs(collection(db, 'sales-data', 'podium', 'daily'))
            ]);
            docs = [...smNorthSnapshot.docs, ...podiumSnapshot.docs];
        }

        const salesData = {};
        docs.forEach((d) => {
            const data = d.data();
            if (
                data.totalSales ||
                (data.cash || 0) + (data.gcash || 0) + (data.maya || 0) + (data.card || 0) + (data.grab || 0) > 0
            ) {
                salesData[d.id] = data;
            }
        });

        console.log('Loaded sales data from Firebase:', Object.keys(salesData).length, 'records');
        return salesData;
    } catch (error) {
        console.error('Error loading sales data:', error);
        return {};
    }
}

// Fast single-user loading functions
function getSingleUserCacheKey(employeeId, periodId, branchId) {
    return `single_user_${employeeId}_${periodId}_${branchId}`;
}

function cacheSingleUserData(employeeId, periodId, branchId, data) {
    const cacheKey = getSingleUserCacheKey(employeeId, periodId, branchId);
    localStorage.setItem(cacheKey, JSON.stringify({
        data: data,
        timestamp: Date.now(),
        period: periodId,
        branch: branchId
    }));
}

function getSingleUserFromCache(employeeId, periodId, branchId) {
    const cacheKey = getSingleUserCacheKey(employeeId, periodId, branchId);
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        const parsed = JSON.parse(cached);
        // Validate cache is still valid
        if (parsed.period === periodId && parsed.branch === branchId) {
            return parsed.data;
        }
    }
    return null;
}

async function loadSingleEmployeeData(employeeId, periodId = null) {
    const period = periodId || periodSelect.value;
    const branch = branchSelect.value;
    const { startDate, endDate } = getPeriodDates(period);
    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(endDate);
    
    console.log(`🚀 FAST LOADING: Single employee ${employeeId} for period: ${period}`);
    console.log(`📅 Date range: ${formattedStartDate} to ${formattedEndDate}`);
    console.log(`🏢 Branch filter: ${branch}`);
    
        // Check cache first
        const cachedData = getSingleUserFromCache(employeeId, period, branch);
        if (cachedData) {
            console.log('✅ Using cached single user data');
            return cachedData;
        }
        
        console.log('🔄 No cache found, fetching from Firebase...');
    
    try {
        // Only load essential data for this specific employee
        console.log('📡 Fetching employee details and attendance data...');
        const [employeeDoc, attendanceSnapshot] = await Promise.all([
            // Get employee details
            getDoc(doc(db, "employees_v2", employeeId)),
            // Get attendance data for this period only
            getDocs(query(
                collection(db, "attendance_v2", employeeId, "dates"),
                where("__name__", ">=", formattedStartDate),
                where("__name__", "<=", formattedEndDate)
            ))
        ]);
        
        console.log(`✅ Employee doc exists: ${employeeDoc.exists()}`);
        console.log(`✅ Attendance records found: ${attendanceSnapshot.size}`);
        
        // Load holidays (lightweight)
        await loadHolidays();
        
        // Load sales data only if employee is eligible
        // IMPORTANT: Sales bonus is only for SM North, so always load SM North sales data
        let salesData = {};
        if (employeeDoc.exists() && employeeDoc.data().salesBonusEligible) {
            salesData = await loadSalesData('sm-north', formattedStartDate, formattedEndDate);
        }
        
        // Initialize PayCalculator with minimal data
        payCalculator = new PayCalculator(HOLIDAYS_2025, salesData);
        
        // Process attendance data
        const dates = [];
        attendanceSnapshot.forEach(doc => {
            const dateData = doc.data();
            const dateStr = doc.id;
            
            // Check if the date is actually in the period range
            const dateObj = new Date(dateStr);
            const dateObjNoTime = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
            const startDateNoTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDateNoTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

            // Only proceed if date is in range
            if (dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime) {
                // Add branch filter condition
                const isPaidLeave = dateData.isPaidLeave === true;
                const branchName = dateData.clockIn?.branch || "N/A";
                const branchMatches = isPaidLeave || branch === 'all' || attendanceMatchesFilter(branchName, branch);

                if (branchMatches) {
                    // Now we load the full data including photos
                    const shiftType = dateData.clockIn?.shift || "Custom";
                    
                    // Get scheduled times: use stored values if available (for Custom shifts), otherwise use shift schedule
                    let scheduledIn, scheduledOut;
                    if (dateData.scheduledIn !== undefined && dateData.scheduledOut !== undefined) {
                        scheduledIn = dateData.scheduledIn;
                        scheduledOut = dateData.scheduledOut;
                    } else {
                        const shiftSchedule = SHIFT_SCHEDULES[shiftType] || SHIFT_SCHEDULES["Custom"];
                        scheduledIn = shiftSchedule.timeIn;
                        scheduledOut = shiftSchedule.timeOut;
                    }

                    dates.push({
                        date: dateStr,
                        branch: branchName,
                        shift: shiftType,
                        scheduledIn: scheduledIn,
                        scheduledOut: scheduledOut,
                        timeIn: dateData.clockIn?.time || null,
                        timeOut: dateData.clockOut?.time || null,
                        timeInPhoto: dateData.clockIn?.selfie || null,
                        timeOutPhoto: dateData.clockOut?.selfie || null,
                        timeInLocation: extractPunchLocation(dateData.clockIn),
                        timeOutLocation: extractPunchLocation(dateData.clockOut),
                        hasOTPay: dateData.hasOTPay || false,
                        transpoAllowance: dateData.transpoAllowance || 0,
                        hasFixedPay: dateData.hasFixedPay || false,
                        fixedPayAmount: dateData.fixedPayAmount || 0,
                        hasDoublePay: dateData.hasDoublePay || false,
                        isPaidLeave: dateData.isPaidLeave === true,
                        hasMealAllowance: dateData.hasMealAllowance !== false // Default to true
                    });
                }
            }
        });
        
        console.log(`📊 Processed ${dates.length} attendance dates`);
        
        const result = {
            employee: employeeDoc.data(),
            dates: dates,
            period: period,
            branch: branch
        };
        
        // Cache the result
        cacheSingleUserData(employeeId, period, branch, result);
        console.log('💾 Data cached for future use');
        
        return result;
        
    } catch (error) {
        console.error("❌ Error loading single employee data:", error);
        throw error;
    }
}

function updatePeriodDropdown() {
    // Store current selection before changing anything
    const currentSelection = periodSelect.value;
    console.log("Current period before dropdown update:", currentSelection);

    if (!window.payrollPeriods || window.payrollPeriods.length === 0) {
        periodSelect.innerHTML = '<option value="default">No Data</option>';
        return;
    }

    periodSelect.innerHTML = window.payrollPeriods.map(p =>
        `<option value="${p.id}">${p.label}</option>`
    ).join('');

    // If we had a selection, try to restore it
    if (currentSelection && periodSelect.querySelector(`option[value="${currentSelection}"]`)) {
        console.log("Restoring previous selection:", currentSelection);
        periodSelect.value = currentSelection;
    } else {
        // Otherwise, set to current period
        const today = new Date();
        let currentPeriodIndex = 0;

        for (let i = 0; i < window.payrollPeriods.length; i++) {
            const period = window.payrollPeriods[i];
            if (today >= period.start && today <= period.end) {
                currentPeriodIndex = i;
                break;
            }
        }

        periodSelect.value = window.payrollPeriods[currentPeriodIndex].id;
    }
}

async function loadData(selectedPeriodId = null, options = {}) {
    const {
        skipSummaryBootstrap = false,
        forceNetworkRefresh = false,
        silent = false
    } = options;
    // Debug: Log every call to loadData
    console.log(`🔍 loadData() called:`, {
        selectedPeriodId,
        currentEmployeeView,
        stack: new Error().stack.split('\n').slice(1, 4).join('\n')
    });
    
    // Prevent loading all data when in single employee view
    if (currentEmployeeView && !selectedPeriodId) {
        console.log(`🚫 BLOCKED: loadData() called while in single employee view (${currentEmployeeView})`);
        console.log(`🚫 Use loadSingleEmployeeData() instead for single employee views`);
        return;
    }

    const myRun = ++loadDataRunId;

    // Use the selected period or current value
    const forcedPeriodId = selectedPeriodId || periodSelect.value;
    console.log("FORCED LOADING FOR PERIOD:", forcedPeriodId);

    const branchId = isMobileLayout() ? 'all' : branchSelect.value;
    const cacheKey = getCacheKey(forcedPeriodId, branchId);

    await loadHolidays();

    console.log(`Loading data for: ${forcedPeriodId} ${branchId}`);

    // CRITICAL: Lock the period selection to prevent reverting
    if (selectedPeriodId) {
        periodSelect.value = selectedPeriodId;
    }

    const periodId = forcedPeriodId;
    const forcePeriodListRefresh = refreshBtn.dataset.forceRefresh === 'true';
    const shouldUseSummaryBootstrap = !skipSummaryBootstrap && !forcePeriodListRefresh && !currentEmployeeView;

    if (shouldUseSummaryBootstrap) {
        const summaryCache = getSummaryFromCache(periodId, branchId);
        if (summaryCache && hydrateFromSummaryCache(summaryCache)) {
            summaryModeActive = true;
            filterData({ skipPaymentFetch: true });
            hideLoading();

            queueMicrotask(() => {
                void loadPaymentDataAndRender({ forcePaymentRefresh: true });
            });

            if (!summaryReconcileInProgress) {
                queueMicrotask(async () => {
                    summaryReconcileInProgress = true;
                    try {
                        await loadData(periodId, {
                            skipSummaryBootstrap: true,
                            forceNetworkRefresh: true,
                            silent: true
                        });
                    } catch (reconcileError) {
                        console.warn('Summary reconcile failed:', reconcileError);
                    } finally {
                        summaryReconcileInProgress = false;
                    }
                });
            }
            return;
        }
    }
    summaryModeActive = false;

    // Rest of your existing loadData function...

    // At the end of the function:
    // CRITICAL: Ensure period is still selected
    if (selectedPeriodId && periodSelect.value !== selectedPeriodId) {
        console.log(`Fixing period selection back to: ${selectedPeriodId}`);
        periodSelect.value = selectedPeriodId;
    }

    // Always show instant data from cache first if available
    const cachedData = getFromCache(periodId, branchId);
        if (cachedData && validateCacheData(cacheKey, cachedData)) {
        console.log('Using valid cached data initially');
        attendanceData = cachedData;
        filterData();
        hideLoading();

        // Cache-only: no network (session already initialized).
        if (!forceNetworkRefresh && !isInitialLoad && refreshBtn.dataset.forceRefresh !== 'true') {
            console.log('Using cached data only (no background refresh)');
            if (myRun === loadDataRunId) hideLoading();
            return;
        }

        // First open: show full cache immediately, reconcile in background (mirror summary bootstrap).
        if (
            !forceNetworkRefresh &&
            isInitialLoad &&
            refreshBtn.dataset.forceRefresh !== 'true'
        ) {
            if (!fullCacheReconcileInProgress) {
                fullCacheReconcileInProgress = true;
                const reconcilePeriod = periodId;
                queueMicrotask(async () => {
                    try {
                        await loadData(reconcilePeriod, {
                            skipSummaryBootstrap: true,
                            forceNetworkRefresh: true,
                            silent: true
                        });
                    } catch (reconcileErr) {
                        console.warn('Full-cache reconcile failed:', reconcileErr);
                    } finally {
                        fullCacheReconcileInProgress = false;
                    }
                });
            }
            if (myRun === loadDataRunId) hideLoading();
            return;
        }

        // Otherwise, we'll continue to fetch updates in the background
        console.log('Continuing with background data refresh');
    } else if (cachedData) {
        console.log('Cache data invalid, invalidating cache');
        localStorage.removeItem(cacheKey);
        if (!silent) showLoading('Loading payroll data…', { fullPageBlocking: true });
    } else {
        // No cache available, show loading indicator
        if (!silent) showLoading('Loading payroll data…', { fullPageBlocking: true });
    }
    refreshBtn.dataset.forceRefresh = 'false';

    try {
        payrollBulkLoadInProgress = true;
        await loadAllEmployees();
        if (myRun !== loadDataRunId) return;

        {
            const n = Object.keys(employees).length;
            setPayrollLoadingProgress({
                phase: 'Loading sales data…',
                loaded: 0,
                total: n,
                indeterminate: true
            });
        }

        if (isInitialLoad || forcePeriodListRefresh) {
            await initializePayrollPeriods();
            if (myRun !== loadDataRunId) return;
        }

        const { startDate, endDate } = getPeriodDates(periodId);
        const formattedStartDate = formatDate(startDate);
        const formattedEndDate = formatDate(endDate);

        const salesData = await loadSalesData('sm-north', formattedStartDate, formattedEndDate);
        if (myRun !== loadDataRunId) return;
        window.salesDataCache = salesData;

        payCalculator = new PayCalculator(HOLIDAYS_2025, salesData);

        if (cachedData) {
            const sampleEmployee = Object.values(cachedData)[0];
            if (sampleEmployee && typeof sampleEmployee.salesBonusEligible === 'undefined') {
                localStorage.removeItem(cacheKey);
                attendanceData = {};
            }
        }

        const employeeIds = Object.keys(employees);
        const empLoadTotal = employeeIds.length;
        let hasChanges = false;
        const cacheWasValidForUi = !!(cachedData && validateCacheData(cacheKey, cachedData));
        const allRowsSummaryOnly =
            Object.keys(attendanceData).length > 0 &&
            Object.values(attendanceData).every((e) => e && e._summaryOnly);
        const useProgressiveRowReveal =
            !cacheWasValidForUi && !(silent && forceNetworkRefresh && allRowsSummaryOnly);

        if (useProgressiveRowReveal) {
            attendanceData = {};
            employeeIds.forEach((employeeId) => {
                attendanceData[employeeId] = {
                    id: employeeId,
                    name: employees[employeeId],
                    dates: [],
                    lastClockIn: null,
                    lastClockInPhoto: null,
                    daysWorked: 0,
                    lateHours: 0,
                    baseRate: 0,
                    salesBonusEligible: false,
                    _payrollRowLoading: true
                };
            });
        }

        const fetchOneEmployeeForPeriod = async (employeeId) => {
            try {
                // Always ensure the employee exists in the data structure
                if (!attendanceData[employeeId]) {
                    attendanceData[employeeId] = {
                        id: employeeId,
                        name: employees[employeeId],
                        dates: [],
                        lastClockIn: null,
                        lastClockInPhoto: null,
                        daysWorked: 0,
                        lateHours: 0,
                        baseRate: 0,
                        ...(useProgressiveRowReveal ? { _payrollRowLoading: true } : {})
                    };
                }

                // Get employee base rate
                const [employeeDocV2, employeeDocLegacy] = await Promise.all([
                    getDoc(doc(db, "employees_v2", employeeId)),
                    getDoc(doc(db, "employees", employeeId))
                ]);
                const employeeData = employeeDocV2.exists()
                    ? employeeDocV2.data()
                    : (employeeDocLegacy.exists() ? employeeDocLegacy.data() : null);
                if (employeeData) {
                    const currentLiveRate = employeeData.baseRate || 0;
                    const oldNickname = attendanceData[employeeId].nickname || '';
                    const newNickname = employeeData.nickname || '';

                    attendanceData[employeeId].rateHistory = Array.isArray(employeeData.rateHistory)
                        ? employeeData.rateHistory
                        : [];
                    attendanceData[employeeId].payType = employeeData.payType || 'hourly';
                    attendanceData[employeeId].monthlySalary = employeeData.monthlySalary || 0;
                    attendanceData[employeeId].periodGross =
                        employeeData.periodGross != null ? employeeData.periodGross : null;
                    attendanceData[employeeId].periodFixedAmount =
                        employeeData.periodFixedAmount != null ? Number(employeeData.periodFixedAmount) || 0 : 0;
                    attendanceData[employeeId].payScheme =
                        employeeData.payScheme === 'inclusive' ? 'inclusive' : 'standard';
                    attendanceData[employeeId].bankName = employeeData.bankName || '';
                    attendanceData[employeeId].bankAccountName = employeeData.bankAccountName || '';
                    attendanceData[employeeId].bankAccountNumber = employeeData.bankAccountNumber || '';
                    attendanceData[employeeId].transferMode = employeeData.transferMode || employeeData.modeOfTransfer || '';
                    attendanceData[employeeId].gotymeQrUrl = employeeData.gotymeQrUrl || '';
                    attendanceData[employeeId].bdoQrUrl = employeeData.bdoQrUrl || '';
                    attendanceData[employeeId].preferredBank = employeeData.preferredBank || employeeData.bankName || '';
                    attendanceData[employeeId].bankAccounts = employeeData.bankAccounts || {};
                    if (employeeData.createdAt) {
                        const createdMs = getEmployeeCreatedAtMs({ createdAt: employeeData.createdAt });
                        attendanceData[employeeId].createdAt = createdMs != null
                            ? new Date(createdMs).toISOString()
                            : null;
                    }

                    const rateForPeriod = PayCalculator.getRateForPeriod(attendanceData[employeeId], periodId);
                    const effectiveRate = rateForPeriod.baseRate || currentLiveRate;
                    attendanceData[employeeId].payScheme = rateForPeriod.payScheme || attendanceData[employeeId].payScheme;

                    // Base rate on bucket reflects period-effective rate for table display
                    const existingRate = attendanceData[employeeId].baseRate || 0;
                    if (existingRate === 0 || existingRate !== effectiveRate) {
                        attendanceData[employeeId].baseRate = effectiveRate;
                        hasChanges = true;
                    }

                    if (oldNickname !== newNickname) {
                        attendanceData[employeeId].nickname = newNickname;
                        hasChanges = true;
                    }

                    const oldSalesBonus = attendanceData[employeeId].salesBonusEligible || false;
                    const newSalesBonus = employeeData.salesBonusEligible || false;
                    if (oldSalesBonus !== newSalesBonus) {
                        attendanceData[employeeId].salesBonusEligible = newSalesBonus;
                        hasChanges = true;
                    }
                }

                // Get attendance data
                const attendanceRef = collection(db, "attendance_v2", employeeId, "dates");

                // Use a where clause to only fetch dates in range
                const snapshot = await getDocs(query(
                    attendanceRef,
                    where("__name__", ">=", formattedStartDate),
                    where("__name__", "<=", formattedEndDate)
                ));

                // Skip if no data and we already have no data
                if (snapshot.empty && attendanceData[employeeId].dates.length === 0) {
                    return;
                }

                let lastClockInDate = attendanceData[employeeId].lastClockIn
                    ? new Date(attendanceData[employeeId].lastClockIn)
                    : null;
                let totalLateHours = 0;
                let daysWorkedCount = 0;
                let datesMap = {};

                // Create a map of existing dates for quick lookup
                if (attendanceData[employeeId].dates) {
                    attendanceData[employeeId].dates.forEach(date => {
                        datesMap[date.date] = date;
                    });
                }

                // Process each date in the snapshot
                snapshot.forEach(doc => {
                    const dateStr = doc.id;
                    const dateData = doc.data();

                    // Create the new entry
                    const shiftType = dateData.clockIn?.shift || "Custom";
                    
                    // Get scheduled times: use stored values if available (for Custom shifts), otherwise use shift schedule
                    let scheduledIn, scheduledOut;
                    if (dateData.scheduledIn !== undefined && dateData.scheduledOut !== undefined) {
                        scheduledIn = dateData.scheduledIn;
                        scheduledOut = dateData.scheduledOut;
                    } else {
                        const shiftSchedule = SHIFT_SCHEDULES[shiftType] || SHIFT_SCHEDULES["Custom"];
                        scheduledIn = shiftSchedule.timeIn;
                        scheduledOut = shiftSchedule.timeOut;
                    }

                    const newEntry = {
                        date: dateStr,
                        branch: dateData.clockIn?.branch || "N/A",
                        shift: shiftType,
                        scheduledIn: scheduledIn,
                        scheduledOut: scheduledOut,
                        timeIn: dateData.clockIn?.time || null,
                        timeOut: dateData.clockOut?.time || null,
                        timeInPhoto: null,
                        timeOutPhoto: null,
                        timeInLocation: extractPunchLocation(dateData.clockIn),
                        timeOutLocation: extractPunchLocation(dateData.clockOut),
                        hasOTPay: dateData.hasOTPay || false,
                        transpoAllowance: dateData.transpoAllowance || 0,
                        hasFixedPay: dateData.hasFixedPay || false,
                        fixedPayAmount: dateData.fixedPayAmount || 0,
                        hasDoublePay: dateData.hasDoublePay || false,
                        isPaidLeave: dateData.isPaidLeave === true,
                        hasMealAllowance: dateData.hasMealAllowance !== false,
                        salesBonus: dateData.salesBonus || 0
                    };

                    // Check if this is a new or updated entry
                    const existingEntry = datesMap[dateStr];
                    let entryChanged = false;

                    if (!existingEntry) {
                        // Completely new entry
                        entryChanged = true;
                    } else {
                        // Check if any fields changed
                        for (const key of Object.keys(newEntry)) {
                            if (JSON.stringify(newEntry[key]) !== JSON.stringify(existingEntry[key])) {
                                entryChanged = true;
                                break;
                            }
                        }
                    }

                    if (entryChanged) {
                        datesMap[dateStr] = newEntry;
                        hasChanges = true;
                    }

                    // Update stats
                    if (dateData.isPaidLeave || (dateData.clockIn && dateData.clockOut)) daysWorkedCount++;

                    if (dateData.clockIn?.shift) {
                        const scheduled = SHIFT_SCHEDULES[dateData.clockIn.shift]?.timeIn || "9:30 AM";
                        const lateMinutes = payCalculator.compareTimes(dateData.clockIn.time, scheduled);
                        if (lateMinutes > 0) totalLateHours += lateMinutes / 60;
                    }

                    if (dateData.clockIn) {
                        const dateObj = new Date(dateStr);
                        if (!lastClockInDate || dateObj > lastClockInDate) {
                            lastClockInDate = dateObj;
                        }
                    }
                });

                // Update the employee data if we have changes
                if (hasChanges) {
                    // Convert dates map back to array
                    attendanceData[employeeId].dates = Object.values(datesMap);
                    attendanceData[employeeId].daysWorked = daysWorkedCount;
                    attendanceData[employeeId].lateHours = totalLateHours;
                    attendanceData[employeeId].lastClockIn = lastClockInDate;

                    // Find the selfie for the last clock in
                    if (lastClockInDate) {
                        const lastDateStr = formatDate(lastClockInDate);
                        const lastDateEntry = datesMap[lastDateStr];
                        if (lastDateEntry) {
                            attendanceData[employeeId].lastClockInPhoto = lastDateEntry.timeInPhoto;
                        }
                    }
                }
            } catch (error) {
                console.error(`Error loading data for employee ${employeeId}:`, error);
                // Make sure we have an entry for this employee even if error occurred
                if (!attendanceData[employeeId]) {
                    attendanceData[employeeId] = {
                        id: employeeId,
                        name: employees[employeeId],
                        dates: [],
                        lastClockIn: null,
                        lastClockInPhoto: null,
                        daysWorked: 0,
                        lateHours: 0,
                        baseRate: 0
                    };
                }
            } finally {
                if (attendanceData[employeeId]) {
                    delete attendanceData[employeeId]._payrollRowLoading;
                }
            }
        };

        if (useProgressiveRowReveal) {
            setPayrollLoadingProgress({
                phase: 'Loading payment records…',
                loaded: 0,
                total: empLoadTotal
            });
            try {
                const prefetched = await loadAllPaymentConfirmations(periodId, { forceRefresh: true });
                window.paymentStatus = {
                    ...(window.paymentStatus || {}),
                    ...prefetched
                };
            } catch (payErr) {
                console.warn('Payment prefetch for progressive load:', payErr);
            }
            if (myRun !== loadDataRunId) return;
            filterData({ skipPaymentFetch: true });
            setPayrollLoadingProgress({
                phase: 'Fetching attendance…',
                loaded: 0,
                total: empLoadTotal
            });
        } else {
            setPayrollLoadingProgress({
                phase: 'Fetching attendance…',
                loaded: 0,
                total: empLoadTotal,
                indeterminate: true
            });
        }

        const PROGRESSIVE_CHUNK = 5;
        if (useProgressiveRowReveal) {
            for (let i = 0; i < employeeIds.length; i += PROGRESSIVE_CHUNK) {
                if (myRun !== loadDataRunId) return;
                const slice = employeeIds.slice(i, i + PROGRESSIVE_CHUNK);
                await Promise.all(slice.map((id) => fetchOneEmployeeForPeriod(id)));
                const loadedCount = Math.min(i + slice.length, employeeIds.length);
                setPayrollLoadingProgress({
                    phase: 'Fetching attendance…',
                    loaded: loadedCount,
                    total: empLoadTotal
                });
                filterData({ skipPaymentFetch: true });
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            }
        } else {
            await Promise.all(employeeIds.map((id) => fetchOneEmployeeForPeriod(id)));
            setPayrollLoadingProgress({
                phase: 'Calculating pay…',
                loaded: empLoadTotal,
                total: empLoadTotal
            });
        }
        if (myRun !== loadDataRunId) return;

        setPayrollLoadingProgress({
            phase: 'Syncing sales bonuses…',
            loaded: empLoadTotal,
            total: empLoadTotal
        });

        window.attendanceData = attendanceData;
        if (payCalculator) {
            payCalculator.staffingAttendanceData = attendanceData;
        }

        const allBonusUpdates = [];

        for (const employeeId of Object.keys(attendanceData)) {
            const employee = attendanceData[employeeId];
            if (employee.dates && employee.dates.length > 0) {
                employee.dates.forEach((dateObj) => {
                    if (dateObj.timeIn && dateObj.timeOut && dateObj.branch === 'SM North' && employee.salesBonusEligible) {
                        const salesBonus = payCalculator.calculateSalesBonus(dateObj.date, employee);

                        if (dateObj.salesBonus !== salesBonus) {
                            dateObj.salesBonus = salesBonus;
                            hasChanges = true;

                            allBonusUpdates.push((async () => {
                                try {
                                    const attendanceDocRef = doc(db, "attendance_v2", employeeId, "dates", dateObj.date);
                                    await setDoc(attendanceDocRef, { salesBonus: salesBonus }, { merge: true });
                                } catch (error) {
                                    console.error(`Failed to write salesBonus for ${employeeId} on ${dateObj.date}:`, error);
                                }
                            })());
                        }
                    }
                });
            }
        }

        if (allBonusUpdates.length > 0) {
            await Promise.all(allBonusUpdates);
        }
        if (myRun !== loadDataRunId) return;

        setPayrollLoadingProgress({
            phase: 'Finishing up…',
            loaded: empLoadTotal,
            total: empLoadTotal
        });

        const earningsByEmployee = await loadPeriodEarningsForPeriod(periodId);
        applyPeriodEarningsToAttendanceData(attendanceData, earningsByEmployee);
        if (myRun !== loadDataRunId) return;

        for (const employeeId of Object.keys(attendanceData)) {
            const employee = attendanceData[employeeId];
            employee.totalPayWithBonus = calcTotalPaySimple(employee.dates || [], employee, periodId);
        }

        Object.values(attendanceData).forEach((rec) => {
            if (rec && '_payrollRowLoading' in rec) delete rec._payrollRowLoading;
        });

        summaryModeActive = false;
        Object.values(attendanceData).forEach((employee) => {
            if (employee && employee._summaryOnly) delete employee._summaryOnly;
        });
        saveToCache(cacheKey, attendanceData);
        saveSummaryToCache(periodId, branchId, attendanceData, window.paymentStatus || {});
        if (useProgressiveRowReveal) {
            filterData({ skipPaymentFetch: true });
            try {
                await updateEmployeePaymentStatus(true);
            } catch (payUiErr) {
                console.warn('updateEmployeePaymentStatus:', payUiErr);
            }
        } else {
            filterData();
        }

        // After data is loaded and filtered, restore employee view if needed
        const employeeId = getEmployeeFromHash();
        if (employeeId && employees[employeeId] && currentEmployeeView !== employeeId) {
            console.log('Restoring employee view after data load:', employeeId);
            currentEmployeeView = employeeId;
            updateViewMode();
            
            const container = document.getElementById('employee-details-table');
            if (container) {
                try {
                    await loadEmployeeDetailsAsMainTable(employeeId, container);
                } catch (error) {
                    console.error('Error loading single employee:', error);
                    container.innerHTML = '<div class="error">Error loading employee data</div>';
                }
            }
        }
    } catch (error) {
        console.error("❌ Error loading data:", error);
        if (!cachedData) {
            alert("Failed to load data. Please try again.");
        }
    } finally {
        payrollBulkLoadInProgress = false;
        hideLoading();
    }

    if (selectedPeriodId && periodSelect.value !== selectedPeriodId) {
        console.log(`Fixing period selection back to: ${selectedPeriodId}`);
        periodSelect.value = selectedPeriodId;
    }
}

function invalidateAllCaches() {
    // Clear all attendance caches when sales data might have changed
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('attendance_') || key.startsWith('payroll_summary_'))) {
            localStorage.removeItem(key);
        }
    }
    console.log("All caches invalidated due to potential sales data changes");
}

// Clear single user caches
function clearSingleUserCaches() {
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('single_user_')) {
            localStorage.removeItem(key);
        }
    }
    console.log("Single user caches cleared");
}

// Filter data based on selected period and branch
// Update the filterData() function around line 212:
// Filter data based on selected period and branch
// Replace the existing filterData function with this updated version
function filterData(options = {}) {
    const period = periodSelect.value;
    const branch = isMobileLayout() ? 'all' : branchSelect.value;
    const { startDate, endDate } = getPeriodDates(period);

    // First make a deep copy of original attendance data to avoid modifying it
    filteredData = JSON.parse(JSON.stringify(attendanceData));

    // If we're in single employee view, filter to just that employee
    if (currentEmployeeView) {
        const singleEmployeeData = {};
        if (filteredData[currentEmployeeView]) {
            singleEmployeeData[currentEmployeeView] = filteredData[currentEmployeeView];
        }
        filteredData = singleEmployeeData;
    }

    // Apply period filters by recalculating key metrics
    Object.keys(filteredData).forEach(employeeId => {
        let lastClockInDate = null;
        let totalLateHours = 0;
        let daysWorkedCount = 0;

        // Filter dates for selected period
        filteredData[employeeId].dates = filteredData[employeeId].dates.filter(date => {
            const dateObj = new Date(date.date);
            const dateObjNoTime = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
            const startDateNoTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDateNoTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

            // Check if date is in the selected period range
            return dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime;
        });

        // Apply branch filter if needed
        if (branch !== 'all') {
            filteredData[employeeId].dates = filteredData[employeeId].dates.filter(date => {
                return date.isPaidLeave || attendanceMatchesFilter(date.branch, branch);
            });
        }

        // Recalculate metrics based on filtered dates
        filteredData[employeeId].dates.forEach(date => {
            if (date.isPaidLeave || (date.timeIn && date.timeOut)) {
                daysWorkedCount++;
            }

            if (payCalculator && date.scheduledIn && date.timeIn) {
                const lateMinutes = payCalculator.compareTimes(date.timeIn, date.scheduledIn);
                if (lateMinutes > 0) totalLateHours += lateMinutes / 60;
            }

            const dateObj = new Date(date.date);
            if (date.timeIn && (!lastClockInDate || dateObj > lastClockInDate)) {
                lastClockInDate = dateObj;
                filteredData[employeeId].lastClockIn = dateObj;
                filteredData[employeeId].lastClockInPhoto = date.timeInPhoto;
            }
        });

        // Update the employee's metrics
        filteredData[employeeId].daysWorked = daysWorkedCount;
        filteredData[employeeId].lateHours = totalLateHours;
        if (!lastClockInDate) {
            filteredData[employeeId].lastClockIn = null;
            filteredData[employeeId].lastClockInPhoto = null;
        }

        if (!filteredData[employeeId]._summaryOnly) {
            const payType =
                (typeof PayCalculator?.getRateForPeriod === 'function'
                    ? PayCalculator.getRateForPeriod(filteredData[employeeId], period).payType
                    : null) ||
                filteredData[employeeId].payType ||
                'hourly';
            const hasDates = filteredData[employeeId].dates?.length > 0;
            // Monthly/hybrid still earn with zero attendance days this cutoff
            if (hasDates || payType === 'monthly' || payType === 'hybrid' || Number(filteredData[employeeId].periodEarningsTotal)) {
                filteredData[employeeId].totalPayWithBonus = calcTotalPaySimple(
                    filteredData[employeeId].dates || [],
                    filteredData[employeeId],
                    period
                );
            } else {
                filteredData[employeeId].totalPayWithBonus = 0;
            }
        }
    });

    if (options.skipPaymentFetch) {
        renderEmployeeTable();
        updateSummaryCards();
        updatePayModeButtonState();
    } else {
        loadPaymentDataAndRender();
    }
}

// Load payment data and render table
async function loadPaymentDataAndRender({ forcePaymentRefresh = false } = {}) {
    const periodId = periodSelect.value;
    
    try {
        // Clear cache first so we never paint unpaid over a just-saved payment
        if (forcePaymentRefresh) {
            localStorage.removeItem(periodPaymentsCacheKey(periodId));
        }

        const paymentStatuses = await loadAllPaymentConfirmations(periodId, {
            forceRefresh: forcePaymentRefresh
        });

        window.paymentStatus = {
            ...(window.paymentStatus || {}),
            ...paymentStatuses
        };
        
        // Render the table with payment data
        renderEmployeeTable();
        
        // Update summary cards after rendering
        updateSummaryCards();
        
        await updateEmployeePaymentStatus(true);
        updatePayModeButtonState();
        
    } catch (error) {
        console.error('Error loading payment data:', error);
        // Still render table even if payment data fails
        renderEmployeeTable();
        updateSummaryCards();
        updatePayModeButtonState();
    }
}

// Replace the updateSummaryCards function
function updateSummaryCards() {
    // Calculate summary values
    const totalEmployees = Object.keys(employees).length;

    // Count active employees (those with at least one clock-in for the period)
    let activeEmployees = 0;
    let totalPayrollAmount = 0;

    // Get period dates
    const period = periodSelect.value;
    const { startDate, endDate } = getPeriodDates(period);

    // Count holidays in the period
    const holidays = countHolidaysInPeriod(startDate, endDate);

    Object.values(filteredData).forEach((employee) => {
        if (!employeeHasRosterPayActivity(employee, period)) return;
        totalPayrollAmount += getEmployeeTotalPayForTable(employee, period);
        activeEmployees++;
    });

    const branchId = getSelectedBranchFilter();
    updatePayrollSummaryLabels(branchId);

    // Update cards
    document.getElementById('totalEmployees').textContent = totalEmployees;
    document.getElementById('activeEmployees').textContent = activeEmployees;
    document.getElementById('totalLateHours').textContent = `${holidays.regular} regular, ${holidays.special} special`; // Replace late hours with holidays
    
    const totalPayrollElement = document.getElementById('totalPayroll');
    totalPayrollElement.textContent = `₱${totalPayrollAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const mobileSummaryTotal = document.getElementById('mobileSummaryTotalPayroll');
    const mobileSummaryActive = document.getElementById('mobileSummaryActive');
    const mobileSummaryPeriodLabel = document.getElementById('mobileSummaryPeriodLabel');
    if (mobileSummaryTotal) mobileSummaryTotal.textContent = `₱${totalPayrollAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (mobileSummaryActive) mobileSummaryActive.textContent = activeEmployees;
    if (mobileSummaryPeriodLabel) mobileSummaryPeriodLabel.textContent = periodSelect.options[periodSelect.selectedIndex]?.text || '—';

    // Check if payroll period is over and calculate unpaid amount
    const today = new Date();

    if (today > endDate) {
        // Calculate unpaid amount
        let unpaidAmount = 0;
        const periodId = period;

        // Get payment statuses (we'll need to make this synchronous for the calculation)
        loadAllPaymentConfirmations(periodId).then(paymentStatuses => {
            Object.entries(filteredData).forEach(([employeeId, employee]) => {
                if (!employeeHasRosterPayActivity(employee, periodId)) return;
                const branchSpecificPay = getEmployeeTotalPayForTable(employee, periodId);
                const paymentData = paymentStatuses[employeeId];

                if (!paymentData) {
                    unpaidAmount += branchSpecificPay;
                } else {
                    unpaidAmount += getPayableRemaining(branchSpecificPay, paymentData);
                }
            });

            // Add unpaid amount display if there's any unpaid
            if (unpaidAmount > 0) {
                const existingUnpaid = totalPayrollElement.parentNode.querySelector('.unpaid-amount');
                if (existingUnpaid) {
                    existingUnpaid.remove();
                }

                const unpaidDiv = document.createElement('div');
                unpaidDiv.className = 'unpaid-amount';
                unpaidDiv.style.cssText = `
                color: #e63946;
                font-size: 0.9rem;
                font-weight: 500;
                margin-top: 0.25rem;
            `;
                unpaidDiv.textContent = `₱${unpaidAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} unpaid`;

                totalPayrollElement.parentNode.insertBefore(unpaidDiv, totalPayrollElement.nextSibling);
            }
        });
    } else {
        // Remove any existing unpaid amount display if period is not over
        const existingUnpaid = totalPayrollElement.parentNode.querySelector('.unpaid-amount');
        if (existingUnpaid) {
            existingUnpaid.remove();
        }
    }

    // Update the late hours label to say "Holidays"
    // const lateHoursLabel = document.querySelector('label[for="totalLateHours"]');
    // if (lateHoursLabel) {
    //     lateHoursLabel.textContent = "Holidays";
    // }

    const holidaysList = [];
    for (const dateStr in HOLIDAYS_2025) {
        const holiday = HOLIDAYS_2025[dateStr];
        const holidayDate = new Date(dateStr + 'T00:00:00');
        const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

        if (holidayDate >= startDateOnly && holidayDate <= endDateOnly) {
            holidaysList.push({
                date: dateStr,
                name: holiday.name,
                type: holiday.type
            });
        }
    }

    const holidayDisplay = document.getElementById('totalLateHours');

    if (holidaysList.length > 0) {
        // Sort holidays by date
        holidaysList.sort((a, b) => new Date(a.date) - new Date(b.date));

        let htmlContent = '';

        // Format each holiday in a compact, elegant format
        holidaysList.forEach(holiday => {
            const date = new Date(holiday.date);
            const formattedDate = date.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric'
            });

            // Type class for styling (regular or special)
            const typeClass = holiday.type === 'regular' ? 'regular-holiday' : 'special-holiday';

            // Create the holiday entry with name and date on separate lines
            htmlContent += `
                <div class="holiday-entry">
                    <div class="holiday-date">${formattedDate}</div>
                    <div class="holiday-name ${typeClass}">${holiday.name}</div>
                </div>
            `;
        });

        holidayDisplay.innerHTML = `<div class="holidays-container">${htmlContent}</div>`;
    } else {
        holidayDisplay.textContent = "No holidays";
    }

    const holidaysCard = holidayDisplay.closest('.summary-card');

    // Make the holidays card clickable
    if (!holidaysCard.classList.contains('holidays-summary-card')) {
        holidaysCard.classList.add('holidays-summary-card');
        holidaysCard.addEventListener('click', openHolidaysModal);
    }
}

function createEmployeeSpecificSummaryCards(employeeId) {
    const employee = filteredData[employeeId];
    if (!employee) return;

    // Check if employee is sales bonus eligible
    const showSalesBonus = employee.salesBonusEligible;
    const periodId = periodSelect.value;
    const rateForPeriod = PayCalculator.getRateForPeriod(employee, periodId);
    const totalPay = calcTotalPaySimple(employee.dates, employee, periodId);
    const paymentStatus = window.paymentStatus || {};
    const bal = getPaymentBalance(totalPay, paymentStatus[employeeId]);
    const remainingSubtitle = bal.remaining > 0
        ? 'Still to pay'
        : (bal.paid > 0 ? 'Fully paid' : 'Nothing to pay');
    const balanceCard = bal.surplus > 0
        ? `<div class="summary-card">
                <div class="card-title">Surplus</div>
                <div class="card-value" style="color:#0369a1;">₱${bal.surplus.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">Paid above period total</div>
            </div>`
        : `<div class="summary-card">
                <div class="card-title">Remaining</div>
                <div class="card-value ${bal.remaining <= 0 && bal.paid > 0 ? 'paid-amount' : (bal.remaining > 0 ? 'payable-amount' : '')}">₱${bal.remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">${remainingSubtitle}</div>
            </div>`;

    // Create new summary card HTML
    const summaryCardsHTML = `
        <div class="summary-cards employee-view-cards">
            <div class="summary-card">
                <div class="card-title">Employee ID</div>
                <div class="card-value">${employeeId}</div>
                <div class="card-subtitle">Staff ID</div>
            </div>
            <div class="summary-card">
                <div class="card-title">Base Rate</div>
                <div class="card-value">₱${(rateForPeriod.baseRate || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">${rateForPeriod.payScheme === 'inclusive' ? 'Meal included in daily rate' : 'Per day + meal allowance'}</div>
            </div>
            <div class="summary-card">
                <div class="card-title">Days Worked</div>
                <div class="card-value">${employee.daysWorked}</div>
                <div class="card-subtitle">This period</div>
            </div>

            <div class="summary-card">
                <div class="card-title">Total Pay</div>
                <div class="card-value">₱${totalPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">For this period</div>
            </div>
            ${balanceCard}
            ${showSalesBonus ? `
            <div class="summary-card">
                <div class="card-title">Sales Bonus</div>
                <div class="card-value">₱${getEmployeeSalesBonusFromPayCalculator(employee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">Total earned</div>
            </div>
            ` : ''}
        </div>
    `;

    return summaryCardsHTML;
}

function getEmployeeSalesBonusFromPayCalculator(employee) {
    if (!employee.salesBonusEligible) return 0;

    let totalSalesBonus = 0;

    // Calculate sales bonus for each day individually (since this works)
    employee.dates.forEach(dateEntry => {
        if (dateEntry.timeIn && dateEntry.timeOut && dateEntry.branch === 'SM North') {
            // Use PayCalculator's individual day calculation
            const dailyResult = payCalculator.calculateDailyPay(dateEntry, employee, 'detailed');

            if (dailyResult.breakdown && dailyResult.breakdown.components) {
                dailyResult.breakdown.components.forEach(component => {
                    if (component.type === 'sales_bonus') {
                        totalSalesBonus += component.amount;
                    }
                });
            }
        }
    });

    console.log('Sales bonus calculated day by day:', totalSalesBonus);
    return totalSalesBonus;
}

function validateCacheData(cacheKey, data) {
    const values = Object.values(data).filter(Boolean);
    if (!values.length) return false;

    // Prefer an employee with at least one date so we don't reject valid caches
    // when Object.values order picks an eligible staff member with zero rows.
    const sampleEmployee =
        values.find((e) => Array.isArray(e.dates) && e.dates.length > 0) || values[0];

    if (sampleEmployee.salesBonusEligible === undefined) return false;

    if (!sampleEmployee.salesBonusEligible) return true;

    const dates = Array.isArray(sampleEmployee.dates) ? sampleEmployee.dates : [];
    if (!dates.length) return true;

    return dates.some((date) => date && date.salesBonus !== undefined);
}

function isMobileLayout() {
    return window.matchMedia('(max-width: 992px)').matches;
}

function renderMobileCards(cardData) {
    if (!employeeCardsMobileEl) return;
    employeeCardsMobileEl.innerHTML = '';
    employeeCardsMobileEl.setAttribute('aria-hidden', 'false');

    cardData.forEach((item) => {
        if (item.skeleton) {
            const card = document.createElement('div');
            card.className = 'employee-card-mobile employee-card-mobile--loading';
            card.dataset.employeeId = item.employeeId;
            const nm = escapeHtml(item.name || employees[item.employeeId] || 'Unknown');
            card.innerHTML = `
            <div class="employee-card-mobile__main">
                <div class="employee-card-mobile__avatar-placeholder employee-card-mobile__avatar-placeholder--pulse"></div>
                <div class="employee-card-mobile__info">
                    <div class="employee-card-mobile__name">${nm}</div>
                    <div class="employee-card-mobile__meta employee-card-mobile__meta--loading">Loading…</div>
                </div>
            </div>
            <div class="employee-card-mobile__right">
                <div class="employee-card-mobile__salary employee-card-mobile__salary--skeleton"></div>
            </div>
            `;
            employeeCardsMobileEl.appendChild(card);
            return;
        }
        const { employeeId, employee, totalPay, payableDisplay, surplus, paid, remaining, showPaymentButton, daysWorked } = item;
        const name = employee.name || employees[employeeId] || 'Unknown Employee';
        const photoUrl = employee.lastClockInPhoto || '';
        const totalPayStr = totalPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const statusKind = getPaymentStatusKind({ surplus, paid, remaining });
        const statusLabel = paymentStatusLabel(statusKind);

        const card = document.createElement('div');
        card.className = 'employee-card-mobile';
        card.dataset.employeeId = employeeId;

        /* Badge and Pay only in disbursement period (today > period end), same as desktop. Pay button only when unpaid. */
        const showBadge = showPaymentButton;
        const showPayButton = showPaymentButton && (statusKind === 'unpaid' || statusKind === 'partial');
        const showSurplusAdjust = showPaymentButton && statusKind === 'surplus';
        card.innerHTML = `
            <div class="employee-card-mobile__main">
                ${photoUrl
                    ? photoThumbDeferredHtml(photoUrl, 'Last clock-in', 'employee-card-mobile__avatar')
                    : `<div class="employee-card-mobile__avatar-placeholder">${(name || '?').charAt(0).toUpperCase()}</div>`
                }
                <div class="employee-card-mobile__info">
                    <div class="employee-card-mobile__name">${escapeHtml(name)}</div>
                    <div class="employee-card-mobile__meta">${daysWorked} days${surplus > 0 ? ` · ${payableDisplay || ''}` : ''}</div>
                </div>
            </div>
            <div class="employee-card-mobile__right">
                <div class="employee-card-mobile__salary">₱${totalPayStr}</div>
                ${showBadge ? `<span class="employee-card-mobile__status-badge ${statusKind}">${statusLabel}</span>` : ''}
                ${showPayButton ? `<button type="button" class="action-btn payment-btn" data-employee-id="${employeeId}">Pay</button>` : ''}
                ${showSurplusAdjust ? `<button type="button" class="action-btn adjust-surplus-btn" data-employee-id="${employeeId}">Adjust surplus</button>` : ''}
            </div>
        `;

        employeeCardsMobileEl.appendChild(card);
    });

    scheduleDeferredThumbLoads(employeeCardsMobileEl);

    /* Whole card clickable: opens employee view (modal on mobile). Pay button still works. */
    employeeCardsMobileEl.querySelectorAll('.employee-card-mobile').forEach(cardEl => {
        cardEl.addEventListener('click', function (e) {
            if (this.classList.contains('employee-card-mobile--loading')) return;
            if (e.target.closest('.payment-btn') || e.target.closest('.adjust-surplus-btn') || e.target.closest('img.thumb') || e.target.closest('.punch-location-chip')) return;
            const employeeId = this.dataset.employeeId;
            if (!employeeId) return;
            if (isMobileLayout()) {
                openMobileEmployeeDetail(employeeId);
            } else {
                currentEmployeeView = employeeId;
                updateURLHash(employeeId);
                if (!filteredData[employeeId]) {
                    setTimeout(() => { if (currentEmployeeView === employeeId) updateViewMode(); }, 500);
                    return;
                }
                updateViewMode();
                setTimeout(() => {
                    if (currentEmployeeView === employeeId) {
                        updateViewModeImpl();
                        setTimeout(() => {
                            const detailsContainer = document.getElementById('employee-details-table');
                            if (detailsContainer && !detailsContainer.querySelector('#employeeDetailTable')) {
                                loadEmployeeDetailsAsMainTable(employeeId, detailsContainer);
                            }
                        }, 1000);
                    }
                }, 200);
            }
        });
    });

    employeeCardsMobileEl.querySelectorAll('.payment-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openPayMode(this.dataset.employeeId);
        });
    });

    employeeCardsMobileEl.querySelectorAll('.adjust-surplus-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openAdjustSurplusModal(this.dataset.employeeId);
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function buildEmployeeDetailScrimHtml(message = 'Loading attendance…') {
    const m = escapeHtml(message);
    return `<div class="employee-detail-blocking-scrim payroll-blocking-scrim payroll-blocking-scrim--detail" style="display:flex" aria-busy="true">
        <div class="payroll-blocking-scrim__panel">
            <div class="spinner"></div>
            <p class="payroll-blocking-scrim__message">${m}</p>
        </div>
    </div>`;
}

/** Thumbnail markup: no `src` yet so layout/text can paint first; see scheduleDeferredThumbLoads. */
function photoThumbDeferredHtml(photoUrl, altText, extraClass) {
    if (!photoUrl) return '';
    const esc = String(photoUrl).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const cls = ['thumb', 'thumb-deferred', extraClass || ''].filter(Boolean).join(' ');
    const alt = escapeHtml(altText || 'Photo');
    return `<img class="${cls}" alt="${alt}" data-photo="${esc}" data-src="${esc}" decoding="async" loading="lazy">`;
}

function extractPunchLocation(punch) {
    if (!punch || !punch.location) return null;
    const loc = punch.location;
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    const accuracy = Number(loc.accuracy);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return {
            lat,
            lng,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            status: loc.status || 'ok'
        };
    }
    if (loc.status && loc.status !== 'ok') {
        return { status: loc.status };
    }
    return null;
}

function punchLocationMapsUrl(lat, lng) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
}

const BRANCH_PUNCH_SITES = {
    'SM North': {
        lat: 14.65660,
        lng: 121.03237,
        label: 'SM North',
        radiusMeters: 250
    },
    'Podium': {
        lat: 14.58564,
        lng: 121.05948,
        label: 'Podium',
        radiusMeters: 200
    }
};

const PUNCH_ICON_CLOSE = '<svg class="punch-location-chip__svg" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8"/></svg>';
const PUNCH_ICON_PIN = '<svg class="punch-location-chip__svg" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.3 4.5 8.5 4.5 8.5s4.5-5.2 4.5-8.5A4.5 4.5 0 0 0 8 1.5zm0 6.1a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z"/></svg>';

const punchPlaceCache = new Map();
const GENERIC_PLACE_NAMES = new Set([
    'manila',
    'metro manila',
    'national capital region',
    'ncr',
    'philippines',
    'southern manila district',
    'eastern manila district',
    'northern manila district'
]);

function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function formatDistanceMeters(meters) {
    if (!Number.isFinite(meters)) return '';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
}

function formatDistanceFromSite(meters, siteLabel) {
    const dist = formatDistanceMeters(meters);
    if (!dist || !siteLabel) return '';
    return `${dist} from ${siteLabel}`;
}

function getPunchSite(branch) {
    return BRANCH_PUNCH_SITES[branch] || null;
}

function punchPlaceCacheKey(lat, lng) {
    return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

function isGenericPlaceName(name) {
    const n = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!n) return true;
    if (GENERIC_PLACE_NAMES.has(n)) return true;
    if (/^district\s*[ivx\d]+$/i.test(n)) return true;
    return false;
}

function normalizePhCityName(name) {
    const n = String(name || '').replace(/\s+/g, ' ').trim();
    if (!n) return '';
    if (/city$/i.test(n)) return n.replace(/\bcity$/i, 'City');
    const withCity = {
        'Makati': 'Makati City',
        'Pasig': 'Pasig City',
        'Mandaluyong': 'Mandaluyong City',
        'Taguig': 'Taguig City',
        'Parañaque': 'Parañaque City',
        'Paranaque': 'Parañaque City',
        'Las Piñas': 'Las Piñas City',
        'Las Pinas': 'Las Piñas City',
        'Valenzuela': 'Valenzuela City',
        'Malabon': 'Malabon City',
        'Navotas': 'Navotas City',
        'Muntinlupa': 'Muntinlupa City',
        'Marikina': 'Marikina City',
        'Pasay': 'Pasay City',
        'Caloocan': 'Caloocan City',
        'San Juan': 'San Juan City',
        'Quezon': 'Quezon City'
    };
    return withCity[n] || n;
}

function firstUsefulPlace(names) {
    for (const raw of names) {
        const n = String(raw || '').replace(/\s+/g, ' ').trim();
        if (n && !isGenericPlaceName(n)) return n;
    }
    return '';
}

function formatNominatimPlace(data) {
    const addr = data && data.address ? data.address : {};
    const specific = firstUsefulPlace([
        addr.neighbourhood,
        addr.suburb,
        addr.quarter,
        addr.village,
        addr.hamlet,
        addr.residential
    ]);
    const city = normalizePhCityName(firstUsefulPlace([
        addr.city,
        addr.municipality,
        addr.town
    ]));
    if (specific && city && !city.toLowerCase().includes(specific.toLowerCase())) {
        return `${specific}, ${city}`;
    }
    if (city) return city;
    if (specific) return specific;
    return 'Unknown area';
}

function formatPunchPlaceName(data) {
    if (!data || typeof data !== 'object') return 'Unknown area';
    const city = normalizePhCityName(data.city);
    const locality = String(data.locality || '').replace(/\s+/g, ' ').trim();
    const usefulCity = city && !isGenericPlaceName(city) ? city : '';
    const usefulLocality = locality && !isGenericPlaceName(locality) ? locality : '';
    if (usefulLocality && usefulCity && usefulLocality.toLowerCase() !== usefulCity.toLowerCase()) {
        return `${usefulLocality}, ${usefulCity}`;
    }
    if (usefulCity) return usefulCity;
    if (usefulLocality) return usefulLocality;
    const admin = Array.isArray(data.localityInfo?.administrative) ? data.localityInfo.administrative : [];
    const cityAdmin = admin.find((a) => a?.name && !isGenericPlaceName(a.name) && /city/i.test(a.name));
    if (cityAdmin?.name) return normalizePhCityName(cityAdmin.name);
    return 'Unknown area';
}

function formatNominatimPlaceDetailed(data) {
    const short = formatNominatimPlace(data);
    const addr = data && data.address ? data.address : {};
    const road = firstUsefulPlace([
        addr.road,
        addr.pedestrian,
        addr.footway,
        addr.residential
    ]);
    if (road && short && !short.toLowerCase().includes(road.toLowerCase())) {
        return `${road}, ${short}`;
    }
    return short || 'Unknown area';
}

function lookupPunchPlaceDetailed(lat, lng) {
    const key = `${punchPlaceCacheKey(lat, lng)}:detail`;
    if (punchPlaceCache.has(key)) return punchPlaceCache.get(key);
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const pending = fetch(nominatimUrl, { headers: { Accept: 'application/json' } })
        .then((res) => {
            if (!res.ok) throw new Error('nominatim failed');
            return res.json();
        })
        .then((data) => formatNominatimPlaceDetailed(data))
        .catch(() => lookupPunchPlaceName(lat, lng));
    punchPlaceCache.set(key, pending);
    return pending;
}

function lookupPunchPlaceName(lat, lng) {
    const key = punchPlaceCacheKey(lat, lng);
    if (punchPlaceCache.has(key)) return punchPlaceCache.get(key);
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=16&addressdetails=1`;
    const pending = fetch(nominatimUrl, { headers: { Accept: 'application/json' } })
        .then((res) => {
            if (!res.ok) throw new Error('nominatim failed');
            return res.json();
        })
        .then((data) => formatNominatimPlace(data))
        .catch(() => fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=en`)
            .then((res) => {
                if (!res.ok) throw new Error('geocode failed');
                return res.json();
            })
            .then((data) => formatPunchPlaceName(data)))
        .catch(() => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`);
    punchPlaceCache.set(key, pending);
    return pending;
}

function splitPlaceLines(name) {
    const trimmed = String(name || '').replace(/\s+/g, ' ').trim();
    if (!trimmed) return { line1: '', line2: '' };
    const comma = trimmed.indexOf(',');
    if (comma === -1) return { line1: trimmed, line2: '' };
    return {
        line1: trimmed.slice(0, comma).trim(),
        line2: trimmed.slice(comma + 1).trim()
    };
}

function hydratePunchLocations(rootNode) {
    const root = rootNode || document;
    root.querySelectorAll('.punch-location-chip[data-geocode="1"]').forEach((chip) => {
        if (chip.dataset.geocoded === '1') return;
        const lat = chip.dataset.lat;
        const lng = chip.dataset.lng;
        const placeEl = chip.querySelector('.punch-location-chip__place');
        if (!lat || !lng || !placeEl) return;
        chip.dataset.geocoded = '1';
        lookupPunchPlaceName(lat, lng).then((name) => {
            const { line1, line2 } = splitPlaceLines(name);
            placeEl.textContent = line1 || name;
            chip.dataset.place = name;
            chip.title = name;
            const textEl = chip.querySelector('.punch-location-chip__text');
            if (!textEl) return;
            let subEl = chip.querySelector('.punch-location-chip__sub');
            if (line2) {
                if (!subEl) {
                    subEl = document.createElement('span');
                    subEl.className = 'punch-location-chip__sub';
                    textEl.appendChild(subEl);
                }
                subEl.textContent = line2;
            } else if (subEl) {
                subEl.remove();
            }
        });
    });
}

function punchKindLabel(kind, { sentenceCase = false } = {}) {
    if (kind === 'out') return sentenceCase ? 'Time out location' : 'Time Out Location';
    return sentenceCase ? 'Time in location' : 'Time In Location';
}

function punchLocationChipHtml({ modifier, icon, label, sub, placePending, lat, lng, accuracy, branch, site, distance, onsite, title, kind }) {
    const geocode = placePending ? '1' : '0';
    const acc = Number.isFinite(Number(accuracy)) ? String(Math.round(Number(accuracy))) : '';
    const dist = Number.isFinite(Number(distance)) ? String(Math.round(Number(distance))) : '';
    const punchKind = kind === 'out' ? 'out' : 'in';
    const labelClass = placePending ? ' punch-location-chip__place' : '';
    const subHtml = sub
        ? `<span class="punch-location-chip__sub">${sub}</span>`
        : '';
    return `<button type="button" class="punch-location-chip punch-location-chip--${modifier}" title="${escapeHtml(title || 'View map')}" data-lat="${lat}" data-lng="${lng}" data-accuracy="${escapeHtml(acc)}" data-branch="${escapeHtml(branch || '')}" data-site="${escapeHtml(site || '')}" data-distance="${escapeHtml(dist)}" data-onsite="${onsite ? '1' : '0'}" data-geocode="${geocode}" data-kind="${punchKind}">
        <span class="punch-location-chip__icon" aria-hidden="true">${icon}</span>
        <span class="punch-location-chip__text">
            <span class="punch-location-chip__label${labelClass}">${escapeHtml(label)}</span>
            ${subHtml}
        </span>
    </button>`;
}

function punchLocationHtml(location, branch, kind) {
    if (location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
        const lat = Number(location.lat);
        const lng = Number(location.lng);
        const site = getPunchSite(branch);
        if (site) {
            const distance = distanceMeters(lat, lng, site.lat, site.lng);
            const onsite = distance <= site.radiusMeters;
            const dist = formatDistanceMeters(distance);
            const distanceLabel = formatDistanceFromSite(distance, site.label);
            return punchLocationChipHtml({
                modifier: onsite ? 'onsite' : 'offsite',
                icon: onsite ? PUNCH_ICON_PIN : PUNCH_ICON_CLOSE,
                label: onsite ? site.label : `${dist} from`,
                sub: onsite ? '' : escapeHtml(site.label),
                lat,
                lng,
                accuracy: location.accuracy,
                branch,
                site: site.label,
                distance,
                onsite,
                title: onsite ? site.label : distanceLabel,
                kind
            });
        }
        return punchLocationChipHtml({
            modifier: 'place',
            icon: PUNCH_ICON_PIN,
            label: 'Looking up area…',
            placePending: true,
            lat,
            lng,
            accuracy: location.accuracy,
            branch,
            title: 'View map',
            kind
        });
    }
    if (location && location.status && location.status !== 'ok') {
        const labels = {
            denied: 'Location blocked',
            unavailable: 'Location unavailable',
            timeout: 'Location timed out',
            unsupported: 'Location unsupported'
        };
        return `<span class="punch-location-missing">${labels[location.status] || 'Not captured'}</span>`;
    }
    return `<span class="punch-location-missing">Not captured</span>`;
}

function punchLocationCellHtml(location, branch, kind) {
    if (!location) return '';
    if (Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
        return `<div class="punch-location-wrap">${punchLocationHtml(location, branch, kind)}</div>`;
    }
    if (location.status && location.status !== 'ok') {
        return `<div class="punch-location-wrap">${punchLocationHtml(location, branch, kind)}</div>`;
    }
    return '';
}

function locationBreakdownHtml(dateEntry) {
    if (!dateEntry || dateEntry.isPaidLeave) return '';
    const branch = dateEntry.branch || '';
    return `
    <div class="location-breakdown">
        <h4>Clock Location</h4>
        <table class="breakdown-table">
            <tr>
                <td>Time In</td>
                <td>${punchLocationHtml(dateEntry.timeInLocation, branch, 'in')}</td>
            </tr>
            <tr>
                <td>Time Out</td>
                <td>${punchLocationHtml(dateEntry.timeOutLocation, branch, 'out')}</td>
            </tr>
        </table>
    </div>`;
}

let punchLeafletMap = null;

function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (loadLeaflet._pending) return loadLeaflet._pending;
    loadLeaflet._pending = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
        css.crossOrigin = '';
        document.head.appendChild(css);
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
        script.crossOrigin = '';
        script.onload = () => resolve(window.L);
        script.onerror = () => reject(new Error('Failed to load map'));
        document.body.appendChild(script);
    });
    return loadLeaflet._pending;
}

function punchMapPinIcon(color) {
    const html = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40" aria-hidden="true"><path fill="${color}" stroke="#fff" stroke-width="2" d="M14 1.5c-6.3 0-11.5 5.1-11.5 11.4 0 8.4 11.5 25.1 11.5 25.1S25.5 21.3 25.5 12.9C25.5 6.6 20.3 1.5 14 1.5z"/><circle fill="#fff" cx="14" cy="13" r="4.2"/></svg>`;
    return window.L.divIcon({
        className: 'punch-map-pin',
        html,
        iconSize: [28, 40],
        iconAnchor: [14, 40],
        popupAnchor: [0, -34]
    });
}

function destroyPunchLeafletMap() {
    if (punchLeafletMap) {
        punchLeafletMap.remove();
        punchLeafletMap = null;
    }
    const canvas = document.getElementById('punchMapCanvas');
    if (canvas) canvas.innerHTML = '';
    const legend = document.getElementById('punchMapLegend');
    if (legend) legend.hidden = true;
}

function renderPunchLeafletMap(staffLat, staffLng, site, onsite, punchLabel) {
    const canvas = document.getElementById('punchMapCanvas');
    const legend = document.getElementById('punchMapLegend');
    const legendStore = document.getElementById('punchMapLegendStore');
    const legendStaff = document.getElementById('punchMapLegendStaff');
    if (!canvas || !window.L) return;

    destroyPunchLeafletMap();

    const staffPinLabel = punchLabel || 'Time In Location';
    const hasSite = site && Number.isFinite(site.lat) && Number.isFinite(site.lng);
    const showDistance = hasSite && !onsite;
    const staffLatLng = [staffLat, staffLng];
    punchLeafletMap = window.L.map(canvas, {
        scrollWheelZoom: true,
        attributionControl: true
    });
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(punchLeafletMap);

    const staffColor = showDistance ? '#e11d48' : '#16a34a';
    window.L.marker(staffLatLng, { icon: punchMapPinIcon(staffColor) })
        .addTo(punchLeafletMap)
        .bindPopup(showDistance ? staffPinLabel : (hasSite ? 'On site' : staffPinLabel));

    if (showDistance) {
        const storeLatLng = [site.lat, site.lng];
        window.L.marker(storeLatLng, { icon: punchMapPinIcon('#16a34a') })
            .addTo(punchLeafletMap)
            .bindPopup(site.label || 'Store');
        window.L.polyline([staffLatLng, storeLatLng], {
            color: '#e11d48',
            weight: 3,
            opacity: 0.9,
            dashArray: '8 6'
        }).addTo(punchLeafletMap);
        punchLeafletMap.fitBounds([staffLatLng, storeLatLng], { padding: [36, 36], maxZoom: 16 });
        if (legend) legend.hidden = false;
        if (legendStore) legendStore.textContent = site.label || 'Store';
        if (legendStaff) legendStaff.textContent = staffPinLabel;
    } else {
        punchLeafletMap.setView(staffLatLng, 16);
        if (legend) legend.hidden = true;
    }

    requestAnimationFrame(() => {
        punchLeafletMap?.invalidateSize();
    });
}

function closePunchMapModal() {
    const modal = document.getElementById('punchMapModal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    destroyPunchLeafletMap();
}

function openPunchMapModal(chip) {
    const modal = document.getElementById('punchMapModal');
    const titleEl = document.getElementById('punchMapModalTitle');
    const metaEl = document.getElementById('punchMapModalMeta');
    const placeWrap = document.getElementById('punchMapModalPlaceWrap');
    const placeEl = document.getElementById('punchMapModalPlace');
    const external = document.getElementById('punchMapOpenExternal');
    const canvas = document.getElementById('punchMapCanvas');
    if (!modal || !canvas || !chip) return;

    const lat = Number(chip.dataset.lat);
    const lng = Number(chip.dataset.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const knownPlace = chip.dataset.place || chip.querySelector('.punch-location-chip__place')?.textContent || '';
    const lookingUp = !knownPlace || knownPlace === 'Looking up area…';
    const accuracy = Number(chip.dataset.accuracy);
    const punchKind = chip.dataset.kind === 'out' ? 'out' : 'in';
    const punchLabel = punchKindLabel(punchKind);
    const site = getPunchSite(chip.dataset.branch);
    let onsite = chip.dataset.onsite === '1';
    let distance = Number(chip.dataset.distance);
    if (site) {
        distance = distanceMeters(lat, lng, site.lat, site.lng);
        onsite = Number.isFinite(distance) && distance <= site.radiusMeters;
    }

    if (titleEl) {
        if (site && Number.isFinite(distance)) {
            titleEl.textContent = onsite
                ? `On site at ${site.label}`
                : `${formatDistanceMeters(distance)} away from ${site.label}`;
        } else {
            titleEl.textContent = punchLabel;
        }
    }

    const placeCaption = document.getElementById('punchMapModalPlaceCaption');
    if (placeCaption) placeCaption.textContent = punchKindLabel(punchKind, { sentenceCase: true });

    const metaParts = [];
    if (Number.isFinite(accuracy)) {
        metaParts.push(`GPS ±${Math.round(accuracy)} m`);
    }
    if (metaEl) metaEl.textContent = metaParts.join(' · ');

    if (placeWrap && placeEl) {
        placeWrap.hidden = false;
        placeEl.textContent = lookingUp ? 'Looking up area…' : knownPlace;
        lookupPunchPlaceDetailed(lat, lng).then((name) => {
            if (placeEl) placeEl.textContent = name || knownPlace || 'Unknown area';
        }).catch(() => {
            if (placeEl && lookingUp) placeEl.textContent = 'Unknown area';
        });
    }

    if (external) {
        if (site && !onsite) {
            external.href = `https://www.google.com/maps/dir/${lat},${lng}/${site.lat},${site.lng}`;
        } else {
            external.href = punchLocationMapsUrl(lat, lng);
        }
        external.style.display = 'inline-block';
    }

    canvas.textContent = 'Loading map…';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    loadLeaflet()
        .then(() => renderPunchLeafletMap(lat, lng, site, onsite, punchLabel))
        .catch(() => {
            canvas.textContent = 'Could not load map.';
        });
}

(function bindPunchLocationUiOnce() {
    if (bindPunchLocationUiOnce._done) return;
    bindPunchLocationUiOnce._done = true;
    document.addEventListener('click', (e) => {
        const chip = e.target.closest('.punch-location-chip');
        if (!chip) return;
        e.preventDefault();
        e.stopPropagation();
        openPunchMapModal(chip);
    });
})();

/** After DOM update: assign real `src` on idle / next frame so image fetches do not block first paint. */
function scheduleDeferredThumbLoads(rootNode) {
    if (!rootNode) return;
    const hydrate = () => {
        rootNode.querySelectorAll('img.thumb-deferred[data-src]').forEach((img) => {
            const url = img.dataset.src;
            if (!url) return;
            img.src = url;
            img.removeAttribute('data-src');
            img.classList.remove('thumb-deferred');
        });
        hydratePunchLocations(rootNode);
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(hydrate, { timeout: 400 });
    } else {
        requestAnimationFrame(() => requestAnimationFrame(hydrate));
    }
}

(function bindThumbModalOnce() {
    if (bindThumbModalOnce._done) return;
    bindThumbModalOnce._done = true;
    document.addEventListener('click', function (e) {
        const img = e.target.closest('img.thumb[data-photo]');
        if (!img || !img.dataset.photo) return;
        e.stopPropagation();
        openPhotoModal(img.dataset.photo);
    });
})();

function openMobileEmployeeDetail(employeeId) {
    if (!employeeDetailMobileModal || !filteredData[employeeId]) return;
    const employee = filteredData[employeeId];
    const name = employee.name || employees[employeeId] || 'Unknown Employee';
    const totalPay = calcTotalPaySimple(employee.dates || [], employee, periodSelect.value);
    const paymentStatus = window.paymentStatus || {};
    const empPayment = paymentStatus[employeeId];
    const bal = getPaymentBalance(totalPay, empPayment);
    const statusKind = getPaymentStatusKind(bal);
    const statusLabel = paymentStatusLabel(statusKind);
    const daysWorked = employee.dates ? employee.dates.filter(d => d.isPaidLeave || (d.timeIn && d.timeOut)).length : 0;

    employeeDetailMobileName.textContent = name;
    const totalPayStr = totalPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const period = periodSelect.value;
    const { endDate } = getPeriodDates(period);
    const showPaymentButton = new Date() > endDate;
    employeeDetailMobileSummary.className = 'employee-detail-mobile__summary' + (statusKind === 'paid' || statusKind === 'surplus' ? ' employee-detail-mobile__summary--paid' : '');
    const statusRowHtml = showPaymentButton
        ? `<div class="employee-detail-mobile__summary-row">
            <span class="employee-detail-mobile__summary-label">Status</span>
            <span class="employee-detail-mobile__summary-value employee-detail-mobile__summary-status employee-detail-mobile__summary-status--${statusKind}">${statusLabel}</span>
        </div>`
        : '';
    const surplusRowHtml = bal.surplus > 0
        ? `<div class="employee-detail-mobile__summary-row">
            <span class="employee-detail-mobile__summary-label">Surplus</span>
            <span class="employee-detail-mobile__summary-value" style="color:#0369a1;">₱${bal.surplus.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>`
        : '';
    employeeDetailMobileSummary.innerHTML = `
        <div class="employee-detail-mobile__summary-card">
            <div class="employee-detail-mobile__summary-row">
                <span class="employee-detail-mobile__summary-label">Days worked</span>
                <span class="employee-detail-mobile__summary-value">${daysWorked}</span>
            </div>
            <div class="employee-detail-mobile__summary-row">
                <span class="employee-detail-mobile__summary-label">Total pay</span>
                <span class="employee-detail-mobile__summary-value">₱${totalPayStr}</span>
            </div>
            ${surplusRowHtml}
            ${statusRowHtml}
        </div>
    `;
    employeeDetailMobileActions.innerHTML = '';
    if (showPaymentButton && (statusKind === 'unpaid' || statusKind === 'partial')) {
        const payBtn = document.createElement('button');
        payBtn.type = 'button';
        payBtn.className = 'action-btn payment-btn';
        payBtn.textContent = 'Record payment';
        payBtn.dataset.employeeId = employeeId;
        payBtn.addEventListener('click', function () { openPayMode(employeeId); });
        employeeDetailMobileActions.appendChild(payBtn);
    }
    if (showPaymentButton && statusKind === 'surplus') {
        const adjustBtn = document.createElement('button');
        adjustBtn.type = 'button';
        adjustBtn.className = 'action-btn adjust-surplus-btn';
        adjustBtn.textContent = 'Adjust surplus';
        adjustBtn.addEventListener('click', function () { openAdjustSurplusModal(employeeId); });
        employeeDetailMobileActions.appendChild(adjustBtn);
    }

    const payslipMobileBtn = document.createElement('button');
    payslipMobileBtn.type = 'button';
    payslipMobileBtn.className = 'action-btn';
    payslipMobileBtn.textContent = 'Download Payslip';
    payslipMobileBtn.addEventListener('click', function () {
        generateAdminEmployeePayslipPDF(employeeId, payslipMobileBtn);
    });
    employeeDetailMobileActions.appendChild(payslipMobileBtn);

    const finishMobileDayCards = () => {
        renderMobileDayCards(employeeId);
    };
    if (employee._payrollRowLoading) {
        employeeDetailMobileDayCards.innerHTML = buildEmployeeDetailScrimHtml('Loading attendance…');
        const waitRowLoaded = () => {
            const em = filteredData[employeeId];
            if (!em || !em._payrollRowLoading) {
                finishMobileDayCards();
                return;
            }
            requestAnimationFrame(waitRowLoaded);
        };
        requestAnimationFrame(waitRowLoaded);
    } else {
        finishMobileDayCards();
    }

    employeeDetailMobileModal.style.display = 'flex';
    employeeDetailMobileModal.setAttribute('aria-hidden', 'false');

    if (employeeDetailMobileClose) {
        employeeDetailMobileClose.onclick = closeMobileEmployeeDetail;
    }
    employeeDetailMobileModal.onclick = function (e) {
        if (e.target === employeeDetailMobileModal) closeMobileEmployeeDetail();
    };
}

function closeMobileEmployeeDetail() {
    if (employeeDetailMobileModal) {
        employeeDetailMobileModal.style.display = 'none';
        employeeDetailMobileModal.setAttribute('aria-hidden', 'true');
        employeeDetailMobileModal.onclick = null;
    }
    if (employeeDetailMobileClose) employeeDetailMobileClose.onclick = null;
}

function renderMobileDayCards(employeeId) {
    if (!employeeDetailMobileDayCards || !filteredData[employeeId]) return;
    const employee = filteredData[employeeId];
    const dates = (employee.dates || []).slice().sort((a, b) => a.date.localeCompare(b.date));

    employeeDetailMobileDayCards.innerHTML = '';
    dates.forEach(dateEntry => {
        const dailyPay = dateEntry.isPaidLeave || (dateEntry.timeIn && dateEntry.timeOut)
            ? payCalculator.calculateDailyPay(dateEntry, employee, 'simple')
            : 0;
        const dateLabel = formatReadableDate(dateEntry.date);
        const timeInStr = dateEntry.isPaidLeave ? '—' : (dateEntry.timeIn ? formatTimeWithoutSeconds(dateEntry.timeIn) : '–');
        const timeOutStr = dateEntry.isPaidLeave ? '—' : (dateEntry.timeOut ? formatTimeWithoutSeconds(dateEntry.timeOut) : '–');
        const branch = dateEntry.isPaidLeave ? '—' : (dateEntry.branch || '–');
        const shift = dateEntry.isPaidLeave ? '—' : (dateEntry.shift || '–');
        const timeInPhoto = dateEntry.timeInPhoto || '';
        const timeOutPhoto = dateEntry.timeOutPhoto || '';

        const card = document.createElement('div');
        card.className = 'employee-detail-mobile__day-card';
        card.innerHTML = `
            <div class="employee-detail-mobile__day-card__left">
                <div class="employee-detail-mobile__day-card__date">${dateLabel}${dateEntry.isPaidLeave ? ' · Paid Leave' : ''}</div>
                <div class="employee-detail-mobile__day-card__photos">
                    ${photoThumbDeferredHtml(timeInPhoto, 'Clock-in', 'employee-detail-mobile__day-card__thumb')}
                    ${photoThumbDeferredHtml(timeOutPhoto, 'Clock-out', 'employee-detail-mobile__day-card__thumb')}
                </div>
                <div class="employee-detail-mobile__day-card__meta">${dateEntry.isPaidLeave ? 'No shift' : `${branch} · ${shift} · ${timeInStr} – ${timeOutStr}`}</div>
                ${dateEntry.isPaidLeave ? '' : `<div class="employee-detail-mobile__day-card__location">In ${punchLocationHtml(dateEntry.timeInLocation, dateEntry.branch, 'in')} · Out ${punchLocationHtml(dateEntry.timeOutLocation, dateEntry.branch, 'out')}</div>`}
            </div>
            <div class="employee-detail-mobile__day-card__pay">₱${dailyPay.toFixed(2)}</div>
        `;
        employeeDetailMobileDayCards.appendChild(card);
    });

    (employee.periodEarningsLines || []).forEach((line) => {
        if (line.status === 'waived') return;
        const amt = Number(line.amount || 0);
        const dateLabel = formatEarningsRequestDate(line);
        const label = earningsKindLabel(line.kind, amt);
        const card = document.createElement('div');
        card.className = 'employee-detail-mobile__day-card';
        card.innerHTML = `
            <div class="employee-detail-mobile__day-card__left">
                <div class="employee-detail-mobile__day-card__date">${escapeHtml(dateLabel)}${line.fromPriorCutoff ? ' · Prior' : ''}</div>
                <div class="employee-detail-mobile__day-card__meta">${escapeHtml(label)}${(line.prePaid || Number(line.prePaidAmount) > 0) ? ' · Prepaid' : ''}</div>
                <div class="period-earning-actions period-earning-actions--row">
                    <button type="button" class="action-btn" data-pe-action="edit" data-doc-id="${escapeHtml(line.id)}" data-line="${encodeURIComponent(JSON.stringify(line))}">Edit</button>
                    <button type="button" class="action-btn" data-pe-action="defer" data-doc-id="${escapeHtml(line.id)}" data-line="${encodeURIComponent(JSON.stringify(line))}">Defer</button>
                    ${line.kind === 'reimbursement' && !line.prePaid && !(Number(line.prePaidAmount) > 0) && Number(line.amount) > 0
                        ? `<button type="button" class="action-btn" data-pe-action="mark_prepaid" data-doc-id="${escapeHtml(line.id)}" data-line="${encodeURIComponent(JSON.stringify(line))}">Mark prepaid</button>`
                        : ''}
                    <button type="button" class="action-btn action-btn--waive" data-pe-action="waive" data-doc-id="${escapeHtml(line.id)}" data-line="${encodeURIComponent(JSON.stringify(line))}">Waive</button>
                </div>
            </div>
            <div class="employee-detail-mobile__day-card__pay" style="${amt < 0 ? 'color:#b91c1c;' : ''}">₱${amt.toFixed(2)}</div>
        `;
        employeeDetailMobileDayCards.appendChild(card);
    });
    bindPeriodEarningActionButtons(employeeDetailMobileDayCards);

    scheduleDeferredThumbLoads(employeeDetailMobileDayCards);
}

const EMPLOYEE_TABLE_SORT_DEFAULT_DIR = {
    name: 'asc',
    daysWorked: 'desc',
    lateness: 'desc',
    balance: 'desc',
    lastClockIn: 'desc'
};

let employeeTableSort = { column: null, direction: 'asc' };

function getEmployeeDisplayName(employeeId, employee) {
    return (employee?.name || employees[employeeId] || 'Unknown Employee').toString().trim();
}

function getEmployeeAvgLatenessMinutes(employee) {
    const daysWorked = Number(employee?.daysWorked || 0);
    const lateHours = Number(employee?.lateHours || 0);
    return daysWorked > 0 ? (lateHours / daysWorked) * 60 : 0;
}

function getLastClockInMs(employee) {
    if (!employee?.lastClockIn) return null;
    const dateObj = employee.lastClockIn instanceof Date
        ? employee.lastClockIn
        : new Date(employee.lastClockIn);
    const ms = dateObj.getTime();
    return Number.isNaN(ms) ? null : ms;
}

/** Signed balance for sorting: remaining due is positive; surplus is negative. */
function getEmployeeBalanceSortValue(employeeId, employee) {
    const periodId = periodSelect?.value;
    const totalPay = getEmployeeTotalPayForTable(employee, periodId);
    const bal = getPaymentBalance(totalPay, (window.paymentStatus || {})[employeeId]);
    if (bal.surplus > 0) return -bal.surplus;
    return bal.remaining;
}

function compareEmployeeTableRows(a, b) {
    const [idA, empA] = a;
    const [idB, empB] = b;
    const column = employeeTableSort.column;
    const dir = employeeTableSort.direction === 'desc' ? -1 : 1;
    let cmp = 0;

    if (column === 'name') {
        cmp = getEmployeeDisplayName(idA, empA).localeCompare(
            getEmployeeDisplayName(idB, empB),
            undefined,
            { sensitivity: 'base' }
        );
    } else if (column === 'daysWorked') {
        cmp = Number(empA?.daysWorked || 0) - Number(empB?.daysWorked || 0);
    } else if (column === 'lateness') {
        cmp = getEmployeeAvgLatenessMinutes(empA) - getEmployeeAvgLatenessMinutes(empB);
    } else if (column === 'balance') {
        cmp = getEmployeeBalanceSortValue(idA, empA) - getEmployeeBalanceSortValue(idB, empB);
    } else if (column === 'lastClockIn') {
        const msA = getLastClockInMs(empA);
        const msB = getLastClockInMs(empB);
        if (msA == null && msB == null) cmp = 0;
        else if (msA == null) return 1;
        else if (msB == null) return -1;
        else cmp = msA - msB;
    }

    if (cmp === 0) {
        return getEmployeeDisplayName(idA, empA).localeCompare(
            getEmployeeDisplayName(idB, empB),
            undefined,
            { sensitivity: 'base' }
        );
    }
    return cmp * dir;
}

function updateEmployeeTableSortHeaders() {
    document.querySelectorAll('#employeeTable thead th.sortable').forEach((header) => {
        const active = header.dataset.sort === employeeTableSort.column;
        header.classList.toggle('sorted-asc', active && employeeTableSort.direction === 'asc');
        header.classList.toggle('sorted-desc', active && employeeTableSort.direction === 'desc');
        if (!active) {
            header.setAttribute('aria-sort', 'none');
        } else {
            header.setAttribute('aria-sort', employeeTableSort.direction === 'desc' ? 'descending' : 'ascending');
        }
    });
}

function setupEmployeeTableSorting() {
    document.querySelectorAll('#employeeTable thead th.sortable').forEach((header) => {
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-sort', 'none');
        const applySort = () => {
            const column = header.dataset.sort;
            if (employeeTableSort.column === column) {
                employeeTableSort.direction = employeeTableSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                employeeTableSort.column = column;
                employeeTableSort.direction = EMPLOYEE_TABLE_SORT_DEFAULT_DIR[column] || 'asc';
            }
            updateEmployeeTableSortHeaders();
            renderEmployeeTable();
        };
        header.addEventListener('click', applySort);
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                applySort();
            }
        });
    });
}

function renderEmployeeTable() {
    // Clear the table body first
    employeeTableBody.innerHTML = '';

    let filteredEmployees;

    if (activeOnlyToggle.checked) {
        // Active = clock-ins this period, OR monthly/hybrid with pay configured
        const periodId = periodSelect.value;
        filteredEmployees = Object.entries(filteredData).filter(([_, employee]) =>
            employeeHasRosterPayActivity(employee, periodId)
        );
    } else {
        // If unchecked, show ALL employees who existed during this period
        const periodId = periodSelect.value;
        const allEmployees = {};

        // First add all employees from filteredData
        Object.entries(filteredData).forEach(([id, data]) => {
            if (employeeWasOnRosterForPeriod(data, periodId) || (data.dates && data.dates.some((d) => d && (d.timeIn || d.isPaidLeave)))) {
                allEmployees[id] = data;
            }
        });

        // Then add any missing employees from the main employees object
        Object.keys(employees).forEach(id => {
            if (!allEmployees[id]) {
                const stub = {
                    id: id,
                    name: employees[id],
                    dates: [],
                    daysWorked: 0,
                    lateHours: 0,
                    baseRate: 0,
                    salesBonusEligible: false,
                    createdAt: filteredData[id]?.createdAt || attendanceData[id]?.createdAt || null
                };
                if (employeeWasOnRosterForPeriod(stub, periodId)) {
                    allEmployees[id] = stub;
                }
            }
        });

        filteredEmployees = Object.entries(allEmployees);
    }

    if (employeeTableSort.column) {
        filteredEmployees.sort(compareEmployeeTableRows);
    }

    if (filteredEmployees.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="8" class="no-data">No data available for the selected filters</td>`;
        employeeTableBody.appendChild(row);
        if (employeeCardsMobileEl) {
            employeeCardsMobileEl.innerHTML = '';
            employeeCardsMobileEl.setAttribute('aria-hidden', 'true');
        }
        return;
    }

    const mobileCardData = [];
    // Continue with the rest of the function using filteredEmployees
    filteredEmployees.forEach(([employeeId, employee]) => {
        const row = document.createElement('tr');
        row.className = 'expandable-row';
        row.dataset.employeeId = employeeId;

        if (employee._payrollRowLoading) {
            row.classList.add('payroll-row-loading');
            const dispName = escapeHtml(employee.name || employees[employeeId] || 'Unknown Employee');
            row.innerHTML = `
        <td>
          <div class="employee-name-cell">
            <span class="employee-name">${dispName}</span>
          </div>
        </td>
        <td colspan="7" class="payroll-row-loading__cells">
          <span class="payroll-row-loading__shimmer"></span>
          <span class="payroll-row-loading__hint">Loading attendance…</span>
        </td>
        `;
            employeeTableBody.appendChild(row);
            const detailRow = document.createElement('tr');
            detailRow.className = 'detail-row';
            detailRow.dataset.employeeId = employeeId;
            detailRow.dataset.loaded = 'false';
            const detailContent = document.createElement('td');
            detailContent.colSpan = 8;
            detailContent.className = 'detail-content';
            detailContent.innerHTML = '<div class="loading-placeholder">Loading…</div>';
            detailRow.appendChild(detailContent);
            employeeTableBody.appendChild(detailRow);
            mobileCardData.push({ skeleton: true, employeeId, name: employee.name || employees[employeeId] || 'Unknown' });
            return;
        }

        // Use pre-calculated values instead of recalculating
        const daysWorked = employee.daysWorked;
        const lateHours = employee.lateHours;

        // Format the last clock-in date (JSON clone / localStorage cache use ISO strings, not Date)
        let lastClockIn = 'N/A';
        if (employee.lastClockIn) {
            const dateObj =
                employee.lastClockIn instanceof Date
                    ? employee.lastClockIn
                    : new Date(employee.lastClockIn);
            const options = { year: 'numeric', month: 'long', day: 'numeric' };
            if (!Number.isNaN(dateObj.getTime())) {
                lastClockIn = dateObj.toLocaleDateString('en-US', options);
            }
        }

        // Check if we're after payroll period end
        const period = periodSelect.value;
        const { endDate } = getPeriodDates(period);
        const today = new Date();
        const showPaymentButton = today > endDate;


        // Let's see what the first date entry looks like
        if (employee.dates && employee.dates[0]) {
            // console.log('First date entry details:', {
            //     date: employee.dates[0].date,
            //     timeIn: employee.dates[0].timeIn,
            //     timeOut: employee.dates[0].timeOut,
            //     branch: employee.dates[0].branch,
            //     shift: employee.dates[0].shift,
            //     hasFixedPay: employee.dates[0].hasFixedPay,
            //     hasDoublePay: employee.dates[0].hasDoublePay
            // });
        }

        const totalPay = getEmployeeTotalPayForTable(employee, period);

        // Get payment status for this employee
        const paymentStatus = window.paymentStatus || {};
        const employeePayment = paymentStatus[employeeId];
        const payableCell = formatPayableCell(totalPay, employeePayment);
        const payableAmount = payableCell.amount;
        const payableClass = payableCell.className;
        const payableDisplay = payableCell.label;
        const payBal = getPaymentBalance(totalPay, employeePayment);
        const statusKind = getPaymentStatusKind(payBal);
        const showPayAction = showPaymentButton && (statusKind === 'unpaid' || statusKind === 'partial');
        const showSurplusAdjust = showPaymentButton && statusKind === 'surplus';

        const paymentButtonHtml = showPayAction ? `
        <button class="action-btn payment-btn" data-employee-id="${employeeId}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
            Pay
        </button>
        ` : '';

        const adjustSurplusButtonHtml = showSurplusAdjust ? `
        <button type="button" class="action-btn adjust-surplus-btn" data-employee-id="${employeeId}" title="Correct over-recorded payment total">
            Adjust surplus
        </button>
        ` : '';

        mobileCardData.push({
            employeeId,
            employee,
            totalPay,
            payableAmount,
            payableClass,
            payableDisplay,
            surplus: payBal.surplus,
            paid: payBal.paid,
            remaining: payBal.remaining,
            showPaymentButton,
            daysWorked
        });

        row.innerHTML = `
        <td>
            <div class="employee-name-cell">
                <span class="employee-name">${employee.name || employees[employeeId] || 'Unknown Employee'}</span>
            </div>
        </td>
        <td>${daysWorked}</td>
        <td class="${getLatnessColorClass(daysWorked > 0 ? (lateHours / daysWorked * 60) : 0)}">${daysWorked > 0 ? (lateHours / daysWorked * 60).toFixed(1) : '0.0'}</td>
        <td class="base-rate">₱${(employee.baseRate || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>₱${totalPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="${payableClass}">${payableDisplay}</td>
        <td class="time-cell">
            ${employee.lastClockInPhoto ? photoThumbDeferredHtml(employee.lastClockInPhoto, 'Last clock-in') : ''}
            <span class="date-readable">${lastClockIn}</span>
        </td>
        <td class="action-cell">
                <div class="action-buttons-container">
                    <button class="action-btn open-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M9 18l6-6-6-6"></path>
                        </svg>
                        Open
                    </button>
                    <button class="action-btn edit-employee-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit
                    </button>
                    ${paymentButtonHtml}
                    ${adjustSurplusButtonHtml}
                </div>
            </td>
        `;

        employeeTableBody.appendChild(row);

        // Create detail row placeholder - will be populated on demand
        const detailRow = document.createElement('tr');
        detailRow.className = 'detail-row';
        detailRow.dataset.employeeId = employeeId;
        detailRow.dataset.loaded = 'false';

        // Generate placeholder content
        const detailContent = document.createElement('td');
        detailContent.colSpan = 8;
        detailContent.className = 'detail-content';
        detailContent.innerHTML = '<div class="loading-placeholder">Click "View Details" to load attendance details</div>';

        detailRow.appendChild(detailContent);
        employeeTableBody.appendChild(detailRow);
    });


    // Add event listeners for row clicks to expand details
    document.querySelectorAll('.expandable-row').forEach(row => {
        row.addEventListener('click', function (e) {
            // Don't expand if clicking on a button or punch photo
            if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('img.thumb') || e.target.closest('.punch-location-chip')) {
                return;
            }
            if (this.classList.contains('payroll-row-loading')) {
                return;
            }

            const employeeId = this.dataset.employeeId;
            const detailRow = document.querySelector(`.detail-row[data-employee-id="${employeeId}"]`);

            // Load details on demand
            if (detailRow.dataset.loaded === 'false') {
                loadEmployeeDetails(employeeId, detailRow);
            }

            this.classList.toggle('expanded');
            detailRow.classList.toggle('expanded');
        });
    });

    // Add event listeners for edit employee buttons
    document.querySelectorAll('.edit-employee-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const row = this.closest('.expandable-row');
            const employeeId = row.dataset.employeeId;
            openEditEmployeeModal(employeeId);
        });
    });

    // Add this after the other button event listeners in renderEmployeeTable function
    document.querySelectorAll('.open-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const row = this.closest('.expandable-row');
            const employeeId = row.dataset.employeeId;

            console.log('Open button clicked for employee:', employeeId);

            // Set the current view to this employee
            currentEmployeeView = employeeId;
            updateURLHash(employeeId);

            // Ensure we have the employee data before proceeding
            if (!filteredData[employeeId]) {
                console.log('Employee data not found in filteredData, waiting for data load...');
                // Wait for data to be available
                setTimeout(() => {
                    if (currentEmployeeView === employeeId) {
                        console.log('Retrying view update after data load');
                        updateViewMode();
                    }
                }, 500);
                return;
            }

            console.log('Employee data available, proceeding with view update');
            // Update the UI to show we're in single employee view
            updateViewMode();

            // Force a complete view update to ensure single employee page loads
            setTimeout(() => {
                if (currentEmployeeView === employeeId) {
                    console.log('Forcing view update for employee:', employeeId);
                    updateViewModeImpl();
                    
                    // Additional fallback: directly load employee details if view mode fails
                    setTimeout(() => {
                        const detailsContainer = document.getElementById('employee-details-table');
                        if (detailsContainer && !detailsContainer.querySelector('#employeeDetailTable')) {
                            console.log('View mode may have failed, directly loading employee details');
                            loadEmployeeDetailsAsMainTable(employeeId, detailsContainer);
                        }
                    }, 1000);
                }
            }, 200);
        });
    });

    // Add event listeners for payment buttons
    document.querySelectorAll('.payment-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const employeeId = this.dataset.employeeId;
            openPayMode(employeeId);
        });
    });

    document.querySelectorAll('.adjust-surplus-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openAdjustSurplusModal(this.dataset.employeeId);
        });
    });

    // Add this at the end of the renderEmployeeTable function, just before the closing brace
    // After setting up all the event listeners

    // If we're in single employee view, automatically load and expand details
    if (currentEmployeeView) {
        const detailRow = document.querySelector(`.detail-row[data-employee-id="${currentEmployeeView}"]`);
        const row = document.querySelector(`.expandable-row[data-employee-id="${currentEmployeeView}"]`);

        if (detailRow && row) {
            // Load details if not loaded
            if (detailRow.dataset.loaded === 'false') {
                loadEmployeeDetails(currentEmployeeView, detailRow);
            }

            // Expand the row
            row.classList.add('expanded');
            detailRow.classList.add('expanded');
        }
    }

    if (isMobileLayout()) {
        renderMobileCards(mobileCardData);
    } else if (employeeCardsMobileEl) {
        employeeCardsMobileEl.innerHTML = '';
        employeeCardsMobileEl.setAttribute('aria-hidden', 'true');
    }

    scheduleDeferredThumbLoads(employeeTableBody);

    setTimeout(updateEmployeePaymentStatus, 500);
}

async function loadAllPaymentConfirmations(periodId, { forceRefresh = false } = {}) {
    const cacheKey = periodPaymentsCacheKey(periodId);
    const previousStatus = (window.paymentStatus && typeof window.paymentStatus === 'object')
        ? { ...window.paymentStatus }
        : {};

    if (forceRefresh) {
        localStorage.removeItem(cacheKey);
    } else {
        // Try cache first
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                const parsedCache = JSON.parse(cached);
                const cacheAge = Date.now() - (parsedCache.timestamp || 0);
                if (cacheAge < 5 * 60 * 1000) { // 5 minute cache
                    const cachedData = parsedCache.data || {};
                    if (Object.keys(cachedData).length > 0) {
                        return cachedData;
                    }
                    localStorage.removeItem(cacheKey);
                }
            } catch (_) {
                localStorage.removeItem(cacheKey);
            }
        }
    }

    if (!navigator.onLine) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                return JSON.parse(cached).data || previousStatus;
            } catch (_) {
                return previousStatus;
            }
        }
        return previousStatus;
    }

    try {
        const paymentsRef = v2PaymentsCollRef(periodId);
        // After a pay confirm, force server read so a stale cache/offline snapshot
        // cannot keep the employee marked unpaid in Pay Mode.
        const snapshot = forceRefresh
            ? await getDocsFromServer(paymentsRef)
            : await getDocs(paymentsRef);

        const paymentStatus = {};
        snapshot.forEach((d) => {
            const employeeId = d.id;
            const paymentData = d.data() || {};
            paymentStatus[employeeId] = normalizePaymentStatusRecord(paymentData);
        });

        if (snapshot.empty) {
            const knownIds = Object.keys(previousStatus);
            if (knownIds.length > 0) {
                const verified = await fetchPaymentStatusForEmployeeIds(periodId, knownIds);
                if (Object.keys(verified).length > 0) {
                    writePeriodPaymentsCacheMap(periodId, verified);
                    return verified;
                }
                return previousStatus;
            }
            return {};
        }

        writePeriodPaymentsCacheMap(periodId, paymentStatus);

        return paymentStatus;
    } catch (error) {
        console.error("Error loading payment confirmations:", error);
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                return JSON.parse(cached).data || previousStatus;
            } catch (_) {
                return previousStatus;
            }
        }
        // Never wipe known in-memory payments on a failed refresh
        return previousStatus;
    }
}

function normalizePaymentStatusRecord(paymentData = {}) {
    return {
        paid: true,
        paymentAmount: Number(paymentData.paymentAmount) || 0,
        totalPay: Number(paymentData.totalPay) || 0,
        remainingAmount: Number(paymentData.remainingAmount) || 0,
        paymentType: paymentData.paymentType || 'full',
        cashAdvanceNote: paymentData.cashAdvanceNote || '',
        transferMethod: paymentData.transferMethod || '',
        note: paymentData.note || '',
        uploadedAt: paymentData.uploadedAt || '',
        screenshotUrl: paymentData.screenshotUrl || null
    };
}

/** After a server-verified pay, keep memory + localStorage + summary in sync for refresh. */
function applyVerifiedPaymentToLocalState(periodId, employeeId, paymentData) {
    const normalized = normalizePaymentStatusRecord(paymentData);
    if (!window.paymentStatus) window.paymentStatus = {};
    window.paymentStatus[employeeId] = normalized;

    const cachedMap = readPeriodPaymentsCacheMap(periodId) || {};
    writePeriodPaymentsCacheMap(periodId, { ...cachedMap, [employeeId]: normalized });

    const branchId = getSelectedBranchFilter();
    if (attendanceData && Object.keys(attendanceData).length) {
        saveSummaryToCache(periodId, branchId, attendanceData, window.paymentStatus);
    }
}

async function fetchPaymentStatusForEmployeeIds(periodId, employeeIds) {
    const paymentStatus = {};
    const ids = [...new Set((employeeIds || []).filter(Boolean))];
    await Promise.all(ids.map(async (employeeId) => {
        try {
            const snap = await getDocFromServer(v2PaymentDocRef(periodId, employeeId));
            if (snap.exists()) {
                paymentStatus[employeeId] = normalizePaymentStatusRecord(snap.data() || {});
            }
        } catch (err) {
            console.warn('[Payment] Could not verify payment doc for', employeeId, err);
        }
    }));
    return paymentStatus;
}

// Replace the updateEmployeePaymentStatus function with this:
async function updateEmployeePaymentStatus(forceUpdate = false) {
    const periodId = periodSelect.value;

    // Check if we're after the payroll period end
    const { endDate } = getPeriodDates(periodId);
    const today = new Date();

    // Only show payment status if we're past the period end date OR if forced
    if (today <= endDate && !forceUpdate) {
        // Remove any existing indicators since we're still in the period
        const existingIndicators = document.querySelectorAll('.payment-status-indicator');
        existingIndicators.forEach(indicator => indicator.remove());
        return;
    }

    const employeeRows = document.querySelectorAll('.expandable-row');

    // Prefer live in-memory status (just-saved payments) over a second network round-trip
    const paymentStatuses = (window.paymentStatus && Object.keys(window.paymentStatus).length)
        ? window.paymentStatus
        : await loadAllPaymentConfirmations(periodId, { forceRefresh: !!forceUpdate });

    // Update all rows instantly
    employeeRows.forEach(row => {
        const employeeId = row.dataset.employeeId;
        if (!employeeId) return;

        // Remove existing payment indicators
        const existingIndicator = row.querySelector('.payment-status-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }

        const indicator = document.createElement('span');
        indicator.className = 'payment-status-indicator';

        // Calculate payable amount for this employee
        const employeeData = filteredData[employeeId];
        if (!employeeData) return;
        
        const totalPay = getEmployeeTotalPayForTable(employeeData, periodId);
        
        // Remaining / surplus from live total − amount already paid
        const paymentData = paymentStatuses[employeeId];
        const bal = getPaymentBalance(totalPay, paymentData);
        const kind = getPaymentStatusKind(bal);
        indicator.className = `payment-status-indicator payment-status-indicator--${kind}`;
        indicator.textContent = paymentStatusLabel(kind);

        const nameCell = row.querySelector('.employee-name-cell') || row.querySelector('.employee-name')?.parentElement;
        if (nameCell) {
            nameCell.appendChild(indicator);
        }
    });
}

function getLatnessColorClass(avgLateness) {
    if (avgLateness >= 30) return 'late-high';
    if (avgLateness >= 15) return 'late-medium';
    if (avgLateness > 0) return 'late-low';
    return '';
}

async function uploadHolidaysToFirebase() {
    try {
        await setDoc(doc(db, "config", "holidays_2025"), HOLIDAYS_2025);
        console.log("Holidays uploaded to Firebase");
    } catch (error) {
        console.error("Error uploading holidays:", error);
    }
}

function getHolidayPayMultiplier(dateStr) {
    if (HOLIDAYS_2025[dateStr]) {
        // Regular holiday: 200% of daily rate
        if (HOLIDAYS_2025[dateStr].type === "regular") {
            return 2.0;
        }
        // Special non-working holiday: 130% of daily rate
        else if (HOLIDAYS_2025[dateStr].type === "special") {
            return 1.3;
        }
    }
    // Regular day: 100% of daily rate
    return 1.0;
}

// Add this function before the updateSummaryCards function
function countHolidaysInPeriod(startDate, endDate) {
    let regularCount = 0;
    let specialCount = 0;

    // Get all dates in the range
    const dates = getDatesInRange(startDate, endDate);

    // Count holidays
    dates.forEach(dateStr => {
        if (HOLIDAYS_2025[dateStr]) {
            if (HOLIDAYS_2025[dateStr].type === 'regular') {
                regularCount++;
            } else if (HOLIDAYS_2025[dateStr].type === 'special') {
                specialCount++;
            }
        }
    });

    return { regular: regularCount, special: specialCount, total: regularCount + specialCount };
}

// Helper function to remove seconds from time strings
function removeSecondsFromTime(timeStr) {
    if (!timeStr) return timeStr;

    // Match format like "1:16:02 PM" and convert to "1:16 PM"
    const timeRegex = /^(\d{1,2}):(\d{2}):\d{2}\s?(AM|PM)$/i;
    const match = timeStr.match(timeRegex);

    if (match) {
        return `${match[1]}:${match[2]} ${match[3]}`;
    }

    // Return as-is if it doesn't match (already in correct format)
    return timeStr;
}

// Function to load employee details only when needed
async function loadEmployeeDetails(employeeId, detailRow) {
    const detailContent = detailRow.querySelector('.detail-content');
    detailContent.classList.add('detail-content--loading-host');
    detailContent.innerHTML = buildEmployeeDetailScrimHtml('Loading attendance…');

    try {
        const period = periodSelect.value;
        const branch = branchSelect.value;
        const { startDate, endDate } = getPeriodDates(period);
        const formattedStartDate = formatDate(startDate);
        const formattedEndDate = formatDate(endDate);

        // console.log("Period range:", formatDate(startDate), "to", formatDate(endDate));

        const dates = [];
        const attendanceRef = collection(db, "attendance_v2", employeeId, "dates");

        // Only fetch dates within the period range
        const querySnapshot = await getDocs(query(
            attendanceRef.withConverter(null),
            where("__name__", ">=", formattedStartDate),
            where("__name__", "<=", formattedEndDate)
        ));

        querySnapshot.forEach(doc => {
            const dateData = doc.data();
            const dateStr = doc.id;

            // Add this inside your querySnapshot.forEach loop
            console.log(`Checking date: ${dateStr}`);
            console.log(`Date comparison: ${dateStr} >= ${formatDate(startDate)} && ${dateStr} <= ${formatDate(endDate)}`);
            // console.log(`JavaScript comparison result:`, dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime);

            // Check if the date is actually in the period range
            const dateObj = new Date(dateStr);
            const dateObjNoTime = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
            const startDateNoTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDateNoTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            
            // Only proceed if date is in range
            if (dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime) {
                // Add branch filter condition
                const isPaidLeave = dateData.isPaidLeave === true;
                const branchName = dateData.clockIn?.branch || "N/A";
                const branchMatches = isPaidLeave || branch === 'all' || attendanceMatchesFilter(branchName, branch);

                if (branchMatches) {
                    const shiftType = dateData.clockIn?.shift || "Custom";
                    
                    // Get scheduled times: use stored values if available (for Custom shifts), otherwise use shift schedule
                    let scheduledIn, scheduledOut;
                    if (dateData.scheduledIn !== undefined && dateData.scheduledOut !== undefined) {
                        scheduledIn = dateData.scheduledIn;
                        scheduledOut = dateData.scheduledOut;
                    } else {
                        const shiftSchedule = SHIFT_SCHEDULES[shiftType] || SHIFT_SCHEDULES["Custom"];
                        scheduledIn = shiftSchedule.timeIn;
                        scheduledOut = shiftSchedule.timeOut;
                    }

                    dates.push({
                        date: dateStr,
                        branch: branchName,
                        shift: shiftType,
                        scheduledIn: scheduledIn,
                        scheduledOut: scheduledOut,
                        timeIn: dateData.clockIn?.time || null,
                        timeOut: dateData.clockOut?.time || null,
                        timeInPhoto: dateData.clockIn?.selfie || null,
                        timeOutPhoto: dateData.clockOut?.selfie || null,
                        timeInLocation: extractPunchLocation(dateData.clockIn),
                        timeOutLocation: extractPunchLocation(dateData.clockOut),
                        hasOTPay: dateData.hasOTPay || false,
                        transpoAllowance: dateData.transpoAllowance || 0,
                        hasFixedPay: dateData.hasFixedPay || false,
                        fixedPayAmount: dateData.fixedPayAmount || 0,
                        hasDoublePay: dateData.hasDoublePay || false,
                        isPaidLeave: dateData.isPaidLeave === true,
                        hasMealAllowance: dateData.hasMealAllowance !== false // Default to true
                    });

                    // Add this after the push to update the main data store
                    if (dateData.clockIn?.selfie || dateData.clockOut?.selfie) {
                        // Make sure attendanceData has this date entry
                        if (!attendanceData[employeeId].dates) {
                            attendanceData[employeeId].dates = [];
                        }

                        // Find or create the date entry
                        let mainDateEntry = attendanceData[employeeId].dates.find(d => d.date === dateStr);
                        if (!mainDateEntry) {
                            mainDateEntry = {
                                date: dateStr,
                                branch: branchName,
                                shift: dateData.clockIn?.shift || "N/A",
                                scheduledIn: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeIn,
                                scheduledOut: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeOut,
                                timeIn: dateData.clockIn?.time || null,
                                timeOut: dateData.clockOut?.time || null
                            };
                            attendanceData[employeeId].dates.push(mainDateEntry);
                        }

                        // Update with photos
                        mainDateEntry.timeInPhoto = dateData.clockIn?.selfie || null;
                        mainDateEntry.timeOutPhoto = dateData.clockOut?.selfie || null;
                        mainDateEntry.timeInLocation = extractPunchLocation(dateData.clockIn);
                        mainDateEntry.timeOutLocation = extractPunchLocation(dateData.clockOut);
                    }
                }
            }
        });

        // Create detail table
        const detailTable = document.createElement('table');
        detailTable.className = 'detail-table';

        const employeeData = filteredData[employeeId];
        const showSalesBonus = employeeData && employeeData.salesBonusEligible;

        detailTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Shift</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Late Hours</th>
                    ${showSalesBonus ? '<th>Sales Bonus</th>' : ''}
                    <th>Total Pay</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const detailTableBody = detailTable.querySelector('tbody');

        // Sort dates in descending order
        const sortedDates = [...dates].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Add rows for each date
        sortedDates.forEach(date => {
            const dateObj = new Date(date.date);
            const formattedDate = formatDate(dateObj);
            const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });

            const hours = date.timeIn && date.timeOut ? payCalculator.calculateHours(date.timeIn, date.timeOut) : null;

            let status = 'Absent';
            let statusClass = 'absent';

            if (date.timeIn && date.timeOut) {
                if (date.scheduledIn && payCalculator.compareTimes(date.timeIn, date.scheduledIn) > 0) {
                    status = 'Late';
                    statusClass = 'late';
                } else if (date.scheduledOut && payCalculator.getUndertimeMinutes(date.timeIn, date.timeOut, date.scheduledIn, date.scheduledOut) > 0) {
                    status = 'Early Out';
                    statusClass = 'early';
                } else {
                    status = 'Present';
                    statusClass = 'present';
                }
            }

            const detailRowItem = document.createElement('tr');
            // In loadEmployeeDetails function, update the row HTML to place photo above time and remove seconds
            // Update the detailRowItem HTML in loadEmployeeDetails function
            // In the detailRowItem.innerHTML = section, add a holiday column after the status column
            const employeeData = filteredData[employeeId];
            const dailySalesBonus = (date.timeIn && date.timeOut && date.branch === 'SM North' && employeeData.salesBonusEligible) ?
                payCalculator.calculateSalesBonus(date.date, employeeData) : 0;

            detailRowItem.innerHTML = `
                <td class="date-cell">
                    <span class="date-day">${formatReadableDate(date.date)}</span>
                    <span class="date-dow">${dayOfWeek}</span>
                    ${date.isPaidLeave ? '<span class="leave-badge">Paid Leave</span>' : ''}
                    ${HOLIDAYS_2025[date.date] ?
                                `<span class="holiday-badge ${HOLIDAYS_2025[date.date].type}">${HOLIDAYS_2025[date.date].name}</span>` :
                                ''}
                </td>
                <td>${date.isPaidLeave ? '—' : (date.branch || 'N/A')}</td>
                <td>${date.isPaidLeave ? '—' : (date.shift || 'N/A')}</td>
                <td class="time-cell">
                    ${date.isPaidLeave ? '—' : (date.timeInPhoto ? photoThumbDeferredHtml(date.timeInPhoto, 'Clock-in') : '<div style="height: 8px;"></div>')}
                    ${date.isPaidLeave ? '—' : (date.timeIn ? formatTimeWithoutSeconds(date.timeIn) : 'N/A')}
                    ${date.isPaidLeave ? '' : punchLocationCellHtml(date.timeInLocation, date.branch, 'in')}
                </td>
                <td class="time-cell">
                    ${date.isPaidLeave ? '—' : (date.timeOutPhoto ? photoThumbDeferredHtml(date.timeOutPhoto, 'Clock-out') : '<div style="height: 8px;"></div>')}
                    ${date.isPaidLeave ? '—' : (date.timeOut ? formatTimeWithoutSeconds(date.timeOut) : 'N/A')}
                    ${date.isPaidLeave ? '' : punchLocationCellHtml(date.timeOutLocation, date.branch, 'out')}
                </td>
                <td>${date.isPaidLeave ? '—' : (date.scheduledIn && date.timeIn ?
                    (payCalculator.compareTimes(date.timeIn, date.scheduledIn) > 0 ?
                        (payCalculator.compareTimes(date.timeIn, date.scheduledIn) / 60).toFixed(1) :
                        '0.0') :
                    'N/A')}
                </td>
                ${showSalesBonus ? `<td>₱${dailySalesBonus.toFixed(2)}</td>` : ''}
                <td>₱${date.isPaidLeave || (date.timeIn && date.timeOut) ?
                    payCalculator.calculateDailyPay(date, employeeData, 'simple').toFixed(2) :
                    '0.00'}</td>
                <td class="action-cell">
                    <div class="action-buttons-container">
                        <button class="action-btn edit-shift-btn" data-date="${date.date}" data-employee="${employeeId}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                            Edit
                        </button>
                        <button class="action-btn duplicate-shift-btn" data-date="${date.date}" data-employee="${employeeId}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                            </svg>
                            Duplicate
                        </button>
                    </div>
                </td>
            `;

            detailTableBody.appendChild(detailRowItem);
        });

        const earningsLines = employeeData?.periodEarningsLines || [];
        appendPeriodEarningsRows(detailTableBody, earningsLines, showSalesBonus);

        // Replace loading indicator with table
        detailRow.querySelector('.detail-content').innerHTML = '';
        detailRow.querySelector('.detail-content').appendChild(detailTable);

        // Mark as loaded
        detailRow.dataset.loaded = 'true';

        scheduleDeferredThumbLoads(detailRow);

        // Add event listeners for edit shift buttons in detail rows
        detailRow.querySelectorAll('.edit-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                openEditShiftModal(employeeId, dateStr);
            });
        });

        // Add event listeners for duplicate shift buttons in detail rows
        detailRow.querySelectorAll('.duplicate-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                duplicateShift(employeeId, dateStr);
            });
        });

        detailRow.querySelectorAll('.delete-entry-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                deleteAttendanceEntry(employeeId, dateStr);
            });
        });

        detailRow.querySelectorAll('.edit-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                openEditShiftModal(employeeId, dateStr);
            });
        });

        document.querySelectorAll('.payment-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const row = this.closest('.expandable-row');
                const employeeId = row.dataset.employeeId;
                openPayMode(employeeId);
            });
        });

    } catch (error) {
        console.error("Error loading employee details:", error);
        detailRow.querySelector('.detail-content').innerHTML = '<div class="error-message">Failed to load details. Please try again.</div>';
    } finally {
        detailRow.querySelector('.detail-content')?.classList.remove('detail-content--loading-host');
    }
}

function guessShift(timeIn, timeOut) {
    if (!timeIn || !timeOut) return "Custom";

    // Convert times to minutes since midnight for easier comparison
    const [inTime, inMeridian] = timeIn.split(' ');
    const [inHours, inMinutes] = inTime.split(':').map(Number);
    const inTotalMinutes = (inMeridian === 'PM' && inHours !== 12 ? inHours + 12 : inHours % 12) * 60 + inMinutes;

    // Define shift start times in minutes
    const shifts = [
        { name: "Opening", start: 9 * 60 + 30 },      // 9:30 AM
        { name: "Adjusted Opening", start: 10 * 60 + 30 }, // 10:30 AM
        { name: "Midshift", start: 11 * 60 },         // 11:00 AM  
        { name: "Closing", start: 13 * 60 },          // 1:00 PM
        { name: "Closing Half-Day", start: 18 * 60 }  // 6:00 PM
    ];

    // Find the closest shift
    let closestShift = "Custom";
    let smallestDiff = Infinity;

    shifts.forEach(shift => {
        const diff = Math.abs(inTotalMinutes - shift.start);
        if (diff < smallestDiff) {
            smallestDiff = diff;
            closestShift = shift.name;
        }
    });

    // Only return the shift if it's within 60 minutes (reasonable tolerance)
    return smallestDiff <= 60 ? closestShift : "Custom";
}

// Add this new function to format time without seconds
function formatTimeWithoutSeconds(timeStr) {
    if (!timeStr) return 'N/A';

    // Split time into components
    const [time, meridian] = timeStr.split(' ');
    const [hours, minutes, seconds] = time.split(':');

    // Return without seconds
    return `${hours}:${minutes} ${meridian}`;
}

// Generate mock attendance data for testing
async function generateMockData() {
    const mockData = {};

    // Get period dates range
    const period = periodSelect.value;
    const { startDate, endDate } = getPeriodDates(period);
    const datesInRange = getDatesInRange(startDate, endDate);

    // Generate data for each employee
    Object.keys(employees).forEach(employeeId => {
        mockData[employeeId] = {
            id: employeeId,
            name: employees[employeeId],
            dates: []
        };

        // Add data for each date in the range
        datesInRange.forEach(date => {
            const dateObj = new Date(date);
            const dayOfWeek = dateObj.getDay();

            // Skip weekends (0 = Sunday, 6 = Saturday) or random days off
            if (dayOfWeek === 0 || dayOfWeek === 6 || Math.random() > 0.85) {
                return;
            }

            // Determine branch and shift
            const branch = getRandomBranch();
            const shift = getRandomShift();
            const schedule = SHIFT_SCHEDULES[shift];

            // Generate clock in time (potentially late)
            const isLate = Math.random() > 0.7;
            const lateMinutes = isLate ? Math.floor(Math.random() * 30) : 0;
            const timeIn = addMinutesToTime(schedule.timeIn, lateMinutes);

            // Generate clock out time (potentially early)
            const isEarlyOut = Math.random() > 0.8;
            const earlyMinutes = isEarlyOut ? Math.floor(Math.random() * 25) : 0;
            const timeOut = addMinutesToTime(schedule.timeOut, -earlyMinutes);

            // Add date entry
            mockData[employeeId].dates.push({
                date: date,
                branch: branch,
                shift: shift,
                scheduledIn: schedule.timeIn,
                scheduledOut: schedule.timeOut,
                timeIn: timeIn,
                timeOut: timeOut,
                timeInPhoto: `https://placehold.co/200x200/e0f7e5/333333?text=${employeeId.slice(-3)}+In`,
                timeOutPhoto: `https://placehold.co/200x200/ffe7e7/333333?text=${employeeId.slice(-3)}+Out`
            });
        });
    });

    return mockData;
}

// Helper function to get random branch
function getRandomBranch() {
    const branches = [
        "Podium",
        "SM North",
        "Pop-up",
        "Workshop",
        "Other Events"
    ];
    return branches[Math.floor(Math.random() * branches.length)];
}

// Helper function to get random shift
function getRandomShift() {
    const shifts = ["Opening", "Midshift", "Closing", "Closing Half-Day"];
    return shifts[Math.floor(Math.random() * shifts.length)];
}

// Helper function to add minutes to a time string
function addMinutesToTime(timeStr, minutes) {
    const [time, meridian] = timeStr.split(' ');
    let [hours, mins] = time.split(':').map(Number);

    // Convert to 24-hour format
    if (meridian === 'PM' && hours !== 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;

    // Add minutes
    const totalMinutes = hours * 60 + mins + minutes;
    let newHours = Math.floor(totalMinutes / 60) % 24;
    const newMins = totalMinutes % 60;

    // Convert back to 12-hour format
    const newMeridian = newHours >= 12 ? 'PM' : 'AM';
    newHours = newHours % 12 || 12;

    return `${newHours}:${newMins.toString().padStart(2, '0')} ${newMeridian}`;
}

// Open photo modal with the given photo URL
function openPhotoModal(photoUrl) {
    modalImage.src = photoUrl;
    photoModal.style.display = 'flex';
}

// Close photo modal
function closePhotoModal() {
    photoModal.style.display = 'none';
}

// Loading state management
let loadingState = 'idle'; // 'idle', 'initial', 'refreshing'

/** Updates viewport-centered payroll loading card (#payrollBlockingPanelHost). */
function setPayrollLoadingProgress(options = {}) {
    const {
        phase = 'Loading payroll data…',
        loaded = 0,
        total = 0,
        indeterminate = false
    } = options;

    const detailText = (() => {
        if (total <= 0) return '';
        if (indeterminate) {
            return `${total} employee${total === 1 ? '' : 's'} — please wait`;
        }
        return `${Math.min(loaded, total)} of ${total} employee${total === 1 ? '' : 's'}`;
    })();

    const host = document.getElementById('payrollBlockingPanelHost');
    if (!host) return;
    const msgEl = host.querySelector('.payroll-blocking-scrim__message');
    const detEl = host.querySelector('.payroll-blocking-scrim__detail');
    if (msgEl) msgEl.textContent = phase;
    if (detEl) detEl.textContent = detailText;
}

function showLoading(message = 'Loading data...', options = {}) {
    if (loadingState === 'idle') {
        loadingState = 'initial';
    }

    if (options.fullPageBlocking) {
        const showMobile = isMobileLayout();
        ['payrollTableBlockingScrim', 'payrollMobileBlockingScrim'].forEach((id) => {
            const scrim = document.getElementById(id);
            if (!scrim) return;
            const visible = id === 'payrollMobileBlockingScrim' ? showMobile : !showMobile;
            /* block — not flex — so nothing recenters inside the growing table wrapper */
            scrim.style.display = visible ? 'block' : 'none';
            scrim.setAttribute('aria-hidden', visible ? 'false' : 'true');
        });
        const panelHost = document.getElementById('payrollBlockingPanelHost');
        if (panelHost) {
            panelHost.style.display = 'flex';
            panelHost.setAttribute('aria-hidden', 'false');
            const msg = panelHost.querySelector('.payroll-blocking-scrim__message');
            if (msg) msg.textContent = message;
            const det = panelHost.querySelector('.payroll-blocking-scrim__detail');
            if (det) det.textContent = '';
        }
        loadingOverlay.style.display = 'none';
        if (mobileLoadingOverlay) {
            mobileLoadingOverlay.style.display = 'none';
            mobileLoadingOverlay.setAttribute('aria-hidden', 'true');
        }
        return;
    }

    if (isMobileLayout() && mobileLoadingOverlay) {
        loadingOverlay.style.display = 'none';
        mobileLoadingOverlay.style.display = 'flex';
        mobileLoadingOverlay.setAttribute('aria-hidden', 'false');
        const msg = mobileLoadingOverlay.querySelector('.loading-message');
        if (msg) msg.textContent = message;
    } else {
        if (mobileLoadingOverlay) mobileLoadingOverlay.style.display = 'none';
        loadingOverlay.style.display = 'flex';
        let loadingMessage = loadingOverlay.querySelector('.loading-message');
        if (!loadingMessage) {
            loadingMessage = document.createElement('div');
            loadingMessage.className = 'loading-message';
            loadingOverlay.appendChild(loadingMessage);
        }
        loadingMessage.textContent = message;
    }
}

function hideLoading() {
    loadingState = 'idle';
    ['payrollTableBlockingScrim', 'payrollMobileBlockingScrim'].forEach((id) => {
        const scrim = document.getElementById(id);
        if (scrim) {
            scrim.style.display = 'none';
            scrim.setAttribute('aria-hidden', 'true');
        }
    });
    const panelHost = document.getElementById('payrollBlockingPanelHost');
    if (panelHost) {
        panelHost.style.display = 'none';
        panelHost.setAttribute('aria-hidden', 'true');
    }
    loadingOverlay.style.display = 'none';
    if (mobileLoadingOverlay) {
        mobileLoadingOverlay.style.display = 'none';
        mobileLoadingOverlay.setAttribute('aria-hidden', 'true');
    }
}

function openPeriodSelectModal() {
    if (!periodSelectModal || !periodSelectModalList || !window.payrollPeriods) return;
    periodSelectModalList.innerHTML = '';
    window.payrollPeriods.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.label;
        li.dataset.periodId = p.id;
        li.setAttribute('role', 'option');
        li.tabIndex = 0;
        li.addEventListener('click', function () {
            const id = this.dataset.periodId;
            periodSelect.value = id;
            closePeriodSelectModal();
            loadData(id);
        });
        periodSelectModalList.appendChild(li);
    });
    periodSelectModal.style.display = 'flex';
    periodSelectModal.setAttribute('aria-hidden', 'false');
}

function closePeriodSelectModal() {
    if (periodSelectModal) {
        periodSelectModal.style.display = 'none';
        periodSelectModal.setAttribute('aria-hidden', 'true');
    }
}

function formatReadableDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

function getPeriodDates(periodId) {
    const fromId = getPeriodDatesFromId(periodId);
    if (!window.payrollPeriods || !Array.isArray(window.payrollPeriods) || window.payrollPeriods.length === 0) {
        console.warn("Payroll periods not initialized.");
        if (fromId) return fromId;
        const today = new Date();
        return {
            startDate: new Date(today.getFullYear(), today.getMonth(), 1),
            endDate: new Date(today.getFullYear(), today.getMonth() + 1, 0)
        };
    }

    const found = window.payrollPeriods.find(p => p.id === periodId);

    if (!found) {
        if (fromId) {
            return fromId;
        }
        console.warn(`Period ${periodId} not found, using first available period`);
        const fallback = window.payrollPeriods[0];
        return {
            startDate: fallback.start,
            endDate: fallback.end
        };
    }

    return {
        startDate: found.start,
        endDate: found.end
    };
}

// Helper function to get all dates in a range
function getDatesInRange(startDate, endDate) {
    const dates = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        dates.push(formatDate(new Date(currentDate)));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
}

function calculateHours(timeInStr, timeOutStr) {
    try {
        // Parse time strings
        const [timeIn, meridianIn] = timeInStr.split(' ');
        const [hoursIn, minutesIn] = timeIn.split(':').map(Number);

        const [timeOut, meridianOut] = timeOutStr.split(' ');
        const [hoursOut, minutesOut] = timeOut.split(':').map(Number);

        // Convert to 24-hour format
        let hours24In = hoursIn;
        if (meridianIn === 'PM' && hoursIn !== 12) hours24In += 12;
        if (meridianIn === 'AM' && hoursIn === 12) hours24In = 0;

        let hours24Out = hoursOut;
        if (meridianOut === 'PM' && hoursOut !== 12) hours24Out += 12;
        if (meridianOut === 'AM' && hoursOut === 12) hours24Out = 0;

        // Calculate difference in minutes
        const totalMinutesIn = hours24In * 60 + minutesIn;
        const totalMinutesOut = hours24Out * 60 + minutesOut;

        let minutesDiff = totalMinutesOut - totalMinutesIn;

        // Handle midnight crossover
        if (minutesDiff < 0) {
            // For your specific case: 12:38 PM to 2:00 AM
            // This is clearly a next-day scenario
            minutesDiff += 24 * 60;
        }

        // Prevent unreasonably long shifts (over 20 hours)
        const calculatedHours = minutesDiff / 60;
        if (calculatedHours > 20) {
            console.warn("Shift duration exceeds 20 hours - possible data error");
            return null;
        }

        return calculatedHours;
    } catch (error) {
        console.error("Error calculating hours:", error);
        return null;
    }
}

// Helper function to compare times and return difference in minutes
function compareTimes(t1, t2) {
    const [time1, meridian1] = t1.split(' ');
    const [hour1, min1] = time1.split(':').map(Number);
    const minutes1 = (meridian1 === "PM" && hour1 !== 12 ? hour1 + 12 : hour1 % 12) * 60 + min1;

    const [time2, meridian2] = t2.split(' ');
    const [hour2, min2] = time2.split(':').map(Number);
    const minutes2 = (meridian2 === "PM" && hour2 !== 12 ? hour2 + 12 : hour2 % 12) * 60 + min2;

    return minutes1 - minutes2; // > 0 means late
}

// Helper function to get branch name from branch ID (category label for UI)
function getBranchName(branchId) {
    const branchMap = {
        'podium': 'Podium',
        'smnorth': 'SM North',
        'popup': 'Pop-up',
        'workshop': 'Workshop',
        'other': 'Other Events'
    };

    return branchMap[branchId] || getBranchDisplayName(branchId) || 'All Branches';
}

// Export data to CSV
function exportToCSV() {
    // Show loading overlay during export
    showLoading();

    // Load JSZip library if not already available
    if (typeof JSZip === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = createZipArchive;
        document.head.appendChild(script);
    } else {
        createZipArchive();
    }
}

// Payroll CSV Export
function exportPayrollCSV() {
    showLoading('Generating payroll export...');

    try {
        const period = periodSelect.value;
        const { startDate, endDate } = getPeriodDates(period);
        const periodText = periodSelect.options[periodSelect.selectedIndex].text;

        let csv = 'Employee ID,Employee Name,Nickname,Base Rate,Days Worked,Regular Days,Holiday Days,Total Hours,Base Pay,Meal Allowance,Transportation Allowance,Sales Bonus,Gross Pay,Late Deductions (info only),Net Pay,Sales Bonus Eligible\n';
        
        // Get filtered employees (active only if toggle is checked)
        let employeesToExport;
        if (activeOnlyToggle.checked) {
            const periodId = periodSelect.value;
            employeesToExport = Object.entries(filteredData).filter(([_, employee]) =>
                employeeHasRosterPayActivity(employee, periodId)
            );
        } else {
            employeesToExport = Object.entries(filteredData);
        }

        // Process each employee
        employeesToExport.forEach(([employeeId, employee]) => {
            const employeeName = employees[employeeId] || 'Unknown Employee';
            const nickname = employee.nickname || generateDefaultNickname(employeeName);
            const baseRate = employee.baseRate || 0;
            const salesBonusEligible = employee.salesBonusEligible ? 'Yes' : 'No';

            // Use PayCalculator for accurate breakdown
            const totalResult = calcTotalPayDetailed(employee.dates, employee, periodSelect.value);
            const totalPayWithBonus = totalResult.total;

            // Extract components from breakdown
            let totalDays = 0;
            let regularDays = 0;
            let holidayDays = 0;
            let totalHours = 0;
            let mealAllowance = 0;
            let transportationAllowance = 0;
            let lateDeductions = 0;
            let totalSalesBonus = 0;

            employee.dates.forEach(dateObj => {
                if (dateObj.timeIn && dateObj.timeOut) {
                    totalDays++;

                    const dateStr = dateObj.date;
                    const isHoliday = HOLIDAYS_2025[dateStr];

                    if (isHoliday) {
                        holidayDays++;
                    } else {
                        regularDays++;
                    }

                    const actualHours = payCalculator.calculateHours(dateObj.timeIn, dateObj.timeOut);
                    if (actualHours) {
                        totalHours += actualHours;
                    }

                    // Get detailed breakdown for this day
                    const dailyResult = payCalculator.calculateDailyPay(dateObj, employee, 'detailed');

                    // Extract components
                    dailyResult.breakdown.components.forEach(component => {
                        switch (component.type) {
                            case 'meal_allowance':
                                mealAllowance += component.amount;
                                break;
                            case 'transportation_allowance':
                                transportationAllowance += component.amount;
                                break;
                            case 'sales_bonus':
                                totalSalesBonus += component.amount;
                                break;
                            case 'late_deduction':
                            case 'undertime_deduction':
                                if (!component.isPositive) {
                                    lateDeductions += component.amount;
                                }
                                break;
                        }
                    });
                }
            });

            // Calculate base pay (total minus allowances and bonuses)
            const basePay = totalPayWithBonus - mealAllowance - transportationAllowance - totalSalesBonus;
            const grossPay = totalPayWithBonus;
            const netPay = grossPay;

            // Add row to CSV
            csv += `${employeeId},"${employeeName}","${nickname}",${baseRate.toFixed(2)},${totalDays},${regularDays},${holidayDays},${totalHours.toFixed(1)},${basePay.toFixed(2)},${mealAllowance.toFixed(2)},${transportationAllowance.toFixed(2)},${totalSalesBonus.toFixed(2)},${grossPay.toFixed(2)},${lateDeductions.toFixed(2)},${netPay.toFixed(2)},${salesBonusEligible}\n`;
        });

        // Create download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `payroll_summary_${periodText.replace(/\s+/g, '_')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log('Payroll CSV export completed');
    } catch (error) {
        console.error('Error generating payroll export:', error);
        alert('Failed to generate payroll export. Please try again.');
    } finally {
        hideLoading();
    }
}

function showExportProgress(message) {
    // Check if the progress element already exists
    let progressDiv = document.getElementById('exportProgress');

    if (!progressDiv) {
        progressDiv = document.createElement('div');
        progressDiv.id = 'exportProgress';
        progressDiv.className = 'export-progress';
        progressDiv.innerHTML = `
            <div class="progress-message">Preparing export...</div>
            <div class="progress-spinner"></div>
        `;
        document.body.appendChild(progressDiv);
    }

    if (message) {
        progressDiv.querySelector('.progress-message').textContent = message;
    }

    progressDiv.style.display = 'flex';
}

// Add this function to hide the progress
function hideExportProgress() {
    const progressDiv = document.getElementById('exportProgress');
    if (progressDiv) {
        progressDiv.style.display = 'none';
    }
}

async function createZipArchive() {
    showExportProgress("Preparing export files...");
    try {
        const zip = new JSZip();
        const photoFolder = zip.folder("photos");

        // Get the selected period name for the filename
        const periodText = periodSelect.options[periodSelect.selectedIndex].text;
        const branchText = branchSelect.options[branchSelect.selectedIndex].text;
        const filenameBase = `attendance_${periodText.replace(/\s+/g, '_')}_${branchText.replace(/\s+/g, '_')}`;

        // Build CSV header
        let csv = 'Employee ID,Employee Name,Base Rate,Total Pay,Branch,Date,Shift,Clock In,Clock Out,Hours,Status,Clock In Photo,Clock Out Photo\n';

        // Track photo promises
        const photoPromises = [];
        const photoMap = {};

        // Loop through each employee
        Object.entries(filteredData).forEach(([employeeId, employee]) => {
            const employeeName = employees[employeeId] || `Employee ${employeeId}`;

            // Loop through each date
            employee.dates.forEach((date, index) => {
                const dateObj = new Date(date.date);
                const formattedDate = formatDate(dateObj);

                // Calculate hours
                const hours = date.timeIn && date.timeOut ? payCalculator.calculateHours(date.timeIn, date.timeOut) : 0;

                // Determine status
                let status = 'Absent';
                if (date.timeIn && date.timeOut) {
                    if (date.scheduledIn && payCalculator.compareTimes(date.timeIn, date.scheduledIn) > 0) {
                        status = 'Late';
                    } else if (date.scheduledOut && payCalculator.getUndertimeMinutes(date.timeIn, date.timeOut, date.scheduledIn, date.scheduledOut) > 0) {
                        status = 'Early Out';
                    } else {
                        status = 'Present';
                    }
                }

                // Handle Clock In Photo
                let timeInPhotoFilename = 'N/A';
                if (date.timeInPhoto) {
                    timeInPhotoFilename = `${employeeId}_${formattedDate}_in.jpg`;
                    photoMap[timeInPhotoFilename] = date.timeInPhoto;

                    // Add promise to fetch the photo
                    photoPromises.push(
                        fetch(date.timeInPhoto)
                            .then(response => response.blob())
                            .then(blob => {
                                photoFolder.file(timeInPhotoFilename, blob);
                            })
                            .catch(error => {
                                console.error(`Failed to fetch photo ${date.timeInPhoto}:`, error);
                            })
                    );
                }

                // Handle Clock Out Photo
                let timeOutPhotoFilename = 'N/A';
                if (date.timeOutPhoto) {
                    timeOutPhotoFilename = `${employeeId}_${formattedDate}_out.jpg`;
                    photoMap[timeOutPhotoFilename] = date.timeOutPhoto;

                    // Add promise to fetch the photo
                    photoPromises.push(
                        fetch(date.timeOutPhoto)
                            .then(response => response.blob())
                            .then(blob => {
                                photoFolder.file(timeOutPhotoFilename, blob);
                            })
                            .catch(error => {
                                console.error(`Failed to fetch photo ${date.timeOutPhoto}:`, error);
                            })
                    );
                }

                // Add row to CSV
                csv += `${employeeId},${employeeName},${employee.baseRate || 0},${calcTotalPaySimple(employee.dates, employee, periodSelect.value).toFixed(2)},${date.branch || 'N/A'},${formattedDate},${date.shift || 'N/A'},${date.timeIn || 'N/A'},${date.timeOut || 'N/A'},${hours ? hours.toFixed(1) : 0},${status},${timeInPhotoFilename},${timeOutPhotoFilename}\n`;
            });
        });

        // Add CSV file to zip
        zip.file(`${filenameBase}.csv`, csv);

        // Add a JSON export with all data
        zip.file(`${filenameBase}.json`, JSON.stringify(filteredData, null, 2));

        showExportProgress(`Downloading ${photoPromises.length} photos...`);

        // Wait for all photo fetches to complete
        await Promise.all(photoPromises);

        showExportProgress("Generating ZIP file...");

        // Generate the zip file
        const content = await zip.generateAsync({ type: 'blob' });

        // Create download link
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${filenameBase}.zip`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        hideExportProgress();
        hideLoading();
    } catch (error) {
        console.error("Error generating export:", error);
        alert("Failed to generate export. Please try again.");

        hideExportProgress();
        hideLoading();
    }
}

// Export current person's payroll to CSV
function exportPersonPayroll(employeeId) {
    if (!employeeId) {
        alert('No employee selected');
        return;
    }

    try {
        const employee = filteredData[employeeId];
        if (!employee) {
            alert('Employee data not found');
            return;
        }

        const employeeName = employees[employeeId] || 'Unknown Employee';
        const period = periodSelect.value;
        const { startDate, endDate } = getPeriodDates(period);
        const periodText = periodSelect.options[periodSelect.selectedIndex].text;

        // Generate all dates in the period range
        const allDates = getDatesInRange(startDate, endDate);
        
        // Create CSV header - only include fields that can be edited per shift
        let csv = 'Date,Day of Week,Branch,Shift,Time In,Time Out,Hours Worked,OT Pay,Double Pay,Fixed Pay,Fixed Amount,Meal Allowance,Transportation Allowance,Notes\n';
        
        // Process each date in the period
        allDates.forEach(dateStr => {
            const dateObj = new Date(dateStr);
            const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            
            // Find existing data for this date
            const existingData = employee.dates.find(d => d.date === dateStr);
            
            if (existingData && existingData.timeIn && existingData.timeOut) {
                // Has data - include editable fields
                const hours = payCalculator.calculateHours(existingData.timeIn, existingData.timeOut) || 0;
                
                csv += `${dateStr},${dayOfWeek},${existingData.branch || 'N/A'},${existingData.shift || 'N/A'},${existingData.timeIn || ''},${existingData.timeOut || ''},${hours.toFixed(1)},${existingData.hasOTPay ? 'Yes' : 'No'},${existingData.hasDoublePay ? 'Yes' : 'No'},${existingData.hasFixedPay ? 'Yes' : 'No'},${existingData.fixedPayAmount || 0},${existingData.hasMealAllowance ? 'Yes' : 'No'},${existingData.transpoAllowance || 0},${existingData.notes || ''}\n`;
            } else {
                // No data - include placeholder row with empty values
                csv += `${dateStr},${dayOfWeek},,,,,,No,No,No,0,No,0,No attendance recorded\n`;
            }
        });
        
        // Create download link
        const filename = `${employeeName.replace(/[^a-zA-Z0-9]/g, '_')}_Payroll_${periodText.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`Exported payroll for ${employeeName}`);
    } catch (error) {
        console.error("Error exporting person payroll:", error);
        alert("Failed to export payroll. Please try again.");
    }
}

// Open import payroll modal
function openImportPayrollModal(employeeId) {
    if (!employeeId) {
        alert('No employee selected');
        return;
    }

    // Create modal HTML
    const modalHTML = `
        <div class="modal" id="importPayrollModal" style="display: flex;">
            <div class="modal-content">
                <span class="close-modal" id="closeImportPayrollModal">&times;</span>
                <h2>Import Payroll Data for ${employees[employeeId] || 'Employee'}</h2>
                <p>Upload a CSV file with payroll data. The CSV should have columns: Date, Branch, Shift, Time In, Time Out, OT Pay, Double Pay, Fixed Pay, Fixed Amount, Meal Allowance, Transportation Allowance, Notes (optional)</p>
                <p><strong>Date format:</strong> YYYY-MM-DD (e.g., 2025-01-15)</p>
                <p><strong>Time format:</strong> HH:MM AM/PM (e.g., 9:30 AM, 6:30 PM)</p>
                <p><strong>Shift options:</strong> Opening, Adjusted Opening, Opening Half-Day, Midshift, Closing, Closing Half-Day, Custom</p>
                <p><strong>Note:</strong> You can import data for any date - it doesn't need to be within the current payroll period!</p>
                
                <div class="form-group">
                    <button type="button" class="btn btn-info" id="downloadTemplate">Download CSV Template</button>
                </div>
                
                <form id="importPayrollForm">
                    <div class="form-group">
                        <label for="importPayrollFile">Select CSV File</label>
                        <input type="file" id="importPayrollFile" accept=".csv" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="importPayrollOverwrite">
                            <input type="checkbox" id="importPayrollOverwrite">
                            Overwrite existing data for matching dates
                        </label>
                    </div>
                    
                    <div class="form-group">
                        <button type="submit" class="btn btn-primary">Import Payroll Data</button>
                        <button type="button" class="btn btn-secondary" id="cancelImportPayroll">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
            // Get modal elements
        const modal = document.getElementById('importPayrollModal');
        const closeBtn = document.getElementById('closeImportPayrollModal');
        const cancelBtn = document.getElementById('cancelImportPayrollModal');
        const form = document.getElementById('importPayrollForm');
        
        // Close modal function
        const closeModal = () => {
            modal.remove();
        };
        
        // Event listeners
        closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeModal);
        }
    
    // Template download button
    const templateBtn = document.getElementById('downloadTemplate');
    templateBtn.addEventListener('click', () => downloadCSVTemplate(employeeId));
    
    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const file = document.getElementById('importPayrollFile').files[0];
        const overwrite = document.getElementById('importPayrollOverwrite').checked;
        
        if (!file) {
            alert('Please select a CSV file');
            return;
        }
        
        // Check file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('File too large. Please select a file smaller than 5MB.');
            return;
        }
        
        // Check file type
        if (!file.name.toLowerCase().endsWith('.csv')) {
            alert('Please select a valid CSV file.');
            return;
        }
        
        try {
            await importPersonPayroll(employeeId, file, overwrite);
            closeModal();
        } catch (error) {
            console.error('Import failed:', error);
            alert('Import failed: ' + error.message);
        }
    });
}

// Download CSV template for payroll import
function downloadCSVTemplate(employeeId) {
    try {
        const employeeName = employees[employeeId] || 'Employee';
        
        // Create template CSV with sample data
        let csv = 'Date,Branch,Shift,Time In,Time Out,OT Pay,Double Pay,Fixed Pay,Fixed Amount,Meal Allowance,Transportation Allowance,Notes\n';
        csv += '2025-01-15,Podium,Opening,9:30 AM,6:30 PM,No,No,No,0,Yes,100,Regular shift\n';
        csv += '2025-01-16,SM North,Closing,1:00 PM,10:00 PM,Yes,No,No,0,Yes,100,Closing shift with OT\n';
        csv += '2025-01-17,Pop-up,Midshift,11:00 AM,8:00 PM,No,Yes,No,0,Yes,100,Event day with double pay\n';
        csv += '2025-01-18,,,,,No,No,No,0,No,0,\n'; // Empty row to show format
        
        // Create download link
        const filename = `${employeeName.replace(/[^a-zA-Z0-9]/g, '_')}_Payroll_Template.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`Template downloaded for ${employeeName}`);
    } catch (error) {
        console.error("Error downloading template:", error);
        alert("Failed to download template. Please try again.");
    }
}

// Import person's payroll from CSV
async function importPersonPayroll(employeeId, file, overwrite = false) {
    try {
        showLoading('Importing payroll data...');
        
        const text = await file.text();
        console.log('Raw CSV text:', text.substring(0, 500) + '...'); // Debug first 500 chars
        
        const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));
        console.log('Parsed rows:', rows.slice(0, 3)); // Debug first 3 rows
        
        // Skip header row
        const dataRows = rows.slice(1);
        console.log('Data rows count:', dataRows.length);
        
        let importedCount = 0;
        let skippedCount = 0;
        let errors = [];
        
        // Process each row
        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            console.log(`Row ${i + 1} has ${row.length} columns:`, row);
            
            if (row.length < 5 || !row[0]) {
                console.log(`Skipping row ${i + 1}: insufficient columns or empty date`);
                continue;
            }
            
            // Show progress every 10 rows
            if (i % 10 === 0) {
                showLoading(`Importing payroll data... ${i}/${dataRows.length} rows processed`);
            }
            
            // Parse all columns including the new fields - handle variable column counts
            const dateStr = row[0] || '';
            const branch = row[1] || '';
            const shift = row[2] || '';
            const timeIn = row[3] || '';
            const timeOut = row[4] || '';
            const otPay = row[5] || '';
            const doublePay = row[6] || '';
            const fixedPay = row[7] || '';
            const fixedAmount = row[8] || '';
            const mealAllowance = row[9] || '';
            const transpoAllowance = row[10] || '';
            const notes = row[11] || '';
            
            console.log(`Processing row ${i + 1}:`, { dateStr, branch, shift, timeIn, timeOut, otPay, doublePay, fixedPay, fixedAmount, mealAllowance, transpoAllowance, notes });
            
            // Validate date
            const dateObj = new Date(dateStr);
            if (isNaN(dateObj.getTime())) {
                errors.push(`Invalid date: ${dateStr}`);
                continue;
            }
            
            // Validate time format (HH:MM AM/PM or HH:MM) - only if time is provided
            const timeRegex = /^(\d{1,2}):(\d{2})\s?(AM|PM)?$/i;
            if (timeIn && !timeRegex.test(timeIn)) {
                errors.push(`Invalid time format for Time In: ${timeIn} (use HH:MM AM/PM format)`);
                continue;
            }
            if (timeOut && !timeRegex.test(timeOut)) {
                errors.push(`Invalid time format for Time Out: ${timeOut} (use HH:MM AM/PM format)`);
                continue;
            }
            
            // Validate shift (optional but if provided, should be valid)
            if (shift && !['Opening', 'Adjusted Opening', 'Opening Half-Day', 'Midshift', 'Closing', 'Closing Half-Day', 'Custom'].includes(shift)) {
                console.warn(`Unknown shift type: ${shift}, using Custom`);
                shift = 'Custom';
            }
            
            // Check if data already exists for this date
            const existingData = attendanceData[employeeId]?.dates?.find(d => d.date === dateStr);
            if (existingData && !overwrite) {
                skippedCount++;
                continue;
            }
            
            // Prepare data for Firebase
            const firebaseData = {
                clockIn: {
                    time: timeIn || null,
                    branch: branch || 'N/A',
                    shift: shift || 'Custom'
                },
                clockOut: {
                    time: timeOut || null
                }
            };
            
            // Parse boolean fields
            firebaseData.hasOTPay = otPay && otPay.toLowerCase() === 'yes';
            firebaseData.hasDoublePay = doublePay && doublePay.toLowerCase() === 'yes';
            firebaseData.hasFixedPay = fixedPay && fixedPay.toLowerCase() === 'yes';
            firebaseData.hasMealAllowance = mealAllowance && mealAllowance.toLowerCase() === 'yes';
            
            // Parse numeric fields
            if (fixedAmount && !isNaN(parseFloat(fixedAmount))) {
                firebaseData.fixedPayAmount = parseFloat(fixedAmount);
            }
            if (transpoAllowance && !isNaN(parseFloat(transpoAllowance))) {
                firebaseData.transpoAllowance = parseFloat(transpoAllowance);
            }
            
            // Save data even if no time is provided (for updating other fields like OT, allowances, etc.)
            // This allows importing just the configuration without time data
            
            // Add notes if provided
            if (notes) {
                firebaseData.notes = notes;
            }
            
            // Save to Firebase
            const docRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);
            await setDoc(docRef, firebaseData, { merge: true });
            
            console.log(`Successfully saved data for ${dateStr}:`, firebaseData);
            importedCount++;
        }
        
        // Refresh data
        await loadData();
        
        // Show results
        let message = `Import completed!\n\nImported: ${importedCount} records`;
        if (skippedCount > 0) {
            message += `\nSkipped: ${skippedCount} records (already exist)`;
        }
        if (errors.length > 0) {
            message += `\nErrors: ${errors.length}`;
            console.error('Import errors:', errors);
        }
        
        if (importedCount > 0) {
            message += `\n\nData has been saved to Firebase and the view will refresh automatically.`;
        } else {
            message += `\n\nNo records were imported. Check the console for debugging information.`;
        }
        
        console.log('Import summary:', { importedCount, skippedCount, errors: errors.length, totalRows: dataRows.length });
        alert(message);
        
    } catch (error) {
        console.error("Error importing payroll:", error);
        throw new Error('Failed to import payroll data: ' + error.message);
    } finally {
        hideLoading();
    }
}

function updateViewMode() {
    console.log('updateViewMode called, currentEmployeeView:', currentEmployeeView);
    
    // Prevent multiple simultaneous executions
    if (isUpdateViewModeRunning) {
        console.log('updateViewMode already running, skipping...');
        return;
    }
    
    // Debounce multiple rapid calls
    if (updateViewModeTimeout) {
        clearTimeout(updateViewModeTimeout);
    }
    
    updateViewModeTimeout = setTimeout(() => {
        console.log('updateViewMode timeout fired, calling updateViewModeImpl');
        updateViewModeImpl();
    }, 100);
}

function updateViewModeImpl() {
    isUpdateViewModeRunning = true;
    console.log('updateViewModeImpl called, currentEmployeeView:', currentEmployeeView);
    console.log('isUpdateViewModeRunning set to true');
    const container = document.querySelector('.container');

    // Get the table container and employee table elements
    const tableContainer = document.querySelector('.data-table-container');
    const employeeTable = document.getElementById('employeeTable');

    if (currentEmployeeView) {
        console.log('Single employee view logic reached');
        // Single employee view - restructure the page
        const employeeName = employees[currentEmployeeView] || 'Employee';
        const employee = filteredData[currentEmployeeView];
        console.log('Employee data found:', employee);

        // Remove any existing employee heading first
        const existingHeading = document.getElementById('employee-view-heading');
        if (existingHeading) {
            existingHeading.remove();
        }

        const employeeNameHeading = document.createElement('h2');
        employeeNameHeading.id = 'employee-view-heading';
        employeeNameHeading.className = 'employee-view-heading';
        employeeNameHeading.textContent = employees[currentEmployeeView] || 'Employee';

        // 1. Update page title
        // document.querySelector('.app-title').textContent = `${employeeName} - Attendance`;

        // Make logo/title clickable in employee view
        const logoSection = document.querySelector('.logo-section');
        logoSection.style.cursor = 'pointer';
        logoSection.addEventListener('click', function () {
            // Return to main view
            currentEmployeeView = null;
            updateURLHash(null);
            updateViewMode(); // This will properly switch back to main view
        });

        // Create edit button for single employee view
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit Employee
        `;
                editBtn.addEventListener('click', function () {
                    openEditEmployeeModal(currentEmployeeView);
                });

                // Create batch edit button for single employee view
                const batchEditBtn = document.createElement('button');
                batchEditBtn.className = 'edit-btn batch-edit-period-btn';
                batchEditBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
            Batch Edit Period
        `;
        batchEditBtn.addEventListener('click', function () {
            openBatchEditModal(currentEmployeeView);
        });

        // Create add shift button for single employee view
        const addShiftBtn = document.createElement('button');
        addShiftBtn.className = 'edit-btn';
        addShiftBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
            </svg>
            Add Shift
        `;
        addShiftBtn.addEventListener('click', function () {
            openAddShiftModal(currentEmployeeView);
        });

        // Hide the main view buttons in employee view
        document.getElementById('addEmployeeBtn').style.display = 'none';
        const peBtn = document.getElementById('periodEarningsBtn');
        if (peBtn) peBtn.style.display = 'none';
        document.querySelector('.push-holidays-btn').style.display = 'none';

        const paymentBtn = document.createElement('button');
        paymentBtn.className = 'edit-btn payment-period-btn';
        paymentBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
            Pay
        `;
        paymentBtn.addEventListener('click', function () {
            openPayMode(currentEmployeeView);
        });

        const periodIdForActions = periodSelect.value;
        const totalPayForActions = employee
            ? getEmployeeTotalPayForTable(employee, periodIdForActions)
            : 0;
        const empPaymentForActions = (window.paymentStatus || {})[currentEmployeeView];
        const balForActions = getPaymentBalance(totalPayForActions, empPaymentForActions);
        const statusKindForActions = getPaymentStatusKind(balForActions);
        const { endDate: periodEndForActions } = getPeriodDates(periodIdForActions);
        const showPayInView = new Date() > periodEndForActions
            && (statusKindForActions === 'unpaid' || statusKindForActions === 'partial');
        const showSurplusAdjustInView = new Date() > periodEndForActions && statusKindForActions === 'surplus';

        let adjustSurplusViewBtn = null;
        if (showSurplusAdjustInView) {
            adjustSurplusViewBtn = document.createElement('button');
            adjustSurplusViewBtn.type = 'button';
            adjustSurplusViewBtn.className = 'edit-btn adjust-surplus-btn';
            adjustSurplusViewBtn.textContent = 'Adjust surplus';
            adjustSurplusViewBtn.addEventListener('click', function () {
                openAdjustSurplusModal(currentEmployeeView);
            });
        }

        // Add the employee name heading first
        const summaryCards = document.querySelector('.summary-cards');
        container.insertBefore(employeeNameHeading, summaryCards);

        // Remove any existing action buttons first to prevent duplication
        const existingActionButtons = document.querySelectorAll('.edit-btn');
        existingActionButtons.forEach(btn => btn.remove());

        // Create a container for all action buttons to prevent duplication
        const actionButtonsContainer = document.createElement('div');
        actionButtonsContainer.className = 'employee-action-buttons';
        actionButtonsContainer.style.cssText = 'margin: 1rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap;';

        // Add all buttons to the container
        actionButtonsContainer.appendChild(editBtn);
        actionButtonsContainer.appendChild(batchEditBtn);
        actionButtonsContainer.appendChild(addShiftBtn);
        if (showPayInView) actionButtonsContainer.appendChild(paymentBtn);
        if (adjustSurplusViewBtn) actionButtonsContainer.appendChild(adjustSurplusViewBtn);

        const payslipBtn = document.createElement('button');
        payslipBtn.className = 'edit-btn download-payslip-admin-btn';
        payslipBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download Payslip
        `;
        payslipBtn.addEventListener('click', () => generateAdminEmployeePayslipPDF(currentEmployeeView, payslipBtn));
        actionButtonsContainer.appendChild(payslipBtn);

        // Add the container after the heading
        employeeNameHeading.insertAdjacentElement('afterend', actionButtonsContainer);

        // Add import/export buttons for payroll data
        const importExportContainer = document.createElement('div');
        importExportContainer.className = 'import-export-container';
        importExportContainer.style.cssText = 'margin: 1rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap;';

        // Export current person's payroll button
        const exportPersonBtn = document.createElement('button');
        exportPersonBtn.className = 'edit-btn export-person-btn';
        exportPersonBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7,10 12,15 17,10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Export Payroll
        `;
        exportPersonBtn.addEventListener('click', () => exportPersonPayroll(currentEmployeeView));

        // Import payroll button
        const importPersonBtn = document.createElement('button');
        importPersonBtn.className = 'edit-btn import-person-btn';
        importPersonBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17,8 12,3 7,8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Import Payroll
        `;
        importPersonBtn.addEventListener('click', () => openImportPayrollModal(currentEmployeeView));

        // Add buttons to container
        importExportContainer.appendChild(exportPersonBtn);
        importExportContainer.appendChild(importPersonBtn);

        // Add the import/export container after the action buttons
        actionButtonsContainer.insertAdjacentElement('afterend', importExportContainer);

        // 3. Update summary cards with employee-specific info
        if (employee) {
            // Hide the standard summary cards
            document.querySelector('.summary-cards').style.display = 'none';

            // Create employee-specific cards
            const employeeCards = createEmployeeSpecificSummaryCards(currentEmployeeView);
            if (employeeCards) {
                // Check if we already created employee cards
                let existingCards = document.querySelector('.employee-view-cards');
                if (existingCards) {
                    existingCards.outerHTML = employeeCards;
                } else {
                    // Insert after the employee name heading
                    employeeNameHeading.insertAdjacentHTML('afterend', employeeCards);
                }
            }

            // Fourth card: Update to show this employee's pay
            const totalPayCard = document.getElementById('totalPayroll');
            totalPayCard.textContent = `₱${calcTotalPaySimple(employee.dates, employee, periodSelect.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;    
        }

        // 4. Hide the main employee table and mobile cards (single-employee view)
        employeeTable.style.display = 'none';
        if (employeeCardsMobileEl) employeeCardsMobileEl.style.display = 'none';

        // 5. Load the employee details and make them the main table
        let detailsTable = document.getElementById('employee-details-table');
        if (!detailsTable) {
            const detailsContainer = document.createElement('div');
            detailsContainer.id = 'employee-details-table';
            tableContainer.appendChild(detailsContainer);
            console.log('About to call loadEmployeeDetailsAsMainTable for:', currentEmployeeView);
            loadEmployeeDetailsAsMainTable(currentEmployeeView, detailsContainer);
        } else {
            loadEmployeeDetailsAsMainTable(currentEmployeeView, detailsTable);
        }
    } else {
        // All employees view - restore original view
        // document.querySelector('.app-title').textContent = 'Admin Dashboard';
        // Remove employee heading
        const employeeHeading = document.getElementById('employee-view-heading');
        if (employeeHeading) {
            employeeHeading.remove();
        }

        // Remove all edit and batch edit buttons
        const editBtns = document.querySelectorAll('.edit-btn');
        editBtns.forEach(btn => btn.remove());

        // Remove the action buttons container if it exists
        const actionButtonsContainer = document.querySelector('.employee-action-buttons');
        if (actionButtonsContainer) {
            actionButtonsContainer.remove();
        }

        // Remove the import/export container if it exists
        const importExportContainer = document.querySelector('.import-export-container');
        if (importExportContainer) {
            importExportContainer.remove();
        }

        // Show the original table and mobile cards (CSS controls visibility by breakpoint)
        employeeTable.style.display = 'table';
        if (employeeCardsMobileEl) employeeCardsMobileEl.style.display = '';

        // Remove any employee details table
        const detailsTable = document.getElementById('employee-details-table');
        if (detailsTable) {
            detailsTable.remove();
        }
        
        // Remove any employee-specific cards first
        const employeeCards = document.querySelector('.employee-view-cards');
        if (employeeCards) {
            employeeCards.remove();
        }

        // Show the original summary cards
        const originalCards = document.querySelector('.summary-cards');
        if (originalCards) {
            originalCards.style.display = 'grid';
        }

        // Show the main view buttons
        document.getElementById('addEmployeeBtn').style.display = 'flex';
        const peBtnMain = document.getElementById('periodEarningsBtn');
        if (peBtnMain) peBtnMain.style.display = 'flex';
        document.querySelector('.push-holidays-btn').style.display = 'none'; // Keep hidden

        // Remove click handler from logo in main view
        const logoSection = document.querySelector('.logo-section');
        logoSection.style.cursor = 'default';
        logoSection.removeEventListener('click', arguments.callee);

        // // Reset the card titles and subtitles to original values
        // const totalEmpCard = document.getElementById('totalEmployees');
        // const totalEmpLabel = totalEmpCard.closest('.summary-card').querySelector('.card-title');
        // const totalEmpSubtitle = totalEmpCard.closest('.summary-card').querySelector('.card-subtitle');

        // totalEmpLabel.textContent = "Total Employees";
        // totalEmpSubtitle.textContent = "All staff";

        // const activeEmpCard = document.getElementById('activeEmployees');
        // const activeEmpLabel = activeEmpCard.closest('.summary-card').querySelector('.card-title');
        // const activeEmpSubtitle = activeEmpCard.closest('.summary-card').querySelector('.card-subtitle');

        // activeEmpLabel.textContent = "Active Employees";
        // activeEmpSubtitle.textContent = "For this period";

        // Update summary cards with overall data
        updateSummaryCards();
    }
    
    // Reset the running flag
    isUpdateViewModeRunning = false;
    console.log('updateViewModeImpl completed, isUpdateViewModeRunning set to false');
}

async function loadEmployeeDetailsAsMainTable(employeeId, container, preloadedData = null) {
    const fromRosterMemory = () => {
        const row =
            (filteredData && filteredData[employeeId]) ||
            (attendanceData && attendanceData[employeeId]);
        if (!row || !Array.isArray(row.dates)) return null;
        return { dates: JSON.parse(JSON.stringify(row.dates)) };
    };

    if (!preloadedData && filteredData[employeeId]?._payrollRowLoading) {
        if (container) {
            container.classList.add('employee-details-load-host');
            container.innerHTML = buildEmployeeDetailScrimHtml('Loading attendance…');
        }
        await new Promise((resolve) => {
            const tick = () => {
                const em = filteredData[employeeId];
                if (!em || !em._payrollRowLoading) return resolve();
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

    if (!preloadedData) {
        preloadedData = fromRosterMemory();
    }

    const skipDetailScrim = preloadedData && Array.isArray(preloadedData.dates);
    if (!skipDetailScrim && container) {
        container.classList.add('employee-details-load-host');
        container.innerHTML = buildEmployeeDetailScrimHtml('Loading attendance…');
    }

    try {
        let dates = [];
        
        // Use preloaded data if available (fast path: roster / filteredData already has period dates)
        if (preloadedData && preloadedData.dates) {
            console.log('Using in-memory or preloaded data for employee detail (no list refetch)');
            dates = preloadedData.dates;
        } else {
            // Fallback to original Firebase query (slow path)
            console.log("No preloaded data, fetching from Firebase");
            const period = periodSelect.value;
            const branch = branchSelect.value;
            const { startDate, endDate } = getPeriodDates(period);
            const formattedStartDate = formatDate(startDate);
            const formattedEndDate = formatDate(endDate);

            console.log("Period range:", formatDate(startDate), "to", formatDate(endDate));

            const attendanceRef = collection(db, "attendance_v2", employeeId, "dates");

            // Only fetch dates within the period range
            const querySnapshot = await getDocs(query(
                attendanceRef.withConverter(null),
                where("__name__", ">=", formattedStartDate),
                where("__name__", "<=", formattedEndDate)
            ));

        // Process each date document
        querySnapshot.forEach(doc => {
            const dateData = doc.data();
            const dateStr = doc.id;

            // Check if the date is actually in the period range
            const dateObj = new Date(dateStr);
            const dateObjNoTime = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
            const startDateNoTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDateNoTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

            // Only proceed if date is in range
            if (dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime) {
                // Add branch filter condition
                const isPaidLeave = dateData.isPaidLeave === true;
                const branchName = dateData.clockIn?.branch || "N/A";
                const branchMatches = isPaidLeave || branch === 'all' || attendanceMatchesFilter(branchName, branch);

                if (branchMatches) {
                    // Now we load the full data including photos
                    const shiftType = dateData.clockIn?.shift || "Custom";
                    
                    // Get scheduled times: use stored values if available (for Custom shifts), otherwise use shift schedule
                    let scheduledIn, scheduledOut;
                    if (dateData.scheduledIn !== undefined && dateData.scheduledOut !== undefined) {
                        scheduledIn = dateData.scheduledIn;
                        scheduledOut = dateData.scheduledOut;
                    } else {
                        const shiftSchedule = SHIFT_SCHEDULES[shiftType] || SHIFT_SCHEDULES["Custom"];
                        scheduledIn = shiftSchedule.timeIn;
                        scheduledOut = shiftSchedule.timeOut;
                    }

                    dates.push({
                        date: dateStr,
                        branch: branchName,
                        shift: shiftType,
                        scheduledIn: scheduledIn,
                        scheduledOut: scheduledOut,
                        timeIn: dateData.clockIn?.time || null,
                        timeOut: dateData.clockOut?.time || null,
                        timeInPhoto: dateData.clockIn?.selfie || null,
                        timeOutPhoto: dateData.clockOut?.selfie || null,
                        timeInLocation: extractPunchLocation(dateData.clockIn),
                        timeOutLocation: extractPunchLocation(dateData.clockOut),
                        hasOTPay: dateData.hasOTPay || false,
                        transpoAllowance: dateData.transpoAllowance || 0,
                        hasFixedPay: dateData.hasFixedPay || false,
                        fixedPayAmount: dateData.fixedPayAmount || 0,
                        hasDoublePay: dateData.hasDoublePay || false,
                        isPaidLeave: dateData.isPaidLeave === true,
                        hasMealAllowance: dateData.hasMealAllowance !== false // Default to true
                    });
                }
            }
        });
        } // Close the else block

        if (filteredData[employeeId] && Array.isArray(filteredData[employeeId].dates)) {
            dates.forEach((fresh) => {
                const existing = filteredData[employeeId].dates.find(d => d.date === fresh.date);
                if (existing) {
                    existing.timeInLocation = fresh.timeInLocation;
                    existing.timeOutLocation = fresh.timeOutLocation;
                }
            });
        }

        // Create the employee details table
        const detailTable = document.createElement('table');
        detailTable.className = 'data-table';
        detailTable.id = 'employeeDetailTable';

        // Get employee data to check sales bonus eligibility
        const employeeData = filteredData[employeeId];
        const showSalesBonus = employeeData && employeeData.salesBonusEligible;

        detailTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Shift</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Late Hours</th>
                    ${showSalesBonus ? '<th>Sales Bonus</th>' : ''}
                    <th>Total Pay</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const detailTableBody = detailTable.querySelector('tbody');

        // Sort dates in descending order
        const sortedDates = [...dates].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Add rows for each date
        sortedDates.forEach(date => {
            const dateObj = new Date(date.date);
            const formattedDate = formatDate(dateObj);
            const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });

            const detailRowItem = document.createElement('tr');
            detailRowItem.dataset.date = date.date;
            const employeeData = filteredData[employeeId];
            const dailySalesBonus = (date.timeIn && date.timeOut && date.branch === 'SM North' && employeeData.salesBonusEligible) ?
                payCalculator.calculateSalesBonus(date.date, employeeData) : 0;

            detailRowItem.className = 'expandable-row';
            detailRowItem.dataset.employeeId = employeeId;
            detailRowItem.dataset.date = date.date;

            // Replace the detailRowItem.innerHTML section with:
            detailRowItem.innerHTML = `
            <td class="date-cell">
                <span class="date-day">${formatReadableDate(date.date)}</span>
                <span class="date-dow">${dayOfWeek}</span>
                ${date.isPaidLeave ? '<span class="leave-badge">Paid Leave</span>' : ''}
                ${HOLIDAYS_2025[date.date] ?
                                `<span class="holiday-badge ${HOLIDAYS_2025[date.date].type}">${HOLIDAYS_2025[date.date].name}</span>` :
                                ''}
            </td>
            <td>${date.isPaidLeave ? '—' : (date.branch || 'N/A')}</td>
            <td>${date.isPaidLeave ? '—' : (date.shift || 'N/A')}</td>
            <td class="time-cell">
                ${date.isPaidLeave ? '—' : (date.timeInPhoto ? photoThumbDeferredHtml(date.timeInPhoto, 'Clock-in') : '<div style="height: 8px;"></div>')}
                ${date.isPaidLeave ? '—' : (date.timeIn ? formatTimeWithoutSeconds(date.timeIn) : 'N/A')}
                ${date.isPaidLeave ? '' : punchLocationCellHtml(date.timeInLocation, date.branch, 'in')}
            </td>
            <td class="time-cell">
                ${date.isPaidLeave ? '—' : (date.timeOutPhoto ? photoThumbDeferredHtml(date.timeOutPhoto, 'Clock-out') : '<div style="height: 8px;"></div>')}
                ${date.isPaidLeave ? '—' : (date.timeOut ? formatTimeWithoutSeconds(date.timeOut) : 'N/A')}
                ${date.isPaidLeave ? '' : punchLocationCellHtml(date.timeOutLocation, date.branch, 'out')}
            </td>
            <td>${date.isPaidLeave ? '—' : (date.scheduledIn && date.timeIn ?
                    (payCalculator.compareTimes(date.timeIn, date.scheduledIn) > 0 ?
                        (payCalculator.compareTimes(date.timeIn, date.scheduledIn) / 60).toFixed(1) :
                        '0.0') :
                    'N/A')}
            </td>
            ${showSalesBonus ? `<td>₱${dailySalesBonus.toFixed(2)}</td>` : ''}
            <td>₱${date.isPaidLeave || (date.timeIn && date.timeOut) ?
                    payCalculator.calculateDailyPay(date, employeeData, 'simple').toFixed(2) :
                    '0.00'}</td>
            <td class="action-cell">
                    <div class="action-buttons-container">
                        <button class="action-btn edit-shift-btn" data-date="${date.date}" data-employee="${employeeId}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit
                        </button>
                        <button class="action-btn duplicate-shift-btn" data-date="${date.date}" data-employee="${employeeId}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                        </svg>
                        Duplicate
                        </button>
                        <button class="action-btn delete-entry-btn" data-date="${date.date}" data-employee="${employeeId}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" preserveAspectRatio="none">
                        <path d="M3 6h18"></path>
                        <path d="m19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="m8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        <line x1="10" x2="10" y1="11" y2="17"></line>
                        <line x1="14" x2="14" y1="11" y2="17"></line>
                    </svg>
                    Delete
                </button>
                    </div>
                </td>
            `;

            detailTableBody.appendChild(detailRowItem);

            // Create detail row for breakdown
            const breakdownRow = document.createElement('tr');
            breakdownRow.className = 'detail-row';
            breakdownRow.dataset.employeeId = employeeId;
            breakdownRow.dataset.date = date.date;
            breakdownRow.dataset.loaded = 'false';

            const breakdownContent = document.createElement('td');
            breakdownContent.colSpan = showSalesBonus ? 9 : 8;
            breakdownContent.className = 'detail-content';
            breakdownContent.innerHTML = '<div class="loading-placeholder">Click row to load pay breakdown</div>';

            breakdownRow.appendChild(breakdownContent);
            detailTableBody.appendChild(breakdownRow);
        });

        const earningsLinesMain = employeeData?.periodEarningsLines || [];
        appendPeriodEarningsRows(detailTableBody, earningsLinesMain, showSalesBonus);

        // Add event listeners for expandable rows
        detailTable.querySelectorAll('.expandable-row').forEach(row => {
            row.addEventListener('click', function (e) {
                // Don't expand if clicking on a button or punch photo
                if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('img.thumb') || e.target.closest('.punch-location-chip')) {
                    return;
                }

                const employeeId = this.dataset.employeeId;
                const dateStr = this.dataset.date;
                const detailRow = detailTable.querySelector(`.detail-row[data-employee-id="${employeeId}"][data-date="${dateStr}"]`);

                // Load breakdown on demand
                if (detailRow.dataset.loaded === 'false') {
                    loadPayBreakdown(employeeId, dateStr, detailRow);
                }

                this.classList.toggle('expanded');
                detailRow.classList.toggle('expanded');
            });
        });

        // Replace loading indicator with the table
        container.innerHTML = '';
        container.appendChild(detailTable);

        scheduleDeferredThumbLoads(container);

        // Add event listeners for delete buttons
        container.querySelectorAll('.delete-entry-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                deleteAttendanceEntry(employeeId, dateStr);
            });
        });

        // Add event listeners for edit shift buttons
        container.querySelectorAll('.edit-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                openEditShiftModal(employeeId, dateStr);
            });
        });

        // Add event listeners for duplicate shift buttons
        container.querySelectorAll('.duplicate-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                duplicateShift(employeeId, dateStr);
            });
        });

    } catch (error) {
        console.error("Error loading employee details:", error);
        container.innerHTML = '<div class="error-message">Failed to load details. Please try again.</div>';
    } finally {
        if (container) container.classList.remove('employee-details-load-host');
    }
}

function loadPayBreakdown(employeeId, dateStr, detailRow) {
    const employee = filteredData[employeeId];
    const dateEntry = employee.dates.find(d => d.date === dateStr);

    if (!dateEntry || !dateEntry.timeIn || !dateEntry.timeOut) {
        const locHtml = dateEntry ? locationBreakdownHtml(dateEntry) : '';
        detailRow.querySelector('.detail-content').innerHTML = locHtml
            ? `<div class="pay-breakdown"><div class="no-data">No attendance data for pay breakdown</div>${locHtml}</div>`
            : '<div class="no-data">No attendance data for breakdown</div>';
        hydratePunchLocations(detailRow);
        detailRow.dataset.loaded = 'true';
        return;
    }

    // Use PayCalculator for breakdown
    const employeeData = mergeEmpRates(employee, periodSelect.value);

    // Clean the dateEntry to remove seconds from times
    const cleanDateObj = { ...dateEntry };
    if (cleanDateObj.timeIn) {
        cleanDateObj.timeIn = removeSecondsFromTime(cleanDateObj.timeIn);
    }
    if (cleanDateObj.timeOut) {
        cleanDateObj.timeOut = removeSecondsFromTime(cleanDateObj.timeOut);
    }
    if (cleanDateObj.scheduledIn) {
        cleanDateObj.scheduledIn = removeSecondsFromTime(cleanDateObj.scheduledIn);
    }
    if (cleanDateObj.scheduledOut) {
        cleanDateObj.scheduledOut = removeSecondsFromTime(cleanDateObj.scheduledOut);
    }

    const result = payCalculator.calculateDailyPay(cleanDateObj, employeeData, 'detailed');

    let breakdownHTML = `
    <div class="pay-breakdown">
        <h4>Pay Breakdown for ${formatReadableDate(dateStr)}</h4>
        <table class="breakdown-table">
            <tr>
                <td><strong>Pay Type:</strong></td>
                <td><strong>${result.breakdown.payType}</strong></td>
            </tr>`;

    // Add each component with admin-specific formatting
    if (result.breakdown && result.breakdown.components) {
        result.breakdown.components.forEach(component => {
            const label = formatComponentLabel(component);
            const colorClass = component.isPositive === false ? 'negative-amount' : 'positive-amount';
            const displayAmount = component.isPositive === false ?
                `-₱${component.amount.toFixed(2)}` :
                `₱${component.amount.toFixed(2)}`;

            breakdownHTML += `
                <tr>
                    <td>${label}</td>
                    <td class="${colorClass}">${displayAmount}</td>
                </tr>`;
        });
    }

    // Total row
    breakdownHTML += `
            <tr class="total-row">
                <td><strong>Total Pay</strong></td>
                <td><strong>₱${result.total.toFixed(2)}</strong></td>
            </tr>
        </table>`;

    // Sales Bonus Details (if applicable)
    if (employee.salesBonusEligible) {
        const salesData = window.salesDataCache[dateStr];
        if (salesData) {
            // Debug: Log the raw sales data to verify what we're reading
            console.log(`[Sales Debug] Date: ${dateStr}`, {
                cash: salesData.cash,
                gcash: salesData.gcash,
                maya: salesData.maya,
                card: salesData.card,
                grab: salesData.grab,
                totalSales: salesData.totalSales,
                hasGrab: 'grab' in salesData,
                grabUndefined: salesData.grab === undefined
            });
            
            // Use the same calculation as sales dashboard
            // Fallback to inline calculation if method doesn't exist (for cache compatibility)
            let totalSales;
            if (payCalculator.calculateTotalSalesFromData) {
                totalSales = payCalculator.calculateTotalSalesFromData(salesData);
            } else {
                // Fallback: match sales dashboard logic exactly
                const hasGrabData = 'grab' in salesData && salesData.grab !== undefined;
                if (hasGrabData) {
                    const walkInSales = (salesData.cash || 0) + (salesData.gcash || 0) + 
                                       (salesData.maya || 0) + (salesData.card || 0);
                    totalSales = walkInSales + (salesData.grab || 0);
                } else {
                    totalSales = salesData.totalSales || 0;
                }
            }
            
            console.log(`[Sales Debug] Calculated totalSales: ${totalSales} for ${dateStr}`);
            
            const date = new Date(dateStr);
            const staffCount = payCalculator.getStaffingLevel(date, attendanceData);
            const quota = payCalculator.getQuotaForStaffing(staffCount);
            const salesBonus = payCalculator.calculateSalesBonusAmount(totalSales, quota);

            breakdownHTML += `
            <div style="margin-top: 1.5rem;">
                <h4>Sales Bonus Details</h4>
                <table class="breakdown-table">
                    <tr>
                        <td>Daily Sales</td>
                        <td>₱${totalSales.toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td>Staff Count</td>
                        <td>${staffCount}</td>
                    </tr>
                    <tr>
                        <td>Sales Quota</td>
                        <td>₱${quota.toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td>Bonus Earned</td>
                        <td>₱${salesBonus.toFixed(2)}</td>
                    </tr>
                </table>
            </div>`;
        }
    }

    // Overtime Details (if applicable)
    if (dateEntry.hasOTPay) {
        const totalHours = payCalculator.calculateHours(cleanDateObj.timeIn, cleanDateObj.timeOut);
        if (totalHours) {
            const otCalculation = payCalculator.calculateOvertimePay(cleanDateObj, employeeData.baseRate);
            if (otCalculation.otPay > 0) {
                breakdownHTML += `
                <div style="margin-top: 1.5rem;">
                    <h4>Overtime Details</h4>
                    <table class="breakdown-table">
                        <tr>
                            <td>Total Hours Worked</td>
                            <td>${totalHours.toFixed(1)} hrs</td>
                        </tr>
                        <tr>
                            <td>Regular Hours (max 8)</td>
                            <td>8.0 hrs</td>
                        </tr>
                        <tr>
                            <td>Overtime Hours</td>
                            <td>${otCalculation.otHours.toFixed(1)} hrs</td>
                        </tr>
                        <tr>
                            <td>OT Rate</td>
                            <td>₱${(otCalculation.otPay / otCalculation.otHours).toFixed(2)}/hr</td>
                        </tr>
                        <tr>
                            <td>Total OT Pay</td>
                            <td>₱${otCalculation.otPay.toFixed(2)}</td>
                        </tr>
                    </table>
                </div>`;
            }
        }
    }

    breakdownHTML += locationBreakdownHtml(dateEntry);
    breakdownHTML += '</div>';

    detailRow.querySelector('.detail-content').innerHTML = breakdownHTML;
    hydratePunchLocations(detailRow);
    detailRow.dataset.loaded = 'true';
}

// Add this new function to handle component label formatting
function formatComponentLabel(component) {
    const { type, metadata } = component;

    switch (type) {
        case 'base_rate':
            return `Base Rate${metadata.isHalfDay ? ' (Half Day)' : ''}`;

        case 'base_pay':
            return `Base Pay (${metadata.hours.toFixed(1)} hrs)`;

        case 'fixed_pay':
            return 'Fixed Pay Amount';

        case 'double_pay_bonus':
            return `Double Pay Bonus (${metadata.bonusMultiplier}x)`;

        case 'holiday_bonus':
            return `Holiday Bonus (${metadata.bonusMultiplier}x)`;

        case 'meal_allowance':
            if (metadata.isHalfDay) {
                return 'Meal Allowance (Half Day)';
            } else if (metadata.isCustomShift) {
                return 'Meal Allowance';
            } else {
                return 'Meal Allowance';
            }

        case 'late_deduction':
            if (metadata.multiplier > 1.0) {
                return `Late Deduction (${metadata.hours.toFixed(1)} hrs at ${metadata.multiplier}x rate)`;
            } else {
                return `Late Deduction (${metadata.hours.toFixed(1)} hrs)`;
            }

        case 'undertime_deduction':
            if (metadata.multiplier > 1.0) {
                return `Undertime Deduction (${metadata.hours.toFixed(1)} hrs at ${metadata.multiplier}x rate)`;
            } else {
                return `Undertime Deduction (${metadata.hours.toFixed(1)} hrs)`;
            }

        case 'overtime_pay':
            return `Overtime Pay (${metadata.hours.toFixed(1)} hrs)`;

        case 'transportation_allowance':
            return 'Transportation Allowance';

        case 'sales_bonus':
            return 'Sales Bonus';

        default:
            return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
}

async function cleanupOrphanedPhotos() {
    showLoading("Scanning for orphaned photos...");

    try {
        // Get all employees
        const employeeIds = Object.keys(employees);
        let totalDeleted = 0;

        // Get today's date for reference
        const today = new Date();
        // Look back 7 days by default
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        // Build a list of dates to check
        const datesToCheck = [];
        let currentDate = new Date(startDate);
        while (currentDate <= today) {
            datesToCheck.push(formatDate(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        console.log(`Checking orphaned photos for dates: ${datesToCheck.join(', ')}`);

        // For each employee, check recent dates
        for (const employeeId of employeeIds) {
            // console.log(`Checking employee: ${employees[employeeId]}`);

            // For each date, check if document exists but photos might be orphaned
            for (const dateStr of datesToCheck) {
                // Check if document exists
                const docRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);
                const docSnap = await getDoc(docRef);

                if (!docSnap.exists()) {
                    // Document doesn't exist - possible orphaned photos
                    console.log(`No attendance record for ${employeeId} on ${dateStr} - checking for orphaned photos`);

                    // Try some common timestamp patterns we might have used in photo filenames
                    const timestamps = [
                        // Common patterns - you might need to adjust based on your app's naming
                        "",  // Try with no timestamp first
                        `_${dateStr.replace(/-/g, "")}`,
                        `_${new Date(dateStr).getTime()}`
                    ];

                    for (const timestamp of timestamps) {
                        try {
                            // Try to find clock-in photo
                            const inPath = `selfies/${employeeId}_${dateStr}_in${timestamp}.jpg`;
                            console.log(`Checking for: ${inPath}`);
                            const inRef = storageRef(storage, inPath);

                            try {
                                await deleteObject(inRef);
                                console.log(`Deleted orphaned clock-in photo: ${inPath}`);
                                totalDeleted++;
                            } catch (inError) {
                                // Not found or other error - that's okay, just continue
                                console.log(`Not found: ${inPath}`);
                            }

                            // Try to find clock-out photo
                            const outPath = `selfies/${employeeId}_${dateStr}_out${timestamp}.jpg`;
                            console.log(`Checking for: ${outPath}`);
                            const outRef = storageRef(storage, outPath);

                            try {
                                await deleteObject(outRef);
                                console.log(`Deleted orphaned clock-out photo: ${outPath}`);
                                totalDeleted++;
                            } catch (outError) {
                                // Not found or other error - that's okay, just continue
                                console.log(`Not found: ${outPath}`);
                            }
                        } catch (pathError) {
                            // Skip any errors for this pattern
                            console.warn(`Error with pattern: ${pathError.message}`);
                        }
                    }
                }
            }
        }

        console.log(`Cleanup complete. Deleted ${totalDeleted} orphaned photos.`);
        alert(`Cleanup complete. Found and deleted ${totalDeleted} orphaned photos.`);
    } catch (error) {
        console.error("Error during orphaned photo cleanup:", error);
        alert("Error during cleanup: " + error.message);
    } finally {
        hideLoading();
    }
}

async function deleteStoredSelfie(selfieUrl) {
    if (!selfieUrl || !selfieUrl.includes('firebasestorage.googleapis.com')) return;
    try {
        const storageUrl = new URL(selfieUrl);
        const encodedPath = storageUrl.pathname.split('/o/')[1];
        if (!encodedPath) return;
        const path = decodeURIComponent(encodedPath.split('?')[0]);
        await deleteObject(storageRef(storage, path));
    } catch (photoError) {
        console.warn("Could not delete punch photo:", photoError);
    }
}

function refreshAttendanceAfterEntryChange(employeeId) {
    if (attendanceData[employeeId]) {
        let daysWorkedCount = 0;
        let totalLateHours = 0;
        attendanceData[employeeId].dates.forEach(date => {
            if (date.isPaidLeave || (date.timeIn && date.timeOut)) {
                daysWorkedCount++;
            }
            if (date.scheduledIn && date.timeIn) {
                const lateMinutes = payCalculator.compareTimes(date.timeIn, date.scheduledIn);
                if (lateMinutes > 0) totalLateHours += lateMinutes / 60;
            }
        });
        attendanceData[employeeId].daysWorked = daysWorkedCount;
        attendanceData[employeeId].lateHours = totalLateHours;
    }

    const periodId = periodSelect.value;
    const branchId = branchSelect.value;
    saveToCache(getCacheKey(periodId, branchId), attendanceData);

    if (currentEmployeeView) {
        const container = document.getElementById('employee-details-table');
        if (container) {
            loadEmployeeDetailsAsMainTable(employeeId, container);
        }
        updateViewMode();
    } else {
        filterData();
    }
}

function syncRemovePunchButtons(dateEntry) {
    const inBtn = document.getElementById('removeTimeInBtn');
    const outBtn = document.getElementById('removeTimeOutBtn');
    const isLeave = !!(dateEntry && dateEntry.isPaidLeave);
    if (inBtn) inBtn.style.display = (!isLeave && dateEntry?.timeIn) ? 'inline-block' : 'none';
    if (outBtn) outBtn.style.display = (!isLeave && dateEntry?.timeOut) ? 'inline-block' : 'none';
}

function applyLocalPunchRemoval(employeeId, dateStr, kind) {
    const patch = (employee) => {
        if (!employee?.dates) return;
        const dateEntry = employee.dates.find(d => d.date === dateStr);
        if (!dateEntry) return;
        if (kind === 'in') {
            dateEntry.timeIn = null;
            dateEntry.timeInPhoto = null;
            dateEntry.timeInLocation = null;
        } else {
            dateEntry.timeOut = null;
            dateEntry.timeOutPhoto = null;
            dateEntry.timeOutLocation = null;
        }
    };
    patch(attendanceData[employeeId]);
    patch(filteredData[employeeId]);
}

// 2. Now add a function to handle the deletion of an attendance entry
async function deleteAttendanceEntry(employeeId, dateStr, { skipConfirm = false } = {}) {
    if (!employeeId || !dateStr) {
        console.error("Missing required parameters for deletion");
        return false;
    }

    if (!skipConfirm && !confirm(`Are you sure you want to delete the attendance record for ${dateStr}?`)) {
        return false;
    }

    showLoading("Deleting attendance entry...");

    try {
        const entryRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);
        const docSnap = await getDoc(entryRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            await deleteStoredSelfie(data.clockIn?.selfie);
            await deleteStoredSelfie(data.clockOut?.selfie);
        }

        await deleteDoc(entryRef);

        console.log(`Deleted attendance entry for ${employeeId} on ${dateStr}`);

        if (attendanceData[employeeId]) {
            attendanceData[employeeId].dates = attendanceData[employeeId].dates.filter(date => date.date !== dateStr);
        }
        if (filteredData[employeeId]) {
            filteredData[employeeId].dates = filteredData[employeeId].dates.filter(date => date.date !== dateStr);
        }

        refreshAttendanceAfterEntryChange(employeeId);
        showToast('Attendance entry deleted successfully');
        return true;
    } catch (error) {
        console.error("Error deleting attendance entry:", error);
        alert("Failed to delete attendance entry: " + error.message);
        return false;
    } finally {
        hideLoading();
    }
}

async function deletePunchFromEntry(employeeId, dateStr, kind) {
    if (!employeeId || !dateStr || (kind !== 'in' && kind !== 'out')) return false;

    const label = kind === 'out' ? 'Time Out' : 'Time In';
    const entryRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);
    const docSnap = await getDoc(entryRef);
    if (!docSnap.exists()) {
        showToast('No attendance record found for that date.', 'error');
        return false;
    }

    const data = docSnap.data();
    const hasIn = !!(data.clockIn && (data.clockIn.time || data.clockIn.timestamp));
    const hasOut = !!(data.clockOut && (data.clockOut.time || data.clockOut.timestamp));
    if (kind === 'in' && !hasIn) {
        showToast('There is no Time In punch to remove.', 'error');
        return false;
    }
    if (kind === 'out' && !hasOut) {
        showToast('There is no Time Out punch to remove.', 'error');
        return false;
    }

    const isLast = (kind === 'in' && !hasOut) || (kind === 'out' && !hasIn);
    const confirmMsg = isLast
        ? `Remove ${label}? This is the only punch left, so the whole log for ${dateStr} will be deleted.`
        : `Remove the ${label} punch for ${dateStr}? The other punch will stay.`;
    if (!confirm(confirmMsg)) return false;

    if (isLast) {
        return deleteAttendanceEntry(employeeId, dateStr, { skipConfirm: true });
    }

    showLoading(`Removing ${label}...`);
    try {
        const selfie = kind === 'in' ? data.clockIn?.selfie : data.clockOut?.selfie;
        await deleteStoredSelfie(selfie);
        await updateDoc(entryRef, kind === 'in' ? { clockIn: deleteField() } : { clockOut: deleteField() });
        applyLocalPunchRemoval(employeeId, dateStr, kind);
        refreshAttendanceAfterEntryChange(employeeId);
        showToast(`${label} removed`);
        return true;
    } catch (error) {
        console.error(`Error removing ${label}:`, error);
        alert(`Failed to remove ${label}: ${error.message}`);
        return false;
    } finally {
        hideLoading();
    }
}



// Add event listeners for base rate inputs
document.querySelectorAll('.base-rate-input').forEach(input => {
    input.addEventListener('change', async function () {
        const employeeId = this.dataset.employeeId;
        const newBaseRate = parseFloat(this.value) || 0;

        try {
            // Update in local data
            attendanceData[employeeId].baseRate = newBaseRate;

            // Update the total pay display
            const daysWorked = attendanceData[employeeId].daysWorked;
            const periodId = periodSelect.value;
            const totalPay = calcTotalPaySimple(attendanceData[employeeId].dates, attendanceData[employeeId], periodId);
            const row = this.closest('tr');
            row.querySelector('td:nth-child(5)').textContent = `₱${totalPay.toFixed(2)}`;

            // Update in Firebase
            const employeeDocRef = doc(db, "employees_v2", employeeId);
            const empSnap = await getDoc(employeeDocRef);
            const prev = empSnap.exists() ? empSnap.data() : {};
            const payType = prev.payType || attendanceData[employeeId].payType || 'hourly';
            const monthlySalary = prev.monthlySalary != null ? prev.monthlySalary : (attendanceData[employeeId].monthlySalary || 0);
            const periodGross = prev.periodGross != null ? prev.periodGross : attendanceData[employeeId].periodGross;
            const periodFixedAmount = prev.periodFixedAmount != null
                ? prev.periodFixedAmount
                : (attendanceData[employeeId].periodFixedAmount || 0);
            const payScheme = prev.payScheme === 'inclusive' || attendanceData[employeeId].payScheme === 'inclusive'
                ? 'inclusive'
                : 'standard';
            const rh = upsertEmployeeRateHistory(prev.rateHistory, periodId, {
                baseRate: newBaseRate,
                payType,
                monthlySalary,
                periodFixedAmount,
                payScheme,
                ...(periodGross != null && periodGross !== '' ? { periodGross } : {})
            });
            attendanceData[employeeId].rateHistory = rh;
            attendanceData[employeeId].payType = payType;
            attendanceData[employeeId].monthlySalary = monthlySalary;
            attendanceData[employeeId].periodFixedAmount = periodFixedAmount;
            attendanceData[employeeId].payScheme = payScheme;
            await updateDoc(employeeDocRef, {
                baseRate: newBaseRate,
                rateHistory: rh
            });

            console.log(`Base rate updated for ${employees[employeeId]} to ${newBaseRate}`);
        } catch (error) {
            console.error(`Error updating base rate for employee ${employeeId}:`, error);
            alert("Failed to update base rate. Please try again.");
            // Revert to previous value
            this.value = attendanceData[employeeId].baseRate || 0;
        }
    });
});

// Open employee edit modal
function openEditEmployeeModal(employeeId) {
    // Get employee data
    const employee = attendanceData[employeeId];

    // Fill form with current data
    editEmployeeName.value = employees[employeeId] || '';
    // Show current live rate, not cached period rate
    editBaseRate.value = PayCalculator.getRateForPeriod(employee, periodSelect.value).baseRate || 0;
    const currentScheme = PayCalculator.getRateForPeriod(employee, periodSelect.value).payScheme
        || employee.payScheme
        || 'standard';
    if (editPayScheme) {
        editPayScheme.value = currentScheme === 'inclusive' ? 'inclusive' : 'standard';
        const hint = document.getElementById('editPaySchemeHint');
        if (hint) {
            hint.textContent = editPayScheme.value === 'inclusive'
                ? 'Meal is already part of the daily rate, so it isn’t added again.'
                : '₱150 is added on top of the daily base (₱75 half day).';
        }
    }

    // Set nickname - use stored nickname or generate default
    const storedNickname = employee.nickname;
    const defaultNickname = generateDefaultNickname(employees[employeeId] || '');
    editNickname.value = storedNickname || defaultNickname;
    editNickname.placeholder = `Default: ${defaultNickname}`;
    editSalesBonus.checked = employee.salesBonusEligible || false;

    editEmployeeId.value = employeeId;

    // Show modal
    employeeEditModal.style.display = 'flex';

    // Add period context to base rate field
    const baseRateLabel = document.querySelector('label[for="editBaseRate"]');
    const periodText = periodSelect.options[periodSelect.selectedIndex].text;
    if (baseRateLabel) {
        baseRateLabel.textContent = `Base Rate (applies to ${periodText} and future periods)`;
    }
}

function generateDefaultNickname(fullName) {
    if (!fullName) return '';
    const nameParts = fullName.trim().split(' ');
    return nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : fullName;
}

// Close employee edit modal
function closeEditEmployeeModal() {
    employeeEditModal.style.display = 'none';
}

async function saveEmployeeChanges(e) {
    e.preventDefault();

    const employeeId = editEmployeeId.value;
    const newName = editEmployeeName.value.trim();
    const newBaseRate = parseFloat(editBaseRate.value) || 0;
    const newPayScheme = editPayScheme?.value === 'inclusive' ? 'inclusive' : 'standard';
    const newNickname = editNickname.value.trim();
    const newSalesBonusEligible = editSalesBonus.checked;

    try {
        const periodId = periodSelect.value;
        const priorEffectiveBase = PayCalculator.getRateForPeriod(attendanceData[employeeId], periodId).baseRate;

        employees[employeeId] = newName;
        attendanceData[employeeId].baseRate = newBaseRate;
        attendanceData[employeeId].payScheme = newPayScheme;
        attendanceData[employeeId].nickname = newNickname;
        attendanceData[employeeId].salesBonusEligible = newSalesBonusEligible;

        const employeeDocRef = doc(db, "employees_v2", employeeId);
        const prevSnap = await getDoc(employeeDocRef);
        const prevData = prevSnap.exists() ? prevSnap.data() : {};
        const payType = prevData.payType || attendanceData[employeeId].payType || 'hourly';
        const monthlySalary = prevData.monthlySalary != null ? prevData.monthlySalary : (attendanceData[employeeId].monthlySalary || 0);
        const periodGross = prevData.periodGross != null ? prevData.periodGross : attendanceData[employeeId].periodGross;
        const periodFixedAmount = prevData.periodFixedAmount != null
            ? prevData.periodFixedAmount
            : (attendanceData[employeeId].periodFixedAmount || 0);
        const rateHistory = upsertEmployeeRateHistory(prevData.rateHistory, periodId, {
            baseRate: newBaseRate,
            payType,
            monthlySalary,
            periodFixedAmount,
            payScheme: newPayScheme,
            ...(periodGross != null && periodGross !== '' ? { periodGross } : {})
        });
        attendanceData[employeeId].rateHistory = rateHistory;
        attendanceData[employeeId].payType = payType;
        attendanceData[employeeId].monthlySalary = monthlySalary;
        attendanceData[employeeId].periodFixedAmount = periodFixedAmount;
        attendanceData[employeeId].payScheme = newPayScheme;

        await setDoc(employeeDocRef, {
            name: newName,
            baseRate: newBaseRate,
            payScheme: newPayScheme,
            nickname: newNickname,
            salesBonusEligible: newSalesBonusEligible,
            rateHistory
        }, { merge: true });

        // Update UI
        const row = document.querySelector(`.expandable-row[data-employee-id="${employeeId}"]`);
        if (row) {
            row.querySelector('.employee-name').textContent = newName;
            row.querySelector('.base-rate').textContent = `₱${newBaseRate}`;

            // Update total pay
            const daysWorked = attendanceData[employeeId].daysWorked;
            const totalPay = calcTotalPaySimple(attendanceData[employeeId].dates, attendanceData[employeeId], periodSelect.value);
            row.querySelector('td:nth-child(5)').textContent = `₱${totalPay.toFixed(2)}`;
        }

        // Update single employee view heading if we're in that view
        if (currentEmployeeView === employeeId) {
            const heading = document.getElementById('employee-view-heading');
            if (heading) {
                const displayName = newNickname || generateDefaultNickname(newName);
                heading.textContent = displayName;
            }
        }

        console.log(`Employee ${employeeId} updated: name=${newName}, baseRate=${newBaseRate}, nickname=${newNickname}`);
        
        if (priorEffectiveBase !== newBaseRate) {
            const today = new Date();
            const { endDate } = getPeriodDates(periodSelect.value);
            if (today <= endDate) {
                const currentCacheKey = getCacheKey(periodSelect.value, branchSelect.value);
                localStorage.removeItem(currentCacheKey);
                await loadData();
            }
        }

        // Close modal
        closeEditEmployeeModal();
    } catch (error) {
        console.error("Error updating employee:", error);
        alert("Failed to update employee details. Please try again.");
    }
}

// Add this to your DOM elements section
const activeOnlyToggle = document.getElementById('activeOnlyToggle');

// Add this to your DOMContentLoaded event listener setup
activeOnlyToggle.addEventListener('change', filterData);

const includePriorEarningsToggle = document.getElementById('includePriorEarningsToggle');
if (includePriorEarningsToggle) {
    includePriorEarningsToggle.checked = isPriorEarningsToggleOn();
    includePriorEarningsToggle.addEventListener('change', async () => {
        setPriorEarningsToggle(includePriorEarningsToggle.checked);
        showToast(includePriorEarningsToggle.checked
            ? 'Including open lines from previous 2 cutoffs'
            : 'Showing current period lines only');
        if (periodSelect?.value) {
            await loadData(periodSelect.value);
        }
    });
}
// Background data refresh functionality
let backgroundRefreshInProgress = false;

function showBackgroundRefresh() {
    refreshIndicator.style.display = 'flex';
}

function hideBackgroundRefresh() {
    refreshIndicator.style.display = 'none';
}

async function backgroundRefresh() {
    // Don't start another refresh if one is in progress
    if (backgroundRefreshInProgress) {
        console.log("Background refresh already in progress, skipping");
        return;
    }

    if (payrollBulkLoadInProgress || summaryReconcileInProgress || fullCacheReconcileInProgress) {
        console.log("Background refresh skipped: payroll load or reconcile in progress");
        return;
    }

    backgroundRefreshInProgress = true;
    showBackgroundRefresh();

    try {
        console.log("Starting background data refresh");

        // Use current period and branch
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;

        // Check when data was last refreshed
        const summaryCacheKey = getSummaryCacheKey(periodId, branchId);
        const cachedData = localStorage.getItem(summaryCacheKey);

        // Only refresh if we have cached data that's older than 15 minutes
        if (cachedData) {
            const parsedCache = JSON.parse(cachedData);
            const lastRefresh = parsedCache.timestamp;
            const refreshAge = Date.now() - lastRefresh;
            const minRefreshInterval = 15 * 60 * 1000; // 15 minutes

            if (refreshAge < minRefreshInterval) {
                console.log(`Data is fresh (${Math.round(refreshAge / 60000)}min old), skipping refresh`);
                hideBackgroundRefresh();
                backgroundRefreshInProgress = false;
                return;
            }
        }

        // Force a refresh with the current period and branch
        console.log("Refreshing data in the background");
        await loadData(periodId, {
            skipSummaryBootstrap: true,
            forceNetworkRefresh: true,
            silent: true
        });
    } catch (error) {
        console.error("Error in background refresh:", error);
        // Failed silently - no need to alert user since this is in the background
    } finally {
        hideBackgroundRefresh();
        backgroundRefreshInProgress = false;
    }
}

// Set up periodic background refresh (call once — guarded)
function setupBackgroundRefresh() {
    if (backgroundRefreshSetupDone) {
        console.warn("setupBackgroundRefresh: already registered, skipping duplicate");
        return;
    }
    backgroundRefreshSetupDone = true;

    // Check for updates every 5 minutes
    const refreshInterval = 5 * 60 * 1000; // 5 minutes

    // First refresh after 30 seconds (give time for initial load)
    setTimeout(() => {
        backgroundRefresh();

        // Then set up regular interval
        setInterval(backgroundRefresh, refreshInterval);
    }, 30 * 1000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (visibilityRefreshDebounceTimer) {
            clearTimeout(visibilityRefreshDebounceTimer);
        }
        visibilityRefreshDebounceTimer = setTimeout(() => {
            visibilityRefreshDebounceTimer = null;
            backgroundRefresh();
        }, VISIBILITY_REFRESH_DEBOUNCE_MS);
    });
}

function openEditShiftModal(employeeId, dateStr) {
    // Get DOM elements
    const editShiftBranch = document.getElementById('editShiftBranch');
    const editShiftSchedule = document.getElementById('editShiftSchedule');
    const editShiftTimeIn = document.getElementById('editShiftTimeIn');
    const editShiftTimeOut = document.getElementById('editShiftTimeOut');
    const editTranspoAllowance = document.getElementById('editTranspoAllowance');
    const editOTPay = document.getElementById('editOTPay');
    const editShiftEmployeeId = document.getElementById('editShiftEmployeeId');
    const editShiftDate = document.getElementById('editShiftDate');
    const editShiftFixedPay = document.getElementById('editShiftFixedPay');
    const editShiftDoublePay = document.getElementById('editShiftDoublePay');
    const editShiftFixedAmount = document.getElementById('editShiftFixedAmount');
    const editShiftFixedAmountGroup = document.getElementById('editShiftFixedAmountGroup');
    const editMealAllowance = document.getElementById('editMealAllowance');

    // Find the date entry in the data
    const employee = filteredData[employeeId];
    const dateEntry = employee.dates.find(d => d.date === dateStr);

    if (dateEntry) {
        populateAttendanceBranchSelect(editShiftBranch, { selectedValue: dateEntry.branch || 'Podium' });
        if (dateEntry.branch && ![...editShiftBranch.options].some((o) => o.value === dateEntry.branch)) {
            const opt = document.createElement('option');
            opt.value = dateEntry.branch;
            opt.textContent = dateEntry.branch;
            editShiftBranch.appendChild(opt);
        }
        editShiftBranch.value = dateEntry.branch || 'Podium';
        editShiftSchedule.value = dateEntry.shift || 'Opening';
        editShiftTimeIn.value = convertTo24HourFormat(dateEntry.timeIn) || '';
        editShiftTimeOut.value = convertTo24HourFormat(dateEntry.timeOut) || '';
        editTranspoAllowance.value = dateEntry.transpoAllowance || 0;
        editOTPay.checked = dateEntry.hasOTPay || false;

        // Set pay options
        editShiftFixedPay.checked = dateEntry.hasFixedPay || false;
        editShiftDoublePay.checked = dateEntry.hasDoublePay || false;
        editShiftFixedAmount.value = dateEntry.fixedPayAmount || '';

        // Set meal allowance (default to true if not specified)
        editMealAllowance.checked = dateEntry.hasMealAllowance !== false;
        applyMealAllowanceControlState(editMealAllowance, employee);

        const editPaidLeaveEl = document.getElementById('editShiftPaidLeave');
        if (editPaidLeaveEl) {
            editPaidLeaveEl.checked = dateEntry.isPaidLeave === true;
            togglePaidLeaveMode('edit', editPaidLeaveEl.checked);
        }

        // Load scheduled times for Custom shifts
        const editShiftScheduledIn = document.getElementById('editShiftScheduledIn');
        const editShiftScheduledOut = document.getElementById('editShiftScheduledOut');
        if (editShiftScheduledIn && editShiftScheduledOut) {
            if (dateEntry.scheduledIn) {
                editShiftScheduledIn.value = convertTo24HourFormat(dateEntry.scheduledIn) || '';
            }
            if (dateEntry.scheduledOut) {
                editShiftScheduledOut.value = convertTo24HourFormat(dateEntry.scheduledOut) || '';
            }
        }

        // Show/hide fixed amount field
        if (editShiftFixedPay.checked) {
            editShiftFixedAmountGroup.style.display = 'block';
            editShiftFixedAmount.required = true;
        } else {
            editShiftFixedAmountGroup.style.display = 'none';
            editShiftFixedAmount.required = false;
        }

        // Show/hide scheduled times fields based on shift type
        toggleScheduledTimesFields('edit', dateEntry.shift || 'Opening');
        syncRemovePunchButtons(dateEntry);
    }

    editShiftEmployeeId.value = employeeId;
    editShiftDate.value = dateStr;

    // If no date entry yet, default paid leave off
    if (!dateEntry) {
        const editPaidLeaveEl = document.getElementById('editShiftPaidLeave');
        if (editPaidLeaveEl) {
            editPaidLeaveEl.checked = false;
            togglePaidLeaveMode('edit', false);
        }
        syncRemovePunchButtons(null);
    }

    document.getElementById('shiftEditModal').style.display = 'flex';
}

function convertTo24HourFormat(timeStr) {
    if (!timeStr) return '';

    const [time, meridian] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (meridian === 'PM' && hours !== 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// Function to show/hide scheduled time fields based on shift type
function toggleScheduledTimesFields(modalType, shiftValue) {
    if (modalType === 'add') {
        const scheduledTimesGroup = document.getElementById('addScheduledTimesGroup');
        if (scheduledTimesGroup) {
            if (shiftValue === 'Custom') {
                scheduledTimesGroup.style.display = 'block';
            } else {
                scheduledTimesGroup.style.display = 'none';
                // Clear values when hidden
                const scheduledIn = document.getElementById('addShiftScheduledIn');
                const scheduledOut = document.getElementById('addShiftScheduledOut');
                if (scheduledIn) scheduledIn.value = '';
                if (scheduledOut) scheduledOut.value = '';
            }
        }
    } else if (modalType === 'edit') {
        const scheduledTimesGroup = document.getElementById('editScheduledTimesGroup');
        if (scheduledTimesGroup) {
            if (shiftValue === 'Custom') {
                scheduledTimesGroup.style.display = 'block';
            } else {
                scheduledTimesGroup.style.display = 'none';
                // Clear values when hidden
                const scheduledIn = document.getElementById('editShiftScheduledIn');
                const scheduledOut = document.getElementById('editShiftScheduledOut');
                if (scheduledIn) scheduledIn.value = '';
                if (scheduledOut) scheduledOut.value = '';
            }
        }
    }
}

// Function to update time placeholders based on selected schedule
function updateTimePlaceholders() {
    console.log('updateTimePlaceholders called');
    const selectedSchedule = addShiftSchedule.value;
    console.log('Selected schedule:', selectedSchedule);
    const schedule = SHIFT_SCHEDULES[selectedSchedule];
    console.log('Schedule object:', schedule);
    
    if (schedule) {
        // Convert 12-hour format to 24-hour format for input placeholders
        const timeIn24 = convert12To24Hour(schedule.timeIn);
        const timeOut24 = convert12To24Hour(schedule.timeOut);
        console.log('Time In 24h:', timeIn24, 'Time Out 24h:', timeOut24);
        
        addShiftTimeIn.placeholder = timeIn24;
        addShiftTimeOut.placeholder = timeOut24;
        
        console.log('Placeholders updated - Time In:', addShiftTimeIn.placeholder, 'Time Out:', addShiftTimeOut.placeholder);
    } else {
        console.log('No schedule found for:', selectedSchedule);
    }
}

// Helper function to convert 12-hour format to 24-hour format
function convert12To24Hour(time12) {
    console.log('convert12To24Hour called with:', time12);
    if (!time12) {
        console.log('No time provided, returning empty string');
        return '';
    }
    
    const [time, meridian] = time12.split(' ');
    console.log('Split time:', time, 'meridian:', meridian);
    let [hours, minutes] = time.split(':').map(Number);
    console.log('Hours:', hours, 'Minutes:', minutes);
    
    if (meridian === 'PM' && hours !== 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;
    
    const result = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    console.log('Converted result:', result);
    return result;
}

function convertTo12HourFormat(timeStr) {
    if (!timeStr) return null;

    const [hours, minutes] = timeStr.split(':').map(Number);
    const meridian = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;

    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${meridian}`;
}

// Close shift edit modal
function closeShiftEditModal() {
    shiftEditModal.style.display = 'none';
}

// Open add employee modal
function openAddEmployeeModal() {
    // Clear form
    addEmployeeForm.reset();
    const addPayScheme = document.getElementById('addPayScheme');
    if (addPayScheme) addPayScheme.value = 'inclusive';
    if (addBaseRate) addBaseRate.placeholder = 'e.g., 750';

    // Show modal
    addEmployeeModal.style.display = 'flex';
}

// Close add employee modal
function closeAddEmployeeModalFunc() {
    addEmployeeModal.style.display = 'none';
}

// Save new employee
async function saveNewEmployee(e) {
    e.preventDefault();

    const employeeId = addEmployeeId.value.trim();
    const employeeName = addEmployeeName.value.trim();
    const baseRate = parseFloat(addBaseRate.value) || 0;
    const payScheme = document.getElementById('addPayScheme')?.value === 'inclusive' ? 'inclusive' : 'standard';
    const nickname = addNickname.value.trim() || generateDefaultNickname(employeeName);
    const salesBonusEligible = addSalesBonus.checked;

    // Validate employee ID doesn't already exist
    if (employees[employeeId]) {
        showToast('Employee ID already exists. Please use a different ID.', 'error');
        return;
    }

    try {
        // Save to Firebase first
        const employeeDocRef = doc(db, "employees_v2", employeeId);
        await setDoc(employeeDocRef, {
            name: employeeName,
            baseRate: baseRate,
            payScheme: payScheme,
            payType: 'hourly',
            nickname: nickname,
            salesBonusEligible: salesBonusEligible
        });

        // Add to local employees object
        employees[employeeId] = employeeName;

        // Add to attendance data
        attendanceData[employeeId] = {
            id: employeeId,
            name: employeeName,
            dates: [],
            lastClockIn: null,
            lastClockInPhoto: null,
            daysWorked: 0,
            lateHours: 0,
            baseRate: baseRate,
            payScheme: payScheme,
            payType: 'hourly',
            nickname: nickname,
            salesBonusEligible: salesBonusEligible
        };

        console.log(`New employee added: ${employeeId} - ${employeeName}`);

        // Update cache
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        // Refresh the view
        filterData();

        // Close modal
        closeAddEmployeeModalFunc();

        showToast('Employee added successfully!');
    } catch (error) {
        console.error("Error adding employee:", error);
        showToast("Failed to add employee. Please try again.", 'error');
    }
}

async function saveShiftChanges(e) {
    e.preventDefault();

    const employeeId = document.getElementById('editShiftEmployeeId').value;
    const dateStr = document.getElementById('editShiftDate').value;
    const isPaidLeave = document.getElementById('editShiftPaidLeave')?.checked === true;
    const docRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);

    if (isPaidLeave) {
        try {
            await setDoc(docRef, {
                isPaidLeave: true,
                hasMealAllowance: false,
                notes: 'Paid leave'
            });

            const applyLeaveLocal = (employee) => {
                if (!employee?.dates) return;
                const dateEntry = employee.dates.find(d => d.date === dateStr);
                if (!dateEntry) return;
                dateEntry.isPaidLeave = true;
                dateEntry.timeIn = null;
                dateEntry.timeOut = null;
                dateEntry.branch = 'N/A';
                dateEntry.shift = 'Custom';
                dateEntry.hasMealAllowance = false;
                dateEntry.hasOTPay = false;
                dateEntry.hasFixedPay = false;
                dateEntry.hasDoublePay = false;
                dateEntry.fixedPayAmount = 0;
                dateEntry.transpoAllowance = 0;
                dateEntry.timeInPhoto = null;
                dateEntry.timeOutPhoto = null;
            };
            applyLeaveLocal(attendanceData[employeeId]);
            applyLeaveLocal(filteredData[employeeId]);

            const periodId = periodSelect.value;
            const branchId = branchSelect.value;
            saveToCache(getCacheKey(periodId, branchId), attendanceData);
            filterData();

            if (currentEmployeeView === employeeId) {
                const container = document.getElementById('employee-details-table');
                if (container) loadEmployeeDetailsAsMainTable(employeeId, container);
            }

            document.getElementById('shiftEditModal').style.display = 'none';
            showToast('Paid leave saved successfully!');
        } catch (error) {
            console.error('Error saving paid leave:', error);
            showToast('Failed to save paid leave. Please try again.', 'error');
        }
        return;
    }

    const newBranch = document.getElementById('editShiftBranch').value;
    const newShift = document.getElementById('editShiftSchedule').value;
    const newTimeIn = document.getElementById('editShiftTimeIn').value ? convertTo12HourFormat(document.getElementById('editShiftTimeIn').value) : null;
    const newTimeOut = document.getElementById('editShiftTimeOut').value ? convertTo12HourFormat(document.getElementById('editShiftTimeOut').value) : null;
    const newTranspoAllowance = parseFloat(document.getElementById('editTranspoAllowance').value) || 0;
    const newHasOTPay = document.getElementById('editOTPay').checked;
    const newHasFixedPay = document.getElementById('editShiftFixedPay').checked;
    const newHasDoublePay = document.getElementById('editShiftDoublePay').checked;
    const newFixedPayAmount = newHasFixedPay ? (parseFloat(document.getElementById('editShiftFixedAmount').value) || 0) : 0;
    const newHasMealAllowance = employeeIncludesMealAllowance(filteredData[employeeId] || attendanceData[employeeId])
        ? document.getElementById('editMealAllowance').checked
        : false;

    // Get scheduled times for Custom shifts
    const editShiftScheduledIn = document.getElementById('editShiftScheduledIn');
    const editShiftScheduledOut = document.getElementById('editShiftScheduledOut');
    const newScheduledIn = (newShift === 'Custom' && editShiftScheduledIn?.value) ? convertTo12HourFormat(editShiftScheduledIn.value) : null;
    const newScheduledOut = (newShift === 'Custom' && editShiftScheduledOut?.value) ? convertTo12HourFormat(editShiftScheduledOut.value) : null;

    try {
        const existingSnap = await getDoc(docRef);
        const wasPaidLeave = existingSnap.exists() && existingSnap.data().isPaidLeave === true;

        // If converting from leave to a normal shift, rewrite the full doc
        if (wasPaidLeave) {
            if (!newTimeIn || !newTimeOut) {
                showToast('Please set Time In and Time Out when converting leave to a shift.', 'error');
                return;
            }
            const shiftData = {
                clockIn: { time: newTimeIn, branch: newBranch, shift: newShift },
                clockOut: { time: newTimeOut },
                transpoAllowance: newTranspoAllowance,
                hasOTPay: newHasOTPay,
                hasFixedPay: newHasFixedPay,
                fixedPayAmount: newFixedPayAmount,
                hasDoublePay: newHasDoublePay,
                hasMealAllowance: newHasMealAllowance,
                isPaidLeave: false
            };
            if (newShift === 'Custom') {
                if (newScheduledIn) shiftData.scheduledIn = newScheduledIn;
                if (newScheduledOut) shiftData.scheduledOut = newScheduledOut;
            }
            await setDoc(docRef, shiftData);
        } else {
            // Build update object
            const updateData = {
                'clockIn.branch': newBranch,
                'clockIn.shift': newShift,
                'transpoAllowance': newTranspoAllowance,
                'hasOTPay': newHasOTPay,
                'hasFixedPay': newHasFixedPay,
                'fixedPayAmount': newFixedPayAmount,
                'hasDoublePay': newHasDoublePay,
                'hasMealAllowance': newHasMealAllowance,
                'isPaidLeave': false
            };

            // Only update times if they were provided
            if (newTimeIn) {
                updateData['clockIn.time'] = newTimeIn;
            }
            if (newTimeOut) {
                updateData['clockOut.time'] = newTimeOut;
            }

            // Update scheduled times for Custom shifts
            if (newShift === 'Custom') {
                if (newScheduledIn) {
                    updateData['scheduledIn'] = newScheduledIn;
                } else {
                    updateData['scheduledIn'] = null;
                }
                if (newScheduledOut) {
                    updateData['scheduledOut'] = newScheduledOut;
                } else {
                    updateData['scheduledOut'] = null;
                }
            } else {
                updateData['scheduledIn'] = null;
                updateData['scheduledOut'] = null;
            }

            await updateDoc(docRef, updateData);
        }

        // Update local data
        const employee = attendanceData[employeeId];
        const dateEntry = employee.dates.find(d => d.date === dateStr);
        if (dateEntry) {
            dateEntry.branch = newBranch;
            dateEntry.shift = newShift;
            dateEntry.transpoAllowance = newTranspoAllowance;
            dateEntry.hasOTPay = newHasOTPay;
            dateEntry.hasFixedPay = newHasFixedPay;
            dateEntry.fixedPayAmount = newFixedPayAmount;
            dateEntry.hasDoublePay = newHasDoublePay;
            dateEntry.hasMealAllowance = newHasMealAllowance;
            dateEntry.isPaidLeave = false;

            if (newTimeIn) dateEntry.timeIn = newTimeIn;
            if (newTimeOut) dateEntry.timeOut = newTimeOut;

            // Update scheduled times
            if (newShift === 'Custom') {
                dateEntry.scheduledIn = newScheduledIn || null;
                dateEntry.scheduledOut = newScheduledOut || null;
            } else {
                const shiftSchedule = SHIFT_SCHEDULES[newShift] || SHIFT_SCHEDULES["Custom"];
                dateEntry.scheduledIn = shiftSchedule.timeIn;
                dateEntry.scheduledOut = shiftSchedule.timeOut;
            }
        }

        // Also update filteredData to ensure UI reflects changes immediately
        const filteredEmployee = filteredData[employeeId];
        if (filteredEmployee) {
            const filteredDateEntry = filteredEmployee.dates.find(d => d.date === dateStr);
            if (filteredDateEntry) {
                filteredDateEntry.branch = newBranch;
                filteredDateEntry.shift = newShift;
                filteredDateEntry.transpoAllowance = newTranspoAllowance;
                filteredDateEntry.hasOTPay = newHasOTPay;
                filteredDateEntry.hasFixedPay = newHasFixedPay;
                filteredDateEntry.fixedPayAmount = newFixedPayAmount;
                filteredDateEntry.hasDoublePay = newHasDoublePay;
                filteredDateEntry.hasMealAllowance = newHasMealAllowance;
                filteredDateEntry.isPaidLeave = false;

                if (newTimeIn) filteredDateEntry.timeIn = newTimeIn;
                if (newTimeOut) filteredDateEntry.timeOut = newTimeOut;

                // Update scheduled times
                if (newShift === 'Custom') {
                    filteredDateEntry.scheduledIn = newScheduledIn || null;
                    filteredDateEntry.scheduledOut = newScheduledOut || null;
                } else {
                    const shiftSchedule = SHIFT_SCHEDULES[newShift] || SHIFT_SCHEDULES["Custom"];
                    filteredDateEntry.scheduledIn = shiftSchedule.timeIn;
                    filteredDateEntry.scheduledOut = shiftSchedule.timeOut;
                }
            }
        }

        // Update cache and refresh view
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        filterData();

        if (currentEmployeeView === employeeId) {
            const container = document.getElementById('employee-details-table');
            if (container) {
                await loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        closeShiftEditModal();
        showToast('Shift details updated successfully');
    } catch (error) {
        console.error('Error updating shift:', error);
        showToast('Failed to update shift details. Please try again.', 'error');
    }
}

// Open batch edit modal
function openBatchEditModal(employeeId) {
    batchEditEmployeeId.value = employeeId;
    batchEditBranch.value = '';
    batchEditShift.value = '';
    batchEditModal.style.display = 'flex';
}

// Close batch edit modal
function closeBatchEditModal() {
    batchEditModal.style.display = 'none';
}

// Save batch changes
async function saveBatchChanges(e) {
    e.preventDefault();

    const employeeId = batchEditEmployeeId.value;
    const newBranch = batchEditBranch.value;
    const newShift = batchEditShift.value;

    if (!newBranch && !newShift) {
        showToast('Please select at least one field to update.', 'error');
        return;
    }

    if (!confirm('This will update all attendance records for this employee in the current period. Continue?')) {
        return;
    }

    showLoading('Updating attendance records...');

    try {
        const employee = filteredData[employeeId];
        const updates = [];

        // Process each date entry
        for (const dateEntry of employee.dates) {
            const docRef = doc(db, "attendance_v2", employeeId, "dates", dateEntry.date);
            const updateData = {};

            if (newBranch) {
                updateData['clockIn.branch'] = newBranch;
                dateEntry.branch = newBranch;
            }

            if (newShift) {
                updateData['clockIn.shift'] = newShift;
                dateEntry.shift = newShift;
                dateEntry.scheduledIn = SHIFT_SCHEDULES[newShift].timeIn;
                dateEntry.scheduledOut = SHIFT_SCHEDULES[newShift].timeOut;
            }

            updates.push(updateDoc(docRef, updateData));
        }

        // Execute all updates
        await Promise.all(updates);

        // Update cache
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        // Refresh the view
        filterData();

        // Reload single employee view if active
        if (currentEmployeeView === employeeId) {
            const container = document.getElementById('employee-details-table');
            if (container) {
                loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        closeBatchEditModal();
        showToast(`Successfully updated ${updates.length} records`);
    } catch (error) {
        console.error('Error in batch update:', error);
        showToast('Failed to update records. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

document.addEventListener('DOMContentLoaded', async function () {
    // Add this event listener in your DOMContentLoaded function
    // document.getElementById('cleanupPhotosBtn').addEventListener('click', cleanupOrphanedPhotos);
    console.time('app-init');

    await loadBranchesFromFirebase(db, { getDocs, collection });
    populateAttendanceBranchSelects(['addShiftBranch', 'editShiftBranch', 'batchEditBranch']);

    // Setup event listeners
    setupEmployeeTableSorting();

    closeModal.addEventListener('click', closePhotoModal);
    photoModal.addEventListener('click', closePhotoModal);
    document.querySelector('.photo-modal-content').addEventListener('click', function (e) { e.stopPropagation(); });

    const punchMapModal = document.getElementById('punchMapModal');
    const closePunchMapBtn = document.getElementById('closePunchMapModal');
    if (closePunchMapBtn) closePunchMapBtn.addEventListener('click', closePunchMapModal);
    if (punchMapModal) punchMapModal.addEventListener('click', closePunchMapModal);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && punchMapModal && punchMapModal.style.display === 'flex') {
            closePunchMapModal();
        }
    });

    const todayBootstrap = new Date();
    const cachedEarliest = readMigrationEarliestDateFromCache();
    if (cachedEarliest) {
        window.payrollPeriods = generatePayrollPeriods(cachedEarliest, todayBootstrap, false, 0);
        console.log('Payroll periods bootstrapped from migration-tool earliest-date cache');
    } else {
        window.payrollPeriods = generatePayrollPeriods();
    }
    updatePeriodDropdown();

    periodSelect.addEventListener('change', async function () {
        // Get the selection right away and store it
        const selectedPeriod = this.value;
        console.log(`Period selected by user: ${selectedPeriod}`);

        // Lock the selection immediately
        this.disabled = true;

        try {
            // Clear existing data and cache
            attendanceData = {};
            localStorage.setItem('last_selected_period', selectedPeriod);
            // Keep caches so period switch can hydrate instantly, then reconcile in background.

            // Pass the explicitly selected period to loadData
            await loadData(selectedPeriod);

            // IMPORTANT: Only update view mode and reload employee details AFTER loadData completes
            // If we're in single employee view, reload that specific view
            if (currentEmployeeView) {
                // First update the view mode to ensure proper structure
                updateViewMode();

                // Then reload the employee details
                const container = document.getElementById('employee-details-table');
                if (container) {
                    await loadEmployeeDetailsAsMainTable(currentEmployeeView, container);
                }
            }
        } catch (error) {
            console.error("Error loading period:", error);
        } finally {
            this.disabled = false;

            // Double-check selection is still correct after loading
            if (this.value !== selectedPeriod) {
                console.log(`Fixing period back to ${selectedPeriod} from ${this.value}`);
                this.value = selectedPeriod;
            }
        }
    });

    // Fixed pay checkbox handler
    document.getElementById('editShiftFixedPay').addEventListener('change', function () {
        const fixedAmountGroup = document.getElementById('editShiftFixedAmountGroup');
        const fixedAmountInput = document.getElementById('editShiftFixedAmount');
        const doublePayCheckbox = document.getElementById('editShiftDoublePay');

        if (this.checked) {
            fixedAmountGroup.style.display = 'block';
            fixedAmountInput.required = true;
            // Uncheck double pay if fixed pay is selected
            doublePayCheckbox.checked = false;
        } else {
            fixedAmountGroup.style.display = 'none';
            fixedAmountInput.required = false;
            fixedAmountInput.value = '';
        }
    });

    // Double pay checkbox handler
    document.getElementById('editShiftDoublePay').addEventListener('change', function () {
        const fixedPayCheckbox = document.getElementById('editShiftFixedPay');
        const fixedAmountGroup = document.getElementById('editShiftFixedAmountGroup');
        const fixedAmountInput = document.getElementById('editShiftFixedAmount');

        if (this.checked) {
            // Uncheck fixed pay if double pay is selected
            fixedPayCheckbox.checked = false;
            fixedAmountGroup.style.display = 'none';
            fixedAmountInput.required = false;
            fixedAmountInput.value = '';
        }
    });

    if (mobileSummaryCard) {
        mobileSummaryCard.addEventListener('click', function () {
            if (isMobileLayout()) openPeriodSelectModal();
        });
        mobileSummaryCard.addEventListener('keydown', function (e) {
            if (isMobileLayout() && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                openPeriodSelectModal();
            }
        });
    }
    if (periodSelectModalClose) periodSelectModalClose.addEventListener('click', closePeriodSelectModal);
    if (periodSelectModal) periodSelectModal.addEventListener('click', function (e) { if (e.target === periodSelectModal) closePeriodSelectModal(); });

    branchSelect.addEventListener('change', function () {
        localStorage.removeItem('last_selected_branch');
        localStorage.setItem('last_selected_branch', this.value);
        applyBranchFilterChange();
    });

    refreshBtn.addEventListener('click', function () {
        clearAllPeriodCaches();
        clearSingleUserCaches(); // Also clear single user caches
        refreshBtn.dataset.forceRefresh = 'true';
        
        // If we're in single employee view, use fast loading
        if (currentEmployeeView) {
            console.log('🔄 Refresh in single employee view, using fast loading for:', currentEmployeeView);
            const container = document.getElementById('employee-details-table');
            if (container) {
                loadSingleEmployeeData(currentEmployeeView).then(employeeData => {
                    loadEmployeeDetailsAsMainTable(currentEmployeeView, container, employeeData);
                }).catch(error => {
                    console.error("Error refreshing single employee:", error);
                    container.innerHTML = '<div class="error">Error refreshing employee data</div>';
                });
            }
        } else {
            // Main view - load all employees
            console.log('🔄 Refresh in main view, loading all employees');
            loadData();
        }
    });
    
    exportBtn.addEventListener('click', exportToCSV);
    document.getElementById('exportPayrollBtn').addEventListener('click', exportPayrollCSV); // Add this line

    // Holiday modal event listeners
    closeHolidaysModal.addEventListener('click', closeHolidaysModalFunc);
    closeHolidaysBtn.addEventListener('click', closeHolidaysModalFunc);
    addHolidayForm.addEventListener('submit', saveNewHoliday);
    
    // Toggle for past holidays
    const showPastHolidaysCheckbox = document.getElementById('showPastHolidays');
    if (showPastHolidaysCheckbox) {
        showPastHolidaysCheckbox.addEventListener('change', renderHolidaysTable);
    }
    
    // Bulk import event listeners - will be set up when modal opens

    // Add event listener for fixed pay checkbox
    editShiftFixedPay.addEventListener('change', function () {
        if (this.checked) {
            editShiftFixedAmountGroup.style.display = 'block';
            editShiftFixedAmount.required = true;
        } else {
            editShiftFixedAmountGroup.style.display = 'none';
            editShiftFixedAmount.required = false;
            editShiftFixedAmount.value = '';
        }
    });

    // Check for any previously selected period or branch
    const lastSelectedPeriod = localStorage.getItem('last_selected_period');
    const lastSelectedBranch = localStorage.getItem('last_selected_branch');

    if (lastSelectedBranch) {
        branchSelect.value = lastSelectedBranch;
    }

    if (lastSelectedPeriod) {
        const isValidSelection = window.payrollPeriods &&
            window.payrollPeriods.some(p => p.id === lastSelectedPeriod);

        if (isValidSelection) {
            periodSelect.value = lastSelectedPeriod;
        }
    }

    // Load initial data (this will use cache if available)
    await loadData();

    restoreEmployeeView();

    // Re-render when crossing mobile breakpoint (table vs cards)
    let lastMobile = isMobileLayout();
    window.matchMedia('(max-width: 992px)').addEventListener('change', function () {
        const now = isMobileLayout();
        if (now !== lastMobile) {
            lastMobile = now;
            if (!now && employeeDetailMobileModal && employeeDetailMobileModal.style.display === 'flex') {
                closeMobileEmployeeDetail();
            }
            filterData({ skipPaymentFetch: true });
        }
    });

    // Single background refresh + debounced tab-visible reconcile
    setupBackgroundRefresh();

    // After initial load, hide the loading overlay and mark as initialized
    isInitialLoad = false;
    console.timeEnd('app-init');
});

// Holiday management functions
function openHolidaysModal() {
    renderHolidaysTable();
    holidaysModal.style.display = 'flex';
    
    // Setup bulk import listener when modal opens
    const bulkHolidayFileInput = document.getElementById('bulkHolidayFileInput');
    
    if (bulkHolidayFileInput) {
        // Remove old listener
        const newInput = bulkHolidayFileInput.cloneNode(true);
        bulkHolidayFileInput.replaceWith(newInput);
        
        // Get fresh reference and add listener
        const input = document.getElementById('bulkHolidayFileInput');
        input.onchange = function(e) {
            console.log('File selected:', this.files);
            if (this.files && this.files[0]) {
                importBulkHolidays();
            }
        };
    }
}

function closeHolidaysModalFunc() {
    holidaysModal.style.display = 'none';
}

function renderHolidaysTable() {
    holidaysTableBody.innerHTML = '';

    // Get toggle state
    const showPastHolidays = document.getElementById('showPastHolidays')?.checked || false;
    
    // Get today's date (start of day for comparison)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Convert HOLIDAYS_2025 object to array and sort by date
    let holidayArray = Object.entries(HOLIDAYS_2025)
        .map(([date, holiday]) => ({ date, ...holiday }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Filter out past holidays if toggle is off
    if (!showPastHolidays) {
        holidayArray = holidayArray.filter(holiday => {
            const holidayDate = new Date(holiday.date + 'T00:00:00');
            return holidayDate >= today;
        });
    }

    holidayArray.forEach(holiday => {
        const row = document.createElement('tr');
        const formattedDate = new Date(holiday.date).toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        row.innerHTML = `
            <td>${formattedDate}</td>
            <td>${holiday.name}</td>
            <td>
                <span class="holiday-type-badge ${holiday.type}">
                    ${holiday.type === 'regular' ? 'Regular' : 'Special'}
                </span>
            </td>
            <td>
                <button class="action-btn delete-holiday-btn" data-date="${holiday.date}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="m19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="m8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                    </svg>
                    Delete
                </button>
            </td>
        `;

        holidaysTableBody.appendChild(row);
    });

    // Add event listeners for delete buttons
    holidaysTableBody.querySelectorAll('.delete-holiday-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const dateStr = this.dataset.date;
            deleteHoliday(dateStr);
        });
    });
}

async function saveNewHoliday(e) {
    e.preventDefault();

    const date = document.getElementById('holidayDate').value;
    const name = document.getElementById('holidayName').value.trim();
    const type = document.getElementById('holidayType').value;

    if (!date || !name) {
        alert('Please fill in all required fields.');
        return;
    }

    // Check if holiday already exists
    if (HOLIDAYS_2025[date]) {
        alert('A holiday already exists on this date.');
        return;
    }

    try {
        // Add to local HOLIDAYS_2025 object
        HOLIDAYS_2025[date] = { name, type };

        // Save to Firebase
        await setDoc(doc(db, "config", "holidays_2025"), HOLIDAYS_2025);

        // Clear form
        addHolidayForm.reset();

        // Refresh the table
        renderHolidaysTable();

        // Update summary cards if needed
        updateSummaryCards();

        showToast(`Holiday "${name}" added successfully`);
        console.log(`Holiday added: ${date} - ${name} (${type})`);
    } catch (error) {
        console.error('Error adding holiday:', error);
        alert('Failed to add holiday. Please try again.');
    }
}

async function deleteHoliday(dateStr) {
    const holiday = HOLIDAYS_2025[dateStr];
    if (!holiday) return;

    if (!confirm(`Are you sure you want to delete "${holiday.name}"?`)) {
        return;
    }

    try {
        // Remove from local object
        delete HOLIDAYS_2025[dateStr];

        // Save to Firebase
        await setDoc(doc(db, "config", "holidays_2025"), HOLIDAYS_2025);

        // Refresh the table
        renderHolidaysTable();

        // Update summary cards
        updateSummaryCards();

        showToast(`Holiday "${holiday.name}" deleted successfully`);
        console.log(`Holiday deleted: ${dateStr}`);
    } catch (error) {
        console.error('Error deleting holiday:', error);
        alert('Failed to delete holiday. Please try again.');
    }
}

// Bulk import functions
async function importBulkHolidays() {
    const bulkHolidayFileInput = document.getElementById('bulkHolidayFileInput');
    const overwrite = document.getElementById('bulkImportOverwrite').checked;
    
    // Check if file is selected
    if (!bulkHolidayFileInput || !bulkHolidayFileInput.files || !bulkHolidayFileInput.files[0]) {
        alert('Please select a JSON file.');
        return;
    }
    
    const file = bulkHolidayFileInput.files[0];
    
    // Read file
    let jsonText;
    try {
        jsonText = await file.text();
    } catch (error) {
        alert('Failed to read file: ' + error.message);
        return;
    }
    
    let holidays;
    try {
        holidays = JSON.parse(jsonText);
    } catch (error) {
        alert('Invalid JSON format. Please check your JSON syntax.');
        console.error('JSON parse error:', error);
        return;
    }
    
    if (!Array.isArray(holidays)) {
        alert('JSON must be an array of holiday objects.');
        return;
    }
    
    if (holidays.length === 0) {
        alert('Holiday array is empty.');
        return;
    }
    
    // Validate each holiday object
    const validHolidays = [];
    const errors = [];
    
    holidays.forEach((holiday, index) => {
        if (!holiday.date || !holiday.name || !holiday.type) {
            errors.push(`Holiday at index ${index}: Missing required fields (date, name, or type)`);
            return;
        }
        
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(holiday.date)) {
            errors.push(`Holiday at index ${index}: Invalid date format "${holiday.date}". Use YYYY-MM-DD format.`);
            return;
        }
        
        // Validate type
        if (holiday.type !== 'regular' && holiday.type !== 'special') {
            errors.push(`Holiday at index ${index}: Invalid type "${holiday.type}". Must be "regular" or "special".`);
            return;
        }
        
        // Check for duplicates in import
        if (validHolidays.some(h => h.date === holiday.date)) {
            errors.push(`Holiday at index ${index}: Duplicate date "${holiday.date}" in import data.`);
            return;
        }
        
        // Check if holiday already exists (unless overwrite is enabled)
        if (!overwrite && HOLIDAYS_2025[holiday.date]) {
            errors.push(`Holiday at index ${index}: "${holiday.name}" already exists on ${holiday.date}. Enable "Overwrite" to replace.`);
            return;
        }
        
        validHolidays.push({
            date: holiday.date,
            name: holiday.name.trim(),
            type: holiday.type
        });
    });
    
    if (errors.length > 0) {
        const errorMessage = `Validation errors:\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n\n... and ${errors.length - 10} more errors.` : ''}`;
        if (!confirm(`${errorMessage}\n\nDo you want to import the ${validHolidays.length} valid holidays anyway?`)) {
            return;
        }
    }
    
    if (validHolidays.length === 0) {
        alert('No valid holidays to import.');
        return;
    }
    
    try {
        // Add holidays to local object
        let addedCount = 0;
        let updatedCount = 0;
        
        validHolidays.forEach(holiday => {
            const existed = HOLIDAYS_2025[holiday.date] ? true : false;
            HOLIDAYS_2025[holiday.date] = {
                name: holiday.name,
                type: holiday.type
            };
            
            if (existed) {
                updatedCount++;
            } else {
                addedCount++;
            }
        });
        
        // Save to Firebase
        await setDoc(doc(db, "config", "holidays_2025"), HOLIDAYS_2025);
        
        // Clear the file input
        if (bulkHolidayFileInput) {
            bulkHolidayFileInput.value = '';
        }
        
        // Refresh the table
        renderHolidaysTable();
        
        // Update summary cards
        updateSummaryCards();
        
        // Show success message
        const message = `Successfully imported ${validHolidays.length} holidays (${addedCount} added, ${updatedCount} updated)`;
        showToast(message);
        console.log(message);
        
        if (errors.length > 0) {
            console.warn('Import completed with errors:', errors);
        }
    } catch (error) {
        console.error('Error importing holidays:', error);
        alert('Failed to import holidays: ' + error.message);
    }
}

// Open add shift modal
function openAddShiftModal(employeeId) {
    addShiftEmployeeId.value = employeeId;

    // Set date picker limits to current payroll period
    const { startDate, endDate } = getPeriodDates(periodSelect.value);
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    addShiftDate.setAttribute('min', startDateStr);
    addShiftDate.setAttribute('max', endDateStr);

    // Find the next available date after the most recent entry
    let nextAvailableDate = startDate;
    
    if (attendanceData[employeeId] && attendanceData[employeeId].dates && attendanceData[employeeId].dates.length > 0) {
        // Get the most recent date in the current period
        const currentPeriodDates = attendanceData[employeeId].dates.filter(d => {
            const entryDate = new Date(d.date);
            return entryDate >= startDate && entryDate <= endDate;
        });
        
        if (currentPeriodDates.length > 0) {
            // Sort by date and get the latest one
            currentPeriodDates.sort((a, b) => new Date(b.date) - new Date(a.date));
            const mostRecentDate = new Date(currentPeriodDates[0].date);
            
            // Calculate next day
            const nextDay = new Date(mostRecentDate);
            nextDay.setDate(mostRecentDate.getDate() + 1);
            
            // Make sure it's within the payroll period
            if (nextDay >= startDate && nextDay <= endDate) {
                nextAvailableDate = nextDay;
            }
        }
    }

    // Set default values
    addShiftDate.value = formatDate(nextAvailableDate);
    addShiftBranch.value = 'Podium';
    addShiftSchedule.value = 'Opening';
    addShiftTimeIn.value = '09:30';
    addShiftTimeOut.value = '18:30';
    
    // Reset scheduled times fields (hidden by default for non-Custom shifts)
    const addShiftScheduledIn = document.getElementById('addShiftScheduledIn');
    const addShiftScheduledOut = document.getElementById('addShiftScheduledOut');
    if (addShiftScheduledIn) addShiftScheduledIn.value = '';
    if (addShiftScheduledOut) addShiftScheduledOut.value = '';
    toggleScheduledTimesFields('add', 'Opening'); // Hide scheduled times fields
    
    // Set default values for new fields
    addShiftDoublePay.checked = false;
    addShiftFixedPay.checked = false;
    addShiftFixedAmount.value = '';
    addShiftFixedAmountGroup.style.display = 'none';
    addShiftMealAllowance.checked = true;
    applyMealAllowanceControlState(addShiftMealAllowance, attendanceData[employeeId]);
    addShiftTranspoAllowance.value = '0';
    addShiftOTPay.checked = false;
    if (addShiftPaidLeave) {
        addShiftPaidLeave.checked = false;
        togglePaidLeaveMode('add', false);
    }

    // Update time placeholders based on selected schedule
    updateTimePlaceholders();

    addShiftModal.style.display = 'flex';
}

// Close add shift modal
function closeAddShiftModalFunc() {
    addShiftModal.style.display = 'none';
}

// Save new shift
async function saveNewShift(e) {
    e.preventDefault();

    const employeeId = addShiftEmployeeId.value;
    const dateStr = addShiftDate.value;
    const isPaidLeave = document.getElementById('addShiftPaidLeave')?.checked === true;

    if (!dateStr) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }

    if (isPaidLeave) {
        try {
            const docRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                if (!confirm('A record already exists for this date. Do you want to overwrite it with paid leave?')) {
                    return;
                }
            }

            await setDoc(docRef, {
                isPaidLeave: true,
                hasMealAllowance: false,
                notes: 'Paid leave'
            });

            if (!attendanceData[employeeId]) {
                attendanceData[employeeId] = {
                    id: employeeId,
                    name: employees[employeeId],
                    dates: [],
                    lastClockIn: null,
                    lastClockInPhoto: null,
                    daysWorked: 0,
                    lateHours: 0,
                    baseRate: 0
                };
            }

            const leaveEntry = {
                date: dateStr,
                branch: 'N/A',
                shift: 'Custom',
                scheduledIn: null,
                scheduledOut: null,
                timeIn: null,
                timeOut: null,
                timeInPhoto: null,
                timeOutPhoto: null,
                hasDoublePay: false,
                hasFixedPay: false,
                fixedPayAmount: 0,
                hasMealAllowance: false,
                transpoAllowance: 0,
                hasOTPay: false,
                isPaidLeave: true
            };

            attendanceData[employeeId].dates = attendanceData[employeeId].dates.filter(d => d.date !== dateStr);
            attendanceData[employeeId].dates.push(leaveEntry);

            const periodId = periodSelect.value;
            const branchId = branchSelect.value;
            saveToCache(getCacheKey(periodId, branchId), attendanceData);
            filterData();

            if (currentEmployeeView === employeeId) {
                const container = document.getElementById('employee-details-table');
                if (container) loadEmployeeDetailsAsMainTable(employeeId, container);
            }

            closeAddShiftModalFunc();
            showToast('Paid leave added successfully!');
        } catch (error) {
            console.error('Error adding paid leave:', error);
            showToast('Failed to add paid leave. Please try again.', 'error');
        }
        return;
    }

    const branch = addShiftBranch.value;
    const shift = addShiftSchedule.value;
    const timeIn = convertTo12HourFormat(addShiftTimeIn.value);
    const timeOut = convertTo12HourFormat(addShiftTimeOut.value);
    const hasDoublePay = addShiftDoublePay.checked;
    const hasFixedPay = addShiftFixedPay.checked;
    const fixedPayAmount = hasFixedPay ? parseFloat(addShiftFixedAmount.value) || 0 : 0;
    const hasMealAllowance = employeeIncludesMealAllowance(attendanceData[employeeId])
        ? addShiftMealAllowance.checked
        : false;
    const transpoAllowance = parseFloat(addShiftTranspoAllowance.value) || 0;
    const hasOTPay = addShiftOTPay.checked;

    // Get scheduled times for Custom shifts
    const addShiftScheduledIn = document.getElementById('addShiftScheduledIn');
    const addShiftScheduledOut = document.getElementById('addShiftScheduledOut');
    const scheduledIn = (shift === 'Custom' && addShiftScheduledIn?.value) ? convertTo12HourFormat(addShiftScheduledIn.value) : null;
    const scheduledOut = (shift === 'Custom' && addShiftScheduledOut?.value) ? convertTo12HourFormat(addShiftScheduledOut.value) : null;

    if (!dateStr || !timeIn || !timeOut) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }
    
    if (hasFixedPay && fixedPayAmount <= 0) {
        showToast('Please enter a valid fixed pay amount.', 'error');
        return;
    }

    try {
        // Check if shift already exists for this date
        const docRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            if (!confirm('A shift already exists for this date. Do you want to overwrite it?')) {
                return;
            }
        }

        // Create the shift data
        const shiftData = {
            clockIn: {
                time: timeIn,
                branch: branch,
                shift: shift
            },
            clockOut: {
                time: timeOut
            },
            hasDoublePay: hasDoublePay,
            hasFixedPay: hasFixedPay,
            fixedPayAmount: fixedPayAmount,
            hasMealAllowance: hasMealAllowance,
            transpoAllowance: transpoAllowance,
            hasOTPay: hasOTPay,
            isPaidLeave: false
        };

        // Add scheduled times for Custom shifts
        if (shift === 'Custom') {
            if (scheduledIn) shiftData.scheduledIn = scheduledIn;
            if (scheduledOut) shiftData.scheduledOut = scheduledOut;
        }

        // Save to Firebase
        await setDoc(docRef, shiftData);

        // Update local data
        if (!attendanceData[employeeId]) {
            attendanceData[employeeId] = {
                id: employeeId,
                name: employees[employeeId],
                dates: [],
                lastClockIn: null,
                lastClockInPhoto: null,
                daysWorked: 0,
                lateHours: 0,
                baseRate: 0
            };
        }

        // Set scheduled times based on shift type
        let scheduledInValue, scheduledOutValue;
        if (shift === 'Custom') {
            scheduledInValue = scheduledIn || null;
            scheduledOutValue = scheduledOut || null;
        } else {
            const shiftSchedule = SHIFT_SCHEDULES[shift] || SHIFT_SCHEDULES["Custom"];
            scheduledInValue = shiftSchedule.timeIn;
            scheduledOutValue = shiftSchedule.timeOut;
        }

        const newEntry = {
            date: dateStr,
            branch: branch,
            shift: shift,
            scheduledIn: scheduledInValue,
            scheduledOut: scheduledOutValue,
            timeIn: timeIn,
            timeOut: timeOut,
            timeInPhoto: null,
            timeOutPhoto: null,
            hasDoublePay: hasDoublePay,
            hasFixedPay: hasFixedPay,
            fixedPayAmount: fixedPayAmount,
            hasMealAllowance: hasMealAllowance,
            transpoAllowance: transpoAllowance,
            hasOTPay: hasOTPay,
            isPaidLeave: false
        };

        // Remove existing entry if it exists
        attendanceData[employeeId].dates = attendanceData[employeeId].dates.filter(d => d.date !== dateStr);

        // Add new entry
        attendanceData[employeeId].dates.push(newEntry);

        // Update cache
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        // Refresh the view
        filterData();

        // Reload employee details if in single view
        if (currentEmployeeView === employeeId) {
            const container = document.getElementById('employee-details-table');
            if (container) {
                loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        closeAddShiftModalFunc();
        showToast('Shift added successfully!');

    } catch (error) {
        console.error('Error adding shift:', error);
        showToast('Failed to add shift. Please try again.', 'error');
    }
}

function emptyPayrollBankAccount() {
    return { accountName: '', accountNumber: '', qrUrl: '' };
}

function readPayrollBankAccounts(details) {
    const result = { gotyme: emptyPayrollBankAccount(), bdo: emptyPayrollBankAccount() };
    const stored = details?.bankAccounts || {};
    for (const key of ['gotyme', 'bdo']) {
        const slot = stored[key];
        if (slot && typeof slot === 'object') {
            result[key] = {
                accountName: String(slot.accountName || '').trim(),
                accountNumber: String(slot.accountNumber || '').replace(/\D/g, ''),
                qrUrl: String(slot.qrUrl || '').trim()
            };
        }
    }
    const legacyKey = String(details?.bankName || '').trim().toLowerCase();
    if ((legacyKey === 'gotyme' || legacyKey === 'bdo') && !result[legacyKey].accountNumber) {
        result[legacyKey].accountName = String(details?.bankAccountName || '').trim();
        result[legacyKey].accountNumber = String(details?.bankAccountNumber || '').replace(/\D/g, '');
    }
    if (!result.gotyme.qrUrl && details?.gotymeQrUrl) result.gotyme.qrUrl = String(details.gotymeQrUrl).trim();
    if (!result.bdo.qrUrl && details?.bdoQrUrl) result.bdo.qrUrl = String(details.bdoQrUrl).trim();
    return result;
}

async function getEmployeeBankDetails(employeeId) {
    const cached = attendanceData[employeeId] || filteredData[employeeId];
    if (cached && (cached.bankAccounts || cached.gotymeQrUrl || cached.bdoQrUrl || cached.bankAccountNumber)) {
        return cached;
    }
    try {
        const snap = await getDoc(doc(db, 'employees_v2', employeeId));
        if (snap.exists()) return snap.data() || {};
    } catch (error) {
        console.warn('Could not load staff bank details:', error);
    }
    return cached || {};
}

async function getEmployeeContactInfo(employeeId) {
    const cached = attendanceData[employeeId] || filteredData[employeeId] || {};
    let email = String(cached.email || '').trim();
    let phone = String(cached.phone || '').trim();
    if (email && phone) return { email, phone };
    try {
        const snap = await getDoc(doc(db, 'employees_v2', employeeId));
        if (snap.exists()) {
            const data = snap.data() || {};
            if (!email) email = String(data.email || '').trim();
            if (!phone) phone = String(data.phone || '').trim();
        }
    } catch (error) {
        console.warn('Could not load staff contact info:', error);
    }
    return { email, phone };
}

function formatPayrollPhp(amount) {
    const n = Number(amount) || 0;
    return `₱${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPayrollPayDateLabel(periodId) {
    try {
        const iso = payDayIsoFromPeriodId(periodId);
        if (!iso) return '';
        const dt = new Date(`${iso}T00:00:00`);
        if (Number.isNaN(dt.getTime())) return '';
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
        return '';
    }
}

function transferMethodLabel(method) {
    const key = String(method || '').toLowerCase();
    if (key === 'gotyme') return 'GoTyme';
    if (key === 'bdo') return 'BDO';
    return method ? String(method) : '—';
}

async function uploadPayrollStatementPdf({ periodId, employeeId, blob, filename }) {
    const safeName = String(filename || 'payslip.pdf').replace(/[^\w.\-]+/g, '_');
    const path = `payroll_periods_v2_statements/${periodId}/${employeeId}_${Date.now()}_${safeName}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, blob, { contentType: 'application/pdf' });
    return getDownloadURL(fileRef);
}

function buildPayrollPaymentEmailHtml({
    employeeName,
    periodLabel,
    paymentAmount,
    paymentType,
    paidTotal,
    remainingAmount,
    transferMethod,
    accountName,
    accountNumber,
    statementUrl,
    note
}) {
    const methodLabel = transferMethodLabel(transferMethod);
    const amountStr = formatPayrollPhp(paymentAmount);
    const remaining = Math.max(0, Number(remainingAmount) || 0);
    const isPartial = String(paymentType || '').toLowerCase() === 'partial' || remaining > 0.009;
    const noteText = String(note || '').trim();
    const acctName = String(accountName || '').trim() || '—';
    const acctNumber = String(accountNumber || '').trim() || '—';
    const name = String(employeeName || 'there').trim() || 'there';

    let partialBlock = '';
    if (isPartial) {
        partialBlock = `
            <tr>
              <td style="padding:0 0 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e8;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:14px;line-height:1.5;color:#7a5b12;">
                      <strong>Partial payment</strong><br>
                      Already paid this period: <strong>${escapeHtml(formatPayrollPhp(paidTotal))}</strong><br>
                      Remaining: <strong>${escapeHtml(formatPayrollPhp(remaining))}</strong>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
    }

    const noteBlock = noteText
        ? `<tr><td style="padding:0 0 16px;font-size:14px;color:#555;line-height:1.5;"><strong>Note:</strong> ${escapeHtml(noteText)}</td></tr>`
        : '';

    const ctaBlock = statementUrl
        ? `<tr>
              <td style="padding:8px 0 24px;" align="center">
                <a href="${escapeHtml(statementUrl)}" style="display:inline-block;background:#2b9348;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:10px;">Download payroll statement</a>
              </td>
            </tr>`
        : '';

    return `
<div style="margin:0;padding:0;background:#f4f7f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3eee6;">
          <tr>
            <td style="background:#eef9f0;padding:22px 24px;">
              <img src="https://matchanese.com/cdn/shop/files/matchanese-2025-logo_e4944ef8-b626-4206-80c5-cc4fd9ed79ab.png?v=1738086945&width=60" alt="Matchanese" style="max-height:40px;display:block;margin-bottom:12px;" />
              <div style="font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#2b9348;font-weight:700;">Payroll paid</div>
              <div style="font-size:26px;line-height:1.2;font-weight:700;color:#1f2933;margin-top:6px;">${escapeHtml(amountStr)}</div>
              <div style="font-size:14px;color:#5b6b63;margin-top:6px;">${escapeHtml(periodLabel || '')}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 0 16px;font-size:15px;line-height:1.55;color:#333;">
                    Hi ${escapeHtml(name)},<br><br>
                    Your payroll payment has been sent.
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fbf8;border-radius:10px;">
                      <tr>
                        <td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#333;">
                          <div style="font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#6b7c74;font-weight:700;margin-bottom:6px;">Sent to</div>
                          <div><strong>${escapeHtml(methodLabel)}</strong></div>
                          <div>${escapeHtml(acctName)}</div>
                          <div style="font-family:Consolas,Monaco,monospace;letter-spacing:0.02em;">${escapeHtml(acctNumber)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${partialBlock}
                ${noteBlock}
                ${ctaBlock}
                <tr>
                  <td style="padding-top:8px;border-top:1px solid #e8efe9;font-size:12px;color:#88948e;line-height:1.5;">
                    Matchanese Payroll
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

async function sendPayrollPaymentEmail({
    to,
    employeeName,
    periodId,
    periodLabel,
    paymentAmount,
    paymentType,
    paidTotal,
    remainingAmount,
    transferMethod,
    accountName,
    accountNumber,
    statementUrl,
    note
}) {
    const EMAILJS_SERVICE_ID = 'service_1085n74';
    const EMAILJS_TEMPLATE_ID = 'template_6zh5mq8';
    const EMAILJS_PUBLIC_KEY = 'Jxzqofh9mPAsb9V0M';

    const recipient = String(to || '').trim();
    if (!recipient) return { skipped: true, reason: 'no_email' };

    if (typeof emailjs === 'undefined') {
        console.warn('EmailJS not loaded — skipping payroll payment email');
        return { skipped: true, reason: 'emailjs_missing' };
    }

    emailjs.init(EMAILJS_PUBLIC_KEY);

    const payDateLabel = formatPayrollPayDateLabel(periodId);
    const subject = payDateLabel
        ? `Your payroll for ${payDateLabel} has been sent`
        : 'Your payroll has been sent';
    const message = buildPayrollPaymentEmailHtml({
        employeeName,
        periodLabel,
        paymentAmount,
        paymentType,
        paidTotal,
        remainingAmount,
        transferMethod,
        accountName,
        accountNumber,
        statementUrl,
        note
    });

    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: recipient,
        from_name: 'Matchanese Payroll',
        subject,
        message,
        payslip_pdf: statementUrl || ''
    });

    return { ok: true, to: recipient, subject };
}

async function notifyPayrollPaymentAfterSave({
    employeeId,
    periodId,
    transferMethod,
    paymentAmount,
    paymentData,
    note = '',
    overrideToEmail = null
}) {
    try {
        const contact = await getEmployeeContactInfo(employeeId);
        const to = String(overrideToEmail || contact.email || '').trim();
        if (!to) {
            console.log('[Payroll email] No employee email — skipping notify');
            return { skipped: true, reason: 'no_email' };
        }

        const bankDetails = await getEmployeeBankDetails(employeeId);
        const accounts = readPayrollBankAccounts(bankDetails);
        const methodKey = String(transferMethod || '').toLowerCase();
        const acc = accounts[methodKey] || emptyPayrollBankAccount();

        const employee = filteredData[employeeId] || attendanceData[employeeId] || {};
        const employeeName = employee.name || employees[employeeId] || employeeId;

        let statementUrl = '';
        try {
            const built = await buildAdminEmployeePayslipPdf(employeeId);
            statementUrl = await uploadPayrollStatementPdf({
                periodId: periodId || built.periodId,
                employeeId,
                blob: built.blob,
                filename: built.filename
            });
        } catch (pdfErr) {
            console.warn('[Payroll email] Statement PDF/upload failed:', pdfErr);
            if (!payModeState.open) {
                showToast('Payment saved, but payslip upload failed', 'warning');
            }
        }

        const periodOpt = periodSelect?.options?.[periodSelect.selectedIndex];
        const periodLabel = periodOpt ? periodOpt.textContent : (periodId || '');

        await sendPayrollPaymentEmail({
            to,
            employeeName,
            periodId,
            periodLabel,
            paymentAmount,
            paymentType: paymentData?.paymentType,
            paidTotal: paymentData?.paymentAmount,
            remainingAmount: paymentData?.remainingAmount,
            transferMethod,
            accountName: acc.accountName,
            accountNumber: acc.accountNumber,
            statementUrl,
            note
        });

        console.log('[Payroll email] Payment confirmation sent to', to);
        return { ok: true, to, statementUrl };
    } catch (err) {
        console.warn('[Payroll email] Notify failed:', err);
        if (!payModeState.open) {
            showToast('Payment saved, but email notify failed', 'warning');
        }
        return { ok: false, error: err };
    }
}

window.getEmployeeContactInfo = getEmployeeContactInfo;
window.sendPayrollPaymentEmail = sendPayrollPaymentEmail;
window.notifyPayrollPaymentAfterSave = notifyPayrollPaymentAfterSave;

async function sendSamplePayrollPaymentEmail(toEmail = 'david.toph@gmail.com') {
    const periodId = periodSelect?.value;
    let employeeId = document.getElementById('paymentEmployeeId')?.value
        || payModeState?.queue?.[payModeState.index]?.employeeId
        || null;

    if (!employeeId) {
        const pool = filteredData && Object.keys(filteredData).length ? filteredData : attendanceData;
        let bestId = null;
        let bestPay = -1;
        Object.keys(pool || {}).forEach((id) => {
            const emp = pool[id];
            const pay = Number(calcTotalPaySimple?.(emp?.dates, emp, periodId))
                || Number(emp?.totalPayWithBonus)
                || 0;
            if (pay > bestPay) {
                bestPay = pay;
                bestId = id;
            }
        });
        employeeId = bestId;
    }

    if (!employeeId || !periodId) {
        throw new Error('Load a payroll period with employees before sending a sample');
    }

    const bankDetails = await getEmployeeBankDetails(employeeId);
    const accounts = readPayrollBankAccounts(bankDetails);
    const methods = Object.keys(accounts).filter((k) => accounts[k]?.accountNumber || accounts[k]?.qrUrl);
    const transferMethod = methods[0] || 'gotyme';
    const acc = accounts[transferMethod] || emptyPayrollBankAccount();
    const employee = filteredData[employeeId] || attendanceData[employeeId] || {};
    const employeeName = employee.name || employees[employeeId] || employeeId;

    const built = await buildAdminEmployeePayslipPdf(employeeId);
    if (!(Number(built.grandTotal) > 0)) {
        throw new Error('Selected employee has ₱0 for this period — pick someone with attendance first');
    }

    const statementUrl = await uploadPayrollStatementPdf({
        periodId,
        employeeId,
        blob: built.blob,
        filename: built.filename
    });

    const periodOpt = periodSelect.options[periodSelect.selectedIndex];
    const periodLabel = periodOpt ? periodOpt.textContent : periodId;
    const sampleAmount = Number(built.grandTotal) || 0;

    const result = await sendPayrollPaymentEmail({
        to: toEmail,
        employeeName,
        periodId,
        periodLabel,
        paymentAmount: sampleAmount,
        paymentType: 'full',
        paidTotal: sampleAmount,
        remainingAmount: 0,
        transferMethod,
        accountName: acc.accountName || 'Sample Account',
        accountNumber: acc.accountNumber || '0000000000',
        statementUrl,
        note: ''
    });

    showToast(`Sample payroll email sent to ${toEmail}`, 'success');
    return { ...result, employeeId, periodId, statementUrl, employeeName, grandTotal: built.grandTotal };
}

window.sendSamplePayrollPaymentEmail = sendSamplePayrollPaymentEmail;

function isDisbursementPeriod() {
    const periodId = periodSelect?.value;
    if (!periodId) return false;
    const { endDate } = getPeriodDates(periodId);
    return new Date() > endDate;
}

function highlightPaymentRecipientCards() {
    const method = (document.getElementById('paymentMethod')?.value || '').toLowerCase();
    document.querySelectorAll('#paymentRecipientList .payment-recipient-card').forEach((card) => {
        card.classList.toggle('is-active', Boolean(method) && card.dataset.bank === method);
    });
}

async function populatePaymentRecipientDetails(employeeId) {
    const group = document.getElementById('paymentRecipientGroup');
    const list = document.getElementById('paymentRecipientList');
    if (!group || !list) return;

    const details = await getEmployeeBankDetails(employeeId);

    const accounts = readPayrollBankAccounts(details);
    const labels = { gotyme: 'GoTyme', bdo: 'BDO' };
    list.innerHTML = '';
    let shown = 0;

    for (const key of ['gotyme', 'bdo']) {
        const acc = accounts[key];
        if (!acc.accountNumber && !acc.qrUrl) continue;
        shown += 1;
        const card = document.createElement('div');
        card.className = 'payment-recipient-card';
        card.dataset.bank = key;

        const meta = document.createElement('div');
        meta.className = 'payment-recipient-meta';

        const bankEl = document.createElement('div');
        bankEl.className = 'payment-recipient-bank';
        bankEl.textContent = labels[key];
        meta.appendChild(bankEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'payment-recipient-name';
        nameEl.textContent = acc.accountName || 'Account name not set';
        meta.appendChild(nameEl);

        const numberEl = document.createElement('button');
        numberEl.type = 'button';
        numberEl.className = 'payment-recipient-number';
        numberEl.title = 'Copy account number';
        numberEl.textContent = acc.accountNumber || 'Account number not set';
        numberEl.disabled = !acc.accountNumber;
        numberEl.onclick = async () => {
            if (!acc.accountNumber) return;
            try {
                await navigator.clipboard.writeText(acc.accountNumber);
                showToast('Account number copied', 'success');
            } catch {
                showToast('Could not copy account number', 'error');
            }
        };
        meta.appendChild(numberEl);

        if (!acc.qrUrl) {
            const missing = document.createElement('p');
            missing.className = 'form-hint';
            missing.style.marginTop = '0.35rem';
            missing.textContent = `No ${labels[key]} QR uploaded yet.`;
            meta.appendChild(missing);
        }

        card.appendChild(meta);

        if (acc.qrUrl) {
            const qrImg = document.createElement('img');
            qrImg.className = 'payment-recipient-qr';
            qrImg.alt = `${labels[key]} QR`;
            qrImg.src = acc.qrUrl;
            qrImg.onclick = () => openPhotoModal(acc.qrUrl);
            card.appendChild(qrImg);
        }

        list.appendChild(card);
    }

    group.style.display = shown ? 'block' : 'none';
    const methodSelect = document.getElementById('paymentMethod');
    if (methodSelect && !methodSelect.dataset.qrHighlightBound) {
        methodSelect.dataset.qrHighlightBound = '1';
        methodSelect.addEventListener('change', highlightPaymentRecipientCards);
    }
    highlightPaymentRecipientCards();
}

// Add these functions
async function openPaymentModal(employeeId) {
    console.log('[Payment] openPaymentModal called, employeeId:', employeeId);
    const modal = document.getElementById('paymentModal');
    const paymentForm = document.getElementById('paymentForm');
    const closeBtn = document.getElementById('closePaymentModal');
    const overlay = document.getElementById('paymentModalLoadingOverlay');
    // Force clean state every time we open: ensure overlay hidden and not blocking clicks
    if (overlay) {
        overlay.style.display = 'none';
        overlay.style.visibility = 'hidden';
        overlay.style.pointerEvents = 'none';
    }
    if (paymentForm) {
        paymentForm.querySelectorAll('input, select, textarea, button').forEach(el => { el.disabled = false; });
    }
    if (closeBtn) closeBtn.style.pointerEvents = 'auto';
    // Move modal to end of body so it stays on top after table re-renders (fixes second-open stuck)
    if (modal) {
        document.body.appendChild(modal);
    }
    console.log('[Payment] openPaymentModal: reset overlay/form/closeBtn');

    const employee = employees[employeeId];
    const employeeData = filteredData[employeeId];
    const currentPeriod = periodSelect.options[periodSelect.selectedIndex].text;
    const periodId = periodSelect.value;

    const nameDisplay = document.getElementById('paymentEmployeeNameDisplay');
    const periodDisplay = document.getElementById('paymentPeriodDisplay');
    if (nameDisplay) nameDisplay.textContent = getEmployeeDisplayName(employeeId, employeeData);
    if (periodDisplay) periodDisplay.textContent = currentPeriod;
    document.getElementById('paymentEmployeeId').value = employeeId;
    document.getElementById('paymentScreenshot').value = '';
    const screenshotNameEl = document.getElementById('paymentScreenshotName');
    if (screenshotNameEl) screenshotNameEl.textContent = 'No file chosen';
    document.getElementById('paymentNote').value = '';
    document.getElementById('paymentMethod').value = 'gotyme'; // Set default to gotyme
    await populatePaymentRecipientDetails(employeeId);
    
    // Calculate total pay for this employee
    const totalPay = employeeData ? calcTotalPaySimple(employeeData.dates, employeeData, periodId) : 0;
    const initialBal = getPaymentBalance(totalPay, null);
    document.getElementById('paymentAmount').value = initialBal.remaining.toFixed(2);
    document.getElementById('paymentAmountHint').textContent = totalPay <= 0
        ? 'Nothing to pay this period (net is zero or negative)'
        : 'Enter amount to pay (full or partial)';

    // Check if payment already exists
    try {
        const paymentRef = v2PaymentDocRef(periodId, employeeId);
        const paymentSnap = await getDoc(paymentRef);

        if (paymentSnap.exists()) {
            const paymentData = paymentSnap.data();
            document.getElementById('paymentNote').value = paymentData.note || '';
            document.getElementById('paymentMethod').value = paymentData.transferMethod || '';
            highlightPaymentRecipientCards();
            
            // Prefill with live remaining (total − already paid), not frozen remainingAmount
            const bal = getPaymentBalance(totalPay, paymentData);
            document.getElementById('paymentAmount').value = bal.remaining.toFixed(2);
            if (bal.surplus > 0) {
                document.getElementById('paymentAmountHint').textContent =
                    `Already ₱${bal.surplus.toFixed(2)} surplus (paid ₱${bal.paid.toFixed(2)} vs total ₱${bal.total.toFixed(2)})`;
            } else if (bal.remaining > 0 && bal.paid > 0) {
                document.getElementById('paymentAmountHint').textContent =
                    `₱${bal.remaining.toFixed(2)} remaining (₱${bal.paid.toFixed(2)} already paid)`;
            }

            // Only show existing photo view if we actually have a screenshot
            if (paymentData.screenshotUrl) {
                // Show existing payment photo and info
                const existingInfo = document.getElementById('existingPaymentInfo');
                const existingPhoto = document.getElementById('existingPaymentPhoto');
                const paymentForm = document.getElementById('paymentForm');
                const updateScreenshotBtn = document.getElementById('updateScreenshotBtn');

                if (existingInfo && existingPhoto) {
                    existingPhoto.src = paymentData.screenshotUrl;
                    existingPhoto.style.display = 'block';
                    existingPhoto.onclick = () => openPhotoModal(paymentData.screenshotUrl);

                    existingInfo.textContent = paymentData.note || 'No note added';
                    existingInfo.style.display = 'block';

                    // Hide form and show update button
                    paymentForm.style.display = 'none';
                    updateScreenshotBtn.style.display = 'block';
                }

                document.querySelector('#paymentForm .submit-btn').textContent = 'Update Payment';
            } else {
                // No screenshot exists, show form directly
                const existingInfo = document.getElementById('existingPaymentInfo');
                const existingPhoto = document.getElementById('existingPaymentPhoto');
                const paymentForm = document.getElementById('paymentForm');
                const updateScreenshotBtn = document.getElementById('updateScreenshotBtn');

                if (existingInfo) existingInfo.style.display = 'none';
                if (existingPhoto) {
                    existingPhoto.style.display = 'none';
                    existingPhoto.onclick = null;
                }

                paymentForm.style.display = 'block';
                updateScreenshotBtn.style.display = 'none';
                document.querySelector('#paymentForm .submit-btn').textContent = 'Confirm Payment';
            }
        } else {
            // No payment record exists, show form directly
            const existingInfo = document.getElementById('existingPaymentInfo');
            const existingPhoto = document.getElementById('existingPaymentPhoto');
            const paymentForm = document.getElementById('paymentForm');
            const updateScreenshotBtn = document.getElementById('updateScreenshotBtn');

            if (existingInfo) existingInfo.style.display = 'none';
            if (existingPhoto) {
                existingPhoto.style.display = 'none';
                existingPhoto.onclick = null;
            }

            paymentForm.style.display = 'block';
            updateScreenshotBtn.style.display = 'none';
            document.querySelector('#paymentForm .submit-btn').textContent = 'Confirm Payment';
        }
    } catch (error) {
        console.error('Error checking existing payment:', error);
    }

    if (modal) modal.style.display = 'flex';
    console.log('[Payment] openPaymentModal done, modal visible');
}

function showUpdateForm() {
    const paymentForm = document.getElementById('paymentForm');
    const updateScreenshotBtn = document.getElementById('updateScreenshotBtn');

    paymentForm.style.display = 'block';
    updateScreenshotBtn.style.display = 'none';
}

// Helper function to get readable transfer method text
function getTransferMethodText(method) {
    const methods = {
        'gotyme': 'GoTyme',
        'bdo': 'BDO',
        'gcash': 'GCash',
        'cash': 'Cash',
        'others': 'Others'
    };
    return methods[method] || method;
}

function closePaymentModal() {
    console.log('[Payment] closePaymentModal called');
    const modal = document.getElementById('paymentModal');
    const loadingOverlay = document.getElementById('paymentModalLoadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
        loadingOverlay.style.visibility = 'hidden';
        loadingOverlay.style.pointerEvents = 'none';
    }
    if (modal) {
        modal.style.display = 'none';
    }
}

async function openAdjustSurplusModal(employeeId) {
    const modal = document.getElementById('adjustSurplusModal');
    if (!modal) return;

    const periodId = periodSelect.value;
    const employee = filteredData[employeeId] || attendanceData[employeeId];
    const totalPay = employee ? getEmployeeTotalPayForTable(employee, periodId) : 0;
    const paymentData = (window.paymentStatus || {})[employeeId];
    const bal = getPaymentBalance(totalPay, paymentData);

    document.getElementById('adjustSurplusEmployeeId').value = employeeId;
    document.getElementById('adjustSurplusEmployeeName').textContent =
        getEmployeeDisplayName(employeeId, employee);
    document.getElementById('adjustSurplusPeriod').textContent =
        periodSelect.options[periodSelect.selectedIndex]?.text || periodId;
    const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('adjustSurplusTotalPay').textContent = peso(totalPay);
    document.getElementById('adjustSurplusRecordedPaid').textContent = peso(bal.paid);
    document.getElementById('adjustSurplusAmount').textContent = peso(bal.surplus);

    const paidInput = document.getElementById('adjustSurplusPaidInput');
    const defaultPaid = Math.max(0, Math.round(Number(totalPay) * 100) / 100);
    paidInput.value = defaultPaid.toFixed(2);
    document.getElementById('adjustSurplusNote').value = '';
    document.getElementById('adjustSurplusHint').textContent =
        defaultPaid > 0
            ? 'Prefilled to period total pay — change if they were only partially paid.'
            : 'Set to 0 or use Clear payment if nothing was actually sent.';

    document.body.appendChild(modal);
    modal.style.display = 'flex';
}

function closeAdjustSurplusModal() {
    const modal = document.getElementById('adjustSurplusModal');
    if (modal) modal.style.display = 'none';
}

async function correctPayrollPaymentAmount({ employeeId, periodId, newPaidAmount, note = '' }) {
    if (!employeeId || !periodId) {
        throw new Error('Missing employee or period');
    }
    if (!navigator.onLine) {
        throw new Error('You are offline. Changes were not saved.');
    }

    const employeeData = filteredData[employeeId] || attendanceData[employeeId];
    const totalPay = employeeData ? getEmployeeTotalPayForTable(employeeData, periodId) : 0;
    const payable = Math.max(0, Math.round((Number(totalPay) || 0) * 100) / 100);
    const paid = Math.max(0, Math.round((Number(newPaidAmount) || 0) * 100) / 100);
    const bal = getPaymentBalance(payable, { paymentAmount: paid });

    const paymentDocRef = v2PaymentDocRef(periodId, employeeId);
    const existingSnap = await getDocFromServer(paymentDocRef);
    const existing = existingSnap.exists() ? (existingSnap.data() || {}) : {};

    const paymentType = bal.surplus > 0
        ? 'surplus'
        : (paid <= 0 ? 'none' : (paid >= payable - 0.009 ? 'full' : 'partial'));

    const paymentData = {
        ...existing,
        employeeId: String(employeeId),
        periodId: String(periodId),
        paymentAmount: paid,
        totalPay: payable,
        remainingAmount: Math.round((payable - paid) * 100) / 100,
        surplusAmount: bal.surplus,
        paymentType,
        correctionNote: String(note || ''),
        correctedAt: new Date().toISOString(),
        correctedBy: 'admin'
    };

    await setDoc(paymentDocRef, paymentData);
    await waitForPendingWrites(db);

    const verifySnap = await getDocFromServer(paymentDocRef);
    if (!verifySnap.exists()) {
        throw new Error('Correction did not save to Firestore');
    }

    applyVerifiedPaymentToLocalState(periodId, employeeId, paymentData);
    return paymentData;
}

async function clearPayrollPaymentRecord(employeeId, periodId) {
    if (!navigator.onLine) {
        throw new Error('You are offline. Changes were not saved.');
    }
    const paymentDocRef = v2PaymentDocRef(periodId, employeeId);
    await deleteDoc(paymentDocRef);
    await waitForPendingWrites(db);

    if (window.paymentStatus && window.paymentStatus[employeeId]) {
        delete window.paymentStatus[employeeId];
    }
    const cachedMap = readPeriodPaymentsCacheMap(periodId) || {};
    if (cachedMap[employeeId]) {
        delete cachedMap[employeeId];
        writePeriodPaymentsCacheMap(periodId, cachedMap);
    }
    const branchId = getSelectedBranchFilter();
    if (attendanceData && Object.keys(attendanceData).length) {
        saveSummaryToCache(periodId, branchId, attendanceData, window.paymentStatus || {});
    }
}

async function saveAdjustSurplusForm(e) {
    e.preventDefault();
    const employeeId = document.getElementById('adjustSurplusEmployeeId').value;
    const periodId = periodSelect.value;
    const newPaid = parseFloat(document.getElementById('adjustSurplusPaidInput').value);
    const note = document.getElementById('adjustSurplusNote').value.trim();
    const submitBtn = e.target.querySelector('button[type="submit"]');

    if (!Number.isFinite(newPaid) || newPaid < 0) {
        showToast('Enter a valid paid amount', 'error');
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    try {
        await correctPayrollPaymentAmount({
            employeeId,
            periodId,
            newPaidAmount: newPaid,
            note
        });
        closeAdjustSurplusModal();
        renderEmployeeTable();
        updateSummaryCards();
        await updateEmployeePaymentStatus(true);
        updatePayModeButtonState();
        showToast('Payment record updated', 'success');
    } catch (err) {
        console.error('Adjust surplus failed:', err);
        showToast(err?.message || 'Could not save correction', 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function handleAdjustSurplusClear() {
    const employeeId = document.getElementById('adjustSurplusEmployeeId').value;
    const periodId = periodSelect.value;
    const name = document.getElementById('adjustSurplusEmployeeName')?.textContent || 'this employee';
    if (!confirm(`Remove the payment record for ${name} this period? They will show as unpaid.`)) {
        return;
    }
    try {
        await clearPayrollPaymentRecord(employeeId, periodId);
        closeAdjustSurplusModal();
        renderEmployeeTable();
        updateSummaryCards();
        await updateEmployeePaymentStatus(true);
        updatePayModeButtonState();
        showToast('Payment record cleared', 'success');
    } catch (err) {
        console.error('Clear payment failed:', err);
        showToast(err?.message || 'Could not clear payment', 'error');
    }
}

async function persistPayrollPayment({ employeeId, periodId, transferMethod, paymentAmount, note = '', screenshotFile = null }) {
    if (!employeeId || !periodId) {
        throw new Error('Missing employee or period for payment');
    }
    if (!navigator.onLine) {
        throw new Error('You are offline. Payment was not saved.');
    }

    let downloadURL = null;

    if (screenshotFile) {
        const filename = `payment_${employeeId}_${periodId}_${Date.now()}.jpg`;
        const fileRef = storageRef(storage, `payroll_periods_v2_screenshots/${filename}`);
        const snapshot = await uploadBytes(fileRef, screenshotFile);
        downloadURL = await getDownloadURL(snapshot.ref);
    }

    const employeeData = filteredData[employeeId] || attendanceData[employeeId];
    // Same total as Pay Mode / table so a full pay clears remaining
    const totalPay = employeeData
        ? getEmployeeTotalPayForTable(employeeData, periodId)
        : 0;

    const paymentDocRef = v2PaymentDocRef(periodId, employeeId);

    // ALWAYS read existing payment from the server — local cache caused
    // fake "already paid" amounts that compounded into huge surplus, then
    // vanished on refresh when the write never actually landed remotely.
    let existingData = {};
    let existingPaymentAmount = 0;
    try {
        const existingPaymentDoc = await getDocFromServer(paymentDocRef);
        if (existingPaymentDoc.exists()) {
            existingData = existingPaymentDoc.data() || {};
            existingPaymentAmount = Number(existingData.paymentAmount) || 0;
        }
    } catch (error) {
        console.error('[Payment] Could not read existing payment from server:', error);
        throw new Error('Could not reach Firestore to save payment. Try again.');
    }

    const payable = Math.max(0, Number(totalPay) || 0);
    const remainingBefore = Math.max(0, Math.round((payable - existingPaymentAmount) * 100) / 100);

    // Already settled on server — do not accumulate or re-email
    if (payable > 0 && remainingBefore <= 0.009) {
        const paymentData = normalizePaymentStatusRecord({
            ...existingData,
            employeeId,
            periodId,
            paymentAmount: existingPaymentAmount,
            totalPay: payable,
            remainingAmount: 0,
            paymentType: existingData.paymentType || 'full'
        });
        applyVerifiedPaymentToLocalState(periodId, employeeId, paymentData);
        return {
            surplusAmount: getPaymentBalance(payable, paymentData).surplus,
            paymentData,
            totalPay: payable,
            alreadyPaid: true,
            newlyPaid: false
        };
    }

    const payNow = Number(paymentAmount) || 0;
    if (payNow <= 0) {
        throw new Error('Payment amount must be greater than zero');
    }

    // Paying the displayed remaining (or more) settles to at least full payable.
    // Cap accidental double-submit overpay: if they click full remaining twice
    // before UI updates, second click is blocked by alreadyPaid above once
    // the first write is on the server.
    let accumulatedPaymentAmount = existingPaymentAmount + payNow;
    // If this click is meant to clear the remaining balance, snap to exact payable
    // when within 1 peso of remaining (avoids tiny float surplus).
    if (Math.abs(payNow - remainingBefore) < 1.01 || payNow >= remainingBefore - 0.009) {
        accumulatedPaymentAmount = Math.max(accumulatedPaymentAmount, payable);
        // If they only intended to pay remaining, don't compound beyond payable
        // unless they explicitly typed a larger custom amount.
        if (payNow <= remainingBefore + 0.05) {
            accumulatedPaymentAmount = payable;
        }
    }

    const balAfter = getPaymentBalance(payable, { paymentAmount: accumulatedPaymentAmount });
    const remainingAmount = payable - accumulatedPaymentAmount;
    const surplusAmount = balAfter.surplus;
    const paymentType = accumulatedPaymentAmount >= payable
        ? (surplusAmount > 0 ? 'surplus' : 'full')
        : 'partial';

    const paymentData = {
        employeeId: String(employeeId),
        periodId: String(periodId),
        screenshotUrl: downloadURL != null ? downloadURL : (existingData.screenshotUrl || null),
        transferMethod: String(transferMethod || ''),
        note: String(note || ''),
        paymentType,
        paymentAmount: Number(accumulatedPaymentAmount) || 0,
        totalPay: Number(payable) || 0,
        remainingAmount: Number(remainingAmount) || 0,
        surplusAmount: Number(surplusAmount) || 0,
        uploadedAt: new Date().toISOString(),
        uploadedBy: 'admin'
    };

    console.log('[Payment] Writing payment doc', {
        path: `payroll_periods_v2/${periodId}/payments/${employeeId}`,
        paymentAmount: paymentData.paymentAmount,
        totalPay: paymentData.totalPay,
        paymentType: paymentData.paymentType,
        existingPaymentAmount,
        payNow
    });

    await setDoc(paymentDocRef, paymentData);
    await waitForPendingWrites(db);

    // Confirm on the SERVER (not local latency cache)
    let verifySnap;
    try {
        verifySnap = await getDocFromServer(paymentDocRef);
    } catch (err) {
        console.error('[Payment] Server verify failed:', err);
        throw new Error('Payment may not have saved. Check connection and try again — no email was sent.');
    }
    if (!verifySnap.exists()) {
        throw new Error('Payment did not save to Firestore');
    }
    const verifiedAmount = Number(verifySnap.data()?.paymentAmount) || 0;
    if (Math.abs(verifiedAmount - paymentData.paymentAmount) > 0.05) {
        throw new Error('Payment save verification failed');
    }
    console.log('[Payment] Server-verified payment doc', verifySnap.data());

    if (accumulatedPaymentAmount >= payable - 0.009) {
        try {
            const markApplied = async (pid, { moveToPeriodId = null } = {}) => {
                const eq = query(
                    collection(db, PERIOD_EARNINGS_COLLECTION),
                    where('periodId', '==', pid),
                    where('employeeId', '==', employeeId)
                );
                const eSnap = await getDocs(eq);
                const updates = [];
                eSnap.forEach((d) => {
                    const r = d.data();
                    if (r.status === 'waived' || r.status === 'applied') return;
                    const patch = { status: 'applied', appliedAt: new Date().toISOString() };
                    if (moveToPeriodId && moveToPeriodId !== pid) {
                        patch.originPeriodId = r.originPeriodId || pid;
                        patch.periodId = moveToPeriodId;
                        patch.payDay = payDayIsoFromPeriodId(moveToPeriodId);
                    }
                    updates.push(updateDoc(d.ref, patch));
                });
                await Promise.all(updates);
            };
            await markApplied(periodId);
            if (isPriorEarningsToggleOn()) {
                const priorIds = getPreviousPeriodIds(periodId, 2, periodsForHelpers());
                for (const pid of priorIds) {
                    await markApplied(pid, { moveToPeriodId: periodId });
                }
            }
        } catch (markErr) {
            console.warn('Could not mark earnings applied:', markErr);
        }
    }

    applyVerifiedPaymentToLocalState(periodId, employeeId, paymentData);

    return {
        surplusAmount,
        paymentData,
        totalPay: payable,
        alreadyPaid: false,
        newlyPaid: true
    };
}

async function savePaymentConfirmation(e) {
    e.preventDefault();
    console.log('[Payment] savePaymentConfirmation called (form submit)');

    const employeeId = document.getElementById('paymentEmployeeId').value;
    const periodId = periodSelect.value;
    const file = document.getElementById('paymentScreenshot').files[0];
    const note = document.getElementById('paymentNote').value.trim();
    const transferMethod = document.getElementById('paymentMethod').value;
    const paymentAmount = parseFloat(document.getElementById('paymentAmount').value) || 0;

    if (!transferMethod) {
        console.log('[Payment] savePaymentConfirmation: validation failed - no transfer method');
        showToast('Please select a transfer method', 'error');
        return;
    }

    if (paymentAmount <= 0) {
        console.log('[Payment] savePaymentConfirmation: validation failed - invalid amount', paymentAmount);
        showToast('Please enter a valid payment amount', 'error');
        return;
    }
    console.log('[Payment] savePaymentConfirmation: validation ok, disabling form and showing overlay');

    const paymentModalLoadingOverlay = document.getElementById('paymentModalLoadingOverlay');
    if (paymentModalLoadingOverlay) {
        paymentModalLoadingOverlay.style.display = 'flex';
        paymentModalLoadingOverlay.style.visibility = 'visible';
        paymentModalLoadingOverlay.style.pointerEvents = 'auto';
    }

    const paymentForm = document.getElementById('paymentForm');
    const submitBtn = paymentForm.querySelector('button[type="submit"]');
    const closeBtn = document.getElementById('closePaymentModal');
    const originalButtonHTML = submitBtn ? submitBtn.innerHTML : '';

    const formInputs = paymentForm.querySelectorAll('input, select, textarea, button');
    formInputs.forEach(input => input.disabled = true);
    if (closeBtn) closeBtn.style.pointerEvents = 'none';
    console.log('[Payment] savePaymentConfirmation: form disabled, starting save...');

    try {
        const { surplusAmount, paymentData, newlyPaid } = await persistPayrollPayment({
            employeeId,
            periodId,
            transferMethod,
            paymentAmount,
            note,
            screenshotFile: file || null
        });

        console.log('[Payment] savePaymentConfirmation: Firestore save ok, updating table...');
        applyVerifiedPaymentToLocalState(periodId, employeeId, paymentData);
        renderEmployeeTable();
        await updateEmployeePaymentStatus(true);

        formInputs.forEach(input => input.disabled = false);
        if (closeBtn) closeBtn.style.pointerEvents = 'auto';
        console.log('[Payment] savePaymentConfirmation: form re-enabled, closing modal');

        if (paymentModalLoadingOverlay) {
            paymentModalLoadingOverlay.style.display = 'none';
        }
        if (surplusAmount > 0) {
            showToast(`Payment saved with ₱${surplusAmount.toFixed(2)} surplus`);
        } else {
            showToast('Payment saved', 'success');
        }
        closePaymentModal();

        if (newlyPaid) {
            void notifyPayrollPaymentAfterSave({
                employeeId,
                periodId,
                transferMethod,
                paymentAmount,
                paymentData,
                note
            });
        }

    } catch (error) {
        console.error('Error uploading payment confirmation:', error);
        showToast('Failed to upload payment confirmation. Please try again.', 'error');

        if (paymentModalLoadingOverlay) {
            paymentModalLoadingOverlay.style.display = 'none';
        }

        formInputs.forEach(input => input.disabled = false);
        if (closeBtn) closeBtn.style.pointerEvents = 'auto';
        if (submitBtn && originalButtonHTML) submitBtn.innerHTML = originalButtonHTML;
        if (submitBtn) {
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
        }
    }
}

// ── Pay Mode (sequential QR pay) ──
const payModeState = {
    queue: [],
    index: 0,
    accounts: null,
    selectedMethod: 'gotyme',
    open: false,
    customAmountOpen: false,
    pickerOpen: false,
    saving: false,
    qrGeneration: 0,
    remainingAmount: 0,
    qrShowFull: false,
    qrSourceUrl: '',
    qrBounds: null,
    qrBoundsCache: Object.create(null)
};

const PAY_MODE_QR_TARGET_RATIO = 0.78; // QR side vs min(frame w,h)

let payModeJsQRPromise = null;

function loadPayModeJsQR() {
    if (typeof window.jsQR === 'function') return Promise.resolve(window.jsQR);
    if (payModeJsQRPromise) return payModeJsQRPromise;
    payModeJsQRPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        script.async = true;
        script.onload = () => {
            if (typeof window.jsQR === 'function') resolve(window.jsQR);
            else reject(new Error('jsQR failed to load'));
        };
        script.onerror = () => reject(new Error('jsQR script error'));
        document.head.appendChild(script);
    });
    return payModeJsQRPromise;
}

function loadPayModeImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('QR image failed to load'));
        img.src = url;
    });
}

async function detectPayModeQrBounds(img) {
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    if (typeof BarcodeDetector !== 'undefined') {
        try {
            const detector = new BarcodeDetector({ formats: ['qr_code'] });
            const codes = await detector.detect(canvas);
            const code = codes && codes[0];
            const box = code?.boundingBox;
            if (box && box.width > 8 && box.height > 8) {
                return {
                    x: box.x / scale,
                    y: box.y / scale,
                    width: box.width / scale,
                    height: box.height / scale
                };
            }
        } catch {
            /* fall through to jsQR */
        }
    }

    try {
        const jsQR = await loadPayModeJsQR();
        const imageData = ctx.getImageData(0, 0, w, h);
        const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
        const loc = code?.location;
        if (!loc) return null;
        const xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomLeftCorner.x, loc.bottomRightCorner.x];
        const ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomLeftCorner.y, loc.bottomRightCorner.y];
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
            x: minX / scale,
            y: minY / scale,
            width: (maxX - minX) / scale,
            height: (maxY - minY) / scale
        };
    } catch {
        return null;
    }
}

async function getPayModeQrBoundsCached(sourceUrl) {
    if (!sourceUrl) return null;
    if (Object.prototype.hasOwnProperty.call(payModeState.qrBoundsCache, sourceUrl)) {
        return payModeState.qrBoundsCache[sourceUrl];
    }
    try {
        const img = await loadPayModeImage(sourceUrl);
        const bounds = await detectPayModeQrBounds(img);
        const ok = bounds && bounds.width >= 16 && bounds.height >= 16 ? bounds : null;
        payModeState.qrBoundsCache[sourceUrl] = ok;
        return ok;
    } catch {
        payModeState.qrBoundsCache[sourceUrl] = null;
        return null;
    }
}

function clearPayModeQrZoomStyles(qrImg) {
    if (!qrImg) return;
    qrImg.classList.remove('is-zoomed', 'is-fit', 'is-cropped');
    qrImg.style.width = '';
    qrImg.style.height = '';
    qrImg.style.transform = '';
    qrImg.style.left = '';
    qrImg.style.top = '';
}

function applyPayModeQrFit(qrImg) {
    clearPayModeQrZoomStyles(qrImg);
    qrImg.classList.add('is-fit');
}

function applyPayModeQrZoom(qrImg, bounds) {
    const frame = document.querySelector('.pay-mode__qr-frame');
    if (!qrImg || !frame || !bounds) {
        applyPayModeQrFit(qrImg);
        return false;
    }

    const fw = frame.clientWidth || frame.getBoundingClientRect().width;
    const fh = frame.clientHeight || frame.getBoundingClientRect().height;
    if (!(fw > 0 && fh > 0)) {
        applyPayModeQrFit(qrImg);
        return false;
    }

    const nw = qrImg.naturalWidth || 0;
    const nh = qrImg.naturalHeight || 0;
    if (!(nw > 0 && nh > 0)) {
        applyPayModeQrFit(qrImg);
        return false;
    }

    const qrSide = Math.max(bounds.width, bounds.height);
    const target = Math.min(fw, fh) * PAY_MODE_QR_TARGET_RATIO;
    const scale = target / qrSide;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const tx = fw / 2 - cx * scale;
    const ty = fh / 2 - cy * scale;

    clearPayModeQrZoomStyles(qrImg);
    qrImg.classList.add('is-zoomed');
    qrImg.style.width = `${nw}px`;
    qrImg.style.height = `${nh}px`;
    qrImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    return true;
}

function updatePayModeQrViewToggle() {
    const toggle = document.getElementById('payModeQrViewToggle');
    if (!toggle) return;
    const canToggle = Boolean(payModeState.qrBounds);
    toggle.hidden = !canToggle;
    toggle.textContent = payModeState.qrShowFull ? 'Zoom to QR' : 'Full photo';
}

function showPayModeQrImage(url) {
    const qrImg = document.getElementById('payModeQrImg');
    if (!qrImg) return Promise.resolve(false);
    return new Promise((resolve) => {
        const finish = () => resolve(true);
        qrImg.onload = () => {
            if (typeof qrImg.decode === 'function') {
                qrImg.decode().then(finish).catch(finish);
            } else finish();
        };
        qrImg.onerror = () => resolve(false);
        qrImg.src = url;
        if (qrImg.complete && qrImg.naturalWidth > 0 && qrImg.getAttribute('src') === url) finish();
    });
}

function formatPayModePeso(amount) {
    const n = Number(amount) || 0;
    return `₱${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function employeeHasPayQr(employee) {
    const accounts = readPayrollBankAccounts(employee);
    return Boolean(accounts.gotyme.qrUrl || accounts.bdo.qrUrl);
}

function setPayModeLoading(visible) {
    const loadingEl = document.getElementById('payModeLoading');
    if (!loadingEl) return;
    loadingEl.classList.toggle('is-visible', visible);
    if (visible) {
        loadingEl.removeAttribute('hidden');
    } else {
        loadingEl.setAttribute('hidden', '');
    }
    loadingEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function buildPayModeQueue() {
    const periodId = periodSelect.value;
    const paymentStatus = window.paymentStatus || {};
    const queue = [];

    Object.entries(filteredData).forEach(([employeeId, employee]) => {
        const totalPay = getEmployeeTotalPayForTable(employee, periodId);
        const employeePayment = paymentStatus[employeeId];
        const bal = getPaymentBalance(totalPay, employeePayment);
        const statusKind = getPaymentStatusKind(bal);

        if (statusKind === 'unpaid' || statusKind === 'partial') {
            queue.push({
                employeeId,
                employee,
                totalPay,
                bal,
                statusKind,
                hasQr: employeeHasPayQr(employee)
            });
        }
    });

    // Employees with a saved QR first, then by account id within each group
    queue.sort((a, b) => {
        if (a.hasQr !== b.hasQr) return a.hasQr ? -1 : 1;
        return String(a.employeeId || '').localeCompare(String(b.employeeId || ''), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    });

    return queue;
}

function getPayModeQueueRemainingTotal(queue) {
    return queue.reduce((sum, item) => sum + Math.max(0, item.bal.remaining), 0);
}

function updatePayModeButtonState() {
    const btn = document.getElementById('payModeBtn');
    if (!btn) return;

    if (!isDisbursementPeriod()) {
        btn.disabled = true;
        btn.title = 'Pay Mode is available after the payroll period ends';
        return;
    }

    const queue = buildPayModeQueue();
    btn.disabled = queue.length === 0;
    const withQr = queue.filter((q) => q.hasQr).length;
    btn.title = queue.length === 0
        ? 'No unpaid employees in this view'
        : `Pay ${queue.length} employee${queue.length === 1 ? '' : 's'} sequentially (${withQr} with QR first)`;
}

function getAvailablePayModeMethods(accounts) {
    const methods = [];
    for (const key of ['gotyme', 'bdo']) {
        const acc = accounts[key];
        if (acc && (acc.qrUrl || acc.accountNumber)) {
            methods.push(key);
        }
    }
    return methods;
}

function getPayModePayingAmount() {
    const hidden = document.getElementById('payModeAmount');
    return parseFloat(hidden?.value) || 0;
}

function updatePayModeConfirmLabel() {
    const confirmBtn = document.getElementById('payModeConfirmBtn');
    if (!confirmBtn) return;
    const amount = getPayModePayingAmount();
    if (amount > 0) {
        confirmBtn.textContent = `Pay ${formatPayModePeso(amount)}`;
    } else {
        confirmBtn.textContent = 'Pay';
    }
}

function syncPayModeHeroResetVisibility() {
    const resetBtn = document.getElementById('payModeHeroResetBtn');
    if (!resetBtn) return;
    const amount = getPayModePayingAmount();
    const remaining = Math.round((payModeState.remainingAmount || 0) * 100) / 100;
    const current = Math.round(amount * 100) / 100;
    resetBtn.hidden = !(current > 0 && current !== remaining);
}

function setPayModeAmountValue(amount) {
    const amountEl = document.getElementById('payModeAmount');
    const n = Number(amount) || 0;
    if (amountEl) amountEl.value = n > 0 ? n.toFixed(2) : '';
    updatePayModeHeroDisplay(n > 0 ? n : 0);
    syncPayModeHeroResetVisibility();
    updatePayModeConfirmLabel();
    renderPayModeMathForCurrent();
}

function setPayModeHeroEditMode(editing) {
    payModeState.customAmountOpen = editing;
    const valueBtn = document.getElementById('payModeHeroAmount');
    const inputWrap = document.getElementById('payModeHeroInputWrap');
    const input = document.getElementById('payModeHeroInput');
    const editBtn = document.getElementById('payModeHeroEditBtn');

    if (editing) {
        if (valueBtn) valueBtn.hidden = true;
        if (inputWrap) inputWrap.hidden = false;
        if (editBtn) editBtn.hidden = true;
        const seed = getPayModePayingAmount() || payModeState.remainingAmount || 0;
        if (input) {
            input.value = seed > 0 ? seed.toFixed(2) : '';
            input.focus();
            input.select();
        }
    } else {
        if (valueBtn) valueBtn.hidden = false;
        if (inputWrap) inputWrap.hidden = true;
        if (editBtn) editBtn.hidden = false;
        if (input) input.value = '';
        updatePayModeHeroDisplay(getPayModePayingAmount());
    }

    syncPayModeHeroResetVisibility();
}

function resetPayModeCustomAmount(remaining) {
    payModeState.remainingAmount = Math.max(0, Number(remaining) || 0);
    setPayModeAmountValue(payModeState.remainingAmount);
    setPayModeHeroEditMode(false);
}

function updatePayModeHeroDisplay(amount) {
    const heroEl = document.getElementById('payModeHeroAmount');
    if (heroEl) heroEl.textContent = formatPayModePeso(amount);
}

function openPayModeCustomAmount() {
    setPayModeHeroEditMode(true);
}

function closePayModeCustomAmount() {
    resetPayModeCustomAmount(payModeState.remainingAmount);
}

function onPayModeHeroInputChange() {
    if (!payModeState.customAmountOpen) return;
    const input = document.getElementById('payModeHeroInput');
    setPayModeAmountValue(parseFloat(input?.value) || 0);
}

function commitPayModeHeroEdit() {
    if (!payModeState.customAmountOpen) return;
    const amount = parseFloat(document.getElementById('payModeHeroInput')?.value) || 0;
    if (!(amount > 0)) {
        closePayModeCustomAmount();
        return;
    }
    setPayModeAmountValue(amount);
    setPayModeHeroEditMode(false);
}

function renderPayModeSnapshot(employee) {
    const snapEl = document.getElementById('payModeSnapshot');
    if (!snapEl) return;

    const periodId = periodSelect?.value;
    const dates = Array.isArray(employee?.dates)
        ? employee.dates.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
        : [];
    const workedDays = dates.filter((d) => d && (d.isPaidLeave || (d.timeIn && d.timeOut)));

    let html = '';
    if (workedDays.length) {
        const rows = workedDays.map((day) => {
            let pay = 0;
            try {
                if (payCalculator) {
                    const rated = typeof mergeEmpRates === 'function' && periodId
                        ? mergeEmpRates(employee, periodId)
                        : employee;
                    pay = Number(payCalculator.calculateDailyPay(day, rated, 'simple')) || 0;
                }
            } catch { /* ignore */ }
            const label = day.isPaidLeave
                ? `${formatReadableDate(day.date)} · Leave`
                : formatReadableDate(day.date);
            const shortLabel = (() => {
                try {
                    const dt = new Date(day.date + (String(day.date).includes('T') ? '' : 'T00:00:00'));
                    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                        + (day.isPaidLeave ? ' · Leave' : '');
                } catch {
                    return label;
                }
            })();
            return `<tr>
                <td>${escapeHtml(shortLabel)}</td>
                <td class="pay-mode__days-pay">${formatPayModePeso(pay)}</td>
            </tr>`;
        }).join('');
        html += `<table class="pay-mode__days-table">
            <thead><tr><th>Days worked</th><th>Pay</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    } else {
        const days = Number(employee?.daysWorked) || 0;
        html += days > 0
            ? `<p class="pay-mode__days-empty">${days} day${days === 1 ? '' : 's'} this period</p>`
            : `<p class="pay-mode__days-empty">No attendance days this period</p>`;
    }

    const lines = Array.isArray(employee?.periodEarningsLines) ? employee.periodEarningsLines : [];
    const extras = lines.filter((line) => line && line.status !== 'waived' && Number(line.amount));
    if (extras.length) {
        html += `<div class="pay-mode__adjustments">
            <p class="pay-mode__adjustments-note">Already in the amount above</p>`;
        extras.forEach((line) => {
            const amt = Number(line.amount) || 0;
            const label = earningsKindLabel(line.kind, amt) + (line.fromPriorCutoff ? ' (prior)' : '');
            const kindClass = amt < 0 ? 'pay-mode__snapshot-line--deduct' : 'pay-mode__snapshot-line--credit';
            const value = amt < 0
                ? `–${formatPayModePeso(Math.abs(amt))}`
                : `+${formatPayModePeso(amt)}`;
            html += `<div class="pay-mode__snapshot-line ${kindClass}">
                <span class="pay-mode__snapshot-line-label">${escapeHtml(label)}</span>
                <span class="pay-mode__snapshot-line-value">${value}</span>
            </div>`;
        });
        html += `</div>`;
    }

    // silence unused periodId lint if any
    void periodId;
    snapEl.innerHTML = html;
}

function renderPayModeMath(item, payingAmount) {
    const mathEl = document.getElementById('payModeMath');
    if (!mathEl) return;

    const bal = item?.bal;
    const showMath = bal && bal.paid > 0;
    if (!showMath) {
        mathEl.hidden = true;
        mathEl.innerHTML = '';
        return;
    }

    const paying = Number(payingAmount) || 0;
    mathEl.hidden = false;
    mathEl.innerHTML = `
        <div class="pay-mode__math-row"><span>Period total</span><strong>${formatPayModePeso(item.totalPay)}</strong></div>
        <div class="pay-mode__math-row"><span>Already paid</span><strong>${formatPayModePeso(bal.paid)}</strong></div>
        <div class="pay-mode__math-row pay-mode__math-row--emphasis"><span>Paying now</span><strong>${formatPayModePeso(paying)}</strong></div>
    `;
}

function renderPayModeMathForCurrent() {
    const item = payModeState.queue[payModeState.index];
    if (!item) return;
    renderPayModeMath(item, getPayModePayingAmount());
}

function renderPayModeSendRow(accounts, selectedMethod, hasQr) {
    const tabsEl = document.getElementById('payModeMethodTabs');
    const sendEl = document.getElementById('payModeSend');
    const numberEl = document.getElementById('payModeAccountNumber');
    const copyBtn = document.getElementById('payModeCopyBtn');
    if (!tabsEl) return selectedMethod;

    const methods = getAvailablePayModeMethods(accounts);
    const labels = { gotyme: 'GoTyme', bdo: 'BDO' };
    tabsEl.innerHTML = '';

    if (sendEl) sendEl.classList.toggle('pay-mode__send--no-qr', !hasQr);

    if (!methods.length) {
        tabsEl.innerHTML = '<span class="form-hint">No bank account on file</span>';
        if (numberEl) numberEl.textContent = '';
        if (copyBtn) {
            copyBtn.hidden = true;
            copyBtn.onclick = null;
        }
        return selectedMethod;
    }

    const activeMethod = methods.includes(selectedMethod) ? selectedMethod : methods[0];

    methods.forEach((key, index) => {
        if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'pay-mode__send-sep';
            sep.textContent = '|';
            sep.setAttribute('aria-hidden', 'true');
            tabsEl.appendChild(sep);
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `pay-mode__send-method${key === activeMethod ? ' is-active' : ''}`;
        btn.textContent = labels[key];
        btn.dataset.method = key;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', key === activeMethod ? 'true' : 'false');

        if (methods.length === 1) {
            btn.disabled = true;
        } else {
            btn.onclick = () => {
                payModeState.selectedMethod = key;
                renderPayModeCurrent().catch((err) => console.warn('Pay Mode render failed:', err));
            };
        }
        tabsEl.appendChild(btn);
    });

    const acc = accounts[activeMethod] || emptyPayrollBankAccount();
    if (numberEl) {
        numberEl.textContent = acc.accountNumber || 'No account number';
    }
    if (copyBtn) {
        const canCopy = Boolean(acc.accountNumber);
        copyBtn.hidden = !canCopy;
        copyBtn.disabled = !canCopy;
        copyBtn.onclick = canCopy
            ? async () => {
                try {
                    await navigator.clipboard.writeText(acc.accountNumber);
                    showToast('Account number copied', 'success');
                } catch {
                    showToast('Could not copy account number', 'error');
                }
            }
            : null;
    }

    return activeMethod;
}

function clearPayModeQrDisplay({ showSkeleton = true } = {}) {
    const qrImg = document.getElementById('payModeQrImg');
    const qrMissing = document.getElementById('payModeQrMissing');
    const skeleton = document.getElementById('payModeQrSkeleton');
    const toggle = document.getElementById('payModeQrViewToggle');

    if (qrImg) {
        qrImg.hidden = true;
        qrImg.classList.remove('is-ready');
        clearPayModeQrZoomStyles(qrImg);
        qrImg.removeAttribute('src');
        qrImg.onload = null;
        qrImg.onerror = null;
    }
    if (qrMissing) qrMissing.hidden = true;
    if (toggle) toggle.hidden = true;
    if (skeleton) {
        skeleton.hidden = false;
        skeleton.classList.toggle('is-idle', !showSkeleton);
        skeleton.setAttribute('aria-hidden', 'true');
    }
}

function bindCopyAccountNumber(buttonEl, accountNumber) {
    if (!buttonEl) return;
    buttonEl.textContent = accountNumber ? 'Copy account number' : 'No account number';
    buttonEl.disabled = !accountNumber;
    buttonEl.onclick = async () => {
        if (!accountNumber) return;
        try {
            await navigator.clipboard.writeText(accountNumber);
            showToast('Account number copied', 'success');
        } catch {
            showToast('Could not copy account number', 'error');
        }
    };
}

async function revealPayModeQr(url, generation) {
    const qrImg = document.getElementById('payModeQrImg');
    const skeleton = document.getElementById('payModeQrSkeleton');
    if (!qrImg || !url) return;
    if (generation !== payModeState.qrGeneration) return;

    payModeState.qrSourceUrl = url;
    payModeState.qrShowFull = false;
    payModeState.qrBounds = null;

    const ok = await showPayModeQrImage(url);
    if (generation !== payModeState.qrGeneration) return;

    if (!ok) {
        if (skeleton) {
            skeleton.hidden = false;
            skeleton.classList.remove('is-idle');
        }
        qrImg.hidden = true;
        qrImg.removeAttribute('src');
        updatePayModeQrViewToggle();
        return;
    }

    const bounds = await getPayModeQrBoundsCached(url);
    if (generation !== payModeState.qrGeneration) return;
    payModeState.qrBounds = bounds;

    if (bounds) {
        // Wait a frame so the fixed frame has layout size
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (generation !== payModeState.qrGeneration) return;
        applyPayModeQrZoom(qrImg, bounds);
    } else {
        applyPayModeQrFit(qrImg);
    }

    if (skeleton) {
        skeleton.classList.add('is-idle');
        skeleton.hidden = false;
    }
    qrImg.hidden = false;
    qrImg.classList.add('is-ready');
    updatePayModeQrViewToggle();
}

async function togglePayModeQrFullView() {
    if (!payModeState.qrSourceUrl || !payModeState.qrBounds) return;
    const qrImg = document.getElementById('payModeQrImg');
    if (!qrImg) return;

    payModeState.qrShowFull = !payModeState.qrShowFull;
    if (payModeState.qrShowFull) {
        applyPayModeQrFit(qrImg);
    } else {
        applyPayModeQrZoom(qrImg, payModeState.qrBounds);
    }
    updatePayModeQrViewToggle();
}

function renderPayModeQrMissing(acc) {
    const qrMissing = document.getElementById('payModeQrMissing');
    const skeleton = document.getElementById('payModeQrSkeleton');
    const qrImg = document.getElementById('payModeQrImg');
    const fallbackName = document.getElementById('payModeQrFallbackName');
    const fallbackNumber = document.getElementById('payModeQrFallbackNumber');

    if (qrImg) {
        qrImg.hidden = true;
        qrImg.classList.remove('is-ready');
        qrImg.removeAttribute('src');
    }
    if (skeleton) {
        skeleton.hidden = false;
        skeleton.classList.add('is-idle');
    }
    if (fallbackName) fallbackName.textContent = acc?.accountName || '';
    bindCopyAccountNumber(fallbackNumber, acc?.accountNumber || '');
    if (qrMissing) qrMissing.hidden = false;
}

async function renderPayModeQrPanel(acc, method) {
    const qrLabel = document.getElementById('payModeQrLabel');
    const labels = { gotyme: 'GoTyme', bdo: 'BDO' };
    const generation = ++payModeState.qrGeneration;

    clearPayModeQrDisplay({ showSkeleton: Boolean(acc?.qrUrl) });

    if (qrLabel) {
        qrLabel.textContent = acc?.qrUrl
            ? `Scan QR with ${labels[method] || method}`
            : `No ${labels[method] || method} QR on file`;
    }

    if (acc?.qrUrl) {
        await revealPayModeQr(acc.qrUrl, generation);
        if (generation === payModeState.qrGeneration) {
            const qrImg = document.getElementById('payModeQrImg');
            const shown = qrImg && !qrImg.hidden && qrImg.getAttribute('src');
            if (shown) {
                const qrMissing = document.getElementById('payModeQrMissing');
                if (qrMissing) qrMissing.hidden = true;
            } else {
                renderPayModeQrMissing(acc);
            }
        }
    } else {
        renderPayModeQrMissing(acc);
    }
}

function preloadPayModeNeighborAssets() {
    const queue = payModeState.queue;
    const index = payModeState.index;
    const neighborIndexes = [index - 1, index + 1].filter((i) => i >= 0 && i < queue.length);

    neighborIndexes.forEach((i) => {
        const item = queue[i];
        if (!item) return;
        getEmployeeBankDetails(item.employeeId).then((details) => {
            if (!payModeState.open) return;
            const accounts = readPayrollBankAccounts(details);
            for (const key of ['gotyme', 'bdo']) {
                const url = accounts[key]?.qrUrl;
                if (!url) continue;
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.decoding = 'async';
                img.src = url;
                // Warm QR bounds cache in background
                getPayModeQrBoundsCached(url).catch(() => { /* ignore */ });
            }
            item.hasQr = employeeHasPayQr(details);
            if (attendanceData[item.employeeId] && details) {
                Object.assign(attendanceData[item.employeeId], {
                    bankAccounts: details.bankAccounts || attendanceData[item.employeeId].bankAccounts,
                    gotymeQrUrl: details.gotymeQrUrl || attendanceData[item.employeeId].gotymeQrUrl,
                    bdoQrUrl: details.bdoQrUrl || attendanceData[item.employeeId].bdoQrUrl
                });
            }
        }).catch(() => { /* ignore preload errors */ });
    });
}

function setPayModePickerOpen(open) {
    payModeState.pickerOpen = Boolean(open);
    const panel = document.getElementById('payModeSummaryPanel');
    const picker = document.getElementById('payModePicker');
    const nameBtn = document.getElementById('payModeEmployeeName');
    if (panel) panel.classList.toggle('is-picking', payModeState.pickerOpen);
    if (picker) {
        if (payModeState.pickerOpen) picker.removeAttribute('hidden');
        else picker.setAttribute('hidden', '');
    }
    if (nameBtn) nameBtn.setAttribute('aria-expanded', payModeState.pickerOpen ? 'true' : 'false');
}

function closePayModePicker() {
    setPayModePickerOpen(false);
}

function renderPayModePickerList() {
    const list = document.getElementById('payModePickerList');
    if (!list) return;

    list.innerHTML = '';
    payModeState.queue.forEach((item, index) => {
        const name = getEmployeeDisplayName(item.employeeId, item.employee);
        const amount = Math.max(0, item.bal?.remaining || 0);
        const isCurrent = index === payModeState.index;
        const isPartial = item.statusKind === 'partial';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pay-mode__picker-item'
            + (isCurrent ? ' is-current' : '')
            + (isPartial ? ' is-partial' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
        btn.dataset.index = String(index);

        const main = document.createElement('div');
        main.className = 'pay-mode__picker-item-main';

        const nameEl = document.createElement('div');
        nameEl.className = 'pay-mode__picker-item-name';
        nameEl.textContent = name;

        const meta = document.createElement('div');
        meta.className = 'pay-mode__picker-item-meta';
        meta.textContent = isCurrent
            ? `Current · #${index + 1}`
            : `#${index + 1}${isPartial ? ' · Partial' : ''}${item.hasQr ? '' : ' · No QR'}`;

        main.appendChild(nameEl);
        main.appendChild(meta);

        const amountEl = document.createElement('div');
        amountEl.className = 'pay-mode__picker-item-amount';
        amountEl.textContent = formatPayModePeso(amount);

        btn.appendChild(main);
        btn.appendChild(amountEl);
        btn.addEventListener('click', () => {
            selectPayModePickerIndex(index);
        });
        list.appendChild(btn);
    });

    const current = list.querySelector('.pay-mode__picker-item.is-current');
    if (current) {
        requestAnimationFrame(() => {
            current.scrollIntoView({ block: 'nearest' });
        });
    }
}

function openPayModePicker() {
    if (!payModeState.open || !payModeState.queue.length) return;
    if (payModeState.customAmountOpen) closePayModeCustomAmount();
    renderPayModePickerList();
    setPayModePickerOpen(true);
    setTimeout(() => {
        const current = document.querySelector('#payModePickerList .pay-mode__picker-item.is-current');
        (current || document.getElementById('payModePickerCloseBtn'))?.focus();
    }, 30);
}

async function selectPayModePickerIndex(index) {
    closePayModePicker();
    if (index === payModeState.index) return;
    await payModeGoTo(index);
}

function paintPayModeLeftFromQueueItem(item) {
    const { employeeId, employee, bal, statusKind } = item;
    const nameEl = document.getElementById('payModeEmployeeName');
    const statusEl = document.getElementById('payModeStatusBadge');
    const countEl = document.getElementById('payModeProgressCount');
    const leftEl = document.getElementById('payModeProgressLeft');
    const backBtn = document.getElementById('payModeBackBtn');
    const noteEl = document.getElementById('payModeNote');

    if (nameEl) nameEl.textContent = getEmployeeDisplayName(employeeId, employee);

    if (statusEl) {
        if (statusKind === 'partial') {
            statusEl.hidden = false;
            statusEl.textContent = paymentStatusLabel(statusKind);
            statusEl.className = `pay-mode__status pay-mode__status--${statusKind}`;
        } else {
            statusEl.hidden = true;
            statusEl.textContent = '';
            statusEl.className = 'pay-mode__status';
        }
    }

    payModeState.remainingAmount = Math.max(0, bal.remaining || 0);
    if (!payModeState.customAmountOpen) {
        setPayModeAmountValue(bal.remaining > 0 ? bal.remaining : 0);
        const editBtn = document.getElementById('payModeHeroEditBtn');
        const valueBtn = document.getElementById('payModeHeroAmount');
        const inputWrap = document.getElementById('payModeHeroInputWrap');
        if (editBtn) editBtn.hidden = false;
        if (valueBtn) valueBtn.hidden = false;
        if (inputWrap) inputWrap.hidden = true;
    }

    renderPayModeSnapshot(employee);
    const hintEl = document.getElementById('payModeHeroHint');
    if (hintEl) {
        const lines = Array.isArray(employee?.periodEarningsLines) ? employee.periodEarningsLines : [];
        const hasAdjustments = lines.some((line) => line && line.status !== 'waived' && Number(line.amount));
        hintEl.hidden = !hasAdjustments;
        hintEl.textContent = hasAdjustments
            ? 'Net amount — advances & adjustments already included'
            : '';
    }
    renderPayModeMath(item, getPayModePayingAmount());
    updatePayModeConfirmLabel();
    syncPayModeHeroResetVisibility();

    if (noteEl && !payModeState._preserveNote) {
        noteEl.value = '';
        const details = noteEl.closest('details');
        if (details) details.open = false;
    }
    payModeState._preserveNote = false;

    const queueTotal = getPayModeQueueRemainingTotal(payModeState.queue);
    if (countEl) {
        countEl.textContent = `${payModeState.index + 1} / ${payModeState.queue.length}`;
    }
    if (leftEl) {
        leftEl.textContent = formatPayModePeso(queueTotal);
    }

    if (backBtn) backBtn.disabled = payModeState.index <= 0;
}

async function renderPayModeCurrent() {
    const item = payModeState.queue[payModeState.index];
    if (!item) return;

    // Clear previous QR immediately so skip never shows the last person
    clearPayModeQrDisplay({ showSkeleton: true });
    paintPayModeLeftFromQueueItem(item);

    const { employeeId } = item;
    const details = await getEmployeeBankDetails(employeeId);
    if (payModeState.queue[payModeState.index]?.employeeId !== employeeId) return;

    const accounts = readPayrollBankAccounts(details);
    payModeState.accounts = accounts;
    item.hasQr = employeeHasPayQr(details);

    const methods = getAvailablePayModeMethods(accounts);
    const selectedMethod = methods.includes(payModeState.selectedMethod)
        ? payModeState.selectedMethod
        : (methods[0] || payModeState.selectedMethod);
    payModeState.selectedMethod = selectedMethod;
    const acc = accounts[selectedMethod] || emptyPayrollBankAccount();
    renderPayModeSendRow(accounts, selectedMethod, Boolean(acc.qrUrl));

    await renderPayModeQrPanel(acc, selectedMethod);
    preloadPayModeNeighborAssets();
}

async function openPayMode(startEmployeeId = null) {
    if (!isDisbursementPeriod()) {
        showToast('Pay Mode is available after the payroll period ends', 'error');
        return;
    }

    payModeState.queue = buildPayModeQueue();
    if (!payModeState.queue.length) {
        showToast('No unpaid employees in this view', 'error');
        return;
    }

    let startIndex = 0;
    if (startEmployeeId) {
        const found = payModeState.queue.findIndex((q) => q.employeeId === startEmployeeId);
        if (found < 0) {
            showToast('No remaining balance for this employee', 'error');
            return;
        }
        startIndex = found;
    }

    payModeState.index = startIndex;
    payModeState.selectedMethod = 'gotyme';
    payModeState.accounts = null;
    payModeState.customAmountOpen = false;
    payModeState.pickerOpen = false;
    payModeState.qrShowFull = false;
    payModeState.qrSourceUrl = '';
    payModeState.qrBounds = null;
    payModeState.qrBoundsCache = Object.create(null);
    payModeState.open = true;

    const overlay = document.getElementById('payModeOverlay');
    const periodLabel = document.getElementById('payModePeriodLabel');
    if (periodLabel) {
        periodLabel.textContent = periodSelect.options[periodSelect.selectedIndex]?.text || '';
    }

    resetPayModeCustomAmount(0);
    setPayModeLoading(false);

    if (overlay) {
        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
    }

    document.body.style.overflow = 'hidden';
    closePayModePicker();
    await renderPayModeCurrent();
    setTimeout(() => document.getElementById('payModeConfirmBtn')?.focus(), 100);
}

function closePayMode() {
    payModeState.open = false;
    payModeState.queue = [];
    payModeState.index = 0;
    payModeState.accounts = null;
    payModeState.customAmountOpen = false;
    payModeState.pickerOpen = false;
    payModeState.saving = false;
    payModeState.qrGeneration += 1;
    clearPayModeQrDisplay({ showSkeleton: false });
    setPayModeLoading(false);
    closePayModePicker();

    const overlay = document.getElementById('payModeOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    }

    document.body.style.overflow = '';
    updatePayModeButtonState();
}

async function payModeGoTo(index) {
    if (!payModeState.queue.length) return;
    closePayModePicker();
    payModeState.index = Math.max(0, Math.min(index, payModeState.queue.length - 1));
    payModeState.accounts = null;
    payModeState.customAmountOpen = false;
    resetPayModeCustomAmount(payModeState.queue[payModeState.index]?.bal?.remaining || 0);
    clearPayModeQrDisplay({ showSkeleton: true });
    await renderPayModeCurrent();
}

async function payModeSkip() {
    if (payModeState.index < payModeState.queue.length - 1) {
        await payModeGoTo(payModeState.index + 1);
    } else {
        closePayMode();
        showToast('Reached end of queue', 'success');
    }
}

async function payModeBack() {
    if (payModeState.index > 0) await payModeGoTo(payModeState.index - 1);
}

async function payModeConfirmAndNext() {
    if (payModeState.saving) return;

    const item = payModeState.queue[payModeState.index];
    if (!item) return;

    const amount = getPayModePayingAmount();
    const note = document.getElementById('payModeNote')?.value.trim() || '';
    const transferMethod = payModeState.selectedMethod;
    const periodId = periodSelect.value;
    const confirmBtn = document.getElementById('payModeConfirmBtn');

    if (!transferMethod || !getAvailablePayModeMethods(payModeState.accounts || {}).includes(transferMethod)) {
        showToast('No valid transfer method for this employee', 'error');
        return;
    }

    if (amount <= 0) {
        showToast('Please enter a valid payment amount', 'error');
        return;
    }

    payModeState.saving = true;
    setPayModeLoading(true);
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        const paidEmployeeId = item.employeeId;
        const { paymentData, newlyPaid, alreadyPaid } = await persistPayrollPayment({
            employeeId: paidEmployeeId,
            periodId,
            transferMethod,
            paymentAmount: amount,
            note
        });

        // Email ONLY after a new server-verified save — never on double-clicks
        if (newlyPaid) {
            void notifyPayrollPaymentAfterSave({
                employeeId: paidEmployeeId,
                periodId,
                transferMethod,
                paymentAmount: amount,
                paymentData,
                note
            });
        } else if (alreadyPaid) {
            console.log('[Payment] Already paid on server — skipped email', paidEmployeeId);
        }

        applyVerifiedPaymentToLocalState(periodId, paidEmployeeId, paymentData);
        renderEmployeeTable();
        updateSummaryCards();
        await updateEmployeePaymentStatus(true);

        payModeState.queue = buildPayModeQueue();
        if (!payModeState.queue.length) {
            closePayMode();
            return;
        }

        if (payModeState.index >= payModeState.queue.length) {
            payModeState.index = payModeState.queue.length - 1;
        }

        payModeState.accounts = null;
        payModeState._preserveNote = false;
        payModeState.customAmountOpen = false;
        resetPayModeCustomAmount(payModeState.queue[payModeState.index]?.bal?.remaining || 0);
        clearPayModeQrDisplay({ showSkeleton: true });
        await renderPayModeCurrent();
        setTimeout(() => document.getElementById('payModeConfirmBtn')?.focus(), 50);

    } catch (error) {
        console.error('Pay Mode save failed:', error);
        showToast(error?.message || 'Failed to save payment. Please try again.', 'error');
    } finally {
        payModeState.saving = false;
        setPayModeLoading(false);
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

function handlePayModeKeydown(e) {
    if (!payModeState.open) return;

    const tag = (e.target?.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';
    const editingHero = payModeState.customAmountOpen && e.target?.id === 'payModeHeroInput';

    if (e.key === 'Escape') {
        e.preventDefault();
        if (payModeState.customAmountOpen) {
            closePayModeCustomAmount();
            return;
        }
        if (payModeState.pickerOpen) {
            closePayModePicker();
            document.getElementById('payModeEmployeeName')?.focus();
            return;
        }
        closePayMode();
        return;
    }

    if (editingHero) {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitPayModeHeroEdit();
            payModeConfirmAndNext();
        }
        return;
    }

    if (isTyping) return;

    if (payModeState.pickerOpen) return;

    if (e.key === 'Enter') {
        e.preventDefault();
        payModeConfirmAndNext();
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        payModeSkip();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        payModeBack();
    }
}

async function uploadPaymentScreenshot(imageDataUrl, employeeId, periodId) {
    try {
        // Convert base64 data to blob
        const response = await fetch(imageDataUrl);
        const blob = await response.blob();

        // Create a unique filename
        const filename = `payment_${employeeId}_${periodId}_${Date.now()}.jpg`;
        const fileRef = storageRef(storage, `payroll_periods_v2_screenshots/${filename}`);

        // Upload to Firebase Storage
        await uploadBytes(fileRef, blob);

        // Get the download URL
        const downloadURL = await getDownloadURL(fileRef);
        return downloadURL;
    } catch (error) {
        console.error("Error uploading payment screenshot:", error);
        throw error;
    }
}

// Add event listeners (once)
const paymentFormEl = document.getElementById('paymentForm');
if (paymentFormEl) {
    paymentFormEl.addEventListener('submit', function paymentFormSubmit(e) {
        console.log('[Payment] paymentForm submit event fired');
        savePaymentConfirmation(e);
    });
    console.log('[Payment] paymentForm submit listener attached');
}
document.getElementById('closePaymentModal').addEventListener('click', closePaymentModal);
document.getElementById('cancelPaymentBtn').addEventListener('click', closePaymentModal);
window.showUpdateForm = showUpdateForm;

const adjustSurplusFormEl = document.getElementById('adjustSurplusForm');
if (adjustSurplusFormEl) {
    adjustSurplusFormEl.addEventListener('submit', saveAdjustSurplusForm);
}
const closeAdjustSurplusModalBtn = document.getElementById('closeAdjustSurplusModal');
if (closeAdjustSurplusModalBtn) closeAdjustSurplusModalBtn.addEventListener('click', closeAdjustSurplusModal);
const cancelAdjustSurplusBtn = document.getElementById('cancelAdjustSurplusBtn');
if (cancelAdjustSurplusBtn) cancelAdjustSurplusBtn.addEventListener('click', closeAdjustSurplusModal);
const adjustSurplusClearBtn = document.getElementById('adjustSurplusClearBtn');
if (adjustSurplusClearBtn) adjustSurplusClearBtn.addEventListener('click', handleAdjustSurplusClear);

const paymentScreenshotInput = document.getElementById('paymentScreenshot');
const paymentScreenshotNameEl = document.getElementById('paymentScreenshotName');
if (paymentScreenshotInput && paymentScreenshotNameEl) {
    paymentScreenshotInput.addEventListener('change', function () {
        const file = this.files?.[0];
        paymentScreenshotNameEl.textContent = file ? file.name : 'No file chosen';
    });
}

const payModeBtn = document.getElementById('payModeBtn');
if (payModeBtn) payModeBtn.addEventListener('click', () => openPayMode());

const payModeExitBtn = document.getElementById('payModeExitBtn');
if (payModeExitBtn) payModeExitBtn.addEventListener('click', closePayMode);

const payModeBackBtn = document.getElementById('payModeBackBtn');
if (payModeBackBtn) payModeBackBtn.addEventListener('click', payModeBack);

const payModeSkipBtn = document.getElementById('payModeSkipBtn');
if (payModeSkipBtn) payModeSkipBtn.addEventListener('click', payModeSkip);

const payModeConfirmBtn = document.getElementById('payModeConfirmBtn');
if (payModeConfirmBtn) payModeConfirmBtn.addEventListener('click', payModeConfirmAndNext);

const payModeEmployeeNameBtn = document.getElementById('payModeEmployeeName');
if (payModeEmployeeNameBtn) {
    payModeEmployeeNameBtn.addEventListener('click', () => {
        if (payModeState.pickerOpen) closePayModePicker();
        else openPayModePicker();
    });
}

const payModePickerCloseBtn = document.getElementById('payModePickerCloseBtn');
if (payModePickerCloseBtn) {
    payModePickerCloseBtn.addEventListener('click', () => {
        closePayModePicker();
        document.getElementById('payModeEmployeeName')?.focus();
    });
}

const payModeQrViewToggle = document.getElementById('payModeQrViewToggle');
if (payModeQrViewToggle) {
    payModeQrViewToggle.addEventListener('click', () => {
        togglePayModeQrFullView().catch((err) => console.warn('QR view toggle failed:', err));
    });
}

const payModeHeroAmount = document.getElementById('payModeHeroAmount');
if (payModeHeroAmount) {
    payModeHeroAmount.addEventListener('click', openPayModeCustomAmount);
}

const payModeHeroEditBtn = document.getElementById('payModeHeroEditBtn');
if (payModeHeroEditBtn) {
    payModeHeroEditBtn.addEventListener('click', openPayModeCustomAmount);
}

const payModeHeroResetBtn = document.getElementById('payModeHeroResetBtn');
if (payModeHeroResetBtn) {
    payModeHeroResetBtn.addEventListener('click', closePayModeCustomAmount);
}

const payModeHeroInput = document.getElementById('payModeHeroInput');
if (payModeHeroInput) {
    payModeHeroInput.addEventListener('input', onPayModeHeroInputChange);
    payModeHeroInput.addEventListener('blur', () => {
        // Defer so Reset/Edit clicks still fire first
        setTimeout(() => {
            if (!payModeState.open || !payModeState.customAmountOpen) return;
            if (document.activeElement === payModeHeroInput) return;
            commitPayModeHeroEdit();
        }, 120);
    });
}

const payModeOverlay = document.getElementById('payModeOverlay');
if (payModeOverlay) {
    payModeOverlay.addEventListener('click', (e) => {
        if (e.target === payModeOverlay) closePayMode();
    });
}

document.addEventListener('keydown', handlePayModeKeydown);

// Payment amount field event listener to update hint
document.getElementById('paymentAmount').addEventListener('input', async function() {
    const employeeId = document.getElementById('paymentEmployeeId').value;
    const employeeData = filteredData[employeeId];
    const periodId = periodSelect.value;
    const totalPay = employeeData ? calcTotalPaySimple(employeeData.dates, employeeData, periodId) : 0;
    const newPaymentAmount = parseFloat(this.value) || 0;
    
    let existingPaymentAmount = 0;
    try {
        const existingPaymentRef = v2PaymentDocRef(periodId, employeeId);
        const existingPaymentDoc = await getDoc(existingPaymentRef);
        if (existingPaymentDoc.exists()) {
            existingPaymentAmount = existingPaymentDoc.data().paymentAmount || 0;
        }
    } catch (error) {
        // No existing payment
    }
    
    const accumulatedPaymentAmount = existingPaymentAmount + newPaymentAmount;
    const remainingAmount = totalPay - accumulatedPaymentAmount;
    const surplusAmount = getPaymentBalance(totalPay, { paymentAmount: accumulatedPaymentAmount }).surplus;
    
    if (surplusAmount > 0) {
        document.getElementById('paymentAmountHint').textContent = `Surplus ₱${surplusAmount.toFixed(2)} (paid above period total)`;
    } else if (totalPay <= 0) {
        document.getElementById('paymentAmountHint').textContent = 'Nothing to pay this period (net is zero or negative)';
    } else if (accumulatedPaymentAmount >= totalPay) {
        document.getElementById('paymentAmountHint').textContent = 'Full payment';
    } else {
        document.getElementById('paymentAmountHint').textContent = `Partial payment (₱${remainingAmount.toFixed(2)} remaining)`;
    }
});

// URL hash management for employee view state
function updateURLHash(employeeId = null) {
    if (employeeId) {
        window.location.hash = `employee=${employeeId}`;
        console.log('URL hash updated to:', window.location.hash);
    } else {
        window.location.hash = '';
        console.log('URL hash cleared');
    }
}

function getEmployeeFromHash() {
    const hash = window.location.hash;
    const match = hash.match(/employee=([^&]+)/);
    return match ? match[1] : null;
}

function restoreEmployeeView() {
    console.log('restoreEmployeeView called');
    const employeeId = getEmployeeFromHash();
    console.log('Employee ID from hash:', employeeId);
    console.log('Current employees object:', employees);
    console.log('Current employee view:', currentEmployeeView);
    
    if (employeeId && employees[employeeId]) {
        console.log('Valid employee found, restoring view');
        // Check if we're already on the right view
        if (currentEmployeeView !== employeeId) {
            currentEmployeeView = employeeId;
            updateURLHash(employeeId);
            
            // Make sure we're in the right view mode first
            updateViewMode();
            
            const container = document.getElementById('employee-details-table');
            if (container) {
                loadEmployeeDetailsAsMainTable(employeeId, container).catch((error) => {
                    console.error('Error restoring employee view:', error);
                    container.innerHTML = '<div class="error">Error loading employee data</div>';
                });
            } else {
                console.log('Employee details container not found, will retry after data load');
            }
        }
    } else if (currentEmployeeView) {
        console.log('No valid employee in hash, clearing view');
        // Clear the view if no valid employee in hash
        currentEmployeeView = null;
        updateURLHash(null);
        loadData();
    } else {
        console.log('No employee to restore, staying on main view');
    }
}

// Listen for hash changes (back/forward buttons)
window.addEventListener('hashchange', restoreEmployeeView);

// Duplicate shift function
async function duplicateShift(employeeId, dateStr) {
    try {
        // Get the original shift data
        const employee = filteredData[employeeId];
        const originalShift = employee.dates.find(d => d.date === dateStr);

        if (!originalShift) {
            alert('Shift not found. Please try again.');
            return;
        }

        // Calculate the next day
        const originalDate = new Date(dateStr);
        const nextDate = new Date(originalDate);
        nextDate.setDate(originalDate.getDate() + 1);
        
        // Format the next date
        const nextDateStr = formatDate(nextDate);

        // Check if shift already exists for the next day
        const existingShift = employee.dates.find(d => d.date === nextDateStr);
        if (existingShift) {
            if (!confirm(`A shift already exists for ${nextDateStr}. Do you want to overwrite it?`)) {
                return;
            }
        }

        // Create the duplicated shift data with the correct structure
        // Use originalShift's scheduled times if they exist, otherwise use shift schedule defaults
        let scheduledInValue, scheduledOutValue;
        if (originalShift.scheduledIn !== undefined && originalShift.scheduledOut !== undefined) {
            scheduledInValue = originalShift.scheduledIn;
            scheduledOutValue = originalShift.scheduledOut;
        } else {
            const shiftSchedule = SHIFT_SCHEDULES[originalShift.shift] || SHIFT_SCHEDULES["Custom"];
            scheduledInValue = shiftSchedule.timeIn;
            scheduledOutValue = shiftSchedule.timeOut;
        }
        const duplicatedShift = {
            date: nextDateStr,
            branch: originalShift.branch,
            shift: originalShift.shift,
            scheduledIn: scheduledInValue,
            scheduledOut: scheduledOutValue,
            timeIn: originalShift.timeIn,
            timeOut: originalShift.timeOut,
            timeInPhoto: originalShift.timeInPhoto,
            timeOutPhoto: originalShift.timeOutPhoto,
            hasDoublePay: originalShift.hasDoublePay,
            hasFixedPay: originalShift.hasFixedPay,
            fixedPayAmount: originalShift.fixedPayAmount,
            hasMealAllowance: originalShift.hasMealAllowance,
            transpoAllowance: originalShift.transpoAllowance,
            hasOTPay: originalShift.hasOTPay
        };

        // Save to Firebase in the correct structure
        const firebaseData = {
            clockIn: {
                time: duplicatedShift.timeIn,
                branch: duplicatedShift.branch,
                shift: duplicatedShift.shift
            },
            clockOut: {
                time: duplicatedShift.timeOut
            },
            hasDoublePay: duplicatedShift.hasDoublePay,
            hasFixedPay: duplicatedShift.hasFixedPay,
            fixedPayAmount: duplicatedShift.fixedPayAmount,
            hasMealAllowance: duplicatedShift.hasMealAllowance,
            transpoAllowance: duplicatedShift.transpoAllowance,
            hasOTPay: duplicatedShift.hasOTPay
        };

        // Add scheduled times if they exist (for Custom shifts)
        if (duplicatedShift.shift === 'Custom' && scheduledInValue && scheduledOutValue) {
            firebaseData.scheduledIn = scheduledInValue;
            firebaseData.scheduledOut = scheduledOutValue;
        }

        const docRef = doc(db, "attendance_v2", employeeId, "dates", nextDateStr);
        await setDoc(docRef, firebaseData);

        // Update local data
        if (existingShift) {
            // Replace existing shift
            const index = employee.dates.findIndex(d => d.date === nextDateStr);
            employee.dates[index] = duplicatedShift;
        } else {
            // Add new shift
            employee.dates.push(duplicatedShift);
        }

        // Update cache
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        // Refresh the view
        filterData();

        // Reload single employee view if active
        if (currentEmployeeView === employeeId) {
            const container = document.getElementById('employee-details-table');
            if (container) {
                await loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        showToast(`Shift duplicated successfully for ${nextDateStr}`);
    } catch (error) {
        console.error('Error duplicating shift:', error);
        alert('Failed to duplicate shift. Please try again.');
    }
}

// Add function to manually refresh payment status indicators
window.refreshPaymentStatus = async function() {
    const periodId = periodSelect.value;
    localStorage.removeItem(periodPaymentsCacheKey(periodId));
    await updateEmployeePaymentStatus(true);
    console.log('Payment status indicators refreshed!');
};

// Add function to force refresh payment status immediately
window.forceRefreshPaymentStatus = async function() {
    console.log('🔄 Force refreshing payment status indicators...');
    
    // Clear all payment caches
    const periodId = periodSelect.value;
    localStorage.removeItem(periodPaymentsCacheKey(periodId));
    
    // Force reload payment data and render
    await loadPaymentDataAndRender();
    
    console.log('✅ Payment status indicators force refreshed!');
};

async function buildAdminEmployeePayslipPdf(employeeId) {
    const employee = filteredData[employeeId] || attendanceData[employeeId];
    if (!employee) {
        throw new Error('Employee data not loaded');
    }
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
        throw new Error('PDF libraries not loaded. Refresh the page.');
    }

    const periodId = periodSelect.value;
    const periodOpt = periodSelect.options[periodSelect.selectedIndex];
    const periodLabel = periodOpt ? periodOpt.textContent : periodId;
    const merged = mergeEmpRates(employee, periodId);
    const employeeName = employee.name || employees[employeeId] || employeeId;
    const employeeRole = employee.role || 'Barista';
    const transferMode = employee.transferMode || employee.modeOfTransfer || 'GoTyme';
    const payType = merged.payType || employee.payType || 'hourly';
    const dates = Array.isArray(employee.dates) ? employee.dates : [];
    const earningsLines = Array.isArray(employee.periodEarningsLines) ? employee.periodEarningsLines : [];
    const earningsTotal = Number(employee.periodEarningsTotal)
        || earningsLines.filter((l) => l.status !== 'waived').reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

    const employeeData = {
        ...merged,
        baseRate: merged.baseRate || employee.baseRate || 750,
        salesBonusEligible: employee.salesBonusEligible || false,
        payType,
        monthlySalary: merged.monthlySalary || employee.monthlySalary || 0,
        periodGross: merged.periodGross,
        periodFixedAmount: merged.periodFixedAmount || employee.periodFixedAmount || 0
    };

    const { branchData, workedDays } = buildPayslipBranchData({
        dates,
        payType,
        employeeData,
        payCalculator
    });

    let periodBreakdown = {};
    let attendanceOnly = 0;
    if (payCalculator) {
        const periodResult = payCalculator.calculateTotalPay(workedDays, employeeData, 'detailed');
        periodBreakdown = periodResult?.breakdown || {};
        attendanceOnly = Number(payCalculator.calculateTotalPay(workedDays, employeeData, 'simple')) || 0;
    } else {
        attendanceOnly = (Number(employee.totalPayWithBonus) || 0) - earningsTotal;
    }
    const grandTotal = attendanceOnly + earningsTotal;

    const breakdownHTML = buildPayslipBreakdownHtml({
        payType,
        branchData,
        periodBreakdown,
        mergedEmployee: employeeData,
        attendanceOnly,
        grandTotal,
        earningsLines,
        earningsKindLabelFn: earningsKindLabel
    });

    const payslipHTML = buildPayslipDocumentHtml({
        employeeName,
        employeeRole,
        transferMode,
        periodLabel,
        grandTotal,
        breakdownHTML
    });

    const nameClean = String(employeeName).replace(/[^a-zA-Z0-9]/g, '_');
    const periodClean = String(periodId).replace(/[^a-zA-Z0-9]+/g, '_');
    const filename = 'matchanese_payslip_' + nameClean + '_' + periodClean + '.pdf';

    const rendered = await renderPayslipHtmlToPdf({
        payslipHTML,
        filename,
        html2canvasFn: html2canvas,
        jsPDFCtor: window.jspdf.jsPDF
    });

    return {
        blob: rendered.blob,
        dataUrl: rendered.dataUrl,
        filename: rendered.filename,
        grandTotal,
        periodLabel,
        employeeName,
        periodId,
        pdf: rendered.pdf
    };
}

async function generateAdminEmployeePayslipPDF(employeeId, btnEl) {
    const originalHtml = btnEl ? btnEl.innerHTML : '';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = 'Generating…';
    }

    try {
        const { pdf, filename } = await buildAdminEmployeePayslipPdf(employeeId);
        pdf.save(filename);
        showToast('Payslip downloaded');
    } catch (err) {
        console.error('Admin payslip failed:', err);
        showToast(err?.message || 'Failed to generate payslip', 'error');
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalHtml;
        }
    }
}

window.buildAdminEmployeePayslipPdf = buildAdminEmployeePayslipPdf;
window.generateAdminEmployeePayslipPDF = generateAdminEmployeePayslipPDF;
