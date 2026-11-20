const SCRIPT_ID = "razorpay-standard-checkout-sdk";
const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let scriptPromise;

export function loadRazorpayStandardSdk({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  if (windowRef?.Razorpay) return Promise.resolve(windowRef.Razorpay);
  if (!documentRef) return Promise.reject(new Error("Razorpay Checkout is unavailable in this browser."));
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = documentRef.getElementById(SCRIPT_ID) || documentRef.createElement("script");
    const fail = () => { scriptPromise = null; reject(new Error("Razorpay Checkout could not load. Please retry.")); };
    script.addEventListener("load", () => windowRef?.Razorpay ? resolve(windowRef.Razorpay) : fail(), { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!script.isConnected) { script.id = SCRIPT_ID; script.src = SCRIPT_SRC; script.async = true; documentRef.head.appendChild(script); }
  });
  return scriptPromise;
}

async function postJson(baseUrl, path, body, fetchImpl) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit" });
  let payload;
  try { payload = await response.json(); } catch { throw new Error("Local Razorpay test service returned an invalid response."); }
  if (!response.ok) throw new Error(payload?.message || "Razorpay test payment could not be completed.");
  return payload;
}

export async function startRazorpayStandardTestCheckout({ backendUrl, shopifyCartId, fetchImpl = globalThis.fetch, windowRef = globalThis.window, sdkLoader = loadRazorpayStandardSdk }) {
  if (!backendUrl || !shopifyCartId || typeof fetchImpl !== "function") throw new Error("Local Razorpay test checkout configuration is incomplete.");
  const Razorpay = await sdkLoader({ windowRef });
  const order = await postJson(backendUrl, "/api/razorpay/test/create-order", { shopifyCartId }, fetchImpl);
  if (!/^rzp_test_/.test(order?.keyId || "") || !/^order_[A-Za-z0-9]+$/.test(order?.id || "") || !/^CBT-[\da-f-]{36}$/i.test(order?.reference || "") || !Number.isSafeInteger(order.amount) || order.amount < 100 || order.currency !== "INR") throw new Error("Local Razorpay test order response is invalid.");
  return new Promise((resolve, reject) => {
    let finished = false;
    const instance = new Razorpay({
      key: order.keyId, order_id: order.id, amount: order.amount, currency: order.currency,
      name: "Crystal Baaz", description: "Test payment — no Shopify order will be created", theme: { color: "#631c24" },
      handler: async response => {
        if (finished) return;
        finished = true;
        try {
          const result = await postJson(backendUrl, "/api/razorpay/test/verify-payment", response, fetchImpl);
          if (result?.verified !== true || result.mode !== "test" || result.shopifyOrderCreated !== false || result.status !== "captured" || result.reference !== order.reference || !/^[a-f\d]{64}$/i.test(result.accessToken || "")) throw new Error("Razorpay has not confirmed this test payment.");
          resolve(result);
        } catch (error) { reject(error); }
      },
      modal: { ondismiss: () => { if (!finished) { finished = true; resolve({ cancelled: true }); } }, confirm_close: true },
    });
    if (typeof instance.on === "function") instance.on("payment.failed", () => {
      if (!finished) { finished = true; reject(new Error("Test payment was not completed. Your cart remains unchanged.")); }
    });
    instance.open();
  });
}

export function resetRazorpayStandardSdkForTests() { scriptPromise = null; }
