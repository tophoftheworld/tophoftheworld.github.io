/**
 * Bundle Shopify dashboard static files + server into Firebase deploy artifacts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DASHBOARD_ROOT, "..");
const SHOPIFY_SRC = path.join(REPO_ROOT, "shopify-orders");
const PUBLIC_ROOT = path.join(DASHBOARD_ROOT, "public");
const PUBLIC_SHOPIFY = path.join(PUBLIC_ROOT, "shopify");
const PUBLIC_LEADS = path.join(PUBLIC_ROOT, "leads");
const PUBLIC_WORKSHOPS = path.join(PUBLIC_ROOT, "workshops");
const FUNCTIONS_SHOPIFY = path.join(DASHBOARD_ROOT, "functions", "shopify-orders");

const LEADS_HOSTING_SKIP = new Set(["shopify", "leads", "workshops", "i"]);

const SKIP_NAMES = new Set([
  ".env",
  ".env.example",
  "node_modules",
  "Open-Dashboard.cmd",
  "package.json",
  "README.md"
]);

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyTree(src, dest, { skipServer = false } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (SKIP_NAMES.has(name)) continue;
    if (skipServer && (name === "server.mjs" || name === "scripts")) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to, { skipServer });
    else fs.copyFileSync(from, to);
  }
}

function patchShopifyHtml(filePath) {
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, "utf8");
  html = html
    .replaceAll('href="/hub/hub-shell.css"', 'href="css/hub-shell.css"')
    .replaceAll('href="/hub/hub.css"', 'href="css/hub.css"')
    .replaceAll('src="/hub/hub.js"', 'src="js/hub.js"');
  fs.writeFileSync(filePath, html);
}

function ensureSharedAssets(targetRoot) {
  const cssDir = path.join(targetRoot, "css");
  const jsDir = path.join(targetRoot, "js");
  const imgDir = path.join(targetRoot, "img");
  fs.mkdirSync(cssDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });

  for (const file of ["hub-shell.css", "hub.css"]) {
    fs.copyFileSync(
      path.join(DASHBOARD_ROOT, "public", "css", file),
      path.join(cssDir, file)
    );
  }
  fs.copyFileSync(path.join(DASHBOARD_ROOT, "public", "js", "hub.js"), path.join(jsDir, "hub.js"));
  const logo = path.join(DASHBOARD_ROOT, "public", "img", "matchanese-logo.png");
  if (fs.existsSync(logo)) {
    fs.copyFileSync(logo, path.join(imgDir, "matchanese-logo.png"));
  }
}

function patchWorkshopsHtml(filePath) {
  if (!fs.existsSync(filePath)) return;
  patchShopifyHtml(filePath);
  let html = fs.readFileSync(filePath, "utf8");
  html = html
    .replaceAll('href="css/', 'href="/workshops/css/')
    .replaceAll('src="js/', 'src="/workshops/js/')
    .replaceAll('src="img/', 'src="/workshops/img/');
  fs.writeFileSync(filePath, html);
}

function copyWorkshopsHosting() {
  rmDir(PUBLIC_WORKSHOPS);
  copyTree(SHOPIFY_SRC, PUBLIC_WORKSHOPS, { skipServer: true });
  // Orders dashboard lives at /shopify/ only; /workshops/ is workshop management.
  const workshopsIndex = path.join(PUBLIC_WORKSHOPS, "index.html");
  if (fs.existsSync(workshopsIndex)) fs.rmSync(workshopsIndex);
  ensureSharedAssets(PUBLIC_WORKSHOPS);
  for (const file of ["workshop.html", "workshops.html"]) {
    patchWorkshopsHtml(path.join(PUBLIC_WORKSHOPS, file));
  }
}

function copyLeadsHosting() {
  rmDir(PUBLIC_LEADS);
  fs.mkdirSync(PUBLIC_LEADS, { recursive: true });
  for (const name of fs.readdirSync(PUBLIC_ROOT)) {
    if (LEADS_HOSTING_SKIP.has(name)) continue;
    const from = path.join(PUBLIC_ROOT, name);
    const to = path.join(PUBLIC_LEADS, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

if (!fs.existsSync(SHOPIFY_SRC)) {
  console.error("Missing shopify-orders at", SHOPIFY_SRC);
  process.exit(1);
}

rmDir(PUBLIC_SHOPIFY);
rmDir(PUBLIC_LEADS);
rmDir(PUBLIC_WORKSHOPS);
rmDir(FUNCTIONS_SHOPIFY);

copyTree(SHOPIFY_SRC, PUBLIC_SHOPIFY, { skipServer: true });
copyTree(SHOPIFY_SRC, FUNCTIONS_SHOPIFY, { skipServer: false });

ensureSharedAssets(PUBLIC_SHOPIFY);

for (const file of ["index.html", "workshop.html", "workshops.html"]) {
  patchShopifyHtml(path.join(PUBLIC_SHOPIFY, file));
}

function copyPublicInvoiceAssets(dest) {
  const src = path.join(REPO_ROOT, "invoice-generator");
  rmDir(dest);
  fs.mkdirSync(path.join(dest, "css"), { recursive: true });
  fs.mkdirSync(path.join(dest, "js"), { recursive: true });
  fs.mkdirSync(path.join(dest, "img"), { recursive: true });
  fs.copyFileSync(path.join(src, "view.html"), path.join(dest, "index.html"));
  fs.copyFileSync(path.join(src, "css", "invoice-view.css"), path.join(dest, "css", "invoice-view.css"));
  fs.copyFileSync(
    path.join(src, "css", "invoice-pdf-document.css"),
    path.join(dest, "css", "invoice-pdf-document.css")
  );
  fs.copyFileSync(path.join(src, "js", "invoice-page-render.js"), path.join(dest, "js", "invoice-page-render.js"));
  fs.copyFileSync(path.join(src, "js", "invoice-pdf-legacy.js"), path.join(dest, "js", "invoice-pdf-legacy.js"));
  fs.copyFileSync(path.join(src, "js", "invoice-view.js"), path.join(dest, "js", "invoice-view.js"));
  fs.copyFileSync(path.join(src, "img", "logo.png"), path.join(dest, "img", "logo.png"));
  fs.copyFileSync(
    path.join(src, "img", "matchanese-logo-full.png"),
    path.join(dest, "img", "matchanese-logo-full.png")
  );
  fs.copyFileSync(path.join(src, "img", "sign.png"), path.join(dest, "img", "sign.png"));
  fs.copyFileSync(path.join(src, "img", "og-social.jpg"), path.join(dest, "img", "og-social.jpg"));
  const qrSrc = path.join(src, "img", "qr");
  const qrDest = path.join(dest, "img", "qr");
  fs.mkdirSync(qrDest, { recursive: true });
  for (const name of fs.readdirSync(qrSrc)) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    fs.copyFileSync(path.join(qrSrc, name), path.join(qrDest, name));
  }
}

function copyPublicInvoiceHosting() {
  // Keep /i on the main attendance site for old links.
  copyPublicInvoiceAssets(path.join(PUBLIC_ROOT, "i"));
  // Dedicated customer invoice site (matchanese-invoice.web.app).
  const invoiceSiteRoot = path.join(DASHBOARD_ROOT, "public-invoice");
  const invoiceSiteI = path.join(invoiceSiteRoot, "i");
  rmDir(invoiceSiteRoot);
  fs.mkdirSync(invoiceSiteRoot, { recursive: true });
  copyPublicInvoiceAssets(invoiceSiteI);
  // Root OG image for crawlers (cleaner URL than /i/img/...).
  fs.copyFileSync(
    path.join(REPO_ROOT, "invoice-generator", "img", "og-social.jpg"),
    path.join(invoiceSiteRoot, "og-social.jpg")
  );
  // Also on attendance public root for the same absolute OG URL fallback.
  fs.copyFileSync(
    path.join(REPO_ROOT, "invoice-generator", "img", "og-social.jpg"),
    path.join(PUBLIC_ROOT, "og-social.jpg")
  );
  // Shell HTML for Cloud Function (injects correct og:url per token).
  fs.copyFileSync(
    path.join(REPO_ROOT, "invoice-generator", "view.html"),
    path.join(DASHBOARD_ROOT, "functions", "invoice-page-shell.html")
  );
}

copyWorkshopsHosting();
copyLeadsHosting();
copyPublicInvoiceHosting();

console.log("Prepared Shopify hosting at public/shopify");
console.log("Prepared Workshops hosting at public/workshops");
console.log("Prepared Leads hosting at public/leads");
console.log("Prepared public invoice page at public/i");
console.log("Prepared matchanese-invoice site at public-invoice");
console.log("Prepared Shopify API bundle at functions/shopify-orders");
