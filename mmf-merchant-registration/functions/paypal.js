/**
 * PayPal Invoicing API helpers for MMF merchant card payments.
 */

const { EVENT, PAYPAL_TEST_MINIMUM_DUE } = require("./payment-config");

const DEFAULT_API_BASE = "https://api-m.paypal.com";
const CURRENCY = "PHP";

function getPayPalConfig() {
  return {
    clientId: String(process.env.PAYPAL_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.PAYPAL_CLIENT_SECRET || "").trim(),
    apiBase: String(process.env.PAYPAL_API_BASE || DEFAULT_API_BASE).trim(),
    templateId: String(process.env.PAYPAL_INVOICE_TEMPLATE_ID || "").trim(),
  };
}

function formatAmountValue(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error("Invalid invoice amount");
    err.code = "PAYPAL_INVALID_AMOUNT";
    throw err;
  }
  return n.toFixed(2);
}

function resolveMinimumDue(downpaymentAmount) {
  if (PAYPAL_TEST_MINIMUM_DUE != null && Number.isFinite(Number(PAYPAL_TEST_MINIMUM_DUE))) {
    return Number(PAYPAL_TEST_MINIMUM_DUE);
  }
  return downpaymentAmount;
}

/**
 * Resolve invoice amounts + purpose from a registration doc.
 * Downpayment: one invoice for full fee (56k) with minimum due (28k, or test override).
 */
function resolveInvoiceAmount(doc) {
  const fees = doc?.feeSnapshot || {};
  const isDownpayment = doc?.settlementType === "downpayment";
  const totalDue = Number(fees.totalDue);
  const downpaymentAmount = Number(fees.downpaymentAmount);
  const lineItemTotal = totalDue;
  const minimumAmountDue = isDownpayment ? resolveMinimumDue(downpaymentAmount) : null;
  const amountDueNow = isDownpayment ? minimumAmountDue : totalDue;

  const note = isDownpayment
    ? `Manila Matcha Fest 2026 - 50% downpayment (PHP ${minimumAmountDue.toLocaleString("en-PH")} minimum due now; balance due by ${EVENT.finalPaymentDue})`
    : "Manila Matcha Fest 2026 - full participation fee";

  const itemName = isDownpayment
    ? "Manila Matcha Fest 2026 - Merchant participation fee"
    : "Manila Matcha Fest 2026 - full participation fee";

  const itemDescription = isDownpayment
    ? `Total participation fee PHP ${totalDue.toLocaleString("en-PH")}. Minimum due now PHP ${minimumAmountDue.toLocaleString("en-PH")}; remaining balance due by ${EVENT.finalPaymentDue}.`
    : undefined;

  return {
    amount: amountDueNow,
    lineItemTotal,
    minimumAmountDue,
    allowPartialPayment: isDownpayment,
    purpose: isDownpayment ? "downpayment" : "full",
    note,
    itemName,
    itemDescription,
    currency: CURRENCY,
  };
}

function formatPayPalError(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback || "PayPal request failed";
  const details = Array.isArray(payload.details) ? payload.details : [];
  const detailText = details
    .map((d) => {
      const bits = [d.issue, d.description, d.field].filter(Boolean);
      return bits.join(": ");
    })
    .filter(Boolean)
    .join("; ");
  return detailText || payload.message || fallback || "PayPal request failed";
}

function buildInvoiceNumber(registrationId) {
  return "MMF-" + String(registrationId).replace(/-/g, "").slice(0, 20);
}

function shouldReplaceCachedInvoice(cached, resolved) {
  if (!cached?.href || !cached?.id) return false;
  if (isSandboxPayPalHref(cached.href)) return true;
  if (resolved.allowPartialPayment && Number(cached.invoiceTotal ?? cached.amount) !== Number(resolved.lineItemTotal)) {
    return true;
  }
  if (resolved.allowPartialPayment && !cached.allowPartialPayment) {
    return true;
  }
  if (
    resolved.minimumAmountDue != null &&
    cached.minimumAmountDue != null &&
    Number(cached.minimumAmountDue) !== Number(resolved.minimumAmountDue)
  ) {
    return true;
  }
  return false;
}

function buildInvoiceRequest({
  email,
  brandName,
  note,
  itemName,
  itemDescription,
  lineItemTotal,
  minimumAmountDue,
  allowPartialPayment,
  invoiceNumber,
  currency = CURRENCY,
  templateId,
} = {}) {
  const recipientEmail = String(email || "").trim();
  if (!recipientEmail) {
    const err = new Error("Merchant email is required for PayPal invoice");
    err.code = "PAYPAL_NO_EMAIL";
    throw err;
  }

  const lineTotalValue = formatAmountValue(lineItemTotal);
  const body = {
    detail: {
      currency_code: currency,
      note: note || "Manila Matcha Fest 2026",
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: recipientEmail,
          business_name: String(brandName || "").trim() || undefined,
        },
      },
    ],
    items: [
      {
        name: itemName || note || "Manila Matcha Fest 2026 participation",
        description: itemDescription || undefined,
        quantity: "1",
        unit_amount: { currency_code: currency, value: lineTotalValue },
      },
    ],
    configuration: {
      tax_calculated_after_discount: false,
      tax_inclusive: false,
    },
  };

  if (invoiceNumber) {
    body.detail.invoice_number = String(invoiceNumber).slice(0, 25);
  }

  if (templateId) {
    body.detail.template_id = templateId;
  }

  if (allowPartialPayment && minimumAmountDue != null) {
    body.configuration.partial_payment = {
      allow_partial_payment: true,
      minimum_amount_due: {
        currency_code: currency,
        value: formatAmountValue(minimumAmountDue),
      },
    };
  }

  return { body, lineTotalValue, recipientEmail };
}

