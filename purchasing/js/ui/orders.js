import { getWeek, setLineStatus, setLinesStatus, canActOnWeek } from '../store.js?v=96';
import { itemDisplayName, locationLabel, locationSortRank } from '../data/catalog.js?v=96';
import {
  groupOrderSheets,
  plannedLines,
  lineAmount,
  isFee,
  fulfillmentStatus,
} from '../compute.js?v=96';
import { formatDateRange, formatPeso, formatQty, formatDateMedium, escapeHtml, statusLabel } from '../format.js?v=96';
import { renderWeekChrome, bindWeekChrome } from './week-chrome.js?v=96';
import { toast } from './shell.js?v=96';

const STATUS_OPTIONS = [
  ['planned', 'Not ordered'],
  ['ordered', 'Ordered'],
  ['delivered', 'Delivered'],
];
const GROUP_KEY = 'purchasing-order-group';
const VIEW_KEY = 'purchasing-order-view';

let groupBy = loadGroupBy();
let orderView = loadOrderView();

function loadGroupBy() {
  try {
    const saved = localStorage.getItem(GROUP_KEY);
    if (saved === 'item' || saved === 'branch') return saved;
  } catch (_) {
    /* ignore */
  }
  return 'branch';
}

function saveGroupBy(value) {
  groupBy = value;
  try {
    localStorage.setItem(GROUP_KEY, value);
  } catch (_) {
    /* ignore */
  }
}

function loadOrderView() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'list' || saved === 'suppliers' || saved === 'tickets') {
      return saved === 'tickets' ? 'suppliers' : saved;
    }
  } catch (_) {
    /* ignore */
  }
  return 'list';
}

function saveOrderView(value) {
  orderView = value;
  try {
    localStorage.setItem(VIEW_KEY, value);
  } catch (_) {
    /* ignore */
  }
}

