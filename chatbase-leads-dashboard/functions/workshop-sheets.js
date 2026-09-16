/**
 * Live Google Sheets sync for workshop rosters.
 *
 * One spreadsheet per workshop day, created inside a team Shared Drive.
 * Columns mirror the manual sheet exactly:
 *   Order ID | Name | Checked-In | Pass | Email | Contact Number |
 *   Time Slot | Milk Options | Payment Method | Notes
 *
 * Staff-entered columns (Checked-In, Notes) are preserved across syncs.
 *
 * Requires:
 *   - GOOGLE_SA_KEY               service-account JSON key (stringified)
 *   - WORKSHOP_SHEETS_DRIVE_ID    Shared Drive ID the sheets live in
 */
const path = require("path");
const { pathToFileURL } = require("url");
const admin = require("firebase-admin");

const COLLECTION = "workshopSheets";
const SHEET_TITLE = "Roster";
const MANAGED_ROWS = 2000; // rows we pre-format for validation / colors

const HEADERS = [
  "Order ID",
  "Name",
  "Checked-In",
  "Pass",
  "Email",
  "Contact Number",
  "Time Slot",
  "Milk Options",
  "Payment Method",
  "Notes",
];

const COL = {
  orderId: 0,
  name: 1,
  checkedIn: 2,
  pass: 3,
  email: 4,
  contact: 5,
  timeSlot: 6,
  milk: 7,
  payment: 8,
  notes: 9,
};

const PASS_OPTIONS = ["Basic Pass", "Premium Pass"];
const MILK_OPTIONS = ["Oat Milk", "Dairy", "Dairy Milk", "Oat", "Dairy + Oat", "No Milk"];

function isSheetsConfigured() {
  return Boolean(
    (process.env.GOOGLE_SA_KEY || "").trim() &&
      (process.env.WORKSHOP_SHEETS_DRIVE_ID || "").trim()
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

let googleClients = null;
function getGoogle() {
  if (googleClients) return googleClients;
  const { google } = require("googleapis");
  const raw = process.env.GOOGLE_SA_KEY;
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (_) {
    throw new Error("GOOGLE_SA_KEY is not valid JSON");
  }
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: (creds.private_key || "").replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  googleClients = {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
  return googleClients;
}

let serverModPromise;
function loadServerMod() {
  if (!serverModPromise) {
    const serverPath = path.join(__dirname, "shopify-orders", "server.mjs");
    serverModPromise = import(pathToFileURL(serverPath).href);
  }
  return serverModPromise;
}

async function loadRosterFn() {
  return (await loadServerMod()).getWorkshopRosterData;
}

function dayKey(eventId, sessionDate) {
  return `${String(eventId || "").trim()}_${String(sessionDate || "").trim()}`.replace(
    /[^\w-]/g,
    "_"
  );
}

function cleanWorkshopName(raw) {
  return String(raw || "Workshop")
    .replace(/\s*[-–]\s*\d+\s*$/u, "")
    .trim();
}

function spreadsheetTitle(day) {
  const name = cleanWorkshopName(day?.workshop);
  const date = day?.dateLabel || day?.sessionDate || "";
  return [name, date].filter(Boolean).join(" - ").slice(0, 180) || "Workshop Roster";
}

function participantValue(v) {
  const s = String(v == null ? "" : v).trim();
  return s === "—" ? "" : s;
}

/** Flatten roster into ordered sheet rows with a stable key for manual-column merge. */
function rosterToRows(data) {
  const sessions = (data && data.sessions) || [];
  const rows = [];
  for (const session of sessions) {
    const timeLabel =
      session.timeLabel ||
      [session.startTime, session.endTime].filter(Boolean).join(" – ") ||
      "";
    const participants = [...(session.participants || [])];
    participants.sort((a, b) => {
      const an = orderNum(a.orderName);
      const bn = orderNum(b.orderName);
      if (an !== bn) return an - bn;
      return (a.seatIndex ?? 0) - (b.seatIndex ?? 0);
    });
    for (const p of participants) {
      rows.push({
        key: rowKey(p),
        values: [
          p.orderName || "",
          participantValue(p.participant),
          "", // Checked-In (staff)
          p.pass || "",
          p.email || "",
          p.contact || "",
          p.noBooking ? "" : timeLabel,
          p.milk || "",
          participantValue(p.paymentMethod),
          "", // Notes (staff)
        ],
      });
    }
  }
  return rows;
}

function orderNum(name) {
  const m = String(name || "").match(/#(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function rowKey(p) {
  return [
    String(p.orderId || "").trim(),
    String(p.seatIndex ?? "").trim(),
    String(p.email || "").trim().toLowerCase(),
  ].join("|");
}

async function getMapping(eventId, sessionDate) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(dayKey(eventId, sessionDate)).get();
  if (!doc.exists) return null;
  return doc.data();
}

async function saveMapping(eventId, sessionDate, mapping) {
  const db = getDb();
  await db
    .collection(COLLECTION)
    .doc(dayKey(eventId, sessionDate))
    .set(
      {
        eventId: String(eventId),
        sessionDate: String(sessionDate),
        ...mapping,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
}

function sheetUrl(spreadsheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

async function createSpreadsheet(title) {
  const { drive, sheets } = getGoogle();
  const driveId = (process.env.WORKSHOP_SHEETS_DRIVE_ID || "").trim();
  const file = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: title,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [driveId],
    },
    fields: "id",
  });
  const spreadsheetId = file.data.id;
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  const sheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;
  await applyLayout(spreadsheetId, sheetId);
  return { spreadsheetId, sheetId };
}

function solid(r, g, b) {
  return { red: r, green: g, blue: b };
}

function textContainsRule(sheetId, colIndex, text, color) {
  return {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 1,
            endRowIndex: MANAGED_ROWS,
            startColumnIndex: colIndex,
            endColumnIndex: colIndex + 1,
          },
        ],
        booleanRule: {
          condition: {
            type: "TEXT_CONTAINS",
            values: [{ userEnteredValue: text }],
          },
          format: { backgroundColor: color },
        },
      },
      index: 0,
    },
  };
}

