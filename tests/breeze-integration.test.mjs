import test from "node:test";
import assert from "node:assert/strict";
import { breezeButtonAttributes, loadBreezeHeadlessScript, mapShopifyCartToBreezeCart, resetBreezeScriptLoaderForTests, serializeBreezeCart } from "../src/breeze.js";
import { fetchCompleteShopifyCart } from "../src/shopify.js";

const cartId = "gid://shopify/Cart/token?key=secret";
const line = (id, quantity, amount = "100.00") => ({
  id: `gid://shopify/CartLine/${id}`, quantity, attributes: [{ key: "gift", value: "no" }],
  cost: {
    amountPerQuantity: { amount, currencyCode: "INR" },
    compareAtAmountPerQuantity: { amount: "120.00", currencyCode: "INR" },
    subtotalAmount: { amount: (Number(amount) * quantity).toFixed(2), currencyCode: "INR" },
    totalAmount: { amount: (Number(amount) * quantity - 10).toFixed(2), currencyCode: "INR" },
  },
  discountAllocations: [{ discountedAmount: { amount: "10.00", currencyCode: "INR" } }],
  merchandise: {
    id: `gid://shopify/ProductVariant/${id}`, title: "One size", sku: `SKU-${id}`, weight: 8, weightUnit: "GRAMS", availableForSale: true,
    selectedOptions: [{ name: "Title", value: "One size" }], price: { amount, currencyCode: "INR" },
    image: { url: "https://cdn.example/item.jpg", altText: "Item" },
    product: { id: `gid://shopify/Product/${id}`, title: `Item ${id}`, handle: `item-${id}`, description: "Shopify description", isGiftCard: false, productType: "Crystal", vendor: "Crystal Baaz", onlineStoreUrl: "https://shop.example/products/item", featuredImage: { url: "https://cdn.example/item.jpg", altText: "Item" } },
  },
});
const cart = (nodes = [line("1", 3)]) => ({
  id: cartId, checkoutUrl: "https://crystalbaaz.myshopify.com/checkouts/example", totalQuantity: nodes.reduce((sum, item) => sum + item.quantity, 0),
  note: null,
  buyerIdentity: { countryCode: "IN", email: "buyer@example.com", phone: "+919876543210" }, discountCodes: [{ code: "SAVE10", applicable: true }],
  discountApplications: [{ __typename: "CartCodeDiscountApplication", code: "SAVE10", targetType: "LINE_ITEM", allocationMethod: "ACROSS", targetSelection: "ALL", totalAllocatedAmount: { amount: "10.00", currencyCode: "INR" } }],
  attributes: [{ key: "source", value: "storefront" }],
  cost: { subtotalAmount: { amount: "300.00", currencyCode: "INR" }, totalAmount: { amount: "290.00", currencyCode: "INR" }, totalDutyAmount: null, totalTaxAmount: null },
  lines: { nodes },
});

test("maps confirmed Shopify totals, discounts, variants and product fields without currency conversion", () => {
  const result = mapShopifyCartToBreezeCart(cart());
  assert.equal(result.totalQuantity, 3);
  assert.equal(result.cost.totalAmount.amount, "290.00");
  assert.equal(result.cost.totalTaxAmount, null);
  assert.deepEqual(result.discountCodes, [{ code: "SAVE10", applicable: true }]);
  assert.equal(result.discountApplications[0].totalAllocatedAmount.amount, "10.00");
  assert.equal(result.buyerIdentity.email, "buyer@example.com");
  assert.equal(result.checkoutUrl, cart().checkoutUrl);
  assert.deepEqual(result.attributes, [{ key: "source", value: "storefront" }]);
  assert.equal(result.lines[0].cost.totalAmount.amount, "290.00");
  assert.equal(result.lines[0].discountAllocations[0].discountedAmount.amount, "10.00");
  assert.equal(result.lines[0].merchandise.weightUnit, "GRAMS");
  assert.equal(result.lines[0].merchandise.product.isGiftCard, false);
  assert.equal(JSON.parse(serializeBreezeCart(cart())).lines[0].quantity, 3);
});

