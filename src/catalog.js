import { selectProductMedia } from "./product-media.js";
import registry from "./data/catalog-registry.json" with { type: "json" };
let clientCatalog = { ...registry, products: [] };
let clientProducts = [];
export const loadPreviewCatalog = async () => {
  if (import.meta.env?.PROD === true) return Promise.reject(new Error("Workbook catalog preview is available only in development."));
  const module = await import("./data/client-catalog.json");
  clientCatalog = module.default;
  clientProducts = module.default.products;
  return clientProducts;
};

export { clientCatalog, clientProducts };
export const collections = registry.collections;
export const navigation = registry.navigation;
export const catalogGroups = registry.groups;
export const zodiacSigns = registry.zodiacSigns;
export const categories = navigation.map((group) => ({ name: group.label, group }));
export const crystals = (navigation.find((group) => group.label === "Crystal")?.items || [])
  .filter((item) => item.kind === "collection")
  .map((item) => ({ name: item.label, handle: item.target }));

export function selectProducts(products, { filter = { kind: "all", value: "" }, query = "", sort = "featured", saved = [] } = {}) {
  let items = [...products];
  if (filter.kind === "saved") items = items.filter((product) => saved.includes(product.id));
  if (filter.kind === "new") items = items.filter((product) => (product.groupIds || []).includes("group-new-arrivals"));
  if (filter.kind === "bestseller") items = items.filter((product) => (product.groupIds || []).includes("group-best-seller"));
  if (filter.kind === "collection") items = items.filter((product) => (product.collectionHandles || []).includes(filter.value));
  if (filter.kind === "group") items = items.filter((product) => (product.groupIds || []).includes(filter.value));
  if (filter.kind === "category") {
    const value = filter.value.toLowerCase();
    items = items.filter((product) => searchableText(product).includes(value));
  }
  if (filter.kind === "crystal") {
    const value = filter.value.toLowerCase();
    items = items.filter((product) => (product.collectionTitles || []).some((title) => title.toLowerCase() === value) || searchableText(product).includes(value));
  }
  if (filter.kind === "zodiac") {
    const sign = zodiacSigns.find((item) => item.name.toLowerCase() === filter.value.toLowerCase());
    const terms = [filter.value, sign?.hindi].filter(Boolean).map((item) => item.toLowerCase());
    items = items.filter((product) => terms.some((term) => searchableText(product).includes(term)));
  }
  if (query.trim()) {
    const needle = query.trim().toLowerCase();
    items = items.filter((product) => searchableText(product).includes(needle));
  }
  if (sort === "price-low") items.sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
  if (sort === "price-high") items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  if (sort === "title") items.sort((a, b) => {
    const left = a.title?.trim() || "";
    const right = b.title?.trim() || "";
    if (!left && right) return 1;
    if (left && !right) return -1;
    return left.localeCompare(right);
  });
  return items;
}

function searchableText(product) {
  return [
    product.title, product.handle, product.type, product.category, product.description,
    product.collectionTitles?.join(" "), product.collectionHandles?.join(" "),
    product.tags?.join(" "), product.keywords?.join(" "),
    product.attributes?.map((item) => `${item.label || ""} ${item.value || ""}`).join(" "),
    product.variants?.map((variant) => `${variant.sku || ""} ${variant.title || ""}`).join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function getQuizMatches(products, goal, limit = 3) {
  const handle = collections.find((collection) => collection.title.toLowerCase() === String(goal).toLowerCase())?.handle;
  if (!handle) return [];
  return selectProducts(products, { filter: { kind: "collection", value: handle } }).slice(0, limit);
}

export function productHash(product, variantId = "") {
  const path = `#product/${encodeURIComponent(product.handle || product.id)}`;
  return variantId ? `${path}?variant=${encodeURIComponent(variantId)}` : path;
}

const genericVariantText = (value) => !String(value || "").trim()
  || /^(?:default title|standard|variant\s*\d+)$/i.test(String(value).trim());

export function formatVariantLabel(product, variant) {
  if (!variant) return "";
  const selectedOptions = (variant.selectedOptions || []).flatMap((option) => {
    const value = String(option?.value || "").trim();
    if (genericVariantText(value)) return [];
    const name = String(option?.name || "").trim();
    return [name && !/^(?:title|variant)$/i.test(name) ? `${name}: ${value}` : value];
  });
  if (selectedOptions.length) return [...new Set(selectedOptions)].join(" · ");

  const title = String(variant.title || "").trim();
  if (!genericVariantText(title) && title.toLowerCase() !== String(product?.title || "").trim().toLowerCase()) return title;

  const sku = String(variant.sku || "").trim();
  const hasChoices = (product?.variants || []).length > 1
    || (product?.options || []).some(option => (option.values || []).length > 1);
  if (hasChoices && product?.variantsComplete === true && sku
    && (product?.variants || []).filter((item) => String(item?.sku || "").trim() === sku).length === 1) {
    return `SKU: ${sku}`;
  }
  return "";
}

export function productFromHash(products, hash) {
  if (!hash.startsWith("#product/")) return null;
  let key = hash.slice("#product/".length).split("?")[0];
  try { key = decodeURIComponent(key); } catch { return null; }
  return products.find((product) => product.id === key || product.handle === key) || null;
}

export function normalizeShopifyProduct(node) {
  const variants = node.variants?.nodes || node.variants?.edges?.map((edge) => edge.node) || [];
  const available = variants.filter((variant) => variant.availableForSale !== false);
  const pricedVariants = variants.map((variant) => Number(variant.price?.amount)).filter((value) => Number.isFinite(value) && value > 0);
  const amount = Number(node.priceRange?.minVariantPrice?.amount || 0)
    || (pricedVariants.length ? Math.min(...pricedVariants) : 0);
  const selectedVariant = available.find((variant) => Number(variant.price?.amount) === amount)
    || variants.find((variant) => Number(variant.price?.amount) === amount);
  const compareAt = Number(selectedVariant?.compareAtPrice?.amount || 0);
  const media = selectProductMedia(node);
  const images = media.images;
  const collectionNodes = node.collections?.nodes || [];
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    stone: node.productType || "",
    type: node.productType || "",
    category: (node.productType || "").toLowerCase(),
    price: amount > 0 ? amount : null,
    compareAt: compareAt > amount ? compareAt : null,
    ...media,
    currencyCode: selectedVariant?.price?.currencyCode || node.priceRange?.minVariantPrice?.currencyCode || null,
    compareAtCurrencyCode: selectedVariant?.compareAtPrice?.currencyCode || null,
    images,
    imagePosition: "center",
    collectionHandles: collectionNodes.map((collection) => collection.handle),
    collectionTitles: collectionNodes.map((collection) => collection.title),
    options: (node.options || []).map((option) => ({ name: option.name || "", values: option.values || [] })),
    groupIds: [],
    vendor: node.vendor || "",
    skuCount: variants.length,
    canPurchase: Boolean(available.length && amount > 0),
    availability: typeof node.availableForSale === "boolean" ? node.availableForSale : Boolean(available.length),
    variantsComplete: Boolean(node.variants?.pageInfo && !node.variants.pageInfo.hasNextPage),
    previewOnly: false,
    description: node.description || "",
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku || "",
      title: variant.title,
      image: variant.image?.url || null,
      selectedOptions: variant.selectedOptions || [],
      price: Number(variant.price?.amount || 0),
      currencyCode: variant.price?.currencyCode || null,
      compareAtCurrencyCode: variant.compareAtPrice?.currencyCode || null,
      compareAt: Number(variant.compareAtPrice?.amount || 0) || null,
      available: variant.availableForSale,
    })),
  };
}

