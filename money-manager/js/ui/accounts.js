import { getState } from '../store.js';
import { accountFundSplit, historyTransactions, liveTransactions } from '../compute.js';
import {
    formatMoney,
    formatDate,
    escapeHtml,
    roleLabel,
    todayISO
} from '../format.js';
import {
    openModal,
    closeModal,
    toast,
    showWarnings,
    fundSelectOptions
} from './shell.js';
import { reconcileAccount } from '../commands.js';
import { bankTheme, bankThemeClass } from '../banks.js';

let focusAccountId = null;

document.addEventListener('mm:focus-account', (e) => {
    focusAccountId = e.detail;
});

export function renderAccounts() {
    const el = document.getElementById('view-accounts');
    const state = getState();

    if (focusAccountId) {
        const acct = state.accounts.find((a) => a.id === focusAccountId);
        if (acct) {
            renderAccountDetail(el, acct, state);
            return;
        }
    }

    el.innerHTML = `
      <h2 class="section-title">Accounts</h2>
      <div id="acctList"></div>
    `;

    const list = el.querySelector('#acctList');
    list.innerHTML = state.accounts
        .map((a) => {
            const theme = bankTheme(a.institution);
            const bankClass = bankThemeClass(a.institution);
            const split = accountFundSplit(state, a.id);
            const totalSplit = split.reduce((s, x) => s + x.amount, 0) || 1;
            const bar =
                split.length === 0
                    ? ''
                    : `<div class="fund-bar">
              ${split
                  .map(
                      (s) =>
                          `<div class="fund-bar-seg" style="flex-grow:${(s.amount / totalSplit) * 100};background:${escapeHtml(s.color)}"></div>`
                  )
                  .join('')}
            </div>
            <div class="fund-bar-legend">
              ${split
                  .map(
                      (s) =>
                          `<span><i class="swatch" style="background:${escapeHtml(s.color)}"></i>${escapeHtml(s.name)} ${formatMoney(s.amount)}</span>`
                  )
                  .join('')}
            </div>`;
            return `
        <article class="account-tile ${escapeHtml(bankClass)}" data-id="${escapeHtml(a.id)}">
          <div class="account-tile-head">
            <div>
              <span class="account-bank-tag">${escapeHtml(theme.label)}</span>
              <h3 class="account-name">${escapeHtml(a.name)}</h3>
              <p class="account-meta"><span class="role-badge ${escapeHtml(a.role || '')}">${escapeHtml(roleLabel(a.role))}</span></p>
            </div>
            <p class="account-bal ${a.balance == null ? 'unknown' : ''}">${a.balance == null ? 'Unknown' : formatMoney(a.balance)}</p>
          </div>
          ${bar}
        </article>`;
        })
        .join('') || '<p class="empty">No accounts</p>';

    list.querySelectorAll('[data-id]').forEach((row) => {
        row.addEventListener('click', () => {
            focusAccountId = row.dataset.id;
            renderAccounts();
        });
    });
}

function renderAccountDetail(el, acct, state) {
    const split = accountFundSplit(state, acct.id);
    const live = liveTransactions(state)
        .filter((t) => t.account_id === acct.id || t.to_account_id === acct.id)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const hist = historyTransactions(state)
        .filter((t) => t.account_id === acct.id)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const limitsHtml = Object.entries(acct.limits || {})
        .map(
            ([k, v]) =>
                `<div class="kv"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`
        )
        .join('') || '<p class="list-row-sub">No limits recorded</p>';

    el.innerHTML = `
      <button type="button" class="btn ghost" id="backAccts">← All accounts</button>
      <div class="detail-block bank-hero ${escapeHtml(bankThemeClass(acct.institution))}">
        <span class="account-bank-tag">${escapeHtml(bankTheme(acct.institution).label)}</span>
        <h2 class="section-title" style="margin-top:6px">${escapeHtml(acct.name)}</h2>
        <p class="list-row-sub">${escapeHtml(roleLabel(acct.role))} · ${escapeHtml(acct.titling || '')}</p>
        <p class="strip-value" style="margin-top:8px">${acct.balance == null ? 'Unknown' : formatMoney(acct.balance)}</p>
        ${acct.as_of ? `<p class="strip-hint">As of ${escapeHtml(formatDate(acct.as_of))}</p>` : ''}
        ${acct.notes ? `<div class="note-block" style="background:rgba(255,255,255,0.15);color:#fff">${escapeHtml(acct.notes)}</div>` : ''}
        <div class="modal-actions" style="margin-top:12px">
          <button type="button" class="btn secondary" id="btnReconcile">Reconcile</button>
        </div>
      </div>

      <h3 class="section-title">Fund composition</h3>
      <div class="detail-block">
        ${
            split.length
                ? split
                      .map(
                          (s) =>
                              `<div class="kv"><span><i class="swatch" style="background:${escapeHtml(s.color)};box-shadow:none"></i>${escapeHtml(s.name)}</span><span>${formatMoney(s.amount)}</span></div>`
                      )
                      .join('')
                : '<p class="list-row-sub">No allocations</p>'
        }
      </div>

      <h3 class="section-title">Transfer limits</h3>
      <div class="detail-block">${limitsHtml}</div>

      <h3 class="section-title">Live activity</h3>
      <div id="liveTx">${txnList(live)}</div>

      <h3 class="section-title">History (opening context)</h3>
      <div id="histTx">${txnList(hist)}</div>
    `;

    el.querySelector('#backAccts').addEventListener('click', () => {
        focusAccountId = null;
        renderAccounts();
    });

    el.querySelector('#btnReconcile').addEventListener('click', () => openReconcileModal(acct, state));
}