test("rejects empty, stale, unpriced, invalid-quantity, and mixed-currency carts", () => {
  assert.throws(() => mapShopifyCartToBreezeCart(cart([])), /non-empty/);
  assert.throws(() => mapShopifyCartToBreezeCart({ ...cart(), totalQuantity: 2 }), /quantities/);
  assert.throws(() => mapShopifyCartToBreezeCart({ ...cart(), cost: { ...cart().cost, totalAmount: { amount: "bad", currencyCode: "INR" } } }), /total is unavailable/);
  assert.throws(() => mapShopifyCartToBreezeCart(cart([line("1", 1, "10.00"), { ...line("2", 1), cost: { ...line("2", 1).cost, amountPerQuantity: { amount: "100", currencyCode: "USD" } } }])), /currencies/);
});

test("emits the documented lowercase Breeze button attributes with Crystal Baaz styling", () => {
  assert.deepEqual(breezeButtonAttributes("crystalbaaz.myshopify.com"), {
    enable: "true", enableexternaltrackers: "false", enablega: "false", enablefbp: "false", enablesnaptracker: "false",
    errortext: "Checkout is temporarily unavailable. Please try again.",
    buttonradius: "14px", buttoncolor: "#536b4a", logocolor: "#ffffff", buttontextcolor: "#ffffff",
    logohovercolor: "#ffffff", texthovercolor: "#ffffff", buttonhovercolor: "#41563a", buttonminheight: "46px",
    buttonfontsize: "15px", buttonminwidth: "200px", buttonpadding: "9px 16px", buttonfontweight: "600", fontfamily: "inherit", letterspacing: "0px",
    checkouttext: "Checkout with Breeze", buynowtext: "Checkout with Breeze", showlogo: "true", ghostmode: "false",
    platform: "shopifystorefront", shopurl: "crystalbaaz.myshopify.com",
  });
});

test("loads the official Web Component script once and waits for registration", async () => {
  resetBreezeScriptLoaderForTests();
  const listeners = {};
  const script = { dataset: {}, addEventListener(name, callback) { listeners[name] = callback; }, remove() {} };
  let appended = 0;
  const documentRef = { getElementById: () => null, createElement: () => script, head: { appendChild() { appended++; } } };
  const customElementsRef = { get: () => undefined, whenDefined: async (name) => assert.equal(name, "breeze-button") };
  const first = loadBreezeHeadlessScript({ documentRef, customElementsRef, shopUrl: "crystalbaaz.myshopify.com" });
  const second = loadBreezeHeadlessScript({ documentRef, customElementsRef, shopUrl: "crystalbaaz.myshopify.com" });
  assert.equal(first, second);
  assert.equal(appended, 1);
  assert.equal(script.src, "https://sdk.breeze.in/electron/latest/index.js");
  assert.equal(script.dataset.platform, "shopifystorefront");
  listeners.load();
  await first;
  resetBreezeScriptLoaderForTests();
});

test("reports Breeze script network failure and allows a retry", async () => {
  resetBreezeScriptLoaderForTests();
  const listeners = {};
  const script = { dataset: {}, addEventListener(name, callback) { listeners[name] = callback; }, remove() { this.removed = true; } };
  const documentRef = { getElementById: () => null, createElement: () => script, head: { appendChild() {} } };
  const customElementsRef = { get: () => undefined, whenDefined: async () => {} };
  const pending = loadBreezeHeadlessScript({ documentRef, customElementsRef, shopUrl: "crystalbaaz.myshopify.com" });
  listeners.error();
  await assert.rejects(pending, /could not load/);
  assert.equal(script.removed, true);
  resetBreezeScriptLoaderForTests();
});

test("waits for every Shopify cart line page and rejects incomplete pagination", async () => {
  const pageOne = { ...cart([line("1", 100)]), totalQuantity: 101, lines: { nodes: Array.from({ length: 100 }, (_, i) => line(String(i + 1), 1)), pageInfo: { hasNextPage: true, endCursor: "cursor-1" } } };
  const pageTwo = { ...cart([line("101", 1)]), totalQuantity: 101, lines: { nodes: [line("101", 1)], pageInfo: { hasNextPage: false, endCursor: null } } };
  const calls = [];
  const result = await fetchCompleteShopifyCart(cartId, { request: async (_query, variables) => {
    calls.push(variables.after);
    return { cart: variables.after ? pageTwo : pageOne };
  } });
  assert.equal(calls.length, 2);
  assert.equal(result.lines.nodes.length, 101);
  await assert.rejects(fetchCompleteShopifyCart(cartId, { request: async () => ({ cart: { ...pageOne, lines: { ...pageOne.lines, pageInfo: { hasNextPage: true, endCursor: null } } } }) }), /pagination/);
});
