import { readFile, writeFile } from "node:fs/promises";
import { clientProducts, formatVariantLabel, mapShopifyCatalog, normalizeShopifyProduct } from "../src/catalog.js";
import { categoryParents, productsForCategory } from "../src/category-hierarchy.js";

const [envText, appSource, configSource, catalogSource] = await Promise.all([
  readFile(new URL("../.env.local", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../src/config.js", import.meta.url), "utf8"),
  readFile(new URL("../src/catalog.js", import.meta.url), "utf8"),
]);
function readEnv(name, fallback = "") {
  const line = envText.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  if (!line) return fallback;
  return line.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
}

const storeDomain = readEnv("VITE_SHOPIFY_STORE_DOMAIN", "crystalbaaz.myshopify.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
const token = readEnv("VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN");
const apiVersion = readEnv("VITE_SHOPIFY_API_VERSION", "2026-10");
if (!token) throw new Error("Shopify Storefront public token is not configured.");

const variantFields = `nodes { id sku title availableForSale selectedOptions { name value } image { url } price { amount currencyCode } } pageInfo { hasNextPage endCursor }`;
async function storefront(query, variables = {}) {
  const response = await fetch(`https://${storeDomain}/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-storefront-access-token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Shopify Storefront request failed (${response.status}).`);
  const result = await response.json();
  if (result.errors?.length) throw new Error(`Shopify Storefront query failed: ${result.errors[0].message || "unknown error"}`);
  return result.data;
}

const products = [];
let after = null;
let hasNextPage = true;
while (hasNextPage) {
  const data = await storefront(`query VariantLabelAudit($first:Int!,$after:String){products(first:$first,after:$after,sortKey:TITLE){nodes{id title handle productType availableForSale options{name values} featuredImage{url altText} images(first:1){nodes{url altText}} priceRange{minVariantPrice{amount currencyCode}} variants(first:10){${variantFields}}} pageInfo{hasNextPage endCursor}}}`, { first: 100, after });
  const connection = data.products;
  products.push(...connection.nodes);
  hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
  after = connection.pageInfo?.endCursor || null;
  if (hasNextPage && !after) throw new Error("Shopify returned an incomplete product cursor.");
}

for (const product of products) {
  let variants = [...(product.variants?.nodes || [])];
  let pageInfo = product.variants?.pageInfo;
  while (pageInfo?.hasNextPage && pageInfo.endCursor) {
    const data = await storefront(`query VariantLabelProduct($handle:String!,$first:Int!,$after:String){product(handle:$handle){variants(first:$first,after:$after){${variantFields}}}}`, { handle: product.handle, first: 100, after: pageInfo.endCursor });
    const connection = data.product?.variants;
    if (!connection) break;
    variants.push(...connection.nodes);
    pageInfo = connection.pageInfo;
  }
  product.variants = variants;
  product.variantsComplete = !pageInfo?.hasNextPage;
}

const genericText = (value) => !String(value || "").trim() || /^(?:default title|standard|variant\s*\d+)$/i.test(String(value).trim());
const fieldLabelIsGeneric = (variant, product) => {
  const options = (variant.selectedOptions || []).filter(option => !genericText(option.value));
  const title = String(variant.title || "").trim();
  return options.length === 0 && (genericText(title) || title.toLowerCase() === String(product.title || "").trim().toLowerCase());
};
const rows = [];
const genericProducts = [];
const needsCorrection = new Set();
const optionCorrectionProducts = [];
let genericVariantCount = 0;
let skuLabeledVariantCount = 0;
for (const product of products) {
  if (product.variants.length <= 1) continue;
  const normalized = { title: product.title, options: product.options || [], variants: product.variants, variantsComplete: product.variantsComplete };
  const productRows = [];
  for (const variant of product.variants) {
    if (!fieldLabelIsGeneric(variant, product)) continue;
    genericVariantCount += 1;
    const label = formatVariantLabel(normalized, variant);
    const correction = !label;
    if (label.startsWith("SKU: ")) skuLabeledVariantCount += 1;
    if (correction) needsCorrection.add(product.handle);
    const selectedOptions = (variant.selectedOptions || []).map(option => `${option.name}: ${option.value}`).join(" | ");
    const row = {
      handle: product.handle,
      product_title: product.title,
      variant_id: variant.id,
      sku: variant.sku || "",
      shopify_variant_title: variant.title || "",
      selected_options: selectedOptions,
      price: variant.price?.amount || "",
      currency: variant.price?.currencyCode || "",
      available_for_sale: Boolean(variant.availableForSale),
      image_url: variant.image?.url || "",
      product_image_url: product.featuredImage?.url || product.images?.nodes?.[0]?.url || "",
      customer_label: label,
      merchant_correction_required: correction,
      missing_descriptive_fields: "Meaningful selected option values and variant title",
      merchant_action: correction
        ? "Add descriptive Shopify option values and assign unique variant SKUs; purchasing remains blocked until each choice is distinguishable."
        : "Add accurate Shopify option names and values for every variant. The verified SKU is only a temporary customer label.",
    };
    productRows.push(row);
    rows.push(row);
  }
  if (productRows.length) {
    const record = { handle: product.handle, title: product.title, options: product.options || [], genericVariants: productRows.length, needsMerchantCorrection: needsCorrection.has(product.handle) };
    genericProducts.push(record);
    optionCorrectionProducts.push({
      ...record,
      variants: productRows.map(({ handle, product_title, variant_id, sku, shopify_variant_title, selected_options, price, currency, available_for_sale, customer_label, merchant_correction_required, missing_descriptive_fields, merchant_action }) => ({
        variant_id, sku, shopify_variant_title, selected_options, price, currency, available_for_sale, customer_label, merchant_correction_required, missing_descriptive_fields, merchant_action,
      })),
    });
  }
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
const columns = ["handle", "product_title", "variant_id", "sku", "shopify_variant_title", "selected_options", "price", "currency", "available_for_sale", "image_url", "product_image_url", "customer_label", "merchant_correction_required", "missing_descriptive_fields", "merchant_action"];
const csv = [columns.join(","), ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\n") + "\n";
const generatedAt = new Date().toISOString();
const normalizedShopifyProducts = products.map(product => normalizeShopifyProduct({
  ...product,
  variants: { nodes: product.variants || [], pageInfo: { hasNextPage: !product.variantsComplete, endCursor: null } },
}));
const renderedCatalog = mapShopifyCatalog(normalizedShopifyProducts, clientProducts);
const shopifyHandles = new Set(products.map(product => product.handle));
const workbookHandles = new Set(clientProducts.map(product => product.handle));
const missingWorkbookProducts = clientProducts.filter(product => !shopifyHandles.has(product.handle));
const missingShopifyImages = renderedCatalog.filter(product => !product.image).map(product => ({ id: product.id, handle: product.handle, title: product.title }));
const allVariants = products.flatMap(product => (product.variants || []).map(variant => ({ ...variant, productHandle: product.handle })));
const availableVariants = allVariants.filter(variant => variant.availableForSale === true);
const validVariantId = variant => /^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(variant.id || "");
const validVariantPrice = variant => Number.isFinite(Number(variant.price?.amount)) && Number(variant.price.amount) > 0;
const mainCategoryCounts = categoryParents.map(parent => ({ id: parent.id, label: parent.label, productCount: productsForCategory(renderedCatalog, parent).length }));
const childCategoryCounts = categoryParents.flatMap(parent => parent.items.map(item => ({
  parent: parent.label,
  id: item.id,
  label: item.label,
  productCount: productsForCategory(renderedCatalog, item).length,
}))).filter(item => item.productCount === 0);
const expectedMainOrder = ["Best Seller", "New Arrivals", "Rashi / Zodiac", "Bracelets", "Rudraksha", "Crystal", "Puja", "Remedy"];
const previewLoaderCallSites = [...appSource.matchAll(/loadPreviewCatalog\s*\(/g)].length;
const previewBranchGuarded = /if\s*\(catalogService\.source\s*!==\s*["']shopify["']\)/.test(appSource);
const productionForcedToShopify = /!isProduction\s*&&\s*requestedSource\s*===\s*["']preview["']\s*\?\s*["']preview["']\s*:\s*["']shopify["']/.test(configSource);
const previewLoaderRejectsProduction = /if\s*\(import\.meta\.env\?\.PROD\s*===\s*true\)/.test(catalogSource);
const summary = {
  generatedAt,
  store: storeDomain,
  productsScanned: products.length,
  actualShopifyProductRecords: products.filter(product => /^gid:\/\/shopify\/Product\/[1-9]\d+$/.test(product.id || "")).length,
  verifiedShopifyProductsAvailableToRender: renderedCatalog.length,
  renderedProductsMissingTitle: renderedCatalog.filter(product => !String(product.title || "").trim()).length,
  actualShopifyProductsNotMappedToApprovedWorkbook: products.length - renderedCatalog.length,
  workbookProductsMissingFromShopify: missingWorkbookProducts.length,
  workbookProductsMissingFromShopifyHandles: missingWorkbookProducts.map(product => ({ handle: product.handle, title: product.title })),
  verifiedProductsMissingShopifyImage: missingShopifyImages.length,
  verifiedProductsMissingShopifyImageRecords: missingShopifyImages,
  actualShopifyVariantRecords: allVariants.length,
  variantsMissingValidShopifyId: allVariants.filter(variant => !validVariantId(variant)).length,
  availableVariantsMissingValidPrice: availableVariants.filter(variant => !validVariantPrice(variant)).length,
  availableVariantsWithVerifiedShopifyIdAndPrice: availableVariants.filter(variant => validVariantId(variant) && validVariantPrice(variant)).length,
  mainCategoryOrder: mainCategoryCounts,
  mainCategoryOrderMatchesRequired: JSON.stringify(mainCategoryCounts.map(item => item.label)) === JSON.stringify(expectedMainOrder),
  emptyMainCategories: mainCategoryCounts.filter(item => item.productCount === 0),
  emptyChildCategories: childCategoryCounts,
  fallbackCallAudit: {
    retainedPreviewProductLoaderCallSites: previewLoaderCallSites,
    previewLoaderGuardedByProvider: previewBranchGuarded,
    productionProviderForcedToShopify: productionForcedToShopify,
    previewLoaderRejectsProduction,
    productionPreviewProductCalls: productionForcedToShopify && previewBranchGuarded && previewLoaderRejectsProduction ? 0 : null,
    pagesBehindTheSameProviderGate: ["home", "category/collection", "search", "product detail", "wishlist", "cart"],
    workbookCatalogUse: "SKU identity and approved category/group mapping only",
  },
  multiVariantProducts: products.filter(product => product.variants.length > 1).length,
  productsWithGenericVariantFields: genericProducts.length,
  productsRequiringOptionNameCorrection: genericProducts.length,
  genericVariantRows: genericVariantCount,
  variantsRequiringOptionNameCorrection: genericVariantCount,
  genericVariantsWithUniqueSkuLabel: skuLabeledVariantCount,
  productsRequiringMerchantCorrection: needsCorrection.size,
  variantsRequiringMerchantCorrection: rows.filter(row => row.merchant_correction_required).length,
  blueSapphireExamples: rows.filter(row => row.handle === "blue-sapphire" || row.handle === "blue-sapphire-ring-5-ratti-1"),
  catEyeExamples: rows.filter(row => /cat'?s eye|lehsuniya/i.test(row.product_title)),
  optionCorrectionProducts: genericProducts,
  merchantCorrectionHandles: [...needsCorrection].sort(),
};
await writeFile(new URL("../reports/shopify-generic-variant-labels.csv", import.meta.url), csv);
await writeFile(new URL("../reports/shopify-generic-variant-labels-summary.json", import.meta.url), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(new URL("../reports/shopify-variant-option-corrections.json", import.meta.url), `${JSON.stringify({ generatedAt, productsRequiringOptionNameCorrection: genericProducts.length, variantsRequiringOptionNameCorrection: genericVariantCount, productsRequiringUniqueSkuCorrection: needsCorrection.size, variantsRequiringUniqueSkuCorrection: rows.filter(row => row.merchant_correction_required).length, products: optionCorrectionProducts }, null, 2)}\n`);
await writeFile(new URL("../reports/shopify-only-catalog-audit.json", import.meta.url), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ generatedAt, productsScanned: summary.productsScanned, actualShopifyProductRecords: summary.actualShopifyProductRecords, verifiedShopifyProductsAvailableToRender: summary.verifiedShopifyProductsAvailableToRender, actualShopifyProductsNotMappedToApprovedWorkbook: summary.actualShopifyProductsNotMappedToApprovedWorkbook, workbookProductsMissingFromShopify: summary.workbookProductsMissingFromShopify, verifiedProductsMissingShopifyImage: summary.verifiedProductsMissingShopifyImage, actualShopifyVariantRecords: summary.actualShopifyVariantRecords, variantsMissingValidShopifyId: summary.variantsMissingValidShopifyId, availableVariantsMissingValidPrice: summary.availableVariantsMissingValidPrice, availableVariantsWithVerifiedShopifyIdAndPrice: summary.availableVariantsWithVerifiedShopifyIdAndPrice, mainCategoryOrder: summary.mainCategoryOrder, emptyMainCategories: summary.emptyMainCategories, emptyChildCategories: summary.emptyChildCategories.length, productsRequiringOptionNameCorrection: summary.productsRequiringOptionNameCorrection, variantsRequiringOptionNameCorrection: summary.variantsRequiringOptionNameCorrection, productsRequiringUniqueSkuCorrection: summary.productsRequiringMerchantCorrection, variantsRequiringUniqueSkuCorrection: summary.variantsRequiringMerchantCorrection, catEyeExamples: summary.catEyeExamples.map(({ handle, sku, shopify_variant_title, selected_options, price, currency, customer_label, merchant_correction_required }) => ({ handle, sku, shopify_variant_title, selected_options, price, currency, customer_label, merchant_correction_required })) }, null, 2));
