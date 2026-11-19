const CART_GID_PREFIX = "gid://shopify/Cart/";
const numericShopifyId = (gid, type) => {
  const match = new RegExp(`^gid://shopify/${type}/([1-9]\\d*)$`).exec(gid || "");
  if (!match) throw new Error(`Shopify ${type.toLowerCase()} ID is invalid.`);
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id)) throw new Error(`Shopify ${type.toLowerCase()} ID is outside the supported range.`);
  return id;
};

/** Maps Shopify's documented Cart GID and complete line connection to Razorpay's Shopify Ajax cart shape. */
export function mapShopifyCartToRazorpayMagic(cart) {
  if (typeof cart?.id !== "string" || !cart.id.startsWith(CART_GID_PREFIX) || !cart.id.slice(CART_GID_PREFIX.length).includes("?key=")) {
    throw new Error("Shopify cart token is not in the supported Cart GID format.");
  }
  const token = cart.id.slice(CART_GID_PREFIX.length);
  const lines = cart.lines?.nodes;
  if (!Array.isArray(lines) || !lines.length) throw new Error("A complete, non-empty Shopify cart is required.");
  const currency = cart.cost?.totalAmount?.currencyCode;
  const validMoney = value => value && typeof value.amount === "string" && Number.isFinite(Number(value.amount)) && Number(value.amount) >= 0 && value.currencyCode === currency;
  if (currency !== "INR" || !validMoney(cart.cost?.subtotalAmount) || !validMoney(cart.cost?.totalAmount)) throw new Error("Shopify cart prices must be confirmed in INR.");
  const attributes = {};
  for (const attribute of cart.attributes || []) {
    if (typeof attribute?.key !== "string" || typeof attribute?.value !== "string" || Object.hasOwn(attributes, attribute.key)) {
      throw new Error("Shopify cart attributes could not be mapped safely.");
    }
    attributes[attribute.key] = attribute.value;
  }
  const usedVariants = new Set();
  const items = lines.map(line => {
    const variant = line?.merchandise;
    const variantId = numericShopifyId(variant?.id, "ProductVariant");
    const productId = numericShopifyId(variant?.product?.id, "Product");
    if (usedVariants.has(variantId)) throw new Error("Duplicate Shopify variant lines cannot be represented safely.");
    usedVariants.add(variantId);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999 || variant.availableForSale !== true ||
        !validMoney(line.cost?.amountPerQuantity) || !validMoney(line.cost?.subtotalAmount) || !validMoney(line.cost?.totalAmount)) {
      throw new Error("A Shopify cart line is unavailable or has an invalid quantity.");
    }
    const properties = {};
    for (const property of line.attributes || []) {
      if (typeof property?.key !== "string" || typeof property?.value !== "string" || Object.hasOwn(properties, property.key)) {
        throw new Error("Shopify line properties could not be mapped safely.");
      }
      properties[property.key] = property.value;
    }
    return { id: variantId, quantity: line.quantity, product_id: productId, variant_id: variantId, properties };
  });
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  if (!Number.isInteger(cart.totalQuantity) || itemCount !== cart.totalQuantity) throw new Error("Shopify cart quantities could not be reconciled.");
  const discountCodes = (cart.discountCodes || []).filter(item => item?.applicable === true).map(item => item.code);
  if (discountCodes.some(code => typeof code !== "string" || !code) || discountCodes.length > 1) throw new Error("Razorpay Magic Checkout can only prefill one verified cart coupon.");
  return {
    cart: {
      token,
      note: typeof cart.note === "string" ? cart.note : null,
      attributes,
      item_count: itemCount,
      items,
    },
    currency,
    subtotal: cart.cost?.subtotalAmount?.amount,
    total: cart.cost?.totalAmount?.amount,
    discountCodes,
  };
}

export function validateMagicCheckoutResponse(payload, expectedCartId) {
  if (payload?.shopify_checkout_id !== expectedCartId || !payload?.tax_details ||
      !Number.isInteger(payload.tax_details.total_tax) || payload.tax_details.total_tax < 0 ||
      typeof payload.tax_details.taxes_included !== "boolean") throw new Error("Razorpay Magic Checkout ID response is invalid.");
  return { shopify_checkout_id: payload.shopify_checkout_id, tax_details: payload.tax_details };
}

export function validateMagicOrderResponse(payload) {
  if (typeof payload?.order_id !== "string" || !/^order_[A-Za-z0-9]+$/.test(payload.order_id)) throw new Error("Razorpay Magic order response is invalid.");
  return { order_id: payload.order_id, preferences: payload.preferences ?? null };
}
