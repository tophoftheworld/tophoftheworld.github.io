import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const name = process.argv[2] || "M#2053";

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (process.env[key] === undefined) process.env[key] = val;
    }
}
loadEnv(path.join(root, ".env"));

const SHOP = (process.env.SHOPIFY_SHOP || "")
    .replace(/\.myshopify\.com$/i, "")
    .trim();
const VER = process.env.SHOPIFY_API_VERSION || "2024-10";

const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_CLIENT_SECRET,
});
const tok = process.env.SHOPIFY_ACCESS_TOKEN
    ? process.env.SHOPIFY_ACCESS_TOKEN
    : (
          await (
              await fetch(
                  `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
                  {
                      method: "POST",
                      headers: {
                          "Content-Type": "application/x-www-form-urlencoded",
                      },
                      body,
                  }
              )
          ).json()
      ).access_token;

const h = { "X-Shopify-Access-Token": tok };
const base = `https://${SHOP}.myshopify.com/admin/api/${VER}`;

let found = null;
let pageInfo = null;
for (let i = 0; i < 20 && !found; i++) {
    const url = pageInfo
        ? `${base}/orders.json?limit=50&page_info=${pageInfo}`
        : `${base}/orders.json?limit=50&status=any&name=${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: h });
    const data = await res.json();
    found = (data.orders || []).find((o) => o.name === name);
    const link = res.headers.get("link") || "";
    const next = link.split(",").find((p) => p.includes('rel="next"'));
    const m = next?.match(/page_info=([^&>]+)/);
    pageInfo = m ? m[1] : null;
    if (!pageInfo) break;
}

if (!found) {
    console.log("Order not found:", name);
    process.exit(1);
}

const o = found;
const fos = (
    await (
        await fetch(`${base}/orders/${o.id}/fulfillment_orders.json`, {
            headers: h,
        })
    ).json()
).fulfillment_orders;

console.log("Order", o.name, o.id);
console.log("fulfillment_status", o.fulfillment_status);
console.log("shipping_lines", o.shipping_lines);
console.log("shipping_address", o.shipping_address);
console.log("fulfillments", (o.fulfillments || []).map((f) => ({
    status: f.status,
    shipment_status: f.shipment_status,
})));
console.log("FOs:", JSON.stringify(fos, null, 2));
