import { hasOrdersApi } from "./orders-api-host.js";
import {
    buildFulfillmentContext,
    deliveryMethodDisplayText,
    inferDeliveryFromOrder,
} from "./fulfillment-context.js";
import {
    paidIconHtml,
    paymentCellHtml,
    paymentFooterText,
    paymentMethodDisplay,
} from "./payment-method.js";
import {
    collectOrderRegistrationsForOrder,
    lineItemPropertiesFromShopify,
    parseRegistrationFromLineItem,
    workshopManagementUrl,
} from "./registration.js";
import { isMobileViewport, onViewportChange } from "./viewport.js";
import { fetchPaymentIntakesByOrders } from "./hub-api.js";
import {
    canCancelOrder,
    canRefundPayment,
    cancelOrderButtonLabel,
    confirmCancelOrder,
    confirmRefundPayment,
    postCancelOrder,
    postRefundOrder,
} from "./order-cancel.js";

const WORKSHOP_PRODUCT_TYPE = "Matcha Workshop";
const REFRESH_STALE_MS = 60_000;

const els = {
    status: document.getElementById("statusBar"),
    workspace: document.getElementById("workspace"),
    listPane: document.getElementById("listPane"),
    detailPane: document.getElementById("detailPane"),
    detailPaneHeader: document.getElementById("detailPaneHeader"),
    detailPaneBody: document.getElementById("detailPaneBody"),
    tbody: document.querySelector("#ordersTable tbody"),
    ordersCardList: document.getElementById("ordersCardList"),
    detailModalBackdrop: document.getElementById("detailModalBackdrop"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    pageIndicator: document.getElementById("pageIndicator"),
    syncIndicator: document.getElementById("ordersSyncIndicator"),
    search: document.getElementById("searchInput"),
    finStatus: document.getElementById("filterFinancial"),
    fulStatus: document.getElementById("filterFulfillment"),
    filterProduct: document.getElementById("filterProduct"),
    filterProductType: document.getElementById("filterProductType"),
    filterTag: document.getElementById("filterTag"),
    typeSelector: document.getElementById("typeSelector"),
};

const state = {
    rows: [],
    productMap: {},
    typeFilter: "",
    nextPageInfo: null,
    previousPageInfo: null,
    pageCursor: null,
    pageNumber: 1,
    shopHandle: null,
    sortKey: "created_at",
    sortDir: "desc",
    loading: false,
    selectedOrderId: null,
    detailLoading: false,
    detailOrder: null,
    botPayments: {},
};

let ordersFetchInProgress = false;
let ordersFetchComplete = false;
let lastOrdersFetchAt = 0;

function isLiveHost() {
    return hasOrdersApi();
}

function setStatus(msg, isError = false) {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", Boolean(isError));
}

function displayFinancialStatus(raw) {
    const s = (raw || "").toLowerCase();
    const map = {
        pending: "Unpaid",
        paid: "Paid",
        refunded: "Refunded",
        partially_refunded: "Partially refunded",
        authorized: "Authorized",
        partially_paid: "Partially paid",
        voided: "Voided",
    };
    return map[s] || (raw ? String(raw).replace(/_/g, " ") : "Unpaid");
}

function isWorkshopProductType(productType) {
    return (
        (productType || "").trim().toLowerCase() ===
        WORKSHOP_PRODUCT_TYPE.toLowerCase()
    );
}

function orderTypeFromLineItems(lineItems, productMap) {
    const hasWorkshop = lineItems.some((li) => {
        const pt = li.product_type || productMap[li.product_id]?.product_type;
        return isWorkshopProductType(pt);
    });
    return hasWorkshop ? "workshop" : "product";
}

function typeLabel(type) {
    return type === "workshop" ? "Workshop" : "Order";
}

function displayFulfillmentFromOrder(o) {
    const fulfillments = o.fulfillments || [];
    for (const f of fulfillments) {
        const ss = (f.shipment_status || "").toLowerCase();
        if (ss === "ready_for_pickup") return "Ready for pickup";
        if (ss === "in_transit" || ss === "out_for_delivery") return "Shipped";
        if (ss === "picked_up") return "Picked up";
        if (ss === "delivered") return "Fulfilled";
    }
    const fs = (o.fulfillment_status || "").toLowerCase();
    if (!fs || fs === "null") return "Unfulfilled";
    if (fs === "fulfilled") return "Fulfilled";
    if (fs === "partial") return "Partially fulfilled";
    if (fs === "restocked") return "Restocked";
    return fs.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function registrationField(label, value) {
    if (!value) return "";
    let valueHtml = escapeHtml(value);
    if (label === "Email") {
        valueHtml = `<a href="mailto:${escapeHtml(value)}">${escapeHtml(value)}</a>`;
    } else if (label === "Contact") {
        const tel = value.replace(/[^\d+]/g, "");
        if (tel) {
            valueHtml = `<a href="tel:${escapeHtml(tel)}">${escapeHtml(value)}</a>`;
        }
    }
    return `<div class="registration-field">
        <span class="registration-label">${escapeHtml(label)}</span>
        <span class="registration-value">${valueHtml}</span>
    </div>`;
}

function renderRegistrationBlock(reg, index, total) {
    const indexNote =
        total > 1
            ? `<p class="registration-index">Registration ${index + 1} of ${total}</p>`
            : "";
    const qtyNote =
        reg.quantity > 1
            ? `<p class="registration-qty-note">${escapeHtml(String(reg.quantity))} seats on this line item</p>`
            : "";
    const sessionLine = [reg.date, reg.time].filter(Boolean).join(" · ");
    let sessionHtml = "";
    if (sessionLine) {
        sessionHtml = `<p class="registration-session">${escapeHtml(sessionLine)}</p>`;
    } else if (reg.noBooking) {
        sessionHtml =
            '<p class="registration-session registration-session--tbd">No upcoming session found — assign manually</p>';
    }
    const noBookingNote = reg.noBooking
        ? `<p class="registration-no-booking"><span class="registration-badge registration-badge--warning">No booking</span> Paid without Easy Booking${reg.inferred && sessionLine ? " — session below inferred from order date" : ""}. Confirm or assign manually on the platform.</p>`
        : "";
    const workshopName =
        reg.workshopDisplay || reg.workshop || "Workshop";

    return `<article class="registration-block">${indexNote}
        <div class="registration-head">
            <p class="registration-workshop">${escapeHtml(workshopName)}</p>
            ${noBookingNote}
            ${sessionHtml}
        </div>
        <div class="registration-details">
            ${registrationField("Participant", reg.participant)}
            ${registrationField("Contact", reg.contact)}
            ${registrationField("Email", reg.email)}
        </div>
        ${qtyNote}</article>`;
}

function renderRegistrationSection(r) {
    const registrations = collectOrderRegistrationsForOrder(
        r.lineItems,
        r.inferred_registrations
    );
    if (!registrations.length) return "";

    const cards = registrations
        .map((reg, i) => {
            const rosterHref = workshopManagementUrl(reg, r.id);
            const linkAttrs = rosterHref
                ? ` class="detail-card detail-card--registration detail-card--registration-link" data-roster-href="${escapeHtml(rosterHref)}" tabindex="0" role="link" aria-label="Open workshop management for this session"`
                : ` class="detail-card detail-card--registration"`;
            const inner = renderRegistrationBlock(
                reg,
                i,
                registrations.length
            );
            return `<section${linkAttrs}>${inner}</section>`;
        })
        .join("");
    return cards;
}

function buildLineItems(o, productMap) {
    return (o.line_items || []).map((li) => {
        const p = productMap[li.product_id];
        return {
            id: li.id,
            product_id: li.product_id,
            title: li.title || li.name || "",
            sku: li.sku || "",
            quantity: li.quantity,
            price: li.price,
            product_type: p?.product_type || "",
            variant_title: li.variant_title || "",
            image_url: p?.image_url || null,
            properties: lineItemPropertiesFromShopify(li.properties),
        };
    });
}

function normalizeApiOrder(o, productMap = {}) {
    const c = o.customer;
    const custName = c
        ? [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
        : "";
    const lineItems = buildLineItems(o, productMap);
    const productTypes = new Set();
    const productTags = new Set();
    for (const li of lineItems) {
        if (li.product_type) productTypes.add(li.product_type);
        const p = productMap[li.product_id];
        if (p?.tags) {
            p.tags.split(",").forEach((t) => {
                const tag = t.trim();
                if (tag) productTags.add(tag);
            });
        }
    }
    const orderTags = (o.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    const allTags = [...new Set([...orderTags, ...productTags])];
    const itemCount = lineItems.reduce((n, li) => n + (li.quantity || 0), 0);
    const displayFulfillment = displayFulfillmentFromOrder(o);
    const type = orderTypeFromLineItems(lineItems, productMap);
    const delivery = inferDeliveryFromOrder(o);
    let deliveryMethod = delivery.deliveryMethod;
    let deliveryLabel = delivery.deliveryLabel;
    let deliveryMethodDisplay = deliveryMethodDisplayText(
        deliveryMethod,
        deliveryLabel
    );
    if (type === "workshop") {
        deliveryMethod = "none";
        deliveryLabel = "Shipping not required";
        deliveryMethodDisplay = "Shipping not required";
    }

    return {
        id: o.id,
        name: o.name || "",
        type,
        type_label: typeLabel(type),
        deliveryMethod,
        deliveryLabel,
        deliveryMethodDisplay,
        created_at: o.created_at || "",
        customer: custName || o.email || "—",
        email: o.email || "",
        total: o.current_total_price ?? o.total_price ?? "",
        currency: o.currency || "",
        financial_status: o.financial_status || "pending",
        cancelled_at: o.cancelled_at || null,
        financial_label: displayFinancialStatus(o.financial_status),
        payment_method: paymentMethodDisplay(o),
        fulfillment_status: o.fulfillment_status || null,
        displayFulfillment,
        lineItems,
        productTypes: [...productTypes],
        tags: allTags,
        item_count: itemCount,
        fulfillable:
            (o.line_items || []).some((li) => li.fulfillable_quantity > 0) &&
            displayFulfillment !== "Fulfilled",
    };
}

function resolveOrderPricing(o, lineItems) {
    const currency = (o.currency || "PHP").trim() || "PHP";
    let subtotal = o.current_subtotal_price ?? o.subtotal_price;
    if (subtotal === "" || subtotal == null) {
        const sum = lineItems.reduce(
            (n, li) => n + Number(li.price || 0) * (li.quantity || 1),
            0
        );
        subtotal = sum > 0 ? String(sum) : "";
    }
    let total = o.current_total_price ?? o.total_price;
    if (total === "" || total == null) total = subtotal;
    let shipping = 0;
    for (const sl of o.shipping_lines || []) {
        shipping += Number(sl.discounted_price ?? sl.price) || 0;
    }
    if (!shipping && o.total_shipping_price_set?.shop_money?.amount) {
        shipping = Number(o.total_shipping_price_set.shop_money.amount) || 0;
    }
    return { currency, subtotal, total, shipping };
}

async function loadFulfillmentContextForOrder(
    orderId,
    order,
    fromApi,
    options = {}
) {
    if (options.isWorkshop) {
        return buildFulfillmentContext(order, [], { isWorkshop: true });
    }
    if (fromApi) return fromApi;
    try {
        const res = await fetch(`/api/orders/${orderId}/fulfillment_orders`);
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            return buildFulfillmentContext(
                order,
                data.fulfillment_orders || [],
                options
            );
        }
    } catch (_) {
        /* fallback below */
    }
    return buildFulfillmentContext(order, [], options);
}

function normalizeDetailOrder(o, productMap = {}, fulfillmentContext = null) {
    const base = normalizeApiOrder(o, productMap);
    const pricing = resolveOrderPricing(o, base.lineItems);
    const phone =
        o.phone ||
        o.billing_address?.phone ||
        o.shipping_address?.phone ||
        o.customer?.phone ||
        "";
    let ctx = fulfillmentContext || {};
    let delivery = ctx.deliveryMethod
        ? { method: ctx.deliveryMethod, label: ctx.deliveryLabel || "—" }
        : inferDeliveryMethod(o);

    if (base.type === "workshop") {
        delivery = { method: "none", label: "Shipping not required" };
        ctx = {
            ...ctx,
            deliveryMethod: "none",
            deliveryLabel: "Shipping not required",
            deliveryMethodDisplay: "Shipping not required",
            canMarkReadyForPickup: false,
            canMarkPickedUp: false,
        };
    }

    const displayFulfillment =
        ctx.displayFulfillment || displayFulfillmentFromOrder(o);
    const fulfillable =
        delivery.method === "pickup"
            ? Boolean(ctx.canMarkReadyForPickup || ctx.canMarkPickedUp)
            : base.fulfillable;
    return {
        ...base,
        displayFulfillment,
        fulfillable,
        note: o.note || "",
        phone,
        source_name: formatSourceName(o.source_name),
        billing_address: o.billing_address,
        shipping_address: o.shipping_address,
        subtotal: pricing.subtotal,
        total: pricing.total,
        currency: pricing.currency,
        shipping: pricing.shipping,
        order_tags: (o.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        fulfillment_note: fulfillmentLocationHint(o),
        deliveryMethod: delivery.method,
        deliveryLabel: delivery.label,
        deliveryMethodDisplay:
            ctx.deliveryMethodDisplay ||
            deliveryMethodDisplayText(delivery.method, delivery.label),
        pickupStage: ctx.pickupStage || null,
        canMarkReadyForPickup: Boolean(ctx.canMarkReadyForPickup),
        canMarkPickedUp: Boolean(ctx.canMarkPickedUp),
    };
}

function fulfillmentLocationHint(o) {
    const fs = displayFulfillmentFromOrder(o);
    if (fs === "Unfulfilled") return "Unfulfilled";
    return fs;
}

function inferDeliveryMethod(o) {
    const r = inferDeliveryFromOrder(o);
    return { method: r.deliveryMethod, label: r.deliveryLabel };
}

function renderDeliveryDescription(r) {
    if (r.type === "workshop") {
        return r.deliveryMethodDisplay || "Shipping not required";
    }
    if (r.deliveryMethod === "pickup") {
        const loc = (r.deliveryLabel || "").trim();
        return loc ? `Pickup in store at ${loc}` : "Pickup in store";
    }
    if (r.deliveryMethod === "shipping") {
        return r.deliveryLabel || "Shipping";
    }
    if (r.deliveryMethod === "none") {
        return "Shipping not required";
    }
    return r.deliveryMethodDisplay || r.deliveryLabel || "—";
}

function renderDetailStatusPills(r) {
    const pills = [];
    if (r.cancelled_at) {
        pills.push(
            `<span class="status-pill status-pill--cancelled">Cancelled</span>`
        );
    }
    const payPillClass = r.cancelled_at
        ? `${paymentStatusClass(r.financial_status)} status-pill--struck`
        : paymentStatusClass(r.financial_status);
    pills.push(
        `<span class="status-pill ${payPillClass}">${escapeHtml(r.financial_label)}</span>`
    );

    if (r.type === "workshop") {
        pills.push(
            `<span class="type-pill ${typePillClass("workshop")}">${escapeHtml(r.type_label)}</span>`
        );
    } else {
        const fs = r.displayFulfillment;
        if (fs) {
            pills.push(
                `<span class="status-pill ${fulfillmentStatusClass(fs)}">${escapeHtml(fs)}</span>`
            );
        }
        if (r.deliveryMethod === "pickup") {
            pills.push(
                `<span class="context-pill context-pill--pickup">Pickup in store</span>`
            );
        } else if (r.deliveryMethod === "shipping") {
            const label = (r.deliveryLabel || "Shipping").trim();
            pills.push(
                `<span class="context-pill context-pill--shipping">${escapeHtml(label)}</span>`
            );
        }
        pills.push(
            `<span class="type-pill ${typePillClass("product")}">${escapeHtml(r.type_label)}</span>`
        );
    }

    return pills.join("");
}

function chatPaymentProofSuffix(orderId) {
    const intake = state.botPayments[String(orderId)];
    if (!intake?.automated) return "";
    const paymentsUrl = `/leads/?tab=payments&id=${encodeURIComponent(intake.id)}`;
    return ` · Confirmed from chat · <a class="detail-payment-proof-link" href="${escapeHtml(paymentsUrl)}">View payment</a>`;
}

async function refreshBotPaymentMap(orderIds) {
    const map = await fetchPaymentIntakesByOrders(orderIds);
    state.botPayments = { ...state.botPayments, ...map };
}

function renderDetailHeader(r) {
    const adminUrl = adminOrderUrl(r.id);
    const shopifyBtn = adminUrl
        ? `<a class="detail-shopify-btn" href="${adminUrl}" target="_blank" rel="noopener">Open in Shopify</a>`
        : "";

    const dateLine = escapeHtml(formatLongDate(r.created_at));
    const metaRow =
        dateLine || shopifyBtn
            ? `<div class="detail-header-row detail-header-row--meta">
                ${dateLine ? `<span class="detail-header-date">${dateLine}</span>` : "<span></span>"}
                ${shopifyBtn}
            </div>`
            : "";

    return `
        <div class="detail-header-body">
            <div class="detail-header-row detail-header-row--top">
                <div class="detail-header-identity">
                    <h2 class="detail-order-title">${escapeHtml(r.name)}</h2>
                    <p class="detail-order-customer">${escapeHtml(r.customer)}</p>
                </div>
                <button type="button" class="detail-close-btn" id="btnDetailClose" aria-label="Close order details">×</button>
            </div>
            ${metaRow}
            <div class="detail-header-tags" aria-label="Order status">${renderDetailStatusPills(r)}</div>
        </div>`;
}

function lineItemsSubtotal(r) {
    const sum = (r.lineItems || []).reduce(
        (n, li) => n + Number(li.price || 0) * (li.quantity || 1),
        0
    );
    return sum > 0 ? sum : null;
}

function freightAmount(r) {
    return Number(r.shipping) || 0;
}

function renderOrderTotalsFooter(r) {
    const subtotalRaw = r.subtotal ?? lineItemsSubtotal(r);
    const totalRaw = r.total ?? subtotalRaw;
    const totalMoney = formatMoney(totalRaw, r.currency);
    const fin = (r.financial_status || "").toLowerCase();
    const isPaid = fin === "paid";
    const freight = freightAmount(r);

    const line = (label, amount, { strong = false, extraClass = "" } = {}) =>
        `<div class="detail-order-total-row ${extraClass}">
            <span class="detail-order-total-label">${escapeHtml(label)}</span>
            <span class="detail-order-total-value${strong ? " detail-order-total-value--strong" : ""}">${escapeHtml(amount)}</span>
        </div>`;

    let html = "";
    if (freight > 0) {
        const freightLabel =
            r.deliveryMethod === "pickup" ? "Pickup" : "Shipping";
        html += line("Subtotal", formatMoney(subtotalRaw, r.currency));
        html += line(freightLabel, formatMoney(freight, r.currency));
    }

    html += line("Total", totalMoney, {
        strong: true,
        extraClass: "detail-order-total-row--main",
    });

    if (!isPaid) {
        const dueLabel =
            fin === "partially_paid" ? "Paid so far" : "Amount due";
        html += line(dueLabel, totalMoney, {
            extraClass: "detail-order-total-row--due",
        });
    }

    return `<div class="detail-order-totals">${html}</div>`;
}

function renderOrderPaymentStatus(r) {
    const paymentLine = paymentFooterText(
        r.financial_status,
        r.payment_method
    );
    const proofSuffix = chatPaymentProofSuffix(r.id);
    if (!paymentLine && !proofSuffix) return "";
    const text = paymentLine
        ? `${escapeHtml(paymentLine)}${proofSuffix}`
        : proofSuffix.replace(/^ · /, "");
    return `<div class="detail-order-payment">
        ${paidIconHtml(r.financial_status)}
        <span class="detail-order-payment-text">${text}</span>
    </div>`;
}

function renderOrderFooterBar(r) {
    const actions = buildDetailActionButtons(r);
    const payment = renderOrderPaymentStatus(r);
    if (!actions && !payment) return "";
    return `<div class="detail-order-footer">
        <div class="detail-order-footer__left">${actions}</div>
        <div class="detail-order-footer__right">${payment}</div>
    </div>`;
}

function formatSourceName(source) {
    if (!source) return "Online Store";
    const s = String(source).toLowerCase();
    if (s === "web") return "Online Store";
    return source.replace(/_/g, " ");
}

function formatAddress(addr) {
    if (!addr) return null;
    const lines = [
        [addr.first_name, addr.last_name].filter(Boolean).join(" "),
        addr.company,
        addr.address1,
        addr.address2,
        [addr.city, addr.province, addr.zip].filter(Boolean).join(", "),
        addr.country,
        addr.phone,
    ].filter((x) => x && String(x).trim());
    return lines.length ? lines.join("\n") : null;
}

function adminOrderUrl(orderId) {
    if (!state.shopHandle || !orderId) return null;
    return `https://admin.shopify.com/store/${state.shopHandle}/orders/${orderId}`;
}

function formatMoney(total, currency) {
    if (total === "" || total == null) return "—";
    const n = typeof total === "number" ? total : Number(total);
    if (Number.isNaN(n)) return String(total);
    return `₱${n.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function formatShopifyDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;

    const now = new Date();
    const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
    );
    const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayDiff = Math.round(
        (startOfToday - startOfThat) / (24 * 60 * 60 * 1000)
    );

    let dayPart;
    if (dayDiff === 0) dayPart = "Today";
    else if (dayDiff === 1) dayPart = "Yesterday";
    else {
        dayPart = d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
        });
    }

    const timePart = d
        .toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase()
        .replace(/\s/g, " ");

    return `${dayPart} at ${timePart}`;
}

function formatLongDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function paymentStatusClass(financialStatus) {
    const s = (financialStatus || "pending").toLowerCase().replace(/\s+/g, "_");
    return `status-pill--payment-${s}`;
}

function fulfillmentStatusClass(label) {
    const raw = (label || "unfulfilled").toLowerCase();
    if (raw.includes("ready") && raw.includes("pickup")) {
        return "status-pill--fulfillment-ready_for_pickup";
    }
    if (raw.includes("partial")) return "status-pill--fulfillment-partial";
    if (raw.includes("picked up")) {
        return "status-pill--fulfillment-fulfilled";
    }
    if (raw.includes("fulfilled") && !raw.includes("un")) {
        return "status-pill--fulfillment-fulfilled";
    }
    if (raw.includes("shipped") || raw.includes("transit")) {
        return "status-pill--fulfillment-shipped";
    }
    const key = raw.replace(/\s+/g, "_");
    return `status-pill--fulfillment-${key}`;
}

function typePillClass(type) {
    return type === "workshop" ? "type-pill--workshop" : "type-pill--product";
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function getFilteredRows() {
    const q = (els.search.value || "").trim().toLowerCase();
    const fin = els.finStatus.value;
    const ful = els.fulStatus.value;
    const product = els.filterProduct.value;
    const ptype = els.filterProductType.value;
    const tag = els.filterTag.value;
    const typeF = state.typeFilter;

    return state.rows.filter((r) => {
        if (typeF && r.type !== typeF) return false;
        if (fin && r.financial_status !== fin) return false;
        if (ful && r.displayFulfillment !== ful) return false;
        if (product) {
            const hit = r.lineItems.some(
                (li) =>
                    li.title === product ||
                    (li.sku && li.sku === product)
            );
            if (!hit) return false;
        }
        if (ptype && !r.productTypes.includes(ptype)) return false;
        if (tag && !r.tags.includes(tag)) return false;
        if (!q) return true;
        const blob = [
            r.name,
            r.customer,
            r.email,
            r.financial_label,
            r.payment_method,
            r.displayFulfillment,
            r.type_label,
            ...r.lineItems.map((li) => `${li.title} ${li.sku} ${li.product_type}`),
            ...r.tags,
            ...r.productTypes,
        ]
            .join(" ")
            .toLowerCase();
        return blob.includes(q);
    });
}

function sortHeaderArrow(dir) {
    return dir === "asc" ? "▴" : "▾";
}

function updateSortHeaderIndicators() {
    document.querySelectorAll("#ordersTable th[data-sort]").forEach((th) => {
        const key = th.getAttribute("data-sort");
        const label =
            th.dataset.sortLabel ||
            th.textContent.replace(/\s*(?:↑|↓|▲|▼|▴|▾)\s*$/u, "").trim();
        th.dataset.sortLabel = label;
        if (key === state.sortKey) {
            th.textContent = `${label} ${sortHeaderArrow(state.sortDir)}`;
            th.setAttribute(
                "aria-sort",
                state.sortDir === "asc" ? "ascending" : "descending"
            );
            th.classList.add("th--sorted");
        } else {
            th.textContent = label;
            th.removeAttribute("aria-sort");
            th.classList.remove("th--sorted");
        }
    });
}

function sortRowsInPlace(list) {
    const k = state.sortKey;
    const dir = state.sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
        let va = a[k];
        let vb = b[k];
        if (k === "created_at") {
            va = new Date(va).getTime() || 0;
            vb = new Date(vb).getTime() || 0;
        } else if (k === "total" || k === "item_count") {
            va = Number(va) || 0;
            vb = Number(vb) || 0;
        } else {
            va = String(va || "").toLowerCase();
            vb = String(vb || "").toLowerCase();
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });
}

function paymentActions(r) {
    if (r.cancelled_at) return [];
    const fin = (r.financial_status || "").toLowerCase();
    const items = [];
    if (["pending", "partially_paid", "authorized", "voided"].includes(fin)) {
        items.push({ id: "mark-paid", label: "Mark as paid", primary: true });
    }
    if (fin === "authorized") {
        items.push({ id: "void", label: "Void authorization" });
    }
    return items;
}

function renderPaymentCancelActions(r) {
    const parts = [];
    if (canCancelOrder(r)) {
        parts.push(
            `<button type="button" class="detail-cancel-link" data-detail-action="cancel" data-order-id="${r.id}">${escapeHtml(cancelOrderButtonLabel(r))}</button>`
        );
    }
    if (canRefundPayment(r)) {
        parts.push(
            `<button type="button" class="detail-cancel-link detail-cancel-link--refund" data-detail-action="refund" data-order-id="${r.id}">Refund payment</button>`
        );
    }
    if (!parts.length) return "";
    return `<div class="detail-cancel-row">${parts.join("")}</div>`;
}

function fulfillmentActions(r) {
    if (r.cancelled_at) return [];
    if (r.type === "workshop") return [];
    if (r.deliveryMethod === "pickup") {
        const ready =
            r.canMarkPickedUp ||
            r.pickupStage === "ready_for_pickup" ||
            r.displayFulfillment === "Ready for pickup";
        if (ready) {
            return [
                {
                    id: "picked_up",
                    label: "Mark as picked up",
                    primary: true,
                },
            ];
        }
        if (r.canMarkReadyForPickup) {
            return [
                {
                    id: "ready_for_pickup",
                    label: "Mark as ready for pickup",
                    primary: true,
                },
            ];
        }
        return [];
    }
    if (!r.fulfillable) return [];
    if (r.deliveryMethod === "shipping") {
        return [{ id: "shipped", label: "Mark as shipped", primary: true }];
    }
    return [{ id: "fulfilled", label: "Mark as fulfilled", primary: true }];
}

function renderOrderCard(r) {
    const tClass = typePillClass(r.type);
    const itemsLabel = r.item_count === 1 ? "1 item" : `${r.item_count} items`;
    const selected =
        String(r.id) === String(state.selectedOrderId)
            ? " entity-card--selected"
            : "";
    const deliveryText = renderDeliveryDescription(r);
    const deliveryFooter =
        r.type === "workshop"
            ? ""
            : `<div class="entity-card__foot order-card__foot">
            <span class="entity-card__label">Delivery</span>
            <span class="order-card__delivery">${escapeHtml(deliveryText)}</span>
        </div>`;

    const cancelledClass = r.cancelled_at ? " order-card--cancelled" : "";
    return `<article class="entity-card order-card${r.type === "workshop" ? " order-card--workshop" : ""}${cancelledClass}${selected}" data-order-id="${r.id}" tabindex="0" role="button" aria-label="Open order ${escapeHtml(r.name)}">
        <div class="entity-card__head order-card__head">
            <span class="entity-card__title order-card__order-num">${escapeHtml(r.name)}</span>
            <span class="type-pill ${tClass}">${escapeHtml(r.type_label)}</span>
        </div>
        <div class="order-card__body">
            <div class="order-card__left">
                <p class="entity-card__primary">${escapeHtml(r.customer)}</p>
                <p class="entity-card__sub">${escapeHtml(formatShopifyDate(r.created_at))}</p>
                <p class="entity-card__sub entity-card__items">${escapeHtml(itemsLabel)}</p>
            </div>
            <div class="order-card__right">
                <div class="entity-card__amount">${escapeHtml(formatMoney(r.total, r.currency))}</div>
                <div class="entity-card__payment">
                    ${paymentCellHtml(r.financial_status, escapeHtml(r.payment_method))}
                </div>
            </div>
        </div>
        ${deliveryFooter}
    </article>`;
}

function renderOrdersTableRows(list) {
    els.tbody.innerHTML = list
        .map((r) => {
            const fulClass = fulfillmentStatusClass(r.displayFulfillment);
            const tClass = typePillClass(r.type);
            const itemsLabel =
                r.item_count === 1 ? "1 item" : `${r.item_count} items`;
            const selected =
                String(r.id) === String(state.selectedOrderId)
                    ? " orders-row--selected"
                    : "";
            const cancelledClass = r.cancelled_at ? " orders-row--cancelled" : "";
            return `<tr class="orders-row${selected}${cancelledClass}" data-order-id="${r.id}" tabindex="0">
                <td class="col-order">${escapeHtml(r.name)}</td>
                <td class="col-type"><span class="type-pill ${tClass}">${escapeHtml(r.type_label)}</span></td>
                <td class="col-date">${escapeHtml(formatShopifyDate(r.created_at))}</td>
                <td class="col-customer">${escapeHtml(r.customer)}</td>
                <td class="col-items">${escapeHtml(itemsLabel)}</td>
                <td class="col-total num">${escapeHtml(formatMoney(r.total, r.currency))}</td>
                <td class="col-paid">${paidIconHtml(r.financial_status)}</td>
                <td class="col-payment">${escapeHtml(r.payment_method)}</td>
                <td class="col-fulfillment"><span class="status-pill ${fulClass}">${escapeHtml(r.displayFulfillment)}</span></td>
            </tr>`;
        })
        .join("");
}

function renderTable() {
    const list = getFilteredRows();
    sortRowsInPlace(list);
    updateSortHeaderIndicators();
    renderOrdersTableRows(list);
    if (els.ordersCardList) {
        els.ordersCardList.innerHTML = list.length
            ? list.map(renderOrderCard).join("")
            : '<p class="entity-card-empty muted">No orders match your filters.</p>';
    }
    updatePaginationUi();
}

function updatePaginationUi() {
    els.btnPrev.disabled = state.loading || !state.previousPageInfo;
    els.btnNext.disabled = state.loading || !state.nextPageInfo;
    const count = state.rows.length;
    let label = `Page ${state.pageNumber}`;
    if (count) label += ` · ${count} orders`;
    els.pageIndicator.textContent = label;
}

function setDetailLoading(loading) {
    const overlay = document.getElementById("detailLoadingOverlay");
    if (overlay) {
        overlay.classList.toggle("hidden", !loading);
        overlay.setAttribute("aria-hidden", loading ? "false" : "true");
    }
    els.detailPaneHeader.classList.toggle("hidden", loading);
    if (loading) {
        els.detailPaneHeader.innerHTML = "";
        els.detailPaneBody.innerHTML = "";
    }
}

function setDetailModalOpen(open) {
    const mobile = isMobileViewport();
    document.body.classList.toggle("split-active", open && !mobile);
    document.body.classList.toggle("detail-modal-open", open && mobile);
    if (els.detailModalBackdrop) {
        els.detailModalBackdrop.classList.toggle("hidden", !open || !mobile);
        els.detailModalBackdrop.setAttribute(
            "aria-hidden",
            open && mobile ? "false" : "true"
        );
    }
}

function setSplitMode(open) {
    setDetailModalOpen(open);
    if (open) {
        if (!isMobileViewport()) {
            els.workspace.classList.add("workspace--split");
        } else {
            els.workspace.classList.remove("workspace--split");
        }
        els.detailPane.classList.remove("hidden");
    } else {
        els.workspace.classList.remove("workspace--split");
        els.detailPane.classList.add("hidden");
    }
}

function closeOrderDetail() {
    state.selectedOrderId = null;
    state.detailOrder = null;
    setDetailLoading(false);
    els.detailPaneHeader.classList.add("hidden");
    els.detailPaneHeader.innerHTML = "";
    els.detailPaneBody.innerHTML =
        '<p class="detail-placeholder">Select an order to view details.</p>';
    setSplitMode(false);
    renderTable();
}

function isOrdersFetchStale() {
    return !lastOrdersFetchAt || Date.now() - lastOrdersFetchAt > REFRESH_STALE_MS;
}

function setOrdersSyncing(active) {
    if (els.syncIndicator) {
        els.syncIndicator.hidden = !active;
        els.syncIndicator.setAttribute("aria-hidden", active ? "false" : "true");
        els.syncIndicator.classList.toggle(
            "orders-sync-indicator--active",
            Boolean(active)
        );
    }
    els.listPane?.classList.toggle("list-pane--syncing", Boolean(active));
}

async function openOrderDetail(orderId, { background = false } = {}) {
    if (!isLiveHost()) return;
    state.selectedOrderId = orderId;
    setSplitMode(true);
    renderTable();
    const listRow = els.tbody?.querySelector(
        `tr[data-order-id="${CSS.escape(String(orderId))}"]`
    );
    if (!background) {
        listRow?.scrollIntoView({ block: "nearest" });
        state.detailLoading = true;
        setDetailLoading(true);
    }

    try {
        const res = await fetch(`/api/orders/${orderId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || res.statusText);
        }
        const productMap = {};
        for (const p of data.products || []) {
            productMap[p.id] = p;
        }
        const isWorkshop =
            orderTypeFromLineItems(
                buildLineItems(data.order, productMap),
                productMap
            ) === "workshop";
        const fulfillmentContext = await loadFulfillmentContextForOrder(
            orderId,
            data.order,
            data.fulfillment_context,
            { isWorkshop }
        );
        state.detailOrder = {
            ...normalizeDetailOrder(
                data.order,
                productMap,
                fulfillmentContext
            ),
            inferred_registrations: data.inferred_registrations || [],
        };
        renderDetailPane(state.detailOrder);
    } catch (e) {
        if (!background) {
            setDetailLoading(false);
            els.detailPaneBody.innerHTML = `<div class="detail-error-state"><p>${escapeHtml(e.message || String(e))}</p></div>`;
        }
    } finally {
        state.detailLoading = false;
    }
}

function buildDetailActionButtons(r) {
    const pay = paymentActions(r);
    const ful = fulfillmentActions(r);
    if (!pay.length && !ful.length) return "";
    let html = '<div class="detail-actions">';
    for (const a of pay) {
        const cls = a.primary ? " detail-action-btn primary" : " detail-action-btn";
        html += `<button type="button" class="${cls.trim()}" data-detail-action="${escapeHtml(a.id)}" data-order-id="${r.id}">${escapeHtml(a.label)}</button>`;
    }
    for (const a of ful) {
        html += `<button type="button" class="detail-action-btn" data-detail-action="fulfill" data-intent="${escapeHtml(a.id)}" data-order-id="${r.id}">${escapeHtml(a.label)}</button>`;
    }
    html += "</div>";
    return html;
}

function renderDetailPane(r) {
    setDetailLoading(false);
    els.detailPaneHeader.classList.remove("hidden");
    els.detailPaneHeader.innerHTML = renderDetailHeader(r);

    const lineItemsHtml = r.lineItems
        .map((li) => {
            const thumb = li.image_url
                ? `<img class="detail-line-thumb" src="${escapeHtml(li.image_url)}" alt="" />`
                : `<span class="detail-line-thumb detail-line-thumb--empty" aria-hidden="true"></span>`;
            const variant = li.variant_title
                ? `<div class="detail-line-variant">${escapeHtml(li.variant_title)}</div>`
                : "";
            const lineTotal =
                Number(li.price) * (li.quantity || 1);
            return `<li class="detail-line-item">
                ${thumb}
                <div class="detail-line-info">
                    <div class="detail-line-title">${escapeHtml(li.title)}</div>
                    ${variant}
                    <div class="detail-line-variant">${escapeHtml(formatMoney(li.price, r.currency))} × ${li.quantity}</div>
                </div>
                <div class="detail-line-price">${escapeHtml(formatMoney(lineTotal, r.currency))}</div>
            </li>`;
        })
        .join("");

    const itemLabel =
        r.item_count === 1 ? "1 item" : `${r.item_count} items`;
    const bill = formatAddress(r.billing_address);
    const ship = formatAddress(r.shipping_address);
    const tagsHtml = r.order_tags.length
        ? r.order_tags
              .map((t) => `<span class="detail-tag">${escapeHtml(t)}</span>`)
              .join("")
        : '<span class="muted">No tags</span>';

    const contactBits = [
        r.email
            ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>`
            : "",
        r.phone ? `<span>${escapeHtml(r.phone)}</span>` : "",
    ].filter(Boolean);

    els.detailPaneBody.innerHTML = `
        <section class="detail-card detail-card--order">
            <div class="detail-card-head">
                <h3 class="detail-card-title">Fulfillment${r.type !== "workshop" ? ` · ${escapeHtml(r.displayFulfillment)}` : ""}</h3>
                <p class="detail-meta detail-card-subtitle">${escapeHtml(itemLabel)}</p>
            </div>
            <ul class="detail-line-items">${lineItemsHtml || '<li class="muted">No line items</li>'}</ul>
            ${renderOrderTotalsFooter(r)}
            ${renderOrderFooterBar(r)}
            ${renderPaymentCancelActions(r)}
        </section>
        ${renderRegistrationSection(r)}
        <section class="detail-card">
            <h3 class="detail-card-title">Customer</h3>
            <p><strong>${escapeHtml(r.customer)}</strong></p>
            ${contactBits.length ? `<div class="detail-contact-row">${contactBits.join("")}</div>` : ""}
            <div class="detail-customer-grid">
                <div class="detail-customer-block">
                    <h4>Billing address</h4>
                    <p class="detail-address">${bill ? escapeHtml(bill) : "—"}</p>
                </div>
                <div class="detail-customer-block">
                    <h4>Shipping address</h4>
                    <p class="detail-address">${ship ? escapeHtml(ship) : "No shipping address provided"}</p>
                </div>
            </div>
        </section>
        <section class="detail-card">
            <h3 class="detail-card-title">Notes</h3>
            <p>${r.note ? escapeHtml(r.note) : '<span class="muted">No notes from customer</span>'}</p>
        </section>
        <section class="detail-card">
            <h3 class="detail-card-title">Tags</h3>
            <div class="detail-tag-list">${tagsHtml}</div>
        </section>`;

    document.getElementById("btnDetailClose")?.addEventListener("click", closeOrderDetail);
    els.detailPaneBody
        .querySelectorAll(".detail-card--registration-link[data-roster-href]")
        .forEach((el) => {
            const href = el.getAttribute("data-roster-href");
            if (!href) return;
            el.addEventListener("click", (ev) => {
                if (ev.target.closest("a")) return;
                window.location.href = href;
            });
            el.addEventListener("keydown", (ev) => {
                if (ev.key !== "Enter" && ev.key !== " ") return;
                if (ev.target.closest("a")) return;
                ev.preventDefault();
                window.location.href = href;
            });
        });
    els.detailPaneBody.querySelectorAll("[data-detail-action]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const action = btn.getAttribute("data-detail-action");
            const intent = btn.getAttribute("data-intent");
            const orderId = btn.getAttribute("data-order-id");
            runOrderAction(orderId, action, intent);
        });
    });
}

async function fetchConfig() {
    if (!isLiveHost()) return;
    try {
        const res = await fetch("/api/config");
        if (!res.ok) return;
        const cfg = await res.json();
        if (cfg.shop) state.shopHandle = cfg.shop;
    } catch {
        /* ignore */
    }
}

async function fetchProductsForOrders(orders) {
    const ids = [
        ...new Set(
            orders
                .flatMap((o) => (o.line_items || []).map((li) => li.product_id))
                .filter(Boolean)
        ),
    ];
    if (!ids.length) return {};
    try {
        const res = await fetch(`/api/products?ids=${ids.join(",")}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        const map = {};
        for (const p of data.products || []) {
            map[p.id] = p;
        }
        return map;
    } catch (e) {
        console.warn("Product lookup failed:", e);
        return {};
    }
}

async function fetchOrders(
    pageInfo = null,
    direction = "replace",
    { background = false } = {}
) {
    if (!isLiveHost()) {
        setStatus("Orders API is not available on this site.", true);
        return;
    }
    if (ordersFetchInProgress) return;

    const qs = new URLSearchParams();
    qs.set("limit", "50");
    if (pageInfo) qs.set("page_info", pageInfo);

    ordersFetchInProgress = true;
    if (background) {
        setOrdersSyncing(true);
    } else {
        state.loading = true;
        els.btnRefresh.disabled = true;
        els.btnPrev.disabled = true;
        els.btnNext.disabled = true;
        setStatus("");
    }

    try {
        const res = await fetch(`/api/orders?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || res.statusText || "Request failed");
        }

        const productMap = await fetchProductsForOrders(data.orders || []);
        state.productMap = { ...state.productMap, ...productMap };
        const batch = (data.orders || []).map((o) =>
            normalizeApiOrder(o, state.productMap)
        );

        state.rows = batch;
        state.nextPageInfo = data.nextPageInfo || null;
        state.previousPageInfo = data.previousPageInfo || null;
        state.pageCursor = pageInfo;

        if (direction === "next") state.pageNumber += 1;
        else if (direction === "prev") {
            state.pageNumber = Math.max(1, state.pageNumber - 1);
        } else if (!pageInfo) state.pageNumber = 1;

        if (!background) setStatus("");
        populateFilterOptions();
        await refreshBotPaymentMap(batch.map((r) => r.id));
        renderTable();

        lastOrdersFetchAt = Date.now();
        ordersFetchComplete = true;

        if (state.selectedOrderId) {
            const still = batch.some(
                (r) => String(r.id) === String(state.selectedOrderId)
            );
            if (still || !state.detailOrder) {
                await openOrderDetail(state.selectedOrderId, { background });
            }
        }
    } catch (e) {
        if (!background) setStatus(e.message || String(e), true);
    } finally {
        ordersFetchInProgress = false;
        if (background) {
            setOrdersSyncing(false);
        } else {
            state.loading = false;
            els.btnRefresh.disabled = false;
        }
        updatePaginationUi();
    }
}

function populateFilterOptions() {
    const fins = [...new Set(state.rows.map((r) => r.financial_status))].filter(
        Boolean
    );
    const fuls = [...new Set(state.rows.map((r) => r.displayFulfillment))].filter(
        Boolean
    );
    const products = [
        ...new Set(
            state.rows.flatMap((r) =>
                r.lineItems.map((li) => li.title).filter(Boolean)
            )
        ),
    ].sort();
    const types = [
        ...new Set(state.rows.flatMap((r) => r.productTypes)),
    ].sort();
    const tags = [...new Set(state.rows.flatMap((r) => r.tags))].sort();

    const keep = {
        fin: els.finStatus.value,
        ful: els.fulStatus.value,
        product: els.filterProduct.value,
        ptype: els.filterProductType.value,
        tag: els.filterTag.value,
    };

    els.finStatus.innerHTML =
        '<option value="">All</option>' +
        fins
            .map(
                (x) =>
                    `<option value="${escapeHtml(x)}">${escapeHtml(displayFinancialStatus(x))}</option>`
            )
            .join("");
    els.fulStatus.innerHTML =
        '<option value="">All</option>' +
        fuls.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
    els.filterProduct.innerHTML =
        '<option value="">All</option>' +
        products.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
    els.filterProductType.innerHTML =
        '<option value="">All</option>' +
        types.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
    els.filterTag.innerHTML =
        '<option value="">All</option>' +
        tags.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");

    if (fins.includes(keep.fin)) els.finStatus.value = keep.fin;
    if (fuls.includes(keep.ful)) els.fulStatus.value = keep.ful;
    if (products.includes(keep.product)) els.filterProduct.value = keep.product;
    if (types.includes(keep.ptype)) els.filterProductType.value = keep.ptype;
    if (tags.includes(keep.tag)) els.filterTag.value = keep.tag;
}

async function runOrderAction(orderId, action, intent = null) {
    setStatus("");
    if (action === "cancel") {
        const order =
            state.detailOrder ||
            state.rows.find((r) => String(r.id) === String(orderId));
        const choice = await confirmCancelOrder(order || {});
        if (!choice) return;
        try {
            await postCancelOrder(orderId, { refund: choice.refund });
            setStatus("");
            closeOrderDetail();
            await fetchOrders(state.pageCursor, "stay");
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
        return;
    }

    if (action === "refund") {
        if (!(await confirmRefundPayment())) return;
        try {
            await postRefundOrder(orderId);
            setStatus("");
            if (state.selectedOrderId) {
                await openOrderDetail(orderId);
            }
            await fetchOrders(state.pageCursor, "stay");
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
        return;
    }

    const url =
        action === "fulfill"
            ? `/api/orders/${orderId}/fulfill`
            : `/api/orders/${orderId}/${action}`;
    const opts = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    };
    if (action === "fulfill") {
        opts.body = JSON.stringify({ intent });
    }
    try {
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data.error || res.statusText || "Request failed";
            throw new Error(data.hint ? `${msg} ${data.hint}` : msg);
        }
        setStatus("");
        await fetchOrders(state.pageCursor, "stay");
        if (state.selectedOrderId === orderId) {
            await openOrderDetail(orderId);
        }
    } catch (e) {
        setStatus(e.message || String(e), true);
    }
}

function setupSortHeaders() {
    document.querySelectorAll("#ordersTable th[data-sort]").forEach((th) => {
        th.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const k = th.getAttribute("data-sort");
            if (state.sortKey === k) {
                state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
            } else {
                state.sortKey = k;
                state.sortDir = k === "created_at" ? "desc" : "asc";
            }
            renderTable();
        });
    });
}

function openOrderFromListTarget(target) {
    const el = target.closest("[data-order-id]");
    if (!el) return;
    const orderId = el.getAttribute("data-order-id");
    if (orderId) openOrderDetail(orderId);
}

function setupTableRowClicks() {
    els.tbody.addEventListener("click", (ev) => {
        openOrderFromListTarget(ev.target);
    });
    els.tbody.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        openOrderFromListTarget(ev.target);
    });
}

function setupCardListClicks() {
    if (!els.ordersCardList) return;
    els.ordersCardList.addEventListener("click", (ev) => {
        openOrderFromListTarget(ev.target);
    });
    els.ordersCardList.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        openOrderFromListTarget(ev.target);
    });
}

function setupDetailModalBackdrop() {
    if (!els.detailModalBackdrop) return;
    els.detailModalBackdrop.addEventListener("click", () => {
        if (isMobileViewport() && state.selectedOrderId) {
            closeOrderDetail();
        }
    });
}

function initUi() {
    if (!isLiveHost()) {
        setStatus("Orders API is not available on this site.", true);
        els.btnRefresh.disabled = true;
        els.btnPrev.disabled = true;
        els.btnNext.disabled = true;
    }

    els.btnRefresh.addEventListener("click", () => fetchOrders(null, "replace"));
    els.btnPrev.addEventListener("click", () => {
        if (state.previousPageInfo) {
            fetchOrders(state.previousPageInfo, "prev");
        }
    });
    els.btnNext.addEventListener("click", () => {
        if (state.nextPageInfo) {
            fetchOrders(state.nextPageInfo, "next");
        }
    });
    els.search.addEventListener("input", () => renderTable());
    els.finStatus.addEventListener("change", () => renderTable());
    els.fulStatus.addEventListener("change", () => renderTable());
    els.filterProduct.addEventListener("change", () => renderTable());
    els.filterProductType.addEventListener("change", () => renderTable());
    els.filterTag.addEventListener("change", () => renderTable());

    if (els.typeSelector) {
        els.typeSelector.querySelectorAll(".type-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.typeFilter = btn.getAttribute("data-type") || "";
                els.typeSelector.querySelectorAll(".type-btn").forEach((b) =>
                    b.classList.toggle(
                        "active",
                        b.getAttribute("data-type") === state.typeFilter
                    )
                );
                renderTable();
            });
        });
    }

    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && state.selectedOrderId) {
            closeOrderDetail();
        }
    });

    setupSortHeaders();
    setupTableRowClicks();
    setupCardListClicks();
    setupDetailModalBackdrop();
    onViewportChange(() => {
        if (state.selectedOrderId) {
            setSplitMode(true);
        } else {
            setSplitMode(false);
        }
        renderTable();
    });
}

function resolveDeepLinkOrderId(raw) {
    if (!raw) return null;
    const value = decodeURIComponent(String(raw)).trim();
    if (/^\d+$/.test(value)) return value;
    const normalized = value.replace(/^m#?/i, "M#");
    const hit = state.rows.find(
        (r) => r.name === normalized || r.name === value
    );
    return hit ? String(hit.id) : null;
}

function initAutoRefresh() {
    if (!isLiveHost()) return;

    const maybeRefresh = () => {
        if (document.visibilityState !== "visible") return;
        if (ordersFetchInProgress) return;
        if (!ordersFetchComplete || !isOrdersFetchStale()) return;
        fetchOrders(state.pageCursor, "stay", { background: true });
    };

    setInterval(maybeRefresh, REFRESH_STALE_MS);
    document.addEventListener("visibilitychange", maybeRefresh);
}

async function boot() {
    initUi();
    await fetchConfig();
    const deepLinkRaw = new URLSearchParams(window.location.search).get("order");
    if (isLiveHost()) {
        await fetchOrders(null, "replace");
        initAutoRefresh();
        if (deepLinkRaw) {
            const orderId = resolveDeepLinkOrderId(deepLinkRaw);
            if (orderId) {
                state.selectedOrderId = orderId;
                await openOrderDetail(orderId);
            }
        }
    } else {
        renderTable();
    }
}

boot();
