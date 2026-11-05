import { mkdir, readFile, writeFile } from "node:fs/promises";
import { categoryParents, productsForCategory } from "../src/category-hierarchy.js";

const catalog = JSON.parse(await readFile(new URL("../src/data/client-catalog.json", import.meta.url), "utf8"));
const reportDirectory = new URL("../reports/", import.meta.url);
await mkdir(reportDirectory, { recursive: true });
const unsupportedSearchLinks = catalog.navigation.flatMap((parent) => [...(parent.items || []), ...(parent.formItems || [])]
  .filter((item) => item.kind === "search")
  .map((item) => ({ parent: parent.label, label: item.label, target: item.target, reason: "Text search is not a verified category-to-product relationship; omitted from hierarchy." })));
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
  source: "Client workbook navigation declarations, registered collections and explicit collection/group product memberships",
  scope: "This audits relationship metadata, not current Shopify inventory, prices or availability. Live Shopify product handles must be matched separately.",
  rules: [
    "No parent/child relationship is inferred from product titles, tags or crystal names.",
    "Only collectionHandles and groupIds filter products. Zodiac title matching and text-search categories are disabled in the hierarchy.",
    "A parent without declared child categories opens its direct mapped product listing.",
    "The Bracelets parent intersects child collection membership with explicit Bracelets membership.",
    "Rudraksha's broad collection children remain empty until Rudraksha-specific parent membership is supplied.",
    "No client category icon assets were supplied; text-only category controls are used.",
  ],
  parentCount: parents.length,
  parents,
  requestedExampleStatus: {
    flow: "Mala → Pearl Mala → Ruby Mala",
    status: "blocked-by-missing-verified-hierarchy",
    malaExists: true,
    malaExplicitWorkbookProducts: catalog.products.filter((product) => product.collectionHandles.includes("mala")).length,
    declaredMalaChildren: 0,
    requestedChildrenNotCreated: ["Pearl Mala", "Ruby Mala", "Emerald Mala", "Blue Sapphire Mala"],
    currentBehavior: "Mala opens its real mapped product listing directly. No 25-child hierarchy or crystal-name membership has been invented.",
    clientAction: "Provide approved Mala child definitions, explicit product handles or SKU memberships for each child, display order, and actual icon files."
  },
  unresolved: [
    { category: "Mala", issue: "No parent-to-child relationships supplied; expected approximately 25 types cannot be verified." },
    { category: "Rashi Rings", issue: "Explicit product group exists; no child category definitions supplied. Direct product listing is available." },
    { category: "Rashi Pendants", issue: "Group exists, but has no explicit product assignments or child category definitions." },
    { category: "Zodiac Signs", issue: "Twelve sign labels exist, but no explicit product-to-sign memberships. Old text matching is not accepted as proof." },
    { category: "Rudraksha", issue: "Parent collection handle is absent; linking all Bracelets, Mala or Pendants would include unrelated products. These scoped memberships need approval." },
    { category: "Home Decor / Vastu", issue: "Collection is registered but has no explicit assigned product handles." },
  ],
  unsupportedSearchLinks,
};
const nodes = categoryParents.flatMap((parent) => [
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
