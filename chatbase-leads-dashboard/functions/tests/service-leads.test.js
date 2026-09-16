const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeService,
  normalizeTargetDateStorage,
  normalizeQuoteReference,
  generateQuoteReference,
  buildMessageForUser,
  computeLeadStatus,
  computeProfileStatus,
  normalizePipelineStatus,
  migrateLeadRow,
  resolvePipelineStatus,
  hasAnyQuoteDetail,
  mergeLeadPatch,
  diffLeadChanges,
  recordLeadEdit,
  parseManualLeadPatch,
  parseManualLeadCreate,
  QUOTE_REF_PATTERN,
  QUOTE_REF_LEGACY_PATTERN,
  parseLeadPayload,
  deleteServiceLeads,
  SERVICE_MOBILE_BAR,
  SERVICE_WORKSHOP
} = require("../service-leads");

test("normalizeService maps mobile bar variants", () => {
  assert.equal(normalizeService("Private Mobile Matcha Bar"), SERVICE_MOBILE_BAR);
  assert.equal(normalizeService("mobile matcha bar catering"), SERVICE_MOBILE_BAR);
  assert.equal(normalizeService("private_mobile_matcha_bar"), SERVICE_MOBILE_BAR);
});

test("normalizeService maps workshop variants", () => {
  assert.equal(normalizeService("Private Matcha Workshop"), SERVICE_WORKSHOP);
  assert.equal(normalizeService("workshop at office"), SERVICE_WORKSHOP);
});

test("normalizeService returns null for unknown", () => {
  assert.equal(normalizeService("general inquiry"), null);
});

test("generateQuoteReference is 5 uppercase alphanumeric chars", () => {
  const ref = generateQuoteReference();
  assert.match(ref, QUOTE_REF_PATTERN);
  assert.equal(ref.length, 5);
});

test("normalizeQuoteReference accepts legacy MQ codes", () => {
  assert.equal(normalizeQuoteReference(" mq-260602-a3f1 "), "MQ-260602-A3F1");
  assert.equal(normalizeQuoteReference(" k7m2p "), "K7M2P");
});

test("normalizeQuoteReference rejects invalid codes", () => {
  assert.equal(normalizeQuoteReference("INVALID!"), null);
});

