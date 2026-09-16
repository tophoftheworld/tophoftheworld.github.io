import { getState } from '../store.js';
import {
    formatMoney,
    escapeHtml,
    todayISO
} from '../format.js';
import {
    openModal,
    closeModal,
    toast,
    showWarnings,
    fundSelectOptions,
    accountSelectOptions
} from './shell.js';
import {
    addMoneyIn,
    addExpense,
    updateTransaction,
    deleteTransaction,
    bulkReassignFundOnTransactions
} from '../commands.js';

let filter = { q: '', fund: '', account: '', dir: '' };
const selected = new Set();

export function renderLedger() {
    const el = document.getElementById('view-ledger');
    const state = getState();
    let rows = [...state.transactions].sort((a, b) =>
        String(b.date).localeCompare(String(a.date))
    );

    const q = filter.q.trim().toLowerCase();
    if (q) {
        rows = rows.filter((t) =>
            [
                t.note,
                t.counterparty,
                t.category,
                t.description,
                t.account_id,
                t.fund_id,
                t.amount,
                t.date,
                t.status,
                ...(t.tags || [])
            ]
                .join(' ')
                .toLowerCase()
                .includes(q)
        );
    }
    if (filter.fund) rows = rows.filter((t) => t.fund_id === filter.fund || t.from_fund_id === filter.fund || t.to_fund_id === filter.fund);
    if (filter.account) {
        rows = rows.filter(
            (t) => t.account_id === filter.account || t.to_account_id === filter.account
        );
    }
    if (filter.dir) rows = rows.filter((t) => t.direction === filter.dir);

    el.innerHTML = `
      <div class="toolbar">
        <input class="search-input" id="ledgerQ" placeholder="Search every field…" value="${escapeHtml(filter.q)}">
      </div>
      <div class="chip-row">
        <button type="button" class="chip ${!filter.dir ? 'active' : ''}" data-dir="">All</button>
        <button type="button" class="chip ${filter.dir === 'in' ? 'active' : ''}" data-dir="in">In</button>
        <button type="button" class="chip ${filter.dir === 'out' ? 'active' : ''}" data-dir="out">Out</button>
        <button type="button" class="chip ${filter.dir === 'transfer' ? 'active' : ''}" data-dir="transfer">Moves</button>
        <button type="button" class="chip ${filter.dir === 'reassign' ? 'active' : ''}" data-dir="reassign">Reassign</button>
      </div>
      <div class="field-row" style="margin-bottom:12px">
        <select class="field-select" id="filterFund">
          <option value="">All funds</option>
          ${fundSelectOptions(state.funds, filter.fund)}
        </select>
        <select class="field-select" id="filterAcct">
          <option value="">All accounts</option>
          ${accountSelectOptions(state.accounts, filter.account)}
        </select>
      </div>
      <div id="ledgerList"></div>
      <div id="bulkBar"></div>
    `;

    el.querySelector('#ledgerQ').addEventListener('input', (e) => {
        filter.q = e.target.value;
        renderLedger();
    });
    el.querySelectorAll('[data-dir]').forEach((c) => {
        c.addEventListener('click', () => {
            filter.dir = c.dataset.dir;
            renderLedger();
        });
    });
    el.querySelector('#filterFund').addEventListener('change', (e) => {
        filter.fund = e.target.value;
        renderLedger();
    });
    el.querySelector('#filterAcct').addEventListener('change', (e) => {
        filter.account = e.target.value;
        renderLedger();
    });

    const list = el.querySelector('#ledgerList');
    if (!rows.length) {
        list.innerHTML = '<p class="empty">No transactions match.</p>';
    } else {
        list.innerHTML = rows
            .map((t) => {
                const fund = state.funds.find((f) => f.id === t.fund_id);
                const acct = state.accounts.find((a) => a.id === t.account_id);
                const hist = t.already_reflected_in_opening_balance;
                const noteId = `note_${t.id}`;
                return `
          <div class="list-row" data-txn="${escapeHtml(t.id)}">
            <div class="list-row-top">
              <label style="display:flex;gap:8px;align-items:flex-start;min-width:0;flex:1">
                <input type="checkbox" class="bulk-check" data-id="${escapeHtml(t.id)}" ${selected.has(t.id) ? 'checked' : ''}>
                <span>
                  <h3 class="list-row-title">${escapeHtml(t.counterparty || t.description || t.category || t.type || 'Entry')}</h3>
                  <p class="list-row-sub">
                    ${escapeHtml(t.date)}
                    · ${escapeHtml(acct?.name || t.account_id)}
                    · ${escapeHtml(fund?.name || t.fund_id)}
                    · ${escapeHtml(t.direction)}
                    ${hist ? ' · <em>history</em>' : ''}
                  </p>
                </span>
              </label>
              <p class="list-row-amt ${t.direction === 'in' ? 'in' : t.direction === 'out' ? 'out' : ''}">
                ${t.direction === 'in' ? '+' : t.direction === 'out' ? '−' : ''}${formatMoney(t.amount)}
              </p>
            </div>
            ${
                t.note
                    ? `<div class="note-block collapsed" id="${noteId}">${escapeHtml(t.note)}</div>
                       <button type="button" class="note-toggle" data-note="${noteId}">Expand note</button>`
                    : ''
            }
          </div>`;
            })
            .join('');
    }

    list.querySelectorAll('.note-toggle').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const block = document.getElementById(btn.dataset.note);
            const collapsed = block.classList.toggle('collapsed');
            btn.textContent = collapsed ? 'Expand note' : 'Collapse note';
        });
    });

    list.querySelectorAll('.bulk-check').forEach((cb) => {
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => {
            if (cb.checked) selected.add(cb.dataset.id);
            else selected.delete(cb.dataset.id);
            renderBulkBar(el, state);
        });
    });

    list.querySelectorAll('[data-txn]').forEach((row) => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('input,button')) return;
            const t = state.transactions.find((x) => x.id === row.dataset.txn);
            if (t) openTxnDetail(t, state);
        });
    });

    renderBulkBar(el, state);
}

