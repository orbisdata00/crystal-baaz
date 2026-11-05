#!/usr/bin/env node
// Verify the desktop storefront shell, all collection routes, and common destinations.

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const previewUrl = process.env.CRYSTAL_BAZZ_PREVIEW_URL || "http://127.0.0.1:4174/";
const cdpUrl = process.env.CRYSTAL_BAZZ_CDP_URL || "http://127.0.0.1:9223";
const outputDir = resolve("reports/screenshots");
const catalog = JSON.parse(await readFile("src/data/client-catalog.json", "utf8"));
await mkdir(outputDir, { recursive: true });

const response = await fetch(`${cdpUrl}/json`);
assert.ok(response.ok, `Chrome DevTools endpoint returned ${response.status}`);
const targets = await response.json();
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
    const { resolve: resolveMessage, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolveMessage(message.result);
  } else if (message.method) {
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveMessage, reject) => {
    pending.set(id, { resolve: resolveMessage, reject });
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

async function evaluate(expression, awaitPromise = false) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Page evaluation failed");
  return result.result?.value;
}

async function waitForRoute(hash, delay = 100) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await evaluate("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))", true);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
}

async function setViewport(width, height = 950) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(outputDir, name), Buffer.from(result.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.setBypassServiceWorker", { bypass: true });
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });
// Keep repeated local preview audits independent of the cart added by an earlier run.
await evaluate("localStorage.removeItem('crystal-bazz-cart'); localStorage.removeItem('crystal-baaz-shopify-cart-lines'); localStorage.removeItem('crystal-baaz-shopify-cart'); true");
const freshUrl = new URL(previewUrl);
freshUrl.searchParams.set("desktop-audit", Date.now().toString());
const pageLoaded = waitForEvent("Page.loadEventFired");
await send("Page.navigate", { url: freshUrl.toString() });
await pageLoaded;
await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
await evaluate("document.fonts.ready.then(() => true)", true);
await waitForRoute("#home", 450);
await evaluate("window.scrollTo({ top: 0, behavior: 'instant' }); true");
await capture("home-desktop-baaz-after-1440.png");

const results = {
  previewUrl,
  sourceProducts: catalog.products.length,
  sourceCollections: catalog.collections.length,
  desktopWidths: [],
  collectionRoutes: { checked: 0, failures: [], results: [] },
  groupEmptyState: {},
  destinations: {},
  screenshots: [
    "reports/screenshots/home-desktop-baaz-after-1440.png",
    "reports/screenshots/collection-desktop-baaz-after-1280.png",
    "reports/screenshots/collection-desktop-baaz-after-1440.png",
    "reports/screenshots/product-desktop-baaz-after-1440.png",
    "reports/screenshots/cart-desktop-baaz-after-1440.png",
  ],
  failures: [],
};

for (const width of [1024, 1280, 1366, 1440, 1600, 1920]) {
  await setViewport(width, 950);
  const row = await evaluate(`(() => {
    const doc = document.documentElement;
    const header = document.querySelector('.site-header');
    const nav = document.querySelector('.main-nav');
    const mobileBar = document.querySelector('.mobile-bottom-navigation');
      const mobileGroupNav = document.querySelector('.mobile-category-navigation--global');
    return {
      width: ${width}, documentWidth: doc.clientWidth, scrollWidth: doc.scrollWidth,
      horizontalOverflow: doc.scrollWidth > doc.clientWidth,
      headerVisible: Boolean(header && getComputedStyle(header).display !== 'none' && header.getBoundingClientRect().height > 0),
      desktopNavVisible: Boolean(nav && getComputedStyle(nav).display !== 'none' && nav.getBoundingClientRect().height > 0),
      mobileNavHidden: !mobileBar || getComputedStyle(mobileBar).display === 'none',
      mobileGroupNavHidden: !mobileGroupNav || getComputedStyle(mobileGroupNav).display === 'none',
      brand: document.querySelector('.brand-name')?.textContent?.trim() || ''
    };
  })()`);
  results.desktopWidths.push(row);
  if (row.horizontalOverflow) results.failures.push({ area: "responsive-shell", width, issue: "horizontal-overflow", found: row.scrollWidth });
  if (!row.headerVisible || !row.desktopNavVisible || !row.mobileNavHidden || !row.mobileGroupNavHidden || !row.brand.toLowerCase().includes("baaz")) results.failures.push({ area: "responsive-shell", width, issue: "header-or-navigation", found: row });
}

const collections = catalog.collections.map((collection) => ({
  handle: collection.handle,
  title: collection.title,
  products: catalog.products.filter((product) => (product.collectionHandles || []).includes(collection.handle)),
}));
const group = (catalog.groups || []).find((item) => item.title === "Rudraksha 1-21 Mukhi");
assert.ok(group, "Workbook Rudraksha 1-21 Mukhi navigation group is missing");

