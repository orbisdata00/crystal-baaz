import { shopifyConfig } from "./config.js";
import { normalizeShopifyProduct } from "./catalog.js";
import { getCatalogCache, setCatalogCache } from "./shopify-cache.js";

const configured = () => Boolean(shopifyConfig.storeDomain && shopifyConfig.storefrontAccessToken);
const variantIdPattern = /^gid:\/\/shopify\/ProductVariant\//;
const CATALOG_PAGE_SIZE = 100;
const CATALOG_CACHE_AGE = 30 * 60 * 1000;

const PRODUCT_FIELDS = `
  id title handle description productType tags availableForSale
  images(first: 12) { nodes { url altText } }
  priceRange { minVariantPrice { amount currencyCode } }
  collections(first: 50) { nodes { handle title } }
  variants(first: 100) {
    nodes {
      id sku title availableForSale
      selectedOptions { name value }
      price { amount currencyCode }
      compareAtPrice { amount currencyCode }
    }
    pageInfo { hasNextPage endCursor }
  }
`;

const CART_FIELDS = `
  id totalQuantity
  cost { subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
  lines(first: 100) {
    nodes {
      id quantity
      merchandise {
        ... on ProductVariant {
          id title availableForSale
          price { amount currencyCode }
          product { id handle title productType images(first: 1) { nodes { url altText } } }
        }
      }
    }
  }
`;

