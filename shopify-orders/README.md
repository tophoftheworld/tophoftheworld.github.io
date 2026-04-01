# Shopify Orders dashboard

Standalone tool (separate from `mobile-orders/`). Table view of Shopify orders with filters, sorting, and optional CSV import.

## Live data (recommended)

1. Install [Node.js](https://nodejs.org/) once.
2. Copy `shopify-orders/.env.example` to `shopify-orders/.env`.
3. Set `SHOPIFY_SHOP` to your store subdomain (e.g. `my-store` for `my-store.myshopify.com`).
4. Set `SHOPIFY_ACCESS_TOKEN` to your custom app **Admin API** access token (scope: `read_orders`; add `read_customers` if you need richer customer fields).
5. Double-click **`Open-Dashboard.cmd`**. Your browser opens `http://localhost:3847` (default port).

Keep `.env` out of git — it is listed in the repo `.gitignore`.

## Import CSV (no server)

Open `index.html` as a file or host files anywhere, choose **Import CSV**, then **Choose CSV**. Use Shopify Admin → Orders → Export. Column names are matched case-insensitively (e.g. Name, Created at, Email, Total, Financial Status, Fulfillment Status).

## Firebase

`js/firebase-setup.js` uses the same Firebase project as the other internal apps (aligned with `sales/js/firebase-setup.js`). The table UI does not require Firebase yet; it is there for future sync or auth.

## Stack

- Static: HTML, CSS, ES modules.
- Local server: `server.mjs` (pure Node, no npm install required) serves files and proxies `/api/orders` to Shopify with your token.

## Troubleshooting

- **502 / error from `/api/missing env`**: create `shopify-orders/.env` from `.env.example`.
- **Pagination**: use **Load more**; cursor requests only send `page_info` + `limit` per Shopify rules.
- **Admin link**: appears when the server exposes `shop` via `/api/config` (live mode). CSV imports may lack numeric order IDs, so the link can be missing.
