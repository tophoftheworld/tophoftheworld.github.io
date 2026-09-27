const express = require("express");
const { onRequest } = require("firebase-functions/v2/https");
const {
  getChatbaseClientFromEnv,
  getDefaultPageSize,
  getDefaultMaxPages,
  normalizeConversation
} = require("./chatbase");
const {
  parseLeadPayload,
  verifyActionSecret,
  upsertServiceLead,
  createManualServiceLead,
  updateServiceLead,
  deleteServiceLeads,
  patchLeadDiscordMessage,
  listServiceLeads,
  SERVICE_MOBILE_BAR,
  SERVICE_WORKSHOP
} = require("./service-leads");
const {
  findConversationIdByQuoteReference,
  findConversationIdByOrderNumber,
} = require("./conversation-link");
const {
  verifyActionSecret: verifyPaymentActionSecret,
  parsePaymentPayload,
  processPaymentProof,
  listPaymentIntakes,
  getPaymentIntakeByOrder,
  getPaymentIntakesByOrders,
  deletePaymentIntakes
} = require("./payment-intakes");
const { logInfo, logError } = require("./logger");
const { getPublicInvoiceByToken, updatePublicChoiceDrinks } = require("./public-invoice");
const { handlePublicInvoicePage } = require("./public-invoice-page");
const { generateInboxSummary, sectionsToText } = require("./inbox-summary");
const {
  buildFullInboxSummary,
  injectPaymentsSection,
  formatSummarySectionsHtml,
  wrapSummaryEmailHtml,
  emailSubjectForFraming,
  emailTitleForFraming
} = require("./inbox-summary-email");
const { sendInboxSummaryEmail } = require("./mailer");
const { sendPublicInvoiceEmail } = require("./invoice-email");
const {
  extractInvoicePaymentProof,
  confirmInvoicePaymentProof
} = require("./invoice-payment-proof");
const { sendInboxSummaryToDiscord, upsertInquiryMessage, notifyShopifyOrder } = require("./discord");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");

// Firebase strips *_KEY from .env on deploy — use Secret Manager (same as MMF).
const emailjsPrivateKey = defineSecret("EMAILJS_PRIVATE_KEY");
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const {
  isSheetsConfigured,
  exportWorkshopSheet,
  syncWorkshopSheet,
  syncWorkshopSheetsForOrder,
  getWorkshopSheetInfo
} = require("./workshop-sheets");
const { promoteLeadToOpsEvent } = require("./ops-events");
const {
  syncOpsEventToGoogleCalendar,
  isOpsCalendarConfigured
} = require("./ops-calendar");
const {
  getUpcomingWorkshopSessions,
  getWorkshopEventDetails,
  searchWorkshopSessions,
  getNextAvailableWorkshop,
  formatSessionsForChat
} = require("./workshop-events");

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

function parsePage(value, fallback = 1) {
  const page = Number(value);
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : fallback;
}

function parseSize(value, fallback) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 1) return fallback;
  return Math.min(Math.floor(size), 100);
}

const app = express();

const CORS_ALLOWED_ORIGINS = new Set([
  "https://admin.matchanese.com",
  "https://matchanese.com",
  "https://www.matchanese.com",
  "https://tophoftheworld.github.io",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:8080",
  "http://127.0.0.1:8080"
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    (CORS_ALLOWED_ORIGINS.has(origin) ||
      origin.endsWith(".web.app") ||
      origin.endsWith(".firebaseapp.com"))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(
  express.json({
    limit: "8mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

const path = require("path");
const { pathToFileURL } = require("url");
const SHOPIFY_API_PATH = /^\/api\/(config|orders|workshop-sessions|workshop-roster|products)/;
let shopifyHttpPromise;

function loadShopifyHttp() {
  if (!shopifyHttpPromise) {
    const serverPath = path.join(__dirname, "shopify-orders", "server.mjs");
    shopifyHttpPromise = import(pathToFileURL(serverPath).href).then((mod) => mod.handleShopifyHttp);
  }
  return shopifyHttpPromise;
}

app.use(async (req, res, next) => {
  const pathname = (req.url || "").split("?")[0];
  if (!SHOPIFY_API_PATH.test(pathname)) return next();
  try {
    const handleShopifyHttp = await loadShopifyHttp();
    await handleShopifyHttp(req, res);
  } catch (err) {
    logError("Shopify API proxy failed", err);
    if (!res.headersSent) {
      res.status(502).json({ error: err.message || String(err) });
    }
  }
});

app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) {
    req.url = req.url.slice(4) || "/";
  }
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, time: nowIso() });
});