async function storefrontRequest(query, variables = {}) {
  if (!configured()) throw new Error("Shopify Storefront API settings are not configured.");
  const domain = shopifyConfig.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${domain}/api/${shopifyConfig.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": shopifyConfig.storefrontAccessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Shopify request failed (${response.status})`);
  const result = await response.json();
  if (result.errors?.length) throw new Error(result.errors[0].message || "Shopify request failed");
  return result.data;
}

function connectionNodes(connection) {
  return connection?.nodes || connection?.edges?.map((edge) => edge.node) || [];
}

export async function loadShopifyProducts({ first = 24, after = null, query = "", sortKey = "BEST_SELLING", reverse = false } = {}) {
  if (!configured()) return null;
  const gql = `query CrystalBazzProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
    products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { ${PRODUCT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const data = await storefrontRequest(gql, { first, after, query: query || null, sortKey, reverse });
  const connection = data.products;
  return { products: connectionNodes(connection).map(normalizeShopifyProduct), pageInfo: connection.pageInfo };
}

const CATALOG_PRODUCT_FIELDS = `
  id title handle productType tags availableForSale
  images(first: 1) { nodes { url altText } }
  priceRange { minVariantPrice { amount currencyCode } }
  variants(first: 5) {
    nodes {
      id sku title availableForSale
      selectedOptions { name value }
      price { amount currencyCode }
      compareAtPrice { amount currencyCode }
    }
    pageInfo { hasNextPage endCursor }
  }
`;

async function fetchAllShopifyProducts() {
  const products = [];
  let after = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const gql = `query CrystalBazzCatalog($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: TITLE) {
        nodes { ${CATALOG_PRODUCT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`;
    const data = await storefrontRequest(gql, { first: CATALOG_PAGE_SIZE, after });
    const connection = data.products;
    products.push(...connectionNodes(connection).map(normalizeShopifyProduct));
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    after = connection.pageInfo?.endCursor || null;
    if (hasNextPage && !after) throw new Error("Shopify returned an incomplete product cursor.");
  }
  return products;
}

let catalogRequest = null;
export async function loadAllShopifyProducts({ forceRefresh = false } = {}) {
  if (!configured()) throw new Error("Shopify Storefront API settings are not configured.");
  const domain = shopifyConfig.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const cacheKey = `${domain}:${shopifyConfig.apiVersion}:products-v1`;
  if (!forceRefresh) {
    const cached = await getCatalogCache(cacheKey, CATALOG_CACHE_AGE);
    if (cached) return { products: cached, pageInfo: { hasNextPage: false, endCursor: null }, cached: true };
  }
  if (!catalogRequest) {
    catalogRequest = fetchAllShopifyProducts()
      .then(async (products) => { await setCatalogCache(cacheKey, products); return products; })
      .finally(() => { catalogRequest = null; });
  }
  const products = await catalogRequest;
  return { products, pageInfo: { hasNextPage: false, endCursor: null }, cached: false };
}

export async function loadShopifyCollection(handle, { first = 24, after = null, sortKey = "COLLECTION_DEFAULT", reverse = false } = {}) {
  if (!configured()) return null;
  const gql = `query CrystalBazzCollection($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys, $reverse: Boolean) {
    collection(handle: $handle) {
      handle title description
      products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
        nodes { ${PRODUCT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
  const data = await storefrontRequest(gql, { handle, first, after, sortKey, reverse });
  const collection = data.collection;
  if (!collection) return { collection: null, products: [], pageInfo: { hasNextPage: false, endCursor: null } };
  return {
    collection: { handle: collection.handle, title: collection.title, description: collection.description },
    products: connectionNodes(collection.products).map(normalizeShopifyProduct),
    pageInfo: collection.products.pageInfo,
  };
}

export async function loadShopifyCollections({ first = 100, after = null } = {}) {
  if (!configured()) return null;
  const gql = `query CrystalBazzCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      nodes { id handle title description image { url altText } productsCount { count } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const data = await storefrontRequest(gql, { first, after });
  return { collections: connectionNodes(data.collections), pageInfo: data.collections.pageInfo };
}

export async function loadShopifyProduct(handle) {
  if (!configured()) return null;
  const gql = `query CrystalBazzProduct($handle: String!) { product(handle: $handle) { ${PRODUCT_FIELDS} } }`;
  const data = await storefrontRequest(gql, { handle });
  if (!data.product) return null;
  let product = data.product;
  const variants = connectionNodes(product.variants);
  let pageInfo = product.variants?.pageInfo;
  while (pageInfo?.hasNextPage && pageInfo.endCursor) {
    const variantsQuery = `query CrystalBazzProductVariants($handle: String!, $first: Int!, $after: String) {
      product(handle: $handle) { variants(first: $first, after: $after) {
        nodes { id sku title availableForSale selectedOptions { name value } price { amount currencyCode } compareAtPrice { amount currencyCode } }
        pageInfo { hasNextPage endCursor }
      } }
    }`;
    const variantData = await storefrontRequest(variantsQuery, { handle, first: 100, after: pageInfo.endCursor });
    const connection = variantData.product?.variants;
    variants.push(...connectionNodes(connection));
    pageInfo = connection?.pageInfo;
  }
  product = { ...product, variants: { nodes: variants, pageInfo: pageInfo || { hasNextPage: false, endCursor: null } } };
  return normalizeShopifyProduct(product);
}

export async function fetchShopifyCart(cartId) {
  if (!configured() || !cartId) return null;
  const gql = `query CrystalBazzCart($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`;
  const data = await storefrontRequest(gql, { id: cartId });
  return data.cart || null;
}

function storeErrors(payload, operation) {
  if (payload?.userErrors?.length) throw new Error(payload.userErrors[0].message || `${operation} failed.`);
  return payload?.cart || null;
}

async function createCart(lines) {
  const gql = `mutation CrystalBazzCartCreate($input: CartInput!) {
    cartCreate(input: $input) { cart { ${CART_FIELDS} } userErrors { field message } }
  }`;
  const data = await storefrontRequest(gql, { input: { lines } });
  return storeErrors(data.cartCreate, "Cart creation");
}

async function addCartLines(cartId, lines) {
  if (!lines.length) return null;
  const gql = `mutation CrystalBazzCartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { field message } }
  }`;
  const data = await storefrontRequest(gql, { cartId, lines });
  return storeErrors(data.cartLinesAdd, "Adding cart lines");
}

async function updateCartLines(cartId, lines) {
  if (!lines.length) return null;
  const gql = `mutation CrystalBazzCartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { field message } }
  }`;
  const data = await storefrontRequest(gql, { cartId, lines });
  return storeErrors(data.cartLinesUpdate, "Updating cart lines");
}

async function removeCartLines(cartId, lineIds) {
  if (!lineIds.length) return null;
  const gql = `mutation CrystalBazzCartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ${CART_FIELDS} } userErrors { field message } }
  }`;
  const data = await storefrontRequest(gql, { cartId, lineIds });
  return storeErrors(data.cartLinesRemove, "Removing cart lines");
}

export async function syncShopifyCart(cartId, localLines) {
  if (!configured()) return null;
  const lines = localLines
    .filter((line) => variantIdPattern.test(line.variantId) && Number.isInteger(line.quantity) && line.quantity > 0)
    .map((line) => ({ merchandiseId: line.variantId, quantity: line.quantity }));
  if (lines.length !== localLines.length) throw new Error("Remove preview-only items before checking out.");
  let cart = cartId ? await fetchShopifyCart(cartId) : null;
  if (!lines.length) {
    if (!cart) return null;
    const current = connectionNodes(cart.lines);
    return current.length ? removeCartLines(cart.id, current.map((line) => line.id)) : cart;
  }
  if (!cart) return createCart(lines);

  const existing = connectionNodes(cart.lines);
  const expected = new Map(lines.map((line) => [line.merchandiseId, line.quantity]));
  const currentByVariant = new Map(existing.map((line) => [line.merchandise?.id, line]));
  const additions = [];
  const updates = [];
  const removals = [];
  for (const [merchandiseId, quantity] of expected) {
    const line = currentByVariant.get(merchandiseId);
    if (!line) additions.push({ merchandiseId, quantity });
    else {
      if (!line.merchandise?.availableForSale) throw new Error(`${line.merchandise?.product?.title || "A product"} is no longer available.`);
      if (line.quantity !== quantity) updates.push({ id: line.id, quantity });
      currentByVariant.delete(merchandiseId);
    }
  }
  for (const line of currentByVariant.values()) removals.push(line.id);
  if (removals.length) cart = await removeCartLines(cart.id, removals);
  if (updates.length) cart = await updateCartLines(cartId, updates);
  if (additions.length) cart = await addCartLines(cartId, additions);
  return cart || await fetchShopifyCart(cartId);
}

export async function createHostedCheckout(cart, catalog, cartId = null) {
  return { disabled: true };
}

export function hasShopifyConnection() {
  return configured();
}
