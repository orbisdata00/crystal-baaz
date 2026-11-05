// Share a readable product list. Shopify cart IDs and checkout links never leave
// browser storage, and the recipient is not promised a restored or payable cart.
export function buildCartShare({ lines, total, currencyCode = "INR", baseUrl = globalThis.location?.href } = {}) {
  let storefront;
  try {
    storefront = new URL(baseUrl);
    if (!["https:", "http:"].includes(storefront.protocol)) storefront = null;
    else { storefront.search = ""; storefront.hash = ""; storefront.username = ""; storefront.password = ""; }
  } catch { storefront = null; }
  const items = (lines || []).filter(line => line?.product?.title && Number.isInteger(line.quantity) && line.quantity > 0);
  const text = ["My Crystal Baaz shopping list", ...items.map(line => {
    const variant = line.variantTitle && line.variantTitle !== "Default Title" ? ` (${line.variantTitle})` : "";
    const url = storefront && line.product.handle ? new URL(`#product/${encodeURIComponent(line.product.handle)}`, storefront).href : "";
    return `${line.quantity} × ${line.product.title}${variant}${url ? `\n${url}` : ""}`;
  })];
  if (total != null && Number.isFinite(Number(total)) && Number(total) >= 0) {
    try { text.push(`Confirmed cart total: ${new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode }).format(Number(total))}`); } catch { /* Omit an invalid currency rather than invent one. */ }
  }
  text.push("Prices and availability may change. Open the product links to create your own cart.");
  return { title: "Crystal Baaz shopping list", text: text.join("\n\n") };
}

export async function shareCart(options = {}) {
  const browser = options.navigator ?? globalThis.navigator;
  const payload = buildCartShare(options);
  if (typeof browser?.share === "function") {
    try { await browser.share(payload); return { status: "shared", message: "Shopping list shared." }; }
    catch (error) { if (error?.name === "AbortError") return { status: "cancelled", message: "" }; }
  }
  if (typeof browser?.clipboard?.writeText === "function") {
    try { await browser.clipboard.writeText(payload.text); return { status: "copied", message: "Shopping list copied. Paste it to share." }; }
    catch { return { status: "failed", message: "Could not share this shopping list. Please try again." }; }
  }
  return { status: "unsupported", message: "Sharing is unavailable in this browser." };
}
