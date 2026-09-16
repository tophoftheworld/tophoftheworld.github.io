import {
    getState,
    applyOps,
    setAllocationOps
} from './store.js';
import {
    allocationForAccountFund,
    checkTransferLimits
} from './compute.js';
import { uid, todayISO, round2 } from './format.js';

function requireFields(payload, fields) {
    for (const f of fields) {
        if (payload[f] === undefined || payload[f] === null || payload[f] === '') {
            throw new Error(`Missing required field: ${f}`);
        }
    }
}

function bumpAccountBalance(accountId, delta) {
    const state = getState();
    const acct = state.accounts.find((a) => a.id === accountId);
    if (!acct) throw new Error(`Unknown account ${accountId}`);
    const ops = [];
    if (acct.balance === null || acct.balance === undefined) {
        // Still allow allocation changes; leave balance null but warn via caller
        return { ops, warnings: [`${acct.name} has unknown balance — cash total not updated`] };
    }
    const next = round2(Number(acct.balance) + delta);
    ops.push({
        type: 'set',
        collection: 'accounts',
        id: accountId,
        merge: true,
        data: {
            ...acct,
            balance: next,
            as_of: new Date().toISOString()
        }
    });
    return { ops, warnings: [] };
}

function setAllocAmount(accountId, fundId, newAmount, note) {
    return setAllocationOps(accountId, fundId, newAmount, note);
}

function adjustAlloc(accountId, fundId, delta, note) {
    const state = getState();
    const current = allocationForAccountFund(state, accountId, fundId);
    return setAllocAmount(accountId, fundId, round2(current + delta), note);
}

/** Create or increase inter-fund debt: debtor owes creditor */
function upsertInterfundDebt(debtorFund, creditorFund, amount, reason) {
    const state = getState();
    const existing = state.interfund_balances.find(
        (b) =>
            (b.status || 'OPEN') === 'OPEN' &&
            b.debtor_fund === debtorFund &&
            b.creditor_fund === creditorFund
    );
    const amt = round2(amount);
    if (amt <= 0) return [];

    if (existing) {
        return [
            {
                type: 'set',
                collection: 'interfund_balances',
                id: existing.id,
                merge: true,
                data: {
                    ...existing,
                    amount: round2(Number(existing.amount) + amt),
                    reason: reason || existing.reason,
                    note: existing.note
                        ? `${existing.note}\n(+${amt}) ${reason || ''}`.trim()
                        : reason
                }
            }
        ];
    }

    const id = uid('IF');
    return [
        {
            type: 'set',
            collection: 'interfund_balances',
            id,
            data: {
                id,
                debtor_fund: debtorFund,
                creditor_fund: creditorFund,
                amount: amt,
                reason: reason || 'Fund reassignment',
                status: 'OPEN'
            }
        }
    ];
}

/**
 * When reassigning ownership: money that belonged to fromFund now belongs to toFund.
 * The toFund now owes fromFund (or we settle reverse debt).
 */
function settleOrCreateInterfund(fromFund, toFund, amount, reason) {
    const state = getState();
    const amt = round2(amount);
    // Prefer settling reverse: if fromFund already owes toFund, reduce that debt
    const reverse = state.interfund_balances.find(
        (b) =>
            (b.status || 'OPEN') === 'OPEN' &&
            b.debtor_fund === fromFund &&
            b.creditor_fund === toFund
    );
    if (reverse) {
        const current = Number(reverse.amount);
        if (current <= amt + 0.001) {
            return [
                {
                    type: 'set',
                    collection: 'interfund_balances',
                    id: reverse.id,
                    merge: true,
                    data: {
                        ...reverse,
                        amount: 0,
                        status: 'SETTLED',
                        note: `${reverse.note || ''}\nSettled by reassignment: ${reason}`.trim()
                    }
                },
                ...upsertInterfundDebt(toFund, fromFund, round2(amt - current), reason)
            ].filter((op) => {
                // drop zero upserts
                if (op.collection === 'interfund_balances' && op.data?.amount === 0 && op.data?.status !== 'SETTLED') {
                    return false;
                }
                return true;
            });
        }
        return [
            {
                type: 'set',
                collection: 'interfund_balances',
                id: reverse.id,
                merge: true,
                data: {
                    ...reverse,
                    amount: round2(current - amt),
                    note: `${reverse.note || ''}\nReduced by reassignment (${amt}): ${reason}`.trim()
                }
            }
        ];
    }
    // toFund now holds fromFund's money → toFund owes fromFund
    return upsertInterfundDebt(toFund, fromFund, amt, reason);
}

