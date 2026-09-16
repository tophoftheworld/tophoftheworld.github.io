# Matchanese AI Bot Manager

Dashboard for Chatbase agent conversations (Instagram, Messenger, WhatsApp, widget, and other sources) plus **structured service leads** from a Chatbase custom action.

## Features

### Inbox

- Paginated **Refresh** loads conversations in the selected date range
- Filter by source, date range, and client-side search
- Two-pane layout: conversation list + message thread (agent messages on the **right**)
- **Summary** button builds an ops brief (Urgent / Leads / Payments to verify / Follow-ups / Awaiting reply)
- **Send test email** on the summary pane; scheduled emails at **9:00** and **21:00** Asia/Manila (rolling 24h + 5-day awaiting-reply)
- Same briefs post to Discord `#inbox-summary`; service leads post to `#inquiries` (creates and updates; updates edit the same Discord message)

### Service leads

- **Quote ref** — 5-character code per quote (e.g. `K7M2P`); legacy `MQ-…` codes still work for updates
- **Pipeline status** — inquiry, quoted, invoiced, deposit, completed (AI + staff)
- **Profile incomplete** badge when core fields are still missing
- **Notes** — internal notes (staff + optional AI via webhook)
- Two-pane detail view; **Download invoice** PDF in-app (requires finalized pax/cups and single price)
- Partial logging: API accepts any subset of fields and merges on update

## Setup

