import test from "node:test";
import assert from "node:assert/strict";
import { formatCurrencyAmount } from "../src/money.js";

test("INR prices use one grouped rupee format without fractional paise", () => {
  assert.equal(formatCurrencyAmount(290, "INR"), "₹290");
  assert.equal(formatCurrencyAmount(3490, "INR"), "₹3,490");
  assert.equal(formatCurrencyAmount(3490.5, "INR"), "₹3,491");
});

test("non-INR Shopify currencies keep their two decimal places", () => {
  assert.equal(formatCurrencyAmount(12.5, "USD", 2), "$12.50");
});
