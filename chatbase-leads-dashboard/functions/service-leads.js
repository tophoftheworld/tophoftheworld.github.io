const crypto = require("crypto");
const admin = require("firebase-admin");

const COLLECTION = "serviceLeads";

const SERVICE_MOBILE_BAR = "private_mobile_matcha_bar";
const SERVICE_WORKSHOP = "private_matcha_workshop";

const SERVICE_LABELS = {
  [SERVICE_MOBILE_BAR]: "Private Mobile Matcha Bar",
  [SERVICE_WORKSHOP]: "Private Matcha Workshop"
};

const QUOTE_REF_SHORT_PATTERN = /^[A-Z0-9]{5}$/;
const QUOTE_REF_LEGACY_PATTERN = /^MQ-\d{6}-[A-Z0-9]{4}$/;
const QUOTE_REF_PATTERN = QUOTE_REF_SHORT_PATTERN;

const QUOTE_REF_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const COMPLETENESS_FIELDS = [
  "clientName",
  "service",
  "targetDate",
  "targetPax",
  "targetVenue",
  "eventType"
];

const PIPELINE_STATUSES = ["inquiry", "quoted", "invoiced", "deposit", "completed"];
const DEFAULT_PIPELINE_STATUS = "inquiry";

const PIPELINE_RANK = {
  inquiry: 0,
  quoted: 1,
  invoiced: 2,
  deposit: 3,
  completed: 4
};

const EDIT_HISTORY_MAX = 100;

const TRACKED_EDIT_FIELDS = [
  "clientName",
  "service",
  "targetDate",
  "targetPax",
  "targetVenue",
  "eventType",
  "quotedPrice",
  "pipelineStatus",
  "notes"
];

const EDIT_FIELD_LABELS = {
  clientName: "Client name",
  service: "Service",
  targetDate: "Target date",
  targetPax: "Pax / cups",
  targetVenue: "Venue",
  eventType: "Event type",
  quotedPrice: "Quoted price",
  pipelineStatus: "Status",
  notes: "Notes"
};

function fieldSnapshotValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function diffLeadChanges(prev, next, fields = TRACKED_EDIT_FIELDS) {
  const changes = [];
  for (const field of fields) {
    const from = fieldSnapshotValue(prev[field]);
    const to = fieldSnapshotValue(next[field]);
    if (from !== to) {
      changes.push({ field, from, to });
    }
  }
  return changes;
}

function appendEditHistory(prevHistory, entry) {
  const history = Array.isArray(prevHistory) ? [...prevHistory] : [];
  history.push(entry);
  if (history.length > EDIT_HISTORY_MAX) {
    return history.slice(history.length - EDIT_HISTORY_MAX);
  }
  return history;
}

function recordLeadEdit(prev, next, source) {
  const changes = diffLeadChanges(prev, next);
  if (!changes.length) return prev.editHistory || [];
  return appendEditHistory(prev.editHistory, {
    at: new Date().toISOString(),
    source,
    changes
  });
}

function hasQuotedPrice(record) {
  return Boolean(record?.quotedPrice && String(record.quotedPrice).trim());
}

/** Promote inquiry → quoted when a price exists; never downgrade later stages. */
function resolvePipelineStatus(record) {
  const stored = record.pipelineStatus || DEFAULT_PIPELINE_STATUS;
  const rank = PIPELINE_RANK[stored] ?? 0;
  if (rank >= PIPELINE_RANK.quoted) return stored;
  if (hasQuotedPrice(record)) return "quoted";
  return stored;
}

function generateQuoteReference() {
  let code = "";
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) {
    code += QUOTE_REF_CHARSET[bytes[i] % QUOTE_REF_CHARSET.length];
  }
  return code;
}

async function generateUniqueQuoteReference(db) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateQuoteReference();
    const snap = await db
      .collection(COLLECTION)
      .where("quoteReference", "==", code)
      .limit(1)
      .get();
    if (snap.empty) return code;
  }
  throw new Error("Could not allocate unique quote reference");
}

