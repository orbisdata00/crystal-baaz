import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fetchRazorpayTestOrder, readRazorpayTestOrderAccess, saveRazorpayTestOrderAccess } from "../src/razorpay-test-orders.js";
import { parseRoute } from "../src/routes.js";

function memoryStorage() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; }

test("verified test order capability is saved locally and a URL reference alone is not enough", async () => {
  const storage = memoryStorage();
  const reference = `CBT-${randomUUID()}`;
  const accessToken = "a".repeat(64);
  saveRazorpayTestOrderAccess({ reference, accessToken }, storage);
  assert.deepEqual(readRazorpayTestOrderAccess(storage), { [reference]: accessToken });
  assert.deepEqual(parseRoute(`#order-success/${reference}`), { page: "order-success", reference });
  let requestBody;
  const order = { mode: "test", reference, paymentId: "pay_test", orderId: "order_test", amount: 1234, currency: "INR", status: "captured", items: [], shopifyOrderCreated: false };
  assert.deepEqual(await fetchRazorpayTestOrder("https://api.example", reference, accessToken, async (url, options) => {
    assert.equal(url, "https://api.example/api/razorpay/test/get-order");
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => order };
  }), order);
  assert.equal(requestBody.reference, reference);
  await assert.rejects(fetchRazorpayTestOrder("https://api.example", reference, accessToken, async () => ({ ok: true, json: async () => ({ ...order, shopifyOrderCreated: true }) })));
  assert.throws(() => saveRazorpayTestOrderAccess({ reference: "CBT-invalid", accessToken }, storage));
});
