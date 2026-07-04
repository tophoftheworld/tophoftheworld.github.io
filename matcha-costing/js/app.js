import {
  defaultScenario, defaultAccordionState, newId, defaultIngredients,
  eventDefaults, storeDefaults, SETUP_TYPES, EXPLORE_MODES,
  defaultStaffRates, staffCostPerDay,
  defaultEventCostLines, defaultMonthlyFixedLines,
} from './defaults.js';
import { computeResults, dailyStaffCost } from './model.js';
import { parseNum, peso } from './format.js';
import { loadDraft, saveDraft, saveUiState } from './storage.js';
import {
  renderWorkspace, renderSettingsDrawer, renderIngredientsTable, renderCompactCostLines,
  renderResultsPanel, renderResultStrip,
} from './ui-zones.js';
import { wireTableEvents } from './ui-tables.js';

/** @typedef {import('./model.js').Scenario} Scenario */

const GENERIC_EVENT_COST_NAMES = new Set([
  'setup & logistics', 'setup', 'setup and logistics',
  'event costs', 'event cost', 'one-time event costs',
]);

/** @param {import('./defaults.js').CostLine[]} lines */
function isGenericLumpEventCosts(lines) {
  if (!lines || lines.length !== 1) return false;
  return GENERIC_EVENT_COST_NAMES.has(lines[0].name.trim().toLowerCase());
}

const root = document.getElementById('app');

/** @type {Scenario} */
let scenario = migrateDraft(loadDraft()) ?? defaultScenario();

/** @type {Record<string, boolean>} */
let accordion = defaultAccordionState();

let waterfallExpanded = false;

/** @type {ReturnType<typeof computeResults>} */
let results = computeResults(scenario);

/** @param {Scenario|null} draft */
function migrateDraft(draft) {
  if (!draft) return null;

  if (draft.eventCosts != null && !draft.eventCostLines?.length) {
    draft.eventCostLines = [{ id: newId(), name: 'Setup & logistics', amount: draft.eventCosts }];
    delete draft.eventCosts;
  }
  if (draft.monthlyFixed != null && !draft.monthlyFixedLines?.length) {
    draft.monthlyFixedLines = [{ id: newId(), name: 'Operating costs', amount: draft.monthlyFixed }];
    delete draft.monthlyFixed;
  }
  if (!draft.eventCostLines?.length) draft.eventCostLines = defaultEventCostLines();
  if (!draft.monthlyFixedLines?.length) draft.monthlyFixedLines = defaultMonthlyFixedLines();

  if (isGenericLumpEventCosts(draft.eventCostLines)) {
    draft.eventCostLines = defaultEventCostLines();
  }

  if (draft.setupType && draft.staffCount != null && draft.staffRates) {
    if (draft.exploreMode === 'given_sales' || draft.exploreMode === 'profit_target') {
      draft.exploreMode = EXPLORE_MODES.KNOW_SALES;
    }
    if (!draft.salesPerDay && draft.cupsPerDay != null) {
      draft.salesPerDay = Math.round(draft.cupsPerDay * 229);
      delete draft.cupsPerDay;
    }
    return draft;
  }
  const ings = draft.ingredients?.length ? draft.ingredients : defaultIngredients();
  const fresh = { ...eventDefaults(), ingredients: ings };
  if (draft.cupsPerDay != null && !draft.salesPerDay) {
    fresh.salesPerDay = Math.round(draft.cupsPerDay * 229);
  } else if (draft.staffPerDay != null && !draft.staffCount) {
    const perHead = staffCostPerDay(defaultStaffRates(), 1);
    fresh.staffCount = Math.max(1, Math.round(draft.staffPerDay / perHead));
  }
  return fresh;
}

/** @param {Scenario} from @param {Scenario} defaults */
function withSharedSettings(from, defaults) {
  return {
    ...defaults,
    exploreMode: from.exploreMode,
    ingredients: from.ingredients,
    staffRates: from.staffRates,
    dairyPrice: from.dairyPrice,
    oatPrice: from.oatPrice,
    oatUpgradePct: from.oatUpgradePct,
    spoilagePct: from.spoilagePct,
    vatApplies: from.vatApplies,
    vatRate: from.vatRate,
    eventCostLines: from.eventCostLines?.length ? from.eventCostLines : defaults.eventCostLines,
    monthlyFixedLines: from.monthlyFixedLines?.length ? from.monthlyFixedLines : defaults.monthlyFixedLines,
  };
}

function persistUi() {
  saveUiState({ waterfallExpanded });
}

/** @param {boolean} [fullRender] */
function recompute(fullRender = true) {
  results = computeResults(scenario);
  saveDraft(scenario);
  if (fullRender) render();
  else refreshLiveOutputs();
}

