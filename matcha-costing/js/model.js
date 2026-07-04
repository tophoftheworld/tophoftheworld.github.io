import { computeCogs } from './ingredients.js';
import { RENT_MODES, EXPLORE_MODES, staffCostPerDay } from './defaults.js';

/**
 * @typedef {Object} Scenario
 * @property {string} setupType
 * @property {string} exploreMode
 * @property {number} salesPerDay
 * @property {number} oatUpgradePct
 * @property {number} days
 * @property {number} staffCount
 * @property {{ wholeDayRate: number, mealAllowance: number, transportAllowance: number }} staffRates
 * @property {import('./defaults.js').CostLine[]} eventCostLines
 * @property {import('./defaults.js').CostLine[]} monthlyFixedLines
 * @property {string} rentMode
 * @property {number} fixedDaily
 * @property {number} fixedMonthly
 * @property {number} turnoverPct
 * @property {number} floorPeriod
 * @property {number} dairyPrice
 * @property {number} oatPrice
 * @property {boolean} vatApplies
 * @property {number} vatRate
 * @property {number} spoilagePct
 * @property {import('./defaults.js').Ingredient[]} ingredients
 */

/**
 * @param {Scenario} scenario
 * @param {number} cogsDairy
 * @param {number} cogsOat
 */
export function perCupEconomics(scenario, cogsDairy, cogsOat) {
  const oatShare = Math.min(100, Math.max(0, scenario.oatUpgradePct)) / 100;
  const dairyShare = 1 - oatShare;
  const avgPrice = scenario.dairyPrice * dairyShare + scenario.oatPrice * oatShare;
  const spoilageMult = 1 + scenario.spoilagePct / 100;
  const cogsDairyEff = cogsDairy * spoilageMult;
  const cogsOatEff = cogsOat * spoilageMult;
  const avgCogs = cogsDairyEff * dairyShare + cogsOatEff * oatShare;
  const vatPerCup = scenario.vatApplies
    ? avgPrice * scenario.vatRate / (1 + scenario.vatRate)
    : 0;
  const turnoverShare = scenario.turnoverPct / 100;
  const contributionExclRent = avgPrice - avgCogs - vatPerCup;
  const contributionAfterTurnover = contributionExclRent - avgPrice * turnoverShare;

  return {
    oatShare,
    dairyShare,
    avgPrice,
    avgCogs,
    vatPerCup,
    contributionExclRent,
    contributionAfterTurnover,
    cogsDairyEff,
    cogsOatEff,
  };
}

/** @param {Scenario} scenario */
export function dailyStaffCost(scenario) {
  const rates = scenario.staffRates ?? { wholeDayRate: 0, mealAllowance: 0, transportAllowance: 0 };
  return staffCostPerDay(rates, scenario.staffCount ?? 0);
}

/** @param {import('./defaults.js').CostLine[]} lines */
function sumLines(lines) {
  return (lines || []).reduce((s, l) => s + Math.max(0, l.amount), 0);
}

/** @param {Scenario} scenario */
export function periodFixedCosts(scenario) {
  const staff = dailyStaffCost(scenario) * scenario.days;
  const event = scenario.setupType === 'event' ? sumLines(scenario.eventCostLines) : 0;
  const monthly = scenario.setupType === 'store' ? sumLines(scenario.monthlyFixedLines) : 0;
  return { staff, event, monthly, other: event + monthly };
}

/**
 * @param {number} volumeCups
 * @param {Scenario} scenario
 * @param {{ avgPrice: number }} cup
 */
export function rentAtVolume(volumeCups, scenario, cup) {
  const revenue = volumeCups * cup.avgPrice;
  const turnoverShare = scenario.turnoverPct / 100;

  switch (scenario.rentMode) {
    case RENT_MODES.FIXED_DAILY:
      return scenario.fixedDaily * scenario.days;
    case RENT_MODES.FIXED_MONTHLY:
      return scenario.fixedMonthly;
    case RENT_MODES.TURNOVER_PCT:
      return revenue * turnoverShare;
    case RENT_MODES.MAX_FLOOR:
      return Math.max(scenario.floorPeriod, revenue * turnoverShare);
    default:
      return 0;
  }
}

/** @param {Scenario} scenario @param {{ avgPrice: number, contributionExclRent: number, contributionAfterTurnover: number }} cup */
export function fixedRentPeriod(scenario, cup) {
  if (scenario.rentMode === RENT_MODES.FIXED_DAILY) {
    return scenario.fixedDaily * scenario.days;
  }
  if (scenario.rentMode === RENT_MODES.FIXED_MONTHLY) {
    return scenario.fixedMonthly;
  }
  return rentAtVolume(0, scenario, cup);
}

/**
 * @param {Scenario} scenario
 * @param {{ contributionExclRent: number, contributionAfterTurnover: number, avgPrice: number }} cup
 * @param {number} extraNumerator
 */
