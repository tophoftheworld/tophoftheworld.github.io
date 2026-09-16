import { hasOrdersApi } from "./orders-api-host.js";
import {
    buildFulfillmentContext,
    deliveryMethodDisplayText,
    inferDeliveryFromOrder,
    normalizeDeliveryDisplayLabel,
} from "./fulfillment-context.js";
import {
    paidIconHtml,
    paymentCellHtml,
    paymentFooterText,
    paymentMethodDisplay,
} from "./payment-method.js";
import {
    collectOrderRegistrations,
    collectOrderRegistrationsForOrder,
    formatWorkshopDisplayName,
    lineItemPropertiesFromShopify,
    parseRegistrationFromLineItem,
    workshopManagementUrl,
} from "./registration.js";
import { isMobileViewport, onViewportChange } from "./viewport.js";
import { fetchPaymentIntakesByOrders } from "./hub-api.js";
import {
    formatBundleTitle,
    mergeLineItemBundleMeta,
} from "./bundle-line-items.mjs";
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
const ORDERS_PAGE_SIZE = 50;
const MAX_FILTER_SCAN_PAGES = 20;
const FILTER_SEARCH_DEBOUNCE_MS = 300;

const ORDER_STATUS_LABEL = {
    cancelled: "Cancelled",
    unpaid: "Unpaid",
    paid: "Paid",
    for_pickup: "For Pick Up",
    to_ship: "To Ship",
    picked_up: "Picked Up",
    shipped: "Shipped",
    done: "Done",
};

const ORDER_STATUS_SORT = [
    "unpaid",
    "paid",
    "to_ship",
    "for_pickup",
    "shipped",
    "picked_up",
    "done",
    "cancelled",
];

const autoFulfillInFlight = new Set();

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
    btnProductQueue: document.getElementById("btnProductQueue"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    pageIndicator: document.getElementById("pageIndicator"),
    syncIndicator: document.getElementById("ordersSyncIndicator"),
    search: document.getElementById("searchInput"),
    finStatus: document.getElementById("filterStatus"),
    filterProduct: document.getElementById("filterProduct"),
    filterProductType: document.getElementById("filterProductType"),
    filterDelivery: document.getElementById("filterDelivery"),
    typeSelector: document.getElementById("typeSelector"),
    filtersBar: document.getElementById("ordersFiltersBar"),
    btnFiltersToggle: document.getElementById("btnFiltersToggle"),
    filtersExtraPanel: document.getElementById("filtersExtraPanel"),
    filtersActiveBadge: document.getElementById("filtersActiveBadge"),
    ordersTable: document.getElementById("ordersTable"),
    btnSelectMode: document.getElementById("btnSelectMode"),
    batchActionBar: document.getElementById("batchActionBar"),
    batchSelectedCount: document.getElementById("batchSelectedCount"),
    batchActionButtons: document.getElementById("batchActionButtons"),
    btnBatchClear: document.getElementById("btnBatchClear"),
    batchSelectAll: document.getElementById("batchSelectAll"),
};

const BATCH_ACTION_DEFS = [
    {
        id: "mark-paid",
        label: "Mark as paid",
        action: "mark-paid",
        intent: null,
        matches(r) {
            return paymentActions(r).some((a) => a.id === "mark-paid");
        },
    },
    {
        id: "ready_for_pickup",
        label: "Mark as ready for pickup",
        action: "fulfill",
        intent: "ready_for_pickup",
        matches(r) {
            if (r.cancelled_at || r.type === "workshop" || !isOrderPaid(r)) return false;
            if (r.deliveryMethod !== "pickup") return false;
            if (r.orderStatus === "for_pickup" || r.orderStatus === "picked_up") {
                return false;
            }
            if (r.canMarkReadyForPickup) return true;
            if (r.supportsLocalPickup && r.fulfillable) return true;
            return r.orderStatus === "paid" && r.fulfillable;
        },
    },
    {
        id: "picked_up",
        label: "Mark as picked up",
        action: "fulfill",
        intent: "picked_up",
        matches(r) {
            if (r.cancelled_at || r.type === "workshop" || !isOrderPaid(r)) return false;
            if (r.deliveryMethod !== "pickup") return false;
            if (r.canMarkPickedUp) return true;
            if (r.orderStatus === "for_pickup") return true;
            const df = (r.displayFulfillment || "").toLowerCase();
            if (df.includes("ready for pickup")) return true;
            if (r.supportsLocalPickup === false && r.fulfillable) return true;
            return false;
        },
    },
    {
        id: "shipped",
        label: "Mark as shipped",
        action: "fulfill",
        intent: "shipped",
        matches(r) {
            if (r.cancelled_at || r.type === "workshop" || !isOrderPaid(r)) return false;
            if (!r.fulfillable) return false;
            return (
                r.orderStatus === "to_ship" ||
                (r.deliveryMethod === "shipping" && r.orderStatus !== "shipped")
            );
        },
    },
    {
        id: "fulfilled",
        label: "Mark as fulfilled",
        action: "fulfill",
        intent: "fulfilled",
        matches(r) {
            if (r.cancelled_at || r.type === "workshop" || !isOrderPaid(r)) return false;
            if (!r.fulfillable) return false;
            return r.deliveryMethod === "none";
        },
    },
];

const state = {
    rows: [],
    productMap: {},
    typeFilter: "",
    productQueueFilter: false,
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
    selectionMode: false,
    selectedOrderIds: new Set(),
    batchActionInProgress: false,
    filterPageStack: [],
    filterOverflow: [],
    filterFetchCursor: null,
    filterHasMore: false,
    filterPageStartOverflow: [],
};

let ordersFetchInProgress = false;
let ordersFetchComplete = false;
let lastOrdersFetchAt = 0;
let filterSearchDebounceTimer = null;

function isLiveHost() {
    return hasOrdersApi();
}

function setStatus(msg, isError = false) {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", Boolean(isError));
}

function actionPendingLabel(action, intent = null) {
    if (action === "mark-paid") return "Marking as paid…";
    if (action === "mark-pending") return "Marking as pending…";
    if (action === "void") return "Voiding…";
    if (action === "fulfill") {
        if (intent === "shipped") return "Marking as shipped…";
        if (intent === "picked_up") return "Marking as picked up…";
        if (intent === "ready_for_pickup") return "Marking ready for pickup…";
        return "Marking as fulfilled…";
    }
    return "Working…";
}

function setActionButtonPending(btn, label) {
    if (!btn) return;
    if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
    btn.disabled = true;
    btn.classList.add("detail-action-btn--pending");
    btn.textContent = label;
}

function resetActionButton(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove("detail-action-btn--pending");
    if (btn.dataset.origLabel) {
        btn.textContent = btn.dataset.origLabel;
        delete btn.dataset.origLabel;
    }
}

function isOrderSelected(orderId) {
    return state.selectedOrderIds.has(String(orderId));
}

function toggleOrderSelected(orderId, selected = null) {
    const key = String(orderId);
    const next =
        selected == null ? !state.selectedOrderIds.has(key) : Boolean(selected);
    if (next) state.selectedOrderIds.add(key);
    else state.selectedOrderIds.delete(key);
    updateBatchSelectionUi();
}

function clearOrderSelection() {
    state.selectedOrderIds.clear();
    updateBatchSelectionUi();
}

function setSelectionMode(active) {
    state.selectionMode = Boolean(active);
    if (!state.selectionMode) clearOrderSelection();
    els.btnSelectMode?.setAttribute(
        "aria-pressed",
        state.selectionMode ? "true" : "false"
    );
    if (els.btnSelectMode) {
        els.btnSelectMode.textContent = state.selectionMode ? "Done" : "Select";
    }
    els.ordersTable?.classList.toggle(
        "orders-table--select-mode",
        state.selectionMode
    );
    els.batchActionBar?.classList.toggle("hidden", !state.selectionMode);
    if (!state.selectionMode && els.batchSelectAll) {
        els.batchSelectAll.checked = false;
        els.batchSelectAll.indeterminate = false;
    }
    renderTable();
}

function orderSupportsBatchAction(r, def) {
    return Boolean(r && def?.matches(r));
}

function orderHasAnyBatchAction(r) {
    return BATCH_ACTION_DEFS.some((def) => orderSupportsBatchAction(r, def));
}

function batchSelectableRows() {
    return getFilteredRows().filter((r) => orderHasAnyBatchAction(r));
}

