import { clientProducts, mapShopifyCatalog, mergeShopifyProduct } from "./catalog.js";
import { catalogProvider } from "./config.js";
import {
  hasShopifyConnection,
  loadAllShopifyProducts,
  loadShopifyProduct,
  syncShopifyCart,
} from "./shopify.js";

const shopifyAdapter = {
  hasConnection: hasShopifyConnection,
  loadCatalog: loadAllShopifyProducts,
  loadProduct: loadShopifyProduct,
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
        const sourceProducts = result?.products || [];
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