app.get("/invoices/:token", async (req, res) => {
  try {
    const result = await getPublicInvoiceByToken(req.params.token);
    if (!result.ok) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.status(200).json({ data: result.data });
  } catch (err) {
    logError("Get public invoice failed", err);
    res.status(500).json({ message: "Unable to load invoice" });
  }
});

app.patch("/invoices/:token/choice-drinks", async (req, res) => {
  try {
    const result = await updatePublicChoiceDrinks(req.params.token, req.body || {});
    if (!result.ok) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.status(200).json({ data: result.data });
  } catch (err) {
    logError("Update public choice drinks failed", err);
    res.status(500).json({ message: "Unable to save drink choices" });
  }
});

app.post("/invoices/:token/email", async (req, res) => {
  try {
    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();
    const body = req.body || {};
    const result = await sendPublicInvoiceEmail({
      token: req.params.token,
      to: body.to,
      subject: body.subject,
      message: body.message
    });
    if (!result.ok) {
      res.status(result.status || 400).json({ ok: false, message: result.message });
      return;
    }
    logInfo("Invoice email sent", {
      to: result.data?.to,
      invoiceNumber: result.data?.invoiceNumber,
      token: String(req.params.token || "").slice(0, 8)
    });
    res.set("Cache-Control", "no-store");
    res.status(200).json({ ok: true, data: result.data });
  } catch (err) {
    logError("Invoice email failed", err);
    const status =
      err.code === "EMAIL_NOT_CONFIGURED"
        ? 501
        : err.code === "EMAIL_NO_RECIPIENT"
          ? 400
          : err.code === "EMAILJS_SEND_FAILED"
            ? 502
            : 500;
    res.status(status).json({
      ok: false,
      message: err.message || "Unable to send invoice email",
      code: err.code || null
    });
  }
});

app.post("/invoices/:token/payment-proof/extract", async (req, res) => {
  try {
    const body = req.body || {};
    const result = await extractInvoicePaymentProof({
      token: req.params.token,
      imageBase64: body.imageBase64,
      mimeType: body.mimeType,
      apiKey: geminiApiKey.value()
    });
    if (!result.ok) {
      res.status(result.status || 400).json({ ok: false, message: result.message });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.status(200).json({ ok: true, data: result.data });
  } catch (err) {
    logError("Invoice payment proof extract failed", err);
    const status =
      err.code === "INVALID_IMAGE" ? 400 : err.code === "failed-precondition" ? 501 : 502;
    res.status(status).json({
      ok: false,
      message: err.message || "Unable to read payment screenshot",
      code: err.code || null
    });
  }
});

app.post("/invoices/:token/payment-proof/confirm", async (req, res) => {
  try {
    const body = req.body || {};
    const result = await confirmInvoicePaymentProof({
      token: req.params.token,
      imageBase64: body.imageBase64,
      mimeType: body.mimeType,
      milestoneId: body.milestoneId,
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      referenceNumber: body.referenceNumber,
      paidAt: body.paidAt,
      senderName: body.senderName
    });
    if (!result.ok) {
      res.status(result.status || 400).json({ ok: false, message: result.message });
      return;
    }
    logInfo("Invoice payment proof confirmed", {
      invoiceNumber: result.data?.invoice?.invoiceNumber,
      milestoneId: body.milestoneId,
      token: String(req.params.token || "").slice(0, 8)
    });
    res.set("Cache-Control", "no-store");
    res.status(200).json({ ok: true, data: result.data });
  } catch (err) {
    logError("Invoice payment proof confirm failed", err);
    res.status(500).json({
      ok: false,
      message: err.message || "Unable to confirm payment",
      code: err.code || null
    });
  }
});

app.get("/conversations", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const client = getChatbaseClientFromEnv();
    const page = parsePage(req.query.page, 1);
    const size = parseSize(req.query.size, getDefaultPageSize());
    const { startDate, endDate, filteredSources } = req.query;

    const result = await client.getConversations({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page,
      size,
      filteredSources: filteredSources || ""
    });

    const rows = (result?.data || []).map((row) => {
      const conversation = normalizeConversation(row);
      const { messages, ...summary } = conversation;
      return summary;
    });
    res.status(200).json({
      data: rows,
      meta: {
        page,
        size,
        count: rows.length,
        hasMore: rows.length >= size
      }
    });
  } catch (err) {
    logError("List conversations failed", err);
    res.status(500).json({ message: err.message });
  }
});

