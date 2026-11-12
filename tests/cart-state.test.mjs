import test from "node:test";
import assert from "node:assert/strict";
import { createShopifyCartController } from "../src/use-shopify-cart.js";
import { createBuyNowHandler } from "../src/cart.js";

const product = { id: "p1", title: "Crystal", variants: [{ id: "v1", title: "Small", sku: "C1", price: 100, canPurchase: true, available: true }] };
function remote(lines) {
  return { id: "private-cart", totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0), cost: { totalAmount: { amount: String(lines.reduce((sum, line) => sum + line.quantity * 100, 0)), currencyCode: "INR" } }, lines: { nodes: lines.map(line => ({ quantity: line.quantity, merchandise: { id: line.variantId } })) } };
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const line = { key: "p1:v1", productId: "p1", variantId: "v1", quantity: 2, variantTitle: "Small", sku: "C1" };

test("Buy Now preserves the selected variant and never navigates to cart", async () => {
  const calls = [], navigation = [];
  const buyNow = createBuyNowHandler(async (...args) => { calls.push(args); return true; }, () => navigation.push("cart"));
  assert.equal(await buyNow(product, "gid://shopify/ProductVariant/selected", 3), true);
  assert.deepEqual(calls, [[product, "gid://shopify/ProductVariant/selected", 3]]);
  assert.deepEqual(navigation, []);

  const refused = createBuyNowHandler(async () => false, () => navigation.push("cart"));
  assert.equal(await refused(product, "gid://shopify/ProductVariant/unavailable"), false);
  assert.deepEqual(navigation, []);
});

test("addition is optimistic, duplicate taps are ignored, and confirmation is not persisted early", async () => {
  let resolve, calls = 0;
  const notices = [];
  const saved = storage();
  const controller = createShopifyCartController({ storage: saved, service: { source: "shopify", syncCart: (_id, lines) => { calls++; return new Promise(done => { resolve = () => done({ cart: remote(lines) }); }); } }, onNotice: value => notices.push(value) });
  await controller.hydrate([product]);
  const request = controller.add(product, "v1");
  assert.equal(controller.getSnapshot().pending, true);
  assert.equal(controller.getSnapshot().cart[0].quantity, 1);
  assert.deepEqual(controller.getSnapshot().pendingKeys, ["p1:v1"]);
  assert.equal(saved.getItem("crystal-baaz-shopify-cart-lines"), undefined);
  assert.equal(await controller.add(product, "v1"), false);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(calls, 1);
  resolve();
  assert.equal(await request, true);
  assert.equal(controller.getSnapshot().cart[0].quantity, 1);
  assert.equal(controller.getSnapshot().remoteCart.totalQuantity, 1);
  assert.deepEqual(notices, ["Added to cart."]);
  assert.equal(controller.getSnapshot().pending, false);
  assert.deepEqual(JSON.parse(saved.getItem("crystal-baaz-shopify-cart-lines")), [lineWithQuantity(1)]);
});

function lineWithQuantity(quantity) { return { ...line, quantity }; }

test("failure retains committed quantities, hides raw errors, and retry sends the same desired state", async () => {
  let fail = false;
  const sent = [], notices = [];
  const saved = storage();
  const controller = createShopifyCartController({ storage: saved, service: { source: "shopify", async syncCart(_id, lines) { sent.push(lines.map(line => ({ ...line }))); if (fail) throw new Error("private-cart secret"); return { cart: remote(lines) }; } }, onNotice: message => notices.push(message) });
  await controller.hydrate([product]);
  await controller.add(product, "v1");
  fail = true;
  const update = controller.update("p1:v1", 1);
  assert.equal(controller.getSnapshot().cart[0].quantity, 2);
  assert.equal(await update, false);
  assert.equal(controller.getSnapshot().cart[0].quantity, 1);
  assert.equal(controller.getSnapshot().remoteCart, null);
  assert.doesNotMatch(controller.getSnapshot().error, /secret|private-cart/);
  assert.equal(JSON.parse(saved.getItem("crystal-baaz-shopify-cart-lines"))[0].quantity, 1);
  assert.equal(await controller.add(product, "v1"), false);
  fail = false;
  assert.equal(await controller.retry(), true);
  assert.deepEqual(sent[1], sent[2]);
  assert.equal(controller.getSnapshot().cart[0].quantity, 2);
  assert.equal(notices.length, 1);
});

test("rehydration runs once and publishes server-adjusted quantities and refreshed products", async () => {
  let calls = 0, refreshed;
  const controller = createShopifyCartController({ storage: storage({ "crystal-baaz-shopify-cart-lines": JSON.stringify([line]), "crystal-baaz-shopify-cart-id": JSON.stringify("private-cart") }), service: { source: "shopify", async syncCart(id, lines) { calls++; assert.equal(id, "private-cart"); return { cart: remote(lines.map(line => ({ ...line, quantity: 1 }))), products: [product] }; } }, onProducts: products => { refreshed = products; } });
  assert.deepEqual(controller.getSnapshot().cart, []);
  assert.equal(await controller.hydrate([]), true, "saved cart verification does not wait for the product catalog");
  assert.equal(await controller.hydrate([product]), false);
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().cart[0].quantity, 1);
  assert.deepEqual(refreshed, [product]);
});

