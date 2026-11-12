import { formatVariantLabel, mapShopifyCatalog, mergeShopifyProduct } from "./catalog.js";
import { catalogProvider, shopifyConfig } from "./config.js";
import {
  hasShopifyConnection,
  createHostedCheckout,
  loadAllShopifyProducts,
  loadShopifyCatalogCache,
  loadShopifyCatalogPage,
  loadShopifyProduct,
  loadShopifyVariants,
  loadShopifyCheckoutDestination,
  saveShopifyCatalogCache,
  syncShopifyCart,
  fetchShopifyCart,
} from "./shopify.js";

const SHOPIFY_PRODUCT_ID = /^gid:\/\/shopify\/Product\/[1-9]\d+$/;
const SHOPIFY_VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d+$/;
const INITIAL_PAGE_SIZE = 48;
const FOLLOWUP_PAGE_SIZE = 100;
const defaultWorkbookPromise = import("./data/product-mapping.json", { with: { type: "json" } }).then(module => module.default);

const shopifyAdapter = {
  hasConnection: hasShopifyConnection,
  loadCatalog: loadAllShopifyProducts,
  loadPage: loadShopifyCatalogPage,
  loadCatalogCache: loadShopifyCatalogCache,
  saveCatalogCache: saveShopifyCatalogCache,
  loadProduct: loadShopifyProduct,
  loadVariants: loadShopifyVariants,
  fetchCart: fetchShopifyCart,
  syncCart: syncShopifyCart,
  loadCheckoutDestination: loadShopifyCheckoutDestination,
};

function pageInfoDefault() { return { hasNextPage: false, endCursor: null }; }

function markCachedProduct(product) {
  return {
    ...product,
    stale: true,
    price: null,
    compareAt: null,
    canPurchase: false,
    availability: null,
    variants: (product.variants || []).map(variant => ({
      ...variant, price: null, compareAt: null, available: null, canPurchase: false,
    })),
  };
}

