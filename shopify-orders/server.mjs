/**
 * Local static server + Shopify Admin API proxy.
 * Reads shopify-orders/.env (see .env.example).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { paymentMethodDisplay } from "./js/payment-method.js";
import {
    buildSessionCatalogFromOrders,
    buildWorkshopDayIndex,
    expandRegistrationToSeatRowsWithFallback,
    normalizeOrderSeatLabels,
    findInferredSessionForTarget,
    findNextSessionAfter,
    formatWorkshopDisplayName,
    inferRegistrationStub,
    sessionsForLineItem,
    orderContactFallback,
    orderCreatedDateIso,
    parseRegistrationFromLineItem,
    parseTimeSortKey,
    sessionSlotKey,
} from "./js/registration-core.mjs";
import { mergeLineItemBundleMeta } from "./js/bundle-line-items.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3847;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
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

loadEnv(path.join(__dirname, ".env"));

const SHOP = (process.env.SHOPIFY_SHOP || "").replace(/\.myshopify\.com$/i, "").trim();
const STATIC_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();

let cachedOAuthToken = null;
let cachedOAuthExpiry = 0;
let cachedLocationId = null;

const SHOPIFY_MIN_GAP_MS = 520;
const SHOPIFY_MAX_RETRIES = 6;

let shopifyApiTail = Promise.resolve();
let lastShopifyCallFinishedAt = 0;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleShopifyCall(fn) {
    const job = shopifyApiTail.then(fn, fn);
    shopifyApiTail = job.then(
        () => {},
        () => {}
    );
    return job;
}

async function waitShopifyGap() {
    const elapsed = Date.now() - lastShopifyCallFinishedAt;
    const wait = SHOPIFY_MIN_GAP_MS - elapsed;
    if (wait > 0) await sleep(wait);
}

function shopifyErrorMessage(body, res) {
    const msg = body?.errors || body?.error || `Shopify HTTP ${res.status}`;
    return typeof msg === "string" ? msg : JSON.stringify(msg);
}

function isShopifyRateLimit(res, message) {
    if (res.status === 429) return true;
    const s = String(message || "").toLowerCase();
    return (
        s.includes("2 calls per second") ||
        s.includes("throttle") ||
        s.includes("rate limit") ||
        s.includes("too many requests")
    );
}

async function shopifyRest(path, options = {}) {
    return scheduleShopifyCall(async () => {
        for (let attempt = 0; attempt <= SHOPIFY_MAX_RETRIES; attempt++) {
            await waitShopifyGap();
            const token = await resolveAccessToken();
            const url = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}${path}`;
            const res = await fetch(url, {
                ...options,
                headers: {
                    "X-Shopify-Access-Token": token,
                    "Content-Type": "application/json",
                    ...(options.headers || {}),
                },
            });
            const text = await res.text();
            let body;
            try {
                body = text ? JSON.parse(text) : {};
            } catch {
                body = { errors: text || res.statusText };
            }
            lastShopifyCallFinishedAt = Date.now();

            if (!res.ok) {
                const message = shopifyErrorMessage(body, res);
                if (
                    isShopifyRateLimit(res, message) &&
                    attempt < SHOPIFY_MAX_RETRIES
                ) {
                    const retryAfterSec = Number(res.headers.get("retry-after"));
                    const backoff =
                        retryAfterSec > 0
                            ? retryAfterSec * 1000
                            : Math.min(1500 * 2 ** attempt, 12000);
                    await sleep(backoff);
                    continue;
                }
                throw new Error(message);
            }
            return { body, headers: res.headers };
        }
        throw new Error(
            "Shopify API rate limit: please retry in a few seconds."
        );
    });
}

async function shopifyGraphql(query, variables = {}) {
    return scheduleShopifyCall(async () => {
        for (let attempt = 0; attempt <= SHOPIFY_MAX_RETRIES; attempt++) {
            await waitShopifyGap();
            const token = await resolveAccessToken();
            const res = await fetch(
                `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
                {
                    method: "POST",
                    headers: {
                        "X-Shopify-Access-Token": token,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ query, variables }),
                }
            );
            const payload = await res.json().catch(() => ({}));
            lastShopifyCallFinishedAt = Date.now();

            if (!res.ok) {
                const message =
                    payload?.errors?.[0]?.message || res.statusText;
                if (
                    isShopifyRateLimit(res, message) &&
                    attempt < SHOPIFY_MAX_RETRIES
                ) {
                    const retryAfterSec = Number(res.headers.get("retry-after"));
                    const backoff =
                        retryAfterSec > 0
                            ? retryAfterSec * 1000
                            : Math.min(1500 * 2 ** attempt, 12000);
                    await sleep(backoff);
                    continue;
                }
                throw new Error(message);
            }
            if (payload.errors?.length) {
                const message = payload.errors.map((e) => e.message).join("; ");
                if (
                    isShopifyRateLimit(res, message) &&
                    attempt < SHOPIFY_MAX_RETRIES
                ) {
                    await sleep(Math.min(1500 * 2 ** attempt, 12000));
                    continue;
                }
                throw new Error(message);
            }
            return payload.data;
        }
        throw new Error(
            "Shopify API rate limit: please retry in a few seconds."
        );
    });
}

async function resolveAccessToken() {
    if (STATIC_TOKEN) return STATIC_TOKEN;
    if (!SHOP) {
        throw new Error(
            "Missing SHOPIFY_SHOP in shopify-orders/.env (store subdomain only)"
        );
    }
    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error(
            "Missing SHOPIFY_ACCESS_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET in shopify-orders/.env"
        );
    }
    const now = Date.now();
    if (cachedOAuthToken && now < cachedOAuthExpiry - 60_000) {
        return cachedOAuthToken;
    }
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
    });
    const res = await fetch(
        `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        }
    );
    const text = await res.text();
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        payload = { error: text || res.statusText };
    }
    if (!res.ok) {
        const msg = payload?.error_description || payload?.error || text;
        throw new Error(
            typeof msg === "string" ? msg : JSON.stringify(msg)
        );
    }
    cachedOAuthToken = payload.access_token;
    const ttlSec = Number(payload.expires_in) || 86_400;
    cachedOAuthExpiry = now + ttlSec * 1000;
    return cachedOAuthToken;
}

function hasAuthConfig() {
    return Boolean(
        STATIC_TOKEN || (SHOP && CLIENT_ID && CLIENT_SECRET)
    );
}

function orderGid(orderId) {
    return `gid://shopify/Order/${orderId}`;
}

function fulfillmentOrderGid(id) {
    return `gid://shopify/FulfillmentOrder/${id}`;
}

function fulfillmentOrderLineItemGid(id) {
    return `gid://shopify/FulfillmentOrderLineItem/${id}`;
}

function fulfillmentOrderMethodType(fo) {
    return (fo.delivery_method?.method_type || "")
        .toLowerCase()
        .replace(/-/g, "_");
}

function isLocalPickupFulfillmentOrder(fo) {
    const mt = fulfillmentOrderMethodType(fo);
    return mt === "pick_up" || mt === "pickup" || mt === "retail";
}

function hasShipToAddress(fo, order) {
    const dest = fo?.destination || order?.shipping_address || {};
    return Boolean(String(dest.address1 || "").trim());
}

/** Shopify often uses method_type "none" + assigned_location for in-store / local pickup. */
function isMerchantPickupFulfillmentOrder(fo, order) {
    const mt = fulfillmentOrderMethodType(fo);
    if (mt === "pick_up" || mt === "pickup") return true;
    if (mt === "retail") return true;
    if (mt === "shipping" || mt === "local") return false;
    if (mt === "none") {
        const hasLocation =
            Boolean(fo.assigned_location?.location_id) ||
            Boolean(fo.assigned_location?.name);
        if (!hasLocation) return false;
        if (hasShipToAddress(fo, order)) return false;
        return true;
    }
    return false;
}

