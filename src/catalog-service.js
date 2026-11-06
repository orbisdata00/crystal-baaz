import { clientProducts, formatVariantLabel, mapShopifyCatalog, mergeShopifyProduct } from "./catalog.js";
import { catalogProvider } from "./config.js";
import {
  hasShopifyConnection,
  loadAllShopifyProducts,
  loadShopifyProduct,
  loadShopifyVariants,
  syncShopifyCart,
} from "./shopify.js";

const shopifyAdapter = {
  hasConnection: hasShopifyConnection,
  loadCatalog: loadAllShopifyProducts,
  loadProduct: loadShopifyProduct,
  loadVariants: loadShopifyVariants,
  syncCart: syncShopifyCart,
};

export function createCatalogService({ provider = catalogProvider, adapter = shopifyAdapter, workbook = clientProducts } = {}) {
  const requestedLive = provider === "shopify";
  const isLive = requestedLive && adapter.hasConnection();
  let catalogPromise = null;
  let mappedCatalog = null;
  let catalogResult = null;
  async function loadCatalog() {
    if (!isLive) throw new Error("Shopify mode is selected, but public Storefront API configuration is missing.");
    if (mappedCatalog) return { ...catalogResult, products: mappedCatalog };
    if (!catalogPromise) {
      catalogPromise = adapter.loadCatalog().then((result) => {
        if (!Array.isArray(result?.products)) throw new Error("Shopify returned an invalid product catalog response.");
        const sourceProducts = result.products.filter(product => /^gid:\/\/shopify\/Product\/[1-9]\d+$/.test(product?.id || ""));
        if (result.products.length && !sourceProducts.length) throw new Error("Shopify returned no verifiable product records.");
        mappedCatalog = mapShopifyCatalog(sourceProducts, workbook);
        catalogResult = {
          products: mappedCatalog,
          pageInfo: { hasNextPage: false, endCursor: null },
          mapping: {
            shopifyProducts: sourceProducts.length,
            matchedProducts: mappedCatalog.length,
            unmatchedShopifyProducts: sourceProducts.length - mappedCatalog.length,
            workbookProductsMissingFromShopify: workbook.length - mappedCatalog.length,
          },
          cached: Boolean(result?.cached),
        };
        return catalogResult;
      }).finally(() => { catalogPromise = null; });
    }
    const result = await catalogPromise;
    return { ...result, products: mappedCatalog };
  }

  return Object.freeze({
    source: requestedLive ? "shopify" : "preview",
    isLive,
    hasConnection: isLive,
    canCheckout: false,

    async loadCatalog() {
      return loadCatalog();
    },

    async loadRoute(route) {
      if (!requestedLive) return null;
      if (route.page === "product") {
        if (!isLive) throw new Error("Shopify mode is selected, but public Storefront API configuration is missing.");
        const catalog = await loadCatalog();
        const workbookProduct = workbook.find((product) => product.handle === route.handle);
        const liveProduct = await adapter.loadProduct(route.handle);
        if (!liveProduct) throw new Error("This product is no longer available from Shopify.");
        const product = mergeShopifyProduct(liveProduct, workbookProduct);
        if (!product) throw new Error("This product is no longer available from Shopify.");
        return { ...catalog, product };
      }
      return loadCatalog();
    },

    async resolveSharedVariants(variantIds) {
      if (!isLive) throw new Error("Shared carts require current Shopify Storefront data.");
      await loadCatalog();
      const resolved = await adapter.loadVariants(variantIds);
      const byHandle = new Map(mappedCatalog.map(product => [product.handle, product]));
      const fullProducts = new Map();
      for (const item of resolved || []) {
        const handle = item?.product?.handle;
        const base = handle ? byHandle.get(handle) : null;
        const workbookProduct = workbook.find(product => product.handle === handle);
        if (!handle || !base || base.variantsComplete || !workbookProduct || fullProducts.has(handle)) continue;
        const full = await adapter.loadProduct(handle);
        if (full) fullProducts.set(handle, full);
      }
      return variantIds.map((variantId, index) => {
        const live = resolved?.find?.(item => item?.variantId === variantId) || resolved?.[index] || null;
        if (!live?.product || !live.variant
          || !/^gid:\/\/shopify\/Product\/[1-9]\d+$/.test(live.product.id || "")
          || live.variant.id !== variantId
          || !/^gid:\/\/shopify\/ProductVariant\/[1-9]\d+$/.test(live.variant.id || "")) return { variantId, status: "missing", product: null, variant: null };
        const workbookProduct = workbook.find(item => item.handle === live.product.handle);
        const catalogProduct = byHandle.get(live.product.handle);
        const sourceProduct = fullProducts.get(live.product.handle) || catalogProduct || live.product;
        const sourceVariants = new Map((sourceProduct.variants || []).map(variant => [variant.id, variant]));
        sourceVariants.set(live.variantId, live.variant);
        const productToMerge = {
          ...sourceProduct,
          ...live.product,
          variants: [...sourceVariants.values()],
          variantsComplete: sourceProduct.variantsComplete === true,
          options: live.product.options?.length ? live.product.options : sourceProduct.options,
        };
        const product = workbookProduct ? mergeShopifyProduct(productToMerge, workbookProduct) : null;
        const variant = product?.variants.find(item => item.id === variantId) || live.variant;
        if (!product) return { variantId, status: "unverified", product: live.product, variant };
        if (variant.available !== true) return { variantId, status: "unavailable", product, variant };
        if (variant.canPurchase !== true) return { variantId, status: "unverified", product, variant };
        if (product.variants.length > 1 && !formatVariantLabel(product, variant)) return { variantId, status: "unverified", product, variant };
        return { variantId, status: "available", product, variant };
      });
    },

    async loadMore() {
      return null;
    },

    async syncCart(cartId, lines, knownCart = null, { verified = false } = {}) {
      if (!isLive) throw new Error("Live Shopify cart is unavailable until Storefront API configuration is present.");
      if (!mappedCatalog) await loadCatalog();
      const productsById = new Map(mappedCatalog.map((product) => [product.id, product]));
      const cartProductIds = [...new Set(lines.map((line) => line.productId))];
      for (const productId of cartProductIds) {
        let product = productsById.get(productId);
        if (!product) throw new Error("A cart item is not part of the verified Shopify catalog.");
        if (!verified) {
          const liveProduct = await adapter.loadProduct(product.handle);
          if (!liveProduct) throw new Error("A cart item is no longer available from Shopify.");
          product = mergeShopifyProduct(liveProduct, workbook.find((item) => item.handle === product.handle));
          if (!product) throw new Error("A cart item could not be verified against its workbook product handle.");
          productsById.set(product.id, product);
        }
      }
      if (!verified) {
        for (const line of lines) {
          const variant = productsById.get(line.productId)?.variants.find((item) => item.id === line.variantId);
          if (variant?.canPurchase !== true) throw new Error("A cart variant no longer has an exact, available workbook SKU match.");
        }
      }
      mappedCatalog = mappedCatalog.map((product) => productsById.get(product.id) || product);
      const cart = await adapter.syncCart(cartId, lines, knownCart);
      return { cart, products: verified ? [] : cartProductIds.map((id) => productsById.get(id)).filter(Boolean) };
    },

    async checkout() {
      return { disabled: true };
    },
  });
}

export const catalogService = createCatalogService();
