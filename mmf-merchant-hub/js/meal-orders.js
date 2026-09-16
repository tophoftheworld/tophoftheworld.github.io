/**
 * Crew meal orders board — organizer & supplier view.
 * Organized by day → supplier (cook sheet) → brand orders.
 */

import {
    ADMIN_PASSWORD,
    EVENT_DAYS,
    formatNumber,
    formatPeso,
    formatUpdatedAt,
    todayEventDate,
} from './config.js';
import {
    CREW_MEAL_ORDERS_COLLECTION,
    CREW_MEAL_SUPPLIERS,
    formatCrewDateLabel,
} from './crew-meals.js';
import { initFirebase } from './firebase.js';

const SESSION_KEY = 'mmf_hub_meal_orders';
const $ = (id) => document.getElementById(id);

/** @type {Array<ReturnType<typeof normalizeOrder>>} */
let orders = [];
let selectedDay = todayEventDate();

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isAuthed() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
}

function setAuthed(on) {
    if (on) sessionStorage.setItem(SESSION_KEY, '1');
    else sessionStorage.removeItem(SESSION_KEY);
}

function showGate() {
    $('mealGate').classList.remove('hidden');
    $('mealApp').classList.add('hidden');
    document.body.classList.add('gate-body');
    document.body.classList.remove('admin-body');
}

function showApp() {
    $('mealGate').classList.add('hidden');
    $('mealApp').classList.remove('hidden');
    document.body.classList.remove('gate-body');
    document.body.classList.add('admin-body');
}

function normalizeOrder(data, id) {
    const lines = (Array.isArray(data.lines) ? data.lines : [])
        .map((line) => ({
            supplierId: String(line.supplierId || '').trim(),
            supplierName: String(line.supplierName || '').trim() || 'Supplier',
            periodKey: String(line.periodKey || 'meal'),
            periodLabel: String(line.periodLabel || line.periodKey || ''),
            itemId: String(line.itemId || '').trim(),
            itemName: String(line.itemName || '').trim() || 'Item',
            itemDescription: String(line.itemDescription || '').trim(),
            qty: Math.max(0, Math.round(Number(line.qty) || 0)),
            unitPrice: Number(line.unitPrice) || 0,
            lineTotal: Number(line.lineTotal) || 0,
        }))
        .filter((l) => l.qty > 0);

    return {
        id,
        merchantId: data.merchantId || '',
        brandName: String(data.brandName || '').trim() || '—',
        email: String(data.email || '').trim(),
        contactPerson: String(data.contactPerson || '').trim(),
        contactNumber: String(data.contactNumber || '').trim(),
        date: String(data.date || '').trim(),
        lines,
        totalAmount: Number(data.totalAmount) || lines.reduce((s, l) => s + l.lineTotal, 0),
        totalQty: Number(data.totalQty) || lines.reduce((s, l) => s + l.qty, 0),
        updatedAt: data.updatedAt || null,
    };
}

function supplierLabel(id, fallback = '') {
    const known = CREW_MEAL_SUPPLIERS.find((s) => s.id === id);
    return known?.name || fallback || id || 'Supplier';
}

function filteredOrders() {
    const supplier = $('mealFilterSupplier').value;
    const brand = $('mealFilterBrand').value;
    return orders.filter((order) => {
        if (selectedDay && order.date !== selectedDay) return false;
        if (brand && order.brandName !== brand) return false;
        if (!supplier) return order.lines.length > 0;
        return order.lines.some((l) => l.supplierId === supplier);
    });
}

function linesForView(orderList) {
    const supplier = $('mealFilterSupplier').value;
    const out = [];
    orderList.forEach((order) => {
        order.lines.forEach((line) => {
            if (supplier && line.supplierId !== supplier) return;
            out.push({ order, line });
        });
    });
    return out;
}

