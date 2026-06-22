/** Human-readable payment method from Shopify order fields. */

const GATEWAY_LABELS = {
    paypal: "PayPal",
    paypal_express: "PayPal Express",
    manual: "Manual",
    shopify_payments: "Shopify Payments",
    gcash: "GCash",
    g_cash: "GCash",
};

const TX_SUCCESS_STATUS = new Set(["success", "completed"]);
const TX_SUCCESS_KIND = new Set(["sale", "capture"]);

function formatGatewayName(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const key = s.toLowerCase().replace(/\s+/g, "_");
    if (GATEWAY_LABELS[key]) return GATEWAY_LABELS[key];
    if (s !== s.toLowerCase()) return s;
    return s
        .split(/\s+/)
        .map((word) => {
            const w = word.toLowerCase();
            if (GATEWAY_LABELS[w]) return GATEWAY_LABELS[w];
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(" ");
}

function isPaypalLabel(label) {
    return /^paypal(\s|$)/i.test(String(label || "").trim());
}

function gatewaysFromSuccessfulTransactions(txs) {
    const seen = new Set();
    const out = [];
    for (const t of txs || []) {
        const status = String(t.status || "").toLowerCase();
        const kind = String(t.kind || "").toLowerCase();
        if (status === "failure" || status === "error") continue;
        const isSuccess =
            TX_SUCCESS_STATUS.has(status) ||
            (TX_SUCCESS_KIND.has(kind) && status !== "failure");
        if (!isSuccess) continue;
        const label = formatGatewayName(t.gateway);
        if (label && !seen.has(label)) {
            seen.add(label);
            out.push(label);
        }
    }
    return out;
}

/** When Shopify lists multiple gateways (failed attempt + final method). */
function effectiveGatewaysFromNames(names, financialStatus) {
    const labels = [
        ...new Set(names.map(formatGatewayName).filter(Boolean)),
    ];
    if (labels.length <= 1) return labels;

    const fin = String(financialStatus || "").toLowerCase();
    if (fin === "paid" || fin === "partially_paid") {
        const withoutPaypal = labels.filter((g) => !isPaypalLabel(g));
        if (withoutPaypal.length) return withoutPaypal;
        return [labels[labels.length - 1]];
    }

    return [labels[labels.length - 1]];
}

export function effectivePaymentGatewayLabels(order) {
    const fromTx = gatewaysFromSuccessfulTransactions(order?.transactions);
    if (fromTx.length) return fromTx;

    const names = order?.payment_gateway_names;
    if (Array.isArray(names) && names.length) {
        return effectiveGatewaysFromNames(names, order?.financial_status);
    }

    return [];
}

export function paymentMethodFromOrder(order) {
    const labels = effectivePaymentGatewayLabels(order);
    if (labels.length) return labels.join(", ");
    return "";
}

export function paymentMethodDisplay(order) {
    return paymentMethodFromOrder(order) || "—";
}

export function isOrderPaid(financialStatus) {
    return String(financialStatus || "").toLowerCase() === "paid";
}

export function paidIconHtml(financialStatus) {
    const paid = isOrderPaid(financialStatus);
    const iconClass = paid
        ? "payment-cell-icon--paid"
        : "payment-cell-icon--pending";
    const iconChar = paid ? "✓" : "!";
    const statusLabel = paid ? "Paid" : "Unpaid";
    return `<span class="paid-icon payment-cell-icon ${iconClass}" title="${statusLabel}" aria-label="${statusLabel}">${iconChar}</span>`;
}

/** Plain text for order detail footer (below totals). */
export function paymentFooterText(financialStatus, paymentMethod) {
    const method = String(paymentMethod || "").trim();
    if (!method || method === "—") return "";
    if (isOrderPaid(financialStatus)) return `Paid via ${method}`;
    const fin = String(financialStatus || "").toLowerCase();
    if (fin === "partially_paid") return `Partially paid · ${method}`;
    return `Unpaid · ${method}`;
}

/** @param {string} methodText already HTML-escaped */
export function paymentCellHtml(financialStatus, methodText) {
    const method = methodText || "—";
    return `<span class="payment-cell">
        ${paidIconHtml(financialStatus)}
        <span class="payment-cell__method">${method}</span>
    </span>`;
}
