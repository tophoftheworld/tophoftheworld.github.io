/** Shared cancel-order helpers for orders dashboard and workshop roster. */

import { showConfirmDialog } from "./confirm-dialog.js";

export function canCancelOrder(order = {}) {
    if (order.cancelled_at) return false;
    const fin = (order.financial_status || order.financialStatus || "").toLowerCase();
    return fin !== "refunded" && fin !== "partially_refunded";
}

export function canRefundPayment(order = {}) {
    const fin = (order.financial_status || order.financialStatus || "").toLowerCase();
    return fin === "paid" || fin === "partially_paid";
}

export function cancelOrderConfirmMessage(order = {}) {
    const fin = (order.financial_status || order.financialStatus || "").toLowerCase();
    const refundNote = ["paid", "partially_paid"].includes(fin)
        ? " You can issue a refund now or refund payment separately later."
        : "";
    return `This cannot be undone.${refundNote}`;
}

export async function confirmCancelOrder(order = {}) {
    const showRefund = canRefundPayment(order);
    const result = await showConfirmDialog({
        title: cancelOrderButtonLabel(order),
        message: cancelOrderConfirmMessage(order),
        confirmLabel: cancelOrderButtonLabel(order),
        cancelLabel: "Keep",
        danger: true,
        checkbox: showRefund
            ? { label: "Issue refund and cancel payment", checked: true }
            : null,
    });
    if (!result.confirmed) return null;
    return { refund: showRefund ? result.checked : false };
}

export async function confirmRefundPayment() {
    const result = await showConfirmDialog({
        title: "Refund payment",
        message: "This will refund the customer for this order. This cannot be undone.",
        confirmLabel: "Refund payment",
        cancelLabel: "Keep",
        danger: true,
    });
    return result.confirmed;
}

export function cancelOrderButtonLabel(order = {}) {
    const type = order.type || (order.isWorkshop ? "workshop" : "product");
    return type === "workshop" ? "Cancel registration" : "Cancel order";
}

export async function postCancelOrder(orderId, { refund, notifyCustomer = true } = {}) {
    const body = { notifyCustomer };
    if (typeof refund === "boolean") body.refund = refund;
    const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data.error || res.statusText || "Request failed";
        throw new Error(data.hint ? `${msg} ${data.hint}` : msg);
    }
    return data;
}

export async function postRefundOrder(orderId, { notifyCustomer = true } = {}) {
    const res = await fetch(`/api/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyCustomer }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data.error || res.statusText || "Request failed";
        throw new Error(data.hint ? `${msg} ${data.hint}` : msg);
    }
    return data;
}
