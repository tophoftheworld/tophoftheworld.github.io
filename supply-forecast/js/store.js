import {
  defaultState,
  WEEKDAY_META,
  currentWeekStartKey,
  defaultDrinks,
  defaultLevelMix,
  defaultMilkMix,
  defaultAddonPrices,
  normalizeEventServiceType,
  normalizeNeedBufferPct,
  MILK_LINE_ID,
  newId,
} from './defaults.js?v=32';
import { weekStartFromPickedDate } from './compute.js?v=32';

const STORAGE_KEY = 'supply-forecast-v4';
const LEGACY_KEYS = ['supply-forecast-v3', 'supply-forecast-v2', 'supply-forecast-v1'];

/** @typedef {import('./defaults.js').ForecastState} ForecastState */
/** @typedef {import('./defaults.js').Ingredient} Ingredient */
/** @typedef {import('./defaults.js').IngredientRole} IngredientRole */
/** @typedef {import('./defaults.js').DrinkLine} DrinkLine */

/**
 * @param {unknown} raw
 * @returns {IngredientRole}
 */
function normalizeRole(raw) {
  if (raw === 'matcha' || raw === 'milk') return raw;
  if (raw === 'dairy_milk' || raw === 'oat_milk') return 'milk';
  return null;
}

/**
 * Coalesce specific milk SKUs / extra milk lines into one generic Milk recipe line.
 * Keeps the first milk line where it was so newly added ingredients stay at the end.
 * @param {DrinkLine[]} lines
 * @param {Ingredient[]} ingredients
 * @returns {DrinkLine[]}
 */
export function normalizeDrinkLines(lines, ingredients) {
  const milkIds = new Set(
    (ingredients || []).filter((i) => i.role === 'milk').map((i) => i.id)
  );
  /** @type {DrinkLine[]} */
  const out = [];
  let milkIndex = -1;
  for (const l of lines || []) {
    if (!l || typeof l.ingredientId !== 'string') continue;
    const qty =
      Number.isFinite(Number(l.qtyPerCup)) && Number(l.qtyPerCup) >= 0 ? Number(l.qtyPerCup) : 0;
    const isMilk = l.ingredientId === MILK_LINE_ID || milkIds.has(l.ingredientId);
    if (isMilk) {
      if (milkIndex >= 0) {
        out[milkIndex].qtyPerCup += qty;
        continue;
      }
      milkIndex = out.length;
      out.push({ ingredientId: MILK_LINE_ID, qtyPerCup: qty });
      continue;
    }
    out.push({ ingredientId: l.ingredientId, qtyPerCup: qty });
  }
  return out;
}

/**
 * Keep milkMix in sync with milk-role ingredients.
 * @param {Ingredient[]} ingredients
 * @param {unknown} rawMilkMix
 * @param {unknown} rawOatPct
 */
function normalizeMilkMix(ingredients, rawMilkMix, rawOatPct) {
  const milks = ingredients.filter((i) => i.role === 'milk');
  /** @type {Map<string, number>} */
  const prev = new Map();
  if (Array.isArray(rawMilkMix)) {
    for (const m of rawMilkMix) {
      if (m && typeof m.ingredientId === 'string') {
        const pct = Number(m.pct);
        if (Number.isFinite(pct) && pct >= 0) prev.set(m.ingredientId, pct);
      }
    }
  }

  if (prev.size === 0 && Number.isFinite(Number(rawOatPct))) {
    const oat = Math.min(100, Math.max(0, Number(rawOatPct)));
    const dairy = 100 - oat;
    for (const m of milks) {
      if (m.id === 'oatside' || /oat/i.test(m.name)) prev.set(m.id, oat);
      else if (m.id === 'dairy' || /dairy/i.test(m.name)) prev.set(m.id, dairy);
    }
  }

  if (prev.size === 0) {
    const base = defaultMilkMix();
    for (const m of base) prev.set(m.ingredientId, m.pct);
  }

  return milks.map((m, i) => ({
    ingredientId: m.id,
    pct: prev.has(m.id) ? prev.get(m.id) : i === 0 && milks.length === 1 ? 100 : 0,
  }));
}

