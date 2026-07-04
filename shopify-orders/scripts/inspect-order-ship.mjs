/**
 * Inspect an order for shipping fulfill debugging.
 * Usage: node scripts/inspect-order-ship.mjs M#2119
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const query = process.argv[2];

if (!query) {
    console.error("Usage: node scripts/inspect-order-ship.mjs <order name or id>");
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

const h = { "X-Shopify-Access-Token": tok, "Content-Type": "application/json" };
const base = `https://${SHOP}.myshopify.com/admin/api/${VER}`;

let orderId = query.replace(/\D/g, "");
if (query.includes("#") || query.includes("M")) {
    const name = query.includes("#") ? query : `M#${query.replace(/^M/i, "")}`;
    const searchRes = await fetch(
        `${base}/orders.json?status=any&name=${encodeURIComponent(name)}&limit=1`,
        { headers: h }
    );
    const found = (await searchRes.json()).orders?.[0];
    if (!found) {
        console.error("Order not found:", name);
        process.exit(1);
    }
    orderId = String(found.id);
}

const orderRes = await fetch(`${base}/orders/${orderId}.json`, { headers: h });
const order = (await orderRes.json()).order;
console.log("Order:", order.name, "id:", order.id);
console.log("financial:", order.financial_status, "fulfillment:", order.fulfillment_status);
console.log(
    "line items:",
    (order.line_items || []).map((li) => ({
        title: li.title,
        fulfillable: li.fulfillable_quantity,
        requires_shipping: li.requires_shipping,
    }))
);

const foRes = await fetch(`${base}/orders/${orderId}/fulfillment_orders.json`, {
    headers: h,
});
const fos = (await foRes.json()).fulfillment_orders || [];
console.log("\nFulfillment orders:", fos.length);
for (const fo of fos) {
    console.log({
        id: fo.id,
        status: fo.status,
        method_type: fo.delivery_method?.method_type,
        presented: fo.delivery_method?.presented_name,
        assigned: fo.assigned_location?.name,
        line_items: (fo.line_items || []).map((li) => ({
            id: li.id,
            fulfillable: li.fulfillable_quantity,
        })),
    });
}

// Dry-run payload like handleShipped
const shippingFOs = fos.filter(
    (fo) => {
        const mt = (fo.delivery_method?.method_type || "").toLowerCase().replace(/-/g, "_");
        const isShip = mt === "shipping" || mt === "local";
        const dest = fo.destination || order.shipping_address || {};
        const hasAddr = Boolean(String(dest.address1 || "").trim());
        return (isShip || hasAddr) &&
            !["pick_up", "pickup"].includes(mt) &&
            ["open", "in_progress", "scheduled"].includes(fo.status) &&
            (fo.line_items || []).some((li) => li.fulfillable_quantity > 0);
    }
);
console.log("\nWould ship via", shippingFOs.length, "FO(s)");
