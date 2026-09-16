const test = require("node:test");
const assert = require("node:assert/strict");
const {
  plainInvoiceMessageToHtml,
  wrapInvoiceEmailHtml,
  EMAIL_RE
} = require("../invoice-email");

test("EMAIL_RE validates addresses", () => {
  assert.equal(EMAIL_RE.test("client@email.com"), true);
  assert.equal(EMAIL_RE.test("not-an-email"), false);
});

test("plainInvoiceMessageToHtml links labeled text without showing raw URL", () => {
  const url = "https://matchanese-invoice.web.app/i/abc12345tokenxx";
  const html = plainInvoiceMessageToHtml(
    ["Hi Kyle,", "", "View your invoice", "", "Matchanese Team"].join("\n"),
    url
  );
  assert.match(
    html,
    /<a href="https:\/\/matchanese-invoice\.web\.app\/i\/abc12345tokenxx"[^>]*>View your invoice<\/a>/
  );
  assert.doesNotMatch(html, /https:\/\/matchanese-invoice\.web\.app\/i\/abc12345tokenxx(?!")/);
  assert.match(html, /Hi Kyle,<br>/);
  assert.match(wrapInvoiceEmailHtml(html), /font-family:Arial/);
});

test("plainInvoiceMessageToHtml strips pasted raw URL beside label", () => {
  const url = "https://matchanese-invoice.web.app/i/abc12345tokenxx";
  const html = plainInvoiceMessageToHtml(
    ["View your invoice", url].join("\n"),
    url
  );
  assert.match(html, /View your invoice<\/a>/);
  assert.equal((html.match(/View your invoice/g) || []).length, 1);
  assert.doesNotMatch(html, />https:\/\/matchanese-invoice/);
});