export async function addMoneyIn(payload) {
    requireFields(payload, ['amount', 'account_id', 'fund_id']);
    const amount = round2(payload.amount);
    if (amount <= 0) throw new Error('Amount must be positive');

    const id = payload.id || uid('TXN');
    const date = payload.date || todayISO();
    const warnings = [];

    const bal = bumpAccountBalance(payload.account_id, amount);
    warnings.push(...bal.warnings);

    const ops = [
        ...bal.ops,
        ...adjustAlloc(payload.account_id, payload.fund_id, amount, payload.note),
        {
            type: 'set',
            collection: 'transactions',
            id,
            data: {
                id,
                date,
                account_id: payload.account_id,
                fund_id: payload.fund_id,
                direction: 'in',
                amount,
                counterparty: payload.counterparty || '',
                category: payload.category || 'income',
                description: payload.description || '',
                note: payload.note || '',
                status: 'posted',
                tags: payload.tags || [],
                already_reflected_in_opening_balance: false,
                type: 'income'
            }
        }
    ];

    await applyOps(ops);
    return { id, warnings };
}

export async function addExpense(payload) {
    requireFields(payload, ['amount', 'account_id', 'fund_id']);
    const amount = round2(payload.amount);
    if (amount <= 0) throw new Error('Amount must be positive');

    const state = getState();
    const warnings = [];
    const fundCash = allocationForAccountFund(state, payload.account_id, payload.fund_id);
    if (fundCash < amount) {
        warnings.push(
            `This expense overdraws the fund allocation in this account (have ${fundCash}, spending ${amount})`
        );
    }
    const acct = state.accounts.find((a) => a.id === payload.account_id);
    warnings.push(...checkTransferLimits(acct, amount).map((w) => w.message));

    const id = payload.id || uid('TXN');
    const date = payload.date || todayISO();
    const bal = bumpAccountBalance(payload.account_id, -amount);
    warnings.push(...bal.warnings);

    const ops = [
        ...bal.ops,
        ...adjustAlloc(payload.account_id, payload.fund_id, -amount, payload.note),
        {
            type: 'set',
            collection: 'transactions',
            id,
            data: {
                id,
                date,
                account_id: payload.account_id,
                fund_id: payload.fund_id,
                direction: 'out',
                amount,
                counterparty: payload.counterparty || '',
                category: payload.category || 'expense',
                description: payload.description || '',
                note: payload.note || '',
                status: 'posted',
                tags: payload.tags || [],
                already_reflected_in_opening_balance: false,
                type: 'expense'
            }
        }
    ];

    await applyOps(ops);
    return { id, warnings };
}

