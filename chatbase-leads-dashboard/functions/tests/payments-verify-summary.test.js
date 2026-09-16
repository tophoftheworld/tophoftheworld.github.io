const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeMethod,
  formatAmount,
  buildPaymentsToVerifyBullets
} = require("../payments-verify-summary");
const { createCalendarWindow, createRollingWindow } = require("../inbox-summary");

test("normalizeMethod maps common banks", () => {
  assert.equal(normalizeMethod("gcash"), "GCash");
  assert.equal(normalizeMethod("BPI Online"), "BPI");
  assert.equal(normalizeMethod(""), "Unspecified");
});

test("formatAmount formats peso amounts", () => {
  assert.equal(formatAmount("3500"), "Php3,500");
  assert.equal(formatAmount("5150.5"), "Php5,150.50");
  assert.equal(formatAmount(null), null);
});

test("buildPaymentsToVerifyBullets groups by bank method", () => {
  const window = createCalendarWindow("2026-07-10", "Asia/Manila");
  const bullets = buildPaymentsToVerifyBullets(
    [
      {
        shopifyOrderName: "M#8191",
        amount: "3500",
        paymentMethod: "GCash",
        createdAt: "2026-07-10T04:00:00.000Z"
      },
      {
        orderNumber: "M#9128",
        amount: "5150",
        paymentMethod: "gcash",
        createdAt: "2026-07-10T08:00:00.000Z"
      },
      {
        shopifyOrderName: "M#9004",
        amount: "12000",
        paymentMethod: "BPI",
        createdAt: "2026-07-10T09:00:00.000Z"
      },
      {
        shopifyOrderName: "M#1111",
        amount: "100",
        paymentMethod: "GCash",
        createdAt: "2026-07-09T09:00:00.000Z"
      }
    ],
    window
  );

  assert.equal(bullets.length, 2);
  assert.equal(bullets[0], "BPI: M#9004 - Php12,000");
  assert.equal(bullets[1], "GCash: M#8191 - Php3,500, M#9128 - Php5,150");
});

test("buildPaymentsToVerifyBullets respects rolling window", () => {
  const endMs = Date.parse("2026-07-11T04:00:00.000Z");
  const window = createRollingWindow(24, endMs, "Asia/Manila");
  const bullets = buildPaymentsToVerifyBullets(
    [
      {
        shopifyOrderName: "M#1",
        amount: "100",
        paymentMethod: "Maya",
        createdAt: "2026-07-10T05:00:00.000Z"
      },
      {
        shopifyOrderName: "M#2",
        amount: "200",
        paymentMethod: "Maya",
        createdAt: "2026-07-09T03:00:00.000Z"
      }
    ],
    window
  );
  assert.equal(bullets.length, 1);
  assert.match(bullets[0], /M#1/);
  assert.doesNotMatch(bullets[0], /M#2/);
});
