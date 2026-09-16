const fs = require("fs");
const path = require("path");
const { normalizeToken, getPublicInvoiceByToken } = require("./public-invoice");

const PUBLIC_ORIGIN = "https://matchanese-invoice.web.app";
const OG_IMAGE = `${PUBLIC_ORIGIN}/og-social.jpg`;
const OG_IMAGE_WIDTH = "1024";
const OG_IMAGE_HEIGHT = "576";

const SOCIAL_BOT_UA =
  /facebookexternalhit|Facebot|Twitterbot|WhatsApp|Slackbot|LinkedInBot|Discordbot|TelegramBot|SkypeUriPreview|Googlebot|bingbot|Embedly|Quora Link Preview|Showyoubot|outbrain|pinterest|redditbot|Applebot|Baiduspider|ia_archiver|MetaInspector|preview|bot|crawl|spider|slurp/i;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractTokenFromPath(pathname) {
  const raw = String(pathname || "");
  const match = raw.match(/^\/i\/([^/?#]+)/i) || raw.match(/^\/([^/?#]+)/i);
  if (!match) return null;
  const segment = decodeURIComponent(match[1] || "").trim();
  if (!segment || segment === "i") return null;
  // Ignore static asset-looking segments if they somehow hit the function.
  if (/\.(css|js|png|jpe?g|gif|svg|webp|ico|map|json|txt|html)$/i.test(segment)) return null;
  return normalizeToken(segment);
}

function readShellHtml() {
  const shellPath = path.join(__dirname, "invoice-page-shell.html");
  return fs.readFileSync(shellPath, "utf8");
}

function upsertMeta(html, attr, name, content) {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${name}["'][^>]*>`,
    "i"
  );
  const tag = `<meta ${attr}="${name}" content="${escapeHtml(content)}">`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace(/<\/head>/i, `    ${tag}\n</head>`);
}

function buildOgMeta({ pageUrl, title, description }) {
  return {
    pageUrl,
    title,
    description,
    image: OG_IMAGE,
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT
  };
}

function applyOgToHtml(html, meta) {
  let out = html;
  out = upsertMeta(out, "property", "og:type", "website");
  out = upsertMeta(out, "property", "og:site_name", "Matchanese");
  out = upsertMeta(out, "property", "og:title", meta.title);
  out = upsertMeta(out, "property", "og:description", meta.description);
  out = upsertMeta(out, "property", "og:url", meta.pageUrl);
  out = upsertMeta(out, "property", "og:image", meta.image);
  out = upsertMeta(out, "property", "og:image:secure_url", meta.image);
  out = upsertMeta(out, "property", "og:image:type", "image/jpeg");
  out = upsertMeta(out, "property", "og:image:width", meta.width);
  out = upsertMeta(out, "property", "og:image:height", meta.height);
  out = upsertMeta(out, "property", "og:image:alt", "Matchanese iced matcha drinks");
  out = upsertMeta(out, "name", "twitter:card", "summary_large_image");
  out = upsertMeta(out, "name", "twitter:title", meta.title);
  out = upsertMeta(out, "name", "twitter:description", meta.description);
  out = upsertMeta(out, "name", "twitter:image", meta.image);
  out = upsertMeta(out, "name", "description", meta.description);
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
  const canonical = `<link rel="canonical" href="${escapeHtml(meta.pageUrl)}">`;
  if (/<link[^>]+rel=["']canonical["']/i.test(out)) {
    out = out.replace(/<link[^>]+rel=["']canonical["'][^>]*>/i, canonical);
  } else {
    out = out.replace(/<\/head>/i, `    ${canonical}\n</head>`);
  }
  return out;
}

function defaultTitleDescription() {
  return {
    title: "Invoice | Matchanese Matcha Bar",
    description: "View your Matchanese invoice, booking details, and payment schedule."
  };
}

function titleDescriptionFromDoc(doc) {
  const invoiceNumber = String(doc?.invoiceNumber || "").trim();
  const clientName = String(doc?.clientName || "").trim();
  const clientCompany = String(doc?.clientCompany || "").trim();
  const client = clientName || clientCompany;
  if (!invoiceNumber) return defaultTitleDescription();
  return {
    title: client
      ? `${invoiceNumber} · ${client} | Matchanese`
      : `${invoiceNumber} | Matchanese Invoice`,
    description: `Matchanese invoice ${invoiceNumber}${client ? ` for ${client}` : ""}. View booking details, payment schedule, and how to pay.`
  };
}

function isSocialBot(userAgent) {
  return SOCIAL_BOT_UA.test(String(userAgent || ""));
}

async function resolvePageMeta(req) {
  const pathname = String(req.path || req.url || "")
    .split("?")[0]
    .split("#")[0];
  const token = extractTokenFromPath(pathname);
  const pageUrl = token
    ? `${PUBLIC_ORIGIN}/i/${token}`
    : `${PUBLIC_ORIGIN}${pathname && pathname !== "/" ? pathname : "/i/"}`;
  let titleDesc = defaultTitleDescription();
  if (token) {
    try {
      const result = await getPublicInvoiceByToken(token);
      if (result?.ok && result.data) {
        titleDesc = titleDescriptionFromDoc(result.data);
      }
    } catch {
      // Keep defaults if lookup fails — preview image still works.
    }
  }
  return buildOgMeta({ pageUrl, ...titleDesc });
}

async function handlePublicInvoicePage(req, res) {
  const meta = await resolvePageMeta(req);
  let html = readShellHtml();
  html = applyOgToHtml(html, meta);

  // Social crawlers only need the head; still return full shell so behavior stays simple.
  res
    .status(200)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": isSocialBot(req.get("user-agent"))
        ? "public, max-age=300"
        : "no-cache"
    })
    .send(html);
}

module.exports = {
  handlePublicInvoicePage,
  extractTokenFromPath,
  applyOgToHtml,
  isSocialBot,
  OG_IMAGE,
  PUBLIC_ORIGIN
};
