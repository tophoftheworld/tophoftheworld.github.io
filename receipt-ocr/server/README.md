# Receipt OCR Vision + Document AI proxy

Small **Express** server that accepts a base64 image and returns OCR text from **Google Cloud Vision** (`documentTextDetection`).

## Prerequisites

- Node 18+
- GCP project with **Document AI enabled** (Invoice Parser) and a **service account JSON** key (see [../GCP_SETUP.md](../GCP_SETUP.md))

## Setup

```bash
cd receipt-ocr/server
npm install
```

Set credentials (Windows PowerShell):

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="D:\path\to\your-service-account.json"
```

Linux/macOS:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-service-account.json
```

Optional: set `PORT` / `CORS_ORIGIN` in your shell before running (the server does not auto-load `.env`).
Also set `DOCUMENT_AI_PROCESSOR_NAME` so the server can call your Document AI processor via `POST /scan-documentai`.
Make sure `DOCUMENT_AI_PROCESSOR_NAME` is a processor resource name like:
`projects/<projectId>/locations/<region>/processors/<processorId>` (not the full “Prediction endpoint” URL with `:process`).

## Run

```bash
npm start
```

Default URL: `http://localhost:8787`

## API

### `POST /scan`

**Content-Type:** `application/json`

```json
{
  "imageBase64": "<base64 without data: URL prefix, or with prefix — server strips it>"
}
```

**Response:**

```json
{
  "ok": true,
  "fullText": "all detected text...",
  "error": null
}
```

On failure:

```json
{
  "ok": false,
  "fullText": "",
  "error": "message"
}
```

### `GET /health`

Returns `{ "ok": true }` for load balancers.

### `POST /scan-documentai`

**Content-Type:** `application/json`

```json
{
  "imageBase64": "<base64 without data: URL prefix, or with prefix — server strips it>"
}
```

**Response:**

```json
{
  "ok": true,
  "fullText": "all detected text...",
  "parsed": {
    "supplierName": "",
    "businessName": "",
    "tin": "",
    "address": "",
    "invoiceNumber": "",
    "date": "",
    "items": [],
    "totalAmount": 0,
    "vatExemptAmount": 0,
    "vatComputationEnabled": true,
    "printedVat": {
      "vatableSale": null,
      "vatAmount": null,
      "taxableAmount": null,
      "totalAmount": null
    }
  },
  "error": null
}
```

## Deploy

Suitable for **Cloud Run**, **Cloud Functions (2nd gen)**, or any Node host. Set `GOOGLE_APPLICATION_CREDENTIALS` via secret mount or workload identity; restrict `CORS_ORIGIN` to your static site origin.
