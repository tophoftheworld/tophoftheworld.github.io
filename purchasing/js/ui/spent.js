import {
  getWeek,
  settleWeek,
  canActOnWeek,
  linkLineToExpense,
  unlinkLineExpense,
  addOffPlanExpense,
  ensureLinkedExpenseLinks,
  hydrateWeekExpenseLinks,
} from '../store.js?v=96';
import { itemDisplayName, locationLabel } from '../data/catalog.js?v=96';
import {
  plannedLines,
  settlementSummary,
  lineAmount,
  lineUnitRate,
  isFee,
  orderedVsSuggestedSummary,
} from '../compute.js?v=96';
import { formatPeso, formatQty, formatDateMedium, escapeHtml } from '../format.js?v=96';
import { toast, confirmDialog } from './shell.js?v=96';
import { renderWeekChrome, bindWeekChrome } from './week-chrome.js?v=96';
import {
  loadRecentExpenses,
  searchExpenses,
  filterExpensesForWeek,
  locationToExpenseFields,
  createExpenseFromLines,
  getExpenseById,
  patchExpenseReceipt,
} from '../data/expense-link.js?v=96';
import { uploadExpenseReceipt, fetchExpenseReceiptUrl } from '../firebase.js?v=96';

const RECEIPT_MARK = `<span class="recon-receipt-mark" title="Has receipt" aria-label="Has receipt"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2 3-2 3 2V8z"/><path d="M14 2v6h6"/></svg></span>`;

