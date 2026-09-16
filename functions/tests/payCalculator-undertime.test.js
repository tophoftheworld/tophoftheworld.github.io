/**
 * Unit tests for overnight-aware undertime in PayCalculator.
 * Run: node tests/payCalculator-undertime.test.js
 */
const assert = require('assert');
const PayCalculator = require('../payCalculator');

const calc = new PayCalculator({}, {});

function testOvernightClosingNoUndertime() {
  // Closing 1:13 PM → 12:18 AM vs scheduled 1:00 PM–10:00 PM
  const mins = calc.getUndertimeMinutes('1:13 PM', '12:18 AM', '1:00 PM', '10:00 PM');
  assert.strictEqual(mins, 0, `expected 0 undertime for overnight closing out, got ${mins}`);
}

function testOvernightOpeningNoUndertime() {
  // Opening 7:50 AM → 2:00 AM vs scheduled 9:30 AM–6:30 PM
  const mins = calc.getUndertimeMinutes('7:50 AM', '2:00 AM', '9:30 AM', '6:30 PM');
  assert.strictEqual(mins, 0, `expected 0 undertime for overnight opening out, got ${mins}`);
}

function testSameDayEarlyOut() {
  // Closing 1:00 PM–8:00 PM vs scheduled out 10:00 PM → 2h undertime
  const mins = calc.getUndertimeMinutes('1:00 PM', '8:00 PM', '1:00 PM', '10:00 PM');
  assert.strictEqual(mins, 120, `expected 120 mins undertime, got ${mins}`);
}

function testOvernightScheduleRealUndertime() {
  // Custom overnight 8:00 PM–2:00 AM, out at 1:00 AM → 1h undertime
  const mins = calc.getUndertimeMinutes('8:00 PM', '1:00 AM', '8:00 PM', '2:00 AM');
  assert.strictEqual(mins, 60, `expected 60 mins undertime, got ${mins}`);
}

function testOvernightOutNotLate() {
  // Late uses compareTimes(timeIn, scheduledIn) — overnight out must not affect late
  const lateMins = calc.compareTimes('1:13 PM', '1:00 PM');
  assert.ok(lateMins > 0 && lateMins < 60, `expected small late, got ${lateMins}`);
  const undertime = calc.getUndertimeMinutes('1:13 PM', '12:18 AM', '1:00 PM', '10:00 PM');
  assert.strictEqual(undertime, 0);
}

function testDetailedDeductionsOvernightClosing() {
  const entry = {
    date: '2026-08-16',
    timeIn: '1:13 PM',
    timeOut: '12:18 AM',
    scheduledIn: '1:00 PM',
    scheduledOut: '10:00 PM',
    shift: 'Closing',
    hasOTPay: true,
    hasMealAllowance: false
  };
  const hourlyRate = 750 / 8;
  const deductions = calc._calculateDetailedDeductions(entry, hourlyRate, 1.0);
  assert.strictEqual(deductions.undertime.hours, 0);
  assert.strictEqual(deductions.undertime.amount, 0);
}

function testCalculateDeductionsSameDayEarly() {
  const hours = calc.calculateDeductions('1:00 PM', '8:00 PM', '1:00 PM', '10:00 PM');
  assert.strictEqual(hours, 2);
}

function testCalculateDeductionsOvernightZero() {
  const hours = calc.calculateDeductions('1:13 PM', '12:18 AM', '1:00 PM', '10:00 PM');
  // 13 min late but under 30-min grace → only undertime would add, and it should be 0
  assert.strictEqual(hours, 0);
}

function run() {
  testOvernightClosingNoUndertime();
  testOvernightOpeningNoUndertime();
  testSameDayEarlyOut();
  testOvernightScheduleRealUndertime();
  testOvernightOutNotLate();
  testDetailedDeductionsOvernightClosing();
  testCalculateDeductionsSameDayEarly();
  testCalculateDeductionsOvernightZero();
  console.log('payCalculator-undertime.test.js: all passed');
}

run();
