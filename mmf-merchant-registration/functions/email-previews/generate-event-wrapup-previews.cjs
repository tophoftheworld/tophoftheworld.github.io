const fs = require("fs");
const path = require("path");
const {
  buildEventWrapupSubject,
  buildEventWrapupHtml,
} = require("../email-content");

const outDir = __dirname;
fs.mkdirSync(outDir, { recursive: true });

const paid = {
  brandName: "Sample Brand Co",
  contactPerson: "Alex Rivera",
  email: "alex@example.com",
  status: "verified",
  settlementType: "full",
  submissionState: "submitted",
  feeSnapshot: { totalDue: 56000, downpaymentAmount: 28000, balanceAmount: 28000 },
};

const unpaid = {
  ...paid,
  brandName: "Matcha Lab",
  contactPerson: "Jordan Lee",
  status: "verified",
  settlementType: "downpayment",
};

function wrap(title, subject, html) {
  const safeSubject = String(subject)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; background: #e5e7eb; font-family: system-ui, sans-serif; }
    .bar { background: #111; color: #fff; padding: 12px 16px; font-size: 13px; line-height: 1.4; }
    .bar strong { color: #86efac; }
  </style>
</head>
<body>
  <div class="bar"><strong>Subject:</strong> ${safeSubject}</div>
  ${html}
</body>
</html>`;
}

const paidPath = path.join(outDir, "event-wrapup-paid.html");
const unpaidPath = path.join(outDir, "event-wrapup-unpaid.html");

fs.writeFileSync(
  paidPath,
  wrap("Fully paid wrap-up", buildEventWrapupSubject(paid), buildEventWrapupHtml(paid))
);
fs.writeFileSync(
  unpaidPath,
  wrap(
    "Pending final payment wrap-up",
    buildEventWrapupSubject(unpaid),
    buildEventWrapupHtml(unpaid)
  )
);

console.log(paidPath);
console.log("SUBJECT PAID:", buildEventWrapupSubject(paid));
console.log(unpaidPath);
console.log("SUBJECT UNPAID:", buildEventWrapupSubject(unpaid));