function refreshLiveOutputs() {
  const panel = document.getElementById('panel-results');
  if (panel) {
    panel.innerHTML = renderResultsPanel(scenario, results, waterfallExpanded);
    wireResultsEvents(panel);
  }
  const strip = document.getElementById('result-strip');
  if (strip) {
    strip.outerHTML = renderResultStrip(scenario, results);
  }
  refreshCostTotals();
  refreshSettingsSummaries();
}

function refreshCostTotals() {
  root.querySelectorAll('.expense-block').forEach((block) => {
    const key = block.querySelector('[data-cost]')?.getAttribute('data-cost');
    if (!key || !scenario[key]) return;
    const total = scenario[key].reduce((s, l) => s + Math.max(0, l.amount), 0);
    const el = block.querySelector('.expense-total, .cost-lines-total');
    if (el) el.textContent = peso(total);
  });
}

function refreshSettingsSummaries() {
  const staffNote = root.querySelector('.settings-note');
  if (staffNote) {
    const r = scenario.staffRates;
    const perHead = r.wholeDayRate + r.mealAllowance + r.transportAllowance;
    staffNote.textContent = `${scenario.staffCount} baristas × ${peso(perHead)} = ${peso(dailyStaffCost(scenario))}/day`;
  }
  const ingSummary = root.querySelector('[data-accordion="ingredients"] summary');
  if (ingSummary) {
    ingSummary.textContent = `Ingredient costs · dairy ${peso(results.cogsDairy)} · oat ${peso(results.cogsOat)}`;
  }
}

function render() {
  root.innerHTML = `
    <header class="app-header">
      <h1>Matchanese Costing</h1>
      <button type="button" class="settings-link" data-action="open-settings">Settings</button>
    </header>
    ${renderWorkspace(scenario, results, waterfallExpanded)}
    ${renderSettingsDrawer(scenario, results, accordion)}
  `;
  wireEvents();
  if (accordion.ingredients) refreshIngredients();
  if (accordion.monthly && scenario.setupType === SETUP_TYPES.STORE) refreshMonthlyCosts();
  const eventCosts = document.getElementById('eventCostLines-panel');
  if (eventCosts) wireTableEvents(eventCosts, tableHandlers);
}

function refreshIngredients() {
  const ing = document.getElementById('ingredients-panel');
  if (ing) {
    ing.innerHTML = renderIngredientsTable(scenario.ingredients);
    wireTableEvents(ing, tableHandlers);
  }
}

function refreshMonthlyCosts() {
  const panel = document.getElementById('monthlyFixedLines-panel');
  if (panel) {
    panel.innerHTML = renderCompactCostLines(
      'monthlyFixedLines', scenario.monthlyFixedLines, 'Monthly operating costs', { bare: true },
    );
    wireTableEvents(panel, tableHandlers);
  }
}

/** @param {'eventCostLines'|'monthlyFixedLines'} key */
function refreshCostLines(key) {
  const panel = document.getElementById(`${key}-panel`);
  if (!panel) return;
  const title = key === 'eventCostLines' ? 'One-time event costs' : 'Monthly operating costs';
  panel.outerHTML = renderCompactCostLines(key, scenario[key], title);
  const next = document.getElementById(`${key}-panel`);
  if (next) wireTableEvents(next, tableHandlers);
}

/**
 * @param {HTMLElement} el
 * @param {{ allowEmpty?: boolean }} [opts]
 * @returns {boolean} whether scenario changed
 */
function applyField(el, opts = {}) {
  const field = el.getAttribute('data-field');
  if (!field) return false;

  if (field === 'vatApplies') {
    scenario.vatApplies = /** @type {HTMLInputElement} */ (el).checked;
    return true;
  }
  if (field === 'vatRatePct') {
    const n = parseNum(/** @type {HTMLInputElement} */ (el).value);
    if (n === null && opts.allowEmpty) return false;
    scenario.vatRate = (n ?? 0) / 100;
    return true;
  }
  if (field.startsWith('staffRates.')) {
    const key = field.split('.')[1];
    const n = parseNum(/** @type {HTMLInputElement} */ (el).value);
    if (n === null && opts.allowEmpty) return false;
    scenario.staffRates[key] = n ?? 0;
    return true;
  }

  const n = parseNum(/** @type {HTMLInputElement} */ (el).value);
  if (n === null) {
    if (opts.allowEmpty) return false;
    // @ts-expect-error dynamic
    scenario[field] = 0;
    return true;
  }
  // @ts-expect-error dynamic
  scenario[field] = n;
  return true;
}