/**
 * Migrate legacy cups-mode mix to percentages.
 * @param {Array<{ pct: number, cups: number }>} drinkMix
 * @param {string} menuMode
 */
function migrateCupsModeToPct(drinkMix, menuMode) {
  if (menuMode !== 'cups') return drinkMix;
  const cupsSum = drinkMix.reduce((s, m) => s + (Number(m.cups) || 0), 0);
  if (cupsSum <= 0) return drinkMix;
  return drinkMix.map((m) => ({
    ...m,
    pct: ((Number(m.cups) || 0) / cupsSum) * 100,
  }));
}

/**
 * @param {unknown} raw
 * @returns {ForecastState}
 */
export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const eventId =
    typeof raw.eventId === 'string' && raw.eventId ? raw.eventId : base.eventId;
  const eventName = typeof raw.eventName === 'string' ? raw.eventName : '';

  let weekStart = currentWeekStartKey();
  if (typeof raw.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.weekStart)) {
    weekStart = weekStartFromPickedDate(raw.weekStart) || currentWeekStartKey();
  }

  /** @type {Map<string, object>} */
  const byId = new Map();
  if (Array.isArray(raw.days)) {
    for (const d of raw.days) {
      if (d && typeof d.id === 'string') byId.set(d.id, d);
    }
  }

  const days = WEEKDAY_META.map((meta) => {
    const saved = byId.get(meta.id) || {};
    const cups = Number(saved.cups);
    return {
      id: meta.id,
      weekday: meta.weekday,
      label: meta.label,
      enabled:
        typeof saved.enabled === 'boolean'
          ? saved.enabled
          : base.days.find((d) => d.id === meta.id)?.enabled ?? false,
      cups: Number.isFinite(cups) && cups >= 0 ? cups : 0,
    };
  });

  /** @type {Ingredient[]} */
  let ingredients;
  if (Array.isArray(raw.ingredients) && raw.ingredients.length > 0) {
    ingredients = raw.ingredients
      .filter((ing) => ing && typeof ing === 'object')
      .map((ing, i) => {
        const packSize = Number(ing.packSize);
        const id = typeof ing.id === 'string' && ing.id ? ing.id : `ing_${i}`;
        let role = normalizeRole(ing.role);
        if (role == null) {
          if (id === 'matcha' || /matcha/i.test(String(ing.name || ''))) role = 'matcha';
          else if (
            id === 'dairy' ||
            id === 'oatside' ||
            /dairy|full cream|oat|milk/i.test(String(ing.name || ''))
          ) {
            role = 'milk';
          }
        }
        const defaultPack =
          id === 'oatside' || /oat/i.test(String(ing.name || ''))
            ? { packSize: 6000, packLabel: 'box', packRoundUp: true }
            : { packSize: 0, packLabel: '', packRoundUp: false };
        return {
          id,
          name: typeof ing.name === 'string' ? ing.name : 'Ingredient',
          unit: typeof ing.unit === 'string' && ing.unit ? ing.unit : 'g',
          packSize:
            Number.isFinite(packSize) && packSize >= 0
              ? packSize
              : ing.packSize === undefined
                ? defaultPack.packSize
                : 0,
          packLabel:
            typeof ing.packLabel === 'string'
              ? ing.packLabel
              : ing.packLabel === undefined
                ? defaultPack.packLabel
                : '',
          packRoundUp:
            typeof ing.packRoundUp === 'boolean'
              ? ing.packRoundUp
              : ing.packRoundUp === undefined
                ? defaultPack.packRoundUp
                : false,
          role,
        };
      });
  } else {
    ingredients = base.ingredients;
  }

  if (
    Array.isArray(raw.ingredients) &&
    raw.ingredients.length > 0 &&
    (!Array.isArray(raw.drinks) || raw.drinks.length === 0)
  ) {
    const hasDairy = ingredients.some((i) => i.id === 'dairy' || /dairy/i.test(i.name));
    if (!hasDairy) {
      ingredients.splice(1, 0, {
        id: 'dairy',
        name: 'Dairy milk',
        unit: 'ml',
        packSize: 0,
        packLabel: '',
        packRoundUp: false,
        role: 'milk',
      });
    }
  }

  let drinks;
  if (Array.isArray(raw.drinks) && raw.drinks.length > 0) {
    drinks = raw.drinks
      .filter((d) => d && typeof d === 'object')
      .map((d, i) => ({
        id: typeof d.id === 'string' && d.id ? d.id : `drink_${i}`,
        name: typeof d.name === 'string' ? d.name : 'Drink',
        lines: Array.isArray(d.lines)
          ? normalizeDrinkLines(
              d.lines
                .filter((l) => l && typeof l.ingredientId === 'string')
                .map((l) => ({
                  ingredientId: l.ingredientId,
                  qtyPerCup:
                    Number.isFinite(Number(l.qtyPerCup)) && Number(l.qtyPerCup) >= 0
                      ? Number(l.qtyPerCup)
                      : 0,
                })),
              ingredients
            )
          : [],
      }));
  } else if (Array.isArray(raw.ingredients) && raw.ingredients.some((ing) => ing && Number(ing.qtyPerCup) > 0)) {
    drinks = [
      {
        id: 'signature-latte',
        name: 'Signature Latte',
        lines: normalizeDrinkLines(
          ingredients
            .map((ing) => {
              const legacy = raw.ingredients.find((x) => x && x.id === ing.id);
              const q = Number(legacy?.qtyPerCup);
              if (!Number.isFinite(q) || q <= 0) return null;
              return { ingredientId: ing.id, qtyPerCup: q };
            })
            .filter(Boolean),
          ingredients
        ),
      },
    ];
    if (drinks[0].lines.length === 0) drinks = defaultDrinks();
  } else {
    drinks = base.drinks;
  }

  let menuDrinkIds;
  if (Array.isArray(raw.menuDrinkIds)) {
    menuDrinkIds = raw.menuDrinkIds.filter((id) => typeof id === 'string' && drinks.some((d) => d.id === id));
  } else {
    menuDrinkIds = drinks.map((d) => d.id);
  }
  if (menuDrinkIds.length === 0 && drinks.length) menuDrinkIds = [drinks[0].id];

  const menuMode = raw.menuMode === 'cups' ? 'cups' : 'pct';

  let drinkMix;
  if (Array.isArray(raw.drinkMix) && raw.drinkMix.length > 0) {
    drinkMix = menuDrinkIds.map((id) => {
      const found = raw.drinkMix.find((m) => m && m.drinkId === id);
      const pct = Number(found?.pct);
      const cups = Number(found?.cups);
      const price = Number(found?.price);
      return {
        drinkId: id,
        pct: Number.isFinite(pct) && pct >= 0 ? pct : 0,
        cups: Number.isFinite(cups) && cups >= 0 ? cups : 0,
        price: Number.isFinite(price) && price >= 0 ? price : 0,
      };
    });
  } else {
    const even = menuDrinkIds.length ? 100 / menuDrinkIds.length : 0;
    drinkMix = menuDrinkIds.map((id, i) => ({
      drinkId: id,
      pct: menuDrinkIds.length === 1 ? 100 : i === 0 ? Math.ceil(even) : Math.floor(even),
      cups: 0,
      price: 0,
    }));
    const s = drinkMix.reduce((a, m) => a + m.pct, 0);
    if (drinkMix.length && s !== 100) drinkMix[0].pct += 100 - s;
  }

  drinkMix = migrateCupsModeToPct(drinkMix, menuMode);

  const milkMix = normalizeMilkMix(ingredients, raw.milkMix, raw.oatPct);

  const levelMix = defaultLevelMix();
  if (raw.levelMix && typeof raw.levelMix === 'object') {
    for (const k of ['l1', 'l2', 'l3']) {
      const n = Number(raw.levelMix[k]);
      if (Number.isFinite(n) && n >= 0) levelMix[k] = n;
    }
  }

  const addonPrices = defaultAddonPrices();
  if (raw.addonPrices && typeof raw.addonPrices === 'object') {
    for (const k of ['oat', 'l1', 'l2', 'l3']) {
      const n = Number(raw.addonPrices[k]);
      if (Number.isFinite(n) && n >= 0) addonPrices[k] = n;
    }
  }

  const eventServiceType = normalizeEventServiceType(raw.eventServiceType);
  const needBufferPct = normalizeNeedBufferPct(raw.needBufferPct);

  return {
    eventId,
    eventName,
    eventServiceType,
    needBufferPct,
    weekStart,
    days,
    ingredients,
    drinks,
    menuDrinkIds,
    drinkMix,
    milkMix,
    levelMix,
    addonPrices,
  };
}