export function createCatalogService({ provider = catalogProvider, adapter = shopifyAdapter, workbook, checkoutEnabled = shopifyConfig.checkoutEnabled } = {}) {
  const requestedLive = provider === "shopify";
  const isLive = requestedLive && adapter.hasConnection();
  let workbookItems = Array.isArray(workbook) ? workbook : null;
  const workbookPromise = workbookItems ? Promise.resolve(workbookItems) : defaultWorkbookPromise;
  let workbookByHandle = new Map((workbookItems || []).map(product => [product.handle, product]));
  const rawProducts = new Map();
  const productsById = new Map();
  const pageRequests = new Map();
  const pageListeners = new Set();
  let pageInfo = pageInfoDefault();
  let initialized = false;
  let initialPromise = null;
  let initialFreshPromise = null;
  let cachePromise = null;
  let remainingPromise = null;
  let fullCatalogPromise = null;
  let cacheWasShown = false;

  async function ensureWorkbook() {
    if (!workbookItems) workbookItems = await workbookPromise;
    if (!workbookByHandle.size && workbookItems.length) workbookByHandle = new Map(workbookItems.map(product => [product.handle, product]));
    return workbookItems;
  }

  const products = () => [...productsById.values()];
  const mapping = () => ({
    shopifyProducts: rawProducts.size,
    matchedProducts: productsById.size,
    unmatchedShopifyProducts: rawProducts.size - productsById.size,
    workbookProductsMissingFromShopify: Math.max(0, (workbookItems?.length || 0) - productsById.size),
  });
  const snapshot = (extra = {}) => ({ products: products(), pageInfo: { ...pageInfo }, mapping: mapping(), cached: false, fresh: true, ...extra });

  function notify(event = {}) {
    const result = snapshot(event);
    for (const listener of pageListeners) listener(result);
  }

  async function mapRaw(sourceProducts) {
    const verified = (sourceProducts || []).filter(product => SHOPIFY_PRODUCT_ID.test(product?.id || ""));
    return mapShopifyCatalog(verified, await ensureWorkbook());
  }

  async function replaceCurrent(sourceProducts) {
    rawProducts.clear();
    productsById.clear();
    const verified = (sourceProducts || []).filter(product => SHOPIFY_PRODUCT_ID.test(product?.id || ""));
    for (const product of verified) rawProducts.set(product.id, product);
    for (const product of await mapRaw(verified)) productsById.set(product.id, product);
  }

  async function mergePage(sourceProducts) {
    const verified = (sourceProducts || []).filter(product => SHOPIFY_PRODUCT_ID.test(product?.id || ""));
    for (const product of verified) rawProducts.set(product.id, product);
    const mapped = await mapRaw(verified);
    for (const product of mapped) productsById.set(product.id, product);
    return mapped;
  }

  function pageRequest(first, after) {
    const key = `${first}:${after || "first"}`;
    if (!pageRequests.has(key)) {
      const request = (adapter.loadPage
        ? adapter.loadPage({ first, after })
        : adapter.loadCatalog())
        .then(result => {
          if (!Array.isArray(result?.products)) throw new Error("Shopify returned an invalid product catalog response.");
          if (result.products.length && !result.products.some(product => SHOPIFY_PRODUCT_ID.test(product?.id || ""))) {
            throw new Error("Shopify returned no verifiable product records.");
          }
          return result;
        })
        .finally(() => pageRequests.delete(key));
      pageRequests.set(key, request);
    }
    return pageRequests.get(key);
  }

  async function readCatalogCache() {
    if (!cachePromise) cachePromise = Promise.resolve(adapter.loadCatalogCache?.()).catch(() => null);
    return cachePromise;
  }

  async function ensureInitial() {
    if (!isLive) throw new Error("Shopify mode is selected, but public Storefront API configuration is missing.");
    if (initialized) return snapshot({ cached: cacheWasShown, fresh: !cacheWasShown });
    if (!initialPromise) {
      initialPromise = (async () => {
        const request = pageRequest(INITIAL_PAGE_SIZE, null);
        const cacheResult = readCatalogCache().then(value => Array.isArray(value) && value.length
          ? { kind: "cache", value }
          : { kind: "empty" });
        const winner = await Promise.race([
          request.then(() => ({ kind: "fresh" }), () => ({ kind: "failed" })),
          cacheResult,
        ]);
        if (winner.kind === "cache") {
          const cachedMapped = await mapRaw(winner.value);
          for (const product of cachedMapped) productsById.set(product.id, markCachedProduct(product));
          cacheWasShown = true;
          initialized = true;
          // The cached records are genuine Shopify data but their prices and
          // availability are deliberately unusable until the fresh page lands.
          initialFreshPromise = request.then(async result => {
            await replaceCurrent(result.products);
            pageInfo = result.pageInfo || pageInfoDefault();
            cacheWasShown = false;
            notify({ event: "initial-page", pageProducts: products(), fresh: true, cached: false });
            return snapshot();
          });
          return snapshot({ cached: true, fresh: false, pageInfo: { hasNextPage: true, endCursor: null } });
        }

        const result = await request;
        await replaceCurrent(result.products);
        pageInfo = result.pageInfo || pageInfoDefault();
        initialized = true;
        initialFreshPromise = Promise.resolve(snapshot());
        return snapshot({ cached: Boolean(result.cached), fresh: true });
      })().catch(error => {
        initialPromise = null;
        throw error;
      });
    }
    return initialPromise;
  }

  async function saveCurrentCache() {
    if (!adapter.saveCatalogCache || !rawProducts.size) return;
    try { await adapter.saveCatalogCache([...rawProducts.values()]); } catch { /* Cache failures never replace Shopify state. */ }
  }

  async function fetchNextPage() {
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) return null;
    const result = await pageRequest(FOLLOWUP_PAGE_SIZE, pageInfo.endCursor);
    const pageProducts = await mergePage(result.products);
    pageInfo = result.pageInfo || pageInfoDefault();
    return { pageProducts, pageInfo: { ...pageInfo } };
  }

  async function loadCompleteCatalog() {
    if (!isLive) throw new Error("Shopify mode is selected, but public Storefront API configuration is missing.");
    if (!fullCatalogPromise) {
      fullCatalogPromise = (async () => {
        let result;
        if (adapter.loadPage) {
          let after = null;
          let hasNextPage = true;
          const all = [];
          while (hasNextPage) {
            result = await pageRequest(FOLLOWUP_PAGE_SIZE, after);
            all.push(...result.products);
            hasNextPage = Boolean(result.pageInfo?.hasNextPage);
            after = result.pageInfo?.endCursor || null;
            if (hasNextPage && !after) throw new Error("Shopify returned an incomplete product cursor.");
          }
          await replaceCurrent(all);
          rawProducts.clear();
          for (const item of all.filter(product => SHOPIFY_PRODUCT_ID.test(product?.id || ""))) rawProducts.set(item.id, item);
          pageInfo = pageInfoDefault();
          initialized = true;
          cacheWasShown = false;
        } else {
          result = await adapter.loadCatalog();
          if (!Array.isArray(result?.products)) throw new Error("Shopify returned an invalid product catalog response.");
          await replaceCurrent(result.products);
          pageInfo = pageInfoDefault();
          initialized = true;
        }
        await saveCurrentCache();
        return snapshot({ cached: Boolean(result?.cached), fresh: true });
      })().finally(() => { fullCatalogPromise = null; });
    }
    return fullCatalogPromise;
  }

  async function loadRemainingCatalog() {
    if (!requestedLive) return null;
    if (!remainingPromise) {
      remainingPromise = (async () => {
        await ensureInitial();
        if (initialFreshPromise) await initialFreshPromise;
        while (pageInfo.hasNextPage) {
          const result = await fetchNextPage();
          if (!result) break;
          notify({ event: "catalog-page", pageProducts: result.pageProducts, fresh: true, cached: false });
          if (pageInfo.hasNextPage && !pageInfo.endCursor) throw new Error("Shopify returned an incomplete product cursor.");
        }
        await saveCurrentCache();
        notify({ event: "catalog-complete", pageProducts: [], fresh: true, cached: false });
        return snapshot({ complete: true });
      })().finally(() => { remainingPromise = null; });
    }
    return remainingPromise;
  }

  async function loadDetail(handle) {
    if (!isLive) throw new Error("Shopify mode is selected, but public Storefront API configuration is missing.");
    await ensureWorkbook();
    const liveProduct = await adapter.loadProduct(handle);
    if (!liveProduct || !SHOPIFY_PRODUCT_ID.test(liveProduct.id || "")) throw new Error("This product is no longer available from Shopify.");
    const workbookProduct = workbookByHandle.get(handle);
    const product = mergeShopifyProduct(liveProduct, workbookProduct);
    if (!product) throw new Error("This product is no longer available from Shopify.");
    rawProducts.set(product.id, liveProduct);
    productsById.set(product.id, product);
    return { ...snapshot(), product };
  }

  async function installVerifiedProduct(liveProduct, workbookProduct) {
    await ensureWorkbook();
    workbookProduct ||= workbookByHandle.get(liveProduct?.handle);
    const product = mergeShopifyProduct(liveProduct, workbookProduct);
    if (product && SHOPIFY_PRODUCT_ID.test(product.id || "")) {
      productsById.set(product.id, product);
      rawProducts.set(product.id, liveProduct);
    }
    return product;
  }

  async function resolveCartProducts(lines) {
    await ensureWorkbook();
    const ids = [...new Set(lines.map(line => line.variantId))];
    if (!ids.length) return [];
    if (!adapter.loadVariants) {
      const handles = [...new Set(lines.map(line => productsById.get(line.productId)?.handle).filter(Boolean))];
      const loaded = [];
      for (const handle of handles) {
        const detail = await adapter.loadProduct(handle);
        if (!detail) throw new Error("A saved cart item is no longer available from Shopify.");
        const product = await installVerifiedProduct(detail, workbookByHandle.get(handle));
        if (!product) throw new Error("A saved cart item could not be verified against the approved Shopify catalog.");
        loaded.push(product);
      }
      return loaded;
    }
    const resolved = await adapter.loadVariants(ids);
    const productsByVariant = new Map();
    for (const item of resolved || []) {
      const liveProduct = item?.product;
      const handle = liveProduct?.handle;
      if (!SHOPIFY_PRODUCT_ID.test(liveProduct?.id || "") || !handle || !SHOPIFY_VARIANT_ID.test(item.variantId || "")) continue;
      const product = await installVerifiedProduct(liveProduct, workbookByHandle.get(handle));
      if (!product) continue;
      productsByVariant.set(item.variantId, product);
    }
    for (const line of lines) {
      const product = productsByVariant.get(line.variantId);
      const variant = product?.variants.find(item => item.id === line.variantId);
      if (!product || product.id !== line.productId || variant?.canPurchase !== true || variant.available !== true) {
        throw new Error("A saved cart item could not be verified against current Shopify products and availability.");
      }
    }
    return [...new Map(productsByVariant.values().map(product => [product.id, product])).values()];
  }

  return Object.freeze({
    source: requestedLive ? "shopify" : "preview",
    isLive,
    hasConnection: isLive,
    canCheckout: Boolean(requestedLive && isLive && checkoutEnabled && adapter.loadCheckoutDestination),

    async loadCatalog() { return loadCompleteCatalog(); },

    async loadRoute(route) {
      if (!requestedLive) return null;
      if (route.page === "product") return loadDetail(route.handle);
      return ensureInitial();
    },

    subscribeCatalogPages(listener) {
      pageListeners.add(listener);
      return () => pageListeners.delete(listener);
    },

    async loadRemainingCatalog() { return loadRemainingCatalog(); },

    async loadMore() {
      if (!requestedLive) return null;
      await ensureInitial();
      if (initialFreshPromise) await initialFreshPromise;
      if (!pageInfo.hasNextPage || !pageInfo.endCursor) return null;
      const result = await fetchNextPage();
      if (!result) return snapshot({ complete: true });
      notify({ event: "catalog-page", pageProducts: result.pageProducts });
      return snapshot();
    },

    async resolveSharedVariants(variantIds) {
      if (!isLive) throw new Error("Shared carts require current Shopify Storefront data.");
      await ensureWorkbook();
      const resolved = await adapter.loadVariants(variantIds);
      const fullProducts = new Map();
      for (const item of resolved || []) {
        const handle = item?.product?.handle;
        const workbookProduct = workbookByHandle.get(handle);
        const current = [...productsById.values()].find(product => product.handle === handle);
        if (!handle || !workbookProduct || current?.variantsComplete) continue;
        const full = await adapter.loadProduct(handle);
        if (full) fullProducts.set(handle, full);
      }
      return Promise.all(variantIds.map(async (variantId, index) => {
        const live = resolved?.find?.(item => item?.variantId === variantId) || resolved?.[index] || null;
        if (!live?.product || !live.variant || live.variant.id !== variantId
          || !SHOPIFY_PRODUCT_ID.test(live.product.id || "") || !SHOPIFY_VARIANT_ID.test(live.variant.id || "")) {
          return { variantId, status: "missing", product: null, variant: null };
        }
        const handle = live.product.handle;
        const workbookProduct = workbookByHandle.get(handle);
        const base = fullProducts.get(handle) || live.product;
        const variants = new Map((base.variants || []).map(variant => [variant.id, variant]));
        variants.set(live.variantId, live.variant);
        const product = await installVerifiedProduct({
          ...base,
          ...live.product,
          variants: [...variants.values()],
          variantsComplete: base.variantsComplete === true,
          options: live.product.options?.length ? live.product.options : base.options,
        }, workbookProduct);
        const variant = product?.variants.find(item => item.id === variantId) || live.variant;
        if (!product) return { variantId, status: "unverified", product: live.product, variant };
        if (variant.available !== true) return { variantId, status: "unavailable", product, variant };
        if (variant.canPurchase !== true || (product.variants.length > 1 && !formatVariantLabel(product, variant))) {
          return { variantId, status: "unverified", product, variant };
        }
        return { variantId, status: "available", product, variant };
      }));
    },

    async syncCart(cartId, lines, knownCart = null, { verified = false } = {}) {
      if (!isLive) throw new Error("Live Shopify cart is unavailable until Storefront API configuration is present.");
      let verifiedProducts = [];
      if (verified) {
        for (const line of lines) {
          if (!SHOPIFY_PRODUCT_ID.test(line.productId || "") || !SHOPIFY_VARIANT_ID.test(line.variantId || "") || !Number.isInteger(line.quantity) || line.quantity < 1) {
            throw new Error("A cart line does not have a verified Shopify product and variant ID.");
          }
          const product = productsById.get(line.productId);
          const variant = product?.variants.find(item => item.id === line.variantId);
          if (!product || variant?.canPurchase !== true || variant.available !== true || !(Number(variant.price) > 0)) {
            throw new Error("A cart variant no longer matches an available Shopify product and workbook SKU.");
          }
        }
      } else {
        verifiedProducts = await resolveCartProducts(lines);
      }
      const cart = await adapter.syncCart(cartId, lines, knownCart);
      return { cart, products: verifiedProducts };
    },

    async restoreCart(cartId) {
      if (!isLive || !cartId || !adapter.fetchCart) return null;
      await ensureWorkbook();
      const cart = await adapter.fetchCart(cartId);
      if (!cart) return { cart: null, lines: [], products: [] };
      const remoteLines = cart.lines?.nodes || cart.lines?.edges?.map(edge => edge.node) || [];
      const variantIds = [...new Set(remoteLines.map(line => line.merchandise?.id).filter(id => SHOPIFY_VARIANT_ID.test(id || "")))];
      const resolved = variantIds.length && adapter.loadVariants ? await adapter.loadVariants(variantIds) : [];
      const byVariant = new Map();
      const restoredProducts = new Map();
      for (const item of resolved || []) {
        if (!item?.product?.handle) continue;
        const product = await installVerifiedProduct(item.product, workbookByHandle.get(item.product.handle));
        const variant = product?.variants.find(candidate => candidate.id === item.variantId);
        if (product && variant?.canPurchase === true && variant.available === true) {
          byVariant.set(item.variantId, { product, variant });
          restoredProducts.set(product.id, product);
        }
      }
      const restoredLines = remoteLines.flatMap(line => {
        const variantId = line.merchandise?.id;
        const resolvedItem = byVariant.get(variantId);
        if (!resolvedItem || !Number.isInteger(line.quantity) || line.quantity < 1) return [];
        const { product, variant } = resolvedItem;
        return [{ key: `${product.id}:${variantId}`, productId: product.id, variantId, variantTitle: formatVariantLabel(product, variant), sku: variant.sku || "", quantity: line.quantity }];
      });
      return { cart, lines: restoredLines, products: [...restoredProducts.values()] };
    },

    async checkout(cartId, { authenticated = false } = {}) {
      if (!(requestedLive && isLive && checkoutEnabled && adapter.loadCheckoutDestination)) return { disabled: true };
      return createHostedCheckout({ id: cartId }, null, cartId, {
        enabled: checkoutEnabled,
        authenticated,
        loadDestination: adapter.loadCheckoutDestination,
      });
    },
  });
}

export const catalogService = createCatalogService();
