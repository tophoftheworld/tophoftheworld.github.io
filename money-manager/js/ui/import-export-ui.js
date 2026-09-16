import {
    getState,
    replaceWorkspaceFromSeed,
    exportSeed,
    hasWorkspaceData
} from '../store.js';
import { validateSeed } from '../import-export.js';
import { escapeHtml } from '../format.js';
import { openModal, closeModal, toast } from './shell.js';
import { resolveOpenQuestion } from '../commands.js';

export function openImportExport() {
    const state = getState();
    openModal({
        title: 'Import / Export',
        bodyHtml: `
          <p class="list-row-sub" style="margin-bottom:12px">
            Round-trip uses the seed-data.json shape. Import replaces the whole workspace.
          </p>
          <div class="field">
            <label>Upload JSON</label>
            <input class="field-input" type="file" id="importFile" accept="application/json,.json">
          </div>
          <div class="toolbar">
            <button type="button" class="btn secondary" id="btnLoadSeed">Load bundled seed</button>
            <button type="button" class="btn" id="btnExport">Export JSON</button>
          </div>
          <p class="list-row-sub" id="importStatus">
            ${
                state.meta
                    ? `Current snapshot: ${escapeHtml(state.meta.snapshot_at || state.meta.exported_at || '—')} · ${escapeHtml(state.meta.snapshot_state || '')}`
                    : 'No workspace data yet'
            }
          </p>
          <div id="importWarnings"></div>
        `,
        actions: [{ label: 'Close', className: 'secondary' }]
    });

    document.getElementById('btnExport').addEventListener('click', async () => {
        const seed = await exportSeed();
        const blob = new Blob([JSON.stringify(seed, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `money-manager-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Exported');
    });

    document.getElementById('btnLoadSeed').addEventListener('click', async () => {
        try {
            const res = await fetch('data/seed-data.json');
            const seed = await res.json();
            await confirmAndImport(seed, 'bundled_seed');
        } catch (err) {
            toast(err.message, 'danger');
        }
    });

    document.getElementById('importFile').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const seed = JSON.parse(text);
            await confirmAndImport(seed, 'file_upload');
        } catch (err) {
            toast(err.message || 'Invalid JSON', 'danger');
        }
    });
}

async function confirmAndImport(seed, provenance) {
    const validation = validateSeed(seed);
    const warnEl = document.getElementById('importWarnings');
    if (warnEl) {
        warnEl.innerHTML = [
            ...validation.errors.map((e) => `<div class="alert danger"><h4>Error</h4><p>${escapeHtml(e)}</p></div>`),
            ...validation.warnings.map((w) => `<div class="alert warn"><h4>Variance</h4><p>${escapeHtml(w)}</p></div>`)
        ].join('');
    }
    if (!validation.ok) {
        toast('Import blocked — fix errors', 'danger');
        return;
    }
    const msg = hasWorkspaceData()
        ? 'Replace the entire live workspace with this snapshot? This cannot be undone.'
        : 'Load this snapshot into the workspace?';
    if (!confirm(msg)) return;
    try {
        toast('Importing…');
        await replaceWorkspaceFromSeed(seed, { provenance });
        closeModal();
        toast('Import complete');
        if (validation.warnings.length) {
            toast(`${validation.warnings.length} allocation warning(s)`, 'warn');
        }
    } catch (err) {
        toast(err.message, 'danger');
    }
}

export function openQuestions() {
    const state = getState();
    const items = [...state.open_questions];

    openModal({
        title: 'Open questions',
        bodyHtml: `
          <p class="list-row-sub" style="margin-bottom:10px">Data gaps — tick when answered so they stop haunting the dashboard.</p>
          <div id="qList"></div>
        `,
        actions: [{ label: 'Close', className: 'secondary' }]
    });

    const list = document.getElementById('qList');
    if (!items.length) {
        list.innerHTML = '<p class="empty">No open questions.</p>';
        return;
    }

    list.innerHTML = items
        .map(
            (q) => `
      <div class="checklist-item ${q.resolved ? 'resolved' : ''}" data-id="${escapeHtml(q.id)}">
        <input type="checkbox" ${q.resolved ? 'checked' : ''}>
        <div>
          <div class="q-text"><strong>${escapeHtml(q.id)}</strong> — ${escapeHtml(q.question)}</div>
          <p class="list-row-sub">${escapeHtml(q.impact || '')}</p>
          ${q.answer ? `<div class="note-block">${escapeHtml(q.answer)}</div>` : ''}
        </div>
      </div>`
        )
        .join('');

    list.querySelectorAll('.checklist-item').forEach((row) => {
        const cb = row.querySelector('input');
        cb.addEventListener('change', async () => {
            try {
                let answer = '';
                if (cb.checked) {
                    answer = prompt('Optional answer / note:') || '';
                }
                await resolveOpenQuestion({
                    id: row.dataset.id,
                    resolved: cb.checked,
                    answer
                });
                toast(cb.checked ? 'Marked resolved' : 'Reopened');
            } catch (err) {
                toast(err.message, 'danger');
                cb.checked = !cb.checked;
            }
        });
    });
}

export function renderMore() {
    const el = document.getElementById('view-more');
    const state = getState();
    const openQ = state.open_questions.filter((q) => !q.resolved).length;

    el.innerHTML = `
      <h2 class="section-title">More</h2>
      <div class="more-menu">
        <button type="button" class="more-link" data-action="transfers">
          Transfers
          <span>Move cash · Reassign fund</span>
        </button>
        <button type="button" class="more-link" data-action="receivables">
          Receivables
          <span>${state.receivables.filter((r) => r.status !== 'PAID').length} open</span>
        </button>
        <button type="button" class="more-link" data-action="payables">
          Payables
          <span>${state.payables.filter((p) => p.status !== 'PAID').length} open</span>
        </button>
        <button type="button" class="more-link" data-action="questions">
          Open questions
          <span>${openQ} unresolved</span>
        </button>
        <button type="button" class="more-link" data-action="import">
          Import / Export
          <span>JSON seed round-trip</span>
        </button>
        <button type="button" class="more-link" data-action="interfund">
          Inter-fund balances
          <span>${state.interfund_balances.filter((b) => (b.status || 'OPEN') === 'OPEN').length} open</span>
        </button>
        <button type="button" class="more-link" data-action="credit">
          Credit lines
          <span>${state.credit_lines.length}</span>
        </button>
        <button type="button" class="more-link" data-action="inflows">
          Expected inflows
          <span>${state.expected_inflows.length} estimates</span>
        </button>
      </div>
    `;

    el.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const a = btn.dataset.action;
            if (a === 'transfers') document.dispatchEvent(new CustomEvent('mm:transfers'));
            if (a === 'receivables') document.dispatchEvent(new CustomEvent('mm:receivables'));
            if (a === 'payables') document.dispatchEvent(new CustomEvent('mm:payables'));
            if (a === 'questions') openQuestions();
            if (a === 'import') openImportExport();
            if (a === 'interfund') openInterfundList();
            if (a === 'credit') openCreditLines();
            if (a === 'inflows') openInflows();
        });
    });
}

function openInterfundList() {
    const state = getState();
    const fundsById = Object.fromEntries(state.funds.map((f) => [f.id, f]));
    openModal({
        title: 'Inter-fund balances',
        bodyHtml: state.interfund_balances
            .map(
                (b) => `
        <div class="list-row">
          <div class="list-row-top">
            <h3 class="list-row-title">${escapeHtml(fundsById[b.debtor_fund]?.name || b.debtor_fund)} → ${escapeHtml(fundsById[b.creditor_fund]?.name || b.creditor_fund)}</h3>
            <p class="list-row-amt">${formatMoneySafe(b.amount)}</p>
          </div>
          <p class="list-row-sub">${escapeHtml(b.status || 'OPEN')}</p>
          <div class="note-block">${escapeHtml(b.reason || '')}${b.note ? `\n${escapeHtml(b.note)}` : ''}</div>
        </div>`
            )
            .join('') || '<p class="empty">None</p>',
        actions: [{ label: 'Close', className: 'secondary' }]
    });
}

function formatMoneySafe(n) {
    try {
        return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);
    } catch {
        return String(n);
    }
}

function openCreditLines() {
    const state = getState();
    openModal({
        title: 'Credit lines',
        bodyHtml: state.credit_lines
            .map(
                (c) => `
        <div class="list-row">
          <div class="list-row-top">
            <h3 class="list-row-title">${escapeHtml(c.name)}</h3>
            <p class="list-row-amt">${c.known_available != null ? formatMoneySafe(c.known_available) : '—'}</p>
          </div>
          <p class="list-row-sub">Limit: ${c.limit == null ? 'unknown' : formatMoneySafe(c.limit)}</p>
          ${c.note ? `<div class="note-block">${escapeHtml(c.note)}</div>` : ''}
        </div>`
            )
            .join('') || '<p class="empty">None</p>',
        actions: [{ label: 'Close', className: 'secondary' }]
    });
}

function openInflows() {
    const state = getState();
    openModal({
        title: 'Expected inflows',
        bodyHtml: `
          <p class="list-row-sub" style="margin-bottom:8px">Estimates — not committed cash.</p>
          ${
              state.expected_inflows
                  .map(
                      (i) => `
            <div class="list-row">
              <div class="list-row-top">
                <h3 class="list-row-title">${escapeHtml(i.description)}</h3>
                <p class="list-row-amt in">${formatMoneySafe(i.amount)}</p>
              </div>
              <p class="list-row-sub">${escapeHtml(i.fund_id)} · by ${escapeHtml(i.expected_by || '—')} · ${escapeHtml(i.confidence || '')}</p>
              ${i.note ? `<div class="note-block">${escapeHtml(i.note)}</div>` : ''}
            </div>`
                  )
                  .join('') || '<p class="empty">None</p>'
          }
        `,
        actions: [{ label: 'Close', className: 'secondary' }]
    });
}
