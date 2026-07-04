import { newId } from './defaults.js';
import { peso, pesoDec, esc } from './format.js';

/** @param {string} html */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/**
 * @param {Object} opts
 * @param {string} opts.label
 * @param {string} opts.name
 * @param {string|number} opts.value
 * @param {string} [opts.type]
 * @param {string} [opts.step]
 * @param {string} [opts.hint]
 * @param {boolean} [opts.readonly]
 * @param {'narrow'|'medium'|'sales'} [opts.size]
 * @param {string} [opts.prefix]
 */
export function fieldInput(opts) {
  const type = opts.type ?? 'number';
  const ro = opts.readonly ? 'readonly' : '';
  const step = opts.step ? `step="${opts.step}"` : '';
  const hint = opts.hint ? `<p class="field-hint">${opts.hint}</p>` : '';
  const sizeCls = opts.size ? `field-input--${opts.size}` : '';
  const input = `<input class="field-input ${sizeCls}" type="${type}" name="${opts.name}" value="${opts.value}" ${step} ${ro} data-field="${opts.name}" />`;
  const control = opts.prefix
    ? `<div class="field-input-wrap">${opts.prefix ? `<span class="field-prefix">${opts.prefix}</span>` : ''}${input}</div>`
    : input;
  return `
    <label class="field${opts.size ? ` field--${opts.size}` : ''}">
      <span class="field-label">${opts.label}</span>
      ${control}
      ${hint}
    </label>`;
}

/** @param {string} tableClass @param {string} headHtml @param {string} bodyHtml */
export function tableWrap(tableClass, headHtml, bodyHtml) {
  return `
    <div class="table-scroll">
      <table class="data-table ${tableClass}">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>`;
}

/** @param {import('./model.js').Scenario} scenario @param {(path: string, value: unknown) => void} onChange */
export function renderRosterTable(scenario, onChange) {
  const { staffRates, roster } = scenario;
  const head = `
    <th>Role</th><th>#</th><th>Day</th><th>OT hrs</th><th class="num">Daily ₱</th><th></th>`;
  const body = roster.map((row, i) => {
    const dayRate = row.dayType === 'Half' ? staffRates.halfDayRate : staffRates.wholeDayRate;
    const line = row.persons * dayRate
      + row.persons * row.otHours * staffRates.otRate
      + row.persons * (staffRates.mealAllowance + staffRates.transportAllowance);
    return `
      <tr data-roster="${i}">
        <td><input class="cell-input" data-roster-field="role" value="${row.role}" /></td>
        <td><input class="cell-input cell-num" type="number" min="0" data-roster-field="persons" value="${row.persons}" /></td>
        <td>
          <select class="cell-input" data-roster-field="dayType">
            <option value="Whole" ${row.dayType === 'Whole' ? 'selected' : ''}>Whole</option>
            <option value="Half" ${row.dayType === 'Half' ? 'selected' : ''}>Half</option>
          </select>
        </td>
        <td><input class="cell-input cell-num" type="number" min="0" step="0.5" data-roster-field="otHours" value="${row.otHours}" /></td>
        <td class="num muted">${pesoDec(line)}</td>
        <td><button type="button" class="btn-icon" data-action="remove-roster" data-index="${i}" ${roster.length <= 1 ? 'disabled' : ''} title="Remove">×</button></td>
      </tr>`;
  }).join('');
  return `
    <div class="rates-grid">
      ${fieldInput({ label: 'Whole-day rate ₱', name: 'staffRates.wholeDayRate', value: staffRates.wholeDayRate })}
      ${fieldInput({ label: 'Half-day rate ₱', name: 'staffRates.halfDayRate', value: staffRates.halfDayRate })}
      ${fieldInput({ label: 'OT rate / hr ₱', name: 'staffRates.otRate', value: staffRates.otRate })}
      ${fieldInput({ label: 'Meal allowance ₱', name: 'staffRates.mealAllowance', value: staffRates.mealAllowance })}
      ${fieldInput({ label: 'Transport allowance ₱', name: 'staffRates.transportAllowance', value: staffRates.transportAllowance })}
    </div>
    ${tableWrap('roster-table', head, body)}
    <button type="button" class="btn-secondary btn-sm" data-action="add-roster">+ Add roster row</button>`;
}

/**
 * @param {string} key
 * @param {import('./defaults.js').CostLine[]} lines
 * @param {string} title
 * @param {{ bare?: boolean }} [opts]
 */