function selectedRowsForBatchAction(def) {
    return [...state.selectedOrderIds]
        .map((id) => state.rows.find((r) => String(r.id) === String(id)))
        .filter((r) => orderSupportsBatchAction(r, def));
}

function batchActionButtonLabel(def, count) {
    if (!count) return def.label;
    if (count === 1) return def.label;
    return `${def.label} (${count})`;
}

function renderBatchActionButtons() {
    if (!els.batchActionButtons) return;
    const selected = [...state.selectedOrderIds];
    const counts = BATCH_ACTION_DEFS.map((def) => ({
        def,
        count: selected.filter((id) => {
            const row = state.rows.find((r) => String(r.id) === String(id));
            return orderSupportsBatchAction(row, def);
        }).length,
    })).filter((x) => x.count > 0);

    if (!counts.length) {
        els.batchActionButtons.innerHTML =
            '<span class="batch-action-bar__hint">No batch actions apply to the current selection.</span>';
        return;
    }

    els.batchActionButtons.innerHTML = counts
        .map(
            ({ def, count }) =>
                `<button type="button" class="action-btn primary" data-batch-action="${escapeHtml(def.id)}" ${state.batchActionInProgress ? "disabled" : ""}>${escapeHtml(batchActionButtonLabel(def, count))}</button>`
        )
        .join("");
}

