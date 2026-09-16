/**
 * Cup count uses only the `countsAsCup` tag.
 * Set it on the menu category (or item). Nothing else classifies a cup:
 * not product names, not menuItemId prefixes, not type, not hardcoded ids.
 */

export function isCupItem(item, menu) {
  if (!item) return false;
  if (typeof item.countsAsCup === 'boolean') return item.countsAsCup;
  if (typeof item.category?.countsAsCup === 'boolean') return item.category.countsAsCup;

  const categoryId = item.categoryId;
  if (!menu || !categoryId) return false;

  const category = (menu.categories || []).find((c) => c && c.id === categoryId);
  if (typeof category?.countsAsCup === 'boolean') return category.countsAsCup;

  const menuItem = (menu.items || []).find((m) => (
    m && m.categoryId === categoryId && m.name === item.name && typeof m.countsAsCup === 'boolean'
  ));
  if (menuItem) return menuItem.countsAsCup;

  return false;
}

export function countCupsInItems(items, menu) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    if (!isCupItem(item, menu)) return sum;
    return sum + (item.quantity || 1);
  }, 0);
}
