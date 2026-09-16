/**
 * Pure supply-forecast math: cups × drink mix × milk/level → ingredient need.
 */

/** @typedef {import('./defaults.js').Day} Day */
/** @typedef {import('./defaults.js').Ingredient} Ingredient */
/** @typedef {import('./defaults.js').Drink} Drink */
/** @typedef {import('./defaults.js').DrinkMixEntry} DrinkMixEntry */
/** @typedef {import('./defaults.js').LevelMix} LevelMix */
/** @typedef {import('./defaults.js').ForecastState} ForecastState */

import { MATCHA_LEVEL_G, MILK_LINE_ID, tracksEventRevenue, eventServiceLabel } from './defaults.js?v=28';

/**
 * @param {Day[]} days
 * @returns {Day[]}
 */
export function enabledDays(days) {
  return (days || []).filter((d) => d && d.enabled);
}

/**
 * @param {Day[]} days
 * @returns {number}
 */
export function totalCups(days) {
  return enabledDays(days).reduce((sum, d) => sum + (Number(d.cups) || 0), 0);
}

/**
 * @param {LevelMix|null|undefined} levelMix
 * @returns {number}
 */
export function matchaGramsPerCup(levelMix) {
  const l1 = Number(levelMix?.l1) || 0;
  const l2 = Number(levelMix?.l2) || 0;
  const l3 = Number(levelMix?.l3) || 0;
  return (l1 * MATCHA_LEVEL_G.l1 + l2 * MATCHA_LEVEL_G.l2 + l3 * MATCHA_LEVEL_G.l3) / 100;
}

/**
 * @param {number} n
 * @returns {number}
 */
export function pctSum(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((s, e) => s + (Number(e.pct) || 0), 0);
}

/**
 * @param {LevelMix} levelMix
 * @returns {number}
 */
export function levelPctSum(levelMix) {
  return (Number(levelMix?.l1) || 0) + (Number(levelMix?.l2) || 0) + (Number(levelMix?.l3) || 0);
}

/**
 * Weight used for drink mix allocation (always %).
 * @param {DrinkMixEntry|undefined} entry
 * @returns {number}
 */
export function drinkMixWeight(entry) {
  if (!entry) return 0;
  return Number(entry.pct) || 0;
}

/**
 * Sum of menu mix percentages.
 * @param {ForecastState} state
 * @returns {number}
 */
export function mixPctSum(state) {
  const menuIds = new Set(state.menuDrinkIds || []);
  const mixMap = new Map((state.drinkMix || []).map((m) => [m.drinkId, m]));
  let sum = 0;
  for (const drink of state.drinks || []) {
    if (!menuIds.has(drink.id)) continue;
    sum += Number(mixMap.get(drink.id)?.pct) || 0;
  }
  return sum;
}

/**
 * Week cups for a drink from its mix %.
 * @param {number} pct
 * @param {number} weekTotal
 * @returns {number}
 */
export function weekMixCups(pct, weekTotal) {
  return ((Number(pct) || 0) / 100) * (Number(weekTotal) || 0);
}

/**
 * Derive mix % when user edits week cups.
 * @param {number} cups
 * @param {number} weekTotal
 * @param {number} allCupsSum
 * @returns {number}
 */
export function pctFromCups(cups, weekTotal, allCupsSum) {
  const c = Number(cups) || 0;
  if (weekTotal > 0) return (c / weekTotal) * 100;
  const sum = Number(allCupsSum) || 0;
  if (sum > 0) return (c / sum) * 100;
  return 0;
}

/**
 * Menu drinks with active mix weight.
 * @param {ForecastState} state
 * @returns {Array<{ drink: Drink, weight: number, pct: number, cups: number, price: number, totalRevenue: number }>}
 */
export function menuMixRows(state) {
  const drinks = state.drinks || [];
  const menuIds = new Set(state.menuDrinkIds || []);
  const mixMap = new Map((state.drinkMix || []).map((m) => [m.drinkId, m]));
  const weekTotal = totalCups(state.days);
  const pctTotal = mixPctSum(state) || 100;
  const trackRev = tracksEventRevenue(state.eventServiceType);
  return drinks
    .filter((d) => menuIds.has(d.id))
    .map((drink) => {
      const entry = mixMap.get(drink.id);
      const pct = Number(entry?.pct) || 0;
      const price = Number(entry?.price) || 0;
      const cups = weekMixCups(pct, weekTotal);
      const share = pctTotal > 0 ? pct / pctTotal : 0;
      return {
        drink,
        pct,
        cups,
        price,
        weight: pct,
        totalRevenue: trackRev ? price * share * weekTotal : 0,
      };
    });
}

