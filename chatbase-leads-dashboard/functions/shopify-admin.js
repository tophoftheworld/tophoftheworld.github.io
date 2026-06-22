const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

let cachedOAuthToken = null;
let cachedOAuthExpiry = 0;

function getShop() {
  return (process.env.SHOPIFY_SHOP || "").replace(/\.myshopify\.com$/i, "").trim();
}

function hasShopifyConfig() {
  const shop = getShop();
  const staticToken = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
  const clientId = (process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
  return Boolean(shop && (staticToken || (clientId && clientSecret)));
}

async function resolveAccessToken() {
  const staticToken = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
  if (staticToken) return staticToken;

  const shop = getShop();
  const clientId = (process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
  if (!shop || !clientId || !clientSecret) {
    throw new Error("Missing SHOPIFY_SHOP and credentials in environment");
  }

  const now = Date.now();
  if (cachedOAuthToken && now < cachedOAuthExpiry - 60_000) {
    return cachedOAuthToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });
  const res = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Shopify OAuth ${res.status}`);
  }
  cachedOAuthToken = data.access_token;
  cachedOAuthExpiry = now + (data.expires_in || 3600) * 1000;
  return cachedOAuthToken;
}

async function shopifyGraphql(query, variables = {}) {
  const shop = getShop();
  const token = await resolveAccessToken();
  const res = await fetch(
    `https://${shop}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    }
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.errors?.[0]?.message || res.statusText);
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }
  return payload.data;
}

function graphqlUserErrors(result, key) {
  const block = result?.[key];
  const errs = block?.userErrors;
  if (errs?.length) {
    throw new Error(errs.map((e) => e.message).join("; "));
  }
  return block;
}

function orderGid(orderId) {
  return `gid://shopify/Order/${orderId}`;
}

function gidToNumericId(gid) {
  if (!gid) return null;
  const parts = String(gid).split("/");
  return parts[parts.length - 1] || null;
}

function normalizeFinancialStatus(raw) {
  return String(raw || "pending").toLowerCase().replace(/\s+/g, "_");
}

function dedupeRepeatedNameTokens(name) {
  const tokens = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 2) return String(name || "").trim() || null;
  const last = tokens[tokens.length - 1].toLowerCase();
  const secondLast = tokens[tokens.length - 2].toLowerCase();
  if (last === secondLast) {
    return tokens.slice(0, -1).join(" ");
  }
  return tokens.join(" ");
}

function cleanCustomerName(firstName, lastName, displayName) {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  const display = String(displayName || "").trim();
  const fromParts = [first, last].filter(Boolean).join(" ").trim();

  if (first && last && first.toLowerCase().endsWith(last.toLowerCase())) {
    const firstOnly = first.slice(0, first.length - last.length).trim();
    if (first.split(/\s+/).length >= 2 && !firstOnly) {
      return dedupeRepeatedNameTokens(first);
    }
    if (firstOnly) {
      return dedupeRepeatedNameTokens([firstOnly, last].join(" "));
    }
  }

  if (fromParts) {
    return dedupeRepeatedNameTokens(fromParts);
  }

  return dedupeRepeatedNameTokens(display);
}

function mapOrderNode(node) {
  if (!node) return null;
  const id = gidToNumericId(node.id);
  const customer = node.customer || {};
  const billing = node.billingAddress || {};
  const customerName = cleanCustomerName(
    billing.firstName || customer.firstName,
    billing.lastName || customer.lastName,
    customer.displayName
  );
  return {
    id,
    name: node.name || "",
    createdAt: node.createdAt || null,
    financialStatus: normalizeFinancialStatus(node.displayFinancialStatus),
    customerName,
    customerEmail: customer.email || null
  };
}

