/**
 * One-time supplierId migration: analyze Firestore (or localStorage), resolve ambiguous names, batch write.
 */
import { initializeFirebaseConfig } from '../js/firebase-config.js';
import {
    analyzeSupplierIdMigration,
    buildExpensesWithResolvedSupplierIds,
} from '../js/shared.js?v=1.5.52';

const BATCH_LIMIT = 400;

let db = null;
let firestoreMod = null;
let lastExpenses = [];
let lastSuppliers = [];
let lastAnalysis = null;

function log(msg) {
    const el = document.getElementById('log');
    if (!el) return;
    el.textContent += `${msg}\n`;
    el.scrollTop = el.scrollHeight;
}

function clearLog() {
    const el = document.getElementById('log');
    if (el) el.textContent = '';
}

function sanitizePatch(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export async function initFirebase() {
    clearLog();
    const result = await initializeFirebaseConfig();
    if (!result?.db) {
        log('Firebase init failed.');
        return false;
    }
    db = result.db;
    firestoreMod = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
    log('Firebase ready.');
    return true;
}

export async function loadFromFirestore() {
    clearLog();
    if (!db || !firestoreMod) {
        log('Click “Initialize Firebase” first.');
        return;
    }
    const { getDocs, collection } = firestoreMod;
    log('Loading suppliers…');
    const supSnap = await getDocs(collection(db, 'suppliers'));
    lastSuppliers = supSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    log(`Suppliers: ${lastSuppliers.length}`);

    log('Loading expenses…');
    const expSnap = await getDocs(collection(db, 'expenses'));
    lastExpenses = expSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    log(`Expenses: ${lastExpenses.length}`);

    runAnalyzeUI();
}

export function loadFromLocalStorage() {
    clearLog();
    try {
        const expRaw = localStorage.getItem('expenseTracker_expenses');
        const supRaw = localStorage.getItem('expenseTracker_suppliers');
        if (!expRaw || !supRaw) {
            log('localStorage missing expenseTracker_expenses or expenseTracker_suppliers (open the expense app on this origin first).');
            return;
        }
        lastExpenses = JSON.parse(expRaw);
        lastSuppliers = JSON.parse(supRaw);
        log(`localStorage: ${lastSuppliers.length} suppliers, ${lastExpenses.length} expenses`);
        runAnalyzeUI();
    } catch (e) {
        log(`localStorage error: ${e.message}`);
    }
}

function runAnalyzeUI() {
    lastAnalysis = analyzeSupplierIdMigration(lastSuppliers, lastExpenses);
    const a = lastAnalysis;

    document.getElementById('statWithId').textContent = String(a.withId.length);
    document.getElementById('statAssignable').textContent = String(a.assignable.length);
    document.getElementById('statAmbiguous').textContent = String(
        a.ambiguous.reduce((n, g) => n + g.expenses.length, 0)
    );
    document.getElementById('statOrphans').textContent = String(a.orphans.length);

    const ambContainer = document.getElementById('ambiguousContainer');
    ambContainer.innerHTML = '';

    if (a.ambiguous.length === 0) {
        ambContainer.innerHTML = '<p class="note">No ambiguous name groups.</p>';
        return;
    }

    a.ambiguous.forEach((group) => {
        const key = group.key;
        const wrap = document.createElement('div');
        wrap.className = 'ambiguous-row';
        const label = document.createElement('label');
        label.textContent = `Name “${group.suppliers[0]?.name || key}” (${group.expenses.length} expenses, ${group.suppliers.length} supplier rows) — pick canonical supplier:`;
        const sel = document.createElement('select');
        sel.dataset.ambiguousKey = key;
        group.suppliers
            .slice()
            .sort((x, y) => x.id.localeCompare(y.id))
            .forEach((s) => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = `${s.name} — ${s.id.slice(0, 8)}… TIN:${s.tin || '—'}`;
                sel.appendChild(opt);
            });
        wrap.appendChild(label);
        wrap.appendChild(sel);
        ambContainer.appendChild(wrap);
    });
}

