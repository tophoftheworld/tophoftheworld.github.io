'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UPDATE_LOG_COOLDOWN_MS,
  planRequirementsUpdateLog,
} = require('../requirements-update-log');

test('logs initial submit on create', () => {
  const plan = planRequirementsUpdateLog({
    before: null,
    after: { submissionState: 'submitted', brandName: 'A' },
    now: new Date('2026-07-29T12:00:00Z'),
  });
  assert.equal(plan.shouldWrite, true);
  assert.equal(plan.reason, 'initial_submit');
  assert.equal(plan.updateLog.length, 1);
  assert.equal(plan.updateLog[0].type, 'submitted');
});

test('does not log drafts', () => {
  const plan = planRequirementsUpdateLog({
    before: { submissionState: 'draft', notes: 'a' },
    after: { submissionState: 'draft', notes: 'b' },
    now: new Date(),
  });
  assert.equal(plan.shouldWrite, false);
  assert.equal(plan.reason, 'not_submitted');
});

test('logs draft to submitted transition', () => {
  const plan = planRequirementsUpdateLog({
    before: { submissionState: 'draft', brandName: 'A' },
    after: { submissionState: 'submitted', brandName: 'A' },
    now: new Date('2026-07-29T12:00:00Z'),
  });
  assert.equal(plan.shouldWrite, true);
  assert.equal(plan.reason, 'initial_submit');
});

test('ignores updateLog-only writes', () => {
  const submittedAt = new Date('2026-07-29T11:00:00Z');
  const plan = planRequirementsUpdateLog({
    before: {
      submissionState: 'submitted',
      brandName: 'A',
      updateLog: [{ type: 'submitted', at: submittedAt }],
    },
    after: {
      submissionState: 'submitted',
      brandName: 'A',
      updateLog: [
        { type: 'submitted', at: submittedAt },
        { type: 'updated', at: new Date('2026-07-29T12:00:00Z') },
      ],
    },
    now: new Date('2026-07-29T12:00:00Z'),
  });
  assert.equal(plan.shouldWrite, false);
  assert.equal(plan.reason, 'no_content_change');
});

test('skips updates within 30 minutes', () => {
  const submittedAt = new Date('2026-07-29T12:00:00Z');
  const plan = planRequirementsUpdateLog({
    before: {
      submissionState: 'submitted',
      heroDrink: 'old',
      updateLog: [{ type: 'submitted', at: submittedAt }],
    },
    after: {
      submissionState: 'submitted',
      heroDrink: 'new',
      updateLog: [{ type: 'submitted', at: submittedAt }],
    },
    now: new Date(submittedAt.getTime() + UPDATE_LOG_COOLDOWN_MS - 1000),
  });
  assert.equal(plan.shouldWrite, false);
  assert.equal(plan.reason, 'within_cooldown');
});

test('logs update after 30 minutes when content changed', () => {
  const submittedAt = new Date('2026-07-29T12:00:00Z');
  const now = new Date(submittedAt.getTime() + UPDATE_LOG_COOLDOWN_MS + 1000);
  const plan = planRequirementsUpdateLog({
    before: {
      submissionState: 'submitted',
      heroDrink: 'old',
      updateLog: [{ type: 'submitted', at: submittedAt }],
    },
    after: {
      submissionState: 'submitted',
      heroDrink: 'new',
      updateLog: [{ type: 'submitted', at: submittedAt }],
    },
    now,
  });
  assert.equal(plan.shouldWrite, true);
  assert.equal(plan.reason, 'throttled_update');
  assert.equal(plan.updateLog.length, 2);
  assert.equal(plan.updateLog[1].type, 'updated');
});
