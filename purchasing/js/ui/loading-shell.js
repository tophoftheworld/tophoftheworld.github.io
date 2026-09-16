import { STORE_LOCATIONS } from '../data/catalog.js?v=96';
import { THIS_WEEK_ID } from '../data/seed.js?v=96';
import { planWeekStart, addDays, getDateKey } from '../../../inventory/js/shared/forecast.js?v=105';
import { renderWeekChrome, bindWeekChrome } from './week-chrome.js?v=96';

function placeholderWeek() {
  const weekStart = planWeekStart(new Date());
  const weekEnd = addDays(weekStart, 6);
  return {
    id: THIS_WEEK_ID,
    weekStart: getDateKey(weekStart),
    weekEnd: getDateKey(weekEnd),
    status: 'draft',
    lines: [],
  };
}

function loadingBody(tab) {
  if (tab === 'past') {
    return `<p class="app-loading-inline">Loading weeks\u2026</p>`;
  }

  if (tab === 'plan') {
    return `
      <div class="plan-toolbar plan-toolbar--loading" aria-hidden="true"></div>
      <div class="plan-groups plan-groups--loading">
        ${STORE_LOCATIONS.map(
          (loc) => `
          <section class="loc-group loc-group--skeleton" aria-hidden="true">
            <header class="loc-group-head">
              <div class="loc-group-title">
                <span class="group-chevron">\u25BE</span>
                <div class="loc-name-block"><h2>${loc.label}</h2></div>
              </div>
              <strong class="loc-total loc-total--skeleton">\u2014</strong>
            </header>
          </section>`
        ).join('')}
      </div>
      <p class="app-loading-inline" role="status">Loading inventory order data\u2026</p>`;
  }

  return `<p class="app-loading-inline" role="status">Loading inventory order data\u2026</p>`;
}

/** Shell chrome + skeleton while Firebase / Order View data loads. */
export function renderLoadingShell(root, { tab = 'plan' } = {}) {
  if (!root) return;

  if (tab === 'past') {
    root.innerHTML = loadingBody(tab);
    return;
  }

  const week = placeholderWeek();
  const chromeTab = tab === 'summary' ? 'plan' : tab;
  root.innerHTML = `${renderWeekChrome(week, { tab: chromeTab })}${loadingBody(tab)}`;
  bindWeekChrome(root);
}
