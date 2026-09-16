import { allocationKey, validateAllocations, emptyState } from './compute.js';
import { uid, round2 } from './format.js';

export function validateSeed(seed) {
    const errors = [];
    const warnings = [];

    if (!seed || typeof seed !== 'object') {
        return { ok: false, errors: ['Invalid JSON: expected an object'], warnings };
    }
    if (!Array.isArray(seed.funds)) errors.push('Missing funds array');
    if (!Array.isArray(seed.accounts)) errors.push('Missing accounts array');
    if (!Array.isArray(seed.fund_allocations)) errors.push('Missing fund_allocations array');

    if (errors.length) return { ok: false, errors, warnings };

    const fundIds = new Set(seed.funds.map((f) => f.id));
    const accountIds = new Set(seed.accounts.map((a) => a.id));

    for (const a of seed.fund_allocations) {
        if (!accountIds.has(a.account_id)) {
            errors.push(`Allocation references unknown account ${a.account_id}`);
        }
        if (!fundIds.has(a.fund_id)) {
            errors.push(`Allocation references unknown fund ${a.fund_id}`);
        }
    }

    const temp = seedToState(seed);
    for (const w of validateAllocations(temp)) {
        warnings.push(
            `Account ${w.account_id}: balance ${w.balance} ≠ allocated ${w.allocated} (Δ ${w.variance})`
        );
    }

    return { ok: errors.length === 0, errors, warnings };
}

export function seedToState(seed) {
    const state = emptyState();
    state.meta = seed.meta || null;
    state.fund_totals_check = seed.fund_totals_check || null;
    state.funds = (seed.funds || []).map((f) => ({ ...f, archived: !!f.archived }));
    state.accounts = (seed.accounts || []).map((a) => ({ ...a }));
    state.allocations = (seed.fund_allocations || []).map((a) => ({
        id: allocationKey(a.account_id, a.fund_id),
        account_id: a.account_id,
        fund_id: a.fund_id,
        amount: Number(a.amount),
        ...(a.note ? { note: a.note } : {})
    }));
    state.receivables = (seed.receivables || []).map((r) => ({ ...r }));
    state.payables = (seed.payables || []).map((p) => ({ ...p }));
    state.expected_inflows = (seed.expected_inflows || []).map((i) => ({ ...i }));
    state.interfund_balances = (seed.interfund_balances || []).map((b) => ({ ...b }));
    state.credit_lines = (seed.credit_lines || []).map((c) => ({ ...c }));
    state.open_questions = (seed.open_questions || []).map((q) => ({
        ...q,
        resolved: !!q.resolved
    }));

    state.transactions = (seed.history || []).map((h, i) => ({
        id: h.id || `HIST_${i + 1}`,
        date: h.date,
        account_id: h.account_id,
        fund_id: h.fund_id,
        direction: h.direction,
        amount: Number(h.amount),
        counterparty: h.counterparty || '',
        category: h.category || '',
        description: h.description || '',
        note: h.note || '',
        status: h.status || 'posted',
        tags: h.tags || [],
        already_reflected_in_opening_balance: h.already_reflected_in_opening_balance !== false,
        type: h.type || (h.already_reflected_in_opening_balance === false ? 'entry' : 'history'),
        ...(h.to_account_id ? { to_account_id: h.to_account_id } : {}),
        ...(h.from_fund_id ? { from_fund_id: h.from_fund_id } : {}),
        ...(h.to_fund_id ? { to_fund_id: h.to_fund_id } : {})
    }));

    state.loaded = true;
    return state;
}

export function stateToSeed(state) {
    const history = state.transactions
        .filter((t) => t.already_reflected_in_opening_balance)
        .map((t) => ({
            date: t.date,
            account_id: t.account_id,
            fund_id: t.fund_id,
            direction: t.direction,
            amount: t.amount,
            counterparty: t.counterparty || undefined,
            category: t.category || undefined,
            note: t.note || undefined,
            already_reflected_in_opening_balance: true
        }));

    // Live (non-history) transactions are exported under a live_transactions key
    // so round-trip of seed history stays clean, but we also append them into
    // history-compatible rows for losslessness of the full ledger.
    const live = state.transactions.filter((t) => !t.already_reflected_in_opening_balance);

    const seed = {
        meta: {
            ...(state.meta || {}),
            exported_at: new Date().toISOString(),
            version: state.meta?.version || '1.0'
        },
        funds: state.funds.map(({ id, name, purpose, color, archived }) => ({
            id,
            name,
            purpose,
            color,
            ...(archived ? { archived: true } : {})
        })),
        accounts: state.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            institution: a.institution,
            type: a.type,
            titling: a.titling,
            role: a.role,
            balance: a.balance === undefined ? null : a.balance,
            as_of: a.as_of ?? null,
            limits: a.limits || {},
            notes: a.notes || undefined
        })),
        fund_allocations: state.allocations.map((a) => ({
            account_id: a.account_id,
            fund_id: a.fund_id,
            amount: round2(a.amount),
            ...(a.note ? { note: a.note } : {})
        })),
        fund_totals_check: state.fund_totals_check || undefined,
        receivables: state.receivables.map((r) => ({ ...r })),
        receivables_summary: undefined,
        payables: state.payables.map((p) => ({ ...p })),
        expected_inflows: state.expected_inflows.map((i) => ({ ...i })),
        interfund_balances: state.interfund_balances.map((b) => ({ ...b })),
        credit_lines: state.credit_lines.map((c) => ({ ...c })),
        history,
        live_transactions: live.map((t) => ({ ...t })),
        open_questions: state.open_questions.map((q) => ({ ...q }))
    };

    // Include live txns in history-compatible form for consumers that only read history
    if (live.length) {
        for (const t of live) {
            seed.history.push({
                date: t.date,
                account_id: t.account_id,
                fund_id: t.fund_id,
                direction: t.direction,
                amount: t.amount,
                counterparty: t.counterparty || undefined,
                category: t.category || undefined,
                note: t.note || undefined,
                already_reflected_in_opening_balance: false,
                id: t.id,
                type: t.type,
                status: t.status
            });
        }
    }

    // Strip undefined keys shallowly
    return JSON.parse(JSON.stringify(seed));
}

/** When importing, also restore live_transactions if present */
export function seedToStateFull(seed) {
    const state = seedToState(seed);
    const live = seed.live_transactions || [];
    const extraHistory = (seed.history || []).filter(
        (h) => h.already_reflected_in_opening_balance === false
    );
    const extras = [...live, ...extraHistory].map((t, i) => ({
        id: t.id || uid('TXN'),
        date: t.date,
        account_id: t.account_id,
        fund_id: t.fund_id,
        direction: t.direction,
        amount: Number(t.amount),
        counterparty: t.counterparty || '',
        category: t.category || '',
        description: t.description || '',
        note: t.note || '',
        status: t.status || 'posted',
        tags: t.tags || [],
        already_reflected_in_opening_balance: false,
        type: t.type || 'entry',
        ...(t.to_account_id ? { to_account_id: t.to_account_id } : {}),
        ...(t.from_fund_id ? { from_fund_id: t.from_fund_id } : {}),
        ...(t.to_fund_id ? { to_fund_id: t.to_fund_id } : {}),
        ...(t.receivable_id ? { receivable_id: t.receivable_id } : {}),
        ...(t.payable_id ? { payable_id: t.payable_id } : {})
    }));

    // Avoid duplicating if history already included live rows with ids
    const existingIds = new Set(state.transactions.map((t) => t.id));
    for (const t of extras) {
        if (!existingIds.has(t.id)) state.transactions.push(t);
    }
    return state;
}
