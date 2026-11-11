import test from "node:test";
import assert from "node:assert/strict";
import { buildCartShare, buildCategoryShareUrl, buildProductShareUrl, buildWhatsAppShareUrl, copyCartShare, parseSharedCartItems, publicStorefrontBaseUrl, shareCart, shareCategoryLink, shareProductLink } from "../src/cart-share.js";
import { parseRoute } from "../src/routes.js";

const variantOne = "gid://shopify/ProductVariant/1234567890";
const variantTwo = "gid://shopify/ProductVariant/9876543210";
const lines = [
  { key: "private-key", variantId: variantOne, quantity: 2, variantTitle: "Size: 5 Ratti", product: { title: "Blue Sapphire Ring", handle: "blue-sapphire", variants: [{ id: variantOne, sku: "RG166", title: "Variant 1", selectedOptions: [{ name: "Variant", value: "Variant 1" }] }] } },
  { key: "another-private-key", variantId: variantTwo, quantity: 1, product: { title: "Rudraksha Mala", handle: "rudraksha-mala" } },
];
const options = { lines, baseUrl: "https://shop.example/store?campaign=private#cart/private-cart" };

test("product share URLs preserve product and selected variant in the existing hash route", () => {
  const url = buildProductShareUrl({ handle: "blue-sapphire" }, variantOne, { baseUrl: "https://shop.example/?campaign=x#home" });
  assert.deepEqual(parseRoute(new URL(url).hash), { page: "product", handle: "blue-sapphire", variantId: variantOne });
  assert.equal(new URL(url).pathname, "/");
});

test("product sharing uses native share and copies only the safe URL as fallback", async () => {
  let received;
  const result = await shareProductLink({ product: { title: "Blue Sapphire Ring", handle: "blue-sapphire" }, variantId: variantOne, baseUrl: "https://shop.example/", navigator: { async share(payload) { received = payload; } } });
  assert.equal(result.status, "shared");
  assert.equal(new URL(received.url).hash.includes(encodeURIComponent(variantOne)), true);

  let copied;
  const fallback = await shareProductLink({ product: { title: "Blue Sapphire Ring", handle: "blue-sapphire" }, variantId: variantOne, baseUrl: "https://shop.example/", navigator: { clipboard: { async writeText(url) { copied = url; } } } });
  assert.equal(fallback.status, "copied");
  assert.equal(copied, received.url);
});

test("category sharing keeps the selected category route and uses public native-share or copy fallbacks", async () => {
  const routeHash = "#collections?group=bracelets&category=collection%3Astone-bracelet";
  const url = buildCategoryShareUrl("Bracelets", routeHash, { baseUrl: "https://shop.example/?campaign=private#home" });
  assert.equal(new URL(url).hash, routeHash);
  assert.doesNotMatch(url, /campaign=private/);
  assert.equal(buildCategoryShareUrl("Bracelets", routeHash, { baseUrl: "http://localhost:5173/" }), "");
  assert.equal(buildCategoryShareUrl("Bracelets", "javascript:alert(1)", { baseUrl: "https://shop.example/" }), "");

  let shared;
  const native = await shareCategoryLink({ category: "Bracelets", routeHash, baseUrl: "https://shop.example/", navigator: { async share(payload) { shared = payload; } } });
  assert.equal(native.status, "shared");
  assert.equal(shared.url, url);
  assert.match(shared.text, /Bracelets/);
  let copied;
  const fallback = await shareCategoryLink({ category: "Bracelets", routeHash, baseUrl: "https://shop.example/", navigator: { clipboard: { async writeText(value) { copied = value; } } } });
  assert.equal(fallback.status, "copied");
  assert.equal(copied, url);
});

test("cart share URL encodes only real Shopify variant IDs and quantities", () => {
  const payload = buildCartShare(options);
  assert.equal(parseRoute(new URL(payload.url).hash).page, "shared-cart");
  assert.deepEqual(parseSharedCartItems(parseRoute(new URL(payload.url).hash).items), {
    ok: true,
    items: [{ variantId: variantOne, quantity: 2 }, { variantId: variantTwo, quantity: 1 }],
  });
  assert.match(payload.text, /2 × Blue Sapphire Ring \(Size: 5 Ratti\)/);
  assert.doesNotMatch(payload.url, /private|gid:|RG166|Blue Sapphire/);
  assert.doesNotMatch(payload.text, /private-key|private-cart|checkout/);
});

