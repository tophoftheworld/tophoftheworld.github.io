const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTokenFromPath,
  applyOgToHtml,
  isSocialBot,
  OG_IMAGE
} = require("../public-invoice-page");

test("extractTokenFromPath reads /i/:token", () => {
  assert.equal(
    extractTokenFromPath("/i/810e9278ff35b8ac2d12e8d19197c6bb"),
    "810e9278ff35b8ac2d12e8d19197c6bb"
  );
});

test("extractTokenFromPath ignores assets", () => {
  assert.equal(extractTokenFromPath("/i/img/og-social.jpg"), null);
  assert.equal(extractTokenFromPath("/i/css/invoice-view.css"), null);
});

test("applyOgToHtml sets matching og:url and image", () => {
  const html = `<!DOCTYPE html><html><head>
    <title>Old</title>
    <meta property="og:title" content="Old">
    <meta property="og:image" content="https://example.com/old.jpg">
  </head><body></body></html>`;
  const out = applyOgToHtml(html, {
    pageUrl: "https://matchanese-invoice.web.app/i/abc12345token",
    title: "INV-1 · Client | Matchanese",
    description: "desc",
    image: OG_IMAGE,
    width: "1024",
    height: "576"
  });
  assert.match(out, /property="og:url" content="https:\/\/matchanese-invoice\.web\.app\/i\/abc12345token"/);
  assert.match(out, /property="og:image" content="https:\/\/matchanese-invoice\.web\.app\/og-social\.jpg"/);
  assert.match(out, /property="og:image:width" content="1024"/);
  assert.match(out, /<title>INV-1 · Client \| Matchanese<\/title>/);
  assert.match(out, /rel="canonical" href="https:\/\/matchanese-invoice\.web\.app\/i\/abc12345token"/);
});

test("isSocialBot detects Facebook crawler", () => {
  assert.equal(isSocialBot("facebookexternalhit/1.1"), true);
  assert.equal(isSocialBot("Mozilla/5.0 (iPhone)"), false);
});
