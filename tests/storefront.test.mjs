import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import htm from "htm";
import { catalogGroups, collections, crystals, customerVariantLabel, formatVariantLabel, mapShopifyCatalog, mergeShopifyProduct, normalizeShopifyProduct, productFromHash, productHash, selectProducts, variantCorrectionReport, zodiacSigns, navigation } from "../src/catalog.js";
import { addCartLine, calculateCart, changeCartQuantity, removeCartLine, reconcileShopifyCartLines } from "../src/cart.js";
import { createHostedCheckout, hasShopifyConnection } from "../src/shopify.js";
import { resolveCatalogProvider, shopifyConfig } from "../src/config.js";
import { catalogService, createCatalogService } from "../src/catalog-service.js";
import { parseRoute } from "../src/routes.js";
import { Icon } from "../src/Icon.js";
import { categoryTabs, discoveryHref, discoverySections, selectDiscoveryProducts } from "../src/discovery.js";
import { ProductImage, ShoppingSharedCart } from "../src/shopping-ui.js";

import clientCatalog from "../src/data/client-catalog.json" with { type: "json" };
const clientProducts = clientCatalog.products;

const fixture = [
  { id: "amethyst", handle: "amethyst-bracelet", title: "Amethyst Bracelet", price: 1290, collectionHandles: ["bracelets", "amethyst"], collectionTitles: ["Bracelets", "Amethyst"], groupIds: ["group-gembracelets"], type: "Bracelet", variants: [{ id: "variant-a", title: "8 mm" }] },
  { id: "rose", handle: "rose-quartz-necklace", title: "Rose Quartz Necklace", price: 2190, collectionHandles: ["necklaces"], collectionTitles: ["Necklaces", "Rose Quartz"], groupIds: [], type: "Necklace", variants: [] },
  { id: "missing", handle: "title-pending", title: "", price: null, collectionHandles: [], collectionTitles: [], groupIds: [], type: "Catalog item", variants: [] },
];

test("client catalog contains the reconciled workbook registry and is preview-only", () => {
  assert.equal(clientProducts.length, 1523);
  assert.equal(new Set(clientProducts.map((product) => product.handle)).size, 1523);
  assert.equal(collections.length, 111);
  assert.equal(new Set(collections.map((collection) => collection.handle)).size, 111);
  assert.equal(catalogGroups.length, 11);
  assert.equal(navigation.length, 8);
  assert.equal(zodiacSigns.length, 12);
  assert.equal(clientCatalog.catalogStatus, "preview_only");
  assert.equal(clientCatalog.publicationReady, false);
  assert.ok(clientProducts.every((product) => product.previewOnly && product.canPurchase === false));
  assert.ok(crystals.length > 0);
});

test("workbook catalog keeps every grouped handle, SKU variant, image, copy, and quality exception", async () => {
  assert.equal(clientProducts.length, 1523);
  assert.equal(clientProducts.reduce((sum, product) => sum + product.variants.length, 0), 2576);
  assert.equal(new Set(clientProducts.flatMap((product) => product.variants.map((variant) => variant.sku))).size, 2512);
  assert.equal(clientProducts.filter((product) => product.description).length, 1493);
  assert.equal(clientProducts.filter((product) => product.images.length > 0).length, 1496);
  assert.ok(clientProducts.every((product) => Array.isArray(product.tags) && Array.isArray(product.keywords) && Array.isArray(product.images)));
  assert.ok(clientProducts.some((product) => product.variants.length > 1));
  assert.ok(clientProducts.every((product) => product.availability === "unknown"));
  assert.ok(clientProducts.flatMap((product) => product.variants).every((variant) => variant.available === null));
  const quality = JSON.parse(await readFile(new URL("../reports/catalog/catalog-quality-report.json", import.meta.url), "utf8"));
  assert.equal(quality.summary.products, 1523);
  assert.equal(quality.summary.listingSkuSourceRows, 2579);
  assert.equal(quality.summary.collections, 111);
  assert.equal(quality.summary.productsMissingTitle, 2);
  assert.equal(quality.summary.productsMissingDescription, 30);
  assert.equal(quality.summary.productsMissingImage, 27);
  assert.equal(quality.summary.variantsMissingPrice, 661);
  assert.equal(quality.summary.collectionCountDiscrepancies, 87);
  assert.equal(quality.publicationReady, false);
});

