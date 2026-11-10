import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "/private/tmp/crystal-baaz-playwright/node_modules/playwright/index.mjs");
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:4173";
const report = { origin, viewports: [], checks: {}, failures: [] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await context.addInitScript(() => localStorage.setItem("crystal-install-dismissed", String(Date.now())));
const page = await context.newPage();

const assert = (condition, message) => { if (!condition) report.failures.push(message); };
const ready = async () => {
  await page.locator("[data-catalog-loaded='true']").waitFor({ timeout: 120000 });
  await page.waitForFunction(() => document.querySelector(".shopping-loading") === null, { timeout: 120000 });
};
const inspectViewport = async (width) => {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(180);
  const result = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".shopping-add")].filter(button => button.getClientRects().length);
    return {
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      actions: buttons.map(button => {
        const rect = button.getBoundingClientRect();
        return {
          text: button.textContent.trim(),
          disabled: button.disabled,
          width: Math.round(rect.width),
          textFits: button.scrollWidth <= button.clientWidth + 1,
          right: Math.round(rect.right),
        };
      }).slice(0, 8),
      actionCount: buttons.length,
    };
  });
  report.viewports.push(result);
  assert(!result.overflow, `Horizontal overflow at ${width}px`);
  assert(result.actions.every(action => ["Buy Now", "Unavailable", "Price pending"].includes(action.text)), `Unexpected product action label at ${width}px`);
  assert(result.actions.every(action => action.text !== "Buy Now" || action.textFits), `Buy Now clipped at ${width}px`);
  return result;
};

