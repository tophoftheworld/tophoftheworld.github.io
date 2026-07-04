function normalizeProps(properties) {
    return (properties || []).map((p) => ({
        name: p.name,
        value: p.value,
    }));
}

export function formatBundleTitle(title) {
    const raw = String(title || "").trim();
    if (!raw) return "Bundle";
    if (raw === raw.toUpperCase() && raw.includes("+")) {
        return raw
            .split("+")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
            .join(" + ");
    }
    return raw;
}

export function bundleMetaFromLineItemProperties(properties) {
    const props = normalizeProps(properties);
    let bundleId = "";
    let bundleTitle = "";
    let parentVariantId = "";
    for (const p of props) {
        const name = String(p.name || "").trim();
        const lower = name.toLowerCase();
        const value = String(p.value || "").trim();
        if (!value) continue;
        if (
            lower === "_bundle_id" ||
            lower === "__bundle_id" ||
            lower === "bundle id" ||
            lower === "bundle_id"
        ) {
            bundleId = value;
        }
        if (lower === "bundle" || lower === "_bundle") {
            bundleTitle = value;
        }
        if (
            lower === "_bundle_parent_variant_id" ||
            lower === "_bundle_parent"
        ) {
            parentVariantId = value;
        }
    }
    if (parentVariantId) {
        return {
            groupId: `parent:${parentVariantId}`,
            bundleTitle: bundleTitle ? formatBundleTitle(bundleTitle) : null,
            bundleQuantity: 1,
        };
    }
    if (!bundleId) return null;
    return {
        groupId: `prop:${bundleId}`,
        bundleTitle: formatBundleTitle(bundleTitle || "Bundle"),
        bundleQuantity: 1,
    };
}

export function bundleMetaFromRestLineItem(li) {
    const groupId = li.sales_line_item_group_id;
    if (groupId == null || groupId === "") return null;
    return {
        groupId: String(groupId),
        bundleTitle: null,
        bundleQuantity: 1,
    };
}

export function bundleComponentShortName(title) {
    const t = String(title || "").trim();
    if (/hojicha/i.test(t)) return "Hojicha";
    if (/matcha|aki|signature blend/i.test(t)) return "Matcha";
    const head = t.split(/[-|]/)[0]?.trim();
    return head || t;
}

export function inferBundleTitleFromLineItems(lineItems) {
    const names = [
        ...new Set(
            (lineItems || []).map((li) =>
                bundleComponentShortName(li.title || li.name || "")
            )
        ),
    ].filter(Boolean);
    if (names.length >= 2) return names.join(" + ");
    if (names.length === 1) return names[0];
    return "Bundle";
}

function isProratedBundleComponentPrice(price) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return false;
    const cents = Math.round(Math.abs(p * 100)) % 100;
    return cents !== 0;
}

export function inferBundleGroupsFromLineItems(rawLineItems, existingMeta = {}) {
    const inferred = {};
    const items = rawLineItems || [];
    let i = 0;
    while (i < items.length) {
        if (
            existingMeta[String(items[i].id)] ||
            inferred[String(items[i].id)] ||
            !isProratedBundleComponentPrice(items[i].price)
        ) {
            i++;
            continue;
        }
        let j = i;
        while (
            j < items.length &&
            !existingMeta[String(items[j].id)] &&
            !inferred[String(items[j].id)] &&
            isProratedBundleComponentPrice(items[j].price)
        ) {
            j++;
        }
        const run = items.slice(i, j);
        if (run.length >= 2) {
            const groupId = `inferred:${run.map((li) => li.id).join("-")}`;
            const bundleTitle = inferBundleTitleFromLineItems(run);
            for (const li of run) {
                inferred[String(li.id)] = {
                    groupId,
                    bundleTitle,
                    bundleQuantity: 1,
                };
            }
        }
        i = j;
    }
    return inferred;
}

function fillBundleTitlesFromGroups(rawLineItems, merged) {
    const groups = new Map();
    for (const li of rawLineItems || []) {
        const meta = merged[String(li.id)];
        if (!meta?.groupId) continue;
        if (!groups.has(meta.groupId)) groups.set(meta.groupId, []);
        groups.get(meta.groupId).push(li);
    }
    for (const [, items] of groups) {
        const title = inferBundleTitleFromLineItems(items);
        for (const li of items) {
            const meta = merged[String(li.id)];
            if (!meta.bundleTitle) {
                meta.bundleTitle = title;
            } else {
                meta.bundleTitle = formatBundleTitle(meta.bundleTitle);
            }
        }
    }
}

export function mergeLineItemBundleMeta(rawLineItems, graphqlMeta = {}) {
    const merged = { ...graphqlMeta };
    for (const li of rawLineItems || []) {
        const id = String(li.id);
        if (merged[id]) continue;
        const fromRest = bundleMetaFromRestLineItem(li);
        if (fromRest) {
            merged[id] = fromRest;
            continue;
        }
        const fromProps = bundleMetaFromLineItemProperties(li.properties);
        if (fromProps) merged[id] = fromProps;
    }
    Object.assign(
        merged,
        inferBundleGroupsFromLineItems(rawLineItems, merged)
    );
    fillBundleTitlesFromGroups(rawLineItems, merged);
    return merged;
}
