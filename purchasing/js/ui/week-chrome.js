import { THIS_WEEK_ID } from '../data/seed.js?v=96';
import { getThisWeek, pastWeeks, isThisWeek } from '../store.js?v=96';
import { weekTotal } from '../compute.js?v=96';
import {
  formatDateRange,
  formatDateShort,
  formatPeso,
  escapeHtml,
  statusLabel,
  resolveWeekLastEdit,
  formatLastEditLabel,
} from '../format.js?v=96';

function todayKeyLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekStatusText(week) {
  if (week.status === 'settled') return 'Settled';
  if (!isThisWeek(week) || week.archived) return 'Unfinished';
  if (week.status === 'ordered') return 'Ordering';
  if (pastWeeks().some((w) => w.status !== 'settled')) {
    return 'Open \u00B7 last week unfinished';
  }
  return 'Open';
}

/** One header note for Monday stock (forecast vs counted) \u2014 not per-row icons. */
function stockAsOfNote(week) {
  const monday = week?.weekStart || week?.liveMeta?.asOfKey || null;
  if (!monday) return '';
  const dateLabel = formatDateShort(monday);
  const today = todayKeyLocal();
  const modes = (week.lines || [])
    .map((l) => l.stockMode)
    .filter((m) => m === 'forecast' || m === 'actual');
  let forecasted = today < monday;
  if (modes.length) {
    forecasted = modes.every((m) => m === 'forecast');
  }
  return forecasted
    ? `Stock forecasted for ${dateLabel}`
    : `Stock as of ${dateLabel}`;
}

export function weekHref(weekId, tab) {
  const isCurrent = !weekId || weekId === THIS_WEEK_ID;
  if (tab === 'plan') return isCurrent ? '#/' : `#/week/${weekId}`;
  return isCurrent ? `#/${tab}` : `#/week/${weekId}/${tab}`;
}

function weekPickerOptions(currentWeek) {
  const options = [];
  const thisWeek = getThisWeek();
  if (thisWeek) options.push(thisWeek);
  else if (currentWeek) options.push(currentWeek);
  for (const w of pastWeeks()) {
    if (!options.some((o) => o.id === w.id)) options.push(w);
  }
  if (currentWeek && !options.some((w) => w.id === currentWeek.id)) {
    options.unshift(currentWeek);
  }
  return options;
}

function renderWeekPicker(week, tab) {
  const options = weekPickerOptions(week);

  return `
    <div class="week-picker-wrap">
      <h1 class="week-picker-heading">
        <button type="button" class="week-picker-btn" data-week-toggle aria-haspopup="listbox" aria-expanded="false">
          <span>Week of ${formatDateRange(week.weekStart, week.weekEnd)}</span>
          <span class="week-picker-caret" aria-hidden="true"></span>
        </button>
      </h1>
      <div class="week-menu" role="listbox">
        ${options
          .map((w) => {
            const current = w.id === week.id;
            const suffix = isThisWeek(w) ? ' \u00B7 This week' : '';
            const openTag =
              !isThisWeek(w) && w.status !== 'settled' ? ' \u00B7 Unfinished' : '';
            return `<a class="week-option ${current ? 'is-current' : ''}" href="${weekHref(w.id, tab)}" role="option" aria-selected="${current}">
              <span class="week-option-dates">${escapeHtml(formatDateRange(w.weekStart, w.weekEnd))}${suffix}${openTag}</span>
              <span class="week-option-meta">${escapeHtml(statusLabel(w.status))} \u00B7 ${formatPeso(weekTotal(w))}</span>
            </a>`;
          })
          .join('')}
        <div class="week-menu-footer">
          <a class="week-menu-all" href="#/past">All weeks</a>
        </div>
      </div>
    </div>`;
}

export function renderWeekChrome(week, { tab } = {}) {
  const total = weekTotal(week);
  const status = weekStatusText(week);
  const stockNote = stockAsOfNote(week);
  const statusLine = stockNote ? `${status} \u00B7 ${stockNote}` : status;
  const lastEdit = formatLastEditLabel(resolveWeekLastEdit(week));

  const tabs = [
    { key: 'plan', label: 'Budget', step: '1' },
    { key: 'orders', label: 'Order', step: '2' },
    { key: 'spent', label: 'Reconcile', step: '3' },
  ];

  return `
    <div class="step-bar">
      <nav class="step-tabs" aria-label="Purchasing steps">
        ${tabs
          .map(
            (t) =>
              `<a class="step-tab ${t.key === tab ? 'active' : ''}" href="${weekHref(week.id, t.key)}"><span class="step-num">${t.step}</span> ${escapeHtml(t.label)}</a>`
          )
          .join('')}
      </nav>
    </div>

    <header class="week-head">
      <div class="week-head-row">
        <div class="week-head-main">
          ${renderWeekPicker(week, tab)}
          <p class="week-status">${escapeHtml(statusLine)}</p>
          ${
            lastEdit
              ? `<p class="week-last-edit" title="${escapeHtml(lastEdit)}">${escapeHtml(lastEdit)}</p>`
              : ''
          }
        </div>
        <div class="week-total" title="Total budget">
          <span class="week-total-label">Total budget</span>
          <strong class="week-total-amount">${formatPeso(total)}</strong>
        </div>
      </div>
    </header>
  `;
}

function bindWeekPicker(root) {
  const closeAll = () => {
    root.querySelectorAll('.week-picker-wrap.is-open').forEach((wrap) => {
      wrap.classList.remove('is-open');
      wrap.querySelector('[data-week-toggle]')?.setAttribute('aria-expanded', 'false');
    });
  };

  root.querySelectorAll('[data-week-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btn.closest('.week-picker-wrap');
      const open = wrap.classList.contains('is-open');
      closeAll();
      if (!open) {
        wrap.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  if (window.__purchasingWeekPicker) {
    document.removeEventListener('pointerdown', window.__purchasingWeekPicker);
  }
  window.__purchasingWeekPicker = (e) => {
    if (e.target.closest('.week-picker-wrap')) return;
    closeAll();
  };
  document.addEventListener('pointerdown', window.__purchasingWeekPicker);
}

export function bindWeekChrome(root) {
  bindWeekPicker(root);
}
