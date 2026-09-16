import { getState } from '../store.js';
import { allFundPositions, accountFundSplit, whereDidItGo } from '../compute.js';
import { formatMoney, formatMoneyCompact, escapeHtml, uid } from '../format.js';
import { openModal, closeModal, toast, moneyClass } from './shell.js';
import { saveFund } from '../commands.js';

let focusFundId = null;

document.addEventListener('mm:focus-fund', (e) => {
    focusFundId = e.detail;
});

export function renderFunds() {
    const el = document.getElementById('view-funds');
    const state = getState();
    const positions = allFundPositions(state);

    if (focusFundId) {
        const pos = positions.find((p) => p.fund.id === focusFundId);
        if (pos) {
            renderFundDetail(el, pos, state);
            return;
        }
    }

    el.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn secondary" id="btnAddFund">Add fund</button>
      </div>
      <div class="fund-grid" id="fundList"></div>
    `;

    el.querySelector('#btnAddFund').addEventListener('click', () => openFundEditor(null));

    const list = el.querySelector('#fundList');
    list.innerHTML = positions
        .map(
            (p) => `
      <article class="fund-card ${p.isDeficit ? 'deficit' : ''}" style="--fund-color:${escapeHtml(p.fund.color)}" data-id="${escapeHtml(p.fund.id)}">
        <div class="fund-card-head">
          <h3 class="fund-name">${escapeHtml(p.fund.name)}</h3>
          <p class="fund-net ${moneyClass(p.net)}">${formatMoney(p.net)}</p>
        </div>
        <p class="list-row-sub">${escapeHtml(p.fund.purpose || '')}</p>
        <div class="fund-metrics" style="margin-top:8px">
          <div>Cash <strong>${formatMoneyCompact(p.cash)}</strong></div>
          <div>AR <strong>${formatMoneyCompact(p.receivables)}</strong></div>
          <div>AP <strong>${formatMoneyCompact(p.payables)}</strong></div>
          <div>IF net <strong>${formatMoneyCompact(p.interfund.net)}</strong></div>
        </div>
      </article>`
        )
        .join('') || '<p class="empty">No funds</p>';

    list.querySelectorAll('[data-id]').forEach((card) => {
        card.addEventListener('click', () => {
            focusFundId = card.dataset.id;
            renderFunds();
        });
    });
}

function renderFundDetail(el, pos, state) {
    const { fund } = pos;
    const byAccount = state.accounts
        .map((a) => {
            const split = accountFundSplit(state, a.id).find((s) => s.fund_id === fund.id);
            return split ? { account: a, amount: split.amount } : null;
        })
        .filter(Boolean);

    const gone = whereDidItGo(state, fund.id);
    const fundsById = Object.fromEntries(state.funds.map((f) => [f.id, f]));

    el.innerHTML = `
      <button type="button" class="btn ghost" id="backFunds">← All funds</button>
      <div class="detail-block" style="--fund-color:${escapeHtml(fund.color)};border-left:5px solid ${escapeHtml(fund.color)}">
        <div class="fund-card-head">
          <h2 class="fund-name" style="margin:0">${escapeHtml(fund.name)}</h2>
          <button type="button" class="btn secondary" id="editFund">Edit</button>
        </div>
        <p class="list-row-sub">${escapeHtml(fund.purpose || '')}</p>
        <p class="fund-net ${moneyClass(pos.net)}" style="margin-top:12px">${formatMoney(pos.net)}</p>
        <p class="strip-hint">Net position</p>
        <div class="fund-metrics" style="margin-top:12px">
          <div>Cash held <strong>${formatMoney(pos.cash)}</strong></div>
          <div>Receivables <strong>${formatMoney(pos.receivables)}</strong></div>
          <div>Payables <strong>${formatMoney(pos.payables)}</strong></div>
          <div>Owed to fund <strong>${formatMoney(pos.interfund.owedToFund)}</strong></div>
          <div>Fund owes <strong>${formatMoney(pos.interfund.fundOwes)}</strong></div>
        </div>
      </div>

      <h3 class="section-title">Cash by account</h3>
      <div class="detail-block">
        ${
            byAccount.length
                ? byAccount
                      .map(
                          (x) =>
                              `<div class="kv"><span>${escapeHtml(x.account.name)}</span><span>${formatMoney(x.amount)}</span></div>`
                      )
                      .join('')
                : '<p class="list-row-sub">None</p>'
        }
      </div>

      ${
          pos.isDeficit || gone.owedBy.length || gone.owes.length
              ? `
      <h3 class="section-title">Where did it go</h3>
      <div class="detail-block">
        <p class="list-row-sub" style="margin-bottom:8px">Open inter-fund positions involving this fund</p>
        ${
            gone.owedBy.length
                ? `<p><strong>Others owe this fund</strong></p>${gone.owedBy
                      .map(
                          (b) =>
                              `<div class="list-row"><div class="list-row-top"><h3 class="list-row-title">${escapeHtml(fundsById[b.debtor_fund]?.name || b.debtor_fund)}</h3><p class="list-row-amt in">${formatMoney(b.amount)}</p></div><div class="note-block">${escapeHtml(b.reason || '')}</div></div>`
                      )
                      .join('')}`
                : ''
        }
        ${
            gone.owes.length
                ? `<p><strong>This fund owes</strong></p>${gone.owes
                      .map(
                          (b) =>
                              `<div class="list-row"><div class="list-row-top"><h3 class="list-row-title">${escapeHtml(fundsById[b.creditor_fund]?.name || b.creditor_fund)}</h3><p class="list-row-amt out">${formatMoney(b.amount)}</p></div><div class="note-block">${escapeHtml(b.reason || '')}</div></div>`
                      )
                      .join('')}`
                : ''
        }
        ${!gone.owedBy.length && !gone.owes.length ? '<p class="list-row-sub">No open inter-fund rows</p>' : ''}
      </div>`
              : ''
      }
    `;

    el.querySelector('#backFunds').addEventListener('click', () => {
        focusFundId = null;
        renderFunds();
    });
    el.querySelector('#editFund').addEventListener('click', () => openFundEditor(fund));
}

function openFundEditor(fund) {
    const isNew = !fund;
    openModal({
        title: isNew ? 'Add fund' : 'Edit fund',
        bodyHtml: `
          <div class="field">
            <label>ID</label>
            <input class="field-input" id="fId" value="${escapeHtml(fund?.id || '')}" ${isNew ? '' : 'readonly'}>
          </div>
          <div class="field">
            <label>Name</label>
            <input class="field-input" id="fName" value="${escapeHtml(fund?.name || '')}">
          </div>
          <div class="field">
            <label>Purpose</label>
            <textarea class="field-textarea" id="fPurpose">${escapeHtml(fund?.purpose || '')}</textarea>
          </div>
          <div class="field">
            <label>Colour</label>
            <input class="field-input" id="fColor" type="color" value="${escapeHtml(fund?.color || '#3F7D58')}">
          </div>
          ${
              !isNew
                  ? `<div class="field"><label><input type="checkbox" id="fArch" ${fund.archived ? 'checked' : ''}> Archive fund</label></div>`
                  : ''
          }
        `,
        actions: [
            { label: 'Cancel', className: 'secondary' },
            {
                label: 'Save',
                close: false,
                onClick: async () => {
                    try {
                        const id = (document.getElementById('fId').value || '').trim() || uid('FUND').toUpperCase();
                        await saveFund({
                            id,
                            name: document.getElementById('fName').value.trim(),
                            purpose: document.getElementById('fPurpose').value.trim(),
                            color: document.getElementById('fColor').value,
                            archived: document.getElementById('fArch')?.checked || false
                        });
                        closeModal();
                        toast('Fund saved');
                        renderFunds();
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });
}
