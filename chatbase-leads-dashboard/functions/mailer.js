const EMAILJS_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

function getEmailConfig() {
  const serviceId = process.env.EMAILJS_SERVICE_ID || "service_1085n74";
  // Reuse the daily-sales / POS HTML template (expects {{{message}}} / {{subject}} / {{to_email}})
  const templateId =
    process.env.EMAILJS_SUMMARY_TEMPLATE_ID ||
    process.env.EMAILJS_TEMPLATE_ID ||
    "template_6zh5mq8";
  const publicKey = process.env.EMAILJS_PUBLIC_KEY || "Jxzqofh9mPAsb9V0M";
  const privateKey = process.env.EMAILJS_PRIVATE_KEY || "";
  const to = process.env.SUMMARY_EMAIL_TO || "hi@matchanese.com";

  return { serviceId, templateId, publicKey, privateKey, to };
}

function assertEmailConfigured() {
  const cfg = getEmailConfig();
  const missing = [];
  if (!cfg.serviceId) missing.push("EMAILJS_SERVICE_ID");
  if (!cfg.templateId) missing.push("EMAILJS_SUMMARY_TEMPLATE_ID");
  if (!cfg.publicKey) missing.push("EMAILJS_PUBLIC_KEY");
  if (!cfg.privateKey) missing.push("EMAILJS_PRIVATE_KEY");
  if (missing.length) {
    const err = new Error(`Email not configured (missing ${missing.join(", ")})`);
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  return cfg;
}

/**
 * Send HTML email via EmailJS REST API (non-browser).
 * Same service/template as daily-sales / MMF / inbox summaries.
 * Template should include {{{message}}} (or {{{summary_html}}}), {{subject}}, {{to_email}}, {{from_name}}.
 */
async function sendEmail({ to, subject, html, fromName } = {}) {
  const cfg = assertEmailConfigured();
  const recipient = String(to || "").trim();
  if (!recipient) {
    const err = new Error("Recipient email is required");
    err.code = "EMAIL_NO_RECIPIENT";
    throw err;
  }

  const payload = {
    service_id: cfg.serviceId,
    template_id: cfg.templateId,
    user_id: cfg.publicKey,
    accessToken: cfg.privateKey,
    template_params: {
      to_email: recipient,
      from_name: fromName || "Matchanese",
      subject: subject || "Matchanese",
      message: html || "",
      summary_html: html || ""
    }
  };

  const response = await fetch(EMAILJS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  if (!response.ok) {
    const err = new Error(
      `EmailJS send failed (${response.status}): ${bodyText.slice(0, 300) || response.statusText}`
    );
    err.code = "EMAILJS_SEND_FAILED";
    err.status = response.status;
    throw err;
  }

  return {
    ok: true,
    to: recipient,
    subject: payload.template_params.subject,
    provider: "emailjs"
  };
}

/**
 * Send inbox summary via EmailJS REST API (non-browser).
 * Requires EmailJS Account → Security → "Allow EmailJS API for non-browser applications".
 * Template should include {{{summary_html}}} (unescaped HTML) plus {{subject}} / {{to_email}}.
 */
async function sendInboxSummaryEmail({ to, subject, html, fromName } = {}) {
  const cfg = assertEmailConfigured();
  if (!cfg.to && !to) {
    const err = new Error("Email not configured (missing SUMMARY_EMAIL_TO)");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  return sendEmail({
    to: to || cfg.to,
    subject: subject || "Inbox summary",
    html,
    fromName: fromName || "Matchanese Inbox"
  });
}

module.exports = {
  getEmailConfig,
  assertEmailConfigured,
  sendEmail,
  sendInboxSummaryEmail
};
