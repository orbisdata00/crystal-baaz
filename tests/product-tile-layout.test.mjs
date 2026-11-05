import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { ShoppingCard } from "../src/shopping-ui.js";

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

test("mobile product card keeps image actions in the tile and product copy outside", () => {
  const markup = render();
  const tileStart = markup.indexOf("data-product-image-tile");
  const copyStart = markup.indexOf('class="shopping-product-copy"');
  const priceStart = markup.indexOf('class="shopping-product-price-info"');
  const titleStart = markup.indexOf('class="shopping-product-title"');
  assert.ok(tileStart >= 0 && copyStart > tileStart);
  assert.ok(markup.slice(tileStart, copyStart).includes('class="shopping-product-image-link"'));
  assert.ok(markup.slice(tileStart, copyStart).includes('class="shopping-save"'));
  assert.match(markup.slice(tileStart, copyStart), /class="shopping-tile-action(?: [^"]*)?"/);
  assert.ok(markup.slice(tileStart, copyStart).includes('class="shopping-add"'));
  assert.ok(priceStart > copyStart && titleStart > priceStart);
  assert.match(markup, /40% OFF on MRP/);
  assert.match(markup, /class="shopping-product-attributes"><span[^>]*>Ring<\/span>/);
  assert.doesNotMatch(markup, /Variant 1/);
});

test("product add control reflects the current cart quantity", () => {
  const markup = render([{ key: "line-1", productId: product.id, variantId: product.variants[0].id, quantity: 2 }]);
  assert.match(markup, /role="group" aria-label="Quantity for Moonstone Ring"/);
  assert.match(markup, /aria-live="polite">2<\/span>/);
  assert.doesNotMatch(markup, /class="shopping-add"/);
});

test("mobile rails and navigation use compact, separate visual containers", async () => {
  const css = await readFile(new URL("../src/shopping.css", import.meta.url), "utf8");
  assert.match(css, /\.shopping-product-card \{[^}]*border:0; border-radius:0; background:transparent; box-shadow:none;/);
  assert.match(css, /\.shopping-product-image-panel \{ height:clamp\(145px,39vw,170px\); margin:0; border-radius:10px;/);
  assert.match(css, /\.shopping-rail-track>\.shopping-product-card \{ flex:0 0 clamp\(104px,28vw,124px\); \}/);
  assert.match(css, /\.shopping-product-card:not\(\[data-fully-visible="true"\]\) \.shopping-tile-action \{ visibility:hidden; \}/);
  assert.match(css, /\.shopping-bottom-nav[^}]*border-radius:999px; background:#ffffff/);
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
