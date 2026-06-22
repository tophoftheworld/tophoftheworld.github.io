const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePaymentPayload,
  buildMessageForUser,
  normalizeOrderNumber,
  deletePaymentIntakes
} = require("../payment-intakes");
const {
  normalizeOrderNumber: shopifyNormalize,
  namesMatch,
  normalizeNameForMatch,
  dedupeRepeatedNameTokens,
  cleanCustomerName,
  resolveIntakeClientName,
  mapOrderNode
} = require("../shopify-admin");

test("normalizeOrderNumber accepts M# and digit variants", () => {
  assert.equal(normalizeOrderNumber("m#2053"), "M#2053");
  assert.equal(normalizeOrderNumber("2053"), "M#2053");
  assert.equal(normalizeOrderNumber("#2053"), "M#2053");
  assert.equal(shopifyNormalize("M2053"), "M#2053");
});

test("parsePaymentPayload requires orderNumber or clientName", () => {
  const empty = parsePaymentPayload({});
  assert.equal(empty.ok, false);
  const withOrder = parsePaymentPayload({ orderNumber: "M#1042" });
  assert.equal(withOrder.ok, true);
  assert.equal(withOrder.data.orderNumber, "M#1042");
  const withName = parsePaymentPayload({ clientName: "Maria Santos" });
  assert.equal(withName.ok, true);
});

test("parsePaymentPayload maps snake_case fields", () => {
  const result = parsePaymentPayload({
    order_number: "2053",
    client_name: "Test User",
    payment_method: "GCash",
    reference_number: "12345"
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.orderNumber, "M#2053");
  assert.equal(result.data.clientName, "Test User");
  assert.equal(result.data.paymentMethod, "GCash");
});

test("buildMessageForUser covers outcomes", () => {
  assert.match(buildMessageForUser({ outcome: "marked_paid", orderName: "M#1" }), /M#1/);
  assert.match(buildMessageForUser({ outcome: "not_found" }), /couldn't find/i);
  assert.match(buildMessageForUser({ outcome: "ambiguous_name" }), /more than one/i);
});

test("namesMatch is case-insensitive with token overlap", () => {
  assert.equal(namesMatch("Maria Santos", "Maria Santos"), true);
  assert.equal(namesMatch("maria", "Maria Santos"), true);
  assert.equal(normalizeNameForMatch("  Maria-Santos "), "maria santos");
});

test("dedupeRepeatedNameTokens removes doubled trailing surname", () => {
  assert.equal(dedupeRepeatedNameTokens("Cristopher David David"), "Cristopher David");
});

test("cleanCustomerName fixes first-name field containing full name plus repeated last", () => {
  assert.equal(
    cleanCustomerName("Cristopher David", "David", "Cristopher David David"),
    "Cristopher David"
  );
});

test("resolveIntakeClientName prefers Shopify when order matched by number", () => {
  const order = { customerName: "Cristopher David" };
  assert.equal(
    resolveIntakeClientName("Cristopher David David", order, "order_number"),
    "Cristopher David"
  );
});

test("deletePaymentIntakes rejects empty ids", async () => {
  const result = await deletePaymentIntakes([]);
  assert.equal(result.ok, false);
  assert.match(result.message, /no payment ids/i);
});

test("mapOrderNode normalizes doubled customer names from Shopify", () => {
  const row = mapOrderNode({
    id: "gid://shopify/Order/1",
    name: "M#2094",
    displayFinancialStatus: "PAID",
    customer: {
      displayName: "Cristopher David David",
      firstName: "Cristopher David",
      lastName: "David"
    },
    billingAddress: { firstName: "Cristopher David", lastName: "David" }
  });
  assert.equal(row.customerName, "Cristopher David");
});
