/**
 * Copy this file to config.js and update values.
 *
 * API_BASE_URL options:
 * - "" or "SAME_ORIGIN" — use `/api` on this host when it is proxied (Firebase hosting :5000, hub dev :8788).
 *   On python static server (:8080) the client falls back to production hosting (requires CORS on deployed `api`).
 * - Full URL of the deployed `api` function, e.g. https://us-central1-PROJECT.cloudfunctions.net/api
 */
window.CHATBASE_DASHBOARD_CONFIG = {
  API_BASE_URL: "",
  ADMIN_API_TOKEN: "replace-with-strong-token"
};
