const config = window.LEADS_DASHBOARD_CONFIG || {};

function getApiBaseUrl() {
  const raw = config.API_BASE_URL;
  if (raw === "" || raw === "SAME_ORIGIN" || raw == null) {
    const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    return origin ? `${origin}/api` : "";
  }
  return String(raw).replace(/\/+$/, "");
}

function buildUrl(path, query) {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function request(path, options = {}, query = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (config.ADMIN_API_TOKEN) headers.set("x-admin-token", config.ADMIN_API_TOKEN);

  const response = await fetch(buildUrl(path, query), {
    ...options,
    headers
  });

  const bodyText = await response.text();
  let data = {};
  try {
    data = bodyText ? JSON.parse(bodyText) : {};
  } catch (_err) {
    data = { message: bodyText };
  }

  if (!response.ok) {
    throw new Error(data.message || `Request failed with ${response.status}`);
  }
  return data;
}

export function listLeads(filters) {
  return request("/leads", { method: "GET" }, filters);
}

export function getLead(leadId) {
  return request(`/leads/${encodeURIComponent(leadId)}`, { method: "GET" });
}

export function updateLeadStatus(leadId, status, note) {
  return request(`/leads/${encodeURIComponent(leadId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, note })
  });
}

export function triggerSync() {
  return request("/sync", { method: "POST" });
}
