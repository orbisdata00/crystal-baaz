import test from "node:test";
import assert from "node:assert/strict";
import { buildCartShare, shareCart } from "../src/cart-share.js";

const lines = [{ key: "private-key", variantId: "gid://shopify/ProductVariant/private", quantity: 2, variantTitle: "Small", product: { title: "Clear quartz", handle: "clear-quartz" } }];
const options = { lines, total: "250", currencyCode: "INR", baseUrl: "https://shop.example/?cart=private-cart#cart/private-secret" };

test("shared payload contains products and confirmed total without cart IDs or sensitive URL state", () => {
  const payload = buildCartShare(options);
  assert.match(payload.text, /2 × Clear quartz \(Small\)/);
  assert.match(payload.text, /https:\/\/shop.example\/#product\/clear-quartz/);
  assert.match(payload.text, /Confirmed cart total: ₹250.00/);
  assert.doesNotMatch(JSON.stringify(payload), /private|gid:|checkout/);
  assert.match(payload.text, /create your own cart/);
});

test("unconfirmed amounts and unsafe URL schemes are omitted", () => {
  const payload = buildCartShare({ lines, baseUrl: "javascript:private-secret" });
  assert.doesNotMatch(payload.text, /Confirmed cart total|javascript:|private-secret/);
});

test("native share is awaited before reporting success", async () => {
  let received;
  const result = await shareCart({ ...options, navigator: { async share(payload) { received = payload; } } });
  assert.equal(result.status, "shared");
  assert.deepEqual(received, buildCartShare(options));
});

test("native share cancellation does not copy anything or announce success", async () => {
  let copied = false;
  const result = await shareCart({ ...options, navigator: { async share() { throw Object.assign(Error("cancel"), { name: "AbortError" }); }, clipboard: { async writeText() { copied = true; } } } });
  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "");
  assert.equal(copied, false);
});

test("clipboard fallback copies safe text and reports its real result", async () => {
  let copied;
  const result = await shareCart({ ...options, navigator: { clipboard: { async writeText(text) { copied = text; } } } });
  assert.equal(result.status, "copied");
  assert.equal(copied, buildCartShare(options).text);
  const failed = await shareCart({ ...options, navigator: { clipboard: { async writeText() { throw Error("denied"); } } } });
  assert.equal(failed.status, "failed");
  assert.equal((await shareCart({ ...options, navigator: {} })).status, "unsupported");
});