export function renderCompactCostLines(key, lines, title, opts = {}) {
  const total = lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
  const rows = lines.map((line, i) => `
    <div class="expense-line" data-cost="${key}" data-index="${i}">
      <input class="expense-name" data-cost-field="name" value="${esc(line.name)}" placeholder="Item name" />
      <div class="expense-amt-wrap">
        <span class="expense-amt-prefix">₱</span>
        <input class="expense-amt" type="number" min="0" data-cost-field="amount" value="${line.amount}" />
      </div>
      <button type="button" class="btn-icon" data-action="remove-cost" data-key="${key}" data-index="${i}" aria-label="Remove">×</button>
    </div>`).join('');
  const idAttr = opts.bare ? '' : ` id="${key}-panel"`;
  const header = title ? `
      <div class="expense-head">
        <span class="expense-head-title">${title}</span>
        <span class="expense-total cost-lines-total">${peso(total)}</span>
      </div>` : '';
  return `
    <div class="expense-block${opts.bare ? ' expense-block--bare' : ''}"${idAttr}>
      ${header}
      <div class="expense-cols" aria-hidden="true">
        <span>Item</span>
        <span class="expense-cols-amt">Amount</span>
        <span></span>
      </div>
      <div class="expense-lines">${rows}</div>
      <button type="button" class="expense-add" data-action="add-cost" data-key="${key}">+ Add line</button>
    </div>`;
}

/** @param {import('./defaults.js').Ingredient[]} ingredients */
export function renderIngredientsTable(ingredients) {
  const head = `
    <th>Ingredient</th><th class="num">Bulk qty</th><th class="num">Bulk ₱</th>
    <th>Unit</th><th class="num">Per serving</th><th class="num">₱/serving</th><th></th>`;
  const body = ingredients.map((ing, i) => {
    const cps = ing.bulkQty > 0 ? (ing.bulkCost / ing.bulkQty) * ing.qtyPerServing : 0;
    return `
      <tr data-ingredient="${i}">
        <td><input class="cell-input" data-ing-field="name" value="${ing.name}" /></td>
        <td><input class="cell-input cell-num" type="number" min="0" data-ing-field="bulkQty" value="${ing.bulkQty}" /></td>
        <td><input class="cell-input cell-num" type="number" min="0" data-ing-field="bulkCost" value="${ing.bulkCost}" /></td>
        <td><input class="cell-input cell-unit" data-ing-field="unit" value="${ing.unit}" /></td>
        <td><input class="cell-input cell-num" type="number" min="0" step="0.01" data-ing-field="qtyPerServing" value="${ing.qtyPerServing}" /></td>
        <td class="num muted">${pesoDec(cps)}</td>
        <td><button type="button" class="btn-icon" data-action="remove-ingredient" data-index="${i}">×</button></td>
      </tr>`;
  }).join('');
  return `
    ${tableWrap('ingredients-table', head, body)}
    <button type="button" class="btn-secondary btn-sm" data-action="add-ingredient">+ Add ingredient</button>`;
}

/** Wire table events on a container */
export function wireTableEvents(container, handlers) {
  container.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const action = t.closest('[data-action]');
    if (!action) return;
    const act = action.getAttribute('data-action');
    if (act === 'add-roster') handlers.addRoster();
    if (act === 'remove-roster') handlers.removeRoster(Number(action.getAttribute('data-index')));
    if (act === 'add-cost') handlers.addCost(action.getAttribute('data-key'));
    if (act === 'remove-cost') handlers.removeCost(action.getAttribute('data-key'), Number(action.getAttribute('data-index')));
    if (act === 'add-ingredient') handlers.addIngredient();
    if (act === 'remove-ingredient') handlers.removeIngredient(Number(action.getAttribute('data-index')));
  });

  container.addEventListener('change', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const rosterRow = t.closest('[data-roster]');
    if (rosterRow) {
      const i = Number(rosterRow.getAttribute('data-roster'));
      const field = t.getAttribute('data-roster-field');
      if (field) handlers.updateRoster(i, field, /** @type {HTMLInputElement} */ (t).value);
      return;
    }
    const costRow = t.closest('[data-cost]');
    if (costRow) {
      const key = costRow.getAttribute('data-cost');
      const i = Number(costRow.getAttribute('data-index'));
      const field = t.getAttribute('data-cost-field');
      if (key && field) handlers.updateCost(key, i, field, /** @type {HTMLInputElement} */ (t).value);
      return;
    }
    const ingRow = t.closest('[data-ingredient]');
    if (ingRow) {
      const i = Number(ingRow.getAttribute('data-ingredient'));
      const field = t.getAttribute('data-ing-field');
      if (field) handlers.updateIngredient(i, field, /** @type {HTMLInputElement} */ (t).value);
    }
  });

  container.addEventListener('input', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.matches('[data-roster-field], [data-cost-field], [data-ing-field]')) {
      t.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

export { newId };