/**
 * Milk ingredients with mix pct.
 * @param {ForecastState} state
 * @returns {Array<{ ingredient: Ingredient, pct: number }>}
 */
export function milkMixRows(state) {
  const milks = (state.ingredients || []).filter((i) => i.role === 'milk');
  const mixMap = new Map((state.milkMix || []).map((m) => [m.ingredientId, Number(m.pct) || 0]));
  return milks.map((ingredient) => ({
    ingredient,
    pct: mixMap.has(ingredient.id) ? mixMap.get(ingredient.id) : 0,
  }));
}

/**
 * @param {Array<{ pct: number }>} rows
 * @returns {number}
 */
export function milkPctSum(rows) {
  return (rows || []).reduce((s, r) => s + (Number(r.pct) || 0), 0);
}

/**
 * Milk volume from recipe: generic Milk line and/or legacy milk-role SKU lines.
 * @param {Drink} drink
 * @param {Map<string, Ingredient>} ingById
 * @returns {number}
 */
export function drinkMilkVolume(drink, ingById) {
  let vol = 0;
  for (const line of drink.lines || []) {
    const qty = Number(line.qtyPerCup) || 0;
    if (line.ingredientId === MILK_LINE_ID) {
      vol += qty;
      continue;
    }
    const ing = ingById.get(line.ingredientId);
    if (ing?.role === 'milk') vol += qty;
  }
  return vol;
}

/**
 * Whether drink uses matcha-role ingredient.
 * @param {Drink} drink
 * @param {Map<string, Ingredient>} ingById
 */
export function drinkUsesMatcha(drink, ingById) {
  return (drink.lines || []).some((line) => ingById.get(line.ingredientId)?.role === 'matcha');
}

/**
 * Ingredient qty for one day's cups under mix rules.
 * @param {number} cups
 * @param {ForecastState} state
 * @returns {Record<string, number>}
 */
export function allocateDayNeed(cups, state) {
  /** @type {Record<string, number>} */
  const need = {};
  const total = Number(cups) || 0;
  if (total <= 0) return need;

  const ingById = new Map((state.ingredients || []).map((ing) => [ing.id, ing]));
  const rows = menuMixRows(state);
  if (rows.length === 0) return need;

  const rawSum = rows.reduce((s, r) => s + r.weight, 0);
  const matchaG = matchaGramsPerCup(state.levelMix);
  const matchaIng = (state.ingredients || []).find((i) => i.role === 'matcha');
  const milkRows = milkMixRows(state);

  for (const { drink, weight } of rows) {
    const share = rawSum > 0 ? weight / rawSum : 1 / rows.length;
    const drinkCups = total * share;
    if (drinkCups <= 0) continue;

    const milkVol = drinkMilkVolume(drink, ingById);
    const usesMatcha = drinkUsesMatcha(drink, ingById);

    for (const line of drink.lines || []) {
      if (line.ingredientId === MILK_LINE_ID) continue;
      const ing = ingById.get(line.ingredientId);
      if (!ing) continue;
      const qty = Number(line.qtyPerCup) || 0;

      if (ing.role === 'matcha') continue;
      if (ing.role === 'milk') continue;
      need[ing.id] = (need[ing.id] || 0) + drinkCups * qty;
    }

    if (usesMatcha && matchaIng) {
      need[matchaIng.id] = (need[matchaIng.id] || 0) + drinkCups * matchaG;
    }

    if (milkVol > 0) {
      for (const { ingredient, pct } of milkRows) {
        const frac = (Number(pct) || 0) / 100;
        if (frac <= 0) continue;
        need[ingredient.id] = (need[ingredient.id] || 0) + drinkCups * milkVol * frac;
      }
    }
  }

  return need;
}

/**
 * Estimated revenue for one day's cups.
 * @param {number} cups
 * @param {ForecastState} state
 * @returns {number}
 */
