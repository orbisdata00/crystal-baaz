import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { NewArrivalsPreview, PdpPurchaseBar, ShoppingBrowse, ShoppingCard, ShoppingHeader, ShoppingHome, ShoppingProduct, ShoppingResults, VariantSheetContent } from "../src/shopping-ui.js";

const product = {
  id: "gid://shopify/Product/1",
  handle: "moonstone-ring",
  title: "Moonstone Ring",
  type: "Ring",
  image: "https://cdn.shopify.com/s/files/1/product.jpg",
  price: 60,
  compareAt: 100,
  currencyCode: "INR",
  compareAtCurrencyCode: "INR",
  variantsComplete: true,
  variants: [{
    id: "gid://shopify/ProductVariant/1",
    title: "Variant 1",
    selectedOptions: [{ name: "Title", value: "Variant 1" }],
    price: 60,
    compareAt: 100,
    currencyCode: "INR",
    compareAtCurrencyCode: "INR",
    available: true,
    canPurchase: true,
  }],
};

function render(cart = []) {
  return renderToStaticMarkup(React.createElement(ShoppingCard, {
    product,
    onOpen() {},
    onAdd() {},
    onSave() {},
    onUpdate() {},
    saved: [],
    cart,
  }));
}

test("product card aligns current price with Buy Now and keeps title copy outside the image tile", () => {
  const markup = render();
  const tileStart = markup.indexOf("data-product-image-tile");
  const copyStart = markup.indexOf('class="shopping-product-copy"');
  const priceStart = markup.indexOf('class="shopping-tile-prices"');
  const titleStart = markup.indexOf('class="shopping-product-title"');
  assert.ok(tileStart >= 0 && copyStart > tileStart);
  assert.ok(markup.slice(tileStart, copyStart).includes('class="shopping-product-image-link"'));
  assert.ok(markup.slice(tileStart, copyStart).includes('class="shopping-save"'));
  assert.match(markup.slice(tileStart, copyStart), /class="shopping-tile-action(?: [^"]*)?"/);
  assert.ok(markup.slice(tileStart, copyStart).includes('class="shopping-add"'));
  assert.match(markup, /class="shopping-add"[^>]*>Buy Now<\/button>/);
  assert.match(markup, /₹60/);
  assert.doesNotMatch(markup, />\s*ADD\s*</i);
  assert.ok(priceStart > tileStart && priceStart < copyStart && titleStart > copyStart);
  const purchaseRow = markup.slice(markup.indexOf('class="shopping-tile-purchase-row"'), copyStart);
  assert.match(purchaseRow, /shopping-tile-prices/);
  assert.match(purchaseRow, /shopping-add/);
  assert.match(markup, /40% OFF/);
  assert.doesNotMatch(markup, /on MRP/i);
  assert.match(markup, /class="shopping-product-attributes"><span[^>]*>Ring<\/span>/);
  assert.doesNotMatch(markup, /Variant 1/);
});

test("product add control reflects the current cart quantity", () => {
  const markup = render([{ key: "line-1", productId: product.id, variantId: product.variants[0].id, quantity: 2 }]);
  assert.match(markup, /role="group" aria-label="Quantity for Moonstone Ring"/);
  assert.match(markup, /aria-live="polite">2<\/span>/);
  assert.doesNotMatch(markup, /class="shopping-add"/);
});

test("unavailable variants keep a disabled unavailable state", () => {
  const unavailable = { ...product, variants: [{ ...product.variants[0], available: false }] };
  const markup = renderToStaticMarkup(React.createElement(ShoppingCard, {
    product: unavailable, onOpen() {}, onAdd() {}, onSave() {}, onUpdate() {}, saved: [], cart: [],
  }));
  assert.match(markup, /class="shopping-add"[^>]*disabled[^>]*>Unavailable<\/button>/);
});

