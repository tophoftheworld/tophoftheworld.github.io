/**
 * Call production fulfill API. DRY-RUN by default — pass --execute to POST.
 * Usage: node scripts/test-prod-fulfill.mjs <orderId> [--execute]
 */
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const orderId = args.find((a) => !a.startsWith("-"));
const base = process.env.SHOPIFY_API_BASE || "https://matchanese-attendance.web.app";

if (!orderId) {
    console.error("Usage: node scripts/test-prod-fulfill.mjs <orderId> [--execute]");
    process.exit(1);
}

console.log("Would POST", `${base}/api/orders/${orderId}/fulfill`, { intent: "shipped" });
if (!execute) {
    console.log("Dry run. Pass --execute to call production.");
    process.exit(0);
}

const res = await fetch(`${base}/api/orders/${orderId}/fulfill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "shipped" }),
});
const text = await res.text();
console.log("Status:", res.status);
console.log("Body:", text);
