import { EXPLORE_MODES, RENT_MODES, SETUP_TYPES } from './defaults.js';
import { cups, peso } from './format.js';
import { renderWaterfall } from './ui-waterfall.js';
import { fieldInput, renderIngredientsTable, renderCompactCostLines } from './ui-tables.js';
import { dailyStaffCost } from './model.js';

function segBtn(group, value, label, current) {
  return `<button type="button" class="seg ${current === value ? 'active' : ''}" data-${group}="${value}">${label}</button>`;
}

/**
 * @param {import('./model.js').Scenario} scenario
 * @param {ReturnType<import('./model.js').computeResults>} results
 */
export function renderResultStrip(scenario, results) {
  const isKnowSales = scenario.exploreMode === EXPLORE_MODES.KNOW_SALES;
  if (isKnowSales) {
    const cls = (results.targetPnl.profit ?? 0) >= 0 ? 'positive' : 'negative';
    return `<div class="result-strip ${cls}" id="result-strip">${peso(results.profitPerDay)} profit / day</div>`;
  }
  return `<div class="result-strip" id="result-strip">Break even: ${cups(results.beCupsPerDay)} cups · ${peso(results.beSalesPerDay)}/day</div>`;
}

/**
 * @param {import('./model.js').Scenario} scenario
 * @param {ReturnType<import('./model.js').computeResults>} results
 * @param {boolean} waterfallExpanded
 */
export function renderResultsPanel(scenario, results, waterfallExpanded) {
  const isKnowSales = scenario.exploreMode === EXPLORE_MODES.KNOW_SALES;
  const isEvent = scenario.setupType === SETUP_TYPES.EVENT;
  const profitClass = (results.targetPnl.profit ?? 0) >= 0 ? 'positive' : 'negative';

  const resultLabel = isKnowSales ? 'Profit per day' : 'Break-even (cups / day)';
  const heroValue = isKnowSales ? peso(results.profitPerDay) : cups(results.beCupsPerDay);
  const daysLabel = isEvent ? 'days' : 'days/mo';
  const subline = isKnowSales
    ? `${peso(results.targetPnl.profit)} total · ${scenario.days} ${daysLabel}`
    : `${peso(results.beSalesPerDay)}/day sales`;

  return `
    <p class="result-label">${resultLabel}</p>
    <div class="hero ${isKnowSales ? profitClass : ''}">
      <div class="hero-value">${heroValue}</div>
    </div>
    <p class="result-subline">${subline}</p>
    ${isKnowSales ? `
      <p class="be-line">Break even: ${cups(results.beCupsPerDay)} cups · ${peso(results.beSalesPerDay)}/day</p>
    ` : ''}
    ${renderWaterfall(scenario, results, waterfallExpanded)}`;
}

/**
 * @param {import('./model.js').Scenario} scenario
 * @param {ReturnType<import('./model.js').computeResults>} results
 * @param {boolean} waterfallExpanded
 */