async function handleInboxSummary(req, res) {
  if (!requireAdminToken(req, res)) return;
  try {
    const client = getChatbaseClientFromEnv();
    const dateSource = req.method === "GET" ? req.query : req.body;
    const date = dateSource?.date ? String(dateSource.date).slice(0, 10) : undefined;
    const filteredSources =
      dateSource?.filteredSources != null ? String(dateSource.filteredSources) : "";
    const batch = dateSource?.batch != null ? Number(dateSource.batch) : 0;
    const pendingBatch =
      dateSource?.pendingBatch != null && dateSource.pendingBatch !== ""
        ? Number(dateSource.pendingBatch)
        : undefined;
    const windowMode =
      dateSource?.windowMode === "rolling24h" ? "rolling24h" : "calendar";

    const result = await generateInboxSummary({
      client,
      date,
      filteredSources,
      batch,
      pendingBatch,
      windowMode
    });

    // Inject deterministic payments checklist on day-phase responses (client merge picks it up).
    if (result?.meta?.phase === "day" && result.sections) {
      result.sections = await injectPaymentsSection(result.sections, {
        date: result.meta.date,
        windowMode: result.meta.windowMode || windowMode
      });
      result.summary = sectionsToText(result.sections);
    }

    logInfo("Inbox summary batch generated", result.meta);
    res.status(200).json({ data: result });
  } catch (err) {
    logError("Inbox summary failed", err);
    res.status(500).json({ message: err.message });
  }
}

async function handleInboxSummaryEmail(req, res) {
  if (!requireAdminToken(req, res)) return;
  try {
    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();
    const body = req.body || {};
    const date = body.date ? String(body.date).slice(0, 10) : undefined;
    const filteredSources = body.filteredSources != null ? String(body.filteredSources) : "";
    const windowMode = body.windowMode === "rolling24h" ? "rolling24h" : "calendar";
    const framing = body.framing === "morning" || body.framing === "evening" ? body.framing : "test";
    const to = body.to ? String(body.to).trim() : undefined;

    let sections = body.sections;
    let html;
    let meta;
    let summaryDate = date;

    if (sections && typeof sections === "object") {
      // Test-send from dashboard: use the already-rendered merged sections as-is.
      const sectionsHtml = formatSummarySectionsHtml(sections);
      const title = emailTitleForFraming("test", summaryDate);
      html = wrapSummaryEmailHtml({
        title,
        subtitle: "Manual test send from the dashboard",
        sectionsHtml
      });
      meta = { date: summaryDate, windowMode, framing: "test", fromSections: true };
    } else {
      const client = getChatbaseClientFromEnv();
      const built = await buildFullInboxSummary({
        client,
        date,
        filteredSources,
        windowMode,
        framing: framing === "test" ? null : framing
      });
      sections = built.sections;
      html = built.html;
      meta = built.meta;
      summaryDate = built.meta?.date;
    }

    const subject = emailSubjectForFraming(framing, summaryDate);

    const sent = await sendInboxSummaryEmail({ to, subject, html });
    logInfo("Inbox summary email sent", { ...sent, ...meta });
    await pingInboxSummaryDiscord({
      subject,
      summary: sectionsToText(sections),
      sections,
      framing: meta?.framing || framing
    });
    res.status(200).json({ ok: true, data: { ...sent, meta, sections } });
  } catch (err) {
    logError("Inbox summary email failed", err);
    const status = err.code === "EMAIL_NOT_CONFIGURED" ? 501 : 500;
    res.status(status).json({ ok: false, message: err.message });
  }
}