const tableHandlers = {
  addRoster() {},
  removeRoster() {},
  updateRoster() {},
  /** @param {'eventCostLines'|'monthlyFixedLines'} key */
  addCost(key) {
    if (!key || !scenario[key]) return;
    scenario[key].push({ id: newId(), name: 'New item', amount: 0 });
    if (key === 'eventCostLines') refreshCostLines(key);
    else refreshMonthlyCosts();
    recompute(false);
  },
  /** @param {'eventCostLines'|'monthlyFixedLines'} key @param {number} i */
  removeCost(key, i) {
    if (!key || !scenario[key]) return;
    scenario[key].splice(i, 1);
    if (key === 'eventCostLines') refreshCostLines(key);
    else refreshMonthlyCosts();
    recompute(false);
  },
  /** @param {'eventCostLines'|'monthlyFixedLines'} key @param {number} i @param {string} field */
  updateCost(key, i, field, value) {
    const line = scenario[key]?.[i];
    if (!line) return;
    if (field === 'name') {
      line.name = String(value);
      return;
    }
    const n = parseNum(value);
    if (n === null) return;
    line.amount = Math.max(0, n);
    recompute(false);
  },
  addIngredient() {
    scenario.ingredients.push({
      id: newId(), name: 'New ingredient', bulkQty: 1000, bulkCost: 0, unit: 'g', qtyPerServing: 1,
    });
    refreshIngredients();
    recompute(false);
  },
  removeIngredient(i) {
    scenario.ingredients.splice(i, 1);
    refreshIngredients();
    recompute(false);
  },
  updateIngredient(i, field, value) {
    const ing = scenario.ingredients[i];
    if (!ing) return;
    if (field === 'name' || field === 'unit') {
      ing[field] = String(value);
      return;
    }
    const n = parseNum(value);
    if (n === null) return;
    ing[field] = Math.max(0, n);
    recompute(false);
  },
};

/** @param {ParentNode} scope */
function wireResultsEvents(scope) {
  scope.querySelector('[data-action="toggle-waterfall"]')?.addEventListener('click', () => {
    waterfallExpanded = !waterfallExpanded;
    persistUi();
    refreshLiveOutputs();
  });
}

function wireEvents() {
  root.querySelectorAll('[data-field]').forEach((el) => {
    const field = el.getAttribute('data-field');
    if (!field) return;

    if (el instanceof HTMLInputElement && el.type === 'number') {
      el.addEventListener('input', () => {
        if (applyField(el, { allowEmpty: true })) recompute(false);
      });
      el.addEventListener('change', () => {
        if (applyField(el, { allowEmpty: false })) recompute(false);
      });
      return;
    }

    el.addEventListener('change', () => {
      if (applyField(el)) recompute(el.getAttribute('data-field') === 'vatApplies');
    });
  });

  root.querySelectorAll('[data-explore]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-explore');
      if (mode) {
        scenario.exploreMode = mode;
        recompute();
      }
    });
  });

  root.querySelectorAll('[data-setup]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const setup = btn.getAttribute('data-setup');
      if (setup === SETUP_TYPES.EVENT) {
        scenario = withSharedSettings(scenario, eventDefaults());
      } else if (setup === SETUP_TYPES.STORE) {
        scenario = withSharedSettings(scenario, storeDefaults());
      }
      recompute();
    });
  });

  root.querySelectorAll('[data-rent]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rent = btn.getAttribute('data-rent');
      if (rent) {
        scenario.rentMode = rent;
        recompute();
      }
    });
  });

  root.querySelectorAll('.accordion, .settings-group').forEach((det) => {
    det.addEventListener('toggle', () => {
      const key = det.getAttribute('data-accordion');
      if (key) {
        accordion[key] = det.open;
        if (key === 'ingredients' && det.open) refreshIngredients();
        if (key === 'monthly' && det.open) refreshMonthlyCosts();
      }
    });
  });

  root.querySelector('[data-action="open-settings"]')?.addEventListener('click', () => {
    accordion.settingsOpen = true;
    const modal = document.getElementById('settings-modal');
    modal?.classList.add('open');
    if (accordion.monthly && scenario.setupType === SETUP_TYPES.STORE) refreshMonthlyCosts();
  });

  root.querySelectorAll('[data-action="close-settings"]').forEach((el) => {
    el.addEventListener('click', () => {
      accordion.settingsOpen = false;
      document.getElementById('settings-modal')?.classList.remove('open');
    });
  });

  if (!root.dataset.settingsKeybound) {
    root.dataset.settingsKeybound = '1';
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && accordion.settingsOpen) {
        accordion.settingsOpen = false;
        document.getElementById('settings-modal')?.classList.remove('open');
      }
    });
  }

  wireResultsEvents(root);
}

render();