test("home discovery follows the screenshot categories and only uses mapped workbook products", () => {
  assert.deepEqual(discoverySections.map((section) => section.items.length), [8, 8, 6]);
  assert.deepEqual(categoryTabs.map((tab) => tab.label), ["All", "Bracelets", "Rings", "Pendants", "Home Decor", "Spiritual", "Rudraksha", "Crystals", "Puja"]);
  assert.equal(categoryTabs.find((tab) => tab.label === "Rudraksha").href, "#nav/Rudraksha");
  assert.equal(categoryTabs.find((tab) => tab.label === "Crystals").href, "#crystals");
  assert.equal(categoryTabs.find((tab) => tab.label === "Puja").href, "#nav/Puja");
  const bracelets = discoverySections[0].items.find((item) => item.id === "crystal-bracelets");
  const homeDecor = discoverySections[0].items.find((item) => item.id === "home-decor-vastu");
  const gifts = discoverySections[2].items.find((item) => item.id === "gift-sets-combos");
  const rudraksha = discoverySections[2].items.find((item) => item.id === "rudraksha-products");
  const puja = discoverySections[2].items.find((item) => item.id === "puja-essentials");
  assert.equal(selectDiscoveryProducts(clientProducts, bracelets).length, 347);
  assert.equal(selectDiscoveryProducts(clientProducts, homeDecor).length, 0);
  assert.equal(selectDiscoveryProducts(clientProducts, gifts).length, 13);
  assert.equal(selectDiscoveryProducts(clientProducts, rudraksha).length, 25);
  assert.ok(selectDiscoveryProducts(clientProducts, puja).length > 0);
  assert.equal(discoveryHref(gifts), "#discovery/gift-sets-combos");
  assert.deepEqual(parseRoute(discoveryHref(gifts)), { page: "discovery", id: "gift-sets-combos", sort: "featured", facet: "" });
});

test("catalog filters use explicit titles, collection links, groups and zodiac text", () => {
  assert.deepEqual(selectProducts(fixture, { query: "AMETHYST" }).map((product) => product.id), ["amethyst"]);
  assert.deepEqual(selectProducts(fixture, { filter: { kind: "collection", value: "necklaces" } }).map((product) => product.id), ["rose"]);
  assert.deepEqual(selectProducts(fixture, { filter: { kind: "group", value: "group-gembracelets" } }).map((product) => product.id), ["amethyst"]);
  assert.deepEqual(selectProducts(fixture, { filter: { kind: "category", value: "necklace" } }).map((product) => product.id), ["rose"]);
  assert.deepEqual(selectProducts(fixture, { filter: { kind: "saved" }, saved: ["rose"] }).map((product) => product.id), ["rose"]);
  const zodiacFixture = [{ ...fixture[0], title: "Aries Zodiac Bracelet" }];
  assert.equal(selectProducts(zodiacFixture, { filter: { kind: "zodiac", value: "Aries" } }).length, 1);
  assert.equal(selectProducts(zodiacFixture, { filter: { kind: "zodiac", value: "Taurus" } }).length, 0);
});

test("catalog search indexes workbook SKUs, tags, keywords, attributes, and descriptions", () => {
  const product = {
    ...fixture[0],
    tags: ["raw amethyst bead"],
    keywords: ["calm energy"],
    attributes: [{ label: "Crystal Category", value: "Natural Quartz" }],
    description: "A grounding stone from the client product sheet.",
    variants: [{ id: "variant-sku", sku: "CB-204", title: "CB-204", price: 1290 }],
  };
  for (const query of ["CB-204", "raw amethyst bead", "calm energy", "Natural Quartz", "grounding stone"]) {
    assert.deepEqual(selectProducts([product], { query }).map((item) => item.id), [product.id], query);
  }
});

test("price and title sorting keep unpriced products explicit", () => {
  const low = selectProducts(fixture, { sort: "price-low" });
  const high = selectProducts(fixture, { sort: "price-high" });
  const title = selectProducts(fixture, { sort: "title" });
  assert.deepEqual(low.map((product) => product.id), ["amethyst", "rose", "missing"]);
  assert.deepEqual(high.map((product) => product.id), ["rose", "amethyst", "missing"]);
  assert.deepEqual(title.map((product) => product.id), ["amethyst", "rose", "missing"]);
});

test("preview cart rejects missing prices and supports quantities, removal, and totals", () => {
  assert.deepEqual(addCartLine([], fixture[2]), []);
  let cart = addCartLine([], fixture[0], "8 mm");
  cart = addCartLine(cart, fixture[0], "8 mm", 2);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
  const totals = calculateCart(cart, fixture);
  assert.equal(totals.count, 3);
  assert.equal(totals.subtotal, fixture[0].price * 3);
  cart = changeCartQuantity(cart, cart[0].key, -1);
  assert.equal(cart[0].quantity, 2);
  cart = changeCartQuantity(cart, cart[0].key, -2);
  assert.equal(cart.length, 0);
  assert.equal(removeCartLine(addCartLine([], fixture[0]), addCartLine([], fixture[0])[0].key).length, 0);
});

