import { mkdir, writeFile } from "node:fs/promises";
import { connectChrome } from "./cdp-client.mjs";

const browser = await connectChrome("http://127.0.0.1:4180/");
const report = { generatedAt: new Date().toISOString(), mode: "local Vite + live Shopify Storefront API", failures: [], screenshots: [], cartCleanup: "not started" };
await mkdir("reports/variant-sharing", { recursive: true });
const check = (condition, message) => { if (!condition) report.failures.push(message); };
const until = async (expression, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await browser.evaluate(`Boolean(${expression})`)) return;
    await browser.wait(250);
  }
  throw new Error(`Timed out waiting for ${expression}`);
};
const route = async hash => { await browser.evaluate(`location.hash=${JSON.stringify(hash)};true`); await browser.wait(250); };
const capture = async name => {
  const path = `reports/variant-sharing/${name}.png`;
  await browser.screenshot(path);
  report.screenshots.push(path);
};
const sharedHash = "#shared-cart?items=67884496421090%3A1%2C67884496453858%3A1";

try {
  await browser.send("Network.setCacheDisabled", { cacheDisabled: true });
  await browser.viewport(390, 844);
  await browser.navigate("http://127.0.0.1:4180/#product/blue-sapphire");
  await until(`document.querySelector('.shopping-detail-variants') || document.querySelector('.shopping-error')`);
  await until(`document.querySelector('.shopping-detail-variants')?.querySelectorAll('button').length===2 || document.querySelector('.shopping-error')`);
  await browser.evaluate(`document.querySelector('.shopping-install-sheet .shopping-text-button')?.click();true`);
  await until(`!document.querySelector('.shopping-install-sheet')`);
  report.productOptions = await browser.evaluate(`({title:document.querySelector('.shopping-product-detail h1')?.textContent,rows:[...document.querySelectorAll('.shopping-detail-variants>button')].map(row=>row.innerText),error:document.querySelector('.shopping-error')?.innerText||''})`);
  check(report.productOptions.rows.length === 2, "Blue Sapphire product detail did not load two live variants");
  check(report.productOptions.rows.some(row => row.includes("SKU: RG166") && row.includes("3,490")), "Variant RG166 label or live price is missing");
  check(report.productOptions.rows.some(row => row.includes("SKU: RG168") && row.includes("3,890")), "Variant RG168 label or live price is missing");
  await capture("product-variants-mobile-390");

  await browser.evaluate(`document.querySelector('.shopping-detail-variants>button:nth-child(2)')?.click();true`);
  report.selectedVariant = await browser.evaluate(`({price:document.querySelector('.shopping-detail-purchase .shopping-prices strong')?.textContent,availability:document.querySelector('.shopping-product-detail>div:last-child>p')?.textContent})`);
  check(report.selectedVariant.price?.includes("3,890"), "Selecting Variant 2 did not update the selected price");
  await browser.evaluate(`location.hash='#product/blue-sapphire?variant=gid%3A%2F%2Fshopify%2FProductVariant%2F67884496453858';true`);
  await browser.wait(300);
  await browser.send("Page.reload", { ignoreCache: true });
  await until(`document.querySelector('.shopping-detail-variants>button[aria-pressed="true"]')?.innerText.includes('RG168')&&document.querySelector('.shopping-detail-purchase .shopping-prices strong')?.textContent.includes('3,890')`);
  report.directVariantRoute = await browser.evaluate(`({hash:location.hash,selected:[...document.querySelectorAll('.shopping-detail-variants>button')].find(button=>button.getAttribute('aria-pressed')==='true')?.innerText,price:document.querySelector('.shopping-detail-purchase .shopping-prices strong')?.textContent})`);
  check(report.directVariantRoute.hash.includes("67884496453858") && report.directVariantRoute.selected?.includes("RG168") && report.directVariantRoute.price?.includes("3,890"), "Refreshing a shared product URL lost its selected Shopify variant");
  await capture("selected-variant-deep-link-390");

  await browser.viewport(1440, 950);
  await route("#product/blue-sapphire?variant=gid%3A%2F%2Fshopify%2FProductVariant%2F67884496453858");
  await until(`document.querySelector('.shopping-detail-variants>button[aria-pressed="true"]')?.innerText.includes('RG168')`);
  report.desktopSelectedVariant = await browser.evaluate(`({width:innerWidth,selected:document.querySelector('.shopping-detail-variants>button[aria-pressed="true"]')?.innerText,price:document.querySelector('.shopping-detail-purchase .shopping-prices strong')?.textContent})`);
  check(report.desktopSelectedVariant.width>=1000&&report.desktopSelectedVariant.selected?.includes("RG168")&&report.desktopSelectedVariant.price?.includes("3,890"),"Desktop selected-variant route did not retain its exact choice");
  await capture("selected-variant-deep-link-desktop-1440");

  await route("#search/Blue%20Sapphire");
  await until(`document.querySelector('.shopping-product-card[data-product-handle="blue-sapphire"] .shopping-option-link') || document.querySelector('.shopping-error')`);
  await browser.evaluate(`document.querySelector('.shopping-product-card[data-product-handle="blue-sapphire"] .shopping-option-link')?.click();true`);
  await until(`document.querySelector('.shopping-variant-sheet') || document.querySelector('.shopping-error')`);
  report.variantSheet = await browser.evaluate(`({labels:[...document.querySelectorAll('.shopping-variant-line')].map(row=>row.innerText),images:[...document.querySelectorAll('.shopping-variant-line img')].map(image=>image.getAttribute('src'))})`);
  check(report.variantSheet.labels?.length === 2, "Product card did not open its two-row variant sheet");
  check(report.variantSheet.labels?.some(row=>row.includes("SKU: RG166")&&row.includes("3,490")&&row.includes("Available")), "Variant sheet did not show RG166 live label, price and status");
  check(report.variantSheet.labels?.some(row=>row.includes("SKU: RG168")&&row.includes("3,890")&&row.includes("Available")), "Variant sheet did not show RG168 live label, price and status");
  await capture("variant-bottom-sheet-mobile-390");
  await browser.evaluate(`document.querySelector('.shopping-variant-sheet [aria-label="Close variants"]')?.click();true`);

  await route(sharedHash);
  await until(`document.querySelectorAll('.shopping-shared-item').length===2 || document.querySelector('.shopping-shared-error')`);
  report.sharedCart = await browser.evaluate(`({items:[...document.querySelectorAll('.shopping-shared-item')].map(row=>row.innerText),error:document.querySelector('.shopping-shared-error')?.innerText||'',button:document.querySelector('.shopping-shared-summary .shopping-primary')?.textContent})`);
  check(report.sharedCart.items.length === 2, "Shared cart did not resolve both Shopify variants");
  check(report.sharedCart.items.some(row=>row.includes("SKU: RG166")&&row.includes("3,490")&&row.includes("Quantity 1")), "Shared cart did not show current RG166 data");
  check(report.sharedCart.items.some(row=>row.includes("SKU: RG168")&&row.includes("3,890")&&row.includes("Quantity 1")), "Shared cart did not show current RG168 data");
  await capture("shared-cart-review-mobile-390");

  await browser.viewport(1440, 950);
  await route(sharedHash);
  await until(`document.querySelectorAll('.shopping-shared-item').length===2`);
  report.desktopSharedCart = await browser.evaluate(`({width:innerWidth,items:document.querySelectorAll('.shopping-shared-item').length,hasHorizontalOverflow:document.documentElement.scrollWidth>innerWidth})`);
  check(report.desktopSharedCart.width>=1000&&report.desktopSharedCart.items===2&&!report.desktopSharedCart.hasHorizontalOverflow,"Desktop shared-cart layout did not fit the viewport");
  await capture("shared-cart-review-desktop-1440");
  await browser.viewport(390, 844);
  await route(sharedHash);
  await until(`document.querySelectorAll('.shopping-shared-item').length===2`);

  report.cartCleanup = "pending";
  await browser.evaluate(`document.querySelector('.shopping-shared-summary .shopping-primary')?.click();true`);
  await until(`document.querySelector('.shopping-cart-page') || document.querySelector('.shopping-shared-status')`);
  await until(`document.querySelector('.shopping-cart-page h1')?.textContent.includes('(2)') || document.querySelector('.shopping-shared-status')`);
  report.cartAfterFirstAdd = await browser.evaluate(`({heading:document.querySelector('.shopping-cart-page h1')?.textContent,lines:[...document.querySelectorAll('.shopping-cart-line')].map(row=>row.innerText)})`);
  check(report.cartAfterFirstAdd.lines?.length === 2, "Adding the shared variants did not create the expected two cart lines");

  await route(sharedHash);
  await until(`document.querySelector('.shopping-shared-summary .shopping-primary')`);
  await browser.evaluate(`document.querySelector('.shopping-shared-summary .shopping-primary')?.click();true`);
  await until(`document.querySelector('.shopping-shared-confirm')`);
  report.mergeConfirmation = await browser.evaluate(`document.querySelector('.shopping-shared-confirm')?.innerText||''`);
  check(report.mergeConfirmation.includes("existing 2 items will stay"), "Shared cart did not ask before merging into the existing cart");
  await capture("shared-cart-merge-confirmation-mobile-390");
  await browser.evaluate(`[...document.querySelectorAll('.shopping-shared-confirm button')].find(button=>button.textContent.includes('Add to current cart'))?.click();true`);
  await until(`document.querySelector('.shopping-cart-page h1')?.textContent.includes('(4)')`);
  report.cartAfterMerge = await browser.evaluate(`({heading:document.querySelector('.shopping-cart-page h1')?.textContent,lines:[...document.querySelectorAll('.shopping-cart-line')].map(row=>row.innerText),variantLines:JSON.parse(localStorage.getItem('crystal-baaz-shopify-cart-lines')||'[]').map(line=>({variantId:line.variantId,quantity:line.quantity}))})`);
  check(report.cartAfterMerge.lines.length === 2 && report.cartAfterMerge.lines.every(line=>line.includes('2')), "Accepting merge did not retain and add quantities for both exact variants");
  check(report.cartAfterMerge.variantLines?.length===2&&report.cartAfterMerge.variantLines.some(line=>line.variantId==="gid://shopify/ProductVariant/67884496421090"&&line.quantity===2)&&report.cartAfterMerge.variantLines.some(line=>line.variantId==="gid://shopify/ProductVariant/67884496453858"&&line.quantity===2),"The merge did not preserve the exact selected Shopify variant IDs and quantities");
  await capture("merged-cart-mobile-390");
} catch (error) {
  report.failures.push(error.stack || error.message);
} finally {
  try {
    await route("#cart");
    await until(`document.querySelector('.shopping-cart-page')`);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const before = await browser.evaluate(`document.querySelectorAll('.shopping-remove').length`);
      if (!before) break;
      await browser.evaluate(`document.querySelector('.shopping-remove:not(:disabled)')?.click();true`);
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        const after = await browser.evaluate(`document.querySelectorAll('.shopping-remove').length`);
        const pending = await browser.evaluate(`document.querySelector('.shopping-cart-page')?.textContent.includes('Removing')||document.querySelector('.shopping-cart-page')?.textContent.includes('Saving')`);
        if (after < before && !pending) break;
        await browser.wait(300);
      }
    }
    report.cartCleanup = await browser.evaluate(`document.querySelectorAll('.shopping-cart-line').length===0?'empty':'items remain'`);
    if (report.cartCleanup !== "empty") report.failures.push("Temporary Shopify test cart could not be emptied automatically.");
  } catch (error) {
    report.cartCleanup = `failed: ${error.message}`;
    report.failures.push("Temporary Shopify cart cleanup failed.");
  }
  report.runtimeIssues = browser.issues;
  report.pass = report.failures.length === 0;
  await mkdir("reports/variant-sharing", { recursive: true });
  await writeFile("reports/variant-sharing/browser-audit.json", `${JSON.stringify(report, null, 2)}\n`);
  browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
