import { initStore, subscribe, getState, hasWorkspaceData } from './store.js';
import { formatDate } from './format.js';
import { bindNav, registerView, navigate, rerender, toast } from './ui/shell.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderAccounts } from './ui/accounts.js';
import { renderFunds } from './ui/funds.js';
import { renderLedger, openQuickEntry } from './ui/transactions.js';
import { renderMore, openImportExport } from './ui/import-export-ui.js';
import { openTransfersHub } from './ui/transfers.js';
import { openReceivables } from './ui/receivables.js';
import { openPayables } from './ui/payables.js';

registerView('dashboard', renderDashboard);
registerView('accounts', renderAccounts);
registerView('funds', renderFunds);
registerView('ledger', renderLedger);
registerView('more', renderMore);

function updateHeader(state) {
    const meta = document.getElementById('headerMeta');
    if (!state.loaded) {
        meta.textContent = 'Connecting…';
        return;
    }
    if (!state.meta && !hasWorkspaceData()) {
        meta.textContent = 'Empty workspace — import seed';
        return;
    }
    const stamp = state.meta?.snapshot_at || state.meta?.exported_at;
    meta.textContent = stamp
        ? `${state.meta?.snapshot_state || 'LIVE'} · ${formatDate(stamp)}`
        : `${state.funds.length} funds · ${state.accounts.length} accounts`;
}

async function boot() {
    bindNav();

    document.getElementById('fabAdd').addEventListener('click', openQuickEntry);
    document.getElementById('btnRefresh').addEventListener('click', () => {
        rerender();
        toast('Refreshed');
    });

    document.addEventListener('mm:open-import', openImportExport);
    document.addEventListener('mm:transfers', openTransfersHub);
    document.addEventListener('mm:receivables', openReceivables);
    document.addEventListener('mm:payables', openPayables);

    document.getElementById('view-dashboard').innerHTML = `
      <div class="loading-screen">
        <div class="brand-mark">MM</div>
        <p>Loading money manager…</p>
      </div>`;

    try {
        await initStore();
    } catch (err) {
        console.error(err);
        document.getElementById('view-dashboard').innerHTML = `
          <div class="empty">
            <h3>Could not connect</h3>
            <p>${err.message}</p>
          </div>`;
        return;
    }

    let first = true;
    subscribe((state) => {
        updateHeader(state);
        if (first) {
            first = false;
            navigate('dashboard');
            if (!hasWorkspaceData()) {
                // Prompt first-time import gently
                setTimeout(() => {
                    if (!hasWorkspaceData()) openImportExport();
                }, 400);
            }
            return;
        }
        rerender();
    });
}

boot();