test("cart stores stable workbook variant IDs and calculates the selected SKU price", () => {
  const product = {
    id: "multi-sku", title: "Gem bracelet", price: 900, compareAt: 1200,
    variants: [
      { id: "multi-sku:CB-10", sku: "CB-10", title: "CB-10", price: 900, compareAt: 1200, canPurchase: true },
      { id: "multi-sku:CB-11", sku: "CB-11", title: "CB-11", price: 1500, compareAt: 1800, canPurchase: true },
      { id: "multi-sku:CB-12", sku: "CB-12", title: "CB-12", price: null, canPurchase: false },
    ],
  };
  const cart = addCartLine([], product, "multi-sku:CB-11", 2);
  assert.equal(cart[0].variantId, "multi-sku:CB-11");
  assert.equal(cart[0].sku, "CB-11");
  assert.deepEqual(addCartLine(cart, product, "multi-sku:CB-12"), cart);
  const totals = calculateCart(cart, [product]);
  assert.equal(totals.lines[0].price, 1500);
  assert.equal(totals.lines[0].compareAt, 1800);
  assert.equal(totals.subtotal, 3000);
});

test("Shopify connection remains disabled without public credentials", async () => {
  assert.equal(hasShopifyConnection(), false);
  assert.equal(shopifyConfig.storeDomain, "crystalbaaz.myshopify.com");
  assert.equal(shopifyConfig.storefrontAccessToken, "");
  assert.equal(shopifyConfig.apiVersion, "2026-10");
  assert.deepEqual(await createHostedCheckout(addCartLine([], fixture[0]), fixture), { disabled: true });
});

test("preview remains opt-in and checkout remains disabled", async () => {
  let adapterCalls = 0;
  const adapter = {
    hasConnection: () => { adapterCalls += 1; return true; },
    loadProducts: async () => { adapterCalls += 1; },
    loadCollection: async () => { adapterCalls += 1; },
    loadProduct: async () => { adapterCalls += 1; },
    checkout: async () => { adapterCalls += 1; },
  };
  const preview = createCatalogService({ provider: "preview", adapter });
  assert.equal(catalogService.source, "shopify");
  assert.equal(catalogService.canCheckout, false);
  assert.equal(preview.isLive, false);
  assert.equal(await preview.loadRoute({ page: "search", query: "amethyst" }), null);
  assert.equal(await preview.loadMore({ page: "collection", handle: "bracelets" }, { pageInfo: { hasNextPage: true, endCursor: "cursor" } }), null);
  assert.deepEqual(await preview.checkout([], []), { disabled: true });
  assert.equal(adapterCalls, 0);
});

test("production is forced to Shopify and development preview remains explicit", () => {
  assert.equal(resolveCatalogProvider({ isProduction: true, requestedSource: "preview" }), "shopify");
  assert.equal(resolveCatalogProvider({ isProduction: false, requestedSource: "preview" }), "preview");
  assert.equal(resolveCatalogProvider({ isProduction: false, requestedSource: "" }), "shopify");
});

test("Shopify API failures remain errors and an empty Shopify response remains empty", async () => {
  const failing = createCatalogService({ provider: "shopify", workbook: [], adapter: {
    hasConnection: () => true,
    loadCatalog: async () => { throw new Error("Shopify API unavailable"); },
  } });
  await assert.rejects(failing.loadCatalog(), /Shopify API unavailable/);

  const empty = createCatalogService({ provider: "shopify", workbook: [], adapter: {
    hasConnection: () => true,
    loadCatalog: async () => ({ products: [] }),
  } });
  assert.deepEqual((await empty.loadCatalog()).products, []);

  const malformed = createCatalogService({ provider: "shopify", workbook: [], adapter: {
    hasConnection: () => true,
    loadCatalog: async () => ({ products: null }),
  } });
  await assert.rejects(malformed.loadCatalog(), /invalid product catalog response/);
});