/** Move cash between accounts, same fund */
export async function moveCash(payload) {
    requireFields(payload, ['amount', 'from_account_id', 'to_account_id', 'fund_id']);
    const amount = round2(payload.amount);
    if (amount <= 0) throw new Error('Amount must be positive');
    if (payload.from_account_id === payload.to_account_id) {
        throw new Error('Source and destination accounts must differ');
    }

    const state = getState();
    const warnings = [];
    const fromCash = allocationForAccountFund(state, payload.from_account_id, payload.fund_id);
    if (fromCash < amount) {
        warnings.push(`Fund allocation in source is only ${fromCash} (moving ${amount})`);
    }
    const fromAcct = state.accounts.find((a) => a.id === payload.from_account_id);
    warnings.push(...checkTransferLimits(fromAcct, amount, payload.rail || '').map((w) => w.message));

    const id = payload.id || uid('TXN');
    const date = payload.date || todayISO();
    const note = payload.note || `Move cash ${payload.from_account_id} → ${payload.to_account_id}`;

    const outBal = bumpAccountBalance(payload.from_account_id, -amount);
    const inBal = bumpAccountBalance(payload.to_account_id, amount);
    warnings.push(...outBal.warnings, ...inBal.warnings);

    const ops = [
        ...outBal.ops,
        ...inBal.ops,
        ...adjustAlloc(payload.from_account_id, payload.fund_id, -amount),
        ...adjustAlloc(payload.to_account_id, payload.fund_id, amount),
        {
            type: 'set',
            collection: 'transactions',
            id,
            data: {
                id,
                date,
                account_id: payload.from_account_id,
                to_account_id: payload.to_account_id,
                fund_id: payload.fund_id,
                direction: 'transfer',
                amount,
                counterparty: payload.to_account_id,
                category: 'transfer',
                description: 'Move cash',
                note,
                status: 'posted',
                tags: payload.tags || [],
                already_reflected_in_opening_balance: false,
                type: 'move_cash',
                rail: payload.rail || ''
            }
        }
    ];

    await applyOps(ops);
    return { id, warnings };
}

/** Reassign ownership without moving cash */
export async function reassignFund(payload) {
    requireFields(payload, ['amount', 'account_id', 'from_fund_id', 'to_fund_id', 'note']);
    const amount = round2(payload.amount);
    if (amount <= 0) throw new Error('Amount must be positive');
    if (payload.from_fund_id === payload.to_fund_id) {
        throw new Error('Funds must differ');
    }
    if (!String(payload.note).trim()) {
        throw new Error('A reason note is required for fund reassignment');
    }

    const state = getState();
    const warnings = [];
    const fromCash = allocationForAccountFund(state, payload.account_id, payload.from_fund_id);
    if (fromCash < amount) {
        warnings.push(`Only ${fromCash} of this fund sits in the account (reassigning ${amount})`);
    }

    const id = payload.id || uid('TXN');
    const date = payload.date || todayISO();

    const ops = [
        ...adjustAlloc(payload.account_id, payload.from_fund_id, -amount),
        ...adjustAlloc(payload.account_id, payload.to_fund_id, amount),
        ...settleOrCreateInterfund(
            payload.from_fund_id,
            payload.to_fund_id,
            amount,
            payload.note
        ),
        {
            type: 'set',
            collection: 'transactions',
            id,
            data: {
                id,
                date,
                account_id: payload.account_id,
                fund_id: payload.to_fund_id,
                from_fund_id: payload.from_fund_id,
                to_fund_id: payload.to_fund_id,
                direction: 'reassign',
                amount,
                category: 'fund_reassign',
                description: 'Reassign fund',
                note: payload.note,
                status: 'posted',
                tags: payload.tags || [],
                already_reflected_in_opening_balance: false,
                type: 'reassign_fund'
            }
        }
    ];

    await applyOps(ops);
    return { id, warnings };
}

export async function recordReceivablePayment(payload) {
    requireFields(payload, ['receivable_id', 'amount', 'account_id']);
    const state = getState();
    const rec = state.receivables.find((r) => r.id === payload.receivable_id);
    if (!rec) throw new Error('Receivable not found');

    const amount = round2(payload.amount);
    if (amount <= 0) throw new Error('Amount must be positive');

    const paid = round2(Number(rec.amount_paid || 0) + amount);
    const due = round2(Number(rec.amount_total) - paid);
    const status = due <= 0.01 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';

    const result = await addMoneyIn({
        amount,
        account_id: payload.account_id,
        fund_id: rec.fund_id,
        counterparty: rec.payer,
        category: 'receivable_payment',
        note: payload.note || `Payment from ${rec.payer}`,
        date: payload.date || todayISO()
    });

    await applyOps([
        {
            type: 'set',
            collection: 'receivables',
            id: rec.id,
            merge: true,
            data: {
                ...rec,
                amount_paid: paid,
                amount_due: Math.max(0, due),
                status,
                received_in: payload.account_id,
                ...(payload.note ? { note: `${rec.note || ''}\n${payload.note}`.trim() } : {})
            }
        },
        {
            type: 'set',
            collection: 'transactions',
            id: result.id,
            merge: true,
            data: { receivable_id: rec.id }
        }
    ]);

    return { ...result, receivable: { ...rec, amount_paid: paid, amount_due: Math.max(0, due), status } };
}

