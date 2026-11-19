const SCRIPT_ID = "razorpay-magic-checkout-sdk";
const SCRIPT_SRC = "https://checkout.razorpay.com/v1/magic-checkout.js";
let scriptPromise = null;
let activeCheckout = false;

export function loadRazorpayMagicSdk({ documentRef = globalThis.document, windowRef = globalThis.window, timeoutMs = 15000 } = {}) {
  if (windowRef?.Razorpay) return Promise.resolve(windowRef.Razorpay);
  if (!documentRef) return Promise.reject(new Error("Razorpay Magic Checkout is unavailable in this environment."));
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = documentRef.getElementById(SCRIPT_ID);
    const script = existing || documentRef.createElement("script");
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { scriptPromise = null; script.remove?.(); reject(error); return; }
      if (!windowRef?.Razorpay) { scriptPromise = null; script.remove?.(); reject(new Error("Razorpay Magic Checkout SDK did not initialize.")); return; }
      resolve(windowRef.Razorpay);
    };
    const timer = setTimeout(() => finish(new Error("Razorpay Magic Checkout could not load. Please retry.")), timeoutMs);
    script.addEventListener("load", () => finish(), { once: true });
    script.addEventListener("error", () => finish(new Error("Razorpay Magic Checkout could not load. Please retry.")), { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      documentRef.head.appendChild(script);
    }
  });
  return scriptPromise;
}

async function postJson(baseUrl, path, body, fetchImpl) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit",
  });
  let result;
  try { result = await response.json(); } catch { throw new Error("Razorpay checkout service returned an invalid response."); }
  if (!response.ok) throw new Error(typeof result?.message === "string" ? result.message : "Razorpay checkout could not be prepared.");
  return result;
}

export async function startRazorpayMagicCheckout({ backendUrl, keyId, shopifyCartId, cart, customer = {}, storeDomain, fetchImpl = globalThis.fetch, windowRef = globalThis.window, sdkLoader = loadRazorpayMagicSdk }) {
  if (activeCheckout) throw new Error("A Razorpay checkout is already in progress.");
  if (!backendUrl || !keyId || !shopifyCartId || !cart?.cart?.items?.length || typeof fetchImpl !== "function") throw new Error("Razorpay Magic Checkout configuration is incomplete.");
  activeCheckout = true;
  try {
    const Razorpay = await sdkLoader({ windowRef });
    const session = await postJson(backendUrl, "/api/razorpay/magic/prepare", { shopifyCartId }, fetchImpl);
    if (typeof session.checkoutToken !== "string" || !/^order_[A-Za-z0-9]+$/.test(session.order_id)) throw new Error("Razorpay checkout session response is invalid.");
    const coupon = cart.discountCodes.length === 1 ? cart.discountCodes[0] : undefined;
    return await new Promise((resolve, reject) => {
      let completed = false;
      const instance = new Razorpay({
        key: keyId,
        name: "Crystal Baaz",
        order_id: session.order_id,
        show_coupons: true,
        prefill: {
          ...(typeof customer.name === "string" && customer.name ? { name: customer.name } : {}),
          ...(typeof customer.email === "string" && customer.email ? { email: customer.email } : {}),
          ...(typeof customer.phone === "string" && customer.phone ? { contact: customer.phone } : {}),
          ...(coupon ? { coupon_code: coupon } : {}),
        },
        theme: { color: "#631c24" },
        handler: async response => {
          if (completed) return;
          completed = true;
          try {
            const result = await postJson(backendUrl, "/api/razorpay/magic/complete", {
              checkoutToken: session.checkoutToken,
              razorpay_payment_id: response?.razorpay_payment_id,
              razorpay_order_id: response?.razorpay_order_id,
              razorpay_signature: response?.razorpay_signature,
            }, fetchImpl);
            if (result?.verified !== true || !result.order?.order_status_url) throw new Error("Payment or Shopify order is still being verified. Please contact support before retrying payment.");
            const target = new URL(result.order.order_status_url);
            const allowedDomain = String(storeDomain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
            if (target.protocol !== "https:" || target.hostname.toLowerCase() !== allowedDomain || target.username || target.password) throw new Error("The verified order destination is invalid.");
            resolve({ order: result.order, orderStatusUrl: target.href });
          } catch (error) { reject(error); }
        },
        modal: { ondismiss: () => { if (!completed) { completed = true; resolve({ cancelled: true }); } } },
      });
      if (typeof instance.on === "function") instance.on("payment.failed", () => {
        if (!completed) { completed = true; reject(new Error("Payment was not completed. Your cart remains unchanged.")); }
      });
      instance.open();
    });
  } finally { activeCheckout = false; }
}

export function resetRazorpayMagicSdkForTests() { scriptPromise = null; activeCheckout = false; }