export function renderSpent(root, weekId) {
  const week = getWeek(weekId);
  if (!week) {
    root.innerHTML = '<p class="app-loading-inline">Loading week\u2026</p>';
    return;
  }

  const lines = plannedLines(week);
  for (const line of lines) ensureLinkedExpenseLinks(line);

  const linked = lines.filter((l) => (l.linkedExpenseIds || []).length > 0);
  const open = lines.filter((l) => !(l.linkedExpenseIds || []).length);
  const offPlan = week.offPlanExpenses || [];

  const matchedSpend = linked.reduce(
    (s, l) => s + (l.actualCost ?? lineAmount(l)),
    0
  );
  const offPlanSpend = offPlan.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const unmatchedPlanned = open.reduce((s, l) => s + lineAmount(l), 0);
  const spentTotal = matchedSpend + offPlanSpend;

  const settlement = settlementSummary({
    ...week,
    spent: week.spent || spentTotal,
  });
  const left = settlement.released - spentTotal - (settlement.returned || 0);
  const canSettle = canActOnWeek(week) && week.status === 'ordered';
  const canEdit = canActOnWeek(week);
  const vsSuggested = orderedVsSuggestedSummary(week);
  const vsLabel =
    vsSuggested.compared === 0
      ? '\u2014'
      : vsSuggested.overLines === 0 && vsSuggested.underLines === 0
        ? `Match (${vsSuggested.compared})`
        : [
            vsSuggested.overLines ? `${vsSuggested.overLines} over` : null,
            vsSuggested.underLines ? `${vsSuggested.underLines} under` : null,
            vsSuggested.onPlanLines ? `${vsSuggested.onPlanLines} ok` : null,
          ]
            .filter(Boolean)
            .join(' \u00B7 ');

  const rows = [
    ...lines.map((line) => ({
      kind: (line.linkedExpenseIds || []).length ? 'linked' : 'open',
      line,
    })),
    ...offPlan.map((entry) => ({ kind: 'offplan', entry })),
  ];

  root.innerHTML = `
    ${renderWeekChrome(week, { tab: 'spent' })}

    <div class="settle-strip settle-strip--recon">
      <div class="settle-metrics">
        ${settleMetric('Floated', formatPeso(settlement.released))}
        ${settleMetric('Logged', formatPeso(matchedSpend))}
        ${offPlanSpend > 0 ? settleMetric('Extra', formatPeso(offPlanSpend)) : ''}
        ${settleMetric('Not logged', formatPeso(unmatchedPlanned))}
        ${settleMetric('Ordered vs suggested', vsLabel)}
        ${settleMetric('Left', formatPeso(left), true)}
      </div>
      ${
        canSettle
          ? '<button type="button" class="btn primary" id="btnSettle">Close week</button>'
          : ''
      }
    </div>

    <div class="recon-toolbar no-print">
      ${
        canEdit
          ? `<button type="button" class="btn secondary btn-sm" data-add-offplan>Add extra expense</button>`
          : ''
      }
    </div>

    ${
      rows.length
        ? `<div class="table-wrap">
      <table class="plan-table compact recon-table">
        <colgroup>
          <col class="rt-item" />
          <col class="rt-planned" />
          <col class="rt-actual" />
          <col class="rt-diff" />
          <col class="rt-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Budget</th>
            <th class="num">Actual</th>
            <th class="num">Diff</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => renderReconRow(row, canEdit)).join('')}
        </tbody>
      </table>
    </div>`
        : '<p class="empty">Nothing on the budget yet.</p>'
    }
  `;

  bindWeekChrome(root, week, { tab: 'spent' });
  if (!week.__reconLinksHydrated) {
    hydrateExpenseLinkRows(root, week, weekId);
  }

  root.querySelector('#btnSettle')?.addEventListener('click', () => {
    const unmatched = open.length;
    const confirmMsg = unmatched
      ? `${unmatched} line(s) still have no expense. Close anyway? ${formatPeso(left)} left will be recorded as cash returned.`
      : `Close this week? ${formatPeso(left)} left will be recorded as cash returned.`;
    confirmDialog(confirmMsg, () => {
      week.spent = spentTotal;
      settleWeek(week.id);
      toast('Week closed');
      renderSpent(root, weekId);
    });
  });

  root.querySelectorAll('[data-link-expense]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const line = week.lines.find((l) => l.id === btn.dataset.linkExpense);
      if (line) openLinkExpenseModal(week, line, () => renderSpent(root, weekId));
    });
  });

  root.querySelectorAll('[data-add-expense]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const line = week.lines.find((l) => l.id === btn.dataset.addExpense);
      if (line) openAddExpenseModal(week, line, () => renderSpent(root, weekId));
    });
  });

  root.querySelectorAll('[data-unlink-line]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      unlinkLineExpense(week.id, btn.dataset.unlinkLine, btn.dataset.unlinkExpenseId || null);
      toast('Unlinked');
      renderSpent(root, weekId);
    });
  });

  root.querySelectorAll('[data-open-expense]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-unlink-line]')) return;
      openExpenseDetailModal(el.dataset.openExpense);
    });
  });

  root.querySelector('[data-add-offplan]')?.addEventListener('click', () => {
    openOffPlanLinkModal(week, () => renderSpent(root, weekId));
  });
}

function settleMetric(label, value, emphasize = false) {
  return `<div class="settle-metric${emphasize ? ' settle-metric--left' : ''}">
    <span class="settle-metric-label">${escapeHtml(label)}</span>
    <span class="settle-metric-value">${value}</span>
  </div>`;
}

async function hydrateExpenseLinkRows(root, week, weekId) {
  try {
    const expenses = await loadRecentExpenses();
    hydrateWeekExpenseLinks(weekId, expenses);
  } catch (_) {
    /* ignore \u2014 show whatever snapshots we have */
  }
  week.__reconLinksHydrated = true;
  renderSpent(root, weekId);
}

/** Branch + paidBy only \u2014 omit empty parts; empty string if neither. */
function wherePaidLine(source) {
  const branch = String(source?.branch || '').trim();
  const paidBy = String(source?.paidBy || '').trim();
  return [branch, paidBy].filter(Boolean).join(' \u00B7 ');
}

