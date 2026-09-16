import {
  getWeek,
  updateLine,
  setLineOnPlan,
  canEditPlan,
  loadStateFromOrderView,
  isThisWeek,
  ensureBranchLoaded,
  reloadBranchLoaded,
  loadLastOpenLoc,
  saveLastOpenLoc,
  isBranchFeedLoaded,
  CORE_BRANCHES,
} from '../store.js?v=97';
import {
  itemDisplayName,
  buildLocationGroups,
} from '../data/catalog.js?v=97';
import {
  sortByInventoryOrder,
  lineWarning,
  lineAmount,
  isFee,
  isLockedStatus,
  fulfillmentStatus,
  orderQtyState,
} from '../compute.js?v=97';
import {
  formatPeso,
  formatQty,
  formatDateShort,
  formatDateRange,
  formatRunoutDays,
  escapeHtml,
  statusLabel,
  formatLineEditTitle,
} from '../format.js?v=97';
import { renderWeekChrome, bindWeekChrome } from './week-chrome.js?v=97';
import { toast } from './shell.js?v=97';
import { openPlanLineModal, openAddLineModal } from './plan-line-modal.js?v=97';
import { openAddLocationChooser } from './location-chooser.js?v=97';
import {
  createAutocomplete,
} from '../../../expenses/js/autocomplete.js?v=97';
import { getSuppliers, ensureSupplier } from '../data/suppliers.js?v=97';
import { buildItemSupplierMatchList, getSupplierRate } from '../data/item-prefs.js?v=97';
import { isManualPlanLine } from '../data/overlay-filter.js?v=97';
import {
  VALID_ORDER_BASELINES,
  VALID_ORDER_HORIZONS,
  compactBaselineChoices,
  compactHorizonChoices,
  loadBranchForecastOptions,
  saveBranchForecastOptions,
} from '../../../inventory/js/shared/order-view-options.js?v=105';

const COLLAPSE_KEY = 'purchasing-collapsed-locs';
const SUGGESTED_EXPAND_KEY = 'purchasing-show-suggested';
const SUGGESTED_ALL_KEY = 'purchasing-show-all-suggested';
const SUGGESTED_RENDER_CAP = 50;
const COLS_WITH_RUNOUT = 9;
const COLS_NO_RUNOUT = 8;

let editingLineId = null;
let justOpenedEdit = false;

