import { formatSessionDate, formatTime12 } from "../js/session-utils.js";

/**
 * Line item properties compatible with shopify-orders / Easy Booking parsers.
 */
export function buildCartProperties(session, attendee = {}) {
    const name = String(attendee.name || "").trim();
    const email = String(attendee.email || "").trim();
    const phone = String(attendee.phone || "").trim();

    return {
        Date: formatSessionDate(session.date),
        Time: formatTime12(session.startTime),
        "_End Time": formatTime12(session.endTime),
        "_Event #": session.id,
        "_Booked With": String(session.eventType || "").trim(),
        "_Full Name of Participant": name,
        "_E-mail Address": email,
        "_Contact Number": phone,
    };
}

function cartAddUrl() {
    const root = window.Shopify?.routes?.root || "/";
    return `${root}cart/add.js`;
}

/**
 * @param {{ variantId: string|number, quantity?: number, properties: object }} input
 */
export async function addSessionToCart({ variantId, quantity = 1, properties }) {
    const id = Number(variantId);
    if (!id) throw new Error("Missing product variant ID.");

    const res = await fetch(cartAddUrl(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
            items: [{
                id,
                quantity: Math.max(1, Number(quantity) || 1),
                properties,
            }],
        }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.description || data?.message || `Cart error (${res.status})`;
        throw new Error(msg);
    }
    return data;
}

export function redirectToCart() {
    const root = window.Shopify?.routes?.root || "/";
    window.location.href = `${root}cart`;
}
