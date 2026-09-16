import { daysUntil, round2, todayISO } from './format.js';

export function emptyState() {
    return {
        meta: null,
        funds: [],
        accounts: [],
        allocations: [],
        transactions: [],
        receivables: [],
        payables: [],
        expected_inflows: [],
        interfund_balances: [],
        credit_lines: [],
        open_questions: [],
        fund_totals_check: null,
        loaded: false
    };
}

export function allocationKey(accountId, fundId) {
    return `${accountId}__${fundId}`;
}

export function getAllocation(state, accountId, fundId) {
    return state.allocations.find(
        (a) => a.account_id === accountId && a.fund_id === fundId
    );
}

export function allocationSumForAccount(state, accountId) {
    return round2(
        state.allocations
            .filter((a) => a.account_id === accountId)
            .reduce((s, a) => s + Number(a.amount || 0), 0)
    );
}

export function validateAllocations(state) {
    const warnings = [];
    for (const acct of state.accounts) {
        if (acct.balance === null || acct.balance === undefined) continue;
        const sum = allocationSumForAccount(state, acct.id);
        const variance = round2(Number(acct.balance) - sum);
        if (Math.abs(variance) > 0.01) {
            warnings.push({
                account_id: acct.id,
                balance: acct.balance,
                allocated: sum,
                variance
            });
        }
    }
    return warnings;
}

export function fundCashHeld(state, fundId) {
    return round2(
        state.allocations
            .filter((a) => a.fund_id === fundId)
            .reduce((s, a) => s + Number(a.amount || 0), 0)
    );
}

export function accountFundSplit(state, accountId) {
    const fundsById = Object.fromEntries(state.funds.map((f) => [f.id, f]));
    return state.allocations
        .filter((a) => a.account_id === accountId && Number(a.amount) > 0)
        .map((a) => ({
            fund_id: a.fund_id,
            amount: Number(a.amount),
            name: fundsById[a.fund_id]?.name || a.fund_id,
            color: fundsById[a.fund_id]?.color || '#888'
        }))
        .sort((a, b) => b.amount - a.amount);
}

export function interfundNetForFund(state, fundId) {
    let owedToFund = 0;
    let fundOwes = 0;
    const open = state.interfund_balances.filter((b) => (b.status || 'OPEN') === 'OPEN');
    for (const b of open) {
        const amt = Number(b.amount || 0);
        if (b.creditor_fund === fundId) owedToFund += amt;
        if (b.debtor_fund === fundId) fundOwes += amt;
    }
    return {
        owedToFund: round2(owedToFund),
        fundOwes: round2(fundOwes),
        net: round2(owedToFund - fundOwes)
    };
}

export function receivablesDueForFund(state, fundId) {
    return round2(
        state.receivables
            .filter((r) => r.fund_id === fundId && r.status !== 'PAID')
            .reduce((s, r) => {
                const due =
                    r.amount_due != null
                        ? Number(r.amount_due)
                        : Number(r.amount_total || 0) - Number(r.amount_paid || 0);
                return s + due;
            }, 0)
    );
}

export function payablesDueForFund(state, fundId) {
    return round2(
        state.payables
            .filter((p) => p.fund_id === fundId && p.status !== 'PAID' && p.status !== 'CANCELLED')
            .reduce((s, p) => s + Number(p.amount || 0), 0)
    );
}

export function fundPosition(state, fund) {
    const cash = fundCashHeld(state, fund.id);
    const receivables = receivablesDueForFund(state, fund.id);
    const payables = payablesDueForFund(state, fund.id);
    const ifund = interfundNetForFund(state, fund.id);
    const net = round2(cash + receivables - payables + ifund.net);
    return {
        fund,
        cash,
        receivables,
        payables,
        interfund: ifund,
        net,
        isDeficit: net < 0
    };
}

export function allFundPositions(state) {
    return state.funds
        .filter((f) => !f.archived)
        .map((f) => fundPosition(state, f));
}

export function totalKnownCash(state) {
    return round2(
        state.accounts.reduce((s, a) => {
            if (a.balance === null || a.balance === undefined) return s;
            return s + Number(a.balance);
        }, 0)
    );
}

export function allocationForAccountFund(state, accountId, fundId) {
    const a = getAllocation(state, accountId, fundId);
    return a ? Number(a.amount || 0) : 0;
}

/** Coverage: green can cover, amber partial/tight, red cannot or unknown source */
export function obligationCoverage(state, payable) {
    const acct = state.accounts.find((a) => a.id === payable.planned_source);
    if (!acct) {
        return { level: 'red', label: 'No source', detail: 'No planned source account' };
    }
    if (acct.balance === null || acct.balance === undefined) {
        return { level: 'red', label: 'Unknown', detail: `${acct.name} balance unknown` };
    }
    const needed = Number(payable.amount || 0);
    const fundCash = allocationForAccountFund(state, acct.id, payable.fund_id);
    const accountCash = Number(acct.balance);

    if (fundCash >= needed) {
        return { level: 'green', label: 'Covered', detail: `Fund has ${fundCash} in ${acct.name}` };
    }
    if (accountCash >= needed) {
        return {
            level: 'amber',
            label: 'Wrong fund',
            detail: `Account has cash but only ${fundCash} in this fund`
        };
    }
    if (accountCash > 0 && accountCash < needed) {
        return { level: 'amber', label: 'Short', detail: `Account has ${accountCash}, need ${needed}` };
    }
    return { level: 'red', label: 'Short', detail: `Insufficient in ${acct.name}` };
}

