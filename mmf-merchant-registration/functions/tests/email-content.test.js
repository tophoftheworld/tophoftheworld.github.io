const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMerchantRecapSubject,
  buildAdminNotifySubject,
  buildMerchantRecapHtml,
  buildAdminNotifyHtml,
  settlementLabel,
  paymentStatusLabel,
  amountDueLabel,
  nextStepNote,
} = require("../email-content");

const sampleDoc = {
  id: "abc-123",
  brandName: "Matchanese",
  registeredBusinessName: "Matchanese Inc.",
  contactPerson: "Toph",
  role: "Owner",
  contactNumber: "09171234567",
  email: "merchant@example.com",
  instagram: "@matchanese",
  otherLinks: ["https://matchanese.com"],
  brandDescription: "Premium matcha drinks",
  settlementType: "downpayment",
  paymentMethod: "ewallet",
  status: "pending_verification",
  proofOfPaymentUrl: "https://storage.example/proof.jpg",
  proofOfPaymentName: "proof.jpg",
  notes: "Need extra power",
  supplierInterest: { crewMeals: true },
  feeSnapshot: {
    totalDue: 56000,
    downpaymentAmount: 28000,
    balanceAmount: 28000,
  },
  eventSnapshot: {
    name: "Manila Matcha Fest 2026",
    dates: "August 7–16, 2026",
    venue: "SM Mall of Asia, Main Atrium",
  },
  createdAt: new Date("2026-07-27T12:00:00"),
};

test("buildMerchantRecapSubject", () => {
  assert.equal(buildMerchantRecapSubject(sampleDoc), "Manila Matcha Fest 2026 — Registration received");
});

test("buildAdminNotifySubject includes brand", () => {
  assert.equal(buildAdminNotifySubject(sampleDoc), "[MMF Merchant] New signup — Matchanese");
});

test("settlementLabel", () => {
  assert.equal(settlementLabel("full"), "Full payment");
  assert.equal(settlementLabel("downpayment"), "50% downpayment");
});

test("paymentStatusLabel", () => {
  assert.equal(paymentStatusLabel("pending_verification"), "Payment pending verification");
  assert.equal(paymentStatusLabel("pending_paypal"), "Payment awaiting PayPal");
  assert.equal(paymentStatusLabel("verified"), "Verified");
});

test("amountDueLabel uses downpayment for 50%", () => {
  assert.equal(amountDueLabel(sampleDoc), "₱28,000.00");
  assert.equal(amountDueLabel({ ...sampleDoc, settlementType: "full" }), "₱56,000.00");
});

test("nextStepNote for card vs bank", () => {
  assert.match(nextStepNote({ paymentMethod: "card" }), /payment details/i);
  assert.equal(nextStepNote({ paymentMethod: "bank" }), "");
});

test("buildMerchantRecapHtml includes key fields", () => {
  const html = buildMerchantRecapHtml(sampleDoc);
  assert.match(html, /Thank you for registering/);
  assert.match(html, /Matchanese/);
  assert.match(html, /50% downpayment/);
  assert.match(html, /merchant@example\.com/);
  assert.match(html, /₱28,000\.00/);
  assert.doesNotMatch(html, /Payment status/i);
  assert.doesNotMatch(html, /pending verification/i);
});

test("buildMerchantRecapHtml includes e-wallet accounts for remaining balance", () => {
  const html = buildMerchantRecapHtml(sampleDoc);
  assert.match(html, /Remaining balance/);
  assert.match(html, /GCash/);
  assert.match(html, /August 6, 2026/);
  assert.doesNotMatch(html, /notified once confirmed/i);
  assert.doesNotMatch(html, /verify it shortly/i);
});

test("buildMerchantRecapHtml includes bank accounts for remaining balance", () => {
  const html = buildMerchantRecapHtml({ ...sampleDoc, paymentMethod: "bank" });
  assert.match(html, /Remaining balance/);
  assert.match(html, /BDO/);
  assert.match(html, /000251640035/);
});

test("buildMerchantRecapHtml full payment skips account details", () => {
  const html = buildMerchantRecapHtml({ ...sampleDoc, settlementType: "full" });
  assert.doesNotMatch(html, /Remaining balance/);
  assert.doesNotMatch(html, /GCash/);
  assert.doesNotMatch(html, /pending verification/i);
});

test("buildMerchantRecapHtml card mentions separate payment details", () => {
  const html = buildMerchantRecapHtml({ ...sampleDoc, paymentMethod: "card", status: "pending_paypal" });
  assert.match(html, /card payment/i);
  assert.match(html, /payment details separately/i);
});