app.get(["/inbox/summary", "/api/inbox/summary"], handleInboxSummary);
app.post(["/inbox/summary", "/api/inbox/summary"], handleInboxSummary);
app.post(["/inbox/summary/email", "/api/inbox/summary/email"], handleInboxSummaryEmail);

app.get("/conversations/:conversationId", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const client = getChatbaseClientFromEnv();
    const size = parseSize(req.query.size, getDefaultPageSize());
    const maxPages = parseSize(req.query.maxPages, getDefaultMaxPages());
    const { startDate, endDate, filteredSources } = req.query;

    const wideStart = () => {
      const date = new Date();
      date.setFullYear(date.getFullYear() - 2);
      return date.toISOString().slice(0, 10);
    };
    const wideEnd = () => new Date().toISOString().slice(0, 10);

    const conversation = await client.findConversationById(req.params.conversationId, {
      startDate: startDate || wideStart(),
      endDate: endDate || wideEnd(),
      filteredSources: filteredSources || "",
      size,
      maxPages: Math.max(maxPages, 100)
    });

    if (!conversation) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }

    res.status(200).json({ data: conversation });
  } catch (err) {
    logError("Get conversation failed", err, { conversationId: req.params.conversationId });
    res.status(500).json({ message: err.message });
  }
});

app.post("/conversations/resolve/quote", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const quoteReference = String(req.body?.quoteReference || "").trim();
    if (!quoteReference) {
      res.status(400).json({ ok: false, message: "quoteReference required" });
      return;
    }
    const loggedAt = req.body?.loggedAt || new Date().toISOString();
    const anchorDate = req.body?.anchorDate || loggedAt;
    const conversationId = await findConversationIdByQuoteReference(quoteReference, {
      loggedAt,
      anchorDate
    });
    if (!conversationId) {
      res.status(404).json({
        ok: false,
        message: "No inbox thread found with this quote reference in chat"
      });
      return;
    }
    res.status(200).json({ ok: true, conversationId, via: "quoteReference" });
  } catch (err) {
    logError("Resolve conversation by quote failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post("/conversations/resolve/order", async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const orderNumber = String(req.body?.orderNumber || "").trim();
    if (!orderNumber) {
      res.status(400).json({ ok: false, message: "orderNumber required" });
      return;
    }
    const loggedAt = req.body?.loggedAt || new Date().toISOString();
    const anchorDate = req.body?.anchorDate || loggedAt;
    const conversationId = await findConversationIdByOrderNumber(orderNumber, {
      loggedAt,
      anchorDate
    });
    if (!conversationId) {
      res.status(404).json({
        ok: false,
        message: "No inbox thread found with this order number in chat"
      });
      return;
    }
    res.status(200).json({ ok: true, conversationId, via: "orderNumber" });
  } catch (err) {
    logError("Resolve conversation by order failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post("/webhooks/service-lead", async (req, res) => {
  const auth = verifyActionSecret(req);
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, message: auth.message });
    return;
  }

  try {
    const parsed = parseLeadPayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const saved = await upsertServiceLead({
      ...parsed.data,
      ...(parsed.leadId ? { leadId: parsed.leadId } : {}),
      ...(parsed.quoteReference ? { quoteReference: parsed.quoteReference } : {}),
    });

    if (!saved.ok) {
      res.status(saved.status || 400).json({ ok: false, message: saved.message });
      return;
    }

    logInfo(saved.created ? "Service lead created" : "Service lead updated", {
      id: saved.id,
      quoteReference: saved.quoteReference,
      service: saved.service,
    });
    await pingInquiryDiscord(saved);
    res.status(saved.created ? 201 : 200).json({
      ok: true,
      id: saved.id,
      quoteReference: saved.quoteReference,
      created: saved.created,
      profileStatus: saved.profileStatus,
      pipelineStatus: saved.pipelineStatus,
      status: saved.profileStatus,
      messageForUser: saved.messageForUser
    });
  } catch (err) {
    logError("Create service lead failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get("/service-leads", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const page = parsePage(req.query.page, 1);
    const size = parseSize(req.query.size, 20);
    let service = req.query.service || "";
    if (service && service !== SERVICE_MOBILE_BAR && service !== SERVICE_WORKSHOP) {
      res.status(400).json({
        message: `service must be ${SERVICE_MOBILE_BAR} or ${SERVICE_WORKSHOP}`
      });
      return;
    }

    const result = await listServiceLeads({
      startDate: req.query.startDate || undefined,
      endDate: req.query.endDate || undefined,
      service: service || undefined,
      eventType: req.query.eventType || undefined,
      page,
      size
    });

    res.status(200).json(result);
  } catch (err) {
    logError("List service leads failed", err);
    res.status(500).json({ message: err.message });
  }
});