function loadSuggestedExpand() {
  try {
    return JSON.parse(localStorage.getItem(SUGGESTED_EXPAND_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function saveSuggestedExpand(map) {
  localStorage.setItem(SUGGESTED_EXPAND_KEY, JSON.stringify(map));
}

function isSuggestedExpanded(locKey) {
  return !!loadSuggestedExpand()[locKey];
}

function toggleSuggestedExpand(locKey) {
  const map = loadSuggestedExpand();
  const next = !map[locKey];
  map[locKey] = next;
  saveSuggestedExpand(map);
  if (!next) {
    const all = loadSuggestedAll();
    if (all[locKey]) {
      delete all[locKey];
      saveSuggestedAll(all);
    }
  }
}

function loadSuggestedAll() {
  try {
    return JSON.parse(localStorage.getItem(SUGGESTED_ALL_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function saveSuggestedAll(map) {
  localStorage.setItem(SUGGESTED_ALL_KEY, JSON.stringify(map));
}

function isSuggestedShowAll(locKey) {
  return !!loadSuggestedAll()[locKey];
}

function showAllSuggested(locKey) {
  const map = loadSuggestedAll();
  map[locKey] = true;
  saveSuggestedAll(map);
}

/** Suggested lists are hidden until clicked \u2014 rendering every Order View row freezes Budget. */
function shouldAutoHideSuggested(_includedCount, suggestedCount) {
  return suggestedCount > 0;
}

function showRunoutColumn(week) {
  return isThisWeek(week) && !week.archived;
}

function loadCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function saveCollapsed(map) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map));
}

function isGroupCollapsed(key, hasIncluded) {
  const map = loadCollapsed();
  if (map[key] === true) return true;
  if (map[key] === false) return false;
  // Default: expand last-open branch (or any with plan lines); keep others collapsed.
  const last = loadLastOpenLoc();
  if (key === last) return false;
  return !hasIncluded;
}

function toggleCollapsed(key, hasIncluded) {
  const map = loadCollapsed();
  const next = !isGroupCollapsed(key, hasIncluded);
  map[key] = next;
  saveCollapsed(map);
  if (!next) saveLastOpenLoc(key);
}

export function renderPlan(root, weekId) {
  const week = getWeek(weekId);
  if (!week) {
    // Route/state can briefly disagree during boot \u2014 avoid a hard empty state flash.
    root.innerHTML = '<p class="app-loading-inline">Loading week\u2026</p>';
    return;
  }

  const editable = canEditPlan(week);
  const groups = buildLocationGroups(week);

  root.innerHTML = `
    ${renderWeekChrome(week, { tab: 'plan' })}
    <div class="plan-toolbar">
      ${
        editable
          ? `<button type="button" class="btn secondary btn-sm" data-add-location>+ Add location</button>`
          : ''
      }
    </div>
    <div class="plan-groups">
      ${groups.map((g) => renderGroup(week, g, editable)).join('')}
    </div>
    ${
      !groups.length
        ? `<div class="plan-empty">
            <p class="empty">No locations on this week yet.</p>
            ${
              editable
                ? `<button type="button" class="btn primary" data-add-location>Add location</button>`
                : ''
            }
          </div>`
        : ''
    }
  `;

  bindWeekChrome(root, week, { tab: 'plan' });
  bindPlan(root, week, editable, () => renderPlan(root, weekId));
  bindBranchForecast(root, week);

  // If last-open (or another expanded) core branch isn't loaded yet, fetch it now.
  for (const g of groups) {
    const hasIncluded = g.lines.some((l) => l.onPlan);
    if (
      !isGroupCollapsed(g.key, hasIncluded) &&
      CORE_BRANCHES.includes(g.key) &&
      !isBranchFeedLoaded(g.key)
    ) {
      ensureBranchLoaded(g.key).catch((err) =>
        console.warn('Could not load branch', g.key, err)
      );
    }
  }
}

function sortIncluded(lines) {
  const processed = sortByInventoryOrder(
    lines.filter((l) => isLockedStatus(fulfillmentStatus(l)) || l.frozen)
  );
  const open = sortByInventoryOrder(
    lines.filter((l) => !isLockedStatus(fulfillmentStatus(l)) && !l.frozen)
  );
  return [...processed, ...open];
}

function renderLineRows(week, lines, editable, withRunout = true) {
  return lines.map((line) => renderRow(week, line, editable, withRunout)).join('');
}

async function downloadLocationBudgetPng(week, group) {
  const lines = (group.lines || []).filter((l) => l.onPlan);
  if (!lines.length) {
    toast('Nothing on the budget to download');
    return;
  }
  const dash = '\u2014';
  const middot = '\u00B7';
  const rowsHtml = lines
    .map((l) => {
      const fee = isFee(l);
      const supplier =
        !fee && l.supplierName && l.supplierName !== 'Unassigned' ? l.supplierName : dash;
      const stock =
        fee || l.stockQty == null ? dash : escapeHtml(formatQty(l.stockQty, l.unit));
      const need =
        fee || l.needQty == null ? dash : escapeHtml(formatQty(l.needQty, l.unit));
      const order = fee ? dash : escapeHtml(formatQty(l.qty, l.unit));
      return `<tr>
        <td>${escapeHtml(itemDisplayName(l))}</td>
        <td>${escapeHtml(l.category || '')}</td>
        <td>${escapeHtml(supplier)}</td>
        <td class="num">${stock}</td>
        <td class="num">${need}</td>
        <td class="num">${order}</td>
        <td class="num">${escapeHtml(formatPeso(lineAmount(l)))}</td>
      </tr>`;
    })
    .join('');
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const weekLabel = formatDateRange(week.weekStart, week.weekEnd);
  const year = String(week.weekStart || '').slice(0, 4);
  const weekMeta = year ? `${weekLabel}, ${year}` : weekLabel;
  const card = document.createElement('div');
  card.className = 'budget-snapshot-card';
  card.innerHTML = `
    <header>
      <div class="snap-head-row">
        <div class="snap-head-main">
          <p class="snap-brand">Matchanese</p>
          <h1>${escapeHtml(group.label || group.key || 'Budget')}</h1>
          <p class="snap-meta">Budget ${middot} Week of ${escapeHtml(weekMeta)}</p>
        </div>
        <div class="snap-total">
          <span class="snap-total-label">Total</span>
          <strong class="snap-total-amount">${escapeHtml(formatPeso(subtotal))}</strong>
        </div>
      </div>
    </header>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Category</th>
          <th>Supplier</th>
          <th class="num">Stock</th>
          <th class="num">Need</th>
          <th class="num">Order</th>
          <th class="num">Cost</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  card.style.cssText =
    'position:fixed;left:-10000px;top:0;width:920px;padding:28px 32px;background:#fff;color:#111;font-family:Inter,system-ui,-apple-system,sans-serif;';
  document.body.appendChild(card);
  if (document.fonts?.ready) await document.fonts.ready;

  try {
    const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm')).default;
    const canvas = await html2canvas(card, {
      backgroundColor: '#ffffff',
      scale: Math.min(2, window.devicePixelRatio || 2),
      useCORS: true,
    });
    const locSlug = String(group.label || group.key || 'location')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const weekSlug = String(week.weekStart || 'week').replace(/-/g, '');
    const link = document.createElement('a');
    link.download = `budget-${locSlug || 'location'}-${weekSlug}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    card.remove();
  }
}

function selectOptionsHtml(choices, selected) {
  return choices
    .map(
      (c) =>
        `<option value="${escapeHtml(c.value)}" ${c.value === selected ? 'selected' : ''}>${escapeHtml(
          c.label
        )}</option>`
    )
    .join('');
}

function branchForecastOptions(week, branch) {
  const fromMeta = week?.liveMeta?.byBranch?.[branch];
  if (fromMeta) {
    return {
      orderUsageBaseline: VALID_ORDER_BASELINES.has(fromMeta.orderUsageBaseline)
        ? fromMeta.orderUsageBaseline
        : loadBranchForecastOptions(branch).orderUsageBaseline,
      orderHorizon: VALID_ORDER_HORIZONS.has(fromMeta.orderHorizon)
        ? fromMeta.orderHorizon
        : loadBranchForecastOptions(branch).orderHorizon,
      orderDemandBuffer:
        typeof fromMeta.orderDemandBuffer === 'boolean'
          ? fromMeta.orderDemandBuffer
          : loadBranchForecastOptions(branch).orderDemandBuffer,
    };
  }
  return loadBranchForecastOptions(branch);
}

function renderBranchForecast(week, branch, { loading = false } = {}) {
  if (!CORE_BRANCHES.includes(branch)) return '';
  if (!isThisWeek(week) || week.archived) return '';
  const today = new Date();
  const opts = branchForecastOptions(week, branch);
  const disabled = loading ? 'disabled' : '';
  return `
    <div class="loc-forecast" data-forecast-branch="${escapeHtml(branch)}">
      <select data-forecast-horizon class="loc-forecast-select" aria-label="Plan for" title="Week window to cover" ${disabled}>
        ${selectOptionsHtml(compactHorizonChoices(today), opts.orderHorizon)}
      </select>
      <select data-forecast-baseline class="loc-forecast-select loc-forecast-select--usage" aria-label="Usage from" title="Which week’s usage to use as the pattern" ${disabled}>
        ${selectOptionsHtml(compactBaselineChoices(today), opts.orderUsageBaseline)}
      </select>
      <button type="button" class="loc-forecast-buffer ${opts.orderDemandBuffer ? 'active' : ''}"
        data-forecast-buffer ${disabled}
        title="Adds 20% in case usage is higher than last week.">+20%</button>
    </div>`;
}

let forecastReloading = false;

async function reloadLiveForecast(branch) {
  if (forecastReloading) return;
  forecastReloading = true;
  document.querySelectorAll('.loc-forecast select, .loc-forecast button').forEach((el) => {
    el.disabled = true;
  });
  try {
    if (branch && CORE_BRANCHES.includes(branch)) {
      await reloadBranchLoaded(branch);
    } else {
      await loadStateFromOrderView();
    }
  } catch (err) {
    console.error(err);
    toast('Could not reload usage data');
  } finally {
    forecastReloading = false;
  }
}

function bindBranchForecast(root, week) {
  if (!isThisWeek(week) || week.archived) return;

  root.querySelectorAll('[data-forecast-branch]').forEach((wrap) => {
    const branch = wrap.dataset.forecastBranch;
    wrap.addEventListener('click', (e) => e.stopPropagation());
    wrap.querySelector('[data-forecast-horizon]')?.addEventListener('change', (e) => {
      e.stopPropagation();
      const v = e.target.value;
      if (!VALID_ORDER_HORIZONS.has(v)) return;
      saveBranchForecastOptions(branch, { orderHorizon: v });
      reloadLiveForecast(branch);
    });
    wrap.querySelector('[data-forecast-baseline]')?.addEventListener('change', (e) => {
      e.stopPropagation();
      const v = e.target.value;
      if (!VALID_ORDER_BASELINES.has(v)) return;
      saveBranchForecastOptions(branch, { orderUsageBaseline: v });
      reloadLiveForecast(branch);
    });
    wrap.querySelector('[data-forecast-buffer]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = !branchForecastOptions(week, branch).orderDemandBuffer;
      saveBranchForecastOptions(branch, { orderDemandBuffer: next });
      reloadLiveForecast(branch);
    });
  });
}

function renderGroup(week, group, editable) {
  const includedRaw = group.lines.filter((l) => l.onPlan);
  const feedReady = isBranchFeedLoaded(group.key);
  const collapsed = isGroupCollapsed(group.key, includedRaw.length > 0);
  const included = collapsed ? includedRaw : sortIncluded(includedRaw);
  const suggestedUnsorted = group.lines.filter(
    (l) =>
      !l.onPlan &&
      !isManualPlanLine(l) &&
      (l.needsCount || Number(l.suggestedQty) > 0)
  );
  const expandSuggested = isSuggestedExpanded(group.key);
  const suggested =
    collapsed || !feedReady || !expandSuggested
      ? suggestedUnsorted
      : sortByInventoryOrder(suggestedUnsorted);
  const subtotal = includedRaw.reduce((s, l) => s + lineAmount(l), 0);
  const showFeedLoading =
    !collapsed && CORE_BRANCHES.includes(group.key) && !feedReady;
  const withRunout = showRunoutColumn(week);
  const cols = withRunout ? COLS_WITH_RUNOUT : COLS_NO_RUNOUT;
  const autoHide = shouldAutoHideSuggested(included.length, suggested.length);
  const showSuggested =
    suggested.length > 0 && (!autoHide || isSuggestedExpanded(group.key));
  const capSuggested =
    showSuggested &&
    !isSuggestedShowAll(group.key) &&
    suggested.length > SUGGESTED_RENDER_CAP;
  const visibleSuggested = capSuggested
    ? suggested.slice(0, SUGGESTED_RENDER_CAP)
    : showSuggested
      ? suggested
      : [];

  const table = collapsed
    ? ''
    : showFeedLoading
      ? `<p class="app-loading-inline loc-loading" role="status">Loading ${escapeHtml(group.label)}\u2026</p>`
      : included.length || suggested.length
        ? `<div class="table-wrap">
      <table class="plan-table plan-table--loc">
        <colgroup>
          <col class="col-act" />
          ${withRunout ? '<col class="col-runout" />' : ''}
          <col class="col-item" />
          <col class="col-category" />
          <col class="col-supplier" />
          <col class="col-stock" />
          <col class="col-need" />
          <col class="col-order" />
          <col class="col-cost" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-act"></th>
            ${withRunout ? '<th class="col-runout">Runs out</th>' : ''}
            <th class="col-item">Item</th>
            <th class="col-category">Category</th>
            <th class="col-supplier">Supplier</th>
            <th class="col-num col-stock">Stock</th>
            <th class="col-num col-need">Need</th>
            <th class="col-num col-order">Order</th>
            <th class="col-num col-cost">Cost</th>
          </tr>
        </thead>
        <tbody>
          ${renderLineRows(week, included, editable, withRunout)}
          ${
            suggested.length && autoHide && !showSuggested
              ? `<tr class="suggested-divider"><td colspan="${cols}">
                  <div class="suggested-head">
                    <span>Suggested</span>
                    <button type="button" class="btn secondary btn-sm" data-toggle-suggested="${escapeHtml(group.key)}">
                      Show ${suggested.length} suggested
                    </button>
                  </div>
                </td></tr>`
              : ''
          }
          ${
            showSuggested
              ? `<tr class="suggested-divider"><td colspan="${cols}">
                  <div class="suggested-head">
                    <span>Suggested</span>
                    ${
                      autoHide
                        ? `<button type="button" class="btn secondary btn-sm" data-toggle-suggested="${escapeHtml(group.key)}">
                            Hide suggested
                          </button>`
                        : ''
                    }
                  </div>
                </td></tr>
                 ${renderLineRows(week, visibleSuggested, editable, withRunout)}
                 ${
                   capSuggested
                     ? `<tr class="suggested-divider"><td colspan="${cols}">
                  <div class="suggested-head">
                    <button type="button" class="btn secondary btn-sm" data-show-all-suggested="${escapeHtml(group.key)}">
                      Show remaining ${suggested.length - SUGGESTED_RENDER_CAP} suggested
                    </button>
                  </div>
                </td></tr>`
                     : ''
                 }`
              : ''
          }
        </tbody>
      </table>
    </div>`
        : `<div class="loc-group-empty">
            <p>No items yet.</p>
            ${
              editable
                ? `<button type="button" class="btn secondary btn-sm" data-add-loc="${escapeHtml(group.key)}">+ Add item</button>`
                : ''
            }
          </div>`;

  const canDownload = includedRaw.length > 0;

  return `<section class="loc-group" data-loc="${escapeHtml(group.key)}">
    <header class="loc-group-head" data-collapse="${group.key}">
      <div class="loc-group-title">
        <span class="group-chevron" aria-hidden="true">${collapsed ? '\u25B8' : '\u25BE'}</span>
        <div class="loc-name-block">
          <h2>${escapeHtml(group.label)}</h2>
        </div>
        ${
          canDownload
            ? `<button type="button" class="btn secondary btn-sm" data-download-loc="${escapeHtml(group.key)}" title="Download budget snapshot">Download</button>`
            : ''
        }
        ${editable ? `<button type="button" class="btn secondary btn-sm" data-add-loc="${group.key}">+ Add</button>` : ''}
      </div>
      ${collapsed ? '' : renderBranchForecast(week, group.key, { loading: showFeedLoading })}
      <strong class="loc-total">${formatPeso(subtotal)}</strong>
    </header>
    ${table ? `<div class="loc-group-body">${table}</div>` : ''}
  </section>`;
}

function renderSupplierInput(line) {
  const name =
    line.supplierName && line.supplierName !== 'Unassigned' ? line.supplierName : '';
  return `<div class="supplier-ac">
    <input type="text" data-field="supplier" autocomplete="off"
      value="${escapeHtml(name)}"
      data-supplier-id="${escapeHtml(line.supplierId || '')}"
      placeholder="Supplier" />
  </div>`;
}

function runoutCell(week, line) {
  const warn = lineWarning(week, line) || (line.runOutUrgent ? 'Out of stock or runs out soon' : '');
  const primary = line.runOutPrimary || (line.runoutDate ? formatDateShort(line.runoutDate) : '\u2014');
  const secondary =
    line.runOutSecondary || (line.runoutDate ? formatRunoutDays(line.runoutDate) : '');
  const tip = line.runOutTitle || warn || '';
  const urgent = line.runOutUrgent ? ' is-urgent' : '';
  return `<div class="runout-cell${urgent}" title="${escapeHtml(tip)}">
    <div class="runout-text">
      <span class="runout-date">${escapeHtml(primary)}</span>
      ${secondary ? `<span class="runout-days">${escapeHtml(secondary)}</span>` : ''}
    </div>
    ${warn ? `<span class="runout-warn" title="${escapeHtml(warn)}">\u26A0</span>` : ''}
  </div>`;
}

/** Parse stock as-of label into short date/text + opening|closing|forecast kind. */
function parseStockAsOf(label, kindHint = null, { preferMondayOpening = false } = {}) {
  if (kindHint === 'forecast') {
    return {
      kind: 'forecast',
      text: '',
      title: 'Forecasted Monday opening',
    };
  }
  if (
    preferMondayOpening ||
    kindHint === 'opening' ||
    String(label || '') === 'Mon opening' ||
    String(label || '') === 'Mon' ||
    /Opening/i.test(String(label || ''))
  ) {
    const raw = String(label || '').trim();
    const from = raw.match(/^(.+?)\s+Opening\b/i);
    return {
      kind: 'opening',
      text: '',
      title: from
        ? `Monday opening (from ${from[1].trim()})`
        : 'Monday opening',
    };
  }
  const raw = String(label || '').trim();
  const legacy = raw.match(/^(.+?)\s+(Closing)\b(.*)$/i);
  if (legacy) {
    const text = `${legacy[1].trim()}${legacy[3] || ''}`.trim();
    return {
      kind: 'closing',
      text,
      title: 'Closing count',
    };
  }
  if (!raw) return null;
  const kind =
    kindHint === 'opening' || kindHint === 'closing' || kindHint === 'forecast'
      ? kindHint
      : null;
  return {
    kind,
    text: raw,
    title:
      kind === 'opening'
        ? 'Opening count'
        : kind === 'closing'
          ? 'Closing count'
          : kind === 'forecast'
            ? 'Forecasted Monday opening'
            : raw,
  };
}

function renderStockAsOfSub(label, kindHint = null, opts = {}) {
  const parsed = parseStockAsOf(label, kindHint, opts);
  if (!parsed || (!parsed.text && !parsed.kind)) return '';
  const kindClass =
    parsed.kind === 'opening'
      ? 'stock-kind stock-kind--opening'
      : parsed.kind === 'closing'
        ? 'stock-kind stock-kind--closing'
        : parsed.kind === 'forecast'
          ? 'stock-kind stock-kind--forecast'
          : '';
  const icon = kindClass
    ? `<span class="${kindClass}" title="${escapeHtml(parsed.title)}" aria-label="${escapeHtml(parsed.title)}"></span>`
    : '';
  const text = parsed.text ? escapeHtml(parsed.text) : '';
  return `<span class="cell-sub" title="${escapeHtml(parsed.title)}">${icon}${text}</span>`;
}

function stockCell(line) {
  if (line.stockQty == null && line.needsCount) {
    return `<span class="cell-stack"><span>\u2014</span><span class="cell-sub">No count</span></span>`;
  }
  if (line.stockQty == null) return '\u2014';
  if (line.needsCount) {
    return `<span class="cell-stack"><span>${escapeHtml(formatQty(line.stockQty, line.unit))}</span><span class="cell-sub">No count</span></span>`;
  }

  // Monday stock mode: qty only \u2014 as-of date lives in the week header.
  if (
    line.stockMode === 'forecast' ||
    line.stockMode === 'actual' ||
    line.stockCountKind === 'forecast' ||
    line.stockAsOfLabel === 'Mon' ||
    line.stockAsOfLabel === 'Mon opening' ||
    (line.metricsSnapshotted &&
      (line.stockCountKind === 'opening' || line.stockCountKind === 'forecast'))
  ) {
    return escapeHtml(formatQty(line.stockQty, line.unit));
  }

  const subLabel =
    line.stockAsOfLabel ||
    (line.stockSub && line.stockSub !== 'No count' ? line.stockSub : '');
  const sub = subLabel ? renderStockAsOfSub(subLabel, line.stockCountKind || null) : '';

  return sub
    ? `<span class="cell-stack"><span>${escapeHtml(formatQty(line.stockQty, line.unit))}</span>${sub}</span>`
    : escapeHtml(formatQty(line.stockQty, line.unit));
}

function orderCell(week, line, editing) {
  if (isFee(line)) return '\u2014';
  if (editing) {
    return `<span class="qty-edit"><input type="number" min="0" step="any" data-field="qty" value="${line.qty}" /><span class="unit">${escapeHtml(line.unit || '')}</span></span>`;
  }
  const state = orderQtyState(line);
  const reset =
    state.edited && line.suggestedQty != null
      ? `<button type="button" class="order-qty-reset" data-reset-qty title="Reset to suggested">→º</button>`
      : `<span class="order-qty-trail" aria-hidden="true"></span>`;
  const belowFlag = state.belowNeed
    ? `<span class="order-qty-below-flag" title="Below suggested order" aria-label="Below suggested order">→“</span>`
    : '';
  // Italic = edited from suggested. →“ = order qty is below suggested.
  return `<span class="order-qty ${state.classes}" title="${escapeHtml(state.tip)}"><span class="order-qty-val">${escapeHtml(
    formatQty(line.qty, line.unit)
  )}${belowFlag}</span>${reset}</span>`;
}

function renderRow(week, line, editable, withRunout = true) {
  const fulfill = fulfillmentStatus(line);
  const locked = isLockedStatus(fulfill) || line.frozen;
  const canToggle = editable && fulfill === 'planned' && !line.frozen;
  const suggested = !line.onPlan;
  const canEditRow =
    editable && !locked && fulfill === 'planned' && line.onPlan;
  const editing = canEditRow && editingLineId === line.id;

  const supplierCell = editing
    ? renderSupplierInput(line)
    : escapeHtml(
        line.supplierName && line.supplierName !== 'Unassigned' ? line.supplierName : '\u2014'
      );

  const stateTips = {
    ordered: 'Order already sent to the supplier',
    delivered: 'Goods arrived at the store',
  };
  const state =
    fulfill !== 'planned'
      ? `<span class="status-flags"><span class="status-pill status-pill--${fulfill}" title="${escapeHtml(stateTips[fulfill] || '')}">${escapeHtml(statusLabel(fulfill, 'line'))}</span></span>`
      : '';

  const includeCell = !editable
    ? ''
    : canToggle && suggested
      ? `<button type="button" class="icon-btn icon-btn--add" data-include="1" title="Add to budget">+</button>`
      : canToggle && !suggested
        ? `<button type="button" class="icon-btn icon-btn--remove" data-include="0" title="${
            isManualPlanLine(line) ? 'Remove' : 'Remove from budget'
          }">-</button>`
        : '';

  const editTitle = formatLineEditTitle(line);
  const itemTitle = editTitle ? ` title="${escapeHtml(editTitle)}"` : '';

  return `<tr class="${suggested ? 'is-suggested' : ''} ${locked ? 'is-committed' : ''} ${editing ? 'is-editing' : ''} ${canEditRow ? 'is-editable' : ''}" data-line="${line.id}">
    <td class="col-act">${includeCell}</td>
    ${withRunout ? `<td class="col-runout">${isFee(line) ? '\u2014' : runoutCell(week, line)}</td>` : ''}
    <td class="col-item"><strong class="item-name"${itemTitle}>${escapeHtml(itemDisplayName(line))}</strong> ${state}</td>
    <td class="col-category">${escapeHtml(line.category || 'Other')}</td>
    <td class="col-supplier">${supplierCell}</td>
    <td class="num col-stock">${isFee(line) ? '\u2014' : stockCell(line)}</td>
    <td class="num col-need">${isFee(line) || line.needQty == null ? '\u2014' : escapeHtml(formatQty(line.needQty, line.unit))}</td>
    <td class="num col-order">${orderCell(week, line, editing)}</td>
    <td class="num col-cost">${
      editing
        ? `<input type="number" min="0" step="1" data-field="cost" value="${line.estimatedCost}" />`
        : formatPeso(line.estimatedCost)
    }</td>
  </tr>`;
}

function bindSupplierAutocomplete(input, line, onPick) {
  if (!input) return;
  createAutocomplete(
    input,
    (q) => buildItemSupplierMatchList(line?.itemId || null, q),
    (id) => {
      const s = getSuppliers().find((x) => x.id === id);
      if (!s) return;
      input.value = s.name;
      input.dataset.supplierId = s.id;
      onPick?.(s);
    },
    { showOnFocus: true }
  );

  const wrap = input.closest('.supplier-ac') || input.parentElement;
  const dropdown = wrap?.querySelector('.autocomplete-dropdown');
  if (!dropdown) return;

  const placeDropdown = () => {
    if (dropdown.classList.contains('hidden')) return;
    const rect = input.getBoundingClientRect();
    dropdown.classList.add('autocomplete-dropdown--fixed');
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 2}px`;
    dropdown.style.width = `${Math.max(rect.width, 220)}px`;
    dropdown.style.minWidth = `${rect.width}px`;
  };

  input.addEventListener('focus', () => requestAnimationFrame(placeDropdown));
  input.addEventListener('input', () => requestAnimationFrame(placeDropdown));
  window.addEventListener('scroll', placeDropdown, true);
  window.addEventListener('resize', placeDropdown);
}

function bindPlan(root, week, editable, rerender) {
  root.querySelectorAll('[data-add-location]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editingLineId = null;
      openAddLocationChooser(week, {
        onPinned: (locKey) => {
          if (locKey) {
            const map = loadCollapsed();
            map[locKey] = false;
            saveCollapsed(map);
            saveLastOpenLoc(locKey);
          }
          rerender();
        },
      });
    });
  });

  root.querySelectorAll('[data-download-loc]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = btn.dataset.downloadLoc;
      const groups = buildLocationGroups(week);
      const group = groups.find((g) => g.key === key);
      if (!group) return;
      btn.disabled = true;
      try {
        await downloadLocationBudgetPng(week, group);
        toast(`Downloaded ${group.label} budget`);
      } catch (err) {
        console.warn(err);
        toast('Could not download');
      } finally {
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll('[data-toggle-suggested]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSuggestedExpand(btn.dataset.toggleSuggested);
      rerender();
    });
  });

  root.querySelectorAll('[data-show-all-suggested]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showAllSuggested(btn.dataset.showAllSuggested);
      rerender();
    });
  });

  root.querySelectorAll('[data-collapse]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      // Only ignore real controls \u2014 not the whole forecast strip (it was swallowing collapse clicks).
      if (e.target.closest('button, input, select, a, label')) return;
      const key = el.dataset.collapse;
      const groupLines = week.lines.filter((l) => l.location === key);
      const wasCollapsed = isGroupCollapsed(key, groupLines.some((l) => l.onPlan));
      toggleCollapsed(key, groupLines.some((l) => l.onPlan));
      rerender();
      if (wasCollapsed && CORE_BRANCHES.includes(key) && !isBranchFeedLoaded(key)) {
        try {
          await ensureBranchLoaded(key);
          rerender();
        } catch (err) {
          console.error(err);
          toast(`Could not load ${key}`);
        }
      }
    });
  });

  root.querySelectorAll('[data-add-loc]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editingLineId = null;
      const loc = btn.dataset.addLoc;
      const map = loadCollapsed();
      map[loc] = false;
      saveCollapsed(map);
      openAddLineModal(week, loc, { onSaved: rerender });
    });
  });

  root.querySelectorAll('tr[data-line]').forEach((tr) => {
    const lineId = tr.dataset.line;
    const line = week.lines.find((l) => l.id === lineId);
    const canEditRow =
      editable &&
      line &&
      fulfillmentStatus(line) === 'planned' &&
      !line.frozen &&
      line.onPlan;

    if (canEditRow) {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('input, button, select, .autocomplete-dropdown, .autocomplete-item')) {
          return;
        }
        if (editingLineId === lineId) {
          openPlanLineModal(week, line, { onSaved: rerender });
          return;
        }
        editingLineId = lineId;
        justOpenedEdit = true;
        rerender();
      });
    }

    tr.querySelector('[data-include]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setLineOnPlan(week.id, lineId, e.currentTarget.dataset.include === '1');
      editingLineId = null;
      rerender();
    });

    tr.querySelector('[data-reset-qty]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (line?.suggestedQty == null) return;
      updateLine(week.id, lineId, {
        qty: line.suggestedQty,
        qtyEdited: false,
      });
      rerender();
    });

    tr.querySelector('[data-field="qty"]')?.addEventListener('change', (e) => {
      updateLine(week.id, lineId, { qty: Number(e.target.value) });
      rerender();
    });

    tr.querySelector('[data-field="cost"]')?.addEventListener('change', (e) => {
      const newTotal = Number(e.target.value);
      updateLine(
        week.id,
        lineId,
        {
          estimatedCost: newTotal,
          costSet: true,
          unitRate:
            line.qty > 0 ? newTotal / line.qty : line.unitRate,
        },
        { propagateRate: !!line.itemId, savePrefs: true }
      );
      rerender();
    });

    const supplierInput = tr.querySelector('[data-field="supplier"]');
    if (supplierInput) {
      bindSupplierAutocomplete(supplierInput, line);
      supplierInput.addEventListener('change', async () => {
        const supplier = await ensureSupplier(supplierInput.value, {
          supplierId: supplierInput.dataset.supplierId || null,
        });
        const patch = { supplierId: supplier.id, supplierName: supplier.name };
        if (line.itemId) {
          const rate = getSupplierRate(line.itemId, supplier.id);
          if (rate != null && rate > 0) patch.unitRate = rate;
        }
        updateLine(week.id, lineId, patch, { savePrefs: true });
        rerender();
      });
    }
  });

  if (justOpenedEdit) {
    justOpenedEdit = false;
    root.querySelector('tr.is-editing input[data-field="qty"]')?.focus();
  }

  bindOutside(week, editable, rerender);
}

function bindOutside(week, editable, rerender) {
  if (window.__purchasingOutside) {
    document.removeEventListener('pointerdown', window.__purchasingOutside);
  }
  window.__purchasingOutside = (e) => {
    if (!editingLineId) return;
    if (
      e.target.closest(
        'input, button, select, .loc-group-head, .step-tabs, .past-link, .week-picker-wrap, .modal, .modal-root, .autocomplete-dropdown'
      )
    ) {
      return;
    }

    const row = e.target.closest('tr[data-line]');
    if (row?.dataset.line === editingLineId) return;

    if (row?.dataset.line) {
      const line = week.lines.find((l) => l.id === row.dataset.line);
      const canEditRow =
        editable &&
        line &&
        fulfillmentStatus(line) === 'planned' &&
        !line.frozen &&
        line.onPlan;
      if (canEditRow) {
        editingLineId = line.id;
        justOpenedEdit = true;
        rerender();
        return;
      }
    }

    editingLineId = null;
    rerender();
  };
  document.addEventListener('pointerdown', window.__purchasingOutside);
}