function renderBulkBar(el, state) {
    const bar = el.querySelector('#bulkBar');
    if (!selected.size) {
        bar.innerHTML = '';
        return;
    }
    bar.innerHTML = `
      <div class="bulk-bar">
        <span>${selected.size} selected</span>
        <select id="bulkFund">${fundSelectOptions(state.funds)}</select>
        <button type="button" class="btn secondary" id="bulkApply">Set fund</button>
        <button type="button" class="btn ghost" id="bulkClear">Clear</button>
      </div>`;
    bar.querySelector('#bulkClear').addEventListener('click', () => {
        selected.clear();
        renderLedger();
    });
    bar.querySelector('#bulkApply').addEventListener('click', async () => {
        try {
            const result = await bulkReassignFundOnTransactions({
                ids: [...selected],
                fund_id: bar.querySelector('#bulkFund').value
            });
            showWarnings(result.warnings);
            selected.clear();
            toast('Bulk fund update done');
            renderLedger();
        } catch (err) {
            toast(err.message, 'danger');
        }
    });
}

function openTxnDetail(t, state) {
    openModal({
        title: 'Transaction',
        bodyHtml: `
          <div class="kv"><span>Date</span><span>${escapeHtml(t.date)}</span></div>
          <div class="kv"><span>Account</span><span>${escapeHtml(t.account_id)}</span></div>
          <div class="kv"><span>Fund</span><span>${escapeHtml(t.fund_id)}</span></div>
          <div class="kv"><span>Direction</span><span>${escapeHtml(t.direction)}</span></div>
          <div class="kv"><span>Amount</span><span>${formatMoney(t.amount)}</span></div>
          <div class="kv"><span>Category</span><span>${escapeHtml(t.category || '—')}</span></div>
          <div class="kv"><span>Counterparty</span><span>${escapeHtml(t.counterparty || '—')}</span></div>
          <div class="field" style="margin-top:12px">
            <label>Note</label>
            <textarea class="field-textarea" id="txnNote">${escapeHtml(t.note || '')}</textarea>
          </div>
          ${t.already_reflected_in_opening_balance ? '<p class="list-row-sub">History row — already in opening balances.</p>' : ''}
        `,
        actions: [
            {
                label: 'Delete',
                className: 'danger',
                close: false,
                onClick: async () => {
                    if (!confirm('Delete this transaction?')) return;
                    try {
                        const r = await deleteTransaction({ id: t.id });
                        showWarnings(r.warnings);
                        closeModal();
                        toast('Deleted');
                        renderLedger();
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            },
            {
                label: 'Save note',
                close: false,
                onClick: async () => {
                    try {
                        await updateTransaction({
                            id: t.id,
                            note: document.getElementById('txnNote').value
                        });
                        closeModal();
                        toast('Saved');
                        renderLedger();
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });
}

export function openQuickEntry() {
    const state = getState();
    if (!state.accounts.length) {
        toast('Import data first', 'warn');
        return;
    }

    openModal({
        title: 'Add money',
        bodyHtml: `
          <div class="tabs">
            <button type="button" class="tab active" data-mode="in">Money in</button>
            <button type="button" class="tab" data-mode="out">Expense</button>
          </div>
          <div class="field">
            <label>Amount</label>
            <input class="field-input" id="qeAmount" type="number" step="0.01" inputmode="decimal" autofocus>
          </div>
          <div class="field">
            <label>Account</label>
            <select class="field-select" id="qeAcct">${accountSelectOptions(state.accounts)}</select>
          </div>
          <div class="field">
            <label>Fund</label>
            <select class="field-select" id="qeFund">${fundSelectOptions(state.funds)}</select>
          </div>
          <div class="field">
            <label>Note</label>
            <textarea class="field-textarea" id="qeNote" placeholder="Why — required for clarity"></textarea>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Date</label>
              <input class="field-input" id="qeDate" type="date" value="${todayISO()}">
            </div>
            <div class="field">
              <label>Counterparty</label>
              <input class="field-input" id="qeCp" placeholder="Optional">
            </div>
          </div>
        `,
        actions: [
            { label: 'Cancel', className: 'secondary' },
            {
                label: 'Save',
                close: false,
                onClick: async () => {
                    const mode =
                        document.querySelector('.tab.active')?.dataset.mode || 'in';
                    const payload = {
                        amount: Number(document.getElementById('qeAmount').value),
                        account_id: document.getElementById('qeAcct').value,
                        fund_id: document.getElementById('qeFund').value,
                        note: document.getElementById('qeNote').value,
                        date: document.getElementById('qeDate').value,
                        counterparty: document.getElementById('qeCp').value
                    };
                    try {
                        const result =
                            mode === 'in' ? await addMoneyIn(payload) : await addExpense(payload);
                        showWarnings(result.warnings);
                        closeModal();
                        toast(mode === 'in' ? 'Money in recorded' : 'Expense recorded');
                        renderLedger();
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });

    const modal = document.querySelector('.modal');
    modal.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            modal.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            modal.querySelector('.modal-head h2').textContent =
                tab.dataset.mode === 'in' ? 'Add money in' : 'Add expense';
        });
    });
}
