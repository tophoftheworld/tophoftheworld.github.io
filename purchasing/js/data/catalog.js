import { loadMasterItemsForOrderView } from '../../../inventory/js/shared/order-view-feed.js?v=105';

export const LOCATIONS = [
  { key: 'sm-north', label: 'SM North' },
  { key: 'podium', label: 'Podium' },
  { key: 'moa', label: 'MOA' },
  { key: 'events', label: 'Events' },
  { key: 'general', label: 'General' },
];

/** Fixed store branches (Order View\u2013backed). */
export const STORE_LOCATIONS = LOCATIONS.filter((l) =>
  ['sm-north', 'podium', 'moa'].includes(l.key)
);

/** Choices shown in the Add-location first step. */
export const ADD_LOCATION_CHOICES = [
  ...STORE_LOCATIONS,
  { key: 'general', label: 'General' },
  { key: 'events', label: 'Events' },
];

const EVENT_PREFIX = 'event:';

/** In-memory registry of named event labels (from live overlay). */
let locationMetaCache = {};

export function isNamedEventLocation(key) {
  return typeof key === 'string' && key.startsWith(EVENT_PREFIX);
}

export function isFlexibleLocation(key) {
  return key === 'events' || key === 'general' || isNamedEventLocation(key);
}

export function setLocationMetaCache(meta) {
  locationMetaCache = meta && typeof meta === 'object' ? { ...meta } : {};
}

export function getLocationMetaCache() {
  return locationMetaCache;
}

export function upsertLocationMetaCache(key, entry) {
  if (!key || !entry) return locationMetaCache;
  locationMetaCache = {
    ...locationMetaCache,
    [key]: { ...locationMetaCache[key], ...entry },
  };
  return locationMetaCache;
}

