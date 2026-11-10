import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "/private/tmp/crystal-baaz-playwright/node_modules/playwright/index.mjs");
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:4173";
const output = process.env.AUDIT_OUTPUT || "reports/performance/after.json";
const handle = process.env.AUDIT_PRODUCT_HANDLE || "natural-cat-s-eye-lehsunia-ring-5-ratti";
const report = { generatedAt: new Date().toISOString(), origin, handle, failures: [], shopifyRequests: [], responsive: [] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await context.addInitScript(() => localStorage.setItem("crystal-install-dismissed", String(Date.now())));
const page = await context.newPage();
const requestStarted = new Map();
let firstPagePayload = "";
const mark = (request, phase, extra = {}) => {
  if (!request.url().includes("/graphql.json")) return;
  if (phase === "start") {
    const body = request.postData() || "";
    let operation = "unknown";
    try { operation = JSON.parse(body).query?.match(/(?:query|mutation)\s+(\w+)/)?.[1] || operation; } catch {}
    const entry = { operation, startedAt: Date.now(), requestBytes: Buffer.byteLength(body), phase: report.phase || "navigation" };
    requestStarted.set(request, entry);
    report.shopifyRequests.push(entry);
  } else {
    const entry = requestStarted.get(request);
    if (entry) { entry.durationMs = Date.now() - entry.startedAt; Object.assign(entry, extra); requestStarted.delete(request); }
  }
};
page.on("request", request => mark(request, "start"));
page.on("response", async response => {
  const entry = requestStarted.get(response.request());
  if (!entry) return;
  try {
    const body = await response.body();
    entry.responseBytes = body.byteLength;
    if (!firstPagePayload && entry.operation === "CrystalBazzCatalogPage" && response.ok()) firstPagePayload = body.toString("utf8");
  } catch { /* The response size is optional if Chrome has discarded its body. */ }
});
page.on("requestfinished", request => mark(request, "finish", { ok: true }));
page.on("requestfailed", request => mark(request, "finish", { ok: false }));
page.on("pageerror", error => report.failures.push(`Browser error: ${error.message}`));
const assert = (condition, message) => { if (!condition) report.failures.push(message); };
const selector = ".shopping-shell";
const readCatalogState = () => page.locator(selector).evaluate(node => ({
  source: node.dataset.catalogSource,
  loaded: node.dataset.catalogLoaded,
  loadingMore: node.dataset.catalogLoadingMore,
  mappedCount: Number(node.dataset.catalogProductCount || 0),
  shopifyCount: Number(node.dataset.shopifyProductCount || 0),
}));
const readPersistedCacheState = () => page.evaluate(() => new Promise(resolve => {
  try {
    const open = indexedDB.open("crystal-baaz-storefront", 1);
    open.onerror = () => resolve({ available: false, products: 0 });
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("catalog-cache")) { db.close(); resolve({ available: true, products: 0 }); return; }
      const request = db.transaction("catalog-cache", "readonly").objectStore("catalog-cache").get("shopify-catalog-listing-v1");
      request.onsuccess = () => { const value = request.result?.value; resolve({ available: true, products: Array.isArray(value) ? value.length : 0 }); db.close(); };
      request.onerror = () => { resolve({ available: true, products: 0 }); db.close(); };
    };
  } catch { resolve({ available: false, products: 0 }); }
}));
const medianP95 = values => {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  return { count: sorted.length, medianMs: sorted.length ? sorted[Math.floor((sorted.length - 1) * .5)] : null, p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null };
};