function updateBatchSelectionUi() {
    const selected = [...state.selectedOrderIds];
    if (els.batchSelectedCount) {
        const n = selected.length;
        els.batchSelectedCount.textContent =
            n === 1 ? "1 order selected" : `${n} orders selected`;
    }
    renderBatchActionButtons();
    const visible = batchSelectableRows();
    if (els.batchSelectAll && state.selectionMode) {
        const visibleIds = visible.map((r) => String(r.id));
        const selectedVisible = visibleIds.filter((id) =>
            state.selectedOrderIds.has(id)
        );
        els.batchSelectAll.checked =
            visibleIds.length > 0 &&
            selectedVisible.length === visibleIds.length;
        els.batchSelectAll.indeterminate =
            selectedVisible.length > 0 &&
            selectedVisible.length < visibleIds.length;
    }
    renderTable();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(message) {
    const s = String(message || "").toLowerCase();
    return (
        s.includes("2 calls per second") ||
        s.includes("rate limit") ||
        s.includes("throttle") ||
        s.includes("too many requests")
    );
}

async function fetchJsonWithRetry(url, options = {}, { retries = 4 } = {}) {
    let lastRes = null;
    let lastData = {};
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (res.ok) return { res, data };
        lastRes = res;
        lastData = data;
        const msg = data.error || res.statusText;
        if (isRateLimitError(msg) && attempt < retries) {
            await sleep(Math.min(1200 * 2 ** attempt, 8000));
            continue;
        }
        break;
    }
    return { res: lastRes, data: lastData };
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

function deliveryTypeLabel(r) {
    if (r.type === "workshop") return "";
    return normalizeDeliveryDisplayLabel(r.deliveryMethod, r.deliveryLabel);
}

function deliveryTypePillClass(deliveryMethod) {
    if (deliveryMethod === "pickup") return "context-pill--pickup";
    if (deliveryMethod === "shipping") return "context-pill--shipping";
    return "context-pill--none";
}

function isOrderPaid(r) {
    return (r.financial_status || "").toLowerCase() === "paid";
}

function todayDateIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function workshopSessionDatesFromLineItems(lineItems) {
    return collectOrderRegistrations(lineItems)
        .map((reg) => reg.sessionDateIso)
        .filter(Boolean);
}

function isWorkshopSessionOver(r) {
    const dates = r.workshopSessionDates || [];
    if (!dates.length) return false;
    const latest = dates.slice().sort().pop();
    return latest < todayDateIso();
}

function resolveOrderStatus(r) {
    if (r.cancelled_at) return "cancelled";
    if (!isOrderPaid(r)) return "unpaid";

    if (r.type === "workshop") {
        if (isWorkshopSessionOver(r)) return "done";
        return "paid";
    }

    const dm = r.deliveryMethod;
    const raw = (r.displayFulfillment || "").toLowerCase();

    if (dm === "none") {
        if (raw.includes("fulfilled") && !raw.includes("un")) return "done";
        return "paid";
    }

    if (dm === "pickup") {
        if (
            r.pickupStage === "ready_for_pickup" ||
            raw.includes("ready for pickup")
        ) {
            return "for_pickup";
        }
        if (r.pickupStage === "picked_up" || raw === "picked up") {
            return "picked_up";
        }
        if (raw.includes("picked up") && !raw.includes("ready for pickup")) {
            return "picked_up";
        }
        if (
            r.pickupStage === "fulfilled" ||
            raw === "fulfilled" ||
            (raw.includes("fulfilled") && !raw.includes("un"))
        ) {
            return "picked_up";
        }
        return "paid";
    }

    if (dm === "shipping" || dm === "unknown") {
        if (
            raw.includes("shipped") ||
            raw.includes("transit") ||
            raw.includes("delivered") ||
            (raw.includes("fulfilled") && !raw.includes("un"))
        ) {
            return "shipped";
        }
        return "to_ship";
    }

    return "paid";
}

function withOrderStatus(row) {
    const orderStatus = resolveOrderStatus(row);
    return {
        ...row,
        orderStatus,
        orderStatusLabel: orderStatus ? ORDER_STATUS_LABEL[orderStatus] : "",
    };
}

async function maybeAutoFulfillWorkshopOrder(r) {
    if (r.type !== "workshop" || !isOrderPaid(r) || r.cancelled_at) return false;
    if (!isWorkshopSessionOver(r)) return false;
    const fs = (r.fulfillment_status || "").toLowerCase();
    if (fs === "fulfilled") return false;
    if (autoFulfillInFlight.has(r.id)) return false;
    autoFulfillInFlight.add(r.id);
    try {
        await sleep(700);
        const { res } = await fetchJsonWithRetry(`/api/orders/${r.id}/fulfill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intent: "fulfilled" }),
        });
        return res.ok;
    } catch (_) {
        return false;
    } finally {
        autoFulfillInFlight.delete(r.id);
    }
}

async function autoFulfillCompletedWorkshops(rows) {
    let any = false;
    for (const r of rows) {
        if (await maybeAutoFulfillWorkshopOrder(r)) any = true;
    }
    return any;
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

function buildLineItems(o, productMap, bundleByLineId = {}) {
    return (o.line_items || []).map((li) => {
        const p = productMap[li.product_id];
        const properties = lineItemPropertiesFromShopify(li.properties);
        const bundle = bundleByLineId[String(li.id)];
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
            properties,
            bundleGroupId: bundle?.groupId || null,
            bundleTitle: bundle?.bundleTitle
                ? formatBundleTitle(bundle.bundleTitle)
                : null,
            bundleQuantity: bundle?.bundleQuantity || null,
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
    const listFx = o.list_fulfillment || null;
    const displayFulfillment =
        listFx?.displayFulfillment ?? displayFulfillmentFromOrder(o);
    const type = orderTypeFromLineItems(lineItems, productMap);
    const workshopSessionDates =
        type === "workshop"
            ? workshopSessionDatesFromLineItems(lineItems)
            : [];
    const workshopSessionLabel =
        type === "workshop"
            ? workshopSessionLabelFromLineItems(lineItems)
            : "";
    const delivery = inferDeliveryFromOrder(o);
    let deliveryMethod = delivery.deliveryMethod;
    let deliveryLabel = delivery.deliveryLabel;
    if (listFx?.deliveryMethod && type !== "workshop") {
        deliveryMethod = listFx.deliveryMethod;
        deliveryLabel = listFx.deliveryLabel || deliveryLabel;
    }
    let deliveryMethodDisplay = deliveryMethodDisplayText(
        deliveryMethod,
        deliveryLabel
    );
    if (type === "workshop") {
        deliveryMethod = "none";
        deliveryLabel = "Shipping not required";
        deliveryMethodDisplay = "Shipping not required";
    }

    const fulfillable =
        listFx && deliveryMethod === "pickup"
            ? Boolean(
                  listFx.canMarkReadyForPickup ||
                      listFx.canMarkPickedUp ||
                      (!listFx.supportsLocalPickup &&
                          (o.line_items || []).some(
                              (li) => li.fulfillable_quantity > 0
                          ))
              )
            : (o.line_items || []).some((li) => li.fulfillable_quantity > 0) &&
              displayFulfillment !== "Fulfilled";

    return withOrderStatus({
        id: o.id,
        name: o.name || "",
        type,
        type_label: typeLabel(type),
        deliveryMethod,
        deliveryLabel,
        deliveryMethodDisplay,
        deliveryTypeLabel: deliveryTypeLabel({
            type,
            deliveryMethod,
            deliveryLabel,
        }),
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
        pickupStage: listFx?.pickupStage || null,
        canMarkReadyForPickup: Boolean(listFx?.canMarkReadyForPickup),
        canMarkPickedUp: Boolean(listFx?.canMarkPickedUp),
        supportsLocalPickup: Boolean(listFx?.supportsLocalPickup),
        workshopSessionDates,
        workshopSessionLabel,
        lineItems,
        productTypes: [...productTypes],
        tags: allTags,
        item_count: itemCount,
        fulfillable,
    });
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

function normalizeDetailOrder(
    o,
    productMap = {},
    fulfillmentContext = null,
    inferredRegs = [],
    bundleByLineId = {}
) {
    const base = normalizeApiOrder(o, productMap);
    const lineItems = buildLineItems(o, productMap, bundleByLineId);
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
            ? Boolean(
                  ctx.canMarkReadyForPickup ||
                      ctx.canMarkPickedUp ||
                      (!ctx.supportsLocalPickup && base.fulfillable)
              )
            : base.fulfillable;
    const workshopSessionDates =
        base.type === "workshop"
            ? [
                  ...new Set([
                      ...workshopSessionDatesFromLineItems(base.lineItems),
                      ...workshopRegistrationsFromRow({
                          lineItems: base.lineItems,
                          inferred_registrations: inferredRegs,
                      })
                          .map((reg) => reg.sessionDateIso)
                          .filter(Boolean),
                  ]),
              ]
            : base.workshopSessionDates;
    const workshopSessionLabel =
        base.type === "workshop"
            ? workshopSessionLabelFromLineItems(base.lineItems) ||
              formatWorkshopDisplayName(
                  workshopRegistrationsFromRow({
                      lineItems: base.lineItems,
                      inferred_registrations: inferredRegs,
                  })[0]?.workshopDisplay || ""
              )
            : "";
    return withOrderStatus({
        ...base,
        lineItems,
        displayFulfillment,
        fulfillable,
        workshopSessionDates,
        workshopSessionLabel,
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
        deliveryTypeLabel: deliveryTypeLabel({
            type: base.type,
            deliveryMethod: delivery.method,
            deliveryLabel: delivery.label,
        }),
        pickupStage: ctx.pickupStage || null,
        canMarkReadyForPickup: Boolean(ctx.canMarkReadyForPickup),
        canMarkPickedUp: Boolean(ctx.canMarkPickedUp),
        supportsLocalPickup: Boolean(ctx.supportsLocalPickup),
    });
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
        return "Shipping not required";
    }
    const label = deliveryTypeLabel(r);
    return label || "—";
}

function renderDetailStatusPills(r) {
    const pills = [];
    if (r.orderStatusLabel) {
        pills.push(orderStatusPillHtml(r));
    }
    const delivery = deliveryPillHtml(r);
    if (delivery) pills.push(delivery);
    pills.push(
        `<span class="type-pill ${typePillClass(r.type)}">${escapeHtml(r.type_label)}</span>`
    );
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

function orderStatusClass(statusKey) {
    switch (statusKey) {
        case "cancelled":
            return "status-pill--cancelled";
        case "unpaid":
            return "status-pill--unpaid";
        case "paid":
            return "status-pill--paid";
        case "for_pickup":
        case "to_ship":
            return "status-pill--action";
        case "shipped":
        case "picked_up":
        case "done":
            return "status-pill--complete";
        default:
            return "status-pill--neutral";
    }
}

function orderStatusIconSvg(statusKey) {
    const stroke = "currentColor";
    const common = `xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
    switch (statusKey) {
        case "cancelled":
            return `<svg ${common}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>`;
        case "unpaid":
            return `<svg ${common}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;
        case "paid":
            return `<svg ${common}><path d="M20 6 9 17l-5-5"/></svg>`;
        case "to_ship":
            return `<svg ${common}><path d="M10 17h4"/><path d="M3 17h2"/><path d="M19 17h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17H3V8l2-3h9v12"/><path d="M14 17h3l3-4V9h-6v8"/></svg>`;
        case "for_pickup":
            return `<svg ${common}><path d="M3 9 12 2l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`;
        case "shipped":
        case "picked_up":
            return `<svg ${common}><path d="M20 6 9 17l-5-5"/></svg>`;
        case "done":
            return `<svg ${common}><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
        default:
            return `<svg ${common}><circle cx="12" cy="12" r="10"/></svg>`;
    }
}

function orderStatusPillHtml(r) {
    if (!r.orderStatusLabel) return "";
    const cls = orderStatusClass(r.orderStatus);
    const icon = orderStatusIconSvg(r.orderStatus);
    return `<span class="status-pill ${cls}"><span class="status-pill__icon" aria-hidden="true">${icon}</span><span class="status-pill__label">${escapeHtml(r.orderStatusLabel)}</span></span>`;
}

function lineItemShortName(li) {
    return (li.title || "").trim();
}

function orderLineItemsPreviewLines(r, maxLines = 3) {
    const lines = (r.lineItems || []).map((li) => {
        const name = lineItemShortName(li);
        const qty = li.quantity || 1;
        return `${qty}× ${name}`;
    });
    if (!lines.length) return [];
    const shown = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
        shown.push(`+${lines.length - maxLines} more`);
    }
    return shown;
}

function orderLineItemsPreviewHtml(r) {
    const lines = orderLineItemsPreviewLines(r);
    if (!lines.length) return '<span class="muted">—</span>';
    return `<ul class="order-items-preview">${lines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul>`;
}

function workshopRegistrationsFromRow(r) {
    return collectOrderRegistrationsForOrder(
        r.lineItems,
        r.inferred_registrations || []
    );
}

function workshopSlotCount(r) {
    const regs = workshopRegistrationsFromRow(r);
    if (regs.length) {
        return regs.reduce((n, reg) => n + (reg.quantity || 1), 0);
    }
    return r.item_count || 0;
}

function workshopSessionLabelFromLineItems(lineItems) {
    const regs = collectOrderRegistrations(lineItems);
    if (!regs.length) {
        const li = lineItems?.[0];
        if (!li) return "";
        return formatWorkshopDisplayName(li.title || "");
    }
    const reg = regs[0];
    return formatWorkshopDisplayName(reg.workshopDisplay || reg.workshop || "");
}

function workshopSessionWhenFromRow(r) {
    const regs = workshopRegistrationsFromRow(r);
    if (!regs.length) return "";
    const reg = regs[0];
    return [reg.date, reg.time].filter(Boolean).join(" · ");
}

function workshopSessionCellHtml(r) {
    if (r.type !== "workshop") return "";
    const name =
        r.workshopSessionLabel ||
        workshopSessionLabelFromLineItems(r.lineItems);
    if (!name) return '<span class="muted">—</span>';
    const when = workshopSessionWhenFromRow(r);
    return `<div class="workshop-session-cell">
        <span class="workshop-session-cell__name">${escapeHtml(name)}</span>
        ${when ? `<span class="workshop-session-cell__when">${escapeHtml(when)}</span>` : ""}
    </div>`;
}

function orderItemsCellHtml(r) {
    const mode = state.typeFilter || "all";
    if (mode === "workshop") {
        const slots = workshopSlotCount(r);
        const label = slots === 1 ? "1 slot" : `${slots} slots`;
        return `<span class="order-slots-count">${escapeHtml(label)}</span>`;
    }
    if (mode === "product") {
        return orderLineItemsPreviewHtml(r);
    }
    const n = r.item_count || 0;
    return escapeHtml(n === 1 ? "1 item" : `${n} items`);
}

function deliveryPillVariant(r) {
    const label = deliveryTypeLabel(r);
    if (label === "Pickup") return "pickup";
    if (label === "Nationwide") return "nationwide";
    if (label === "Metro Manila") return "metro";
    return r.deliveryMethod || "unknown";
}

function deliveryPillHtml(r) {
    const label = deliveryTypeLabel(r);
    if (!label) return "";
    const variant = deliveryPillVariant(r);
    return `<span class="delivery-pill delivery-pill--${escapeHtml(variant)}">${escapeHtml(label)}</span>`;
}

function fulfillmentStatusClass(label) {
    const raw = (label || "unfulfilled").toLowerCase();
    if (raw.includes("ready") && raw.includes("pickup")) {
        return "status-pill--fulfillment-ready_for_pickup";
    }
    if (raw.includes("partial")) return "status-pill--fulfillment-partial";
    if (raw.includes("picked up") && !raw.includes("ready for pickup")) {
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

function needsShipOrPackToday(r) {
    if (r.type !== "product" || r.cancelled_at) return false;
    if (!isOrderPaid(r)) return false;
    const status = r.orderStatus || resolveOrderStatus(r);
    return status === "paid" || status === "to_ship" || status === "for_pickup";
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function getFilterCriteria() {
    return {
        q: (els.search.value || "").trim().toLowerCase(),
        statusFilter: els.finStatus.value,
        product: els.filterProduct.value,
        ptype: els.filterProductType.value,
        delivery: els.filterDelivery?.value || "",
        typeF: state.typeFilter,
        productQueueFilter: state.productQueueFilter,
    };
}

function needsServerOrderScan(criteria = getFilterCriteria()) {
    return Boolean(
        criteria.productQueueFilter ||
            criteria.statusFilter ||
            criteria.product ||
            criteria.ptype ||
            criteria.delivery ||
            criteria.q
    );
}

function hasActiveListFilters(criteria = getFilterCriteria()) {
    return Boolean(
        criteria.typeF ||
            criteria.productQueueFilter ||
            criteria.statusFilter ||
            criteria.product ||
            criteria.ptype ||
            criteria.delivery ||
            criteria.q
    );
}

function rowMatchesFilters(r, criteria = getFilterCriteria()) {
    if (criteria.typeF && r.type !== criteria.typeF) return false;
    if (criteria.statusFilter && r.orderStatus !== criteria.statusFilter) {
        return false;
    }
    if (criteria.product) {
        const hit = r.lineItems.some(
            (li) =>
                li.title === criteria.product ||
                (li.sku && li.sku === criteria.product)
        );
        if (!hit) return false;
    }
    if (criteria.ptype && !r.productTypes.includes(criteria.ptype)) return false;
    if (criteria.delivery && deliveryPillVariant(r) !== criteria.delivery) {
        return false;
    }
    if (criteria.productQueueFilter && !needsShipOrPackToday(r)) return false;
    if (!criteria.q) return true;
    const blob = [
        r.name,
        r.customer,
        r.email,
        r.financial_label,
        r.payment_method,
        r.orderStatusLabel,
        r.workshopSessionLabel,
        ...orderLineItemsPreviewLines(r, 5),
        r.displayFulfillment,
        r.deliveryTypeLabel,
        r.deliveryLabel,
        r.type_label,
        ...r.lineItems.map((li) => `${li.title} ${li.sku} ${li.product_type}`),
        ...r.tags,
        ...r.productTypes,
    ]
        .join(" ")
        .toLowerCase();
    return blob.includes(criteria.q);
}

function getFilteredRows() {
    if (!hasActiveListFilters()) return state.rows;
    return state.rows.filter((r) => rowMatchesFilters(r));
}

function refetchOrdersForFilters({ background } = {}) {
    setSelectionMode(false);
    const bg = background ?? state.rows.length > 0;
    void fetchOrders(null, "replace", { background: bg });
}

function applyClientListFilters() {
    updateProductQueueUi();
    updateFiltersUi();
    renderTable();
    updatePaginationUi();
}

function wasServerFiltered() {
    return (
        state.filterPageStack.length > 0 ||
        state.filterFetchCursor != null ||
        state.filterOverflow.length > 0
    );
}

function clearServerFilterModeIfNeeded() {
    if (!needsServerOrderScan() && wasServerFiltered()) {
        resetFilterPaginationState();
        return true;
    }
    return false;
}

function handleListFilterChange() {
    updateFiltersUi();
    if (needsServerOrderScan()) {
        refetchOrdersForFilters();
        return;
    }
    if (clearServerFilterModeIfNeeded()) {
        void fetchOrders(null, "replace", {
            background: state.rows.length > 0,
        });
        return;
    }
    applyClientListFilters();
}

function resetFilterPaginationState() {
    state.filterPageStack = [];
    state.filterOverflow = [];
    state.filterFetchCursor = null;
    state.filterHasMore = false;
    state.filterPageStartOverflow = [];
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
        if (r.supportsLocalPickup) {
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
        return [
            {
                id: "picked_up",
                label: "Mark as picked up",
                primary: true,
            },
        ];
    }
    if (!r.fulfillable) return [];
    if (r.deliveryMethod === "shipping") {
        return [{ id: "shipped", label: "Mark as shipped", primary: true }];
    }
    return [{ id: "fulfilled", label: "Mark as fulfilled", primary: true }];
}

function renderOrderCard(r) {
    const tClass = typePillClass(r.type);
    const itemsPreview = orderLineItemsPreviewLines(r, 2).join(", ");
    const itemsLabel =
        r.type === "workshop"
            ? workshopSlotCount(r) === 1
                ? "1 slot"
                : `${workshopSlotCount(r)} slots`
            : itemsPreview || "—";
    const sessionLine =
        r.type === "workshop" ? r.workshopSessionLabel || "" : "";
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
    const batchSelected = isOrderSelected(r.id) ? " order-card--batch-selected" : "";
    const batchSelectable = state.selectionMode
        ? " order-card--batch-selectable"
        : "";
    const batchCheck = state.selectionMode
        ? `<input type="checkbox" class="order-card__batch-check" data-batch-select="${r.id}" ${isOrderSelected(r.id) ? "checked" : ""} aria-label="Select order ${escapeHtml(r.name)}" />`
        : "";
    return `<article class="entity-card order-card${r.type === "workshop" ? " order-card--workshop" : ""}${cancelledClass}${selected}${batchSelectable}${batchSelected}" data-order-id="${r.id}" tabindex="0" role="button" aria-label="Open order ${escapeHtml(r.name)}">
        ${batchCheck}
        <div class="entity-card__head order-card__head">
            <span class="entity-card__title order-card__order-num">${escapeHtml(r.name)}</span>
            <span class="type-pill ${tClass}">${escapeHtml(r.type_label)}</span>
        </div>
        <div class="order-card__body">
            <div class="order-card__left">
                <p class="entity-card__primary">${escapeHtml(r.customer)}</p>
                <p class="entity-card__sub">${escapeHtml(formatShopifyDate(r.created_at))}</p>
                ${sessionLine ? `<p class="entity-card__sub entity-card__session">${escapeHtml(sessionLine)}</p>` : ""}
                <p class="entity-card__sub entity-card__items">${escapeHtml(itemsLabel)}</p>
            </div>
            <div class="order-card__right">
                <div class="entity-card__amount">${escapeHtml(formatMoney(r.total, r.currency))}</div>
                ${r.orderStatusLabel ? `<div class="entity-card__payment">${orderStatusPillHtml(r)}</div>` : ""}
            </div>
        </div>
        ${deliveryFooter}
    </article>`;
}

function renderOrderTableRow(r) {
    const tClass = typePillClass(r.type);
    const selected =
        String(r.id) === String(state.selectedOrderId)
            ? " orders-row--selected"
            : "";
    const cancelledClass = r.cancelled_at ? " orders-row--cancelled" : "";
    const batchSelected = isOrderSelected(r.id)
        ? " orders-row--batch-selected"
        : "";
    const canBatch = orderHasAnyBatchAction(r);
    const batchCell = state.selectionMode
        ? `<td class="col-select"><input type="checkbox" class="batch-row-select" data-batch-select="${r.id}" ${isOrderSelected(r.id) ? "checked" : ""} ${canBatch ? "" : "disabled"} aria-label="Select order ${escapeHtml(r.name)}" title="${canBatch ? "" : "No batch actions apply to this order"}" /></td>`
        : `<td class="col-select" hidden></td>`;
    return `<tr class="orders-row${selected}${cancelledClass}${batchSelected}" data-order-id="${r.id}" tabindex="0">
        ${batchCell}
        <td class="col-order">${escapeHtml(r.name)}</td>
        <td class="col-type"><span class="type-pill ${tClass}">${escapeHtml(r.type_label)}</span></td>
        <td class="col-date">${escapeHtml(formatShopifyDate(r.created_at))}</td>
        <td class="col-customer">${escapeHtml(r.customer)}</td>
        <td class="col-session">${workshopSessionCellHtml(r)}</td>
        <td class="col-items">${orderItemsCellHtml(r)}</td>
        <td class="col-total num">${escapeHtml(formatMoney(r.total, r.currency))}</td>
        <td class="col-delivery">${deliveryPillHtml(r)}</td>
        <td class="col-status">${orderStatusPillHtml(r)}</td>
    </tr>`;
}

function renderOrdersTableRows(list) {
    els.tbody.innerHTML = list.map((r) => renderOrderTableRow(r)).join("");
}

function patchListRowDom(r) {
    const id = String(r.id);
    const list = getFilteredRows();
    if (!list.some((row) => String(row.id) === id)) return;
    const tr = els.tbody?.querySelector(
        `tr[data-order-id="${CSS.escape(id)}"]`
    );
    if (tr) tr.outerHTML = renderOrderTableRow(r);
    const card = els.ordersCardList?.querySelector(
        `[data-order-id="${CSS.escape(id)}"]`
    );
    if (card) card.outerHTML = renderOrderCard(r);
}

function upsertListRowFromOrder(o, productMap) {
    const row = withOrderStatus(normalizeApiOrder(o, productMap));
    const idx = state.rows.findIndex(
        (x) => String(x.id) === String(row.id)
    );
    if (idx >= 0) state.rows[idx] = row;
    patchListRowDom(row);
    return row;
}

function syncListRowFromDetail(detailOrder) {
    const idx = state.rows.findIndex(
        (x) => String(x.id) === String(detailOrder.id)
    );
    if (idx < 0) return;
    const row = withOrderStatus({
        ...state.rows[idx],
        displayFulfillment: detailOrder.displayFulfillment,
        deliveryMethod: detailOrder.deliveryMethod,
        deliveryLabel: detailOrder.deliveryLabel,
        deliveryMethodDisplay: detailOrder.deliveryMethodDisplay,
        deliveryTypeLabel: detailOrder.deliveryTypeLabel,
        fulfillable: detailOrder.fulfillable,
        pickupStage: detailOrder.pickupStage,
        canMarkReadyForPickup: detailOrder.canMarkReadyForPickup,
        canMarkPickedUp: detailOrder.canMarkPickedUp,
        supportsLocalPickup: detailOrder.supportsLocalPickup,
        fulfillment_status: detailOrder.fulfillment_status,
        financial_status: detailOrder.financial_status,
        financial_label: detailOrder.financial_label,
        cancelled_at: detailOrder.cancelled_at,
    });
    state.rows[idx] = row;
    patchListRowDom(row);
}

async function applyOrderDetailFromApi(data) {
    const productMap = await productMapFromOrdersResponse(
        [data.order],
        data.products
    );
    state.productMap = { ...state.productMap, ...productMap };

    const orderId = data.order.id;
    const isWorkshop =
        orderTypeFromLineItems(
            buildLineItems(data.order, state.productMap),
            state.productMap
        ) === "workshop";
    const fulfillmentContext = await loadFulfillmentContextForOrder(
        orderId,
        data.order,
        data.fulfillment_context,
        { isWorkshop }
    );
    const bundleByLineId = mergeLineItemBundleMeta(
        data.order.line_items || [],
        data.line_item_bundles || {}
    );
    state.detailOrder = withOrderStatus({
        ...normalizeDetailOrder(
            data.order,
            state.productMap,
            fulfillmentContext,
            data.inferred_registrations || [],
            bundleByLineId
        ),
        inferred_registrations: data.inferred_registrations || [],
    });
    syncListRowFromDetail(state.detailOrder);
    renderDetailPane(state.detailOrder);
    return state.detailOrder;
}

async function refreshOrderAfterAction(orderId) {
    els.detailPaneBody?.setAttribute("aria-busy", "true");
    try {
        const { res, data } = await fetchJsonWithRetry(
            `/api/orders/${orderId}`
        );
        if (!res.ok) {
            throw new Error(data.error || res.statusText || "Request failed");
        }
        await applyOrderDetailFromApi(data);
    } finally {
        els.detailPaneBody?.removeAttribute("aria-busy");
    }
}

function updateProductQueueUi() {
    const show = state.typeFilter === "product";
    if (!els.btnProductQueue) return;
    els.btnProductQueue.hidden = !show;
    if (!show) state.productQueueFilter = false;
    els.btnProductQueue.classList.toggle(
        "product-queue-btn--active",
        Boolean(state.productQueueFilter)
    );
    els.btnProductQueue.setAttribute(
        "aria-pressed",
        state.productQueueFilter ? "true" : "false"
    );
}

function updateTableHeaders() {
    const mode = state.typeFilter || "all";
    const itemsTh = document.querySelector("#ordersTable th.col-items");
    if (!itemsTh) return;
    const label = mode === "workshop" ? "Slots" : "Items";
    itemsTh.dataset.sortLabel = label;
    if (itemsTh.getAttribute("data-sort") !== state.sortKey) {
        itemsTh.textContent = label;
    }
}

function updateOrdersViewMode() {
    const table = els.ordersTable;
    if (!table) return;
    table.classList.remove(
        "orders-view--all",
        "orders-view--workshop",
        "orders-view--product"
    );
    const mode = state.typeFilter || "all";
    table.classList.add(`orders-view--${mode}`);
    updateTableHeaders();
    updateProductQueueUi();
}

function renderTableSkeleton() {
    const skeletonRow = `<tr class="orders-row orders-row--skeleton" aria-hidden="true">
        <td class="col-select" hidden><span class="table-skeleton-bar table-skeleton-bar--short"></span></td>
        <td class="col-order"><span class="table-skeleton-bar"></span></td>
        <td class="col-type"><span class="table-skeleton-bar table-skeleton-bar--short"></span></td>
        <td class="col-date"><span class="table-skeleton-bar table-skeleton-bar--short"></span></td>
        <td class="col-customer"><span class="table-skeleton-bar"></span></td>
        <td class="col-session"><span class="table-skeleton-bar table-skeleton-bar--short"></span></td>
        <td class="col-items"><span class="table-skeleton-bar"></span></td>
        <td class="col-total"><span class="table-skeleton-bar table-skeleton-bar--short"></span></td>
        <td class="col-delivery"><span class="table-skeleton-bar table-skeleton-bar--short"></span></td>
        <td class="col-status"><span class="table-skeleton-bar table-skeleton-bar--short"></span></td>
    </tr>`;
    els.tbody.innerHTML = skeletonRow.repeat(8);
    if (els.ordersCardList) {
        els.ordersCardList.innerHTML = Array.from(
            { length: 5 },
            () =>
                `<article class="entity-card entity-card--skeleton" aria-hidden="true">
                    <span class="table-skeleton-bar"></span>
                    <span class="table-skeleton-bar table-skeleton-bar--short"></span>
                </article>`
        ).join("");
    }
}

function setTableLoading(loading) {
    state.loading = loading;
    els.listPane?.classList.toggle("list-pane--loading", Boolean(loading));
    if (loading) {
        setStatus("Loading orders…");
        renderTableSkeleton();
        els.btnPrev.disabled = true;
        els.btnNext.disabled = true;
    }
}

function renderTable() {
    updateOrdersViewMode();
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
    const filteredMode = needsServerOrderScan();
    els.btnPrev.disabled =
        state.loading ||
        (filteredMode
            ? state.filterPageStack.length === 0
            : !state.previousPageInfo);
    els.btnNext.disabled =
        state.loading ||
        (filteredMode ? !state.filterHasMore : !state.nextPageInfo);
    const count = getFilteredRows().length;
    let label = `Page ${state.pageNumber}`;
    if (count) {
        label += ` · ${count} order${count === 1 ? "" : "s"}`;
        if (filteredMode && state.filterHasMore) label += "+";
    }
    els.pageIndicator.textContent = label;
}

function findListRowById(orderId) {
    return (
        state.rows.find((r) => String(r.id) === String(orderId)) || null
    );
}

function listRowToDetailPreview(row) {
    return {
        ...row,
        order_tags: row.tags || [],
        billing_address: null,
        shipping_address: null,
        phone: "",
        note: "",
        subtotal: null,
        shipping: 0,
        inferred_registrations: [],
    };
}

function setDetailLoading(loading, { overlay = true } = {}) {
    const overlayEl = document.getElementById("detailLoadingOverlay");
    if (overlayEl) {
        overlayEl.classList.toggle("hidden", !loading || !overlay);
        overlayEl.setAttribute(
            "aria-hidden",
            loading && overlay ? "false" : "true"
        );
    }
    els.detailPane?.classList.toggle("detail-pane--loading", Boolean(loading));
    if (loading && overlay) {
        els.detailPaneHeader.classList.add("hidden");
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

async function openOrderDetail(orderId, { background = false, skipListRender = false } = {}) {
    if (!isLiveHost()) return;
    state.selectedOrderId = orderId;
    setSplitMode(true);
    if (!skipListRender) renderTable();
    const listRowData = findListRowById(orderId);
    const listRow = els.tbody?.querySelector(
        `tr[data-order-id="${CSS.escape(String(orderId))}"]`
    );
    if (!background) {
        listRow?.scrollIntoView({ block: "nearest" });
        state.detailLoading = true;
        if (listRowData) {
            renderDetailPane(listRowToDetailPreview(listRowData), {
                preview: true,
            });
            setDetailLoading(true, { overlay: false });
        } else {
            setDetailLoading(true, { overlay: true });
        }
    }

    try {
        const { res, data } = await fetchJsonWithRetry(`/api/orders/${orderId}`);
        if (!res.ok) {
            throw new Error(data.error || res.statusText);
        }
        await applyOrderDetailFromApi(data);
    } catch (e) {
        if (!background) {
            setDetailLoading(false);
            els.detailPaneBody.innerHTML = `<div class="detail-error-state"><p>${escapeHtml(e.message || String(e))}</p></div>`;
        }
    } finally {
        state.detailLoading = false;
    }
}

function groupDetailLineItems(lineItems) {
    const bundleMap = new Map();
    const blocks = [];
    const emitted = new Set();

    for (const li of lineItems || []) {
        if (!li.bundleGroupId) continue;
        if (!bundleMap.has(li.bundleGroupId)) {
            bundleMap.set(li.bundleGroupId, {
                id: li.bundleGroupId,
                title: li.bundleTitle || "Bundle",
                quantity: li.bundleQuantity || 1,
                items: [],
            });
        }
        bundleMap.get(li.bundleGroupId).items.push(li);
    }

    for (const li of lineItems || []) {
        if (!li.bundleGroupId) {
            blocks.push({ type: "item", item: li });
            continue;
        }
        if (emitted.has(li.bundleGroupId)) continue;
        emitted.add(li.bundleGroupId);
        blocks.push({ type: "bundle", ...bundleMap.get(li.bundleGroupId) });
    }
    return blocks;
}

function renderDetailLineItemHtml(li, r, { component = false } = {}) {
    const lineTotal = Number(li.price) * (li.quantity || 1);
    const thumb = li.image_url
        ? `<img class="detail-line-thumb" src="${escapeHtml(li.image_url)}" alt="" />`
        : `<span class="detail-line-thumb detail-line-thumb--empty" aria-hidden="true"></span>`;
    const variant = li.variant_title
        ? `<div class="detail-line-variant">${escapeHtml(li.variant_title)}</div>`
        : "";
    const qtyLine = component
        ? `<div class="detail-line-variant detail-line-variant--bundle-component">${escapeHtml(formatMoney(li.price, r.currency))} × ${li.quantity}</div>`
        : `<div class="detail-line-variant">${escapeHtml(formatMoney(li.price, r.currency))} × ${li.quantity}</div>`;
    const itemClass = component ? " detail-line-item--component" : "";
    const priceHtml = component
        ? `<div class="detail-line-price detail-line-price--component">${escapeHtml(formatMoney(lineTotal, r.currency))}</div>`
        : `<div class="detail-line-price">${escapeHtml(formatMoney(lineTotal, r.currency))}</div>`;
    return `<li class="detail-line-item${itemClass}">
        ${thumb}
        <div class="detail-line-info">
            <div class="detail-line-title">${escapeHtml(li.title)}</div>
            ${variant}
            ${qtyLine}
        </div>
        ${priceHtml}
    </li>`;
}

function renderDetailLineItemsHtml(r) {
  return groupDetailLineItems(r.lineItems)
        .map((block) => {
            if (block.type === "item") {
                return renderDetailLineItemHtml(block.item, r);
            }
            const bundleQty =
                block.quantity > 1 ? ` × ${block.quantity}` : "";
            const components = block.items
                .map((li) => renderDetailLineItemHtml(li, r, { component: true }))
                .join("");
            const bundleTotal = block.items.reduce(
                (sum, li) => sum + Number(li.price) * (li.quantity || 1),
                0
            );
            return `<li class="detail-line-bundle">
                <div class="detail-line-bundle__head">
                    <div class="detail-line-bundle__identity">
                        <span class="detail-line-bundle__title">${escapeHtml(block.title)}${escapeHtml(bundleQty)}</span>
                        <span class="detail-line-bundle__badge">Bundle</span>
                    </div>
                    <span class="detail-line-bundle__total">${escapeHtml(formatMoney(bundleTotal, r.currency))}</span>
                </div>
                <ul class="detail-line-bundle__items" aria-label="Bundle contents">
                    ${components}
                </ul>
            </li>`;
        })
        .join("");
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

function renderDetailPane(r, { preview = false } = {}) {
    if (!preview) {
        setDetailLoading(false);
        els.detailPane?.classList.remove("detail-pane--preview");
    } else {
        els.detailPane?.classList.add("detail-pane--preview");
    }
    els.detailPaneHeader.classList.remove("hidden");
    els.detailPaneHeader.innerHTML = renderDetailHeader(r);

    const lineItemsHtml = renderDetailLineItemsHtml(r);

    const itemLabel =
        r.item_count === 1 ? "1 item" : `${r.item_count} items`;
    const bill = preview ? "" : formatAddress(r.billing_address);
    const ship = preview ? "" : formatAddress(r.shipping_address);
    const tagsHtml = (r.order_tags || []).length
        ? r.order_tags
              .map((t) => `<span class="detail-tag">${escapeHtml(t)}</span>`)
              .join("")
        : preview
          ? '<span class="detail-skeleton detail-skeleton--inline" aria-hidden="true"></span>'
          : '<span class="muted">No tags</span>';

    const contactBits = [
        r.email
            ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>`
            : "",
        r.phone ? `<span>${escapeHtml(r.phone)}</span>` : "",
    ].filter(Boolean);

    const customerAddressesHtml = preview
        ? `<div class="detail-customer-grid detail-customer-grid--loading" aria-busy="true">
                <div class="detail-customer-block">
                    <h4>Billing address</h4>
                    <p class="detail-skeleton" aria-hidden="true"></p>
                    <p class="detail-skeleton detail-skeleton--short" aria-hidden="true"></p>
                </div>
                <div class="detail-customer-block">
                    <h4>Shipping address</h4>
                    <p class="detail-skeleton" aria-hidden="true"></p>
                    <p class="detail-skeleton detail-skeleton--short" aria-hidden="true"></p>
                </div>
            </div>`
        : `<div class="detail-customer-grid">
                <div class="detail-customer-block">
                    <h4>Billing address</h4>
                    <p class="detail-address">${bill ? escapeHtml(bill) : "—"}</p>
                </div>
                <div class="detail-customer-block">
                    <h4>Shipping address</h4>
                    <p class="detail-address">${ship ? escapeHtml(ship) : "No shipping address provided"}</p>
                </div>
            </div>`;

    const notesHtml = preview
        ? '<p class="detail-skeleton detail-skeleton--note" aria-hidden="true"></p>'
        : `<p>${r.note ? escapeHtml(r.note) : '<span class="muted">No notes from customer</span>'}</p>`;

    els.detailPaneBody.innerHTML = `
        <section class="detail-card detail-card--order">
            <div class="detail-card-head">
                <h3 class="detail-card-title">Order${r.type !== "workshop" && r.orderStatusLabel ? ` · ${escapeHtml(r.orderStatusLabel)}` : ""}</h3>
                <p class="detail-meta detail-card-subtitle">${escapeHtml(itemLabel)}</p>
            </div>
            <ul class="detail-line-items">${lineItemsHtml || '<li class="muted">No line items</li>'}</ul>
            ${renderOrderTotalsFooter(r)}
            ${preview ? "" : renderOrderFooterBar(r)}
            ${preview ? "" : renderPaymentCancelActions(r)}
        </section>
        ${renderRegistrationSection(r)}
        <section class="detail-card">
            <h3 class="detail-card-title">Customer</h3>
            <p><strong>${escapeHtml(r.customer)}</strong></p>
            ${contactBits.length ? `<div class="detail-contact-row">${contactBits.join("")}</div>` : ""}
            ${customerAddressesHtml}
        </section>
        <section class="detail-card">
            <h3 class="detail-card-title">Notes</h3>
            ${notesHtml}
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
            if (btn.disabled || btn.classList.contains("detail-action-btn--pending")) {
                return;
            }
            runOrderAction(orderId, action, intent, btn);
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

async function productMapFromOrdersResponse(orders, embeddedProducts) {
    if (Array.isArray(embeddedProducts) && embeddedProducts.length) {
        const map = {};
        for (const p of embeddedProducts) {
            map[p.id] = p;
        }
        return map;
    }
    return fetchProductsForOrders(orders);
}

async function runOrdersPostLoadTasks(batch) {
    try {
        await sleep(3000);
        await refreshBotPaymentMap(batch.map((r) => r.id));
        const autoFulfilled = await autoFulfillCompletedWorkshops(batch);
        if (autoFulfilled) {
            await fetchOrders(state.pageCursor, "stay", { background: true });
        }
    } catch (e) {
        console.warn("Post-load order tasks failed:", e);
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

async function fetchOrdersApiBatch(pageInfo = null) {
    const qs = new URLSearchParams();
    qs.set("limit", String(ORDERS_PAGE_SIZE));
    if (pageInfo) qs.set("page_info", pageInfo);

    const { res, data } = await fetchJsonWithRetry(`/api/orders?${qs}`);
    if (!res.ok) {
        throw new Error(data.error || res.statusText || "Request failed");
    }
    return data;
}

async function normalizeOrdersBatch(orders, embeddedProducts) {
    const productMap = await productMapFromOrdersResponse(
        orders || [],
        embeddedProducts
    );
    state.productMap = { ...state.productMap, ...productMap };
    return (orders || []).map((o) => normalizeApiOrder(o, state.productMap));
}

async function fillFilteredOrdersPage({
    startCursor = null,
    initialOverflow = [],
} = {}) {
    const criteria = getFilterCriteria();
    const matches = [];
    let overflow = [...initialOverflow];
    let apiCursor = startCursor;
    let scanPages = 0;

    while (matches.length < ORDERS_PAGE_SIZE) {
        while (overflow.length && matches.length < ORDERS_PAGE_SIZE) {
            matches.push(overflow.shift());
        }
        if (matches.length >= ORDERS_PAGE_SIZE) break;
        if (apiCursor === false) break;

        scanPages += 1;
        if (scanPages > MAX_FILTER_SCAN_PAGES) break;

        const data = await fetchOrdersApiBatch(apiCursor);
        const batch = await normalizeOrdersBatch(
            data.orders || [],
            data.products
        );

        for (const row of batch) {
            if (!rowMatchesFilters(row, criteria)) continue;
            if (matches.length < ORDERS_PAGE_SIZE) matches.push(row);
            else overflow.push(row);
        }

        apiCursor = data.nextPageInfo || false;
        if (!data.nextPageInfo) break;
    }

    return {
        rows: matches,
        overflow,
        fetchCursor: apiCursor === false ? null : apiCursor,
        hasMore:
            overflow.length > 0 ||
            (apiCursor !== false && apiCursor != null),
    };
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

    const filteredMode = needsServerOrderScan();
    const useBackground =
        background ||
        (direction === "replace" && !pageInfo && state.rows.length > 0);

    ordersFetchInProgress = true;
    if (useBackground) {
        setOrdersSyncing(true);
    } else {
        setTableLoading(true);
    }

    try {
        if (filteredMode) {
            let startCursor = null;
            let initialOverflow = [];

            if (direction === "replace") {
                resetFilterPaginationState();
                state.pageNumber = 1;
            } else if (direction === "next") {
                state.filterPageStack.push({
                    startCursor: state.pageCursor,
                    overflow: [...state.filterPageStartOverflow],
                });
                startCursor = state.filterFetchCursor;
                initialOverflow = [...state.filterOverflow];
                state.pageNumber += 1;
            } else if (direction === "prev") {
                const prev = state.filterPageStack.pop();
                if (!prev) return;
                startCursor = prev.startCursor;
                initialOverflow = [...prev.overflow];
                state.pageNumber = Math.max(1, state.pageNumber - 1);
            } else if (direction === "stay") {
                startCursor = state.pageCursor;
                initialOverflow = [...state.filterPageStartOverflow];
            }

            const result = await fillFilteredOrdersPage({
                startCursor,
                initialOverflow,
            });

            state.rows = result.rows;
            state.filterOverflow = result.overflow;
            state.filterFetchCursor = result.fetchCursor;
            state.filterHasMore = result.hasMore;
            state.pageCursor = startCursor;
            state.filterPageStartOverflow = initialOverflow;
            state.nextPageInfo = result.hasMore ? "filtered" : null;
            state.previousPageInfo =
                state.filterPageStack.length > 0 ? "filtered" : null;
        } else {
            resetFilterPaginationState();

            const data = await fetchOrdersApiBatch(pageInfo);
            const batch = await normalizeOrdersBatch(
                data.orders || [],
                data.products
            );

            state.rows = batch;
            state.nextPageInfo = data.nextPageInfo || null;
            state.previousPageInfo = data.previousPageInfo || null;
            state.pageCursor = pageInfo;

            if (direction === "next") state.pageNumber += 1;
            else if (direction === "prev") {
                state.pageNumber = Math.max(1, state.pageNumber - 1);
            } else if (!pageInfo) state.pageNumber = 1;
        }

        populateFilterOptions();
        renderTable();

        lastOrdersFetchAt = Date.now();
        ordersFetchComplete = true;

        if (!useBackground) setStatus("");
        void runOrdersPostLoadTasks(state.rows);

        if (state.selectedOrderId) {
            const still = state.rows.some(
                (r) => String(r.id) === String(state.selectedOrderId)
            );
            if (still || !state.detailOrder) {
                await openOrderDetail(state.selectedOrderId, { background });
            }
        }
    } catch (e) {
        if (!useBackground) setStatus(e.message || String(e), true);
    } finally {
        ordersFetchInProgress = false;
        if (useBackground) {
            setOrdersSyncing(false);
        } else {
            state.loading = false;
            els.listPane?.classList.remove("list-pane--loading");
        }
        updatePaginationUi();
    }
}

function populateFilterOptions() {
    const statuses = [
        ...new Set(state.rows.map((r) => r.orderStatus).filter(Boolean)),
    ].sort(
        (a, b) => ORDER_STATUS_SORT.indexOf(a) - ORDER_STATUS_SORT.indexOf(b)
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

    const keep = {
        status: els.finStatus.value,
        product: els.filterProduct.value,
        ptype: els.filterProductType.value,
    };

    els.finStatus.innerHTML =
        '<option value="">All</option>' +
        statuses
            .map(
                (key) =>
                    `<option value="${escapeHtml(key)}">${escapeHtml(ORDER_STATUS_LABEL[key] || key)}</option>`
            )
            .join("");
    els.filterProduct.innerHTML =
        '<option value="">All</option>' +
        products.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
    els.filterProductType.innerHTML =
        '<option value="">All</option>' +
        types.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");

    if (statuses.includes(keep.status)) els.finStatus.value = keep.status;
    if (products.includes(keep.product)) els.filterProduct.value = keep.product;
    if (types.includes(keep.ptype)) els.filterProductType.value = keep.ptype;
}

async function postOrderAction(orderId, action, intent = null) {
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
    const { res, data } = await fetchJsonWithRetry(url, opts);
    if (!res.ok) {
        const msg =
            data.error ||
            (res.status === 406
                ? "This action is not supported for this order."
                : res.statusText) ||
            "Request failed";
        throw new Error(data.hint ? `${msg} ${data.hint}` : msg);
    }
    return data;
}

async function runBatchAction(def) {
    if (state.batchActionInProgress || !def) return;
    const targets = selectedRowsForBatchAction(def);
    if (!targets.length) return;

    state.batchActionInProgress = true;
    updateBatchSelectionUi();
    let done = 0;
    let failed = 0;
    const pendingLabel = actionPendingLabel(def.action, def.intent);
    try {
        for (const row of targets) {
            setStatus(`${pendingLabel.replace(/…$/, "")} ${done + 1} of ${targets.length}…`);
            try {
                await postOrderAction(row.id, def.action, def.intent);
                await refreshOrderAfterAction(row.id);
                state.selectedOrderIds.delete(String(row.id));
                done += 1;
            } catch (e) {
                failed += 1;
                setStatus(
                    `${row.name}: ${e.message || String(e)}`,
                    true
                );
                break;
            }
            if (done < targets.length) await sleep(650);
        }
        if (!failed) {
            const doneLabel =
                def.action === "mark-paid"
                    ? done === 1
                        ? "1 order marked as paid."
                        : `${done} orders marked as paid.`
                    : done === 1
                      ? `1 order updated.`
                      : `${done} orders updated.`;
            setStatus(doneLabel);
        }
    } finally {
        state.batchActionInProgress = false;
        updateBatchSelectionUi();
    }
}

async function runOrderAction(orderId, action, intent = null, triggerBtn = null) {
    setStatus("");
    if (action === "cancel") {
        const order =
            state.detailOrder ||
            state.rows.find((r) => String(r.id) === String(orderId));
        const choice = await confirmCancelOrder(order || {});
        if (!choice) return;
        setActionButtonPending(triggerBtn, "Cancelling…");
        try {
            await postCancelOrder(orderId, { refund: choice.refund });
            setStatus("");
            closeOrderDetail();
            await fetchOrders(state.pageCursor, "stay", { background: true });
        } catch (e) {
            resetActionButton(triggerBtn);
            setStatus(e.message || String(e), true);
        }
        return;
    }

    if (action === "refund") {
        if (!(await confirmRefundPayment())) return;
        setActionButtonPending(triggerBtn, "Refunding…");
        try {
            await postRefundOrder(orderId);
            setStatus("");
            await refreshOrderAfterAction(orderId);
        } catch (e) {
            resetActionButton(triggerBtn);
            setStatus(e.message || String(e), true);
        }
        return;
    }

    setActionButtonPending(
        triggerBtn,
        actionPendingLabel(action, intent)
    );
    try {
        await postOrderAction(orderId, action, intent);
        setStatus("");
        await refreshOrderAfterAction(orderId);
    } catch (e) {
        resetActionButton(triggerBtn);
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
    if (state.selectionMode) return;
    const el = target.closest("[data-order-id]");
    if (!el) return;
    const orderId = el.getAttribute("data-order-id");
    if (orderId) openOrderDetail(orderId);
}

function handleBatchSelectTarget(target) {
    const input = target.closest("[data-batch-select]");
    if (!input) return false;
    const orderId = input.getAttribute("data-batch-select");
    if (!orderId) return false;
    toggleOrderSelected(orderId, input.checked);
    return true;
}

function setupTableRowClicks() {
    els.tbody.addEventListener("click", (ev) => {
        if (handleBatchSelectTarget(ev.target)) {
            ev.stopPropagation();
            return;
        }
        if (state.selectionMode) {
            const row = ev.target.closest("tr[data-order-id]");
            if (!row) return;
            const id = row.getAttribute("data-order-id");
            const dataRow = state.rows.find(
                (r) => String(r.id) === String(id)
            );
            if (!orderHasAnyBatchAction(dataRow)) return;
            toggleOrderSelected(id);
            ev.preventDefault();
            return;
        }
        openOrderFromListTarget(ev.target);
    });
    els.tbody.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        if (state.selectionMode) return;
        openOrderFromListTarget(ev.target);
    });
}

function setupCardListClicks() {
    if (!els.ordersCardList) return;
    els.ordersCardList.addEventListener("click", (ev) => {
        if (handleBatchSelectTarget(ev.target)) {
            ev.stopPropagation();
            return;
        }
        if (state.selectionMode) {
            const card = ev.target.closest("[data-order-id]");
            if (!card) return;
            const id = card.getAttribute("data-order-id");
            const dataRow = state.rows.find(
                (r) => String(r.id) === String(id)
            );
            if (!orderHasAnyBatchAction(dataRow)) return;
            toggleOrderSelected(id);
            ev.preventDefault();
            return;
        }
        openOrderFromListTarget(ev.target);
    });
    els.ordersCardList.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        if (state.selectionMode) return;
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

function activeFilterCount() {
    let count = 0;
    if (els.search?.value.trim()) count += 1;
    if (els.finStatus?.value) count += 1;
    if (state.productQueueFilter) count += 1;
    if (els.filterProduct?.value) count += 1;
    if (els.filterProductType?.value) count += 1;
    if (els.filterDelivery?.value) count += 1;
    return count;
}

function setFiltersExpanded(expanded) {
    if (!els.filtersBar || !els.btnFiltersToggle) return;
    const open = Boolean(expanded) && isMobileViewport();
    els.filtersBar.classList.toggle("filters-expanded", open);
    els.btnFiltersToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function updateFiltersUi() {
    const count = activeFilterCount();
    if (els.filtersActiveBadge) {
        els.filtersActiveBadge.textContent = count > 0 ? String(count) : "";
        els.filtersActiveBadge.classList.toggle("hidden", count === 0);
        els.filtersActiveBadge.setAttribute(
            "aria-hidden",
            count > 0 ? "false" : "true"
        );
    }
    els.btnFiltersToggle?.classList.toggle(
        "filters-toggle-btn--active",
        count > 0
    );
    if (!isMobileViewport()) {
        setFiltersExpanded(false);
    }
}

function initUi() {
    if (!isLiveHost()) {
        setStatus("Orders API is not available on this site.", true);
        els.btnPrev.disabled = true;
        els.btnNext.disabled = true;
    }

    els.btnPrev.addEventListener("click", () => {
        if (needsServerOrderScan()) {
            if (state.filterPageStack.length === 0) return;
            setSelectionMode(false);
            fetchOrders(null, "prev");
            return;
        }
        if (state.previousPageInfo) {
            setSelectionMode(false);
            fetchOrders(state.previousPageInfo, "prev");
        }
    });
    els.btnNext.addEventListener("click", () => {
        if (needsServerOrderScan()) {
            if (!state.filterHasMore) return;
            setSelectionMode(false);
            fetchOrders(null, "next");
            return;
        }
        if (state.nextPageInfo) {
            setSelectionMode(false);
            fetchOrders(state.nextPageInfo, "next");
        }
    });
    els.search.addEventListener("input", () => {
        updateFiltersUi();
        clearTimeout(filterSearchDebounceTimer);
        filterSearchDebounceTimer = setTimeout(() => {
            handleListFilterChange();
        }, FILTER_SEARCH_DEBOUNCE_MS);
    });
    const onFilterChange = () => {
        handleListFilterChange();
    };
    els.finStatus.addEventListener("change", onFilterChange);
    els.filterProduct.addEventListener("change", onFilterChange);
    els.filterProductType.addEventListener("change", onFilterChange);
    els.filterDelivery.addEventListener("change", onFilterChange);

    els.btnFiltersToggle?.addEventListener("click", () => {
        const open = !els.filtersBar?.classList.contains("filters-expanded");
        setFiltersExpanded(open);
    });

    els.btnProductQueue?.addEventListener("click", () => {
        state.productQueueFilter = !state.productQueueFilter;
        updateProductQueueUi();
        handleListFilterChange();
    });

    els.btnSelectMode?.addEventListener("click", () => {
        setSelectionMode(!state.selectionMode);
    });
    els.btnBatchClear?.addEventListener("click", () => {
        clearOrderSelection();
    });
    els.batchActionButtons?.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-batch-action]");
        if (!btn || btn.disabled) return;
        const id = btn.getAttribute("data-batch-action");
        const def = BATCH_ACTION_DEFS.find((d) => d.id === id);
        if (def) void runBatchAction(def);
    });
    els.batchSelectAll?.addEventListener("change", (ev) => {
        const checked = ev.target.checked;
        for (const r of batchSelectableRows()) {
            const key = String(r.id);
            if (checked) state.selectedOrderIds.add(key);
            else state.selectedOrderIds.delete(key);
        }
        updateBatchSelectionUi();
    });

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
                if (needsServerOrderScan()) refetchOrdersForFilters();
                else applyClientListFilters();
            });
        });
    }

    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && state.selectionMode) {
            setSelectionMode(false);
            return;
        }
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
        updateFiltersUi();
        renderTable();
    });
    updateFiltersUi();
    updateProductQueueUi();
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
    const deepLinkRaw = new URLSearchParams(window.location.search).get("order");
    if (isLiveHost()) {
        await Promise.all([fetchConfig(), fetchOrders(null, "replace")]);
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