/** Slugify an event display name into an `event:{slug}` key. */
export function eventLocationKeyFromLabel(label, existingKeys = []) {
  const base =
    String(label || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'event';
  let slug = base;
  let n = 2;
  const taken = new Set(existingKeys);
  while (taken.has(`${EVENT_PREFIX}${slug}`)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return `${EVENT_PREFIX}${slug}`;
}

let catalog = null;
/** @type {Array<object>|null} */
let liveItems = null;
/** @type {Array<object>|null} Raw inventory master docs for Order View feed. */
let rawMasterItems = null;

/**
 * Normalize a master inventory item for the purchasing picker.
 * @param {object} item
 */
function normalizePickerItem(item) {
  if (!item || !item.id) return null;
  const description = item.description || item.subtitle || '';
  return {
    id: item.id,
    name: item.name || item.id,
    description,
    unit: item.unit || 'pcs',
    category: item.category || 'Other',
    categoryOrder: item.categoryOrder ?? 999,
    displayOrder: item.displayOrder ?? 0,
    enabledBranches: item.enabledBranches,
    restockAmount: item.restockAmount || item.defaultRestockLevel || 0,
  };
}

export async function loadCatalog() {
  if (catalog?.items?.length && liveItems) return catalog;

  let staticCatalog = { items: [], suppliers: [] };
  try {
    const res = await fetch('./data/catalog.json?v=2');
    if (res.ok) staticCatalog = await res.json();
  } catch (err) {
    console.warn('Could not load static catalog fallback', err);
  }

  try {
    const master = await loadMasterItemsForOrderView();
    rawMasterItems = master;
    liveItems = master.map(normalizePickerItem).filter(Boolean);
  } catch (err) {
    console.warn('Could not load live inventory for picker; using catalog.json', err);
    rawMasterItems = null;
    liveItems = (staticCatalog.items || []).map(normalizePickerItem).filter(Boolean);
  }

  catalog = {
    ...staticCatalog,
    items: liveItems,
    suppliers: staticCatalog.suppliers || [],
  };
  return catalog;
}

/** Force-refresh live inventory items into the picker cache. */
export async function refreshPickerItems() {
  liveItems = null;
  rawMasterItems = null;
  catalog = catalog ? { ...catalog, items: [] } : null;
  return loadCatalog();
}

/** Raw Firebase master items (for Order View math). */
export function getLiveMasterItems() {
  return rawMasterItems;
}

export function getCatalog() {
  return catalog;
}

export function findItem(itemId) {
  return (
    liveItems?.find((i) => i.id === itemId) ||
    catalog?.items?.find((i) => i.id === itemId) ||
    null
  );
}

export function findSupplier(supplierId) {
  return catalog?.suppliers?.find((s) => s.id === supplierId) || null;
}

export function itemDisplayName(line) {
  if (line.freeTextName) return line.freeTextName;
  if (line.itemName) return line.itemName;
  const item = findItem(line.itemId);
  if (!item) return 'Unknown item';
  return item.description ? `${item.name} (${item.description})` : item.name;
}

/**
 * Human label for a location key (store, general, legacy events, or named event).
 * @param {string} key
 * @param {object} [meta] optional overlay locationMeta; falls back to cache
 */
export function locationLabel(key, meta) {
  if (!key) return '\u2014';
  const fromList = LOCATIONS.find((l) => l.key === key)?.label;
  if (fromList) return fromList;
  const registry = meta || locationMetaCache;
  const entry = registry?.[key];
  if (entry?.label) return entry.label;
  if (isNamedEventLocation(key)) {
    return key.slice(EVENT_PREFIX.length).replace(/-/g, ' ') || key;
  }
  return key;
}

/** Sort rank for location keys: stores → general → legacy events → named events (alpha). */
export function locationSortRank(key, meta) {
  if (key === 'sm-north') return 0;
  if (key === 'podium') return 1;
  if (key === 'moa') return 2;
  if (key === 'general') return 3;
  if (key === 'events') return 4;
  if (isNamedEventLocation(key)) return 100;
  return 50;
}

/**
 * Build Budget location groups: any location with lines, plus pinned locationMeta entries.
 * @param {object} week
 */
export function buildLocationGroups(week) {
  const meta = week?.locationMeta || locationMetaCache || {};
  const byLoc = new Map();
  for (const line of week?.lines || []) {
    const loc = line.location;
    if (!loc) continue;
    if (!byLoc.has(loc)) byLoc.set(loc, []);
    byLoc.get(loc).push(line);
  }
  // Stores always appear so Budget isn't empty while other branches lazy-load.
  for (const loc of STORE_LOCATIONS) {
    if (!byLoc.has(loc.key)) byLoc.set(loc.key, []);
  }
  // Pinned locations (added via + Add location) show even with no lines yet.
  for (const [key, entry] of Object.entries(meta)) {
    if (!key) continue;
    if (!byLoc.has(key) && (entry?.pinned || isNamedEventLocation(key))) {
      byLoc.set(key, []);
    }
  }
  const keys = [...byLoc.keys()].sort((a, b) => {
    const ra = locationSortRank(a, meta);
    const rb = locationSortRank(b, meta);
    if (ra !== rb) return ra - rb;
    return locationLabel(a, meta).localeCompare(locationLabel(b, meta));
  });
  return keys.map((key) => ({
    key,
    label: locationLabel(key, meta),
    kind: isNamedEventLocation(key)
      ? 'event'
      : key === 'general'
        ? 'general'
        : key === 'events'
          ? 'events'
          : 'store',
    lines: byLoc.get(key) || [],
  }));
}

/**
 * Inventory items for the add-line picker.
 * @param {string} [locationKey] Prefer items enabled for this branch.
 */
export function catalogItemsForPicker(locationKey) {
  const items = liveItems || catalog?.items || [];
  return items.filter((i) => {
    const branches = i.enabledBranches;
    if (branches === undefined) return true;
    if (!Array.isArray(branches) || branches.length === 0) return false;
    if (locationKey && !isFlexibleLocation(locationKey)) {
      return branches.includes(locationKey);
    }
    return true;
  });
}

export function catalogSuppliersForPicker() {
  return (catalog?.suppliers || []).slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function itemPickerLabel(item) {
  if (!item) return '';
  return item.description ? `${item.name} (${item.description})` : item.name;
}
