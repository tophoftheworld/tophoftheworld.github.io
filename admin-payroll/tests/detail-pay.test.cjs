const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../js/admin-script.js'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../shared/js/PayCalculator.js'), 'utf8'), context);
const PayCalculator = context.module.exports;

// Exercise the actual document-to-row mappings without loading the Firebase UI.
for (const loader of ['loadEmployeeDetailsAsMainTable']) {
    const body = source.slice(source.indexOf(`async function ${loader}(`));
    const mapping = body.match(/dates\.push\((\{[\s\S]*?\})\);/)[1];
    const rowCalculation = body.match(/const dailyPay = ([^;]+);/)[1];

    test(`${loader}: detail totals and bonuses match Pay Mode with period rates`, () => {
        const calculator = new PayCalculator();
        const periodId = '2026-09-test';
        const employee = {
            baseRate: 600, salesBonusEligible: true,
            rateHistory: [{ periodId, baseRate: 700 }]
        };
        const rated = PayCalculator.mergeEmployeeRatesForPeriod(employee, periodId);
        const bonuses = [0, 0, 0, 150, 175, 0, 0, 0, 0, 0, 0];
        let total = 0;
        bonuses.forEach((salesBonus, index) => {
            const dateData = {
                clockIn: { time: '9:30 AM' }, clockOut: { time: '6:30 PM' }, salesBonus
            };
            const date = vm.runInNewContext(`(${mapping})`, {
                dateData, dateStr: `2026-09-${13 + index}`, branchName: 'SM North',
                shiftType: 'Opening', scheduledIn: '9:30 AM', scheduledOut: '6:30 PM',
                extractPunchLocation: () => null
            });
            const result = vm.runInNewContext(rowCalculation, {
                date, employeeData: employee, payCalculator: calculator,
                mergeEmpRates: (value) => PayCalculator.mergeEmployeeRatesForPeriod(value, periodId)
            });
            assert.equal(result.breakdown.bonuses.sales, salesBonus);
            assert.equal(result.total, 850 + salesBonus);
            assert.equal(result.total, calculator.calculateDailyPay(date, rated, 'simple'));
            total += result.total;
        });
        assert.equal(total, 9675);
    });
}
