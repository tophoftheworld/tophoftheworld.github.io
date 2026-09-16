import {
  newId,
  INGREDIENT_ROLES,
  MATCHA_LEVEL_G,
  MILK_LINE_ID,
  EVENT_SERVICE_TYPES,
  tracksEventRevenue,
  eventServiceLabel,
  normalizeEventServiceType,
  normalizeNeedBufferPct,
} from './defaults.js?v=32';
import {
  formatNeed,
  formatNeedTotal,
  formatCups,
  formatMoney,
  totalColumnQty,
  totalCups,
  datesForWeek,
  formatDateCompact,
  formatWeekdayLong,
  weekStartFromPickedDate,
  needMatrixFromState,
  revenueMatrixFromState,
  menuMixRows,
  milkMixRows,
  milkPctSum,
  levelPctSum,
  mixPctSum,
  pctFromCups,
  weekMixCups,
  formatWeekRange,
  forecastSnapshotFilename,
} from './compute.js?v=32';
import { loadState, saveState, syncMilkMix, normalizeDrinkLines } from './store.js?v=32';
import { initSync, scheduleCloudSave, listEvents, switchEvent, createEvent, duplicateEvent } from './sync.js?v=32';

/** @typedef {import('./defaults.js').ForecastState} ForecastState */

const root = document.getElementById('app');

/** @type {ForecastState} */
let state = loadState();

/** @type {boolean} */
let menuModalOpen = false;

/** @type {boolean} */
let eventModalOpen = false;

/** @type {boolean} */
let bufferModalOpen = false;

/** @type {'list'|'rename'|'new'} */
let eventModalPanel = 'list';

/** @type {string|null} */
let pendingEventId = null;

/** @type {Array<{ id: string, name: string }>} */
let eventList = [];

/** @type {string} */
let syncStatus = 'saved';

/** @type {ReturnType<typeof setTimeout>|null} */
let modalPersistTimer = null;

/**
 * @param {'catalog'|'event'|'both'} [scope]
 */
function persist(scope = 'event') {
  saveState(state);
  scheduleCloudSave(state, scope);
}

function initShell() {
  const embedded = window.self !== window.top;
  document.body.classList.toggle('embedded', embedded);
  const chrome = document.getElementById('appChrome');
  if (chrome) chrome.hidden = embedded;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function needHtml(qty, ing, isTotalColumn = false) {
  const bufferPct = state.needBufferPct || 0;
  const q = isTotalColumn ? totalColumnQty(qty, bufferPct) : qty;
  const { primary, pack } = isTotalColumn ? formatNeedTotal(q, ing) : formatNeed(q, ing);
  return `
    <span class="need-stack">
      <span class="need-primary">${escapeHtml(primary)}</span>
      ${pack ? `<span class="need-pack">${escapeHtml(pack)}</span>` : ''}
    </span>`;
}

function weekTotalQty(qty) {
  return totalColumnQty(qty, state.needBufferPct || 0);
}

function formatTotalCell(n) {
  return formatCups(weekTotalQty(n));
}

function totalColumnLabel() {
  const pct = state.needBufferPct || 0;
  if (pct > 0) return `Buffered total [${pct}%]`;
  return 'Total';
}

function parseView() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  return hash === 'settings' || hash === 'recipe' ? 'settings' : 'forecast';
}

function setView(view) {
  menuModalOpen = false;
  eventModalOpen = false;
  bufferModalOpen = false;
  eventModalPanel = 'list';
  location.hash = view === 'settings' ? '#/settings' : '#/';
}

function formatNumberLocal(n) {
  const x = Number(n) || 0;
  if (Number.isInteger(x)) return String(x);
  return String(Math.round(x * 100) / 100);
}

function syncStatusLabel() {
  if (syncStatus === 'saving') return 'Saving…';
  if (syncStatus === 'offline') return 'Local only';
  if (syncStatus === 'error') return 'Sync error';
  return '';
}

function syncStatusTitle() {
  if (syncStatus === 'offline') {
    return 'Could not reach Firebase — forecast is saved in this browser only';
  }
  if (syncStatus === 'error') return 'Cloud sync failed — changes are still saved locally';
  if (syncStatus === 'saving') return 'Saving to Firebase…';
  return '';
}

function renderSyncStatus() {
  const label = syncStatusLabel();
  return `<span class="sync-status sync-status--${escapeHtml(syncStatus)}" id="syncStatus" title="${escapeHtml(syncStatusTitle())}" ${label ? '' : 'hidden'}>${escapeHtml(label || '')}</span>`;
}

function scheduleModalPersist() {
  if (modalPersistTimer) clearTimeout(modalPersistTimer);
  modalPersistTimer = setTimeout(() => {
    modalPersistTimer = null;
    persist('event');
  }, 600);
}

function eventDisplayName() {
  const name = state.eventName?.trim();
  if (name) return name;
  if (state.eventId && state.eventId !== 'default') return state.eventId;
  return 'Untitled event';
}

function flushModalPersist() {
  if (!modalPersistTimer) return;
  clearTimeout(modalPersistTimer);
  modalPersistTimer = null;
  persist('event');
}

