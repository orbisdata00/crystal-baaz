import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mapShopifyCartToRazorpayMagic, validateMagicCheckoutResponse, validateMagicOrderResponse } from "../src/razorpay-magic-cart.js";
import { loadRazorpayMagicSdk, resetRazorpayMagicSdkForTests, startRazorpayMagicCheckout } from "../src/razorpay-magic-checkout.js";
import { createRazorpayMagicBackend, createShopifyMagicCartFetcher, verifyRazorpayMagicSignature } from "../backend/razorpay-magic.js";

const cart = () => ({
  id: "gid://shopify/Cart/cb-token?key=secret-key", totalQuantity: 2, note: "Gift wrap",
  attributes: [{ key: "source", value: "pwa" }], discountCodes: [{ code: "SAVE10", applicable: true }],
  cost: { subtotalAmount: { amount: "200.00", currencyCode: "INR" }, totalAmount: { amount: "180.00", currencyCode: "INR" } },
  lines: { nodes: [{ id: "gid://shopify/CartLine/1", quantity: 2, attributes: [{ key: "gift", value: "yes" }], cost: {
    amountPerQuantity: { amount: "100.00", currencyCode: "INR" }, subtotalAmount: { amount: "200.00", currencyCode: "INR" }, totalAmount: { amount: "180.00", currencyCode: "INR" },
  }, merchandise: {
    id: "gid://shopify/ProductVariant/1234567890123", availableForSale: true,
    product: { id: "gid://shopify/Product/9876543210123" },
  } }] },
});

test("maps the Shopify GraphQL cart to documented Magic Shopify cart fields safely", () => {
  const mapped = mapShopifyCartToRazorpayMagic(cart());
  assert.equal(mapped.cart.token, "cb-token?key=secret-key");
  assert.equal(mapped.cart.item_count, 2);
  assert.deepEqual(mapped.cart.attributes, { source: "pwa" });
  assert.deepEqual(mapped.cart.items[0], { id: 1234567890123, quantity: 2, product_id: 9876543210123, variant_id: 1234567890123, properties: { gift: "yes" } });
  assert.deepEqual(mapped.discountCodes, ["SAVE10"]);
  assert.equal(mapped.currency, "INR");
  assert.throws(() => mapShopifyCartToRazorpayMagic({ ...cart(), id: "gid://shopify/Cart/no-key" }), /token/);
  assert.throws(() => mapShopifyCartToRazorpayMagic({ ...cart(), lines: { nodes: [{ ...cart().lines.nodes[0], merchandise: { ...cart().lines.nodes[0].merchandise, id: "gid://shopify/ProductVariant/9007199254740992" } }] } }), /supported range/);
  assert.throws(() => mapShopifyCartToRazorpayMagic({ ...cart(), cost: { ...cart().cost, totalAmount: { amount: "180", currencyCode: "USD" } } }), /INR/);
});

test("validates documented Magic API responses", () => {
  assert.deepEqual(validateMagicCheckoutResponse({ shopify_checkout_id: cart().id, tax_details: { total_tax: 125, taxes_included: false } }, cart().id), {
    shopify_checkout_id: cart().id, tax_details: { total_tax: 125, taxes_included: false },
  });
  assert.throws(() => validateMagicCheckoutResponse({ shopify_checkout_id: "wrong", tax_details: {} }, cart().id), /invalid/);
  assert.equal(validateMagicOrderResponse({ order_id: "order_EKwxwAgItmmXdp", preferences: null }).order_id, "order_EKwxwAgItmmXdp");
  assert.throws(() => validateMagicOrderResponse({ order_id: "not-an-order" }), /invalid/);
});

test("server Shopify cart fetcher retrieves every cart page and rejects moving carts", async () => {
  let call = 0;
  const fetcher = createShopifyMagicCartFetcher({ storeDomain: "crystalbaaz.myshopify.com", storefrontToken: "public-token", fetchImpl: async (url, init) => {
    assert.match(url, /\/api\/2026-10\/graphql\.json$/);
    assert.equal(init.headers["X-Shopify-Storefront-Access-Token"], "public-token");
    call++;
    const id = cart().id;
    return Response.json({ data: { cart: {
      id, note: null, updatedAt: "2026-11-20T10:00:00Z", totalQuantity: 2,
      cost: cart().cost, attributes: [], discountCodes: [],
      lines: { nodes: [{ ...cart().lines.nodes[0], quantity: 1, id: `gid://shopify/CartLine/${call}` }], pageInfo: call === 1 ? { hasNextPage: true, endCursor: "cursor-1" } : { hasNextPage: false, endCursor: null } },
    } } });
  } });
  const result = await fetcher(cart().id);
  assert.equal(call, 2);
  assert.equal(result.lines.nodes.length, 2);
  const moving = createShopifyMagicCartFetcher({ storeDomain: "crystalbaaz.myshopify.com", storefrontToken: "public-token", fetchImpl: async () => {
    const n = ++call;
    const value = cart();
    return Response.json({ data: { cart: { ...value, updatedAt: `2026-11-20T10:00:0${n}Z`, lines: { nodes: [], pageInfo: { hasNextPage: true, endCursor: `c${n}` } } } } });
  } });
  await assert.rejects(moving(cart().id), /changed during checkout preparation/);
});

