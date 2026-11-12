import { customerVariantLabel, productHash } from "./catalog.js";
import { shopifyConfig } from "./config.js";

const SHOPIFY_VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/([1-9]\d{0,23})$/;
const MAX_SHARED_LINES = 50;
const MAX_SHARED_QUANTITY = 999;
const MAX_SHARED_URL_LENGTH = 2048;

function isLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".localhost");
}

export function publicStorefrontBaseUrl({ baseUrl = globalThis.location?.href, publicSiteUrl = shopifyConfig.publicSiteUrl } = {}) {
  const candidates = [publicSiteUrl, baseUrl].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || isLocalHost(url.hostname) || url.username || url.password) continue;
      url.search = "";
      url.hash = "";
      return url;
    } catch { /* Try the next configured public origin. */ }
  }
  return null;
}

export function buildProductShareUrl(product, variantId, options = {}) {
  const storefront = publicStorefrontBaseUrl(options);
  if (!storefront || !product?.handle) return "";
  storefront.hash = productHash(product, variantId);
  return storefront.href;
}

export function buildCategoryShareUrl(category, routeHash, options = {}) {
  const storefront = publicStorefrontBaseUrl(options);
  const label = String(category || "").trim();
  const hash = typeof routeHash === "string" ? routeHash : "";
  if (!storefront || !label || !hash.startsWith("#") || hash.startsWith("#//")) return "";
  storefront.hash = hash;
  return storefront.href;
}

function shareLines(lines = []) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const quantities = new Map();
  const details = new Map();
  for (const line of lines) {
    const match = SHOPIFY_VARIANT_ID.exec(String(line?.variantId || ""));
    const quantity = Number(line?.quantity);
    if (!match || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SHARED_QUANTITY) return null;
    const current = quantities.get(match[1]) || 0;
    if (current + quantity > MAX_SHARED_QUANTITY) return null;
    quantities.set(match[1], current + quantity);
    details.set(match[1], line);
  }
  if (quantities.size > MAX_SHARED_LINES) return null;
  return [...quantities].map(([numericId, quantity]) => ({ numericId, quantity, line: details.get(numericId) }));
}

export function buildCartShare({ lines, baseUrl, publicSiteUrl } = {}) {
  const items = shareLines(lines);
  const storefront = publicStorefrontBaseUrl({ baseUrl, publicSiteUrl });
  if (!items?.length) return { title: "Crystal Baaz cart", text: "This cart cannot be shared as a link.", url: "", reason: "invalid-cart" };
  if (!storefront) return { title: "Crystal Baaz cart", text: "Open this Crystal Baaz cart to review current availability and prices.", url: "", reason: "public-url" };

  const params = new URLSearchParams({ items: items.map(item => `${item.numericId}:${item.quantity}`).join(",") });
  storefront.hash = `shared-cart?${params.toString()}`;
  if (storefront.href.length > MAX_SHARED_URL_LENGTH) return { title: "Crystal Baaz cart", text: "This cart is too large to share as one link.", url: "", reason: "too-large" };

  const linesText = items.map(({ quantity, line }) => {
    const product = line?.product;
    const variant = product?.variants?.find(item => item.id === line.variantId);
    const label = customerVariantLabel(product, variant, line?.variantTitle);
    const title = String(product?.title || "").trim();
    const details = title && label ? `${title} (${label})` : title || label;
    return details ? `${quantity} × ${details}` : `${quantity} item${quantity === 1 ? "" : "s"}`;
  });
  return {
    title: "Crystal Baaz cart",
    text: `Review this Crystal Baaz cart with current Shopify prices and availability.\n\n${linesText.join("\n")}\n\n${storefront.href}`,
    url: storefront.href,
    reason: "",
  };
}

export function buildWhatsAppShareUrl(options = {}) {
  const payload = buildCartShare(options);
  return payload.url ? `https://wa.me/?text=${encodeURIComponent(payload.text)}` : "";
}

export function parseSharedCartItems(serialized) {
  if (typeof serialized !== "string" || !serialized || serialized.length > 1800) return { ok: false, items: [] };
  const pairs = serialized.split(",");
  if (!pairs.length || pairs.length > MAX_SHARED_LINES) return { ok: false, items: [] };
  const quantities = new Map();
  for (const pair of pairs) {
    const match = pair.match(/^([1-9]\d{0,23}):([1-9]\d{0,2})$/);
    if (!match) return { ok: false, items: [] };
    const next = (quantities.get(match[1]) || 0) + Number(match[2]);
    if (next > MAX_SHARED_QUANTITY) return { ok: false, items: [] };
    quantities.set(match[1], next);
  }
  return {
    ok: quantities.size > 0 && quantities.size <= MAX_SHARED_LINES,
    items: [...quantities].map(([numericId, quantity]) => ({ variantId: `gid://shopify/ProductVariant/${numericId}`, quantity })),
  };
}