app.post("/service-leads", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const result = await createManualServiceLead(req.body || {});
    if (!result.ok) {
      res.status(result.status || 400).json({ ok: false, message: result.message });
      return;
    }
    logInfo("Service lead created manually", {
      id: result.data.id,
      quoteReference: result.data.quoteReference
    });
    await pingInquiryDiscord({ created: true, ...result.data });
    res.status(201).json({ ok: true, data: result.data });
  } catch (err) {
    logError("Create service lead failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.patch("/service-leads/:id", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const result = await updateServiceLead(req.params.id, req.body || {});
    if (!result.ok) {
      res.status(result.status || 400).json({ ok: false, message: result.message });
      return;
    }
    await pingInquiryDiscord({ created: false, ...result.data });
    res.status(200).json({ ok: true, data: result.data });
  } catch (err) {
    logError("Update service lead failed", err, { id: req.params.id });
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post("/service-leads/:id/promote-event", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const result = await promoteLeadToOpsEvent(req.params.id);
    logInfo("Service lead promoted to ops event", {
      leadId: req.params.id,
      eventId: result.id,
      alreadyLinked: Boolean(result.alreadyLinked)
    });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logError("Promote lead to event failed", err, { id: req.params.id });
    const status = err.status || 500;
    res.status(status).json({ ok: false, message: err.message });
  }
});

