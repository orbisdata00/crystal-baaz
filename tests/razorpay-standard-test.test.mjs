import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRazorpayStandardTestBackend, inrToPaise, verifyStandardCheckoutSignature } from "../backend/razorpay-standard-test.js";

const cart = { id: "gid://shopify/Cart/abc?key=cartkey", totalQuantity: 1, cost: { subtotalAmount: { amount: "1250.50", currencyCode: "INR" }, totalAmount: { amount: "1250.50", currencyCode: "INR" } }, attributes: [], discountCodes: [], lines: { nodes: [{ quantity: 1, attributes: [], cost: { amountPerQuantity: { amount: "1250.50", currencyCode: "INR" }, subtotalAmount: { amount: "1250.50", currencyCode: "INR" }, totalAmount: { amount: "1250.50", currencyCode: "INR" } }, merchandise: { id: "gid://shopify/ProductVariant/12", title: "One size", image: { url: "https://cdn.shopify.com/test.jpg" }, product: { id: "gid://shopify/Product/34", title: "Crystal Bracelet" }, availableForSale: true } }] } };
const config = { enabled: true, mode: "test", keyId: "rzp_test_example", keySecret: "private-test-secret" };
const makeStore = () => {
  const orders = new Map();
  return { orders, saveStandardTestOrder: async order => orders.set(order.id, order), getStandardTestOrder: async id => orders.get(id), getStandardTestOrderByReference: async reference => [...orders.values()].find(order => order.reference === reference), saveStandardTestVerification: async (id, value) => orders.set(id, { ...orders.get(id), ...value }) };
};
const signature = (orderId, paymentId) => createHmac("sha256", config.keySecret).update(`${orderId}|${paymentId}`).digest("hex");

test("INR decimal to paise conversion avoids floating point math", () => {
  assert.equal(inrToPaise("1250.50"), 125050);
  assert.throws(() => inrToPaise("1.001"));
  assert.throws(() => inrToPaise("0.50"));
});

test("test backend creates a server-priced order and verifies captured payment", async () => {
  const store = makeStore();
  const requests = [];
  const backend = createRazorpayStandardTestBackend({ config, fetchShopifyCart: async id => ({ ...cart, id }), store, fetchImpl: async (url, options = {}) => {
    requests.push({ url, options });
    const payload = url.endsWith("/orders") ? { id: "order_test123", amount: 125050, currency: "INR", status: "created" } : { id: "pay_test456", order_id: "order_test123", amount: 125050, currency: "INR", status: "captured" };
    return { ok: true, json: async () => payload };
  } });
  const order = await backend.createOrder({ shopifyCartId: cart.id });
  assert.equal(order.amount, 125050);
  assert.match(order.reference, /^CBT-/);
  assert.equal(order.keyId, config.keyId);
  assert.match(requests[0].url, /api\.razorpay\.com\/v1\/orders$/);
  assert.match(requests[0].options.headers.Authorization, /^Basic /);
  const verified = await backend.verifyPayment({ razorpay_order_id: order.id, razorpay_payment_id: "pay_test456", razorpay_signature: signature(order.id, "pay_test456") });
  assert.equal(verified.verified, true);
  assert.equal(verified.reference, order.reference);
  assert.match(verified.accessToken, /^[a-f\d]{64}$/);
  assert.equal(requests[1].url, "https://api.razorpay.com/v1/payments/pay_test456");
  assert.equal(store.orders.get(order.id).verifiedPaymentId, "pay_test456");
  const record = await backend.getOrder({ reference: order.reference, accessToken: verified.accessToken });
  assert.equal(record.items[0].productTitle, "Crystal Bracelet");
  assert.equal(record.items[0].variantTitle, "One size");
  assert.equal(record.items[0].quantity, 1);
  assert.equal(record.shopifyOrderCreated, false);
  await assert.rejects(backend.getOrder({ reference: order.reference, accessToken: "0".repeat(64) }));
  assert.deepEqual(await backend.getOrder({ reference: order.reference, accessToken: verified.accessToken }), record);
});

test("verification rejects unknown orders, bad signatures, amount/currency/status mismatch", async () => {
  const store = makeStore();
  await store.saveStandardTestOrder({ id: "order_test123", amount: 125050, currency: "INR", verifiedPaymentId: null });
  let payment = { id: "pay_test456", order_id: "order_test123", amount: 125050, currency: "INR", status: "captured" };
  const backend = createRazorpayStandardTestBackend({ config, fetchShopifyCart: async () => cart, store, fetchImpl: async () => ({ ok: true, json: async () => payment }) });
  await assert.rejects(backend.verifyPayment({ razorpay_order_id: "order_other", razorpay_payment_id: "pay_test456", razorpay_signature: signature("order_other", "pay_test456") }));
  await assert.rejects(backend.verifyPayment({ razorpay_order_id: "order_test123", razorpay_payment_id: "pay_test456", razorpay_signature: "0".repeat(64) }));
  for (const altered of [{ amount: 100 }, { currency: "USD" }, { status: "authorized" }]) {
    payment = { id: "pay_test456", order_id: "order_test123", amount: 125050, currency: "INR", status: "captured", ...altered };
    await assert.rejects(backend.verifyPayment({ razorpay_order_id: "order_test123", razorpay_payment_id: "pay_test456", razorpay_signature: signature("order_test123", "pay_test456") }));
  }
});

test("test checkout fails closed unless explicitly enabled with rzp_test credentials", async () => {
  for (const blockedConfig of [{ ...config, enabled: false }, { ...config, mode: "live" }, { ...config, keyId: "rzp_live_example" }]) {
    const backend = createRazorpayStandardTestBackend({ config: blockedConfig, fetchShopifyCart: async () => cart, store: makeStore() });
    await assert.rejects(backend.createOrder({ shopifyCartId: cart.id }), /disabled/);
  }
  assert.equal(verifyStandardCheckoutSignature({ orderId: "order_1", paymentId: "pay_1", signature: signature("order_1", "pay_1"), secret: config.keySecret }), true);
});