export function oatMilkPct(state) {
  return milkMixRows(state)
    .filter(
      (r) => r.ingredient.id === 'oatside' || /oat/i.test(String(r.ingredient.name || ''))
    )
    .reduce((s, r) => s + (Number(r.pct) || 0), 0);
}

export function addonRevenueForDay(cups, state) {
  const total = Number(cups) || 0;
  if (total <= 0) return 0;
  const ap = state.addonPrices || { oat: 0, l1: 0, l2: 0, l3: 0 };
  let rev = 0;
  rev += total * (oatMilkPct(state) / 100) * (Number(ap.oat) || 0);
  const lm = state.levelMix || {};
  rev += total * ((Number(lm.l1) || 0) / 100) * (Number(ap.l1) || 0);
  rev += total * ((Number(lm.l2) || 0) / 100) * (Number(ap.l2) || 0);
  rev += total * ((Number(lm.l3) || 0) / 100) * (Number(ap.l3) || 0);
  return rev;
}

export function baseDrinkRevenueForDay(cups, state) {
  const total = Number(cups) || 0;
  if (total <= 0) return 0;
  const rows = menuMixRows(state);
  if (rows.length === 0) return 0;
  const rawSum = rows.reduce((s, r) => s + r.weight, 0);
  let rev = 0;
  for (const { weight, price } of rows) {
    const share = rawSum > 0 ? weight / rawSum : 1 / rows.length;
    rev += total * share * price;
  }
  return rev;
}

export function revenueForDay(cups, state) {
  if (!tracksEventRevenue(state.eventServiceType)) return 0;
  return baseDrinkRevenueForDay(cups, state) + addonRevenueForDay(cups, state);
}

/**
 * Revenue per enabled day and week total.
 * @param {ForecastState} state
 */
