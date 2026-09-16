const ADMIN_URL = process.env.MMF_ADMIN_URL || "https://mmf-info.web.app/admin";
const { EVENT, PAYMENT_DETAILS, publicAssetUrl } = require("./payment-config");

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPeso(amount) {
  const n = Number(amount);
  if (Number.isNaN(n)) return "—";
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function methodLabel(method) {
  const map = {
    bank: "Bank transfer",
    ewallet: "E-wallet",
    gcash: "GCash",
    card: "Card (PayPal)",
    other: "Other",
  };
  return map[method] || method || "—";
}

function settlementLabel(type) {
  if (type === "full") return "Full payment";
  if (type === "downpayment") return "50% downpayment";
  return type || "—";
}

function paymentStatusLabel(status) {
  if (status === "verified") return "Verified";
  if (status === "pending_paypal") return "Payment awaiting PayPal";
  return "Payment pending verification";
}

function formatTimestamp(value) {
  if (!value) return "—";
  try {
    const date =
      typeof value?.toDate === "function"
        ? value.toDate()
        : value instanceof Date
          ? value
          : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function supplierInterestLabel(s) {
  if (!s || typeof s !== "object") return "—";
  const bits = [];
  if (s.ice) bits.push("Ice");
  if (s.water) bits.push("Water");
  if (s.crewMeals) bits.push("Crew meals");
  if (s.milk) bits.push("Milk");
  if (s.other) bits.push(s.otherText ? `Other: ${s.otherText}` : "Other");
  return bits.length ? bits.join(", ") : "—";
}

function otherLinksLabel(doc) {
  if (Array.isArray(doc.otherLinks) && doc.otherLinks.length) {
    return doc.otherLinks.join(", ");
  }
  if (doc.tiktokOther) return doc.tiktokOther;
  return "—";
}

function amountDueLabel(doc) {
  const fees = doc.feeSnapshot || {};
  if (doc.settlementType === "downpayment") {
    return formatPeso(fees.downpaymentAmount);
  }
  return formatPeso(fees.totalDue);
}

function nextStepNote(doc) {
  if (doc.paymentMethod === "card") {
    return "You selected card payment. We will email you bank and e-wallet payment details separately.";
  }
  return "";
}

function finalPaymentDueDate(doc) {
  return doc.eventSnapshot?.finalPaymentDue || EVENT.finalPaymentDue;
}

function accountsForMethod(method) {
  if (method === "bank" || method === "gcash") {
    if (method === "gcash") {
      return PAYMENT_DETAILS.accounts.filter((a) => a.type === "ewallet" && a.label === "GCash");
    }
    return PAYMENT_DETAILS.accounts.filter((a) => a.type === "bank");
  }
  if (method === "ewallet") {
    return PAYMENT_DETAILS.accounts.filter((a) => a.type === "ewallet");
  }
  return [];
}

function formatAccountBlock(accounts) {
  if (!accounts.length) return "";
  return accounts
    .map(
      (a) =>
        `<li style="margin:0.35em 0;line-height:1.5;"><strong>${escapeHtml(a.label)}</strong> — ${escapeHtml(a.accountName)} · ${escapeHtml(a.accountNumber)}</li>`
    )
    .join("");
}

function paymentInstructionsHtml(doc) {
  const fees = doc.feeSnapshot || {};
  const method = doc.paymentMethod;
  const isDownpayment = doc.settlementType === "downpayment";
  const dueDate = finalPaymentDueDate(doc);
  const chunks = [];

  if (method === "card") {
    chunks.push(`<div style="margin-top:1.5em;padding-top:1.25em;border-top:1px solid #eee;">
      <h2 style="margin:0 0 0.65em;font-size:15px;color:#111;">Payment</h2>
      <p style="margin:0;font-size:13px;color:#444;line-height:1.55;">You selected card payment. We will email you bank and e-wallet payment details separately while card processing is unavailable.</p>
    </div>`);
    return chunks.join("");
  }

  // Bank / e-wallet: proof of payment was already uploaded to submit.
  // Account details are only useful for the remaining balance on 50% settlements.
  if (!isDownpayment) {
    return "";
  }

  const accounts = accountsForMethod(method);
  if (!accounts.length) {
    chunks.push(`<div style="margin-top:1.5em;padding-top:1.25em;border-top:1px solid #eee;">
      <h2 style="margin:0 0 0.65em;font-size:15px;color:#111;">Remaining balance</h2>
      <p style="margin:0;font-size:13px;color:#444;line-height:1.55;">Your remaining balance of <strong>${escapeHtml(formatPeso(fees.balanceAmount))}</strong> is due by <strong>${escapeHtml(dueDate)}</strong>.</p>
    </div>`);
    return chunks.join("");
  }

  const hint =
    method === "bank"
      ? PAYMENT_DETAILS.hints.bank
      : PAYMENT_DETAILS.hints.ewallet;

  chunks.push(`<div style="margin-top:1.5em;padding-top:1.25em;border-top:1px solid #eee;">
    <h2 style="margin:0 0 0.65em;font-size:15px;color:#111;">Remaining balance</h2>
    <p style="margin:0 0 0.5em;font-size:13px;color:#444;line-height:1.55;">For your remaining balance of <strong>${escapeHtml(formatPeso(fees.balanceAmount))}</strong>, please send payment to the account(s) below by <strong>${escapeHtml(dueDate)}</strong>:</p>
    <p style="margin:0 0 0.35em;font-size:12px;color:#666;font-weight:600;">${escapeHtml(hint)}</p>
    <ul style="margin:0 0 0.75em;padding-left:1.2em;font-size:13px;color:#111;">${formatAccountBlock(accounts)}</ul>
  </div>`);

  return chunks.join("");
}

function row(label, value) {
  const display = value === null || value === undefined || value === "" ? "—" : value;
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#666;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-size:13px;color:#111;vertical-align:top;">${display}</td>
  </tr>`;
}

function linkRow(label, url, text) {
  if (!url) return row(label, "—");
  return row(
    label,
    `<a href="${escapeHtml(url)}" style="color:#166534;">${escapeHtml(text || "Open")}</a>`
  );
}

function wrapEmailHtml({ title, subtitle, bodyHtml, footer }) {
  const heading = title
    ? `<h1 style="margin:0 0 0.35em;font-size:20px;color:#111;">${escapeHtml(title)}</h1>`
    : "";
  const sub = subtitle
    ? `<p style="margin:0 0 1.25em;color:#555;font-size:14px;line-height:1.5;">${escapeHtml(subtitle)}</p>`
    : "";
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:10px;padding:24px 22px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      ${heading}
      ${sub}
      ${bodyHtml}
    </div>
    <p style="margin:16px 0 0;color:#999;font-size:11px;text-align:center;">${escapeHtml(footer || "Manila Matcha Fest 2026")}</p>
  </div>
</body>
</html>`;
}

function buildMerchantRecapSubject(doc) {
  return "Manila Matcha Fest 2026 — Registration received";
}

function buildAdminNotifySubject(doc) {
  const brand = (doc.brandName || "Untitled brand").trim();
  return `[MMF Merchant] New signup — ${brand}`;
}

function buildMerchantRecapHtml(doc) {
  const event = doc.eventSnapshot || {};
  const fees = doc.feeSnapshot || {};
  const table = `<table style="border-collapse:collapse;width:100%;">
    ${row("Brand", escapeHtml(doc.brandName))}
    ${row("Contact", escapeHtml(doc.contactPerson))}
    ${row("Phone", escapeHtml(doc.contactNumber))}
    ${row("Email", escapeHtml(doc.email))}
    ${row("Instagram", escapeHtml(doc.instagram))}
    ${row("Settlement", escapeHtml(settlementLabel(doc.settlementType)))}
    ${row("Amount submitted", escapeHtml(amountDueLabel(doc)))}
    ${row("Total participation fee", escapeHtml(formatPeso(fees.totalDue)))}
    ${row("Payment method", escapeHtml(methodLabel(doc.paymentMethod)))}
    ${doc.notes ? row("Notes", escapeHtml(doc.notes)) : ""}
    ${supplierInterestLabel(doc.supplierInterest) !== "—" ? row("Supplier interest", escapeHtml(supplierInterestLabel(doc.supplierInterest))) : ""}
    ${doc.settlementType === "downpayment" ? row("Balance due", escapeHtml(formatPeso(fees.balanceAmount))) : ""}
    ${doc.settlementType === "downpayment" ? row("Balance due by", escapeHtml(finalPaymentDueDate(doc))) : ""}
  </table>
  ${paymentInstructionsHtml(doc)}`;

  const subtitle = [
    event.name || "Manila Matcha Fest 2026",
    event.dates,
    event.venue,
  ]
    .filter(Boolean)
    .join(" · ");

  return wrapEmailHtml({
    title: "Thank you for registering!",
    subtitle,
    bodyHtml: table,
    footer: "If you have any questions or concerns, please reach out via Viber.",
  });
}

function buildAdminNotifyHtml(doc) {
  const fees = doc.feeSnapshot || {};
  const table = `<table style="border-collapse:collapse;width:100%;">
    ${row("Brand", escapeHtml(doc.brandName))}
    ${row("Registered business", escapeHtml(doc.registeredBusinessName))}
    ${row("Contact", escapeHtml(doc.contactPerson))}
    ${row("Role", escapeHtml(doc.role))}
    ${row("Phone", escapeHtml(doc.contactNumber))}
    ${row("Email", escapeHtml(doc.email))}
    ${row("Instagram", escapeHtml(doc.instagram))}
    ${row("Other links", escapeHtml(otherLinksLabel(doc)))}
    ${row("Brand description", escapeHtml(doc.brandDescription))}
    ${row("Settlement", escapeHtml(settlementLabel(doc.settlementType)))}
    ${row("Amount due now", escapeHtml(amountDueLabel(doc)))}
    ${row("Total fee", escapeHtml(formatPeso(fees.totalDue)))}
    ${row("Payment method", escapeHtml(methodLabel(doc.paymentMethod)))}
    ${row("Payment status", escapeHtml(paymentStatusLabel(doc.status)))}
    ${linkRow("Proof of payment", doc.proofOfPaymentUrl, doc.proofOfPaymentName || "View proof")}
    ${linkRow("Business document", doc.businessDocUrl, doc.businessDocName || "View document")}
    ${doc.notes ? row("Notes", escapeHtml(doc.notes)) : ""}
    ${supplierInterestLabel(doc.supplierInterest) !== "—" ? row("Supplier interest", escapeHtml(supplierInterestLabel(doc.supplierInterest))) : ""}
    ${row("Submitted", escapeHtml(formatTimestamp(doc.createdAt)))}
    ${row("Submission ID", escapeHtml(doc.id))}
  </table>
  <p style="margin:1.25em 0 0;font-size:13px;">
    <a href="${escapeHtml(ADMIN_URL)}" style="color:#166534;font-weight:600;">Open admin dashboard →</a>
  </p>`;

  return wrapEmailHtml({
    title: "New merchant registration",
    subtitle: `${doc.brandName || "Untitled brand"} · ${methodLabel(doc.paymentMethod)} · ${settlementLabel(doc.settlementType)}`,
    bodyHtml: table,
    footer: "MMF Merchant Registration — admin notification",
  });
}

function buildCardPaymentDetailsSubject(doc) {
  return "Manila Matcha Fest 2026 — Payment details";
}

function buildFinalPaymentDetailsSubject(doc) {
  return "Manila Matcha Fest 2026 — Final payment (remaining balance)";
}

function formatAccountListHtml(accounts, { includeQr = false } = {}) {
  if (!accounts.length) return "";
  return accounts
    .map((a) => {
      const lines = [
        `<li style="margin:0 0 0.85em;line-height:1.55;">`,
        `<strong>${escapeHtml(a.label)}</strong><br>`,
        `${escapeHtml(a.accountName)} · ${escapeHtml(a.accountNumber)}`,
      ];
      if (includeQr && a.qrImage) {
        const qrUrl = publicAssetUrl(a.qrImage);
        lines.push(
          `<br><a href="${escapeHtml(qrUrl)}" style="color:#166534;font-size:12px;">Open ${escapeHtml(a.label)} QR</a>`,
          `<br><img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(a.label)} QR" width="140" style="margin-top:8px;border:1px solid #eee;border-radius:6px;display:block;">`
        );
      }
      lines.push("</li>");
      return lines.join("");
    })
    .join("");
}

function buildCardPaymentDetailsHtml(doc) {
  const fees = doc.feeSnapshot || {};
  const isDownpayment = doc.settlementType === "downpayment";
  const dueDate = finalPaymentDueDate(doc);
  const amountDueNow = isDownpayment ? fees.downpaymentAmount : fees.totalDue;
  const bankAccounts = PAYMENT_DETAILS.accounts.filter((a) => a.type === "bank");
  const ewalletAccounts = PAYMENT_DETAILS.accounts.filter((a) => a.type === "ewallet");
  const greeting = doc.brandName ? `Hi ${escapeHtml(doc.brandName)},` : "Hi,";

  const amountBlock = `<table style="border-collapse:collapse;width:100%;margin:0 0 1.25em;">
    ${row("Settlement", escapeHtml(settlementLabel(doc.settlementType)))}
    ${row("Amount due now", escapeHtml(formatPeso(amountDueNow)))}
    ${row("Total participation fee", escapeHtml(formatPeso(fees.totalDue)))}
    ${isDownpayment ? row("Remaining balance", escapeHtml(formatPeso(fees.balanceAmount))) : ""}
    ${isDownpayment ? row("Balance due by", escapeHtml(dueDate)) : ""}
  </table>`;

  const bodyHtml =
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">${greeting}</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">You are receiving this email because you selected <strong>card payment</strong> when you registered for Manila Matcha Fest 2026. We are currently experiencing technical issues with card processing, so please complete your payment via <strong>bank transfer</strong> or <strong>e-wallet</strong> using the details below.</p>` +
    amountBlock +
    `<h2 style="margin:1.25em 0 0.5em;font-size:15px;color:#111;">${escapeHtml(PAYMENT_DETAILS.hints.bank)}</h2>` +
    `<ul style="margin:0 0 1.25em;padding-left:1.2em;font-size:13px;color:#111;list-style:none;">${formatAccountListHtml(bankAccounts)}</ul>` +
    `<h2 style="margin:0 0 0.5em;font-size:15px;color:#111;">${escapeHtml(PAYMENT_DETAILS.hints.ewallet)}</h2>` +
    `<ul style="margin:0 0 1.25em;padding-left:1.2em;font-size:13px;color:#111;list-style:none;">${formatAccountListHtml(ewalletAccounts, { includeQr: true })}</ul>` +
    `<p style="margin:0;font-size:13px;color:#444;line-height:1.55;">Once you have paid, please <strong>reply to this email</strong> with a screenshot or photo of your proof of payment so we can verify your registration.</p>`;

  return wrapEmailHtml({
    title: "Payment details",
    subtitle: "Manila Matcha Fest 2026",
    bodyHtml,
    footer: "If you have any questions or concerns, please reach out via Viber.",
  });
}

function buildFinalPaymentDetailsHtml(doc) {
  const fees = doc.feeSnapshot || {};
  const dueDate = finalPaymentDueDate(doc);
  const balance = fees.balanceAmount;
  const bankAccounts = PAYMENT_DETAILS.accounts.filter((a) => a.type === "bank");
  const ewalletAccounts = PAYMENT_DETAILS.accounts.filter((a) => a.type === "ewallet");
  const greeting = doc.brandName ? `Hi ${escapeHtml(doc.brandName)},` : "Hi,";

  const amountBlock = `<table style="border-collapse:collapse;width:100%;margin:0 0 1.25em;">
    ${row("Settlement", "50% downpayment (already received)")}
    ${row("Downpayment paid", escapeHtml(formatPeso(fees.downpaymentAmount)))}
    ${row("Remaining balance due", escapeHtml(formatPeso(balance)))}
    ${row("Due by", escapeHtml(dueDate))}
    ${row("Total participation fee", escapeHtml(formatPeso(fees.totalDue)))}
  </table>`;

  const bodyHtml =
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">${greeting}</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">This is a reminder that your <strong>remaining balance</strong> of <strong>${escapeHtml(formatPeso(balance))}</strong> for Manila Matcha Fest 2026 is due on or before <strong>${escapeHtml(dueDate)}</strong>.</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Your <strong>50% downpayment</strong> is already on file. Please settle the remaining balance via <strong>bank transfer</strong> or <strong>e-wallet</strong> using the details below.</p>` +
    amountBlock +
    `<h2 style="margin:1.25em 0 0.5em;font-size:15px;color:#111;">${escapeHtml(PAYMENT_DETAILS.hints.bank)}</h2>` +
    `<ul style="margin:0 0 1.25em;padding-left:1.2em;font-size:13px;color:#111;list-style:none;">${formatAccountListHtml(bankAccounts)}</ul>` +
    `<h2 style="margin:0 0 0.5em;font-size:15px;color:#111;">${escapeHtml(PAYMENT_DETAILS.hints.ewallet)}</h2>` +
    `<ul style="margin:0 0 1.25em;padding-left:1.2em;font-size:13px;color:#111;list-style:none;">${formatAccountListHtml(ewalletAccounts, { includeQr: true })}</ul>` +
    `<p style="margin:0 0 1em;font-size:13px;color:#444;line-height:1.55;">Once you have paid the remaining balance, please <strong>reply to this email</strong> with a screenshot or photo of your proof of payment so we can mark your registration as fully paid.</p>` +
    `<p style="margin:0;font-size:14px;color:#444;line-height:1.55;">Thank you!</p>`;

  return wrapEmailHtml({
    bodyHtml,
    footer: "If you have any questions or concerns, please reach out via Viber.",
  });
}

const REQUIREMENTS_URL = process.env.MMF_REQUIREMENTS_URL || "https://mmf-requirements.web.app/";

function buildRequirementsInviteSubject() {
  return "Next step: Merchant Requirements — Manila Matcha Fest 2026";
}

function buildRequirementsInviteHtml(doc) {
  const brand = (doc.brandName || "").trim();
  const greeting = brand ? `Hi ${escapeHtml(brand)},` : "Hi,";
  const url = REQUIREMENTS_URL;

  const bodyHtml =
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">${greeting}</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Thank you again for confirming your participation at <strong>Manila Matcha Fest 2026</strong> (August 7–16 at SM Mall of Asia).</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Your merchant registration is in — next, please complete the <strong>Merchant Requirements</strong> form so we can process logistics and promote your brand across event materials.</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">We’ll need details like logo files, menu/product photos, booth layout, electrical load, and crew list.</p>` +
    `<p style="margin:0 0 1.25em;text-align:center;">` +
    `<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;background:#166534;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Open Merchant Requirements</a>` +
    `</p>` +
    `<p style="margin:0 0 1em;font-size:13px;color:#666;line-height:1.55;word-break:break-all;">Or open this link: <a href="${escapeHtml(url)}" style="color:#166534;">${escapeHtml(url)}</a></p>` +
    `<p style="margin:0;font-size:13px;color:#444;line-height:1.55;">You can save progress and come back anytime. If anything is unclear, reply to this email or message us on Viber.</p>`;

  return wrapEmailHtml({
    title: "Merchant Requirements",
    subtitle: "Manila Matcha Fest 2026 — next step",
    bodyHtml,
    footer: "Manila Matcha Fest Team",
  });
}

function fileCountLabel(value) {
  if (!value) return "—";
  if (Array.isArray(value)) return value.length ? `${value.length} file(s)` : "—";
  if (typeof value === "object" && value.url) return value.name || "Uploaded";
  if (typeof value === "string") return "Uploaded";
  return "—";
}

function sellingCategoriesLabel(doc) {
  const cats = Array.isArray(doc.sellingCategories) ? doc.sellingCategories : [];
  if (!cats.length) return "—";
  const labels = cats.map((c) => {
    if (c === "other" && doc.sellingOtherText) return `Other (${doc.sellingOtherText})`;
    return String(c).replace(/_/g, " ");
  });
  return labels.join(", ");
}

function equipmentSummaryLabel(doc) {
  const rows = Array.isArray(doc.equipment) ? doc.equipment.filter((r) => r && (r.item || r.watts)) : [];
  if (!rows.length) return "—";
  return rows
    .slice(0, 8)
    .map((r) => `${r.item || "Item"}${r.watts ? ` (${r.watts}W)` : ""}`)
    .join("; ") + (rows.length > 8 ? ` … +${rows.length - 8} more` : "");
}

function buildRequirementsMerchantRecapSubject(doc) {
  return "Manila Matcha Fest 2026 — Requirements received";
}

function buildRequirementsAdminNotifySubject(doc) {
  const brand = (doc.brandName || "Untitled brand").trim();
  return `[MMF Requirements] Submitted — ${brand}`;
}

function buildRequirementsMerchantRecapHtml(doc) {
  const brand = (doc.brandName || "").trim();
  const greeting = brand ? `Hi ${escapeHtml(brand)},` : "Hi,";
  const event = doc.eventSnapshot || {};
  const files = doc.files || {};
  const subtitle = [event.name || "Manila Matcha Fest 2026", event.dates, event.venue]
    .filter(Boolean)
    .join(" · ");

  const table = `<table style="border-collapse:collapse;width:100%;">
    ${row("Brand", escapeHtml(doc.brandName))}
    ${row("Sales categories", escapeHtml(sellingCategoriesLabel(doc)))}
    ${row("Square logo (light bg)", escapeHtml(fileCountLabel(files.logoSquareLight)))}
    ${row("Square logo (dark bg)", escapeHtml(fileCountLabel(files.logoSquareDark)))}
    ${row("Wide logo (light bg)", escapeHtml(fileCountLabel(files.logoWideLight)))}
    ${row("Wide logo (dark bg)", escapeHtml(fileCountLabel(files.logoWideDark)))}
    ${row("Menu photos", escapeHtml(fileCountLabel(files.menuPhotos)))}
    ${row("Product photos", escapeHtml(fileCountLabel(files.productPhotos)))}
    ${row("Booth photos", escapeHtml(fileCountLabel(files.boothLayout)))}
    ${row("Brand videos", escapeHtml(fileCountLabel(files.brandVideos)))}
    ${row("Electrical load", escapeHtml(equipmentSummaryLabel(doc)))}
    ${row("Ingress equipment / materials", escapeHtml(doc.ingressEquipmentMaterials))}
    ${row("Personnel", escapeHtml(doc.crewNames))}
    ${doc.exDealItems ? row("Ex-deal items", escapeHtml(doc.exDealItems)) : ""}
    ${doc.boothNotes ? row("Notes", escapeHtml(doc.boothNotes)) : ""}
  </table>`;

  const bodyHtml =
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">${greeting}</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Thanks — we received your <strong>Merchant Requirements</strong> for Manila Matcha Fest 2026.</p>` +
    `<p style="margin:0 0 1.25em;font-size:14px;color:#444;line-height:1.55;">Here’s a quick summary of what you submitted. You can still update anything later at <a href="${escapeHtml(REQUIREMENTS_URL)}" style="color:#166534;">${escapeHtml(REQUIREMENTS_URL)}</a>.</p>` +
    table +
    `<p style="margin:1.25em 0 0;font-size:13px;color:#444;line-height:1.55;">If anything changes before the event, reply to this email or message us on Viber.</p>`;

  return wrapEmailHtml({
    title: "Requirements received",
    subtitle,
    bodyHtml,
    footer: "Manila Matcha Fest Team",
  });
}

function buildRequirementsAdminNotifyHtml(doc) {
  const files = doc.files || {};
  const table = `<table style="border-collapse:collapse;width:100%;">
    ${row("Brand", escapeHtml(doc.brandName))}
    ${row("Registration ID", escapeHtml(doc.registrationId))}
    ${row("Email", escapeHtml(doc.registrationEmail))}
    ${row("Sales categories", escapeHtml(sellingCategoriesLabel(doc)))}
    ${row("Square logo (light bg)", escapeHtml(fileCountLabel(files.logoSquareLight)))}
    ${row("Square logo (dark bg)", escapeHtml(fileCountLabel(files.logoSquareDark)))}
    ${row("Wide logo (light bg)", escapeHtml(fileCountLabel(files.logoWideLight)))}
    ${row("Wide logo (dark bg)", escapeHtml(fileCountLabel(files.logoWideDark)))}
    ${row("Menu photos", escapeHtml(fileCountLabel(files.menuPhotos)))}
    ${row("Product photos", escapeHtml(fileCountLabel(files.productPhotos)))}
    ${row("Booth photos", escapeHtml(fileCountLabel(files.boothLayout)))}
    ${row("Brand videos", escapeHtml(fileCountLabel(files.brandVideos)))}
    ${row("Electrical load", escapeHtml(equipmentSummaryLabel(doc)))}
    ${row("Ingress equipment / materials", escapeHtml(doc.ingressEquipmentMaterials))}
    ${row("Personnel", escapeHtml(doc.crewNames))}
    ${doc.heroDrink ? row("Hero drink", escapeHtml(doc.heroDrink)) : ""}
    ${doc.exclusivePromo ? row("Exclusive promo", escapeHtml(doc.exclusivePromo)) : ""}
    ${doc.exDealItems ? row("Ex-deal items", escapeHtml(doc.exDealItems)) : ""}
    ${doc.boothNotes ? row("Notes", escapeHtml(doc.boothNotes)) : ""}
    ${row("Submitted", escapeHtml(formatTimestamp(doc.submittedAt || doc.createdAt)))}
    ${row("Requirements ID", escapeHtml(doc.id))}
  </table>
  <p style="margin:1.25em 0 0;font-size:13px;">
    <a href="${escapeHtml(ADMIN_URL)}" style="color:#166534;font-weight:600;">Open admin dashboard →</a>
  </p>`;

  return wrapEmailHtml({
    title: "New requirements submission",
    subtitle: `${doc.brandName || "Untitled brand"} · merchant requirements`,
    bodyHtml: table,
    footer: "MMF Merchant Requirements — admin notification",
  });
}

function formatCrewOrderDate(date) {
  const [y, m, d] = String(date || "")
    .split("-")
    .map(Number);
  if (!y || !m || !d) return date || "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function crewLinesHtml(lines = []) {
  if (!lines.length) {
    return `<p style="margin:0;font-size:13px;color:#666;">No items.</p>`;
  }

  const groups = new Map();
  lines.forEach((line) => {
    const key = line.supplierId || line.supplierName || "supplier";
    if (!groups.has(key)) {
      groups.set(key, {
        name: line.supplierName || "Supplier",
        lines: [],
        qty: 0,
        total: 0,
      });
    }
    const group = groups.get(key);
    group.lines.push(line);
    group.qty += Number(line.qty) || 0;
    group.total += Number(line.lineTotal) || 0;
  });

  const multi = groups.size > 1;
  const sections = [...groups.values()]
    .map((group, index) => {
      const rows = group.lines
        .map((line) => {
          const desc = line.itemDescription
            ? `<div style="font-size:12px;color:#666;margin-top:2px;">${escapeHtml(line.itemDescription)}</div>`
            : "";
          const period =
            line.periodKey && line.periodKey !== "meal"
              ? `<div style="font-size:12px;color:#666;margin-top:2px;text-transform:capitalize;">${escapeHtml(String(line.periodLabel || line.periodKey))}</div>`
              : "";
          return `<tr>
            <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top;">
              <div style="font-weight:600;color:#111;">${escapeHtml(String(line.qty))}× ${escapeHtml(line.itemName)}</div>
              ${desc}
              ${period}
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;white-space:nowrap;font-weight:600;">${escapeHtml(formatPeso(line.lineTotal))}</td>
          </tr>`;
        })
        .join("");

      const subtotal =
        multi
          ? `<tr>
              <td style="padding:8px 8px 4px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.03em;">Subtotal · ${escapeHtml(String(group.qty))} item${group.qty === 1 ? "" : "s"}</td>
              <td style="padding:8px 8px 4px;text-align:right;font-size:13px;font-weight:700;color:#166534;white-space:nowrap;">${escapeHtml(formatPeso(group.total))}</td>
            </tr>`
          : "";

      return `
        <div style="margin:${index === 0 ? "0.75em" : "1.35em"} 0 0;padding:0.85em 0.9em 0.7em;border:1px solid #dcfce7;border-radius:10px;background:#f0fdf4;">
          <div style="margin:0 0 0.55em;padding-bottom:0.45em;border-bottom:1px solid #bbf7d0;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#166534;">Supplier${multi ? ` ${index + 1} of ${groups.size}` : ""}</div>
            <div style="margin-top:0.2em;font-size:15px;font-weight:700;color:#14532d;line-height:1.3;">${escapeHtml(group.name)}</div>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <tbody>${rows}${subtotal}</tbody>
          </table>
        </div>`;
    })
    .join("");

  return sections;
}

function crewTotalRowHtml(order) {
  return `<table style="width:100%;border-collapse:collapse;margin:0.25em 0 0;">
    <tr>
      <td style="padding:12px 8px 4px;border-top:1px solid #ddd;font-size:15px;font-weight:700;color:#111;">Total</td>
      <td style="padding:12px 8px 4px;border-top:1px solid #ddd;text-align:right;font-size:15px;font-weight:700;color:#166534;white-space:nowrap;">${escapeHtml(formatPeso(order.totalAmount))}</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:0 8px 4px;text-align:right;font-size:12px;color:#666;">${escapeHtml(String(order.totalQty || 0))} item${Number(order.totalQty) === 1 ? "" : "s"}</td>
    </tr>
  </table>`;
}

function buildCrewMealOrderSubject(order) {
  if (order.isCancel) {
    return `Crew meal order cancelled · ${order.brandName || "Merchant"} · ${formatCrewOrderDate(order.date)}`;
  }
  const verb = order.isUpdate ? "updated" : "confirmed";
  return `Crew meal order ${verb} · ${order.brandName || "Merchant"} · ${formatCrewOrderDate(order.date)}`;
}

function buildCrewMealOrderHtml(order) {
  if (order.isCancel) {
    const body = `
      <p style="margin:0 0 1em;font-size:14px;line-height:1.55;color:#333;">
        Hi${order.contactPerson ? ` ${escapeHtml(order.contactPerson)}` : ""},
        your crew meal order for <strong>${escapeHtml(order.brandName || "your brand")}</strong>
        on <strong>${escapeHtml(formatCrewOrderDate(order.date))}</strong> has been <strong>cancelled</strong>.
      </p>
      <p style="margin:0 0 1em;font-size:14px;line-height:1.55;color:#333;">
        No meals will be prepared for this day unless you place a new order.
      </p>
      <p style="margin:1.25em 0 0;font-size:13px;color:#666;line-height:1.5;">
        To place a new order, open Merchant Hub
        (<a href="https://mmf-merchant.web.app" style="color:#166534;font-weight:600;">mmf-merchant.web.app</a>)
        and go to Crew meals.
      </p>`;

    return wrapEmailHtml({
      title: "Crew meal order cancelled",
      subtitle: `${order.brandName || "Merchant"} · ${formatCrewOrderDate(order.date)}`,
      bodyHtml: body,
      footer: "MMF Merchant Hub — crew meal confirmation",
    });
  }

  const verb = order.isUpdate ? "updated" : "confirmed";
  const body = `
    <p style="margin:0 0 1em;font-size:14px;line-height:1.55;color:#333;">
      Hi${order.contactPerson ? ` ${escapeHtml(order.contactPerson)}` : ""},
      your crew meal order for <strong>${escapeHtml(order.brandName || "your brand")}</strong>
      on <strong>${escapeHtml(formatCrewOrderDate(order.date))}</strong> has been ${verb}.
    </p>
    ${crewLinesHtml(order.lines)}
    ${crewTotalRowHtml(order)}
    <p style="margin:1.25em 0 0;font-size:13px;color:#666;line-height:1.5;">
      Orders must be placed by 6:00 PM (Manila time) the day before. To change this order, open Merchant Hub
      (<a href="https://mmf-merchant.web.app" style="color:#166534;font-weight:600;">mmf-merchant.web.app</a>),
      go to Crew meals, and tap <strong>Edit order</strong>.
    </p>`;

  return wrapEmailHtml({
    title: order.isUpdate ? "Crew meal order updated" : "Crew meal order confirmed",
    subtitle: `${order.brandName || "Merchant"} · ${formatCrewOrderDate(order.date)}`,
    bodyHtml: body,
    footer: "MMF Merchant Hub — crew meal confirmation",
  });
}

function buildCrewMealAdminSubject(order) {
  if (order.isCancel) {
    return `[Crew meals · Cancelled] ${order.brandName || "Merchant"} · ${formatCrewOrderDate(order.date)}`;
  }
  const tag = order.isUpdate ? "Updated" : "New";
  return `[Crew meals · ${tag}] ${order.brandName || "Merchant"} · ${formatCrewOrderDate(order.date)}`;
}

function buildCrewMealAdminHtml(order) {
  const statusLabel = order.isCancel
    ? "Cancelled"
    : order.isUpdate
      ? "Updated order"
      : "New order";
  const table = `
  <table style="width:100%;border-collapse:collapse;">
    ${row("Brand", escapeHtml(order.brandName))}
    ${row("Contact", escapeHtml(order.contactPerson))}
    ${row("Phone", escapeHtml(order.contactNumber))}
    ${row("Merchant ID", escapeHtml(order.merchantId))}
    ${row("Delivery day", escapeHtml(formatCrewOrderDate(order.date)))}
    ${row("Confirm email", escapeHtml(order.email))}
    ${row("Status", escapeHtml(statusLabel))}
    ${row("Items", escapeHtml(String(order.totalQty || 0)))}
    ${row("Total", escapeHtml(formatPeso(order.totalAmount)))}
  </table>
  ${order.isCancel ? `<p style="margin:1em 0 0;font-size:14px;color:#333;">This order was cancelled — nothing to prepare.</p>` : `${crewLinesHtml(order.lines)}${crewTotalRowHtml(order)}`}`;

  return wrapEmailHtml({
    title: order.isCancel
      ? "Crew meal order cancelled"
      : order.isUpdate
        ? "Crew meal order updated"
        : "New crew meal order",
    subtitle: `${order.brandName || "Merchant"} · ${formatCrewOrderDate(order.date)}`,
    bodyHtml: table,
    footer: "MMF Merchant Hub — admin notification",
  });
}

const HUB_URL = process.env.MMF_HUB_URL || "https://mmf-merchant.web.app";

function merchantHasOutstandingBalance(doc) {
  if (!doc) return false;
  if (doc.submissionState === "draft") return false;
  if (doc.status === "verified" && doc.settlementType !== "downpayment") return false;
  return true;
}

/** Remaining 50% not yet confirmed. Does not include unverified initial payments. */
function merchantHasPendingFinalPayment(doc) {
  if (!doc) return false;
  if (doc.archived) return false;
  if (doc.submissionState === "draft") return false;
  return doc.status === "verified" && doc.settlementType === "downpayment";
}

function merchantHubBalanceAmount(doc) {
  const fees = doc?.feeSnapshot || {};
  if (doc?.status === "verified" && doc?.settlementType === "downpayment") {
    return Number(fees.balanceAmount) || 28000;
  }
  if (doc?.settlementType === "downpayment") {
    return Number(fees.downpaymentAmount) || 28000;
  }
  return Number(fees.totalDue) || 56000;
}

function buildMerchantHubAnnouncementSubject(doc) {
  if (merchantHasOutstandingBalance(doc)) {
    return "Merchant Hub is live — please settle your balance today · Manila Matcha Fest 2026";
  }
  return "Your Merchant Hub is ready · Manila Matcha Fest 2026";
}

function buildMerchantHubAnnouncementHtml(doc) {
  const brand = String(doc.brandName || "").trim();
  const contact = String(doc.contactPerson || "").trim();
  const greeting = contact
    ? `Hi ${escapeHtml(contact)},`
    : brand
      ? `Hi ${escapeHtml(brand)},`
      : "Hi,";
  const hasBalance = merchantHasOutstandingBalance(doc);
  const dueDate = doc.eventSnapshot?.finalPaymentDue || EVENT.finalPaymentDue;
  const balance = formatPeso(merchantHubBalanceAmount(doc));
  const hubUrl = HUB_URL;
  const accessCode = String(doc.hubAccessCode || doc.accessCode || "")
    .trim()
    .toUpperCase();
  const brandLabel = brand || "your brand";

  const accessBlock = accessCode
    ? `<div style="margin:0 0 1.15em;padding:14px 16px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;">
        <p style="margin:0 0 0.45em;font-size:13px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.04em;">Your sign-in details</p>
        <p style="margin:0 0 0.35em;font-size:14px;color:#444;line-height:1.55;">Brand: <strong>${escapeHtml(brandLabel)}</strong></p>
        <p style="margin:0 0 0.55em;font-size:14px;color:#444;line-height:1.55;">Access code: <strong style="font-size:18px;letter-spacing:0.12em;color:#14532d;">${escapeHtml(accessCode)}</strong></p>
        <p style="margin:0;font-size:13px;color:#666;line-height:1.55;">Keep this code private. You’ll need it each time you open Merchant Hub.</p>
      </div>`
    : "";

  const balanceBlock = hasBalance
    ? `<div style="margin:1.25em 0 0;padding:14px 16px;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;">
        <p style="margin:0 0 0.4em;font-size:13px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.04em;">Reminder — settle today</p>
        <p style="margin:0 0 0.55em;font-size:14px;color:#444;line-height:1.55;">You still have an outstanding balance of <strong style="color:#9a3412;">${escapeHtml(balance)}</strong> due on or before <strong>${escapeHtml(dueDate)}</strong>.</p>
        <p style="margin:0 0 0.55em;font-size:14px;color:#444;line-height:1.55;">Bank and e-wallet payment details (with QR codes) are in Merchant Hub under <strong>Payment balance</strong>. After paying, please email proof to <a href="mailto:hi@matchanese.com" style="color:#166534;">hi@matchanese.com</a>.</p>
        <p style="margin:0;font-size:14px;color:#444;line-height:1.55;">If you have already paid, please remind us via Viber so we can confirm it.</p>
      </div>`
    : "";

  const bodyHtml =
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">${greeting}</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Manila Matcha Fest is almost here (August 7–16 at SM Mall of Asia). We’ve set up your <strong>Merchant Hub</strong> — one place for ingress details, suppliers, crew meal ordering, and daily reports.</p>` +
    `<p style="margin:0 0 1.25em;text-align:center;">` +
    `<a href="${escapeHtml(hubUrl)}" style="display:inline-block;padding:12px 22px;background:#166534;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Open Merchant Hub</a>` +
    `</p>` +
    `<p style="margin:0 0 1em;font-size:13px;color:#666;line-height:1.55;word-break:break-all;">Or open: <a href="${escapeHtml(hubUrl)}" style="color:#166534;">${escapeHtml(hubUrl)}</a></p>` +
    accessBlock +
    `<p style="margin:0 0 0.45em;font-size:14px;font-weight:700;color:#111;">What’s inside</p>` +
    `<ul style="margin:0 0 1.15em;padding-left:1.2em;font-size:14px;color:#444;line-height:1.55;">
      <li style="margin:0 0 0.35em;"><strong>Ingress reminders</strong> — setup schedule, what to bring, and mall guidelines</li>
      <li style="margin:0 0 0.35em;"><strong>Supplier references</strong> — recommended ice and water contacts</li>
      <li style="margin:0 0 0.35em;"><strong>Event &amp; booth layout</strong> — atrium map and where your booth is</li>
      <li style="margin:0 0 0.35em;"><strong>Crew meals</strong> — order by 6:00 PM the day before</li>
      <li style="margin:0 0 0.35em;"><strong>Daily sales report</strong> — log each day’s cash sales</li>
      <li style="margin:0;"><strong>Freebies claim report</strong> — track KOL drinks and retail given away</li>
    </ul>` +
    `<p style="margin:0;font-size:13px;color:#444;line-height:1.55;">If anything is unclear, reply to this email or message us on Viber. See you at the atrium.</p>` +
    balanceBlock;

  return wrapEmailHtml({
    title: hasBalance ? "Merchant Hub + balance reminder" : "Your Merchant Hub is ready",
    subtitle: "Manila Matcha Fest 2026 · August 7–16 · SM Mall of Asia",
    bodyHtml,
    footer: "Manila Matcha Fest Team",
  });
}

function buildApologySalesReminderSubject() {
  return "Manila Matcha Fest reminders";
}

function buildApologySalesReminderHtml(doc) {
  const brand = String(doc?.brandName || "").trim();
  const greeting = brand
    ? `Hi ${escapeHtml(brand)} team,`
    : "Hi,";
  const hubUrl = HUB_URL;

  const bodyHtml =
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">${greeting}</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Congrats on the first two days of your participation, and for making Manila Matcha Fest a success!</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">We hope you and your team are staying safe given the weather. If your team will not be able to set up on time for mall opening (<strong>10:00 AM</strong>) on any of the succeeding days, please keep us updated via Viber.</p>` +
    `<div style="margin:0 0 1.15em;padding:14px 16px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;">
      <p style="margin:0 0 0.4em;font-size:13px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.04em;">Daily sales report</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.55;">As required by <strong>SM Mall of Asia</strong>, please submit your <strong>daily cash sales report</strong> in Merchant Hub for each event day.</p>
    </div>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Open Merchant Hub → <strong>Daily sales report</strong> → pick the day → enter cash sales → Save.</p>` +
    `<p style="margin:0 0 1.25em;text-align:center;">` +
    `<a href="${escapeHtml(hubUrl)}" style="display:inline-block;padding:12px 22px;background:#166534;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Open Merchant Hub</a>` +
    `</p>` +
    `<p style="margin:0 0 1em;font-size:13px;color:#666;line-height:1.55;word-break:break-all;">Or open: <a href="${escapeHtml(hubUrl)}" style="color:#166534;">${escapeHtml(hubUrl)}</a></p>` +
    `<p style="margin:0 0 1em;font-size:13px;color:#666;line-height:1.55;">Sorry about the earlier email — if you have already settled your balance, please disregard that payment reminder.</p>` +
    `<p style="margin:0;font-size:13px;color:#444;line-height:1.55;">If anything is unclear, reply to this email or message us on Viber.</p>`;

  return wrapEmailHtml({
    title: "",
    subtitle: "",
    bodyHtml,
    footer: "Manila Matcha Fest Team",
  });
}

function formatSalesReportDate(dateStr) {
  const raw = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "—";
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildEventWrapupSubject(doc) {
  if (merchantHasPendingFinalPayment(doc)) {
    return "Thank you — remaining balance reminder · Manila Matcha Fest 2026";
  }
  return "Thank you for making Manila Matcha Fest 2026 a success";
}

function buildEventWrapupHtml(doc) {
  const brand = String(doc?.brandName || "").trim();
  const greeting = brand ? `Hi ${escapeHtml(brand)} team,` : "Hi,";
  const hubUrl = HUB_URL;
  const hasPendingFinal = merchantHasPendingFinalPayment(doc);
  const fees = doc?.feeSnapshot || {};
  const balance = formatPeso(Number(fees.balanceAmount) || 28000);

  const paymentBlock = hasPendingFinal
    ? `<div style="margin:1.25em 0 0;padding:14px 16px;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;">
        <p style="margin:0 0 0.4em;font-size:13px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.04em;">Reminder — remaining balance</p>
        <p style="margin:0 0 0.55em;font-size:14px;color:#444;line-height:1.55;">Our records still show a pending remaining balance of <strong style="color:#9a3412;">${escapeHtml(balance)}</strong>.</p>
        <p style="margin:0;font-size:14px;color:#444;line-height:1.55;">Please send us your payment confirmation, or remind us where you sent it in case we have overlooked it.</p>
      </div>`
    : "";

  const bodyHtml =
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">${greeting}</p>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Congratulations on a successful run, and thank you for making <strong>Manila Matcha Fest 2026</strong> a success!</p>` +
    `<div style="margin:0 0 1.15em;padding:14px 16px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;">
      <p style="margin:0 0 0.4em;font-size:13px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.04em;">Daily sales report</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.55;">Please make sure your <strong>daily cash sales</strong> for each event day (August 7–16) are submitted in Merchant Hub, as part of SM Mall of Asia’s requirements.</p>
    </div>` +
    `<p style="margin:0 0 1em;font-size:14px;color:#444;line-height:1.55;">Open Merchant Hub → <strong>Daily sales report</strong> → pick the day → enter cash sales → Save.</p>` +
    `<p style="margin:0 0 1.25em;text-align:center;">` +
    `<a href="${escapeHtml(hubUrl)}" style="display:inline-block;padding:12px 22px;background:#166534;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Open Merchant Hub</a>` +
    `</p>` +
    `<p style="margin:0 0 1em;font-size:13px;color:#666;line-height:1.55;word-break:break-all;">Or open: <a href="${escapeHtml(hubUrl)}" style="color:#166534;">${escapeHtml(hubUrl)}</a></p>` +
    `<p style="margin:0;font-size:13px;color:#444;line-height:1.55;">If anything is unclear, reply to this email or message us on Viber.</p>` +
    paymentBlock;

  return wrapEmailHtml({
    title: "",
    subtitle: "",
    bodyHtml,
    footer: "Manila Matcha Fest Team",
  });
}

function buildSalesReportNotifySubject(doc) {
  const brand = (doc.brandName || "Merchant").trim();
  return `Daily sales report — ${brand} · ${formatSalesReportDate(doc.date)}`;
}

function buildSalesReportNotifyHtml(doc) {
  const cash = formatPeso(doc.cashSales);
  const previous = doc._previousCashSales;
  const showPrevious =
    doc._isUpdate && previous != null && Number(previous) !== Number(doc.cashSales);

  const bodyHtml =
    `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#166534;">Daily sales report</p>` +
    `<h1 style="margin:0 0 4px;font-size:22px;line-height:1.25;color:#111;">${escapeHtml(doc.brandName || "Merchant")}</h1>` +
    `<p style="margin:0 0 1.35em;font-size:14px;color:#555;line-height:1.45;">${escapeHtml(formatSalesReportDate(doc.date))} · Manila Matcha Fest 2026 · SM Mall of Asia</p>` +
    `<div style="padding:22px 18px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;text-align:center;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#166534;">Cash sales</p>
      <p style="margin:0;font-size:34px;font-weight:700;color:#111;letter-spacing:-0.02em;line-height:1.1;">${escapeHtml(cash)}</p>
      ${
        showPrevious
          ? `<p style="margin:12px 0 0;font-size:13px;color:#666;">Previously reported: <strong style="color:#111;">${escapeHtml(formatPeso(previous))}</strong></p>`
          : ""
      }
    </div>`;

  return wrapEmailHtml({
    title: "",
    subtitle: "",
    bodyHtml,
    footer: "MMF Merchant Hub — internal only",
  });
}

module.exports = {
  escapeHtml,
  formatPeso,
  methodLabel,
  settlementLabel,
  paymentStatusLabel,
  buildMerchantRecapSubject,
  buildAdminNotifySubject,
  buildMerchantRecapHtml,
  buildAdminNotifyHtml,
  buildCardPaymentDetailsSubject,
  buildCardPaymentDetailsHtml,
  buildFinalPaymentDetailsSubject,
  buildFinalPaymentDetailsHtml,
  buildRequirementsInviteSubject,
  buildRequirementsInviteHtml,
  buildRequirementsMerchantRecapSubject,
  buildRequirementsMerchantRecapHtml,
  buildRequirementsAdminNotifySubject,
  buildRequirementsAdminNotifyHtml,
  buildCrewMealOrderSubject,
  buildCrewMealOrderHtml,
  buildCrewMealAdminSubject,
  buildCrewMealAdminHtml,
  buildMerchantHubAnnouncementSubject,
  buildMerchantHubAnnouncementHtml,
  buildApologySalesReminderSubject,
  buildApologySalesReminderHtml,
  buildEventWrapupSubject,
  buildEventWrapupHtml,
  buildSalesReportNotifySubject,
  buildSalesReportNotifyHtml,
  formatSalesReportDate,
  merchantHasOutstandingBalance,
  merchantHasPendingFinalPayment,
  REQUIREMENTS_URL,
  amountDueLabel,
  nextStepNote,
  paymentInstructionsHtml,
  accountsForMethod,
  formatAccountListHtml,
};