function collectNameKeyChoices() {
    const choices = {};
    document.querySelectorAll('select[data-ambiguous-key]').forEach((sel) => {
        const k = sel.dataset.ambiguousKey;
        if (k && sel.value) choices[k] = sel.value;
    });
    return choices;
}

export async function applyToFirestore() {
    clearLog();
    if (!db || !firestoreMod) {
        log('Initialize Firebase first.');
        return;
    }
    if (!lastExpenses.length) {
        log('Load data first.');
        return;
    }
    const choices = collectNameKeyChoices();
    const a = lastAnalysis;
    if (a.ambiguous.length > 0) {
        for (const g of a.ambiguous) {
            if (!choices[g.key]) {
                log(`Missing choice for ambiguous name key: ${g.key}`);
                return;
            }
        }
    }

    const migrated = buildExpensesWithResolvedSupplierIds(lastExpenses, lastSuppliers, choices);
    const { doc, writeBatch } = firestoreMod;
    const toPatch = migrated.filter((m) => {
        const o = lastExpenses.find((e) => e.id === m.id);
        return o && o.supplierId !== m.supplierId;
    });

    if (toPatch.length === 0) {
        log('No expense supplierId changes to write.');
        return;
    }

    if (!confirm(`Write ${toPatch.length} expense document(s) to Firestore with merge?`)) return;

    log(`Writing ${toPatch.length} patches in batches of ${BATCH_LIMIT}…`);
    for (let i = 0; i < toPatch.length; i += BATCH_LIMIT) {
        const chunk = toPatch.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        for (const m of chunk) {
            const patch = sanitizePatch({
                supplierId: m.supplierId,
                supplierName: m.supplierName,
                businessName: m.businessName,
                tin: m.tin,
                address: m.address,
                isVatRegistered: m.isVatRegistered,
                updatedAt: m.updatedAt,
            });
            batch.set(doc(db, 'expenses', m.id), patch, { merge: true });
        }
        await batch.commit();
        log(`Committed ${Math.min(i + BATCH_LIMIT, toPatch.length)} / ${toPatch.length}`);
    }
    log('Done. Refresh the expense app and fetch/sync.');
    lastExpenses = migrated;
    runAnalyzeUI();
}

export function applyToLocalStorage() {
    clearLog();
    if (!lastExpenses.length) {
        log('Load data first.');
        return;
    }
    const choices = collectNameKeyChoices();
    const a = lastAnalysis;
    if (a.ambiguous.length > 0) {
        for (const g of a.ambiguous) {
            if (!choices[g.key]) {
                log(`Missing choice for ambiguous name key: ${g.key}`);
                return;
            }
        }
    }

    const migrated = buildExpensesWithResolvedSupplierIds(lastExpenses, lastSuppliers, choices);
    const changed = migrated.filter((m) => {
        const o = lastExpenses.find((e) => e.id === m.id);
        return o && o.supplierId !== m.supplierId;
    });

    if (changed.length === 0) {
        log('No supplierId changes for localStorage.');
        return;
    }

    if (!confirm(`Update ${changed.length} expense(s) in localStorage?`)) return;

    try {
        localStorage.setItem('expenseTracker_expenses', JSON.stringify(migrated));
        log(`Saved ${migrated.length} expenses to localStorage.`);
        lastExpenses = migrated;
        runAnalyzeUI();
    } catch (e) {
        log(`Save failed: ${e.message}`);
    }
}

// Wire DOM
document.getElementById('btnInit')?.addEventListener('click', () => initFirebase());
document.getElementById('btnLoadFs')?.addEventListener('click', () => loadFromFirestore());
document.getElementById('btnLoadLs')?.addEventListener('click', () => loadFromLocalStorage());
document.getElementById('btnApplyFs')?.addEventListener('click', () => applyToFirestore());
document.getElementById('btnApplyLs')?.addEventListener('click', () => applyToLocalStorage());
