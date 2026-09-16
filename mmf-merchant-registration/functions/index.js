const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendEmail, getEmailConfig } = require("./mailer");
const {
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
  merchantHasOutstandingBalance,
  merchantHasPendingFinalPayment,
} = require("./email-content");
const { createAndSendInvoice, resolveInvoiceAmount, shouldReplaceCachedInvoice, buildInvoiceNumber } = require("./paypal");
const { planRequirementsUpdateLog } = require("./requirements-update-log");
const { ensureRequirementImageThumbs } = require("./requirements-thumbs");

const emailjsPrivateKey = defineSecret("EMAILJS_PRIVATE_KEY");
const paypalClientId = defineSecret("PAYPAL_CLIENT_ID");
const paypalClientSecret = defineSecret("PAYPAL_CLIENT_SECRET");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const COLLECTION = "mmf_merchant_registrations";
const REQUIREMENTS_COLLECTION = "mmf_merchant_requirements";
const SALES_COLLECTION = "mmf_hub_sales_reports";

function salesReportMeaningfulChange(before, after) {
  if (!after) return false;
  if (!before) return true;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return (
    num(before.cashSales) !== num(after.cashSales) ||
    num(before.grossSales) !== num(after.grossSales) ||
    String(before.date || "") !== String(after.date || "") ||
    String(before.brandName || "") !== String(after.brandName || "") ||
    String(before.merchantId || "") !== String(after.merchantId || "")
  );
}

function isSubmittedRegistration(doc) {
  if (doc.submissionState === "draft") return false;
  if (doc.submissionState === "submitted") return true;
  return Boolean(doc.status);
}

function isEventWrapupSkippedMerchant(doc) {
  const email = String(doc?.email || "").trim().toLowerCase();
  const brand = String(doc?.brandName || "").trim().toLowerCase();
  return email === "david.toph@gmail.com" || brand === "matchanese";
}

function countRequirementFiles(files = {}) {
  return Object.values(files).reduce((n, value) => {
    if (!value) return n;
    if (Array.isArray(value)) return n + value.length;
    if (typeof value === "object" && value.url) return n + 1;
    if (typeof value === "string") return n + 1;
    return n;
  }, 0);
}