app.post("/webhooks/payment-proof", async (req, res) => {
  const auth = verifyPaymentActionSecret(req);
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, message: auth.message });
    return;
  }

  try {
    const parsed = parsePaymentPayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        ok: false,
        message: parsed.message,
        messageForUser: parsed.message
      });
      return;
    }

    const result = await processPaymentProof(parsed.data);
    if (!result.ok) {
      res.status(result.status || 400).json({
        ok: false,
        message: result.message,
        messageForUser: result.messageForUser,
        ...(result.id ? { id: result.id } : {})
      });
      return;
    }

    logInfo("Payment proof processed", {
      id: result.id,
      orderName: result.orderName,
      shopifyOrderId: result.shopifyOrderId,
      status: result.status,
    });
    res.status(201).json({
      ok: true,
      id: result.id,
      orderName: result.orderName,
      shopifyOrderId: result.shopifyOrderId,
      status: result.status,
      matchMethod: result.matchMethod,
      messageForUser: result.messageForUser
    });
  } catch (err) {
    logError("Payment proof webhook failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get("/payment-intakes", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const page = parsePage(req.query.page, 1);
    const size = parseSize(req.query.size, 20);
    const result = await listPaymentIntakes({
      startDate: req.query.startDate || undefined,
      endDate: req.query.endDate || undefined,
      status: req.query.status || undefined,
      search: req.query.search || undefined,
      page,
      size
    });
    res.status(200).json(result);
  } catch (err) {
    logError("List payment intakes failed", err);
    res.status(500).json({ message: err.message });
  }
});

app.get("/payment-intakes/by-order/:shopifyOrderId", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const row = await getPaymentIntakeByOrder(req.params.shopifyOrderId);
    if (!row) {
      res.status(404).json({ message: "No payment intake for this order" });
      return;
    }
    res.status(200).json({ data: row });
  } catch (err) {
    logError("Get payment intake by order failed", err);
    res.status(500).json({ message: err.message });
  }
});

app.post("/payment-intakes/by-orders", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const map = await getPaymentIntakesByOrders(ids);
    res.status(200).json({ data: map });
  } catch (err) {
    logError("Batch payment intakes failed", err);
    res.status(500).json({ message: err.message });
  }
});

