/** Shared pickup/shipping detection (mirrors server.mjs). */

export function fulfillmentOrderMethodType(fo) {
    return (fo.delivery_method?.method_type || "")
        .toLowerCase()
        .replace(/-/g, "_");
}

export function isLocalPickupFulfillmentOrder(fo) {
    const mt = fulfillmentOrderMethodType(fo);
    return mt === "pick_up" || mt === "pickup" || mt === "retail";
}

function hasShipToAddress(fo, order) {
    const dest = fo?.destination || order?.shipping_address || {};
    return Boolean(String(dest.address1 || "").trim());
}

export function isMerchantPickupFulfillmentOrder(fo, order) {
    const mt = fulfillmentOrderMethodType(fo);
    if (mt === "pick_up" || mt === "pickup") return true;
    if (mt === "retail") return true;
    if (mt === "shipping" || mt === "local") return false;
    if (mt === "none") {
        const hasLocation =
            Boolean(fo.assigned_location?.location_id) ||
            Boolean(fo.assigned_location?.name);
        if (!hasLocation) return false;
        if (hasShipToAddress(fo, order)) return false;
        return true;
    }
    return false;
}

function isShippingFulfillmentOrder(fo, order) {
    const mt = fulfillmentOrderMethodType(fo);
    if (mt === "shipping" || mt === "local") return true;
    if (hasShipToAddress(fo, order)) return true;
    return false;
}

function pickupLabelFromFulfillmentOrder(fo) {
    const loc = fo.assigned_location?.name;
    const presented = fo.delivery_method?.presented_name;
    if (loc) return loc;
    if (presented && !/^shipping$/i.test(presented)) return presented;
    return "Store pickup";
}

export function deliveryMethodDisplayText(deliveryMethod, deliveryLabel) {
    if (deliveryMethod === "pickup") {
        const loc = (deliveryLabel || "").trim();
        return loc ? `Pickup in store at ${loc}` : "Pickup in store";
    }
    if (deliveryMethod === "shipping") {
        return deliveryLabel || "Shipping";
    }
    if (deliveryMethod === "none") {
        return deliveryLabel || "Shipping not required";
    }
    return deliveryLabel || "—";
}

export function normalizeDeliveryDisplayLabel(deliveryMethod, rawLabel = "") {
    const label = String(rawLabel || "").trim();
    const combined = label.toLowerCase();

    if (
        deliveryMethod === "pickup" ||
        combined.includes("pickup") ||
        combined.includes("pick up") ||
        combined.includes("pick-up") ||
        combined.includes("podium") ||
        combined.includes("in store") ||
        combined.includes("in-store")
    ) {
        return "Pickup";
    }
    if (combined.includes("nationwide")) {
        return "Nationwide";
    }
    if (combined.includes("metro")) {
        return "Metro Manila";
    }
    if (deliveryMethod === "shipping") {
        return label || "Shipping";
    }
    if (deliveryMethod === "none") {
        return "";
    }
    return label || "";
}

export function inferDeliveryFromOrder(order) {
    const shippingLines = order.shipping_lines || [];
    const combined = shippingLines
        .map((sl) => (sl.title || sl.code || "").toLowerCase())
        .join(" ");
    const label =
        shippingLines[0]?.title || shippingLines[0]?.code || "";
    const lineItems = order.line_items || [];
    const allNoShipping =
        lineItems.length > 0 &&
        lineItems.every((li) => li.requires_shipping === false);
    const noShipAddr =
        !order.shipping_address ||
        !String(order.shipping_address.address1 || "").trim();

    if (
        combined.includes("pickup") ||
        combined.includes("pick up") ||
        combined.includes("pick-up") ||
        combined.includes("in store") ||
        combined.includes("in-store")
    ) {
        return { deliveryMethod: "pickup", deliveryLabel: label || "Pickup" };
    }
    if (
        combined.includes("delivery") ||
        combined.includes("nationwide") ||
        combined.includes("metro") ||
        combined.includes("courier") ||
        (combined.includes("ship") && !combined.includes("not required"))
    ) {
        return {
            deliveryMethod: "shipping",
            deliveryLabel: label || "Shipping",
        };
    }
    if (noShipAddr && shippingLines.length) {
        const sl = shippingLines[0];
        const price = Number(sl.discounted_price ?? sl.price);
        if (price === 0 && (sl.title || sl.code)) {
            return {
                deliveryMethod: "pickup",
                deliveryLabel: sl.title || sl.code || "Pickup",
            };
        }
    }
    if (
        combined.includes("shipping not required") ||
        (allNoShipping && noShipAddr)
    ) {
        return {
            deliveryMethod: "none",
            deliveryLabel: label || "Shipping not required",
        };
    }
    return { deliveryMethod: "unknown", deliveryLabel: label || "—" };
}

