/**
 * Unit tests for senior/PWD ID field normalizers (no Gemini network calls).
 * Run: node tests/extractDiscountId.test.js
 */
const assert = require('assert');
const {
  normalizeIdParsed,
  normalizeIdDate,
  normalizeSex,
  detailFieldsFor,
  PWD_DETAIL_FIELDS
} = require('../extractDiscountId');

function testNormalizeDates() {
  assert.strictEqual(normalizeIdDate('1958-03-12'), '1958-03-12');
  assert.strictEqual(normalizeIdDate('03/12/1958'), '1958-03-12');
  assert.strictEqual(normalizeIdDate('12/03/1958'), '1958-12-03');
  assert.strictEqual(normalizeIdDate('22/07/1958'), '1958-07-22');
}

function testNormalizeSex() {
  assert.strictEqual(normalizeSex('F'), 'Female');
  assert.strictEqual(normalizeSex('male'), 'Male');
  assert.strictEqual(normalizeSex('babae'), 'Female');
}

function testPwdFieldsIncludeDisability() {
  const keys = PWD_DETAIL_FIELDS.map((f) => f.key);
  assert.ok(keys.includes('disabilityType'));
  assert.ok(!detailFieldsFor('senior').some((f) => f.key === 'disabilityType'));
  assert.ok(!PWD_DETAIL_FIELDS.some((f) => f.key === 'bloodType'));
  assert.ok(!detailFieldsFor('senior').some((f) => f.key === 'bloodType'));
}

function testNormalizeParsedSenior() {
  const parsed = normalizeIdParsed(
    {
      fullName: '  Juana Dela Cruz  ',
      idNumber: 'OSC-12345',
      dateOfBirth: '12/03/1958',
      sex: 'F',
      disabilityType: 'should be dropped',
      issuingLgu: 'Quezon City',
      documentType: 'senior'
    },
    'senior'
  );
  assert.strictEqual(parsed.fullName, 'Juana Dela Cruz');
  assert.strictEqual(parsed.idNumber, 'OSC-12345');
  assert.strictEqual(parsed.dateOfBirth, '1958-12-03');
  assert.strictEqual(parsed.sex, 'Female');
  assert.strictEqual(parsed.disabilityType, '');
  assert.strictEqual(parsed.issuingLgu, 'Quezon City');
  assert.strictEqual(parsed.idType, 'senior');
  assert.strictEqual(parsed.documentType, 'senior');
}

function testNormalizeParsedPwd() {
  const parsed = normalizeIdParsed(
    {
      fullName: 'Pedro Santos',
      disabilityType: 'Orthopedic',
      documentType: 'pwd'
    },
    'pwd'
  );
  assert.strictEqual(parsed.disabilityType, 'Orthopedic');
  assert.strictEqual(parsed.idType, 'pwd');
}

function testEmptyUnknown() {
  const parsed = normalizeIdParsed(null, 'pwd');
  assert.strictEqual(parsed.fullName, '');
  assert.strictEqual(parsed.documentType, 'unknown');
  assert.strictEqual(parsed.idType, 'pwd');
}

testNormalizeDates();
testNormalizeSex();
testPwdFieldsIncludeDisability();
testNormalizeParsedSenior();
testNormalizeParsedPwd();
testEmptyUnknown();
console.log('extractDiscountId tests passed');
