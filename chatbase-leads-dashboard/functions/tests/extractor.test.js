const test = require("node:test");
const assert = require("node:assert/strict");
const { extractBookingDetails, hasRequiredFields, normalizeStructuredBooking, mergeExtractedWithStructured } = require("../extractor");

test("extractBookingDetails captures mobile bar fields", () => {
  const details = extractBookingDetails([
    { role: "user", content: "I need a mobile matcha bar on 2026-04-20 at BGC High Street for 250 cups." }
  ]);
  assert.equal(details.inquiryType, "mobile_bar");
  assert.equal(details.targetDate, "2026-04-20");
  assert.equal(details.cupsToServe, 250);
  assert.equal(hasRequiredFields(details.inquiryType, details), true);
});

test("extractBookingDetails captures workshop pax", () => {
  const details = extractBookingDetails([
    { role: "user", content: "Can you host a private workshop for 35 pax?" }
  ]);
  assert.equal(details.inquiryType, "workshop");
  assert.equal(details.pax, 35);
  assert.equal(hasRequiredFields(details.inquiryType, details), true);
});

test("normalizeStructuredBooking maps snake_case", () => {
  const n = normalizeStructuredBooking({
    target_date: "2026-05-01",
    target_venue: "BGC",
    cups_to_serve: 100,
    inquiry_type: "mobile_bar"
  });
  assert.equal(n.targetDate, "2026-05-01");
  assert.equal(n.targetVenue, "BGC");
  assert.equal(n.cupsToServe, 100);
  assert.equal(n.inquiryType, "mobile_bar");
});

test("mergeExtractedWithStructured prefers structured fields", () => {
  const base = extractBookingDetails([{ role: "user", content: "hello" }]);
  const merged = mergeExtractedWithStructured(base, { pax: 12, inquiry_type: "workshop" });
  assert.equal(merged.pax, 12);
  assert.equal(merged.inquiryType, "workshop");
});
