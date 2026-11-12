import { selectProductMedia } from "./product-media.js";
import registry from "./data/catalog-registry.json" with { type: "json" };
let clientCatalog = { ...registry, products: [] };
let clientProducts = [];
export const loadPreviewCatalog = async () => {
  if (import.meta.env?.PROD === true) return Promise.reject(new Error("Workbook catalog preview is available only in development."));
  const module = await import("./data/client-catalog.json", { with: { type: "json" } });
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
    items = items.map((product, index) => ({ product, index, score: scoreProductSearch(product, query) }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(item => item.product);
    const queryIntent = normalizeSearchText(query);
    if (/\b(?:cheap|cheapest|affordable|budget|lowest|low price)\b/.test(queryIntent)) {
      items.sort((a, b) => (Number(a.price) || Number.MAX_SAFE_INTEGER) - (Number(b.price) || Number.MAX_SAFE_INTEGER));
    } else if (/\b(?:expensive|premium|highest|high price)\b/.test(queryIntent)) {
      items.sort((a, b) => (Number(b.price) || -1) - (Number(a.price) || -1));
    }
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

const SEARCH_SYNONYMS = [
  ["rudraksha", "rudraksh", "rudraksha bead", "rudraksha beads"],
  ["mala", "malas", "rosary", "japa", "jaap", "prayer bead", "prayer beads"],
  ["bracelet", "bracelets", "kada", "kadas", "bangle", "bangles"],
  ["crystal", "crystals", "gemstone", "gemstones", "gem", "gems"],
  ["ring", "rings", "anguthi"],
  ["puja", "pooja", "worship", "ritual"],
  ["necklace", "necklaces", "pendant", "pendants"],
  ["zodiac", "rashi", "horoscope"],
  ["gift", "gifts", "present", "presents"],
  ["pearl", "pearls", "moti"],
  ["earring", "earrings", "stud", "studs"],
];
const SEARCH_SYNONYM_LOOKUP = new Map();
for (const group of SEARCH_SYNONYMS) {
  const alternatives = group.map(normalizeSearchText);
  for (const phrase of alternatives) {
    for (const token of searchWords(phrase)) {
      SEARCH_SYNONYM_LOOKUP.set(token, [...new Set([...(SEARCH_SYNONYM_LOOKUP.get(token) || []), ...alternatives])]);
    }
  }
}
const SEARCH_STOPWORDS = new Set(["a", "an", "and", "are", "best", "buy", "can", "cheap", "cheapest", "affordable", "budget", "lowest", "low", "expensive", "premium", "highest", "high", "for", "find", "give", "i", "in", "me", "my", "of", "on", "or", "please", "product", "products", "show", "some", "the", "to", "want", "with", "under", "below", "less", "than", "upto", "up", "above", "over", "more", "max", "min", "price", "rs", "rupee", "rupees", "inr"]);

function normalizeSearchText(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/(\d+)\s+(mm|cm|kg|g)\b/g, "$1$2")
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function searchWords(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean).map(word => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word);
}

function editDistanceWithin(left, right, limit) {
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let smallest = row;
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
      smallest = Math.min(smallest, current[column]);
    }
    if (smallest > limit) return false;
    previous = current;
  }
  return previous[right.length] <= limit;
}

function priceIntent(query) {
  const text = normalizeSearchText(query);
  const under = text.match(/\b(?:under|below|less than|upto|up to|max)\s+(\d[\d,]*)\b/);
  const over = text.match(/\b(?:above|over|more than|min)\s+(\d[\d,]*)\b/);
  return {
    max: under ? Number(under[1].replace(/,/g, "")) : null,
    min: over ? Number(over[1].replace(/,/g, "")) : null,
  };
}

