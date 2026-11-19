import test from "node:test";
import assert from "node:assert/strict";
import { resolveCheckoutProvider } from "../src/config.js";

test("checkout provider accepts Shopify, Magic Razorpay, or disabled", () => {
  for (const provider of ["shopify", "razorpay", "disabled"]) {
    assert.deepEqual(resolveCheckoutProvider({ requested: provider }), {
      provider,
      conflict: false,
      reason: "configured",
    });
  }
});

test("Razorpay Standard test provider is available only when explicitly allowed in development", () => {
  assert.deepEqual(resolveCheckoutProvider({ requested: "razorpay_test", allowTestProvider: true }), { provider: "razorpay_test", conflict: false, reason: "configured" });
  assert.deepEqual(resolveCheckoutProvider({ requested: "razorpay_test", allowTestProvider: false }), { provider: "disabled", conflict: true, reason: "test-provider-production-disabled" });
});

test("unknown checkout providers fail closed without fallback", () => {
  for (const requested of ["legacy-provider", "unexpected"]) {
    assert.deepEqual(resolveCheckoutProvider({ requested }), {
      provider: "disabled",
      conflict: true,
      reason: "unknown-provider",
    });
  }
});