function pickupStageFromFulfillments(order) {
    const fulfillments = order.fulfillments || [];
    for (const f of fulfillments) {
        if (f.status === "cancelled") continue;
        const ss = (f.shipment_status || "").toLowerCase();
        if (ss === "ready_for_pickup") return "ready_for_pickup";
        if (ss === "picked_up") return "picked_up";
    }
    const fs = (order.fulfillment_status || "").toLowerCase();
    if (fs === "fulfilled") return "fulfilled";
    if (fs === "partial") return "partial";
    return "unfulfilled";
}

function workshopFulfillmentContext() {
    return {
        deliveryMethod: "none",
        deliveryLabel: "Shipping not required",
        deliveryMethodDisplay: "Workshop · Shipping not required",
        displayFulfillment: null,
        pickupStage: null,
        pickupFulfillmentOrderIds: [],
        canMarkReadyForPickup: false,
        canMarkPickedUp: false,
    };
}

export function buildFulfillmentContext(order, fulfillmentOrders, options = {}) {
    if (options.isWorkshop) {
        return workshopFulfillmentContext();
    }

    const fos = fulfillmentOrders || [];
    const pickUpFOs = fos.filter((fo) =>
        isMerchantPickupFulfillmentOrder(fo, order)
    );
    const shippingFOs = fos.filter(
        (fo) =>
            isShippingFulfillmentOrder(fo, order) &&
            !isMerchantPickupFulfillmentOrder(fo, order)
    );

    let deliveryMethod;
    let deliveryLabel;
    if (pickUpFOs.length) {
        deliveryMethod = "pickup";
        deliveryLabel = pickupLabelFromFulfillmentOrder(pickUpFOs[0]);
    } else if (shippingFOs.length) {
        deliveryMethod = "shipping";
        const dm = shippingFOs[0].delivery_method || {};
        deliveryLabel = dm.presented_name || dm.title || "Shipping";
    } else {
        const inferred = inferDeliveryFromOrder(order);
        deliveryMethod = inferred.deliveryMethod;
        deliveryLabel = inferred.deliveryLabel;
    }

    let pickupStage = null;
    let canMarkReadyForPickup = false;
    let canMarkPickedUp = false;
    const pickupFulfillmentOrderIds = [];
    let displayFulfillment = null;

    if (deliveryMethod === "pickup") {
        const localPickUpFOs = pickUpFOs.filter((fo) =>
            isLocalPickupFulfillmentOrder(fo)
        );
        const supportsLocalPickup = localPickUpFOs.length > 0;

        pickupStage = pickupStageFromFulfillments(order);
        for (const fo of pickUpFOs) {
            if (["open", "in_progress", "scheduled"].includes(fo.status)) {
                pickupFulfillmentOrderIds.push(fo.id);
            }
        }

        const hasOpenPickup = pickUpFOs.some(
            (fo) =>
                ["open", "scheduled"].includes(fo.status) &&
                (fo.line_items || []).some((li) => li.fulfillable_quantity > 0)
        );
        const hasInProgressPickup = localPickUpFOs.some(
            (fo) => fo.status === "in_progress"
        );

        if (hasInProgressPickup) {
            pickupStage = "ready_for_pickup";
            displayFulfillment = "Ready for pickup";
        }

        if (pickupStage === "picked_up" || pickupStage === "fulfilled") {
            canMarkReadyForPickup = false;
            canMarkPickedUp = false;
            if (pickupStage === "fulfilled") displayFulfillment = "Fulfilled";
        } else if (supportsLocalPickup) {
            if (
                pickupStage === "ready_for_pickup" ||
                hasInProgressPickup
            ) {
                canMarkReadyForPickup = false;
                canMarkPickedUp = true;
                displayFulfillment = "Ready for pickup";
            } else if (pickupStage === "unfulfilled" || pickupStage === "partial") {
                canMarkReadyForPickup = hasOpenPickup;
                canMarkPickedUp = false;
                displayFulfillment = "Unfulfilled";
            }
        } else if (pickupStage === "unfulfilled" || pickupStage === "partial") {
            canMarkReadyForPickup = false;
            canMarkPickedUp = false;
            displayFulfillment = "Unfulfilled";
        }
    }

    return {
        deliveryMethod,
        deliveryLabel,
        deliveryMethodDisplay: deliveryMethodDisplayText(
            deliveryMethod,
            deliveryLabel
        ),
        displayFulfillment,
        pickupStage,
        pickupFulfillmentOrderIds,
        canMarkReadyForPickup,
        canMarkPickedUp,
        supportsLocalPickup:
            deliveryMethod === "pickup"
                ? pickUpFOs.some((fo) => isLocalPickupFulfillmentOrder(fo))
                : false,
    };
}