function normalizeOrderNumber(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;

  const mHash = s.match(/^M#?(\d+)$/);
  if (mHash) return `M#${mHash[1]}`;

  const hashOnly = s.match(/^#(\d+)$/);
  if (hashOnly) return `M#${hashOnly[1]}`;

  const digitsOnly = s.match(/^(\d+)$/);
  if (digitsOnly) return `M#${digitsOnly[1]}`;

  if (/^M#\d+$/.test(s)) return s;
  return s;
}

function normalizeNameForMatch(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(provided, orderName) {
  const a = normalizeNameForMatch(provided);
  const b = normalizeNameForMatch(orderName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aTokens = a.split(" ").filter((t) => t.length > 1);
  const bTokens = b.split(" ").filter((t) => t.length > 1);
  if (!aTokens.length || !bTokens.length) return false;
  const overlap = aTokens.filter((t) => bTokens.includes(t));
  return overlap.length >= Math.min(2, Math.min(aTokens.length, bTokens.length));
}

const ORDER_BY_NAME_QUERY = `
  query OrderByName($query: String!) {
    orders(first: 5, query: $query) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          customer { displayName email firstName lastName }
          billingAddress { firstName lastName }
        }
      }
    }
  }
`;

const UNPAID_ORDERS_QUERY = `
  query UnpaidOrders($query: String!) {
    orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          customer { displayName email firstName lastName }
          billingAddress { firstName lastName }
        }
      }
    }
  }
`;

async function findOrderByName(orderNumber) {
  const normalized = normalizeOrderNumber(orderNumber);
  if (!normalized) return null;

  const queries = [`name:${normalized}`, `name:'${normalized}'`];
  for (const q of queries) {
    const data = await shopifyGraphql(ORDER_BY_NAME_QUERY, { query: q });
    const nodes = (data?.orders?.edges || []).map((e) => mapOrderNode(e.node)).filter(Boolean);
    const exact = nodes.find((o) => o.name.toUpperCase() === normalized.toUpperCase());
    if (exact) return { order: exact, matchMethod: "order_number" };
    if (nodes.length === 1) return { order: nodes[0], matchMethod: "order_number" };
  }
  return null;
}

async function findOrdersByCustomerName(clientName) {
  const needle = normalizeNameForMatch(clientName);
  if (!needle) return [];

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceIso = since.toISOString().slice(0, 10);
  const query = `financial_status:pending OR financial_status:partially_paid created_at:>=${sinceIso}`;
  const data = await shopifyGraphql(UNPAID_ORDERS_QUERY, { query });
  return (data?.orders?.edges || [])
    .map((e) => mapOrderNode(e.node))
    .filter((o) => o && namesMatch(clientName, o.customerName));
}

async function findOrderByCustomerName(clientName) {
  const candidates = await findOrdersByCustomerName(clientName);
  if (candidates.length === 1) {
    return { order: candidates[0], matchMethod: "customer_name" };
  }
  return null;
}

async function findOrder({ orderNumber, clientName }) {
  if (!hasShopifyConfig()) {
    throw new Error("Shopify is not configured on the server");
  }

  if (orderNumber) {
    const byName = await findOrderByName(orderNumber);
    if (byName) return byName;
  }

  if (clientName) {
    const candidates = await findOrdersByCustomerName(clientName);
    if (candidates.length > 1) {
      return { ambiguous: true, count: candidates.length };
    }
    if (candidates.length === 1) {
      return { order: candidates[0], matchMethod: "customer_name" };
    }
  }

  return null;
}

async function markOrderPaid(shopifyOrderId) {
  const data = await shopifyGraphql(
    `mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) {
        order { id displayFinancialStatus }
        userErrors { field message }
      }
    }`,
    { input: { id: orderGid(shopifyOrderId) } }
  );
  graphqlUserErrors(data, "orderMarkAsPaid");
  return { ok: true, at: new Date().toISOString() };
}

function resolveIntakeClientName(provided, order, matchMethod) {
  const shopify = order?.customerName?.trim() || null;
  const fromChat = dedupeRepeatedNameTokens(provided);

  if (matchMethod === "order_number" && shopify) {
    return shopify;
  }

  if (shopify && fromChat) {
    if (namesMatch(fromChat, shopify)) return shopify;
    return fromChat;
  }

  return fromChat || shopify || null;
}

module.exports = {
  hasShopifyConfig,
  normalizeOrderNumber,
  normalizeNameForMatch,
  namesMatch,
  dedupeRepeatedNameTokens,
  cleanCustomerName,
  resolveIntakeClientName,
  findOrder,
  findOrdersByCustomerName,
  markOrderPaid,
  mapOrderNode
};
