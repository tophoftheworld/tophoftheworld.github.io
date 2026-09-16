const { SECTION_LABELS } = require("./inbox-summary");

const DISCORD_CONTENT_LIMIT = 2000;
const DISCORD_CHUNK_LIMIT = 1980;
const DASHBOARD_LEADS_URL = "https://matchanese-attendance.web.app/?tab=leads";

function getInboxWebhookUrl() {
  return String(process.env.DISCORD_INBOX_WEBHOOK_URL || "").trim();
}

function getInquiriesWebhookUrl() {
  return String(process.env.DISCORD_INQUIRIES_WEBHOOK_URL || "").trim();
}

function getOrdersWebhookUrl() {
  return String(process.env.DISCORD_ORDERS_WEBHOOK_URL || "").trim();
}

function chunkText(text, limit = DISCORD_CONTENT_LIMIT) {
  const src = String(text ?? "");
  if (!src) return [];
  if (src.length <= limit) return [src];

  const chunks = [];
  let remaining = src;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < 1) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function withWait(url) {
  const u = new URL(url);
  u.searchParams.set("wait", "true");
  return u.toString();
}

function inquiryMessageUrl(webhookUrl, messageId) {
  const base = String(webhookUrl || "").split("?")[0].replace(/\/$/, "");
  return `${base}/messages/${encodeURIComponent(messageId)}`;
}

async function executeWebhook(url, { method = "POST", payload, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const bodyText = await response.text();
  if (!response.ok) {
    const err = new Error(
      `Discord webhook failed (${response.status}): ${bodyText.slice(0, 300) || response.statusText}`
    );
    err.status = response.status;
    throw err;
  }
  let parsed = null;
  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText);
    } catch (_err) {
      parsed = null;
    }
  }
  return {
    ok: true,
    status: response.status,
    messageId: parsed?.id ? String(parsed.id) : null,
    body: parsed
  };
}

async function postWebhook(url, payload, fetchImpl = fetch) {
  return executeWebhook(url, { method: "POST", payload, fetchImpl });
}

const SERVICE_LABELS = {
  private_mobile_matcha_bar: "Private Mobile Matcha Bar",
  private_matcha_workshop: "Private Matcha Workshop"
};

const PIPELINE_LABELS = {
  inquiry: "Inquiry",
  quoted: "Quoted",
  invoiced: "Invoiced",
  deposit: "Deposit",
  completed: "Completed"
};

const PROFILE_LABELS = {
  draft: "Incomplete",
  complete: "Complete"
};

function isBlankDisplay(value) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  return /^(n\/a|na|none|null|undefined|—|-)$/i.test(text);
}

function humanizeSlug(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (SERVICE_LABELS[text]) return SERVICE_LABELS[text];
  if (!text.includes("_")) return text;
  return text
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatInquiryDate(value) {
  const text = String(value || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!iso) return text;
  const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatService(value) {
  if (isBlankDisplay(value)) return "";
  return humanizeSlug(value);
}

function formatPipeline(value) {
  if (isBlankDisplay(value)) return "";
  const key = String(value).trim().toLowerCase();
  return PIPELINE_LABELS[key] || humanizeSlug(value);
}

function formatProfile(value) {
  if (isBlankDisplay(value)) return "";
  const key = String(value).trim().toLowerCase();
  return PROFILE_LABELS[key] || humanizeSlug(value);
}

function embedField(name, value, inline = true) {
  if (isBlankDisplay(value)) return null;
  return { name, value: String(value).trim().slice(0, 1024), inline };
}

function isNewInquiryCard(lead = {}) {
  if (lead.created === true) return true;
  if (lead.created === false) return false;
  return !String(lead.discordMessageId || "").trim();
}

function buildInquiryEmbed(lead = {}) {
  const isNew = isNewInquiryCard(lead);
  const name = String(lead.clientName || "").trim();
  const prefix = isNew ? "New inquiry" : "Inquiry updated";
  const title = (name ? `${prefix}: ${name}` : prefix).slice(0, 256);
  const fields = [
    embedField("Quote ref", lead.quoteReference),
    embedField("Service", formatService(lead.service)),
    embedField("Event", isBlankDisplay(lead.eventType) ? "" : String(lead.eventType).trim()),
    embedField("Date", formatInquiryDate(lead.targetDate)),
    embedField("Pax / cups", lead.targetPax),
    embedField("Venue", lead.targetVenue),
    embedField("Price", lead.quotedPrice),
    embedField("Status", formatPipeline(lead.pipelineStatus)),
    embedField("Profile", formatProfile(lead.profileStatus)),
    embedField("Notes", lead.notes, false)
  ].filter(Boolean);

  return {
    title,
    url: DASHBOARD_LEADS_URL,
    color: isNew ? 0x2d6a4f : 0xbc6c25,
    fields,
    timestamp: new Date().toISOString()
  };
}

function inquiryPayload(lead) {
  return {
    username: "Inquiries",
    embeds: [buildInquiryEmbed(lead)]
  };
}

function packSection(label, items) {
  const header = `**${label}**`;
  const messages = [];
  let lines = [header];
  for (const raw of items) {
    const item = String(raw || "").trim();
    if (!item) continue;
    const bullet = item.startsWith("- ") ? item : `- ${item}`;
    const candidate = `${lines.join("\n")}\n${bullet}`;
    if (candidate.length <= DISCORD_CONTENT_LIMIT) {
      lines.push(bullet);
      continue;
    }
    if (lines.length > 1) {
      messages.push(lines.join("\n"));
      lines = [header, bullet];
      if (lines.join("\n").length > DISCORD_CONTENT_LIMIT) {
        messages.push(...chunkText(lines.join("\n"), DISCORD_CONTENT_LIMIT));
        lines = [header];
      }
      continue;
    }
    messages.push(...chunkText(`${header}\n${bullet}`, DISCORD_CONTENT_LIMIT));
  }
  if (lines.length > 1) messages.push(lines.join("\n"));
  return messages;
}

function blocksFromSections(sections) {
  if (!sections || typeof sections !== "object") return [];
  const blocks = [];
  for (const [key, label] of SECTION_LABELS) {
    const items = (sections[key] || [])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!items.length) continue;
    blocks.push(...packSection(label, items));
  }
  return blocks;
}

function blocksFromSummaryText(summary) {
  const text = String(summary || "").trim();
  if (!text) return [];
  const labels = SECTION_LABELS.map(([, label]) => label);
  const byLower = new Map(labels.map((label) => [label.toLowerCase(), label]));
  const grouped = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const heading = byLower.get(trimmed.toLowerCase());
    if (heading) {
      if (current?.items.length) grouped.push(current);
      current = { label: heading, items: [] };
      continue;
    }
    if (!current) current = { label: "Summary", items: [] };
    current.items.push(trimmed.replace(/^-\s+/, ""));
  }
  if (current?.items.length) grouped.push(current);
  const blocks = [];
  for (const group of grouped) {
    blocks.push(...packSection(group.label, group.items));
  }
  return blocks;
}