1. Install [Firebase CLI](https://firebase.google.com/docs/cli) and log in.
2. Set Firebase project in `[.firebaserc](./.firebaserc)`.
3. Enable **Firestore** in the Firebase console.
4. `cd functions && npm install`
5. Copy `[functions/.env.example](./functions/.env.example)` → `functions/.env`
6. Copy `[public/js/config.example.js](./public/js/config.example.js)` → `public/js/config.js` (same `ADMIN_API_TOKEN`)

## Local run

```bash
firebase emulators:start --only functions,hosting
```

## Deploy

```bash
cd functions && npm run deploy
```

(or `firebase deploy --only "functions:api,functions:inboxSummaryEmailMorning,functions:inboxSummaryEmailEvening,hosting"`)

Set on Cloud Functions (via `functions/.env`): `ADMIN_API_TOKEN`, `CHATBASE_API_KEY`, `CHATBASE_CHATBOT_ID`, `CHATBASE_ACTION_SECRET`, `SHOPIFY_SHOP`, `SHOPIFY_ACCESS_TOKEN` (or client id/secret), plus EmailJS vars below for summary email, and Discord webhook URLs.

### Inbox summary email (EmailJS)

Uses the same EmailJS account as daily-sales. In EmailJS:

1. Account → Security → enable **Allow EmailJS API for non-browser applications** and copy the private key → `EMAILJS_PRIVATE_KEY`
2. Create a template (e.g. `EMAILJS_SUMMARY_TEMPLATE_ID`) with body `{{{summary_html}}}` (triple braces) and params `{{subject}}`, `{{to_email}}`, `{{from_name}}`
3. Set `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`, `SUMMARY_EMAIL_TO` (default `hi@matchanese.com`)

Schedules: `inboxSummaryEmailMorning` (09:00) and `inboxSummaryEmailEvening` (21:00) Asia/Manila.

### Discord (inbox summary + new inquiries)

Create **three** incoming webhooks (Integrations → Webhooks). The Discord **Name** field is a display name only — do not put env var names there, and do not use the word `discord` in the name.

| Discord name | Channel | Env var |
|---|---|---|
| Inbox Summary | `#inbox-summary` | `DISCORD_INBOX_WEBHOOK_URL` |
| Inquiries | `#inquiries` | `DISCORD_INQUIRIES_WEBHOOK_URL` |
| Orders | orders channel | `DISCORD_ORDERS_WEBHOOK_URL` |

Paste the copied URLs into `functions/.env` (do not commit them). Morning/evening jobs and the dashboard **Send test email** button also post the brief to `#inbox-summary`. Chatbase and dashboard lead **creates** post a card to `#inquiries`; later **updates** edit that same message (stored as `discordMessageId` on the lead). If the original Discord message was deleted, a new card is posted. Shopify `orders/create` and `orders/paid` post to the orders webhook. If a URL is missing, email and lead logging still work.

**Webhooks:**

- Service leads: `https://matchanese-attendance.web.app/api/webhooks/service-lead`
- Payment proof: `https://matchanese-attendance.web.app/api/webhooks/payment-proof`

## API — PATCH `/service-leads/:id` (dashboard)

Requires `x-admin-token`. Body: `{ "pipelineStatus"?: "inquiry"|"quoted"|"invoiced"|"deposit"|"completed", "notes"?: "..." }`

## API — POST `/service-leads/delete` (dashboard)

Requires `x-admin-token`. Body: `{ "ids": ["firestoreDocId1", "firestoreDocId2"] }` (max 100).

## API — POST `/webhooks/service-lead`


| Field                                                                          | Required | Notes                                                                                                           |
| ------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------- |
| `clientName`, `service`, `targetDate`, `targetPax`, `targetVenue`, `eventType` | No*      | Send when known; `service` must be bar or workshop if sent                                                      |
| `quotedPrice`                                                                  | No       | e.g. `PHP 45000`, `₱45,000` (ranges OK for chat quotes)                                                         |
| `pipelineStatus`                                                               | No       | `inquiry`, `quoted`, `invoiced`, `deposit`, `completed` — do **not** set `invoiced` unless staff issued invoice |
| `notes`                                                                        | No       | Internal note; use for pax ranges, tiers, caveats                                                               |
| `quoteReference`                                                               | No       | Empty = **new** quote. Set = **update** that quote                                                              |
| `conversationId`                                                               | No       | Not available in Chatbase Add variable; dashboard infers inbox link (see below)                                 |


New quote: at least **one** detail field required. Update: `quoteReference` alone is enough.

**Success (201 / 200):**

```json
{
  "ok": true,
  "id": "firestore-doc-id",
  "quoteReference": "K7M2P",
  "created": true,
  "profileStatus": "draft",
  "pipelineStatus": "inquiry",
  "status": "draft",
  "messageForUser": "Thanks! We've noted what you've shared so far..."
}
```

`profileStatus` is `draft` until name, service, date, pax, venue, and event type are all stored. `status` in responses is an alias for `profileStatus` (legacy).

---

## Chatbase setup (copy-paste)

Configure **Actions → logServiceLead** (server / Call API).

### General — When to use

```
Use logServiceLead for Private Mobile Matcha Bar or Private Matcha Workshop quote requests.

Call this action EARLY and OFTEN:
- As soon as the customer shows quote intent and you learn ANY one detail (name, service, date, pax, venue, event type, or price), call logServiceLead immediately with whatever you know. Do not wait until all fields are complete.
- Call again EVERY TIME the customer adds or changes ANY detail (including price). Always pass the same quoteReference from your last successful response when updating the same quote.
- New separate project in the same chat: call with quoteReference empty to get a new code.

Never skip logging because information is incomplete.
```

### Data inputs (10 — all optional in Chatbase)


| Name             | Description                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `quoteReference` | Empty for new quote. For updates, same 5-character code from last API response (e.g. K7M2P).                                           |
| `clientName`     | Name when known                                                                                                                        |
| `service`        | Private Mobile Matcha Bar OR Private Matcha Workshop when known                                                                        |
| `targetDate`     | Event date when known                                                                                                                  |
| `targetPax`      | Guests/cups — use a **single number** once the client confirms final count (e.g. `100`). While still a range, describe it in `notes`.  |
| `targetVenue`    | Venue when known                                                                                                                       |
| `eventType`      | Wedding, Corporate, etc. when known                                                                                                    |
| `quotedPrice`    | Quoted amount when stated (ranges/tiers OK for verbal quotes)                                                                          |
| `pipelineStatus` | `inquiry`, `quoted`, `invoiced`, `deposit`, `completed` — use `quoted` when you give a custom quote; never set `invoiced` (staff only) |
| `notes`          | Short internal note (pax range, tiers, special requests)                                                                               |


### API request


| Setting    | Value                                                             |
| ---------- | ----------------------------------------------------------------- |
| **Method** | `POST`                                                            |
| **URL**    | `https://matchanese-attendance.web.app/api/webhooks/service-lead` |


**Headers:**


| Key                        | Value                                        |
| -------------------------- | -------------------------------------------- |
| `Content-Type`             | `application/json`                           |
| `x-chatbase-action-secret` | Same as `CHATBASE_ACTION_SECRET` in Firebase |


**Body:**

```json
{
  "quoteReference": "{{quoteReference}}",
  "clientName": "{{clientName}}",
  "service": "{{service}}",
  "targetDate": "{{targetDate}}",
  "targetPax": "{{targetPax}}",
  "targetVenue": "{{targetVenue}}",
  "eventType": "{{eventType}}",
  "quotedPrice": "{{quotedPrice}}",
  "pipelineStatus": "{{pipelineStatus}}",
  "notes": "{{notes}}"
}
```

The HTTPS URL must be plain text (no `{{` around the URL). Chatbase server actions do **not** expose `conversationId` in Add variable; `userId` / [identity verification](https://www.chatbase.co/docs/developer-guides/identity-verification) is **website widget only**, not Instagram/Messenger.

**Linking Inbox ↔ Service leads:** Chatbase cannot pass `conversationId`. The dashboard **View conversation** action searches Inbox by **client name / user display name**, not by quote reference. Keep `quoteReference` for internal updates only — **never say the booking/quote code to the customer in chat**.

### Test response

1. **Live response** — only `clientName` = `Test User`, **`quoteReference` empty** → expect **201**, 5-char `quoteReference`, `profileStatus: "draft"`, `pipelineStatus: "inquiry"`.
2. Same test with that `quoteReference` + `targetPax` = `50` + `pipelineStatus` = `quoted` → **200**, `created: false`.

**404 in Chatbase test?** Usually means `quoteReference` was filled with a code that does not exist yet. Clear it for a new-quote test, or use the code returned from step 1. Unknown refs sent with other quote details are treated as a new quote (server assigns a fresh code).

### Data access

**Full data access** (agent reads `quoteReference`, `profileStatus`, `pipelineStatus`, `messageForUser`).

### Agent instructions (Deploy / AI)

```
logServiceLead rules:
1. On first quote detail → call immediately with only known fields; quoteReference empty; pipelineStatus inquiry.
2. Never tell the customer the quoteReference / booking code. Keep it internal (read from the action response for later updates only). Use messageForUser as written — do not append the code.
3. On ANY later change → call again with same quoteReference + all fields you currently know (leave unknown fields empty).
4. New separate event in same chat → quoteReference empty.
5. Set pipelineStatus quoted when you give any custom quotation or price (including estimates for a pax/cup RANGE).
6. Use notes for ranges, tiers, or caveats (e.g. "Quote assumes 50–100 cups; final price depends on confirmed count").
7. When the customer confirms a FINAL number of guests/cups, call again with that exact number in targetPax and update quotedPrice if needed.
8. Invoicing: You may quote freely while count is still a range. Do NOT say a formal invoice is ready until they confirm a final count. Do NOT set pipelineStatus to invoiced (staff only).
9. Do not set deposit/completed unless the customer clearly confirmed payment or the event is done.
```

### Channels

Enable **Instagram**, **Messenger** (and **Widget** if used). Save and enable the action.

---

## API — POST `/webhooks/payment-proof`

Logs payment proof from chat, matches Shopify order (`M#XXXX` preferred), marks order paid, stores audit row in `paymentIntakes`.


| Field                                                 | Required | Notes                      |
| ----------------------------------------------------- | -------- | -------------------------- |
| `orderNumber`                                         | Yes*     | e.g. `M#2053`              |
| `clientName`                                          | Yes*     | Payer / customer name      |
| `amount`, `paymentMethod`, `referenceNumber`, `notes` | No       | From screenshot            |
| `conversationId`                                      | No       | Auto-resolved when `orderNumber` appears in recent inbox messages                          |


At least one of `orderNumber` or `clientName`.

**Success (201):** `{ ok, id, orderName, shopifyOrderId, status, messageForUser }`

## Chatbase setup — logPaymentProof

### When to use

```
Use logPaymentProof when the customer sends GCash/bank transfer payment proof for a Shopify order (products, delivery/pickup, or workshop registration).

Before calling: the order number M#XXXX must already appear in this chat (customer said it, or you repeated it earlier).
Call once you have order number OR payer name. `clientName` is for Shopify matching only (payer on receipt).
After EVERY successful response, repeat the order number in your reply (e.g. "Payment recorded for M#2094"). Required for inbox linking.
After success, use messageForUser in your reply.
```

### Data inputs


| Name              | Description              |
| ----------------- | ------------------------ |
| `orderNumber`     | Order number e.g. M#2053 |
| `clientName`      | Name on transfer         |
| `amount`          | Amount on receipt        |
| `paymentMethod`   | GCash, BDO, etc.         |
| `referenceNumber` | Transaction ref          |
| `notes`           | Internal note            |


### API request


| Setting    | Value                                                              |
| ---------- | ------------------------------------------------------------------ |
| **Method** | `POST`                                                             |
| **URL**    | `https://matchanese-attendance.web.app/api/webhooks/payment-proof` |


**Headers:** `Content-Type: application/json`, `x-chatbase-action-secret` (same as service-lead)

**Body:**

```json
{
  "orderNumber": "{{orderNumber}}",
  "clientName": "{{clientName}}",
  "amount": "{{amount}}",
  "paymentMethod": "{{paymentMethod}}",
  "referenceNumber": "{{referenceNumber}}",
  "notes": "{{notes}}"
}
```

**Data access:** Full — use `messageForUser`, `orderName`, `status` in replies.

**Inbox link:** the server searches inbox threads whose dates fall around when the payment was logged, and (if older) back to the **Shopify order date** — up to 400 days. It looks for the **order number** in any message. No `conversationId` from Chatbase.

---

## Tests

```bash
cd functions
npm test
```