function isRequirementsSubmitted(doc) {
  if (!doc) return false;
  if (doc.submissionState === "submitted") return true;
  if (doc.submissionState === "draft") return false;
  if (doc.submissionState) return false;
  return countRequirementFiles(doc.files) > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyPayPalSecrets() {
  process.env.PAYPAL_CLIENT_ID = paypalClientId.value();
  process.env.PAYPAL_CLIENT_SECRET = paypalClientSecret.value();
}

async function trySendEmail({ to, subject, html, fromName }) {
  try {
    await sendEmail({ to, subject, html, fromName });
    return { sent: true, sentAt: admin.firestore.FieldValue.serverTimestamp(), error: null };
  } catch (err) {
    console.error("[MMF Email]", err?.message || err);
    return {
      sent: false,
      sentAt: null,
      error: String(err?.message || err).slice(0, 500),
    };
  }
}

async function sendRegistrationEmails(doc, registrationId) {
  process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();

  const cfg = getEmailConfig();
  const merchantEmail = String(doc.email || "").trim();

  const merchantResult = merchantEmail
    ? await trySendEmail({
        to: merchantEmail,
        subject: buildMerchantRecapSubject(doc),
        html: buildMerchantRecapHtml(doc),
        fromName: "Manila Matcha Fest",
      })
    : { sent: false, sentAt: null, error: "No submitter email on registration" };

  const adminResult = await trySendEmail({
    to: cfg.notifyEmail,
    subject: buildAdminNotifySubject(doc),
    html: buildAdminNotifyHtml(doc),
    fromName: "MMF Merchant Registration",
  });

  try {
    await db.collection(COLLECTION).doc(registrationId).update({
      emailNotification: {
        merchant: merchantResult,
        admin: adminResult,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[MMF Email] failed to write notification status", err?.message || err);
  }
}

async function sendRequirementsEmails(doc, requirementId) {
  process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();

  const cfg = getEmailConfig();
  const merchantEmail = String(doc.registrationEmail || doc.email || "").trim();

  const merchantResult = merchantEmail
    ? await trySendEmail({
        to: merchantEmail,
        subject: buildRequirementsMerchantRecapSubject(doc),
        html: buildRequirementsMerchantRecapHtml(doc),
        fromName: "Manila Matcha Fest",
      })
    : { sent: false, sentAt: null, error: "No merchant email on requirements" };

  const adminResult = await trySendEmail({
    to: cfg.notifyEmail,
    subject: buildRequirementsAdminNotifySubject(doc),
    html: buildRequirementsAdminNotifyHtml(doc),
    fromName: "MMF Merchant Requirements",
  });

  try {
    await db.collection(REQUIREMENTS_COLLECTION).doc(requirementId).update({
      emailNotification: {
        merchant: merchantResult,
        admin: adminResult,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[MMF Requirements Email] failed to write notification status", err?.message || err);
  }
}

async function prepareRegistrationEmailDoc(doc) {
  return doc;
}

async function ensurePayPalInvoice(registrationId) {
  const ref = db.collection(COLLECTION).doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Registration not found");
  }

  const doc = { id: snap.id, ...snap.data() };
  if (!isSubmittedRegistration(doc)) {
    throw new HttpsError("failed-precondition", "Registration is not submitted yet");
  }
  if (doc.paymentMethod !== "card") {
    throw new HttpsError("failed-precondition", "Registration is not a PayPal / card payment");
  }

  const resolved = resolveInvoiceAmount(doc);
  const cached = doc.paypalInvoice;
  if (cached?.href && cached?.id && !shouldReplaceCachedInvoice(cached, resolved)) {
    return {
      href: cached.href,
      invoiceId: cached.id,
      created: false,
      amount: cached.amount,
      purpose: cached.purpose,
    };
  }

  if (cached?.href && shouldReplaceCachedInvoice(cached, resolved)) {
    console.info("[MMF PayPal] Replacing stale invoice for", registrationId);
  }

  const replacing = Boolean(cached?.href && shouldReplaceCachedInvoice(cached, resolved));
  const { amount, purpose, note, currency, lineItemTotal, minimumAmountDue, allowPartialPayment, itemName, itemDescription } =
    resolved;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("failed-precondition", "Missing fee amount on registration");
  }

  applyPayPalSecrets();

  let invoice;
  try {
    invoice = await createAndSendInvoice({
      email: doc.email,
      brandName: doc.brandName,
      amount,
      lineItemTotal,
      minimumAmountDue,
      allowPartialPayment,
      note,
      itemName,
      itemDescription,
      invoiceNumber: replacing ? undefined : buildInvoiceNumber(registrationId),
      currency,
    });
  } catch (err) {
    console.error("[MMF PayPal] create/send failed", err?.message || err);
    throw new HttpsError("internal", err?.message || "Failed to create PayPal invoice");
  }

  const paypalInvoice = {
    id: invoice.id,
    href: invoice.href,
    status: invoice.status || "SENT",
    amount: invoice.amount,
    invoiceTotal: invoice.invoiceTotal,
    minimumAmountDue,
    allowPartialPayment: invoice.allowPartialPayment,
    currency: invoice.currency || currency,
    purpose,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await ref.update({
    paypalInvoice,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    href: invoice.href,
    invoiceId: invoice.id,
    created: true,
    amount: invoice.amount,
    purpose,
  };
}

exports.onMerchantRegistrationCreated = onDocumentCreated(
  {
    document: COLLECTION + "/{registrationId}",
    secrets: [emailjsPrivateKey],
    region: "asia-southeast1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const doc = { id: snap.id, ...snap.data() };
    if (!isSubmittedRegistration(doc)) return;
    const docForEmail = await prepareRegistrationEmailDoc(doc);
    await sendRegistrationEmails(docForEmail, snap.id);
  }
);

exports.onMerchantRegistrationUpdated = onDocumentUpdated(
  {
    document: COLLECTION + "/{registrationId}",
    secrets: [emailjsPrivateKey],
    region: "asia-southeast1",
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!after) return;
    const wasSubmitted = isSubmittedRegistration(before);
    const isSubmitted = isSubmittedRegistration(after);
    if (wasSubmitted || !isSubmitted) return;
    const doc = { id: event.params.registrationId, ...after };
    const docForEmail = await prepareRegistrationEmailDoc(doc);
    await sendRegistrationEmails(docForEmail, event.params.registrationId);
  }
);

async function maybeWriteRequirementsUpdateLog(docId, before, after) {
  const plan = planRequirementsUpdateLog({
    before,
    after,
    now: new Date(),
  });
  if (!plan.shouldWrite) return plan;

  const updateLog = plan.updateLog.map((entry) => ({
    type: entry.type,
    at:
      entry.at instanceof Date
        ? admin.firestore.Timestamp.fromDate(entry.at)
        : admin.firestore.Timestamp.fromDate(new Date(entry.at)),
  }));

  await db.collection(REQUIREMENTS_COLLECTION).doc(docId).update({ updateLog });
  return plan;
}

async function maybeEnsureRequirementThumbs(docId, data) {
  try {
    return await ensureRequirementImageThumbs(docId, data, db, REQUIREMENTS_COLLECTION);
  } catch (err) {
    console.error("[MMF Thumbs]", err?.message || err);
    return false;
  }
}

exports.onMerchantRequirementsCreated = onDocumentCreated(
  {
    document: REQUIREMENTS_COLLECTION + "/{requirementId}",
    secrets: [emailjsPrivateKey],
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const doc = { id: snap.id, ...snap.data() };
    await maybeWriteRequirementsUpdateLog(snap.id, null, doc);
    await maybeEnsureRequirementThumbs(snap.id, doc);
    if (!isRequirementsSubmitted(doc)) return;
    await sendRequirementsEmails(doc, snap.id);
  }
);

exports.onMerchantRequirementsUpdated = onDocumentUpdated(
  {
    document: REQUIREMENTS_COLLECTION + "/{requirementId}",
    secrets: [emailjsPrivateKey],
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!after) return;
    const docId = event.params.requirementId;
    await maybeWriteRequirementsUpdateLog(docId, before, after);
    await maybeEnsureRequirementThumbs(docId, after);

    const wasSubmitted = isRequirementsSubmitted(before);
    const isSubmitted = isRequirementsSubmitted(after);
    if (wasSubmitted || !isSubmitted) return;
    const doc = { id: docId, ...after };
    await sendRequirementsEmails(doc, docId);
  }
);

exports.createPayPalInvoice = onCall(
  {
    region: "asia-southeast1",
    secrets: [paypalClientId, paypalClientSecret],
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const registrationId = String(request.data?.registrationId || "").trim();
    if (!registrationId) {
      throw new HttpsError("invalid-argument", "registrationId is required");
    }
    const result = await ensurePayPalInvoice(registrationId);
    return {
      href: result.href,
      invoiceId: result.invoiceId,
      created: result.created,
    };
  }
);

exports.sendPaymentDetailsEmail = onCall(
  {
    region: "asia-southeast1",
    secrets: [emailjsPrivateKey],
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const registrationId = String(request.data?.registrationId || "").trim();
    if (!registrationId) {
      throw new HttpsError("invalid-argument", "registrationId is required");
    }

    const ref = db.collection(COLLECTION).doc(registrationId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Registration not found");
    }

    const doc = { id: snap.id, ...snap.data() };
    if (!isSubmittedRegistration(doc)) {
      throw new HttpsError("failed-precondition", "Registration is not submitted yet");
    }
    if (doc.paymentMethod !== "card") {
      throw new HttpsError("failed-precondition", "Registration is not a card payment");
    }

    const email = String(doc.email || "").trim();
    if (!email) {
      throw new HttpsError("failed-precondition", "Registration has no email");
    }

    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();

    try {
      await sendEmail({
        to: email,
        subject: buildCardPaymentDetailsSubject(doc),
        html: buildCardPaymentDetailsHtml(doc),
        fromName: "Manila Matcha Fest",
      });
    } catch (err) {
      console.error("[MMF Email] payment details failed", err?.message || err);
      throw new HttpsError("internal", err?.message || "Failed to send payment details email");
    }

    await ref.update({
      paymentDetailsEmail: {
        sent: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { sent: true };
  }
);

exports.sendFinalPaymentDetailsEmail = onCall(
  {
    region: "asia-southeast1",
    secrets: [emailjsPrivateKey],
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const registrationId = String(request.data?.registrationId || "").trim();
    if (!registrationId) {
      throw new HttpsError("invalid-argument", "registrationId is required");
    }

    const ref = db.collection(COLLECTION).doc(registrationId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Registration not found");
    }

    const doc = { id: snap.id, ...snap.data() };
    if (!isSubmittedRegistration(doc)) {
      throw new HttpsError("failed-precondition", "Registration is not submitted yet");
    }
    if (doc.status !== "verified") {
      throw new HttpsError("failed-precondition", "Downpayment is not verified yet");
    }
    if (doc.settlementType !== "downpayment") {
      throw new HttpsError("failed-precondition", "Registration is not a 50% downpayment settlement");
    }

    const email = String(doc.email || "").trim();
    if (!email) {
      throw new HttpsError("failed-precondition", "Registration has no email");
    }

    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();

    try {
      await sendEmail({
        to: email,
        subject: buildFinalPaymentDetailsSubject(doc),
        html: buildFinalPaymentDetailsHtml(doc),
        fromName: "Manila Matcha Fest",
      });
    } catch (err) {
      console.error("[MMF Email] final payment details failed", err?.message || err);
      throw new HttpsError("internal", err?.message || "Failed to send final payment details email");
    }

    await ref.update({
      finalPaymentDetailsEmail: {
        sent: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { sent: true };
  }
);

exports.ensureRequirementThumbs = onCall(
  {
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 300,
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const docId = String(request.data?.requirementId || "").trim();
    if (!docId) {
      throw new HttpsError("invalid-argument", "requirementId is required");
    }
    const snap = await db.collection(REQUIREMENTS_COLLECTION).doc(docId).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Requirements not found");
    }
    const updated = await ensureRequirementImageThumbs(docId, snap.data(), db, REQUIREMENTS_COLLECTION);
    return { updated: Boolean(updated) };
  }
);

exports.sendRequirementsInviteEmails = onCall(
  {
    region: "asia-southeast1",
    secrets: [emailjsPrivateKey],
    timeoutSeconds: 300,
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const registrationId = String(request.data?.registrationId || "").trim();
    const includeAlreadySent = Boolean(request.data?.includeAlreadySent);
    const includeCompletedRequirements = Boolean(request.data?.includeCompletedRequirements);

    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();

    const [regSnap, reqSnap] = await Promise.all([
      db.collection(COLLECTION).get(),
      db.collection(REQUIREMENTS_COLLECTION).get(),
    ]);

    const requirementsByRegistration = new Map();
    for (const docSnap of reqSnap.docs) {
      const data = { id: docSnap.id, ...docSnap.data() };
      if (data.archived) continue;
      const key = data.registrationId || "";
      if (!key) continue;
      const existing = requirementsByRegistration.get(key);
      if (!existing) {
        requirementsByRegistration.set(key, data);
        continue;
      }
      // Prefer submitted over draft
      if (isRequirementsSubmitted(data) && !isRequirementsSubmitted(existing)) {
        requirementsByRegistration.set(key, data);
      }
    }

    let targets = regSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((doc) => !doc.archived && isSubmittedRegistration(doc));

    if (registrationId) {
      targets = targets.filter((doc) => doc.id === registrationId);
      if (!targets.length) {
        throw new HttpsError("not-found", "Submitted registration not found");
      }
    }

    const results = {
      sent: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    for (const doc of targets) {
      const email = String(doc.email || "").trim();
      const req = requirementsByRegistration.get(doc.id);
      const hasRequirements = isRequirementsSubmitted(req);
      const alreadySent = Boolean(doc.requirementsInviteEmail?.sent);

      if (!email) {
        results.skipped += 1;
        results.details.push({ id: doc.id, brandName: doc.brandName, status: "skipped", reason: "no_email" });
        continue;
      }
      if (hasRequirements && !includeCompletedRequirements) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          status: "skipped",
          reason: "requirements_already_submitted",
        });
        continue;
      }
      if (alreadySent && !includeAlreadySent && !registrationId) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          status: "skipped",
          reason: "already_invited",
        });
        continue;
      }

      try {
        await sendEmail({
          to: email,
          subject: buildRequirementsInviteSubject(doc),
          html: buildRequirementsInviteHtml(doc),
          fromName: "Manila Matcha Fest",
        });
        await db.collection(COLLECTION).doc(doc.id).update({
          requirementsInviteEmail: {
            sent: true,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results.sent += 1;
        results.details.push({ id: doc.id, brandName: doc.brandName, email, status: "sent" });
        await sleep(350);
      } catch (err) {
        console.error("[MMF Email] requirements invite failed", doc.id, err?.message || err);
        results.failed += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "failed",
          reason: String(err?.message || err).slice(0, 200),
        });
      }
    }

    return results;
  }
);

exports.sendCrewMealOrderEmail = onCall(
  {
    region: "asia-southeast1",
    secrets: [emailjsPrivateKey],
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const data = request.data || {};
    const merchantId = String(data.merchantId || "").trim();
    const brandName = String(data.brandName || "").trim();
    const date = String(data.date || "").trim();
    const email = String(data.email || "").trim();
    const contactPerson = String(data.contactPerson || "").trim();
    const contactNumber = String(data.contactNumber || "").trim();
    const orderId = String(data.orderId || "").trim();
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const totalAmount = Number(data.totalAmount) || 0;
    const totalQty = Number(data.totalQty) || 0;
    const isUpdate = Boolean(data.isUpdate);
    const isCancel = Boolean(data.isCancel) || (isUpdate && !lines.length);

    if (!merchantId || !brandName || !date) {
      throw new HttpsError("invalid-argument", "merchantId, brandName, and date are required");
    }

    const merchantSnap = await db.collection("mmf_hub_merchants").doc(merchantId).get();
    if (!merchantSnap.exists) {
      throw new HttpsError("not-found", "Merchant not found");
    }

    const merchantData = merchantSnap.data() || {};
    const resolvedEmail =
      email ||
      String(merchantData.email || "").trim();
    if (!resolvedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail)) {
      throw new HttpsError("failed-precondition", "Merchant has no email on file");
    }
    if (!lines.length && !isCancel) {
      throw new HttpsError("invalid-argument", "Order has no items");
    }

    const order = {
      merchantId,
      brandName,
      date,
      email: resolvedEmail,
      contactPerson: contactPerson || String(merchantData.contactPerson || "").trim(),
      contactNumber: contactNumber || String(merchantData.contactNumber || "").trim(),
      lines,
      totalAmount,
      totalQty,
      orderId,
      isUpdate,
      isCancel,
    };

    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();
    const cfg = getEmailConfig();

    const merchantResult = await trySendEmail({
      to: resolvedEmail,
      subject: buildCrewMealOrderSubject(order),
      html: buildCrewMealOrderHtml(order),
      fromName: "Manila Matcha Fest",
    });

    const adminResult = await trySendEmail({
      to: cfg.notifyEmail,
      subject: buildCrewMealAdminSubject(order),
      html: buildCrewMealAdminHtml(order),
      fromName: "Manila Matcha Fest",
    });

    if (!merchantResult.sent) {
      throw new HttpsError("internal", merchantResult.error || "Failed to send confirmation email");
    }

    if (orderId) {
      await db
        .collection("mmf_hub_crew_meal_orders")
        .doc(orderId)
        .set(
          {
            confirmationEmail: {
              to: resolvedEmail,
              sent: true,
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
              isUpdate,
              isCancel,
              adminNotified: Boolean(adminResult.sent),
              adminError: adminResult.error || null,
            },
          },
          { merge: true }
        );
    }

    return {
      sent: true,
      to: resolvedEmail,
      isUpdate,
      isCancel,
      adminNotified: Boolean(adminResult.sent),
    };
  }
);

exports.sendMerchantHubAnnouncementEmails = onCall(
  {
    region: "asia-southeast1",
    secrets: [emailjsPrivateKey],
    timeoutSeconds: 540,
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const registrationId = String(request.data?.registrationId || "").trim();
    const includeAlreadySent = Boolean(request.data?.includeAlreadySent);
    const dryRun = Boolean(request.data?.dryRun);

    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();

    const snap = await db.collection(COLLECTION).get();
    let targets = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((doc) => !doc.archived && isSubmittedRegistration(doc));

    if (registrationId) {
      targets = targets.filter((doc) => doc.id === registrationId);
      if (!targets.length) {
        throw new HttpsError("not-found", "Submitted registration not found");
      }
    }

    const results = {
      sent: 0,
      skipped: 0,
      failed: 0,
      paidTemplate: 0,
      balanceTemplate: 0,
      details: [],
    };

    for (const doc of targets) {
      const email = String(doc.email || "").trim();
      const alreadySent = Boolean(doc.hubAnnouncementEmail?.sent);
      const hasBalance = merchantHasOutstandingBalance(doc);
      const template = hasBalance ? "balance" : "paid";

      if (!email) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          status: "skipped",
          reason: "no_email",
          template,
        });
        continue;
      }
      const accessCode = String(doc.hubAccessCode || "").trim().toUpperCase();
      if (!accessCode) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "skipped",
          reason: "no_access_code",
          template,
        });
        continue;
      }
      if (alreadySent && !includeAlreadySent && !registrationId) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "skipped",
          reason: "already_sent",
          template,
        });
        continue;
      }

      const emailDoc = { ...doc, hubAccessCode: accessCode };

      if (dryRun) {
        results.sent += 1;
        if (hasBalance) results.balanceTemplate += 1;
        else results.paidTemplate += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "dry_run",
          template,
          accessCode,
        });
        continue;
      }

      try {
        await sendEmail({
          to: email,
          subject: buildMerchantHubAnnouncementSubject(emailDoc),
          html: buildMerchantHubAnnouncementHtml(emailDoc),
          fromName: "Manila Matcha Fest",
        });
        await db.collection(COLLECTION).doc(doc.id).update({
          hubAnnouncementEmail: {
            sent: true,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            template,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results.sent += 1;
        if (hasBalance) results.balanceTemplate += 1;
        else results.paidTemplate += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "sent",
          template,
        });
        await sleep(350);
      } catch (err) {
        console.error("[MMF Email] hub announcement failed", doc.id, err?.message || err);
        results.failed += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "failed",
          template,
          reason: String(err?.message || err).slice(0, 200),
        });
      }
    }

    return results;
  }
);

