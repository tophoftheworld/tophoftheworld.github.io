import { getState } from '../store.js';
import { obligationCoverage } from '../compute.js';
import { formatMoney, formatDate, escapeHtml, todayISO, uid } from '../format.js';
import {
    openModal,
    closeModal,
    toast,
    showWarnings,
    fundSelectOptions,
    accountSelectOptions
} from './shell.js';
import { markPayablePaid, savePayable, deletePayable } from '../commands.js';

export function openPayables() {
    const state = getState();
    const rows = [...state.payables].sort((a, b) => {
        if (a.status === 'PAID' && b.status !== 'PAID') return 1;
        if (b.status === 'PAID' && a.status !== 'PAID') return -1;
        return String(a.due_date || '').localeCompare(String(b.due_date || ''));
    });

    openModal({
        title: 'Payables',
        bodyHtml: `
          <div class="toolbar">
            <button type="button" class="btn secondary" id="btnAddPay">Add payable</button>
          </div>
          <div id="payList" style="max-height:55vh;overflow:auto"></div>
        `,
        actions: [{ label: 'Close', className: 'secondary' }]
    });

    const list = document.getElementById('payList');
    list.innerHTML = rows
        .map((p) => {
            const fund = state.funds.find((f) => f.id === p.fund_id);
            const cov = obligationCoverage(state, p);
            return `
        <div class="list-row" data-id="${escapeHtml(p.id)}">
          <div class="list-row-top">
            <h3 class="list-row-title">${escapeHtml(p.payee)}</h3>
            <p class="list-row-amt out">${formatMoney(p.amount)}</p>
          </div>
          <p class="list-row-sub">
            ${escapeHtml(p.status)} · ${formatDate(p.due_date)} · ${escapeHtml(fund?.name || p.fund_id)}
            · <span class="coverage"><i class="dot ${escapeHtml(cov.level)}"></i>${escapeHtml(cov.label)}</span>
          </p>
          ${p.note ? `<div class="note-block">${escapeHtml(p.note)}</div>` : ''}
        </div>`;
        })
        .join('') || '<p class="empty">No payables</p>';

    document.getElementById('btnAddPay').addEventListener('click', () => {
        closeModal();
        openEditPayable(null);
    });

    list.querySelectorAll('[data-id]').forEach((row) => {
        row.addEventListener('click', () => {
            const p = state.payables.find((x) => x.id === row.dataset.id);
            closeModal();
            openPayableActions(p);
        });
    });
}

function openPayableActions(p) {
    const state = getState();
    openModal({
        title: p.payee,
        bodyHtml: `
          <div class="kv"><span>Amount</span><span>${formatMoney(p.amount)}</span></div>
          <div class="kv"><span>Due</span><span>${formatDate(p.due_date)}</span></div>
          <div class="kv"><span>Fund</span><span>${escapeHtml(p.fund_id)}</span></div>
          <div class="kv"><span>Source</span><span>${escapeHtml(p.planned_source || '—')}</span></div>
          <div class="kv"><span>Rail</span><span>${escapeHtml(p.rail || '—')}</span></div>
          <div class="kv"><span>Status</span><span>${escapeHtml(p.status)}</span></div>
          ${p.note ? `<div class="note-block">${escapeHtml(p.note)}</div>` : ''}
          <div class="modal-actions" style="margin-top:12px;flex-direction:column">
            ${
                p.status !== 'PAID'
                    ? `<button type="button" class="btn" id="btnMarkPaid">Mark paid</button>`
                    : ''
            }
            <button type="button" class="btn secondary" id="btnEditPay">Edit</button>
            <button type="button" class="btn danger" id="btnDelPay">Delete</button>
          </div>
        `,
        actions: [{ label: 'Close', className: 'secondary' }]
    });

    document.getElementById('btnMarkPaid')?.addEventListener('click', () => {
        closeModal();
        openMarkPaid(p);
    });
    document.getElementById('btnEditPay').addEventListener('click', () => {
        closeModal();
        openEditPayable(p);
    });
    document.getElementById('btnDelPay').addEventListener('click', async () => {
        if (!confirm('Delete payable?')) return;
        await deletePayable(p.id);
        closeModal();
        toast('Deleted');
    });
}

function openMarkPaid(p) {
    const state = getState();
    openModal({
        title: `Pay — ${p.payee}`,
        bodyHtml: `
          <div class="field">
            <label>Amount</label>
            <input class="field-input" id="mpAmt" type="number" step="0.01" value="${p.amount}">
          </div>
          <div class="field">
            <label>From account</label>
            <select class="field-select" id="mpAcct">${accountSelectOptions(state.accounts, p.planned_source || '')}</select>
          </div>
          <div class="field">
            <label>Date</label>
            <input class="field-input" id="mpDate" type="date" value="${todayISO()}">
          </div>
          <div class="field">
            <label>Note</label>
            <textarea class="field-textarea" id="mpNote">${escapeHtml(p.note || '')}</textarea>
          </div>
        `,
        actions: [
            { label: 'Cancel', className: 'secondary' },
            {
                label: 'Mark paid',
                close: false,
                onClick: async () => {
                    try {
                        const r = await markPayablePaid({
                            payable_id: p.id,
                            amount: Number(document.getElementById('mpAmt').value),
                            account_id: document.getElementById('mpAcct').value,
                            date: document.getElementById('mpDate').value,
                            note: document.getElementById('mpNote').value
                        });
                        showWarnings(r.warnings);
                        closeModal();
                        toast('Payable marked paid');
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });
}

function openEditPayable(p) {
    const state = getState();
    const isNew = !p;
    openModal({
        title: isNew ? 'Add payable' : 'Edit payable',
        bodyHtml: `
          <div class="field"><label>Payee</label><input class="field-input" id="pPayee" value="${escapeHtml(p?.payee || '')}"></div>
          <div class="field"><label>Amount</label><input class="field-input" id="pAmt" type="number" step="0.01" value="${p?.amount ?? ''}"></div>
          <div class="field"><label>Due date</label><input class="field-input" id="pDue" type="date" value="${escapeHtml(p?.due_date || '')}"></div>
          <div class="field"><label>Fund</label><select class="field-select" id="pFund">${fundSelectOptions(state.funds, p?.fund_id)}</select></div>
          <div class="field"><label>Planned source</label><select class="field-select" id="pSrc"><option value="">—</option>${accountSelectOptions(state.accounts, p?.planned_source || '')}</select></div>
          <div class="field"><label>Rail</label><input class="field-input" id="pRail" value="${escapeHtml(p?.rail || '')}"></div>
          <div class="field"><label>Note</label><textarea class="field-textarea" id="pNote">${escapeHtml(p?.note || '')}</textarea></div>
        `,
        actions: [
            { label: 'Cancel', className: 'secondary' },
            {
                label: 'Save',
                close: false,
                onClick: async () => {
                    try {
                        await savePayable({
                            id: p?.id || uid('P'),
                            payee: document.getElementById('pPayee').value,
                            amount: Number(document.getElementById('pAmt').value),
                            due_date: document.getElementById('pDue').value,
                            fund_id: document.getElementById('pFund').value,
                            planned_source: document.getElementById('pSrc').value || null,
                            rail: document.getElementById('pRail').value,
                            note: document.getElementById('pNote').value,
                            status: p?.status || 'SCHEDULED',
                            priority: p?.priority,
                            breakdown: p?.breakdown,
                            funding_route: p?.funding_route
                        });
                        closeModal();
                        toast('Saved');
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });
}
