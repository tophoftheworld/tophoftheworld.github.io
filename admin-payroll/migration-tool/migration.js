import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
    getFirestore,
    collection,
    getDocs,
    doc,
    getDoc,
    setDoc,
    addDoc,
    query,
    where
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {formatDate, generatePayrollPeriods, getPeriodDatesFromId} from '../../shared/js/payrollPeriods.js';

const firebaseConfig = {
    apiKey: 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE',
    authDomain: 'matchanese-attendance.firebaseapp.com',
    projectId: 'matchanese-attendance',
    storageBucket: 'matchanese-attendance.firebasestorage.app',
    messagingSenderId: '339591618451',
    appId: '1:339591618451:web:23f9d95833ee5010bbd266',
    measurementId: 'G-YEK4GML6SJ'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const MIG_STATUS = 'migration_v2_status';
/** When legacy vs v2 attendance differ, both snapshots + merged result are stored here for audit/rollback. */
const MIG_ATT_BACKUP_COLLECTION = 'migration_v2_attendance_diffs';
/** One-time employees + payments status (not tied to a pay period). Cannot use __…__ — Firestore reserves those ids. */
const GLOBAL_STATUS_DOC_ID = 'v2_global_status';
const EARLIEST_CACHE_STORAGE_KEY = 'payroll_migration_v2_earliest_v1';

/** @typedef {{ v: number, projectId: string, globalEarliestYmd: string, cachedAt: string, fromAttendance?: string|null, fromPayments?: string|null, employeeCount?: number, paymentDocCount?: number }} EarliestCache */

const ST = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETE: 'complete',
    ERROR: 'error'
};

let globalMigrationStatus = {
    employeesStatus: ST.PENDING,
    paymentsStatus: ST.PENDING,
    lastError: undefined
};

const logEl = document.getElementById('log');
/** @type {{ id: string, label: string, start: Date, end: Date }[]} */
let loadedPeriods = [];
let statusByPeriod = {};
let periodTableLoading = false;

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    logEl.textContent += line;
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
}

/** @returns {EarliestCache | null} */
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