exports.sendApologySalesReminderEmails = onCall(
  {
    region: "asia-southeast1",
    secrets: [emailjsPrivateKey],
    timeoutSeconds: 540,
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const registrationId = String(request.data?.registrationId || "").trim();
    const includeAlreadySent = Boolean(request.data?.includeAlreadySent);
    const dryRun = Boolean(request.data?.dryRun);
    const confirmBulk = Boolean(request.data?.confirmBulk);

    if (!registrationId && !dryRun && !confirmBulk) {
      throw new HttpsError(
        "failed-precondition",
        "Refusing bulk send without confirmBulk: true (or pass registrationId / dryRun)."
      );
    }

    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();

    const snap = await db.collection(COLLECTION).get();
    let targets = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((doc) => !doc.archived && isSubmittedRegistration(doc));

    if (registrationId) {
      targets = targets.filter((doc) => doc.id === registrationId);
      if (!targets.length) {
        throw new HttpsError("not-found", "Submitted registration not found");
      }
    }

    const results = {
      sent: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    for (const doc of targets) {
      const email = String(doc.email || "").trim();
      const alreadySent = Boolean(doc.apologySalesReminderEmail?.sent);

      if (!email) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          status: "skipped",
          reason: "no_email",
        });
        continue;
      }
      if (alreadySent && !includeAlreadySent && !registrationId) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "skipped",
          reason: "already_sent",
        });
        continue;
      }

      if (dryRun) {
        results.sent += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "dry_run",
        });
        continue;
      }

      try {
        await sendEmail({
          to: email,
          subject: buildApologySalesReminderSubject(doc),
          html: buildApologySalesReminderHtml(doc),
          fromName: "Manila Matcha Fest",
        });
        await db.collection(COLLECTION).doc(doc.id).update({
          apologySalesReminderEmail: {
            sent: true,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results.sent += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "sent",
        });
        await sleep(350);
      } catch (err) {
        console.error("[MMF Email] apology/sales reminder failed", doc.id, err?.message || err);
        results.failed += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "failed",
          reason: String(err?.message || err).slice(0, 200),
        });
      }
    }

    return results;
  }
);