function oneOfListValidation(sheetId, colIndex, options) {
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: MANAGED_ROWS,
        startColumnIndex: colIndex,
        endColumnIndex: colIndex + 1,
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: options.map((v) => ({ userEnteredValue: v })),
        },
        showCustomUi: true,
        strict: false,
      },
    },
  };
}

/** Header styling, freeze, checkbox, dropdowns, and colored badges (once, at create). */
async function applyLayout(spreadsheetId, sheetId) {
  const { sheets } = getGoogle();
  const requests = [];

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        title: SHEET_TITLE,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: "title,gridProperties.frozenRowCount",
    },
  });

  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: solid(0.17, 0.55, 0.28),
          textFormat: {
            foregroundColor: solid(1, 1, 1),
            bold: true,
          },
          horizontalAlignment: "LEFT",
        },
      },
      fields:
        "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  requests.push({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: MANAGED_ROWS,
        startColumnIndex: COL.checkedIn,
        endColumnIndex: COL.checkedIn + 1,
      },
      rule: { condition: { type: "BOOLEAN" } },
    },
  });

  requests.push(oneOfListValidation(sheetId, COL.pass, PASS_OPTIONS));
  requests.push(oneOfListValidation(sheetId, COL.milk, MILK_OPTIONS));

  // Pass badges
  requests.push(textContainsRule(sheetId, COL.pass, "Premium", solid(0.85, 0.82, 0.98)));
  requests.push(textContainsRule(sheetId, COL.pass, "Basic", solid(1, 0.95, 0.7)));

  // Time slot badges (morning vs afternoon)
  requests.push(textContainsRule(sheetId, COL.timeSlot, "AM", solid(1, 0.96, 0.76)));
  requests.push(textContainsRule(sheetId, COL.timeSlot, "PM", solid(0.79, 0.9, 0.98)));

  // Payment badges
  const payColors = [
    ["PayPal", solid(0.79, 0.9, 0.98)],
    ["GCash", solid(0.8, 0.93, 0.86)],
    ["BDO", solid(0.68, 0.82, 0.98)],
    ["BPI", solid(0.98, 0.78, 0.78)],
    ["UB", solid(0.99, 0.86, 0.72)],
    ["UnionBank", solid(0.99, 0.86, 0.72)],
  ];
  for (const [text, color] of payColors) {
    requests.push(textContainsRule(sheetId, COL.payment, text, color));
  }

  const widths = [90, 200, 80, 120, 240, 140, 150, 120, 150, 220];
  widths.forEach((px, i) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    });
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function readManualColumns(spreadsheetId) {
  const { sheets } = getGoogle();
  const map = new Map();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_TITLE}!A2:J${MANAGED_ROWS}`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const rows = res.data.values || [];
    for (const r of rows) {
      const key = [
        String(r[COL.orderId] || "").trim(),
        // seatIndex is not stored in the sheet; fall back to email-only match below
      ].join("|");
      const email = String(r[COL.email] || "").trim().toLowerCase();
      const name = String(r[COL.name] || "").trim().toLowerCase();
      const manual = { checkedIn: r[COL.checkedIn], notes: r[COL.notes] };
      map.set(`${key}|${email}|${name}`, manual);
    }
  } catch (_) {
    /* first sync / empty sheet */
  }
  return map;
}

function manualLookupKey(rowValues) {
  const orderId = String(rowValues[COL.orderId] || "").match(/#(\d+)/i);
  return [
    orderId ? orderId[0] : String(rowValues[COL.orderId] || "").trim(),
    String(rowValues[COL.email] || "").trim().toLowerCase(),
    String(rowValues[COL.name] || "").trim().toLowerCase(),
  ].join("|");
}

async function writeRows(spreadsheetId, rows, previousManual) {
  const { sheets } = getGoogle();

  const body = rows.map((row) => {
    const values = [...row.values];
    if (previousManual) {
      const prev = previousManual.get(manualLookupKey(values));
      if (prev) {
        if (prev.checkedIn !== undefined && prev.checkedIn !== "") {
          values[COL.checkedIn] = prev.checkedIn;
        }
        if (prev.notes !== undefined && prev.notes !== "") {
          values[COL.notes] = prev.notes;
        }
      }
    }
    return values;
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SHEET_TITLE}!A2:J${MANAGED_ROWS}`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TITLE}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [HEADERS, ...body] },
  });
}

