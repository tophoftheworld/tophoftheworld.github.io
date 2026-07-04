/**
 * DRY-RUN ONLY: validates GraphQL fulfillmentCreate payload for an order.
 * Does NOT call Shopify. Pass --execute to actually fulfill (avoid on production).
 *
 * Usage:
 *   node scripts/test-graphql-shipped.mjs <orderId>           # dry run
 *   node scripts/test-graphql-shipped.mjs <orderId> --execute # live (dangerous)
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
    console.error(
        "Usage: node scripts/test-graphql-shipped.mjs <orderId> [--execute]"
    );
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

const foRes = await fetch(`${base}/orders/${orderId}/fulfillment_orders.json`, {
    headers: h,
});
const fos = (await foRes.json()).fulfillment_orders || [];

const shippingFOs = fos.filter(
    (fo) =>
        (fo.delivery_method?.method_type || "").toLowerCase() === "shipping" &&
        ["open", "in_progress", "scheduled"].includes(fo.status) &&
        (fo.line_items || []).some((li) => li.fulfillable_quantity > 0)
);

const lineItemsByFulfillmentOrder = shippingFOs.map((fo) => ({
    fulfillmentOrderId: `gid://shopify/FulfillmentOrder/${fo.id}`,
    fulfillmentOrderLineItems: (fo.line_items || [])
        .filter((li) => li.fulfillable_quantity > 0)
        .map((li) => ({
            id: `gid://shopify/FulfillmentOrderLineItem/${li.id}`,
            quantity: li.fulfillable_quantity,
        })),
}));

console.log(
    JSON.stringify(
        { orderId, shippingFOCount: shippingFOs.length, lineItemsByFulfillmentOrder },
        null,
        2
    )
);

if (!execute) {
    console.log("\nDry run only. Pass --execute to call fulfillmentCreate.");
    process.exit(0);
}

const gqlRes = await fetch(`${base}/graphql.json`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
        query: `mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id status }
            userErrors { field message }
          }
        }`,
        variables: {
            fulfillment: {
                notifyCustomer: false,
                trackingInfo: { number: "Shipped", company: "Other" },
                lineItemsByFulfillmentOrder,
            },
        },
    }),
});
const data = await gqlRes.json();
console.log(JSON.stringify(data, null, 2));