export function renderWorkspace(scenario, results, waterfallExpanded) {
  const isKnowSales = scenario.exploreMode === EXPLORE_MODES.KNOW_SALES;
  const isEvent = scenario.setupType === SETUP_TYPES.EVENT;
  const scenarioLabel = isEvent ? 'Your event' : 'This month';

  return `
    <div class="workspace card">
      ${renderResultStrip(scenario, results)}
      <div class="toolbar">
        <div class="toolbar-group toolbar-group--bare">
          <div class="seg-group" role="group" aria-label="Setup type">
            ${segBtn('setup', SETUP_TYPES.EVENT, 'Event', scenario.setupType)}
            ${segBtn('setup', SETUP_TYPES.STORE, 'Store', scenario.setupType)}
          </div>
        </div>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <div class="toolbar-group toolbar-group--bare">
          <div class="seg-group" role="group" aria-label="Calculation mode">
            ${segBtn('explore', EXPLORE_MODES.KNOW_SALES, 'My sales', scenario.exploreMode)}
            ${segBtn('explore', EXPLORE_MODES.BREAK_EVEN, 'Break even', scenario.exploreMode)}
          </div>
        </div>
      </div>

      <div class="main-grid">
        <div class="panel-inputs">
          <section class="input-section">
            <h3 class="section-label">${scenarioLabel}</h3>
            <div class="metrics-row">
              ${isKnowSales ? fieldInput({ label: 'Sales / day', name: 'salesPerDay', value: scenario.salesPerDay, size: 'sales', prefix: '₱' }) : ''}
              ${fieldInput({ label: isEvent ? 'Days' : 'Days / mo', name: 'days', value: scenario.days, size: 'narrow' })}
              ${fieldInput({ label: 'Baristas', name: 'staffCount', value: scenario.staffCount, size: 'narrow' })}
            </div>
          </section>

          <section class="input-section">
            <h3 class="section-label">Venue</h3>
            ${renderRentFields(scenario, isEvent)}
          </section>

          ${isEvent ? `
          <section class="input-section">
            ${renderCompactCostLines('eventCostLines', scenario.eventCostLines, 'One-time event costs')}
          </section>
          ` : ''}
        </div>

        <div class="panel-results" id="panel-results">
          ${renderResultsPanel(scenario, results, waterfallExpanded)}
        </div>
      </div>
    </div>`;
}

/** @param {import('./model.js').Scenario} scenario @param {boolean} isEvent */
function renderRentFields(scenario, isEvent) {
  const rentType = scenario.rentMode;
  const showPct = rentType === RENT_MODES.TURNOVER_PCT || rentType === RENT_MODES.MAX_FLOOR;
  const showFloor = !isEvent && rentType === RENT_MODES.MAX_FLOOR;

  const rentAmountField = rentType === RENT_MODES.FIXED_DAILY
    ? fieldInput({ label: 'Amount / day', name: 'fixedDaily', value: scenario.fixedDaily, size: 'medium', prefix: '₱' })
    : rentType === RENT_MODES.FIXED_MONTHLY
      ? fieldInput({ label: 'Amount / month', name: 'fixedMonthly', value: scenario.fixedMonthly, size: 'medium', prefix: '₱' })
      : showPct && showFloor
        ? fieldInput({ label: 'Min / month', name: 'floorPeriod', value: scenario.floorPeriod, size: 'medium', prefix: '₱' })
        : showPct
          ? fieldInput({ label: 'Turnover %', name: 'turnoverPct', value: scenario.turnoverPct, step: '0.1', size: 'narrow' })
          : '';

  const extraPct = showPct && showFloor
    ? fieldInput({ label: 'Turnover %', name: 'turnoverPct', value: scenario.turnoverPct, step: '0.1', size: 'narrow' })
    : '';

  return `
    <div class="rent-block">
      <label class="field field--rent-mode">
        <span class="field-label">Rent type</span>
        <div class="seg-group seg-compact">
          ${isEvent ? `
            ${segBtn('rent', RENT_MODES.FIXED_DAILY, '₱/day', rentType)}
            ${segBtn('rent', RENT_MODES.TURNOVER_PCT, '% sales', rentType)}
          ` : `
            ${segBtn('rent', RENT_MODES.FIXED_MONTHLY, 'Fixed', rentType)}
            ${segBtn('rent', RENT_MODES.TURNOVER_PCT, '% sales', rentType)}
            ${segBtn('rent', RENT_MODES.MAX_FLOOR, 'Min or %', rentType)}
          `}
        </div>
      </label>
      ${rentAmountField}
      ${extraPct}
    </div>`;
}

/**
 * @param {import('./model.js').Scenario} scenario
 * @param {ReturnType<import('./model.js').computeResults>} results
 * @param {Record<string, boolean>} accordion
 */