for (const width of [1024, 1280]) {
  await setViewport(width, 950);
  for (const collection of collections) {
    await waitForRoute(`#collection/${encodeURIComponent(collection.handle)}`, 45);
    const actual = await evaluate(`(() => {
      const visible = (element) => Boolean(element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
      const hero = document.querySelector('.desktop-catalog-hero');
      const listing = document.querySelector('.desktop-catalog-listing');
      const mobile = document.querySelector('.mobile-catalog-layout');
      const grid = listing?.querySelector('.product-grid');
      const cards = [...(grid?.querySelectorAll('.product-card') || [])];
      const first = cards[0];
      const image = first?.querySelector('.product-image-wrap');
      return {
        hash: location.hash,
        heading: hero?.querySelector('h1')?.textContent?.trim() || '',
        mappedCount: Number((listing?.querySelector('.listing-topline')?.textContent || '').match(/[0-9]+/)?.[0] || 0),
        visibleHero: visible(hero), visibleListing: visible(listing), mobileHidden: !visible(mobile),
        visibleEmptyStates: [...(listing?.querySelectorAll('.no-products') || [])].filter(visible).length,
        cards: cards.length,
        columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        imageRatio: image ? Math.round(image.getBoundingClientRect().width / image.getBoundingClientRect().height * 100) / 100 : null,
        documentWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth
      };
    })()`);
    const expectedCards = Math.min(24, collection.products.length);
    const routeIssues = [];
    if (actual.heading !== collection.title) routeIssues.push(`heading ${JSON.stringify(actual.heading)} != ${JSON.stringify(collection.title)}`);
    if (actual.mappedCount !== collection.products.length) routeIssues.push(`mapped count ${actual.mappedCount} != ${collection.products.length}`);
    if (!actual.visibleHero || !actual.visibleListing || !actual.mobileHidden) routeIssues.push("desktop listing visibility is incorrect");
    if (actual.cards !== expectedCards) routeIssues.push(`visible cards ${actual.cards} != ${expectedCards}`);
    if (expectedCards && ![3, 4].includes(actual.columns)) routeIssues.push(`grid columns ${actual.columns} at ${width}px`);
    if (actual.cards && (actual.imageRatio == null || Math.abs(actual.imageRatio - 1) > 0.08)) routeIssues.push(`product image ratio ${actual.imageRatio} is not square`);
    if (actual.visibleEmptyStates !== (expectedCards ? 0 : 1)) routeIssues.push(`visible empty states ${actual.visibleEmptyStates} for ${expectedCards} products`);
    if (actual.scrollWidth > actual.documentWidth) routeIssues.push(`horizontal overflow ${actual.scrollWidth} > ${actual.documentWidth}`);
    if (routeIssues.length) results.collectionRoutes.failures.push({ width, handle: collection.handle, title: collection.title, issues: routeIssues, actual });
    results.collectionRoutes.results.push({ width, handle: collection.handle, title: collection.title, expectedProducts: collection.products.length, renderedCards: actual.cards, columns: actual.columns });
    results.collectionRoutes.checked += 1;
    if (width === 1280 && collection.handle === "bracelets") await capture("collection-desktop-baaz-after-1280.png");
  }
}

