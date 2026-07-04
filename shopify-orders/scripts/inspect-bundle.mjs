import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

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
const name = process.argv[2] || "M#2133";

const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_CLIENT_SECRET,
});
const tok =
    process.env.SHOPIFY_ACCESS_TOKEN ||
    (
        await (
            await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body,
            })
        ).json()
    ).access_token;

const h = { "X-Shopify-Access-Token": tok };
const base = `https://${SHOP}.myshopify.com/admin/api/${VER}`;
const res = await fetch(
    `${base}/orders.json?limit=1&status=any&name=${encodeURIComponent(name)}`,
    { headers: h }
);
const order = (await res.json()).orders?.[0];
if (!order) {
    console.log("Order not found");
    process.exit(1);
}

console.log(
    "REST:",
    JSON.stringify(
        (order.line_items || []).map((li) => ({
            id: li.id,
            title: li.title,
            price: li.price,
            properties: li.properties,
            sales_line_item_group_id: li.sales_line_item_group_id,
        })),
        null,
        2
    )
);

const gql = await fetch(`${base}/graphql.json`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({
        query: `query orderBundleLineItems($id: ID!) {
          order(id: $id) {
            lineItems(first: 50) {
              nodes {
                id
                title
                lineItemGroup { id title quantity }
              }
            }
          }
        }`,
        variables: { id: `gid://shopify/Order/${order.id}` },
    }),
});
console.log("GraphQL:", JSON.stringify(await gql.json(), null, 2));