function normalizedSku(value) {
  return String(value || "").trim().toUpperCase();
}

export function mergeShopifyProduct(liveProduct, workbookProduct) {
  if (!/^gid:\/\/shopify\/Product\/[1-9]\d+$/.test(liveProduct?.id || "") || !workbookProduct) return null;
  const workbookSkus = new Set((workbookProduct.variants || []).map((variant) => normalizedSku(variant.sku)).filter(Boolean));
  const variants = (liveProduct.variants || []).filter((variant) => /^gid:\/\/shopify\/ProductVariant\/[1-9]\d+$/.test(variant?.id || "")).map((variant) => {
    const sku = normalizedSku(variant.sku);
    const workbookMatch = Boolean(sku && workbookSkus.has(sku));
    const available = variant.available === true;
    const price = Number(variant.price);
    return {
      ...variant,
      workbookMatch,
      canPurchase: workbookMatch && /^gid:\/\/shopify\/ProductVariant\//.test(variant.id || "") && available && Number.isFinite(price) && price > 0,
    };
  });
  const approvedVariants = variants.filter((variant) => variant.canPurchase);
  const pricedVariants = variants.filter((variant) => Number(variant.price) > 0);
  const selected = approvedVariants.sort((left, right) => Number(left.price) - Number(right.price))[0]
    || pricedVariants.sort((left, right) => Number(left.price) - Number(right.price))[0];
  const collectionHandles = workbookProduct.collectionHandles || [];
  const collectionTitleByHandle = new Map(collections.map((collection) => [collection.handle, collection.title]));
  const hasShopifyDescription = liveProduct.description && liveProduct.description !== "Product details have not been added yet.";
  const hasShopifyImages = (liveProduct.images || []).length > 0;
  return {
    ...liveProduct,
    id: liveProduct.id,
    workbookId: workbookProduct.id,
    handle: liveProduct.handle,
    title: liveProduct.title || "",
    type: liveProduct.type || "",
    productType: liveProduct.stone || "",
    category: liveProduct.category || "",
    image: hasShopifyImages ? liveProduct.image : null,
    images: hasShopifyImages ? liveProduct.images : [],
    description: hasShopifyDescription ? liveProduct.description : "",
    collectionHandles,
    collectionTitles: collectionHandles.map((handle) => collectionTitleByHandle.get(handle)).filter(Boolean),
    groupIds: workbookProduct.groupIds || [],
    variants,
    skuCount: workbookProduct.variants?.length || variants.length,
    price: selected ? Number(selected.price) : liveProduct.price,
    compareAt: selected ? selected.compareAt : liveProduct.compareAt,
    canPurchase: approvedVariants.length > 0 || (!liveProduct.variantsComplete && liveProduct.availability === true && workbookSkus.size > 0),
    availability: liveProduct.availability,
    previewOnly: false,
    variantsComplete: liveProduct.variantsComplete === true,
    tags: liveProduct.tags || [],
    keywords: [],
    attributes: [],
  };
}

export function mapShopifyCatalog(liveProducts, workbookProducts = []) {
  const workbookByHandle = new Map(workbookProducts.map((product) => [product.handle, product]));
  return (Array.isArray(liveProducts) ? liveProducts : [])
    .filter((product) => /^gid:\/\/shopify\/Product\/[1-9]\d+$/.test(product?.id || ""))
    .map((product) => mergeShopifyProduct(product, workbookByHandle.get(product.handle)))
    .filter(Boolean);
}