function normalizeQuoteReference(raw) {
  if (!raw) return null;
  const text = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!text) return null;
  if (QUOTE_REF_SHORT_PATTERN.test(text) || QUOTE_REF_LEGACY_PATTERN.test(text)) {
    return text;
  }
  return null;
}

function buildMessageForUser({ created, profileStatus }) {
  if (created) {
    if (profileStatus === "draft") {
      return `Thanks! We've noted what you've shared so far—share more details anytime and we'll update your quote.`;
    }
    return `Thanks! Our team will follow up soon.`;
  }
  return `Thanks! We've updated your quote with the latest details. Our team will follow up soon.`;
}

function normalizePipelineStatus(raw) {
  if (!raw) return null;
  const text = String(raw).trim().toLowerCase().replace(/\s+/g, "_");
  if (PIPELINE_STATUSES.includes(text)) return text;
  return null;
}

function computeProfileStatus(record) {
  for (const field of COMPLETENESS_FIELDS) {
    const val = record[field];
    if (val === undefined || val === null || String(val).trim() === "") {
      return "draft";
    }
  }
  return "complete";
}

function computeLeadStatus(record) {
  return computeProfileStatus(record);
}

function migrateLeadRow(row) {
  const out = { ...row };
  if (!out.profileStatus) {
    if (out.status === "draft" || out.status === "complete") {
      out.profileStatus = out.status;
    } else {
      out.profileStatus = computeProfileStatus(out);
    }
  }
  if (!out.pipelineStatus) {
    out.pipelineStatus = DEFAULT_PIPELINE_STATUS;
  }
  if (out.pipelineStatus && !PIPELINE_STATUSES.includes(out.pipelineStatus)) {
    out.pipelineStatus = DEFAULT_PIPELINE_STATUS;
  }
  out.pipelineStatus = resolvePipelineStatus(out);
  if (!out.updatedAt && out.createdAt) {
    out.updatedAt = out.createdAt;
  }
  return out;
}

function serializeLeadRow(id, data) {
  const row = migrateLeadRow({
    id,
    ...data,
    quoteReference: data.quoteReference || null,
    targetDate: normalizeTargetDateStorage(data.targetDate) || data.targetDate
  });
  row.profileStatus = computeProfileStatus(row);
  return row;
}

function getDb() {
  if (!admin.apps.length) {
    const projectId =
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      "matchanese-attendance";
    admin.initializeApp({ projectId });
  }
  return admin.firestore();
}

function pickString(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

function normalizeTargetDateStorage(raw) {
  if (!raw) return raw;
  const str = String(raw).trim();
  const isoOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (isoOnly) return str;
  const date = new Date(str);
  if (!Number.isNaN(date.getTime())) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return str;
}

function leadActivityAt(row) {
  return row.updatedAt || row.createdAt || "";
}

function normalizeService(raw) {
  if (!raw) return null;
  const text = String(raw).trim().toLowerCase();
  if (
    text.includes("workshop") ||
    text === "private_matcha_workshop" ||
    text === "matcha workshop"
  ) {
    return SERVICE_WORKSHOP;
  }
  if (
    text.includes("mobile") ||
    text.includes("bar") ||
    text.includes("catering") ||
    text === "private_mobile_matcha_bar" ||
    text.includes("matcha bar")
  ) {
    return SERVICE_MOBILE_BAR;
  }
  if (text === SERVICE_WORKSHOP || text === SERVICE_MOBILE_BAR) {
    return text;
  }
  return null;
}

function hasAnyQuoteDetail(fields) {
  return Boolean(
    fields.clientName ||
      fields.service ||
      fields.targetDate ||
      fields.targetPax ||
      fields.targetVenue ||
      fields.eventType ||
      fields.quotedPrice
  );
}

function mergeLeadPatch(prev, incoming) {
  const out = { ...prev };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue;
    if (key === "source") {
      if (String(value).trim()) out.source = String(value).trim();
      continue;
    }
    if (String(value).trim() !== "") {
      out[key] = value;
    }
  }
  return out;
}

function parseLeadPayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object" };
  }

  const clientName = pickString(body, ["clientName", "client_name", "name"]);
  const serviceRaw = pickString(body, ["service", "serviceType", "service_type"]);
  const targetDate = pickString(body, ["targetDate", "target_date", "eventDate", "event_date"]);
  const targetPax = pickString(body, ["targetPax", "target_pax", "pax", "headcount", "cups"]);
  const targetVenue = pickString(body, ["targetVenue", "target_venue", "venue"]);
  const eventType = pickString(body, ["eventType", "event_type", "eventCategory", "event_category"]);
  const quotedPrice = pickString(body, [
    "quotedPrice",
    "quoted_price",
    "price",
    "quoteAmount",
    "quote_amount"
  ]);
  const conversationId = pickString(body, [
    "conversationId",
    "conversation_id",
    "chatId",
    "chat_id"
  ]);
  const leadId = pickString(body, ["leadId", "lead_id"]);
  const quoteReference = normalizeQuoteReference(
    pickString(body, [
      "quoteReference",
      "quote_reference",
      "referenceCode",
      "reference_code",
      "bookingReference",
      "booking_reference"
    ])
  );
  const pipelineStatus = normalizePipelineStatus(
    pickString(body, ["pipelineStatus", "pipeline_status", "leadStatus", "lead_status"])
  );
  const notes = pickString(body, ["notes", "note", "internalNotes", "internal_notes"]);

  if (serviceRaw) {
    const service = normalizeService(serviceRaw);
    if (!service) {
      return {
        ok: false,
        message:
          'service must be "Private Mobile Matcha Bar" or "Private Matcha Workshop"'
      };
    }
  }

  const data = { source: "chatbase_action" };
  if (clientName) data.clientName = clientName;
  if (serviceRaw) data.service = normalizeService(serviceRaw);
  if (targetDate) data.targetDate = normalizeTargetDateStorage(targetDate);
  if (targetPax) data.targetPax = targetPax;
  if (targetVenue) data.targetVenue = targetVenue;
  if (eventType) data.eventType = eventType;
  if (quotedPrice) data.quotedPrice = quotedPrice;
  if (conversationId) data.conversationId = conversationId;
  if (pipelineStatus) data.pipelineStatus = pipelineStatus;
  if (notes) data.notes = notes;

  const isUpdateRequest = Boolean(quoteReference || leadId);

  if (!isUpdateRequest && !hasAnyQuoteDetail(data)) {
    return {
      ok: false,
      message:
        "Provide at least one quote detail (name, service, date, pax, venue, event type, or quoted price), or quoteReference to update an existing quote."
    };
  }

  return { ok: true, data, leadId, quoteReference, conversationId };
}

function verifyActionSecret(req) {
  const expected = process.env.CHATBASE_ACTION_SECRET;
  if (!expected) {
    return { ok: false, status: 500, message: "Missing CHATBASE_ACTION_SECRET env" };
  }
  const provided = req.headers["x-chatbase-action-secret"];
  if (provided !== expected) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}

async function findLeadDocRef(db, { quoteReference, leadId, conversationId }) {
  if (quoteReference) {
    const snap = await db
      .collection(COLLECTION)
      .where("quoteReference", "==", quoteReference)
      .limit(1)
      .get();
    if (!snap.empty) return { ref: snap.docs[0].ref, via: "quoteReference" };
    return { ref: null, via: "quoteReference", notFound: true };
  }

  if (leadId) {
    const docRef = db.collection(COLLECTION).doc(leadId);
    const doc = await docRef.get();
    if (doc.exists) return { ref: docRef, via: "leadId" };
    return { ref: null, via: "leadId", notFound: true };
  }

  if (conversationId) {
    const snap = await db
      .collection(COLLECTION)
      .where("conversationId", "==", conversationId)
      .get();
    if (snap.size === 1) return { ref: snap.docs[0].ref, via: "conversationId" };
    if (snap.size > 1) {
      return { ref: null, via: "conversationId", ambiguous: true, count: snap.size };
    }
  }

  return { ref: null, via: null };
}

