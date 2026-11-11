import { collections, catalogGroups, navigation, selectProducts } from "./catalog.js";
import iconRegistry from "./data/category-icons.json";
import mainRegistry from "./data/main-categories.json";

export const categoryIconMap = iconRegistry.icons;
export const mainCategoryRules = mainRegistry.rules;
const itemId = (item) => `${item.kind}:${item.target}`;
function decorate(item, parentId, displayOrder) {
  const iconKey = parentId ? `${parentId}/${itemId(item)}` : `parent/${item.id}`;
  return { ...item, id: parentId ? itemId(item) : item.id, parentId: parentId || null, displayOrder,
    iconKey, iconUrl: categoryIconMap[iconKey] || null,
    membershipVerified: item.membershipVerified ?? item.kind !== "zodiac" };
}
const aliases = {
  zodiac: ["Zodiac Signs", "Zodiac Sign", "Rashi | Zodiac"],
  crystals: ["Crystals"], pooja: ["Pooja"], intentions: ["Problem / Intention", "Problem", "Intention", "remedy"],
};
// Presentation sequence and children come solely from MAIN, including empty nodes.
export const mainCategories = mainRegistry.mainCategories.map((parent, index) => ({
  ...decorate({ ...parent, aliases: aliases[parent.id] || [] }, null, index),
  source: `MAIN:${parent.sourceRow}`,
  items: parent.items.map((item, order) => decorate(item, parent.id, order)),
}));
export const categoryParents = mainCategories;
function leaf(id, label, kind, target, aliases = []) {
  return decorate({ id, label, kind, target, aliases, items: [] }, null, 0);
}
export const auxiliaryCategories = [
  { ...leaf("zodiac-signs", "Shop by Rashi", "category", "zodiac-signs"), items: mainRegistry.zodiacSigns.map((sign, index) => decorate(sign, "zodiac-signs", index)) },
  { ...leaf("mala", "Mala", "collection", "mala"), items: ["Pearl", "Ruby"].map((stone, index) => decorate({kind:"collection", target:`${stone.toLowerCase()}-mala`, label:`${stone} Mala`, membershipVerified:false, source:"client-request:pending-navigation", mappingIssue:`${stone} Mala is requested in navigation; verified product assignments and category artwork are still missing.`}, "mala", index)) },
  leaf("rashi-rings", "Rashi Rings", "group", "group-rashirings", ["Rashi Ring"]),
  leaf("rashi-pendants", "Rashi Pendants", "group", "group-rashipendants", ["Rashi Pendant"]),
  leaf("pendants", "Pendants", "collection", "pendants"),
  leaf("decor", "Home Decor / Vastu", "collection", "home-decor-vastu", ["Decor", "Home Decor/Vastu"]),
];
const all = { ...leaf("all", "All Categories", "category", "all", ["Category", "All"]),
  items: [...collections.map((c) => ({ kind: "collection", target: c.handle, label: c.title })),
    ...catalogGroups.map((g) => ({ kind: "group", target: g.id, label: g.title }))]
    .map((item, index) => decorate({ ...item, relatedParentId: auxiliaryCategories.find((parent) => itemId(parent) === itemId(item))?.id || null }, "all", index)) };
const contexts = [...mainCategories, ...auxiliaryCategories, all];
export function getParentCategory(idOrLabel = "all") {
  const value = String(idOrLabel).toLowerCase();
  return contexts.find((parent) => [parent.id, parent.label, ...(parent.aliases || [])].some((candidate) => candidate.toLowerCase() === value)) || null;
}
export function hierarchyHref(parentId = "all", selectedItemId = null) {
  const parent = getParentCategory(parentId);
  const params = new URLSearchParams({ group: parent?.id || "all" });
  if (selectedItemId) params.set("category", typeof selectedItemId === "object" ? itemId(selectedItemId) : selectedItemId);
  return `#collections?${params.toString()}`;
}
export function resolveHierarchy(route = {}) {
  let parent = getParentCategory(route.group || "all");
  let requestedItemId = route.category || "";
  let directItem = null;
  let invalidSelection = !parent;
  if (["collection", "group"].includes(route.page)) {
    const id = `${route.page}:${route.handle || route.id}`;
    parent = contexts.find((candidate) => ["collection", "group"].includes(candidate.kind) && itemId(candidate) === id) || all;
    directItem = itemId(parent) === id ? parent : null;
    requestedItemId = directItem ? "" : id;
  }
  parent ||= all;
  let item = directItem || (requestedItemId ? parent.items.find((candidate) => candidate.id === requestedItemId) || (itemId(parent) === requestedItemId ? parent : null) : null);
  // Old saved URLs remain resolvable without adding obsolete children to MAIN.
  if (requestedItemId && !item && parent.id === "zodiac" && requestedItemId.startsWith("zodiac:")) {
    const signs = getParentCategory("zodiac-signs");
    item = signs.items.find((candidate) => candidate.id === requestedItemId) || null;
    if (item) parent = signs;
  }
  if (requestedItemId && !item && ["bracelets", "crystals"].includes(parent.id)) {
    const source = navigation.find((candidate) => candidate.label === (parent.id === "crystals" ? "Crystal" : "Bracelets"));
    const legacy = [...(source?.items || []), ...(source?.formItems || [])].find((candidate) => itemId(candidate) === requestedItemId && candidate.kind === "collection");
    if (legacy) item = decorate({ ...legacy, ...(parent.id === "bracelets" ? { requiredCollectionHandle: "bracelets" } : {}) }, parent.id, 0);
  }
  if (requestedItemId && !item) invalidSelection = true;
  if (!parent.items.length && parent.kind !== "category" && !requestedItemId) item = parent;
  return { parent, item, parents: mainCategories, items: parent.items, state: item ? "products" : "overview", invalidSelection };
}
function ruleMatches(product, ruleName) {
  // Only identified, workbook-matched live Shopify records may use MAIN's title rules.
  if (!/^gid:\/\/shopify\/Product\//.test(product.id || "") || !product.workbookId || product.previewOnly) return false;
  const rule = mainCategoryRules[ruleName];
  if (!rule) return false;
  const title = String(product.title || "").toLowerCase();
  return (rule.collectionHandles || []).some((handle) => product.collectionHandles?.includes(handle))
    || rule.titleWords.some((word) => new RegExp(`\\b${word}\\b`, "i").test(title));
}
export function productsForCategory(products, item, { sort = "featured", query = "" } = {}) {
  if (!item || item.membershipVerified === false) return [];
  if (item.kind === "category") {
    const context = contexts.find((parent) => parent.id === item.target) || item;
    const selected = new Set((context.items || []).flatMap((child) => productsForCategory(products, child)).map((product) => product.id));
    return selectProducts(products.filter((product) => selected.has(product.id)), { sort, query });
  }
  if (item.rule || item.kind === "rule") {
    const exact = item.kind === "collection" ? selectProducts(products, { filter: { kind: "collection", value: item.target } }) : [];
    const ids = new Set(exact.map((p) => p.id));
    return selectProducts(products.filter((product) => ids.has(product.id) || ruleMatches(product, item.rule)), { sort, query });
  }
  if (!["collection", "group"].includes(item.kind)) return [];
  let matches = selectProducts(products, { filter: { kind: item.kind, value: item.target }, sort, query });
  if (item.requiredCollectionHandle && item.requiredCollectionHandle !== item.target) matches = selectProducts(matches, { filter: { kind: "collection", value: item.requiredCollectionHandle }, sort });
  return matches;
}