await setViewport(1440, 1000);
await waitForRoute("#collection/bracelets", 180);
await evaluate("window.scrollTo({ top: 0, behavior: 'instant' }); true");
await capture("collection-desktop-baaz-after-1440.png");
results.productCardLayout = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.desktop-catalog-listing .product-card')];
  const card = cards[0];
  const rect = (element) => { const box = element?.getBoundingClientRect(); return box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height } : null; };
  const prices = [...(card?.querySelectorAll('.product-price > strong, .product-price > del, .product-price > .product-discount') || [])];
  const overlaps = prices.some((left, index) => prices.slice(index + 1).some((right) => {
    const a = left.getBoundingClientRect(); const b = right.getBoundingClientRect();
    return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  }));
  const buttons = cards.slice(0, 8).map((item) => rect(item.querySelector('.desktop-product-action')));
  return {
    cardCount: cards.length, cardHeight: rect(card)?.height || 0,
    cardHeightsMatch: cards.slice(0, 8).every((item) => Math.abs(item.getBoundingClientRect().height - (rect(card)?.height || 0)) < 1),
    pricePiecesOverlap: overlaps,
    desktopButtonText: card?.querySelector('.desktop-product-action .quick-add')?.textContent?.trim() || "",
    desktopActionVisible: Boolean(card?.querySelector('.desktop-product-action') && getComputedStyle(card.querySelector('.desktop-product-action')).display !== 'none'),
    mobileActionHidden: !card?.querySelector('.mobile-product-action') || getComputedStyle(card.querySelector('.mobile-product-action')).display === 'none',
    actionWithinCard: buttons.every((button, index) => !button || (button.left >= rect(cards[index]).left && button.right <= rect(cards[index]).right && Math.abs(button.bottom - rect(cards[index]).bottom) < 16))
  };
})()`);
if (results.productCardLayout.pricePiecesOverlap || !results.productCardLayout.cardHeightsMatch || !results.productCardLayout.actionWithinCard || !results.productCardLayout.desktopActionVisible || !results.productCardLayout.mobileActionHidden || !["Add to cart", "Review required", "Price pending"].includes(results.productCardLayout.desktopButtonText)) {
  results.failures.push({ area: "product-card", issue: "card-alignment-or-action", found: results.productCardLayout });
}
await waitForRoute(`#group/${encodeURIComponent(group.id)}`, 180);
results.groupEmptyState = await evaluate(`(() => {
  const listing = document.querySelector('.desktop-catalog-listing');
  const visible = (element) => Boolean(element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
  const empty = [...(listing?.querySelectorAll('.no-products') || [])].filter(visible);
  return {
    route: location.hash, title: document.querySelector('.desktop-catalog-hero h1')?.textContent?.trim() || '',
    mappedProducts: listing?.querySelector('.product-grid')?.querySelectorAll('.product-card').length || 0,
    visibleEmptyCount: empty.length, emptyMessage: empty[0]?.querySelector('h3')?.textContent?.trim() || '',
    mobileLayoutHidden: !visible(document.querySelector('.mobile-catalog-layout')),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  };
})()`);
if (group.explicit_product_count !== 0 || results.groupEmptyState.mappedProducts !== 0 || results.groupEmptyState.visibleEmptyCount !== 1 || !results.groupEmptyState.mobileLayoutHidden || results.groupEmptyState.overflow) {
  results.failures.push({ area: "rudraksha-group", issue: "empty-group-route", found: results.groupEmptyState, workbookExplicitCount: group.explicit_product_count });
}

const sample = catalog.products.find((product) => product.handle && product.title && product.title.toLowerCase() !== "certificate" && (product.image || product.images?.length));
assert.ok(sample, "No product with an image was found for product detail audit");
await waitForRoute("#collection/bracelets", 180);
results.desktopCartInteraction = await evaluate(`(() => {
  const button = [...document.querySelectorAll('.desktop-product-action .quick-add:not(:disabled)')].find((item) => item.textContent.trim() === 'Add to cart');
  button?.click();
  return { available: Boolean(button), label: button?.textContent?.trim() || '', title: button?.closest('.product-card')?.querySelector('.product-title')?.textContent?.trim() || '' };
})()`);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
if (!results.desktopCartInteraction.available || results.desktopCartInteraction.label !== "Add to cart") results.failures.push({ area: "desktop-add-to-cart", issue: "button-text-or-action", found: results.desktopCartInteraction });
const routes = [
  ["categories", "#collections", ".collection-directory"],
  ["search", "#search/rudraksha", ".search-route"],
  ["wishlist", "#wishlist", ".catalog-page"],
  ["cart", "#cart", ".cart-page"],
  ["account", "#account", ".profile-page"],
  ["about", "#about", ".content-page"],
  ["policies", "#policies", ".content-page"],
];
for (const [name, hash, selector] of routes) {
  await waitForRoute(hash, 180);
  const result = await evaluate(`(() => {
    const page = document.querySelector(${JSON.stringify(selector)});
    const mobile = document.querySelector('.mobile-bottom-navigation');
    return {
      hash: location.hash, pageVisible: Boolean(page && getComputedStyle(page).display !== 'none' && page.getBoundingClientRect().height > 0),
      heading: page?.querySelector('h1')?.textContent?.trim() || '',
      documentWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      mobileNavHidden: !mobile || getComputedStyle(mobile).display === 'none'
    };
  })()`);
  results.destinations[name] = result;
  if (!result.pageVisible || !result.mobileNavHidden || result.scrollWidth > result.documentWidth) results.failures.push({ area: name, issue: "route-layout", found: result });
  if (name === "cart") {
    // Let the add-to-cart confirmation fade before capturing the stable cart layout.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3300));
    await capture("cart-desktop-baaz-after-1440.png");
    results.destinations.cartDetails = await evaluate(`(() => {
      const line = document.querySelector('.cart-page-line');
      const summary = document.querySelector('.cart-summary');
      const price = line?.querySelector('.cart-line-price');
      const pieces = [...(price?.children || [])].map((node) => node.getBoundingClientRect());
      const overlap = pieces.some((left, index) => pieces.slice(index + 1).some((right) => left.left < right.right - 1 && left.right > right.left + 1 && left.top < right.bottom - 1 && left.bottom > right.top + 1));
      const lineBox = line?.getBoundingClientRect(); const summaryBox = summary?.getBoundingClientRect();
      return {
        itemCount: document.querySelectorAll('.cart-page-line').length,
        heading: document.querySelector('.cart-hero h1')?.textContent?.trim() || '',
        linePricePiecesOverlap: overlap,
        pricePieceCount: pieces.length,
        summaryVisible: Boolean(summaryBox && summaryBox.width > 0 && summaryBox.height > 0),
        summaryDoesNotOverlapItems: !lineBox || !summaryBox || lineBox.right <= summaryBox.left || summaryBox.right <= lineBox.left,
        checkoutDisabled: Boolean(document.querySelector('.checkout-button')?.disabled),
        checkoutText: document.querySelector('.checkout-button')?.textContent?.trim() || '',
        documentWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth
      };
    })()`);
    if (results.destinations.cartDetails.itemCount !== 1 || results.destinations.cartDetails.linePricePiecesOverlap || !results.destinations.cartDetails.summaryVisible || !results.destinations.cartDetails.summaryDoesNotOverlapItems || !results.destinations.cartDetails.checkoutDisabled || results.destinations.cartDetails.scrollWidth > results.destinations.cartDetails.documentWidth) {
      results.failures.push({ area: "desktop-cart", issue: "cart-layout-or-pricing", found: results.destinations.cartDetails });
    }
  }
}

