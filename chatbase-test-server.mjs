/**
 * Local server for chatbase-test.html — mints identity JWTs and serves the page.
 *
 *   set CHATBOT_IDENTITY_SECRET=your_secret_from_chatbase_dashboard
 *   node chatbase-test-server.mjs
 *
 * Open http://localhost:8765/chatbase-test.html
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8765;
const SECRET = process.env.CHATBOT_IDENTITY_SECRET || "";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnv(path.join(__dirname, ".env"));

const secret = process.env.CHATBOT_IDENTITY_SECRET || SECRET;

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload, key) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto
    .createHmac("sha256", key)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${sig}`;
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/token" && req.method === "GET") {
    if (!secret) {
      json(res, 500, {
        error: "Missing CHATBOT_IDENTITY_SECRET env var (from Chatbase embed settings)",
      });
      return;
    }

    const userId = url.searchParams.get("user_id") || "test-user-001";
    const email = url.searchParams.get("email") || "test@example.com";
    const name = url.searchParams.get("name") || "Test User";

    const token = signJwt(
      {
        user_id: userId,
        email,
        name,
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      secret
    );

    json(res, 200, { token, user_id: userId, email, name });
    return;
  }

  if (url.pathname === "/chatbase-test.html" || url.pathname === "/") {
    serveFile(
      res,
      path.join(__dirname, "chatbase-test.html"),
      "text/html; charset=utf-8"
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Chatbase test server → http://localhost:${PORT}/chatbase-test.html`);
  if (!secret) {
    console.warn(
      "WARNING: CHATBOT_IDENTITY_SECRET not set — identity tokens will fail."
    );
    console.warn("Set it in .env or: $env:CHATBOT_IDENTITY_SECRET=\"...\"");
  } else {
    console.log("Identity secret loaded — /api/token ready");
  }
});