test("buildCardPaymentDetailsHtml includes accounts, QR, and settlement amounts", () => {
  const {
    buildCardPaymentDetailsHtml,
    buildCardPaymentDetailsSubject,
  } = require("../email-content");
  const html = buildCardPaymentDetailsHtml({
    brandName: "Matchanese",
    settlementType: "downpayment",
    feeSnapshot: { totalDue: 56000, downpaymentAmount: 28000, balanceAmount: 28000 },
    eventSnapshot: { finalPaymentDue: "August 6, 2026" },
  });
  assert.equal(buildCardPaymentDetailsSubject({}), "Manila Matcha Fest 2026 — Payment details");
  assert.match(html, /technical issues with card processing/i);
  assert.match(html, /28,000\.00/);
  assert.match(html, /Remaining balance/);
  assert.match(html, /BDO/);
  assert.match(html, /GCash/);
  assert.match(html, /mmf-info\.web\.app\/images\/qr\/gcash\.png|mmf-merchant\.web\.app\/images\/qr\/gcash\.png/);
  assert.match(html, /reply to this email/i);
});

test("buildCardPaymentDetailsHtml full payment omits balance", () => {
  const { buildCardPaymentDetailsHtml } = require("../email-content");
  const html = buildCardPaymentDetailsHtml({
    settlementType: "full",
    feeSnapshot: { totalDue: 56000, downpaymentAmount: 28000, balanceAmount: 28000 },
  });
  assert.match(html, /Full payment/);
  assert.match(html, /56,000\.00/);
  assert.doesNotMatch(html, /Remaining balance/);
});

test("buildFinalPaymentDetailsHtml is for remaining balance after downpayment", () => {
  const {
    buildFinalPaymentDetailsHtml,
    buildFinalPaymentDetailsSubject,
  } = require("../email-content");
  const html = buildFinalPaymentDetailsHtml({
    brandName: "Matchanese",
    settlementType: "downpayment",
    feeSnapshot: { totalDue: 56000, downpaymentAmount: 28000, balanceAmount: 28000 },
    eventSnapshot: { finalPaymentDue: "August 6, 2026" },
  });
  assert.equal(
    buildFinalPaymentDetailsSubject({}),
    "Manila Matcha Fest 2026 — Final payment (remaining balance)"
  );
  assert.match(html, /Hi Matchanese/);
  assert.doesNotMatch(html, /<h1[^>]*>Final payment<\/h1>/i);
  assert.match(html, /50% downpayment/i);
  assert.match(html, /already on file|already received/i);
  assert.match(html, /remaining balance/i);
  assert.match(html, /28,000\.00/);
  assert.match(html, /August 6, 2026/);
  assert.match(html, /BDO/);
  assert.match(html, /GCash/);
  assert.match(html, /fully paid/i);
  assert.match(html, /Thank you/i);
  assert.doesNotMatch(html, /technical issues with card processing/i);
  assert.doesNotMatch(html, /we have received and verified/i);
});

test("buildAdminNotifyHtml includes admin details and links", () => {
  const html = buildAdminNotifyHtml(sampleDoc);
  assert.match(html, /New merchant registration/);
  assert.match(html, /Matchanese Inc\./);
  assert.match(html, /proof\.jpg/);
  assert.match(html, /abc-123/);
  assert.match(html, /admin/);
});

test("buildRequirementsInviteHtml includes requirements link and brand", () => {
  const {
    buildRequirementsInviteSubject,
    buildRequirementsInviteHtml,
  } = require("../email-content");
  assert.match(buildRequirementsInviteSubject(), /Merchant Requirements/);
  const html = buildRequirementsInviteHtml(sampleDoc);
  assert.match(html, /Hi Matchanese/);
  assert.match(html, /mmf-requirements\.web\.app/);
  assert.match(html, /Open Merchant Requirements/);
  assert.match(html, /logo files/i);
});

test("buildRequirementsMerchantRecapHtml and admin notify", () => {
  const {
    buildRequirementsMerchantRecapSubject,
    buildRequirementsMerchantRecapHtml,
    buildRequirementsAdminNotifySubject,
    buildRequirementsAdminNotifyHtml,
  } = require("../email-content");

  const reqDoc = {
    id: "req-1",
    brandName: "Matchanese",
    registrationId: "abc-123",
    registrationEmail: "merchant@example.com",
    sellingCategories: ["matcha_drinks", "other"],
    sellingOtherText: "Merch",
    equipment: [{ item: "Blender", watts: "500" }],
    ingressEquipmentMaterials: "Tables, coolers",
    crewNames: "Ana, Ben",
    exDealItems: "2 drinks",
    boothNotes: "Corner booth preferred",
    files: {
      logoSquareLight: { url: "https://example.com/logo.png", name: "logo.png" },
      menuPhotos: [{ url: "https://example.com/m1.jpg", name: "m1.jpg" }],
      boothLayout: [{ url: "https://example.com/b1.jpg", name: "b1.jpg" }],
    },
    eventSnapshot: {
      name: "Manila Matcha Fest 2026",
      dates: "August 7–16, 2026",
      venue: "SM Mall of Asia, Main Atrium",
    },
  };

  assert.match(buildRequirementsMerchantRecapSubject(reqDoc), /Requirements received/);
  const merchantHtml = buildRequirementsMerchantRecapHtml(reqDoc);
  assert.match(merchantHtml, /Hi Matchanese/);
  assert.match(merchantHtml, /Requirements received/);
  assert.match(merchantHtml, /Blender \(500W\)/);
  assert.match(merchantHtml, /1 file\(s\)/);

  assert.match(buildRequirementsAdminNotifySubject(reqDoc), /Submitted — Matchanese/);
  const adminHtml = buildRequirementsAdminNotifyHtml(reqDoc);
  assert.match(adminHtml, /New requirements submission/);
  assert.match(adminHtml, /abc-123/);
  assert.match(adminHtml, /merchant@example\.com/);
  assert.match(adminHtml, /Open admin dashboard/);
});

