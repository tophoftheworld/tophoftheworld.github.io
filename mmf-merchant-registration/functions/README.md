# MMF Merchant Registration — Cloud Functions

Signup confirmation emails, admin alerts, and PayPal invoicing for card payments.

## Prerequisites

1. **Firebase Blaze plan** on `manila-matcha-fest` (required for Cloud Functions)
2. **EmailJS** account (same as daily-sales / payroll)
   - Enable **Account → Security → Allow EmailJS API for non-browser applications**
   - Copy the **private key**
   - Use an HTML template with `{{{message}}}`, `{{subject}}`, `{{to_email}}`, `{{from_name}}` (e.g. `template_6zh5mq8`)
3. **PayPal Business** app with Invoicing enabled
   - Client ID + Secret stored as Firebase secrets

## One-time setup

```bash
cd mmf-merchant-registration/functions
npm install

firebase functions:secrets:set EMAILJS_PRIVATE_KEY --project manila-matcha-fest
firebase functions:secrets:set PAYPAL_CLIENT_ID --project manila-matcha-fest
firebase functions:secrets:set PAYPAL_CLIENT_SECRET --project manila-matcha-fest
```

Optional: `PAYPAL_API_BASE` env override. **Default is live** (`https://api-m.paypal.com`). For sandbox testing, set `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com` and use sandbox credentials.

### PayPal invoice branding (logo, name, address)

**Do not hardcode business details in our code.** PayPal uses your **Business account profile** for sender branding when we omit the API `invoicer` block.

Update in PayPal:

1. [paypal.com](https://www.paypal.com) → **Settings** → **Business information** — name, address, logo  
2. **Invoicing** → **Templates** (optional) — save a default template, then set env `PAYPAL_INVOICE_TEMPLATE_ID` if you want every API invoice to use it

Logo on PayPal: upload in business settings (wide format, max 250×90 px for API-hosted logos if you ever set `logo_url` manually later).

### Test partial payments

In `payment-config.js`, `PAYPAL_TEST_MINIMUM_DUE = 28` sets PayPal **minimum due** to PHP 28 (invoice total stays PHP 56,000). Set to `null` before production so minimum due = 50% (PHP 28,000).

## Deploy

**Functions only** (when ready to test PayPal / emails):

```bash
cd mmf-merchant-registration
firebase deploy --only functions --project manila-matcha-fest
```

Do **not** deploy hosting until you explicitly want the public form/admin UI live with these changes.

```bash
# Later, when you want the site live:
# firebase deploy --only hosting --project manila-matcha-fest
```

Region: **asia-southeast1**.

## Callables

| Name | Purpose |
|------|---------|
| `createPayPalInvoice` | `{ registrationId }` → create/reuse invoice (legacy; card removed from form) |
| `sendPaymentDetailsEmail` | `{ registrationId }` → email bank/e-wallet payment details to card merchants (admin button) |
| `sendFinalPaymentDetailsEmail` | `{ registrationId }` → email remaining-balance payment details to verified 50% downpayment merchants (admin button) |

Both are public invokers (no Firebase Auth). They require a submitted registration with `paymentMethod: "card"`.

## Environment / secrets

| Variable | Notes |
|----------|-------|
| `EMAILJS_SERVICE_ID` | default `service_1085n74` |
| `EMAILJS_PUBLIC_KEY` | see mailer.js |
| `EMAILJS_PRIVATE_KEY` | Firebase secret |
| `EMAILJS_TEMPLATE_ID` | default `template_6zh5mq8` |
| `MMF_NOTIFY_EMAIL` | default `hi@matchanese.com` |
| `MMF_ADMIN_URL` | default `https://mmf-info.web.app/admin` |
| `PAYPAL_CLIENT_ID` | Firebase secret |
| `PAYPAL_CLIENT_SECRET` | Firebase secret |
| `PAYPAL_API_BASE` | optional; defaults to `https://api-m.paypal.com` |

## Firestore fields

Card registrations get:

```js
paypalInvoice: {
  id, href, status, amount, currency, purpose, // 'downpayment' | 'full'
  createdAt, lastEmailedAt
}
```

## Test

```bash
cd functions && npm test
```
