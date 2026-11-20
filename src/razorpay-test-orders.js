const STORAGE_KEY = "crystal-baaz-razorpay-test-orders-v1";

export function saveRazorpayTestOrderAccess({ reference, accessToken }, storage = globalThis.localStorage) {
  if (!/^CBT-[\da-f-]{36}$/i.test(reference || "") || !/^[a-f\d]{64}$/i.test(accessToken || "")) throw new Error("Verified test order access is invalid.");
  const entries = readRazorpayTestOrderAccess(storage);
  entries[reference] = accessToken;
  const limited = Object.fromEntries(Object.entries(entries).slice(-50));
  storage.setItem(STORAGE_KEY, JSON.stringify(limited));
}

export function readRazorpayTestOrderAccess(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([reference, token]) => /^CBT-[\da-f-]{36}$/i.test(reference) && /^[a-f\d]{64}$/i.test(token))) : {};
  } catch { return {}; }
}

export async function fetchRazorpayTestOrder(backendUrl, reference, accessToken, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${backendUrl.replace(/\/$/, "")}/api/razorpay/test/get-order`, {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit",
    body: JSON.stringify({ reference, accessToken }),
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error("Test order lookup returned an invalid response."); }
  if (!response.ok || payload?.mode !== "test" || payload?.shopifyOrderCreated !== false) throw new Error("Test order could not be loaded from this browser's saved test history.");
  return payload;
}