export function renderOrders(root, weekId) {
  const week = getWeek(weekId);
  if (!week) {
    root.innerHTML = '<p class="app-loading-inline">Loading week\u2026</p>';
    return;
  }

  const groups = groupOrderSheets(week);
  const canAct = canActOnWeek(week);
  const byItem = groupBy === 'item';
  const isList = orderView === 'list';
  const lines = sortOrderLines(plannedLines(week));

  root.innerHTML = `
    ${renderWeekChrome(week, { tab: 'orders' })}
    <div class="sheet-toolbar order-toolbar no-print">
      <div class="order-toolbar-slot order-toolbar-slot--group" aria-hidden="${isList ? 'true' : 'false'}">
        ${
          isList
            ? ''
            : `<div class="day-toggle" role="group" aria-label="Group suppliers by">
                <button type="button" class="${byItem ? 'on' : ''}" data-group-by="item">By item</button>
                <button type="button" class="${byItem ? '' : 'on'}" data-group-by="branch">By branch</button>
              </div>`
        }
      </div>
      <div class="order-toolbar-slot order-toolbar-slot--view">
        <div class="day-toggle" role="group" aria-label="Order view">
          <button type="button" class="${isList ? 'on' : ''}" data-order-view="list">List</button>
          <button type="button" class="${isList ? '' : 'on'}" data-order-view="suppliers">Suppliers</button>
        </div>
      </div>
    </div>
    ${
      isList
        ? renderOrderList(week, lines, canAct)
        : renderTickets(week, groups, canAct, byItem)
    }
  `;

  bindWeekChrome(root, week, { tab: 'orders' });
  bindStatusPills(root, week, weekId);
  root.querySelectorAll('[data-order-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveOrderView(btn.dataset.orderView);
      renderOrders(root, weekId);
    });
  });
  root.querySelectorAll('[data-group-by]').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveGroupBy(btn.dataset.groupBy);
      renderOrders(root, weekId);
    });
  });
  root.querySelectorAll('[data-download-sheet]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.downloadSheet);
      const group = groups[idx];
      if (!group) return;
      btn.disabled = true;
      try {
        await downloadSupplierHandoff(week, group, byItem);
        toast(`Saved ${group.supplierName}`);
      } catch (err) {
        console.warn(err);
        toast('Could not download');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function sortOrderLines(lines) {
  return [...lines].sort((a, b) => {
    const loc = locationSortRank(a.location) - locationSortRank(b.location);
    if (loc) return loc;
    return itemDisplayName(a).localeCompare(itemDisplayName(b));
  });
}

function renderOrderList(week, lines, canAct) {
  if (!lines.length) {
    return '<p class="empty">Nothing on the budget yet.</p>';
  }
  return `<div class="table-wrap order-list-wrap">
    <table class="plan-table order-list-table">
      <colgroup>
        <col class="ol-item" />
        <col class="ol-branch" />
        <col class="ol-supplier" />
        <col class="ol-qty" />
        <col class="ol-cost" />
        <col class="ol-status" />
      </colgroup>
      <thead>
        <tr>
          <th>Item</th>
          <th>Branch</th>
          <th>Supplier</th>
          <th class="num">Qty</th>
          <th class="num">Cost</th>
          <th class="col-status">Status</th>
        </tr>
      </thead>
      <tbody>
        ${lines
          .map((line) => {
            const status = fulfillmentStatus(line);
            const split = {
              id: line.id,
              status,
              qty: line.qty,
              cost: lineAmount(line),
              label: locationLabel(line.location),
              location: line.location,
            };
            return `<tr data-line="${escapeHtml(line.id)}">
              <td class="ol-item"><strong>${escapeHtml(itemDisplayName(line))}</strong></td>
              <td class="ol-branch">${escapeHtml(locationLabel(line.location))}</td>
              <td class="ol-supplier">${escapeHtml(
                line.supplierName && line.supplierName !== 'Unassigned'
                  ? line.supplierName
                  : '\u2014'
              )}</td>
              <td class="num ol-qty">${isFee(line) ? '\u2014' : formatQty(line.qty, line.unit)}</td>
              <td class="num ol-cost">${formatPeso(lineAmount(line))}</td>
              <td class="col-status ol-status">${renderStatusCell(split, canAct)}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  </div>`;
}

function renderTickets(week, groups, canAct, byItem) {
  if (!groups.length) {
    return '<p class="empty">Nothing on the budget yet.</p>';
  }
  return `<div class="order-sheets">
    ${groups
      .map(
        (g, idx) => `<section class="sheet print-area" data-sheet-idx="${idx}">
          <header class="sheet-head">
            <div>
              <h2>${escapeHtml(g.supplierName)}</h2>
              <p class="muted">${formatDateRange(week.weekStart, week.weekEnd)}</p>
            </div>
            <div class="sheet-head-actions no-print">
              <button type="button" class="btn secondary btn-sm" data-download-sheet="${idx}">Download</button>
              ${canAct ? renderMarkAll(g) : ''}
            </div>
          </header>
          <table class="sheet-table">
            <thead>
              <tr>
                <th>${byItem ? 'Item / branch' : 'Branch / item'}</th>
                <th class="num">Qty</th>
                <th class="num">Cost</th>
                <th class="col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              ${renderSheetBody(g.rows, canAct)}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td></td>
                <td class="num">${formatPeso(g.rows.reduce((s, r) => s + r.cost, 0))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </section>`
      )
      .join('')}
  </div>`;
}

async function downloadSupplierHandoff(week, group, byItem) {
  const branches = new Set();
  for (const row of group.rows || []) {
    for (const split of row.splits || []) {
      if (split.location) branches.add(split.location);
    }
  }
  const singleBranch = branches.size <= 1;
  const sections = byItem ? sectionsByItem(group.rows) : sectionsByBranch(group.rows);
  const flatItems = [];
  if (singleBranch) {
    for (const section of sections) {
      for (const child of section.children) {
        flatItems.push({
          label: byItem ? section.title : child.label,
          qty: child.qty,
        });
      }
    }
  }

  const bodyHtml = singleBranch
    ? flatItems
        .map(
          (item) => `<tr>
            <td>${escapeHtml(item.label)}</td>
            <td class="num">${escapeHtml(item.qty)}</td>
          </tr>`
        )
        .join('')
    : sections
        .map(
          (section) => `<tr class="handoff-group">
            <td colspan="2">${escapeHtml(section.title)}</td>
          </tr>
          ${section.children
            .map(
              (child) => `<tr>
                <td>${escapeHtml(child.label)}</td>
                <td class="num">${escapeHtml(child.qty)}</td>
              </tr>`
            )
            .join('')}`
        )
        .join('');

  const todayIso = new Date().toISOString().slice(0, 10);
  const orderDate = formatDateMedium(todayIso);
  const supplierName = group.supplierName || 'Supplier';
  const card = document.createElement('div');
  card.className = 'supplier-handoff-card';
  card.innerHTML = `
    <header>
      <h1>Matchanese</h1>
      <p class="handoff-meta">Order date \u00B7 ${escapeHtml(orderDate)}</p>
      <p class="handoff-supplier">Supplier \u00B7 ${escapeHtml(supplierName)}</p>
    </header>
    <table>
      <thead>
        <tr>
          <th>${byItem && !singleBranch ? 'Item / branch' : singleBranch ? 'Item' : 'Branch / item'}</th>
          <th class="num">Qty</th>
        </tr>
      </thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;
  card.style.cssText =
    'position:fixed;left:-10000px;top:0;width:560px;padding:28px 32px;background:#fff;color:#111;font-family:Inter,system-ui,-apple-system,sans-serif;';
  document.body.appendChild(card);

  try {
    const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm')).default;
    const canvas = await html2canvas(card, {
      backgroundColor: '#ffffff',
      scale: Math.min(2, window.devicePixelRatio || 2),
      useCORS: true,
    });
    const slug = String(supplierName)
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const dateSlug = todayIso.replace(/-/g, '');
    const link = document.createElement('a');
    link.download = `${slug || 'supplier'}-${dateSlug}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    card.remove();
  }
}

function sheetLineIds(group) {
  return group.rows.flatMap((row) => row.splits.map((split) => split.id));
}

function renderMarkAll(group) {
  const ids = sheetLineIds(group).join(',');
  return `<div class="status-pill-wrap sheet-bulk no-print">
    <button type="button" class="btn secondary btn-sm status-pill-btn sheet-action-btn" data-status-toggle aria-haspopup="listbox" aria-expanded="false">
      Mark all<span class="status-pill-caret" aria-hidden="true"></span>
    </button>
    <div class="status-menu" role="listbox">
      ${STATUS_OPTIONS.map(
        ([value, label]) => `<button type="button" class="status-option" data-mark-all="${escapeHtml(ids)}" data-value="${value}" role="option">
          <span class="status-pill status-pill--${value}">${escapeHtml(label)}</span>
        </button>`
      ).join('')}
    </div>
  </div>`;
}

function renderSheetBody(rows, canAct) {
  const sections = groupBy === 'item' ? sectionsByItem(rows) : sectionsByBranch(rows);
  return sections
    .map(
      (section) => `<tr class="sheet-item">
        <td colspan="4">${escapeHtml(section.title)}</td>
      </tr>
      ${section.children
        .map(
          (child) => `<tr class="sheet-branch">
            <td class="branch-name">${escapeHtml(child.label)}</td>
            <td class="num">${child.qty}</td>
            <td class="num">${formatPeso(child.cost)}</td>
            <td class="col-status">${renderStatusCell(child.split, canAct)}</td>
          </tr>`
        )
        .join('')}`
    )
    .join('');
}

function sectionsByItem(rows) {
  return rows.map((row) => ({
    title: itemDisplayName(row),
    children: row.splits.map((split) => ({
      label: split.label,
      qty: row.kind === 'deliveryFee' ? '\u2014' : formatQty(split.qty, row.unit),
      cost: split.cost,
      split,
    })),
  }));
}

function sectionsByBranch(rows) {
  const byLoc = new Map();
  for (const row of rows) {
    for (const split of row.splits) {
      const key = split.location || 'unknown';
      if (!byLoc.has(key)) {
        byLoc.set(key, { key, title: split.label, children: [] });
      }
      byLoc.get(key).children.push({
        label: itemDisplayName(row),
        qty: row.kind === 'deliveryFee' ? '\u2014' : formatQty(split.qty, row.unit),
        cost: split.cost,
        split,
      });
    }
  }
  return [...byLoc.values()].sort((a, b) => locationSortRank(a.key) - locationSortRank(b.key));
}

function statusLabelFor(status) {
  if (status === 'planned') return 'Not ordered';
  return statusLabel(status, 'line');
}

function renderPill(status, { chevron = false } = {}) {
  return `<span class="status-pill status-pill--${escapeHtml(status)}">
    ${escapeHtml(statusLabelFor(status))}
    ${chevron ? '<span class="status-pill-caret" aria-hidden="true"></span>' : ''}
  </span>`;
}

function renderStatusCell(split, canAct) {
  if (!canAct) {
    return split.status === 'planned'
      ? '\u2014'
      : `<span class="status-pill-wrap">${renderPill(split.status)}</span>`;
  }
  return `<div class="status-pill-wrap">
    <button type="button" class="status-pill-btn" data-status-toggle aria-haspopup="listbox" aria-expanded="false">
      ${renderPill(split.status, { chevron: true })}
    </button>
    <div class="status-menu" role="listbox">
      ${STATUS_OPTIONS.map(
        ([value, label]) => `<button type="button" class="status-option ${split.status === value ? 'is-current' : ''}" data-line-status="${escapeHtml(split.id)}" data-value="${value}" role="option" aria-selected="${split.status === value}">
          <span class="status-pill status-pill--${value}">${escapeHtml(label)}</span>
        </button>`
      ).join('')}
    </div>
  </div>`;
}

function bindStatusPills(root, week, weekId) {
  const clearMenuPos = (wrap) => {
    const menu = wrap.querySelector('.status-menu');
    if (!menu) return;
    menu.classList.remove('status-menu--fixed');
    menu.style.left = '';
    menu.style.top = '';
    menu.style.minWidth = '';
  };

  const placeMenu = (wrap) => {
    const menu = wrap.querySelector('.status-menu');
    const btn = wrap.querySelector('[data-status-toggle]');
    if (!menu || !btn) return;
    menu.classList.add('status-menu--fixed');
    const rect = btn.getBoundingClientRect();
    const menuH = menu.offsetHeight || 130;
    const openUp = window.innerHeight - rect.bottom < menuH + 12 && rect.top > menuH + 12;
    const width = Math.max(rect.width, 168);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    menu.style.minWidth = `${width}px`;
    menu.style.left = `${left}px`;
    menu.style.top = openUp
      ? `${Math.max(8, rect.top - menuH - 6)}px`
      : `${rect.bottom + 6}px`;
  };

  const closeAll = () => {
    root.querySelectorAll('.status-pill-wrap.is-open').forEach((wrap) => {
      wrap.classList.remove('is-open');
      wrap.querySelector('[data-status-toggle]')?.setAttribute('aria-expanded', 'false');
      clearMenuPos(wrap);
    });
  };

  root.querySelectorAll('[data-status-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btn.closest('.status-pill-wrap');
      const open = wrap.classList.contains('is-open');
      closeAll();
      if (!open) {
        wrap.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => placeMenu(wrap));
      }
    });
  });

  root.querySelectorAll('[data-line-status]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setLineStatus(week.id, btn.dataset.lineStatus, btn.dataset.value);
      renderOrders(root, weekId);
    });
  });

  root.querySelectorAll('[data-mark-all]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ids = (btn.dataset.markAll || '').split(',').filter(Boolean);
      setLinesStatus(week.id, ids, btn.dataset.value);
      renderOrders(root, weekId);
    });
  });

  if (window.__purchasingStatusMenu) {
    document.removeEventListener('pointerdown', window.__purchasingStatusMenu);
  }
  window.__purchasingStatusMenu = (e) => {
    if (e.target.closest('.status-pill-wrap')) return;
    if (e.target.closest('.status-menu')) return;
    closeAll();
  };
  document.addEventListener('pointerdown', window.__purchasingStatusMenu);

  if (window.__purchasingStatusScroll) {
    window.removeEventListener('scroll', window.__purchasingStatusScroll, true);
    window.removeEventListener('resize', window.__purchasingStatusScroll);
  }
  window.__purchasingStatusScroll = () => closeAll();
  window.addEventListener('scroll', window.__purchasingStatusScroll, true);
  window.addEventListener('resize', window.__purchasingStatusScroll);
}
