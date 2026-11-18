const SCRIPT_ID = "breeze-script-tag";
const SCRIPT_SRC = "https://sdk.breeze.in/electron/latest/index.js";
const PLATFORM = "shopifystorefront";
let scriptLoadPromise = null;

/** @typedef {{amount:string,currencyCode:string}|null} BreezeMoney */

const requiredMoney = (money, field, currency) => {
  if (!money || typeof money.amount !== "string" || !Number.isFinite(Number(money.amount)) || Number(money.amount) < 0 || !/^[A-Z]{3}$/.test(money.currencyCode || "")) {
    throw new Error(`Shopify cart ${field} is unavailable.`);
  }
  if (currency && money.currencyCode !== currency) throw new Error("Shopify cart currencies do not match.");
  return { amount: money.amount, currencyCode: money.currencyCode };
};

/**
 * Maps only Shopify Storefront Cart API fields into the documented Breeze
 * headless cart shape. Money remains Shopify decimal strings; no paise conversion
 * is applied. Shopify's Cart ID includes a secret key and is passed only to the
 * Breeze element as required by the merchant integration, never logged/shared.
 */
export function mapShopifyCartToBreezeCart(cart) {
  if (!cart?.id?.startsWith("gid://shopify/Cart/") || !Array.isArray(cart.lines?.nodes) || cart.lines.nodes.length === 0) {
    throw new Error("A confirmed, non-empty Shopify cart is required.");
  }
  const totalQuantity = cart.lines.nodes.reduce((sum, line) => sum + (Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0), 0);
  if (totalQuantity < 1 || totalQuantity !== cart.totalQuantity) throw new Error("Shopify cart quantities could not be reconciled.");
  const subtotalAmount = requiredMoney(cart.cost?.subtotalAmount, "subtotal");
  const totalAmount = requiredMoney(cart.cost?.totalAmount, "total", subtotalAmount.currencyCode);
  const totalDutyAmount = cart.cost?.totalDutyAmount == null ? null : requiredMoney(cart.cost.totalDutyAmount, "duty", subtotalAmount.currencyCode);
  const totalTaxAmount = cart.cost?.totalTaxAmount == null ? null : requiredMoney(cart.cost.totalTaxAmount, "tax", subtotalAmount.currencyCode);
  const discountCodes = (cart.discountCodes || []).map((discount) => {
    if (typeof discount?.code !== "string" || typeof discount.applicable !== "boolean") throw new Error("Shopify discount information is incomplete.");
    return { code: discount.code, applicable: discount.applicable };
  });
  const discountApplications = (cart.discountApplications || []).map((application) => ({
    type: application.__typename,
    code: application.code ?? null,
    title: application.title ?? null,
    targetType: application.targetType,
    allocationMethod: application.allocationMethod,
    targetSelection: application.targetSelection,
    totalAllocatedAmount: requiredMoney(application.totalAllocatedAmount, "cart discount", subtotalAmount.currencyCode),
  }));
  const nodes = cart.lines.nodes.map((line) => {
    const variant = line.merchandise;
    if (!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(variant?.id || "") || !variant?.product?.id || !variant.product.title || !Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error("A Shopify cart item is missing its product variant or quantity.");
    }
    const money = line.cost?.amountPerQuantity;
    const currency = money?.currencyCode || subtotalAmount.currencyCode;
    const amountPerQuantity = requiredMoney(money, "line price", currency);
    if (currency !== subtotalAmount.currencyCode) throw new Error("Shopify cart currencies do not match.");
    const cost = {
      amountPerQuantity,
      compareAtAmountPerQuantity: line.cost?.compareAtAmountPerQuantity == null
        ? null : requiredMoney(line.cost.compareAtAmountPerQuantity, "compare-at price", currency),
      subtotalAmount: requiredMoney(line.cost?.subtotalAmount, "line subtotal", currency),
      totalAmount: requiredMoney(line.cost?.totalAmount, "line total", currency),
    };
    const discountAllocations = (line.discountAllocations || []).map((allocation) => ({
      discountedAmount: requiredMoney(allocation?.discountedAmount, "line discount", currency),
    }));
    return {
      id: line.id,
      quantity: line.quantity,
      attributes: (line.attributes || []).map(({ key, value }) => ({ key: String(key), value: String(value) })),
      cost,
      discountAllocations,
      merchandise: {
        id: variant.id,
        title: variant.title,
        sku: variant.sku ?? null,
        weight: variant.weight ?? null,
        weightUnit: variant.weightUnit ?? null,
        availableForSale: variant.availableForSale,
        requiresShipping: variant.requiresShipping ?? null,
        selectedOptions: (variant.selectedOptions || []).map(({ name, value }) => ({ name, value })),
        image: variant.image ? { url: variant.image.url, altText: variant.image.altText ?? null } : null,
        price: requiredMoney(variant.price, "variant price", currency),
        compareAtPrice: variant.compareAtPrice == null ? null : requiredMoney(variant.compareAtPrice, "compare-at price", currency),
        product: {
          id: variant.product.id,
          title: variant.product.title,
          handle: variant.product.handle ?? null,
          description: variant.product.description ?? null,
          isGiftCard: variant.product.isGiftCard ?? null,
          productType: variant.product.productType ?? null,
          vendor: variant.product.vendor ?? null,
          onlineStoreUrl: variant.product.onlineStoreUrl ?? null,
          featuredImage: variant.product.featuredImage
            ? { url: variant.product.featuredImage.url, altText: variant.product.featuredImage.altText ?? null } : null,
        },
      },
    };
  });
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl ?? null,
    note: cart.note ?? null,
    totalQuantity,
    buyerIdentity: cart.buyerIdentity ? {
      countryCode: cart.buyerIdentity.countryCode ?? null,
      email: cart.buyerIdentity.email ?? null,
      phone: cart.buyerIdentity.phone ?? null,
      customer: null,
    } : null,
    attributes: (cart.attributes || []).map(({ key, value }) => ({ key: String(key), value: String(value) })),
    discountCodes,
    discountApplications,
    cost: { subtotalAmount, totalAmount, totalDutyAmount, totalTaxAmount },
    lines: nodes,
  };
}

