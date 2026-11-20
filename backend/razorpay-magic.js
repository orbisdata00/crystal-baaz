import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mapShopifyCartToRazorpayMagic, validateMagicCheckoutResponse, validateMagicOrderResponse } from "../src/razorpay-magic-cart.js";

const API = "https://api.razorpay.com/v1";
const text = value => typeof value === "string" && value.length > 0;
const tokenDigest = token => createHash("sha256").update(token).digest("hex");

export function readRazorpayMagicServerConfig(env = process.env) {
  return {
    enabled: env.RAZORPAY_MAGIC_ENABLED === "true",
    authorized: env.RAZORPAY_MAGIC_AUTHORIZED === "true",
    testModeSupported: env.RAZORPAY_MAGIC_TEST_MODE_SUPPORTED === "true",
    mode: env.RAZORPAY_MODE === "live" ? "live" : "test",
    keyId: env.RAZORPAY_KEY_ID || "",
    keySecret: env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || "",
    shopDomain: env.SHOPIFY_STORE_DOMAIN || "crystalbaaz.myshopify.com",
  };
}

export function createShopifyMagicCartFetcher({ storeDomain, storefrontToken, apiVersion = "2026-10", fetchImpl = globalThis.fetch } = {}) {
  if (!text(storeDomain) || !text(storefrontToken) || !/^\d{4}-\d{2}$/.test(apiVersion) || typeof fetchImpl !== "function") throw new Error("Server-side Shopify Storefront configuration is incomplete.");
  const domain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return async function fetchShopifyCart(cartId) {
    if (typeof cartId !== "string" || !cartId.startsWith("gid://shopify/Cart/")) throw new Error("A Shopify cart ID is required.");
    const query = `query RazorpayMagicCart($id: ID!, $after: String) {
      cart(id: $id) {
        id note updatedAt totalQuantity attributes { key value }
        cost { subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
        discountCodes { code applicable }
        lines(first: 100, after: $after) {
          nodes { id quantity attributes { key value }
            cost { amountPerQuantity { amount currencyCode } subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
            merchandise { ... on ProductVariant { id title availableForSale image { url altText } product { id title } } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`;
    const lines = [];
    let after = null, cart = null;
    do {
      const response = await fetchImpl(`https://${domain}/api/${apiVersion}/graphql.json`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
        body: JSON.stringify({ query, variables: { id: cartId, after } }),
      });
      if (!response.ok) throw new Error("Shopify cart verification failed.");
      const result = await response.json();
      if (result.errors?.length || !result.data?.cart) throw new Error("Shopify cart verification failed.");
      const page = result.data.cart;
      if (!cart) cart = { ...page, lines: undefined };
      else if (page.id !== cart.id || page.updatedAt !== cart.updatedAt || page.totalQuantity !== cart.totalQuantity) throw new Error("The Shopify cart changed during checkout preparation.");
      lines.push(...(page.lines?.nodes || []));
      if (!page.lines?.pageInfo?.hasNextPage) break;
      if (!page.lines.pageInfo.endCursor || page.lines.pageInfo.endCursor === after) throw new Error("Shopify cart pagination is incomplete.");
      after = page.lines.pageInfo.endCursor;
    } while (true);
    if (!cart || lines.reduce((sum, line) => sum + line.quantity, 0) !== cart.totalQuantity) throw new Error("The complete Shopify cart could not be verified.");
    return { ...cart, lines: { nodes: lines, pageInfo: { hasNextPage: false, endCursor: null } } };
  };
}

