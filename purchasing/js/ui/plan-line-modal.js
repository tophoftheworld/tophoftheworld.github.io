import { updateLine, addLine } from '../store.js?v=96';
import {
  catalogItemsForPicker,
  itemDisplayName,
  itemPickerLabel,
  locationLabel,
} from '../data/catalog.js?v=96';
import {
  derivedRate,
  recalcLineCost,
  isBudgetLine,
} from '../compute.js?v=96';
import {
  formatPesoRate,
  formatQty,
  formatRateInput,
  escapeHtml,
} from '../format.js?v=96';
import { createAutocomplete } from '../../../expenses/js/autocomplete.js?v=96';
import {
  getSuppliers,
  findSupplierById,
  findSupplierByName,
  ensureSupplier,
} from '../data/suppliers.js?v=96';
import {
  getItemPref,
  getSupplierRate,
  buildItemSupplierMatchList,
} from '../data/item-prefs.js?v=96';
import {
  findCustomItemByName,
  buildCustomItemMatchList,
} from '../data/custom-items.js?v=96';
import { toast } from './shell.js?v=96';

const SAVED_CHECK_SVG = `<svg class="line-modal-supplier-check" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#2b9348"/><path d="M7 12l3 3 7-7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function resolveCatalogItem(typed, locationKey) {
  const value = (typed || '').trim();
  if (!value) return null;
  return (
    catalogItemsForPicker(locationKey).find((i) => {
      const label = itemPickerLabel(i);
      return i.id === value || i.name === value || label === value;
    }) || null
  );
}

/** Split "Name (Description)" typed into the item field. */
function splitNameAndDescription(raw) {
  const value = (raw || '').trim();
  const match = value.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!match) return { name: value, description: '' };
  return { name: match[1].trim(), description: match[2].trim() };
}

function composeItemLabel(name, description) {
  const n = (name || '').trim();
  const d = (description || '').trim();
  if (!n) return '';
  return d ? `${n} (${d})` : n;
}

function supplierMatchList(itemId, query) {
  if (itemId) return buildItemSupplierMatchList(itemId, query);
  return buildItemSupplierMatchList(null, query);
}

/**
 * Open line detail modal (edit existing line).
 */
export function openPlanLineModal(week, line, { onSaved } = {}) {
  if (!line) return;
  openLineModalCore({
    week,
    mode: 'edit',
    line,
    location: line.location,
    onSaved,
  });
}

/**
 * Open add modal \u2014 line lands on plan immediately after save.
 */
export function openAddLineModal(week, location, { onSaved } = {}) {
  openLineModalCore({
    week,
    mode: 'add',
    location,
    onSaved,
  });
}

function openLineModalCore({ week, mode, line = null, location, onSaved }) {
  const root = document.getElementById('modalRoot');
  if (!root) return;

  const isAdd = mode === 'add';
  const isEditingBudget = !isAdd && line && isBudgetLine(line);

  let itemKind = line?.kind || 'item';
  let catalogItem = line?.itemId
    ? catalogItemsForPicker(location).find((i) => i.id === line.itemId) ||
      catalogItemsForPicker().find((i) => i.id === line.itemId)
    : null;

  const initialSplit = isAdd
    ? { name: '', description: '' }
    : catalogItem
      ? { name: catalogItem.name, description: catalogItem.description || '' }
      : splitNameAndDescription(line?.freeTextName || itemDisplayName(line));

  let draftItemName = initialSplit.name;
  let draftDescription = initialSplit.description;

  let qty = Number(line?.qty) || 1;
  let unitPrice =
    line?.unitRate ??
    derivedRate(line?.qty, line?.estimatedCost) ??
    line?.lastPaidRate ??
    0;
  unitPrice = unitPrice ? Number(formatRateInput(unitPrice)) : 0;
  let total = Number(line?.estimatedCost) || Math.round(qty * unitPrice);
  /** Last cost field the user edited \u2014 keeps qty/total typing from fighting each other. */
  let lastCostEdit = null;

  const suggested = line?.suggestedQty;
  const need = line?.needQty;
  let unit = line?.unit || catalogItem?.unit || 'pcs';
  let category = line?.category || catalogItem?.category || 'Other';

  let lockedSupplier =
    (line?.supplierId && findSupplierById(line.supplierId)) ||
    (line?.supplierName && line.supplierName !== 'Unassigned'
      ? findSupplierByName(line.supplierName)
      : null) ||
    null;
  let draftSupplierName =
    !lockedSupplier && line?.supplierName && line.supplierName !== 'Unassigned'
      ? line.supplierName
      : '';

  function isTotalOnlyEntry() {
    if (isEditingBudget || itemKind === 'budget') return true;
    if (catalogItem) return false;
    if (unitPrice > 0) return false;
    // Qty > 1 with only a total → treat as a product line and derive unit price
    if (isAdd && qty > 1) return false;
    return total > 0 && (!unitPrice || unitPrice <= 0);
  }

  function showQtyUnitFields() {
    if (isEditingBudget || itemKind === 'budget') return false;
    if (isAdd) return true;
    return !isTotalOnlyEntry();
  }

  function showDescriptionField() {
    return isAdd && !catalogItem;
  }

  function currentItemId() {
    return catalogItem?.id ?? line?.itemId ?? null;
  }

  function composedCustomName() {
    return composeItemLabel(draftItemName, draftDescription);
  }

  function applyItemSelection(name, { resetCosts = true } = {}) {
    const custom = findCustomItemByName(name);
    catalogItem = resolveCatalogItem(name, location);
    if (catalogItem) {
      itemKind = 'item';
      draftItemName = catalogItem.name;
      draftDescription = catalogItem.description || '';
      unit = catalogItem.unit || 'pcs';
      category = catalogItem.category || 'Other';
      if (resetCosts) {
        qty = catalogItem.restockAmount || qty || 1;
        const pref = getItemPref(catalogItem.id);
        const rate =
          getSupplierRate(catalogItem.id, lockedSupplier?.id) ??
          pref?.lastPaidRate ??
          null;
        if (rate) {
          unitPrice = Number(formatRateInput(rate));
          total = Math.round(qty * unitPrice);
        }
        if (pref?.lastSupplierName && !lockedSupplier) {
          draftSupplierName = pref.lastSupplierName;
          const match = findSupplierByName(pref.lastSupplierName);
          if (match) lockedSupplier = match;
        }
      } else {
        const pref = getItemPref(catalogItem.id);
        if (pref?.lastSupplierName && !lockedSupplier && !draftSupplierName) {
          draftSupplierName = pref.lastSupplierName;
          const match = findSupplierByName(pref.lastSupplierName);
          if (match) lockedSupplier = match;
        }
      }
    } else if (custom) {
      catalogItem = null;
      itemKind = custom.kind === 'budget' ? 'budget' : 'item';
      const split = splitNameAndDescription(custom.name);
      draftItemName = split.name;
      draftDescription = split.description;
      unit = custom.defaultUnit || (custom.kind === 'budget' ? 'budget' : 'pcs');
      category = custom.category || (custom.kind === 'budget' ? 'Services & Budget' : 'Other');
      if (resetCosts) {
        if (custom.kind === 'budget' && custom.lastPaidTotal) {
          total = custom.lastPaidTotal;
          qty = 1;
          unitPrice = 0;
        } else if (custom.lastPaidRate) {
          unitPrice = Number(formatRateInput(custom.lastPaidRate));
          total = Math.round(qty * unitPrice);
        }
      }
    } else if (name.trim()) {
      catalogItem = null;
      const split = splitNameAndDescription(name);
      draftItemName = split.name;
      if (split.description) draftDescription = split.description;
      itemKind = 'item';
    }
  }

  /** Pull latest qty / unit / total from the form so save never uses stale draft state. */
  function syncCostsFromDom() {
    const qtyInput = body.querySelector('[data-field="qty"]');
    const unitInput = body.querySelector('[data-field="unit"]');
    const totalInput = body.querySelector('[data-field="total"]');
    if (qtyInput) {
      const n = readNumberInput(qtyInput);
      if (n != null && n >= 0) qty = n;
    }
    if (unitInput) {
      const n = readNumberInput(unitInput);
      if (n != null && n >= 0) unitPrice = n;
    }
    if (totalInput) {
      const n = readNumberInput(totalInput);
      if (n != null && n >= 0) total = n;
    }
  }

  function recalcFrom(field) {
    // Budget / total-only lines: leave qty alone while typing; pin on save only.
    if (isEditingBudget || itemKind === 'budget') return;
    if (!showQtyUnitFields()) return;

    const preserveTotal =
      field === 'qty' && lastCostEdit === 'total' && total > 0;
    const result = recalcLineCost(
      { qty, unitRate: unitPrice, estimatedCost: total },
      field,
      { preserveTotal }
    );
    qty = result.qty;
    unitPrice = result.unitRate;
    total = result.estimatedCost;
    lastCostEdit = field;
  }

  function summaryChip(label, value) {
    return `<div class="line-modal-chip">
      <span class="line-modal-chip-label">${escapeHtml(label)}</span>
      <strong class="line-modal-chip-value">${escapeHtml(value)}</strong>
    </div>`;
  }

  function renderSupplierBlock() {
    if (lockedSupplier) {
      const biz = (lockedSupplier.businessName || '').trim();
      return `
        <div class="line-modal-field full">
          <label>Supplier</label>
          <div class="line-modal-supplier-card" data-supplier-locked>
            <div class="line-modal-supplier-card-main">
              <div class="line-modal-supplier-name-row">
                <strong>${escapeHtml(lockedSupplier.name)}</strong>
                ${SAVED_CHECK_SVG}
              </div>
              ${biz ? `<div class="line-modal-supplier-biz">${escapeHtml(biz)}</div>` : ''}
            </div>
            <button type="button" class="line-modal-supplier-clear" data-clear-supplier aria-label="Change supplier" title="Change supplier">&times;</button>
          </div>
        </div>`;
    }
    return `
      <div class="line-modal-field full">
        <label>Supplier</label>
        <div class="supplier-ac" data-supplier-manual>
          <input type="text" data-field="supplier" autocomplete="off"
            value="${escapeHtml(draftSupplierName)}"
            placeholder="Search or type a new supplier" />
        </div>
        <p class="line-modal-field-hint">Pick a saved supplier to lock it, or type a new name.</p>
      </div>`;
  }

  function renderBody() {
    const pref = currentItemId() ? getItemPref(currentItemId()) : null;
    const lastPaid =
      unitPrice > 0
        ? unitPrice
        : pref?.lastPaidRate ?? line?.lastPaidRate ?? null;

    const showReset = showQtyUnitFields() && suggested != null && qty !== Number(suggested);
    const unitSuffix = escapeHtml(unit || 'pcs');
    const itemFieldValue = catalogItem
      ? itemPickerLabel(catalogItem)
      : draftItemName;

    return `
      ${
        isAdd
          ? `<div class="line-modal-field full">
              <label>Item</label>
              <div class="supplier-ac" data-item-picker>
                <input type="text" data-field="itemName" autocomplete="off"
                  value="${escapeHtml(itemFieldValue)}"
                  placeholder="Inventory item or custom name" />
              </div>
            </div>
            ${
              showDescriptionField()
                ? `<div class="line-modal-field full">
              <label>Description</label>
              <input type="text" data-field="description" autocomplete="off"
                value="${escapeHtml(draftDescription)}"
                placeholder=""
                aria-label="Description (optional)" />
            </div>`
                : catalogItem?.description
                  ? `<p class="line-modal-field-hint">${escapeHtml(catalogItem.description)}</p>`
                  : ''
            }`
          : ''
      }
      ${
        !isAdd
          ? `<div class="line-modal-summary">
              ${summaryChip('Stock', line.stockQty == null ? '\u2014' : formatQty(line.stockQty, unit))}
              ${summaryChip('Need', need == null ? '\u2014' : formatQty(need, unit))}
              ${summaryChip('Suggested', suggested == null ? '\u2014' : formatQty(suggested, unit))}
            </div>`
          : ''
      }
      ${
        lastPaid != null && showQtyUnitFields()
          ? `<p class="line-modal-last-paid">Last paid ${escapeHtml(formatPesoRate(lastPaid))}</p>`
          : ''
      }

      <div class="line-modal-grid line-modal-grid--costs">
        ${
          showQtyUnitFields()
            ? `<div class="line-modal-field line-modal-field--qty">
                <label>Order qty</label>
                <div class="line-modal-affix-input">
                  <input type="number" min="0" step="any" data-field="qty" value="${qty}" />
                  <span class="line-modal-affix">${unitSuffix}</span>
                  ${
                    showReset
                      ? `<button type="button" class="line-modal-reset-btn" data-reset-suggested title="Reset to suggested ${escapeHtml(formatQty(suggested, unit))}">→º</button>`
                      : ''
                  }
                </div>
              </div>
              <div class="line-modal-field line-modal-field--unit">
                <label>Unit price</label>
                <div class="line-modal-affix-input">
                  <span class="line-modal-affix line-modal-affix--prefix">\u20B1</span>
                  <input type="number" min="0" step="0.01" data-field="unit" value="${formatRateInput(unitPrice)}" />
                  <span class="line-modal-affix">/${unitSuffix}</span>
                </div>
              </div>`
            : ''
        }
        <div class="line-modal-field line-modal-field--total${showQtyUnitFields() ? '' : ' full'}">
          <label>Total</label>
          <div class="line-modal-affix-input">
            <span class="line-modal-affix line-modal-affix--prefix">\u20B1</span>
            <input type="number" min="0" step="1" data-field="total" value="${total || ''}" />
          </div>
        </div>
      </div>

      <div class="line-modal-grid">
        ${renderSupplierBlock()}
      </div>
    `;
  }

  function modalTitle() {
    if (isAdd) return `Add to ${locationLabel(location)}`;
    return escapeHtml(itemDisplayName(line));
  }

  function modalContext() {
    if (isAdd) return '';
    return `<div class="line-modal-context">
      <span class="line-modal-loc">${escapeHtml(locationLabel(line.location))}</span>
      ${category ? `<span class="line-modal-cat">${escapeHtml(category)}</span>` : ''}
    </div>`;
  }

  root.hidden = false;
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal line-modal" role="dialog" aria-modal="true">
      <div class="modal-header line-modal-header">
        <div class="line-modal-title-block">
          <h2>${modalTitle()}</h2>
          ${modalContext()}
        </div>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body" data-line-modal-body>${renderBody()}</div>
      <div class="modal-footer">
        <button type="button" class="btn secondary" data-cancel>Cancel</button>
        <button type="button" class="btn primary" data-save>${isAdd ? 'Add to plan' : 'Save'}</button>
      </div>
    </div>`;

  const body = root.querySelector('[data-line-modal-body]');

  function refresh() {
    body.innerHTML = renderBody();
    wireBody();
  }

  function lockSupplier(supplier) {
    if (!supplier) return;
    lockedSupplier = supplier;
    draftSupplierName = '';
    const itemId = currentItemId();
    if (itemId) {
      const rate = getSupplierRate(itemId, supplier.id);
      if (rate != null && rate > 0 && showQtyUnitFields()) {
        unitPrice = Number(formatRateInput(rate));
        recalcFrom('unit');
      }
    }
    refresh();
  }

  function clearSupplier() {
    lockedSupplier = null;
    draftSupplierName = '';
    refresh();
    requestAnimationFrame(() => body.querySelector('[data-field="supplier"]')?.focus());
  }

  function wireItemPicker() {
    const input = body.querySelector('[data-field="itemName"]');
    if (!input) return;

    createAutocomplete(
      input,
      (q) => {
        const custom = buildCustomItemMatchList(q).map((c) => ({
          id: `custom:${c.slug}`,
          display: `<div style="font-weight:500">${escapeHtml(c.name)}</div><div style="font-size:12px;color:#666">${escapeHtml(c.category)} \u00B7 used ${c.orderCount}×</div>`,
          priority: c.priority,
          name: c.name,
          kind: c.kind,
        }));
        const catalog = catalogItemsForPicker(location)
          .filter((i) => {
            const label = itemPickerLabel(i);
            const ql = (q || '').toLowerCase();
            if (!ql) return true;
            return (
              label.toLowerCase().includes(ql) ||
              i.name.toLowerCase().includes(ql) ||
              (i.description || '').toLowerCase().includes(ql)
            );
          })
          .slice(0, 12)
          .map((i) => ({
            id: i.id,
            display: escapeHtml(itemPickerLabel(i)),
            priority: 0,
            name: itemPickerLabel(i),
            kind: 'item',
            catalogItem: i,
          }));
        return [...custom, ...catalog]
          .sort((a, b) => a.priority - b.priority)
          .slice(0, 16);
      },
      (id) => {
        if (String(id).startsWith('custom:')) {
          const slug = String(id).slice(7);
          const custom = buildCustomItemMatchList('').find((c) => c.slug === slug);
          if (custom) {
            const split = splitNameAndDescription(custom.name);
            input.value = split.name;
            applyItemSelection(custom.name);
            refresh();
          }
        } else {
          const item = catalogItemsForPicker(location).find((i) => i.id === id);
          if (item) {
            input.value = item.name;
            applyItemSelection(itemPickerLabel(item));
            refresh();
          }
        }
      },
      { showOnFocus: true }
    );

    const wrap = input.closest('.supplier-ac') || input.parentElement;
    const dropdown = wrap?.querySelector('.autocomplete-dropdown');
    if (dropdown) {
      const placeDropdown = () => {
        if (dropdown.classList.contains('hidden')) return;
        const rect = input.getBoundingClientRect();
        dropdown.classList.add('autocomplete-dropdown--fixed');
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 2}px`;
        dropdown.style.width = `${Math.max(rect.width, 280)}px`;
      };
      input.addEventListener('focus', () => requestAnimationFrame(placeDropdown));
      input.addEventListener('input', () => requestAnimationFrame(placeDropdown));
    }

    input.addEventListener('input', () => {
      const wasCatalog = !!catalogItem;
      draftItemName = input.value;
      if (wasCatalog) {
        catalogItem = null;
        refresh();
        const next = body.querySelector('[data-field="itemName"]');
        if (next) {
          next.value = draftItemName;
          next.focus();
          const len = next.value.length;
          next.setSelectionRange(len, len);
        }
      }
    });
    input.addEventListener('change', () => applyItemSelection(input.value));
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement?.closest?.('.autocomplete-dropdown')) return;
        applyItemSelection(input.value);
        if (!catalogItem) {
          const split = splitNameAndDescription(input.value);
          draftItemName = split.name || draftItemName;
          if (split.description) draftDescription = split.description;
          if (input.value !== draftItemName) {
            input.value = draftItemName;
            refresh();
          }
        }
      }, 150);
    });
  }

  function wireSupplierManual() {
    const input = body.querySelector('[data-field="supplier"]');
    if (!input) return;

    createAutocomplete(
      input,
      (q) => supplierMatchList(currentItemId(), q),
      (id) => {
        const s = getSuppliers().find((x) => x.id === id);
        if (s) lockSupplier(s);
      },
      { showOnFocus: true }
    );

    const wrap = input.closest('.supplier-ac') || input.parentElement;
    const dropdown = wrap?.querySelector('.autocomplete-dropdown');
    if (dropdown) {
      const placeDropdown = () => {
        if (dropdown.classList.contains('hidden')) return;
        const rect = input.getBoundingClientRect();
        dropdown.classList.add('autocomplete-dropdown--fixed');
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 2}px`;
        dropdown.style.width = `${Math.max(rect.width, 240)}px`;
      };
      input.addEventListener('focus', () => requestAnimationFrame(placeDropdown));
      input.addEventListener('input', () => requestAnimationFrame(placeDropdown));
    }

    input.addEventListener('input', () => {
      draftSupplierName = input.value;
      input.dataset.supplierId = '';
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        const typed = (input.value || '').trim();
        if (!typed) return;
        const match = findSupplierByName(typed);
        if (match) lockSupplier(match);
      }, 180);
    });
  }

  function patchCostInputs(activeField = null) {
    const totalInput = body.querySelector('[data-field="total"]');
    const unitInput = body.querySelector('[data-field="unit"]');
    const qtyInput = body.querySelector('[data-field="qty"]');
    // Don't rewrite the field the user is typing \u2014 empty/"5." must stay editable.
    if (totalInput && activeField !== 'total') totalInput.value = total || '';
    if (unitInput && activeField !== 'unit') {
      unitInput.value = unitPrice ? formatRateInput(unitPrice) : '';
    }
    if (qtyInput && activeField !== 'qty') {
      qtyInput.value = qty === 0 || qty ? String(qty) : '';
    }
  }

  function readNumberInput(el) {
    const raw = (el?.value ?? '').trim();
    if (raw === '' || raw === '.' || raw === '-') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function onResetSuggested() {
    if (suggested == null) return;
    qty = Number(suggested);
    recalcFrom('qty');
    patchCostInputs();
  }

  function wireBody() {
    body.querySelector('[data-clear-supplier]')?.addEventListener('click', clearSupplier);

    wireItemPicker();

    body.querySelector('[data-field="description"]')?.addEventListener('input', (e) => {
      draftDescription = e.target.value;
    });

    body.querySelector('[data-field="qty"]')?.addEventListener('input', (e) => {
      const n = readNumberInput(e.target);
      if (n == null) return; // leave field empty while deleting / mid-type
      qty = n;
      recalcFrom('qty');
      patchCostInputs('qty');
    });

    body.querySelector('[data-field="qty"]')?.addEventListener('blur', (e) => {
      const n = readNumberInput(e.target);
      qty = n == null || n < 0 ? 0 : n;
      if (qty > 0) recalcFrom('qty');
      patchCostInputs();
    });

    body.querySelector('[data-field="unit"]')?.addEventListener('input', (e) => {
      const n = readNumberInput(e.target);
      if (n == null) return;
      unitPrice = n;
      recalcFrom('unit');
      patchCostInputs('unit');
    });

    body.querySelector('[data-field="unit"]')?.addEventListener('blur', (e) => {
      const n = readNumberInput(e.target);
      unitPrice = n == null || n < 0 ? 0 : n;
      if (unitPrice > 0 || qty > 0) recalcFrom('unit');
      patchCostInputs();
    });

    body.querySelector('[data-field="total"]')?.addEventListener('input', (e) => {
      const n = readNumberInput(e.target);
      if (n == null) return;
      total = n;
      recalcFrom('total');
      patchCostInputs('total');
    });

    body.querySelector('[data-field="total"]')?.addEventListener('blur', (e) => {
      const n = readNumberInput(e.target);
      total = n == null || n < 0 ? 0 : n;
      if (total > 0 || qty > 0) recalcFrom('total');
      patchCostInputs();
    });

    body.querySelector('[data-reset-suggested]')?.addEventListener('click', onResetSuggested);
    wireSupplierManual();
  }

  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
  };

  root.querySelector('[data-close]')?.addEventListener('click', close);
  root.querySelector('.modal-close')?.addEventListener('click', close);
  root.querySelector('[data-cancel]')?.addEventListener('click', close);

  root.querySelector('[data-save]')?.addEventListener('click', async () => {
    // Read the form first \u2014 item resolve must not wipe typed qty/price.
    syncCostsFromDom();

    if (isAdd) {
      const nameInput = body.querySelector('[data-field="itemName"]');
      const descInput = body.querySelector('[data-field="description"]');
      if (descInput) draftDescription = descInput.value;
      applyItemSelection(nameInput?.value || draftItemName, { resetCosts: false });
      if (!draftItemName.trim()) {
        toast('Enter an item name');
        return;
      }
    }

    let supplier;
    if (lockedSupplier) {
      supplier = { id: lockedSupplier.id, name: lockedSupplier.name };
    } else {
      const typed =
        draftSupplierName ||
        (body.querySelector('[data-field="supplier"]')?.value || '').trim();
      supplier = await ensureSupplier(typed);
    }

    const totalOnly = isTotalOnlyEntry();

    if (totalOnly) {
      qty = 1;
      unit = unit === 'budget' ? 'budget' : (catalogItem?.unit || 'pcs');
      category = category || 'Other';
      itemKind = catalogItem ? 'item' : 'budget';
      if (!catalogItem) {
        unit = 'budget';
        category = category === 'Other' ? 'Services & Budget' : category;
      }
    } else if (unitPrice <= 0 && total > 0 && qty > 0) {
      recalcFrom('total');
    } else {
      recalcFrom('unit');
    }

    // Manual adds always keep the typed qty through Order View remaps.
    const qtyEdited =
      isAdd || (suggested != null ? qty !== Number(suggested) : true);

    const payload = {
      qty,
      qtyEdited,
      unit,
      unitRate: totalOnly ? null : unitPrice,
      estimatedCost: total,
      costSet: total > 0 || (unitPrice > 0 && qty > 0),
      supplierId: supplier.id,
      supplierName: supplier.name,
      lastPaidRate: totalOnly ? null : unitPrice > 0 ? unitPrice : line?.lastPaidRate,
      category,
      kind: itemKind,
    };

    if (isAdd) {
      const displayName = catalogItem
        ? itemPickerLabel(catalogItem)
        : composedCustomName();
      const lineId = `line-${Date.now()}`;
      addLine(week.id, {
        id: lineId,
        kind: itemKind,
        itemId: catalogItem?.id ?? null,
        freeTextName: catalogItem ? null : displayName,
        itemName: displayName,
        location,
        category,
        categoryOrder: catalogItem?.categoryOrder ?? 999,
        displayOrder: catalogItem?.displayOrder ?? 0,
        suggestedQty: qty,
        supplierOptions: [],
        source: 'manual',
        status: 'planned',
        onPlan: true,
        needQty: null,
        stockQty: null,
        runoutDate: null,
        lastCountedAt: null,
        countAgeDays: null,
        lastPaidDate: null,
        linkedExpenseIds: [],
        attachedLineIds: [],
        frozen: false,
        rateLocked: false,
        ...payload,
      });
      toast('Added to the budget');
    } else {
      updateLine(week.id, line.id, payload, {
        propagateRate: !!line.itemId,
        savePrefs: true,
      });
      toast('Saved');
    }

    close();
    onSaved?.();
  });

  wireBody();
  if (isAdd) {
    body.querySelector('[data-field="itemName"]')?.focus();
  } else if (showQtyUnitFields()) {
    body.querySelector('[data-field="qty"]')?.focus();
  } else {
    body.querySelector('[data-field="total"]')?.focus();
  }
}
