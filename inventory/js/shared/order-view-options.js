/**
 * Shared Order View computation options (usage week, plan window, demand buffer).
 * Inventory Admin and Purchasing persist the same localStorage keys so numbers match.
 */
import {
  addDays,
  defaultHorizonForToday,
  formatDateRange,
  horizonLabel,
  lastCompleteWeekStart,
  lastCompleteWeekStarts,
  migrateStoredHorizon,
  planWeekStart,
  sliceOfPlanWeek,
} from './forecast.js?v=105';

export const ORDER_VIEW_STORAGE_BASELINE = 'order-view-usage-baseline';
export const ORDER_VIEW_STORAGE_HORIZON = 'order-view-horizon';
export const ORDER_VIEW_STORAGE_BUFFER = 'order-view-demand-buffer';
export const PURCHASING_BRANCH_FORECAST_KEY = 'purchasing-branch-forecast-v1';

export const VALID_ORDER_BASELINES = new Set(['prev-week', 'two-weeks-ago', 'rolling-avg']);
export const VALID_ORDER_HORIZONS = new Set(['week', 'wave1', 'wave2']);

function readStorage(key) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    return storage.getItem(key);
  } catch (_) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(key, value);
  } catch (_) {
    /* ignore */
  }
}

export function sanitizeOrderViewOptions(raw, today = new Date()) {
  const defaults = {
    orderUsageBaseline: 'prev-week',
    orderHorizon: defaultHorizonForToday(today),
    orderDemandBuffer: true,
  };
  const src = raw && typeof raw === 'object' ? raw : {};
  let orderUsageBaseline = src.orderUsageBaseline || defaults.orderUsageBaseline;
  if (!VALID_ORDER_BASELINES.has(orderUsageBaseline)) orderUsageBaseline = defaults.orderUsageBaseline;

  let orderHorizon = migrateStoredHorizon(src.orderHorizon, today);
  if (!VALID_ORDER_HORIZONS.has(orderHorizon)) orderHorizon = defaults.orderHorizon;

  const orderDemandBuffer = src.orderDemandBuffer !== false && src.orderDemandBuffer !== '0';
  return { orderUsageBaseline, orderHorizon, orderDemandBuffer };
}

export function loadOrderViewOptions(today = new Date()) {
  return sanitizeOrderViewOptions(
    {
      orderUsageBaseline: readStorage(ORDER_VIEW_STORAGE_BASELINE),
      orderHorizon: readStorage(ORDER_VIEW_STORAGE_HORIZON),
      orderDemandBuffer: readStorage(ORDER_VIEW_STORAGE_BUFFER) !== '0',
    },
    today
  );
}

function readBranchForecastMap() {
  try {
    const parsed = JSON.parse(readStorage(PURCHASING_BRANCH_FORECAST_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** Full per-branch map as stored locally (unsanitized keys may exist). */
export function loadBranchForecastMap() {
  return readBranchForecastMap();
}

/**
 * Replace the local per-branch forecast map (e.g. from firebase overlay).
 * @returns {Record<string, object>}
 */
export function replaceBranchForecastMap(map, today = new Date()) {
  const out = {};
  if (map && typeof map === 'object') {
    for (const [branch, opts] of Object.entries(map)) {
      if (!branch) continue;
      out[branch] = sanitizeOrderViewOptions(opts, today);
    }
  }
  writeStorage(PURCHASING_BRANCH_FORECAST_KEY, JSON.stringify(out));
  return out;
}

/** Per-branch purchasing options; ralls back to shared Order View settings. */
export function loadBranchForecastOptions(branch, today = new Date()) {
  const map = readBranchForecastMap();
  const saved = map && branch && map[branch];
  if (saved) return sanitizeOrderViewOptions(saved, today);
  return loadOrderViewOptions(today);
}

export function saveBranchForecastOptions(branch, patch, today = new Date()) {
  if (!branch) return loadOrderViewOptions(today);
  const map = readBranchForecastMap();
  const next = sanitizeOrderViewOptions({ ...loadBranchForecastOptions(branch, today), ...patch }, today);
  map[branch] = next;
  writeStorage(PURCHASING_BRANCH_FORECAST_KEY, JSON.stringify(map));
  return next;
}

export function loadForecastOptionsForBranches(branches, today = new Date()) {
  const out = {};
  for (const branch of branches || []) {
    out[branch] = loadBranchForecastOptions(branch, today);
  }
  return out;
}

export function saveOrderViewOptions(patch, today = new Date()) {
  const next = { ...loadOrderViewOptions(today), ...patch };
  if (!VALID_ORDER_BASELINES.has(next.orderUsageBaseline)) next.orderUsageBaseline = 'prev-week';
  if (!VALID_ORDER_HORIZONS.has(next.orderHorizon)) next.orderHorizon = defaultHorizonForToday(today);
  next.orderDemandBuffer = !!next.orderDemandBuffer;
  writeStorage(ORDER_VIEW_STORAGE_BASELINE, next.orderUsageBaseline);
  writeStorage(ORDER_VIEW_STORAGE_HORIZON, next.orderHorizon);
  writeStorage(ORDER_VIEW_STORAGE_BUFFER, next.orderDemandBuffer ? '1' : '0');
  return next;
}

export function baselineChoices(today = new Date()) {
  const lastWeekStart = lastCompleteWeekStart(today, 1);
  const twoAgoStart = lastCompleteWeekStart(today, 2);
  const fourStarts = lastCompleteWeekStarts(today, 4);
  const fourOldest = fourStarts[fourStarts.length - 1];
  const fourNewestEnd = addDays(fourStarts[0], 6);
  return [
    {
      value: 'prev-week',
      label: `Last week (${formatDateRange(lastWeekStart, addDays(lastWeekStart, 6))})`,
    },
    {
      value: 'two-weeks-ago',
      label: `2 weeks ago (${formatDateRange(twoAgoStart, addDays(twoAgoStart, 6))})`,
    },
    {
      value: 'rolling-avg',
      label: `4-week average (${formatDateRange(fourOldest, fourNewestEnd)})`,
    },
  ];
}

export function horizonChoices(today = new Date()) {
  const weekStart = planWeekStart(today);
  return [...VALID_ORDER_HORIZONS].map((value) => {
    const slice = sliceOfPlanWeek(weekStart, value);
    const range = slice.length ? formatDateRange(slice[0], slice[slice.length - 1]) : '-';
    return { value, label: `${horizonLabel(value)} (${range})` };
  });
}

export function compactBaselineChoices(today = new Date()) {
  return baselineChoices(today).map((c) => {
    if (c.value === 'prev-week') return { ...c, label: c.label.replace(/^Last week \(/, 'Last week · ').replace(/\)$/, '') };
    if (c.value === 'two-weeks-ago') return { ...c, label: c.label.replace(/^2 weeks ago \(/, '2w ago · ').replace(/\)$/, '') };
    if (c.value === 'rolling-avg') return { ...c, label: c.label.replace(/^4-week average \(/, '4-wk avg · ').replace(/\)$/, '') };
    return c;
  });
}

export function compactHorizonChoices(today = new Date()) {
  return horizonChoices(today).map((c) => {
    if (c.value === 'week') return { ...c, label: c.label.replace(/^Entire week \(/, 'Week · ').replace(/\)$/, '') };
    if (c.value === 'wave1') return { ...c, label: c.label.replace(/^Mon–Thu \(/, 'Mon–Thu · ').replace(/\)$/, '') };
    if (c.value === 'wave2') return { ...c, label: c.label.replace(/^Fri–Sun \(/, 'Fri–Sun · ').replace(/\)$/, '') };
    return c;
  });
}