test("home renders the first Shopify cursor page before loading the remaining catalog", async () => {
  const live = (id, handle, sku) => normalizeShopifyProduct({
    id: `gid://shopify/Product/${id}`, handle, title: handle, productType: "Bracelet", availableForSale: true,
    featuredImage: { url: `https://cdn.shopify.com/${handle}.jpg` },
    priceRange: { minVariantPrice: { amount: "1200", currencyCode: "INR" } },
    variants: { nodes: [{ id: `gid://shopify/ProductVariant/${id}`, sku, title: "8 mm", availableForSale: true, price: { amount: "1200", currencyCode: "INR" } }], pageInfo: { hasNextPage: false, endCursor: null } },
  });
  const first = live(501, "first-bracelet", "SKU-501"), second = live(502, "second-bracelet", "SKU-502");
  const calls = [], events = [];
  const service = createCatalogService({ provider: "shopify", workbook: [
    { id: "workbook-501", handle: "first-bracelet", collectionHandles: ["bracelets"], groupIds: [], variants: [{ sku: "SKU-501" }] },
    { id: "workbook-502", handle: "second-bracelet", collectionHandles: ["bracelets"], groupIds: [], variants: [{ sku: "SKU-502" }] },
  ], adapter: {
    hasConnection: () => true,
    async loadPage({ first: size, after }) {
      calls.push({ size, after });
      return after ? { products: [second], pageInfo: { hasNextPage: false, endCursor: null } }
        : { products: [first], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } };
    },
    saveCatalogCache: async () => {},
  } });
  const initial = await service.loadRoute({ page: "home" });
  assert.deepEqual(initial.products.map(item => item.handle), ["first-bracelet"]);
  assert.deepEqual(calls, [{ size: 48, after: null }]);
  const unsubscribe = service.subscribeCatalogPages(page => events.push(page));
  const complete = await service.loadRemainingCatalog();
  unsubscribe();
  assert.deepEqual(calls, [{ size: 48, after: null }, { size: 100, after: "cursor-1" }]);
  assert.deepEqual(complete.products.map(item => item.handle), ["first-bracelet", "second-bracelet"]);
  assert.equal(events.at(-1).event, "catalog-complete");
  assert.ok(complete.products.every(item => /^gid:\/\/shopify\/Product\//.test(item.id)));
});

test("cached Shopify products render only with unconfirmed prices until fresh Shopify data replaces them", async () => {
  const live = normalizeShopifyProduct({
    id: "gid://shopify/Product/601", handle: "cached-gem", title: "Cached Gem", productType: "Crystal", availableForSale: true,
    featuredImage: { url: "https://cdn.shopify.com/cached.jpg" },
    priceRange: { minVariantPrice: { amount: "1200", currencyCode: "INR" } },
    variants: { nodes: [{ id: "gid://shopify/ProductVariant/601", sku: "SKU-601", title: "Single", availableForSale: true, price: { amount: "1200", currencyCode: "INR" } }], pageInfo: { hasNextPage: false, endCursor: null } },
  });
  let resolvePage;
  const service = createCatalogService({ provider: "shopify", workbook: [{ id: "workbook-601", handle: "cached-gem", collectionHandles: [], groupIds: [], variants: [{ sku: "SKU-601" }] }], adapter: {
    hasConnection: () => true,
    loadCatalogCache: async () => [live],
    loadPage: () => new Promise(resolve => { resolvePage = resolve; }),
    saveCatalogCache: async () => {},
  } });
  const initial = await service.loadRoute({ page: "home" });
  assert.equal(initial.cached, true);
  assert.equal(initial.fresh, false);
  assert.equal(initial.products[0].stale, true);
  assert.equal(initial.products[0].price, null);
  assert.equal(initial.products[0].variants[0].canPurchase, false);
  const loading = service.loadRemainingCatalog();
  resolvePage({ products: [live], pageInfo: { hasNextPage: false, endCursor: null } });
  const fresh = await loading;
  assert.equal(fresh.products[0].stale, undefined);
  assert.equal(fresh.products[0].price, 1200);
  assert.equal(fresh.products[0].variants[0].canPurchase, true);
});

test("catalog service adapter contract can swap providers without changing route callers", async () => {
  const calls = [];
  const liveProduct = normalizeShopifyProduct({
    id: "gid://shopify/Product/42", handle: "rose-quartz-necklace", title: "Rose Quartz Necklace", description: "Live detail", productType: "Necklace", availableForSale: true,
    images: { nodes: [{ url: "https://cdn.example/rose.jpg" }] }, priceRange: { minVariantPrice: { amount: "1290.00" } },
    variants: { nodes: [{ id: "gid://shopify/ProductVariant/99", sku: "CB-99", title: "8 mm", availableForSale: true, price: { amount: "1290.00" }, compareAtPrice: { amount: "1590.00" } }], pageInfo: { hasNextPage: false, endCursor: null } },
  });
  const adapter = {
    hasConnection: () => true,
    loadCatalog: async () => { calls.push(["catalog"]); return { products: [liveProduct], cached: true }; },
    loadProduct: async (handle) => { calls.push(["product", handle]); return liveProduct; },
    syncCart: async (cartId, lines) => { calls.push(["syncCart", cartId, lines]); return { id: "cart-1" }; },
  };
  const workbook = [{ ...fixture[1], handle: "rose-quartz-necklace", variants: [{ id: "rose:CB-99", sku: "CB-99", title: "CB-99" }], collectionHandles: ["bracelets"], collectionTitles: ["Bracelets"] }];
  const shopify = createCatalogService({ provider: "shopify", adapter, workbook });
  assert.equal(shopify.source, "shopify");
  assert.equal(shopify.canCheckout, false);
  const collectionResult = await shopify.loadRoute({ page: "collection", handle: "bracelets" });
  assert.deepEqual(collectionResult.products.map((item) => item.handle), ["rose-quartz-necklace"]);
  assert.deepEqual(collectionResult.products[0].collectionHandles, ["bracelets"]);
  assert.deepEqual(calls[0], ["catalog"]);
  assert.equal((await shopify.loadRoute({ page: "collection", handle: "bracelets" })).products.length, 1, "cached route loads retain the catalog result contract");
  const productResult = await shopify.loadRoute({ page: "product", handle: "rose-quartz-necklace" });
  assert.equal(productResult.product.id, "gid://shopify/Product/42");
  assert.deepEqual(calls[1], ["product", "rose-quartz-necklace"]);
  assert.equal(await shopify.loadMore({ page: "search" }, { pageInfo: { hasNextPage: true, endCursor: "cursor-1" } }), null);
  const syncResult = await shopify.syncCart(null, [{ productId: "gid://shopify/Product/42", variantId: "gid://shopify/ProductVariant/99", quantity: 1 }]);
  assert.equal(syncResult.cart.id, "cart-1");
  assert.equal(syncResult.products[0].handle, "rose-quartz-necklace");
  assert.deepEqual(calls[2], ["product", "rose-quartz-necklace"]);
  assert.deepEqual(calls[3], ["syncCart", null, [{ productId: "gid://shopify/Product/42", variantId: "gid://shopify/ProductVariant/99", quantity: 1 }]]);
  assert.deepEqual(await shopify.checkout([], [], "cart-1"), { disabled: true });
});

test("shared variant resolution verifies full-product SKU identity before allowing an ambiguous option", async () => {
  const makeProduct = (skus) => normalizeShopifyProduct({
    id: "gid://shopify/Product/400", handle: "blue-sapphire-test", title: "Blue Sapphire Ring", productType: "Ring", availableForSale: true,
    options: [{ name: "Variant", values: ["Variant 1", "Variant 2"] }],
    priceRange: { minVariantPrice: { amount: "3490.00" } },
    variants: { nodes: skus.map((sku, index) => ({
      id: `gid://shopify/ProductVariant/40${index}`, sku, title: `Variant ${index + 1}`, availableForSale: true,
      selectedOptions: [{ name: "Variant", value: `Variant ${index + 1}` }],
      price: { amount: index ? "3890.00" : "3490.00", currencyCode: "INR" },
    })), pageInfo: { hasNextPage: false, endCursor: null } },
  });
  const workbookFor = (skus) => [{
    id: "workbook-blue-sapphire", handle: "blue-sapphire-test", title: "Blue Sapphire Ring", type: "Ring", price: 3490,
    collectionHandles: [], collectionTitles: [], groupIds: [], variants: skus.map(sku => ({ sku })),
  }];
  const createService = (skus) => {
    const product = makeProduct(skus);
    const adapter = {
      hasConnection: () => true,
      loadCatalog: async () => ({ products: [product] }),
      loadProduct: async () => product,
      loadVariants: async ids => ids.map(id => {
        const variant = product.variants.find(item => item.id === id);
        const partial = normalizeShopifyProduct({
          id: product.id, handle: product.handle, title: product.title, productType: product.type, availableForSale: true,
          options: product.options, priceRange: { minVariantPrice: { amount: String(variant.price) } },
          variants: { nodes: [{ ...variant, availableForSale: variant.available, price: { amount: String(variant.price), currencyCode: variant.currencyCode } }], pageInfo: { hasNextPage: true, endCursor: null } },
        });
        return { product: partial, variantId: id, variant: partial.variants[0] };
      }),
      syncCart: async () => null,
    };
    return createCatalogService({ provider: "shopify", adapter, workbook: workbookFor(skus) });
  };

  const unique = createService(["RG166", "RG168"]);
  const available = await unique.resolveSharedVariants(["gid://shopify/ProductVariant/400"]);
  assert.equal(available[0].status, "available");
  assert.equal(formatVariantLabel(available[0].product, available[0].variant), "SKU: RG166");

  const duplicate = createService(["RG-DUP", "RG-DUP"]);
  const blocked = await duplicate.resolveSharedVariants(["gid://shopify/ProductVariant/400"]);
  assert.equal(blocked[0].status, "unverified");
  assert.equal(formatVariantLabel(blocked[0].product, blocked[0].variant), "");
});

test("live product mapping keeps workbook collections and only approves exact Shopify SKU matches", () => {
  const workbook = {
    ...fixture[0],
    id: "workbook-amethyst",
    handle: "amethyst-bracelet",
    collectionHandles: ["bracelets", "amethyst"],
    collectionTitles: ["Bracelets", "Amethyst"],
    groupIds: ["group-gembracelets"],
    variants: [{ sku: "CB-204" }, { sku: "WORKBOOK-ONLY" }],
  };
  const live = normalizeShopifyProduct({
    id: "gid://shopify/Product/204", handle: workbook.handle, title: "Live Amethyst Bracelet", description: "Shopify description", productType: "Bracelet", availableForSale: true,
    images: { nodes: [{ url: "https://cdn.example/amethyst.jpg" }] }, priceRange: { minVariantPrice: { amount: "1290.00" } },
    variants: { nodes: [
      { id: "gid://shopify/ProductVariant/204", sku: "CB-204", title: "CB-204", availableForSale: true, price: { amount: "1290.00" }, compareAtPrice: { amount: "1590.00" } },
      { id: "gid://shopify/ProductVariant/205", sku: "SHOPIFY-ONLY", title: "SHOPIFY-ONLY", availableForSale: true, price: { amount: "1490.00" }, compareAtPrice: null },
      { id: "gid://shopify/ProductVariant/206", sku: "WORKBOOK-ONLY", title: "WORKBOOK-ONLY", availableForSale: true, price: { amount: "1690.00" }, compareAtPrice: null },
    ], pageInfo: { hasNextPage: false, endCursor: null } },
  });
  const merged = mergeShopifyProduct(live, workbook);
  assert.equal(merged.id, "gid://shopify/Product/204");
  assert.equal(merged.workbookId, "workbook-amethyst");
  assert.equal(merged.description, "Shopify description");
  assert.deepEqual(merged.collectionHandles, ["bracelets", "amethyst"]);
  assert.deepEqual(merged.groupIds, ["group-gembracelets"]);
  assert.equal(merged.variants.find((item) => item.sku === "CB-204").canPurchase, true);
  assert.equal(merged.variants.find((item) => item.sku === "SHOPIFY-ONLY").canPurchase, false);
  assert.equal(merged.variants.find((item) => item.sku === "WORKBOOK-ONLY").canPurchase, true);
  assert.equal(merged.canPurchase, true);
  assert.deepEqual(mapShopifyCatalog([live, { ...live, id: "gid://shopify/Product/404", handle: "missing-workbook-product" }, { ...live, id: "workbook-preview-id" }], [workbook]).map((item) => item.id), [live.id]);
  assert.equal(mergeShopifyProduct({ ...live, id: "workbook-preview-id" }, workbook), null);
});

test("live product mapping never substitutes workbook media or description when Shopify omits them", () => {
  const workbook = {
    ...fixture[0],
    handle: "amethyst-bracelet",
    image: "/assets/workbook-amethyst.jpg",
    images: ["/assets/workbook-amethyst.jpg"],
    description: "Workbook product description",
    variants: [{ sku: "CB-204" }],
  };
  const live = normalizeShopifyProduct({
    id: "gid://shopify/Product/204", handle: workbook.handle, title: workbook.title, description: "", productType: "Bracelet", availableForSale: true,
    priceRange: { minVariantPrice: { amount: "1290.00" } },
    variants: { nodes: [{ id: "gid://shopify/ProductVariant/204", sku: "CB-204", title: "CB-204", availableForSale: true, price: { amount: "1290.00" } }], pageInfo: { hasNextPage: false, endCursor: null } },
  });
  const merged = mergeShopifyProduct(live, workbook);
  assert.equal(merged.image, null);
  assert.deepEqual(merged.images, []);
  assert.equal(merged.description, "");
});

test("Shopify products normalize without invented reviews or details", () => {
  const product = normalizeShopifyProduct({
    id: "gid://shopify/Product/42", handle: "rose-quartz-bracelet", title: "Rose Quartz Bracelet", description: "", productType: "Bracelet",
    images: { nodes: [{ url: "https://cdn.example/rose.jpg" }] }, priceRange: { minVariantPrice: { amount: "1290.00" } },
    variants: { nodes: [{ id: "gid://shopify/ProductVariant/99", title: "8 mm", availableForSale: true, price: { amount: "1290.00" }, compareAtPrice: { amount: "1590.00" } }] },
  });
  assert.equal(product.price, 1290);
  assert.equal(product.type, "Bracelet");
  assert.equal(product.variants[0].title, "8 mm");
  assert.equal(product.compareAt, 1590);
  assert.equal(product.description, "");
  assert.equal("rating" in product, false);
  assert.equal("reviews" in product, false);
});

test("partial Shopify variant pages use the full product price range", () => {
  const product = normalizeShopifyProduct({
    id: "gid://shopify/Product/43", handle: "variant-heavy-product", title: "Variant Heavy Product", productType: "Bracelet",
    priceRange: { minVariantPrice: { amount: "490.00" } },
    variants: {
      nodes: [{
        id: "gid://shopify/ProductVariant/431", sku: "CB-431", title: "Large", availableForSale: true,
        price: { amount: "990.00" }, compareAtPrice: { amount: "1290.00" },
      }],
      pageInfo: { hasNextPage: true, endCursor: "variant-cursor" },
    },
  });
  assert.equal(product.price, 490);
  assert.equal(product.compareAt, null);
  assert.equal(product.variantsComplete, false);
});

test("hash routes decode handles, signs, search terms and view options", () => {
  assert.deepEqual(parseRoute("#product/rose-quartz-bracelet"), { page: "product", handle: "rose-quartz-bracelet" });
  assert.deepEqual(parseRoute("#product/blue-sapphire?variant=gid%3A%2F%2Fshopify%2FProductVariant%2F123"), { page: "product", handle: "blue-sapphire", variantId: "gid://shopify/ProductVariant/123" });
  assert.deepEqual(parseRoute("#shared-cart?items=123%3A2%2C456%3A1"), { page: "shared-cart", items: "123:2,456:1" });
  assert.deepEqual(parseRoute("#collections?group=Zodiac+Sign&category=zodiac%3AAries"), { page: "collections", group: "Zodiac Sign", category: "zodiac:Aries", sort: "featured", facet: "" });
  assert.deepEqual(parseRoute("#zodiac/Rashi%20%2F%20Zodiac?sort=title"), { page: "zodiac", sign: "Rashi / Zodiac", sort: "title", facet: "" });
  assert.deepEqual(parseRoute("#collection/rose-quartz?facet=Bracelets&sort=price-low"), { page: "collection", handle: "rose-quartz", sort: "price-low", facet: "Bracelets" });
  assert.deepEqual(parseRoute("#search/rose%20quartz"), { page: "search", query: "rose quartz", sort: "featured", facet: "" });
  assert.deepEqual(parseRoute("#account"), { page: "account" });
  assert.deepEqual(parseRoute("#orders"), { page: "orders" });
  assert.deepEqual(parseRoute("#unrecognized"), { page: "home" });
  assert.equal(productFromHash(fixture, productHash(fixture[0])), fixture[0]);
  assert.equal(productFromHash(fixture, productHash(fixture[0], "gid://shopify/ProductVariant/123")), fixture[0]);
  assert.equal(productFromHash(fixture, "#product/missing-handle"), null);
});

test("variant labels prefer verified option values, then meaningful title, then a unique SKU", () => {
  const product = {
    title: "Blue Sapphire Ring",
    variantsComplete: true,
    options: [{ name: "Variant", values: ["Variant 1", "Variant 2"] }],
    variants: [
      { id: "v1", title: "Variant 1", sku: "RG166", selectedOptions: [{ name: "Variant", value: "Variant 1" }] },
      { id: "v2", title: "Variant 2", sku: "RG168", selectedOptions: [{ name: "Variant", value: "Variant 2" }] },
    ],
  };
  assert.equal(formatVariantLabel(product, { title: "Variant 1", sku: "RG166", selectedOptions: [{ name: "Variant", value: "Variant 1" }] }), "SKU: RG166");
  assert.equal(formatVariantLabel(product, { title: "5 Ratti / Silver", selectedOptions: [{ name: "Size", value: "5 Ratti" }, { name: "Metal", value: "Silver" }] }), "Size: 5 Ratti · Metal: Silver");
  assert.equal(formatVariantLabel(product, { title: "Polished silver", selectedOptions: [] }), "Polished silver");
});

test("variant formatter avoids invented or ambiguous labels and ignores a single default option", () => {
  const single = { title: "Quartz Pendant", options: [{ name: "Title", values: ["Default Title"] }], variants: [{ id: "v1" }] };
  assert.equal(formatVariantLabel(single, { title: "Default Title", sku: "QZ-1", selectedOptions: [{ name: "Title", value: "Default Title" }] }), "");
  const ambiguous = { options: [{ name: "Variant", values: ["Variant 1", "Variant 2"] }], variants: [{ sku: "DUP" }, { sku: "DUP" }] };
  assert.equal(formatVariantLabel(ambiguous, { title: "Variant 1", sku: "DUP", selectedOptions: [{ name: "Variant", value: "Variant 1" }] }), "");
  assert.equal(formatVariantLabel({ ...ambiguous, variants: [{}, {}] }, { title: "Variant 1", selectedOptions: [{ name: "Variant", value: "Variant 1" }] }), "");
});

test("generic Shopify variants get neutral customer labels and a merchant correction report", () => {
  const product = {
    id: "gid://shopify/Product/42", handle: "blue-sapphire-ring", title: "Blue Sapphire Ring", variantsComplete: true,
    options: [{ name: "Title", values: ["Variant 1", "Variant 2"] }],
    variants: [
      { id: "gid://shopify/ProductVariant/421", title: "Variant 1", sku: "RG166", selectedOptions: [{ name: "Title", value: "Variant 1" }] },
      { id: "gid://shopify/ProductVariant/422", title: "Variant 2", sku: "RG168", selectedOptions: [{ name: "Title", value: "Variant 2" }] },
    ],
  };
  assert.equal(customerVariantLabel(product, product.variants[0]), "Option 1");
  assert.equal(customerVariantLabel(product, product.variants[1]), "Option 2");
  const report = variantCorrectionReport([product]);
  assert.equal(report.length, 2);
  assert.equal(report[0].sku, "RG166");
  assert.match(report[0].correction, /meaningful option names and values/);
  const meaningful = { ...product, variants: product.variants.map((variant, index) => ({ ...variant, title: `${5 + index} Ratti / Silver`, selectedOptions: [{ name: "Size", value: `${5 + index} Ratti` }] })) };
  assert.deepEqual(variantCorrectionReport([meaningful]), []);
});

test("missing and placeholder product media render a neutral unavailable state", () => {
  for (const src of [null, "", "/assets/product-placeholder.svg"]) {
    const markup = renderToStaticMarkup(React.createElement(ProductImage, { src, alt: "Crystal ring" }));
    assert.match(markup, /Image unavailable/);
    assert.doesNotMatch(markup, /product-placeholder\.svg/);
  }
});

test("unverified shared-cart items do not get invented product titles", () => {
  const markup = renderToStaticMarkup(React.createElement(ShoppingSharedCart, {
    items: [{ variantId: "gid://shopify/ProductVariant/123", quantity: 1, status: "missing", product: null, variant: null }],
    onNavigate: () => {},
  }));
  assert.match(markup, /Could not verify in the approved catalog/);
  assert.doesNotMatch(markup, /Shopify variant/);
});

test("SVG icons render valid elements without React key warnings", () => {
  const names = ["search", "bag", "user", "menu", "close", "arrow", "arrowUp", "check", "heart", "plus", "minus", "trash", "star", "sparkle", "truck", "grid", "bracelet", "ring", "pendant", "home", "homeTab", "mic"];
  const warnings = [];
  const previousError = console.error;
  console.error = (...args) => warnings.push(args.join(" "));
  try {
    for (const name of names) {
      const markup = renderToStaticMarkup(React.createElement(Icon, { name }));
      assert.match(markup, /^<svg\b/);
      assert.doesNotMatch(markup, /<\s*>/);
    }
  } finally { console.error = previousError; }
  assert.deepEqual(warnings, []);
});

test("HTM renders React fragments and responsive navigation destinations exist", async () => {
  const html = htm.bind(React.createElement);
  const markup = renderToStaticMarkup(html`<${React.Fragment}><b>Announcement</b><header>Navigation</header></${React.Fragment}>`);
  assert.equal(markup, "<b>Announcement</b><header>Navigation</header>");
  const [styles, app, worker] = await Promise.all([readFile(new URL("../src/styles.css", import.meta.url), "utf8"), readFile(new URL("../src/app.js", import.meta.url), "utf8"), readFile(new URL("../public/service-worker.js", import.meta.url), "utf8")]);
  for (const width of ["1080px", "780px", "430px"]) assert.ok(styles.includes(`max-width: ${width}`), width);
  for (const destination of ["collections", "crystals", "zodiac", "wishlist", "cart"]) assert.ok(app.includes(`"${destination}"`), destination);
  assert.ok(app.includes('aria-label="Main navigation"'));
  assert.ok(app.includes('aria-label="Mobile navigation"'));
  assert.ok(app.includes('className="carousel-track"'));
  assert.ok(app.includes('className="back-to-top"'));
  assert.ok(styles.includes("scroll-snap-type: x mandatory"));
  assert.ok(styles.includes(".product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }"));
  assert.ok(!worker.includes("/assets/product-placeholder.svg"));
});

test("customer-facing brand copy and PWA metadata use Crystal Baaz", async () => {
  const paths = [
    "../index.html",
    "../src/app.js",
    "../public/manifest.webmanifest",
    "../public/offline.html",
    "../public/assets/product-placeholder.svg",
    "../scripts/import_catalog.py",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bcrystal bazz\b/i, `${path} should not show the old brand name`);
  }

  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "Crystal Baaz");
  assert.equal(manifest.short_name, "Crystal Baaz");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /aria-label="Crystal Baaz home"/);
  assert.match(app, /className="brand-name">Crystal Baaz/);
});