export function solveVolumeCups(scenario, cup, extraNumerator = 0) {
  const fixed = periodFixedCosts(scenario);
  const numerator = fixed.staff + fixed.other + extraNumerator;

  if (scenario.rentMode === RENT_MODES.TURNOVER_PCT) {
    const denom = cup.contributionAfterTurnover;
    if (denom <= 0) return null;
    return numerator / denom;
  }

  if (scenario.rentMode === RENT_MODES.MAX_FLOOR) {
    const turnoverShare = scenario.turnoverPct / 100;
    const floor = scenario.floorPeriod;
    const vx = turnoverShare > 0 && cup.avgPrice > 0
      ? floor / (cup.avgPrice * turnoverShare)
      : Infinity;
    const denomExcl = cup.contributionExclRent;
    if (denomExcl <= 0) return null;
    const cupsFloor = (numerator + floor) / denomExcl;
    if (cupsFloor <= vx) return cupsFloor;
    const denomAfter = cup.contributionAfterTurnover;
    if (denomAfter <= 0) return null;
    return numerator / denomAfter;
  }

  const rent = fixedRentPeriod(scenario, cup);
  const denom = cup.contributionExclRent;
  if (denom <= 0) return null;
  return (numerator + rent) / denom;
}

/**
 * @param {number} volumeCups
 * @param {Scenario} scenario
 */
export function pnlAtVolume(volumeCups, scenario) {
  const { cogsDairy, cogsOat } = computeCogs(scenario.ingredients);
  const cup = perCupEconomics(scenario, cogsDairy, cogsOat);
  const fixed = periodFixedCosts(scenario);
  const revenue = volumeCups * cup.avgPrice;
  const cogs = volumeCups * cup.avgCogs;
  const vat = volumeCups * cup.vatPerCup;
  const rent = rentAtVolume(volumeCups, scenario, cup);
  const profit = revenue - cogs - vat - rent - fixed.staff - fixed.other;
  const margin = revenue > 0 ? (profit / revenue) * 100 : null;

  return {
    volumeCups,
    revenue,
    cogs,
    vat,
    rent,
    staff: fixed.staff,
    otherFixed: fixed.other,
    profit,
    margin,
    cup,
    fixed,
  };
}

/** @param {number} salesPerDay @param {number} avgPrice */
export function cupsPerDayFromSales(salesPerDay, avgPrice) {
  if (!avgPrice || avgPrice <= 0) return 0;
  return salesPerDay / avgPrice;
}

/** @param {Scenario} scenario */
export function computeResults(scenario) {
  const days = Math.max(0, scenario.days);

  const { cogsDairy, cogsOat, base } = computeCogs(scenario.ingredients);
  const cup = perCupEconomics(scenario, cogsDairy, cogsOat);

  const beCups = solveVolumeCups(scenario, cup, 0);
  const beCupsPerDay = beCups != null && days > 0 ? beCups / days : null;
  const beSalesPerDay = beCupsPerDay != null ? beCupsPerDay * cup.avgPrice : null;

  const salesCupsPerDay = cupsPerDayFromSales(scenario.salesPerDay, cup.avgPrice);

  let effectiveCupsPerDay = salesCupsPerDay;
  if (scenario.exploreMode === EXPLORE_MODES.BREAK_EVEN && beCupsPerDay != null) {
    effectiveCupsPerDay = beCupsPerDay;
  }

  const targetCups = effectiveCupsPerDay * days;
  const targetPnl = pnlAtVolume(targetCups, scenario);

  const dialCups = salesCupsPerDay * days;
  const targetVsBe = beCups != null && beCups > 0 && dialCups > 0
    ? (dialCups / beCups - 1) * 100
    : null;

  return {
    cogsDairy,
    cogsOat,
    cogsBase: base,
    cup,
    salesCupsPerDay,
    effectiveCupsPerDay,
    targetCups,
    targetPnl,
    beCups,
    beCupsPerDay,
    beSalesPerDay,
    beRevenuePeriod: beCups != null ? beCups * cup.avgPrice : null,
    beRevenuePerDay: beSalesPerDay,
    profitPerDay: days > 0 ? targetPnl.profit / days : null,
    targetVsBe,
    dailyStaff: dailyStaffCost(scenario),
  };
}

/** @param {string} rentMode */
export function rentModeLabel(rentMode) {
  switch (rentMode) {
    case RENT_MODES.FIXED_DAILY: return 'Fixed daily';
    case RENT_MODES.FIXED_MONTHLY: return 'Fixed monthly';
    case RENT_MODES.TURNOVER_PCT: return '% turnover';
    case RENT_MODES.MAX_FLOOR: return 'Max (floor, % turnover)';
    default: return rentMode;
  }
}
