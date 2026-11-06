import { mkdir, writeFile } from "node:fs/promises";
import { connectChrome } from "./cdp-client.mjs";

const browser = await connectChrome("http://127.0.0.1:4180/");
const report = { generatedAt: new Date().toISOString(), mode: "local browser + live Shopify Storefront", failures: [], screenshots: [], externalShareLinkGenerated: false, cartCleanup: "not started" };
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
const route = async hash => { await browser.evaluate(`location.hash=${JSON.stringify(hash)};true`); await browser.wait(300); };
const capture = async name => {
  const path = `reports/variant-sharing/${name}.png`;
  await browser.screenshot(path);
  report.screenshots.push(path);
};

try {
  await browser.send("Network.setCacheDisabled", { cacheDisabled: true });
  const storageReset = await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.removeItem('crystal-baaz-shopify-cart-id');localStorage.removeItem('crystal-baaz-shopify-cart-lines');localStorage.removeItem('crystal-bazz-cart');localStorage.removeItem('crystal-bazz-shopify-cart');}catch{}` });
  await browser.viewport(390, 844);
  await browser.navigate("http://127.0.0.1:4180/#home");
  if (storageReset?.identifier) await browser.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: storageReset.identifier });
  await until(`document.querySelector('.shopping-shell')?.dataset.catalogLoaded==='true' || document.querySelector('.shopping-error')`, 90000);
  report.mobileHome = await browser.evaluate(`({
    width:innerWidth,
    cards:document.querySelectorAll('.shopping-product-card').length,
    productIds:[...new Set([...document.querySelectorAll('.shopping-product-card')].map(card=>card.dataset.productId))],
    invalidProductIds:[...new Set([...document.querySelectorAll('.shopping-product-card')].map(card=>card.dataset.productId).filter(id=>!new RegExp('^gid://shopify/Product/[1-9][0-9]*$').test(id||'')))],
    categories:[...document.querySelectorAll('[data-main-category]')].map(card=>card.innerText.trim()),
    sectionCount:document.querySelectorAll('[data-home-section]').length,
    error:document.querySelector('.shopping-error')?.innerText||''
  })`);
  const expectedCategories = ["Best Seller", "New Arrivals", "Rashi / Zodiac", "Bracelets", "Rudraksha", "Crystal", "Puja", "Remedy"];
  check(!report.mobileHome.error, `Live Shopify catalog failed to load: ${report.mobileHome.error}`);
  check(report.mobileHome.cards > 0, "Live homepage did not render any Shopify product cards");
  check(report.mobileHome.invalidProductIds.length === 0, "A rendered homepage product is not an actual Shopify Product GID");
  check(JSON.stringify(report.mobileHome.categories) === JSON.stringify(expectedCategories), "Homepage categories do not follow the required eight-category order");
  check(report.mobileHome.sectionCount === 8, "Homepage does not retain all eight category sections");
  const failedImage = await browser.evaluate(`(()=>{const image=document.querySelector('.shopping-product-card img');if(!image)return null;const card=image.closest('.shopping-product-card');image.dispatchEvent(new Event('error'));return {productId:card?.dataset.productId,src:image.currentSrc||image.src};})()`);
  if (failedImage?.productId) {
    await browser.wait(150);
    report.failedProductImage = await browser.evaluate(`(()=>{const card=document.querySelector('[data-product-id="${failedImage.productId}"]');return {neutral:Boolean(card?.querySelector('.shopping-image-unavailable')),placeholder:Boolean(card?.querySelector('img[src*="product-placeholder"]'))};})()`);
    check(report.failedProductImage.neutral && !report.failedProductImage.placeholder, "A failed Shopify image did not become the neutral unavailable state");
  } else {
    report.failedProductImage = { skipped: "No product image was rendered to simulate." };
  }
  await browser.evaluate(`window.scrollTo(0,0);true`);
  await capture("shopify-home-mobile-390");

  await browser.viewport(1440, 950);
  report.desktopHome = await browser.evaluate(`({width:innerWidth,cards:document.querySelectorAll('.shopping-product-card').length,invalidProductIds:[...new Set([...document.querySelectorAll('.shopping-product-card')].map(card=>card.dataset.productId).filter(id=>!new RegExp('^gid://shopify/Product/[1-9][0-9]*$').test(id||'')))],categories:[...document.querySelectorAll('[data-main-category]')].map(card=>card.innerText.trim()),sectionCount:document.querySelectorAll('[data-home-section]').length})`);
  check(report.desktopHome.width >= 1000 && report.desktopHome.cards > 0, "Desktop homepage did not render the live Shopify catalog");
  check(report.desktopHome.invalidProductIds.length === 0, "A rendered desktop product is not an actual Shopify Product GID");
  check(JSON.stringify(report.desktopHome.categories) === JSON.stringify(expectedCategories), "Desktop category order differs from the required MAIN order");
  check(report.desktopHome.sectionCount === 8, "Desktop homepage does not retain all eight category sections");
  await browser.evaluate(`window.scrollTo(0,0);true`);
  await capture("shopify-home-desktop-1440");

  await browser.navigate("http://127.0.0.1:4180/#product/natural-cat-s-eye-lehsunia-ring-5-ratti");
  await browser.evaluate(`document.querySelector('.shopping-install-sheet .shopping-text-button')?.click();true`);
  await until(`!document.querySelector('.shopping-install-sheet')`);
  await until(`document.querySelectorAll('.shopping-detail-variants>button').length===2 || document.querySelector('.shopping-error')`);
  report.catEye = await browser.evaluate(`({title:document.querySelector('.shopping-product-detail h1')?.textContent,rows:[...document.querySelectorAll('.shopping-detail-variants>button')].map(button=>button.innerText)})`);
  check(report.catEye.title?.includes("Cat's Eye"), "Cat's Eye product detail did not load from Shopify");
  check(report.catEye.rows.some(row => row.includes("RG171") && row.includes("1,990")) && report.catEye.rows.some(row => row.includes("RG169") && row.includes("2,490")), "Cat's Eye variants did not show the verified SKU labels and prices");
  await browser.evaluate(`document.querySelector('.shopping-detail-variants')?.scrollIntoView({block:'center'});true`);
  await browser.wait(300);
  await capture("cat-eye-variants-mobile-390");

  await route("#shared-cart?items=67884514312418%3A1");
  await until(`document.querySelector('.shopping-shared-item') || document.querySelector('.shopping-shared-error')`);
  report.sharedCart = await browser.evaluate(`({item:document.querySelector('.shopping-shared-item')?.innerText,error:document.querySelector('.shopping-shared-error')?.innerText||'',addButton:document.querySelector('.shopping-shared-summary .shopping-primary')?.textContent||''})`);
  check(report.sharedCart.item?.includes("RG171") && report.sharedCart.item.includes("1,990"), "Local shared-cart route did not resolve the live Cat's Eye variant");
  check(report.sharedCart.addButton.includes("Add 1 item"), "Local shared-cart route did not offer the valid item");
  await capture("shared-cart-preview-mobile-390");

  report.cartCleanup = "pending";
  await browser.evaluate(`document.querySelector('.shopping-shared-summary .shopping-primary')?.click();true`);
  await until(`document.querySelector('.shopping-cart-page') || document.querySelector('.shopping-shared-error') || document.querySelector('.shopping-shared-status')?.textContent.includes('Some items were not confirmed')`, 45000);
  const cartOpened = await browser.evaluate(`Boolean(document.querySelector('.shopping-cart-page'))`);
  if (!cartOpened) {
    report.cartAddAttempt = await browser.evaluate(`({sharedStatus:document.querySelector('.shopping-shared-status')?.textContent||'',sharedError:document.querySelector('.shopping-shared-error')?.innerText||'',toast:document.querySelector('.toast')?.innerText||''})`);
    check(false, `Adding a verified shared Shopify variant did not open the cart: ${report.cartAddAttempt.sharedError || report.cartAddAttempt.sharedStatus || report.cartAddAttempt.toast}`);
  } else {
    await until(`document.querySelector('.shopping-cart-page h1')?.textContent.includes('(1)')`);
    report.cartStatus = await browser.evaluate(`(()=>{const lines=JSON.parse(localStorage.getItem('crystal-baaz-shopify-cart-lines')||'[]');return {status:document.querySelector('.shopping-cart-status')?.textContent,checkout:document.querySelector('.shopping-cart-checkout .shopping-primary')?.textContent,total:document.querySelector('.shopping-cart-checkout div strong')?.textContent||'',productIdsValid:lines.length===1&&lines.every(line=>new RegExp('^gid://shopify/Product/[1-9][0-9]*$').test(line.productId||'')),variantIdsValid:lines.length===1&&lines.every(line=>new RegExp('^gid://shopify/ProductVariant/[1-9][0-9]*$').test(line.variantId||'')),quantity:lines.reduce((sum,line)=>sum+line.quantity,0)}})()`);
    check(!report.cartStatus.status, "Normal cart view still shows an unnecessary technical confirmation");
    check(report.cartStatus.checkout === "Checkout unavailable", "Checkout-disabled state was not preserved in the checkout section");
    check(report.cartStatus.total.includes("1,990") && report.cartStatus.productIdsValid && report.cartStatus.variantIdsValid && report.cartStatus.quantity===1, "Cart total or stored product/variant identity did not match the verified Shopify item");
    await browser.evaluate(`document.querySelector('.shopping-cart-page .shopping-quantity button[aria-label^="Increase"]')?.click();true`);
    await until(`document.querySelector('.shopping-cart-page h1')?.textContent.includes('(2)')&&!document.querySelector('.shopping-cart-page [aria-busy="true"]')`);
    const increased = await browser.evaluate(`document.querySelector('.shopping-cart-checkout div strong')?.textContent||''`);
    check(increased.includes("3,980"), "Increasing quantity did not update the confirmed Shopify cart total");
    await browser.evaluate(`document.querySelector('.shopping-cart-page .shopping-quantity button[aria-label^="Decrease"]')?.click();true`);
    await until(`document.querySelector('.shopping-cart-page h1')?.textContent.includes('(1)')&&!document.querySelector('.shopping-cart-page [aria-busy="true"]')`);
    report.cartQuantityChanges = { initial: report.cartStatus.total, doubled: increased, restored: await browser.evaluate(`document.querySelector('.shopping-cart-checkout div strong')?.textContent||''`) };
    check(report.cartQuantityChanges.restored.includes("1,990"), "Decreasing quantity did not restore the Shopify cart total");
    await browser.evaluate(`document.querySelector('.shopping-cart-share')?.click();true`);
    await until(`document.querySelector('.shopping-share-status')?.textContent.includes('public Crystal Baaz website address')`);
    report.shareBlocker = await browser.evaluate(`document.querySelector('.shopping-share-status')?.textContent||''`);
    check(!report.shareBlocker.includes("Cart link shared.") && !report.shareBlocker.includes("Cart link copied."), "Local preview falsely announced a successful public share");
    report.cartShareControls = await browser.evaluate(`({nativeShare:Boolean(document.querySelector('.shopping-cart-share')),copyLink:Boolean(document.querySelector('.shopping-cart-copy')),whatsapp:Boolean(document.querySelector('.shopping-cart-whatsapp'))})`);
    check(report.cartShareControls.nativeShare && report.cartShareControls.copyLink && report.cartShareControls.whatsapp, "Cart did not show all three requested share actions");
    await browser.evaluate(`document.querySelector('.shopping-cart-copy')?.click();true`);
    await until(`document.querySelector('.shopping-share-status')?.textContent.includes('public Crystal Baaz website address')`);
    report.copyLinkBlocker = await browser.evaluate(`document.querySelector('.shopping-share-status')?.textContent||''`);
    check(report.copyLinkBlocker === report.shareBlocker, "Copy Link did not explain the missing public storefront URL");
    await browser.evaluate(`document.querySelector('.shopping-cart-whatsapp')?.click();true`);
    await until(`document.querySelector('.shopping-share-status')?.textContent.includes('public Crystal Baaz website address')`);
    report.whatsappBlocker = await browser.evaluate(`({message:document.querySelector('.shopping-share-status')?.textContent||'',href:document.querySelector('.shopping-cart-whatsapp')?.getAttribute('href')||''})`);
    check(report.whatsappBlocker.message === report.shareBlocker && !report.whatsappBlocker.href, "WhatsApp did not stay blocked without a public HTTPS storefront URL");
    await browser.evaluate(`window.scrollTo(0,0);true`);
    await browser.wait(300);
    await capture("cart-share-public-url-blocker-mobile-390");

    await browser.viewport(1440, 950);
    await route("#cart");
    await until(`document.querySelector('.shopping-cart-page h1')?.textContent.includes('(1)')`);
    await browser.evaluate(`document.querySelector('.shopping-cart-share')?.click();true`);
    await until(`document.querySelector('.shopping-share-status')?.textContent.includes('public Crystal Baaz website address')`);
    report.desktopShareBlocker = await browser.evaluate(`({width:innerWidth,message:document.querySelector('.shopping-share-status')?.textContent})`);
    check(report.desktopShareBlocker.width >= 1000 && report.desktopShareBlocker.message === report.shareBlocker, "Desktop preview did not report the same missing-public-URL blocker");
    await browser.evaluate(`window.scrollTo(0,0);true`);
    await browser.wait(300);
    await capture("cart-share-public-url-blocker-desktop-1440");
  }

  await route("#shared-cart?items=invalid");
  await until(`document.querySelector('.shopping-shared-error')`);
  report.invalidLink = await browser.evaluate(`document.querySelector('.shopping-shared-error')?.innerText||''`);
  check(report.invalidLink.includes("invalid or has expired"), "Malformed shared-cart link did not receive a clear error");

  let mockScript;
  try {
    mockScript = await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{const original=window.fetch.bind(window);window.fetch=(input,init)=>{const url=typeof input==='string'?input:input?.url||'';const mode=new URL(location.href).searchParams.get('catalogMock');if(url.includes('/graphql.json')&&mode==='failure')return Promise.reject(new Error('Simulated Shopify API failure'));if(url.includes('/graphql.json')&&mode==='empty')return Promise.resolve(new Response(JSON.stringify({data:{products:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}),{status:200,headers:{'Content-Type':'application/json'}}));return original(input,init);};})();` });
    await browser.navigate("http://127.0.0.1:4180/?catalogMock=empty#home");
    await until(`document.querySelector('.shopping-shell')?.dataset.catalogLoaded==='true'`, 45000);
    report.emptyApi = await browser.evaluate(`({cards:document.querySelectorAll('.shopping-product-card').length,categoryCount:document.querySelectorAll('[data-main-category]').length,sections:[...document.querySelectorAll('[data-home-section]')].map(section=>({id:section.dataset.homeSection,products:section.querySelectorAll('.shopping-product-card').length}))})`);
    check(report.emptyApi.cards === 0, "An empty Shopify response rendered products");
    check(report.emptyApi.categoryCount === 8 && report.emptyApi.sections.length === 8, "An empty Shopify response did not retain the eight empty category sections");
    check(report.emptyApi.sections.every(section=>section.products===0), "An empty category was filled with unrelated products");
    await capture("shopify-empty-response-mobile-390");

    await browser.navigate("http://127.0.0.1:4180/?catalogMock=failure#home");
    await until(`document.querySelector('.shopping-error')`, 45000);
    report.apiFailure = await browser.evaluate(`({cards:document.querySelectorAll('.shopping-product-card').length,error:document.querySelector('.shopping-error')?.innerText||'',retry:document.querySelector('.shopping-error button')?.textContent||''})`);
    check(report.apiFailure.cards === 0, "A Shopify API failure rendered cached or fallback products");
    check(report.apiFailure.retry === "Retry" && report.apiFailure.error.includes("Simulated Shopify API failure"), "A Shopify API failure did not show the error state with Retry");
    await capture("shopify-api-failure-mobile-390");
  } finally {
    if (mockScript?.identifier) await browser.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: mockScript.identifier });
    await browser.navigate("http://127.0.0.1:4180/#home");
  }
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
    report.cartCleanup = await browser.evaluate(`document.querySelector('.shopping-cart-page')?(document.querySelectorAll('.shopping-cart-line').length===0?'empty':'items remain'):'cart view unavailable'`);
    if (report.cartCleanup !== "empty") report.failures.push("Temporary Shopify audit cart could not be emptied automatically.");
  } catch {
    report.failures.push("Temporary Shopify audit cart cleanup failed.");
    report.cartCleanup = "failed";
  }
  report.runtimeIssues = browser.issues;
  report.pass = report.failures.length === 0;
  await writeFile("reports/variant-sharing/local-share-readiness.json", `${JSON.stringify(report, null, 2)}\n`);
  browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
