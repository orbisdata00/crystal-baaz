import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const previewUrl = process.env.CRYSTAL_BAZZ_PREVIEW_URL || "http://127.0.0.1:4173/";
const cdpUrl = process.env.CRYSTAL_BAZZ_CDP_URL || "http://127.0.0.1:9223";
const outputDir = resolve(process.env.CRYSTAL_BAZZ_AUDIT_OUTPUT_DIR || "reports/screenshots");
const auditSuffix = process.env.CRYSTAL_BAZZ_AUDIT_SUFFIX ? `-${process.env.CRYSTAL_BAZZ_AUDIT_SUFFIX}` : "";
const reportPath = resolve(process.env.CRYSTAL_BAZZ_AUDIT_REPORT || "reports/screenshots/responsive-audit.json");
await mkdir(outputDir, { recursive: true });

const targetsResponse = await fetch(`${cdpUrl}/json`);
if (!targetsResponse.ok) throw new Error(`Chrome DevTools endpoint returned ${targetsResponse.status}`);
const targets = await targetsResponse.json();
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No Chrome page target is available.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const events = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve: resolveMessage, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolveMessage(message.result);
  } else if (message.method) {
    for (const listener of events.get(message.method) || []) listener(message.params || {});
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveMessage, reject) => {
    pending.set(id, { resolve: resolveMessage, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function waitForEvent(method, timeout = 12000) {
  return new Promise((resolveEvent, reject) => {
    const listeners = events.get(method) || new Set();
    const listener = (payload) => { clearTimeout(timer); listeners.delete(listener); resolveEvent(payload); };
    listeners.add(listener);
    events.set(method, listeners);
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Timed out waiting for ${method}`)); }, timeout);
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Page evaluation failed");
  return result.result?.value;
}

async function setViewport(width, height, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(outputDir, name.replace(/\.png$/i, `${auditSuffix}.png`)), Buffer.from(result.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.setBypassServiceWorker", { bypass: true });
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
const loaded = waitForEvent("Page.loadEventFired");
const freshUrl = new URL(previewUrl);
freshUrl.searchParams.set("responsive-audit", Date.now().toString());
await send("Page.navigate", { url: freshUrl.toString() });
await loaded;
await evaluate("localStorage.clear(); sessionStorage.clear(); true");
await evaluate("Promise.all([navigator.serviceWorker?.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))) || [], caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name))))]).then(() => true)", true);
await send("Network.setBypassServiceWorker", { bypass: false });
await send("Network.setCacheDisabled", { cacheDisabled: false });
const cleanReload = waitForEvent("Page.loadEventFired");
await send("Page.reload", { ignoreCache: true });
await cleanReload;
await evaluate("document.fonts.ready.then(() => true)", true);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
await evaluate("document.querySelectorAll('.mobile-category-tile-image img, .product-carousel img').forEach((image) => { image.loading = 'eager'; }); true");
await evaluate(`Promise.race([Promise.all([...document.querySelectorAll('.mobile-category-tile-image img, .product-carousel img')].map((image) => image.decode().catch(() => false))), new Promise((resolveDelay) => setTimeout(resolveDelay, 4500))])`, true);
await evaluate("new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))", true);

const audit = [];
for (const [width, height, mobile] of [[320, 844, true], [360, 800, true], [375, 812, true], [390, 844, true], [414, 896, true], [427, 952, true], [430, 932, true], [440, 956, true], [768, 1024, true], [1024, 900, false], [1280, 900, false], [1440, 1000, false]]) {
  await setViewport(width, height, mobile);
  const row = await evaluate(`(() => {
    const doc = document.documentElement;
    const measure = (selector) => {
      const track = document.querySelector(selector);
      if (!track) return null;
      track.scrollLeft = 0;
      const bounds = track.getBoundingClientRect();
      const cards = [...track.children].map((card) => card.getBoundingClientRect());
      const full = cards.filter((card) => card.left >= bounds.left - 1 && card.right <= bounds.right + 1).length;
      const partial = cards.find((card) => card.left < bounds.right && card.right > bounds.right);
      return { trackWidth: Math.round(bounds.width), scrollWidth: track.scrollWidth, clientWidth: track.clientWidth, cardCount: cards.length, fullyVisibleCards: full, nextCardPeekPercent: partial ? Math.round((bounds.right - partial.left) / partial.width * 100) : 0, scrollSnapType: getComputedStyle(track).scrollSnapType };
    };
    return {
      viewport: ${width}, documentWidth: doc.clientWidth, scrollWidth: doc.scrollWidth,
      horizontalOverflow: doc.scrollWidth > doc.clientWidth,
      categories: measure('.mobile-category-tiles'),
      products: measure('.home-new-arrivals .product-carousel .carousel-track'),
      stickyPosition: getComputedStyle(document.querySelector('.mobile-discovery-sticky')).position,
      categoryTabsOverflow: (document.querySelector('.mobile-category-navigation')?.scrollWidth || 0) > (document.querySelector('.mobile-category-navigation')?.clientWidth || 0),
      categoryTiles: document.querySelectorAll('.mobile-category-tiles > button').length,
      intentionTiles: 0,
      exploreTiles: 0
    };
  })()`);
  audit.push(row);
  if ([360, 390, 427, 430, 440].includes(width)) await capture(`home-mobile-${width}.png`);
}

await setViewport(390, 844, true);
const loadedImagesAtCapture = await evaluate("[...document.querySelectorAll('.mobile-category-tile-image img')].filter((image) => image.complete && image.naturalWidth > 0).length");
const imageStatesAtCapture = await evaluate(`[...document.querySelectorAll('.mobile-category-tiles > button')].map((tile) => { const image = tile.querySelector('.mobile-category-tile-image img'); return { title: tile.textContent.trim(), loaded: Boolean(image?.complete && image?.naturalWidth), hidden: Boolean(image?.hidden), display: image ? getComputedStyle(image).display : 'none' }; })`);
const carouselScrollCheck = await evaluate(`(async () => {
  const first = document.querySelector('.mobile-category-tiles');
  const second = document.querySelector('.home-new-arrivals .product-carousel .carousel-track');
  if (!first || !second) return { available: false };
  first.scrollLeft = 0; second.scrollLeft = 0;
  first.scrollBy({ left: 140, behavior: 'instant' });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  const moved = first.scrollLeft;
  const otherStayedAtStart = second.scrollLeft === 0;
  second.focus(); second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  return { available: true, moved, keyboardPosition: second.scrollLeft, otherStayedAtStart, categoriesSnap: getComputedStyle(first).scrollSnapType };
})()`, true);
await evaluate("document.querySelector('.home-new-arrivals')?.scrollIntoView({ behavior: 'instant', block: 'start' }); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
await capture("home-products-mobile-390.png");
const stickyCheck = await evaluate(`(async () => {
  window.scrollTo({ top: 560, behavior: 'instant' });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  const sticky = document.querySelector('.mobile-discovery-sticky');
  const header = document.querySelector('.site-header');
  return { visible: getComputedStyle(sticky).display !== 'none', top: Math.round(sticky.getBoundingClientRect().top), headerBottom: Math.round(header.getBoundingClientRect().bottom), position: getComputedStyle(sticky).position };
})()`, true);
await evaluate("window.scrollTo({ top: 0, behavior: 'instant' }); true");
await setViewport(1440, 1000, false);
await capture("home-desktop-redesign.png");
await setViewport(390, 844, true);
await evaluate("location.hash = '#collection/bracelets'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
await capture("collection-mobile-redesign.png");
const routeCheck = await evaluate(`({ hash: location.hash, title: document.querySelector('.page-hero h1')?.textContent || document.querySelector('h1')?.textContent || '', tileCount: document.querySelectorAll('.product-card').length })`);
await evaluate("location.hash = '#collections'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
await capture("categories-mobile-baaz-after.png");
await evaluate("location.hash = '#home'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
await evaluate(`[...document.querySelectorAll('.mobile-category-tiles > button')].find((button) => button.textContent.trim() === 'Rings')?.click(); true`);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
const categoryTabCheck = await evaluate(`({ hash: location.hash, title: document.querySelector('.page-hero h1')?.textContent || '' })`);
await evaluate("location.hash = '#home'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
const cartInteractionCheck = await evaluate(`(async () => {
  const track = document.querySelector('.product-carousel .carousel-track');
  const adds = [...document.querySelectorAll('.product-carousel .quick-add:not(:disabled)')];
  if (!track || !adds.length) return { available: false };
  const secondCard = adds[1]?.closest('.product-card');
  if (secondCard) track.scrollLeft = Math.max(0, secondCard.offsetLeft - track.offsetLeft);
  await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  const trackBounds = track.getBoundingClientRect();
  const add = adds.find((button) => { const bounds = button.getBoundingClientRect(); return bounds.left >= trackBounds.left && bounds.left < trackBounds.right; }) || adds[0];
  const card = add.closest('.product-card');
  const before = track.scrollLeft;
  add.click();
  await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  if (!card) return { available: false, reason: 'product card was not retained after adding' };
  const quantity = () => card.querySelector('.quick-quantity span')?.textContent || '';
  const afterAdd = quantity();
  card.querySelector('.quick-quantity button:last-child')?.click();
  await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  const afterPlus = quantity();
  card.querySelector('.quick-quantity button:first-child')?.click();
  await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  const afterMinus = quantity();
  const afterInteraction = track.scrollLeft;
  card.querySelector('.quick-quantity button:first-child')?.click();
  await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  return { available: true, beforeScroll: before, afterInteractionScroll: afterInteraction, afterAdd, afterPlus, afterMinus, cartCount: Number([...document.querySelectorAll('.mobile-bottom-item')].find((item) => item.textContent.includes('Cart'))?.querySelector('i')?.textContent || 0), returnedToAdd: Boolean(card.querySelector('.quick-add')) };
})()`, true);
await evaluate("window.scrollTo(0, 760); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
const backToTopCheck = await evaluate(`({ visible: Boolean(document.querySelector('.back-to-top')), position: document.querySelector('.back-to-top') ? getComputedStyle(document.querySelector('.back-to-top')).position : '' })`);
await evaluate("document.querySelector('.back-to-top')?.click(); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 1100));
const backToTopReturned = await evaluate("window.scrollY < 20");
await evaluate("location.hash = '#home'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
await evaluate("document.querySelector('.search-tool')?.click(); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
await evaluate("document.querySelector('.mobile-search-header input')?.focus(); true");
await send("Input.insertText", { text: "rose quartz" });
await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
const searchSuggestionCount = await evaluate("document.querySelectorAll('.search-results .product-card').length");
const searchCheck = await evaluate(`({ hash: location.hash, title: document.querySelector('.search-results h1')?.textContent || '', resultCount: document.querySelectorAll('.search-results .product-card').length })`);
await capture("search-mobile-baaz-after.png");

await evaluate("location.hash = '#home'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
await evaluate("document.querySelector('.menu-toggle')?.click(); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 160));
const mobileMenuOpenCheck = await evaluate(`(() => {
  const menu = document.querySelector('.mobile-nav');
  return { opened: Boolean(menu), groupCount: menu?.querySelectorAll('.mobile-nav-group').length || 0, browseAll: Boolean(menu?.querySelector('.mobile-nav-all')) };
})()`);
await evaluate("document.querySelector('.mobile-nav-group summary')?.click(); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 140));
const mobileNavigationCheck = await evaluate(`({ ...${JSON.stringify(mobileMenuOpenCheck)}, firstGroupExpanded: Boolean(document.querySelector('.mobile-nav-group')?.open) })`);
await evaluate("document.querySelector('.menu-toggle')?.click(); true");
await setViewport(1440, 1000, false);
await evaluate("document.querySelector('.main-nav .nav-mega-trigger')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
const desktopNavigationCheck = await evaluate(`(() => {
  const open = document.querySelector('.nav-mega.is-open');
  return { opened: Boolean(open), menuTitle: open?.querySelector('h3')?.textContent || '', linkCount: open?.querySelectorAll('.mega-menu-link').length || 0 };
})()`);
await setViewport(390, 844, true);

await evaluate("location.hash = '#home'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
const selectedProduct = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.product-carousel .product-card')].find((item) => !item.querySelector('.quick-add')?.disabled);
  const title = card?.querySelector('.product-title');
  const label = title?.textContent?.trim() || '';
  title?.click();
  return label;
})()`);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 550));
const productRoute = await evaluate("location.hash");
const productDetailCheck = await evaluate(`(() => ({
  route: location.hash,
  title: document.querySelector('.product-detail-page h1')?.textContent?.trim() || '',
  imageCount: document.querySelectorAll('.detail-thumb').length || 1,
  addEnabled: Boolean(document.querySelector('.detail-add') && !document.querySelector('.detail-add').disabled),
  wishlistAction: Boolean(document.querySelector('.detail-gallery-save'))
}))()`);
await capture("product-mobile-baaz-after.png");
await evaluate("document.querySelector('.detail-gallery-save')?.click(); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 220));
await evaluate("location.hash = '#wishlist'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
await capture("wishlist-mobile-baaz-after.png");
const wishlistCheck = await evaluate(`(() => ({
  route: location.hash,
  savedCount: document.querySelectorAll('.product-card').length,
  containsSelectedProduct: [...document.querySelectorAll('.product-title')].some((node) => node.textContent.trim() === ${JSON.stringify(selectedProduct)})
}))()`);
await evaluate(`${JSON.stringify(productRoute)} && (location.hash = ${JSON.stringify(productRoute)}); true`);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 480));
await evaluate("document.querySelector('.detail-add:not(:disabled)')?.click(); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 260));
await evaluate("location.hash = '#cart'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
const cartBeforeReloadCheck = await evaluate(`(() => ({
  lineCount: document.querySelectorAll('.cart-page-line').length,
  quantity: document.querySelector('.cart-page-line .cart-qty span')?.textContent || '',
  checkoutDisabled: Boolean(document.querySelector('.checkout-button')?.disabled),
  checkoutText: document.querySelector('.checkout-button')?.textContent?.trim() || ''
}))()`);
await capture("cart-mobile-baaz-after.png");
await evaluate("document.querySelector('.cart-page-line .cart-qty button:last-child')?.click(); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
const cartQuantityUpdateCheck = await evaluate("document.querySelector('.cart-page-line .cart-qty span')?.textContent || ''");
const cartReload = waitForEvent("Page.loadEventFired");
await send("Page.reload", { ignoreCache: false });
await cartReload;
await new Promise((resolveDelay) => setTimeout(resolveDelay, 380));
const cartPersistenceCheck = await evaluate(`(() => ({
  lineCount: document.querySelectorAll('.cart-page-line').length,
  quantity: document.querySelector('.cart-page-line .cart-qty span')?.textContent || ''
}))()`);
await evaluate("document.querySelector('.remove-line')?.click(); true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 260));
const cartRemovalCheck = await evaluate("document.querySelectorAll('.cart-page-line').length === 0");
await evaluate("location.hash = '#wishlist'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 380));
const wishlistPersistenceCheck = await evaluate(`[...document.querySelectorAll('.product-title')].some((node) => node.textContent.trim() === ${JSON.stringify(selectedProduct)})`);
await evaluate("location.hash = '#account'; true");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 380));
await capture("profile-mobile-baaz-after.png");

await evaluate(`new Promise((resolveController) => {
  if (navigator.serviceWorker?.controller) return resolveController(true);
  const timer = setTimeout(() => resolveController(false), 2200);
  navigator.serviceWorker?.addEventListener('controllerchange', () => { clearTimeout(timer); resolveController(true); }, { once: true });
})`, true);
const initiallyControlled = await evaluate("Boolean(navigator.serviceWorker?.controller)");
if (!initiallyControlled) {
  const controlReload = waitForEvent("Page.loadEventFired", 10000);
  await send("Page.reload", { ignoreCache: false });
  await controlReload;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
}
const pwaCheck = await evaluate(`(async () => {
  const manifestResponse = await fetch('/manifest.webmanifest');
  const manifest = await manifestResponse.json();
  const offlineResponse = await fetch('/offline.html');
  const serviceWorkerResponse = await fetch('/service-worker.js');
  const iconStatuses = await Promise.all(manifest.icons.map(async (icon) => (await fetch(icon.src)).status));
  const registration = await navigator.serviceWorker?.getRegistration();
  const cacheNames = await caches.keys();
  const cacheEntries = await Promise.all(cacheNames.map(async (name) => ({ name, urls: (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname) })));
  return { manifestStatus: manifestResponse.status, appName: manifest.name, display: manifest.display, icons: manifest.icons.length, iconStatuses, offlineStatus: offlineResponse.status, serviceWorkerStatus: serviceWorkerResponse.status, registered: Boolean(registration), controlled: Boolean(navigator.serviceWorker?.controller), workerState: registration?.active?.state || "missing", cacheEntries };
})()`, true);

await send("Network.enable");
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" });
const offlineFetchCheck = await evaluate(`fetch('/offline.html').then(async (response) => ({ status: response.status, containsOfflineCopy: (await response.text()).includes("You're offline") })).catch((error) => ({ error: error.message }))`, true);
const offlineLoad = waitForEvent("Page.loadEventFired", 10000);
await send("Page.navigate", { url: `${previewUrl}?offline-check=1` });
await offlineLoad;
await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
const offlineCheck = await evaluate(`({ homeSearch: Boolean(document.querySelector('.search-tool')), pageTitle: document.title, offlineFallback: location.pathname.endsWith('/offline.html') })`);
await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "wifi" });

assert.ok(audit.every((row) => !row.horizontalOverflow), "A viewport has document-level horizontal overflow");
assert.ok(audit.filter((row) => [427, 440].includes(row.viewport)).every((row) => row.categories?.nextCardPeekPercent > 0 && row.products?.nextCardPeekPercent > 0), `Requested mobile carousel previews are missing: ${JSON.stringify(audit.filter((row) => [427, 440].includes(row.viewport)))}`);
assert.equal(routeCheck.title, "Bracelets");
assert.equal(categoryTabCheck.title, "Rings");
assert.ok(carouselScrollCheck.moved > 0 && carouselScrollCheck.otherStayedAtStart && carouselScrollCheck.keyboardPosition > 0, "Independent or keyboard carousel scrolling failed");
assert.ok(mobileNavigationCheck.opened && mobileNavigationCheck.firstGroupExpanded && mobileNavigationCheck.browseAll, "Mobile category drawer did not open correctly");
assert.ok(desktopNavigationCheck.opened && desktopNavigationCheck.linkCount > 0, "Desktop mega menu did not open");
assert.ok(selectedProduct && productDetailCheck.title === selectedProduct && productDetailCheck.addEnabled, "Product detail flow failed");
assert.ok(wishlistCheck.containsSelectedProduct && wishlistPersistenceCheck, "Wishlist state did not persist");
assert.equal(cartBeforeReloadCheck.lineCount, 1);
assert.equal(cartBeforeReloadCheck.checkoutDisabled, true, "Preview checkout must remain disabled");
assert.equal(cartQuantityUpdateCheck, "2");
assert.deepEqual(cartPersistenceCheck, { lineCount: 1, quantity: "2" });
assert.equal(cartRemovalCheck, true);
assert.ok(pwaCheck.registered && pwaCheck.controlled && pwaCheck.workerState === "activated", "PWA service worker did not activate");
assert.ok(pwaCheck.iconStatuses.every((status) => status === 200), "A PWA icon could not be loaded");
assert.equal(offlineCheck.homeSearch, true, "Offline app shell did not load");

await writeFile(reportPath, JSON.stringify({ previewUrl, viewports: audit, loadedImagesAtCapture, imageStatesAtCapture, routeCheck, categoryTabCheck, carouselScrollCheck, stickyCheck, cartInteractionCheck, backToTopCheck, backToTopReturned, searchCheck, searchSuggestionCount, mobileNavigationCheck, desktopNavigationCheck, selectedProduct, productDetailCheck, wishlistCheck, cartBeforeReloadCheck, cartQuantityUpdateCheck, cartPersistenceCheck, cartRemovalCheck, wishlistPersistenceCheck, pwaCheck, initiallyControlled, offlineFetchCheck, offlineCheck }, null, 2));
console.log(JSON.stringify({ viewports: audit, loadedImagesAtCapture, routeCheck, categoryTabCheck, carouselScrollCheck, stickyCheck, cartInteractionCheck, backToTopCheck, backToTopReturned, searchCheck, searchSuggestionCount, mobileNavigationCheck, desktopNavigationCheck, selectedProduct, productDetailCheck, wishlistCheck, cartBeforeReloadCheck, cartQuantityUpdateCheck, cartPersistenceCheck, cartRemovalCheck, wishlistPersistenceCheck, pwaCheck, initiallyControlled, offlineFetchCheck, offlineCheck }, null, 2));
socket.close();
process.exit(0);