test("loads the Vite Magic Checkout script once and handles load failure", async () => {
  resetRazorpayMagicSdkForTests();
  const listeners = {};
  const script = { addEventListener(name, fn) { listeners[name] = fn; } };
  let appendCount = 0;
  const documentRef = { getElementById: () => null, createElement: () => script, head: { appendChild() { appendCount++; } } };
  const windowRef = {};
  const first = loadRazorpayMagicSdk({ documentRef, windowRef });
  const second = loadRazorpayMagicSdk({ documentRef, windowRef });
  assert.equal(first, second);
  assert.equal(appendCount, 1);
  assert.equal(script.src, "https://checkout.razorpay.com/v1/magic-checkout.js");
  windowRef.Razorpay = function Razorpay() {};
  listeners.load();
  assert.equal(await first, windowRef.Razorpay);
  resetRazorpayMagicSdkForTests();
  const failed = loadRazorpayMagicSdk({ documentRef: { ...documentRef, getElementById: () => null }, windowRef: {} });
  listeners.error();
  await assert.rejects(failed, /could not load/);
  resetRazorpayMagicSdkForTests();
});

test("Magic backend creates documented sessions, verifies captured payment, then completes Shopify checkout", async () => {
  const secret = "test-secret";
  const sessions = new Map(), preparations = new Map(), completions = new Map(), claims = new Set(), webhookClaims = new Set(), webhookEvents = new Map(), calls = [];
  const store = {
    async claimPreparation(fp) {
      const existing = [...sessions.values()].find(item => item.fingerprint === fp);
      if (existing) return { claimed: false, session: existing };
      if (preparations.has(fp)) return { claimed: false };
      preparations.set(fp, true); return { claimed: true };
    },
    async failPreparation(fp) { preparations.delete(fp); },
    async saveSession(session) { sessions.set(session.tokenDigest, session); preparations.delete(session.fingerprint); },
    async getSessionByTokenDigest(digest) { return sessions.get(digest) || null; },
    async getSessionByRazorpayOrderId(id) { return [...sessions.values()].find(item => item.razorpayOrderId === id) || null; },
    async getCompletion(digest) { return completions.get(digest) || null; },
    async claimCompletion(digest) { if (claims.has(digest)) return { claimed: false }; claims.add(digest); return { claimed: true }; },
    async saveCompletion(digest, value) { completions.set(digest, value); },
    async claimWebhookEvent(id) { if (webhookClaims.has(id)) return { claimed: false }; webhookClaims.add(id); return { claimed: true }; },
    async saveWebhookEvent(id, value) { webhookEvents.set(id, value); },
  };
  const paymentId = "pay_0123456789ABCD", orderId = "order_EKwxwAgItmmXdp";
  const signature = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url); calls.push({ target, init });
    if (target.pathname.endsWith("/magic/checkout/shopify")) return Response.json({ shopify_checkout_id: cart().id, tax_details: { total_tax: 0, taxes_included: true } });
    if (target.pathname.endsWith("/magic/order/shopify")) return Response.json({ order_id: orderId, preferences: null });
    if (target.pathname.endsWith(`/payments/${paymentId}`)) return Response.json({ id: paymentId, order_id: orderId, status: "captured", currency: "INR", amount: 18000 });
    if (target.pathname.endsWith("/1cc/shopify/complete")) return Response.json({ id: 12345, order_id: "#123", payment_id: paymentId, payment_currency: "INR", total_amount: 18000, payment_method: "upi", order_status_url: "https://crystalbaaz.myshopify.com/orders/123" });
    throw new Error(`Unexpected test URL ${target.pathname}`);
  };
  const backend = createRazorpayMagicBackend({
    config: { enabled: true, authorized: true, mode: "test", testModeSupported: true, keyId: "rzp_test_key", keySecret: secret, webhookSecret: "hook-secret", shopDomain: "crystalbaaz.myshopify.com" },
    fetchShopifyCart: async id => id === cart().id ? cart() : null,
    fetchImpl,
    store,
  });
  const prepared = await backend.prepareCheckout({ shopifyCartId: cart().id });
  assert.equal(prepared.order_id, orderId);
  assert.equal(calls[0].target.searchParams.get("key_id"), "rzp_test_key");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  await assert.rejects(backend.completeCheckout({ checkoutToken: prepared.checkoutToken, razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: "0".repeat(64) }), /signature is invalid/);
  const webhookBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: orderId } } } });
  const webhookSignature = createHmac("sha256", "hook-secret").update(webhookBody).digest("hex");
  assert.equal((await backend.handleWebhook({ rawBody: webhookBody, signature: webhookSignature, eventId: "evt_123" })).response.verified, true);
  assert.equal(webhookEvents.get("evt_123").state, "completed");
  const confirmed = await backend.completeCheckout({ checkoutToken: prepared.checkoutToken, razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: signature });
  assert.equal(confirmed.verified, true);
  assert.equal(confirmed.order.total_amount, 18000);
  assert.equal(calls.at(-1).target.pathname, "/v1/1cc/shopify/complete");
  assert.equal((await backend.completeCheckout({ checkoutToken: prepared.checkoutToken, razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: signature })).order.order_number, "#123");
});

