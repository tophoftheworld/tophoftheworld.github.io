# Event Booking Dashboard

Admin dashboard for workshop/event schedule and capacity management. Sessions are stored in Firestore; Shopify storefront integration is not wired yet.

## Admin dashboard

Open [`admin/index.html`](admin/index.html) via a local server, or deploy to Firebase Hosting.

### Local (quick test)

From repo root:

```bash
npx --yes serve workshop-booking -l 5190
```

Then open: `http://localhost:5190/admin/`

> ES modules need a server — do not open the HTML file directly as `file://`.

### Firebase Hosting

```bash
cd workshop-booking
firebase login
firebase use matchanese-attendance
firebase deploy --only hosting,firestore:indexes
```

Admin URL: `https://<your-hosting-site>.web.app/admin/`

No login screen is configured. Keep the URL private while Firestore rules remain open for development (see root [`firestore.rules`](../firestore.rules)).

## UX

Two-panel layout (similar to Shopify Orders / Leads):

| Left panel | Right panel |
|------------|-------------|
| **List** or **Calendar** toggle | Hidden until you add or select something |
| Month + filters | **Add event** form or **Edit event** form |
| Flat session rows / calendar chips | Event form; **Schedule** for one slot, **Sessions** when multiple |

- **+ Add event** or click an **empty calendar day** → right panel opens with a new event form.
- Single-slot events use a **Schedule** section (date/time/capacity) — not labeled “Session 1”.
- **+ Add another session** switches to multi-session UI with numbered sessions.
- Click a row or calendar chip → edit event; **Delete event** removes it (no status dropdown).
- Session `full` status is computed from capacity/bookings — not set manually in the form.

## Firestore

| Collection | Document ID | Purpose |
|------------|-------------|---------|
| `workshop_events` | UUID | Event metadata (name, venue, maps place, notes) |
| `workshop_sessions` | `{eventType}_{date}_{HHmm}` | Schedule slot + capacity + link to parent event |
| `workshop_bookings` | `{bookingId}` | Participant rows (from future Shopify webhooks) |
| `workshop_config` | `shopify` | Future storefront mapping config |

### `workshop_events`

`eventName`, `venue`, `address`, `placeId`, `lat`, `lng`, `durationHours`, `notes`, `status` (`open` until deleted), `createdAt`, `updatedAt`.

Venue is required on save — pick from Google Maps search (same Places API as Matcha Hop v2).

### `workshop_sessions`

`eventId`, `eventType` (denormalized event name), `date`, `startTime`, `endTime`, `capacity`, `bookedSeats`, `heldSeats`, `status` (`open` \| `full` auto from capacity), `timezone`.

Legacy sessions without `eventId` still appear in the list. Editing them creates a `workshop_events` doc and links the session on save.

### Composite index

If the list query fails with `failed-precondition`, deploy indexes:

```bash
cd workshop-booking
firebase deploy --only firestore:indexes
```

## Shopify storefront widget

A **session picker** for test products: date chips, time slots, participant fields, then add to cart with line properties compatible with [`shopify-orders`](../shopify-orders/).

### 1. Deploy widget assets

```bash
cd workshop-booking
firebase deploy --only hosting
```

Widget URL: `https://matchanese-attendance.web.app/widget/booking-widget.js`

(CORS headers are set so Shopify themes can load these scripts.)

### 2. Create sessions in admin

- Event name must match what you filter on the product (e.g. `Matcha Workshop`)
- Sessions must be **today or future**, status open, with seats left

### 3. Add to Shopify test product

1. Create a test product (e.g. handle `matcha-workshop-booking-test`)
2. Online Store → Themes → Edit code → `sections/main-product.liquid` (or your product section)
3. Paste [`shopify/product-snippet.liquid`](shopify/product-snippet.liquid) **above** the buy button
4. Set `wb_host` and `wb_event_name` at the top of the snippet
5. Update the `product.handle` check if you used a different handle (hides default Add to cart)

### 4. Test checkout

1. Open the test product on your storefront
2. Pick **date** → **time** → enter name/email
3. Click **Add to cart** → complete test checkout
4. Confirm line item properties in the order (Date, Time, `_End Time`, `_Event #`, participant fields)
5. Roster in `shopify-orders` should show the booking (same as Easy Booking orders)

### Local widget preview (no Shopify)

```bash
npx serve workshop-booking -l 5190
```

Open: `http://localhost:5190/widget/demo.html`

### Cart line properties written

| Property | Example |
|----------|---------|
| `Date` | `Sat, Jun 27, 2026` |
| `Time` | `10:00 AM` |
| `_End Time` | `12:30 PM` |
| `_Event #` | `matcha-workshop_2026-06-27_1000` |
| `_Booked With` | `Matcha Workshop` |
| `_Full Name of Participant` | … |
| `_E-mail Address` | … |
| `_Contact Number` | … |

## Shopify (backend — not built yet)

