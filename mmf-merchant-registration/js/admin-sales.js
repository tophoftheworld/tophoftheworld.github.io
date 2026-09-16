import {
    ADMIN_PASSWORD,
    COLLECTION_NAME,
    EVENT_DAYS,
    SALES_COLLECTION,
    formatPeso,
} from './config.js';
import { initFirebase } from './firebase.js';

const SESSION_KEY = 'mmf_merchant_reg_admin';
const $ = (id) => document.getElementById(id);

let submissions = [];
let salesReports = [];
/** @type {'brand' | 'total' | string} sort key — brand, total, or day date YYYY-MM-DD */
let sortKey = 'brand';
/** @type {'asc' | 'desc'} */
let sortDir = 'asc';

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
    $('adminGate')?.classList.remove('hidden');
    $('adminApp')?.classList.add('hidden');
}

function showApp() {
    $('adminGate')?.classList.add('hidden');
    $('adminApp')?.classList.remove('hidden');
}

function cashFromSalesDoc(doc) {
    if (!doc) return null;
    if (doc.cashSales != null) return Number(doc.cashSales) || 0;
    if (doc.grossSales != null) return Number(doc.grossSales) || 0;
    return null;
}

function brandNameFor(merchantId, fallback = '') {
    const reg = submissions.find((s) => s.id === merchantId);
    return (
        String(reg?.brandName || '').trim() ||
        String(fallback || '').trim() ||
        merchantId ||
        '—'
    );
}

function activeMerchants() {
    const byId = new Map();
    submissions
        .filter((doc) => !doc.archived && String(doc.submissionState || '').toLowerCase() !== 'draft')
        .forEach((doc) => {
            byId.set(doc.id, {
                merchantId: doc.id,
                brandName: brandNameFor(doc.id, doc.brandName),
            });
        });

    // Include any sales reporter not in active registrations
    salesReports.forEach((d) => {
        const id = d.merchantId;
        if (!id || byId.has(id)) return;
        byId.set(id, {
            merchantId: id,
            brandName: brandNameFor(id, d.brandName),
        });
    });

    return [...byId.values()].sort((a, b) =>
        a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' })
    );
}

function salesFor(merchantId, date) {
    return salesReports.find((d) => d.merchantId === merchantId && d.date === date) || null;
}

function visibleDays() {
    const dayFilter = $('filterDay')?.value || '';
    return dayFilter ? EVENT_DAYS.filter((d) => d.date === dayFilter) : EVENT_DAYS;
}

function visibleBrands() {
    const brandFilter = $('filterBrand')?.value || '';
    const all = activeMerchants();
    return brandFilter ? all.filter((b) => b.brandName === brandFilter) : all;
}

function fillFilters() {
    const daySel = $('filterDay');
    const brandSel = $('filterBrand');
    const currentDay = daySel?.value || '';
    const currentBrand = brandSel?.value || '';

    if (daySel) {
        daySel.innerHTML =
            '<option value="">All days</option>' +
            EVENT_DAYS.map(
                (d) => `<option value="${escapeHtml(d.date)}">${escapeHtml(d.label)}</option>`
            ).join('');
        daySel.value = currentDay;
    }

    const brands = activeMerchants().map((b) => b.brandName).filter(Boolean);
    if (brandSel) {
        brandSel.innerHTML =
            '<option value="">All brands</option>' +
            brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
        brandSel.value = currentBrand;
    }
}

function buildMatrix() {
    const days = visibleDays();
    const brands = visibleBrands();
    const dayTotals = days.map(() => 0);
    let grandTotal = 0;
    let reportedCells = 0;

    const rows = brands.map((brand) => {
        let brandTotal = 0;
        let brandDays = 0;
        const cells = days.map((day, i) => {
            const cash = cashFromSalesDoc(salesFor(brand.merchantId, day.date));
            if (cash != null) {
                brandTotal += cash;
                dayTotals[i] += cash;
                grandTotal += cash;
                brandDays += 1;
                reportedCells += 1;
            }
            return cash;
        });
        return { ...brand, cells, brandTotal, brandDays };
    });

    return { days, brands, rows, dayTotals, grandTotal, reportedCells };
}

function sortIndicator(key) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? '↑' : '↓';
}

function sortRows(rows, days) {
    const dir = sortDir === 'asc' ? 1 : -1;
    const dayIndex = days.findIndex((d) => d.date === sortKey);

    return [...rows].sort((a, b) => {
        if (sortKey === 'brand') {
            return (
                dir *
                a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' })
            );
        }
        if (sortKey === 'total') {
            const av = Number(a.brandTotal) || 0;
            const bv = Number(b.brandTotal) || 0;
            if (av !== bv) return dir * (av - bv);
            return a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' });
        }
        if (dayIndex >= 0) {
            const av = a.cells[dayIndex];
            const bv = b.cells[dayIndex];
            const an = av == null ? -1 : Number(av) || 0;
            const bn = bv == null ? -1 : Number(bv) || 0;
            if (an !== bn) return dir * (an - bn);
            return a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' });
        }
        return 0;
    });
}

function setSort(key) {
    if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey = key;
        sortDir = key === 'brand' ? 'asc' : 'desc';
    }
    render();
}

function bindSortHeaders(root) {
    root?.querySelectorAll('[data-sort]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            setSort(btn.getAttribute('data-sort') || 'brand');
        });
    });
}