/** @param {Partial<EarliestCache> & { globalEarliestYmd: string }} data */
function writeEarliestCache(data) {
    try {
        /** @type {EarliestCache} */
        const payload = {
            v: 1,
            projectId: firebaseConfig.projectId,
            globalEarliestYmd: data.globalEarliestYmd,
            cachedAt: new Date().toISOString(),
            fromAttendance: data.fromAttendance ?? null,
            fromPayments: data.fromPayments ?? null,
            employeeCount: data.employeeCount,
            paymentDocCount: data.paymentDocCount
        };
        localStorage.setItem(EARLIEST_CACHE_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
        log(`Could not save local cache: ${e.message || e}`);
    }
}

function clearEarliestCache() {
    try {
        localStorage.removeItem(EARLIEST_CACHE_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

function setBusy(busy) {
    document.querySelectorAll('button').forEach((btn) => {
        btn.disabled = !!busy;
    });
}

function statusRef(periodId) {
    return doc(db, MIG_STATUS, periodId);
}

function globalStatusRef() {
    return doc(db, MIG_STATUS, GLOBAL_STATUS_DOC_ID);
}

async function loadGlobalStatus() {
    const snap = await getDoc(globalStatusRef());
    const d = snap.exists() ? snap.data() : {};
    globalMigrationStatus = {
        employeesStatus: d.employeesStatus || ST.PENDING,
        paymentsStatus: d.paymentsStatus || ST.PENDING,
        lastError: d.lastError || undefined
    };
}

async function patchGlobalStatus(patch) {
    await setDoc(
        globalStatusRef(),
        {...patch, statusUpdatedAt: new Date().toISOString()},
        {merge: true}
    );
    globalMigrationStatus = {...globalMigrationStatus, ...patch};
}

async function patchStatus(periodId, patch) {
    await setDoc(
        statusRef(periodId),
        {...patch, statusUpdatedAt: new Date().toISOString()},
        {merge: true}
    );
    mergeLocalStatus(periodId, patch);
}

function mergeLocalStatus(periodId, patch) {
    statusByPeriod[periodId] = {...(statusByPeriod[periodId] || {}), ...patch};
}

async function loadStatusDoc(periodId) {
    const snap = await getDoc(statusRef(periodId));
    const d = snap.exists() ? snap.data() : {};
    const le = d.lastError;
    const lastError =
        le && (le.section === 'attendance' || !le.section)
            ? le
            : undefined;
    statusByPeriod[periodId] = {
        attendanceStatus: d.attendanceStatus || ST.PENDING,
        lastError
    };
}

async function refreshAllStatuses() {
    statusByPeriod = {};
    await loadGlobalStatus();
    const n = loadedPeriods.length;
    if (n > 0) {
        log(`[status] Fetching global + ${n} period doc(s) from migration_v2_status…`);
        const t0 = performance.now();
        await Promise.all(loadedPeriods.map((p) => loadStatusDoc(p.id)));
        log(`[status] Loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    }
    renderTable();
    log(`Status refreshed (global + ${n} period row(s)).`);
}

function badge(cls, text) {
    return `<span class="status status-${cls}">${text}</span>`;
}

function statusLabel(raw) {
    const v = raw || ST.PENDING;
    if (v === ST.COMPLETE) return badge('complete', 'Complete');
    if (v === ST.IN_PROGRESS) return badge('in_progress', 'In progress');
    if (v === ST.ERROR) return badge('error', 'Error');
    return badge('pending', 'Pending');
}

function rowError(periodId) {
    const e = statusByPeriod[periodId]?.lastError;
    if (!e || !e.message) return '';
    return `<div class="err-hint" title="${escapeAttr(e.message)}">attendance: ${escapeHtml(e.message.slice(0, 80))}${e.message.length > 80 ? '…' : ''}</div>`;
}

function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}

function renderGlobalStatusCells() {
    const eEl = document.getElementById('globalStatusEmployees');
    const pEl = document.getElementById('globalStatusPayments');
    if (eEl) eEl.innerHTML = statusLabel(globalMigrationStatus.employeesStatus);
    if (pEl) pEl.innerHTML = statusLabel(globalMigrationStatus.paymentsStatus);
}

function renderTable() {
    const tbody = document.getElementById('periodTableBody');
    renderGlobalStatusCells();

    if (periodTableLoading) {
        tbody.innerHTML =
            '<tr><td colspan="4" class="note" style="padding:1rem;">Scanning Firestore for full date range…</td></tr>';
        return;
    }
    if (!loadedPeriods.length) {
        tbody.innerHTML =
            '<tr><td colspan="4" class="note" style="padding:1rem;">No periods found (no attendance dates or payment_confirmations with period ids). Click “Load all periods” to retry.</td></tr>';
        return;
    }

    tbody.innerHTML = loadedPeriods
        .map((p) => {
            const st = statusByPeriod[p.id] || {};
            const att = st.attendanceStatus || ST.PENDING;
            return `<tr data-period-id="${escapeAttr(p.id)}">
            <td>${escapeHtml(p.label)}<div class="note">${formatDate(p.start)} → ${formatDate(p.end)}</div></td>
            <td><span class="period-id">${escapeHtml(p.id)}</span>${rowError(p.id)}</td>
            <td>${statusLabel(att)}</td>
            <td>
                <button type="button" class="btn-row btn-ok" data-action="attendance" data-period="${escapeAttr(p.id)}">Attendance</button>
            </td>
        </tr>`;
        })
        .join('');

    tbody.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => runRowAction(btn.dataset.action, btn.dataset.period));
    });
}

/**
 * Walk every employee’s `attendance/{id}/dates` subcollection (slow on large data).
 * @returns {{ ymd: string|null, employeeCount: number, dateDocsTouched: number, employeesWithDates: number }}
 */
async function scanOldestLegacyAttendanceVerbose() {
    const t0 = performance.now();
    const listT0 = performance.now();
    const empSnap = await getDocs(collection(db, 'employees'));
    const total = empSnap.docs.length;
    log(
        `[scan/attendance] Employees collection: ${total} doc(s) listed in ${((performance.now() - listT0) / 1000).toFixed(2)}s`
    );

    let oldest = null;
    let dateDocsTouched = 0;
    let employeesWithDates = 0;
    const progressEvery = total <= 25 ? 1 : Math.max(1, Math.ceil(total / 25));

    for (let i = 0; i < empSnap.docs.length; i++) {
        const d = empSnap.docs[i];
        const subT0 = performance.now();
        const datesCol = collection(db, 'attendance', d.id, 'dates');
        const snap = await getDocs(datesCol);
        const nDates = snap.size;
        dateDocsTouched += nDates;
        if (nDates > 0) employeesWithDates++;

        snap.forEach((docSnap) => {
            const id = docSnap.id;
            if (/^\d{4}-\d{2}-\d{2}$/.test(id)) {
                if (!oldest || id < oldest) oldest = id;
            }
        });

        const idx = i + 1;
        if (idx === 1 || idx === total || idx % progressEvery === 0) {
            log(
                `[scan/attendance] ${idx}/${total} id=${d.id} — ${nDates} date doc(s) in ${((performance.now() - subT0) / 1000).toFixed(2)}s, running oldest=${oldest ?? '—'}`
            );
        }
    }

    log(
        `[scan/attendance] Done in ${((performance.now() - t0) / 1000).toFixed(1)}s — employees with ≥1 date: ${employeesWithDates}/${total}, date docs read: ${dateDocsTouched}, oldest YMD: ${oldest ?? 'none'}`
    );
    return {ymd: oldest, employeeCount: total, dateDocsTouched, employeesWithDates};
}

/** @returns {{ ymd: string|null, docCount: number, matchedPeriodShape: number }} */
async function scanPaymentConfirmationsEarliestVerbose() {
    const t0 = performance.now();
    log('[scan/payments] Fetching payment_confirmations…');
    const snap = await getDocs(collection(db, 'payment_confirmations'));
    const afterFetch = performance.now();
    log(
        `[scan/payments] ${snap.size} document(s) in ${((afterFetch - t0) / 1000).toFixed(2)}s — scanning doc ids…`
    );

    let oldest = null;
    let matchedPeriodShape = 0;
    const re = /_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;
    const docs = snap.docs;
    const chunk = Math.max(500, Math.ceil(docs.length / 20) || 500);

    for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        const m = d.id.match(re);
        if (!m) continue;
        matchedPeriodShape++;
        const start = m[1];
        if (!oldest || start < oldest) oldest = start;

        if (i > 0 && (i % chunk === 0 || i === docs.length - 1)) {
            log(
                `[scan/payments] … ${i + 1}/${docs.length} ids, matches=${matchedPeriodShape}, oldest period start=${oldest ?? '—'}`
            );
        }
    }

    log(
        `[scan/payments] Done in ${((performance.now() - t0) / 1000).toFixed(1)}s — docs matching *_YYYY-MM-DD_YYYY-MM-DD: ${matchedPeriodShape}, oldest period start: ${oldest ?? 'none'}`
    );
    return {ymd: oldest, docCount: snap.size, matchedPeriodShape};
}

/** Full Firestore scan (parallel): attendance date docs ∪ payment confirmation period ids. */
async function scanFirestoreForGlobalEarliest() {
    const wall0 = performance.now();
    log('[scan] Starting (attendance subcollections + payment_confirmations in parallel)…');
    const [att, pay] = await Promise.all([
        scanOldestLegacyAttendanceVerbose(),
        scanPaymentConfirmationsEarliestVerbose()
    ]);

    let best = null;
    if (att.ymd && (!best || att.ymd < best)) best = att.ymd;
    if (pay.ymd && (!best || pay.ymd < best)) best = pay.ymd;

    log(
        `[scan] Combined earliest day: ${best ?? 'none'} (attendance ${att.ymd ?? '—'} vs. payments ${pay.ymd ?? '—'}) — wall ${((performance.now() - wall0) / 1000).toFixed(1)}s`
    );
    return {globalEarliestYmd: best, att, pay};
}

/**
 * One-time copy of master employee docs. Per-period pay rates use rateHistory when present;
 * otherwise admin PayCalculator falls back to top-level baseRate / payType for any period.
 */
async function migrateEmployeesGlobalOnce() {
    const snap = await getDocs(collection(db, 'employees'));
    let n = 0;
    for (const d of snap.docs) {
        const data = d.data();
        await setDoc(doc(db, 'employees_v2', d.id), {...data}, {merge: true});
        n++;
        if (n % 25 === 0) log(`employees → employees_v2 … ${n}`);
    }
    log(`Employees → employees_v2 (one-time): ${n} doc(s).`);
}

/** Doc id: {employeeId}_{yyyy-mm-dd}_{yyyy-mm-dd} — period id is the last two segments. */
async function migratePaymentsGlobalOnce() {
    const re = /^(.+)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;
    const snap = await getDocs(collection(db, 'payment_confirmations'));
    let n = 0;
    for (const d of snap.docs) {
        const m = d.id.match(re);
        if (!m) continue;
        const employeeId = m[1];
        const periodId = `${m[2]}_${m[3]}`;
        const payload = {...d.data(), employeeId, periodId};
        await setDoc(doc(db, 'payroll_periods_v2', periodId, 'payments', employeeId), payload, {
            merge: true
        });
        n++;
        if (n % 50 === 0) log(`payment_confirmations → nested payments … ${n}`);
    }
    log(`Payments (one-time): ${n} confirmation(s) → payroll_periods_v2/…/payments (${snap.size} doc(s) read).`);
}

function stripSyncedFromClock(half) {
    if (!half || typeof half !== 'object') return half;
    const {synced, ...rest} = half;
    return rest;
}

/** Serialize for stable equality (handles Firestore Timestamp-like objects). */
function stableSerialize(val) {
    if (val === null || val === undefined) return 'null';
    const t = typeof val;
    if (t === 'number' || t === 'boolean') return JSON.stringify(val);
    if (t === 'string') return JSON.stringify(val);
    if (val && typeof val.toMillis === 'function') return `ts:${val.toMillis()}`;
    if (val && typeof val.seconds === 'number') return `ts:${val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6)}`;
    if (Array.isArray(val)) return `[${val.map(stableSerialize).join(',')}]`;
    if (t === 'object') {
        const keys = Object.keys(val).sort();
        return `{${keys.map((k) => JSON.stringify(k) + ':' + stableSerialize(val[k])).join(',')}}`;
    }
    return String(val);
}

function normalizeComparableAttendance(data) {
    if (!data || typeof data !== 'object') return '';
    const o = {};
    if (data.clockIn) o.clockIn = stripSyncedFromClock(data.clockIn);
    if (data.clockOut) o.clockOut = stripSyncedFromClock(data.clockOut);
    return stableSerialize(o);
}

function attendanceComparableEqual(a, b) {
    return normalizeComparableAttendance(a) === normalizeComparableAttendance(b);
}

function halfTimestamp(h) {
    if (!h || typeof h !== 'object') return 0;
    const t = h.timestamp;
    if (typeof t === 'number' && !Number.isNaN(t)) return t;
    if (t && typeof t.toMillis === 'function') return t.toMillis();
    if (t && typeof t.seconds === 'number') return t.seconds * 1000;
    return 0;
}

function cloneClockHalf(h) {
    if (!h || typeof h !== 'object') return undefined;
    return {...stripSyncedFromClock(h)};
}

function mergeClockHalf(legacyHalf, v2Half, key, notes) {
    if (!legacyHalf && !v2Half) return undefined;
    if (!legacyHalf) return cloneClockHalf(v2Half);
    if (!v2Half) return cloneClockHalf(legacyHalf);
    const L = stripSyncedFromClock(legacyHalf);
    const V = stripSyncedFromClock(v2Half);
    if (stableSerialize(L) === stableSerialize(V)) return {...L};
    const tL = halfTimestamp(legacyHalf);
    const tV = halfTimestamp(v2Half);
    if (tV > tL) {
        notes.push(`${key}: chose v2 (timestamp ${tV} > legacy ${tL})`);
        return {...V};
    }
    if (tL > tV) {
        notes.push(`${key}: chose legacy (timestamp ${tL} > v2 ${tV})`);
        return {...L};
    }
    notes.push(`${key}: same timestamp — chose v2`);
    return {...V};
}

/**
 * Merge one day: clockIn / clockOut independently by newer `timestamp` per half; extra top-level fields prefer v2 on conflict.
 */
function mergeAttendanceDocuments(legacyData, v2Data) {
    const notes = [];
    const l = legacyData || {};
    const v = v2Data || {};
    const merged = {};
    const clockIn = mergeClockHalf(l.clockIn, v.clockIn, 'clockIn', notes);
    const clockOut = mergeClockHalf(l.clockOut, v.clockOut, 'clockOut', notes);
    if (clockIn !== undefined) merged.clockIn = clockIn;
    if (clockOut !== undefined) merged.clockOut = clockOut;

    const keys = new Set([...Object.keys(l), ...Object.keys(v)]);
    keys.delete('clockIn');
    keys.delete('clockOut');
    for (const k of keys) {
        const lv = l[k];
        const vv = v[k];
        if (lv === undefined) {
            merged[k] = vv;
            continue;
        }
        if (vv === undefined) {
            merged[k] = lv;
            continue;
        }
        if (stableSerialize(lv) === stableSerialize(vv)) {
            merged[k] = lv;
            continue;
        }
        merged[k] = vv;
        notes.push(`field "${k}": conflict — kept v2`);
    }
    return {merged, notes};
}

function sanitizeDocForV2Write(data) {
    if (!data || typeof data !== 'object') return data;
    const m = {...data};
    if (m.clockIn && typeof m.clockIn === 'object') {
        m.clockIn = {...m.clockIn};
        delete m.clockIn.synced;
    }
    if (m.clockOut && typeof m.clockOut === 'object') {
        m.clockOut = {...m.clockOut};
        delete m.clockOut.synced;
    }
    return m;
}

async function migrateAttendanceForPeriodLegacyCopy(periodId, startDate, endDate) {
    const empSnap = await getDocs(collection(db, 'employees'));
    let totalDates = 0;
    for (const empDoc of empSnap.docs) {
        const eid = empDoc.id;
        const datesCol = collection(db, 'attendance', eid, 'dates');
        const q = query(datesCol, where('__name__', '>=', startDate), where('__name__', '<=', endDate));
        const snap = await getDocs(q);
        for (const dateDoc of snap.docs) {
            await setDoc(
                doc(db, 'attendance_v2', eid, 'dates', dateDoc.id),
                dateDoc.data(),
                {merge: true}
            );
            totalDates++;
        }
    }
    log(`Attendance → attendance_v2 ${periodId} (legacy-only copy / no compare): ${totalDates} date doc(s).`);
}

async function migrateAttendanceForPeriod(periodId) {
    const bounds = getPeriodDatesFromId(periodId);
    if (!bounds) throw new Error('Invalid periodId');
    const startDate = formatDate(bounds.startDate);
    const endDate = formatDate(bounds.endDate);
    const smartMerge = document.getElementById('chkSmartAttendanceMerge')?.checked !== false;

    if (!smartMerge) {
        await migrateAttendanceForPeriodLegacyCopy(periodId, startDate, endDate);
        return;
    }

    const runId = new Date().toISOString();
    const empSnap = await getDocs(collection(db, 'employees'));
    const backupCol = collection(db, MIG_ATT_BACKUP_COLLECTION);

    let totalDates = 0;
    let identical = 0;
    let legacyOnly = 0;
    let mergedDiff = 0;
    let backedUp = 0;
    let backupFailed = 0;

    for (const empDoc of empSnap.docs) {
        const eid = empDoc.id;
        const datesCol = collection(db, 'attendance', eid, 'dates');
        const q = query(datesCol, where('__name__', '>=', startDate), where('__name__', '<=', endDate));
        const snap = await getDocs(q);

        for (const dateDoc of snap.docs) {
            totalDates++;
            const dateKey = dateDoc.id;
            const legacyData = dateDoc.data();
            const v2DocRef = doc(db, 'attendance_v2', eid, 'dates', dateKey);
            const v2Snap = await getDoc(v2DocRef);
            const v2Data = v2Snap.exists() ? v2Snap.data() : null;

            if (!v2Data) {
                await setDoc(v2DocRef, sanitizeDocForV2Write(legacyData), {merge: true});
                legacyOnly++;
                continue;
            }

            if (attendanceComparableEqual(legacyData, v2Data)) {
                identical++;
                continue;
            }

            const {merged, notes} = mergeAttendanceDocuments(legacyData, v2Data);
            const payload = sanitizeDocForV2Write(merged);

            try {
                await addDoc(backupCol, {
                    periodId,
                    employeeId: eid,
                    dateKey,
                    runId,
                    legacySnapshot: legacyData,
                    v2Snapshot: v2Data,
                    merged: payload,
                    mergeNotes: notes,
                    createdAt: new Date().toISOString()
                });
                backedUp++;
            } catch (be) {
                backupFailed++;
                log(`BACKUP FAILED ${eid} ${dateKey}: ${be.message || be} — writing merged doc to v2 anyway`);
            }

            await setDoc(v2DocRef, payload, {merge: true});
            mergedDiff++;
        }
    }

    log(
        `Attendance smart-merge ${periodId}: ${totalDates} legacy row(s) in range — ` +
            `identical(skip)=${identical}, legacy-only(copy)=${legacyOnly}, merged(diff)=${mergedDiff}, ` +
            `backup docs=${backedUp}${backupFailed ? `, backup errors=${backupFailed}` : ''} → ${MIG_ATT_BACKUP_COLLECTION}`
    );
}

async function migrateTopLevelV2Payments() {
    const snap = await getDocs(collection(db, 'payment_confirmations_v2'));
    let n = 0;
    for (const d of snap.docs) {
        const parts = d.id.split('_');
        if (parts.length < 2) continue;
        const periodId = parts[parts.length - 1];
        const employeeId = parts.slice(0, -1).join('_');
        if (!periodId || !employeeId) continue;
        const payload = {...d.data(), employeeId, periodId};
        await setDoc(doc(db, 'payroll_periods_v2', periodId, 'payments', employeeId), payload, {
            merge: true
        });
        n++;
    }
    log(`payment_confirmations_v2 import: ${n} doc(s).`);
}

async function runAttendanceSection(periodId) {
    await patchStatus(periodId, {
        attendanceStatus: ST.IN_PROGRESS,
        lastError: null
    });
    renderTable();

    try {
        await migrateAttendanceForPeriod(periodId);
        await patchStatus(periodId, {attendanceStatus: ST.COMPLETE, lastError: null});
    } catch (e) {
        const msg = e.message || String(e);
        await patchStatus(periodId, {
            attendanceStatus: ST.ERROR,
            lastError: {section: 'attendance', message: msg}
        });
        throw e;
    }
    renderTable();
}

async function runRowAction(action, periodId) {
    if (!periodId || action !== 'attendance') return;
    try {
        setBusy(true);
        await runAttendanceSection(periodId);
    } catch (e) {
        log(`ERROR: ${e.message || e}`);
    } finally {
        setBusy(false);
        renderTable();
    }
}

function setGlobalAttendanceBatchLabel(text) {
    const el = document.getElementById('globalStatusAttendance');
    if (el) el.textContent = text;
}

/** Attendance only — each period’s date range maps to different legacy docs. */
async function runGlobalAttendance() {
    if (!loadedPeriods.length) {
        log('Wait for the period table to finish loading, or click “Load all periods”.');
        return;
    }
    const ordered = [...loadedPeriods].reverse();

    try {
        setBusy(true);
        setGlobalAttendanceBatchLabel('Starting…');
        log(`=== Attendance (all periods): ${ordered.length} period(s), oldest first ===`);

        for (let i = 0; i < ordered.length; i++) {
            const p = ordered[i];
            setGlobalAttendanceBatchLabel(`Running ${i + 1}/${ordered.length}…`);
            try {
                await runAttendanceSection(p.id);
            } catch (e) {
                log(`[Attendance] ${p.id}: ${e.message || e} — continuing`);
            }
            renderTable();
        }

        setGlobalAttendanceBatchLabel(`Finished ${ordered.length} period(s)`);
        log('=== Attendance (all periods): done ===');
    } catch (e) {
        setGlobalAttendanceBatchLabel(`Error: ${e.message || e}`);
        log(`ERROR global attendance: ${e.message || e}`);
    } finally {
        setBusy(false);
        renderTable();
    }
}

async function runGlobalEmployeesMigration() {
    try {
        setBusy(true);
        await patchGlobalStatus({employeesStatus: ST.IN_PROGRESS, lastError: null});
        renderTable();
        await migrateEmployeesGlobalOnce();
        await patchGlobalStatus({employeesStatus: ST.COMPLETE, lastError: null});
    } catch (e) {
        const msg = e.message || String(e);
        await patchGlobalStatus({
            employeesStatus: ST.ERROR,
            lastError: {section: 'employees', message: msg}
        });
        log(`ERROR migrate employees: ${msg}`);
    } finally {
        setBusy(false);
        renderTable();
    }
}

async function runGlobalPaymentsMigration() {
    try {
        setBusy(true);
        await patchGlobalStatus({paymentsStatus: ST.IN_PROGRESS, lastError: null});
        renderTable();
        await migratePaymentsGlobalOnce();
        await patchGlobalStatus({paymentsStatus: ST.COMPLETE, lastError: null});
    } catch (e) {
        const msg = e.message || String(e);
        await patchGlobalStatus({
            paymentsStatus: ST.ERROR,
            lastError: {section: 'payments', message: msg}
        });
        log(`ERROR migrate payments: ${msg}`);
    } finally {
        setBusy(false);
        renderTable();
    }
}

async function loadPeriodRowsFromEarliest(earliest) {
    const today = new Date();
    // 0 = no artificial cap; full history from earliest through current period rules
    loadedPeriods = generatePayrollPeriods(earliest, today, false, 0);
    log(`Generated ${loadedPeriods.length} period row(s) from legacy data through today.`);
    renderTable();
    try {
        await refreshAllStatuses();
    } catch (e) {
        log(`Status refresh: ${e.message || e}`);
        renderTable();
    }
}

async function loadAllPeriodRows() {
    log('Scanning Firestore (attendance + payment_confirmations) for full date range…');
    periodTableLoading = true;
    renderTable();
    try {
        setBusy(true);
        const result = await scanFirestoreForGlobalEarliest();
        const ymd = result.globalEarliestYmd;
        if (!ymd) {
            log('No legacy attendance dates or payment_confirmations with period ids found.');
            loadedPeriods = [];
            return;
        }
        writeEarliestCache({
            globalEarliestYmd: ymd,
            fromAttendance: result.att.ymd,
            fromPayments: result.pay.ymd,
            employeeCount: result.att.employeeCount,
            paymentDocCount: result.pay.docCount
        });
        log(`Saved earliest date to browser local storage (this device only). Next visit skips the slow scan.`);

        const p = ymd.split('-').map((x) => parseInt(x, 10));
        const start = new Date(p[0], p[1] - 1, p[2]);
        log(`Earliest relevant date: ${ymd} — building all payroll periods through today.`);
        periodTableLoading = false;
        await loadPeriodRowsFromEarliest(start);
    } catch (e) {
        log(`ERROR: ${e.message || e}`);
        periodTableLoading = false;
        renderTable();
    } finally {
        periodTableLoading = false;
        setBusy(false);
        renderTable();
    }
}

/** First open: use cached earliest date if present so the table is usable immediately; otherwise full scan. */
async function bootstrapPeriodTable() {
    const cached = readEarliestCache();
    if (cached) {
        log(
            `[cache] Earliest date ${cached.globalEarliestYmd} from ${cached.cachedAt} — building period table without scanning (employees in scan=${cached.employeeCount ?? 'n/a'}, payment_confirmations docs=${cached.paymentDocCount ?? 'n/a'}). Use “Load all periods” to rescan Firestore and update cache.`
        );
        try {
            setBusy(true);
            const p = cached.globalEarliestYmd.split('-').map((x) => parseInt(x, 10));
            const start = new Date(p[0], p[1] - 1, p[2]);
            await loadPeriodRowsFromEarliest(start);
        } catch (e) {
            log(`ERROR: ${e.message || e}`);
        } finally {
            setBusy(false);
        }
        return;
    }
    await loadAllPeriodRows();
}

document.getElementById('btnLoadPeriods').addEventListener('click', () => loadAllPeriodRows());

document.getElementById('btnClearEarliestCache').addEventListener('click', () => {
    clearEarliestCache();
    log('Cleared saved earliest date from this browser. Reload the page or click “Load all periods” to run a full Firestore scan.');
});

document.getElementById('btnRefreshStatus').addEventListener('click', async () => {
    try {
        setBusy(true);
        await refreshAllStatuses();
    } catch (e) {
        log(`ERROR: ${e.message || e}`);
    } finally {
        setBusy(false);
    }
});

document.getElementById('btnGlobalEmployees').addEventListener('click', () => runGlobalEmployeesMigration());
document.getElementById('btnGlobalAttendance').addEventListener('click', () => runGlobalAttendance());
document.getElementById('btnGlobalPayments').addEventListener('click', () => runGlobalPaymentsMigration());

document.getElementById('btnLegacyV2Import').addEventListener('click', async () => {
    logEl.textContent = '';
    try {
        setBusy(true);
        await migrateTopLevelV2Payments();
    } catch (e) {
        log(`ERROR: ${e.message || e}`);
    } finally {
        setBusy(false);
    }
});

bootstrapPeriodTable();
