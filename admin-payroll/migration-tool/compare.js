import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getFirestore, collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { formatDate, generatePayrollPeriods, getPeriodDatesFromId } from '../../shared/js/payrollPeriods.js';

const firebaseConfig = {
    apiKey: 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE',
    authDomain: 'matchanese-attendance.firebaseapp.com',
    projectId: 'matchanese-attendance',
    storageBucket: 'matchanese-attendance.firebasestorage.app',
    messagingSenderId: '339591618451',
    appId: '1:339591618451:web:23f9d95833ee5010bbd266',
    measurementId: 'G-YEK4GML6SJ'
};

const EARLIEST_CACHE_STORAGE_KEY = 'payroll_migration_v2_earliest_v1';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const logEl = document.getElementById('log');
const periodSelect = document.getElementById('periodSelect');
const btnLoad = document.getElementById('btnLoad');
const chkOnlyDiff = document.getElementById('chkOnlyDiff');
const tbody = document.getElementById('compareBody');
const summaryEl = document.getElementById('summary');

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    logEl.textContent += line;
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
}

function readEarliestCache() {
    try {
        const raw = localStorage.getItem(EARLIEST_CACHE_STORAGE_KEY);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (o.v !== 1 || o.projectId !== firebaseConfig.projectId) return null;
        if (!o.globalEarliestYmd || !/^\d{4}-\d{2}-\d{2}$/.test(o.globalEarliestYmd)) return null;
        return o;
    } catch {
        return null;
    }
}

function stableSerialize(val) {
    if (val === null || val === undefined) return 'null';
    const t = typeof val;
    if (t === 'number' || t === 'boolean') return JSON.stringify(val);
    if (t === 'string') return JSON.stringify(val);
    if (val && typeof val.toMillis === 'function') return `ts:${val.toMillis()}`;
    if (val && typeof val.seconds === 'number')
        return `ts:${val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6)}`;
    if (Array.isArray(val)) return `[${val.map(stableSerialize).join(',')}]`;
    if (t === 'object') {
        const keys = Object.keys(val).sort();
        return `{${keys.map((k) => JSON.stringify(k) + ':' + stableSerialize(val[k])).join(',')}}`;
    }
    return String(val);
}

function fullDocStable(data) {
    if (!data || typeof data !== 'object') return '';
    return stableSerialize(data);
}

function escapeHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function hasDoc(data) {
    return data != null && typeof data === 'object';
}

function rowStatus(legacyData, v2Data) {
    const hasL = hasDoc(legacyData);
    const hasV = hasDoc(v2Data);
    if (!hasL && !hasV) return 'empty';
    if (hasL && !hasV) return 'legacy-only';
    if (!hasL && hasV) return 'v2-only';
    if (fullDocStable(legacyData) === fullDocStable(v2Data)) return 'match';
    return 'mismatch';
}

function presentCell(yes) {
    if (yes) {
        return '<td class="cell-yes" title="Record exists"><span class="mark-yes">Present</span></td>';
    }
    return '<td class="cell-no" title="No record"><span class="mark-no">—</span></td>';
}

function fillPeriodDropdown() {
    const cached = readEarliestCache();
    const today = new Date();
    let start;
    if (cached?.globalEarliestYmd) {
        const p = cached.globalEarliestYmd.split('-').map((x) => parseInt(x, 10));
        start = new Date(p[0], p[1] - 1, p[2]);
    } else {
        start = new Date(today);
        start.setMonth(start.getMonth() - 18);
    }
    const periods = generatePayrollPeriods(start, today, false, 0);
    periodSelect.innerHTML = periods
        .map(
            (p) =>
                `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)} (${escapeHtml(
                    formatDate(p.start)
                )} → ${escapeHtml(formatDate(p.end))})</option>`
        )
        .join('');
    log(`Period dropdown: ${periods.length} period(s)${cached ? ' (from migration earliest cache)' : ' (default ~18mo lookback — run migration “Load all periods” once to use scan cache)'}.`);
}

