/**
 * Stage staff portal + admin dashboard into hosting-staff/
 * Usage: node scripts/prepare-staff-hosting.mjs
 * Deploy: firebase deploy --only hosting:staff --project matchanese-attendance
 */
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DEST = join(ROOT, "hosting-staff");

const ROOT_FILES = [
  "index.html",
  "login.html",
  "admin.html",
  "admin-login.html",
  "daily-sales.html",
  "expense-input.html",
  "manifest.webmanifest",
  "sw.js",
  "staff.json",
];

const DIRS = [
  "js",
  "shared",
  "icons",
  "img",
  "css",
  "employee-attendance",
  "payroll",
  "schedule",
  "expenses",
  "inventory",
  "pos",
  "sales",
  "reports",
  "admin-payroll",
  "admin-staff",
  "admin-scheduling",
  "admin-requests",
  "admin-13th",
  "profile",
  "register",
  "money-manager",
  "wrapped-analysis",
  "invoice-generator",
  "menu-creator",
  "mobile-orders",
  "matcha-quotation",
  "matcha-pricing",
  "matcha-costing",
  "matcha-supply",
  "pdf-signer",
  "certificate-generator",
];

function shouldCopy(srcPath) {
  const parts = srcPath.split(/[/\\]/);
  if (parts.includes("node_modules") || parts.includes(".git")) return false;
  if (parts.includes("money-manager") && parts.includes("data")) return false;
  return true;
}

function dirSizeMb(dir) {
  let total = 0;
  const walk = (p) => {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  walk(dir);
  return (total / (1024 * 1024)).toFixed(1);
}

if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

for (const file of ROOT_FILES) {
  const src = join(ROOT, file);
  if (existsSync(src)) cpSync(src, join(DEST, file));
}

for (const dir of DIRS) {
  const src = join(ROOT, dir);
  if (!existsSync(src)) {
    console.warn(`skip missing: ${dir}`);
    continue;
  }
  cpSync(src, join(DEST, dir), { recursive: true, filter: shouldCopy });
}

console.log(`Prepared hosting-staff/ (${dirSizeMb(DEST)} MB) for full staff + admin deploy`);
