import { initFirebase, getDb, getFirestoreApi, ROOT_PATH } from './firebase.js';
import { emptyState, allocationKey } from './compute.js';
import { seedToStateFull, stateToSeed, validateSeed } from './import-export.js';

const SUBCOLLECTIONS = [
    'funds',
    'accounts',
    'allocations',
    'transactions',
    'receivables',
    'payables',
    'expected_inflows',
    'interfund_balances',
    'credit_lines',
    'open_questions'
];

const STATE_KEY = {
    funds: 'funds',
    accounts: 'accounts',
    allocations: 'allocations',
    transactions: 'transactions',
    receivables: 'receivables',
    payables: 'payables',
    expected_inflows: 'expected_inflows',
    interfund_balances: 'interfund_balances',
    credit_lines: 'credit_lines',
    open_questions: 'open_questions'
};

let state = emptyState();
const listeners = new Set();
let unsubscribers = [];
let ready = false;

function workspaceRef() {
    const { doc } = getFirestoreApi();
    const db = getDb();
    return doc(db, ...ROOT_PATH);
}

function subRef(name) {
    const { collection } = getFirestoreApi();
    return collection(workspaceRef(), name);
}

function itemRef(name, id) {
    const { doc } = getFirestoreApi();
    return doc(subRef(name), id);
}

export function getState() {
    return state;
}

export function subscribe(fn) {
    listeners.add(fn);
    if (ready) fn(state);
    return () => listeners.delete(fn);
}

function emit() {
    for (const fn of listeners) fn(state);
}

function mergeDocs(name, docs) {
    const key = STATE_KEY[name];
    state = {
        ...state,
        [key]: docs.map((d) => ({ id: d.id, ...d.data() }))
    };
    emit();
}

export async function initStore() {
    await initFirebase();
    const { onSnapshot, getDoc } = getFirestoreApi();

    // Clear previous
    unsubscribers.forEach((u) => u());
    unsubscribers = [];

    const rootSnap = await getDoc(workspaceRef());
    if (rootSnap.exists()) {
        const data = rootSnap.data();
        state = {
            ...state,
            meta: data.meta || null,
            fund_totals_check: data.fund_totals_check || null,
            loaded: true
        };
    }

    unsubscribers.push(
        onSnapshot(workspaceRef(), (snap) => {
            if (!snap.exists()) {
                state = { ...state, meta: null, loaded: true };
                emit();
                return;
            }
            const data = snap.data();
            state = {
                ...state,
                meta: data.meta || null,
                fund_totals_check: data.fund_totals_check || null,
                loaded: true
            };
            emit();
        })
    );

    for (const name of SUBCOLLECTIONS) {
        unsubscribers.push(
            onSnapshot(subRef(name), (snap) => {
                mergeDocs(name, snap.docs);
                ready = true;
            })
        );
    }

    ready = true;
    emit();
    return state;
}

export function hasWorkspaceData() {
    return !!(
        state.meta ||
        state.funds.length ||
        state.accounts.length ||
        state.transactions.length
    );
}

async function clearSubcollection(name, batchSize = 400) {
    const { getDocs, writeBatch } = getFirestoreApi();
    const db = getDb();
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const snap = await getDocs(subRef(name));
        if (snap.empty) break;
        const batch = writeBatch(db);
        let n = 0;
        for (const d of snap.docs) {
            batch.delete(d.ref);
            n += 1;
            if (n >= batchSize) break;
        }
        await batch.commit();
        if (n < batchSize && snap.size <= batchSize) break;
    }
}

export async function replaceWorkspaceFromSeed(seed, { provenance = 'import' } = {}) {
    const validation = validateSeed(seed);
    if (!validation.ok) {
        throw new Error(validation.errors.join('; '));
    }

    const next = seedToStateFull(seed);
    const { writeBatch, serverTimestamp, setDoc } = getFirestoreApi();
    const db = getDb();

    for (const name of SUBCOLLECTIONS) {
        await clearSubcollection(name);
    }

    await setDoc(
        workspaceRef(),
        {
            meta: next.meta,
            fund_totals_check: next.fund_totals_check || null,
            provenance,
            updatedAt: serverTimestamp()
        },
        { merge: false }
    );

    const writes = [];

    const push = (col, id, data) => {
        writes.push({ col, id, data });
    };

    for (const f of next.funds) push('funds', f.id, f);
    for (const a of next.accounts) push('accounts', a.id, a);
    for (const a of next.allocations) {
        push('allocations', allocationKey(a.account_id, a.fund_id), a);
    }
    for (const t of next.transactions) push('transactions', t.id, t);
    for (const r of next.receivables) push('receivables', r.id, r);
    for (const p of next.payables) push('payables', p.id, p);
    for (const i of next.expected_inflows) push('expected_inflows', i.id, i);
    for (const b of next.interfund_balances) push('interfund_balances', b.id, b);
    for (const c of next.credit_lines) push('credit_lines', c.id, c);
    for (const q of next.open_questions) push('open_questions', q.id, q);

    for (let i = 0; i < writes.length; i += 400) {
        const chunk = writes.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const w of chunk) {
            batch.set(itemRef(w.col, w.id), w.data);
        }
        await batch.commit();
    }

    return validation;
}

export async function exportSeed() {
    return stateToSeed(state);
}

/** Low-level batch helpers used by commands */
export async function applyOps(ops) {
    const { writeBatch, serverTimestamp } = getFirestoreApi();
    const db = getDb();
    const chunks = [];
    for (let i = 0; i < ops.length; i += 400) chunks.push(ops.slice(i, i + 400));

    for (const chunk of chunks) {
        const b = writeBatch(db);
        for (const op of chunk) {
            if (op.type === 'set') {
                b.set(itemRef(op.collection, op.id), op.data, { merge: !!op.merge });
            } else if (op.type === 'delete') {
                b.delete(itemRef(op.collection, op.id));
            } else if (op.type === 'update') {
                b.update(itemRef(op.collection, op.id), op.data);
            }
        }
        b.set(workspaceRef(), { updatedAt: serverTimestamp() }, { merge: true });
        await b.commit();
    }
}

export function setAllocationOps(accountId, fundId, amount, note) {
    const id = allocationKey(accountId, fundId);
    const amt = Number(amount) || 0;
    if (amt <= 0.001 && amt >= -0.001) {
        return [{ type: 'delete', collection: 'allocations', id }];
    }
    return [
        {
            type: 'set',
            collection: 'allocations',
            id,
            data: {
                id,
                account_id: accountId,
                fund_id: fundId,
                amount: Math.round(amt * 100) / 100,
                ...(note ? { note } : {})
            }
        }
    ];
}

export { stateToSeed, seedToStateFull, validateSeed };