async function upsertServiceLead(payload) {
  const db = getDb();
  const now = new Date().toISOString();
  const { conversationId, leadId, quoteReference: quoteRefInput, ...incoming } = payload;

  const lookup = await findLeadDocRef(db, {
    quoteReference: quoteRefInput,
    leadId,
    conversationId
  });

  if (lookup.notFound) {
    const canStartNewQuote =
      lookup.via === "quoteReference" && hasAnyQuoteDetail(incoming);
    if (!canStartNewQuote) {
      const label = lookup.via === "leadId" ? "Lead id" : "Quote reference";
      return {
        ok: false,
        status: 404,
        message: `${label} not found. Omit quoteReference to start a new quote.`
      };
    }
  }

  if (lookup.ambiguous) {
    return {
      ok: false,
      status: 409,
      message: `This chat has ${lookup.count} quote requests. Pass quoteReference (e.g. K7M2P) to update one, or omit it only when starting a brand-new quote.`
    };
  }

  if (lookup.ref) {
    const existing = await lookup.ref.get();
    const prev = existing.data() || {};
    let quoteReference = prev.quoteReference || quoteRefInput;
    if (!quoteReference) {
      quoteReference = await generateUniqueQuoteReference(db);
    }
    const merged = mergeLeadPatch(prev, incoming);
    merged.quoteReference = quoteReference;
    if (conversationId) merged.conversationId = conversationId;
    else if (prev.conversationId) merged.conversationId = prev.conversationId;
    if (incoming.conversationLinkVia) merged.conversationLinkVia = incoming.conversationLinkVia;
    merged.updatedAt = now;
    merged.createdAt = prev.createdAt || now;
    merged.updateCount = (prev.updateCount || 1) + 1;
    merged.source = prev.source || incoming.source || "chatbase_action";
    if (incoming.pipelineStatus) {
      merged.pipelineStatus = incoming.pipelineStatus;
    } else if (!merged.pipelineStatus) {
      merged.pipelineStatus = DEFAULT_PIPELINE_STATUS;
    }
    if (incoming.notes !== undefined && incoming.notes !== null && String(incoming.notes).trim()) {
      merged.notes = String(incoming.notes).trim();
    }
    merged.profileStatus = computeProfileStatus(merged);
    merged.pipelineStatus = resolvePipelineStatus(merged);
    merged.editHistory = recordLeadEdit(prev, merged, "automation");

    await lookup.ref.set(merged, { merge: true });
    const serialized = serializeLeadRow(lookup.ref.id, merged);
    return {
      ok: true,
      id: lookup.ref.id,
      created: false,
      ...serialized,
      messageForUser: buildMessageForUser({
        created: false,
        quoteReference,
        profileStatus: serialized.profileStatus
      })
    };
  }

  if (!hasAnyQuoteDetail(incoming)) {
    return {
      ok: false,
      status: 400,
      message:
        "Provide at least one quote detail (name, service, date, pax, venue, event type, or quoted price)."
    };
  }

  const quoteReference = await generateUniqueQuoteReference(db);
  const record = {
    ...incoming,
    quoteReference,
    ...(conversationId ? { conversationId } : {}),
    ...(incoming.conversationLinkVia ? { conversationLinkVia: incoming.conversationLinkVia } : {}),
    createdAt: now,
    updatedAt: now,
    updateCount: 1,
    source: incoming.source || "chatbase_action",
    pipelineStatus: incoming.pipelineStatus || DEFAULT_PIPELINE_STATUS
  };
  record.profileStatus = computeProfileStatus(record);
  record.pipelineStatus = resolvePipelineStatus(record);
  record.editHistory = recordLeadEdit({}, record, "automation");

  const docRef = await db.collection(COLLECTION).add(record);
  const serialized = serializeLeadRow(docRef.id, record);
  return {
    ok: true,
    id: docRef.id,
    created: true,
    ...serialized,
    messageForUser: buildMessageForUser({
      created: true,
      quoteReference,
      profileStatus: serialized.profileStatus
    })
  };
}

