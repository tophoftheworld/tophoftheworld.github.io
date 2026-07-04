/**
 * Run handleShipped logic locally (uses .env). Dry-run by default.
 *   node scripts/test-local-fulfill.mjs <orderId> [--execute]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const orderId = args.find((a) => !a.startsWith("-"));

if (!orderId) {
    console.error("Usage: node scripts/test-local-fulfill.mjs <orderId> [--execute]");
    process.exit(1);
}

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1).trim();
    }
}

loadEnv(path.join(root, ".env"));

const { handleShopifyHttp } = await import(path.join(root, "server.mjs"));

const server = createServer((req, res) => handleShopifyHttp(req, res));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const body = JSON.stringify({ intent: "shipped" });
const pathname = `/api/orders/${orderId}/fulfill`;

if (!execute) {
    console.log("Would POST", pathname, body);
    console.log("Dry run. Pass --execute to call local server.");
    server.close();
    process.exit(0);
}

const started = Date.now();
const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body,
});
const text = await res.text();
console.log("Elapsed ms:", Date.now() - started);
console.log("Status:", res.status);
console.log("Body:", text);
server.close();