function renderReconRow(row, canEdit) {
  if (row.kind === 'offplan') {
    const e = row.entry;
    const amount = Number(e.amount) || 0;
    const dateLabel = formatDateMedium(e.date) || e.date || '';
    const place = e.location ? locationLabel(e.location) || e.location : '';
    return `<tr class="recon-row is-offplan">
      <td>
        <div class="recon-offplan-title">
          <strong>${escapeHtml(e.supplierName || 'Extra')}</strong>
          <span class="recon-extra-tag">Extra</span>
        </div>
        ${dateLabel ? `<div class="recon-expense-link-date muted">${escapeHtml(dateLabel)}</div>` : ''}
        ${place ? `<div class="recon-expense-link-where muted">${escapeHtml(place)}</div>` : ''}
        ${e.reason ? `<div class="recon-expense-link-date muted">${escapeHtml(e.reason)}</div>` : ''}
      </td>
      <td class="num">\u2014</td>
      <td class="num">${formatPeso(amount)}</td>
      <td class="num delta-up">+${formatPeso(amount)}</td>
      <td><div class="recon-actions"></div></td>
    </tr>`;
  }

  const line = row.line;
  const budget = lineAmount(line);
  const isLinked = row.kind === 'linked';
  const links = isLinked ? ensureLinkedExpenseLinks(line) : [];
  const actual = isLinked ? line.actualCost ?? budget : null;
  const diff = isLinked ? actual - budget : null;
  const meta = [
    locationLabel(line.location),
    line.supplierName && line.supplierName !== 'Unassigned' ? line.supplierName : null,
    isFee(line) ? null : formatQty(line.qty, line.unit),
    !isFee(line) && line.suggestedQty != null
      ? `sug ${formatQty(line.suggestedQty, line.unit)}`
      : null,
  ]
    .filter(Boolean)
    .join(' \u00B7 ');

  const actions = !canEdit
    ? ''
    : `<button type="button" class="btn secondary btn-sm" data-link-expense="${escapeHtml(line.id)}">Link</button>
       <button type="button" class="btn primary btn-sm" data-add-expense="${escapeHtml(line.id)}">Add expense</button>`;

  const parent = `<tr class="recon-row recon-budget-row ${isLinked ? 'is-linked' : 'is-open'}${
    links.length ? ' has-expense-links' : ''
  }">
    <td>
      <strong>${escapeHtml(itemDisplayName(line))}</strong>
      <div class="split muted">${escapeHtml(meta)}</div>
    </td>
    <td class="num">${formatPeso(budget)}</td>
    <td class="num">${isLinked ? formatPeso(actual) : '\u2014'}</td>
    <td class="num ${
      diff == null ? '' : diff > 0 ? 'delta-up' : diff < 0 ? 'delta-down' : ''
    }">${
      diff == null ? '\u2014' : `${diff > 0 ? '+' : ''}${formatPeso(diff)}`
    }</td>
    <td><div class="recon-actions">${actions}</div></td>
  </tr>`;

  if (!links.length) return parent;

  const children = links
    .map((link, i) => {
      const supplier = link.supplierName || 'Expense';
      const where = wherePaidLine(link);
      const dateLabel = formatDateMedium(link.date) || link.date || '';
      const isLast = i === links.length - 1;
      const unlinkBtn = canEdit
        ? `<button type="button" class="btn secondary btn-sm" data-unlink-line="${escapeHtml(
            line.id
          )}" data-unlink-expense-id="${escapeHtml(link.id)}">Unlink</button>`
        : '';
      return `<tr class="recon-row recon-expense-link${isLast ? ' is-last-link' : ''}" data-open-expense="${escapeHtml(
        link.id
      )}" tabindex="0" role="button" title="View expense">
        <td colspan="5" class="recon-expense-link-td">
          <div class="recon-expense-link-row">
            <div class="recon-expense-link-main">
              <div class="recon-expense-link-label">${escapeHtml(supplier)}</div>
              ${where ? `<div class="recon-expense-link-where muted">${escapeHtml(where)}</div>` : ''}
              <div class="recon-expense-link-meta">
                ${dateLabel ? `<span class="recon-expense-link-date muted">${escapeHtml(dateLabel)}</span>` : ''}
                ${link.hasReceiptImage ? RECEIPT_MARK : ''}
              </div>
            </div>
            <div class="num muted">\u2014</div>
            <div class="num">${formatPeso(Number(link.amount) || 0)}</div>
            <div class="num muted">\u2014</div>
            <div class="recon-actions">${unlinkBtn}</div>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  return parent + children;
}

function openModalShell(title, bodyHtml, { wide = false } = {}) {
  const root = document.getElementById('modalRoot');
  if (!root) return null;
  root.hidden = false;
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal line-modal recon-modal${wide ? ' recon-modal--wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-header line-modal-header">
        <div class="line-modal-title-block">
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body" data-recon-body>${bodyHtml}</div>
      <div class="modal-footer" data-recon-footer></div>
    </div>`;
  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
  };
  root.querySelector('[data-close]')?.addEventListener('click', close);
  root.querySelector('.modal-close')?.addEventListener('click', close);
  return {
    root,
    close,
    body: root.querySelector('[data-recon-body]'),
    footer: root.querySelector('[data-recon-footer]'),
  };
}

function detailField(label, value) {
  if (value == null || value === '') return '';
  return `<div>
    <div class="recon-detail-label">${escapeHtml(label)}</div>
    <div class="recon-detail-value">${escapeHtml(String(value))}</div>
  </div>`;
}

async function openExpenseDetailModal(expenseId) {
  const shell = openModalShell('Expense details', `<p class="empty">Loading\u2026</p>`, { wide: true });
  if (!shell) return;
  shell.footer.innerHTML = `<button type="button" class="btn secondary" data-cancel>Close</button>`;
  shell.footer.querySelector('[data-cancel]')?.addEventListener('click', shell.close);

  const exp = await getExpenseById(expenseId);
  if (!exp) {
    shell.body.innerHTML = '<p class="empty">Expense not found</p>';
    return;
  }

  let receiptUrl = exp.receiptImage || null;
  if (!receiptUrl && exp.hasReceiptImage) {
    receiptUrl = await fetchExpenseReceiptUrl(expenseId);
  }

  const items = (exp.items || [])
    .map(
      (i) => `<tr>
        <td>${escapeHtml(i.name || 'Item')}</td>
        <td class="num">${escapeHtml(String(i.quantity ?? ''))}</td>
        <td class="num">${formatPeso(Number(i.total) || 0)}</td>
      </tr>`
    )
    .join('');

  const branch =
    String(exp.branch || '').trim() ||
    (exp.allocation && exp.allocation !== 'Store' ? String(exp.eventName || exp.allocation).trim() : '');

  shell.body.classList.add('recon-detail-body');
  shell.body.innerHTML = `
    <div class="recon-detail-panes">
      <div class="recon-detail-pane recon-detail-pane--main">
        <div class="recon-detail-grid">
          ${detailField('Supplier', exp.supplierName || '\u2014')}
          ${detailField('Date', formatDateMedium(exp.date) || exp.date || '\u2014')}
          ${detailField('Branch', branch)}
          ${detailField('Paid by', exp.paidBy)}
          <div>
            <div class="recon-detail-label">Total</div>
            <div class="recon-detail-value">${formatPeso(exp.totalAmount || 0)}</div>
          </div>
          ${
            exp.notes
              ? `<div class="full">
            <div class="recon-detail-label">Notes</div>
            <div class="recon-detail-value muted">${escapeHtml(exp.notes)}</div>
          </div>`
              : ''
          }
        </div>
        ${
          items
            ? `<table class="plan-table compact recon-detail-items">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
          <tbody>${items}</tbody>
        </table>`
            : ''
        }
      </div>
      <div class="recon-detail-pane recon-detail-pane--receipt">
        ${
          receiptUrl
            ? `<img src="${escapeHtml(receiptUrl)}" alt="Receipt" class="recon-detail-receipt-img" />`
            : '<p class="muted recon-detail-receipt-empty">No receipt attached</p>'
        }
      </div>
    </div>
  `;
}

async function openLinkExpenseModal(week, line, onDone) {
  const budget = lineAmount(line);
  const supplier =
    line.supplierName && line.supplierName !== 'Unassigned' ? line.supplierName : '';
  const linkedIds = new Set(ensureLinkedExpenseLinks(line).map((l) => l.id));
  const shell = openModalShell(`Link expense \u00B7 ${itemDisplayName(line)}`, `
    <div class="recon-link-target">
      <span class="recon-link-target-name">${escapeHtml(itemDisplayName(line))}</span>
      <span class="recon-link-target-meta">${escapeHtml(supplier || 'No supplier')}${
        linkedIds.size ? ` \u00B7 ${linkedIds.size} linked` : ''
      }</span>
      <span class="recon-link-target-amount"><span class="recon-link-budget-label">Budget</span> ${formatPeso(budget)}</span>
    </div>
    <div class="line-modal-field full">
      <label>Search expenses</label>
      <input type="search" data-expense-search autocomplete="off" placeholder="Supplier, item, amount\u2026" />
    </div>
    <div class="recon-expense-list" data-expense-list role="listbox">
      <p class="empty">Loading\u2026</p>
    </div>
  `);
  if (!shell) return;

  shell.footer.innerHTML = `<button type="button" class="btn secondary" data-cancel>Cancel</button>`;
  shell.footer.querySelector('[data-cancel]')?.addEventListener('click', shell.close);

  let expenses = [];
  try {
    const all = await loadRecentExpenses();
    expenses = filterExpensesForWeek(all, week);
  } catch (err) {
    console.warn(err);
    shell.body.querySelector('[data-expense-list]').innerHTML =
      '<p class="empty">Could not load expenses</p>';
    return;
  }

  const listEl = shell.body.querySelector('[data-expense-list]');
  const searchEl = shell.body.querySelector('[data-expense-search]');

  const paint = () => {
    const hits = searchExpenses(expenses, searchEl.value, { line }).filter(
      (h) => !linkedIds.has(h.exp.id)
    );
    listEl.innerHTML = renderExpenseHitList(hits);
    bindExpensePick(listEl, expenses, (exp) => {
      linkLineToExpense(week.id, line.id, exp);
      toast('Linked');
      shell.close();
      onDone?.();
    });
  };

  searchEl.addEventListener('input', paint);
  paint();
  searchEl.focus();
}

function renderExpenseCard(hit) {
  const exp = hit.exp;
  const where = wherePaidLine({
    branch: exp.branch || exp.eventName || '',
    paidBy: exp.paidBy || '',
  });
  const dateLabel = formatDateMedium(exp.date) || exp.date || '';
  // Items only when branch/paidBy can't disambiguate \u2014 quiet single truncated line
  const showItems = !where;
  const items = showItems
    ? (exp.items || [])
        .slice(0, 2)
        .map((i) => i.name)
        .filter(Boolean)
        .join(', ')
    : '';

  return `<button type="button" class="recon-expense-card" data-pick-expense="${escapeHtml(exp.id)}" role="option">
    <div class="recon-expense-card-top">
      <span class="recon-expense-supplier">${escapeHtml(exp.supplierName || 'Expense')}</span>
      <span class="recon-expense-amount">${formatPeso(exp.totalAmount || 0)}</span>
    </div>
    ${where ? `<div class="recon-expense-where muted">${escapeHtml(where)}</div>` : ''}
    ${dateLabel ? `<div class="recon-expense-date muted">${escapeHtml(dateLabel)}</div>` : ''}
    ${items ? `<div class="recon-expense-items">${escapeHtml(items)}</div>` : ''}
  </button>`;
}

function renderExpenseHitList(hits) {
  if (!hits.length) return '<p class="empty">No matching expenses this week</p>';
  return hits.map(renderExpenseCard).join('');
}

function bindExpensePick(listEl, expenses, onPick) {
  listEl.querySelectorAll('[data-pick-expense]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exp = expenses.find((e) => e.id === btn.dataset.pickExpense);
      if (exp) onPick(exp);
    });
  });
}