function groupBySupplier(flatLines) {
    const map = new Map();
    flatLines.forEach(({ order, line }) => {
        const key = line.supplierId || line.supplierName;
        if (!map.has(key)) {
            map.set(key, {
                supplierId: line.supplierId,
                supplierName: supplierLabel(line.supplierId, line.supplierName),
                itemRollup: new Map(),
                brandOrders: new Map(),
                totalQty: 0,
                totalAmount: 0,
            });
        }
        const group = map.get(key);
        group.totalQty += line.qty;
        group.totalAmount += line.lineTotal;

        const itemKey = `${line.periodKey}::${line.itemId || line.itemName}`;
        if (!group.itemRollup.has(itemKey)) {
            group.itemRollup.set(itemKey, {
                itemName: line.itemName,
                itemDescription: line.itemDescription,
                periodKey: line.periodKey,
                periodLabel: line.periodLabel,
                qty: 0,
                amount: 0,
            });
        }
        const item = group.itemRollup.get(itemKey);
        item.qty += line.qty;
        item.amount += line.lineTotal;

        if (!group.brandOrders.has(order.id)) {
            group.brandOrders.set(order.id, {
                brandName: order.brandName,
                email: order.email,
                contactPerson: order.contactPerson,
                contactNumber: order.contactNumber,
                updatedAt: order.updatedAt,
                lines: [],
                qty: 0,
                amount: 0,
            });
        }
        const brand = group.brandOrders.get(order.id);
        brand.lines.push(line);
        brand.qty += line.qty;
        brand.amount += line.lineTotal;
    });

    const preferred = CREW_MEAL_SUPPLIERS.map((s) => s.id);
    return [...map.values()].sort((a, b) => {
        const ai = preferred.indexOf(a.supplierId);
        const bi = preferred.indexOf(b.supplierId);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        return a.supplierName.localeCompare(b.supplierName, undefined, { sensitivity: 'base' });
    });
}

function fillFilters() {
    const supplierSel = $('mealFilterSupplier');
    const brandSel = $('mealFilterBrand');
    const currentSupplier = supplierSel.value;
    const currentBrand = brandSel.value;

    const suppliers = new Map();
    CREW_MEAL_SUPPLIERS.forEach((s) => suppliers.set(s.id, s.name));
    orders.forEach((order) => {
        order.lines.forEach((line) => {
            if (line.supplierId && !suppliers.has(line.supplierId)) {
                suppliers.set(line.supplierId, line.supplierName);
            }
        });
    });

    supplierSel.innerHTML =
        '<option value="">All suppliers</option>' +
        [...suppliers.entries()]
            .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
            .join('');
    if (currentSupplier) supplierSel.value = currentSupplier;

    const brands = [...new Set(orders.map((o) => o.brandName).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    brandSel.innerHTML =
        '<option value="">All brands</option>' +
        brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    if (currentBrand) brandSel.value = currentBrand;
}

function renderDayStrip() {
    const container = $('mealDayStrip');
    const counts = new Map();
    orders.forEach((o) => {
        if (!o.date || !o.lines.length) return;
        counts.set(o.date, (counts.get(o.date) || 0) + 1);
    });

    container.innerHTML = EVENT_DAYS.map((d) => {
        const active = d.date === selectedDay;
        const count = counts.get(d.date) || 0;
        return `
            <button type="button"
                class="day-chip${active ? ' is-active' : ''}"
                role="tab"
                aria-selected="${active ? 'true' : 'false'}"
                data-date="${d.date}">
                <span class="day-chip-num">Day ${d.day}</span>
                <span class="day-chip-date">${escapeHtml(d.shortDate)}</span>
                <span class="day-chip-wd">${escapeHtml(d.weekday)}${count ? ` · ${count}` : ''}</span>
            </button>`;
    }).join('');

    if (container.dataset.bound === '1') return;
    container.dataset.bound = '1';
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.day-chip');
        if (!btn) return;
        selectedDay = btn.dataset.date;
        render();
    });
}

