const test = require("node:test");
const assert = require("node:assert/strict");
const { typeIdFromLead, normalizeTargetDate } = require("../ops-events");
const { buildGCalBody, eventTitle, isOpsCalendarConfigured } = require("../ops-calendar");

test("typeIdFromLead maps mobile bar and workshops", () => {
  assert.equal(typeIdFromLead({ service: "private_mobile_matcha_bar" }), "mobile_bar");
  assert.equal(typeIdFromLead({ service: "private_matcha_workshop" }), "matcha_workshop");
  assert.equal(
    typeIdFromLead({ service: "private_matcha_workshop", eventType: "Mochi party" }),
    "mochi_workshop"
  );
});

test("normalizeTargetDate accepts ISO dates", () => {
  assert.equal(normalizeTargetDate("2026-09-15"), "2026-09-15");
  assert.equal(normalizeTargetDate(""), "");
});

test("eventTitle prefixes type label", () => {
  assert.equal(
    eventTitle({ typeId: "matcha_popup", title: "Marikina Fest" }),
    "[Matcha Bar Pop-up] Marikina Fest"
  );
});

test("buildGCalBody all-day uses exclusive end", () => {
  const body = buildGCalBody(
    {
      typeId: "mobile_bar",
      title: "Wedding",
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      venue: "Makati"
    },
    "abc123"
  );
  assert.equal(body.start.date, "2026-10-01");
  assert.equal(body.end.date, "2026-10-02");
  assert.match(body.description, /opsEventId: abc123/);
});

test("isOpsCalendarConfigured is false without env", () => {
  const prevKey = process.env.GOOGLE_SA_KEY;
  const prevCal = process.env.GOOGLE_CALENDAR_ID;
  delete process.env.GOOGLE_SA_KEY;
  delete process.env.GOOGLE_CALENDAR_ID;
  assert.equal(isOpsCalendarConfigured(), false);
  if (prevKey != null) process.env.GOOGLE_SA_KEY = prevKey;
  if (prevCal != null) process.env.GOOGLE_CALENDAR_ID = prevCal;
});
