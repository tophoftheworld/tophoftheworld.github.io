const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeExtracted,
  normalizePaymentMethod,
  nextUnpaidMilestone
} = require("../invoice-payment-proof");
const {
  allocatePaymentWaterfall,
  reallocateAllPayments,
  enrichMilestonesWithPayments,
  scheduleMilestones,
  softSyncMilestonesFromPayments,
  repairInvoicePaymentState,
  buildScheduleFromStructure
} = require("../invoice-payment-alloc");

test("normalizePaymentMethod maps common wallets and banks", () => {
  assert.equal(normalizePaymentMethod("GCash"), "gcash");
  assert.equal(normalizePaymentMethod("PayMaya"), "maya");
  assert.equal(normalizePaymentMethod("GoTyme"), "gotyme");
  assert.equal(normalizePaymentMethod("BDO Transfer"), "bank");
  assert.equal(normalizePaymentMethod("something else"), "other");
});

test("normalizeExtracted cleans amount and reference", () => {
  const out = normalizeExtracted({
    amount: "1,250.50",
    paymentMethod: "gcash",
    referenceNumber: "  ABC123  ",
    paidAt: "09/10/2026",
    senderName: "Kyle",
    confidence: 0.9
  });
  assert.equal(out.amount, 1250.5);
  assert.equal(out.paymentMethod, "gcash");
  assert.equal(out.referenceNumber, "ABC123");
  assert.equal(out.paidAt, "2026-09-10");
  assert.equal(out.senderName, "Kyle");
  assert.equal(out.confidence, 0.9);
});

test("partial payment allocates to Down Payment without shrinking Final", () => {
  const milestones = [
    { id: 1, role: "first", milestone: "Down Payment", percentage: 50, amount: 15000, paid: false },
    { id: 2, role: "final", milestone: "Final Payment", percentage: 50, amount: 15000, paid: false }
  ];
  const allocs = allocatePaymentWaterfall(milestones, 6000, []);
  assert.equal(allocs.length, 1);
  assert.equal(allocs[0].milestoneId, 1);
  assert.equal(allocs[0].amount, 6000);
  assert.equal(milestones[0].amount, 15000);
  assert.equal(milestones[1].amount, 15000);

  const payment = {
    id: "p1",
    amount: 6000,
    status: "sent",
    screenshotUrl: "https://example.com/p.jpg",
    allocations: allocs
  };
  const enriched = enrichMilestonesWithPayments(milestones, [payment]);
  assert.equal(enriched[0].received, 6000);
  assert.equal(enriched[0].remaining, 9000);
  assert.equal(enriched[0].paid, false);
  assert.equal(enriched[0].paymentStatus, "sent");
  assert.equal(enriched[1].received, 0);
  assert.equal(enriched[1].remaining, 15000);
  assert.equal(enriched[1].amount, 15000);
});

test("exact due marks milestone fully covered", () => {
  const milestones = [
    { id: 1, milestone: "Down Payment", percentage: 50, amount: 500, paid: false },
    { id: 2, milestone: "Final", percentage: 50, amount: 500, paid: false }
  ];
  const allocs = allocatePaymentWaterfall(milestones, 500, []);
  assert.deepEqual(allocs, [
    { milestoneId: 1, role: null, milestoneName: "Down Payment", amount: 500 }
  ]);
  const enriched = enrichMilestonesWithPayments(milestones, [
    { id: "p1", amount: 500, status: "sent", allocations: allocs }
  ]);
  assert.equal(enriched[0].paid, true);
  assert.equal(enriched[0].remaining, 0);
  assert.equal(enriched[1].paid, false);
});

test("full amount covers all milestones", () => {
  const milestones = [
    { id: 1, milestone: "Down Payment", percentage: 50, amount: 500, paid: false },
    { id: 2, milestone: "Final", percentage: 50, amount: 500, paid: false }
  ];
  const allocs = allocatePaymentWaterfall(milestones, 1000, []);
  assert.equal(allocs.length, 2);
  assert.equal(allocs[0].amount, 500);
  assert.equal(allocs[1].amount, 500);
});

test("covers two milestones then partial third without splitting rows", () => {
  const milestones = [
    { id: 1, milestone: "A", percentage: 25, amount: 100, paid: false },
    { id: 2, milestone: "B", percentage: 25, amount: 100, paid: false },
    { id: 3, milestone: "C", percentage: 50, amount: 200, paid: false }
  ];
  const allocs = allocatePaymentWaterfall(milestones, 250, []);
  assert.equal(allocs.length, 3);
  assert.equal(allocs[2].amount, 50);
  assert.equal(milestones.length, 3);
  const enriched = enrichMilestonesWithPayments(milestones, [
    { id: "p3", amount: 250, status: "sent", allocations: allocs }
  ]);
  assert.equal(enriched[2].received, 50);
  assert.equal(enriched[2].remaining, 150);
  assert.equal(enriched[2].amount, 200);
});

