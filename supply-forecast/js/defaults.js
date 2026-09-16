/** @typedef {{ id: string, weekday: number, label: string, enabled: boolean, cups: number }} Day */

/** @typedef {'matcha'|'milk'|null} IngredientRole */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   unit: string,
 *   packSize: number,
 *   packLabel: string,
 *   packRoundUp: boolean,
 *   role: IngredientRole
 * }} Ingredient
 */

/** @typedef {{ ingredientId: string, qtyPerCup: number }} DrinkLine */

/** @typedef {{ id: string, name: string, lines: DrinkLine[] }} Drink */

/** @typedef {{ drinkId: string, pct: number, cups: number, price: number }} DrinkMixEntry */

/** @typedef {{ ingredientId: string, pct: number }} MilkMixEntry */

/** @typedef {{ l1: number, l2: number, l3: number }} LevelMix */

/** @typedef {{ oat: number, l1: number, l2: number, l3: number }} AddonPrices */

/** @typedef {'popup'|'package'|'planning'} EventServiceType */

export const EVENT_SERVICE_TYPES = [
  {
    value: 'popup',
    label: 'Pop-up service',
    hint: 'Selling at the bar — track prices and est. revenue.',
  },
  {
    value: 'package',
    label: 'Package service',
    hint: 'Pre-paid package — cup targets and ingredients only, no sales tracking.',
  },
  {
    value: 'planning',
    label: 'Planning only',
    hint: 'Internal forecast — cups and ingredients only.',
  },
];

/**
 * @param {EventServiceType|unknown} type
 * @returns {boolean}
 */
export function tracksEventRevenue(type) {
  return type === 'popup';
}

/**
 * @param {EventServiceType|unknown} type
 * @returns {string}
 */
export function eventServiceLabel(type) {
  const found = EVENT_SERVICE_TYPES.find((t) => t.value === type);
  return found ? found.label : 'Pop-up service';
}

/**
 * @param {unknown} raw
 * @returns {EventServiceType}
 */
export function normalizeEventServiceType(raw) {
  if (raw === 'popup' || raw === 'package' || raw === 'planning') return raw;
  return 'popup';
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
export function normalizeNeedBufferPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

/**
 * @typedef {{
 *   eventId: string,
 *   eventName: string,
 *   eventServiceType: EventServiceType,
 *   weekStart: string,
 *   days: Day[],
 *   ingredients: Ingredient[],
 *   drinks: Drink[],
 *   menuDrinkIds: string[],
 *   drinkMix: DrinkMixEntry[],
 *   milkMix: MilkMixEntry[],
 *   levelMix: LevelMix,
 *   addonPrices: AddonPrices,
 *   needBufferPct: number
 * }} ForecastState
 */

export const INGREDIENT_ROLES = [
  { value: '', label: '—' },
  { value: 'matcha', label: 'Matcha' },
  { value: 'milk', label: 'Milk' },
];

/** Recipe placeholder: milk volume; split by Forecast milkMix, not a stock SKU. */
export const MILK_LINE_ID = '__milk__';

export const MATCHA_LEVEL_G = { l1: 4, l2: 6, l3: 8 };

/** weekday: 0=Sun … 6=Sat; calendar order Mon→Sun */
const WEEKDAY_META = [
  { id: 'mon', weekday: 1, label: 'Mon' },
  { id: 'tue', weekday: 2, label: 'Tue' },
  { id: 'wed', weekday: 3, label: 'Wed' },
  { id: 'thu', weekday: 4, label: 'Thu' },
  { id: 'fri', weekday: 5, label: 'Fri' },
  { id: 'sat', weekday: 6, label: 'Sat' },
  { id: 'sun', weekday: 0, label: 'Sun' },
];

const DEFAULT_ENABLED = new Set(['wed', 'thu', 'fri', 'sat', 'sun']);

/** @returns {string} */
export function newId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** @returns {Day[]} */
export function defaultDays() {
  return WEEKDAY_META.map((d) => ({
    ...d,
    enabled: DEFAULT_ENABLED.has(d.id),
    cups: 0,
  }));
}

/** @returns {Ingredient[]} */
export function defaultIngredients() {
  return [
    {
      id: 'matcha',
      name: 'Matcha',
      unit: 'g',
      packSize: 0,
      packLabel: '',
      packRoundUp: false,
      role: 'matcha',
    },
    {
      id: 'dairy',
      name: 'Dairy milk',
      unit: 'ml',
      packSize: 0,
      packLabel: '',
      packRoundUp: false,
      role: 'milk',
    },
    {
      id: 'oatside',
      name: 'Milk (Oatside)',
      unit: 'ml',
      packSize: 6000,
      packLabel: 'box',
      packRoundUp: true,
      role: 'milk',
    },
  ];
}

/** @returns {Drink[]} */
export function defaultDrinks() {
  return [
    {
      id: 'signature-latte',
      name: 'Signature Latte',
      lines: [
        { ingredientId: 'matcha', qtyPerCup: 4 },
        { ingredientId: MILK_LINE_ID, qtyPerCup: 130 },
      ],
    },
  ];
}

/** @returns {LevelMix} */
export function defaultLevelMix() {
  return { l1: 100, l2: 0, l3: 0 };
}

/** @returns {AddonPrices} */
export function defaultAddonPrices() {
  return { oat: 0, l1: 0, l2: 0, l3: 0 };
}

/** @returns {MilkMixEntry[]} */
export function defaultMilkMix() {
  return [
    { ingredientId: 'dairy', pct: 30 },
    { ingredientId: 'oatside', pct: 70 },
  ];
}

/**
 * Current week's Monday as YYYY-MM-DD (local).
 * @returns {string}
 */
export function currentWeekStartKey() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

/** @returns {ForecastState} */
export function defaultState() {
  const drinks = defaultDrinks();
  return {
    eventId: 'default',
    eventName: '',
    eventServiceType: 'popup',
    weekStart: currentWeekStartKey(),
    days: defaultDays(),
    ingredients: defaultIngredients(),
    drinks,
    menuDrinkIds: drinks.map((d) => d.id),
    drinkMix: drinks.map((d) => ({ drinkId: d.id, pct: 100, cups: 0, price: 0 })),
    milkMix: defaultMilkMix(),
    levelMix: defaultLevelMix(),
    addonPrices: defaultAddonPrices(),
    needBufferPct: 0,
  };
}

export { WEEKDAY_META };
