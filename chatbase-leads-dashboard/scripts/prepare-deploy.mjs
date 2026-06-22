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
const PUBLIC_SHOPIFY = path.join(DASHBOARD_ROOT, "public", "shopify");
const FUNCTIONS_SHOPIFY = path.join(DASHBOARD_ROOT, "functions", "shopify-orders");

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

if (!fs.existsSync(SHOPIFY_SRC)) {
  console.error("Missing shopify-orders at", SHOPIFY_SRC);
  process.exit(1);
}

rmDir(PUBLIC_SHOPIFY);
rmDir(FUNCTIONS_SHOPIFY);

copyTree(SHOPIFY_SRC, PUBLIC_SHOPIFY, { skipServer: true });
copyTree(SHOPIFY_SRC, FUNCTIONS_SHOPIFY, { skipServer: false });

ensureSharedAssets(PUBLIC_SHOPIFY);

for (const file of ["index.html", "workshop.html", "workshops.html"]) {
  patchShopifyHtml(path.join(PUBLIC_SHOPIFY, file));
}

console.log("Prepared Shopify hosting at public/shopify");
console.log("Prepared Shopify API bundle at functions/shopify-orders");
