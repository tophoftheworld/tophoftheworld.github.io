/** Easy Appointment Booking line-item property parsing (browser). */
import {
    formatWorkshopDisplayName,
    lineItemPropertiesFromShopify,
    parseRegistrationFromLineItem,
    propertyValueByPattern,
    sessionDateToIso,
    workshopManagementUrl,
} from "./registration-core.mjs";

export {
    formatWorkshopDisplayName,
    lineItemPropertiesFromShopify,
    propertyValueByPattern,
    sessionDateToIso,
    parseRegistrationFromLineItem,
    workshopManagementUrl,
    workshopManagementUrl as workshopRosterUrl,
};

export function collectOrderRegistrations(lineItems) {
    return (lineItems || [])
        .map(parseRegistrationFromLineItem)
        .filter(Boolean);
}

/** Merge parsed bookings with server-inferred stubs for workshop lines missing Easy Booking data. */
export function collectOrderRegistrationsForOrder(
    lineItems,
    inferredRegs = []
) {
    const inferredByLineId = Object.fromEntries(
        (inferredRegs || []).map((r) => [String(r.lineItemId), r])
    );
    const regs = [];
    for (const li of lineItems || []) {
        const parsed = parseRegistrationFromLineItem(li);
        if (parsed) {
            regs.push(parsed);
            continue;
        }
        const inf = inferredByLineId[String(li.id)];
        if (!inf) continue;
        const { lineItemId, ...reg } = inf;
        regs.push(reg);
    }
    return regs;
}
