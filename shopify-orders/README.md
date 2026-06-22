# Shopify Orders dashboard

Standalone tool (separate from `mobile-orders/`). Table view of Shopify orders with filters, sorting, payment/fulfillment actions, and cursor pagination.

## Live data

1. Install [Node.js](https://nodejs.org/) once.
2. Copy `shopify-orders/.env.example` to `shopify-orders/.env`.
3. Set `SHOPIFY_SHOP` to your store subdomain (e.g. `9576df-4` for `9576df-4.myshopify.com`).
4. Set credentials:
   - **Admin API access token** (`SHOPIFY_ACCESS_TOKEN`), or
   - **Client ID + secret** (`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`) for automatic token exchange.
5. In Shopify Admin → your custom app → configure scopes and **install** on the store:
   - `read_orders`, `read_customers`, `read_products`
   - `write_orders`, `write_fulfillments`, `write_merchant_managed_fulfillment_orders` (store pickup)
6. Double-click **`Open-Dashboard.cmd`**. Browser opens `http://localhost:3847` (default port).

Keep `.env` out of git — it is listed in the repo `.gitignore`.

## Features

- **Payment actions** (per row **Actions** menu): Mark as paid; void authorization when status is authorized (matches Shopify Admin — paid/refunded orders cannot be marked unpaid from here).
- **Fulfillment actions** (match Shopify Admin): **Store pickup** → “Mark as ready for pickup”, then “Mark as picked up”; **Shipping** → “Mark as shipped”; **No shipping** → “Mark as fulfilled”. Pickup is detected from fulfillment orders (including merchant-managed pickup at a location when Shopify reports `method_type: none` and no ship-to address).
- **Pagination**: Previous / Next using Shopify cursor links (50 orders per page).
- **Type**: **Workshop** = any line item with Shopify `product_type` **Matcha Workshop**; **Product** = everything else. Use header tabs (All / Workshops / Products).
- **Split view**: Click a row to open order details on the right (line items, customer, payment, actions). Close with × or Escape.
- **Filters** (current page only): search, payment, fulfillment, product line title, product type, tags.
- **Date column**: Shopify-style relative dates (Today at …, Yesterday at …).

## Firebase

`js/firebase-setup.js` uses the same Firebase project as other internal apps. The table UI does not require Firebase yet.

## Stack

- Static: HTML, CSS, ES modules.
- Local server: `server.mjs` (pure Node, no npm install) serves files and proxies Shopify Admin REST + GraphQL (`GET /api/orders`, `GET /api/orders/:id`).

## Troubleshooting

- **502 / missing env**: create `shopify-orders/.env` from `.env.example`.
- **403 on actions**: add `write_orders`, `write_fulfillments`, and `write_merchant_managed_fulfillment_orders`, release app version, reinstall on store.
- **Pagination**: only `page_info` + `limit` are sent on cursor pages (Shopify requirement).
- **Product/type/tag filters**: apply to the **loaded page** (50 rows), not the entire order history.
- **Logo**: stored at `shopify-orders/img/matchanese-logo.png` (served locally).