function isShippingFulfillmentOrder(fo, order) {
    const mt = fulfillmentOrderMethodType(fo);
    if (mt === "shipping" || mt === "local") return true;
    if (hasShipToAddress(fo, order)) return true;
    return false;
}

function pickupLabelFromFulfillmentOrder(fo) {
    const loc = fo.assigned_location?.name;
    const presented = fo.delivery_method?.presented_name;
    if (loc) return loc;
    if (presented && !/^shipping$/i.test(presented)) return presented;
    return "Store pickup";
}

function deliveryMethodDisplayText(deliveryMethod, deliveryLabel) {
    if (deliveryMethod === "pickup") {
        const loc = (deliveryLabel || "").trim();
        return loc ? `Pickup in store at ${loc}` : "Pickup in store";
    }
    if (deliveryMethod === "shipping") {
        return deliveryLabel || "Shipping";
    }
    if (deliveryMethod === "none") {
        return deliveryLabel || "Shipping not required";
    }
    return deliveryLabel || "—";
}

function inferDeliveryFromOrder(order) {
    const shippingLines = order.shipping_lines || [];
    const combined = shippingLines
        .map((sl) => (sl.title || sl.code || "").toLowerCase())
        .join(" ");
    const label =
        shippingLines[0]?.title || shippingLines[0]?.code || "";
    const lineItems = order.line_items || [];
    const allNoShipping =
        lineItems.length > 0 &&
        lineItems.every((li) => li.requires_shipping === false);
    const noShipAddr =
        !order.shipping_address ||
        !String(order.shipping_address.address1 || "").trim();

    if (
        combined.includes("pickup") ||
        combined.includes("pick up") ||
        combined.includes("pick-up") ||
        combined.includes("in store") ||
        combined.includes("in-store")
    ) {
        return { deliveryMethod: "pickup", deliveryLabel: label || "Pickup" };
    }
    if (
        combined.includes("delivery") ||
        combined.includes("nationwide") ||
        combined.includes("metro") ||
        combined.includes("courier") ||
        (combined.includes("ship") && !combined.includes("not required"))
    ) {
        return { deliveryMethod: "shipping", deliveryLabel: label || "Shipping" };
    }
    if (noShipAddr && shippingLines.length) {
        const sl = shippingLines[0];
        const price = Number(sl.discounted_price ?? sl.price);
        if (price === 0 && (sl.title || sl.code)) {
            return {
                deliveryMethod: "pickup",
                deliveryLabel: sl.title || sl.code || "Pickup",
            };
        }
    }
    if (
        combined.includes("shipping not required") ||
        (allNoShipping && noShipAddr)
    ) {
        return {
            deliveryMethod: "none",
            deliveryLabel: label || "Shipping not required",
        };
    }
    return { deliveryMethod: "unknown", deliveryLabel: label || "—" };
}

function pickupStageFromFulfillments(order) {
    const fulfillments = order.fulfillments || [];
    for (const f of fulfillments) {
        if (f.status === "cancelled") continue;
        const ss = (f.shipment_status || "").toLowerCase();
        if (ss === "ready_for_pickup") return "ready_for_pickup";
        if (ss === "picked_up") return "picked_up";
    }
    const fs = (order.fulfillment_status || "").toLowerCase();
    if (fs === "fulfilled") return "fulfilled";
    if (fs === "partial") return "partial";
    return "unfulfilled";
}

const WORKSHOP_PRODUCT_TYPE = "Matcha Workshop";

function orderIsWorkshop(order, products = []) {
    const map = Object.fromEntries(
        products.map((p) => [String(p.id), p.product_type || ""])
    );
    for (const li of order.line_items || []) {
        const pt =
            map[String(li.product_id)] ||
            li.product_type ||
            "";
        if (
            String(pt).trim().toLowerCase() ===
            WORKSHOP_PRODUCT_TYPE.toLowerCase()
        ) {
            return true;
        }
    }
    return false;
}

function buildFulfillmentContext(order, fulfillmentOrders, products = []) {
    if (orderIsWorkshop(order, products)) {
        return {
            deliveryMethod: "none",
            deliveryLabel: "Shipping not required",
            deliveryMethodDisplay: "Workshop · Shipping not required",
            displayFulfillment: null,
            pickupStage: null,
            pickupFulfillmentOrderIds: [],
            canMarkReadyForPickup: false,
            canMarkPickedUp: false,
        };
    }

    const fos = fulfillmentOrders || [];
    const pickUpFOs = fos.filter((fo) =>
        isMerchantPickupFulfillmentOrder(fo, order)
    );
    const shippingFOs = fos.filter(
        (fo) =>
            isShippingFulfillmentOrder(fo, order) &&
            !isMerchantPickupFulfillmentOrder(fo, order)
    );

    let deliveryMethod;
    let deliveryLabel;
    if (pickUpFOs.length) {
        deliveryMethod = "pickup";
        deliveryLabel = pickupLabelFromFulfillmentOrder(pickUpFOs[0]);
    } else if (shippingFOs.length) {
        deliveryMethod = "shipping";
        const dm = shippingFOs[0].delivery_method || {};
        deliveryLabel = dm.presented_name || dm.title || "Shipping";
    } else {
        const inferred = inferDeliveryFromOrder(order);
        deliveryMethod = inferred.deliveryMethod;
        deliveryLabel = inferred.deliveryLabel;
    }

    let pickupStage = null;
    let canMarkReadyForPickup = false;
    let canMarkPickedUp = false;
    const pickupFulfillmentOrderIds = [];

    let displayFulfillment = null;

    if (deliveryMethod === "pickup") {
        const localPickUpFOs = pickUpFOs.filter((fo) =>
            isLocalPickupFulfillmentOrder(fo)
        );
        const supportsLocalPickup = localPickUpFOs.length > 0;

        pickupStage = pickupStageFromFulfillments(order);
        for (const fo of pickUpFOs) {
            if (["open", "in_progress", "scheduled"].includes(fo.status)) {
                pickupFulfillmentOrderIds.push(fo.id);
            }
        }

        const hasOpenPickup = pickUpFOs.some(
            (fo) =>
                ["open", "scheduled"].includes(fo.status) &&
                (fo.line_items || []).some((li) => li.fulfillable_quantity > 0)
        );
        const hasInProgressPickup = localPickUpFOs.some(
            (fo) => fo.status === "in_progress"
        );

        if (hasInProgressPickup) {
            pickupStage = "ready_for_pickup";
            displayFulfillment = "Ready for pickup";
        }

        if (pickupStage === "picked_up" || pickupStage === "fulfilled") {
            canMarkReadyForPickup = false;
            canMarkPickedUp = false;
            if (pickupStage === "fulfilled") displayFulfillment = "Fulfilled";
        } else if (supportsLocalPickup) {
            if (
                pickupStage === "ready_for_pickup" ||
                hasInProgressPickup
            ) {
                canMarkReadyForPickup = false;
                canMarkPickedUp = true;
                displayFulfillment = "Ready for pickup";
            } else if (pickupStage === "unfulfilled" || pickupStage === "partial") {
                canMarkReadyForPickup = hasOpenPickup;
                canMarkPickedUp = false;
                displayFulfillment = "Unfulfilled";
            }
        } else if (pickupStage === "unfulfilled" || pickupStage === "partial") {
            canMarkReadyForPickup = false;
            canMarkPickedUp = false;
            displayFulfillment = "Unfulfilled";
        }
    }

    return {
        deliveryMethod,
        deliveryLabel,
        deliveryMethodDisplay: deliveryMethodDisplayText(
            deliveryMethod,
            deliveryLabel
        ),
        displayFulfillment,
        pickupStage,
        pickupFulfillmentOrderIds,
        canMarkReadyForPickup,
        canMarkPickedUp,
        supportsLocalPickup:
            deliveryMethod === "pickup"
                ? pickUpFOs.some((fo) => isLocalPickupFulfillmentOrder(fo))
                : false,
    };
}