test("WhatsApp share uses the verified public cart link and is unavailable on localhost", () => {
  const url = buildWhatsAppShareUrl(options);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://wa.me");
  assert.ok(parsed.searchParams.get("text").includes(buildCartShare(options).url));
  assert.match(parsed.searchParams.get("text"), /Blue Sapphire Ring/);
  assert.equal(buildWhatsAppShareUrl({ ...options, baseUrl: "http://localhost:5173/" }), "");
});

test("Copy Link copies only the public cart URL and reports missing deployment origin", async () => {
  let copied = "";
  const result = await copyCartShare({ ...options, navigator: { clipboard: { async writeText(url) { copied = url; } } } });
  assert.equal(result.status, "copied");
  assert.equal(copied, buildCartShare(options).url);
  const blocked = await copyCartShare({ ...options, baseUrl: "http://localhost:5173/", navigator: { clipboard: { async writeText() { throw Error("must not copy"); } } } });
  assert.equal(blocked.status, "unavailable");
  assert.match(blocked.message, /no public Crystal Baaz website address/i);
});

test("cart lines with the same Shopify variant are combined", () => {
  const payload = buildCartShare({ ...options, lines: [lines[0], { ...lines[0], key: "duplicate", quantity: 3 }] });
  const parsed = parseSharedCartItems(parseRoute(new URL(payload.url).hash).items);
  assert.deepEqual(parsed.items, [{ variantId: variantOne, quantity: 5 }]);
});

test("invalid, oversized, local, and non-Shopify cart data cannot produce public links", () => {
  assert.equal(buildCartShare({ lines: [{ variantId: "private-variant", quantity: 1 }], baseUrl: "https://shop.example/" }).url, "");
  assert.equal(buildCartShare({ lines: [...lines, { variantId: "preview-only", quantity: 1 }], baseUrl: "https://shop.example/" }).url, "");
  assert.equal(buildCartShare({ lines: [{ variantId: variantOne, quantity: 1000 }], baseUrl: "https://shop.example/" }).url, "");
  assert.equal(buildCartShare({ lines, baseUrl: "http://localhost:5173/" }).url, "");
  assert.equal(buildCartShare({ lines, baseUrl: "javascript:secret" }).url, "");
  assert.equal(publicStorefrontBaseUrl({ baseUrl: "http://127.0.0.1:4173/" }), null);
  assert.equal(parseSharedCartItems("123:0").ok, false);
  assert.equal(parseSharedCartItems("123:1000").ok, false);
  assert.equal(parseSharedCartItems("123:1,not-an-id:2").ok, false);
});

test("local preview explains the missing public URL without pretending to share", async () => {
  const result = await shareCart({ lines, baseUrl: "http://localhost:5173/", navigator: { async share() { throw Error("must not share"); } } });
  assert.equal(result.status, "unavailable");
  assert.match(result.message, /preview has no public Crystal Baaz website address/i);
});

test("invalid cart items and oversized links report distinct sharing blockers", () => {
  assert.equal(buildCartShare({ lines: [{ variantId: "private-id", quantity: 1 }], baseUrl: "https://shop.example/" }).reason, "invalid-cart");
  const many = Array.from({ length: 50 }, (_, index) => ({ variantId: `gid://shopify/ProductVariant/${index + 1}`, quantity: 999, product: { title: "Long product name ".repeat(10) } }));
  assert.equal(buildCartShare({ lines: many, baseUrl: `https://shop.example/${"a".repeat(1900)}` }).reason, "too-large");
});

test("native cart share is awaited before reporting success", async () => {
  let received;
  const result = await shareCart({ ...options, navigator: { async share(payload) { received = payload; } } });
  assert.equal(result.status, "shared");
  assert.deepEqual(received, buildCartShare(options));
});

test("native share cancellation does not copy anything or announce success", async () => {
  let copied = false;
  const result = await shareCart({ ...options, navigator: { async share() { throw Object.assign(Error("cancel"), { name: "AbortError" }); }, clipboard: { async writeText() { copied = true; } } } });
  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "");
  assert.equal(copied, false);
});

test("clipboard fallback copies the shareable URL and reports its real result", async () => {
  let copied;
  const result = await shareCart({
    ...options,
    navigator: { clipboard: { async writeText(url) { copied = url; } } },
  });
  assert.equal(result.status, "copied");
  assert.equal(copied, buildCartShare(options).url);
  const failed = await shareCart({
    ...options,
    navigator: { clipboard: { async writeText() { throw Error("denied"); } } },
  });
  assert.equal(failed.status, "failed");
  assert.equal((await shareCart({ ...options, navigator: {} })).status, "unsupported");
});
