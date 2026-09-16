const EMAILJS_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

function getEmailConfig() {
  return {
    serviceId: process.env.EMAILJS_SERVICE_ID || "service_1085n74",
    templateId: process.env.EMAILJS_TEMPLATE_ID || "template_6zh5mq8",
    publicKey: process.env.EMAILJS_PUBLIC_KEY || "Jxzqofh9mPAsb9V0M",
    privateKey: process.env.EMAILJS_PRIVATE_KEY || "",
    notifyEmail: process.env.MMF_NOTIFY_EMAIL || "hi@matchanese.com",
  };
}

function assertEmailConfigured() {
  const cfg = getEmailConfig();
  const missing = [];
  if (!cfg.serviceId) missing.push("EMAILJS_SERVICE_ID");
  if (!cfg.templateId) missing.push("EMAILJS_TEMPLATE_ID");
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
 * Send email via EmailJS REST API (non-browser).
 * Template should include {{{message}}} (raw HTML), {{subject}}, {{to_email}}, {{from_name}}.
 */
async function sendEmail({ to, subject, html, fromName } = {}) {
  const cfg = assertEmailConfigured();
  if (!to) {
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
      to_email: to,
      from_name: fromName || "Manila Matcha Fest",
      subject: subject || "Manila Matcha Fest",
      message: html || "",
      summary_html: html || "",
    },
  };

  const response = await fetch(EMAILJS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

  return { ok: true, to, subject, provider: "emailjs" };
}

module.exports = {
  getEmailConfig,
  assertEmailConfigured,
  sendEmail,
};
