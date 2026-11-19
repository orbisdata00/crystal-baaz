import test from "node:test";
import assert from "node:assert/strict";
import { fetchCompleteShopifyCart } from "../src/shopify.js";

const cartId = "gid://shopify/Cart/abc?key=secret";
const line = (id, quantity) => ({
  id: `line-${id}`,
  quantity,
  attributes: [],
  cost: {
    amountPerQuantity: { amount: "10.00", currencyCode: "INR" },
    subtotalAmount: { amount: "10.00", currencyCode: "INR" },
    totalAmount: { amount: "10.00", currencyCode: "INR" },
  },
  merchandise: {
    id: `gid://shopify/ProductVariant/${id}`,
    availableForSale: true,
    product: { id: `gid://shopify/Product/${id}` },
  },
});

function page(lines, hasNextPage = false, endCursor = null) {
  const totalQuantity = lines.reduce((sum, item) => sum + item.quantity, 0);
  return {
    id: cartId,
    updatedAt: "2026-11-20T10:00:00Z",
    note: null,
    totalQuantity,
    attributes: [],
    discountCodes: [],
    cost: {
      subtotalAmount: { amount: String(totalQuantity * 10), currencyCode: "INR" },
      totalAmount: { amount: String(totalQuantity * 10), currencyCode: "INR" },
    },
    lines: { nodes: lines, pageInfo: { hasNextPage, endCursor } },
  };
}

test("complete Shopify cart fetch paginates all lines and verifies units for Razorpay preparation", async () => {
  const firstPage = page([line(1, 100)], true, "cursor-1");
  firstPage.totalQuantity = 101;
  const secondPage = page([line(2, 1)]);
  secondPage.totalQuantity = 101;
  const cursors = [];
  const result = await fetchCompleteShopifyCart(cartId, {
    request: async (query, variables) => {
      assert.match(query, /discountCodes/);
      assert.match(query, /availableForSale/);
      assert.match(query, /subtotalAmount/);
      cursors.push(variables.after);
      return { cart: variables.after ? secondPage : firstPage };
    },
  });

  assert.deepEqual(cursors, [null, "cursor-1"]);
  assert.equal(result.lines.nodes.length, 2);
  assert.equal(result.totalQuantity, 101);
});

test("complete Shopify cart fetch rejects incomplete or unverifiable pagination", async () => {
  const incomplete = page([line(1, 1)], true, null);
  await assert.rejects(
    fetchCompleteShopifyCart(cartId, { request: async () => ({ cart: incomplete }) }),
    /pagination/,
  );
  const mismatchedQuantity = page([line(1, 1)]);
  mismatchedQuantity.totalQuantity = 2;
  await assert.rejects(
    fetchCompleteShopifyCart(cartId, { request: async () => ({ cart: mismatchedQuantity }) }),
    /incomplete/,
  );
});