test("sales report notify email for admin", () => {
  const {
    buildSalesReportNotifySubject,
    buildSalesReportNotifyHtml,
  } = require("../email-content");

  const doc = {
    id: "m1_2026-08-12",
    merchantId: "m1",
    brandName: "Matchanese",
    date: "2026-08-12",
    cashSales: 125710,
    _isUpdate: true,
    _previousCashSales: 100000,
  };

  assert.equal(
    buildSalesReportNotifySubject(doc),
    "Daily sales report — Matchanese · Wed, Aug 12, 2026"
  );
  assert.doesNotMatch(buildSalesReportNotifySubject(doc), /₱/);
  const html = buildSalesReportNotifyHtml(doc);
  assert.match(html, /Daily sales report/);
  assert.match(html, /Matchanese/);
  assert.match(html, /₱125,710\.00/);
  assert.match(html, /Previously reported/);
  assert.match(html, /₱100,000\.00/);
  assert.doesNotMatch(html, /Merchant ID|Report ID|m1_2026/);
  assert.match(html, /internal only/);
});

test("merchantHasPendingFinalPayment is only verified downpayment", () => {
  const { merchantHasPendingFinalPayment } = require("../email-content");
  assert.equal(
    merchantHasPendingFinalPayment({
      status: "verified",
      settlementType: "downpayment",
      submissionState: "submitted",
    }),
    true
  );
  assert.equal(
    merchantHasPendingFinalPayment({
      status: "verified",
      settlementType: "full",
      submissionState: "submitted",
    }),
    false
  );
  assert.equal(
    merchantHasPendingFinalPayment({
      status: "pending_verification",
      settlementType: "downpayment",
      submissionState: "submitted",
    }),
    false
  );
  assert.equal(
    merchantHasPendingFinalPayment({
      status: "verified",
      settlementType: "downpayment",
      submissionState: "draft",
    }),
    false
  );
  assert.equal(
    merchantHasPendingFinalPayment({
      status: "verified",
      settlementType: "downpayment",
      archived: true,
    }),
    false
  );
});

test("event wrap-up paid template has no payment reminder", () => {
  const {
    buildEventWrapupSubject,
    buildEventWrapupHtml,
  } = require("../email-content");
  const doc = {
    brandName: "Sample Brand Co",
    status: "verified",
    settlementType: "full",
    submissionState: "submitted",
    feeSnapshot: { totalDue: 56000, downpaymentAmount: 28000, balanceAmount: 28000 },
  };
  assert.equal(
    buildEventWrapupSubject(doc),
    "Thank you for making Manila Matcha Fest 2026 a success"
  );
  const html = buildEventWrapupHtml(doc);
  assert.match(html, /Hi Sample Brand Co team/);
  assert.match(html, /Congratulations on a successful run/);
  assert.match(html, /daily cash sales/i);
  assert.match(html, /as part of SM Mall of Asia/);
  assert.doesNotMatch(html, /requires these reports/i);
  assert.match(html, /mmf-merchant\.web\.app/);
  assert.doesNotMatch(html, /remaining balance/i);
  assert.doesNotMatch(html, /payment confirmation/i);
  assert.doesNotMatch(html, /hi@matchanese\.com/);
  assert.doesNotMatch(html, /Payment balance/);
});

test("event wrap-up unpaid template includes payment confirmation reminder only", () => {
  const {
    buildEventWrapupSubject,
    buildEventWrapupHtml,
  } = require("../email-content");
  const doc = {
    brandName: "Matcha Lab",
    status: "verified",
    settlementType: "downpayment",
    submissionState: "submitted",
    feeSnapshot: { totalDue: 56000, downpaymentAmount: 28000, balanceAmount: 28000 },
  };
  assert.equal(
    buildEventWrapupSubject(doc),
    "Thank you — remaining balance reminder · Manila Matcha Fest 2026"
  );
  const html = buildEventWrapupHtml(doc);
  assert.match(html, /Hi Matcha Lab team/);
  assert.match(html, /Congratulations on a successful run/);
  assert.match(html, /daily cash sales/i);
  assert.match(html, /as part of SM Mall of Asia/);
  assert.match(html, /remaining balance/i);
  assert.match(html, /₱28,000\.00/);
  assert.match(html, /payment confirmation/i);
  assert.match(html, /overlooked/i);
  assert.doesNotMatch(html, /hi@matchanese\.com/);
  const paymentHtml = html.split("Reminder")[1] || "";
  assert.doesNotMatch(paymentHtml, /viber/i);
});
