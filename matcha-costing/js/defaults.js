/** @typedef {{ id: string, name: string, bulkQty: number, bulkCost: number, unit: string, qtyPerServing: number }} Ingredient */

export const RENT_MODES = {
  FIXED_DAILY: 'fixed_daily',
  FIXED_MONTHLY: 'fixed_monthly',
  TURNOVER_PCT: 'turnover_pct',
  MAX_FLOOR: 'max_floor',
};

export const SETUP_TYPES = {
  EVENT: 'event',
  STORE: 'store',
};

export const EXPLORE_MODES = {
  KNOW_SALES: 'know_sales',
  BREAK_EVEN: 'break_even',
};

/** @returns {string} */
export function newId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** @returns {Ingredient[]} */
export function defaultIngredients() {
  return [
    { id: newId(), name: 'Matcha Powder', bulkQty: 10000, bulkCost: 139500, unit: 'g', qtyPerServing: 4 },
    { id: newId(), name: 'Full Cream Milk', bulkQty: 12000, bulkCost: 900, unit: 'ml', qtyPerServing: 130 },
    { id: newId(), name: 'Oat Milk', bulkQty: 6000, bulkCost: 800, unit: 'ml', qtyPerServing: 130 },
    { id: newId(), name: 'Sugar Syrup', bulkQty: 2000, bulkCost: 99, unit: 'ml', qtyPerServing: 10 },
    { id: newId(), name: 'Ice', bulkQty: 5000, bulkCost: 65, unit: 'g', qtyPerServing: 120 },
    { id: newId(), name: '12oz Cup', bulkQty: 1000, bulkCost: 2250, unit: 'pc', qtyPerServing: 1 },
    { id: newId(), name: 'Lid', bulkQty: 1000, bulkCost: 999, unit: 'pc', qtyPerServing: 1 },
    { id: newId(), name: 'Sticker', bulkQty: 2500, bulkCost: 2400, unit: 'pc', qtyPerServing: 1 },
    { id: newId(), name: 'Straw', bulkQty: 500, bulkCost: 550, unit: 'pc', qtyPerServing: 1 },
  ];
}

export const RECIPE_BASE_NAMES = [
  'Matcha Powder', 'Sugar Syrup', 'Ice', '12oz Cup', 'Lid', 'Sticker', 'Straw',
];
export const RECIPE_DAIRY_MILK = 'Full Cream Milk';
export const RECIPE_OAT_MILK = 'Oat Milk';

/** @typedef {{ id: string, name: string, amount: number }} CostLine */

/** @returns {CostLine[]} */
export function defaultEventCostLines() {
  return [
    { id: newId(), name: 'Booth / setup', amount: 8000 },
    { id: newId(), name: 'Transport', amount: 4000 },
    { id: newId(), name: 'Permits', amount: 2000 },
    { id: newId(), name: 'Equipment rental', amount: 0 },
    { id: newId(), name: 'Marketing', amount: 1000 },
  ];
}

/** @returns {CostLine[]} */
export function defaultMonthlyFixedLines() {
  return [
    { id: newId(), name: 'Electricity', amount: 5000 },
    { id: newId(), name: 'Water', amount: 1000 },
    { id: newId(), name: 'Internet', amount: 1500 },
    { id: newId(), name: 'POS / software', amount: 1000 },
    { id: newId(), name: 'Maintenance', amount: 500 },
  ];
}

/** @typedef {{ wholeDayRate: number, mealAllowance: number, transportAllowance: number }} StaffRates */

/** @returns {StaffRates} */
export function defaultStaffRates() {
  return { wholeDayRate: 700, mealAllowance: 150, transportAllowance: 100 };
}

/** @param {StaffRates} rates @param {number} count */
export function staffCostPerDay(rates, count) {
  const perHead = rates.wholeDayRate + rates.mealAllowance + rates.transportAllowance;
  return Math.max(0, count) * perHead;
}

/** @returns {import('./model.js').Scenario} */
export function defaultScenario() {
  return eventDefaults();
}

/** @returns {import('./model.js').Scenario} */
export function eventDefaults() {
  return {
    setupType: SETUP_TYPES.EVENT,
    exploreMode: EXPLORE_MODES.KNOW_SALES,
    salesPerDay: 25000,
    oatUpgradePct: 30,
    days: 3,
    staffCount: 4,
    staffRates: defaultStaffRates(),
    eventCostLines: defaultEventCostLines(),
    monthlyFixedLines: defaultMonthlyFixedLines(),

    rentMode: RENT_MODES.FIXED_DAILY,
    fixedDaily: 5000,
    fixedMonthly: 0,
    turnoverPct: 15,
    floorPeriod: 0,

    dairyPrice: 220,
    oatPrice: 250,
    vatApplies: false,
    vatRate: 0.12,
    spoilagePct: 5,

    ingredients: defaultIngredients(),
  };
}

/** @returns {import('./model.js').Scenario} */
export function storeDefaults() {
  return {
    setupType: SETUP_TYPES.STORE,
    exploreMode: EXPLORE_MODES.KNOW_SALES,
    salesPerDay: 18500,
    oatUpgradePct: 30,
    days: 26,
    staffCount: 2,
    staffRates: defaultStaffRates(),
    eventCostLines: [],
    monthlyFixedLines: defaultMonthlyFixedLines(),

    rentMode: RENT_MODES.MAX_FLOOR,
    fixedDaily: 0,
    fixedMonthly: 0,
    turnoverPct: 22.4,
    floorPeriod: 0,

    dairyPrice: 220,
    oatPrice: 250,
    vatApplies: true,
    vatRate: 0.12,
    spoilagePct: 0,

    ingredients: defaultIngredients(),
  };
}

/** @returns {Record<string, boolean>} */
export function defaultAccordionState() {
  return { settingsOpen: false, staff: false, drink: false, monthly: false, ingredients: false };
}
