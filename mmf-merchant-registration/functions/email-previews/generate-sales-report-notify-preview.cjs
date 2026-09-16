const fs = require("fs");
const path = require("path");
const {
  buildSalesReportNotifySubject,
  buildSalesReportNotifyHtml,
} = require("../email-content");

const sample = {
  brandName: "Matchanese",
  merchantId: "62d8994e-7326-485c-bee5-5edcab366bb4",
  date: "2026-08-12",
  cashSales: 125710,
  _isUpdate: false,
};

const subject = buildSalesReportNotifySubject(sample);
const html = buildSalesReportNotifyHtml(sample);
const outPath = path.join(__dirname, "sales-report-notify.html");

const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sales report notify preview</title>
  <style>
    body { margin: 0; background: #e5e7eb; font-family: system-ui, sans-serif; }
    .bar { background: #111; color: #fff; padding: 12px 16px; font-size: 13px; line-height: 1.4; }
    .bar strong { color: #86efac; }
  </style>
</head>
<body>
  <div class="bar"><strong>Subject:</strong> ${String(subject)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</div>
  ${html}
</body>
</html>`;

fs.writeFileSync(outPath, page, "utf8");
console.log(outPath);
console.log("SUBJECT:", subject);