function txnList(rows) {
    if (!rows.length) return '<p class="empty">None</p>';
    return rows
        .map(
            (t) => `
      <div class="list-row">
        <div class="list-row-top">
          <h3 class="list-row-title">${escapeHtml(t.counterparty || t.category || t.type || 'Txn')}</h3>
          <p class="list-row-amt ${t.direction === 'in' ? 'in' : t.direction === 'out' ? 'out' : ''}">${
                t.direction === 'in' ? '+' : t.direction === 'out' ? '−' : ''
            }${formatMoney(t.amount)}</p>
        </div>
        <p class="list-row-sub">${escapeHtml(t.date)} · ${escapeHtml(t.fund_id)} · ${escapeHtml(t.direction)}</p>
        ${t.note ? `<div class="note-block">${escapeHtml(t.note)}</div>` : ''}
      </div>`
        )
        .join('');
}

function openReconcileModal(acct, state) {
    openModal({
        title: 'Reconcile account',
        bodyHtml: `
          <p class="list-row-sub">Book balance: <strong>${acct.balance == null ? 'Unknown' : formatMoney(acct.balance)}</strong></p>
          <div class="field">
            <label>Actual bank balance</label>
            <input class="field-input" id="recActual" type="number" step="0.01" value="${acct.balance ?? ''}">
          </div>
          <div class="field">
            <label>Fund for adjustment (if booking variance)</label>
            <select class="field-select" id="recFund">${fundSelectOptions(state.funds)}</select>
          </div>
          <div class="field">
            <label>
              <input type="checkbox" id="recBook" checked>
              Book adjustment transaction for variance
            </label>
          </div>
          <div class="field">
            <label>Note</label>
            <textarea class="field-textarea" id="recNote" placeholder="Why the variance?"></textarea>
          </div>
          <p class="list-row-sub" id="recVariance"></p>
        `,
        actions: [
            { label: 'Cancel', className: 'secondary', onClick: () => {} },
            {
                label: 'Save',
                close: false,
                onClick: async () => {
                    const actual = Number(document.getElementById('recActual').value);
                    if (Number.isNaN(actual)) {
                        toast('Enter a valid balance', 'danger');
                        return;
                    }
                    try {
                        const result = await reconcileAccount({
                            account_id: acct.id,
                            actual_balance: actual,
                            book_adjustment: document.getElementById('recBook').checked,
                            fund_id: document.getElementById('recFund').value,
                            note: document.getElementById('recNote').value,
                            date: todayISO()
                        });
                        closeModal();
                        toast(
                            result.variance == null
                                ? 'Balance set'
                                : `Reconciled · variance ${formatMoney(result.variance)}`,
                            'ok'
                        );
                        renderAccounts();
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });

    const actualInput = document.getElementById('recActual');
    const varianceEl = document.getElementById('recVariance');
    const updateVar = () => {
        if (acct.balance == null) {
            varianceEl.textContent = 'No book balance to compare — setting opening figure.';
            return;
        }
        const v = Number(actualInput.value) - Number(acct.balance);
        varianceEl.textContent = `Variance: ${formatMoney(v)} (actual − book)`;
    };
    actualInput.addEventListener('input', updateVar);
    updateVar();
}
