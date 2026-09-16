/**
 * Remember last Purchasing week + tab so reopen skips the empty default route.
 */
import { THIS_WEEK_ID } from './seed.js?v=96';

export const LAST_ROUTE_KEY = 'purchasing-last-route-v1';
export const LIVE_WEEK_CACHE_KEY = 'purchasing-live-week-cache-v1';

const VALID_TABS = new Set(['plan', 'orders', 'spent', 'past']);

export function loadLastRoute() {
  try {
    const raw = localStorage.getItem(LAST_ROUTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const tab = VALID_TABS.has(parsed.tab) ? parsed.tab : 'plan';
    const weekId =
      typeof parsed.weekId === 'string' && parsed.weekId
        ? parsed.weekId
        : THIS_WEEK_ID;
    return { weekId, tab };
  } catch (_) {
    return null;
  }
}

export function saveLastRoute(weekId, tab) {
  if (!tab || tab === 'past') {
    try {
      localStorage.setItem(
        LAST_ROUTE_KEY,
        JSON.stringify({ weekId: THIS_WEEK_ID, tab: 'past', savedAt: Date.now() })
      );
    } catch (_) {
      /* ignore */
    }
    return;
  }
  try {
    localStorage.setItem(
      LAST_ROUTE_KEY,
      JSON.stringify({
        weekId: weekId || THIS_WEEK_ID,
        tab: VALID_TABS.has(tab) ? tab : 'plan',
        savedAt: Date.now(),
      })
    );
  } catch (_) {
    /* ignore */
  }
}

/** Hash for a week/tab (matches weekHref in week-chrome). */
export function routeToHash(weekId, tab) {
  const isCurrent = !weekId || weekId === THIS_WEEK_ID;
  if (tab === 'past') return '#/past';
  if (tab === 'plan') return isCurrent ? '#/' : `#/week/${weekId}`;
  return isCurrent ? `#/${tab}` : `#/week/${weekId}/${tab}`;
}

/**
 * If the URL has no meaningful purchasing route, restore last week/tab.
 * Returns true when hash was updated (caller should re-parse).
 * @param {{ weekAvailable?: (weekId: string) => boolean }} [opts]
 *   When set, past-week restores are skipped if that week is not loaded yet / missing.
 */
export function restoreHashFromLastRoute(opts = {}) {
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);
  // Explicit routes win \u2014 only restore when landing on default Budget/this-week.
  const isDefault =
    parts.length === 0 ||
    (parts.length === 1 && parts[0] === 'plan') ||
    hash === '/' ||
    hash === '';
  if (!isDefault) return false;

  const last = loadLastRoute();
  if (!last) return false;
  if (last.tab === 'plan' && last.weekId === THIS_WEEK_ID) return false;

  // Don't bounce to a past week that isn't in memory (causes "Week not found" flash).
  if (
    last.tab !== 'past' &&
    last.weekId &&
    last.weekId !== THIS_WEEK_ID &&
    typeof opts.weekAvailable === 'function' &&
    !opts.weekAvailable(last.weekId)
  ) {
    return false;
  }

  const next = routeToHash(last.weekId, last.tab);
  const target = next.startsWith('#') ? next : `#${next}`;
  const current = location.hash || '#/';
  if (current === target) return false;
  location.replace(target);
  return true;
}

function isCacheWorthyLine(line) {
  if (!line) return false;
  if (line.onPlan || line.frozen) return true;
  if (line.source === 'manual') return true;
  if (line.kind === 'budget' || line.kind === 'deliveryFee') return true;
  if (!line.itemId && line.freeTextName) return true;
  return false;
}

/** Drop Order View suggestions so localStorage / hydrate stay small. */
export function slimLiveWeekForCache(week) {
  if (!week || typeof week !== 'object') return week;
  const lines = Array.isArray(week.lines) ? week.lines.filter(isCacheWorthyLine) : [];
  return { ...week, lines };
}

export function readLiveWeekCache() {
  try {
    const raw = localStorage.getItem(LIVE_WEEK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.week?.id) return null;
    // Drop cache older than 7 days
    if (parsed.savedAt && Date.now() - parsed.savedAt > 7 * 24 * 60 * 60 * 1000) {
      return null;
    }
    return slimLiveWeekForCache(parsed.week);
  } catch (_) {
    return null;
  }
}

export function writeLiveWeekCache(week) {
  if (!week?.id) return;
  try {
    localStorage.setItem(
      LIVE_WEEK_CACHE_KEY,
      JSON.stringify({ week: slimLiveWeekForCache(week), savedAt: Date.now() })
    );
  } catch (_) {
    /* ignore quota */
  }
}