export function upcomingObligations(state, withinDays = 14) {
    const today = todayISO();
    return state.payables
        .filter((p) => p.status !== 'PAID' && p.status !== 'CANCELLED' && p.due_date)
        .filter((p) => {
            const d = daysUntil(p.due_date);
            return d !== null && d <= withinDays;
        })
        .sort((a, b) => {
            if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
            return (a.priority || 99) - (b.priority || 99);
        })
        .map((p) => ({
            ...p,
            coverage: obligationCoverage(state, p),
            days: daysUntil(p.due_date),
            overdue: p.due_date < today
        }));
}

export function nextHardDeadline(state) {
    const open = state.payables
        .filter((p) => p.status !== 'PAID' && p.status !== 'CANCELLED' && p.due_date)
        .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    if (!open.length) return null;
    const p = open[0];
    return {
        payable: p,
        days: daysUntil(p.due_date),
        label: p.payee
    };
}

export function computeAlerts(state) {
    const alerts = [];

    for (const acct of state.accounts) {
        if (acct.role === 'TRANSIT' && acct.balance !== null && Number(acct.balance) !== 0) {
            alerts.push({
                type: 'transit',
                severity: 'warn',
                title: `${acct.name} still holds a balance`,
                detail: 'Transit accounts should be swept to zero',
                account_id: acct.id
            });
        }
        if (acct.balance === null || acct.balance === undefined) {
            alerts.push({
                type: 'unknown_balance',
                severity: 'warn',
                title: `${acct.name} balance unknown`,
                detail: acct.notes || 'Enter a real balance to reconcile',
                account_id: acct.id
            });
        }
    }

    for (const w of validateAllocations(state)) {
        const acct = state.accounts.find((a) => a.id === w.account_id);
        alerts.push({
            type: 'allocation_variance',
            severity: 'warn',
            title: `Allocation mismatch: ${acct?.name || w.account_id}`,
            detail: `Balance ${w.balance} vs allocated ${w.allocated} (Δ ${w.variance})`,
            account_id: w.account_id
        });
    }

    for (const pos of allFundPositions(state)) {
        if (pos.isDeficit) {
            alerts.push({
                type: 'fund_deficit',
                severity: 'danger',
                title: `${pos.fund.name} is in deficit`,
                detail: `Net position ${pos.net}`,
                fund_id: pos.fund.id
            });
        }
    }

    for (const p of upcomingObligations(state, 30)) {
        if (p.coverage.level === 'red') {
            alerts.push({
                type: 'obligation_source',
                severity: 'danger',
                title: `No viable source: ${p.payee}`,
                detail: p.coverage.detail,
                payable_id: p.id
            });
        }
    }

    const today = todayISO();
    for (const r of state.receivables) {
        if (r.status === 'PAID') continue;
        if (r.due_date && r.due_date < today && Number(r.amount_due || 0) > 0) {
            alerts.push({
                type: 'receivable_overdue',
                severity: 'warn',
                title: `Past due: ${r.payer}`,
                detail: `Still owed ${r.amount_due}`,
                receivable_id: r.id
            });
        }
    }

    const openQ = state.open_questions.filter((q) => !q.resolved);
    if (openQ.length) {
        alerts.push({
            type: 'open_questions',
            severity: 'info',
            title: `${openQ.length} open question${openQ.length === 1 ? '' : 's'}`,
            detail: 'Data gaps waiting for answers'
        });
    }

    return alerts;
}

export function whereDidItGo(state, fundId) {
    const open = state.interfund_balances.filter(
        (b) => (b.status || 'OPEN') === 'OPEN' && b.debtor_fund === fundId
    );
    const consumedBy = state.interfund_balances.filter(
        (b) => (b.status || 'OPEN') === 'OPEN' && b.creditor_fund === fundId
    );
    const relatedTxns = state.transactions.filter(
        (t) =>
            !t.already_reflected_in_opening_balance &&
            (t.fund_id === fundId || t.to_fund_id === fundId || t.from_fund_id === fundId)
    );
    return { owes: open, owedBy: consumedBy, transactions: relatedTxns };
}

export function checkTransferLimits(account, amount, railHint = '') {
    const warnings = [];
    if (!account?.limits) return warnings;
    const limits = account.limits;
    const amt = Number(amount);

    for (const [key, val] of Object.entries(limits)) {
        if (typeof val === 'number' && amt > val) {
            warnings.push({
                key,
                message: `${account.name} ${key} limit is ₱${val.toLocaleString()} — this transfer is ₱${amt.toLocaleString()}`
            });
        } else if (typeof val === 'string') {
            const lower = val.toLowerCase();
            if (lower.includes('banking days') && /weekend|saturday|sunday/i.test(railHint)) {
                warnings.push({ key, message: `${key}: ${val}` });
            }
            if (lower.includes('confirm') || lower.includes('unknown')) {
                warnings.push({ key, message: `${key}: ${val}` });
            }
        }
    }
    return warnings;
}

export function liveTransactions(state) {
    return state.transactions.filter((t) => !t.already_reflected_in_opening_balance);
}

export function historyTransactions(state) {
    return state.transactions.filter((t) => t.already_reflected_in_opening_balance);
}