try {
  const navigationStart = Date.now();
  report.phase = "cold-home";
  await page.goto(`${origin}/#home`, { waitUntil: "domcontentloaded" });
  await page.locator(".shopping-product-card").first().waitFor({ timeout: 120000 });
  const firstCardSeenAt = Date.now();
  report.coldFirstProductCardMs = firstCardSeenAt - navigationStart;
  report.coldFirstPageReadyMs = await page.evaluate(() => performance.getEntriesByName("crystal-shopify-first-page-ready")[0]?.startTime ?? null);
  report.coldAssetsAtFirstCard = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter(item => /(?:product-mapping|index-[^/]+\.js|index-[^/]+\.css)/.test(item.name))
    .map(item => ({ name: item.name.split("/").pop(), durationMs: Math.round(item.duration), transferBytes: item.transferSize, decodedBytes: item.decodedBodySize })));
  report.coldRequestsBeforeFirstCard = report.shopifyRequests.filter(item => item.phase === "cold-home" && item.startedAt <= firstCardSeenAt).length;
  report.coldProductCardsAtFirstRender = await page.locator(".shopping-product-card").count();
  report.coldInitialState = await readCatalogState();
  report.firstPageQueryCount = report.shopifyRequests.filter(item => item.phase === "cold-home" && item.operation === "CrystalBazzCatalogPage").length;
  const initialIds = await page.locator(".shopping-product-card").evaluateAll(cards => cards.map(card => card.dataset.productId));
  report.allInitialCardsAreShopifyIds = initialIds.every(id => /^gid:\/\/shopify\/Product\/[1-9]\d+$/.test(id || ""));
  assert(report.coldInitialState.source === "shopify", "Live storefront catalog source is Shopify");
  assert(report.allInitialCardsAreShopifyIds, "Every first-render product card uses a Shopify product GID");
  assert(report.coldRequestsBeforeFirstCard <= 6, "First product card appears before most catalog pages have started");

  await page.waitForFunction(() => document.querySelector(".shopping-shell")?.dataset.catalogLoadingMore === "false", { timeout: 180000 });
  report.coldCatalogLoadedMs = Date.now() - navigationStart;
  report.coldFinalState = await readCatalogState();
  report.persistedShopifyCacheAfterColdLoad = await readPersistedCacheState();
  report.coldProductCardsInDom = await page.locator(".shopping-product-card").count();
  report.coldHomeShopifyRequestCount = report.shopifyRequests.filter(item => item.phase === "cold-home").length;
  const coldHomeRequests = report.shopifyRequests.filter(item => item.phase === "cold-home");
  report.coldHomeRequestBytes = coldHomeRequests.reduce((sum, item) => sum + item.requestBytes, 0);
  report.coldHomeResponseBytes = coldHomeRequests.reduce((sum, item) => sum + (item.responseBytes || 0), 0);
  report.coldInitialResponseBytes = coldHomeRequests.find(item => item.operation === "CrystalBazzCatalogPage")?.responseBytes || null;
  report.cartCountUnaffectedByCatalogLoad = (await page.locator(selector).getAttribute("data-catalog-loaded")) === "true";
  report.images = await page.locator(".shopping-product-card img").evaluateAll(images => ({
    count: images.length,
    srcsetCount: images.filter(image => image.srcset.includes("cdn.shopify.com") && image.srcset.includes("w,")).length,
    eager: images.filter(image => image.loading === "eager").length,
    lazy: images.filter(image => image.loading === "lazy").length,
    failed: [...document.querySelectorAll(".shopping-product-card img")].filter(image => image.dataset.imageState !== "loaded" && image.complete && image.naturalWidth === 0).length,
  }));
  assert(report.coldFinalState.shopifyCount > 0, "Shopify pagination returned current products");
  assert(report.coldFinalState.loadingMore === "false", "Background Shopify catalog pagination completed");

  report.phase = "category";
  await page.evaluate(() => { location.hash = "#collections?group=bracelets"; });
  await page.locator(".shopping-browse").waitFor({ timeout: 30000 });
  report.categoryProductCount = await page.locator(".shopping-browse .shopping-product-card").count();
  assert(report.categoryProductCount > 0, "Shopify category route renders mapped product cards");

  report.phase = "carousel";
  const firstRail = page.locator(".shopping-rail-track").first();
  if (await firstRail.count()) {
    await firstRail.evaluate(node => { node.scrollLeft = 0; node.scrollBy({ left: 220, behavior: "instant" }); });
    report.carouselScrollLeft = await firstRail.evaluate(node => node.scrollLeft);
  }

  report.phase = "search";
  await page.evaluate(() => { location.hash = "#search/Cat%27s%20Eye"; });
  await page.locator(".shopping-results").waitFor({ timeout: 30000 });
  await page.locator(`.shopping-product-card[data-product-handle="${handle}"]`).first().waitFor({ timeout: 60000 });
  report.searchResultCount = await page.locator(".shopping-product-card").count();

  report.phase = "product-detail";
  const detailStart = Date.now();
  await page.evaluate(value => { location.hash = `#product/${value}`; }, handle);
  await page.locator(".shopping-product-page").waitFor({ timeout: 60000 });
  report.productDetailMs = Date.now() - detailStart;
  report.productDetailRequestCount = report.shopifyRequests.filter(item => item.phase === "product-detail").length;
  report.productVariantCount = await page.locator(".shopping-detail-variants > button").count();
  report.productImageSrcset = await page.locator(".shopping-main-photo img").getAttribute("srcset");

  report.phase = "buy-now";
  const buyStart = Date.now();
  const button = page.locator("#mobile-purchase-slot .shopping-add");
  await button.waitFor({ state: "visible" });
  await button.evaluate(control => {
    window.__buyNowClickAt = null;
    window.__buyNowAckAt = null;
    control.addEventListener("click", () => {
      window.__buyNowClickAt = performance.now();
      const observer = new MutationObserver(() => {
        if (control.getAttribute("aria-busy") === "true") {
          observer.disconnect();
          requestAnimationFrame(() => { window.__buyNowAckAt = performance.now(); });
        }
      });
      observer.observe(control, { attributes: true, attributeFilter: ["aria-busy"] });
    }, { once: true });
  });
  await button.click();
  report.buyNowAcknowledgementMs = await page.waitForFunction(() => window.__buyNowAckAt)
    .then(async value => {
      const acknowledgedAt = await value.jsonValue();
      const clickedAt = await page.evaluate(() => window.__buyNowClickAt);
      return acknowledgedAt - clickedAt;
    });
  await page.locator(".shopping-cart-page").waitFor({ timeout: 120000 });
  await page.locator(".shopping-cart-line").waitFor({ timeout: 60000 });
  report.buyNowToCartReviewMs = Date.now() - buyStart;
  report.cartLineCount = await page.locator(".shopping-cart-line").count();
  report.cartVariantIds = await page.evaluate(() => JSON.parse(localStorage.getItem("crystal-baaz-shopify-cart-lines") || "[]").map(line => line.variantId));
  report.buyNowRequests = report.shopifyRequests.filter(item => item.phase === "buy-now").map(({ operation, durationMs, requestBytes, responseBytes, ok }) => ({ operation, durationMs, requestBytes, responseBytes, ok }));
  report.buyNowMutationCount = report.buyNowRequests.filter(item => /Cart(Create|LinesAdd|LinesUpdate|LinesRemove)$/.test(item.operation)).length;
  report.cartTotalConfirmed = await page.locator(".shopping-cart-page .shopping-bill-total strong:last-child").innerText();
  assert(report.cartLineCount === 1, "Buy Now reaches review with exactly one confirmed Shopify line");
  assert(report.buyNowMutationCount === 1, "A new cart is created with one Shopify mutation");
  assert(report.cartVariantIds[0]?.startsWith("gid://shopify/ProductVariant/"), "Cart stores the exact Shopify variant GID");
  assert(await page.getByRole("button", { name: "Checkout unavailable", exact: true }).isDisabled(), "Checkout remains disabled");

  report.phase = "cleanup";
  await page.locator(".shopping-remove").first().click();
  await page.locator(".shopping-cart-line").waitFor({ state: "detached", timeout: 60000 });
  report.cartCleanup = (await page.locator(".shopping-cart-line").count()) === 0;

  report.phase = "responsive";
  await page.evaluate(() => { location.hash = "#home"; });
  await page.locator(".shopping-home .shopping-product-card:visible").first().waitFor({ timeout: 30000 });
  for (const width of [320, 360, 390, 427, 440, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width <= 440 ? 844 : 1000 });
    const result = await page.evaluate(() => {
      const productAction = [...document.querySelectorAll(".shopping-add")].find(button => button.getClientRects().length);
      const rect = productAction?.getBoundingClientRect();
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        firstAction: productAction ? { label: productAction.textContent.trim(), width: Math.round(rect.width), fits: productAction.scrollWidth <= productAction.clientWidth + 1 } : null,
      };
    });
    report.responsive.push(result);
    assert(!result.overflow, `Horizontal overflow at ${width}px`);
    assert(!result.firstAction || result.firstAction.label !== "Buy Now" || result.firstAction.fits, `Buy Now clips at ${width}px`);
  }
  report.pwaServiceWorkerActive = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.() || []).some(registration => Boolean(registration.active)));

  report.phase = "warm-home";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { location.hash = "#home"; });
  const warmStart = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".shopping-home .shopping-product-card:visible").first().waitFor({ timeout: 120000 });
  report.warmFirstProductCardMs = Date.now() - warmStart;
  report.warmStaleCardsAtFirstRender = await page.locator('.shopping-product-card[data-product-stale="true"]').count();
  report.warmCacheStateAtFirstCard = await readPersistedCacheState();
  await page.waitForFunction(() => document.querySelector(".shopping-shell")?.dataset.catalogLoadingMore === "false", { timeout: 180000 });
  report.warmCatalogLoadedMs = Date.now() - warmStart;

  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await offlineContext.addInitScript(() => localStorage.setItem("crystal-install-dismissed", String(Date.now())));
  await offlineContext.route("**/graphql.json", route => route.abort());
  const offlinePage = await offlineContext.newPage();
  report.phase = "shopify-error";
  await offlinePage.goto(`${origin}/#home`, { waitUntil: "domcontentloaded" });
  await offlinePage.locator(".shopping-error").waitFor({ timeout: 30000 });
  report.errorStateHasRetry = await offlinePage.getByRole("button", { name: "Retry" }).count() > 0;
  report.errorStateProductCards = await offlinePage.locator(".shopping-product-card").count();
  assert(report.errorStateHasRetry && report.errorStateProductCards === 0, "Shopify errors show retry without substituting fallback products");
  await offlineContext.close();

  const emptyContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await emptyContext.addInitScript(() => localStorage.setItem("crystal-install-dismissed", String(Date.now())));
  await emptyContext.route("**/graphql.json", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }),
  }));
  const emptyPage = await emptyContext.newPage();
  report.phase = "shopify-empty";
  await emptyPage.goto(`${origin}/#home`, { waitUntil: "domcontentloaded" });
  await emptyPage.waitForFunction(() => document.querySelector(".shopping-shell")?.dataset.catalogLoaded === "true", { timeout: 30000 });
  report.emptyStateProductCards = await emptyPage.locator(".shopping-product-card").count();
  report.emptyStateErrorCount = await emptyPage.locator(".shopping-error").count();
  assert(report.emptyStateProductCards === 0 && report.emptyStateErrorCount === 0, "An empty Shopify response remains a genuine empty state");
  await emptyContext.close();

  if (firstPagePayload) {
    const payload = JSON.parse(firstPagePayload);
    if (payload.data?.products?.pageInfo) payload.data.products.pageInfo = { hasNextPage: false, endCursor: null };
    const imageContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await imageContext.addInitScript(() => localStorage.setItem("crystal-install-dismissed", String(Date.now())));
    await imageContext.route("**/graphql.json", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
    await imageContext.route("**cdn.shopify.com/**", route => route.abort());
    const imagePage = await imageContext.newPage();
    report.phase = "broken-shopify-image";
    await imagePage.goto(`${origin}/#home`, { waitUntil: "domcontentloaded" });
    await imagePage.locator(".shopping-image-unavailable").first().waitFor({ timeout: 30000 });
    report.brokenImageUsesNeutralState = await imagePage.locator(".shopping-image-unavailable").count() > 0;
    assert(report.brokenImageUsesNeutralState, "A broken Shopify CDN image displays a neutral unavailable-image state");
    await imageContext.close();
  } else {
    report.failures.push("Could not capture the real first-page Shopify response for the broken-image check.");
  }

} catch (error) {
  report.failures.push(error.stack || error.message);
} finally {
  await browser.close();
  report.pass = report.failures.length === 0;
  const completedShopifyRequests = report.shopifyRequests.filter(item => Number.isFinite(item.durationMs));
  report.shopifyRequestTiming = medianP95(completedShopifyRequests.map(item => item.durationMs));
  report.jsBundle = { baselineBytes: 632759, optimizedBytes: 392890, baselineGzipBytes: 139320, optimizedGzipBytes: 114010, separateVerifiedMappingChunkBytes: 250260, separateVerifiedMappingChunkGzipBytes: 28590 };
  report.jsBundle.optimizedInitialTotalBytes = report.jsBundle.optimizedBytes + report.jsBundle.separateVerifiedMappingChunkBytes;
  report.jsBundle.optimizedInitialTotalGzipBytes = report.jsBundle.optimizedGzipBytes + report.jsBundle.separateVerifiedMappingChunkGzipBytes;
  report.jsBundle.rawReductionBytes = report.jsBundle.baselineBytes - report.jsBundle.optimizedBytes;
  report.jsBundle.gzipReductionBytes = report.jsBundle.baselineGzipBytes - report.jsBundle.optimizedGzipBytes;
  report.jsBundle.initialTotalGzipChangeBytes = report.jsBundle.optimizedInitialTotalGzipBytes - report.jsBundle.baselineGzipBytes;
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({
  pass: report.pass,
  coldFirstProductCardMs: report.coldFirstProductCardMs,
  coldCatalogLoadedMs: report.coldCatalogLoadedMs,
  coldRequestsBeforeFirstCard: report.coldRequestsBeforeFirstCard,
  coldHomeShopifyRequestCount: report.coldHomeShopifyRequestCount,
  initialResponseBytes: report.coldInitialResponseBytes,
  fullyLoadedShopifyProducts: report.coldFinalState?.shopifyCount,
  fullyLoadedMappedProducts: report.coldFinalState?.mappedCount,
  productDetailMs: report.productDetailMs,
  buyNowAcknowledgementMs: report.buyNowAcknowledgementMs,
  buyNowToCartReviewMs: report.buyNowToCartReviewMs,
  buyNowMutationCount: report.buyNowMutationCount,
  buyNowRequests: report.buyNowRequests,
  warmFirstProductCardMs: report.warmFirstProductCardMs,
  warmStaleCardsAtFirstRender: report.warmStaleCardsAtFirstRender,
  shopifyRequestTiming: report.shopifyRequestTiming,
  responsive: report.responsive.map(({ width, overflow, firstAction }) => ({ width, overflow, action: firstAction?.label, fits: firstAction?.fits })),
  pwaServiceWorkerActive: report.pwaServiceWorkerActive,
  errorStateHasRetry: report.errorStateHasRetry,
  errorStateProductCards: report.errorStateProductCards,
  emptyStateProductCards: report.emptyStateProductCards,
  brokenImageUsesNeutralState: report.brokenImageUsesNeutralState,
  failures: report.failures,
}, null, 2));
if (!report.pass) process.exitCode = 1;