test("failed hydration can be retried without exposing stored unconfirmed lines", async () => {
  let fail = true;
  const controller = createShopifyCartController({ storage: storage({ "crystal-baaz-shopify-cart-lines": JSON.stringify([line]) }), service: { source: "shopify", async syncCart(_id, lines) { if (fail) throw Error("offline"); return { cart: remote(lines) }; } } });
  assert.equal(await controller.hydrate([product]), false);
  assert.deepEqual(controller.getSnapshot().cart, []);
  fail = false;
  assert.equal(await controller.retry(), true);
  assert.equal(controller.getSnapshot().cart[0].quantity, 2);
});

test("removal to zero accepts a null remote cart and clears persistence", async () => {
  const saved = storage();
  const controller = createShopifyCartController({ storage: saved, service: { source: "shopify", async syncCart(_id, lines) { return { cart: lines.length ? remote(lines) : null }; } } });
  await controller.hydrate([product]);
  await controller.add(product, "v1");
  assert.equal(await controller.remove("p1:v1"), true);
  assert.deepEqual(controller.getSnapshot().cart, []);
  assert.equal(controller.getSnapshot().cartId, null);
  assert.equal(saved.getItem("crystal-baaz-shopify-cart-id"), undefined);
  await controller.add(product, "v1");
  assert.equal(controller.getSnapshot().cart[0].quantity, 1);
});

test("decreasing a one-item Shopify line to zero syncs removal and clears shared cart state", async () => {
  const sent = [], saved = storage();
  const controller = createShopifyCartController({ storage: saved, service: { source: "shopify", async syncCart(_id, lines) {
    sent.push(lines.map(item => ({ ...item })));
    return { cart: lines.length ? remote(lines) : null };
  } } });
  await controller.hydrate([product]);
  assert.equal(await controller.add(product, "v1"), true);
  assert.equal(controller.getSnapshot().cart[0].quantity, 1);

  assert.equal(await controller.update("p1:v1", -1), true);
  assert.deepEqual(sent.at(-1), []);
  assert.deepEqual(controller.getSnapshot().cart, []);
  assert.equal(controller.getSnapshot().cartId, null);
  assert.equal(controller.getSnapshot().cart.reduce((count, item) => count + item.quantity, 0), 0);
  assert.deepEqual(JSON.parse(saved.getItem("crystal-baaz-shopify-cart-lines")), []);
  assert.equal(saved.getItem("crystal-baaz-shopify-cart-id"), undefined);
});

test("failed quantity-one removal restores the confirmed cart line", async () => {
  const controller = createShopifyCartController({ service: { source: "shopify", async syncCart(_id, lines) {
    if (!lines.length) throw new Error("mutation failed");
    return { cart: remote(lines) };
  } } });
  await controller.hydrate([product]);
  await controller.add(product, "v1");
  assert.equal(await controller.update("p1:v1", -1), false);
  assert.equal(controller.getSnapshot().cart.length, 1);
  assert.equal(controller.getSnapshot().cart[0].quantity, 1);
  assert.equal(controller.getSnapshot().pending, false);
});

test("rapid additions to different products share one mutation and keep optimistic lines visible", async () => {
  const second = { id: "p2", title: "Quartz", variants: [{ id: "v2", title: "Large", sku: "Q2", price: 100, canPurchase: true, available: true }] };
  const requests = [];
  const controller = createShopifyCartController({ service: { source: "shopify", syncCart(_id, lines) { return new Promise(resolve => requests.push({ lines, resolve })); } } });
  await controller.hydrate([product, second]);
  const firstAdd = controller.add(product, "v1");
  const secondAdd = controller.add(second, "v2");
  assert.deepEqual(controller.getSnapshot().cart.map(item => item.key), ["p1:v1", "p2:v2"]);
  assert.deepEqual(controller.getSnapshot().pendingKeys, ["p1:v1", "p2:v2"]);
  assert.equal(requests.length, 0, "network work is debounced while optimistic lines show immediately");
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].lines.map(item => item.key), ["p1:v1", "p2:v2"]);
  requests[0].resolve({ cart: remote(requests[0].lines) });
  assert.equal(await firstAdd, true);
  assert.equal(await secondAdd, true);
  assert.deepEqual(controller.getSnapshot().pendingKeys, []);
  assert.equal(controller.getSnapshot().cart.length, 2);
});

test("missing or unavailable exact variants never reach Shopify", async () => {
  let calls = 0;
  const controller = createShopifyCartController({ service: { source: "shopify", async syncCart() { calls++; } } });
  await controller.hydrate([product]);
  assert.equal(await controller.add(product, "missing"), false);
  assert.equal(await controller.add({ ...product, variants: [{ ...product.variants[0], canPurchase: false }] }, "v1"), false);
  assert.equal(calls, 0);
});

test("server refusal of an addition produces no success notice", async () => {
  const notices = [];
  const controller = createShopifyCartController({ service: { source: "shopify", async syncCart() { return { cart: remote([]) }; } }, onNotice: notice => notices.push(notice) });
  await controller.hydrate([product]);
  assert.equal(await controller.add(product, "v1"), false);
  assert.deepEqual(controller.getSnapshot().cart, []);
  assert.equal(notices.includes("Added to cart."), false);
  assert.match(controller.getSnapshot().error, /could not add/);
});