async function loadComparison() {
    const periodId = periodSelect.value;
    const bounds = getPeriodDatesFromId(periodId);
    if (!bounds) {
        log('Invalid period.');
        return;
    }
    const startYmd = formatDate(bounds.startDate);
    const endYmd = formatDate(bounds.endDate);
    const onlyDiff = chkOnlyDiff.checked;

    btnLoad.disabled = true;
    tbody.innerHTML =
        '<tr><td colspan="4" class="muted">Loading employees and attendance range…</td></tr>';
    summaryEl.textContent = '';

    const t0 = performance.now();
    try {
        const empSnap = await getDocs(collection(db, 'employees_v2'));
        /** @type {Map<string, string>} */
        const nameById = new Map();
        empSnap.docs.forEach((d) => {
            const n = d.data()?.name;
            nameById.set(d.id, typeof n === 'string' && n.trim() ? n.trim() : d.id);
        });
        const employeeIds = empSnap.docs.map((d) => d.id);
        log(`employees_v2: ${employeeIds.length} id(s). Range ${startYmd} … ${endYmd}`);

        const chunkSize = 8;
        /** @type {{ employeeId: string, dateStr: string, legacy: object|null, v2: object|null, status: string }[]} */
        const rows = [];

        for (let i = 0; i < employeeIds.length; i += chunkSize) {
            const chunk = employeeIds.slice(i, i + chunkSize);
            await Promise.all(
                chunk.map(async (employeeId) => {
                    const legCol = collection(db, 'attendance', employeeId, 'dates');
                    const v2Col = collection(db, 'attendance_v2', employeeId, 'dates');
                    const qLeg = query(legCol, where('__name__', '>=', startYmd), where('__name__', '<=', endYmd));
                    const qV2 = query(v2Col, where('__name__', '>=', startYmd), where('__name__', '<=', endYmd));
                    const [legSnap, v2Snap] = await Promise.all([getDocs(qLeg), getDocs(qV2)]);

                    const legMap = new Map();
                    legSnap.forEach((d) => legMap.set(d.id, d.data()));
                    const v2Map = new Map();
                    v2Snap.forEach((d) => v2Map.set(d.id, d.data()));

                    const dateSet = new Set([...legMap.keys(), ...v2Map.keys()]);
                    for (const dateStr of [...dateSet].sort()) {
                        const legacy = legMap.get(dateStr) ?? null;
                        const v2 = v2Map.get(dateStr) ?? null;
                        const status = rowStatus(legacy, v2);
                        if (status === 'empty') continue;
                        rows.push({ employeeId, dateStr, legacy, v2, status });
                    }
                })
            );
        }

        const displayName = (id) => nameById.get(id) || id;
        rows.sort((a, b) => {
            const na = displayName(a.employeeId);
            const nb = displayName(b.employeeId);
            if (na !== nb) return na.localeCompare(nb, undefined, { sensitivity: 'base' });
            if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
            return a.employeeId.localeCompare(b.employeeId);
        });

        let match = 0,
            mismatch = 0,
            legacyOnly = 0,
            v2Only = 0;
        for (const r of rows) {
            if (r.status === 'match') match++;
            else if (r.status === 'mismatch') mismatch++;
            else if (r.status === 'legacy-only') legacyOnly++;
            else if (r.status === 'v2-only') v2Only++;
        }

        const displayRows = onlyDiff ? rows.filter((r) => r.status !== 'match') : rows;

        summaryEl.innerHTML = `
            <strong>${escapeHtml(periodId)}</strong> · ${rows.length} row(s) (at least one side)
            · both match ${match} · content differs ${mismatch} · legacy only ${legacyOnly} · new only ${v2Only}
            · showing ${displayRows.length}${onlyDiff ? ' (hidden: both present &amp; same data)' : ''}
            · ${((performance.now() - t0) / 1000).toFixed(1)}s`;

        if (displayRows.length === 0) {
            tbody.innerHTML =
                '<tr><td colspan="4" class="muted">No rows to show for this filter.</td></tr>';
            log('Done — no rows.');
            return;
        }

        tbody.innerHTML = displayRows
            .map((r) => {
                const hasL = hasDoc(r.legacy);
                const hasV = hasDoc(r.v2);
                const rowClass =
                    r.status === 'mismatch'
                        ? 'row-mismatch'
                        : r.status === 'match'
                          ? 'row-match'
                          : 'row-partial';
                const nm = displayName(r.employeeId);
                const nameCell =
                    nm !== r.employeeId
                        ? `<div class="name-main">${escapeHtml(nm)}</div><div class="name-id mono" title="Employee id">${escapeHtml(r.employeeId)}</div>`
                        : `<div class="name-main mono">${escapeHtml(r.employeeId)}</div>`;
                return `<tr class="${rowClass}">
                    <td class="td-name">${nameCell}</td>
                    <td class="mono">${escapeHtml(r.dateStr)}</td>
                    ${presentCell(hasL)}
                    ${presentCell(hasV)}
                </tr>`;
            })
            .join('');

        log(`Comparison ready: ${displayRows.length} display row(s) from ${rows.length} total.`);
    } catch (e) {
        log(`ERROR: ${e.message || e}`);
        tbody.innerHTML = `<tr><td colspan="4" class="err">${escapeHtml(e.message || String(e))}</td></tr>`;
    } finally {
        btnLoad.disabled = false;
    }
}

fillPeriodDropdown();
btnLoad.addEventListener('click', () => loadComparison());