export async function markPayablePaid(payload) {
    requireFields(payload, ['payable_id']);
    const state = getState();
    const pay = state.payables.find((p) => p.id === payload.payable_id);
    if (!pay) throw new Error('Payable not found');

    const accountId = payload.account_id || pay.planned_source;
    if (!accountId) throw new Error('No source account');

    const amount = round2(payload.amount ?? pay.amount);
    const result = await addExpense({
        amount,
        account_id: accountId,
        fund_id: pay.fund_id,
        counterparty: pay.payee,
        category: 'payable_payment',
        note: payload.note || `Paid: ${pay.payee}`,
        date: payload.date || todayISO()
    });

    await applyOps([
        {
            type: 'set',
            collection: 'payables',
            id: pay.id,
            merge: true,
            data: {
                ...pay,
                status: 'PAID',
                paid_at: new Date().toISOString(),
                paid_from: accountId,
                paid_amount: amount
            }
        },
        {
            type: 'set',
            collection: 'transactions',
            id: result.id,
            merge: true,
            data: { payable_id: pay.id }
        }
    ]);

    return { ...result, payable_id: pay.id };
}

export async function reconcileAccount(payload) {
    requireFields(payload, ['account_id', 'actual_balance']);
    const state = getState();
    const acct = state.accounts.find((a) => a.id === payload.account_id);
    if (!acct) throw new Error('Account not found');

    const actual = round2(payload.actual_balance);
    const book = acct.balance === null || acct.balance === undefined ? null : round2(acct.balance);
    const variance = book === null ? null : round2(actual - book);

    const ops = [
        {
            type: 'set',
            collection: 'accounts',
            id: acct.id,
            merge: true,
            data: {
                ...acct,
                balance: actual,
                as_of: new Date().toISOString(),
                last_reconciled_at: new Date().toISOString(),
                last_reconciled_book: book,
                last_reconciled_variance: variance
            }
        }
    ];

    let txnId = null;
    if (payload.book_adjustment && variance !== null && Math.abs(variance) > 0.01) {
        const fundId = payload.fund_id || state.funds[0]?.id;
        if (!fundId) throw new Error('Need a fund for the adjustment');
        txnId = uid('TXN');
        const direction = variance > 0 ? 'in' : 'out';
        const amount = Math.abs(variance);
        ops.push(...adjustAlloc(acct.id, fundId, variance, payload.note || 'Reconciliation adjustment'));
        ops.push({
            type: 'set',
            collection: 'transactions',
            id: txnId,
            data: {
                id: txnId,
                date: payload.date || todayISO(),
                account_id: acct.id,
                fund_id: fundId,
                direction,
                amount,
                category: 'reconciliation',
                description: 'Reconciliation adjustment',
                note: payload.note || `Reconcile: book ${book} → actual ${actual} (Δ ${variance})`,
                status: 'posted',
                tags: ['reconcile'],
                already_reflected_in_opening_balance: false,
                type: 'adjustment'
            }
        });
    }

    await applyOps(ops);
    return { book, actual, variance, txnId, warnings: [] };
}