export function verifyRazorpayMagicSignature({ orderId, paymentId, signature, secret }) {
  if (![orderId, paymentId, signature, secret].every(text) || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyRazorpayWebhookSignature({ rawBody, signature, secret }) {
  if (typeof rawBody !== "string" || !text(signature) || !text(secret) || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Server-only API and completion service. The persistent store must provide atomic/idempotent methods. */
export function createRazorpayMagicBackend({ config = {}, fetchShopifyCart, fetchImpl = globalThis.fetch, store } = {}) {
  const enabled = config.enabled === true && config.authorized === true &&
    (config.mode === "live" || (config.mode === "test" && config.testModeSupported === true));
  const requireReady = () => {
    if (!enabled) throw new Error("Razorpay Magic Checkout is disabled or merchant authorization is incomplete.");
    if (!text(config.keyId) || !text(config.keySecret) || !text(config.shopDomain)) throw new Error("Razorpay Magic server configuration is incomplete.");
    if (typeof fetchShopifyCart !== "function" || typeof fetchImpl !== "function") throw new Error("Razorpay Magic server adapters are unavailable.");
    for (const method of ["claimPreparation", "failPreparation", "saveSession", "getSessionByTokenDigest", "getSessionByRazorpayOrderId", "claimCompletion", "saveCompletion", "getCompletion", "claimWebhookEvent", "saveWebhookEvent"]) {
      if (typeof store?.[method] !== "function") throw new Error(`Persistent Razorpay checkout storage is required: ${method}.`);
    }
  };

  async function callMagic(path, body) {
    const url = new URL(`${API}${path}`);
    url.searchParams.set("key_id", config.keyId);
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (path === "/magic/order/shopify") headers.Origin = "https://api.razorpay.com";
    const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body) });
    let payload;
    try { payload = await response.json(); } catch { throw new Error("Razorpay Magic API returned an invalid response."); }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Razorpay Magic merchant authorization failed." : "Razorpay Magic checkout request failed.");
    return payload;
  }

  async function prepareCheckout({ shopifyCartId }) {
    requireReady();
    if (typeof shopifyCartId !== "string" || !shopifyCartId.startsWith("gid://shopify/Cart/")) throw new Error("A Shopify cart is required.");
    const cart = await fetchShopifyCart(shopifyCartId);
    if (!cart || cart.id !== shopifyCartId) throw new Error("The Shopify cart could not be confirmed.");
    const mapped = mapShopifyCartToRazorpayMagic(cart);
    const fingerprint = createHash("sha256").update(JSON.stringify({ cart: mapped.cart, subtotal: mapped.subtotal, total: mapped.total, discounts: mapped.discountCodes })).digest("hex");
    const claim = await store.claimPreparation(fingerprint);
    if (!claim?.claimed) {
      const existing = claim?.session;
      if (existing?.state === "prepared" && existing.expiresAt > Date.now() && text(existing.checkoutToken)) return { checkoutToken: existing.checkoutToken, order_id: existing.razorpayOrderId };
      throw new Error("Razorpay checkout preparation is already being reconciled.");
    }
    try {
      const checkoutPayload = await callMagic("/magic/checkout/shopify", { cart: mapped.cart });
      const checkout = validateMagicCheckoutResponse(checkoutPayload, cart.id);
      const orderPayload = await callMagic("/magic/order/shopify", { shopify_checkout_id: checkout.shopify_checkout_id });
      const order = validateMagicOrderResponse(orderPayload);
      const checkoutToken = randomBytes(32).toString("base64url");
      const session = {
        tokenDigest: tokenDigest(checkoutToken), checkoutToken, fingerprint, shopifyCartId, shopifyCheckoutId: checkout.shopify_checkout_id,
        razorpayOrderId: order.order_id, taxDetails: checkout.tax_details, currency: mapped.currency,
        cartTotal: mapped.total, state: "prepared", expiresAt: Date.now() + 30 * 60 * 1000,
      };
      await store.saveSession(session);
      return { checkoutToken, order_id: order.order_id };
    } catch (error) {
      await store.failPreparation(fingerprint, { state: "retryable" });
      throw error;
    }
  }

  async function fetchPayment(paymentId) {
    const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
    const response = await fetchImpl(`${API}/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
    let payment;
    try { payment = await response.json(); } catch { throw new Error("Payment status could not be verified."); }
    if (!response.ok) throw new Error("Payment status could not be verified.");
    return payment;
  }

  async function finalizePayment({ session, digest, paymentId, orderId }) {
    const existing = await store.getCompletion(digest);
    if (existing?.verified === true) {
      if (existing.paymentId !== paymentId || existing.orderId !== orderId) throw new Error("This checkout session is already reconciled to a different payment.");
      return existing.response;
    }
    const payment = await fetchPayment(paymentId);
    if (payment.id !== paymentId || payment.order_id !== session.razorpayOrderId || payment.status !== "captured" || payment.currency !== "INR" || !Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
      throw new Error("Razorpay payment is not captured for the expected order and currency.");
    }
    const claim = await store.claimCompletion(digest, { paymentId, orderId });
    if (!claim?.claimed) {
      const completion = await store.getCompletion(digest);
      if (completion?.verified === true) return completion.response;
      throw new Error("Order completion is being reconciled. Do not retry payment.");
    }

    const completed = await callMagic("/1cc/shopify/complete", { razorpay_payment_id: paymentId, razorpay_order_id: orderId });
    const expectedHost = String(config.shopDomain).toLowerCase();
    let statusUrl;
    try { statusUrl = new URL(completed.order_status_url); } catch { throw new Error("Shopify order confirmation response is incomplete."); }
    if (!Number.isSafeInteger(completed.id) || typeof completed.order_id !== "string" || completed.payment_id !== paymentId ||
        completed.payment_currency !== payment.currency || completed.total_amount !== payment.amount ||
        statusUrl.protocol !== "https:" || statusUrl.hostname.toLowerCase() !== expectedHost ||
        !/^#?\d+$/.test(completed.order_id)) throw new Error("Shopify order and captured payment could not be reconciled.");
    const response = {
      verified: true,
      order: {
        id: completed.id,
        order_number: completed.order_id,
        payment_method: typeof completed.payment_method === "string" ? completed.payment_method : null,
        payment_currency: completed.payment_currency,
        total_amount: completed.total_amount,
        order_status_url: statusUrl.href,
      },
    };
    await store.saveCompletion(digest, { verified: true, paymentId, orderId, response });
    return response;
  }

  async function completeCheckout({ checkoutToken, razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: signature }) {
    requireReady();
    if (!text(checkoutToken) || !/^pay_[A-Za-z0-9]+$/.test(paymentId || "") || !/^order_[A-Za-z0-9]+$/.test(orderId || "")) throw new Error("Razorpay payment response is invalid.");
    const digest = tokenDigest(checkoutToken);
    const session = await store.getSessionByTokenDigest(digest);
    if (!session || session.expiresAt <= Date.now() || session.razorpayOrderId !== orderId) throw new Error("Razorpay checkout session could not be verified.");
    if (!verifyRazorpayMagicSignature({ orderId: session.razorpayOrderId, paymentId, signature, secret: config.keySecret })) throw new Error("Razorpay payment signature is invalid.");
    return finalizePayment({ session, digest, paymentId, orderId });
  }

  async function handleWebhook({ rawBody, signature, eventId }) {
    requireReady();
    if (!text(config.webhookSecret) || !verifyRazorpayWebhookSignature({ rawBody, signature, secret: config.webhookSecret })) throw new Error("Razorpay webhook signature is invalid.");
    if (!text(eventId)) throw new Error("Razorpay webhook event ID is missing.");
    const claim = await store.claimWebhookEvent(eventId);
    if (!claim?.claimed) return { accepted: true, duplicate: true };
    let event;
    try { event = JSON.parse(rawBody); } catch { throw new Error("Razorpay webhook body is invalid."); }
    if (event?.event !== "payment.captured") {
      await store.saveWebhookEvent(eventId, { state: "ignored", eventType: event?.event || "unknown" });
      return { accepted: true, ignored: true };
    }
    const entity = event?.payload?.payment?.entity;
    const paymentId = entity?.id;
    const orderId = entity?.order_id;
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId || "") || !/^order_[A-Za-z0-9]+$/.test(orderId || "")) throw new Error("Captured payment webhook is missing its payment reference.");
    const session = await store.getSessionByRazorpayOrderId(orderId);
    if (!session || session.expiresAt <= Date.now()) {
      await store.saveWebhookEvent(eventId, { state: "unmatched", eventType: event.event, orderId, paymentId });
      return { accepted: true, pending: true };
    }
    const digest = session.tokenDigest;
    const response = await finalizePayment({ session, digest, paymentId, orderId });
    await store.saveWebhookEvent(eventId, { state: "completed", eventType: event.event, orderId, paymentId });
    return { accepted: true, duplicate: false, response };
  }

  return Object.freeze({ prepareCheckout, completeCheckout, handleWebhook });
}
