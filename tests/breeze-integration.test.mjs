import test from "node:test";
import assert from "node:assert/strict";
import { createBreezeInitPayload, createBreezeSdk, mapShopifyCartIntent, prepareBreezeCheckout } from "../src/breeze.js";
import { createBreezeBackend } from "../backend/breeze-integration.js";

const config = { enabled: true, merchantId: "sandbox-merchant", shopUrl: "https://shop.example", environment: "sandbox", productionApproved: false };
const cart = { id: "gid://shopify/Cart/cart-1", lines: { nodes: [{ quantity: 3, merchandise: { id: "gid://shopify/ProductVariant/123" } }] }, cost: { totalAmount: { amount: "300.00", currencyCode: "INR" } } };

test("builds the documented SDK initialization envelope", () => {
  assert.deepEqual(createBreezeInitPayload(config, "init-1"), {
    requestId: "init-1", service: "in.breeze.onecco",
    payload: { merchantId: "sandbox-merchant", shopUrl: "https://shop.example", environment: "sandbox" },
  });
  assert.throws(() => createBreezeInitPayload({ ...config, environment: "production" }), /not approved/);
  assert.throws(() => createBreezeInitPayload({ ...config, shopUrl: "http://shop.example" }), /HTTPS/);
});

test("initializes successfully from the documented initiate event", async () => {
  let payloadSeen;
  const sdk = { initiate(payload, callback) { payloadSeen = payload; callback({ payload: { eventName: "initiate", status: "SUCCESS" } }); }, process() {} };
  const service = createBreezeSdk({ sdk, config });
  await service.initialize();
  assert.equal(payloadSeen.service, "in.breeze.onecco");
});

test("surfaces SDK initialization failure and allows retry", async () => {
  let attempt = 0;
  const sdk = { initiate(_payload, callback) { attempt++; callback({ payload: { eventName: "initiate", status: "FAILURE" } }); }, process() {} };
  const service = createBreezeSdk({ sdk, config });
  await assert.rejects(service.initialize(), /initialization failed/);
  await assert.rejects(service.initialize(), /initialization failed/);
  assert.equal(attempt, 2);
});

test("maps only actual Shopify variant IDs, quantities, and server totals", () => {
  assert.deepEqual(mapShopifyCartIntent(cart), {
    shopifyCartId: cart.id,
    lines: [{ variantId: "gid://shopify/ProductVariant/123", quantity: 3 }],
    total: { amount: "300.00", currencyCode: "INR" },
  });
  assert.throws(() => mapShopifyCartIntent({ ...cart, lines: { nodes: [{ quantity: 0, merchandise: { id: "fake" } }] } }), /invalid item/);
  assert.throws(() => mapShopifyCartIntent({ ...cart, cost: { totalAmount: { amount: "3", currencyCode: "USD" } } }), /not confirmed in INR/);
});

test("checkout fails closed when the backend or approved process schema is missing", async () => {
  await assert.rejects(prepareBreezeCheckout({ cart, config, backendUrl: "", fetchImpl: async () => { throw new Error("should not be called"); } }), /backend is not configured/);
  await assert.rejects(prepareBreezeCheckout({ cart, config, backendUrl: "https://api.example", fetchImpl: async () => ({ ok: true, json: async () => ({}) }), sdk: createBreezeSdk({ config, sdk: { initiate() {}, process() {} } }) }), /session is unavailable or invalid/);
});

test("backend fetches Shopify cart server-side and requires approved Breeze adapters", async () => {
  const requests = [];
  const backend = createBreezeBackend({
    shopify: { async fetchCart(id) { requests.push(id); return { id, lines: [{ variantId: "gid://shopify/ProductVariant/123", quantity: 3 }], total: { amount: "300.00", currencyCode: "INR" } }; } },
    breeze: { async createCheckoutSession(input) { return input; } },
  });
  const result = await backend.prepareCheckout({ shopifyCartId: cart.id });
  assert.deepEqual(requests, [cart.id]);
  assert.equal(result.cart.lines[0].quantity, 3);
  const unconfigured = createBreezeBackend({ shopify: { fetchCart: async id => ({ id, lines: [{ variantId: "gid://shopify/ProductVariant/123", quantity: 1 }], total: { amount: "1", currencyCode: "INR" } }) } });
  await assert.rejects(unconfigured.prepareCheckout({ shopifyCartId: cart.id }), /createCheckoutSession/);
  await assert.rejects(backend.prepareCheckout({ shopifyCartId: "bad" }), /valid Shopify cart ID/);
});

test("webhook boundary verifies before idempotent event handling", async () => {
  const orderEvents = [];
  const backend = createBreezeBackend({
    webhookVerifier: { async verifyAndDecode() { return { id: "evt-1" }; } },
    idempotency: { async claimEvent() { return false; } },
    orders: { async handleVerifiedWebhook({ event }) { orderEvents.push(event); } },
  });
  assert.deepEqual(await backend.receiveWebhook({ headers: {}, rawBody: "opaque" }), { accepted: true, duplicate: true });
  assert.deepEqual(orderEvents, []);
});