function scoreProductSearch(product, query) {
  const price = priceIntent(query);
  const amount = Number(product.price);
  if (price.max !== null && (!Number.isFinite(amount) || amount > price.max)) return 0;
  if (price.min !== null && (!Number.isFinite(amount) || amount < price.min)) return 0;

  const cleanedQuery = normalizeSearchText(query)
    .replace(/\b(?:under|below|less than|upto|up to|max|above|over|more than|min)\s+\d[\d,]*\b/g, " ")
    .replace(/\b(?:rs|inr|rupees?)\b/g, " ");
  let terms = searchWords(cleanedQuery).filter(word => !SEARCH_STOPWORDS.has(word));
  if (price.max !== null || price.min !== null) terms = terms.filter(word => !/^\d{2,}$/.test(word));
  const uniqueTerms = [...new Set(terms)];
  if (!uniqueTerms.length) return price.max !== null || price.min !== null ? 1 : 0;

  const titleWords = new Set(searchWords(product.title));
  const titleText = ` ${normalizeSearchText(product.title)} `;
  const documentText = ` ${normalizeSearchText(searchableText(product))} `;
  const documentWords = new Set(searchWords(documentText));
  const fuzzyWords = [...titleWords];
  let score = 0;
  let matched = 0;
  for (const term of uniqueTerms) {
    let best = titleWords.has(term) ? 14 : documentWords.has(term) ? 8 : 0;
    if (!best) {
      const titlePrefix = [...titleWords].some(word => word.startsWith(term) || (term.length >= 4 && term.startsWith(word)));
      const documentPrefix = [...documentWords].some(word => word.startsWith(term) || (term.length >= 4 && term.startsWith(word)));
      if (titlePrefix) best = 10;
      else if (documentPrefix) best = 5;
    }
    if (!best) {
      const aliases = SEARCH_SYNONYM_LOOKUP.get(term) || [];
      for (const alias of aliases) {
        const phrase = ` ${alias} `;
        if (titleText.includes(phrase)) best = Math.max(best, 11);
        else if (documentText.includes(phrase)) best = Math.max(best, 6);
      }
    }
    if (!best && term.length >= 4) {
      const tolerance = term.length >= 8 ? 2 : 1;
      if (fuzzyWords.some(word => editDistanceWithin(term, word, tolerance))) best = 7;
    }
    if (best) { matched += 1; score += best; }
  }

  const requiredMatches = uniqueTerms.length <= 3 ? uniqueTerms.length : Math.ceil(uniqueTerms.length * 0.7);
  return matched >= requiredMatches ? score + matched / uniqueTerms.length : 0;
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
  || /^(?:default title|standard|(?:option|variant)\s*\d+)$/i.test(String(value).trim());

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

export function customerVariantLabel(product, variant, storedTitle = "") {
  if (!variant) return "";
  const label = String(formatVariantLabel(product, variant) || "").trim();
  const sku = String(variant.sku || "").trim();
  const skuOnly = Boolean(label && (/^SKU\s*:/i.test(label) || (sku && label.toLowerCase() === sku.toLowerCase())));
  if (label) return skuOnly ? (sku || label.replace(/^SKU\s*:\s*/i, "")) : label;
  const savedLabel = String(storedTitle || "").trim();
  const savedSkuOnly = /^SKU\s*:/i.test(savedLabel) || (sku && savedLabel.toLowerCase() === sku.toLowerCase());
  const generic = /^(?:default title|standard|(?:option|variant)\s*\d+)$/i.test(savedLabel);
  if (savedLabel && !generic) return savedSkuOnly ? (sku || savedLabel.replace(/^SKU\s*:\s*/i, "")) : savedLabel;
  return "";
}

export function variantCorrectionReport(products = []) {
  return products.filter((product) => /^gid:\/\/shopify\/Product\//.test(product.id || ""))
    .flatMap((product) => (product.variants || []).length > 1
      ? product.variants.flatMap((variant) => {
        const label = String(formatVariantLabel(product, variant) || "").trim();
        const skuOnly = /^SKU\s*:/i.test(label);
        if (label && !skuOnly) return [];
        return [{
          productId: product.id,
          productTitle: product.title || "Untitled Shopify product",
          productHandle: product.handle || "",
          variantId: variant.id,
          sku: variant.sku || "",
          currentVariantTitle: variant.title || "",
          selectedOptions: (variant.selectedOptions || []).map((option) => ({ name: option?.name || "", value: option?.value || "" })),
          correction: "Add meaningful option names and values in Shopify; the storefront currently uses a neutral option label.",
        }];
      })
      : []);
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
