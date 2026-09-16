import {
    ADMIN_PASSWORD,
    ADMIN_SESSION_KEY,
    EVENT_DAYS,
    KOL_COLLECTION,
    SALES_COLLECTION,
    formatNumber,
    formatPeso,
    formatUpdatedAt,
} from './config.js';
import { initFirebase } from './firebase.js';

const $ = (id) => document.getElementById(id);

let salesDocs = [];
let kolDocs = [];

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isAdminAuthed() {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
}

function setAdminAuthed(on) {
    if (on) sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
    else sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

function showGate() {
    $('adminGate').classList.remove('hidden');
    $('adminApp').classList.add('hidden');
    document.body.classList.add('gate-body');
    document.body.classList.remove('admin-body');
}

function showApp() {
    $('adminGate').classList.add('hidden');
    $('adminApp').classList.remove('hidden');
    document.body.classList.remove('gate-body');
    document.body.classList.add('admin-body');
}

function fillFilters() {
    const daySel = $('filterDay');
    const currentDay = daySel.value;
    daySel.innerHTML =
        '<option value="">All days</option>' +
        EVENT_DAYS.map((d) => `<option value="${d.date}">${escapeHtml(d.label)}</option>`).join('');
    if (currentDay) daySel.value = currentDay;

    const brands = new Set();
    salesDocs.forEach((d) => brands.add(d.brandName));
    kolDocs.forEach((d) => brands.add(d.brandName));
    const brandList = [...brands].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const brandSel = $('filterBrand');
    const currentBrand = brandSel.value;
    brandSel.innerHTML =
        '<option value="">All brands</option>' +
        brandList.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    if (currentBrand) brandSel.value = currentBrand;
}

function filteredSales() {
    const day = $('filterDay').value;
    const brand = $('filterBrand').value;
    return salesDocs.filter((d) => {
        if (day && d.date !== day) return false;
        if (brand && d.brandName !== brand) return false;
        return true;
    });
}

function filteredKol() {
    const day = $('filterDay').value;
    const brand = $('filterBrand').value;
    return kolDocs.filter((d) => {
        if (day && d.date !== day) return false;
        if (brand && d.brandName !== brand) return false;
        return true;
    });
}

function normalizeSalesDoc(data, id) {
    const cashSales =
        data.cashSales != null
            ? Number(data.cashSales) || 0
            : Number(data.grossSales) || 0;
    return {
        id,
        merchantId: data.merchantId || '',
        brandName: String(data.brandName || '').trim() || '—',
        date: data.date || '',
        cashSales,
        updatedAt: data.updatedAt || null,
    };
}

function normalizeKolDoc(data, id) {
    let drinksClaimed = Number(data.drinksClaimed);
    let retailClaimed = Number(data.retailClaimed);
    if (!Number.isFinite(drinksClaimed) && Array.isArray(data.claims)) {
        drinksClaimed = data.claims
            .filter((c) => (c.type || 'drink') === 'drink')
            .reduce((s, c) => s + (Number(c.qty) || 0), 0);
    }
    if (!Number.isFinite(retailClaimed) && Array.isArray(data.claims)) {
        retailClaimed = data.claims
            .filter((c) => c.type === 'retail')
            .reduce((s, c) => s + (Number(c.qty) || 0), 0);
    }
    return {
        id,
        merchantId: data.merchantId || '',
        brandName: String(data.brandName || '').trim() || '—',
        date: data.date || '',
        drinksClaimed: Math.max(0, Math.round(drinksClaimed || 0)),
        retailClaimed: Math.max(0, Math.round(retailClaimed || 0)),
        updatedAt: data.updatedAt || null,
    };
}

function render() {
    const sales = filteredSales().sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' });
    });
    const kol = filteredKol().sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' });
    });

    const cash = sales.reduce((s, d) => s + (Number(d.cashSales) || 0), 0);
    const drinks = kol.reduce((s, d) => s + (Number(d.drinksClaimed) || 0), 0);
    const retail = kol.reduce((s, d) => s + (Number(d.retailClaimed) || 0), 0);

    $('sumGross').textContent = formatPeso(cash);
    $('sumKolDrinks').textContent = formatNumber(drinks);
    $('sumKolRetail').textContent = formatNumber(retail);
    $('sumReports').textContent = formatNumber(sales.length);

    const salesBody = $('salesTableBody');
    if (!sales.length) {
        salesBody.innerHTML = '<tr><td colspan="4" class="muted">No sales reports for this filter.</td></tr>';
    } else {
        salesBody.innerHTML = sales
            .map(
                (d) => `
            <tr>
                <td>${escapeHtml(d.date)}</td>
                <td>${escapeHtml(d.brandName)}</td>
                <td class="num">${formatPeso(d.cashSales)}</td>
                <td>${escapeHtml(formatUpdatedAt(d.updatedAt) || '—')}</td>
            </tr>`
            )
            .join('');
    }

    const kolBody = $('kolTableBody');
    if (!kol.length) {
        kolBody.innerHTML = '<tr><td colspan="5" class="muted">No KOL claims for this filter.</td></tr>';
    } else {
        kolBody.innerHTML = kol
            .map(
                (d) => `
            <tr>
                <td>${escapeHtml(d.date)}</td>
                <td>${escapeHtml(d.brandName)}</td>
                <td class="num">${formatNumber(d.drinksClaimed)}</td>
                <td class="num">${formatNumber(d.retailClaimed)}</td>
                <td>${escapeHtml(formatUpdatedAt(d.updatedAt) || '—')}</td>
            </tr>`
            )
            .join('');
    }
}