try {
  await page.goto(`${origin}/#home`, { waitUntil: "domcontentloaded" });
  await ready();
  report.catalogSource = await page.locator(".shopping-shell").getAttribute("data-catalog-source");
  assert(report.catalogSource === "shopify", "Production audit is using the Shopify catalog");
  for (const width of [320, 390, 1440]) await inspectViewport(width);
  report.checks.homeAndPwaLabels = true;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".shopping-search input").fill("Cat's Eye");
  await page.locator(".shopping-search input").press("Enter");
  await page.locator(".shopping-product-card[data-product-handle='natural-cat-s-eye-lehsunia-ring-5-ratti']").waitFor({ timeout: 30000 });
  const ring = page.locator(".shopping-product-card[data-product-handle='natural-cat-s-eye-lehsunia-ring-5-ratti']").first();
  const cardAction = ring.locator(".shopping-add");
  assert((await cardAction.textContent()).trim() === "Buy Now", "Search result action label");
  await cardAction.click();
  await page.locator(".shopping-variant-sheet").waitFor();
  const variantActions = page.locator(".shopping-variant-line .shopping-add");
  assert((await variantActions.count()) === 2, "Variant popup displays both verified variants");
  assert((await variantActions.allTextContents()).every(text => text.trim() === "Buy Now" || text.trim() === "Unavailable"), "Variant popup action labels");
  const secondAction = variantActions.nth(1);
  const expectedPopupVariant = await secondAction.evaluate(button => button.closest(".shopping-variant-line").dataset.variantId);
  assert(!(await secondAction.isDisabled()), "Selected Shopify variant is purchasable");
  await secondAction.click();
  await page.locator(".shopping-cart-page").waitFor({ timeout: 60000 });
  await page.locator(".shopping-cart-line").waitFor();
  const variantAfterPopup = await page.evaluate(() => JSON.parse(localStorage.getItem("crystal-baaz-shopify-cart-lines") || "[]").map(line => line.variantId));
  assert(variantAfterPopup.includes(expectedPopupVariant), "Variant popup adds the exact selected Shopify merchandise ID");
  assert((await page.locator(".shopping-cart-line").innerText()).includes("RG169"), "Cart review shows selected variant SKU");
  assert(await page.getByRole("button", { name: "Checkout unavailable", exact: true }).isDisabled(), "Checkout remains disabled in cart review");
  report.checks.variantPopupCartReview = true;

  const quantity = page.locator(".shopping-cart-quantity .shopping-quantity");
  await quantity.locator("button:last-child").click();
  await page.waitForFunction(() => document.querySelector(".shopping-cart-quantity .shopping-quantity span")?.textContent === "2", { timeout: 60000 });
  await quantity.locator("button:first-child").click();
  await page.waitForFunction(() => document.querySelector(".shopping-cart-quantity .shopping-quantity span")?.textContent === "1", { timeout: 60000 });
  await page.locator(".shopping-remove").click();
  await page.locator(".shopping-cart-line").waitFor({ state: "detached", timeout: 60000 });
  report.checks.quantityAndCleanup = true;

  await page.evaluate(() => { location.hash = "#product/natural-cat-s-eye-lehsunia-ring-5-ratti"; });
  await page.locator(".shopping-product-page").waitFor();
  const selectedDetailOption = page.locator(".shopping-detail-variants > button").nth(1);
  const expectedDetailVariant = await selectedDetailOption.getAttribute("data-variant-id");
  await selectedDetailOption.click();
  const detailAction = page.locator("#mobile-purchase-slot .shopping-add");
  assert((await detailAction.textContent()).trim() === "Buy Now", "Mobile product detail action label");
  assert(!(await detailAction.isDisabled()), "Available product detail variant can be purchased");
  await detailAction.click();
  await page.locator(".shopping-cart-page").waitFor({ timeout: 60000 });
  const variantAfterDetail = await page.evaluate(() => JSON.parse(localStorage.getItem("crystal-baaz-shopify-cart-lines") || "[]").map(line => line.variantId));
  assert(variantAfterDetail.includes(expectedDetailVariant), "Product detail Buy Now keeps the selected Shopify variant");
  assert(await page.getByRole("button", { name: "Checkout unavailable", exact: true }).isDisabled(), "Product detail leads to cart review, not checkout");
  report.checks.productDetailCartReview = true;
  await page.locator(".shopping-remove").click();
  await page.locator(".shopping-cart-line").waitFor({ state: "detached", timeout: 60000 });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { location.hash = "#product/natural-cat-s-eye-lehsunia-ring-5-ratti"; });
  await page.locator(".shopping-product-page").waitFor();
  const desktopOption = page.locator(".shopping-detail-variants > button").nth(1);
  const expectedDesktopVariant = await desktopOption.getAttribute("data-variant-id");
  await desktopOption.click();
  const desktopAction = page.locator(".shopping-desktop-purchase .shopping-add");
  assert((await desktopAction.textContent()).trim() === "Buy Now", "Desktop product detail action label");
  assert(!(await desktopAction.isDisabled()), "Available desktop product detail variant can be purchased");
  await desktopAction.click();
  await page.locator(".shopping-cart-page").waitFor({ timeout: 60000 });
  const variantAfterDesktop = await page.evaluate(() => JSON.parse(localStorage.getItem("crystal-baaz-shopify-cart-lines") || "[]").map(line => line.variantId));
  assert(variantAfterDesktop.includes(expectedDesktopVariant), "Desktop product detail Buy Now keeps the selected Shopify variant");
  report.checks.desktopProductDetailCartReview = true;
  await page.locator(".shopping-remove").click();
  await page.locator(".shopping-cart-line").waitFor({ state: "detached", timeout: 60000 });

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    window.__serviceWorkerActive = registrations.some(registration => Boolean(registration.active));
  });
  report.checks.serviceWorkerActive = await page.evaluate(() => Boolean(window.__serviceWorkerActive));
} catch (error) {
  report.failures.push(error.stack || error.message);
} finally {
  await browser.close();
  report.pass = report.failures.length === 0;
  await mkdir("reports/buy-now", { recursive: true });
  await writeFile("reports/buy-now/responsive-audit.json", JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ pass: report.pass, viewports: report.viewports.map(({ width, overflow, actions }) => ({ width, overflow, actionCount: actions.length, labels: [...new Set(actions.map(action => action.text))], clipped: actions.some(action => !action.textFits) })), checks: report.checks, failures: report.failures }, null, 2));
if (!report.pass) process.exitCode = 1;