test("a removed Shopify product never falls back to its cached catalog record", async () => {
  const cached = { id: "gid://shopify/Product/204", handle: "amethyst-bracelet", title: "Amethyst Bracelet", variants: [], images: [], availability: true };
  const service = createCatalogService({ provider: "shopify", workbook: [{ ...fixture[0], variants: [{ sku: "CB-204" }] }], adapter: {
    hasConnection: () => true,
    loadCatalog: async () => ({ products: [cached] }),
    loadProduct: async () => null,
  } });
  assert.equal((await service.loadCatalog()).products.length, 1);
  await assert.rejects(service.loadRoute({ page: "product", handle: cached.handle }), /no longer available from Shopify/);
});


test("Shopify-adjusted quantities reconcile without mutating local line identifiers", () => {
  const lines = [{ key: "p:v1", productId: "p", variantId: "v1", quantity: 9 }, { key: "p:v2", productId: "p", variantId: "v2", quantity: 1 }];
  const remote = { lines: { nodes: [{ merchandise: { id: "v1" }, quantity: 3 }] } };
  assert.deepEqual(reconcileShopifyCartLines(lines, remote), [{ ...lines[0], quantity: 3 }]);
  assert.equal(lines[0].quantity, 9);
  const unchanged = [{ ...lines[0], quantity: 3 }];
  assert.equal(reconcileShopifyCartLines(unchanged, remote), unchanged);
});