/**
 * @returns {{ state: ForecastState, catalog: object|null, events: Record<string, object>, activeEventId: string }}
 */
export function readLocalBundle() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === 4) {
        const activeEventId =
          typeof parsed.activeEventId === 'string' && parsed.activeEventId
            ? parsed.activeEventId
            : 'default';
        const events = parsed.events && typeof parsed.events === 'object' ? parsed.events : {};
        const event = events[activeEventId] || {};
        const catalog = parsed.catalog || {};
        const merged = normalizeState({
          ...event,
          eventId: activeEventId,
          eventName:
            typeof event.eventName === 'string'
              ? event.eventName
              : typeof event.name === 'string'
                ? event.name
                : '',
          ingredients: catalog.ingredients || event.ingredients,
          drinks: catalog.drinks || event.drinks,
        });
        return { state: merged, catalog: parsed.catalog || null, events, activeEventId };
      }
      if (parsed && typeof parsed === 'object' && !parsed.version) {
        const state = normalizeState(parsed);
        return {
          state,
          catalog: { ingredients: state.ingredients, drinks: state.drinks },
          events: { [state.eventId]: extractEventFields(state) },
          activeEventId: state.eventId,
        };
      }
    }
  } catch {
    /* fall through */
  }

  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const state = normalizeState(JSON.parse(raw));
      return {
        state,
        catalog: { ingredients: state.ingredients, drinks: state.drinks },
        events: { [state.eventId]: extractEventFields(state) },
        activeEventId: state.eventId,
      };
    } catch {
      /* try next */
    }
  }

  const state = defaultState();
  return {
    state,
    catalog: { ingredients: state.ingredients, drinks: state.drinks },
    events: { [state.eventId]: extractEventFields(state) },
    activeEventId: state.eventId,
  };
}

