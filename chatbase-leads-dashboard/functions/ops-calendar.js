/**
 * Sync confirmed opsEvents to a shared Google Calendar.
 *
 * Env:
 *   GOOGLE_SA_KEY          service-account JSON (same as workshop sheets)
 *   GOOGLE_CALENDAR_ID     calendar id shared with the SA as writer
 *
 * Drafts and cancelled events are not pushed (cancelled removes if linked).
 */
const { google } = require("googleapis");
const admin = require("firebase-admin");

const OPS_EVENTS = "opsEvents";
const TIMEZONE = "Asia/Manila";

const TYPE_LABELS = {
  matcha_workshop: "Matcha Workshop",
  mochi_workshop: "Mochi Making Workshop",
  mobile_bar: "Mobile Matcha Bar",
  matcha_popup: "Matcha Bar Pop-up"
};

function isOpsCalendarConfigured() {
  return Boolean(
    (process.env.GOOGLE_SA_KEY || "").trim() &&
      (process.env.GOOGLE_CALENDAR_ID || "").trim()
  );
}

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

let calendarClient = null;
function getCalendar() {
  if (calendarClient) return calendarClient;
  const raw = process.env.GOOGLE_SA_KEY;
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (_) {
    throw new Error("GOOGLE_SA_KEY is not valid JSON");
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/calendar"]
  });
  calendarClient = google.calendar({ version: "v3", auth });
  return calendarClient;
}

function eventTitle(data) {
  const typeLabel = TYPE_LABELS[data.typeId] || data.typeId || "Event";
  const name = String(data.title || "").trim() || "Untitled";
  return `[${typeLabel}] ${name}`;
}

function buildGCalBody(data, opsEventId) {
  const startDate = data.startDate;
  const endDate = data.endDate && data.endDate >= startDate ? data.endDate : startDate;
  const hasTime = Boolean(data.startTime);

  let start;
  let end;
  if (hasTime) {
    const endTime = data.endTime || data.startTime;
    start = { dateTime: `${startDate}T${data.startTime}:00`, timeZone: TIMEZONE };
    end = { dateTime: `${endDate}T${endTime}:00`, timeZone: TIMEZONE };
  } else {
    // Exclusive end date for all-day events
    const [y, m, d] = endDate.split("-").map(Number);
    const next = new Date(y, m - 1, d + 1);
    const endExclusive = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    start = { date: startDate };
    end = { date: endExclusive };
  }

  const descriptionParts = [];
  if (data.venue) descriptionParts.push(`Venue: ${data.venue}`);
  if (data.notes) descriptionParts.push(data.notes);
  descriptionParts.push(`opsEventId: ${opsEventId}`);

  return {
    summary: eventTitle(data),
    location: data.venue || undefined,
    description: descriptionParts.join("\n\n"),
    start,
    end,
    extendedProperties: {
      private: { opsEventId }
    }
  };
}

/**
 * Sync one ops event document to Google Calendar.
 * @param {string} opsEventId
 * @param {object|null} data - null means deleted
 */
async function syncOpsEventToGoogleCalendar(opsEventId, data) {
  if (!isOpsCalendarConfigured()) {
    return { skipped: true, reason: "not_configured" };
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID.trim();
  const calendar = getCalendar();
  const db = getDb();
  const gcalId = data?.links?.googleCalendarEventId || null;

  if (!data || data.status === "cancelled" || data.status === "draft" || !data.startDate) {
    if (gcalId) {
      try {
        await calendar.events.delete({ calendarId, eventId: gcalId });
      } catch (err) {
        if (err?.code !== 404 && err?.status !== 404) throw err;
      }
      if (data) {
        await db
          .collection(OPS_EVENTS)
          .doc(opsEventId)
          .set(
            { links: { ...(data.links || {}), googleCalendarEventId: null } },
            { merge: true }
          );
      }
      return { ok: true, action: "deleted" };
    }
    return { skipped: true, reason: "not_syncable" };
  }

  const body = buildGCalBody(data, opsEventId);

  if (gcalId) {
    try {
      await calendar.events.patch({
        calendarId,
        eventId: gcalId,
        requestBody: body
      });
      return { ok: true, action: "patched", googleCalendarEventId: gcalId };
    } catch (err) {
      if (err?.code !== 404 && err?.status !== 404) throw err;
      // recreate below
    }
  }

  const inserted = await calendar.events.insert({
    calendarId,
    requestBody: body
  });
  const newId = inserted.data.id;
  await db
    .collection(OPS_EVENTS)
    .doc(opsEventId)
    .set(
      {
        links: { ...(data.links || {}), googleCalendarEventId: newId },
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  return { ok: true, action: "inserted", googleCalendarEventId: newId };
}

module.exports = {
  isOpsCalendarConfigured,
  syncOpsEventToGoogleCalendar,
  buildGCalBody,
  eventTitle
};