test("voided payment is ignored in remaining", () => {
  const milestones = [
    { id: 1, milestone: "Down Payment", percentage: 50, amount: 500, paid: false }
  ];
  const enriched = enrichMilestonesWithPayments(milestones, [
    {
      id: "p",
      amount: 500,
      status: "voided",
      allocations: [{ milestoneId: 1, amount: 500, milestoneName: "Down Payment" }]
    }
  ]);
  assert.equal(enriched[0].received, 0);
  assert.equal(enriched[0].remaining, 500);
});

test("structure change reallocates payments onto new schedule", () => {
  const two = buildScheduleFromStructure("two", 30000, []);
  const payments = [
    {
      id: "p1",
      amount: 6000,
      status: "sent",
      screenshotUrl: "https://example.com/p.jpg",
      allocations: [{ milestoneId: two[0].id, amount: 6000 }]
    }
  ];
  const three = buildScheduleFromStructure("three", 30000, []);
  const reallocated = reallocateAllPayments(three, payments);
  assert.equal(reallocated[0].allocations.length, 1);
  assert.equal(reallocated[0].allocations[0].amount, 6000);
  assert.equal(reallocated[0].screenshotUrl, "https://example.com/p.jpg");
  const enriched = enrichMilestonesWithPayments(three, reallocated);
  assert.equal(enriched[0].received, 6000);
  assert.ok(enriched[0].remaining > 0);
});

test("softSync clears embedded proof and sets paid cache", () => {
  const milestones = [
    {
      id: 1,
      milestone: "Down Payment",
      percentage: 50,
      amount: 15000,
      paid: true,
      screenshotUrl: "https://example.com/p.jpg",
      proofId: "old",
      splitFromId: null
    },
    {
      id: 99,
      milestone: "Down Payment",
      percentage: 0,
      amount: 9000,
      paid: false,
      splitFromId: 1
    },
    { id: 2, milestone: "Final Payment", percentage: 50, amount: 24190, paid: false }
  ];
  const payments = [
    {
      id: "p1",
      amount: 6000,
      status: "sent",
      allocations: [{ milestoneId: 1, amount: 6000, milestoneName: "Down Payment" }]
    }
  ];
  const synced = softSyncMilestonesFromPayments(milestones, payments);
  assert.equal(synced.length, 2);
  assert.equal(synced[0].screenshotUrl, null);
  assert.equal(synced[0].proofId, null);
  assert.equal(synced[0].paid, false);
  assert.equal(synced[0].amount, 15000);
});

test("repair restores 50/50 and promotes embedded screenshot", () => {
  const broken = [
    {
      id: 1,
      role: "first",
      milestone: "Down Payment",
      percentage: 50,
      amount: 6000,
      paid: true,
      screenshotUrl: "https://example.com/p.jpg",
      paymentReference: "R1",
      paymentMethod: "bank",
      paymentStatus: "sent"
    },
    {
      id: 2,
      role: "final",
      milestone: "Final Payment",
      percentage: 50,
      amount: 24190,
      paid: false
    }
  ];
  const { paymentMilestones, payments, promoted } = repairInvoicePaymentState({
    paymentMilestones: broken,
    payments: [],
    paymentStructure: "two",
    amountTotal: 30190
  });
  assert.equal(promoted.length, 1);
  assert.equal(paymentMilestones.length, 2);
  assert.equal(paymentMilestones[0].amount, 15095);
  assert.equal(paymentMilestones[1].amount, 15095);
  assert.equal(payments[0].amount, 6000);
  assert.equal(payments[0].allocations[0].amount, 6000);
  const due = nextUnpaidMilestone(paymentMilestones, payments);
  assert.equal(due.milestone, "Down Payment");
  assert.ok(due.remaining > 8000);
});

test("scheduleMilestones drops split remainder rows", () => {
  const list = scheduleMilestones([
    { id: 1, milestone: "Down Payment", percentage: 50, amount: 6000 },
    { id: 2, milestone: "Down Payment", percentage: 0, amount: 9000, splitFromId: 1 },
    { id: 3, milestone: "Final", percentage: 50, amount: 15000 }
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 1);
  assert.equal(list[1].id, 3);
});

test("allocate rejects zero amount", () => {
  const milestones = [
    { id: 1, milestone: "Down Payment", percentage: 50, amount: 500, paid: false }
  ];
  assert.deepEqual(allocatePaymentWaterfall(milestones, 0, []), []);
});

test("buildScheduleDisplayRows splits received vs due entries", () => {
  const { buildScheduleDisplayRows } = require("../invoice-payment-alloc");
  const milestones = [
    { id: 1, role: "first", milestone: "Down Payment", percentage: 50, amount: 15095 },
    { id: 2, role: "final", milestone: "Final Payment", percentage: 50, amount: 15095 }
  ];
  const payments = [
    {
      id: "p1",
      amount: 6000,
      status: "sent",
      referenceNumber: "PC-1",
      paidAt: "2026-09-01",
      screenshotUrl: "https://example.com/p.jpg",
      allocations: [{ milestoneId: 1, milestoneName: "Down Payment", amount: 6000 }]
    }
  ];
  const rows = buildScheduleDisplayRows(milestones, payments);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, "received");
  assert.equal(rows[0].amount, 6000);
  assert.equal(rows[0].statusLabel, "Payment sent");
  assert.equal(rows[1].kind, "due");
  assert.equal(rows[1].amount, 9095);
  assert.equal(rows[1].statusLabel, "Due now");
  assert.equal(rows[2].kind, "due");
  assert.equal(rows[2].milestone, "Final Payment");
  assert.equal(rows[2].statusLabel, "Upcoming");
});

