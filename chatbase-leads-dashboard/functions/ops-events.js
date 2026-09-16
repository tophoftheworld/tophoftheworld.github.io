/**
 * Ops Events helpers for Cloud Functions (CommonJS).
 * Mirrors shared/js/ops-events.js promote + mapping logic.
 */
const admin = require("firebase-admin");

const OPS_EVENTS = "opsEvents";
const SERVICE_LEADS = "serviceLeads";

const LEAD_SERVICE_MOBILE_BAR = "private_mobile_matcha_bar";
const LEAD_SERVICE_WORKSHOP = "private_matcha_workshop";

function getDb() {
  if (!admin.apps.length) {
    const projectId =
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      "matchanese-attendance";
    admin.initializeApp({ projectId });
  }
  return admin.firestore();
}

function normalizeTargetDate(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function typeIdFromLead(lead) {
  const service = String(lead?.service || "").trim();
  const eventType = String(lead?.eventType || "").toLowerCase();
  if (service === LEAD_SERVICE_MOBILE_BAR) return "mobile_bar";
  if (service === LEAD_SERVICE_WORKSHOP) {
    if (eventType.includes("mochi")) return "mochi_workshop";
    return "matcha_workshop";
  }
  if (eventType.includes("mochi")) return "mochi_workshop";
  if (eventType.includes("mobile") || eventType.includes("bar")) return "mobile_bar";
  if (eventType.includes("popup") || eventType.includes("pop-up")) return "matcha_popup";
  return "matcha_workshop";
}

function headcountUnitForType(typeId) {
  if (typeId === "mobile_bar") return "cups";
  if (typeId === "matcha_workshop" || typeId === "mochi_workshop") return "pax";
  return null;
}

function parseHeadcount(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function resolveHeadcountFields(typeId, headcount, headcountUnit) {
  const unit = headcountUnit || headcountUnitForType(typeId) || null;
  if (!unit) return { headcount: null, headcountUnit: null };
  const n = parseHeadcount(headcount);
  if (n == null) return { headcount: null, headcountUnit: null };
  return { headcount: n, headcountUnit: unit };
}

function slugifyKey(name) {
  return (
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "event"
  );
}

function branchKeyForType(typeId, title) {
  const slug = slugifyKey(title);
  if (typeId === "matcha_popup") return `popup-${slug}`;
  if (typeId === "mobile_bar") return `service-${slug}`;
  return `workshop-${slug}`;
}

/**
 * Promote a service lead into a draft opsEvent.
 * @returns {{ id: string, alreadyLinked?: boolean, event: object }}
 */
async function promoteLeadToOpsEvent(leadId) {
  const db = getDb();
  const leadRef = db.collection(SERVICE_LEADS).doc(leadId);
  const leadSnap = await leadRef.get();
  if (!leadSnap.exists) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  const lead = { id: leadSnap.id, ...leadSnap.data() };

  if (lead.opsEventId) {
    const existing = await db.collection(OPS_EVENTS).doc(lead.opsEventId).get();
    return {
      id: lead.opsEventId,
      alreadyLinked: true,
      event: existing.exists ? { id: existing.id, ...existing.data() } : { id: lead.opsEventId }
    };
  }

  const startDate = normalizeTargetDate(lead.targetDate);
  if (!startDate) {
    const err = new Error("Set a target date on the lead before adding it to the calendar.");
    err.status = 400;
    throw err;
  }

  const typeId = typeIdFromLead(lead);
  const title = String(lead.clientName || lead.quoteReference || "").trim() || "Lead event";
  const noteParts = [];
  if (lead.quoteReference) noteParts.push(`Quote: ${lead.quoteReference}`);
  if (lead.eventType) noteParts.push(`Event type: ${lead.eventType}`);
  if (lead.notes) noteParts.push(String(lead.notes).trim());
  const { headcount, headcountUnit } = resolveHeadcountFields(typeId, lead.targetPax, null);

  const now = new Date().toISOString();
  const payload = {
    title,
    typeId,
    status: "draft",
    startDate,
    endDate: startDate,
    startTime: null,
    endTime: null,
    venue: String(lead.targetVenue || "").trim(),
    notes: noteParts.join("\n"),
    headcount,
    headcountUnit,
    key: branchKeyForType(typeId, title),
    serviceMode: null,
    links: {
      branchId: null,
      branchKey: null,
      forecastId: null,
      workshopEventId: null,
      googleCalendarEventId: null,
      leadId: lead.id
    },
    createdBy: "lead-promote",
    updatedBy: "lead-promote",
    createdAt: now,
    updatedAt: now
  };

  const eventRef = await db.collection(OPS_EVENTS).add(payload);
  await leadRef.update({
    opsEventId: eventRef.id,
    updatedAt: now
  });

  return { id: eventRef.id, event: { id: eventRef.id, ...payload } };
}

module.exports = {
  promoteLeadToOpsEvent,
  typeIdFromLead,
  normalizeTargetDate,
  OPS_EVENTS
};