export async function shareProductLink({ product, variantId, navigator: browser = globalThis.navigator, baseUrl, publicSiteUrl } = {}) {
  const url = buildProductShareUrl(product, variantId, { baseUrl, publicSiteUrl });
  if (!url) return { status: "unavailable", message: "A public Crystal Baaz storefront URL is required to share this product." };
  const variant = product?.variants?.find(item => item.id === variantId);
  const variantLabel = customerVariantLabel(product, variant);
  const payload = { title: product.title || "Crystal Baaz product", text: `Explore ${product.title || "this product"}${variantLabel ? ` · ${variantLabel}` : ""} at Crystal Baaz`, url };
  if (typeof browser?.share === "function") {
    try { await browser.share(payload); return { status: "shared", message: "Product link shared." }; }
    catch (error) { if (error?.name === "AbortError") return { status: "cancelled", message: "" }; }
  }
  if (typeof browser?.clipboard?.writeText === "function") {
    try { await browser.clipboard.writeText(url); return { status: "copied", message: "Product link copied." }; }
    catch { return { status: "failed", message: "Could not copy the product link. Please try again." }; }
  }
  return { status: "unsupported", message: "Sharing is unavailable in this browser." };
}

export async function shareCategoryLink({ category, routeHash, navigator: browser = globalThis.navigator, baseUrl, publicSiteUrl } = {}) {
  const label = String(category || "category").trim().slice(0, 100) || "category";
  const url = buildCategoryShareUrl(label, routeHash, { baseUrl, publicSiteUrl });
  if (!url) return { status: "unavailable", message: "A public Crystal Baaz storefront URL is required to share this category." };
  const payload = { title: `${label} at Crystal Baaz`, text: `Explore ${label} at Crystal Baaz`, url };
  if (typeof browser?.share === "function") {
    try { await browser.share(payload); return { status: "shared", message: "Category link shared." }; }
    catch (error) { if (error?.name === "AbortError") return { status: "cancelled", message: "" }; }
  }
  if (typeof browser?.clipboard?.writeText === "function") {
    try { await browser.clipboard.writeText(url); return { status: "copied", message: "Category link copied." }; }
    catch { return { status: "failed", message: "Could not copy the category link. Please try again." }; }
  }
  return { status: "unsupported", message: "Sharing is unavailable in this browser." };
}

export async function shareCart(options = {}) {
  const browser = options.navigator ?? globalThis.navigator;
  const payload = buildCartShare(options);
  if (!payload.url) {
    return { status: "unavailable", message: cartShareBlockerMessage(payload.reason) };
  }
  if (typeof browser?.share === "function") {
    try { await browser.share(payload); return { status: "shared", message: "Cart link shared." }; }
    catch (error) { if (error?.name === "AbortError") return { status: "cancelled", message: "" }; }
  }
  if (typeof browser?.clipboard?.writeText === "function") {
    try { await browser.clipboard.writeText(payload.url); return { status: "copied", message: "Cart link copied." }; }
    catch { return { status: "failed", message: "Could not copy the cart link. Please try again." }; }
  }
  return { status: "unsupported", message: "Sharing is unavailable in this browser." };
}

export async function copyCartShare(options = {}) {
  const payload = buildCartShare(options);
  if (!payload.url) return { status: "unavailable", message: cartShareBlockerMessage(payload.reason) };
  const browser = options.navigator ?? globalThis.navigator;
  if (typeof browser?.clipboard?.writeText === "function") {
    try { await browser.clipboard.writeText(payload.url); return { status: "copied", message: "Cart link copied." }; }
    catch { return { status: "failed", message: "Could not copy the cart link. Please try again." }; }
  }
  return { status: "unsupported", message: "Copying is unavailable in this browser." };
}

function cartShareBlockerMessage(reason) {
  const messages = {
    "public-url": "This preview has no public Crystal Baaz website address yet, so cart links can’t be shared from here.",
    "too-large": "This cart is too large to fit in one share link.",
    "invalid-cart": "Some cart items can’t be included in a share link. Refresh your cart and try again.",
  };
  return messages[reason] || "This cart can’t be shared right now.";
}
