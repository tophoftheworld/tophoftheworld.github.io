const { normalizeToken, getPublicInvoiceByToken } = require("./public-invoice");
const { sendEmail } = require("./mailer");

const PUBLIC_INVOICE_ORIGIN = "https://matchanese-invoice.web.app";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function invoicePageUrl(token) {
  return `${PUBLIC_INVOICE_ORIGIN}/i/${token}`;
}

function plainInvoiceMessageToHtml(message, invoiceUrl) {
  const text = String(message || "").trim();
  if (!text) return "";
  const url = String(invoiceUrl || "").trim();

  let working = text;
  if (url) {
    // Drop any pasted raw invoice URL — the labeled link replaces it.
    working = working.split(url).join("@@INVOICE_LINK@@");
    working = working.replace(
      /https?:\/\/matchanese-invoice\.web\.app\/i\/[A-Za-z0-9_-]+/gi,
      "@@INVOICE_LINK@@"
    );
    // Turn the "View your invoice" label into the clickable link.
    working = working.replace(/View your invoice/gi, "@@INVOICE_LINK@@");
    // Collapse repeated placeholders from label+URL pairs.
    working = working.replace(/(?:@@INVOICE_LINK@@\s*){2,}/g, "@@INVOICE_LINK@@");
  }

  let html = escapeHtml(working).replace(/\r\n|\r|\n/g, "<br>\n");
  if (url) {
    const anchor = `<a href="${escapeHtml(url)}" style="color:#2b9348;font-weight:600;text-decoration:underline;">View your invoice</a>`;
    if (html.includes("@@INVOICE_LINK@@")) {
      html = html.split("@@INVOICE_LINK@@").join(anchor);
    } else {
      html += `<br><br>${anchor}`;
    }
  }
  return html;
}

function wrapInvoiceEmailHtml(bodyHtml) {
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1f2a22;max-width:36rem;">',
    bodyHtml,
    "</div>"
  ].join("");
}

async function sendPublicInvoiceEmail({ token, to, subject, message } = {}) {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }

  const recipient = String(to || "").trim();
  if (!recipient || !EMAIL_RE.test(recipient)) {
    return { ok: false, status: 400, message: "Enter a valid client email address" };
  }

  const subjectText = String(subject || "").trim();
  if (!subjectText) {
    return { ok: false, status: 400, message: "Subject cannot be empty" };
  }

  const messageText = String(message || "").trim();
  if (!messageText) {
    return { ok: false, status: 400, message: "Message cannot be empty" };
  }

  const invoice = await getPublicInvoiceByToken(normalized);
  if (!invoice.ok) {
    return { ok: false, status: invoice.status || 404, message: invoice.message || "Invoice not found" };
  }

  const url = invoicePageUrl(normalized);
  const bodyHtml = plainInvoiceMessageToHtml(messageText, url);
  const html = wrapInvoiceEmailHtml(bodyHtml);

  const sent = await sendEmail({
    to: recipient,
    subject: subjectText,
    html,
    fromName: "Matchanese"
  });

  return {
    ok: true,
    data: {
      ...sent,
      invoiceUrl: url,
      invoiceNumber: invoice.data?.invoiceNumber || ""
    }
  };
}

module.exports = {
  EMAIL_RE,
  invoicePageUrl,
  plainInvoiceMessageToHtml,
  wrapInvoiceEmailHtml,
  sendPublicInvoiceEmail
};
