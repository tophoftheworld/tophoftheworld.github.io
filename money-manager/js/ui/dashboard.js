import { getState } from '../store.js';
import {
    allFundPositions,
    totalKnownCash,
    nextHardDeadline,
    upcomingObligations,
    computeAlerts,
    accountFundSplit
} from '../compute.js';
import {
    formatMoney,
    formatMoneyCompact,
    formatDateShort,
    escapeHtml,
    roleLabel
} from '../format.js';
import { navigate, moneyClass } from './shell.js';
import { bankTheme, bankThemeClass } from '../banks.js';

export function renderDashboard() {
    const el = document.getElementById('view-dashboard');
    const state = getState();

    if (!state.funds.length && !state.accounts.length) {
        el.innerHTML = `
          <div class="empty">
            <h3>No workspace yet</h3>
            <p>Import seed data to hydrate accounts, funds, and the cash matrix.</p>
            <button type="button" class="btn" id="goImport">Import / Export</button>
          </div>`;
        el.querySelector('#goImport')?.addEventListener('click', () => {
            navigate('more');
            document.dispatchEvent(new CustomEvent('mm:open-import'));
        });
        return;
    }

    const positions = allFundPositions(state);
    const total = totalKnownCash(state);
    const deadline = nextHardDeadline(state);
    const worst = positions.slice().sort((a, b) => a.net - b.net)[0];
    const obligations = upcomingObligations(state, 14);
    const alerts = computeAlerts(state);

    const stripNet =
        worst && worst.isDeficit
            ? `<p class="strip-value danger">${formatMoney(worst.net)}</p>
               <p class="strip-hint">${escapeHtml(worst.fund.name)} net</p>`
            : `<p class="strip-value">${formatMoney(worst?.net ?? 0)}</p>
               <p class="strip-hint">${escapeHtml(worst?.fund.name || '—')} net</p>`;

    const deadlineHtml = deadline
        ? `<p class="strip-value ${deadline.days < 0 ? 'danger' : ''}">${deadline.days < 0 ? 'Overdue' : `${deadline.days}d`}</p>
           <p class="strip-hint">${escapeHtml(deadline.label)} · ${formatMoneyCompact(deadline.payable.amount)}</p>`
        : `<p class="strip-value">—</p><p class="strip-hint">No open payables</p>`;

    el.innerHTML = `
      <div class="top-strip">
        <div class="strip-cell accent">
          <p class="strip-label">Total cash</p>
          <p class="strip-value">${formatMoney(total)}</p>
          <p class="strip-hint">${state.accounts.filter((a) => a.balance != null).length} known accounts</p>
        </div>
        <div class="strip-cell">
          <p class="strip-label">Watch position</p>
          ${stripNet}
        </div>
        <div class="strip-cell">
          <p class="strip-label">Next deadline</p>
          ${deadlineHtml}
        </div>
      </div>

      <h2 class="section-title">Funds</h2>
      <div class="fund-grid" id="fundCards"></div>

      <h2 class="section-title">Accounts</h2>
      <div id="accountTiles"></div>

      <h2 class="section-title">Upcoming (14 days)</h2>
      <div id="obligations"></div>

      <h2 class="section-title">Alerts</h2>
      <div id="alerts"></div>
    `;

    const fundCards = el.querySelector('#fundCards');
    fundCards.innerHTML = positions
        .map((p) => {
            const ifLabel =
                p.interfund.net === 0
                    ? 'Even'
                    : p.interfund.net > 0
                      ? `+${formatMoneyCompact(p.interfund.net)} owed to fund`
                      : `${formatMoneyCompact(p.interfund.net)} fund owes`;
            return `
        <article class="fund-card ${p.isDeficit ? 'deficit' : ''}" style="--fund-color:${escapeHtml(p.fund.color)}" data-fund="${escapeHtml(p.fund.id)}">
          <div class="fund-card-head">
            <h3 class="fund-name">${escapeHtml(p.fund.name)}</h3>
            <p class="fund-net ${moneyClass(p.net)}">${formatMoney(p.net)}</p>
          </div>
          <div class="fund-metrics">
            <div>Cash <strong>${formatMoneyCompact(p.cash)}</strong></div>
            <div>Receivables <strong>${formatMoneyCompact(p.receivables)}</strong></div>
            <div>Payables <strong>${formatMoneyCompact(p.payables)}</strong></div>
            <div>Inter-fund <strong>${escapeHtml(ifLabel)}</strong></div>
          </div>
        </article>`;
        })
        .join('');

    fundCards.querySelectorAll('[data-fund]').forEach((card) => {
        card.addEventListener('click', () => {
            navigate('funds');
            document.dispatchEvent(
                new CustomEvent('mm:focus-fund', { detail: card.dataset.fund })
            );
        });
    });

    const tiles = el.querySelector('#accountTiles');
    tiles.innerHTML = state.accounts
        .map((a) => {
            const theme = bankTheme(a.institution);
            const bankClass = bankThemeClass(a.institution);
            const split = accountFundSplit(state, a.id);
            const totalSplit = split.reduce((s, x) => s + x.amount, 0) || 1;
            const bal =
                a.balance == null
                    ? '<p class="account-bal unknown">Unknown</p>'
                    : `<p class="account-bal">${formatMoney(a.balance)}</p>`;
            const bar =
                split.length === 0
                    ? ''
                    : `<div class="fund-bar" title="${split.map((s) => `${s.name}: ${formatMoney(s.amount)}`).join(' · ')}">
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
                          `<span><i class="swatch" style="background:${escapeHtml(s.color)}"></i>${escapeHtml(s.name)} ${formatMoneyCompact(s.amount)}</span>`
                  )
                  .join('')}
            </div>`;
            return `
        <article class="account-tile ${escapeHtml(bankClass)}" data-account="${escapeHtml(a.id)}">
          <div class="account-tile-head">
            <div>
              <span class="account-bank-tag">${escapeHtml(theme.label)}</span>
              <h3 class="account-name">${escapeHtml(a.name)}</h3>
              <p class="account-meta"><span class="role-badge ${escapeHtml(a.role || '')}">${escapeHtml(roleLabel(a.role))}</span></p>
            </div>
            ${bal}
          </div>
          ${bar}
        </article>`;
        })
        .join('');

    tiles.querySelectorAll('[data-account]').forEach((tile) => {
        tile.addEventListener('click', () => {
            navigate('accounts');
            document.dispatchEvent(
                new CustomEvent('mm:focus-account', { detail: tile.dataset.account })
            );
        });
    });

    const obEl = el.querySelector('#obligations');
    if (!obligations.length) {
        obEl.innerHTML = '<p class="empty">No obligations in the next 14 days.</p>';
    } else {
        obEl.innerHTML = obligations
            .map((p) => {
                const fund = state.funds.find((f) => f.id === p.fund_id);
                const src = state.accounts.find((a) => a.id === p.planned_source);
                return `
          <div class="list-row" data-payable="${escapeHtml(p.id)}">
            <div class="list-row-top">
              <h3 class="list-row-title">${escapeHtml(p.payee)}</h3>
              <p class="list-row-amt out">${formatMoney(p.amount)}</p>
            </div>
            <p class="list-row-sub">
              ${formatDateShort(p.due_date)}
              · ${escapeHtml(fund?.name || p.fund_id)}
              · ${escapeHtml(src?.name || p.planned_source || 'no source')}
              · ${escapeHtml(p.rail || '—')}
              · <span class="coverage"><i class="dot ${escapeHtml(p.coverage.level)}"></i>${escapeHtml(p.coverage.label)}</span>
            </p>
            ${p.note ? `<div class="note-block collapsed">${escapeHtml(p.note)}</div>` : ''}
          </div>`;
            })
            .join('');
    }

    const alEl = el.querySelector('#alerts');
    if (!alerts.length) {
        alEl.innerHTML = '<p class="empty">All clear.</p>';
    } else {
        alEl.innerHTML = alerts
            .map(
                (a) => `
          <div class="alert ${escapeHtml(a.severity)}">
            <h4>${escapeHtml(a.title)}</h4>
            <p>${escapeHtml(a.detail || '')}</p>
          </div>`
            )
            .join('');
    }
}
