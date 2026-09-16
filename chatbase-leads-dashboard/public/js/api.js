const config = window.CHATBASE_DASHBOARD_CONFIG || {};
const REQUEST_TIMEOUT_MS = 45_000;
const SUMMARY_TIMEOUT_MS = 120_000;
const FIREBASE_API_BASE = "https://matchanese-attendance.web.app/api";

const SAME_ORIGIN_API_HOSTS = new Set([
  "matchanese-attendance.web.app",
  "matchanese-attendance.firebaseapp.com",
  "localhost",
  "127.0.0.1"
]);

function ensureApiSuffix(base) {
  const text = String(base || "").replace(/\/+$/, "");
  if (!text) return FIREBASE_API_BASE;
  return text.endsWith("/api") ? text : `${text}/api`;
}

function canUseSameOriginApi() {
  const hostname =
    typeof window !== "undefined" && window.location?.hostname ? window.location.hostname : "";
  const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
  const port = typeof window !== "undefined" && window.location?.port ? window.location.port : "";
  if (!hostname || !origin) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    // Hub dev server (:8080), Firebase hosting emulator (:5000), legacy hub (:8788).
    return port === "8080" || port === "5000" || port === "8788";
  }
  return SAME_ORIGIN_API_HOSTS.has(hostname);
}

function getApiBaseUrl(overrideBase) {
  if (overrideBase) return ensureApiSuffix(overrideBase);

  const raw = config.API_BASE_URL;
  if (raw && raw !== "" && raw !== "SAME_ORIGIN") {
    const text = String(raw).replace(/\/+$/, "");
    if (text.startsWith("http://") || text.startsWith("https://")) {
      return ensureApiSuffix(text);
    }
    const rel = text.startsWith("/") ? text : `/${text}`;
    if (canUseSameOriginApi()) {
      return ensureApiSuffix(`${window.location.origin}${rel}`);
    }
    return ensureApiSuffix(`https://matchanese-attendance.web.app${rel}`);
  }

  if (canUseSameOriginApi()) {
    return `${window.location.origin}/api`;
  }

  return FIREBASE_API_BASE;
}

function buildUrl(path, query, apiBase) {
  const baseUrl = getApiBaseUrl(apiBase).replace(/\/+$/, "");
  const rel = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(rel, `${baseUrl}/`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function request(path, options = {}, query = {}, { timeoutMs, apiBase } = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (config.ADMIN_API_TOKEN) headers.set("x-admin-token", config.ADMIN_API_TOKEN);

  const response = await fetch(buildUrl(path, query, apiBase), {
    ...options,
    headers,
    signal: AbortSignal.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS)
  });

  const bodyText = await response.text();
  let data = {};
  try {
    data = bodyText ? JSON.parse(bodyText) : {};
  } catch (_err) {
    data = { message: bodyText };
  }

  if (!response.ok) {
    const fallback =
      typeof data.message === "string" && data.message.length < 200
        ? data.message
        : `Request failed with ${response.status}`;
    throw new Error(fallback);
  }
  return data;
}

export function listConversationsPage(params) {
  return request("/conversations", { method: "GET" }, params);
}

export function getConversation(conversationId, params) {
  return request(`/conversations/${encodeURIComponent(conversationId)}`, { method: "GET" }, params);
}

export function listServiceLeads(params) {
  return request("/service-leads", { method: "GET" }, params);
}

export function createServiceLead(payload) {
  return request("/service-leads", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateServiceLead(id, patch) {
  return request(`/service-leads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteServiceLeads(ids) {
  return request("/service-leads/delete", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export function promoteServiceLeadToEvent(id) {
  return request(`/service-leads/${encodeURIComponent(id)}/promote-event`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function listPaymentIntakes(params) {
  return request("/payment-intakes", { method: "GET" }, params);
}

export function getPaymentIntakeByOrder(shopifyOrderId) {
  return request(`/payment-intakes/by-order/${encodeURIComponent(shopifyOrderId)}`, {
    method: "GET"
  });
}

export function getPaymentIntakesByOrders(ids) {
  return request("/payment-intakes/by-orders", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export function deletePaymentIntakes(ids) {
  return request("/payment-intakes/delete", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export function resolveLeadConversation(id) {
  return request(`/service-leads/${encodeURIComponent(id)}/resolve-conversation`, {
    method: "POST"
  });
}

export function resolvePaymentConversation(id) {
  return request(`/payment-intakes/${encodeURIComponent(id)}/resolve-conversation`, {
    method: "POST"
  });
}

/** Chatbase-only lookup — works on localhost without Firestore credentials. */
export function findConversationByQuote({ quoteReference, loggedAt, anchorDate }) {
  return request("/conversations/resolve/quote", {
    method: "POST",
    body: JSON.stringify({ quoteReference, loggedAt, anchorDate })
  });
}

export function findConversationByOrder({ orderNumber, loggedAt, anchorDate }) {
  return request("/conversations/resolve/order", {
    method: "POST",
    body: JSON.stringify({ orderNumber, loggedAt, anchorDate })
  });
}

export function fetchInboxSummary({ date, filteredSources, batch, pendingBatch, windowMode } = {}) {
  const query = { date, filteredSources };
  if (windowMode) query.windowMode = windowMode;
  if (pendingBatch != null && pendingBatch !== "") {
    query.pendingBatch = pendingBatch;
  } else {
    query.batch = batch ?? 0;
  }
  return request(
    "/inbox/summary",
    { method: "GET" },
    query,
    { timeoutMs: SUMMARY_TIMEOUT_MS, apiBase: FIREBASE_API_BASE }
  );
}

export function sendInboxSummaryEmail(payload = {}) {
  return request(
    "/inbox/summary/email",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    {},
    { timeoutMs: SUMMARY_TIMEOUT_MS, apiBase: FIREBASE_API_BASE }
  );
}