function parseManualLeadPatch(patch) {
  if (!patch || typeof patch !== "object") {
    return { ok: false, status: 400, message: "Patch must be a JSON object" };
  }

  const updates = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);

  if (has("clientName")) updates.clientName = String(patch.clientName || "").trim();
  if (has("eventType")) updates.eventType = String(patch.eventType || "").trim();
  if (has("targetPax")) updates.targetPax = String(patch.targetPax || "").trim();
  if (has("targetVenue")) updates.targetVenue = String(patch.targetVenue || "").trim();
  if (has("quotedPrice")) updates.quotedPrice = String(patch.quotedPrice || "").trim();
  if (has("notes")) updates.notes = String(patch.notes || "").trim();

  if (has("targetDate")) {
    const raw = String(patch.targetDate || "").trim();
    updates.targetDate = raw ? normalizeTargetDateStorage(raw) || raw : "";
  }

  if (has("service")) {
    const raw = String(patch.service || "").trim();
    if (!raw) {
      updates.service = "";
    } else {
      const service = normalizeService(raw);
      if (!service) {
        return {
          ok: false,
          status: 400,
          message: 'service must be "Private Mobile Matcha Bar" or "Private Matcha Workshop"'
        };
      }
      updates.service = service;
    }
  }

  if (has("pipelineStatus")) {
    const normalized = normalizePipelineStatus(patch.pipelineStatus);
    if (!normalized) {
      return {
        ok: false,
        status: 400,
        message: `pipelineStatus must be one of: ${PIPELINE_STATUSES.join(", ")}`
      };
    }
    updates.pipelineStatus = normalized;
  }

  if (!Object.keys(updates).length) {
    return { ok: false, status: 400, message: "No valid fields to update" };
  }

  return { ok: true, updates };
}

function parseManualLeadCreate(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, message: "Request body must be a JSON object" };
  }

  const clientName = pickString(body, ["clientName", "client_name", "name"]);
  if (!clientName) {
    return { ok: false, status: 400, message: "clientName is required" };
  }

  const parsed = parseManualLeadPatch({
    clientName,
    service: body.service ?? "",
    eventType: body.eventType ?? "",
    targetDate: body.targetDate ?? "",
    targetPax: body.targetPax ?? "",
    targetVenue: body.targetVenue ?? "",
    quotedPrice: body.quotedPrice ?? "",
    notes: body.notes ?? "",
    pipelineStatus: body.pipelineStatus ?? DEFAULT_PIPELINE_STATUS
  });
  if (!parsed.ok) {
    return { ok: false, status: parsed.status, message: parsed.message };
  }

  return { ok: true, data: parsed.updates };
}