function renderItemRollup(group) {
    const items = [...group.itemRollup.values()].sort((a, b) => {
        const periodOrder = { meal: 0, lunch: 1, dinner: 2 };
        const pa = periodOrder[a.periodKey] ?? 9;
        const pb = periodOrder[b.periodKey] ?? 9;
        if (pa !== pb) return pa - pb;
        return a.itemName.localeCompare(b.itemName, undefined, { sensitivity: 'base' });
    });

    if (!items.length) {
        return `<p class="muted">No items for this supplier.</p>`;
    }

    const rows = items
        .map((item) => {
            const period =
                item.periodKey && item.periodKey !== 'meal'
                    ? `<span class="meal-period-tag">${escapeHtml(item.periodLabel || item.periodKey)}</span>`
                    : '';
            const desc = item.itemDescription
                ? `<div class="muted" style="font-size:0.78rem">${escapeHtml(item.itemDescription)}</div>`
                : '';
            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(item.itemName)}</strong>
                        ${period}
                        ${desc}
                    </td>
                    <td class="num"><strong>${formatNumber(item.qty)}</strong></td>
                    <td class="num">${formatPeso(item.amount)}</td>
                </tr>`;
        })
        .join('');

    return `
        <div class="data-table-wrap">
            <table class="data-table meal-cook-table">
                <thead>
                    <tr>
                        <th>Item (prepare)</th>
                        <th class="num">Qty</th>
                        <th class="num">Amount</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function renderBrandOrders(group) {
    const brands = [...group.brandOrders.values()].sort((a, b) =>
        a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' })
    );

    if (!brands.length) return '';

    const cards = brands
        .map((brand) => {
            const lines = brand.lines
                .map((line) => {
                    const period =
                        line.periodKey && line.periodKey !== 'meal'
                            ? ` · ${escapeHtml(line.periodLabel || line.periodKey)}`
                            : '';
                    const desc = line.itemDescription
                        ? `<span class="muted"> — ${escapeHtml(line.itemDescription)}</span>`
                        : '';
                    return `<li><strong>${line.qty}×</strong> ${escapeHtml(line.itemName)}${desc}${period} <span class="muted">(${escapeHtml(formatPeso(line.lineTotal))})</span></li>`;
                })
                .join('');
            const meta = [
                brand.contactPerson || null,
                brand.contactNumber || null,
                brand.email || null,
                formatUpdatedAt(brand.updatedAt) ? `Updated ${formatUpdatedAt(brand.updatedAt)}` : null,
            ]
                .filter(Boolean)
                .map((t) => escapeHtml(t))
                .join(' · ');

            return `
                <article class="meal-brand-card">
                    <header>
                        <div>
                            <h4>${escapeHtml(brand.brandName)}</h4>
                            ${meta ? `<p class="muted">${meta}</p>` : ''}
                        </div>
                        <div class="meal-brand-totals">
                            <strong>${formatNumber(brand.qty)}</strong> items
                            <span>${formatPeso(brand.amount)}</span>
                        </div>
                    </header>
                    <ul>${lines}</ul>
                </article>`;
        })
        .join('');

    return `
        <div class="meal-brand-list">
            <h4 class="meal-subsection-title">Orders by brand</h4>
            ${cards}
        </div>`;
}

function render() {
    fillFilters();
    renderDayStrip();

    const dayOrders = filteredOrders();
    const flat = linesForView(dayOrders);
    const groups = groupBySupplier(flat);

    const merchantCount = new Set(dayOrders.map((o) => o.id)).size;
    const totalItems = flat.reduce((s, x) => s + x.line.qty, 0);
    const totalAmount = flat.reduce((s, x) => s + x.line.lineTotal, 0);

    $('mealSumOrders').textContent = formatNumber(merchantCount);
    $('mealSumItems').textContent = formatNumber(totalItems);
    $('mealSumAmount').textContent = formatPeso(totalAmount);
    $('mealSumSuppliers').textContent = formatNumber(groups.length);
    $('mealSummaryLabel').textContent = `${formatCrewDateLabel(selectedDay)} · filtered totals`;

    const root = $('mealOrdersRoot');
    if (!groups.length) {
        root.innerHTML = `
            <section class="hub-section" style="padding:1.25rem">
                <p class="muted" style="margin:0">No crew meal orders for this day / filter.</p>
            </section>`;
        return;
    }

    root.innerHTML = groups
        .map((group) => {
            return `
                <section class="hub-section meal-supplier-block">
                    <div class="meal-supplier-header">
                        <div>
                            <p class="meal-supplier-kicker">Supplier</p>
                            <h2>${escapeHtml(group.supplierName)}</h2>
                            <p class="muted">${formatNumber(group.totalQty)} items · ${formatPeso(group.totalAmount)} · ${formatNumber(group.brandOrders.size)} brand${group.brandOrders.size === 1 ? '' : 's'}</p>
                        </div>
                    </div>
                    <div class="meal-supplier-body">
                        <h3 class="meal-subsection-title">Cook sheet — total qty to prepare</h3>
                        ${renderItemRollup(group)}
                        ${renderBrandOrders(group)}
                    </div>
                </section>`;
        })
        .join('');
}

async function loadOrders() {
    const status = $('mealLoadStatus');
    status.textContent = 'Loading orders…';
    try {
        const { db, firestoreFns } = await initFirebase();
        const snap = await firestoreFns.getDocs(
            firestoreFns.collection(db, CREW_MEAL_ORDERS_COLLECTION)
        );
        orders = [];
        snap.forEach((docSnap) => {
            const order = normalizeOrder(docSnap.data() || {}, docSnap.id);
            if (order.date && order.lines.length) orders.push(order);
        });
        orders.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' });
        });

        if (!orders.some((o) => o.date === selectedDay)) {
            const firstWithOrders = EVENT_DAYS.find((d) => orders.some((o) => o.date === d.date));
            if (firstWithOrders) selectedDay = firstWithOrders.date;
        }

        status.textContent = `${orders.length} merchant order${orders.length === 1 ? '' : 's'} loaded.`;
        render();
    } catch (err) {
        console.error(err);
        status.textContent = 'Failed to load orders.';
    }
}

