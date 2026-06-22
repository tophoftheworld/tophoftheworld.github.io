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
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
    }
}

loadEnv(path.join(root, ".env"));

const SHOP = (process.env.SHOPIFY_SHOP || "")
    .replace(/\.myshopify\.com$/i, "")
    .trim();
const VER = process.env.SHOPIFY_API_VERSION || "2024-10";

async function resolveAccessToken() {
    if (process.env.SHOPIFY_ACCESS_TOKEN) return process.env.SHOPIFY_ACCESS_TOKEN;
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    });
    const res = await fetch(
        `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        }
    );
    const payload = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(payload));
    return payload.access_token;
}

const token = await resolveAccessToken();
const headers = { "X-Shopify-Access-Token": token };
const base = `https://${SHOP}.myshopify.com/admin/api/${VER}`;

const { orders = [] } = await (
    await fetch(`${base}/orders.json?limit=15&status=any`, { headers })
).json();

const GQL = `
query OrderDelivery($id: ID!) {
  order(id: $id) {
    name
    displayFulfillmentStatus
    deliveryMethod { methodType presentedName }
    shippingLine { title source }
    fulfillmentOrders(first: 5) {
      nodes {
        id
        status
        deliveryMethod { methodType presentedName }
        supportedActions
      }
    }
  }
}`;

for (const o of orders) {
    const fos = (
        await (
            await fetch(`${base}/orders/${o.id}/fulfillment_orders.json`, {
                headers,
            })
        ).json()
    ).fulfillment_orders;

    const gqlPayload = await fetch(`${base}/graphql.json`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
            query: GQL,
            variables: { id: `gid://shopify/Order/${o.id}` },
        }),
    }).then((r) => r.json());
    const gql = gqlPayload.data?.order;

    console.log("\n---", o.name);
    console.log("REST shipping_lines:", (o.shipping_lines || []).map((sl) => ({
        title: sl.title,
        code: sl.code,
        source: sl.source,
        carrier_identifier: sl.carrier_identifier,
    })));
    const dm = fos?.[0]?.delivery_method;
    console.log("REST FO:", {
        status: fos?.[0]?.status,
        method_type: dm?.method_type,
        presented_name: dm?.presented_name,
        additional_information: dm?.additional_information,
        destination: fos?.[0]?.destination,
        assigned_location: fos?.[0]?.assigned_location?.name,
    });
    if (gqlPayload.errors) console.log("GraphQL errors:", gqlPayload.errors);
    else if (o === orders[0]) console.log("GraphQL sample:", JSON.stringify(gql, null, 2));
}

// Scan more orders for pick_up
console.log("\n=== Scanning for pick_up method_type ===");
let pageInfo = null;
let found = 0;
for (let page = 0; page < 4 && found < 5; page++) {
    const url = pageInfo
        ? `${base}/orders.json?limit=50&page_info=${pageInfo}`
        : `${base}/orders.json?limit=50&status=any`;
    const res = await fetch(url, { headers });
    const link = res.headers.get("link") || "";
    const data = await res.json();
    for (const o of data.orders || []) {
        const fos = (
            await (
                await fetch(`${base}/orders/${o.id}/fulfillment_orders.json`, {
                    headers,
                })
            ).json()
        ).fulfillment_orders;
        const types = (fos || []).map((fo) => fo.delivery_method?.method_type);
        if (types.includes("pick_up") || types.includes("PICK_UP")) {
            console.log(o.name, types, fos[0]?.delivery_method);
            found++;
        }
    }
    const m = link.match(/<[^>]+page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = m ? m[1] : null;
    if (!pageInfo) break;
}
console.log("pick_up orders found:", found);

let pickupStyle = 0;
let shipStyle = 0;
pageInfo = null;
for (let page = 0; page < 6; page++) {
    const url = pageInfo
        ? `${base}/orders.json?limit=50&page_info=${pageInfo}`
        : `${base}/orders.json?limit=50&status=any`;
    const res = await fetch(url, { headers });
    const link = res.headers.get("link") || "";
    const data = await res.json();
    for (const o of data.orders || []) {
        const fos = (
            await (
                await fetch(`${base}/orders/${o.id}/fulfillment_orders.json`, {
                    headers,
                })
            ).json()
        ).fulfillment_orders;
        const fo = fos?.[0];
        if (!fo) continue;
        const mt = fo.delivery_method?.method_type;
        const hasAddr = Boolean(
            String(
                fo.destination?.address1 || o.shipping_address?.address1 || ""
            ).trim()
        );
        const hasLoc = Boolean(fo.assigned_location?.name);
        if (mt === "shipping" || (hasAddr && mt !== "none")) shipStyle++;
        else if (
            mt === "pick_up" ||
            (mt === "none" && hasLoc && !hasAddr)
        )
            pickupStyle++;
    }
    const next = link.split(",").find((p) => p.includes('rel="next"'));
    const m = next?.match(/page_info=([^&>]+)/);
    pageInfo = m ? m[1] : null;
    if (!pageInfo) break;
}
console.log("pickupStyle (none+location, no addr):", pickupStyle);
console.log("shipStyle:", shipStyle);