function buildInboxSummaryMessages({ subject, sections, summary } = {}) {
  const header = String(subject || "Inbox summary").trim() || "Inbox summary";
  const blocks = blocksFromSections(sections);
  const parts = blocks.length ? blocks : blocksFromSummaryText(summary);
  if (!parts.length) return [`**${header}**\n\n(empty summary)`];

  const firstWithSubject = `**${header}**\n\n${parts[0]}`;
  if (firstWithSubject.length <= DISCORD_CONTENT_LIMIT) {
    return [firstWithSubject, ...parts.slice(1)];
  }
  return [`**${header}**`, ...parts];
}

async function sendInboxSummaryToDiscord(
  { subject, summary, sections } = {},
  { fetchImpl = fetch, webhookUrl = getInboxWebhookUrl() } = {}
) {
  if (!webhookUrl) return { ok: false, skipped: true, reason: "missing_webhook" };

  const messages = buildInboxSummaryMessages({ subject, summary, sections });
  for (const content of messages) {
    await postWebhook(webhookUrl, { username: "Inbox Summary", content }, fetchImpl);
  }
  return { ok: true, chunks: messages.length };
}

async function upsertInquiryMessage(
  lead,
  { fetchImpl = fetch, webhookUrl = getInquiriesWebhookUrl() } = {}
) {
  if (!webhookUrl) return { ok: false, skipped: true, reason: "missing_webhook" };

  const payload = inquiryPayload(lead || {});
  const existingId = String(lead?.discordMessageId || "").trim();

  if (existingId) {
    try {
      const edited = await executeWebhook(inquiryMessageUrl(webhookUrl, existingId), {
        method: "PATCH",
        payload,
        fetchImpl
      });
      return { ok: true, action: "edited", messageId: edited.messageId || existingId };
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  const posted = await executeWebhook(withWait(webhookUrl), {
    method: "POST",
    payload,
    fetchImpl
  });
  return {
    ok: true,
    action: existingId ? "reposted" : "posted",
    messageId: posted.messageId
  };
}

/** @deprecated use upsertInquiryMessage */
async function notifyNewInquiry(lead, opts) {
  return upsertInquiryMessage(lead, opts);
}

const ORDER_NOTIFY_TOPICS = new Set(["", "orders/create", "orders/paid"]);

const FINANCIAL_STATUS_LABELS = {
  pending: "Unpaid",
  authorized: "Authorized",
  partially_paid: "Partially paid",
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  voided: "Voided"
};

function shouldNotifyShopifyOrder(topic) {
  const key = String(topic || "").trim().toLowerCase();
  return ORDER_NOTIFY_TOPICS.has(key);
}

function shopifyAdminOrderUrl(orderId) {
  const shop = String(process.env.SHOPIFY_SHOP || "")
    .replace(/\.myshopify\.com$/i, "")
    .trim();
  const id = String(orderId || "").replace(/\D/g, "");
  if (!shop || !id) return "https://matchanese-attendance.web.app/shopify/";
  return `https://admin.shopify.com/store/${shop}/orders/${id}`;
}

function orderLinkMarkdown(order = {}) {
  const name = String(order.name || "").trim() || "Order";
  const url = shopifyAdminOrderUrl(order.id);
  return `[${name}](${url})`;
}

function orderCustomerName(order = {}) {
  const customer = order.customer || {};
  const fromCustomer = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
  if (fromCustomer) return fromCustomer;
  const billing = order.billing_address || {};
  if (billing.name) return String(billing.name).trim();
  const email = order.email || customer.email;
  return email ? String(email).trim() : "";
}

function formatOrderMoney(amount, currency) {
  const n = Number(amount);
  const code = String(currency || "PHP").toUpperCase();
  const prefix = code === "PHP" ? "Php" : `${code} `;
  if (!Number.isFinite(n)) {
    const raw = String(amount || "").trim();
    return raw ? `${prefix}${raw}` : "";
  }
  return `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function formatLineItems(items) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((item) => item && (item.title || item.name))
    .map((item) => {
      const qty = Number(item.quantity) || 1;
      const title = String(item.title || item.name || "Item").trim();
      const variant = String(item.variant_title || "").trim();
      const suffix = variant && variant.toLowerCase() !== "default title" ? ` (${variant})` : "";
      return `${qty}× ${title}${suffix}`;
    });
  if (!rows.length) return "";
  let text = rows.join("\n");
  if (text.length <= 1024) return text;
  const kept = [];
  for (const row of rows) {
    const next = [...kept, row].join("\n");
    if (next.length > 980) break;
    kept.push(row);
  }
  const hidden = rows.length - kept.length;
  return `${kept.join("\n")}\n+${hidden} more`;
}

function orderFulfillmentLabel(order = {}) {
  if (order.cancelled_at) return "Cancelled";
  const status = String(order.fulfillment_status || "").trim().toLowerCase();
  if (!status) return "Unfulfilled";
  if (status === "fulfilled") return "Fulfilled";
  if (status === "partial") return "Partially fulfilled";
  return humanizeSlug(status);
}

function buildOrderEmbed(order = {}, topic = "") {
  const name = String(order.name || "").trim() || "Order";
  const paid = String(order.financial_status || "").toLowerCase() === "paid";
  const topicKey = String(topic || "").toLowerCase();
  let prefix = "New order";
  if (order.cancelled_at) prefix = "Cancelled order";
  else if (topicKey === "orders/paid" || paid) prefix = "Order paid";
  const title = `${prefix} ${name}`.slice(0, 256);
  const items = formatLineItems(order.line_items);
  const destination =
    order.shipping_address?.city ||
    order.shipping_lines?.[0]?.title ||
    "";
  const orderUrl = shopifyAdminOrderUrl(order.id);
  const fields = [
    embedField("Order", orderLinkMarkdown(order)),
    embedField("Customer", orderCustomerName(order)),
    embedField("Total", formatOrderMoney(order.total_price, order.currency)),
    embedField("Payment", FINANCIAL_STATUS_LABELS[String(order.financial_status || "").toLowerCase()] || formatPipeline(order.financial_status)),
    embedField("Fulfillment", orderFulfillmentLabel(order)),
    embedField("Ship / pickup", destination),
    embedField("Items", items, false),
    embedField("Note", order.note, false)
  ].filter(Boolean);

  return {
    title,
    url: orderUrl,
    color: order.cancelled_at ? 0x9b2226 : paid ? 0x2d6a4f : 0xbc6c25,
    fields,
    timestamp: order.created_at || new Date().toISOString()
  };
}

async function notifyShopifyOrder(
  order,
  topic = "",
  { fetchImpl = fetch, webhookUrl = getOrdersWebhookUrl() } = {}
) {
  if (!shouldNotifyShopifyOrder(topic)) {
    return { ok: false, skipped: true, reason: "ignored_topic" };
  }
  if (!webhookUrl) return { ok: false, skipped: true, reason: "missing_webhook" };
  if (!order || typeof order !== "object" || (!order.id && !order.name)) {
    return { ok: false, skipped: true, reason: "empty_order" };
  }
  await postWebhook(
    webhookUrl,
    { username: "Orders", embeds: [buildOrderEmbed(order, topic)] },
    fetchImpl
  );
  return { ok: true };
}

module.exports = {
  DISCORD_CONTENT_LIMIT,
  DISCORD_CHUNK_LIMIT,
  DASHBOARD_LEADS_URL,
  chunkText,
  withWait,
  inquiryMessageUrl,
  buildInquiryEmbed,
  formatService,
  formatInquiryDate,
  isNewInquiryCard,
  postWebhook,
  executeWebhook,
  sendInboxSummaryToDiscord,
  buildInboxSummaryMessages,
  packSection,
  upsertInquiryMessage,
  notifyNewInquiry,
  shouldNotifyShopifyOrder,
  shopifyAdminOrderUrl,
  orderLinkMarkdown,
  buildOrderEmbed,
  notifyShopifyOrder,
  formatOrderMoney,
  getInboxWebhookUrl,
  getInquiriesWebhookUrl,
  getOrdersWebhookUrl
};
