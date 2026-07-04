import { peso, pct } from './format.js';
import { SETUP_TYPES } from './defaults.js';

/**
 * @param {import('./model.js').Scenario} scenario
 * @param {ReturnType<import('./model.js').computeResults>} results
 * @param {boolean} expanded
 */
export function renderWaterfall(scenario, results, expanded) {
  const pnl = results.targetPnl;
  const isEvent = scenario.setupType === SETUP_TYPES.EVENT;
  const lines = isEvent ? scenario.eventCostLines : scenario.monthlyFixedLines;
  const fixedLabel = isEvent ? 'Logistics' : 'Operating';

  const fixedDetail = expanded && lines?.length
    ? lines.map((l) => `
      <div class="wf-row wf-sub"><span>${l.name}</span><span>−${peso(l.amount)}</span></div>`).join('')
    : '';

  const rows = expanded ? `
    <div class="waterfall-body">
      <div class="wf-row"><span>Revenue</span><span>${peso(pnl.revenue)}</span></div>
      <div class="wf-row"><span>COGS</span><span>−${peso(pnl.cogs)}</span></div>
      <div class="wf-row"><span>VAT</span><span>−${peso(pnl.vat)}</span></div>
      <div class="wf-row"><span>Staff</span><span>−${peso(pnl.staff)}</span></div>
      <div class="wf-row"><span>Rent</span><span>−${peso(pnl.rent)}</span></div>
      <div class="wf-row"><span>${fixedLabel}</span><span>−${peso(pnl.otherFixed)}</span></div>
      ${fixedDetail}
      <div class="wf-row wf-total ${pnl.profit >= 0 ? 'positive' : 'negative'}">
        <span>Profit (${pct(pnl.margin)})</span><span>${peso(pnl.profit)}</span>
      </div>
    </div>` : '';

  return `
    <button type="button" class="waterfall-toggle" data-action="toggle-waterfall">
      View breakdown ${expanded ? '▾' : '▸'}
    </button>
    ${rows}`;
}
