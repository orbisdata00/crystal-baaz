import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mapShopifyCartToRazorpayMagic } from "../src/razorpay-magic-cart.js";

const API = "https://api.razorpay.com/v1";
const text = value => typeof value === "string" && value.length > 0;

export function inrToPaise(amount) {
  if (typeof amount !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("Shopify cart amount is invalid.");
  const [rupees, fraction = ""] = amount.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise < 100) throw new Error("Razorpay test orders must total at least ₹1.");
  return paise;
}

export function verifyStandardCheckoutSignature({ orderId, paymentId, signature, secret }) {
  if (![orderId, paymentId, signature, secret].every(text) || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Test-only Standard Checkout adapter. It never creates or mutates a Shopify order. */
export function createRazorpayStandardTestBackend({ config = {}, fetchShopifyCart, fetchImpl = globalThis.fetch, store } = {}) {
  const requireReady = () => {
    if (config.enabled !== true || config.mode !== "test" || !/^rzp_test_/.test(config.keyId || "") || !text(config.keySecret)) throw new Error("Razorpay Standard test checkout is disabled or not configured with test credentials.");
    if (typeof fetchShopifyCart !== "function" || typeof fetchImpl !== "function" || typeof store?.saveStandardTestOrder !== "function" || typeof store?.getStandardTestOrder !== "function" || typeof store?.getStandardTestOrderByReference !== "function" || typeof store?.saveStandardTestVerification !== "function") throw new Error("Razorpay Standard test checkout service is unavailable.");
  };
  const auth = () => `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
  async function api(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${API}${path}`, { method, headers: { Authorization: auth(), Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let payload;
    try { payload = await response.json(); } catch { throw new Error("Razorpay test API returned an invalid response."); }
    if (!response.ok) throw new Error("Razorpay rejected the test checkout request.");
    return payload;
  }
  return Object.freeze({
    async createOrder({ shopifyCartId } = {}) {
      requireReady();
      if (typeof shopifyCartId !== "string" || !shopifyCartId.startsWith("gid://shopify/Cart/")) throw new Error("A Shopify cart is required.");
      const cart = await fetchShopifyCart(shopifyCartId);
      if (!cart || cart.id !== shopifyCartId) throw new Error("The Shopify cart could not be confirmed.");
      const mapped = mapShopifyCartToRazorpayMagic(cart);
      const amount = inrToPaise(mapped.total);
      const reference = `CBT-${randomUUID()}`;
      const receipt = `cb-test-${randomUUID()}`;
      const order = await api("/orders", { method: "POST", body: { amount, currency: "INR", receipt, notes: { purpose: "Crystal Baaz local test payment; no Shopify order" } } });
      if (!/^order_[A-Za-z0-9]+$/.test(order?.id || "") || order.amount !== amount || order.currency !== "INR" || order.status !== "created") throw new Error("Razorpay returned an invalid test order.");
      const items = (cart.lines?.nodes || []).map(line => ({
        productTitle: line.merchandise?.product?.title || "Product",
        variantTitle: line.merchandise?.title || "Default",
        variantId: line.merchandise?.id || "",
        image: typeof line.merchandise?.image?.url === "string" && line.merchandise.image.url.startsWith("https://") ? line.merchandise.image.url : "",
        quantity: line.quantity,
        unitAmount: line.cost?.amountPerQuantity?.amount || "0",
        lineAmount: line.cost?.totalAmount?.amount || "0",
        currency: "INR",
      }));
      await store.saveStandardTestOrder({ id: order.id, reference, amount, currency: "INR", receipt, items, createdAt: Date.now(), verifiedPaymentId: null });
      return { id: order.id, reference, amount, currency: "INR", keyId: config.keyId };
    },
    async verifyPayment({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = {}) {
      requireReady();
      if (!/^order_[A-Za-z0-9]+$/.test(orderId || "") || !/^pay_[A-Za-z0-9]+$/.test(paymentId || "") || !text(signature)) throw new Error("Razorpay payment response is invalid.");
      const order = await store.getStandardTestOrder(orderId);
      if (!order) throw new Error("This test payment order was not created by this local service.");
      if (!verifyStandardCheckoutSignature({ orderId, paymentId, signature, secret: config.keySecret })) throw new Error("Razorpay payment signature could not be verified.");
      const payment = await api(`/payments/${encodeURIComponent(paymentId)}`);
      if (payment?.id !== paymentId || payment.order_id !== orderId || payment.amount !== order.amount || payment.currency !== "INR" || payment.status !== "captured") throw new Error("Razorpay has not confirmed a captured payment for this test order.");
      if (order.verifiedPaymentId && order.verifiedPaymentId !== paymentId) throw new Error("This test order is already linked to a different payment.");
      await store.saveStandardTestVerification(orderId, { verifiedPaymentId: paymentId, verifiedAt: order.verifiedAt || Date.now() });
      const verifiedOrder = await store.getStandardTestOrder(orderId);
      const accessToken = createHmac("sha256", config.keySecret).update(`test-order-access:${verifiedOrder.reference}:${paymentId}`).digest("hex");
      return { verified: true, mode: "test", paymentId, orderId, reference: verifiedOrder.reference, accessToken, amount: payment.amount, currency: payment.currency, status: payment.status, shopifyOrderCreated: false };
    },
    async getOrder({ reference, accessToken } = {}) {
      requireReady();
      if (typeof reference !== "string" || !/^CBT-[\da-f-]{36}$/i.test(reference) || typeof accessToken !== "string" || !/^[a-f\d]{64}$/i.test(accessToken)) throw new Error("Test order is unavailable.");
      const order = await store.getStandardTestOrderByReference(reference);
      if (!order?.verifiedPaymentId || !order.verifiedAt) throw new Error("Test order is unavailable.");
      const expected = createHmac("sha256", config.keySecret).update(`test-order-access:${reference}:${order.verifiedPaymentId}`).digest();
      const actual = Buffer.from(accessToken, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Test order is unavailable.");
      return { reference, mode: "test", paymentId: order.verifiedPaymentId, orderId: order.id, amount: order.amount, currency: order.currency, status: "captured", createdAt: order.verifiedAt, items: order.items, shopifyOrderCreated: false };
    },
  });
}
