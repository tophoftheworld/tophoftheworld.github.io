/**
 * Shows legacy REST fulfill payload (returns 406 on modern stores). Does NOT POST unless --execute.
 * Prefer test-graphql-shipped.mjs for fulfillment-order testing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const orderId = args.find((a) => !a.startsWith("-"));

if (!orderId) {
    console.error("Usage: node scripts/test-fulfill-shipped.mjs <orderId> [--execute]");
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

const SHOP = (process.env.SHOPIFY_SHOP || "")
    .replace(/\.myshopify\.com$/i, "")
    .trim();
const VER = process.env.SHOPIFY_API_VERSION || "2024-10";

const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_CLIENT_SECRET,
});
const tok =
    process.env.SHOPIFY_ACCESS_TOKEN ||
    (
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

const h = {
    "X-Shopify-Access-Token": tok,
    "Content-Type": "application/json",
};
const base = `https://${SHOP}.myshopify.com/admin/api/${VER}`;

const orderRes = await fetch(`${base}/orders/${orderId}.json`, { headers: h });
const order = (await orderRes.json()).order;
const lineItems = (order.line_items || []).filter(
    (li) => li.fulfillable_quantity > 0
);
const locRes = await fetch(`${base}/locations.json?limit=1`, { headers: h });
const locationId = (await locRes.json()).locations?.[0]?.id;

const payload = {
    fulfillment: {
        location_id: locationId,
        notify_customer: true,
        tracking_number: "Shipped",
        tracking_company: "Other",
        line_items: lineItems.map((li) => ({
            id: li.id,
            quantity: li.fulfillable_quantity,
        })),
    },
};

console.log(JSON.stringify({ orderId, payload }, null, 2));

if (!execute) {
    console.log("\nDry run only. Pass --execute to POST (legacy REST — usually 406).");
    process.exit(0);
}

const res = await fetch(`${base}/orders/${orderId}/fulfillments.json`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(payload),
});
const text = await res.text();
console.log("Status:", res.status);
console.log("Body:", text);