function applyRosterNameOverrides(data, names) {
  const map = names && typeof names === "object" ? names : {};
  const apply = (list) => {
    for (const p of list || []) {
      const key = `${String(p.orderId || "").trim()}_${String(p.seatIndex ?? "").trim()}`;
      const next = String(map[key] || "").trim();
      if (next) p.participant = next;
    }
  };
  for (const session of data?.sessions || []) apply(session.participants);
  apply(data?.participants);
  return data;
}

async function loadRosterNameOverrides(eventId, sessionDate) {
  try {
    const snap = await getDb()
      .collection("workshopRosterMeta")
      .doc(dayKey(eventId, sessionDate))
      .get();
    if (!snap.exists) return {};
    const names = snap.data()?.names;
    return names && typeof names === "object" ? names : {};
  } catch (_) {
    return {};
  }
}

async function fetchRoster(eventId, sessionDate) {
  const getWorkshopRosterData = await loadRosterFn();
  const data = await getWorkshopRosterData(eventId, sessionDate);
  const names = await loadRosterNameOverrides(eventId, sessionDate);
  return applyRosterNameOverrides(data, names);
}

/** Idempotent: create the sheet if missing, then write current roster. */
async function exportWorkshopSheet(eventId, sessionDate) {
  if (!isSheetsConfigured()) {
    const err = new Error("Google Sheets integration is not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  const data = await fetchRoster(eventId, sessionDate);
  const rows = rosterToRows(data);

  let mapping = await getMapping(eventId, sessionDate);
  let created = false;
  if (!mapping?.spreadsheetId) {
    const { spreadsheetId } = await createSpreadsheet(spreadsheetTitle(data.day));
    mapping = { spreadsheetId, url: sheetUrl(spreadsheetId) };
    await saveMapping(eventId, sessionDate, mapping);
    created = true;
  }

  const previousManual = created
    ? null
    : await readManualColumns(mapping.spreadsheetId);
  await writeRows(mapping.spreadsheetId, rows, previousManual);
  await saveMapping(eventId, sessionDate, {
    lastSyncedAt: new Date().toISOString(),
    rowCount: rows.length,
  });

  return { url: mapping.url, created, rowCount: rows.length };
}

/** Sync only if a sheet already exists (used by webhooks + on-view refresh). */
async function syncWorkshopSheet(eventId, sessionDate) {
  if (!isSheetsConfigured()) return { synced: false, reason: "not_configured" };
  const mapping = await getMapping(eventId, sessionDate);
  if (!mapping?.spreadsheetId) return { synced: false, reason: "no_sheet" };

  const data = await fetchRoster(eventId, sessionDate);
  const rows = rosterToRows(data);
  const previousManual = await readManualColumns(mapping.spreadsheetId);
  await writeRows(mapping.spreadsheetId, rows, previousManual);
  await saveMapping(eventId, sessionDate, {
    lastSyncedAt: new Date().toISOString(),
    rowCount: rows.length,
  });
  return { synced: true, url: mapping.url, rowCount: rows.length };
}

/** Sync every existing sheet touched by a Shopify order (webhook-driven). */
async function syncWorkshopSheetsForOrder(order) {
  if (!isSheetsConfigured()) return { synced: 0, days: 0 };
  const { workshopDaysForOrder } = await loadServerMod();
  const days = workshopDaysForOrder(order) || [];
  let synced = 0;
  for (const d of days) {
    try {
      const r = await syncWorkshopSheet(d.eventId, d.sessionDate);
      if (r.synced) synced += 1;
    } catch (_) {
      /* keep going for other days */
    }
  }
  return { synced, days: days.length };
}

async function getWorkshopSheetInfo(eventId, sessionDate) {
  if (!isSheetsConfigured()) {
    return { configured: false, exists: false };
  }
  const mapping = await getMapping(eventId, sessionDate);
  return {
    configured: true,
    exists: Boolean(mapping?.spreadsheetId),
    url: mapping?.url || null,
    lastSyncedAt: mapping?.lastSyncedAt || null,
  };
}

module.exports = {
  isSheetsConfigured,
  exportWorkshopSheet,
  syncWorkshopSheet,
  syncWorkshopSheetsForOrder,
  getWorkshopSheetInfo,
  applyRosterNameOverrides,
};