function renderSnapshotCard(state) {
  const matrix = needMatrixFromState(state);
  const revenue = revenueMatrixFromState(state);
  const bufferPct = state.needBufferPct || 0;
  const week = formatWeekRange(state.weekStart);
  const showRevenue = tracksEventRevenue(state.eventServiceType);
  const totalLabel = bufferPct > 0 ? `Buffered total [${bufferPct}%]` : 'Week total';

  /** @type {{ label: string, value: string }[]} */
  const rows = [
    {
      label: 'Target cups',
      value: formatCups(totalColumnQty(matrix.totalCups, bufferPct)),
    },
  ];
  if (showRevenue) {
    rows.push({
      label: 'Est. revenue',
      value: formatMoney(totalColumnQty(revenue.total, bufferPct)),
    });
  }
  for (const row of matrix.rows) {
    const qty = totalColumnQty(row.total, bufferPct);
    const { primary, pack } = formatNeedTotal(qty, row.ingredient);
    rows.push({
      label: row.ingredient.name,
      value: pack ? `${primary} (${pack})` : primary,
    });
  }

  const meta = [
    eventServiceLabel(state.eventServiceType),
    week ? `Week ${week}` : '',
    bufferPct > 0 ? `Buffer ${bufferPct}%` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return `
    <div class="snapshot-card">
      <div class="snapshot-card-head">
        <h2 class="snapshot-title">${escapeHtml(eventDisplayName())}</h2>
        ${meta ? `<p class="snapshot-meta">${escapeHtml(meta)}</p>` : ''}
      </div>
      <p class="snapshot-section-label">${escapeHtml(totalLabel)}</p>
      <table class="snapshot-table">
        <tbody>
          ${rows
            .map(
              (row) => `
          <tr>
            <th scope="row">${escapeHtml(row.label)}</th>
            <td>${escapeHtml(row.value)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="snapshot-foot">Generated ${escapeHtml(generatedAt)}</p>
    </div>`;
}

async function downloadSnapshot() {
  const btn = root.querySelector('#downloadSnapshotBtn');
  if (typeof html2canvas === 'undefined') {
    alert('Snapshot capture failed to load. Please refresh and try again.');
    return;
  }

  const origText = btn?.textContent;
  if (btn) {
    btn.textContent = 'Generating…';
    btn.disabled = true;
  }

  const host = document.createElement('div');
  host.className = 'snapshot-capture-host';
  host.innerHTML = renderSnapshotCard(state);
  document.body.appendChild(host);

  try {
    const card = host.querySelector('.snapshot-card');
    if (!card) throw new Error('Snapshot card missing');
    const canvas = await html2canvas(card, {
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
    });
    const link = document.createElement('a');
    link.download = forecastSnapshotFilename(state);
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Snapshot failed:', err);
    alert('Failed to generate snapshot. Please try again.');
  } finally {
    host.remove();
    if (btn) {
      btn.textContent = origText || 'Download snapshot';
      btn.disabled = false;
    }
  }
}

function render() {
  if (!root) return;
  const view = parseView();
  root.innerHTML =
    view === 'settings'
      ? `
    <div class="topbar">
      <button type="button" class="back-btn" data-nav="forecast">
        <span class="back-arrow" aria-hidden="true">←</span> Back
      </button>
      ${renderSyncStatus()}
    </div>
    ${renderSettings()}`
      : `
    <div class="topbar">
      <div class="event-headline">
        <div class="event-title-block">
          <h1 class="event-name">${escapeHtml(eventDisplayName())}</h1>
          <span class="event-service-tag">${escapeHtml(eventServiceLabel(state.eventServiceType))}</span>
        </div>
        <button type="button" class="btn secondary btn-sm" id="manageEventsBtn">Change event</button>
      </div>
      <div class="topbar-actions">
        ${renderSyncStatus()}
        <button type="button" class="btn secondary btn-sm" id="downloadSnapshotBtn" title="Download summary image">Download snapshot</button>
        <button type="button" class="btn secondary btn-sm settings-btn" data-nav="settings">Settings</button>
      </div>
    </div>
    ${renderForecast()}
    ${eventModalOpen ? renderEventModal() : ''}
    ${menuModalOpen ? renderMenuModal() : ''}
    ${bufferModalOpen ? renderBufferModal() : ''}`;
  bind(view);
}

function renderForecast() {
  const cupsSum = totalCups(state.days);
  const weekDates = datesForWeek(state.weekStart);
  const weekInputValue = state.weekStart || '';
  const matrix = needMatrixFromState(state);
  const revenue = revenueMatrixFromState(state);
  const mixRows = menuMixRows(state);
  const milkRows = milkMixRows(state);
  const milkTotal = milkPctSum(milkRows);
  const levelTotal = levelPctSum(state.levelMix);
  const pctSum = mixPctSum(state);
  const mixOver = pctSum > 100;
  const mixCupsSum = mixRows.reduce((s, r) => s + r.cups, 0);
  const showRevenue = tracksEventRevenue(state.eventServiceType);

  const dayHeaders = state.days
    .map((d) => {
      const on = d.enabled ? 'is-on' : 'is-off';
      const date = weekDates ? weekDates[d.id] : null;
      const dateLine = date ? formatDateCompact(date) : '';
      const nameLine = date ? formatWeekdayLong(date) : d.label;
      return `
        <th class="col-day day-head-cell ${on}" scope="col">
          <button
            type="button"
            class="day-cell-btn"
            data-toggle-day="${escapeHtml(d.id)}"
            aria-pressed="${d.enabled}"
            title="${d.enabled ? 'Exclude day' : 'Include day'}"
          >
            ${dateLine ? `<span class="day-date">${escapeHtml(dateLine)}</span>` : ''}
            <span class="day-name">${escapeHtml(nameLine)}</span>
          </button>
        </th>`;
    })
    .join('');

  const cupsCells = state.days
    .map((d) => {
      const off = d.enabled ? '' : ' day-off';
      if (!d.enabled) {
        return `<td class="num col-day${off}"><span class="need-stack is-muted"><span class="need-primary">—</span></span></td>`;
      }
      const val = d.cups ? String(d.cups) : '';
      return `
        <td class="num col-day${off}">
          <input
            class="cups-input"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            data-cups="${escapeHtml(d.id)}"
            value="${val}"
            placeholder="0"
            aria-label="Target cups ${escapeHtml(d.label)}"
          />
        </td>`;
    })
    .join('');

  const revenueCells = state.days
    .map((d) => {
      const off = d.enabled ? '' : ' day-off';
      if (!d.enabled) {
        return `<td class="num col-day${off}" data-revenue-day="${escapeHtml(d.id)}"><span class="need-stack is-muted"><span class="need-primary">—</span></span></td>`;
      }
      const idx = revenue.days.findIndex((x) => x.id === d.id);
      const amt = idx >= 0 ? revenue.byDay[idx] : 0;
      return `<td class="num col-day${off}" data-revenue-day="${escapeHtml(d.id)}">${escapeHtml(formatMoney(amt))}</td>`;
    })
    .join('');

  const needRows = matrix.rows
    .map((row) => {
      const cells = state.days
        .map((d) => {
          const off = d.enabled ? '' : ' day-off';
          if (!d.enabled) {
            return `<td class="num col-day${off}" data-need-day="${escapeHtml(d.id)}" data-need-ing="${escapeHtml(row.ingredient.id)}"><span class="need-stack is-muted"><span class="need-primary">—</span></span></td>`;
          }
          const idx = matrix.days.findIndex((x) => x.id === d.id);
          const qty = idx >= 0 ? row.byDay[idx] : 0;
          return `<td class="num col-day${off}" data-need-day="${escapeHtml(d.id)}" data-need-ing="${escapeHtml(row.ingredient.id)}">${needHtml(qty, row.ingredient)}</td>`;
        })
        .join('');
      return `
        <tr class="row-need" data-ing-need="${escapeHtml(row.ingredient.id)}">
          <td class="col-label">${escapeHtml(row.ingredient.name)}</td>
          ${cells}
          <td class="num col-total" data-need-total="${escapeHtml(row.ingredient.id)}">${needHtml(row.total, row.ingredient, true)}</td>
        </tr>`;
    })
    .join('');

  return `
    <div class="sheet-card">
      <div class="sheet-scroll">
        <table class="sheet" aria-label="Supply forecast">
          <thead>
            <tr class="row-days">
              <th class="col-label week-pick-cell" scope="col" id="weekPickCell" title="Change week">
                <input id="weekStartInput" class="week-pick-input" type="date" value="${escapeHtml(weekInputValue)}" tabindex="-1" aria-hidden="true" />
              </th>
              ${dayHeaders}
              <th class="col-total" scope="col">
                <button type="button" class="total-head-btn" id="openBufferModal" title="Set safety buffer on totals">
                  ${escapeHtml(totalColumnLabel())}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr class="row-cups">
              <td class="col-label">
                Target cups
                <span class="row-label-sub">per day</span>
              </td>
              ${cupsCells}
              <td class="num col-total"><span class="total-cell" id="cupsTotal">${formatTotalCell(cupsSum)}</span></td>
            </tr>
            ${
              showRevenue
                ? `<tr class="row-revenue">
              <td class="col-label">
                Est. revenue
                <span class="row-label-sub">per day</span>
              </td>
              ${revenueCells}
              <td class="num col-total"><span class="total-cell" id="revenueTotal">${escapeHtml(formatMoney(weekTotalQty(revenue.total)))}</span></td>
            </tr>`
                : ''
            }
            ${needRows}
          </tbody>
        </table>
      </div>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Menu</h2>
        <div class="panel-head-actions">
          <button type="button" class="btn secondary btn-sm" id="openMenuModal">Manage</button>
        </div>
      </div>
      ${
        mixRows.length === 0
          ? `<p class="panel-empty">No drinks on the menu.</p>`
          : `
      <div class="menu-table-scroll">
        <table class="mini-table menu-table">
          <thead>
            <tr>
              <th>Drink</th>
              <th class="num">%</th>
              <th class="num">Cups</th>
              ${showRevenue ? '<th class="num">Est. revenue</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${mixRows
              .map((r) => {
                const cupsDisplay = r.cups ? formatNumberLocal(Math.round(r.cups * 10) / 10) : '';
                return `
            <tr data-menu-row="${escapeHtml(r.drink.id)}">
              <td>${escapeHtml(r.drink.name)}</td>
              <td class="num">
                <input type="number" min="0" step="1" class="pct-input" data-mix-pct="${escapeHtml(r.drink.id)}" value="${r.pct}" />
              </td>
              <td class="num">
                <input type="number" min="0" step="1" class="pct-input" data-mix-cups="${escapeHtml(r.drink.id)}" value="${cupsDisplay}" data-mix-cups-val="${escapeHtml(r.drink.id)}" />
              </td>
              ${showRevenue ? `<td class="num menu-readonly" data-menu-total="${escapeHtml(r.drink.id)}">${escapeHtml(formatMoney(r.totalRevenue))}</td>` : ''}
            </tr>`;
              })
              .join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td class="num ${mixOver ? 'is-error' : ''}" id="menuPctTotal">${formatNumberLocal(pctSum)}%</td>
              <td class="num" id="menuCupsTotal">${formatNumberLocal(Math.round(mixCupsSum * 10) / 10)}</td>
              ${showRevenue ? `<td class="num" id="menuRevTotal">${escapeHtml(formatMoney(mixRows.reduce((s, r) => s + r.totalRevenue, 0)))}</td>` : ''}
            </tr>
          </tfoot>
        </table>
      </div>`
      }
    </section>

    <div class="panel-row">
      <section class="panel">
        <h2 class="panel-title">Milk</h2>
        ${
          milkRows.length === 0
            ? `<p class="panel-empty">Add milk ingredients in Settings.</p>`
            : `
        <div class="factor-grid ${milkRows.length > 2 ? '' : ''}">
          ${milkRows
            .map(
              (r) => `
            <label class="factor-field">
              <span>${escapeHtml(r.ingredient.name)} %</span>
              <input type="number" min="0" max="100" step="1" data-milk-pct="${escapeHtml(r.ingredient.id)}" value="${r.pct}" />
            </label>`
            )
            .join('')}
        </div>
        <p class="panel-meta ${milkTotal > 100 ? 'is-error' : ''}" id="milkTotal">Total ${formatNumberLocal(milkTotal)}%</p>`
        }
      </section>

      <section class="panel">
        <h2 class="panel-title">Matcha level</h2>
        <div class="factor-grid three">
          <label class="factor-field">
            <span>L1 · ${MATCHA_LEVEL_G.l1}g %</span>
            <input type="number" min="0" max="100" step="1" data-level="l1" value="${state.levelMix.l1}" />
          </label>
          <label class="factor-field">
            <span>L2 · ${MATCHA_LEVEL_G.l2}g %</span>
            <input type="number" min="0" max="100" step="1" data-level="l2" value="${state.levelMix.l2}" />
          </label>
          <label class="factor-field">
            <span>L3 · ${MATCHA_LEVEL_G.l3}g %</span>
            <input type="number" min="0" max="100" step="1" data-level="l3" value="${state.levelMix.l3}" />
          </label>
        </div>
        <p class="panel-meta ${levelTotal > 100 ? 'is-error' : ''}" id="levelTotal">Total ${formatNumberLocal(levelTotal)}%</p>
      </section>
    </div>
  `;
}

function eventIconRename() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
}

function eventIconDuplicate() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}

function renderEventPickerActions(ev, showRename) {
  const renameBtn = showRename
    ? `<button type="button" class="event-icon-btn" data-event-panel="rename" title="Rename" aria-label="Rename">${eventIconRename()}</button>`
    : '';
  return `
    <div class="event-picker-actions">
      ${renameBtn}
      <button type="button" class="event-icon-btn" data-duplicate-event="${escapeHtml(ev.id)}" title="Duplicate" aria-label="Duplicate">${eventIconDuplicate()}</button>
    </div>`;
}

function renderEventListPanel() {
  if (eventList.length === 0) {
    return `<p class="panel-empty">No events yet. Create one below.</p>`;
  }
  const selectedId = pendingEventId ?? state.eventId;
  return `<div class="event-picker-list">
    ${eventList
      .map((ev) => {
        const selected = ev.id === selectedId;
        const label = ev.name || ev.id;
        return `
        <div class="event-picker-row${selected ? ' is-active' : ''}"${selected ? ' aria-current="true"' : ''}>
          <button
            type="button"
            class="event-picker-hit"
            data-pick-event="${escapeHtml(ev.id)}"
            aria-pressed="${selected}"
          >
            <span class="event-picker-dot${selected ? '' : ' event-picker-dot--off'}" aria-hidden="true"></span>
            <span class="event-picker-name">${escapeHtml(label)}</span>
          </button>
          ${renderEventPickerActions(ev, ev.id === state.eventId)}
        </div>`;
      })
      .join('')}
  </div>`;
}

function renderEventRenamePanel() {
  const currentName = state.eventName?.trim() || '';
  return `
    <button type="button" class="modal-back-link" data-event-panel="list">← Back</button>
    <label class="modal-field modal-field--spaced">
      <span>Event name</span>
      <input
        id="eventRenameInput"
        type="text"
        value="${escapeHtml(currentName)}"
        autocomplete="off"
        placeholder="Event name"
      />
    </label>
    <div class="modal-inline-actions">
      <button type="button" class="btn primary btn-sm" id="saveEventNameBtn">Save</button>
      <button type="button" class="btn secondary btn-sm" data-event-panel="list">Cancel</button>
    </div>`;
}

function renderEventNewPanel() {
  return `
    <button type="button" class="modal-back-link" data-event-panel="list">← Back</button>
    <p class="modal-hint">Starts with the same menu and recipes, but empty cup targets.</p>
    <label class="modal-field modal-field--spaced">
      <span>Event name</span>
      <input id="eventNewInput" type="text" value="" autocomplete="off" placeholder="e.g. Manila Matcha Fest" />
    </label>
    <div class="modal-inline-actions">
      <button type="button" class="btn primary btn-sm" id="createEventBtn">Create</button>
      <button type="button" class="btn secondary btn-sm" data-event-panel="list">Cancel</button>
    </div>`;
}

function renderEventModal() {
  const title =
    eventModalPanel === 'rename' ? 'Rename event' : eventModalPanel === 'new' ? 'New event' : 'Events';
  const body =
    eventModalPanel === 'rename'
      ? renderEventRenamePanel()
      : eventModalPanel === 'new'
        ? renderEventNewPanel()
        : `${renderEventListPanel()}
           <button type="button" class="event-new-link" data-event-panel="new">+ New event</button>`;
  return `
    <div class="modal-backdrop" id="eventModalBackdrop">
      <div class="modal modal--events" role="dialog" aria-modal="true" aria-labelledby="eventModalTitle">
        <div class="modal-head">
          <h2 id="eventModalTitle">${escapeHtml(title)}</h2>
          <button type="button" class="btn-x" id="closeEventModal" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body modal-body--events">
          ${body}
        </div>
        ${
          eventModalPanel === 'list'
            ? `<div class="modal-foot modal-foot--actions">
          <button type="button" class="btn secondary btn-sm" id="closeEventModalCancel">Cancel</button>
          <button type="button" class="btn primary btn-sm" id="closeEventModalDone">${escapeHtml(eventModalDoneLabel())}</button>
        </div>`
            : ''
        }
      </div>
    </div>`;
}

function renderMenuModal() {
  const mixMap = new Map((state.drinkMix || []).map((m) => [m.drinkId, m]));
  const addons = state.addonPrices || { oat: 0, l1: 0, l2: 0, l3: 0 };
  const showRevenue = tracksEventRevenue(state.eventServiceType);
  const addonField = (key, label) => {
    const val = Number(addons[key]) > 0 ? addons[key] : '';
    return `
      <label class="addon-price-field">
        <span>${label}</span>
        <input
          type="number"
          min="0"
          step="1"
          class="pct-input"
          data-modal-addon="${key}"
          value="${val}"
          placeholder="0"
        />
      </label>`;
  };
  const serviceTypeSection = `
    <section class="modal-section modal-section--service">
      <h3 class="modal-section-title">Event type</h3>
      <div class="service-type-list">
        ${EVENT_SERVICE_TYPES.map(
          (t) => `
        <label class="service-type-option">
          <input
            type="radio"
            name="eventServiceType"
            value="${escapeHtml(t.value)}"
            ${state.eventServiceType === t.value ? 'checked' : ''}
          />
          <span class="service-type-copy">
            <span class="service-type-label">${escapeHtml(t.label)}</span>
            <span class="service-type-hint">${escapeHtml(t.hint)}</span>
          </span>
        </label>`
        ).join('')}
      </div>
    </section>`;
  return `
    <div class="modal-backdrop" id="menuModalBackdrop">
      <div class="modal modal--menu" role="dialog" aria-modal="true" aria-labelledby="menuModalTitle">
        <div class="modal-head">
          <h2 id="menuModalTitle">${showRevenue ? 'Menu &amp; pricing' : 'Menu'}</h2>
          <button type="button" class="btn-x" id="closeMenuModal" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          ${serviceTypeSection}
          ${
            state.drinks.length === 0
              ? `<p class="panel-empty">Create drinks in Settings first.</p>`
              : `
          <div class="menu-modal-head${showRevenue ? '' : ' menu-modal-head--mix-only'}">
            <span>On menu</span>
            <span>Drink</span>
            ${showRevenue ? '<span class="num">Price</span>' : ''}
          </div>
          <div class="menu-modal-list${showRevenue ? '' : ' menu-modal-list--mix-only'}">
            ${state.drinks
              .map((drink) => {
                const on = state.menuDrinkIds.includes(drink.id);
                const entry = mixMap.get(drink.id);
                const price = entry && Number(entry.price) > 0 ? entry.price : '';
                return `
            <div class="menu-modal-row${showRevenue ? '' : ' menu-modal-row--mix-only'}">
              <label class="menu-check">
                <input type="checkbox" data-modal-menu="${escapeHtml(drink.id)}" ${on ? 'checked' : ''} />
              </label>
              <span class="menu-modal-name">${escapeHtml(drink.name)}</span>
              ${
                showRevenue
                  ? `<input
                type="text"
                inputmode="decimal"
                class="pct-input menu-modal-price"
                data-modal-price="${escapeHtml(drink.id)}"
                value="${price}"
                placeholder="0"
                ${on ? '' : 'disabled'}
                aria-label="Price for ${escapeHtml(drink.name)}"
              />`
                  : ''
              }
            </div>`;
              })
              .join('')}
          </div>`
          }
          ${
            showRevenue
              ? `<section class="modal-section modal-section--addons">
            <h3 class="modal-section-title">Add-on prices</h3>
            <p class="modal-hint">Extra per cup — uses your Milk % and Matcha level % on the forecast sheet.</p>
            <div class="addon-price-grid">
              ${addonField('oat', 'Oat milk')}
              ${addonField('l1', `Matcha L1 · ${MATCHA_LEVEL_G.l1}g`)}
              ${addonField('l2', `Matcha L2 · ${MATCHA_LEVEL_G.l2}g`)}
              ${addonField('l3', `Matcha L3 · ${MATCHA_LEVEL_G.l3}g`)}
            </div>
          </section>`
              : ''
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn primary btn-sm" id="closeMenuModalDone">Done</button>
        </div>
      </div>
    </div>`;
}

function renderBufferModal() {
  const pct = state.needBufferPct || 0;
  return `
    <div class="modal-backdrop" id="bufferModalBackdrop">
      <div class="modal modal--buffer" role="dialog" aria-modal="true" aria-labelledby="bufferModalTitle">
        <div class="modal-head">
          <h2 id="bufferModalTitle">Safety buffer</h2>
          <button type="button" class="btn-x" id="closeBufferModal" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="modal-hint">Add extra % to week totals for ordering.</p>
          <label class="modal-field modal-field--spaced">
            <span>Buffer %</span>
            <input
              id="bufferPctInput"
              class="modal-input"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              value="${pct > 0 ? pct : ''}"
              placeholder="0"
              autofocus
            />
          </label>
        </div>
        <div class="modal-foot modal-foot--actions">
          <button type="button" class="btn secondary btn-sm" id="clearBufferBtn">Clear</button>
          <button type="button" class="btn primary btn-sm" id="saveBufferBtn">Apply</button>
        </div>
      </div>
    </div>`;
}

function saveBufferFromInput() {
  const input = root.querySelector('#bufferPctInput');
  if (!input) return;
  const raw = input.value.trim();
  state.needBufferPct = raw === '' ? 0 : normalizeNeedBufferPct(Number(raw));
  bufferModalOpen = false;
  persist('event');
  render();
}

function bindBufferModal() {
  root.querySelector('#openBufferModal')?.addEventListener('click', () => {
    eventModalOpen = false;
    menuModalOpen = false;
    bufferModalOpen = true;
    render();
  });

  root.querySelector('#closeBufferModal')?.addEventListener('click', () => {
    bufferModalOpen = false;
    render();
  });

  root.querySelector('#bufferModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id !== 'bufferModalBackdrop') return;
    bufferModalOpen = false;
    render();
  });

  root.querySelector('#saveBufferBtn')?.addEventListener('click', saveBufferFromInput);

  root.querySelector('#clearBufferBtn')?.addEventListener('click', () => {
    state.needBufferPct = 0;
    bufferModalOpen = false;
    persist('event');
    render();
  });

  const input = root.querySelector('#bufferPctInput');
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveBufferFromInput();
    }
  });
  input?.focus();
  input?.select();
}

function renderSettings() {
  return `
    <section class="panel">
      <h2 class="panel-title">Ingredients</h2>
      <div class="recipe-scroll">
        <table class="recipe-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Unit</th>
              <th>Role</th>
              <th class="num">Pack size</th>
              <th>Pack</th>
              <th class="check-col">↑</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${state.ingredients
              .map(
                (ing) => `
              <tr data-ing-row="${escapeHtml(ing.id)}">
                <td><input type="text" data-ing-name="${escapeHtml(ing.id)}" value="${escapeHtml(ing.name)}" /></td>
                <td><input class="unit-input" type="text" data-ing-unit="${escapeHtml(ing.id)}" value="${escapeHtml(ing.unit)}" /></td>
                <td>
                  <select data-ing-role="${escapeHtml(ing.id)}">
                    ${INGREDIENT_ROLES.map(
                      (r) =>
                        `<option value="${escapeHtml(r.value)}" ${(ing.role || '') === r.value ? 'selected' : ''}>${escapeHtml(r.label)}</option>`
                    ).join('')}
                  </select>
                </td>
                <td class="num"><input type="number" min="0" step="any" data-ing-pack-size="${escapeHtml(ing.id)}" value="${ing.packSize || ''}" placeholder="—" /></td>
                <td><input class="pack-label-input" type="text" data-ing-pack-label="${escapeHtml(ing.id)}" value="${escapeHtml(ing.packLabel || '')}" placeholder="box" /></td>
                <td class="check-col">
                  <input type="checkbox" data-ing-pack-round="${escapeHtml(ing.id)}" ${ing.packRoundUp ? 'checked' : ''} ${ing.packSize > 0 ? '' : 'disabled'} title="Round up packs" />
                </td>
                <td><button type="button" class="btn-x" data-remove-ing="${escapeHtml(ing.id)}" ${state.ingredients.length <= 1 ? 'disabled' : ''}>&times;</button></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="recipe-actions">
        <button type="button" class="btn secondary btn-sm" id="addIngredient">+ Ingredient</button>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Drinks</h2>
      ${state.drinks
        .map(
          (drink) => `
        <div class="drink-card" data-drink="${escapeHtml(drink.id)}">
          <div class="drink-card-head">
            <input type="text" class="drink-name-input" data-drink-name="${escapeHtml(drink.id)}" value="${escapeHtml(drink.name)}" />
            <button type="button" class="btn secondary btn-sm" data-duplicate-drink="${escapeHtml(drink.id)}">Duplicate</button>
            <button type="button" class="btn-x" data-remove-drink="${escapeHtml(drink.id)}" ${state.drinks.length <= 1 ? 'disabled' : ''}>&times;</button>
          </div>
          <table class="recipe-table compact">
            <thead><tr><th>Ingredient</th><th class="num">Qty / cup</th><th></th></tr></thead>
            <tbody>
              ${drink.lines
                .map(
                  (line, idx) => `
                <tr>
                  <td>
                    <select data-drink-line-ing="${escapeHtml(drink.id)}" data-line-idx="${idx}">
                      ${recipeLineOptionsHtml(state, line.ingredientId)}
                    </select>
                  </td>
                  <td class="num">
                    <input type="number" min="0" step="any" data-drink-line-qty="${escapeHtml(drink.id)}" data-line-idx="${idx}" value="${line.qtyPerCup}" />
                  </td>
                  <td>
                    <button type="button" class="btn-x" data-remove-line="${escapeHtml(drink.id)}" data-line-idx="${idx}" ${drink.lines.length <= 1 ? 'disabled' : ''}>&times;</button>
                  </td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
          <button type="button" class="btn secondary btn-sm" data-add-line="${escapeHtml(drink.id)}">+ Line</button>
        </div>`
        )
        .join('')}
      <div class="recipe-actions">
        <button type="button" class="btn secondary btn-sm" id="addDrink">+ Drink</button>
      </div>
    </section>
  `;
}

function syncMenuMix() {
  const ids = state.menuDrinkIds;
  const existing = new Map(state.drinkMix.map((m) => [m.drinkId, m]));
  state.drinkMix = ids.map((id) => {
    const prev = existing.get(id);
    return {
      drinkId: id,
      pct: prev ? Number(prev.pct) || 0 : ids.length === 1 ? 100 : 0,
      cups: prev ? Number(prev.cups) || 0 : 0,
      price: prev ? Number(prev.price) || 0 : 0,
    };
  });
}

function recipeLineOptionsHtml(s, selectedId) {
  const opts = s.ingredients
    .filter((ing) => ing.role !== 'milk')
    .map(
      (ing) =>
        `<option value="${escapeHtml(ing.id)}" ${selectedId === ing.id ? 'selected' : ''}>${escapeHtml(ing.name)}</option>`
    );
  opts.push(
    `<option value="${MILK_LINE_ID}" ${selectedId === MILK_LINE_ID ? 'selected' : ''}>Milk</option>`
  );
  return opts.join('');
}

function defaultRecipeLineId() {
  const matcha = state.ingredients.find((i) => i.role === 'matcha');
  if (matcha) return matcha.id;
  const other = state.ingredients.find((i) => i.role !== 'milk');
  if (other) return other.id;
  return MILK_LINE_ID;
}

/** Prefer an ingredient not already on the drink so + Line stays a new row at the end. */
function nextRecipeLineId(drink) {
  const used = new Set((drink?.lines || []).map((l) => l.ingredientId));
  const unused = state.ingredients.find((i) => i.role !== 'milk' && !used.has(i.id));
  if (unused) return unused.id;
  if (!used.has(MILK_LINE_ID)) return MILK_LINE_ID;
  return defaultRecipeLineId();
}

function bind(view) {
  root.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      setView(el.getAttribute('data-nav'));
    });
  });

  if (view === 'settings') {
    bindSettings();
    return;
  }

  bindForecast();
}

function eventModalDoneLabel() {
  const selectedId = pendingEventId ?? state.eventId;
  return selectedId !== state.eventId ? 'Switch event' : 'Done';
}

function closeEventModal() {
  eventModalOpen = false;
  eventModalPanel = 'list';
  pendingEventId = null;
  render();
}

async function confirmEventModal() {
  const targetId = pendingEventId ?? state.eventId;
  if (targetId !== state.eventId) {
    state = await switchEvent(state, targetId);
    await refreshEventList();
  }
  closeEventModal();
}

function openEventPanel(panel) {
  if (panel !== 'list' && panel !== 'rename' && panel !== 'new') return;
  eventModalPanel = panel;
  render();
  requestAnimationFrame(() => {
    if (panel === 'rename') root.querySelector('#eventRenameInput')?.focus();
    if (panel === 'new') root.querySelector('#eventNewInput')?.focus();
  });
}

async function saveEventNameFromModal() {
  const input = root.querySelector('#eventRenameInput');
  const trimmed = input?.value?.trim();
  if (!trimmed || trimmed === state.eventName) return;
  state.eventName = trimmed;
  persist('event');
  await refreshEventList();
  eventModalPanel = 'list';
  render();
}

async function createEventFromModal() {
  const input = root.querySelector('#eventNewInput');
  const trimmed = input?.value?.trim() || 'New event';
  state = await createEvent(state, trimmed);
  await refreshEventList();
  eventModalOpen = false;
  render();
}

function bindEventModal() {
  if (!eventModalOpen) return;

  const close = () => closeEventModal();
  root.querySelector('#closeEventModal')?.addEventListener('click', close);
  root.querySelector('#closeEventModalCancel')?.addEventListener('click', close);
  root.querySelector('#closeEventModalDone')?.addEventListener('click', () => {
    confirmEventModal();
  });
  root.querySelector('#eventModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'eventModalBackdrop') close();
  });

  root.querySelectorAll('[data-event-panel]').forEach((el) => {
    el.addEventListener('click', () => {
      openEventPanel(el.getAttribute('data-event-panel'));
    });
  });

  root.querySelector('#saveEventNameBtn')?.addEventListener('click', () => {
    saveEventNameFromModal();
  });
  root.querySelector('#eventRenameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEventNameFromModal();
    }
  });

  root.querySelector('#createEventBtn')?.addEventListener('click', () => {
    createEventFromModal();
  });
  root.querySelector('#eventNewInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createEventFromModal();
    }
  });

  root.querySelectorAll('[data-pick-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-pick-event');
      if (!id) return;
      pendingEventId = id;
      render();
    });
  });

  root.querySelectorAll('[data-duplicate-event]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-duplicate-event');
      if (!id) return;
      const ev = eventList.find((item) => item.id === id);
      state = await duplicateEvent(state, id, ev?.name || '');
      await refreshEventList();
      pendingEventId = state.eventId;
      eventModalOpen = false;
      eventModalPanel = 'list';
      render();
    });
  });
}

function bindForecast() {
  root.querySelector('#downloadSnapshotBtn')?.addEventListener('click', downloadSnapshot);

  root.querySelector('#manageEventsBtn')?.addEventListener('click', () => {
    menuModalOpen = false;
    bufferModalOpen = false;
    eventModalPanel = 'list';
    pendingEventId = state.eventId;
    eventModalOpen = true;
    render();
  });

  bindEventModal();
  bindBufferModal();

  const weekInput = root.querySelector('#weekStartInput');
  const openWeekPicker = () => {
    if (!weekInput) return;
    try {
      if (typeof weekInput.showPicker === 'function') {
        weekInput.showPicker();
        return;
      }
    } catch {
      /* fall through */
    }
    weekInput.focus();
    weekInput.click();
  };

  root.querySelector('#weekPickCell')?.addEventListener('click', (e) => {
    if (e.target === weekInput) return;
    e.preventDefault();
    openWeekPicker();
  });

  weekInput?.addEventListener('change', (e) => {
    const raw = e.target.value;
    if (raw) state.weekStart = weekStartFromPickedDate(raw) || state.weekStart;
    persist('event');
    render();
  });

  root.querySelectorAll('[data-toggle-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-toggle-day');
      const day = state.days.find((d) => d.id === id);
      if (!day) return;
      day.enabled = !day.enabled;
      persist('event');
      render();
    });
  });

  root.querySelectorAll('[data-cups]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.getAttribute('data-cups');
      const day = state.days.find((d) => d.id === id);
      if (!day) return;
      const raw = input.value;
      const n = raw === '' ? 0 : Number(raw);
      day.cups = Number.isFinite(n) && n >= 0 ? n : 0;
      persist('event');
      refreshNeedLive();
    });
  });

  root.querySelector('#openMenuModal')?.addEventListener('click', () => {
    eventModalOpen = false;
    bufferModalOpen = false;
    menuModalOpen = true;
    render();
  });

  root.querySelector('#closeMenuModal')?.addEventListener('click', () => {
    flushModalPersist();
    menuModalOpen = false;
    render();
  });
  root.querySelector('#closeMenuModalDone')?.addEventListener('click', () => {
    flushModalPersist();
    menuModalOpen = false;
    render();
  });
  root.querySelector('#menuModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'menuModalBackdrop') {
      flushModalPersist();
      menuModalOpen = false;
      render();
    }
  });

  root.querySelectorAll('[name="eventServiceType"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.eventServiceType = normalizeEventServiceType(input.value);
      persist('event');
      render();
    });
  });

  root.querySelectorAll('[data-modal-menu]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.getAttribute('data-modal-menu');
      if (input.checked) {
        if (!state.menuDrinkIds.includes(id)) state.menuDrinkIds.push(id);
      } else {
        state.menuDrinkIds = state.menuDrinkIds.filter((x) => x !== id);
      }
      syncMenuMix();
      const priceInput = root.querySelector(`[data-modal-price="${CSS.escape(id)}"]`);
      if (priceInput) priceInput.disabled = !input.checked;
      scheduleModalPersist();
      refreshNeedLive();
      updateMenuTableLive();
    });
  });

  root.querySelectorAll('[data-modal-price]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.getAttribute('data-modal-price');
      const entry = state.drinkMix.find((m) => m.drinkId === id);
      if (!entry) return;
      const raw = input.value.trim();
      const n = raw === '' ? 0 : Number(raw);
      entry.price = Number.isFinite(n) && n >= 0 ? n : 0;
      refreshNeedLive();
      updateMenuTableLive();
      scheduleModalPersist();
    });
  });

  root.querySelectorAll('[data-modal-addon]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.getAttribute('data-modal-addon');
      if (!key || !state.addonPrices) return;
      const raw = input.value.trim();
      const n = raw === '' ? 0 : Number(raw);
      state.addonPrices[key] = Number.isFinite(n) && n >= 0 ? n : 0;
      refreshNeedLive();
      scheduleModalPersist();
    });
  });

  root.querySelectorAll('[data-mix-pct]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.getAttribute('data-mix-pct');
      const entry = state.drinkMix.find((m) => m.drinkId === id);
      const n = Number(input.value);
      const val = Number.isFinite(n) && n >= 0 ? n : 0;
      if (entry) entry.pct = val;
      persist('event');
      refreshNeedLive();
      updateMenuTableLive();
    });
  });

  root.querySelectorAll('[data-mix-cups]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.getAttribute('data-mix-cups');
      const entry = state.drinkMix.find((m) => m.drinkId === id);
      const n = Number(input.value);
      const val = Number.isFinite(n) && n >= 0 ? n : 0;
      if (!entry) return;
      const weekTotal = totalCups(state.days);
      const otherSum = state.drinkMix
        .filter((m) => m.drinkId !== id)
        .reduce((s, m) => s + weekMixCups(m.pct, weekTotal), 0);
      entry.pct = pctFromCups(val, weekTotal, otherSum + val);
      persist('event');
      refreshNeedLive();
      updateMenuTableLive();
    });
  });

  root.querySelectorAll('[data-milk-pct]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.getAttribute('data-milk-pct');
      const entry = state.milkMix.find((m) => m.ingredientId === id);
      const n = Number(input.value);
      if (entry) entry.pct = Number.isFinite(n) && n >= 0 ? n : 0;
      persist('event');
      refreshNeedLive();
      const el = root.querySelector('#milkTotal');
      if (el) {
        const t = milkPctSum(milkMixRows(state));
        el.textContent = `Total ${formatNumberLocal(t)}%`;
        el.classList.toggle('is-error', t > 100);
      }
    });
  });

  root.querySelectorAll('[data-level]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.getAttribute('data-level');
      const n = Number(input.value);
      if (key === 'l1' || key === 'l2' || key === 'l3') {
        state.levelMix[key] = Number.isFinite(n) && n >= 0 ? n : 0;
      }
      persist('event');
      refreshNeedLive();
      const el = root.querySelector('#levelTotal');
      if (el) {
        const t = levelPctSum(state.levelMix);
        el.textContent = `Total ${formatNumberLocal(t)}%`;
        el.classList.toggle('is-error', t > 100);
      }
    });
  });
}

function updateMenuTableLive() {
  const rows = menuMixRows(state);
  const pctSum = mixPctSum(state);
  const cupsSum = rows.reduce((s, r) => s + r.cups, 0);

  for (const r of rows) {
    const cupsInput = root.querySelector(`[data-mix-cups="${CSS.escape(r.drink.id)}"]`);
    if (cupsInput && document.activeElement !== cupsInput) {
      const cupsDisplay = r.cups ? formatNumberLocal(Math.round(r.cups * 10) / 10) : '';
      cupsInput.value = cupsDisplay;
    }
    const pctInput = root.querySelector(`[data-mix-pct="${CSS.escape(r.drink.id)}"]`);
    if (pctInput && document.activeElement !== pctInput) {
      pctInput.value = String(r.pct);
    }
    const totalEl = root.querySelector(`[data-menu-total="${CSS.escape(r.drink.id)}"]`);
    if (totalEl) totalEl.textContent = formatMoney(r.totalRevenue);
  }

  const pctEl = root.querySelector('#menuPctTotal');
  if (pctEl) {
    pctEl.textContent = `${formatNumberLocal(pctSum)}%`;
    pctEl.classList.toggle('is-error', pctSum > 100);
  }
  const cupsEl = root.querySelector('#menuCupsTotal');
  if (cupsEl) cupsEl.textContent = formatNumberLocal(Math.round(cupsSum * 10) / 10);
  const revTotalEl = root.querySelector('#menuRevTotal');
  if (revTotalEl) revTotalEl.textContent = formatMoney(rows.reduce((s, r) => s + r.totalRevenue, 0));
}

function refreshNeedLive() {
  const cupsEl = root.querySelector('#cupsTotal');
  if (cupsEl) cupsEl.textContent = formatTotalCell(totalCups(state.days));

  const revenue = revenueMatrixFromState(state);
  state.days.forEach((d) => {
    const cell = root.querySelector(`[data-revenue-day="${CSS.escape(d.id)}"]`);
    if (!cell) return;
    if (!d.enabled) {
      cell.innerHTML = `<span class="need-stack is-muted"><span class="need-primary">—</span></span>`;
      return;
    }
    const idx = revenue.days.findIndex((x) => x.id === d.id);
    const amt = idx >= 0 ? revenue.byDay[idx] : 0;
    cell.textContent = formatMoney(amt);
  });
  const revTotalEl = root.querySelector('#revenueTotal');
  if (revTotalEl) revTotalEl.textContent = formatMoney(weekTotalQty(revenue.total));

  const matrix = needMatrixFromState(state);
  for (const row of matrix.rows) {
    state.days.forEach((d) => {
      const cell = root.querySelector(
        `[data-need-day="${CSS.escape(d.id)}"][data-need-ing="${CSS.escape(row.ingredient.id)}"]`
      );
      if (!cell) return;
      if (!d.enabled) {
        cell.innerHTML = `<span class="need-stack is-muted"><span class="need-primary">—</span></span>`;
        return;
      }
      const idx = matrix.days.findIndex((x) => x.id === d.id);
      const qty = idx >= 0 ? row.byDay[idx] : 0;
      cell.innerHTML = needHtml(qty, row.ingredient);
    });
    const totalEl = root.querySelector(`[data-need-total="${CSS.escape(row.ingredient.id)}"]`);
    if (totalEl) totalEl.innerHTML = needHtml(row.total, row.ingredient, true);
  }

  updateMenuTableLive();

  const shown = [...root.querySelectorAll('[data-ing-need]')].map((el) => el.getAttribute('data-ing-need'));
  const next = matrix.rows.map((r) => r.ingredient.id);
  if (shown.length !== next.length || shown.some((id, i) => id !== next[i])) {
    render();
  }
}

function bindSettings() {
  const catalogPersist = () => persist('catalog');

  root.querySelectorAll('[data-ing-name]').forEach((input) => {
    input.addEventListener('input', () => {
      const ing = findIng(input.getAttribute('data-ing-name'));
      if (ing) {
        ing.name = input.value;
        catalogPersist();
      }
    });
  });

  root.querySelectorAll('[data-ing-unit]').forEach((input) => {
    input.addEventListener('input', () => {
      const ing = findIng(input.getAttribute('data-ing-unit'));
      if (ing) {
        ing.unit = input.value || 'g';
        catalogPersist();
      }
    });
  });

  root.querySelectorAll('[data-ing-role]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const ing = findIng(sel.getAttribute('data-ing-role'));
      if (!ing) return;
      const v = sel.value;
      ing.role = v === 'matcha' || v === 'milk' ? v : null;
      syncMilkMix(state);
      catalogPersist();
    });
  });

  root.querySelectorAll('[data-ing-pack-size]').forEach((input) => {
    input.addEventListener('input', () => {
      const ing = findIng(input.getAttribute('data-ing-pack-size'));
      if (!ing) return;
      const n = input.value === '' ? 0 : Number(input.value);
      ing.packSize = Number.isFinite(n) && n >= 0 ? n : 0;
      catalogPersist();
      const roundEl = root.querySelector(`[data-ing-pack-round="${CSS.escape(ing.id)}"]`);
      if (roundEl) roundEl.disabled = !(ing.packSize > 0);
    });
  });

  root.querySelectorAll('[data-ing-pack-label]').forEach((input) => {
    input.addEventListener('input', () => {
      const ing = findIng(input.getAttribute('data-ing-pack-label'));
      if (ing) {
        ing.packLabel = input.value;
        catalogPersist();
      }
    });
  });

  root.querySelectorAll('[data-ing-pack-round]').forEach((input) => {
    input.addEventListener('change', () => {
      const ing = findIng(input.getAttribute('data-ing-pack-round'));
      if (ing) {
        ing.packRoundUp = input.checked;
        catalogPersist();
      }
    });
  });

  root.querySelectorAll('[data-remove-ing]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.ingredients.length <= 1) return;
      const id = btn.getAttribute('data-remove-ing');
      state.ingredients = state.ingredients.filter((ing) => ing.id !== id);
      for (const drink of state.drinks) {
        drink.lines = drink.lines.filter((l) => l.ingredientId !== id);
        if (drink.lines.length === 0) {
          drink.lines = [{ ingredientId: defaultRecipeLineId(), qtyPerCup: 0 }];
        }
      }
      syncMilkMix(state);
      catalogPersist();
      render();
    });
  });

  root.querySelector('#addIngredient')?.addEventListener('click', () => {
    state.ingredients.push({
      id: newId(),
      name: 'New ingredient',
      unit: 'g',
      packSize: 0,
      packLabel: '',
      packRoundUp: false,
      role: null,
    });
    syncMilkMix(state);
    catalogPersist();
    render();
  });

  root.querySelectorAll('[data-drink-name]').forEach((input) => {
    input.addEventListener('input', () => {
      const drink = findDrink(input.getAttribute('data-drink-name'));
      if (drink) {
        drink.name = input.value;
        catalogPersist();
      }
    });
  });

  root.querySelectorAll('[data-drink-line-ing]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const drink = findDrink(sel.getAttribute('data-drink-line-ing'));
      const idx = Number(sel.getAttribute('data-line-idx'));
      if (!drink?.lines[idx]) return;
      drink.lines[idx].ingredientId = sel.value;
      const before = drink.lines.slice();
      drink.lines = normalizeDrinkLines(drink.lines, state.ingredients);
      catalogPersist();
      const reordered =
        drink.lines.length !== before.length ||
        drink.lines.some((line, i) => line.ingredientId !== before[i]?.ingredientId);
      if (reordered) render();
    });
  });

  root.querySelectorAll('[data-drink-line-qty]').forEach((input) => {
    input.addEventListener('input', () => {
      const drink = findDrink(input.getAttribute('data-drink-line-qty'));
      const idx = Number(input.getAttribute('data-line-idx'));
      if (drink?.lines[idx]) {
        const n = Number(input.value);
        drink.lines[idx].qtyPerCup = Number.isFinite(n) && n >= 0 ? n : 0;
        catalogPersist();
      }
    });
  });

  root.querySelectorAll('[data-add-line]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const drink = findDrink(btn.getAttribute('data-add-line'));
      if (!drink) return;
      drink.lines.push({ ingredientId: nextRecipeLineId(drink), qtyPerCup: 0 });
      catalogPersist();
      render();
    });
  });

  root.querySelectorAll('[data-remove-line]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const drink = findDrink(btn.getAttribute('data-remove-line'));
      const idx = Number(btn.getAttribute('data-line-idx'));
      if (!drink || drink.lines.length <= 1) return;
      drink.lines.splice(idx, 1);
      catalogPersist();
      render();
    });
  });

  root.querySelectorAll('[data-duplicate-drink]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const drink = findDrink(btn.getAttribute('data-duplicate-drink'));
      if (!drink) return;
      state.drinks.push({
        id: newId(),
        name: `${drink.name} copy`,
        lines: drink.lines.map((l) => ({ ...l })),
      });
      catalogPersist();
      render();
    });
  });

  root.querySelectorAll('[data-remove-drink]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.drinks.length <= 1) return;
      const id = btn.getAttribute('data-remove-drink');
      state.drinks = state.drinks.filter((d) => d.id !== id);
      state.menuDrinkIds = state.menuDrinkIds.filter((x) => x !== id);
      if (state.menuDrinkIds.length === 0 && state.drinks[0]) {
        state.menuDrinkIds = [state.drinks[0].id];
      }
      syncMenuMix();
      catalogPersist();
      render();
    });
  });

  root.querySelector('#addDrink')?.addEventListener('click', () => {
    const id = newId();
    state.drinks.push({
      id,
      name: 'New drink',
      lines: [
        { ingredientId: defaultRecipeLineId(), qtyPerCup: 0 },
        { ingredientId: MILK_LINE_ID, qtyPerCup: 0 },
      ],
    });
    catalogPersist();
    render();
  });
}

function findIng(id) {
  return state.ingredients.find((ing) => ing.id === id);
}

function findDrink(id) {
  return state.drinks.find((d) => d.id === id);
}

async function refreshEventList() {
  eventList = await listEvents();
  if (!eventList.some((e) => e.id === state.eventId)) {
    eventList.unshift({ id: state.eventId, name: state.eventName || state.eventId });
  }
}

function updateSyncStatus(status) {
  syncStatus = status;
  const el = root.querySelector('#syncStatus');
  if (!el) return;
  const label = syncStatusLabel();
  el.hidden = !label;
  el.textContent = label;
  el.title = syncStatusTitle();
  el.className = `sync-status sync-status--${status}`;
}

async function boot() {
  initShell();
  window.addEventListener('hashchange', render);
  await refreshEventList();
  render();
  await initSync(
    (remote) => {
      state = remote;
      refreshEventList().then(() => {
        if (menuModalOpen || eventModalOpen) {
          refreshNeedLive();
          updateMenuTableLive();
          return;
        }
        render();
      });
    },
    (status) => updateSyncStatus(status)
  );
}

boot();
