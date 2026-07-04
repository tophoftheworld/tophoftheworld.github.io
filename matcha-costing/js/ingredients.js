import {
  RECIPE_BASE_NAMES,
  RECIPE_DAIRY_MILK,
  RECIPE_OAT_MILK,
} from './defaults.js';

/** @typedef {import('./defaults.js').Ingredient} Ingredient */

/** @param {Ingredient} ing */
export function costPerServing(ing) {
  if (!ing.bulkQty || ing.bulkQty <= 0) return 0;
  return (ing.bulkCost / ing.bulkQty) * ing.qtyPerServing;
}

/** @param {Ingredient[]} ingredients */
export function ingredientMap(ingredients) {
  /** @type {Map<string, Ingredient>} */
  const map = new Map();
  for (const ing of ingredients) {
    map.set(ing.name, ing);
  }
  return map;
}

/** @param {Ingredient[]} ingredients @param {string[]} names */
function sumRecipeLines(ingredients, names) {
  const map = ingredientMap(ingredients);
  let total = 0;
  for (const name of names) {
    const ing = map.get(name);
    if (ing) total += costPerServing(ing);
  }
  return total;
}

/** @param {Ingredient[]} ingredients */
export function computeCogs(ingredients) {
  const map = ingredientMap(ingredients);
  const base = sumRecipeLines(ingredients, RECIPE_BASE_NAMES);
  const dairyMilk = map.get(RECIPE_DAIRY_MILK);
  const oatMilk = map.get(RECIPE_OAT_MILK);
  const dairyMilkCost = dairyMilk ? costPerServing(dairyMilk) : 0;
  const oatMilkCost = oatMilk ? costPerServing(oatMilk) : 0;
  return {
    base,
    cogsDairy: base + dairyMilkCost,
    cogsOat: base + oatMilkCost,
  };
}

/** @param {Ingredient[]} ingredients */
export function ingredientRowsWithCosts(ingredients) {
  return ingredients.map((ing) => ({
    ...ing,
    costPerUnit: ing.bulkQty > 0 ? ing.bulkCost / ing.bulkQty : 0,
    costPerServing: costPerServing(ing),
  }));
}
