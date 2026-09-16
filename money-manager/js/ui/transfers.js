import { getState } from '../store.js';
import { checkTransferLimits, allocationForAccountFund } from '../compute.js';
import { formatMoney, escapeHtml, todayISO } from '../format.js';
import {
    openModal,
    closeModal,
    toast,
    showWarnings,
    fundSelectOptions,
    accountSelectOptions
} from './shell.js';
import { moveCash, reassignFund } from '../commands.js';

export function openTransfersHub() {
    const state = getState();
    openModal({
        title: 'Transfers',
        bodyHtml: `
          <p class="list-row-sub" style="margin-bottom:12px">
            Two different actions — do not conflate them.
          </p>
          <button type="button" class="more-link" id="btnMove">
            Move cash
            <span>Account A → B, same fund</span>
          </button>
          <button type="button" class="more-link" id="btnReassign" style="margin-top:8px">
            Reassign fund
            <span>Ownership changes; cash stays put</span>
          </button>
        `,
        actions: [{ label: 'Close', className: 'secondary' }]
    });
    document.getElementById('btnMove').addEventListener('click', () => {
        closeModal();
        openMoveCash(state);
    });
    document.getElementById('btnReassign').addEventListener('click', () => {
        closeModal();
        openReassign(state);
    });
}

function openMoveCash(state) {
    openModal({
        title: 'Move cash',
        bodyHtml: `
          <div class="field">
            <label>Amount</label>
            <input class="field-input" id="mvAmt" type="number" step="0.01">
          </div>
          <div class="field">
            <label>From account</label>
            <select class="field-select" id="mvFrom">${accountSelectOptions(state.accounts)}</select>
          </div>
          <div class="field">
            <label>To account</label>
            <select class="field-select" id="mvTo">${accountSelectOptions(state.accounts)}</select>
          </div>
          <div class="field">
            <label>Fund</label>
            <select class="field-select" id="mvFund">${fundSelectOptions(state.funds)}</select>
          </div>
          <div class="field">
            <label>Rail / note</label>
            <input class="field-input" id="mvRail" placeholder="e.g. BDO internal, PESONet">
          </div>
          <div class="field">
            <label>Note</label>
            <textarea class="field-textarea" id="mvNote"></textarea>
          </div>
          <div class="field">
            <label>Date</label>
            <input class="field-input" id="mvDate" type="date" value="${todayISO()}">
          </div>
          <p class="list-row-sub" id="mvWarn"></p>
        `,
        actions: [
            { label: 'Cancel', className: 'secondary' },
            {
                label: 'Move',
                close: false,
                onClick: async () => {
                    const payload = {
                        amount: Number(document.getElementById('mvAmt').value),
                        from_account_id: document.getElementById('mvFrom').value,
                        to_account_id: document.getElementById('mvTo').value,
                        fund_id: document.getElementById('mvFund').value,
                        rail: document.getElementById('mvRail').value,
                        note: document.getElementById('mvNote').value,
                        date: document.getElementById('mvDate').value
                    };
                    const from = state.accounts.find((a) => a.id === payload.from_account_id);
                    const pre = checkTransferLimits(from, payload.amount, payload.rail).map(
                        (w) => w.message
                    );
                    const avail = allocationForAccountFund(
                        state,
                        payload.from_account_id,
                        payload.fund_id
                    );
                    if (avail < payload.amount) {
                        pre.push(`Fund allocation only ${formatMoney(avail)} — proceeding anyway`);
                    }
                    if (pre.length && !confirm(`Warnings:\n\n${pre.join('\n')}\n\nContinue?`)) {
                        return;
                    }
                    try {
                        const r = await moveCash(payload);
                        showWarnings(r.warnings);
                        closeModal();
                        toast('Cash moved');
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });
}

function openReassign(state) {
    openModal({
        title: 'Reassign fund',
        bodyHtml: `
          <p class="list-row-sub" style="margin-bottom:10px">
            Money stays in the account. Ownership changes and an inter-fund debt is created or settled. A reason note is required.
          </p>
          <div class="field">
            <label>Amount</label>
            <input class="field-input" id="rsAmt" type="number" step="0.01">
          </div>
          <div class="field">
            <label>Account</label>
            <select class="field-select" id="rsAcct">${accountSelectOptions(state.accounts)}</select>
          </div>
          <div class="field">
            <label>From fund</label>
            <select class="field-select" id="rsFrom">${fundSelectOptions(state.funds)}</select>
          </div>
          <div class="field">
            <label>To fund</label>
            <select class="field-select" id="rsTo">${fundSelectOptions(state.funds)}</select>
          </div>
          <div class="field">
            <label>Reason note (required)</label>
            <textarea class="field-textarea" id="rsNote" placeholder="Why is ownership changing?"></textarea>
          </div>
          <div class="field">
            <label>Date</label>
            <input class="field-input" id="rsDate" type="date" value="${todayISO()}">
          </div>
        `,
        actions: [
            { label: 'Cancel', className: 'secondary' },
            {
                label: 'Reassign',
                close: false,
                onClick: async () => {
                    try {
                        const r = await reassignFund({
                            amount: Number(document.getElementById('rsAmt').value),
                            account_id: document.getElementById('rsAcct').value,
                            from_fund_id: document.getElementById('rsFrom').value,
                            to_fund_id: document.getElementById('rsTo').value,
                            note: document.getElementById('rsNote').value,
                            date: document.getElementById('rsDate').value
                        });
                        showWarnings(r.warnings);
                        closeModal();
                        toast('Fund reassigned');
                    } catch (err) {
                        toast(err.message, 'danger');
                    }
                }
            }
        ]
    });
}
