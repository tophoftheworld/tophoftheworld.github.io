/** Hosts where /api/orders is served (local hub dev server or Firebase). */
export function hasOrdersApi() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")) return true;
  if (host === "admin.matchanese.com" || host.endsWith(".matchanese.com")) return true;
  return false;
}