async function fetchFulfillmentOrders(orderId) {
    const { body } = await shopifyRest(
        `/orders/${orderId}/fulfillment_orders.json`
    );
    return body.fulfillment_orders || [];
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
};

const API_PATH_PREFIX = "/api/";

function isApiPath(pathname) {
    return pathname.startsWith(API_PATH_PREFIX);
}

function send(res, status, body, headers = {}) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        ...headers,
    });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function corsHeaders(req) {
    const origin = req.headers.origin || "";
    if (/^https?:\/\/localhost(?::\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)) {
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };
    }
    return {};
}

function parseLinkPageInfo(linkHeader, rel) {
    if (!linkHeader) return null;
    const parts = linkHeader.split(",");
    for (const part of parts) {
        const m = part.match(new RegExp(`<([^>]+)>;\\s*rel="${rel}"`));
        if (!m) continue;
        try {
            const u = new URL(m[1]);
            const pi = u.searchParams.get("page_info");
            if (pi) return pi;
        } catch {
            const q = m[1].split("?")[1];
            if (q) return new URLSearchParams(q).get("page_info");
        }
    }
    return null;
}

function readJsonBody(req) {
    if (
        req.body != null &&
        typeof req.body === "object" &&
        !Buffer.isBuffer(req.body)
    ) {
        return Promise.resolve(req.body);
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            if (!raw.trim()) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error("Invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}

function graphqlUserErrors(result, key) {
    const block = result?.[key];
    const errs = block?.userErrors;
    if (errs?.length) {
        throw new Error(errs.map((e) => e.message).join("; "));
    }
    return block;
}

const ROSTER_DAY_RADIUS = 60;
const UPCOMING_ORDER_LOOKBACK_DAYS = 30;
const PAST_ORDER_LOOKBACK_DAYS = 180;

function displayFinancialStatus(raw) {
    const s = (raw || "").toLowerCase();
    const map = {
        pending: "Unpaid",
        paid: "Paid",
        refunded: "Refunded",
        partially_refunded: "Partially refunded",
        authorized: "Authorized",
        partially_paid: "Partially paid",
        voided: "Voided",
    };
    return map[s] || (raw ? String(raw).replace(/_/g, " ") : "Unpaid");
}

function displayFulfillmentFromOrder(o) {
    for (const f of o.fulfillments || []) {
        const ss = (f.shipment_status || "").toLowerCase();
        if (ss === "ready_for_pickup") return "Ready for pickup";
        if (ss === "in_transit" || ss === "out_for_delivery") return "Shipped";
        if (ss === "picked_up") return "Picked up";
        if (ss === "delivered") return "Fulfilled";
    }
    const fs = (o.fulfillment_status || "").toLowerCase();
    if (!fs || fs === "null") return "Unfulfilled";
    if (fs === "fulfilled") return "Fulfilled";
    if (fs === "partial") return "Partially fulfilled";
    if (fs === "restocked") return "Restocked";
    return fs.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseSessionDateIso(sessionDate) {
    const raw = (sessionDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const d = new Date(`${raw}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return raw;
}

async function fetchAllOrdersInWindow(sessionDateIso, dayRadius = ROSTER_DAY_RADIUS) {
    const center = new Date(`${sessionDateIso}T12:00:00Z`);
    const min = new Date(center);
    min.setUTCDate(min.getUTCDate() - dayRadius);
    const max = new Date(center);
    max.setUTCDate(max.getUTCDate() + dayRadius);

    const baseQs = new URLSearchParams({
        status: "any",
        limit: "250",
        created_at_min: min.toISOString(),
        created_at_max: max.toISOString(),
    });

    const all = [];
    let pageInfo = null;
    do {
        const qs = pageInfo
            ? new URLSearchParams({
                  page_info: pageInfo,
                  limit: "250",
              })
            : baseQs;
        const { orders, nextPageInfo } = await proxyShopifyOrders(qs, {
            includeProducts: false,
        });
        all.push(...(orders || []));
        pageInfo = nextPageInfo;
    } while (pageInfo);

    return all;
}

async function fetchOrdersBetween(createdAtIso, daysBefore = 7, daysAfter = 180) {
    const center = new Date(createdAtIso || Date.now());
    if (Number.isNaN(center.getTime())) {
        center.setTime(Date.now());
    }
    const min = new Date(center);
    min.setUTCDate(min.getUTCDate() - daysBefore);
    const max = new Date(center);
    max.setUTCDate(max.getUTCDate() + daysAfter);

    const baseQs = new URLSearchParams({
        status: "any",
        limit: "250",
        created_at_min: min.toISOString(),
        created_at_max: max.toISOString(),
    });

    const all = [];
    let pageInfo = null;
    do {
        const qs = pageInfo
            ? new URLSearchParams({
                  page_info: pageInfo,
                  limit: "250",
              })
            : baseQs;
        const { orders, nextPageInfo } = await proxyShopifyOrders(qs, {
            includeProducts: false,
        });
        all.push(...(orders || []));
        pageInfo = nextPageInfo;
    } while (pageInfo);

    return all;
}

async function inferWorkshopRegistrationsForOrder(order, products) {
    if (!orderIsWorkshop(order, products)) return [];

    const needsInfer = [];
    for (const li of order.line_items || []) {
        if (parseRegistrationFromLineItem(li)) continue;
        const pt =
            products.find((p) => String(p.id) === String(li.product_id))
                ?.product_type ||
            li.product_type ||
            "";
        if (
            String(pt).trim().toLowerCase() !==
            WORKSHOP_PRODUCT_TYPE.toLowerCase()
        ) {
            continue;
        }
        needsInfer.push(li);
    }
    if (!needsInfer.length) return [];

    const orderDateIso = orderCreatedDateIso(order);
    const orders = await fetchOrdersBetween(order.created_at, 14, 180);
    const catalog = buildSessionCatalogFromOrders(orders);
    const fallback = orderContactFallback(order);
    const results = [];

    for (const li of needsInfer) {
        const next = findNextSessionAfter(
            sessionsForLineItem(li, catalog),
            orderDateIso
        );
        const reg = inferRegistrationStub(li, fallback, next);
        results.push({ lineItemId: li.id, ...reg });
    }

    return results;
}

function todayDateIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

async function proxyWorkshopSessions(searchParams) {
    const range = (searchParams.get("range") || "upcoming").trim().toLowerCase();
    const limit = Math.min(
        50,
        Math.max(1, Number(searchParams.get("limit")) || 10)
    );
    const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
    const today = todayDateIso();

    let orders;
    if (range === "past") {
        orders = await fetchOrdersBetween(
            `${today}T12:00:00.000Z`,
            PAST_ORDER_LOOKBACK_DAYS,
            0
        );
    } else {
        orders = await fetchOrdersBetween(
            `${today}T12:00:00.000Z`,
            UPCOMING_ORDER_LOOKBACK_DAYS,
            0
        );
    }

    let sessions = buildWorkshopDayIndex(orders);

    if (range === "past") {
        sessions = sessions
            .filter((s) => s.sessionDateIso < today)
            .sort((a, b) => b.sessionDateIso.localeCompare(a.sessionDateIso));
    } else {
        sessions = sessions
            .filter((s) => s.sessionDateIso >= today)
            .sort((a, b) => a.sessionDateIso.localeCompare(b.sessionDateIso));
    }

    const total = sessions.length;

    return {
        range: range === "past" ? "past" : "upcoming",
        today,
        total,
        limit,
        offset,
        scan: {
            orderLookbackDays:
                range === "past"
                    ? PAST_ORDER_LOOKBACK_DAYS
                    : UPCOMING_ORDER_LOOKBACK_DAYS,
        },
        sessions: sessions.slice(offset, offset + limit),
    };
}

async function proxyWorkshopRoster(searchParams) {
    const eventId = (searchParams.get("event_id") || "").trim();
    const sessionDateIso = parseSessionDateIso(
        searchParams.get("session_date")
    );
    if (!eventId) throw new Error("event_id is required");
    if (!sessionDateIso) throw new Error("session_date must be YYYY-MM-DD");

    const orders = await fetchAllOrdersInWindow(sessionDateIso);
    const paymentMethodByOrderId = new Map(
        orders.map((o) => [o.id, paymentMethodDisplay(o)])
    );
    const catalog = buildSessionCatalogFromOrders(orders);
    const sessionMap = new Map();
    const processedLineKeys = new Set();
    let dayWorkshop = "";
    let dayDateLabel = "";

    function ensureSessionSlot(reg) {
        const slotKey = sessionSlotKey(reg.startTime, reg.endTime);
        if (!sessionMap.has(slotKey)) {
            sessionMap.set(slotKey, {
                sessionKey: slotKey,
                startTime: reg.startTime,
                endTime: reg.endTime,
                timeLabel: reg.time,
                sortKey: parseTimeSortKey(reg.startTime),
                participants: [],
            });
        }
        return slotKey;
    }

    function addParticipants(order, li, reg, { noBooking = false } = {}) {
        const lineKey = `${order.id}|${li.id}`;
        if (processedLineKeys.has(lineKey)) return;
        processedLineKeys.add(lineKey);

        if (!dayWorkshop) {
            dayWorkshop = reg.workshopDisplay || reg.workshop;
            dayDateLabel = reg.date;
        }

        const slotKey = ensureSessionSlot(reg);
        const orderMeta = {
            orderId: order.id,
            orderName: order.name || "",
            createdAt: order.created_at || "",
            financialStatus: order.financial_status || "pending",
            financialLabel: displayFinancialStatus(order.financial_status),
            paymentMethod:
                paymentMethodByOrderId.get(order.id) ||
                paymentMethodDisplay(order) ||
                "—",
            displayFulfillment: displayFulfillmentFromOrder(order),
            workshop: reg.workshopDisplay || reg.workshop,
            noBooking,
            inferred: noBooking,
        };

        const orderFallback = orderContactFallback(order);
        const seatRows = expandRegistrationToSeatRowsWithFallback(
            reg,
            orderMeta,
            orderFallback
        );
        sessionMap.get(slotKey).participants.push(...seatRows);
    }

    for (const order of orders) {
        if (order.cancelled_at) continue;
        for (const li of order.line_items || []) {
            const reg = parseRegistrationFromLineItem(li);
            if (
                reg &&
                String(reg.eventId) === String(eventId) &&
                reg.sessionDateIso === sessionDateIso
            ) {
                addParticipants(order, li, reg);
                continue;
            }
            if (reg) continue;

            const next = findInferredSessionForTarget(
                li,
                orderCreatedDateIso(order),
                catalog,
                eventId,
                sessionDateIso
            );
            if (!next) continue;

            const stub = inferRegistrationStub(
                li,
                orderContactFallback(order),
                next
            );
            addParticipants(order, li, stub, { noBooking: true });
        }
    }

    const sessions = [...sessionMap.values()]
        .sort((a, b) => a.sortKey - b.sortKey)
        .map((s) => {
            normalizeOrderSeatLabels(s.participants);
            const seatCount = s.participants.length;
            const orderIds = new Set(
                s.participants.map((p) => String(p.orderId))
            );
            return {
                sessionKey: s.sessionKey,
                startTime: s.startTime,
                endTime: s.endTime,
                timeLabel: s.timeLabel,
                seatCount,
                registrationCount: orderIds.size,
                participants: s.participants,
            };
        });

    const totalSeats = sessions.reduce((n, s) => n + s.seatCount, 0);
    const totalRegs = sessions.reduce(
        (n, s) => n + s.registrationCount,
        0
    );

    return {
        day: {
            eventId,
            sessionDate: sessionDateIso,
            workshop: dayWorkshop,
            dateLabel: dayDateLabel,
            registrationCount: totalRegs,
            seatCount: totalSeats,
        },
        sessions,
        /** @deprecated flat list for older clients */
        participants: sessions.flatMap((s) => s.participants),
        session: sessions[0]
            ? {
                  eventId,
                  workshop: dayWorkshop,
                  date: dayDateLabel,
                  time: sessions[0].timeLabel,
                  sessionDate: sessionDateIso,
                  participantCount: totalRegs,
                  seatCount: totalSeats,
              }
            : {
                  eventId,
                  workshop: dayWorkshop,
                  date: dayDateLabel,
                  time: "",
                  sessionDate: sessionDateIso,
                  participantCount: 0,
                  seatCount: 0,
              },
    };
}

/** Workshop day(s) (event + date) a given order touches, from booked line items. */
export function workshopDaysForOrder(order) {
    const days = [];
    const seen = new Set();
    for (const li of order?.line_items || []) {
        const reg = parseRegistrationFromLineItem(li);
        if (!reg?.eventId || !reg?.sessionDateIso) continue;
        const key = `${reg.eventId}|${reg.sessionDateIso}`;
        if (seen.has(key)) continue;
        seen.add(key);
        days.push({ eventId: reg.eventId, sessionDate: reg.sessionDateIso });
    }
    return days;
}

/** Reusable roster fetch for server-side consumers (e.g. Google Sheets sync). */
export async function getWorkshopRosterData(eventId, sessionDate) {
    const searchParams = new URLSearchParams({
        event_id: String(eventId || ""),
        session_date: String(sessionDate || ""),
    });
    return proxyWorkshopRoster(searchParams);
}

function needsListFulfillmentEnrichment(order, products = []) {
    if (order.cancelled_at) return false;
    const fin = (order.financial_status || "").toLowerCase();
    if (fin !== "paid" && fin !== "partially_paid") return false;
    if (orderIsWorkshop(order, products)) return false;

    const fromRest = displayFulfillmentFromOrder(order);
    const restLower = fromRest.toLowerCase();
    if (
        restLower.includes("ready for pickup") ||
        restLower.includes("picked up")
    ) {
        return false;
    }

    const fs = (order.fulfillment_status || "").toLowerCase();
    const inf = inferDeliveryFromOrder(order);
    if (inf.deliveryMethod === "pickup") return true;

    if (fs === "partial" || fs === "fulfilled") {
        const noAddr = !String(order.shipping_address?.address1 || "").trim();
        const sl = (order.shipping_lines || [])
            .map((s) => (s.title || "").toLowerCase())
            .join(" ");
        const looksPickup =
            sl.includes("pickup") ||
            sl.includes("pick up") ||
            sl.includes("podium");
        if (looksPickup || (noAddr && !(order.shipping_lines || []).length)) {
            return true;
        }
        return false;
    }

    const noAddr = !String(order.shipping_address?.address1 || "").trim();
    const noLines = !(order.shipping_lines || []).length;
    if (
        noAddr &&
        noLines &&
        (order.line_items || []).some((li) => li.requires_shipping !== false)
    ) {
        return true;
    }

    return false;
}

function graphqlFulfillmentOrderToRest(gfo) {
    const id = String(gfo.id || "").replace(
        /^gid:\/\/shopify\/FulfillmentOrder\//,
        ""
    );
    const loc = gfo.assignedLocation?.location;
    return {
        id,
        status: String(gfo.status || "")
            .toLowerCase()
            .replace(/-/g, "_"),
        delivery_method: {
            method_type: String(gfo.deliveryMethod?.methodType || "")
                .toLowerCase()
                .replace(/-/g, "_"),
            presented_name: gfo.deliveryMethod?.presentedName || "",
        },
        assigned_location: loc
            ? {
                  location_id: String(loc.id || "").replace(
                      /^gid:\/\/shopify\/Location\//,
                      ""
                  ),
                  name: loc.name || "",
              }
            : {},
        destination: gfo.destination || {},
        line_items: (gfo.lineItems?.nodes || []).map((li) => ({
            id: String(li.id || "").replace(
                /^gid:\/\/shopify\/FulfillmentOrderLineItem\//,
                ""
            ),
            fulfillable_quantity: Number(li.remainingQuantity) || 0,
        })),
    };
}

async function enrichOrdersWithListFulfillment(orders, products = []) {
    const targets = orders.filter((order) =>
        needsListFulfillmentEnrichment(order, products)
    );
    if (!targets.length) return;

    const ids = targets.map((order) => orderGid(order.id));
    let nodes = [];
    try {
        const data = await shopifyGraphql(
            `query OrderListFulfillment($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Order {
                  legacyResourceId
                  fulfillmentOrders(first: 10) {
                    nodes {
                      id
                      status
                      deliveryMethod {
                        methodType
                        presentedName
                      }
                      assignedLocation {
                        location {
                          id
                          name
                        }
                      }
                      destination {
                        address1
                      }
                      lineItems(first: 50) {
                        nodes {
                          id
                          remainingQuantity
                        }
                      }
                    }
                  }
                }
              }
            }`,
            { ids }
        );
        nodes = data?.nodes || [];
    } catch (e) {
        console.warn(
            "List fulfillment GraphQL enrich failed:",
            e.message || e
        );
        return;
    }

    const byId = new Map();
    for (const node of nodes) {
        if (!node?.legacyResourceId) continue;
        byId.set(String(node.legacyResourceId), node);
    }

    for (const order of targets) {
        const node = byId.get(String(order.id));
        if (!node) continue;
        try {
            const fulfillmentOrders = (node.fulfillmentOrders?.nodes || []).map(
                (gfo) => graphqlFulfillmentOrderToRest(gfo)
            );
            const ctx = buildFulfillmentContext(
                order,
                fulfillmentOrders,
                products
            );
            order.list_fulfillment = {
                displayFulfillment: ctx.displayFulfillment,
                pickupStage: ctx.pickupStage,
                deliveryMethod: ctx.deliveryMethod,
                deliveryLabel: ctx.deliveryLabel,
                supportsLocalPickup: ctx.supportsLocalPickup,
                canMarkReadyForPickup: ctx.canMarkReadyForPickup,
                canMarkPickedUp: ctx.canMarkPickedUp,
            };
        } catch (e) {
            console.warn(
                `List fulfillment enrich failed for order ${order.id}:`,
                e.message || e
            );
        }
    }
}

async function proxyShopifyOrders(searchParams, { includeProducts = true } = {}) {
    const base = `/orders.json`;
    const qs = new URLSearchParams();
    if (searchParams.has("page_info")) {
        qs.set("page_info", searchParams.get("page_info"));
        qs.set("limit", searchParams.get("limit") || "50");
    } else {
        const incoming = new URLSearchParams(searchParams);
        if (!incoming.has("status")) incoming.set("status", "any");
        if (!incoming.has("limit")) incoming.set("limit", "50");
        incoming.forEach((v, k) => qs.set(k, v));
    }
    const { body, headers } = await shopifyRest(`${base}?${qs.toString()}`);
    const link = headers.get("link") || "";
    const orders = body.orders || [];
    const productIds = [
        ...new Set(
            orders
                .flatMap((o) => (o.line_items || []).map((li) => li.product_id))
                .filter(Boolean)
        ),
    ];
    let products = [];
    if (includeProducts && productIds.length) {
        const batch = await proxyProducts(productIds.join(","));
        products = batch.products;
    }
    await enrichOrdersWithListFulfillment(orders, products);
    const payload = {
        orders,
        nextPageInfo: parseLinkPageInfo(link, "next"),
        previousPageInfo: parseLinkPageInfo(link, "previous"),
    };
    if (includeProducts) payload.products = products;
    return payload;
}

async function proxyProducts(idsParam) {
    const ids = (idsParam || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (!ids.length) return { products: [] };
    const unique = [...new Set(ids)].slice(0, 100);
    const qs = new URLSearchParams({
        ids: unique.join(","),
        fields: "id,product_type,tags,title,image",
        limit: "250",
    });
    const { body } = await shopifyRest(`/products.json?${qs.toString()}`);
    return {
        products: (body.products || []).map((p) => ({
            id: p.id,
            product_type: p.product_type || "",
            tags: p.tags || "",
            title: p.title || "",
            image_url: p.image?.src || p.images?.[0]?.src || null,
        })),
    };
}

async function fetchOrderLineItemBundleMeta(orderId) {
    try {
        const data = await shopifyGraphql(
            `query orderBundleLineItems($id: ID!) {
              order(id: $id) {
                lineItems(first: 250) {
                  nodes {
                    id
                    lineItemGroup {
                      id
                      title
                      quantity
                    }
                  }
                }
              }
            }`,
            { id: orderGid(orderId) }
        );
        const byLineItemId = {};
        for (const node of data?.order?.lineItems?.nodes || []) {
            const group = node.lineItemGroup;
            if (!group?.id) continue;
            const lineItemId = String(node.id || "").replace(
                /^gid:\/\/shopify\/LineItem\//,
                ""
            );
            if (!lineItemId) continue;
            byLineItemId[lineItemId] = {
                groupId: group.id,
                bundleTitle: group.title || "Bundle",
                bundleQuantity: group.quantity || 1,
            };
        }
        return byLineItemId;
    } catch (e) {
        console.warn("Bundle line item lookup failed:", e.message || e);
        return {};
    }
}

function mergeLineItemBundleMetaFromGraphql(restLineItems, graphqlMeta) {
    return mergeLineItemBundleMeta(restLineItems, graphqlMeta);
}

async function proxyOrderDetail(orderId) {
    const order = await fetchOrder(orderId);
    try {
        order.transactions = await fetchOrderTransactions(orderId);
    } catch (_) {
        order.transactions = order.transactions || [];
    }
    const fulfillmentOrders = await fetchFulfillmentOrders(orderId);
    const productIds = [
        ...new Set(
            (order.line_items || []).map((li) => li.product_id).filter(Boolean)
        ),
    ];
    let products = [];
    if (productIds.length) {
        const batch = await proxyProducts(productIds.join(","));
        products = batch.products;
    }
    const fulfillment_context = buildFulfillmentContext(
        order,
        fulfillmentOrders,
        products
    );
    let inferred_registrations = [];
    try {
        inferred_registrations = await inferWorkshopRegistrationsForOrder(
            order,
            products
        );
    } catch (_) {
        inferred_registrations = [];
    }
    const line_item_bundles = mergeLineItemBundleMetaFromGraphql(
        order.line_items,
        await fetchOrderLineItemBundleMeta(orderId)
    );
    return {
        order,
        products,
        fulfillment_context,
        inferred_registrations,
        line_item_bundles,
    };
}

async function getPrimaryLocationId() {
    if (cachedLocationId) return cachedLocationId;
    const { body } = await shopifyRest("/locations.json?limit=1");
    const id = body.locations?.[0]?.id;
    if (!id) throw new Error("No fulfillment location found on store");
    cachedLocationId = id;
    return id;
}

async function fetchOrder(orderId) {
    const { body } = await shopifyRest(`/orders/${orderId}.json`);
    return body.order;
}

async function fetchOrderTransactions(orderId) {
    const { body } = await shopifyRest(
        `/orders/${orderId}/transactions.json`
    );
    return body.transactions || [];
}

async function handleMarkPaid(orderId) {
    const data = await shopifyGraphql(
        `mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) {
          orderMarkAsPaid(input: $input) {
            order { id displayFinancialStatus }
            userErrors { field message }
          }
        }`,
        { input: { id: orderGid(orderId) } }
    );
    graphqlUserErrors(data, "orderMarkAsPaid");
    return { ok: true };
}

async function handleMarkPending(orderId) {
    const order = await fetchOrder(orderId);
    const fin = order.financial_status;
    if (fin === "paid" || fin === "refunded" || fin === "partially_refunded") {
        throw new Error(
            "Shopify Admin does not allow marking paid or refunded orders as unpaid. Use refund in Admin instead."
        );
    }
    if (fin === "authorized") {
        throw new Error(
            'Use "Void authorization" for authorized payments (same as Shopify Admin).'
        );
    }
    return {
        ok: true,
        message: "Order is already unpaid / pending.",
    };
}

function assertOrderCancellable(order) {
    if (order.cancelled_at) {
        throw new Error("This order is already cancelled.");
    }
    const fin = (order.financial_status || "").toLowerCase();
    if (fin === "refunded" || fin === "partially_refunded") {
        throw new Error("This order has already been refunded.");
    }
}

async function handleCancelOrder(orderId, body = {}) {
    const order = await fetchOrder(orderId);
    assertOrderCancellable(order);

    const fin = (order.financial_status || "").toLowerCase();
    const shouldRefund =
        typeof body.refund === "boolean"
            ? body.refund
            : fin === "paid" || fin === "partially_paid";

    if (fin === "authorized") {
        await handleVoid(orderId);
    }

    await shopifyRest(`/orders/${orderId}/cancel.json`, {
        method: "POST",
        body: JSON.stringify({
            reason: body.reason || "customer",
            email: body.notifyCustomer !== false,
            refund: Boolean(shouldRefund),
        }),
    });

    return { ok: true, refunded: shouldRefund };
}

function refundLineItemsFromOrder(order) {
    return (order.line_items || []).map((li) => ({
        line_item_id: li.id,
        quantity: li.quantity,
        restock_type: "no_restock",
    }));
}

function refundAmountForOrder(order) {
    const raw = order.current_total_price ?? order.total_price ?? "0";
    const n = Number(raw);
    return Number.isFinite(n) ? n.toFixed(2) : String(raw);
}

function refundTransactionsForOrder(order, transactions, calculated = {}) {
    if (calculated.transactions?.length) return calculated.transactions;

    const saleTx = (transactions || []).find(
        (t) =>
            String(t.kind || "").toLowerCase() === "sale" &&
            String(t.status || "").toLowerCase() === "success"
    );
    if (!saleTx?.id) return [];

    return [
        {
            parent_id: saleTx.id,
            amount: refundAmountForOrder(order),
            kind: "refund",
            gateway: saleTx.gateway,
        },
    ];
}

async function handleRefundOrder(orderId, body = {}) {
    const order = await fetchOrder(orderId);
    const fin = (order.financial_status || "").toLowerCase();
    if (fin === "refunded" || fin === "partially_refunded") {
        throw new Error("This order has already been refunded.");
    }
    if (!["paid", "partially_paid"].includes(fin)) {
        throw new Error("Only paid orders can be refunded.");
    }

    const refundLineItems = refundLineItemsFromOrder(order);
    const transactions = await fetchOrderTransactions(orderId);
    const { body: calcBody } = await shopifyRest(
        `/orders/${orderId}/refunds/calculate.json`,
        {
            method: "POST",
            body: JSON.stringify({
                refund: {
                    shipping: { full_refund: true },
                    refund_line_items: refundLineItems,
                },
            }),
        }
    );

    const calculated = calcBody.refund || {};
    const refundTransactions = refundTransactionsForOrder(
        order,
        transactions,
        calculated
    );
    if (!refundTransactions.length) {
        throw new Error(
            "No refundable payment transaction found on this order."
        );
    }

    const refundPayload = {
        notify: body.notifyCustomer !== false,
        note: body.note || "Refund from Matchanese dashboard",
        shipping: { full_refund: true },
        refund_line_items: calculated.refund_line_items || refundLineItems,
        transactions: refundTransactions,
    };

    await shopifyRest(`/orders/${orderId}/refunds.json`, {
        method: "POST",
        body: JSON.stringify({ refund: refundPayload }),
    });

    return { ok: true };
}

async function handleVoid(orderId) {
    const order = await fetchOrder(orderId);
    if (order.financial_status !== "authorized") {
        throw new Error(
            'Void is only available when payment status is "authorized" (same as Shopify Admin).'
        );
    }
    const tx = (order.transactions || []).find(
        (t) => t.status === "success" || t.status === "pending"
    );
    if (!tx?.id) {
        throw new Error("No voidable transaction found on this order.");
    }
    await shopifyRest(`/orders/${orderId}/transactions/${tx.id}/void.json`, {
        method: "POST",
        body: JSON.stringify({ transaction: {} }),
    });
    return { ok: true };
}

async function handleReadyForPickup(orderId) {
    const order = await fetchOrder(orderId);
    const fulfillmentOrders = await fetchFulfillmentOrders(orderId);
    const pickUpFOs = fulfillmentOrders.filter(
        (fo) =>
            isLocalPickupFulfillmentOrder(fo) &&
            isMerchantPickupFulfillmentOrder(fo, order) &&
            ["open", "scheduled"].includes(fo.status)
    );
    if (!pickUpFOs.length) {
        throw new Error("No open store-pickup fulfillment on this order.");
    }
    const data = await shopifyGraphql(
        `mutation preparedForPickup($input: FulfillmentOrderLineItemsPreparedForPickupInput!) {
          fulfillmentOrderLineItemsPreparedForPickup(input: $input) {
            userErrors { field message }
          }
        }`,
        {
            input: {
                lineItemsByFulfillmentOrder: pickUpFOs.map((fo) => ({
                    fulfillmentOrderId: fulfillmentOrderGid(fo.id),
                })),
            },
        }
    );
    graphqlUserErrors(data, "fulfillmentOrderLineItemsPreparedForPickup");
    return { ok: true };
}

async function handlePickedUp(orderId) {
    const order = await fetchOrder(orderId);
    const readyFulfillment = (order.fulfillments || []).find((f) => {
        if (f.status === "cancelled") return false;
        return (f.shipment_status || "").toLowerCase() === "ready_for_pickup";
    });
    if (readyFulfillment?.id) {
        await shopifyRest(
            `/orders/${orderId}/fulfillments/${readyFulfillment.id}.json`,
            {
                method: "PUT",
                body: JSON.stringify({
                    fulfillment: { shipment_status: "picked_up" },
                }),
            }
        );
        return { ok: true };
    }

    const fulfillmentOrders = await fetchFulfillmentOrders(orderId);
    const pickUpFOs = fulfillmentOrders.filter(
        (fo) =>
            isMerchantPickupFulfillmentOrder(fo, order) &&
            ["open", "in_progress"].includes(fo.status) &&
            (fo.line_items || []).some((li) => li.fulfillable_quantity > 0)
    );
    if (!pickUpFOs.length) {
        throw new Error(
            "Nothing to mark as picked up. Mark the order ready for pickup first."
        );
    }

    const lineItemsByFulfillmentOrder = pickUpFOs.map((fo) => {
        const lineItems = (fo.line_items || [])
            .filter((li) => li.fulfillable_quantity > 0)
            .map((li) => ({
                id: fulfillmentOrderLineItemGid(li.id),
                quantity: li.fulfillable_quantity,
            }));
        const entry = {
            fulfillmentOrderId: fulfillmentOrderGid(fo.id),
        };
        if (lineItems.length) entry.fulfillmentOrderLineItems = lineItems;
        return entry;
    });

    const data = await shopifyGraphql(
        `mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id status }
            userErrors { field message }
          }
        }`,
        {
            fulfillment: {
                notifyCustomer: true,
                lineItemsByFulfillmentOrder,
            },
        }
    );
    graphqlUserErrors(data, "fulfillmentCreate");
    return { ok: true };
}

async function handleShipped(orderId) {
    const order = await fetchOrder(orderId);
    const fulfillmentOrders = await fetchFulfillmentOrders(orderId);
    const shippingFOs = fulfillmentOrders.filter(
        (fo) =>
            isShippingFulfillmentOrder(fo, order) &&
            !isMerchantPickupFulfillmentOrder(fo, order) &&
            ["open", "in_progress", "scheduled"].includes(fo.status) &&
            (fo.line_items || []).some((li) => li.fulfillable_quantity > 0)
    );
    if (!shippingFOs.length) {
        throw new Error("No open shipping fulfillment on this order.");
    }

    const lineItemsByFulfillmentOrder = shippingFOs.map((fo) => ({
        fulfillmentOrderId: fulfillmentOrderGid(fo.id),
        fulfillmentOrderLineItems: (fo.line_items || [])
            .filter((li) => li.fulfillable_quantity > 0)
            .map((li) => ({
                id: fulfillmentOrderLineItemGid(li.id),
                quantity: li.fulfillable_quantity,
            })),
    }));

    const data = await shopifyGraphql(
        `mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id status }
            userErrors { field message }
          }
        }`,
        {
            fulfillment: {
                notifyCustomer: true,
                trackingInfo: {
                    number: "Shipped",
                    company: "Other",
                },
                lineItemsByFulfillmentOrder,
            },
        }
    );
    graphqlUserErrors(data, "fulfillmentCreate");
    return { ok: true };
}

async function handleFulfilled(orderId) {
    const order = await fetchOrder(orderId);
    const fulfillmentOrders = await fetchFulfillmentOrders(orderId);
    const openFOs = fulfillmentOrders.filter(
        (fo) =>
            !isMerchantPickupFulfillmentOrder(fo, order) &&
            ["open", "in_progress", "scheduled"].includes(fo.status) &&
            (fo.line_items || []).some((li) => li.fulfillable_quantity > 0)
    );
    if (!openFOs.length) {
        throw new Error("No fulfillable line items on this order.");
    }

    const lineItemsByFulfillmentOrder = openFOs.map((fo) => ({
        fulfillmentOrderId: fulfillmentOrderGid(fo.id),
        fulfillmentOrderLineItems: (fo.line_items || [])
            .filter((li) => li.fulfillable_quantity > 0)
            .map((li) => ({
                id: fulfillmentOrderLineItemGid(li.id),
                quantity: li.fulfillable_quantity,
            })),
    }));

    const data = await shopifyGraphql(
        `mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id status }
            userErrors { field message }
          }
        }`,
        {
            fulfillment: {
                notifyCustomer: false,
                lineItemsByFulfillmentOrder,
            },
        }
    );
    graphqlUserErrors(data, "fulfillmentCreate");
    return { ok: true };
}

async function createFulfillment(orderId, intent) {
    if (intent === "ready_for_pickup") {
        return handleReadyForPickup(orderId);
    }
    if (intent === "picked_up") {
        return handlePickedUp(orderId);
    }
    if (intent === "shipped") {
        return handleShipped(orderId);
    }

    return handleFulfilled(orderId);
}

function safePath(urlPath) {
    const decoded = decodeURIComponent(urlPath.split("?")[0]);
    let rel = decoded.replace(/^\/+/, "") || "index.html";
    if (rel.includes("..")) return null;
    return path.join(__dirname, rel);
}

function isInsideRoot(filePath) {
    const root = path.resolve(__dirname);
    const resolved = path.resolve(filePath);
    return resolved === root || resolved.startsWith(root + path.sep);
}

function matchOrderId(pathname) {
    const m = pathname.match(/^\/api\/orders\/(\d+)$/);
    return m ? m[1] : null;
}

function matchOrderFulfillmentOrders(pathname) {
    const m = pathname.match(/^\/api\/orders\/(\d+)\/fulfillment_orders$/);
    return m ? m[1] : null;
}

function matchOrderAction(pathname) {
    const m = pathname.match(
        /^\/api\/orders\/(\d+)\/(mark-paid|mark-pending|void|fulfill|cancel|refund)$/
    );
    if (!m) return null;
    return { orderId: m[1], action: m[2] };
}

export async function handleShopifyHttp(req, res) {
    const u = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS" && isApiPath(u.pathname)) {
        res.writeHead(204, corsHeaders(req));
        return res.end();
    }

    if (req.method === "GET" && u.pathname === "/api/config") {
        return send(
            res,
            200,
            { shop: SHOP || null, hasToken: hasAuthConfig() },
            corsHeaders(req)
        );
    }

    if (req.method === "GET" && u.pathname === "/api/orders") {
        try {
            const data = await proxyShopifyOrders(u.searchParams);
            return send(res, 200, data, corsHeaders(req));
        } catch (e) {
            return send(
                res,
                502,
                { error: e.message || String(e) },
                corsHeaders(req)
            );
        }
    }

    if (req.method === "GET" && u.pathname === "/api/workshop-sessions") {
        try {
            const data = await proxyWorkshopSessions(u.searchParams);
            return send(res, 200, data, corsHeaders(req));
        } catch (e) {
            return send(
                res,
                502,
                { error: e.message || String(e) },
                corsHeaders(req)
            );
        }
    }

    if (req.method === "GET" && u.pathname === "/api/workshop-roster") {
        try {
            const data = await proxyWorkshopRoster(u.searchParams);
            return send(res, 200, data, corsHeaders(req));
        } catch (e) {
            return send(
                res,
                502,
                { error: e.message || String(e) },
                corsHeaders(req)
            );
        }
    }

    if (req.method === "GET" && u.pathname === "/api/products") {
        try {
            const data = await proxyProducts(u.searchParams.get("ids"));
            return send(res, 200, data, corsHeaders(req));
        } catch (e) {
            return send(
                res,
                502,
                { error: e.message || String(e) },
                corsHeaders(req)
            );
        }
    }

    const orderIdFulfillmentOrders = matchOrderFulfillmentOrders(u.pathname);
    if (req.method === "GET" && orderIdFulfillmentOrders) {
        try {
            const fulfillment_orders = await fetchFulfillmentOrders(
                orderIdFulfillmentOrders
            );
            return send(
                res,
                200,
                { fulfillment_orders },
                corsHeaders(req)
            );
        } catch (e) {
            return send(
                res,
                502,
                { error: e.message || String(e) },
                corsHeaders(req)
            );
        }
    }

    const orderIdGet = matchOrderId(u.pathname);
    if (req.method === "GET" && orderIdGet) {
        try {
            const data = await proxyOrderDetail(orderIdGet);
            return send(res, 200, data, corsHeaders(req));
        } catch (e) {
            return send(
                res,
                502,
                { error: e.message || String(e) },
                corsHeaders(req)
            );
        }
    }

    const actionMatch = matchOrderAction(u.pathname);
    if (req.method === "POST" && actionMatch) {
        try {
            const body =
                actionMatch.action === "fulfill" ||
                actionMatch.action === "cancel" ||
                actionMatch.action === "refund"
                    ? await readJsonBody(req)
                    : {};
            let result;
            switch (actionMatch.action) {
                case "mark-paid":
                    result = await handleMarkPaid(actionMatch.orderId);
                    break;
                case "mark-pending":
                    result = await handleMarkPending(actionMatch.orderId);
                    break;
                case "void":
                    result = await handleVoid(actionMatch.orderId);
                    break;
                case "cancel":
                    result = await handleCancelOrder(actionMatch.orderId, body);
                    break;
                case "refund":
                    result = await handleRefundOrder(actionMatch.orderId, body);
                    break;
                case "fulfill":
                    result = await createFulfillment(
                        actionMatch.orderId,
                        String(body.intent || "fulfilled")
                            .trim()
                            .toLowerCase()
                    );
                    break;
                default:
                    throw new Error("Unknown action");
            }
            return send(res, 200, result, corsHeaders(req));
        } catch (e) {
            return send(
                res,
                502,
                { error: e.message || String(e) },
                corsHeaders(req)
            );
        }
    }

    if (req.method !== "GET") {
        const hint = isApiPath(u.pathname)
            ? "Restart the hub dev server (npm run dev from the repo root) so POST actions are available."
            : undefined;
        return send(
            res,
            405,
            { error: "Method Not Allowed", hint },
            corsHeaders(req)
        );
    }

    const filePath = safePath(u.pathname === "/" ? "/index.html" : u.pathname);
    if (!filePath || !isInsideRoot(filePath)) {
        res.writeHead(404);
        return res.end("Not Found");
    }

    fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) {
            res.writeHead(404);
            return res.end("Not Found");
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
    });
}

const isDirectRun =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
    http.createServer(handleShopifyHttp).listen(PORT, () => {
        console.log(`Shopify orders dashboard: http://localhost:${PORT}`);
        if (process.env.OPEN_BROWSER === "1") {
            const url = `http://localhost:${PORT}`;
            exec(`start "" "${url}"`, { shell: "cmd.exe" });
        }
    });
}