export function revenueMatrixFromState(state) {
  const active = enabledDays(state.days);
  const byDay = active.map((d) => revenueForDay(d.cups, state));
  const total = byDay.reduce((sum, n) => sum + n, 0);
  return { days: active, byDay, total };
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatMoney(n) {
  const x = Number(n) || 0;
  const hasCents = Math.abs(x % 1) > 0.001;
  return `₱${x.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Full need matrix for forecast UI.
 * @param {ForecastState} state
 */
export function needMatrixFromState(state) {
  const active = enabledDays(state.days);
  const cupsTotal = totalCups(active);
  const ingredients = state.ingredients || [];

  const rows = ingredients.map((ingredient) => {
    const byDay = active.map((d) => {
      const dayNeed = allocateDayNeed(d.cups, state);
      return dayNeed[ingredient.id] || 0;
    });
    const total = byDay.reduce((sum, n) => sum + n, 0);
    return { ingredient, byDay, total };
  }).filter((row) => row.total > 0 || ingredientUsedOnMenu(row.ingredient.id, state));

  return { days: active, totalCups: cupsTotal, rows };
}

/**
 * @param {string} ingredientId
 * @param {ForecastState} state
 */
function ingredientUsedOnMenu(ingredientId, state) {
  const menu = new Set(state.menuDrinkIds || []);
  for (const drink of state.drinks || []) {
    if (!menu.has(drink.id)) continue;
    if ((drink.lines || []).some((l) => l.ingredientId === ingredientId && l.ingredientId !== MILK_LINE_ID)) {
      return true;
    }
    const ing = (state.ingredients || []).find((i) => i.id === ingredientId);
    if (!ing) continue;
    if (ing.role === 'milk' || ing.role === 'matcha') {
      const ingById = new Map((state.ingredients || []).map((i) => [i.id, i]));
      if (ing.role === 'matcha' && drinkUsesMatcha(drink, ingById)) return true;
      if (ing.role === 'milk' && drinkMilkVolume(drink, ingById) > 0) return true;
    }
  }
  return false;
}

/** Legacy simple multiply — kept for older tests / helpers */
export function needForDay(cups, ingredient) {
  const c = Number(cups) || 0;
  const q = Number(ingredient?.qtyPerCup) || 0;
  return c * q;
}

/**
 * @param {Day[]} days
 * @param {Ingredient[]} ingredients
 * @deprecated use needMatrixFromState
 */
export function needMatrix(days, ingredients) {
  const active = enabledDays(days);
  const cupsTotal = totalCups(active);
  const rows = (ingredients || []).map((ingredient) => {
    const byDay = active.map((d) => needForDay(d.cups, ingredient));
    const total = byDay.reduce((sum, n) => sum + n, 0);
    return { ingredient, byDay, total };
  });
  return { days: active, totalCups: cupsTotal, rows };
}

/**
 * Format a quantity; g → kg and ml → L at ≥ 1000.
 * @param {number} qty
 * @param {string} unit
 * @returns {string}
 */
export function formatQty(qty, unit) {
  const n = Number(qty) || 0;
  const u = String(unit || '').trim().toLowerCase();

  if (u === 'g' && Math.abs(n) >= 1000) {
    return `${formatNumber(n / 1000)} kg`;
  }
  if ((u === 'ml' || u === 'milliliter' || u === 'millilitre') && Math.abs(n) >= 1000) {
    return `${formatNumber(n / 1000)} L`;
  }

  return `${formatNumber(n)} ${unit || ''}`.trim();
}

/**
 * Whole-number qty label for week total column.
 * @param {number} qty
 * @param {string} unit
 * @returns {string}
 */
export function formatQtyTotal(qty, unit) {
  const n = Number(qty) || 0;
  const u = String(unit || '').trim().toLowerCase();

  if (u === 'g' && Math.abs(n) >= 1000) {
    return `${formatCups(Math.ceil(n / 1000))} kg`;
  }
  if ((u === 'ml' || u === 'milliliter' || u === 'millilitre') && Math.abs(n) >= 1000) {
    return `${formatCups(Math.ceil(n / 1000))} L`;
  }

  return `${formatCups(Math.ceil(n))} ${unit || ''}`.trim();
}

/**
 * @param {string} label
 * @param {number} count
 * @returns {string}
 */
export function pluralizePack(label, count) {
  const base = String(label || 'pack').trim() || 'pack';
  if (Math.abs(count) === 1) return base;
  if (/s$/i.test(base) || /boxes$/i.test(base)) return base;
  if (/box$/i.test(base)) return `${base.slice(0, -3)}boxes`;
  return `${base}s`;
}

/**
 * @param {number} qty
 * @param {number} packSize
 * @returns {number|null}
 */
export function packCount(qty, packSize) {
  const size = Number(packSize);
  if (!Number.isFinite(size) || size <= 0) return null;
  return (Number(qty) || 0) / size;
}

/**
 * @param {number} qty
 * @param {number} packSize
 * @param {string} packLabel
 * @param {boolean} [roundUp]
 * @returns {string|null}
 */
export function formatPack(qty, packSize, packLabel, roundUp = false) {
  let n = packCount(qty, packSize);
  if (n == null) return null;
  if (roundUp) {
    n = n <= 0 ? 0 : Math.ceil(n - 1e-9);
  } else {
    n = Math.round(n * 100) / 100;
  }
  const label = pluralizePack(packLabel, n);
  return `${formatNumber(n)} ${label}`;
}

/**
 * @param {number} qty
 * @param {Ingredient} ingredient
 * @returns {{ primary: string, pack: string|null }}
 */
export function formatNeed(qty, ingredient) {
  const primary = formatQty(qty, ingredient?.unit);
  const pack = formatPack(
    qty,
    ingredient?.packSize,
    ingredient?.packLabel,
    Boolean(ingredient?.packRoundUp)
  );
  return { primary, pack };
}

/**
 * @param {number} qty
 * @param {Ingredient} ingredient
 * @returns {{ primary: string, pack: string|null }}
 */
export function formatNeedTotal(qty, ingredient) {
  const primary = formatQtyTotal(qty, ingredient?.unit);
  const pack = formatPack(
    qty,
    ingredient?.packSize,
    ingredient?.packLabel,
    true
  );
  return { primary, pack };
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  const x = Number(n) || 0;
  if (Number.isInteger(x)) {
    return x.toLocaleString('en-US');
  }
  const rounded = Math.round(x * 100) / 100;
  const fixed = Number(rounded.toFixed(2));
  return fixed.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Apply a whole-number safety buffer % to a total (rounds up to a whole number).
 * @param {number} qty
 * @param {number} bufferPct
 * @returns {number}
 */
export function applyBufferedQty(qty, bufferPct) {
  const pct = Number(bufferPct) || 0;
  if (pct <= 0) return Number(qty) || 0;
  const raw = (Number(qty) || 0) * (1 + pct / 100);
  return Math.ceil(raw);
}

/**
 * Week total column qty: optional buffer, always rounded up to a whole base unit.
 * @param {number} qty
 * @param {number} [bufferPct]
 * @returns {number}
 */
export function totalColumnQty(qty, bufferPct = 0) {
  const base = Number(qty) || 0;
  const adjusted = bufferPct > 0 ? applyBufferedQty(base, bufferPct) : base;
  return Math.ceil(adjusted);
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatCups(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}

/** @param {Date} d */
export function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** @param {string} key @returns {Date|null} */
export function parseDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, day] = key.split('-').map(Number);
  const d = new Date(y, m - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) return null;
  return d;
}

/** Monday of the week containing `date` (local). */
export function mondayOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d;
}

/**
 * @param {string|null|undefined} weekStart
 * @returns {Record<string, Date>|null}
 */
export function datesForWeek(weekStart) {
  const mon = parseDateKey(weekStart || '');
  if (!mon) return null;
  /** @type {Record<string, Date>} */
  const out = {};
  const ids = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    out[ids[i]] = d;
  }
  return out;
}

export function formatShortDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateLong(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return `${month} ${ordinal(d.getDate())}`;
}

export function formatDateCompact(d) {
  return formatShortDate(d);
}

export function formatWeekdayLong(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

/** @param {number} n */
export function ordinal(n) {
  const v = Number(n) || 0;
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

export function formatWeekRange(weekStart) {
  const dates = datesForWeek(weekStart);
  if (!dates) return '';
  const start = dates.mon;
  const end = dates.sun;
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}–${end.getDate()}`;
  }
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/**
 * @param {string} dateKey YYYY-MM-DD
 * @returns {string|null}
 */
export function weekStartFromPickedDate(dateKey) {
  const d = parseDateKey(dateKey);
  if (!d) return null;
  return toDateKey(mondayOfWeek(d));
}

/**
 * Plain-text week summary for download (totals only).
 * @param {ForecastState} state
 * @param {{ generatedAt?: Date }} [opts]
 * @returns {string}
 */
export function buildForecastSnapshot(state, opts = {}) {
  const generatedAt = opts.generatedAt || new Date();
  const name = state.eventName?.trim() || state.eventId || 'Untitled event';
  const matrix = needMatrixFromState(state);
  const revenue = revenueMatrixFromState(state);
  const bufferPct = Number(state.needBufferPct) || 0;
  const cups = totalColumnQty(matrix.totalCups, bufferPct);

  /** @type {string[]} */
  const lines = [name, eventServiceLabel(state.eventServiceType)];
  const week = formatWeekRange(state.weekStart);
  if (week) lines.push(`Week: ${week}`);
  if (bufferPct > 0) lines.push(`Buffer: ${bufferPct}%`);
  lines.push('');
  lines.push(`Target cups (week total): ${formatCups(cups)}`);
  if (tracksEventRevenue(state.eventServiceType)) {
    lines.push(`Est. revenue (week total): ${formatMoney(totalColumnQty(revenue.total, bufferPct))}`);
  }
  lines.push('');
  lines.push('Ingredients');
  if (matrix.rows.length === 0) {
    lines.push('(none)');
  } else {
    for (const row of matrix.rows) {
      const qty = totalColumnQty(row.total, bufferPct);
      const { primary, pack } = formatNeedTotal(qty, row.ingredient);
      const detail = pack ? `${primary} (${pack})` : primary;
      lines.push(`• ${row.ingredient.name}: ${detail}`);
    }
  }
  lines.push('');
  lines.push(
    `Generated ${generatedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
  );
  return lines.join('\n');
}

/**
 * @param {ForecastState} state
 * @returns {string}
 */
export function forecastSnapshotFilename(state) {
  const slug = (state.eventName?.trim() || 'forecast')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'forecast';
  const week = state.weekStart || 'week';
  return `${slug}-${week}-snapshot.png`;
}