test("buildScheduleDisplayRows omits due row when fully covered", () => {
  const { buildScheduleDisplayRows } = require("../invoice-payment-alloc");
  const milestones = [
    { id: 1, milestone: "Down Payment", percentage: 50, amount: 500 },
    { id: 2, milestone: "Final", percentage: 50, amount: 500 }
  ];
  const payments = [
    {
      id: "p1",
      amount: 500,
      status: "confirmed",
      allocations: [{ milestoneId: 1, amount: 500, milestoneName: "Down Payment" }]
    }
  ];
  const rows = buildScheduleDisplayRows(milestones, payments);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "received");
  assert.equal(rows[0].statusLabel, "Payment confirmed");
  assert.equal(rows[1].kind, "due");
  assert.equal(rows[1].milestone, "Final");
});

test("buildScheduleDisplayRows one received row per payment allocation", () => {
  const { buildScheduleDisplayRows } = require("../invoice-payment-alloc");
  const milestones = [
    { id: 1, milestone: "Down Payment", percentage: 100, amount: 10000 }
  ];
  const payments = [
    {
      id: "p1",
      amount: 3000,
      status: "confirmed",
      createdAt: "2026-09-01",
      allocations: [{ milestoneId: 1, amount: 3000 }]
    },
    {
      id: "p2",
      amount: 2000,
      status: "sent",
      createdAt: "2026-09-02",
      allocations: [{ milestoneId: 1, amount: 2000 }]
    }
  ];
  const rows = buildScheduleDisplayRows(milestones, payments);
  assert.equal(rows.filter((r) => r.kind === "received").length, 2);
  assert.equal(rows.filter((r) => r.kind === "due").length, 1);
  assert.equal(rows.find((r) => r.kind === "due").amount, 5000);
});

test("findDuplicatePayment blocks same reference", () => {
  const { findDuplicatePayment } = require("../invoice-payment-alloc");
  const existing = [
    {
      id: "p1",
      amount: 6000,
      referenceNumber: "PC-NDBMOB-20260901-67901150",
      status: "sent"
    }
  ];
  const hit = findDuplicatePayment(existing, {
    referenceNumber: "pc-ndbmob-20260901-67901150",
    amount: 6000
  });
  assert.equal(hit.id, "p1");
  assert.equal(
    findDuplicatePayment(existing, {
      referenceNumber: "OTHER-REF",
      amount: 6000
    }),
    null
  );
});

test("repair collapses duplicate Down Payment rows and voids duplicate refs", () => {
  const broken = [
    {
      id: 1,
      role: "first",
      milestone: "Down Payment",
      percentage: 50,
      amount: 6000,
      paid: true,
      screenshotUrl: "https://example.com/a.jpg",
      paymentReference: "PC-NDBMOB-20260901-67901150"
    },
    {
      id: 2,
      role: "first",
      milestone: "Down Payment",
      percentage: 50,
      amount: 6000,
      paid: true,
      paymentReference: "PC-NDBMOB-20260901-67901150"
    },
    {
      id: 3,
      role: "first",
      milestone: "Down Payment",
      percentage: 0,
      amount: 3095,
      paid: false
    },
    {
      id: 4,
      role: "final",
      milestone: "Final Payment",
      percentage: 50,
      amount: 15095,
      paid: false
    }
  ];
  const { paymentMilestones, payments } = repairInvoicePaymentState({
    paymentMilestones: broken,
    payments: [
      {
        id: "p1",
        amount: 6000,
        referenceNumber: "PC-NDBMOB-20260901-67901150",
        status: "confirmed",
        createdAt: "2026-09-01T01:00:00.000Z",
        allocations: []
      },
      {
        id: "p2",
        amount: 6000,
        referenceNumber: "PC-NDBMOB-20260901-67901150",
        status: "sent",
        createdAt: "2026-09-11T01:00:00.000Z",
        allocations: []
      }
    ],
    paymentStructure: "two",
    amountTotal: 30190
  });
  assert.equal(paymentMilestones.length, 2);
  assert.equal(paymentMilestones[0].milestone, "Down Payment");
  assert.equal(paymentMilestones[1].milestone, "Final Payment");
  assert.equal(payments.filter((p) => p.status !== "voided").length, 1);
  assert.ok(payments.filter((p) => p.status === "voided").length >= 1);
});
