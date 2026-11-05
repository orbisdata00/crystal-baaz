import { mkdir, readFile, writeFile } from "node:fs/promises";
import { categoryParents, auxiliaryCategories, productsForCategory } from "../src/category-hierarchy.js";

const catalog = JSON.parse(await readFile(new URL("../src/data/client-catalog.json", import.meta.url), "utf8"));
const reportDirectory = new URL("../reports/", import.meta.url);
await mkdir(reportDirectory, { recursive: true });
const unsupportedSearchLinks = catalog.navigation.flatMap((parent) => [...(parent.items || []), ...(parent.formItems || [])]
  .filter((item) => item.kind === "search")
  .map((item) => ({ parent: parent.label, label: item.label, target: item.target, reason: "Legacy Structure search is not used as a MAIN membership mapping; MAIN keeps the declared node pending." })));
const parents = categoryParents.map((parent) => ({
  id: parent.id,
  label: parent.label,
  source: parent.source,
  stateOnOpen: parent.items.length ? "overview" : "products",
  childCount: parent.items.length,
  explicitWorkbookProductCount: parent.kind ? productsForCategory(catalog.products, parent).length : null,
  children: parent.items.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    target: item.target,
    membershipVerified: item.membershipVerified,
    parentCollectionConstraint: item.requiredCollectionHandle || null,
    explicitWorkbookProductCount: productsForCategory(catalog.products, item).length,
    ...(item.mappingIssue ? { mappingIssue: item.mappingIssue } : {}),
  })),
}));
const report = {
  source: "Complete client workbook MAIN declarations, registered collections and explicit collection/group product memberships",
  scope: "This audits relationship metadata, not current Shopify inventory, prices or availability. Live Shopify product handles must be matched separately.",
  rules: [
    "No parent/child relationship is inferred from product titles, tags or crystal names.",
    "Collection/group memberships plus the explicitly declared MAIN Money Magnet and Kavach rules only; rules require identified workbook-matched live Shopify products. Zodiac title matching remains disabled.",
    "A parent without declared child categories opens its direct mapped product listing.",
    "MAIN has no Bracelets children; it opens the explicit Bracelets product collection.",
    "Rudraksha Bracelet/Mala use explicit curated groups; remaining broad forms stay pending without scoped membership.",
    "No client category icon assets were supplied; text-only category controls are used.",
  ],
  parentCount: parents.length,
  parents,
  requestedExampleStatus: {
    flow: "Mala → Pearl Mala → Ruby Mala",
    status: "pending-product-membership",
    malaExists: true,
    malaExplicitWorkbookProducts: catalog.products.filter((product) => product.collectionHandles.includes("mala")).length,
    declaredMalaChildren: 2,
    requestedChildrenNotCreated: ["Emerald Mala", "Blue Sapphire Mala"],
    currentBehavior: "The client-requested Pearl and Ruby navigation labels now open honest pending states with sibling switching. Product memberships are unverified; the direct Mala collection URL still opens its actual mapped products.",
    clientAction: "Provide approved Mala child definitions, explicit product handles or SKU memberships for each child, display order, and actual icon files."
  },
  unresolved: [
    { category: "Mala", issue: "Pearl and Ruby navigation explicitly requested by client; their product assignments and icons remain unverified. Other types are not invented." },
    { category: "Rashi Rings", issue: "Explicit product group exists; no child category definitions supplied. Direct product listing is available." },
    { category: "Rashi Pendants", issue: "Group exists, but has no explicit product assignments or child category definitions." },
    { category: "Zodiac Signs", issue: "Twelve sign labels exist, but no explicit product-to-sign memberships. Old text matching is not accepted as proof." },
    { category: "Rudraksha", issue: "Bracelets and Mala use explicit curated Rudraksha groups. Other broad form links remain empty without scoped memberships." },
    { category: "Home Decor / Vastu", issue: "Collection is registered but has no explicit assigned product handles." },
  ],
  unsupportedSearchLinks,
};
const nodes = [...categoryParents, ...auxiliaryCategories].flatMap((parent) => [
  { categoryId: parent.id, parentCategoryId: null, categoryName: parent.label, kind: parent.kind || "navigation", handle: parent.target || parent.id, iconKey: parent.iconKey, iconAssetUrl: parent.iconUrl, displayOrder: parent.displayOrder },
  ...parent.items.map((item) => ({ categoryId: item.id, parentCategoryId: parent.id, categoryName: item.label, kind: item.kind, handle: item.target, iconKey: item.iconKey, iconAssetUrl: item.iconUrl, displayOrder: item.displayOrder })),
]);
const icons = {
  registry: "src/data/category-icons.json",
  instructions: "Add a client-approved asset URL under icons[iconKey]. Product images, generated artwork and unrelated fallback icons must not be substituted.",
  totalControls: nodes.length,
  suppliedAssets: nodes.filter((node) => node.iconAssetUrl).length,
  missingAssets: nodes.filter((node) => !node.iconAssetUrl).length,
  controls: nodes.map((node) => ({ ...node, active: true, supplied: Boolean(node.iconAssetUrl), status: node.iconAssetUrl ? "supplied" : "text-only-until-client-supplies-icon" })),
};
await writeFile(new URL("category-hierarchy-audit.json", reportDirectory), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL("category-icon-checklist.json", reportDirectory), `${JSON.stringify(icons, null, 2)}\n`);
console.log(JSON.stringify({ parentCount: parents.length, malaChildren: report.requestedExampleStatus.declaredMalaChildren, unsupportedSearchLinks: unsupportedSearchLinks.length, missingIcons: icons.missingAssets, report: "reports/category-hierarchy-audit.json", iconChecklist: "reports/category-icon-checklist.json" }, null, 2));
