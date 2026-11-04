#!/usr/bin/env node
// Verify workbook catalog data through the actual built app in Chrome.

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const previewUrl = process.env.CRYSTAL_BAZZ_PREVIEW_URL || "http://127.0.0.1:4174/";
const cdpUrl = process.env.CRYSTAL_BAZZ_CDP_URL || "http://127.0.0.1:9223";
const outputPath = resolve("reports/catalog/catalog-ui-audit.json");
const catalog = JSON.parse(await readFile("src/data/client-catalog.json", "utf8"));
const productsById = new Map(catalog.products.map((product) => [product.id, product]));

const issues = [];
const results = {
  previewUrl,
  viewport: { width: 390, height: 844, mobile: true },
  sourceProducts: catalog.products.length,
  sourceCollections: catalog.collections.length,
  homepage: {},
  categoriesPage: {},
  pagination: {},
  collectionRoutes: { checked: 0, productCardsRendered: 0, failures: [], routes: [] },
  productDetailRoutes: { checked: 0, failures: [], representativeInteractions: {}, detailPageReloads: 0 },
  search: {},
  filtersAndSorting: {},
  cart: {},
  pwa: {},
  issues,
};

const targetsResponse = await fetch(`${cdpUrl}/json`);
assert.ok(targetsResponse.ok, `Chrome DevTools endpoint returned ${targetsResponse.status}`);
const targets = await targetsResponse.json();
const target = targets.find((item) => item.type === "page" && item.url.startsWith(previewUrl));
assert.ok(target, `No Chrome page is open at ${previewUrl}`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const listeners = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve: resolveMessage, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${method}: ${message.error.message}`));
    else resolveMessage(message.result);
  } else if (message.method) {
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveMessage, reject) => {
    pending.set(id, { resolve: resolveMessage, reject, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function waitForEvent(method, timeout = 15000) {
  return new Promise((resolveEvent, reject) => {
    const methodListeners = listeners.get(method) || new Set();
    const listener = (payload) => { clearTimeout(timer); methodListeners.delete(listener); resolveEvent(payload); };
    methodListeners.add(listener);
    listeners.set(method, methodListeners);
    const timer = setTimeout(() => { methodListeners.delete(listener); reject(new Error(`Timed out waiting for ${method}`)); }, timeout);
  });
}

async function evaluate(expression, awaitPromise = true) {
  // JSON-encode results inside the page so large arrays do not exceed CDP's
  // nested-object serializer limits.
  const wrappedExpression = `Promise.resolve(eval(${JSON.stringify(expression)})).then((value) => JSON.stringify(value))`;
  const response = await send("Runtime.evaluate", { expression: wrappedExpression, returnByValue: true, awaitPromise });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Browser evaluation failed");
  const value = response.result?.value;
  return typeof value === "string" ? JSON.parse(value) : value;
}

const nextFrame = () => evaluate("Promise.race([new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))), new Promise((resolve) => setTimeout(resolve, 80))])", true);
const setHash = async (hash) => {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; window.scrollTo(0, 0); true`);
  await nextFrame();
};
const waitForRenderedProduct = (title) => evaluate(`new Promise((resolve) => {
  let attempts = 0;
  const check = () => {
    if (document.querySelector('.product-detail-page h1')?.textContent.trim() === ${JSON.stringify(title)} || attempts >= 12) resolve(true);
    else { attempts += 1; setTimeout(check, 30); }
  };
  check();
})`);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
const pageLoaded = waitForEvent("Page.loadEventFired");
await send("Page.navigate", { url: previewUrl });
await pageLoaded;
await evaluate("localStorage.removeItem('crystal-bazz-cart'); localStorage.removeItem('crystal-bazz-saved'); localStorage.removeItem('crystal-bazz-shopify-cart'); true");
const cleanLoaded = waitForEvent("Page.loadEventFired");
await send("Page.reload", { ignoreCache: true });
await cleanLoaded;
await nextFrame();

function fallbackTitle(product) {
  return product.title?.trim() || "Product title pending";
}

function selectedVariant(product) {
  const variants = product.variants || [];
  return variants.find((item) => item.canPurchase !== false && Number(item.price) > 0 && item.available !== false)
    || variants.find((item) => Number(item.price) > 0)
    || variants[0]
    || null;
}

function amountFromText(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits ? Number(digits) : null;
}