await waitForRoute(`#product/${encodeURIComponent(sample.handle)}`, 300);
results.destinations.product = await evaluate(`(() => {
  const page = document.querySelector('.product-detail-page');
  const image = page?.querySelector('.detail-gallery img, .detail-main-image img, .product-detail-image');
  return {
    route: location.hash, visible: Boolean(page && getComputedStyle(page).display !== 'none' && page.getBoundingClientRect().height > 0),
    heading: page?.querySelector('h1')?.textContent?.trim() || '',
    imagePresent: Boolean(image), imageWidth: image?.naturalWidth || 0,
    documentWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth
  };
})()`);
if (!results.destinations.product.visible || !results.destinations.product.heading || results.destinations.product.scrollWidth > results.destinations.product.documentWidth) {
  results.failures.push({ area: "product-detail", issue: "route-layout", found: results.destinations.product });
}
await capture("product-desktop-baaz-after-1440.png");

await waitForRoute("#home", 200);
const navTarget = await evaluate(`(() => { const bounds = document.querySelector('.main-nav .nav-mega-trigger')?.getBoundingClientRect(); return bounds ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : null; })()`);
if (navTarget) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: navTarget.x, y: navTarget.y, button: "none" });
await new Promise((resolveDelay) => setTimeout(resolveDelay, 220));
results.destinations.navigation = await evaluate(`(() => {
  const opened = document.querySelector('.nav-mega.is-open');
  return { opened: Boolean(opened), menuLinks: opened?.querySelectorAll('.mega-menu-link').length || 0, title: opened?.querySelector('.mega-menu-intro h3')?.textContent?.trim() || '' };
})()`);
if (!results.destinations.navigation.opened || results.destinations.navigation.menuLinks < 1) results.failures.push({ area: "navigation", issue: "desktop-dropdown", found: results.destinations.navigation });

await evaluate("window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
results.destinations.footer = await evaluate(`(() => {
  const footer = document.querySelector('.site-footer');
  const rect = footer?.getBoundingClientRect();
  return { present: Boolean(footer), visible: Boolean(rect && rect.height > 0), brand: footer?.querySelector('.brand-name')?.textContent?.trim() || '', links: footer?.querySelectorAll('.footer-links button').length || 0 };
})()`);
if (!results.destinations.footer.present || !results.destinations.footer.visible || !results.destinations.footer.brand.includes("baaz") || results.destinations.footer.links < 1) results.failures.push({ area: "footer", issue: "footer-layout", found: results.destinations.footer });

results.collectionRoutes.pass = results.collectionRoutes.failures.length === 0;
results.pass = results.failures.length === 0 && results.collectionRoutes.pass;
await writeFile(resolve(outputDir, "desktop-layout-audit.json"), `${JSON.stringify(results, null, 2)}\n`);
socket.close();
console.log(JSON.stringify({ pass: results.pass, desktopWidths: results.desktopWidths.length, collectionsChecked: results.collectionRoutes.checked, collectionFailures: results.collectionRoutes.failures.length, otherFailures: results.failures.length, screenshots: results.screenshots, report: "reports/screenshots/desktop-layout-audit.json" }, null, 2));
if (!results.pass) process.exitCode = 1;
