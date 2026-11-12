import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveCategoryArtwork } from "../src/category-artwork.js";
import { getParentCategory, mainCategories } from "../src/category-hierarchy.js";
import { ShoppingBrowse, ShoppingHome } from "../src/shopping-ui.js";

test("a Shopify collection image takes priority over the local temporary icon", () => {
  const bracelets = getParentCategory("Bracelets");
  const artwork = resolveCategoryArtwork(bracelets, {
    bracelets: "https://cdn.shopify.com/s/files/1/0000/0001/collections/bracelets.jpg",
  });

  assert.equal(artwork.source, "shopify");
  assert.match(artwork.url, /bracelets\.jpg\?width=320$/);
  assert.equal(artwork.temporary.name, "crystalBracelet");
});

test("temporary category art maps the requested subjects to relevant sprites", () => {
  const item = (label, parentId = "") => ({ kind: "collection", target: label.toLowerCase().replaceAll(" ", "-"), label, parentId });
  const cases = [
    ["Rudraksha", "rudraksha", "rudraksha"],
    ["Rudraksha Mala", "rudraksha", "mala"],
    ["Rudraksha Bracelet", "rudraksha", "rudrakshaBracelet"],
    ["Crystal Bracelets", "crystals", "crystalBracelet"],
    ["Gemstones", "crystals", "gemstones"],
    ["Rashi Rings", "zodiac", "ring"],
    ["Earrings/Tops", "crystals", "earrings"],
    ["Puja Essentials", "pooja", "pujaDiya"],
  ];

  for (const [label, parentId, expected] of cases) {
    const artwork = resolveCategoryArtwork(item(label, parentId));
    assert.equal(artwork.source, "temporary", label);
    assert.equal(artwork.temporary.name, expected, label);
  }
});

test("all main categories have a local category image fallback", () => {
  for (const category of mainCategories) {
    assert.ok(resolveCategoryArtwork(category)?.temporary, category.label);
  }
});

test("homepage and category browsing render local icons for responsive category surfaces", () => {
  const home = renderToStaticMarkup(React.createElement(ShoppingHome, {
    catalog: [], onNavigate() {}, loading: false, collectionImages: {},
  }));
  const browse = renderToStaticMarkup(React.createElement(ShoppingBrowse, {
    route: { page: "collections", group: "rudraksha" }, catalog: [], sort: "featured", onSort() {}, onNavigate() {},
    pageSize: 24, onMore() {}, loading: false, collectionImages: {},
  }));

  assert.match(home, /shopping-home-category-grid/);
  assert.match(home, /shopping-category-artwork is-temporary/);
  assert.match(browse, /shopping-sidebar-item/);
  assert.match(browse, /shopping-subcategory-grid/);
  assert.match(browse, /category-icon-rudraksha/);
  assert.doesNotMatch(`${home}${browse}`, /Image unavailable|product-placeholder\.svg/);
});

test("a live Shopify collection image renders in place of its temporary tile image", () => {
  const markup = renderToStaticMarkup(React.createElement(ShoppingHome, {
    catalog: [], onNavigate() {}, loading: false,
    collectionImages: { "best-seller": "https://cdn.shopify.com/s/files/1/0000/0001/collections/best-seller.jpg" },
  }));

  assert.match(markup, /data-art-source="shopify"/);
  assert.match(markup, /src="https:\/\/cdn\.shopify\.com\/s\/files\/1\/0000\/0001\/collections\/best-seller\.jpg\?width=320"/);
});

test("unmatched categories remain text-only, with no product image fallback", () => {
  assert.equal(resolveCategoryArtwork({ kind: "collection", target: "pens", label: "Pens" }), null);
});