async function loadAll() {
    $('salesTableBody').innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';
    $('kolTableBody').innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';

    const { db, firestoreFns } = await initFirebase();
    const [salesSnap, kolSnap] = await Promise.all([
        firestoreFns.getDocs(firestoreFns.collection(db, SALES_COLLECTION)),
        firestoreFns.getDocs(firestoreFns.collection(db, KOL_COLLECTION)),
    ]);

    salesDocs = [];
    salesSnap.forEach((docSnap) => {
        salesDocs.push(normalizeSalesDoc(docSnap.data() || {}, docSnap.id));
    });

    kolDocs = [];
    kolSnap.forEach((docSnap) => {
        kolDocs.push(normalizeKolDoc(docSnap.data() || {}, docSnap.id));
    });

    fillFilters();
    render();
}

function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function downloadCsv(filename, rows) {
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function exportSales() {
    const sales = filteredSales().sort(
        (a, b) => a.date.localeCompare(b.date) || a.brandName.localeCompare(b.brandName)
    );
    const rows = [
        ['date', 'brandName', 'merchantId', 'cashSales', 'updatedAt'],
        ...sales.map((d) => [
            d.date,
            d.brandName,
            d.merchantId,
            d.cashSales,
            formatUpdatedAt(d.updatedAt),
        ]),
    ];
    downloadCsv(`mmf-hub-sales-${Date.now()}.csv`, rows);
}

function exportKol() {
    const kol = filteredKol().sort(
        (a, b) => a.date.localeCompare(b.date) || a.brandName.localeCompare(b.brandName)
    );
    const rows = [
        ['date', 'brandName', 'merchantId', 'drinksClaimed', 'retailClaimed', 'updatedAt'],
        ...kol.map((d) => [
            d.date,
            d.brandName,
            d.merchantId,
            d.drinksClaimed,
            d.retailClaimed,
            formatUpdatedAt(d.updatedAt),
        ]),
    ];
    downloadCsv(`mmf-hub-kol-${Date.now()}.csv`, rows);
}

function main() {
    $('adminLoginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const status = $('adminGateStatus');
        if ($('adminPassword').value === ADMIN_PASSWORD) {
            setAdminAuthed(true);
            $('adminPassword').value = '';
            showApp();
            loadAll().catch((err) => console.error(err));
        } else {
            status.textContent = 'Incorrect password.';
            status.className = 'gate-status error';
        }
    });

    $('adminLogoutBtn').addEventListener('click', () => {
        setAdminAuthed(false);
        showGate();
    });
    $('refreshBtn').addEventListener('click', () => loadAll().catch(console.error));
    $('filterDay').addEventListener('change', render);
    $('filterBrand').addEventListener('change', render);
    $('exportSalesBtn').addEventListener('click', exportSales);
    $('exportKolBtn').addEventListener('click', exportKol);

    if (isAdminAuthed()) {
        showApp();
        loadAll().catch(console.error);
    } else {
        showGate();
    }
}

main();
