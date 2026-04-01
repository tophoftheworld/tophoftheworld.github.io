# Chatbase Leads Dashboard (Firebase + Vanilla JS)

Standalone lead-tracking dashboard for Chatbase booking conversations.

## Features

- Webhook ingestion for `leads.submit` with HMAC-SHA1 signature verification ([Webhook API Guide](https://chatbase.co/docs/developer-guides/webhooks))
- Scheduled sync from Chatbase `get-leads` + `get-conversations` ([REST overview](https://www.chatbase.co/docs/developer-guides/api-integration))
- **Optional:** Chatbase **server-side custom action** → `POST /ingest/chatbase-action` with structured fields (date, venue, cups, pax) for higher accuracy than parsing alone
- Booking field extraction:
  - Mobile bar: target date, target venue, cups to serve
  - Workshop: pax
- Auto lead status transitions (`new`, `qualified`, `follow_up`, `proposal_sent`, `won`, `lost`)
- Pipeline dashboard with filters, lead detail, and status timeline

## Project structure

- `public/index.html` pipeline dashboard
- `public/lead.html` lead detail page
- `public/css/style.css`
- `public/js/*.js` vanilla frontend (`API_BASE_URL: ""` uses same-origin `/api` when hosted on Firebase Hosting)
- `functions/index.js` — `api` (Express), `chatbaseWebhook`, schedulers
- `functions/extractor.js`, `functions/status-engine.js`
- `firestore.rules`, `firestore.indexes.json`

## Setup

1. Install [Firebase CLI](https://firebase.google.com/docs/cli) and log in: `firebase login`
2. Set your Firebase project ID in [`.firebaserc`](./.firebaserc) (replace `your-firebase-project-id`).
3. Install Cloud Functions dependencies:

   ```bash
   cd functions
   npm install
   ```

4. **Secrets / env for functions** (local emulator):
   - Copy [`functions/.env.example`](./functions/.env.example) to `functions/.env`
   - Set `CHATBASE_API_KEY`, `CHATBASE_CHATBOT_ID`, `ADMIN_API_TOKEN`, and optionally `CHATBASE_WEBHOOK_SECRET`

5. **Dashboard config** (browser):
   - Copy [`public/js/config.example.js`](./public/js/config.example.js) to `public/js/config.js`
   - Set `ADMIN_API_TOKEN` to the **same** value as the function env
   - Leave `API_BASE_URL` as `""` when the site is served from Firebase Hosting (uses `/api` rewrite)

## Local run

From `chatbase-leads-dashboard`:

```bash
firebase emulators:start --only functions,firestore,hosting
```

- Open the Hosting URL (default `http://localhost:5000`)
- If the UI is not served via Hosting (e.g. opening `file://` HTML), set `API_BASE_URL` in `public/js/config.js` to your emulated function URL (see emulator logs)

## Deploy

```bash
firebase deploy --only functions,hosting,firestore:rules,firestore:indexes
```

### Production environment variables (required)

Cloud Functions **Gen 2** does not read `functions/.env` in production. After deploy, set runtime environment variables for **each** deployed function (`api`, `chatbaseWebhook`, `scheduledSync`, `scheduledStatusSweep`, `dailyReconciliation`) in [Google Cloud Console](https://console.cloud.google.com/) → **Cloud Functions** → select function → **Edit** → **Runtime, build, connections and security** → **Runtime environment variables**:

| Variable | Purpose |
|----------|---------|
| `ADMIN_API_TOKEN` | Shared secret; dashboard sends it as header `x-admin-token` |
| `CHATBASE_API_KEY` | Bearer token for `get-leads` / `get-conversations` |
| `CHATBASE_CHATBOT_ID` | Chatbot ID (same as in Chatbase settings) |
| `CHATBASE_WEBHOOK_SECRET` | Optional; if omitted, webhook HMAC uses `CHATBASE_API_KEY` |

Optional tuning: `MAX_SYNC_PAGES`, `SYNC_LEADS_PAGE_SIZE`, `SYNC_CONVERSATION_PAGE_SIZE` (see `.env.example`).

## Chatbase configuration

### A) Webhook (`leads.submit`)

1. In Chatbase, configure a webhook to your deployed **`chatbaseWebhook`** URL (Firebase console → Functions → `chatbaseWebhook` → URL).
2. Verify signatures per [Webhook API Guide](https://chatbase.co/docs/developer-guides/webhooks) using the same secret you set in `CHATBASE_WEBHOOK_SECRET` (or API key).

### B) Custom action (structured booking fields)

Use a **server-side** custom action (see [Custom Action](https://chatbase.co/docs/user-guides/chatbot/actions/custom-action.md)):

- **Method:** `POST`
- **URL:** your **`api`** function base + `/ingest/chatbase-action`  
  - With Hosting + rewrite: `https://YOUR_PROJECT.web.app/api/ingest/chatbase-action`
  - Or direct function URL + path as configured in Express (strip `/api` prefix if you call the function URL directly — see rewrite in [`firebase.json`](./firebase.json))
- **Headers:** `Content-Type: application/json`, `x-admin-token: <ADMIN_API_TOKEN>`
- **Body (JSON):** map Chatbase data inputs, for example:

```json
{
  "conversationId": "<variable from Chatbase if available>",
  "name": "<name>",
  "email": "<email>",
  "phone": "<phone>",
  "inquiry_type": "mobile_bar",
  "target_date": "<date>",
  "target_venue": "<venue>",
  "cups_to_serve": 200
}
```

Workshop example: `inquiry_type: "workshop"`, `pax: 20`.

**Response:** keep JSON under 20KB (Chatbase limit). This endpoint returns `{ "ok": true, "leadId": "...", "status": "...", "inquiryType": "..." }`.

## Tests (functions)

```bash
cd functions
npm test
```

## Notes

- Keep Chatbase API keys **server-side** only; never put them in `public/js/config.js`.
- Firestore rules lock client writes; the dashboard talks to your backend only (admin token), not directly to Firestore.
