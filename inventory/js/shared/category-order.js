/**
 * Shared category order for Daily, Weekly, Order View, and Master Items.
 * Source of truth is the `categories` collection `order` field (what Rearrange uses).
 * Item `categoryOrder` is only a fallback for names not in that collection.
 */

export function buildCategoryOrderMap(categoryDocs = [], items = []) {
  const map = Object.create(null);
  for (const cat of categoryDocs) {
    if (cat?.name && typeof cat.order === 'number') {
      map[cat.name] = cat.order;
    }
  }
  for (const item of items) {
    if (item?.category && map[item.category] === undefined) {
      map[item.category] = item.categoryOrder ?? 999;
    }
  }
  return map;
}

export function categoryRank(name, orderMap, fallback = 999) {
  if (name != null && orderMap && Object.prototype.hasOwnProperty.call(orderMap, name)) {
    return orderMap[name];
  }
  return fallback ?? 999;
}

export function compareCategoryNames(nameA, nameB, orderMap, fallbackA = 999, fallbackB = 999) {
  const rankA = categoryRank(nameA, orderMap, fallbackA);
  const rankB = categoryRank(nameB, orderMap, fallbackB);
  if (rankA !== rankB) return rankA - rankB;
  return String(nameA || '').localeCompare(String(nameB || ''));
}

export function compareItemsByCategoryOrder(a, b, orderMap) {
  const cmp = compareCategoryNames(
    a?.category,
    b?.category,
    orderMap,
    a?.categoryOrder ?? 999,
    b?.categoryOrder ?? 999
  );
  if (cmp !== 0) return cmp;
  return (a?.displayOrder ?? a?.order ?? 0) - (b?.displayOrder ?? b?.order ?? 0);
}

export function uniqueSortedCategoryNames(items, orderMap) {
  const present = [...new Set((items || []).map((item) => item?.category).filter(Boolean))];
  return present.sort((a, b) => compareCategoryNames(a, b, orderMap));
}