async function getAccessToken({ clientId, clientSecret, apiBase } = getPayPalConfig()) {
  if (!clientId || !clientSecret) {
    const err = new Error("PayPal not configured (missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)");
    err.code = "PAYPAL_NOT_CONFIGURED";
    throw err;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `PayPal auth failed (${res.status})`);
    err.code = "PAYPAL_AUTH_FAILED";
    err.status = res.status;
    throw err;
  }
  return data.access_token;
}

function extractPayerHref(invoice) {
  const links = Array.isArray(invoice?.links) ? invoice.links : [];
  const payer = links.find((l) => l.rel === "payer-view" || l.rel === "payer_view");
  if (payer?.href) return payer.href;
  if (invoice?.detail?.metadata?.recipient_view_url) {
    return invoice.detail.metadata.recipient_view_url;
  }
  if (invoice?.href) return invoice.href;
  const self = links.find((l) => l.rel === "self");
  return self?.href || null;
}

function isSandboxPayPalHref(href) {
  return /sandbox\.paypal\.com/i.test(String(href || ""));
}

/**
 * Create a draft invoice and send it. Returns { id, href, status }.
 */
async function createAndSendInvoice({
  email,
  brandName,
  amount,
  lineItemTotal,
  minimumAmountDue,
  allowPartialPayment,
  note,
  itemName,
  itemDescription,
  invoiceNumber,
  currency = CURRENCY,
} = {}) {
  const cfg = getPayPalConfig();
  const token = await getAccessToken(cfg);
  const { body, lineTotalValue } = buildInvoiceRequest({
    email,
    brandName,
    note,
    itemName,
    itemDescription,
    lineItemTotal: lineItemTotal ?? amount,
    minimumAmountDue,
    allowPartialPayment,
    invoiceNumber,
    currency,
    templateId: cfg.templateId || undefined,
  });

  const createRes = await fetch(`${cfg.apiBase}/v2/invoicing/invoices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const invoice = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    console.error("[MMF PayPal] create invoice rejected", JSON.stringify(invoice).slice(0, 800));
    const err = new Error(formatPayPalError(invoice, `PayPal create invoice failed (${createRes.status})`));
    err.code = "PAYPAL_CREATE_FAILED";
    err.status = createRes.status;
    err.paypal = invoice;
    throw err;
  }

  const invoiceId = invoice.id;
  if (!invoiceId) {
    const err = new Error("PayPal create invoice returned no id");
    err.code = "PAYPAL_CREATE_FAILED";
    throw err;
  }

  const sendRes = await fetch(`${cfg.apiBase}/v2/invoicing/invoices/${invoiceId}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      send_to_invoicer: true,
      send_to_recipient: false,
    }),
  });
  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    console.error("[MMF PayPal] send invoice rejected", JSON.stringify(sendBody).slice(0, 800));
    const err = new Error(formatPayPalError(sendBody, `PayPal send invoice failed (${sendRes.status})`));
    err.code = "PAYPAL_SEND_FAILED";
    err.status = sendRes.status;
    err.invoiceId = invoiceId;
    err.paypal = sendBody;
    throw err;
  }

  let href = extractPayerHref(sendBody) || sendBody?.href || extractPayerHref(invoice);

  if (!href) {
    const getRes = await fetch(`${cfg.apiBase}/v2/invoicing/invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const full = await getRes.json().catch(() => ({}));
    href = extractPayerHref(full);
  }

  if (!href) {
    const isSandbox = /sandbox/i.test(cfg.apiBase);
    const host = isSandbox ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
    href = `${host}/invoice/p/#${invoiceId}`;
  }

  const dueNow = Number(amount ?? minimumAmountDue ?? lineTotalValue);

  return {
    id: invoiceId,
    href,
    status: "SENT",
    amount: dueNow,
    invoiceTotal: Number(lineTotalValue),
    allowPartialPayment: Boolean(allowPartialPayment),
    currency,
  };
}

module.exports = {
  CURRENCY,
  getPayPalConfig,
  formatAmountValue,
  formatPayPalError,
  buildInvoiceNumber,
  resolveInvoiceAmount,
  shouldReplaceCachedInvoice,
  buildInvoiceRequest,
  getAccessToken,
  createAndSendInvoice,
  extractPayerHref,
  isSandboxPayPalHref,
};
