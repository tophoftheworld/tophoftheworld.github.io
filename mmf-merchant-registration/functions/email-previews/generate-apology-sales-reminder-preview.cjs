const fs = require("fs");
const path = require("path");
const {
  buildApologySalesReminderSubject,
  buildApologySalesReminderHtml,
} = require("../email-content");

const sample = {
  brandName: "Kokorobi Matcha",
  contactPerson: "Cielo Magbitang",
  email: "kokorobimatcha@gmail.com",
};

const subject = buildApologySalesReminderSubject(sample);
const html = buildApologySalesReminderHtml(sample);
const outPath = path.join(__dirname, "apology-sales-reminder.html");

const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Apology + sales reminder preview</title>
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
