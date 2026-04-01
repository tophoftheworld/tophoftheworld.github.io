/**
 * Autocomplete helpers for expense forms (admin + optional reuse).
 * Pass modalBodyEl for item-name dropdowns that need absolute positioning inside a scrollable modal.
 */

export function getItemMatches(getExpenses, query, currentSupplier = '') {
    const allItems = new Map();
    const expenses = getExpenses();

    expenses.forEach((expense) => {
        (expense.items || []).forEach((item) => {
            const key = (item.name || '').toLowerCase();
            if (!key) return;
            if (!allItems.has(key)) {
                allItems.set(key, {
                    id: item.name,
                    name: item.name,
                    suppliers: new Set(),
                    frequency: 0,
                });
            }
            const entry = allItems.get(key);
            if (expense.supplierName) entry.suppliers.add(expense.supplierName);
            entry.frequency++;
        });
    });

    const q = query.toLowerCase().trim();
    const items = Array.from(allItems.values()).map((item) => {
        const name = item.name.toLowerCase();
        let priority = 999;

        if (name === q) priority = 1;
        else if (name.startsWith(q)) priority = 2;
        else if (name.split(/\s+/).some((word) => word.startsWith(q))) priority = 3;
        else if (q && name.includes(q)) priority = 4;
        else if (!q) priority = 5;

        if (currentSupplier && item.suppliers.has(currentSupplier)) {
            priority = Math.max(1, priority - 1);
        }

        const secondarySort = -item.frequency;
        return { ...item, priority, secondarySort, display: item.name };
    });

    return items
        .filter((item) => item.priority < 999)
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (a.secondarySort !== b.secondarySort) return a.secondarySort - b.secondarySort;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 10);
}

export function getPaidByMatches(getExpenses, query) {
    const allPayers = new Map();
    const expenses = getExpenses();

    expenses.forEach((expense) => {
        const payer = (expense.paidBy || '').trim();
        if (!payer) return;
        const key = payer.toLowerCase();
        if (!allPayers.has(key)) {
            allPayers.set(key, { id: payer, name: payer, frequency: 0 });
        }
        allPayers.get(key).frequency++;
    });

    const q = query.toLowerCase().trim();
    const payers = Array.from(allPayers.values()).map((payer) => {
        const name = payer.name.toLowerCase();
        let priority = 999;
        if (name === q) priority = 1;
        else if (name.startsWith(q)) priority = 2;
        else if (name.split(/\s+/).some((word) => word.startsWith(q))) priority = 3;
        else if (q && name.includes(q)) priority = 4;
        else if (!q) priority = 5;
        return { ...payer, priority, display: payer.name };
    });

    return payers
        .filter((payer) => payer.priority < 999)
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.frequency - a.frequency;
        })
        .slice(0, 8);
}

export function buildSupplierMatchList(getSuppliers, query) {
    const allSuppliers = getSuppliers();
    const queryLower = query.toLowerCase().trim();
    const suppliersList = allSuppliers.map((supplier) => {
        const name = (supplier.name || '').toLowerCase();
        const businessName = (supplier.businessName || '').toLowerCase();
        let priority = 999;

        if (!queryLower) priority = 7;
        else if (name.startsWith(queryLower)) priority = 1;
        else if (businessName.startsWith(queryLower)) priority = 2;
        else if (name.split(/\s+/).some((word) => word.startsWith(queryLower))) priority = 3;
        else if (businessName.split(/\s+/).some((word) => word.startsWith(queryLower))) priority = 4;
        else if (name.includes(queryLower)) priority = 5;
        else if (businessName.includes(queryLower)) priority = 6;

        const safeName = escapeHtml(supplier.name || '');
        const safeBiz = escapeHtml(supplier.businessName || 'No business name');
        return {
            ...supplier,
            priority,
            display: `<div style="font-weight:500">${safeName}</div><div style="font-size:12px;color:#666">${safeBiz}</div>`,
        };
    });

    return suppliersList
        .filter((supplier) => supplier.priority < 999)
        .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * @param {HTMLInputElement} inputElement
 * @param {(q: string) => Array<{ id: string, display: string }>} getMatches
 * @param {(value: string, input: HTMLInputElement) => void} onSelect
 * @param {{ showOnFocus?: boolean, modalBodyEl?: HTMLElement | null, useFixedItemDropdown?: boolean }} options
 */
export function createAutocomplete(inputElement, getMatches, onSelect, options = {}) {
    if (!inputElement) return;

    const { showOnFocus = false, modalBodyEl = null, useFixedItemDropdown = false } = options;

    const formGroup = inputElement.parentElement;
    let dropdown = formGroup.querySelector('.autocomplete-dropdown');

    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'autocomplete-dropdown hidden';

        if (useFixedItemDropdown && modalBodyEl) {
            modalBodyEl.appendChild(dropdown);
            dropdown.style.position = 'absolute';
            dropdown.style.zIndex = '10010';
        } else {
            formGroup.style.position = 'relative';
            formGroup.appendChild(dropdown);
        }
    }

    if (!inputElement.id) {
        inputElement.id = `autocomplete_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    function positionItemDropdown() {
        if (!useFixedItemDropdown || !modalBodyEl) return;
        const rect = inputElement.getBoundingClientRect();
        const modalRect = modalBodyEl.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom - modalRect.top + modalBodyEl.scrollTop}px`;
        dropdown.style.left = `${rect.left - modalRect.left}px`;
        dropdown.style.width = `${rect.width}px`;
    }

    function updateDropdown(query = '') {
        const matches = getMatches(query);
        if (!matches.length) {
            dropdown.classList.add('hidden');
            return;
        }

        dropdown.innerHTML = '';
        matches.forEach((match) => {
            const row = document.createElement('div');
            row.className = 'autocomplete-item';
            row.innerHTML = match.display;
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                onSelect(match.id, inputElement);
                dropdown.classList.add('hidden');
            });
            dropdown.appendChild(row);
        });

        if (useFixedItemDropdown) positionItemDropdown();
        dropdown.classList.remove('hidden');
    }

    inputElement.addEventListener('input', function () {
        const query = this.value.toLowerCase().trim();
        updateDropdown(query);
    });

    if (showOnFocus) {
        inputElement.addEventListener('focus', function () {
            setTimeout(() => {
                if (document.activeElement === this && this.value.trim() === '') {
                    updateDropdown('');
                }
            }, 100);
        });
    }

    function hideDropdownHandler(e) {
        if (!inputElement.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    }

    document.addEventListener('click', hideDropdownHandler);
    document.addEventListener('touchend', hideDropdownHandler);

    inputElement.addEventListener('blur', function () {
        setTimeout(() => dropdown.classList.add('hidden'), 150);
    });

    if (useFixedItemDropdown && modalBodyEl) {
        modalBodyEl.addEventListener('scroll', () => {
            if (!dropdown.classList.contains('hidden')) {
                updateDropdown(inputElement.value.toLowerCase().trim());
            }
        });
    }
}
