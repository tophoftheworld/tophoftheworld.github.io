const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../js/admin-script.js'), 'utf8');
function functionSource(name) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    return source.slice(start, source.indexOf('\n}', start) + 2);
}
function harness(initialPaid) {
    let record = initialPaid == null ? null : { paymentAmount: initialPaid };
    let writes = 0;
    const context = {
        navigator: { onLine: true }, console: { log() {}, warn() {}, error() {} },
        filteredData: { employee: {} }, attendanceData: {}, db: {},
        getEmployeeTotalPayForTable: () => 6760.625,
        v2PaymentDocRef: () => 'payment',
        getDocFromServer: async () => ({ exists: () => record !== null, data: () => record }),
        setDoc: async (_, value) => { record = value; writes++; },
        waitForPendingWrites: async () => {},
        normalizePaymentStatusRecord: (value) => value,
        applyVerifiedPaymentToLocalState: () => {},
        query: () => ({}), collection: () => ({}), where: () => ({}),
        PERIOD_EARNINGS_COLLECTION: 'earnings',
        getDocs: async () => ({ forEach() {} }), isPriorEarningsToggleOn: () => false
    };
    vm.createContext(context);
    vm.runInContext(functionSource('getPaymentBalance') + '\n' + functionSource('persistPayrollPayment'), context);
    return { context, record: () => record, writes: () => writes };
}

test('legacy fractional-cent full payment has no phantom remaining balance', () => {
    const { context } = harness();
    const balance = context.getPaymentBalance(6760.625, { paymentAmount: 6760.625 });
    assert.equal(balance.total, 6760.63);
    assert.equal(balance.paid, 6760.63);
    assert.equal(balance.remaining, 0);
    assert.equal(balance.surplus, 0);
    assert.equal(balance.rawRemaining, 0);
});

test('a genuine cent due or overpaid is retained', () => {
    const { context } = harness();
    assert.equal(context.getPaymentBalance(6760.625, { paymentAmount: 6760.62 }).remaining, 0.01);
    assert.equal(context.getPaymentBalance(6760.625, { paymentAmount: 6760.64 }).surplus, 0.01);
});

test('full payment is stored in cents and repeated confirmation does not add payment', async () => {
    const h = harness();
    const args = { employeeId: 'employee', periodId: 'period', paymentAmount: 6760.63 };
    await h.context.persistPayrollPayment(args);
    assert.equal(h.record().paymentAmount, 6760.63);
    assert.equal(h.record().totalPay, 6760.63);
    assert.equal(h.record().remainingAmount, 0);
    assert.equal(h.record().paymentType, 'full');
    const repeat = await h.context.persistPayrollPayment(args);
    assert.equal(repeat.alreadyPaid, true);
    assert.equal(h.writes(), 1);
});

test('genuine last cent can be settled and stays settled', async () => {
    const h = harness(6760.62);
    await h.context.persistPayrollPayment({ employeeId: 'employee', periodId: 'period', paymentAmount: 0.01 });
    assert.equal(h.record().paymentAmount, 6760.63);
    assert.equal(h.context.getPaymentBalance(6760.625, h.record()).remaining, 0);
});

test('legacy full payment does not prompt another payment write', async () => {
    const h = harness(6760.625);
    const result = await h.context.persistPayrollPayment({ employeeId: 'employee', periodId: 'period', paymentAmount: 0.01 });
    assert.equal(result.alreadyPaid, true);
    assert.equal(h.writes(), 0);
    assert.equal(h.context.getPaymentBalance(6760.625, result.paymentData).remaining, 0);
});