export function renderSettingsDrawer(scenario, results, accordion) {
  const open = accordion.settingsOpen ? 'open' : '';
  const isStore = scenario.setupType === SETUP_TYPES.STORE;
  const r = scenario.staffRates;
  const perHead = r.wholeDayRate + r.mealAllowance + r.transportAllowance;
  const staffDay = dailyStaffCost(scenario);

  return `
    <div class="settings-modal ${open}" id="settings-modal" aria-hidden="${accordion.settingsOpen ? 'false' : 'true'}">
      <div class="settings-backdrop" data-action="close-settings"></div>
      <div class="settings-dialog" role="dialog" aria-label="Settings" aria-modal="true">
        <div class="settings-head">
          <h2>Settings</h2>
          <button type="button" class="settings-close" data-action="close-settings" aria-label="Close">×</button>
        </div>

        <div class="settings-scroll">
          <details class="settings-group" data-accordion="staff" ${accordion.staff ? 'open' : ''}>
            <summary>Staff pay rates</summary>
            <div class="settings-body">
              <div class="settings-fields-row">
                ${fieldInput({ label: 'Day rate', name: 'staffRates.wholeDayRate', value: r.wholeDayRate, size: 'medium', prefix: '₱' })}
                ${fieldInput({ label: 'Meal allowance', name: 'staffRates.mealAllowance', value: r.mealAllowance, size: 'medium', prefix: '₱' })}
                ${fieldInput({ label: 'Transport', name: 'staffRates.transportAllowance', value: r.transportAllowance, size: 'medium', prefix: '₱' })}
              </div>
              <p class="settings-note">${scenario.staffCount} baristas × ${peso(perHead)} = ${peso(staffDay)}/day</p>
            </div>
          </details>

          <details class="settings-group" data-accordion="drink" ${accordion.drink ? 'open' : ''}>
            <summary>Drink prices &amp; mix</summary>
            <div class="settings-body">
              <p class="settings-sublabel">Menu prices</p>
              <div class="settings-fields-row">
                ${fieldInput({ label: 'Dairy', name: 'dairyPrice', value: scenario.dairyPrice, size: 'medium', prefix: '₱' })}
                ${fieldInput({ label: 'Oat', name: 'oatPrice', value: scenario.oatPrice, size: 'medium', prefix: '₱' })}
              </div>
              <p class="settings-sublabel">Mix &amp; waste</p>
              <div class="settings-fields-row settings-fields-row--compact">
                ${fieldInput({ label: 'Oat drinks %', name: 'oatUpgradePct', value: scenario.oatUpgradePct, step: '0.1', size: 'narrow' })}
                ${fieldInput({ label: 'Spoilage %', name: 'spoilagePct', value: scenario.spoilagePct, step: '0.1', size: 'narrow' })}
              </div>
              <p class="settings-sublabel">Tax</p>
              <div class="settings-vat-row">
                <label class="field field-check">
                  <input type="checkbox" name="vatApplies" data-field="vatApplies" ${scenario.vatApplies ? 'checked' : ''} />
                  <span>VAT applies</span>
                </label>
                ${scenario.vatApplies ? fieldInput({ label: 'VAT rate', name: 'vatRatePct', value: (scenario.vatRate * 100).toFixed(1), step: '0.1', size: 'narrow' }) : ''}
              </div>
            </div>
          </details>

          ${isStore ? `
          <details class="settings-group" data-accordion="monthly" ${accordion.monthly ? 'open' : ''}>
            <summary>Monthly operating costs</summary>
            <div class="settings-body settings-cost-lines">
              <div id="monthlyFixedLines-panel"></div>
            </div>
          </details>
          ` : ''}

          <details class="settings-group" data-accordion="ingredients" ${accordion.ingredients ? 'open' : ''}>
            <summary>Ingredient costs · dairy ${peso(results.cogsDairy)} · oat ${peso(results.cogsOat)}</summary>
            <div class="settings-body settings-body--wide">
              <div id="ingredients-panel">${accordion.ingredients ? renderIngredientsTable(scenario.ingredients) : ''}</div>
            </div>
          </details>
        </div>
      </div>
    </div>`;
}

export { renderIngredientsTable, renderCompactCostLines };