function render() {
    const matrix = buildMatrix();
    const { days, dayTotals, grandTotal, reportedCells } = matrix;
    const rows = sortRows(matrix.rows, days);
    const root = $('dailySections');

    const headDays = days
        .map((d) => {
            const active = sortKey === d.date ? ' active' : '';
            return `<th class="num admin-sales-day-col">
                <button type="button" class="admin-sort-btn${active}" data-sort="${escapeHtml(d.date)}">
                    <span class="admin-sales-day-top">
                        ${escapeHtml(`D${d.day}`)}
                        <span class="admin-sort-ind" aria-hidden="true">${sortIndicator(d.date) || '\u00a0'}</span>
                    </span>
                    <span class="admin-sales-day-sub">${escapeHtml(d.label.replace(/^Day \d+ · /, ''))}</span>
                </button>
            </th>`;
        })
        .join('');

    const body = rows.length
        ? rows
              .map((r) => {
                  const cells = r.cells
                      .map(
                          (cash) =>
                              `<td class="num admin-sales-day-col">${cash != null ? escapeHtml(formatPeso(cash)) : '—'}</td>`
                      )
                      .join('');
                  return `
                    <tr>
                        <td class="admin-sales-brand">${escapeHtml(r.brandName)}</td>
                        ${cells}
                        <td class="num admin-sales-total">${escapeHtml(formatPeso(r.brandTotal))}</td>
                    </tr>`;
              })
              .join('')
        : `<tr><td colspan="${days.length + 2}" class="muted">No brands to show.</td></tr>`;

    const footDays = dayTotals
        .map((t) => `<td class="num admin-sales-day-col"><strong>${escapeHtml(formatPeso(t))}</strong></td>`)
        .join('');

    const brandActive = sortKey === 'brand' ? ' active' : '';
    const totalActive = sortKey === 'total' ? ' active' : '';

    if (root) {
        root.innerHTML = `
            <section class="admin-sales-day">
                <div class="admin-table-wrap admin-sales-matrix-wrap">
                    <table class="admin-data-table admin-report-table admin-sales-matrix">
                        <thead>
                            <tr>
                                <th class="admin-sales-brand">
                                    <button type="button" class="admin-sort-btn${brandActive}" data-sort="brand">
                                        Brand
                                        <span class="admin-sort-ind" aria-hidden="true">${sortIndicator('brand') || '\u00a0'}</span>
                                    </button>
                                </th>
                                ${headDays}
                                <th class="num admin-sales-total">
                                    <button type="button" class="admin-sort-btn${totalActive}" data-sort="total">
                                        Total
                                        <span class="admin-sort-ind" aria-hidden="true">${sortIndicator('total') || '\u00a0'}</span>
                                    </button>
                                </th>
                            </tr>
                        </thead>
                        <tbody>${body}</tbody>
                        <tfoot>
                            <tr>
                                <td class="admin-sales-brand"><strong>Day total</strong></td>
                                ${footDays}
                                <td class="num admin-sales-total"><strong>${escapeHtml(formatPeso(grandTotal))}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>`;
        bindSortHeaders(root);
    }

    const summary = $('summaryGrid');
    if (summary) {
        summary.innerHTML = `
            <div class="admin-report-stat">
                <span class="label">Cash sales</span>
                <strong>${escapeHtml(formatPeso(grandTotal))}</strong>
            </div>
            <div class="admin-report-stat">
                <span class="label">Brands</span>
                <strong>${escapeHtml(String(rows.length))}</strong>
            </div>
            <div class="admin-report-stat">
                <span class="label">Reports filed</span>
                <strong>${escapeHtml(String(reportedCells))}</strong>
            </div>`;
    }

    const count = $('adminCount');
    if (count) {
        count.textContent = `${rows.length} brands · ${reportedCells} day report${reportedCells === 1 ? '' : 's'}`;
    }
}

function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function exportCsv() {
    const { days, rows, dayTotals, grandTotal } = buildMatrix();
    const header = ['brandName', 'merchantId', ...days.map((d) => d.date), 'total'];
    const out = [header];

    rows.forEach((r) => {
        out.push([
            r.brandName,
            r.merchantId,
            ...r.cells.map((c) => (c != null ? c : '')),
            r.brandTotal,
        ]);
    });
    out.push(['Day total', '', ...dayTotals, grandTotal]);

    const csv = out.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mmf-daily-sales-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

async function loadAll() {
    const root = $('dailySections');
    if (root) root.innerHTML = '<div class="admin-loading">Loading sales…</div>';
    $('adminCount').textContent = 'Loading…';

    try {
        const { db, firestoreFns } = await initFirebase();
        const [subSnap, salesSnap] = await Promise.all([
            firestoreFns.getDocs(firestoreFns.collection(db, COLLECTION_NAME)),
            firestoreFns.getDocs(firestoreFns.collection(db, SALES_COLLECTION)),
        ]);
        submissions = subSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        salesReports = salesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        fillFilters();
        render();
    } catch (err) {
        console.error('[MMF Sales] load failed', err);
        if (root) {
            root.innerHTML = `<div class="admin-empty">Failed to load: ${escapeHtml(err?.message || 'Unknown error')}</div>`;
        }
        $('adminCount').textContent = 'Error loading';
    }
}

function init() {
    if (isAuthed()) {
        showApp();
        loadAll();
    } else {
        showGate();
    }

    $('adminLogin')?.addEventListener('click', () => {
        const val = $('adminPassword')?.value || '';
        const err = $('adminPassError');
        if (val === ADMIN_PASSWORD) {
            err?.classList.remove('visible');
            setAuthed(true);
            showApp();
            loadAll();
        } else {
            err?.classList.add('visible');
        }
    });
    $('adminPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('adminLogin')?.click();
    });
    $('adminLogout')?.addEventListener('click', () => {
        setAuthed(false);
        showGate();
    });
    $('adminRefresh')?.addEventListener('click', () => loadAll());
    $('exportCsvBtn')?.addEventListener('click', () => exportCsv());
    $('filterDay')?.addEventListener('change', () => render());
    $('filterBrand')?.addEventListener('change', () => render());
}

init();