test("mobile rails and navigation use compact, separate visual containers", async () => {
  const css = await readFile(new URL("../src/shopping.css", import.meta.url), "utf8");
  assert.match(css, /\.shopping-product-card \{[^}]*border:0; border-radius:0; background:transparent; box-shadow:none;/);
  assert.match(css, /\.shopping-product-image-panel \{ height:clamp\(145px,39vw,170px\); margin:0; border-radius:10px;/);
  assert.match(css, /\.shopping-rail-track>\.shopping-product-card \{ flex:0 0 clamp\(104px,28vw,124px\); \}/);
  assert.match(css, /\.shopping-product-card:not\(\[data-fully-visible="true"\]\) \.shopping-tile-action \{ visibility:hidden; \}/);
  assert.match(css, /\.shopping-bottom-nav[^}]*border-radius:999px; background:#ffffff/);
  assert.match(css, /\.shopping-tile-action \.shopping-add \{ min-width:70px;[^}]*white-space:nowrap/);
  assert.match(css, /\.shopping-tile-action \.shopping-add \{ min-width:58px; min-height:30px;/);
  assert.match(css, /\.shopping-home-category-grid \{ display:flex; gap:12px; overflow-x:auto/);
  assert.match(css, /\.shopping-category-artwork \{[^}]*aspect-ratio:1;/);
  assert.match(css, /\.shopping-tile-purchase-row \{ display:flex; align-items:center; justify-content:space-between/);
  assert.doesNotMatch(css, /\.shopping-browse-content \.shopping-add,\.shopping-browse-content \.shopping-quantity \{ width:100%/);
  assert.match(css, /\.shopping-search>button \{ width:44px; height:44px;/);
});

test("variant sheet content keeps Shopify identity, price, availability, and action in separate columns", async () => {
  const variantProduct = {
    ...product,
    variantsComplete: true,
    variants: [
      { ...product.variants[0], id: "gid://shopify/ProductVariant/166", title: "Variant 1", sku: "RG166", selectedOptions: [{ name: "Title", value: "Variant 1" }], price: 3490 },
      { ...product.variants[0], id: "gid://shopify/ProductVariant/168", title: "Variant 2", sku: "RG168", selectedOptions: [{ name: "Title", value: "Variant 2" }], price: 3890 },
    ],
  };
  const markup = renderToStaticMarkup(React.createElement(VariantSheetContent, {
    product: variantProduct, onClose() {}, cart: [], pendingKeys: [], pendingOperations: [], onAdd() {}, onUpdate() {},
  }));
  const css = await readFile(new URL("../src/shopping.css", import.meta.url), "utf8");
  assert.equal((markup.match(/class="shopping-variant-line"/g) || []).length, 2);
  assert.match(markup, /SKU: RG166/);
  assert.match(markup, /SKU: RG168/);
  assert.match(markup, /₹3,490/);
  assert.match(markup, /₹3,890/);
  assert.match(markup, /Available/);
  assert.equal((markup.match(/>Buy Now<\/button>/g) || []).length, 2);
  assert.match(css, /\.shopping-variant-line \{ display:grid; grid-template-columns:52px minmax\(0,1fr\) 92px;/);
  assert.match(css, /\.shopping-modal-backdrop\.shopping-variant-backdrop \{ --shop-accent:#0c831f;[^}]*z-index:140/);
  assert.match(css, /@media\(max-width:780px\)[\s\S]*?\.shopping-variant-line \{ grid-template-columns:46px minmax\(0,1fr\) 86px;/);
  assert.match(css, /@media\(max-width:359px\)[\s\S]*?\.shopping-variant-line \{ grid-template-columns:40px minmax\(0,1fr\) 76px;/);
  assert.match(css, /@media\(max-width:380px\) \{\s*\.shopping-browse-content \.shopping-product-grid \{ grid-template-columns:minmax\(0,1fr\); \}/);
});

test("desktop product cards keep one boundary around the image and action tile", async () => {
  const css = await readFile(new URL("../src/shopping.css", import.meta.url), "utf8");
  const cardRule = css.match(/(?:^|\n)\.shopping-product-card \{([^}]+)\}/)?.[1] || "";
  const imageRule = css.match(/(?:^|\n)\.shopping-product-image-panel \{([^}]+)\}/)?.[1] || "";
  assert.match(cardRule, /border:0;/);
  assert.match(cardRule, /background:transparent;/);
  assert.match(cardRule, /box-shadow:none;/);
  assert.match(imageRule, /border:1px solid var\(--line\);/);
  assert.doesNotMatch(css, /\.shopping-product-card \{[^}]*border:1px solid/);
});

test("home opens with compact category icons and Best Seller is the first product section", () => {
  const markup = renderToStaticMarkup(React.createElement(ShoppingHome, { catalog: [], onNavigate() {}, loading: false, error: "" }));
  const categoryStart = markup.indexOf('class="shopping-home-category-grid"');
  const bestSeller = markup.indexOf('data-home-section="best-seller"');
  const newArrivals = markup.indexOf('data-home-section="new-arrivals"');
  assert.ok(categoryStart >= 0 && bestSeller > categoryStart && newArrivals > bestSeller);
  assert.match(markup, /data-category-color="best-seller"/);
  assert.doesNotMatch(markup, /shopping-campaign-main|shopping-campaign-small/);
});

test("New Arrivals preview shows at most three responsive rows of Shopify products", async () => {
  const products = Array.from({ length: 13 }, (_, index) => ({
    ...product,
    id: `gid://shopify/Product/${index + 1}`,
    handle: `moonstone-ring-${index + 1}`,
  }));
  products.push({ ...product, id: "demo-product", handle: "demo-product", previewOnly: true });
  const markup = renderToStaticMarkup(React.createElement(NewArrivalsPreview, {
    products,
    onView() {},
    onOpen() {}, onAdd() {}, onSave() {}, onUpdate() {}, saved: [], cart: [],
  }));
  const css = await readFile(new URL("../src/shopping.css", import.meta.url), "utf8");
  assert.equal((markup.match(/class="shopping-product-card"/g) || []).length, 12);
  assert.match(markup, /gid:\/\/shopify\/Product\/12/);
  assert.doesNotMatch(markup, /gid:\/\/shopify\/Product\/13|demo-product/);
  assert.match(css, /\.shopping-new-arrivals-grid \{ grid-template-columns:repeat\(4,minmax\(0,1fr\)\); \}/);
  assert.match(css, /\.shopping-new-arrivals-grid>\.shopping-product-card:nth-child\(n\+7\) \{ display:none; \}/);
  assert.match(css, /\.shopping-new-arrivals-grid>\.shopping-product-card:nth-child\(n\+10\) \{ display:none; \}/);
});

test("category and product listing screens omit product counts without removing loading controls", () => {
  const browse = renderToStaticMarkup(React.createElement(ShoppingBrowse, {
    route: { page: "collections", group: "best-seller" }, catalog: [], sort: "featured", onSort() {}, onNavigate() {}, pageSize: 24, onMore() {}, loading: false,
  }));
  const results = renderToStaticMarkup(React.createElement(ShoppingResults, {
    catalog: [product], title: "Search results", pageSize: 24, onMore() {}, sort: "featured", onSort() {}, loading: false,
  }));
  const overview = renderToStaticMarkup(React.createElement(ShoppingBrowse, {
    route: { page: "categories" }, catalog: [], sort: "featured", onSort() {}, onNavigate() {}, pageSize: 24, onMore() {}, loading: false,
  }));
  for (const markup of [browse, results, overview]) {
    assert.doesNotMatch(markup, /\b\d+\s+products\b|\b\d+\s+loaded\b|Showing\s+\d+\s+of\s+\d+/i);
  }
  assert.match(browse, /Share category/);
  assert.match(results, /data-product-id="gid:\/\/shopify\/Product\/1"/);
});

test("category browsing has sharing and no stock or price range filters", () => {
  const markup = renderToStaticMarkup(React.createElement(ShoppingBrowse, {
    route: { page: "collections", group: "best-seller" }, catalog: [], sort: "featured", onSort() {}, onNavigate() {}, pageSize: 24, onMore() {}, loading: false,
  }));
  assert.match(markup, /Share category/);
  assert.doesNotMatch(markup, /In stock|Minimum price|Maximum price|Min ₹|Max ₹/i);
});

test("product details show Shopify description and only verified reviews/certification", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const liveProduct = {
      ...product, id: "gid://shopify/Product/1", type: "Ring", description: "<p>Natural <strong>moonstone</strong> &#x2728;</p>",
      collectionHandles: [], images: [product.image], reviews: [
        { id: "review-fake", rating: 5, text: "Do not show this", verified: false },
        { id: "review-live", rating: 4, text: "Real verified review", verified: true },
      ], certification: { verified: false, issuer: "Unverified issuer" },
    };
    const markup = renderToStaticMarkup(React.createElement(ShoppingProduct, {
      product: liveProduct, catalog: [], saved: [], cart: [], pendingKeys: [], pendingOperations: [], onAdd() {}, onUpdate() {}, onSave() {}, onNavigate() {},
    }));
    assert.match(markup, /Product description/);
    assert.match(markup, /Natural moonstone ✨/);
    assert.match(markup, /Real verified review/);
    assert.doesNotMatch(markup, /Do not show this|Unverified issuer|>In stock<|>Ring<\/p>/);
    assert.match(markup, /Verified certification details have not been supplied/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("PDP header exposes back, search, account, and a cart count badge", () => {
  const markup = renderToStaticMarkup(React.createElement(ShoppingHeader, {
    route: { page: "product" }, cartCount: 3, onBack() {}, onNavigate() {}, onCart() {},
  }));
  assert.match(markup, /Crystal Baaz home/);
  assert.match(markup, /Search products/);
  assert.match(markup, /Customer account/);
  assert.match(markup, /Cart, 3 items/);
  assert.match(markup, />3<\/span>/);
});

test("sticky PDP purchase bar uses live variant price, MRP, quantity and Buy Now", () => {
  const markup = renderToStaticMarkup(React.createElement(PdpPurchaseBar, {
    product, variant: product.variants[0], off: 40, thumbnail: product.image, cart: [], pendingKeys: [], pendingOperations: [],
    onAdd() {}, onUpdate() {}, onNavigate() {},
  }));
  assert.match(markup, /shopping-pdp-sticky-thumb/);
  assert.match(markup, /₹60/);
  assert.match(markup, /MRP/);
  assert.match(markup, /₹100/);
  assert.match(markup, /Increase Moonstone Ring quantity/);
  assert.match(markup, /shopping-pdp-buy[^>]*>Buy Now<\/button>/);
  assert.doesNotMatch(markup, /shopping-pdp-offer/);
});

test("PDP quantity one can be decremented and Buy Now stays disabled for an existing line", () => {
  const markup = renderToStaticMarkup(React.createElement(PdpPurchaseBar, {
    product, variant: product.variants[0], off: 40, thumbnail: product.image,
    cart: [{ key: "line-1", productId: product.id, variantId: product.variants[0].id, quantity: 1 }],
    pendingKeys: [], pendingOperations: [], onAdd() {}, onUpdate() {}, onNavigate() {},
  }));
  assert.match(markup, /aria-label="Decrease Moonstone Ring quantity"(?![^>]*disabled)/);
  assert.match(markup, /aria-live="polite">1<\/span>/);
  assert.match(markup, /shopping-pdp-buy[^>]*disabled[^>]*>Added<\/button>/);
});

test("PDP gallery renders actual Shopify video media and responsive sticky purchase styling", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const liveProduct = {
      ...product,
      galleryMedia: [{ id: "media-video", type: "video", src: "https://cdn.shopify.com/videos/ring.mp4", mimeType: "video/mp4", poster: product.image }],
    };
    const markup = renderToStaticMarkup(React.createElement(ShoppingProduct, {
      product: liveProduct, catalog: [], saved: [], cart: [], pendingKeys: [], pendingOperations: [], onAdd() {}, onUpdate() {}, onSave() {}, onNavigate() {},
    }));
    const css = await readFile(new URL("../src/shopping.css", import.meta.url), "utf8");
    assert.match(markup, /shopping-gallery-stage/);
    assert.match(markup, /<video[^>]*controls[^>]*playsinline[^>]*>/i);
    assert.match(markup, /shopping-pdp-zoom/);
    assert.match(markup, /aria-label="Share product"/);
    assert.match(css, /\.shopping-pdp-sticky-wrap \{ position:fixed;[^}]*env\(safe-area-inset-bottom\)/);
    assert.match(css, /\.shopping-product-detail \{ grid-template-columns:minmax\(0,1\.06fr\) minmax\(0,\.94fr\)/);
    assert.match(css, /@media\(max-width:780px\)[\s\S]*?\.shopping-pdp-sticky \{ display:grid;/);
    assert.match(css, /\.shopping-gallery-stage \{ width:min\(calc\(100vw - 64px\),520px\);/);
    assert.match(css, /\.shopping-desktop-purchase \{ display:block; margin:0; \}/);
    assert.match(css, /\.shopping-pdp-desktop-action \{ display:none; \}/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