async function createManualServiceLead(body) {
  const parsed = parseManualLeadCreate(body);
  if (!parsed.ok) {
    return { ok: false, status: parsed.status, message: parsed.message };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const quoteReference = await generateUniqueQuoteReference(db);
  const record = {
    ...parsed.data,
    quoteReference,
    source: "manual",
    createdAt: now,
    updatedAt: now,
    updateCount: 1,
    pipelineStatus: parsed.data.pipelineStatus || DEFAULT_PIPELINE_STATUS
  };
  if (record.targetDate) {
    record.targetDate = normalizeTargetDateStorage(record.targetDate) || record.targetDate;
  }
  record.profileStatus = computeProfileStatus(record);
  record.pipelineStatus = resolvePipelineStatus(record);
  record.editHistory = recordLeadEdit({}, record, "manual");

  const docRef = await db.collection(COLLECTION).add(record);
  const serialized = serializeLeadRow(docRef.id, record);
  return { ok: true, data: serialized };
}

async function updateServiceLead(id, patch) {
  const db = getDb();
  const leadId = String(id || "").trim();
  if (!leadId) {
    return { ok: false, status: 400, message: "Lead id is required" };
  }

  const parsed = parseManualLeadPatch(patch);
  if (!parsed.ok) {
    return { ok: false, status: parsed.status, message: parsed.message };
  }

  const docRef = db.collection(COLLECTION).doc(leadId);
  const doc = await docRef.get();
  if (!doc.exists) {
    return { ok: false, status: 404, message: "Lead not found" };
  }

  const prev = migrateLeadRow({ id: leadId, ...(doc.data() || {}) });
  const now = new Date().toISOString();
  const merged = { ...prev, ...parsed.updates, updatedAt: now };
  if (merged.targetDate) {
    merged.targetDate = normalizeTargetDateStorage(merged.targetDate) || merged.targetDate;
  }
  merged.profileStatus = computeProfileStatus(merged);
  merged.pipelineStatus = resolvePipelineStatus(merged);

  const changes = diffLeadChanges(prev, merged);
  if (!changes.length) {
    return { ok: false, status: 400, message: "No changes to save" };
  }

  merged.editHistory = recordLeadEdit(prev, merged, "manual");

  await docRef.set(merged, { merge: true });
  const serialized = serializeLeadRow(leadId, merged);
  return { ok: true, data: serialized };
}

function parseDateBound(dateStr, endOfDay) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  return endOfDay ? `${dateStr}T23:59:59.999Z` : `${dateStr}T00:00:00.000Z`;
}

function rowInDateRange(activityAt, startBound, endBound) {
  if (!activityAt) return false;
  if (startBound && activityAt < startBound) return false;
  if (endBound && activityAt > endBound) return false;
  return true;
}

async function resolveLeadConversation(leadId) {
  const id = String(leadId || "").trim();
  if (!id) {
    return { ok: false, status: 400, message: "Lead id required" };
  }

  const db = getDb();
  const docRef = db.collection(COLLECTION).doc(id);
  const snap = await docRef.get();
  if (!snap.exists) {
    return { ok: false, status: 404, message: "Lead not found" };
  }

  const data = snap.data() || {};
  if (data.conversationId) {
    return {
      ok: true,
      conversationId: data.conversationId,
      via: data.conversationLinkVia || "stored",
      data: serializeLeadRow(id, data)
    };
  }

  const quoteReference = data.quoteReference;
  if (!quoteReference) {
    return { ok: false, status: 400, message: "Lead has no quote reference to search for" };
  }

  const { findConversationIdByQuoteReference } = require("./conversation-link");
  const loggedAt = data.updatedAt || data.createdAt || new Date().toISOString();
  const anchorDate = data.createdAt || loggedAt;
  const conversationId = await findConversationIdByQuoteReference(quoteReference, {
    loggedAt,
    anchorDate
  });

  if (!conversationId) {
    return {
      ok: false,
      status: 404,
      message: "No inbox thread found with this quote reference in chat"
    };
  }

  await patchLeadConversationLink(id, conversationId, "quoteReference");
  const refreshed = await docRef.get();
  return {
    ok: true,
    conversationId,
    via: "quoteReference",
    data: serializeLeadRow(id, refreshed.data() || {})
  };
}

async function getLeadAnchorDate({ quoteReference, leadId } = {}) {
  if (!quoteReference && !leadId) return null;
  const db = getDb();
  const lookup = await findLeadDocRef(db, { quoteReference, leadId });
  if (!lookup.ref) return null;
  const snap = await lookup.ref.get();
  return snap.data()?.createdAt || null;
}

