import { loadCatalog } from './data/catalog.js?v=97';
import {
  loadStateFromOrderView,
  tryHydrateFromLocalCache,
  subscribe,
  getState,
  getWeek,
  flushPersist,
  startLiveOverlaySync,
  isOverlayDirty,
} from './store.js?v=97';
import { THIS_WEEK_ID } from './data/seed.js?v=97';
import { loadSuppliers } from './data/suppliers.js?v=97';
import { loadItemPrefs } from './data/item-prefs.js?v=97';
import { loadCustomItems } from './data/custom-items.js?v=97';
import {
  saveLastRoute,
  restoreHashFromLastRoute,
  routeToHash,
} from './data/last-route.js?v=97';
import { renderPlan } from './ui/plan.js?v=97';
import { renderOrders } from './ui/orders.js?v=97';
import { renderSpent } from './ui/spent.js?v=97';
import { renderPastWeeks } from './ui/past-weeks.js?v=97';
import { initShell } from './ui/shell.js?v=97';
import { renderLoadingShell } from './ui/loading-shell.js?v=97';

const root = document.getElementById('app');
let renderQueued = false;
/** Skip hashchange while we rewrite a missing-week URL (avoids re-entrant Week not found). */
let suppressingHashChange = false;

function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);

  if (parts[0] === 'past') return { tab: 'past', weekId: null };
  if (parts[0] === 'week' && parts[1]) {
    const tab = parts[2] || 'plan';
    // Legacy #/week/.../summary → Budget
    return { tab: tab === 'summary' ? 'plan' : tab, weekId: parts[1] };
  }
  if (['orders', 'spent'].includes(parts[0])) {
    return { tab: parts[0], weekId: THIS_WEEK_ID };
  }
  // Legacy #/summary → Budget
  if (parts[0] === 'summary') {
    return { tab: 'plan', weekId: THIS_WEEK_ID };
  }
  return { tab: 'plan', weekId: THIS_WEEK_ID };
}

function setHashQuietly(target) {
  const next = target.startsWith('#') ? target : `#${target}`;
  const current = location.hash || '';
  const currentNorm = current || '#/';
  const nextNorm = next || '#/';
  if (currentNorm === nextNorm) return;
  suppressingHashChange = true;
  try {
    location.replace(next);
  } finally {
    // Hashchange is sync in modern browsers; clear on next task as a safety net.
    queueMicrotask(() => {
      suppressingHashChange = false;
    });
  }
}

/** If hash points at a week we don't have, fall back to live week. */
function ensureRouteWeekExists() {
  const route = parseRoute();
  if (route.tab === 'past' || !route.weekId) return route;

  if (getWeek(route.weekId)) return route;

  const tab = route.tab || 'plan';
  // Prefer live week; if even that is missing, keep the id and let render show loading.
  if (getWeek(THIS_WEEK_ID)) {
    setHashQuietly(routeToHash(THIS_WEEK_ID, tab));
    saveLastRoute(THIS_WEEK_ID, tab);
    return { tab, weekId: THIS_WEEK_ID };
  }

  setHashQuietly(routeToHash(THIS_WEEK_ID, tab));
  return { tab, weekId: THIS_WEEK_ID };
}

function render() {
  if (!root) return;
  if (!getState()) {
    renderLoadingShell(root, { tab: parseRoute().tab });
    return;
  }

  const route = ensureRouteWeekExists();

  if (route.tab === 'past') {
    saveLastRoute(THIS_WEEK_ID, 'past');
    renderPastWeeks(root);
    return;
  }

  // Never paint "Week not found" during boot/hash races \u2014 show loading until live week exists.
  if (!getWeek(route.weekId)) {
    renderLoadingShell(root, { tab: route.tab || 'plan' });
    return;
  }

  saveLastRoute(route.weekId, route.tab);

  switch (route.tab) {
    case 'orders':
      renderOrders(root, route.weekId);
      break;
    case 'spent':
      renderSpent(root, route.weekId);
      break;
    default:
      renderPlan(root, route.weekId);
  }
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

async function boot() {
  initShell();

  const route = parseRoute();
  renderLoadingShell(root, { tab: route.tab });

  window.addEventListener('hashchange', () => {
    if (suppressingHashChange) return;
    if (getState()) render();
    else renderLoadingShell(root, { tab: parseRoute().tab });
  });
  window.addEventListener('pagehide', () => {
    if (getState() && isOverlayDirty()) flushPersist();
  });
  try {
    await Promise.all([
      loadCatalog(),
      loadSuppliers(),
      loadItemPrefs(),
      loadCustomItems(),
    ]);

    // Subscribe before network loads so past-week merges re-render on production.
    subscribe(scheduleRender);

    // Paint cached week immediately so Reconcile/Budget aren't blank during Order View fetch.
    // Cache hydrate is read-only \u2014 never flushed to Firebase.
    const paintedFromCache = tryHydrateFromLocalCache();
    if (paintedFromCache) render();

    // persist: false \u2014 loading must not upload stale local cache.
    await loadStateFromOrderView({ persist: false });
    // Restore last week only after past weeks are in memory, and only if that week exists.
    restoreHashFromLastRoute({
      weekAvailable: (weekId) => weekId === THIS_WEEK_ID || !!getWeek(weekId),
    });
    ensureRouteWeekExists();
    startLiveOverlaySync();
    render();
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty"><h2>Could not load Order View data</h2><p>${err.message || err}</p><p class="hint">Open Inventory Admin while signed in, then retry. Purchasing reads the same stock/need/suggested numbers as Order View.</p></div>`;
  }
}

boot();