exports.sendEventWrapupEmails = onCall(
  {
    region: "asia-southeast1",
    secrets: [emailjsPrivateKey],
    timeoutSeconds: 540,
    invoker: "public",
    cors: true,
  },
  async (request) => {
    const registrationId = String(request.data?.registrationId || "").trim();
    const includeAlreadySent = Boolean(request.data?.includeAlreadySent);
    const dryRun = Boolean(request.data?.dryRun);
    const confirmBulk = Boolean(request.data?.confirmBulk);

    if (!registrationId && !dryRun && !confirmBulk) {
      throw new HttpsError(
        "failed-precondition",
        "Refusing bulk send without confirmBulk: true (or pass registrationId / dryRun)."
      );
    }

    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();

    const snap = await db.collection(COLLECTION).get();
    let targets = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((doc) => !doc.archived && isSubmittedRegistration(doc));

    if (registrationId) {
      targets = targets.filter((doc) => doc.id === registrationId);
      if (!targets.length) {
        throw new HttpsError("not-found", "Submitted registration not found");
      }
    }

    const results = {
      sent: 0,
      skipped: 0,
      failed: 0,
      paidTemplate: 0,
      unpaidTemplate: 0,
      details: [],
    };

    for (const doc of targets) {
      const email = String(doc.email || "").trim();
      const alreadySent = Boolean(doc.eventWrapupEmail?.sent);
      const hasPendingFinal = merchantHasPendingFinalPayment(doc);
      const template = hasPendingFinal ? "unpaid" : "paid";

      if (isEventWrapupSkippedMerchant(doc)) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "skipped",
          reason: "organizer_skip",
          template,
        });
        continue;
      }

      if (!email) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          status: "skipped",
          reason: "no_email",
          template,
        });
        continue;
      }
      if (alreadySent && !includeAlreadySent && !registrationId) {
        results.skipped += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "skipped",
          reason: "already_sent",
          template,
        });
        continue;
      }

      if (dryRun) {
        results.sent += 1;
        if (hasPendingFinal) results.unpaidTemplate += 1;
        else results.paidTemplate += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "dry_run",
          template,
        });
        continue;
      }

      try {
        await sendEmail({
          to: email,
          subject: buildEventWrapupSubject(doc),
          html: buildEventWrapupHtml(doc),
          fromName: "Manila Matcha Fest",
        });
        await db.collection(COLLECTION).doc(doc.id).update({
          eventWrapupEmail: {
            sent: true,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            template,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results.sent += 1;
        if (hasPendingFinal) results.unpaidTemplate += 1;
        else results.paidTemplate += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "sent",
          template,
        });
        await sleep(350);
      } catch (err) {
        console.error("[MMF Email] event wrap-up failed", doc.id, err?.message || err);
        results.failed += 1;
        results.details.push({
          id: doc.id,
          brandName: doc.brandName,
          email,
          status: "failed",
          template,
          reason: String(err?.message || err).slice(0, 200),
        });
      }
    }

    return results;
  }
);

