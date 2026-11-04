function validPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

export function selectVariant(product, selector) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (selector) {
    const match = variants.find((variant) => [variant.id, variant.sku, variant.title].some((value) => value != null && String(value) === String(selector)));
    if (match) return match;
  }
  return variants.find((variant) => variant.canPurchase !== false && validPrice(variant.price) && variant.available !== false)
    || variants.find((variant) => validPrice(variant.price))
    || variants[0]
    || {
      id: `${product?.id || "product"}:${product?.sizes?.[0] || "One size"}`,
      title: product?.sizes?.[0] || "One size",
      price: product?.price,
      compareAt: product?.compareAt,
    };
}

export function cartLinePrice(line, product) {
  const variant = selectVariant(product, line.variantId);
  const price = validPrice(variant?.price) ? Number(variant.price) : Number(product?.price);
  const compareAt = Number(variant?.compareAt ?? variant?.compare_at_price ?? product?.compareAt);
  return {
    variant,
    price: validPrice(price) ? price : null,
    compareAt: Number.isFinite(compareAt) && compareAt > 0 ? compareAt : null,
  };
}

export function addCartLine(lines, product, selector = product.sizes?.[0] || "One size", quantity = 1) {
  const variant = selectVariant(product, selector);
  const price = Number(variant?.price ?? product.price);
  if (!validPrice(price) || variant?.canPurchase === false || variant?.available === false) return lines;
  const variantId = variant?.id || `${product.id}:${variant?.title || selector}`;
  const variantTitle = variant?.title || variant?.sku || selector || "One size";
  const key = `${product.id}:${variantId}`;
  const current = lines.find((item) => item.key === key);
  return current
    ? lines.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
    : [...lines, { key, productId: product.id, variantId, variantTitle, sku: variant?.sku || "", quantity }];
}

export function changeCartQuantity(lines, key, delta) {
  return lines
    .map((line) => line.key === key ? { ...line, quantity: line.quantity + delta } : line)
    .filter((line) => line.quantity > 0);
}

export function removeCartLine(lines, key) {
  return lines.filter((line) => line.key !== key);
}

export function calculateCart(lines, catalog) {
  const productsById = new Map(catalog.map((product) => [product.id, product]));
  const items = lines.map((line) => ({ ...line, product: productsById.get(line.productId) }))
    .filter((line) => line.product)
    .map((line) => ({ ...line, ...cartLinePrice(line, line.product) }));
  const subtotal = items.reduce((sum, line) => sum + (line.price || 0) * line.quantity, 0);
  return {
    lines: items,
    subtotal,
    count: items.reduce((sum, line) => sum + line.quantity, 0),
  };
}
