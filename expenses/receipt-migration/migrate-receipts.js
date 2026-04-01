/**
 * One-time migration: convert Firestore `expenses.receiptImage` base64 data URLs
 * into Firebase Storage download URLs.
 *
 * Requirements:
 * - Run with Firebase Admin credentials available (see `GOOGLE_APPLICATION_CREDENTIALS`).
 * - Script will write to Storage bucket configured by your Firebase project.
 *
 * Usage:
 *   cd expenses/receipt-migration
 *   npm install
 *   node migrate-receipts.js --pageSize=100 --stateFile=state.json
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = String(a).match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const pageSize = Number(args.pageSize || process.env.PAGE_SIZE || 100);
const stateFile = args.stateFile || process.env.STATE_FILE || "state.json";
const dryRun = String(args.dryRun || process.env.DRY_RUN || "").toLowerCase() === "true";

const statePath = path.resolve(__dirname, stateFile);
const MIGRATION_PREFIX = "expense-receipts";

function readState() {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      lastCreatedAt: null,
      processedCount: 0,
      updatedCount: 0,
      skippedCount: 0
    };
  }
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function isBase64DataUrlReceipt(value) {
  return typeof value === "string" && value.startsWith("data:image/") && value.includes(";base64,");
}

function getMimeFromDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,/);
  return m?.[1] || "image/jpeg";
}

function getExtFromMime(mime) {
  const type = String(mime || "image/jpeg").toLowerCase().trim();
  const ext = type.split("/")[1] || "jpeg";
  return ext.replace(/[^a-z0-9]/g, "") || "jpeg";
}

function dataUrlToBuffer(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] || "";
  return Buffer.from(base64, "base64");
}

async function main() {
  if (!admin.apps.length) {
    // Uses default application credentials (GOOGLE_APPLICATION_CREDENTIALS recommended)
    admin.initializeApp();
  }

  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  let state = readState();

  // Order by createdAt (ISO strings sort lexicographically).
  let query = db.collection("expenses").orderBy("createdAt").limit(pageSize);
  if (state.lastCreatedAt) {
    query = query.startAfter(state.lastCreatedAt);
  }

  console.log("[ReceiptMigration] Starting migration with:", { pageSize, dryRun, stateFile });

  // Keep looping until no more docs.
  while (true) {
    const snap = await query.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      const docId = docSnap.id;
      const data = docSnap.data() || {};

      const receiptImage = data.receiptImage;

      state.processedCount++;

      // Update state after we finish each doc (resumability).
      // Only advance pagination key when we have a createdAt string.
      const createdAt = typeof data.createdAt === "string" ? data.createdAt : null;
      if (createdAt) state.lastCreatedAt = createdAt;

      if (!isBase64DataUrlReceipt(receiptImage)) {
        state.skippedCount++;
        writeState(state);
        continue;
      }

      const mime = getMimeFromDataUrl(receiptImage);
      const ext = getExtFromMime(mime);
      const storagePath = `${MIGRATION_PREFIX}/${docId}.${ext}`;
      const file = bucket.file(storagePath);

      const signedExpiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10); // ~10 years
      let downloadUrl = null;

      try {
        if (!dryRun) {
          const buffer = dataUrlToBuffer(receiptImage);
          await file.save(buffer, {
            contentType: mime,
            resumable: false
          });

          const [url] = await file.getSignedUrl({
            action: "read",
            expires: signedExpiry
          });

          downloadUrl = url;

          await db.collection("expenses").doc(docId).update({
            receiptImage: downloadUrl,
            updatedAt: new Date().toISOString()
          });
        }

        state.updatedCount++;
        console.log(`[ReceiptMigration] Updated ${docId}`);
      } catch (err) {
        console.error(`[ReceiptMigration] Failed ${docId}:`, err);
      }

      writeState(state);
    }

    // Advance query window based on last doc in this page.
    const lastDoc = snap.docs[snap.docs.length - 1];
    const lastData = lastDoc.data() || {};
    const nextStart = (typeof lastData.createdAt === "string" && lastData.createdAt) || state.lastCreatedAt;
    if (!nextStart) {
      console.warn("[ReceiptMigration] Missing createdAt for pagination; stopping to avoid infinite loop.");
      break;
    }

    query = db.collection("expenses").orderBy("createdAt").startAfter(nextStart).limit(pageSize);
  }

  console.log("[ReceiptMigration] Done:", state);
}

main().catch((e) => {
  console.error("[ReceiptMigration] Fatal error:", e);
  process.exit(1);
});