export async function updateTransaction(payload) {
    requireFields(payload, ['id']);
    const state = getState();
    const existing = state.transactions.find((t) => t.id === payload.id);
    if (!existing) throw new Error('Transaction not found');
    if (existing.already_reflected_in_opening_balance) {
        // Allow note/metadata edits only on history
        await applyOps([
            {
                type: 'set',
                collection: 'transactions',
                id: existing.id,
                merge: true,
                data: {
                    ...existing,
                    note: payload.note !== undefined ? payload.note : existing.note,
                    counterparty:
                        payload.counterparty !== undefined
                            ? payload.counterparty
                            : existing.counterparty,
                    category: payload.category !== undefined ? payload.category : existing.category,
                    description:
                        payload.description !== undefined
                            ? payload.description
                            : existing.description,
                    tags: payload.tags !== undefined ? payload.tags : existing.tags
                }
            }
        ]);
        return { id: existing.id, warnings: ['History row: only metadata updated'] };
    }

    // For live txns: reverse old effect then apply new (simple path for fund/amount/account changes)
    await deleteTransaction({ id: existing.id });
    const base = {
        ...existing,
        ...payload,
        id: existing.id
    };
    if (existing.type === 'move_cash' || existing.direction === 'transfer') {
        return moveCash({
            id: existing.id,
            amount: base.amount,
            from_account_id: base.account_id,
            to_account_id: base.to_account_id,
            fund_id: base.fund_id,
            note: base.note,
            date: base.date,
            rail: base.rail
        });
    }
    if (existing.type === 'reassign_fund' || existing.direction === 'reassign') {
        return reassignFund({
            id: existing.id,
            amount: base.amount,
            account_id: base.account_id,
            from_fund_id: base.from_fund_id,
            to_fund_id: base.to_fund_id,
            note: base.note,
            date: base.date
        });
    }
    if (base.direction === 'in' || existing.type === 'income') {
        return addMoneyIn(base);
    }
    return addExpense(base);
}

export async function deleteTransaction(payload) {
    requireFields(payload, ['id']);
    const state = getState();
    const t = state.transactions.find((x) => x.id === payload.id);
    if (!t) throw new Error('Transaction not found');

    if (t.already_reflected_in_opening_balance) {
        await applyOps([{ type: 'delete', collection: 'transactions', id: t.id }]);
        return { id: t.id, warnings: ['Removed history row from display (balances unchanged)'] };
    }

    const ops = [];
    const amount = Number(t.amount);

    if (t.type === 'move_cash' || t.direction === 'transfer') {
        const outBal = bumpAccountBalance(t.account_id, amount);
        const inBal = bumpAccountBalance(t.to_account_id, -amount);
        ops.push(...outBal.ops, ...inBal.ops);
        ops.push(...adjustAlloc(t.account_id, t.fund_id, amount));
        ops.push(...adjustAlloc(t.to_account_id, t.fund_id, -amount));
    } else if (t.type === 'reassign_fund' || t.direction === 'reassign') {
        ops.push(...adjustAlloc(t.account_id, t.to_fund_id, -amount));
        ops.push(...adjustAlloc(t.account_id, t.from_fund_id, amount));
        ops.push(
            ...settleOrCreateInterfund(t.to_fund_id, t.from_fund_id, amount, `Reverse: ${t.note || t.id}`)
        );
    } else if (t.direction === 'in') {
        const bal = bumpAccountBalance(t.account_id, -amount);
        ops.push(...bal.ops);
        ops.push(...adjustAlloc(t.account_id, t.fund_id, -amount));
    } else {
        const bal = bumpAccountBalance(t.account_id, amount);
        ops.push(...bal.ops);
        ops.push(...adjustAlloc(t.account_id, t.fund_id, amount));
    }

    ops.push({ type: 'delete', collection: 'transactions', id: t.id });
    await applyOps(ops);
    return { id: t.id, warnings: [] };
}