function compareArray(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function displayMoneyAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function expectedDiscount(price, compareAt) {
  const sale = Number(price);
  const list = Number(compareAt);
  return Number.isFinite(sale) && sale > 0 && list > sale ? Math.round((1 - sale / list) * 100) : null;
}

function recordFailure(scope, key, field, expected, actual) {
  const issue = { scope, key, field, expected, actual };
  issues.push(issue);
  return issue;
}

// Homepage sections should display records from the imported workbook catalog.
const newArrivalNav = catalog.navigation.find((group) => group.label === "New Arrivals");
const expectedNew = [];
for (const item of [...(newArrivalNav?.items || []), ...(newArrivalNav?.formItems || [])]) {
  if (!["collection", "group", "zodiac"].includes(item.kind)) continue;
  let matches = [];
  if (item.kind === "collection") matches = catalog.products.filter((product) => (product.collectionHandles || []).includes(item.target));
  else if (item.kind === "group") matches = catalog.products.filter((product) => (product.groupIds || []).includes(item.target));
  else if (item.kind === "search") {
    const words = String(item.target || "").trim().toLowerCase().split(/\s+/).map((word) => word.replace(/s$/, ""));
    matches = catalog.products.filter((product) => {
      const searchable = [product.title, product.handle, product.type, ...(product.collectionTitles || [])].filter(Boolean).join(" ").toLowerCase();
      return words.length > 0 && words.every((word) => searchable.includes(word));
    });
  }
  for (const product of matches) {
    if (product.title?.trim() && product.image && product.image !== "/assets/product-placeholder.svg" && !expectedNew.some((candidate) => candidate.id === product.id)) expectedNew.push(product);
  }
}
expectedNew.splice(12);
results.homepage = await evaluate(`(() => ({
  title: document.title,
  hero: Boolean(document.querySelector('.catalog-hero h1')),
  productRails: [...document.querySelectorAll('.home-reference-rail')].map((section) => ({ title: section.querySelector('h2')?.textContent.trim() || '', cards: section.querySelectorAll('.product-carousel .product-card').length })),
  newArrivals: [...document.querySelectorAll('.home-new-arrivals .product-card .product-title')].map((item) => item.textContent.trim()),
  header: Boolean(document.querySelector('.site-header')),
  bottomNavigation: Boolean(document.querySelector('.mobile-bottom-navigation'))
}))()`);
results.homepage.expectedNewArrivals = expectedNew.map(fallbackTitle);
if (!results.homepage.hero || !results.homepage.header || !results.homepage.bottomNavigation) recordFailure("homepage", "#home", "shell", "hero, header and bottom navigation present", results.homepage);
if (!compareArray(results.homepage.newArrivals, results.homepage.expectedNewArrivals)) recordFailure("homepage", "New Arrivals", "product_titles", results.homepage.expectedNewArrivals, results.homepage.newArrivals);

// Check the mobile category rail/sidebar and actual two-column grid layout.
await setHash("#collections");
results.categoriesPage = await evaluate(`(() => {
  const sidebar = document.querySelector('.category-sidebar--browser');
  const grid = document.querySelector('.mobile-categories-products .product-grid');
  return {
    heading: document.querySelector('.mobile-categories-heading h1')?.textContent.trim() || '',
    sidebarVisible: Boolean(sidebar && getComputedStyle(sidebar).display !== 'none' && sidebar.getBoundingClientRect().width > 0),
    sidebarEntries: sidebar?.querySelectorAll('.category-sidebar-item').length || 0,
    gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : '',
    productCards: grid?.querySelectorAll('.product-card').length || 0,
    documentWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  };
})()`);
const gridColumns = results.categoriesPage.gridColumns.split(" ").filter(Boolean).length;
if (!results.categoriesPage.sidebarVisible || !results.categoriesPage.sidebarEntries) recordFailure("categories", "#collections", "sidebar", "visible with entries", results.categoriesPage);
if (gridColumns !== 2) recordFailure("categories", "#collections", "mobile_grid_columns", 2, gridColumns);
if (results.categoriesPage.scrollWidth > results.categoriesPage.documentWidth) recordFailure("categories", "#collections", "horizontal_overflow", false, true);

// Confirm pagination starts with 24 and can expose every mapped product in a large collection.
const collectionTargets = catalog.collections.map((collection) => ({
  handle: collection.handle,
  title: collection.title,
  products: catalog.products.filter((product) => (product.collectionHandles || []).includes(collection.handle)),
}));
const largestCollection = [...collectionTargets].sort((a, b) => b.products.length - a.products.length)[0];
await setHash(`#collection/${encodeURIComponent(largestCollection.handle)}`);
let firstPageCount = await evaluate("document.querySelectorAll('.mobile-catalog-main .product-grid .product-card').length");
results.pagination = { collectionHandle: largestCollection.handle, collectionTitle: largestCollection.title, expectedProducts: largestCollection.products.length, initialCards: firstPageCount, expectedInitialCards: Math.min(24, largestCollection.products.length), loadMoreClicks: 0, finalCards: firstPageCount };
if (firstPageCount !== Math.min(24, largestCollection.products.length)) recordFailure("pagination", largestCollection.handle, "initial_page_size", Math.min(24, largestCollection.products.length), firstPageCount);
while (firstPageCount < largestCollection.products.length) {
  const clicked = await evaluate(`(() => { const button = document.querySelector('.mobile-catalog-main .load-more button'); if (!button) return false; button.click(); return true; })()`);
  if (!clicked) break;
  results.pagination.loadMoreClicks += 1;
  await nextFrame();
  firstPageCount = await evaluate("document.querySelectorAll('.mobile-catalog-main .product-grid .product-card').length");
  results.pagination.finalCards = firstPageCount;
}
results.pagination.completed = firstPageCount === largestCollection.products.length;
if (!results.pagination.completed) recordFailure("pagination", largestCollection.handle, "all_products_reachable", largestCollection.products.length, firstPageCount);

// Visit all workbook collection handles and compare every rendered card's title,
// product image URL and visible price to the generated data for that handle.
for (const collection of collectionTargets) {
  await setHash(`#collection/${encodeURIComponent(collection.handle)}`);
  const actual = await evaluate(`(() => ({
    heading: document.querySelector('.mobile-catalog-heading h1')?.textContent.trim() || '',
    total: Number((document.querySelector('.mobile-catalog-heading > span')?.textContent || '').match(/[0-9]+/)?.[0] || 0),
    cards: [...document.querySelectorAll('.mobile-catalog-main .product-grid .product-card')].map((card) => ({
      title: card.querySelector('.product-title')?.textContent.trim() || '',
      image: card.querySelector('.product-image')?.getAttribute('src') || '',
      price: card.querySelector('.product-price strong')?.textContent.trim() || '',
      mrp: card.querySelector('.product-price del')?.textContent.trim() || '',
      discount: card.querySelector('.product-price .product-discount')?.textContent.trim() || '',
      pending: Boolean(card.querySelector('.price-pending'))
    })),
    sidebar: Boolean(document.querySelector('.category-sidebar'))
  }))()`);
  const expectedProducts = collection.products;
  const routeFailures = [];
  if (actual.heading !== collection.title) routeFailures.push(recordFailure("collection", collection.handle, "title", collection.title, actual.heading));
  if (actual.total !== expectedProducts.length) routeFailures.push(recordFailure("collection", collection.handle, "product_count_label", expectedProducts.length, actual.total));
  if (actual.cards.length !== expectedProducts.length) routeFailures.push(recordFailure("collection", collection.handle, "rendered_product_count", expectedProducts.length, actual.cards.length));
  const comparable = Math.min(actual.cards.length, expectedProducts.length);
  for (let index = 0; index < comparable; index += 1) {
    const expected = expectedProducts[index];
    const found = actual.cards[index];
    const variant = selectedVariant(expected);
    const expectedPrice = Number(variant?.price ?? expected.price);
    const expectedCanShowPrice = Number.isFinite(expectedPrice) && expectedPrice > 0;
    if (found.title !== fallbackTitle(expected)) routeFailures.push(recordFailure("collection", collection.handle, `product_${index + 1}_title`, fallbackTitle(expected), found.title));
    if (found.image !== (expected.image || "/assets/product-placeholder.svg")) routeFailures.push(recordFailure("collection", collection.handle, `product_${index + 1}_image_display`, expected.image || "/assets/product-placeholder.svg", found.image === "/assets/product-placeholder.svg" ? `Fallback shown after image load failure for ${expected.image}` : found.image));
    const actualPrice = amountFromText(found.price);
    if (expectedCanShowPrice ? actualPrice !== expectedPrice : !found.pending) routeFailures.push(recordFailure("collection", collection.handle, `product_${index + 1}_price`, expectedCanShowPrice ? expectedPrice : "Price pending", found.price));
    const compareAt = Number(variant?.compareAt ?? variant?.compare_at_price ?? expected.compareAt);
    const expectedMrp = expectedCanShowPrice && compareAt > expectedPrice ? compareAt : null;
    const actualMrp = amountFromText(found.mrp);
    const expectedDisplayedMrp = expectedMrp == null ? null : displayMoneyAmount(expectedMrp);
    if ((expectedDisplayedMrp ?? null) !== (actualMrp ?? null)) routeFailures.push(recordFailure("collection", collection.handle, `product_${index + 1}_mrp`, expectedDisplayedMrp, actualMrp));
    const shownDiscount = Number(found.discount.match(/[0-9]+/)?.[0] || 0) || null;
    if (expectedDiscount(expectedPrice, compareAt) !== shownDiscount) routeFailures.push(recordFailure("collection", collection.handle, `product_${index + 1}_discount`, expectedDiscount(expectedPrice, compareAt), shownDiscount));
  }
  results.collectionRoutes.checked += 1;
  results.collectionRoutes.productCardsRendered += actual.cards.length;
  results.collectionRoutes.routes.push({ handle: collection.handle, title: actual.heading, expectedProducts: expectedProducts.length, renderedProducts: actual.cards.length, firstPageTarget: 24, failures: routeFailures.length });
}
console.log(`Collection route audit finished: ${results.collectionRoutes.checked}/${catalog.collections.length}`);

// Compare every product detail route: title, workbook copy, gallery sources,
// variant options, displayed price/MRP, attributes and exact collection labels.
// Keep CDP return objects small enough for Chrome's remote object serializer.
const detailBatchSize = 5;
for (let start = 0; start < catalog.products.length; start += detailBatchSize) {
  if (start % 100 === 0) console.log(`Product detail route audit: ${start}/${catalog.products.length}`);
  if (start > 0 && start % 100 === 0) {
    const reloaded = waitForEvent("Page.loadEventFired");
    await send("Page.reload", { ignoreCache: false });
    await reloaded;
    await nextFrame();
    results.productDetailRoutes.detailPageReloads += 1;
  }
  const batch = catalog.products.slice(start, start + detailBatchSize).map((product) => ({
    handle: product.handle,
    title: fallbackTitle(product),
    images: product.images?.length ? product.images : [product.image || "/assets/product-placeholder.svg"],
    description: (product.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    attributes: product.attributes || [],
    collections: product.collectionTitles || [],
    variants: product.variants || [],
    price: product.price,
    compareAt: product.compareAt,
    rating: product.rating,
    reviewCount: product.reviewCount,
  }));
  const batchResult = await evaluate(`(async (batch) => {
    const results = [];
    for (const item of batch) {
      history.replaceState({}, '', '#product/' + encodeURIComponent(item.handle));
      window.dispatchEvent(new PopStateEvent('popstate'));
      const expectedOptionCount = item.variants.length > 1 ? item.variants.length : 0;
      const expectedOptionIndex = Math.max(0, item.variants.findIndex((variant) => variant.canPurchase !== false && Number(variant.price) > 0 && variant.available !== false));
      const expectedVariant = item.variants[expectedOptionIndex];
      const expectedSku = expectedVariant?.sku || '';
      const expectedPrice = Number(expectedVariant?.price ?? item.price ?? 0);
      let routeSettled = false;
      await new Promise((resolve) => {
        let observer;
        const finish = (ready) => {
          routeSettled = ready;
          observer?.disconnect();
          clearTimeout(timer);
          resolve();
        };
        const check = () => {
          const title = document.querySelector('.product-detail-page h1')?.textContent.trim() || '';
          const options = [...document.querySelectorAll('.product-detail-page .size-option')];
          const selected = options.findIndex((button) => button.classList.contains('is-selected'));
          const primaryImage = document.querySelector('.product-detail-page .detail-photo-media img')?.getAttribute('src') || '';
          const detailPrice = document.querySelector('.product-detail-page .detail-price strong')?.textContent.trim() || '';
          const displayedPrice = Number(detailPrice.replace(/[^0-9]/g, '')) || 0;
          const skuValue = [...document.querySelectorAll('.product-detail-page .detail-attributes > div')]
            .find((row) => row.querySelector('dt')?.textContent.trim() === 'SKU')?.querySelector('dd')?.textContent.trim() || '';
          const imageReady = primaryImage === item.images[0] || primaryImage === '/assets/product-placeholder.svg';
          const priceReady = expectedPrice > 0 ? displayedPrice === Math.round(expectedPrice) : detailPrice.toLowerCase().includes('pending');
          const ready = location.hash === '#product/' + encodeURIComponent(item.handle)
            && title === item.title
            && options.length === expectedOptionCount
            && (expectedOptionCount === 0 || selected === expectedOptionIndex)
            && (!expectedSku || skuValue === expectedSku)
            && priceReady
            && imageReady;
          if (ready) finish(true);
        };
        observer = new MutationObserver(check);
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'class'] });
        const timer = setTimeout(() => finish(false), 2000);
        check();
      });
      const page = document.querySelector('.product-detail-page');
      const variantButtons = [...document.querySelectorAll('.product-detail-page .size-option')];
      const detailPrice = document.querySelector('.product-detail-page .detail-price');
      const attributeRows = [...document.querySelectorAll('.product-detail-page .detail-attributes > div')].map((row) => ({ label: row.querySelector('dt')?.textContent.trim() || '', value: row.querySelector('dd')?.textContent.trim() || '' }));
      const descriptions = document.querySelector('.product-detail-page .detail-description')?.textContent.replace(/\\s+/g, ' ').trim() || '';
      const selected = variantButtons.findIndex((button) => button.classList.contains('is-selected'));
      const media = [...document.querySelectorAll('.product-detail-page .detail-thumb img')].map((image) => image.getAttribute('src'));
      const primaryImage = document.querySelector('.product-detail-page .detail-photo-media img')?.getAttribute('src') || '';
      results.push({
        handle: item.handle,
        routeFound: Boolean(page),
        routeSettled,
        title: page?.querySelector('h1')?.textContent.trim() || '',
        description: descriptions,
        genericDescription: document.querySelector('.product-detail-page .detail-preview-copy')?.textContent.trim() || '',
        primaryImage,
        media,
        variants: variantButtons.length,
        selectedVariant: selected,
        selectedVariantText: variantButtons[selected]?.textContent.trim() || '',
        price: detailPrice?.querySelector('strong')?.textContent.trim() || '',
        mrp: detailPrice?.querySelector('del')?.textContent.trim() || '',
        discount: detailPrice?.querySelector('.product-discount')?.textContent.trim() || '',
        addDisabled: document.querySelector('.product-detail-page .detail-cart-row .detail-add')?.disabled ?? true,
        attributes: attributeRows,
        collections: [...document.querySelectorAll('.product-detail-page .product-collections div span')].map((item) => item.textContent.trim()),
        ratingVisible: Boolean(document.querySelector('.product-detail-page .detail-rating'))
      });
    }
    return results;
  })(${JSON.stringify(batch)})`);
  for (let index = 0; index < batch.length; index += 1) {
    const expected = batch[index];
    const actual = batchResult[index];
    const expectedVariantIndex = Math.max(0, expected.variants.findIndex((item) => item.canPurchase !== false && Number(item.price) > 0 && item.available !== false));
    const variant = expected.variants[expectedVariantIndex];
    const expectedPrice = variant ? Number(variant.price) : Number(expected.price);
    const expectedMrp = variant ? Number(variant.compareAt ?? variant.compare_at_price) : Number(expected.compareAt);
    const expectedCanAdd = Number.isFinite(expectedPrice) && expectedPrice > 0 && variant?.canPurchase !== false && variant?.available !== false;
    const failures = [];
    if (!actual?.routeFound) failures.push(recordFailure("product", expected.handle, "route", true, false));
    if (!actual?.routeSettled) failures.push(recordFailure("product", expected.handle, "route_render_settled", true, false));
    if (actual?.title !== expected.title) failures.push(recordFailure("product", expected.handle, "title", expected.title, actual?.title));
    if (actual?.primaryImage !== expected.images[0]) failures.push(recordFailure("product", expected.handle, "primary_image_display", expected.images[0], actual?.primaryImage === "/assets/product-placeholder.svg" ? `Fallback shown after image load failure for ${expected.images[0]}` : actual?.primaryImage));
    const actualImages = actual?.media?.length ? actual.media : actual?.primaryImage ? [actual.primaryImage] : [];
    if (!compareArray(actualImages, expected.images)) failures.push(recordFailure("product", expected.handle, "gallery_image_display", expected.images, actualImages));
    if (actual?.variants !== (expected.variants.length > 1 ? expected.variants.length : 0)) failures.push(recordFailure("product", expected.handle, "variant_option_count", expected.variants.length > 1 ? expected.variants.length : 0, actual?.variants));
    if (expected.variants.length > 1 && actual?.selectedVariant !== expectedVariantIndex) failures.push(recordFailure("product", expected.handle, "selected_variant_index", expectedVariantIndex, actual?.selectedVariant));
    if (Number.isFinite(expectedPrice) && expectedPrice > 0 ? amountFromText(actual?.price) !== expectedPrice : !actual?.price?.includes("pending")) failures.push(recordFailure("product", expected.handle, "price", expectedPrice > 0 ? expectedPrice : "Price pending", actual?.price));
    const actualMrp = amountFromText(actual?.mrp);
    const expectedDisplayedMrp = expectedPrice > 0 && expectedMrp > expectedPrice ? expectedMrp : null;
    const roundedDisplayedMrp = expectedDisplayedMrp == null ? null : displayMoneyAmount(expectedDisplayedMrp);
    if ((actualMrp ?? null) !== (roundedDisplayedMrp ?? null)) failures.push(recordFailure("product", expected.handle, "mrp", roundedDisplayedMrp, actualMrp));
    const shownDiscount = Number((actual?.discount || "").match(/[0-9]+/)?.[0] || 0) || null;
    if (expectedDiscount(expectedPrice, expectedMrp) !== shownDiscount) failures.push(recordFailure("product", expected.handle, "discount", expectedDiscount(expectedPrice, expectedMrp), shownDiscount));
    if (actual?.addDisabled === expectedCanAdd) failures.push(recordFailure("product", expected.handle, "preview_add_button_state", !expectedCanAdd, actual?.addDisabled));
    const descriptionPending = !expected.description || /^(product details are (being reviewed|pending)|description pending)/i.test(expected.description);
    if (descriptionPending ? !actual?.genericDescription : actual?.description !== expected.description) failures.push(recordFailure("product", expected.handle, "description", expected.description || "safe pending copy", actual?.description || actual?.genericDescription));
    const expectedAttributes = [...expected.attributes.map((item) => ({ label: item.label, value: item.value })), ...(variant?.sku ? [{ label: "SKU", value: variant.sku }] : [])];
    if (!compareArray(actual?.attributes || [], expectedAttributes)) failures.push(recordFailure("product", expected.handle, "attributes_and_sku", expectedAttributes, actual?.attributes || []));
    if (!compareArray(actual?.collections || [], expected.collections)) failures.push(recordFailure("product", expected.handle, "collection_titles", expected.collections, actual?.collections || []));
    if (expected.rating == null && expected.reviewCount == null && actual?.ratingVisible) failures.push(recordFailure("product", expected.handle, "fabricated_rating", false, true));
    results.productDetailRoutes.checked += 1;
  }
}

// Representative interaction checks for galleries, variant switching and source-backed prices.
const withGallery = catalog.products.find((product) => (product.images || []).length > 1);
const withVariants = catalog.products.find((product) => (product.variants || []).filter((item) => item.canPurchase !== false && Number(item.price) > 0).length > 1);
if (withGallery) {
  await setHash(`#product/${encodeURIComponent(withGallery.handle)}`);
  await waitForRenderedProduct(fallbackTitle(withGallery));
  const galleryInteraction = await evaluate(`(async () => {
    const before = document.querySelector('.detail-photo-media img')?.getAttribute('src') || '';
    const second = document.querySelectorAll('.detail-thumb')[1];
    second?.click();
    await Promise.race([new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))), new Promise((resolve) => setTimeout(resolve, 80))]);
    return { before, after: document.querySelector('.detail-photo-media img')?.getAttribute('src') || '', count: document.querySelectorAll('.detail-thumb').length };
  })()`);
  results.productDetailRoutes.representativeInteractions.gallery = { handle: withGallery.handle, ...galleryInteraction, expectedSecond: withGallery.images?.[1] || "" };
  if (galleryInteraction.after !== withGallery.images?.[1]) recordFailure("product-interaction", withGallery.handle, "gallery_thumb_selection", withGallery.images?.[1], galleryInteraction.after);
}
if (withVariants) {
  await setHash(`#product/${encodeURIComponent(withVariants.handle)}`);
  await waitForRenderedProduct(fallbackTitle(withVariants));
  const validIndexes = withVariants.variants.map((item, index) => item.canPurchase !== false && Number(item.price) > 0 ? index : -1).filter((index) => index >= 0);
  const targetVariantIndex = validIndexes[1];
  const variantInteraction = await evaluate(`(async () => {
    const buttons = [...document.querySelectorAll('.product-detail-page .size-option')];
    buttons[${targetVariantIndex}]?.click();
    await Promise.race([new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))), new Promise((resolve) => setTimeout(resolve, 80))]);
    const updatedButtons = [...document.querySelectorAll('.product-detail-page .size-option')];
    return { selected: updatedButtons.findIndex((button) => button.classList.contains('is-selected')), price: document.querySelector('.product-detail-page .detail-price strong')?.textContent.trim() || '', selectedText: updatedButtons[${targetVariantIndex}]?.textContent.trim() || '' };
  })()`);
  const expectedVariant = withVariants.variants[targetVariantIndex];
  results.productDetailRoutes.representativeInteractions.variant = { handle: withVariants.handle, ...variantInteraction, expectedPrice: expectedVariant.price, sku: expectedVariant.sku };
  if (variantInteraction.selected !== targetVariantIndex || amountFromText(variantInteraction.price) !== Number(expectedVariant.price)) recordFailure("product-interaction", withVariants.handle, "variant_selection", { index: targetVariantIndex, price: expectedVariant.price }, variantInteraction);
}

// Search by an exact workbook SKU and compare returned titles to the same data-layer selector.
const searchSeed = catalog.products.find((product) => product.variants?.[0]?.sku);
const searchQuery = searchSeed.variants[0].sku;
const searchExpected = catalog.products.filter((product) => {
  const needle = searchQuery.toLowerCase();
  const text = [product.title, product.handle, product.type, product.category, product.description, ...(product.collectionTitles || []), ...(product.collectionHandles || []), ...(product.tags || []), ...(product.keywords || []), ...(product.attributes || []).flatMap((item) => [item.label, item.value]), ...(product.variants || []).flatMap((item) => [item.sku, item.title])].filter(Boolean).join(" ").toLowerCase();
  return text.includes(needle);
});
await setHash(`#search/${encodeURIComponent(searchQuery)}`);
results.search = await evaluate(`(() => ({
  query: document.querySelector('.mobile-search-header input')?.value || '',
  heading: document.querySelector('.search-results-heading h1')?.textContent.trim() || '',
  resultCount: Number((document.querySelector('.search-results-heading span')?.textContent || '').match(/[0-9]+/)?.[0] || 0),
  titles: [...document.querySelectorAll('.search-results .product-title')].map((item) => item.textContent.trim()),
  firstImage: document.querySelector('.search-results .product-image')?.getAttribute('src') || ''
}))()`);
results.search.expectedCount = searchExpected.length;
results.search.expectedFirstPage = searchExpected.slice(0, 24).map(fallbackTitle);
if (results.search.query !== searchQuery || results.search.resultCount !== searchExpected.length || !compareArray(results.search.titles, results.search.expectedFirstPage)) recordFailure("search", searchQuery, "results", { count: searchExpected.length, titles: results.search.expectedFirstPage }, results.search);

// Exercise mobile price filters and sorting on a collection with multiple priced items.
const sortCollection = collectionTargets.find((collection) => collection.products.length >= 2 && collection.products.some((product) => Number(product.price) > 0)) || largestCollection;
await setHash(`#collection/${encodeURIComponent(sortCollection.handle)}`);
await evaluate("document.querySelector('.mobile-catalog-heading button')?.click(); true");
await nextFrame();
results.filtersAndSorting.drawerOpened = await evaluate("Boolean(document.querySelector('.filter-drawer[role=dialog]'))");
await evaluate(`(() => { const select = [...document.querySelectorAll('.filter-drawer select')].find((item) => [...item.options].some((option) => option.value === 'price-low')); if (!select) return false; select.value = 'price-low'; select.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('.filter-apply')?.click(); return true; })()`);
await nextFrame();
const sortedExpected = [...sortCollection.products].sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
results.filtersAndSorting.sortedTitles = await evaluate("[...document.querySelectorAll('.mobile-catalog-main .product-title')].slice(0,24).map(item => item.textContent.trim())");
results.filtersAndSorting.expectedSortedTitles = sortedExpected.slice(0, 24).map(fallbackTitle);
results.filtersAndSorting.sortValue = await evaluate("new URLSearchParams(location.hash.split('?')[1] || '').get('sort') || 'featured'");
if (!results.filtersAndSorting.drawerOpened) recordFailure("filters", sortCollection.handle, "drawer", true, false);
if (results.filtersAndSorting.sortValue !== "price-low" || !compareArray(results.filtersAndSorting.sortedTitles, results.filtersAndSorting.expectedSortedTitles)) recordFailure("sorting", sortCollection.handle, "price_low_order", { value: "price-low", titles: results.filtersAndSorting.expectedSortedTitles }, { value: results.filtersAndSorting.sortValue, titles: results.filtersAndSorting.sortedTitles });

// Cart add, quantity, total, removal and disabled checkout behavior.
const cartProduct = sortCollection.products.find((product) => selectedVariant(product)?.canPurchase !== false && Number(selectedVariant(product)?.price) > 0);
await evaluate("localStorage.removeItem('crystal-bazz-cart'); true");
const cleanCartLoaded = waitForEvent("Page.loadEventFired");
await send("Page.reload", { ignoreCache: false });
await cleanCartLoaded;
await nextFrame();
await setHash(`#collection/${encodeURIComponent(sortCollection.handle)}`);
const cartProductTitle = fallbackTitle(cartProduct);
results.cart.addProductTitle = cartProductTitle;
const cartAdded = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.mobile-catalog-main .product-card')].find((item) => item.querySelector('.product-title')?.textContent.trim() === ${JSON.stringify(cartProductTitle)});
  const add = card?.querySelector('.mobile-product-action button:not(:disabled)');
  if (!add) return false;
  add.click();
  return true;
})()`);
await nextFrame();
await setHash("#cart");
results.cart.initial = await evaluate(`(() => ({
  lines: document.querySelectorAll('.cart-page-line').length,
  title: document.querySelector('.cart-page-line h2')?.textContent.trim() || '',
  quantity: document.querySelector('.cart-page-line .cart-qty span')?.textContent || '',
  total: document.querySelector('.subtotal-row strong')?.textContent.trim() || '',
  checkoutDisabled: document.querySelector('.checkout-button')?.disabled ?? false
}))()`);
if (!cartAdded || results.cart.initial.lines !== 1 || results.cart.initial.title !== cartProductTitle || results.cart.initial.quantity !== "1") recordFailure("cart", cartProduct.handle, "add_to_cart", { title: cartProductTitle, lines: 1, quantity: "1" }, results.cart.initial);
const cartVariant = selectedVariant(cartProduct);
const expectedCartUnitPrice = Number(cartVariant?.price ?? cartProduct.price);
if (amountFromText(results.cart.initial.total) !== expectedCartUnitPrice) recordFailure("cart", cartProduct.handle, "initial_total", expectedCartUnitPrice, results.cart.initial.total);
if (!results.cart.initial.checkoutDisabled) recordFailure("cart", cartProduct.handle, "checkout_disabled", true, false);
await evaluate("document.querySelector('.cart-page-line .cart-qty button:last-child')?.click(); true");
await nextFrame();
results.cart.afterIncrement = await evaluate(`({ quantity: document.querySelector('.cart-page-line .cart-qty span')?.textContent || '', total: document.querySelector('.subtotal-row strong')?.textContent.trim() || '' })`);
if (results.cart.afterIncrement.quantity !== "2" || amountFromText(results.cart.afterIncrement.total) !== expectedCartUnitPrice * 2) recordFailure("cart", cartProduct.handle, "quantity_and_total", { quantity: "2", total: expectedCartUnitPrice * 2 }, results.cart.afterIncrement);
await evaluate("document.querySelector('.remove-line')?.click(); true");
await nextFrame();
results.cart.removed = await evaluate("document.querySelectorAll('.cart-page-line').length === 0");
if (!results.cart.removed) recordFailure("cart", cartProduct.handle, "remove_line", 0, await evaluate("document.querySelectorAll('.cart-page-line').length"));

results.pwa = await evaluate(`(async () => {
  const manifest = await fetch('/manifest.webmanifest').then((response) => response.json());
  const registration = await navigator.serviceWorker?.getRegistration();
  const icons = await Promise.all((manifest.icons || []).map(async (icon) => ({ src: icon.src, status: (await fetch(icon.src)).status })));
  return { manifest: Boolean(manifest.name), display: manifest.display, icons, registered: Boolean(registration), serviceWorkerState: registration?.active?.state || 'missing' };
})()`);

results.passed = issues.length === 0
  && results.homepage.newArrivals.length === results.homepage.expectedNewArrivals.length
  && results.collectionRoutes.checked === catalog.collections.length
  && results.productDetailRoutes.checked === catalog.products.length
  && results.pagination.completed
  && results.cart.removed;
results.summary = {
  productRoutesChecked: results.productDetailRoutes.checked,
  productRouteFailures: issues.filter((issue) => issue.scope === "product").length,
  collectionRoutesChecked: results.collectionRoutes.checked,
  collectionRouteFailures: issues.filter((issue) => issue.scope === "collection").length,
  collectionCardsRendered: results.collectionRoutes.productCardsRendered,
  renderedDataMismatches: issues.filter((issue) => (issue.scope === "product" || issue.scope === "collection") && !issue.field.includes("image_display") && !issue.field.includes("gallery_image_display")).length,
  imageFallbackDisplays: issues.filter((issue) => issue.field.includes("image_display") || issue.field.includes("gallery_image_display")).length,
  issues: issues.length,
};
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ passed: results.passed, summary: results.summary, pagination: results.pagination, categoriesPage: results.categoriesPage, representativeInteractions: results.productDetailRoutes.representativeInteractions, search: results.search, filtersAndSorting: results.filtersAndSorting, cart: results.cart, pwa: results.pwa, issueSample: issues.slice(0, 20), outputPath }, null, 2));
socket.close();