/**
 * Silent internal alert when a merchant saves/updates a daily sales report.
 * Merchants are not notified and nothing is shown in the hub UI.
 */
exports.onHubSalesReportWritten = onDocumentWritten(
  {
    document: `${SALES_COLLECTION}/{reportId}`,
    secrets: [emailjsPrivateKey],
    region: "asia-southeast1",
  },
  async (event) => {
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const before = beforeSnap?.exists ? beforeSnap.data() : null;
    const after = afterSnap?.exists ? afterSnap.data() : null;
    if (!after) return;
    if (!salesReportMeaningfulChange(before, after)) return;

    process.env.EMAILJS_PRIVATE_KEY = emailjsPrivateKey.value();
    const cfg = getEmailConfig();
    const doc = {
      id: event.params.reportId,
      ...after,
      _isUpdate: Boolean(before),
      _previousCashSales: before ? before.cashSales : null,
    };

    await trySendEmail({
      to: cfg.notifyEmail,
      subject: buildSalesReportNotifySubject(doc),
      html: buildSalesReportNotifyHtml(doc),
      fromName: "MMF Merchant Hub",
    });
  }
);

exports._internal = {
  isSubmittedRegistration,
  ensurePayPalInvoice,
  prepareRegistrationEmailDoc,
  buildCardPaymentDetailsHtml,
};