async function patchLeadConversationLink(leadId, conversationId, via = "quoteReference") {
  if (!leadId || !conversationId) {
    return { ok: false, message: "leadId and conversationId required" };
  }
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(leadId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, message: "Lead not found" };
  }
  await ref.set(
    {
      conversationId: String(conversationId),
      conversationLinkVia: via,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return { ok: true };
}

async function patchLeadDiscordMessage(leadId, messageId) {
  const id = String(leadId || "").trim();
  const discordMessageId = String(messageId || "").trim();
  if (!id || !discordMessageId) {
    return { ok: false, message: "leadId and messageId required" };
  }
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, message: "Lead not found" };
  }
  await ref.set(
    {
      discordMessageId,
      discordMessageAt: new Date().toISOString()
    },
    { merge: true }
  );
  return { ok: true };
}

async function listServiceLeads({ startDate, endDate, service, eventType, page = 1, size = 20 }) {
  const db = getDb();
  const startBound = parseDateBound(startDate, false);
  const endBound = parseDateBound(endDate, true);

  const snap = await db.collection(COLLECTION).orderBy("updatedAt", "desc").limit(500).get();

  let rows = snap.docs.map((doc) => serializeLeadRow(doc.id, doc.data()));

  rows = rows.filter((row) => !row.archived);

  if (service) {
    rows = rows.filter((row) => row.service === service);
  }

  if (eventType) {
    const needle = String(eventType).trim().toLowerCase();
    rows = rows.filter((row) => String(row.eventType || "").trim().toLowerCase() === needle);
  }

  rows = rows.filter((row) => rowInDateRange(leadActivityAt(row), startBound, endBound));

  rows.sort((a, b) => leadActivityAt(b).localeCompare(leadActivityAt(a)));

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * size;
  const data = rows.slice(start, start + size);

  return {
    data,
    meta: {
      page: safePage,
      size,
      count: data.length,
      total,
      hasMore: safePage < totalPages
    }
  };
}

function getServiceLabel(service) {
  return SERVICE_LABELS[service] || service || "—";
}

async function deleteServiceLeads(ids) {
  const db = getDb();
  const unique = [...new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!unique.length) {
    return { ok: false, status: 400, message: "No lead ids provided" };
  }
  if (unique.length > 100) {
    return { ok: false, status: 400, message: "Cannot delete more than 100 leads at once" };
  }

  const batch = db.batch();
  let deleted = 0;
  const refs = await Promise.all(
    unique.map((id) => db.collection(COLLECTION).doc(id).get())
  );
  for (const doc of refs) {
    if (doc.exists) {
      batch.delete(doc.ref);
      deleted += 1;
    }
  }
  if (deleted > 0) {
    await batch.commit();
  }

  return { ok: true, deleted, requested: unique.length };
}

module.exports = {
  COLLECTION,
  SERVICE_MOBILE_BAR,
  SERVICE_WORKSHOP,
  SERVICE_LABELS,
  PIPELINE_STATUSES,
  DEFAULT_PIPELINE_STATUS,
  QUOTE_REF_PATTERN,
  QUOTE_REF_SHORT_PATTERN,
  QUOTE_REF_LEGACY_PATTERN,
  generateQuoteReference,
  generateUniqueQuoteReference,
  normalizeQuoteReference,
  buildMessageForUser,
  computeProfileStatus,
  computeLeadStatus,
  normalizePipelineStatus,
  resolvePipelineStatus,
  hasQuotedPrice,
  migrateLeadRow,
  serializeLeadRow,
  hasAnyQuoteDetail,
  mergeLeadPatch,
  diffLeadChanges,
  recordLeadEdit,
  parseManualLeadPatch,
  parseManualLeadCreate,
  createManualServiceLead,
  EDIT_FIELD_LABELS,
  TRACKED_EDIT_FIELDS,
  normalizeTargetDateStorage,
  leadActivityAt,
  normalizeService,
  parseLeadPayload,
  verifyActionSecret,
  upsertServiceLead,
  updateServiceLead,
  deleteServiceLeads,
  listServiceLeads,
  patchLeadConversationLink,
  patchLeadDiscordMessage,
  resolveLeadConversation,
  getLeadAnchorDate,
  getServiceLabel,
  getDb
};