function purchasingBranchLabel(locationKey) {
  const map = {
    'sm-north': 'SM North',
    podium: 'Podium',
    moa: 'Mall of Asia',
  };
  return map[locationKey] || locationLabel(locationKey);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function openAddExpenseModal(week, line, onDone) {
  const locFields = locationToExpenseFields(line.location);
  const budget = lineAmount(line);
  const qty = isFee(line) ? 1 : Number(line.qty) || 1;
  const rate = lineUnitRate(line);
  const unitPrice = rate > 0 ? rate : qty > 0 ? budget / qty : budget;
  const supplierDefault =
    line.supplierName && line.supplierName !== 'Unassigned' ? line.supplierName : '';
  const branchDefault =
    locFields.allocation === 'Store' ? purchasingBranchLabel(line.location) : '';

  const shell = openModalShell(`Add expense \u00B7 ${itemDisplayName(line)}`, `
    <div class="recon-add-grid">
      <div class="line-modal-field">
        <label>Date</label>
        <input type="date" data-field="date" value="${escapeHtml(new Date().toISOString().slice(0, 10))}" />
      </div>
      <div class="line-modal-field">
        <label>Supplier</label>
        <input type="text" data-field="supplier" value="${escapeHtml(supplierDefault)}" autocomplete="off" />
      </div>
      <div class="line-modal-field full">
        <label>Item</label>
        <input type="text" data-field="item" value="${escapeHtml(itemDisplayName(line))}" />
      </div>
      <div class="line-modal-field">
        <label>Qty</label>
        <input type="number" data-field="qty" min="0" step="any" value="${qty}" ${isFee(line) ? 'readonly' : ''} />
      </div>
      <div class="line-modal-field">
        <label>Unit price</label>
        <input type="number" data-field="price" min="0" step="any" value="${Number(unitPrice.toFixed(4))}" />
      </div>
      <div class="line-modal-field">
        <label>Total</label>
        <input type="number" data-field="total" min="0" step="any" value="${Math.round(budget)}" />
      </div>
      <div class="line-modal-field">
        <label>Branch</label>
        <input type="text" data-field="branch" value="${escapeHtml(branchDefault)}" />
      </div>
      <div class="line-modal-field full">
        <label>Notes</label>
        <input type="text" data-field="notes" value="${escapeHtml(
          `From Purchasing \u00B7 week ${week.weekStart || ''}`.trim()
        )}" />
      </div>
      <div class="line-modal-field full">
        <label>Receipt photo</label>
        <input type="file" data-field="receipt" accept="image/*,.heic,.heif,image/heic,image/heif" />
        <p class="recon-receipt-preview muted" data-receipt-preview hidden></p>
      </div>
    </div>
  `);
  if (!shell) return;

  const qtyEl = shell.body.querySelector('[data-field="qty"]');
  const priceEl = shell.body.querySelector('[data-field="price"]');
  const totalEl = shell.body.querySelector('[data-field="total"]');
  const receiptEl = shell.body.querySelector('[data-field="receipt"]');
  const previewEl = shell.body.querySelector('[data-receipt-preview]');
  let receiptDataUrl = null;

  receiptEl?.addEventListener('change', async () => {
    const file = receiptEl.files?.[0];
    if (!file) {
      receiptDataUrl = null;
      previewEl.hidden = true;
      previewEl.textContent = '';
      return;
    }
    try {
      receiptDataUrl = await readFileAsDataUrl(file);
      previewEl.hidden = false;
      previewEl.textContent = `Selected: ${file.name}`;
    } catch (_) {
      receiptDataUrl = null;
      previewEl.hidden = false;
      previewEl.textContent = 'Could not read that image';
    }
  });

  let active = null;
  qtyEl?.addEventListener('focus', () => {
    active = 'qty';
  });
  priceEl?.addEventListener('focus', () => {
    active = 'price';
  });
  totalEl?.addEventListener('focus', () => {
    active = 'total';
  });
  const syncTotals = () => {
    const q = Number(qtyEl.value) || 0;
    const p = Number(priceEl.value) || 0;
    const t = Number(totalEl.value) || 0;
    if (active === 'total' && q > 0) {
      priceEl.value = String(Number((t / q).toFixed(4)));
    } else if (active === 'qty' || active === 'price') {
      totalEl.value = String(Math.round(q * p));
    }
  };
  qtyEl?.addEventListener('input', syncTotals);
  priceEl?.addEventListener('input', syncTotals);
  totalEl?.addEventListener('input', syncTotals);

  shell.footer.innerHTML = `
    <button type="button" class="btn secondary" data-cancel>Cancel</button>
    <button type="button" class="btn primary" data-save>Save &amp; link</button>
  `;
  shell.footer.querySelector('[data-cancel]')?.addEventListener('click', shell.close);
  shell.footer.querySelector('[data-save]')?.addEventListener('click', async () => {
    const saveBtn = shell.footer.querySelector('[data-save]');
    saveBtn.disabled = true;
    try {
      const expense = await createExpenseFromLines([line], {
        date: shell.body.querySelector('[data-field="date"]').value,
        notes: shell.body.querySelector('[data-field="notes"]').value,
        supplierName: shell.body.querySelector('[data-field="supplier"]').value,
        supplierId: line.supplierId || '',
        itemName: shell.body.querySelector('[data-field="item"]').value,
        quantity: Number(qtyEl.value) || 1,
        price: Number(priceEl.value) || 0,
        totalAmount: Number(totalEl.value) || 0,
        allocation: locFields.allocation,
        branch: shell.body.querySelector('[data-field="branch"]').value,
        eventName: locFields.eventName || '',
      });

      if (receiptDataUrl) {
        const url = await uploadExpenseReceipt(expense.id, receiptDataUrl);
        if (url) {
          await patchExpenseReceipt(expense.id, { receiptImage: url, hasReceiptImage: true });
          expense.receiptImage = url;
          expense.hasReceiptImage = true;
        } else {
          toast('Expense saved, but receipt upload failed');
        }
      }

      linkLineToExpense(week.id, line.id, expense, {
        actualCost: Number(expense.totalAmount) || 0,
      });
      toast('Expense saved & linked');
      shell.close();
      onDone?.();
    } catch (err) {
      console.warn(err);
      toast(err.message || 'Could not save expense');
      saveBtn.disabled = false;
    }
  });
}

async function openOffPlanLinkModal(week, onDone) {
  const shell = openModalShell('Add extra expense', `
    <div class="line-modal-field full">
      <label>Search expenses</label>
      <input type="search" data-expense-search autocomplete="off" placeholder="Supplier, item, date\u2026" />
    </div>
    <div class="line-modal-field full">
      <label>Reason</label>
      <input type="text" data-field="reason" placeholder="Why this wasn’t on the budget" />
    </div>
    <div class="recon-expense-list" data-expense-list><p class="empty">Loading\u2026</p></div>
  `);
  if (!shell) return;
  shell.footer.innerHTML = `<button type="button" class="btn secondary" data-cancel>Cancel</button>`;
  shell.footer.querySelector('[data-cancel]')?.addEventListener('click', shell.close);

  let expenses = [];
  try {
    const all = await loadRecentExpenses();
    expenses = filterExpensesForWeek(all, week);
  } catch (err) {
    shell.body.querySelector('[data-expense-list]').innerHTML =
      '<p class="empty">Could not load expenses</p>';
    return;
  }

  const listEl = shell.body.querySelector('[data-expense-list]');
  const searchEl = shell.body.querySelector('[data-expense-search]');
  const reasonEl = shell.body.querySelector('[data-field="reason"]');

  const paint = () => {
    const hits = searchExpenses(expenses, searchEl.value);
    listEl.innerHTML = renderExpenseHitList(hits);
    bindExpensePick(listEl, expenses, (exp) => {
      addOffPlanExpense(week.id, {
        date: exp.date,
        supplierName: exp.supplierName,
        location: exp.branch || '',
        amount: Number(exp.totalAmount) || 0,
        reason: reasonEl.value || 'Extra purchase',
        expenseId: exp.id,
      });
      toast('Added extra expense');
      shell.close();
      onDone?.();
    });
  };
  searchEl.addEventListener('input', paint);
  paint();
  searchEl.focus();
}
