const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveInvoiceAmount,
  formatAmountValue,
  extractPayerHref,
  isSandboxPayPalHref,
  shouldReplaceCachedInvoice,
  buildInvoiceRequest,
} = require("../paypal");

test("resolveInvoiceAmount uses partial payment for 50% downpayment", () => {
  const result = resolveInvoiceAmount({
    settlementType: "downpayment",
    feeSnapshot: { downpaymentAmount: 28000, totalDue: 56000 },
  });
  assert.equal(result.purpose, "downpayment");
  assert.equal(result.amount, 28);
  assert.equal(result.lineItemTotal, 56000);
  assert.equal(result.minimumAmountDue, 28);
  assert.equal(result.allowPartialPayment, true);
  assert.equal(result.currency, "PHP");
  assert.match(result.note, /50% downpayment/i);
});

test("resolveInvoiceAmount uses total for full payment", () => {
  const result = resolveInvoiceAmount({
    settlementType: "full",
    feeSnapshot: { downpaymentAmount: 28000, totalDue: 56000 },
  });
  assert.equal(result.purpose, "full");
  assert.equal(result.amount, 56000);
  assert.equal(result.lineItemTotal, 56000);
  assert.equal(result.minimumAmountDue, null);
  assert.equal(result.allowPartialPayment, false);
  assert.match(result.note, /full participation/i);
});

test("buildInvoiceRequest adds partial payment and omits invoicer (PayPal profile branding)", () => {
  const { body } = buildInvoiceRequest({
    email: "merchant@example.com",
    brandName: "Matchanese",
    note: "MMF 2026",
    itemName: "Participation fee",
    lineItemTotal: 56000,
    minimumAmountDue: 28000,
    allowPartialPayment: true,
    invoiceNumber: "MMF-TEST",
  });
  assert.equal(body.invoicer, undefined);
  assert.equal(body.items[0].unit_amount.value, "56000.00");
  assert.equal(body.configuration.partial_payment.minimum_amount_due.value, "28000.00");
  assert.equal(body.configuration.partial_payment.allow_partial_payment, true);
});

test("shouldReplaceCachedInvoice replaces old flat downpayment invoices", () => {
  const resolved = resolveInvoiceAmount({
    settlementType: "downpayment",
    feeSnapshot: { downpaymentAmount: 28000, totalDue: 56000 },
  });
  assert.equal(
    shouldReplaceCachedInvoice(
      {
        href: "https://www.paypal.com/invoice/p/#INV",
        id: "INV",
        amount: 28000,
      },
      resolved
    ),
    true
  );
  assert.equal(
    shouldReplaceCachedInvoice(
      {
        href: "https://www.paypal.com/invoice/p/#INV",
        id: "INV",
        amount: 28000,
        invoiceTotal: 56000,
        allowPartialPayment: true,
      },
      resolved
    ),
    false
  );
});

test("formatAmountValue formats two decimals", () => {
  assert.equal(formatAmountValue(28000), "28000.00");
  assert.equal(formatAmountValue("1500.5"), "1500.50");
});

test("formatAmountValue rejects invalid amounts", () => {
  assert.throws(() => formatAmountValue(0), /Invalid invoice amount/);
  assert.throws(() => formatAmountValue(-1), /Invalid invoice amount/);
});

test("extractPayerHref prefers payer-view link", () => {
  const href = extractPayerHref({
    links: [
      { rel: "self", href: "https://api.paypal.com/v2/invoicing/invoices/INV" },
      { rel: "payer-view", href: "https://www.paypal.com/invoice/p/#INV" },
    ],
  });
  assert.equal(href, "https://www.paypal.com/invoice/p/#INV");
});

test("isSandboxPayPalHref detects sandbox payer links", () => {
  assert.equal(
    isSandboxPayPalHref("https://www.sandbox.paypal.com/invoice/p/#INV2-ABC"),
    true
  );
  assert.equal(isSandboxPayPalHref("https://www.paypal.com/invoice/p/#INV2-ABC"), false);
  assert.equal(isSandboxPayPalHref(""), false);
});
