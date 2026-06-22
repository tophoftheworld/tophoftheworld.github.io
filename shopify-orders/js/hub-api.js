/**
 * Chatbase / payment-intakes API (hub origin: /api via matchanese-hub or Firebase).
 * Requires /leads/js/config.js with ADMIN_API_TOKEN.
 */

function getAdminToken() {
  return window.CHATBASE_DASHBOARD_CONFIG?.ADMIN_API_TOKEN || "";
}

export async function fetchPaymentIntakesByOrders(orderIds) {
  const token = getAdminToken();
  const ids = [...new Set((orderIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!token || !ids.length) return {};

  try {
    const res = await fetch("/api/payment-intakes/by-orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token
      },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) return {};
    const body = await res.json().catch(() => ({}));
    return body.data || {};
  } catch {
    return {};
  }
}