test("Magic backend stays disabled without merchant authorization or explicit test support", async () => {
  const backend = createRazorpayMagicBackend({ config: { enabled: true, authorized: true, mode: "test", testModeSupported: false, keyId: "rzp_test_key", keySecret: "secret", shopDomain: "crystalbaaz.myshopify.com" }, fetchShopifyCart: async () => cart(), store: {} });
  await assert.rejects(backend.prepareCheckout({ shopifyCartId: cart().id }), /disabled or merchant authorization/);
});

test("Magic backend rejects missing server credentials before reading a cart or calling Razorpay", async () => {
  let cartReads = 0, upstreamCalls = 0;
  const backend = createRazorpayMagicBackend({
    config: { enabled: true, authorized: true, mode: "live", keyId: "", keySecret: "", shopDomain: "crystalbaaz.myshopify.com" },
    fetchShopifyCart: async () => { cartReads++; return cart(); },
    fetchImpl: async () => { upstreamCalls++; throw new Error("unexpected upstream request"); },
    store: {},
  });
  await assert.rejects(backend.prepareCheckout({ shopifyCartId: cart().id }), /server configuration is incomplete/);
  assert.equal(cartReads, 0);
  assert.equal(upstreamCalls, 0);
});

test("frontend SDK flow calls backend and redirects only after verified completion", async () => {
  resetRazorpayMagicSdkForTests();
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return Response.json(url.endsWith("/prepare") ? { checkoutToken: "opaque-token", order_id: "order_123abc" } : { verified: true, order: { order_status_url: "https://crystalbaaz.myshopify.com/orders/8" } });
  };
  let options;
  class MockRazorpay { constructor(value) { options = value; } on() {} open() { void options.handler({ razorpay_payment_id: "pay_123abc", razorpay_order_id: "order_123abc", razorpay_signature: "signature" }); } }
  const result = await startRazorpayMagicCheckout({
    backendUrl: "https://backend.example", keyId: "rzp_test_key", shopifyCartId: cart().id, cart: mapShopifyCartToRazorpayMagic(cart()),
    storeDomain: "crystalbaaz.myshopify.com", fetchImpl, windowRef: { Razorpay: MockRazorpay }, sdkLoader: async () => MockRazorpay,
  });
  assert.equal(result.orderStatusUrl, "https://crystalbaaz.myshopify.com/orders/8");
  assert.deepEqual(requests.map(item => item.url), ["https://backend.example/api/razorpay/magic/prepare", "https://backend.example/api/razorpay/magic/complete"]);
  assert.equal(options.order_id, "order_123abc");
  assert.equal(options.prefill.coupon_code, "SAVE10");
  assert.equal(verifyRazorpayMagicSignature({ orderId: "order_123abc", paymentId: "pay_123abc", signature: createHmac("sha256", "s").update("order_123abc|pay_123abc").digest("hex"), secret: "s" }), true);
});

test("Magic Checkout cancellation and payment failure do not call the completion endpoint", async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return Response.json({ checkoutToken: "opaque-token", order_id: "order_123abc" });
  };
  const base = { backendUrl: "https://backend.example", keyId: "rzp_test_key", shopifyCartId: cart().id, cart: mapShopifyCartToRazorpayMagic(cart()), storeDomain: "crystalbaaz.myshopify.com", fetchImpl, sdkLoader: async () => class {} };
  let failure;
  class FailedCheckout {
    constructor() {}
    on(name, callback) { assert.equal(name, "payment.failed"); failure = callback; }
    open() { failure({}); }
  }
  await assert.rejects(startRazorpayMagicCheckout({ ...base, sdkLoader: async () => FailedCheckout }), /Payment was not completed/);
  let modalOptions;
  class DismissedCheckout {
    constructor(options) { modalOptions = options; }
    on() {}
    open() { modalOptions.modal.ondismiss(); }
  }
  assert.deepEqual(await startRazorpayMagicCheckout({ ...base, sdkLoader: async () => DismissedCheckout }), { cancelled: true });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.endsWith("/prepare")));
});