export async function bulkReassignFundOnTransactions(payload) {
    requireFields(payload, ['ids', 'fund_id']);
    const warnings = [];
    for (const id of payload.ids) {
        const state = getState();
        const t = state.transactions.find((x) => x.id === id);
        if (!t) continue;
        if (t.already_reflected_in_opening_balance) {
            await applyOps([
                {
                    type: 'set',
                    collection: 'transactions',
                    id: t.id,
                    merge: true,
                    data: { ...t, fund_id: payload.fund_id }
                }
            ]);
            warnings.push(`${id}: history metadata only (balances not recomputed)`);
            continue;
        }
        if (t.fund_id === payload.fund_id) continue;
        // Reverse old fund allocation effect and apply new — for simple in/out only
        if (t.direction === 'in' || t.direction === 'out') {
            const sign = t.direction === 'in' ? 1 : -1;
            const ops = [
                ...adjustAlloc(t.account_id, t.fund_id, -sign * Number(t.amount)),
                ...adjustAlloc(t.account_id, payload.fund_id, sign * Number(t.amount)),
                {
                    type: 'set',
                    collection: 'transactions',
                    id: t.id,
                    merge: true,
                    data: { ...t, fund_id: payload.fund_id }
                }
            ];
            await applyOps(ops);
        } else {
            warnings.push(`${id}: skipped (not a simple in/out entry)`);
        }
    }
    return { warnings };
}

export async function saveFund(payload) {
    requireFields(payload, ['id', 'name', 'color']);
    const state = getState();
    const existing = state.funds.find((f) => f.id === payload.id);
    await applyOps([
        {
            type: 'set',
            collection: 'funds',
            id: payload.id,
            data: {
                id: payload.id,
                name: payload.name,
                purpose: payload.purpose || existing?.purpose || '',
                color: payload.color,
                archived: !!payload.archived
            }
        }
    ]);
    return { id: payload.id };
}

export async function saveAccount(payload) {
    requireFields(payload, ['id', 'name']);
    const state = getState();
    const existing = state.accounts.find((a) => a.id === payload.id) || {};
    await applyOps([
        {
            type: 'set',
            collection: 'accounts',
            id: payload.id,
            data: {
                ...existing,
                ...payload,
                limits: payload.limits || existing.limits || {}
            }
        }
    ]);
    return { id: payload.id };
}

export async function saveReceivable(payload) {
    requireFields(payload, ['id', 'payer', 'fund_id', 'amount_total']);
    const amount_total = round2(payload.amount_total);
    const amount_paid = round2(payload.amount_paid || 0);
    const amount_due = round2(payload.amount_due ?? amount_total - amount_paid);
    const status =
        payload.status ||
        (amount_due <= 0.01 ? 'PAID' : amount_paid > 0 ? 'PARTIAL' : 'UNPAID');
    await applyOps([
        {
            type: 'set',
            collection: 'receivables',
            id: payload.id,
            data: {
                ...payload,
                amount_total,
                amount_paid,
                amount_due,
                status
            }
        }
    ]);
    return { id: payload.id };
}

export async function savePayable(payload) {
    requireFields(payload, ['id', 'payee', 'fund_id', 'amount']);
    await applyOps([
        {
            type: 'set',
            collection: 'payables',
            id: payload.id,
            data: {
                status: 'SCHEDULED',
                ...payload,
                amount: round2(payload.amount)
            }
        }
    ]);
    return { id: payload.id };
}

export async function resolveOpenQuestion(payload) {
    requireFields(payload, ['id']);
    const state = getState();
    const q = state.open_questions.find((x) => x.id === payload.id);
    if (!q) throw new Error('Question not found');
    await applyOps([
        {
            type: 'set',
            collection: 'open_questions',
            id: q.id,
            merge: true,
            data: {
                ...q,
                resolved: !!payload.resolved,
                answer: payload.answer || q.answer || ''
            }
        }
    ]);
    return { id: q.id };
}

export async function deleteReceivable(id) {
    await applyOps([{ type: 'delete', collection: 'receivables', id }]);
}

export async function deletePayable(id) {
    await applyOps([{ type: 'delete', collection: 'payables', id }]);
}
