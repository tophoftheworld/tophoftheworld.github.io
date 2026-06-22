/**
 * Single local server: hub + Shopify orders/workshops + Chatbase leads dashboard.
 * Run from repo root: npm run dev
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { handleShopifyHttp } from "../shopify-orders/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const HUB_ROOT = __dirname;
const SHOPIFY_ROOT = path.join(REPO_ROOT, "shopify-orders");
const LEADS_ROOT = path.join(REPO_ROOT, "chatbase-leads-dashboard", "public");
// Default local port matches start-server.bat (admin portal + inbox on one host).
const PORT = Number(process.env.PORT) || 8080;

const require = createRequire(import.meta.url);

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv(path.join(SHOPIFY_ROOT, ".env"));
loadEnv(path.join(REPO_ROOT, "chatbase-leads-dashboard", "functions", ".env"));

function loadFirebaseProjectId() {
  const fromEnv =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;
  if (fromEnv) {
    process.env.GCLOUD_PROJECT = fromEnv;
    process.env.GOOGLE_CLOUD_PROJECT = fromEnv;
    return fromEnv;
  }
  const rcPath = path.join(REPO_ROOT, "chatbase-leads-dashboard", ".firebaserc");
  if (!fs.existsSync(rcPath)) return null;
  try {
    const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
    const projectId = rc?.projects?.default;
    if (projectId) {
      process.env.GCLOUD_PROJECT = projectId;
      process.env.GOOGLE_CLOUD_PROJECT = projectId;
      return projectId;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveGoogleCredentials() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const candidates = [
    path.join(REPO_ROOT, "chatbase-leads-dashboard", "functions", "service-account.json"),
    path.join(REPO_ROOT, "chatbase-leads-dashboard", "functions", "firebase-adminsdk.json")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = candidate;
      return candidate;
    }
  }

  const winAdc = path.join(
    process.env.APPDATA || "",
    "gcloud",
    "application_default_credentials.json"
  );
  if (winAdc && fs.existsSync(winAdc)) return winAdc;

  const home = process.env.HOME || process.env.USERPROFILE || "";
  const unixAdc = path.join(home, ".config", "gcloud", "application_default_credentials.json");
  if (home && fs.existsSync(unixAdc)) return unixAdc;

  return null;
}

const firebaseProjectId = loadFirebaseProjectId();
const firebaseCredentials = resolveGoogleCredentials();
const REMOTE_LEADS_API =
  process.env.LEADS_API_REMOTE_URL || "https://matchanese-attendance.web.app";
const useRemoteServiceLeads = !firebaseCredentials;

const { getLeadsApiApp } = require("../chatbase-leads-dashboard/functions/index.js");
const leadsApiApp = getLeadsApiApp();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function isLeadsApi(pathname) {
  return /^\/api\/(conversations|service-leads|payment-intakes|health|webhooks|inbox)/.test(pathname);
}

function isRemoteLeadsApi(pathname, method = "GET") {
  if (pathname.includes("/resolve-conversation")) return false;
  if (pathname.startsWith("/api/conversations/resolve/")) return false;
  // Writes use local functions (full field edits); remote may lag behind.
  if (method === "PATCH" && /^\/api\/service-leads\/[^/]+$/.test(pathname)) return false;
  if (method === "POST" && pathname === "/api/service-leads/delete") return false;
  return (
    pathname.startsWith("/api/service-leads") ||
    pathname.startsWith("/api/payment-intakes") ||
    pathname === "/api/webhooks/payment-proof"
  );
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxyToRemoteLeadsApi(req, res) {
  const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const targetUrl = `${REMOTE_LEADS_API}${u.pathname}${u.search}`;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await readRequestBody(req) : undefined;
  const proxyRes = await fetch(targetUrl, { method: req.method, headers, body });
  const outHeaders = {};
  proxyRes.headers.forEach((value, key) => {
    outHeaders[key] = value;
  });
  res.writeHead(proxyRes.status, outHeaders);
  res.end(Buffer.from(await proxyRes.arrayBuffer()));
}

function isShopifyApi(pathname) {
  return pathname.startsWith("/api/") && !isLeadsApi(pathname);
}

function safeJoin(root, rel) {
  const decoded = decodeURIComponent(rel.replace(/^\/+/, "") || "index.html");
  if (decoded.includes("..")) return null;
  const filePath = path.join(root, decoded);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(filePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolved;
}

function sendStatic(res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = u.pathname;

  if (isRemoteLeadsApi(pathname, req.method) && useRemoteServiceLeads) {
    try {
      return await proxyToRemoteLeadsApi(req, res);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: err.message || "Remote API proxy failed" }));
    }
  }

  if (isLeadsApi(pathname)) {
    return leadsApiApp(req, res);
  }

  if (isShopifyApi(pathname)) {
    return handleShopifyHttp(req, res);
  }

  if (pathname === "/shopify" || pathname === "/shopify/") {
    return redirect(res, `/shopify/index.html${u.search || ""}`);
  }
  if (pathname === "/leads" || pathname === "/leads/") {
    return redirect(res, `/leads/index.html${u.search || ""}`);
  }
  if (pathname === "/workshops" || pathname === "/workshops/") {
    return redirect(res, "/shopify/workshops.html");
  }

  if (pathname.startsWith("/hub/")) {
    const filePath = safeJoin(HUB_ROOT, pathname.slice("/hub/".length));
    if (!filePath) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    return sendStatic(res, filePath);
  }

  if (pathname.startsWith("/shopify/")) {
    const filePath = safeJoin(SHOPIFY_ROOT, pathname.slice("/shopify/".length));
    if (!filePath) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    return sendStatic(res, filePath);
  }

  if (pathname.startsWith("/leads/")) {
    const filePath = safeJoin(LEADS_ROOT, pathname.slice("/leads/".length));
    if (!filePath) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    return sendStatic(res, filePath);
  }

  if (pathname === "/" || pathname === "/index.html") {
    return redirect(res, "/admin.html");
  }

  const rootRel = pathname.replace(/^\//, "") || "index.html";
  const rootFile = safeJoin(REPO_ROOT, rootRel);
  if (rootFile) {
    return sendStatic(res, rootFile);
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process, then run npm run dev again.`);
    console.error(`  PowerShell: Get-NetTCPConnection -LocalPort ${PORT} | Select OwningProcess`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Matchanese local server: http://127.0.0.1:${PORT}/`);
  console.log(`  Admin portal: http://127.0.0.1:${PORT}/admin.html`);
  console.log(`  Leads inbox: http://127.0.0.1:${PORT}/leads/`);
  if (firebaseProjectId) {
    console.log(`  Firebase project: ${firebaseProjectId}`);
  }
  if (useRemoteServiceLeads) {
    console.log(`  Service leads & payments list → ${REMOTE_LEADS_API} (no local Firestore credentials)`);
    console.log(`  Service lead edits (PATCH) → local Firestore`);
    console.log(`  Inbox summary + conversation lookup → local (Chatbase API from functions/.env)`);
  }
});
