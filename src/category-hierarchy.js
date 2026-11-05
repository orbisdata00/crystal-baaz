import { collections, navigation, catalogGroups, selectProducts } from "./catalog.js";
import iconRegistry from "./data/category-icons.json" with { type: "json" };

// Only supplied category artwork belongs here. Product photos are not category icons.
export const categoryIconMap = iconRegistry.icons;
const collectionRegistry = new Map(collections.map((item) => [item.handle, item]));
const groupRegistry = new Map(catalogGroups.map((item) => [item.id, item]));
const navRegistry = new Map(navigation.map((item) => [item.label, item]));
const itemId = (item) => `${item.kind}:${item.target}`;
const unique = (items) => [...new Map(items.map((item) => [itemId(item), item])).values()];
const explicitItem = (item) => item.kind === "collection" ? collectionRegistry.has(item.target) : item.kind === "group" ? groupRegistry.has(item.target) : item.kind === "zodiac";

function decorate(item, parentId, displayOrder) {
  const iconKey = parentId ? `${parentId}/${itemId(item)}` : `parent/${item.id}`;
  return {
    ...item,
    id: parentId ? itemId(item) : item.id,
    parentId: parentId || null,
    iconKey,
    iconUrl: categoryIconMap[iconKey] || null,
    displayOrder,
    membershipVerified: item.kind !== "zodiac",
  };
}

function navParent(id, label, sourceLabel, extra = {}) {
  const source = navRegistry.get(sourceLabel);
  const sourceItems = [...(source?.items || []), ...(source?.formItems || [])];
  const items = unique(sourceItems.filter((item) => explicitItem(item) && (id !== "zodiac" || item.kind === "zodiac"))).map((item, index) => {
    const result = decorate(item, id, index);
    if (source?.kind === "collection" && collectionRegistry.has(source.target)) result.requiredCollectionHandle = source.target;
    // The navigation links broad collections under Rudraksha, but supplies no
    // parent membership. Showing every bracelet/mala here would invent a scope.
    if (id === "rudraksha" && item.kind === "collection" && !collectionRegistry.has(source?.target)) {
      result.membershipVerified = false;
      result.mappingIssue = "Rudraksha-specific product membership has not been supplied for this collection.";
    }
    if (item.kind === "zodiac") result.mappingIssue = "The sign is listed in navigation; explicit product-to-sign membership is missing.";
    return result;
  });
  return { id, label, source: `navigation:${sourceLabel}`, items, ...extra };
}

function leaf(id, label, kind, target, aliases = []) {
  return { id, label, kind, target, aliases, items: [], source: `${kind}:${target}` };
}

const parents = [
  { id: "all", label: "All Categories", aliases: ["Category", "All"], source: "workbook:collections-and-groups", items: unique([
    ...collections.map((item) => ({ kind: "collection", target: item.handle, label: item.title })),
    ...catalogGroups.map((item) => ({ kind: "group", target: item.id, label: item.title })),
  ]).map((item, index) => decorate(item, "all", index)) },
  leaf("mala", "Mala", "collection", "mala"),
  leaf("rashi-rings", "Rashi Rings", "group", "group-rashirings", ["Rashi Ring"]),
  leaf("rashi-pendants", "Rashi Pendants", "group", "group-rashipendants", ["Rashi Pendant"]),
  navParent("zodiac", "Zodiac Signs", "Rashi | Zodiac", { aliases: ["Zodiac Sign", "Rashi | Zodiac"] }),
  navParent("rudraksha", "Rudraksha", "Rudraksha"),
  navParent("crystals", "Crystals", "Crystal", { aliases: ["Crystal"] }),
  navParent("bracelets", "Bracelets", "Bracelets", { kind: "collection", target: "bracelets" }),
  leaf("pendants", "Pendants", "collection", "pendants"),
  navParent("pooja", "Pooja", "Puja", { aliases: ["Puja"] }),
  leaf("decor", "Home Decor / Vastu", "collection", "home-decor-vastu", ["Decor", "Home Decor/Vastu"]),
  navParent("intentions", "Problem / Intention", "Remedy", { aliases: ["Problem", "Remedy", "Intention"] }),
];

// Leaf groups remain direct product views until actual child relationships exist.
const mappedParents = new Map(parents.filter((parent) => parent.kind).map((parent) => [itemId(parent), parent.id]));
export const categoryParents = parents.map((parent, index) => ({
  ...decorate(parent, null, index),
  items: parent.items.map((item) => ({ ...item, relatedParentId: parent.id === "all" ? mappedParents.get(item.id) || null : null })),
}));

export function getParentCategory(idOrLabel = "all") {
  const value = String(idOrLabel).toLowerCase();
  return categoryParents.find((parent) => [parent.id, parent.label, ...(parent.aliases || [])].some((candidate) => candidate.toLowerCase() === value)) || null;
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
    parent = categoryParents.find((candidate) => candidate.kind && itemId(candidate) === id) || getParentCategory("all");
    directItem = parent.kind && itemId(parent) === id ? parent : null;
    requestedItemId = directItem ? "" : id;
  }
  parent ||= getParentCategory("all");
  let item = directItem || (requestedItemId ? parent.items.find((candidate) => candidate.id === requestedItemId) || (parent.kind && itemId(parent) === requestedItemId ? parent : null) : null);
  if (requestedItemId && !item) invalidSelection = true;
  if (!parent.items.length && parent.kind && !requestedItemId) item = parent;
  return { parent, item, parents: categoryParents, items: parent.items, state: item ? "products" : "overview", invalidSelection };
}

export function productsForCategory(products, item, { sort = "featured", query = "" } = {}) {
  if (!item || item.membershipVerified === false || !["collection", "group"].includes(item.kind)) return [];
  let matches = selectProducts(products, { filter: { kind: item.kind, value: item.target }, sort, query });
  if (item.requiredCollectionHandle && item.requiredCollectionHandle !== item.target) {
    matches = selectProducts(matches, { filter: { kind: "collection", value: item.requiredCollectionHandle }, sort });
  }
  return matches;
}
