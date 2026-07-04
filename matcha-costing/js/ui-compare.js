import { computeResults } from './model.js';
import { cups, peso, pct, signedPct } from './format.js';

/**
 * @typedef {Object} CompareItem
 * @property {string} id
 * @property {string} label
 * @property {import('./model.js').Scenario} scenario
 * @property {boolean} isBaseline
 * @property {boolean} isLive
 */

/**
 * @param {CompareItem[]} items
 * @param {ReturnType<import('./model.js').computeResults>|null} baselineResults
 */
export function renderCompareView(items, baselineResults) {
  if (!items.length) {
    return `<section class="compare-view card" id="compare-view"><p class="muted">Select scenarios to compare.</p></section>`;
  }

  const computed = items.map((item) => ({
    ...item,
    results: computeResults(item.scenario),
  }));

  const baseline = computed.find((c) => c.isBaseline) ?? (baselineResults ? { results: baselineResults } : null);

  const headerCells = computed.map((c) => `
    <th class="compare-col ${c.isLive ? 'live' : ''} ${c.isBaseline ? 'baseline' : ''}">
      ${c.label}${c.isBaseline ? ' ★' : ''}${c.isLive ? ' (live)' : ''}
    </th>`).join('');

  const rows = [
    { label: 'Revenue (period)', fn: (r) => peso(r.targetPnl.revenue) },
    { label: 'COGS (period)', fn: (r) => peso(r.targetPnl.cogs) },
    { label: 'Staff (period)', fn: (r) => peso(r.targetPnl.staff) },
    { label: 'Rent (period)', fn: (r) => peso(r.targetPnl.rent) },
    { label: 'Profit / day', fn: (r) => peso(r.profitPerDay), delta: true, deltaFn: (r) => r.profitPerDay },
    { label: 'Net margin', fn: (r) => pct(r.targetPnl.margin), delta: true, deltaFn: (r) => r.targetPnl.margin },
    { label: 'Break-even / day', fn: (r) => `${cups(r.beCupsPerDay)} cups` },
    { label: 'Target vs BE', fn: (r) => signedPct(r.targetVsBe) },
    { label: 'Throughput', fn: (r) => `${(r.throughput ?? 0).toFixed(1)} cups/hr` },
  ];

  const bodyRows = rows.map((row) => {
    const cells = computed.map((c) => {
      const val = row.fn(c.results);
      let deltaHtml = '';
      if (row.delta && baseline && 'results' in baseline && baseline.results && c.results !== baseline.results) {
        const baseVal = row.deltaFn(baseline.results);
        const curVal = row.deltaFn(c.results);
        if (baseVal != null && curVal != null && Number.isFinite(baseVal) && Number.isFinite(curVal)) {
          const diff = curVal - baseVal;
          const cls = diff >= 0 ? 'positive' : 'negative';
          const prefix = row.label.includes('margin') || row.label.includes('Profit')
            ? (diff >= 0 ? '+' : '') + (row.label.includes('margin') ? diff.toFixed(1) + 'pp' : peso(diff))
            : signedPct(baseVal !== 0 ? (diff / Math.abs(baseVal)) * 100 : 0);
          deltaHtml = `<div class="delta ${cls}">Δ ${prefix}</div>`;
        }
      }
      return `<td class="compare-col">${val}${deltaHtml}</td>`;
    }).join('');
    return `<tr><th class="compare-row-label">${row.label}</th>${cells}</tr>`;
  }).join('');

  return `
    <section class="compare-view card" id="compare-view">
      <h2 class="zone-title">Compare scenarios</h2>
      <div class="table-scroll">
        <table class="data-table compare-table">
          <thead><tr><th></th>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </section>`;
}

/**
 * @param {import('./storage.js').SavedScenario[]} saved
 * @param {string[]} selectedIds
 * @param {import('./model.js').Scenario} liveScenario
 */
export function renderComparePicker(saved, selectedIds, liveScenario) {
  const liveChecked = selectedIds.includes('__live__');
  const savedChecks = saved.map((s) => {
    const checked = selectedIds.includes(s.id) ? 'checked' : '';
    return `
      <label class="compare-check">
        <input type="checkbox" data-compare-id="${s.id}" ${checked} />
        ${s.data.name}${s.isBaseline ? ' ★' : ''}
      </label>`;
  }).join('');

  return `
    <div class="compare-picker">
      <label class="compare-check">
        <input type="checkbox" data-compare-id="__live__" ${liveChecked ? 'checked' : ''} />
        Live (${liveScenario.name})
      </label>
      ${savedChecks}
    </div>`;
}
