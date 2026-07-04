/**
 * Cancel fulfillments on an order (undo accidental test fulfillments).
 * Usage: node scripts/revert-fulfillment.mjs <orderId>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const orderId = process.argv[2];

if (!orderId) {
    console.error("Usage: node scripts/revert-fulfillment.mjs <orderId>");
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
if (!order) {
    console.error("Order not found");
    process.exit(1);
}

console.log("Order", order.name, "fulfillment_status:", order.fulfillment_status);
const active = (order.fulfillments || []).filter((f) => f.status !== "cancelled");
console.log("Active fulfillments:", active.length);

for (const f of active) {
    const gid = `gid://shopify/Fulfillment/${f.id}`;
    console.log("Cancelling", gid);
    const res = await fetch(`${base}/graphql.json`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
            query: `mutation ($id: ID!) {
              fulfillmentCancel(id: $id) {
                fulfillment { id status }
                userErrors { field message }
              }
            }`,
            variables: { id: gid },
        }),
    });
    const data = await res.json();
    const result = data.data?.fulfillmentCancel;
    if (result?.userErrors?.length) {
        console.error("  userErrors:", result.userErrors);
    } else {
        console.log("  ->", result?.fulfillment?.status || data);
    }
}

const afterRes = await fetch(`${base}/orders/${orderId}.json`, { headers: h });
const after = (await afterRes.json()).order;
console.log(
    "After:",
    after.name,
    "fulfillment_status:",
    after.fulfillment_status ?? "unfulfilled",
    "fulfillable items:",
    (after.line_items || []).reduce((s, li) => s + li.fulfillable_quantity, 0)
);
