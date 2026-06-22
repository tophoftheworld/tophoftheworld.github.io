const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSearchWindows,
  orderNumberSearchTerms,
  quoteReferenceSearchTerms,
  MAX_SPAN_DAYS,
} = require("../conversation-link");

test("orderNumberSearchTerms includes common variants", () => {
  const terms = orderNumberSearchTerms("m#2094");
  assert.ok(terms.includes("M#2094"));
  assert.ok(terms.includes("2094"));
});

test("quoteReferenceSearchTerms includes reference phrasing", () => {
  const terms = quoteReferenceSearchTerms("k7m2p");
  assert.ok(terms.includes("K7M2P"));
  assert.ok(terms.some((t) => t.toLowerCase().includes("reference k7m2p")));
});

test("buildSearchWindows centers on loggedAt", () => {
  const windows = buildSearchWindows({ loggedAt: "2026-06-08T12:00:00.000Z" });
  assert.ok(windows.length >= 1);
  assert.equal(windows[0].phase, "nearEvent");
  assert.ok(windows[0].endDate >= "2026-06-08");
  assert.ok(windows[0].startDate <= "2026-06-08");
});

test("buildSearchWindows spans from lead anchor to loggedAt", () => {
  const windows = buildSearchWindows({
    loggedAt: "2026-06-08T12:00:00.000Z",
    anchorDate: "2026-03-01T10:00:00.000Z",
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[1].phase, "sinceAnchor");
  assert.ok(windows[1].startDate <= "2026-03-01");
  assert.ok(windows[1].endDate >= "2026-06-08");
});

test("buildSearchWindows caps lookback at MAX_SPAN_DAYS", () => {
  const windows = buildSearchWindows({
    loggedAt: "2026-06-08T12:00:00.000Z",
    anchorDate: "2020-01-01T00:00:00.000Z",
  });
  const wide = windows.find((w) => w.phase === "sinceAnchor");
  assert.ok(wide);
  const start = new Date(`${wide.startDate}T00:00:00.000Z`);
  const event = new Date("2026-06-08T12:00:00.000Z");
  const diffDays = (event - start) / (86400000);
  assert.ok(diffDays <= MAX_SPAN_DAYS + 5);
});