export function serializeBreezeCart(cart) {
  return JSON.stringify(mapShopifyCartToBreezeCart(cart));
}

export const breezeButtonAttributes = (shopUrl) => ({
  enable: "true",
  enableexternaltrackers: "false",
  enablega: "false",
  enablefbp: "false",
  enablesnaptracker: "false",
  errortext: "Checkout is temporarily unavailable. Please try again.",
  buttonradius: "14px",
  buttoncolor: "#631c24",
  logocolor: "#ffffff",
  logohovercolor: "#ffffff",
  buttontextcolor: "#ffffff",
  texthovercolor: "#ffffff",
  buttonhovercolor: "#4b151c",
  buttonminheight: "46px",
  buttonfontsize: "15px",
  buttonminwidth: "200px",
  buttonpadding: "9px 16px",
  buttonfontweight: "600",
  fontfamily: "inherit",
  letterspacing: "0px",
  checkouttext: "Checkout with Breeze",
  buynowtext: "Checkout with Breeze",
  showlogo: "true",
  ghostmode: "false",
  platform: PLATFORM,
  shopurl: shopUrl,
});

/** Loads the documented headless script once and waits for its custom element registration. */
export function loadBreezeHeadlessScript({
  documentRef = globalThis.document,
  customElementsRef = globalThis.customElements,
  shopUrl,
  timeoutMs = 15000,
} = {}) {
  if (!documentRef || !customElementsRef || !shopUrl) return Promise.reject(new Error("Breeze button configuration is incomplete."));
  if (customElementsRef.get("breeze-button")) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    let script = documentRef.getElementById(SCRIPT_ID);
    let settled = false;
    let timer;
    const retryableFailure = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      scriptLoadPromise = null;
      script?.remove();
      reject(new Error("Breeze checkout could not load. Please retry."));
    };
    timer = setTimeout(retryableFailure, timeoutMs);
    const onReady = () => {
      customElementsRef.whenDefined("breeze-button").then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }, retryableFailure);
    };
    if (script) {
      if (script.dataset.platform !== PLATFORM || script.dataset.shopurl !== shopUrl) {
        clearTimeout(timer); scriptLoadPromise = null; reject(new Error("Breeze script is configured for a different store.")); return;
      }
      script.addEventListener("load", onReady, { once: true });
      script.addEventListener("error", retryableFailure, { once: true });
      if (script.dataset.loaded === "true") onReady();
      return;
    }
    script = documentRef.createElement("script");
    script.id = SCRIPT_ID;
    script.type = "module";
    script.src = SCRIPT_SRC;
    script.async = true;
    script.dataset.platform = PLATFORM;
    script.dataset.shopurl = shopUrl;
    script.addEventListener("load", () => { script.dataset.loaded = "true"; onReady(); }, { once: true });
    script.addEventListener("error", retryableFailure, { once: true });
    documentRef.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export function resetBreezeScriptLoaderForTests() {
  scriptLoadPromise = null;
}