test("buildMessageForUser never includes quote reference", () => {
  const created = buildMessageForUser({
    created: true,
    quoteReference: "K7M2P",
    profileStatus: "draft"
  });
  assert.doesNotMatch(created, /K7M2P/);
  assert.doesNotMatch(created, /quote reference/i);
  assert.match(created, /noted what you've shared/i);

  const updated = buildMessageForUser({
    created: false,
    quoteReference: "K7M2P",
    profileStatus: "complete"
  });
  assert.doesNotMatch(updated, /K7M2P/);
  assert.doesNotMatch(updated, /quote reference/i);
});

test("parseLeadPayload accepts partial body with name only", () => {
  const result = parseLeadPayload({ clientName: "Jane" });
  assert.equal(result.ok, true);
  assert.equal(result.data.clientName, "Jane");
  assert.equal(result.data.service, undefined);
});

test("parseLeadPayload accepts quotedPrice only", () => {
  const result = parseLeadPayload({ quotedPrice: "PHP 45000" });
  assert.equal(result.ok, true);
  assert.equal(result.data.quotedPrice, "PHP 45000");
});

test("parseLeadPayload rejects empty new quote", () => {
  const result = parseLeadPayload({});
  assert.equal(result.ok, false);
  assert.match(result.message, /at least one quote detail/i);
});

test("parseLeadPayload allows update request with only quoteReference", () => {
  const result = parseLeadPayload({ quoteReference: "K7M2P" });
  assert.equal(result.ok, true);
  assert.equal(result.quoteReference, "K7M2P");
  assert.equal(Object.keys(result.data).length, 1);
});

test("parseLeadPayload accepts quoteReference alias", () => {
  const result = parseLeadPayload({
    quote_reference: "mq-260602-b1c2",
    clientName: "Jane"
  });
  assert.equal(result.ok, true);
  assert.equal(result.quoteReference, "MQ-260602-B1C2");
});

test("normalizeTargetDateStorage stores ISO date", () => {
  assert.equal(normalizeTargetDateStorage("2026-06-15"), "2026-06-15");
  assert.equal(normalizeTargetDateStorage("Sat Sep 26 2026 00:00:00 GMT+0000"), "2026-09-26");
});

test("parseLeadPayload accepts optional conversationId", () => {
  const result = parseLeadPayload({
    conversationId: "conv-abc-123",
    clientName: "Jane",
    service: "Private Matcha Workshop",
    targetDate: "2026-06-01",
    targetPax: "10",
    targetVenue: "Home",
    eventType: "Birthday"
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.conversationId, "conv-abc-123");
});

test("parseLeadPayload accepts full valid body", () => {
  const result = parseLeadPayload({
    clientName: "Jane Doe",
    service: "Private Matcha Workshop",
    targetDate: "2026-06-15",
    targetPax: "40",
    targetVenue: "BGC office",
    eventType: "Corporate",
    quotedPrice: "₱45,000"
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.clientName, "Jane Doe");
  assert.equal(result.data.service, SERVICE_WORKSHOP);
  assert.equal(result.data.quotedPrice, "₱45,000");
});

test("computeLeadStatus draft when fields missing", () => {
  assert.equal(computeLeadStatus({ clientName: "Jane" }), "draft");
  assert.equal(
    computeLeadStatus({
      clientName: "Jane",
      service: SERVICE_WORKSHOP,
      targetDate: "2026-06-01",
      targetPax: "10",
      targetVenue: "Home",
      eventType: "Birthday"
    }),
    "complete"
  );
});

test("mergeLeadPatch keeps previous fields when incoming partial", () => {
  const merged = mergeLeadPatch(
    { clientName: "Jane", targetVenue: "MOA", targetPax: "100" },
    { targetPax: "150" }
  );
  assert.equal(merged.clientName, "Jane");
  assert.equal(merged.targetVenue, "MOA");
  assert.equal(merged.targetPax, "150");
});

test("hasAnyQuoteDetail detects any field", () => {
  assert.equal(hasAnyQuoteDetail({}), false);
  assert.equal(hasAnyQuoteDetail({ quotedPrice: "100" }), true);
});

test("parseLeadPayload accepts snake_case aliases", () => {
  const result = parseLeadPayload({
    client_name: "ACME Corp",
    service_type: "Private Mobile Matcha Bar",
    target_date: "June 20, 2026",
    target_pax: "150",
    target_venue: "SM MOA",
    event_type: "Wedding"
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.service, SERVICE_MOBILE_BAR);
  assert.equal(result.data.eventType, "Wedding");
});

test("deleteServiceLeads rejects empty ids", async () => {
  const result = await deleteServiceLeads([]);
  assert.equal(result.ok, false);
  assert.match(result.message, /No lead ids/i);
});

test("parseLeadPayload rejects invalid service when provided", () => {
  const result = parseLeadPayload({
    clientName: "Jane",
    service: "Birthday party"
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /service must be/i);
});

test("normalizePipelineStatus accepts valid stages", () => {
  assert.equal(normalizePipelineStatus("quoted"), "quoted");
  assert.equal(normalizePipelineStatus(" Invoiced "), "invoiced");
  assert.equal(normalizePipelineStatus("invalid"), null);
});

test("parseLeadPayload accepts pipelineStatus and notes", () => {
  const result = parseLeadPayload({
    clientName: "Jane",
    pipelineStatus: "quoted",
    notes: "50-100 cups range"
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.pipelineStatus, "quoted");
  assert.equal(result.data.notes, "50-100 cups range");
});

test("migrateLeadRow maps legacy status to profileStatus", () => {
  const row = migrateLeadRow({ status: "draft", clientName: "Jane" });
  assert.equal(row.profileStatus, "draft");
  assert.equal(row.pipelineStatus, "inquiry");
});

test("resolvePipelineStatus promotes inquiry to quoted when quotedPrice set", () => {
  assert.equal(
    resolvePipelineStatus({ pipelineStatus: "inquiry", quotedPrice: "PHP 45000" }),
    "quoted"
  );
  assert.equal(
    migrateLeadRow({ pipelineStatus: "inquiry", quotedPrice: "₱45,000" }).pipelineStatus,
    "quoted"
  );
});

test("resolvePipelineStatus does not downgrade invoiced or later", () => {
  assert.equal(
    resolvePipelineStatus({ pipelineStatus: "invoiced", quotedPrice: "PHP 45000" }),
    "invoiced"
  );
  assert.equal(
    resolvePipelineStatus({ pipelineStatus: "completed", quotedPrice: "PHP 45000" }),
    "completed"
  );
});

test("computeProfileStatus matches computeLeadStatus", () => {
  assert.equal(computeProfileStatus({ clientName: "Jane" }), "draft");
  assert.equal(computeLeadStatus({ clientName: "Jane" }), "draft");
});

test("diffLeadChanges detects field updates", () => {
  const changes = diffLeadChanges(
    { clientName: "Jane", targetPax: "50" },
    { clientName: "Janet", targetPax: "50", quotedPrice: "₱40,000" }
  );
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { field: "clientName", from: "Jane", to: "Janet" });
  assert.deepEqual(changes[1], { field: "quotedPrice", from: null, to: "₱40,000" });
});

test("recordLeadEdit appends manual or automation entries", () => {
  const history = recordLeadEdit(
    { clientName: "A", editHistory: [] },
    { clientName: "B" },
    "manual"
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].source, "manual");
  assert.equal(history[0].changes[0].field, "clientName");

  const auto = recordLeadEdit({ notes: "old" }, { notes: "new" }, "automation");
  assert.equal(auto[0].source, "automation");
});

test("parseManualLeadPatch accepts all editable fields", () => {
  const result = parseManualLeadPatch({
    clientName: "ACME",
    service: SERVICE_WORKSHOP,
    eventType: "Birthday",
    targetDate: "2026-08-01",
    targetPax: "30",
    targetVenue: "Home",
    quotedPrice: "₱25,000",
    pipelineStatus: "quoted",
    notes: "VIP"
  });
  assert.equal(result.ok, true);
  assert.equal(result.updates.clientName, "ACME");
  assert.equal(result.updates.service, SERVICE_WORKSHOP);
  assert.equal(result.updates.pipelineStatus, "quoted");
});

test("parseManualLeadPatch rejects invalid service", () => {
  const result = parseManualLeadPatch({ service: "Birthday party" });
  assert.equal(result.ok, false);
});

test("parseManualLeadCreate requires clientName", () => {
  const missing = parseManualLeadCreate({});
  assert.equal(missing.ok, false);
  assert.match(missing.message, /clientName/i);

  const empty = parseManualLeadCreate({ clientName: "   " });
  assert.equal(empty.ok, false);
});

test("parseManualLeadCreate accepts minimal body with defaults", () => {
  const result = parseManualLeadCreate({ clientName: "Jane Doe" });
  assert.equal(result.ok, true);
  assert.equal(result.data.clientName, "Jane Doe");
  assert.equal(result.data.pipelineStatus, "inquiry");
});

test("parseManualLeadCreate accepts full body", () => {
  const result = parseManualLeadCreate({
    clientName: "ACME Corp",
    service: SERVICE_WORKSHOP,
    eventType: "Birthday",
    targetDate: "2026-08-01",
    targetPax: "30",
    targetVenue: "Home",
    quotedPrice: "₱25,000",
    pipelineStatus: "quoted",
    notes: "VIP"
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.service, SERVICE_WORKSHOP);
  assert.equal(result.data.pipelineStatus, "quoted");
  assert.equal(result.data.notes, "VIP");
});

test("parseManualLeadCreate rejects invalid service", () => {
  const result = parseManualLeadCreate({
    clientName: "Jane",
    service: "Birthday party"
  });
  assert.equal(result.ok, false);
});
