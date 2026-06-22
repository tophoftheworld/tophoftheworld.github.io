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
const { generateInboxSummary } = require("./inbox-summary");

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

app.use(express.json());
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) {
    req.url = req.url.slice(4) || "/";
  }
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, time: nowIso() });
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

    const result = await generateInboxSummary({ client, date, filteredSources, batch, pendingBatch });
    logInfo("Inbox summary batch generated", result.meta);
    res.status(200).json({ data: result });
  } catch (err) {
    logError("Inbox summary failed", err);
    res.status(500).json({ message: err.message });
  }
}

app.get(["/inbox/summary", "/api/inbox/summary"], handleInboxSummary);
app.post(["/inbox/summary", "/api/inbox/summary"], handleInboxSummary);

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
    res.status(200).json({ ok: true, data: result.data });
  } catch (err) {
    logError("Update service lead failed", err, { id: req.params.id });
    res.status(500).json({ ok: false, message: err.message });
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

exports.api = onRequest(app);
exports.getLeadsApiApp = () => app;
