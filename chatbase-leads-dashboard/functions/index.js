const crypto = require("crypto");
const express = require("express");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getChatbaseClientFromEnv } = require("./chatbase");
const { extractBookingDetails, hasRequiredFields, mergeExtractedWithStructured } = require("./extractor");
const { decideAutoStatus, buildStatusEvent } = require("./status-engine");
const { logInfo, logError } = require("./logger");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const LEADS_COLLECTION = "leads";

function nowIso() {
  return new Date().toISOString();
}

function requireAdminToken(req, res) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    res.status(500).json({ message: "Missing ADMIN_API_TOKEN env" });
    return false;
  }
  if (req.headers["x-admin-token"] !== expected) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  return true;
}

function buildIdempotencyKey(prefix, payload) {
  const raw = `${prefix}:${JSON.stringify(payload)}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

async function hasProcessedEvent(key) {
  const ref = db.collection("ingestionEvents").doc(key);
  const snap = await ref.get();
  return snap.exists;
}

async function markEventProcessed(key, metadata = {}) {
  await db.collection("ingestionEvents").doc(key).set({
    key,
    createdAt: nowIso(),
    ...metadata
  }, { merge: true });
}

function normalizeLeadId({ leadId, conversationId, email, phone }) {
  if (leadId) return String(leadId);
  if (conversationId) return `conversation_${conversationId}`;
  if (email) return `email_${String(email).toLowerCase()}`;
  if (phone) return `phone_${String(phone)}`;
  return `lead_${crypto.randomUUID()}`;
}

function normalizeConversationMessages(conversation) {
  if (!conversation || !Array.isArray(conversation.messages)) return [];
  return conversation.messages.map((message) => ({
    role: message.role || "user",
    content: message.content || ""
  }));
}

async function appendStatusEvent(leadRef, event) {
  await leadRef.collection("statusEvents").add(event);
}

async function writeConversationSnapshot(leadRef, conversation, rawExcerpt) {
  if (!conversation) return;
  await leadRef.collection("conversationSnapshots").add({
    source: conversation.source || "unknown",
    messageCount: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
    lastMessageAt: conversation.updated_at || conversation.updatedAt || nowIso(),
    rawExcerpt: rawExcerpt || "",
    rawPayload: conversation,
    createdAt: nowIso()
  });
}

async function upsertLead({
  lead,
  conversation,
  extractionSource = "conversation_parse",
  source = "sync",
  structuredBooking = null
}) {
  const messages = normalizeConversationMessages(conversation);
  let extracted = extractBookingDetails(messages);
  if (structuredBooking && typeof structuredBooking === "object") {
    extracted = mergeExtractedWithStructured(extracted, structuredBooking);
    extractionSource = "custom_action";
  }
  const inquiryType = extracted.inquiryType || "unknown";
  const missingRequired = !hasRequiredFields(inquiryType, extracted);

  const leadId = normalizeLeadId({
    leadId: lead.id,
    conversationId: conversation?.id || lead.conversationId,
    email: lead.email,
    phone: lead.phone
  });
  const leadRef = db.collection(LEADS_COLLECTION).doc(leadId);
  const leadSnapshot = await leadRef.get();
  const previous = leadSnapshot.exists ? leadSnapshot.data() : null;

  const baseLead = {
    externalLeadId: lead.id || null,
    chatbotId: process.env.CHATBASE_CHATBOT_ID || null,
    conversationId: conversation?.id || lead.conversationId || null,
    name: lead.name || previous?.name || null,
    email: lead.email || previous?.email || null,
    phone: lead.phone || previous?.phone || null,
    inquiryType,
    statusReason: "",
    source,
    bookingDetails: {
      targetDate: extracted.targetDate || null,
      targetVenue: extracted.targetVenue || null,
      cupsToServe: extracted.cupsToServe || null,
      pax: extracted.pax || null,
      confidenceScore: extracted.confidenceScore,
      extractionSource
    },
    missingRequiredFields: missingRequired,
    lastMessageAt: conversation?.updated_at || conversation?.updatedAt || previous?.lastMessageAt || nowIso(),
    updatedAt: nowIso(),
    createdAt: previous?.createdAt || nowIso()
  };

  const statusDecision = decideAutoStatus(previous || baseLead, !missingRequired);
  const previousStatus = previous?.status || "new";
  baseLead.status = statusDecision.nextStatus;
  baseLead.statusReason = statusDecision.reason;

  await leadRef.set(baseLead, { merge: true });
  await leadRef.collection("bookingDetails").doc("current").set(baseLead.bookingDetails, { merge: true });
  await writeConversationSnapshot(leadRef, conversation, extracted.rawExcerpt);

  if (!previous || previousStatus !== statusDecision.nextStatus) {
    await appendStatusEvent(leadRef, buildStatusEvent({
      fromStatus: previousStatus,
      toStatus: statusDecision.nextStatus,
      triggerType: "auto",
      note: statusDecision.reason
    }));
  }

  return { id: leadId, ...baseLead };
}

async function fetchConversationMap(client, options = {}) {
  const map = new Map();
  const maxPages = Number(process.env.MAX_SYNC_PAGES || 10);
  const size = Number(process.env.SYNC_CONVERSATION_PAGE_SIZE || 50);
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await client.getConversations({
      startDate: options.startDate,
      endDate: options.endDate,
      page,
      size
    });
    const rows = result?.data || [];
    rows.forEach((conversation) => map.set(conversation.id, conversation));
    if (rows.length < size) break;
  }
  return map;
}

async function runLeadSync({ startDate, endDate } = {}) {
  const client = getChatbaseClientFromEnv();
  const conversationMap = await fetchConversationMap(client, { startDate, endDate });

  const maxPages = Number(process.env.MAX_SYNC_PAGES || 10);
  const size = Number(process.env.SYNC_LEADS_PAGE_SIZE || 100);
  let processed = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await client.getLeads({ startDate, endDate, page, size });
    const rows = result?.collectedCustomers || [];
    for (const lead of rows) {
      const key = buildIdempotencyKey("sync", {
        leadId: lead.id,
        page,
        startDate,
        endDate
      });
      if (await hasProcessedEvent(key)) continue;

      const conversation = conversationMap.get(lead.conversationId) || null;
      await upsertLead({ lead, conversation, source: "sync" });
      await markEventProcessed(key, { type: "sync", leadId: lead.id || null });
      processed += 1;
    }
    if (rows.length < size) break;
  }
  return { processed };
}

function verifyWebhookSignature(req) {
  const secret = process.env.CHATBASE_WEBHOOK_SECRET || process.env.CHATBASE_API_KEY;
  if (!secret) throw new Error("Missing CHATBASE_WEBHOOK_SECRET or CHATBASE_API_KEY");
  const received = req.headers["x-chatbase-signature"];
  if (!received) return false;
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
  return received === expected;
}

exports.chatbaseWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method Not Allowed" });
    return;
  }
  try {
    if (!verifyWebhookSignature(req)) {
      res.status(401).json({ message: "Invalid signature" });
      return;
    }

    const payload = req.body || {};
    const eventType = payload.eventType;
    if (eventType !== "leads.submit") {
      res.status(200).json({ ok: true, skipped: true, reason: "unsupported event" });
      return;
    }

    const conversationId = payload?.payload?.conversationId || null;
    const idempotencyKey = buildIdempotencyKey("webhook", {
      eventType,
      conversationId,
      email: payload?.payload?.customerEmail || null
    });
    if (await hasProcessedEvent(idempotencyKey)) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    const lead = {
      id: payload?.payload?.conversationId || null,
      conversationId,
      name: payload?.payload?.customerName || null,
      email: payload?.payload?.customerEmail || null,
      phone: payload?.payload?.customerPhone || null
    };
    await upsertLead({
      lead,
      conversation: { id: conversationId, messages: [], source: "webhook", updatedAt: nowIso() },
      extractionSource: "webhook",
      source: "webhook"
    });
    await markEventProcessed(idempotencyKey, { type: "webhook", eventType, conversationId });
    res.status(200).json({ ok: true });
  } catch (err) {
    logError("Webhook processing failed", err);
    res.status(500).json({ message: err.message });
  }
});

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) {
    req.url = req.url.slice(4) || "/";
  }
  next();
});

app.get("/health", async (_req, res) => {
  res.status(200).json({ ok: true, time: nowIso() });
});

app.get("/leads", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const { status, inquiryType, startDate, endDate, search, missingRequired } = req.query;
    let query = db.collection(LEADS_COLLECTION).orderBy("updatedAt", "desc").limit(300);
    if (status) query = query.where("status", "==", status);
    if (inquiryType) query = query.where("inquiryType", "==", inquiryType);
    if (startDate) query = query.where("createdAt", ">=", String(startDate));
    if (endDate) query = query.where("createdAt", "<=", `${String(endDate)}T23:59:59.999Z`);

    const snap = await query.get();
    let rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (typeof missingRequired === "string" && missingRequired !== "") {
      const expected = missingRequired === "true";
      rows = rows.filter((lead) => Boolean(lead.missingRequiredFields) === expected);
    }
    if (search) {
      const keyword = String(search).toLowerCase();
      rows = rows.filter((lead) => {
        const hay = [
          lead.name,
          lead.email,
          lead.phone,
          lead.bookingDetails?.targetVenue
        ].join(" ").toLowerCase();
        return hay.includes(keyword);
      });
    }

    res.status(200).json({ data: rows });
  } catch (err) {
    logError("List leads failed", err);
    res.status(500).json({ message: err.message });
  }
});

app.get("/leads/:leadId", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const leadRef = db.collection(LEADS_COLLECTION).doc(req.params.leadId);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    const [bookingSnap, eventsSnap, convoSnap] = await Promise.all([
      leadRef.collection("bookingDetails").doc("current").get(),
      leadRef.collection("statusEvents").orderBy("createdAt", "desc").limit(50).get(),
      leadRef.collection("conversationSnapshots").orderBy("createdAt", "desc").limit(10).get()
    ]);

    res.status(200).json({
      data: {
        id: leadSnap.id,
        ...leadSnap.data(),
        bookingDetails: bookingSnap.exists ? bookingSnap.data() : {},
        statusEvents: eventsSnap.docs.map((doc) => doc.data()),
        conversationSnapshots: convoSnap.docs.map((doc) => doc.data())
      }
    });
  } catch (err) {
    logError("Get lead failed", err, { leadId: req.params.leadId });
    res.status(500).json({ message: err.message });
  }
});

app.patch("/leads/:leadId/status", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const { status, note = "" } = req.body || {};
    const allowed = ["new", "qualified", "follow_up", "proposal_sent", "won", "lost"];
    if (!allowed.includes(status)) {
      res.status(400).json({ message: "Invalid status" });
      return;
    }

    const leadRef = db.collection(LEADS_COLLECTION).doc(req.params.leadId);
    const snap = await leadRef.get();
    if (!snap.exists) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    const current = snap.data();
    await leadRef.set({
      status,
      statusReason: note || "manual override",
      updatedAt: nowIso()
    }, { merge: true });
    await appendStatusEvent(leadRef, buildStatusEvent({
      fromStatus: current.status || "new",
      toStatus: status,
      triggerType: "manual",
      note
    }));

    res.status(200).json({ ok: true });
  } catch (err) {
    logError("Manual status update failed", err, { leadId: req.params.leadId });
    res.status(500).json({ message: err.message });
  }
});

app.post("/sync", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const result = await runLeadSync({
      startDate: req.body?.startDate || null,
      endDate: req.body?.endDate || null
    });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logError("Manual sync failed", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * Chatbase server-side custom action: POST JSON body with booking fields.
 * Requires header x-admin-token (same as other dashboard API routes).
 * Chatbase docs: custom actions must send/receive JSON.
 */
app.post("/ingest/chatbase-action", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const body = req.body || {};
    const conversationId = body.conversationId ?? body.conversation_id ?? null;
    const lead = {
      id: body.leadId ?? body.externalLeadId ?? conversationId ?? null,
      conversationId,
      name: body.name ?? body.customerName ?? null,
      email: body.email ?? body.customerEmail ?? null,
      phone: body.phone ?? body.customerPhone ?? null
    };
    const structuredBooking = {
      targetDate: body.targetDate ?? body.target_date,
      targetVenue: body.targetVenue ?? body.target_venue,
      cupsToServe: body.cupsToServe ?? body.cups_to_serve ?? body.cups,
      pax: body.pax ?? body.num_pax,
      inquiryType: body.inquiryType ?? body.inquiry_type
    };
    const hasAnyStructured = Object.values(structuredBooking).some((v) => v != null && v !== "");
    const conversation = {
      id: conversationId,
      messages: hasAnyStructured
        ? [{ role: "user", content: `Structured booking: ${JSON.stringify(structuredBooking)}` }]
        : [],
      source: body.source || "custom_action",
      updated_at: body.updatedAt || nowIso()
    };
    const saved = await upsertLead({
      lead,
      conversation,
      structuredBooking: hasAnyStructured ? structuredBooking : null,
      source: "custom_action"
    });
    res.status(200).json({
      ok: true,
      leadId: saved.id,
      status: saved.status,
      inquiryType: saved.inquiryType
    });
  } catch (err) {
    logError("Custom action ingest failed", err);
    res.status(500).json({ message: err.message });
  }
});

exports.api = onRequest(app);

exports.scheduledSync = onSchedule("every 30 minutes", async () => {
  try {
    const startDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString().slice(0, 10);
    const result = await runLeadSync({ startDate, endDate: nowIso().slice(0, 10) });
    logInfo("Scheduled sync complete", result);
  } catch (err) {
    logError("Scheduled sync failed", err);
  }
});

exports.scheduledStatusSweep = onSchedule("every 60 minutes", async () => {
  try {
    const snap = await db.collection(LEADS_COLLECTION).limit(300).get();
    for (const doc of snap.docs) {
      const lead = { id: doc.id, ...doc.data() };
      const requiredPresent = !lead.missingRequiredFields;
      const decision = decideAutoStatus(lead, requiredPresent);
      if (decision.nextStatus === lead.status) continue;

      const leadRef = db.collection(LEADS_COLLECTION).doc(doc.id);
      await leadRef.set({
        status: decision.nextStatus,
        statusReason: decision.reason,
        updatedAt: nowIso()
      }, { merge: true });
      await appendStatusEvent(leadRef, buildStatusEvent({
        fromStatus: lead.status || "new",
        toStatus: decision.nextStatus,
        triggerType: "auto",
        note: decision.reason
      }));
    }
  } catch (err) {
    logError("Scheduled status sweep failed", err);
  }
});

exports.dailyReconciliation = onSchedule("every day 03:00", async () => {
  try {
    const [leadSnap, eventSnap] = await Promise.all([
      db.collection(LEADS_COLLECTION).get(),
      db.collection("ingestionEvents").get()
    ]);
    logInfo("Daily reconciliation", {
      leadCount: leadSnap.size,
      ingestionEventCount: eventSnap.size
    });
  } catch (err) {
    logError("Daily reconciliation failed", err);
  }
});