/**
 * @param {ForecastState} state
 */
function extractEventFields(state) {
  return {
    id: state.eventId,
    name: state.eventName,
    eventServiceType: state.eventServiceType,
    weekStart: state.weekStart,
    days: state.days,
    menuDrinkIds: state.menuDrinkIds,
    drinkMix: state.drinkMix,
    milkMix: state.milkMix,
    levelMix: state.levelMix,
    addonPrices: state.addonPrices,
    needBufferPct: normalizeNeedBufferPct(state.needBufferPct),
  };
}

/** @param {ForecastState} state */
export function writeLocalBundle(state) {
  try {
    const prev = readLocalBundle();
    const catalog = {
      ingredients: state.ingredients,
      drinks: state.drinks,
      updatedAt: new Date().toISOString(),
    };
    const events = { ...prev.events };
    events[state.eventId] = {
      ...extractEventFields(state),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 4,
        activeEventId: state.eventId,
        catalog,
        events,
      })
    );
  } catch {
    /* quota */
  }
}

/** @returns {ForecastState} */
export function loadState() {
  return readLocalBundle().state;
}

/** @param {ForecastState} state */
export function saveState(state) {
  writeLocalBundle(state);
}

/** Sync milkMix entries when ingredients change; coalesce milk SKUs in recipes → Milk. */
export function syncMilkMix(state) {
  const milks = state.ingredients.filter((i) => i.role === 'milk');
  const prev = new Map(state.milkMix.map((m) => [m.ingredientId, m.pct]));
  state.milkMix = milks.map((m) => ({
    ingredientId: m.id,
    pct: prev.has(m.id) ? prev.get(m.id) : 0,
  }));
  for (const drink of state.drinks || []) {
    drink.lines = normalizeDrinkLines(drink.lines, state.ingredients);
  }
}

/** @returns {string} */
export function newEventId() {
  return newId();
}