app.post("/payment-intakes/delete", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await deletePaymentIntakes(ids);
    if (!result.ok) {
      res.status(result.status || 400).json({ ok: false, message: result.message });
      return;
    }
    logInfo("Payment intakes deleted", { deleted: result.deleted, requested: result.requested });
    res.status(200).json({
      ok: true,
      deleted: result.deleted,
      requested: result.requested
    });
  } catch (err) {
    logError("Delete payment intakes failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post("/service-leads/delete", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await deleteServiceLeads(ids);
    if (!result.ok) {
      res.status(result.status || 400).json({ ok: false, message: result.message });
      return;
    }
    logInfo("Service leads deleted", { deleted: result.deleted, requested: result.requested });
    res.status(200).json({
      ok: true,
      deleted: result.deleted,
      requested: result.requested
    });
  } catch (err) {
    logError("Delete service leads failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

function workshopDayParams(source) {
  const eventId = String(source?.event_id || source?.eventId || "").trim();
  const sessionDate = String(
    source?.session_date || source?.sessionDate || ""
  ).trim();
  return { eventId, sessionDate };
}

app.get("/workshop-sheet", async (req, res) => {
  try {
    const { eventId, sessionDate } = workshopDayParams(req.query);
    if (!eventId || !sessionDate) {
      res.status(400).json({ message: "event_id and session_date are required" });
      return;
    }
    const info = await getWorkshopSheetInfo(eventId, sessionDate);
    res.status(200).json(info);
  } catch (err) {
    logError("Get workshop sheet info failed", err);
    res.status(500).json({ message: err.message });
  }
});

app.post("/workshop-sheet/export", async (req, res) => {
  try {
    const { eventId, sessionDate } = workshopDayParams({ ...req.query, ...req.body });
    if (!eventId || !sessionDate) {
      res.status(400).json({ message: "event_id and session_date are required" });
      return;
    }
    const result = await exportWorkshopSheet(eventId, sessionDate);
    logInfo("Workshop sheet exported", { eventId, sessionDate, created: result.created });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err.code === "NOT_CONFIGURED") {
      res.status(501).json({
        ok: false,
        message:
          "Google Sheets integration is not configured yet (missing service account or Shared Drive)."
      });
      return;
    }
    logError("Workshop sheet export failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post("/workshop-sheet/sync", async (req, res) => {
  try {
    const { eventId, sessionDate } = workshopDayParams({ ...req.query, ...req.body });
    if (!eventId || !sessionDate) {
      res.status(400).json({ message: "event_id and session_date are required" });
      return;
    }
    const result = await syncWorkshopSheet(eventId, sessionDate);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logError("Workshop sheet sync failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get("/workshops/upcoming", async (req, res) => {
  try {
    const eventType = req.query.eventType || req.query.event_type || null;
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const daysAhead = Math.min(Number(req.query.days_ahead || req.query.daysAhead) || 90, 365);
    const format = req.query.format || "json";

    const result = await getUpcomingWorkshopSessions({
      eventType,
      limit,
      daysAhead
    });

    if (!result.ok) {
      res.status(404).json({ ok: false, message: result.message });
      return;
    }

    if (format === "text" || format === "chat") {
      const text = formatSessionsForChat(result.sessions);
      res.status(200).json({
        ok: true,
        text,
        count: result.count,
        sessions: result.sessions
      });
    } else {
      res.status(200).json({
        ok: true,
        data: result.sessions,
        count: result.count,
        queryDate: result.queryDate
      });
    }
  } catch (err) {
    logError("Get upcoming workshops failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get("/workshops/next", async (req, res) => {
  try {
    const eventType = req.query.eventType || req.query.event_type || null;
    const result = await getNextAvailableWorkshop({ eventType });

    if (!result.ok) {
      res.status(404).json({ ok: false, message: result.message });
      return;
    }

    res.status(200).json({
      ok: true,
      data: result.session,
      message: result.message
    });
  } catch (err) {
    logError("Get next workshop failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get("/workshops/search", async (req, res) => {
  try {
    const query = req.query.q || req.query.query || "";
    const date = req.query.date || null;
    const month = req.query.month || null;
    const format = req.query.format || "json";

    const result = await searchWorkshopSessions({ query, date, month });

    if (!result.ok) {
      res.status(404).json({ ok: false, message: result.message });
      return;
    }

    if (format === "text" || format === "chat") {
      const text = formatSessionsForChat(result.sessions);
      res.status(200).json({
        ok: true,
        text,
        count: result.count,
        sessions: result.sessions
      });
    } else {
      res.status(200).json({
        ok: true,
        data: result.sessions,
        count: result.count
      });
    }
  } catch (err) {
    logError("Search workshops failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get("/workshops/event/:eventType", async (req, res) => {
  try {
    const result = await getWorkshopEventDetails({
      eventType: req.params.eventType
    });

    if (!result.ok) {
      res.status(404).json({ ok: false, message: result.message });
      return;
    }

    res.status(200).json({
      ok: true,
      data: result.event
    });
  } catch (err) {
    logError("Get workshop event details failed", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

function verifyShopifyWebhook(req) {
  const secret = (
    process.env.SHOPIFY_WEBHOOK_SECRET ||
    process.env.SHOPIFY_CLIENT_SECRET ||
    ""
  ).trim();
  if (!secret) return false;
  const hmac = req.get("x-shopify-hmac-sha256") || "";
  if (!hmac || !req.rawBody) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest));
  } catch (_) {
    return false;
  }
}

app.post("/webhooks/shopify-order", async (req, res) => {
  if (!verifyShopifyWebhook(req)) {
    res.status(401).json({ ok: false, message: "Invalid webhook signature" });
    return;
  }
  const order = req.body || {};
  const topic = String(req.get("x-shopify-topic") || "");
  try {
    const pinged = await notifyShopifyOrder(order, topic);
    if (pinged?.ok) {
      logInfo("Discord order ping sent", {
        orderName: order.name,
        topic,
        action: pinged.skipped ? "skipped" : "posted"
      });
    } else if (pinged?.skipped && pinged.reason !== "ignored_topic") {
      logInfo("Discord order ping skipped", { reason: pinged.reason, topic, orderName: order.name });
    }
  } catch (err) {
    logError("Discord order ping failed", err, { orderName: order.name, topic });
  }
  res.status(200).json({ ok: true });
  try {
    if (!isSheetsConfigured()) return;
    const result = await syncWorkshopSheetsForOrder(order);
    if (result.synced) {
      logInfo("Workshop sheet synced from order webhook", result);
    }
  } catch (err) {
    logError("Order webhook sheet sync failed", err);
  }
});

exports.api = onRequest(
  { timeoutSeconds: 120, secrets: [emailjsPrivateKey, geminiApiKey] },
  app
);
exports.publicInvoicePage = onRequest({ timeoutSeconds: 30 }, handlePublicInvoicePage);
exports.getLeadsApiApp = () => app;

async function pingInquiryDiscord(saved) {
  if (!saved?.id) return;
  try {
    const result = await upsertInquiryMessage(saved);
    if (result?.skipped) return;
    if (result.messageId && result.messageId !== saved.discordMessageId) {
      await patchLeadDiscordMessage(saved.id, result.messageId);
    }
    logInfo("Discord inquiry message upserted", {
      id: saved.id,
      action: result.action,
      quoteReference: saved.quoteReference
    });
  } catch (err) {
    logError("Discord inquiry ping failed", err, {
      id: saved.id,
      quoteReference: saved.quoteReference
    });
  }
}

async function pingInboxSummaryDiscord({ subject, summary, sections, framing }) {
  try {
    const result = await sendInboxSummaryToDiscord({ subject, summary, sections });
    if (result?.skipped) return result;
    logInfo("Discord inbox summary sent", { framing, chunks: result.chunks });
    return result;
  } catch (err) {
    logError("Discord inbox summary failed", err, { framing });
    return { ok: false, error: err.message };
  }
}

async function runScheduledInboxSummaryEmail(framing) {
  process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();
  const client = getChatbaseClientFromEnv();
  const built = await buildFullInboxSummary({
    client,
    windowMode: "rolling24h",
    framing
  });
  const subject = built.subject || emailSubjectForFraming(framing, built.meta?.date);
  const sent = await sendInboxSummaryEmail({
    subject,
    html: built.html
  });
  logInfo("Scheduled inbox summary email sent", { framing, ...sent, meta: built.meta });
  await pingInboxSummaryDiscord({
    subject,
    summary: built.summary,
    sections: built.sections,
    framing
  });
  return sent;
}

const scheduleOpts = {
  timeZone: "Asia/Manila",
  timeoutSeconds: 540,
  memory: "512MiB",
  secrets: [emailjsPrivateKey]
};

exports.inboxSummaryEmailMorning = onSchedule(
  { ...scheduleOpts, schedule: "0 9 * * *" },
  async () => {
    try {
      await runScheduledInboxSummaryEmail("morning");
    } catch (err) {
      logError("Morning inbox summary email failed", err);
      throw err;
    }
  }
);

exports.inboxSummaryEmailEvening = onSchedule(
  { ...scheduleOpts, schedule: "0 21 * * *" },
  async () => {
    try {
      await runScheduledInboxSummaryEmail("evening");
    } catch (err) {
      logError("Evening inbox summary email failed", err);
      throw err;
    }
  }
);

const { onDocumentWritten } = require("firebase-functions/v2/firestore");

exports.opsEventCalendarSync = onDocumentWritten(
  {
    document: "opsEvents/{eventId}",
    timeoutSeconds: 60
  },
  async (event) => {
    const eventId = event.params.eventId;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    try {
      if (!isOpsCalendarConfigured()) {
        logInfo("Ops calendar sync skipped (not configured)", { eventId });
        return;
      }
      const result = await syncOpsEventToGoogleCalendar(eventId, after);
      logInfo("Ops calendar sync", { eventId, ...result });
    } catch (err) {
      logError("Ops calendar sync failed", err, { eventId });
      throw err;
    }
  }
);
