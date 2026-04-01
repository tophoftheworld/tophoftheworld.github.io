/**
 * Local static server + Shopify Admin API proxy.
 * Reads shopify-orders/.env (see .env.example).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

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
const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
};

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
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };
    }
    return {};
}

function parseNextPageInfo(linkHeader) {
    if (!linkHeader) return null;
    const parts = linkHeader.split(",");
    for (const part of parts) {
        const m = part.match(/<([^>]+)>;\s*rel="next"/);
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

async function proxyShopifyOrders(searchParams) {
    if (!SHOP || !TOKEN) {
        throw new Error(
            "Missing SHOPIFY_SHOP or SHOPIFY_ACCESS_TOKEN in shopify-orders/.env"
        );
    }
    const base = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/orders.json`;
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
    const url = `${base}?${qs.toString()}`;
    const res = await fetch(url, {
        headers: {
            "X-Shopify-Access-Token": TOKEN,
            "Content-Type": "application/json",
        },
    });
    const text = await res.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = { errors: text || res.statusText };
    }
    if (!res.ok) {
        const msg =
            body?.errors ||
            body?.error ||
            `Shopify HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    const nextPageInfo = parseNextPageInfo(res.headers.get("link") || "");
    return {
        orders: body.orders || [],
        nextPageInfo,
    };
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

const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS" && (u.pathname === "/api/orders" || u.pathname === "/api/config")) {
        res.writeHead(204, corsHeaders(req));
        return res.end();
    }

    if (req.method === "GET" && u.pathname === "/api/config") {
        return send(res, 200, { shop: SHOP || null, hasToken: Boolean(TOKEN) }, corsHeaders(req));
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

    if (req.method !== "GET") {
        res.writeHead(405);
        return res.end("Method Not Allowed");
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
});

server.listen(PORT, () => {
    console.log(`Shopify orders dashboard: http://localhost:${PORT}`);
    if (process.env.OPEN_BROWSER === "1") {
        const url = `http://localhost:${PORT}`;
        exec(`start "" "${url}"`, { shell: "cmd.exe" });
    }
});
