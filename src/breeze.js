import BlazeSDK from "@juspay/blaze-sdk-web";
import { shopifyConfig } from "./config.js";

const SERVICE = "in.breeze.onecco";
const initializations = new WeakMap();
let sequence = 0;
let activeProcess = false;
const requestId = (prefix = "cb") => `${prefix}-${Date.now()}-${++sequence}`;

/** @typedef {{merchantId:string, shopUrl:string, environment:'sandbox'|'production', requestId:string, service:string, payload:object}} BreezeInitPayload */
/** @typedef {(payload:Record<string, unknown>)=>void} BreezeCallback */

export function createBreezeInitPayload(config = shopifyConfig.breeze, id = requestId("init")) {
  if (!config.merchantId || !config.shopUrl) throw new Error("Breeze merchant setup is incomplete.");
  if (config.environment === "production" && !config.productionApproved) throw new Error("Breeze production checkout is not approved.");
  const shopUrl = new URL(config.shopUrl);
  if (shopUrl.protocol !== "https:") throw new Error("Breeze shop URL must use HTTPS.");
  return { requestId: id, service: SERVICE, payload: { merchantId: config.merchantId, shopUrl: shopUrl.href.replace(/\/$/, ""), environment: config.environment } };
}

/** SDK wrapper. Process payloads are accepted only from the configured backend's approved Breeze adapter. */
export function createBreezeSdk({ sdk = BlazeSDK, config = shopifyConfig.breeze } = {}) {
  return {
    initialize(callback = () => {}) {
      if (!config.enabled) throw new Error("Breeze checkout is disabled.");
      if (initializations.has(sdk)) return initializations.get(sdk);
      const payload = createBreezeInitPayload(config);
      const pending = Promise.resolve().then(() => new Promise((resolve, reject) => {
        try {
          sdk.initiate(payload, (event) => {
            callback(event);
            const body = event?.payload;
            if (body?.eventName === "initiate" && body?.status === "SUCCESS") resolve(event);
            else if (body?.eventName === "initiate" && body?.status === "FAILURE") { initializations.delete(sdk); reject(new Error("Breeze SDK initialization failed.")); }
            if (body?.eventName === "process") activeProcess = false;
          });
        } catch (error) { initializations.delete(sdk); reject(error); }
      }));
      initializations.set(sdk, pending);
      return pending;
    },
    async process(approvedProcessPayload, callback = () => {}) {
      if (!approvedProcessPayload || typeof approvedProcessPayload !== "object" || !approvedProcessPayload.requestId || approvedProcessPayload.service !== SERVICE || !approvedProcessPayload.payload || typeof approvedProcessPayload.payload !== "object") {
        throw new Error("Breeze checkout session is unavailable or invalid.");
      }
      if (activeProcess) throw new Error("Breeze checkout is already in progress.");
      await this.initialize(callback);
      activeProcess = true;
      try {
        sdk.process(approvedProcessPayload);
      }
      catch (error) { activeProcess = false; throw error; }
    },
    finishProcess() { activeProcess = false; },
  };
}

/** Maps authoritative Shopify Cart API data into a transport-safe intent, not a Breeze-specific signed cart. */
export function mapShopifyCartIntent(cart) {
  if (!cart?.id?.startsWith("gid://shopify/Cart/") || !Array.isArray(cart.lines?.nodes)) throw new Error("A confirmed Shopify cart is required.");
  const lines = cart.lines.nodes.map(line => {
    const variantId = line.merchandise?.id;
    if (!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(variantId || "") || !Number.isInteger(line.quantity) || line.quantity < 1) throw new Error("The Shopify cart contains an invalid item.");
    return { variantId, quantity: line.quantity };
  });
  const total = cart.cost?.totalAmount;
  if (!lines.length || !total || !Number.isFinite(Number(total.amount)) || Number(total.amount) < 0 || total.currencyCode !== "INR") throw new Error("The Shopify cart total is not confirmed in INR.");
  return { shopifyCartId: cart.id, lines, total: { amount: String(total.amount), currencyCode: total.currencyCode } };
}

/** Calls the storefront's own backend boundary. It cannot initiate a payment without a backend-provided documented process payload. */
export async function prepareBreezeCheckout({ cart, config = shopifyConfig.breeze, backendUrl = config.backendUrl, fetchImpl = fetch, sdk = createBreezeSdk({ config }) } = {}) {
  if (!config.enabled) throw new Error("Breeze checkout is disabled.");
  if (!backendUrl) throw new Error("Secure Breeze checkout backend is not configured.");
  const intent = mapShopifyCartIntent(cart);
  const response = await fetchImpl(new URL("/api/breeze/checkout-sessions", backendUrl), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent),
  });
  if (!response.ok) throw new Error("Breeze checkout session could not be prepared.");
  const { processPayload } = await response.json();
  await sdk.process(processPayload);
}