function exportCsv() {
    const flat = linesForView(filteredOrders());
    const rows = [
        [
            'date',
            'brandName',
            'supplierId',
            'supplierName',
            'period',
            'itemName',
            'itemDescription',
            'qty',
            'unitPrice',
            'lineTotal',
            'contactPerson',
            'contactNumber',
            'email',
            'updatedAt',
        ],
    ];

    flat
        .sort((a, b) => {
            if (a.order.date !== b.order.date) return a.order.date.localeCompare(b.order.date);
            if (a.line.supplierName !== b.line.supplierName) {
                return a.line.supplierName.localeCompare(b.line.supplierName);
            }
            if (a.order.brandName !== b.order.brandName) {
                return a.order.brandName.localeCompare(b.order.brandName);
            }
            return a.line.itemName.localeCompare(b.line.itemName);
        })
        .forEach(({ order, line }) => {
            rows.push([
                order.date,
                order.brandName,
                line.supplierId,
                line.supplierName,
                line.periodLabel || line.periodKey,
                line.itemName,
                line.itemDescription,
                line.qty,
                line.unitPrice,
                line.lineTotal,
                order.contactPerson,
                order.contactNumber,
                order.email,
                formatUpdatedAt(order.updatedAt) || '',
            ]);
        });

    const csv = rows
        .map((row) =>
            row
                .map((cell) => {
                    const s = String(cell ?? '');
                    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                })
                .join(',')
        )
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mmf-crew-meal-orders-${selectedDay || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

async function enterApp() {
    showApp();
    await loadOrders();
}

function main() {
    $('mealLoginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const status = $('mealGateStatus');
        if ($('mealPassword').value === ADMIN_PASSWORD) {
            setAuthed(true);
            status.textContent = '';
            enterApp().catch(console.error);
        } else {
            status.textContent = 'Incorrect password.';
            status.className = 'gate-status error';
        }
    });

    $('mealLogoutBtn').addEventListener('click', () => {
        setAuthed(false);
        showGate();
    });
    $('mealRefreshBtn').addEventListener('click', () => {
        loadOrders().catch(console.error);
    });
    $('mealExportBtn').addEventListener('click', exportCsv);
    $('mealFilterSupplier').addEventListener('change', render);
    $('mealFilterBrand').addEventListener('change', render);

    if (isAuthed()) {
        enterApp().catch(console.error);
    } else {
        showGate();
    }
}

main();
