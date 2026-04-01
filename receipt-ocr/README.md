# Receipt OCR (Google Document AI)

Standalone mobile-friendly page to photograph receipts, run **Google Cloud Document AI** through a **server proxy**, parse common Philippine OR/SI fields, **verify VAT** against the same 12% inclusive math as [`../expenses/js/shared.js`](../expenses/js/shared.js), and **copy JSON** shaped for handoff to the Expense Tracker.

## Plain English (if you “just use your HTTP server”)

There are **two separate things**, not one:

1. **The receipt app (normal website)**  
   This is the `receipt-ocr` folder: HTML/JS/CSS, same as the rest of your site. Put it on your HTTP server and open it like any other page (for example `https://yoursite.com/receipt-ocr/`). **No change to how you usually host static files.**

2. **The “scanner bridge” (not a normal web page)**  
   Document AI needs a **secret key**. Browsers cannot keep that secret (anyone could steal it from the page). So a **small Node.js program** in `server/` is the only piece that talks to Google. You run it on a PC when you want to scan, or you host it somewhere later. It is **not** your usual static file server; it is optional only in the sense that **without it, Scan will not work**—there is no way to call Document AI safely with only static hosting.

**What you do in practice**

- **Host** `receipt-ocr/` on your HTTP server (same as always).
- **On the same computer** (or another machine on your LAN) where you are okay running Node once: install and start the `server/` app (see below), and in [`js/config.js`](js/config.js) set `RECEIPT_OCR_API_BASE` to that machine’s address, e.g. `http://192.168.1.10:8787` if your phone loads the site from the internet but the bridge runs on your PC.

If you truly cannot run anything except static files, you would need a hosted bridge (Cloud Run, etc.)—still not a secret inside the HTML.

## Quick start (step-by-step)

**A — One-time Google Cloud setup (so Document AI is allowed to run)**

- Create a Google Cloud project, turn on billing, enable **Document AI** (Invoice Parser), and download a **service account JSON key** file. Details: [GCP_SETUP.md](./GCP_SETUP.md). This is the “permission slip” the bridge uses.

**B — Run the bridge on a machine where Node can run**

- In a terminal: go to `receipt-ocr/server`, run `npm install` once, set the environment variable `GOOGLE_APPLICATION_CREDENTIALS` to the path of that JSON file, then `npm start`. It listens on port **8787** by default.
- Also set `DOCUMENT_AI_PROCESSOR_NAME` (see `receipt-ocr/server/.env.example`) so the server knows which processor to call.

**C — Point the web app at the bridge**

- Open your hosted `receipt-ocr` page. Edit [`js/config.js`](js/config.js) so `RECEIPT_OCR_API_BASE` is the URL of the bridge (for example `http://localhost:8787` if the site and bridge are on the same computer, or `http://YOUR_PC_IP:8787` if the phone uses another device).

**D — Use it**

- Choose a receipt photo. The page sends the image to the bridge; the bridge calls Google and returns text.

## Security

- Never put Vision/Document AI API keys in the browser. The Node proxy holds credentials via `GOOGLE_APPLICATION_CREDENTIALS`.
- Never put Document AI keys in the browser. The Node proxy holds credentials via `GOOGLE_APPLICATION_CREDENTIALS`.
- For production, deploy the proxy to Cloud Run / Cloud Functions and set `CORS_ORIGIN` to your site origin.

## Files

| Path | Purpose |
|------|---------|
| `index.html` | UI |
| `js/parse-ph.js` | Heuristic PH receipt parsing |
| `js/vat-verify.js` | VAT breakdown + printed vs expected check |
| `js/app.js` | Camera/upload, API call, clipboard JSON |
| `js/config.example.js` | Example API base URL |
| `server/` | Express + `@google-cloud/documentai` |

## Expense JSON

“Copy expense JSON” produces a plain object you can paste into tooling or future import. It aligns with fields consumed by `createExpenseObject` in the expenses app (you still add `receiptImage` in the main app).
