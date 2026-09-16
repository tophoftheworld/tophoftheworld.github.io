const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeToken,
  computePaymentSummary,
  toPublicInvoice,
  getPublicInvoiceByToken
} = require("../public-invoice");

test("normalizeToken accepts unguessable ids and rejects junk", () => {
  assert.equal(normalizeToken("a1b2c3d4e5f6a7b8"), "a1b2c3d4e5f6a7b8");
  assert.equal(normalizeToken("  token_OK-123  "), "token_OK-123");
  assert.equal(normalizeToken("short"), null);
  assert.equal(normalizeToken("../etc/passwd"), null);
  assert.equal(normalizeToken(""), null);
});

test("computePaymentSummary reports unpaid when nothing is paid", () => {
  const summary = computePaymentSummary({
    totalAmount: 40000,
    paymentMilestones: [
      { milestone: "Date Reservation", percentage: 25, amount: 10000, paid: false },
      { milestone: "Pre-Event", percentage: 25, amount: 10000, paid: false },
      { milestone: "Event Completion", percentage: 50, amount: 20000, paid: false }
    ]
  });
  assert.equal(summary.paymentStatus, "unpaid");
  assert.equal(summary.amountPaid, 0);
  assert.equal(summary.amountRemaining, 40000);
  assert.equal(summary.amountDueNow, 10000);
  assert.equal(summary.dueLabel, "Date Reservation");
});

test("computePaymentSummary reports partial and remaining after a deposit", () => {
  const summary = computePaymentSummary({
    totalAmount: 40000,
    paymentMilestones: [
      { milestone: "Date Reservation", percentage: 25, amount: 10000, paid: true },
      { milestone: "Pre-Event", percentage: 25, amount: 10000, paid: false },
      { milestone: "Event Completion", percentage: 50, amount: 20000, paid: false }
    ]
  });
  assert.equal(summary.paymentStatus, "partial");
  assert.equal(summary.amountPaid, 10000);
  assert.equal(summary.amountRemaining, 30000);
  assert.equal(summary.amountDueNow, 10000);
  assert.equal(summary.dueLabel, "Pre-Event");
});

test("computePaymentSummary reports paid in full", () => {
  const summary = computePaymentSummary({
    totalAmount: 20000,
    paymentMilestones: [
      { milestone: "Down Payment", percentage: 50, amount: 10000, paid: true },
      { milestone: "Final Payment", percentage: 50, amount: 10000, paid: true }
    ]
  });
  assert.equal(summary.paymentStatus, "paid");
  assert.equal(summary.amountPaid, 20000);
  assert.equal(summary.amountRemaining, 0);
  assert.equal(summary.dueLabel, "Paid in full");
});

test("toPublicInvoice strips unpublished internals and keeps customer fields", () => {
  const pub = toPublicInvoice({
    invoiceNumber: "INV-2026-0910-001",
    invoiceDate: "2026-09-10",
    clientName: "Ada",
    clientCompany: "Booking.com",
    notes: "Please pay via GCash",
    publicToken: "secret",
    shareStatus: "published",
    savedAt: "2026-09-10T00:00:00.000Z",
    totalAmount: 10000,
    invoiceItems: [{ description: "Starter" }],
    customLineItems: [],
    paymentMilestones: [
      { id: 1, milestone: "Down Payment", percentage: 50, amount: 5000, paid: false }
    ]
  });
  assert.equal(pub.invoiceNumber, "INV-2026-0910-001");
  assert.equal(pub.clientName, "Ada");
  assert.equal(pub.clientCompany, "Booking.com");
  assert.equal(pub.notes, "Please pay via GCash");
  assert.equal(pub.invoiceItems.length, 1);
  assert.equal(pub.paymentStatus, "unpaid");
  assert.equal(pub.publicToken, undefined);
  assert.equal(pub.shareStatus, undefined);
  assert.equal(pub.savedAt, undefined);
});

test("getPublicInvoiceByToken returns 404 for invalid or missing tokens", async () => {
  const fakeDb = {
    collection(name) {
      return {
        where() {
          return {
            limit() {
              return { get: async () => ({ docs: [] }) };
            },
            get: async () => ({ docs: [] })
          };
        }
      };
    }
  };
  const missing = await getPublicInvoiceByToken("aaaaaaaaaaaaaaaa", fakeDb);
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);

  const invalid = await getPublicInvoiceByToken("bad token", fakeDb);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 404);
});

test("normalizeCustomerChoiceDrinks keeps catalog drinks within slot limit", () => {
  const {
    normalizeCustomerChoiceDrinks
  } = require("../public-invoice");
  const drinks = normalizeCustomerChoiceDrinks(
    [
      "Strawberry Matchanese Latte",
      "Matchanese Sunrise",
      "bogus drink",
      "Strawberry Matchanese Latte",
      "Matchanese Coconut"
    ],
    3,
    false
  );
  assert.deepEqual(drinks, [
    "Strawberry Matchanese Latte",
    "Matchanese Sunrise",
    "Matchanese Coconut"
  ]);
});

test("buildMobileBarMenuLines inserts named drinks and remaining placeholder", () => {
  const { buildMobileBarMenuLines } = require("../public-invoice");
  const lines = buildMobileBarMenuLines(3, false, [
    "Strawberry Matchanese Latte",
    "Matchanese Sunrise"
  ]);
  assert.ok(lines.includes("Signature Matchanese Latte"));
  assert.ok(lines.includes("Strawberry Matchanese Latte"));
  assert.ok(lines.includes("1 additional drink of choice"));
});

test("getPublicInvoiceByToken returns published invoice only", async () => {
  const fakeDb = {
    collection(name) {
      if (name === "invoicePaymentProofs") {
        return {
          where() {
            return {
              get: async () => ({ docs: [] })
            };
          }
        };
      }
      return {
        where() {
          return {
            limit() {
              return {
                get: async () => ({
                  docs: [
                    {
                      id: "draft1",
                      data: () => ({
                        publicToken: "aaaaaaaaaaaaaaaa",
                        shareStatus: "draft",
                        clientName: "Hidden"
                      })
                    },
                    {
                      id: "pub1",
                      data: () => ({
                        publicToken: "aaaaaaaaaaaaaaaa",
                        shareStatus: "published",
                        clientName: "Visible",
                        totalAmount: 5000,
                        paymentMilestones: [
                          { milestone: "Down Payment", percentage: 100, amount: 5000, paid: false }
                        ]
                      })
                    }
                  ]
                })
              };
            }
          };
        }
      };
    }
  };
  const result = await getPublicInvoiceByToken("aaaaaaaaaaaaaaaa", fakeDb);
  assert.equal(result.ok, true);
  assert.equal(result.data.clientName, "Visible");
  assert.equal(result.data.paymentStatus, "unpaid");
});
