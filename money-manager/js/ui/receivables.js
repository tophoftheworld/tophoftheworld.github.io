import { getState } from '../store.js';
import { formatMoney, escapeHtml, todayISO, uid } from '../format.js';
import {
    openModal,
    closeModal,
    toast,
    showWarnings,
    fundSelectOptions,
    accountSelectOptions
} from './shell.js';
import {
    recordReceivablePayment,
    saveReceivable,
    deleteReceivable
} from '../commands.js';

export function openReceivables() {
    const state = getState();
    const rows = [...state.receivables].sort((a, b) => {
        const order = { UNPAID: 0, PARTIAL: 1, PAID: 2 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

    const byFund = {};
    for (const r of rows) {
        if (!byFund[r.fund_id]) byFund[r.fund_id] = { due: 0, paid: 0, total: 0 };
        byFund[r.fund_id].due += Number(r.amount_due || 0);
        byFund[r.fund_id].paid += Number(r.amount_paid || 0);
        byFund[r.fund_id].total += Number(r.amount_total || 0);
    }

    const totalsHtml = Object.entries(byFund)
        .map(([fid, t]) => {
            const f = state.funds.find((x) => x.id === fid);
            return `<div class="kv"><span>${escapeHtml(f?.name || fid)}</span><span>due ${formatMoney(t.due)} / ${formatMoney(t.total)}</span></div>`;
        })
        .join('');

    openModal({
        title: 'Receivables',
        bodyHtml: `
          <div class="detail-block">${totalsHtml || '<p class="list-row-sub">None</p>'}</div>
          <div class="toolbar">
            <button type="button" class="btn secondary" id="btnAddRec">Add receivable</button>
          </div>
          <div id="recList" style="max-height:50vh;overflow:auto"></div>
        `,
        actions: [{ label: 'Close', className: 'secondary' }]
    });

    const list = document.getElementById('recList');
    list.innerHTML = rows
        .map((r) => {
            const fund = state.funds.find((f) => f.id === r.fund_id);
            const pct = r.amount_total
                ? Math.min(100, (Number(r.amount_paid || 0) / Number(r.amount_total)) * 100)
                : 0;
            return `
        <div class="list-row" data-id="${escapeHtml(r.id)}">
          <div class="list-row-top">
            <h3 class="list-row-title">${escapeHtml(r.payer)}</h3>
            <p class="list-row-amt">${formatMoney(r.amount_due)} due</p>
          </div>
          <p class="list-row-sub">${escapeHtml(r.status)} · ${escapeHtml(fund?.name || r.fund_id)} · paid ${formatMoney(r.amount_paid)} / ${formatMoney(r.amount_total)}</p>
          <div class="progress" style="--fund-color:${escapeHtml(fund?.color || '#3F7D58')}"><span style="width:${pct}%"></span></div>
          ${r.note ? `<div class="note-block">${escapeHtml(r.note)}</div>` : ''}
        </div>`;
        })
        .join('') || '<p class="empty">No receivables</p>';

    document.getElementById('btnAddRec').addEventListener('click', () => {
        closeModal();
        openEditReceivable(null);
    });

    list.querySelectorAll('[data-id]').forEach((row) => {
        row.addEventListener('click', () => {
            const r = state.receivables.find((x) => x.id === row.dataset.id);
            closeModal();
            openReceivableActions(r);
        });
    });
}

function openReceivableActions(r) {
    const state = getState();
    openModal({
        title: r.payer,
        bodyHtml: `
          <div class="kv"><span>Status</span><span>${escapeHtml(r.status)}</span></div>
          <div class="kv"><span>Total</span><span>${formatMoney(r.amount_total)}</span></div>
          <div class="kv"><span>Paid</span><span>${formatMoney(r.amount_paid)}</span></div>
          <div class="kv"><span>Due</span><span>${formatMoney(r.amount_due)}</span></div>
          ${r.note ? `<div class="note-block">${escapeHtml(r.note)}</div>` : ''}
          <div class="modal-actions" style="margin-top:12px;flex-direction:column">
            ${
                r.status !== 'PAID'
                    ? `<button type="button" class="btn" id="btnPayRec">Record payment</button>`
                    : ''
            }
            <button type="button" class="btn secondary" id="btnEditRec">Edit</button>
            <button type="button" class="btn danger" id="btnDelRec">Delete</button>
          </div>
        `,
        actions: [{ label: 'Close', className: 'secondary' }]
    });

    document.getElementById('btnPayRec')?.addEventListener('click', () => {
        closeModal();
        openPaymentForm(r);
    });
    document.getElementById('btnEditRec').addEventListener('click', () => {
        closeModal();
        openEditReceivable(r);
    });
    document.getElementById('btnDelRec').addEventListener('click', async () => {
        if (!confirm('Delete receivable?')) return;
        await deleteReceivable(r.id);
        closeModal();
        toast('Deleted');
    });
}

function openPaymentForm(r) {
    const state = getState();
    const defaultAcct = r.received_in || '';
    openModal({
        title: `Payment — ${r.payer}`,
        bodyHtml: `
          <div class="field">
            <label>Amount</label>
            <input class="field-input" id="payAmt" type="number" step="0.01" value="${Number(r.amount_due) || ''}">
          </div>
          <div class="field">
            <label>Received in account</label>
            <select class="field-select" id="payAcct">${accountSelectOptions(state.accounts, defaultAcct)}</select>
          </div>
          <div class="field">
            <label>Date</label>
            <input class="field-input" id="payDate" type="date" value="${todayISO()}">
          </div>
          <div class="field">
            <label>Note</label>
            <textarea class="field-textarea" id="payNote"></textarea>
          </div>
        `,
        actions: [
            { label: 'Cancel', className: 'secondary' },
            {
                label: 'Record',
                close: false,
                onClick: async () => {
                    try {
                        const result = await recordReceivablePayment({
                            receivable_id: r.id,
                            amount: Number(document.getElementById('payAmt').value),
                            account_id: document.getElementById('payAcct').value,
                            date: document.getElementById('payDate').value,
                            note: document.getElementById('payNote').value
                        });
                        showWarnings(result.warnings);
                        closeModal();
                        toast('Payment recorded');
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });
}

function openEditReceivable(r) {
    const state = getState();
    const isNew = !r;
    openModal({
        title: isNew ? 'Add receivable' : 'Edit receivable',
        bodyHtml: `
          <div class="field"><label>Payer</label><input class="field-input" id="rPayer" value="${escapeHtml(r?.payer || '')}"></div>
          <div class="field"><label>Fund</label><select class="field-select" id="rFund">${fundSelectOptions(state.funds, r?.fund_id)}</select></div>
          <div class="field-row">
            <div class="field"><label>Total</label><input class="field-input" id="rTotal" type="number" step="0.01" value="${r?.amount_total ?? ''}"></div>
            <div class="field"><label>Paid</label><input class="field-input" id="rPaid" type="number" step="0.01" value="${r?.amount_paid ?? 0}"></div>
          </div>
          <div class="field"><label>Expected account</label><select class="field-select" id="rAcct"><option value="">—</option>${accountSelectOptions(state.accounts, r?.received_in || '')}</select></div>
          <div class="field"><label>Due date</label><input class="field-input" id="rDue" type="date" value="${escapeHtml(r?.due_date || '')}"></div>
          <div class="field"><label>Note</label><textarea class="field-textarea" id="rNote">${escapeHtml(r?.note || '')}</textarea></div>
        `,
        actions: [
            { label: 'Cancel', className: 'secondary' },
            {
                label: 'Save',
                close: false,
                onClick: async () => {
                    try {
                        await saveReceivable({
                            id: r?.id || uid('R'),
                            payer: document.getElementById('rPayer').value,
                            fund_id: document.getElementById('rFund').value,
                            amount_total: Number(document.getElementById('rTotal').value),
                            amount_paid: Number(document.getElementById('rPaid').value),
                            received_in: document.getElementById('rAcct').value || null,
                            due_date: document.getElementById('rDue').value || null,
                            note: document.getElementById('rNote').value,
                            terms: r?.terms
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
