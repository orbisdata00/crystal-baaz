// Only public Storefront API values may be read by this Vite/browser bundle.
// Private Storefront tokens must stay in a server-side runtime and are not read here.
const env = import.meta.env || {};

// Preview mode is limited to development; production always renders Shopify data.
export function resolveCatalogProvider({ isProduction = false, requestedSource = "" } = {}) {
  return !isProduction && requestedSource === "preview" ? "preview" : "shopify";
}

export const catalogProvider = resolveCatalogProvider({
  isProduction: env.PROD === true,
  requestedSource: env.VITE_CATALOG_SOURCE,
});

export const shopifyConfig = {
  storeDomain: env.VITE_SHOPIFY_STORE_DOMAIN || "crystalbaaz.myshopify.com",
  storefrontAccessToken: env.VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN || "",
  apiVersion: env.VITE_SHOPIFY_API_VERSION || "2026-10",
  publicSiteUrl: env.VITE_PUBLIC_SITE_URL || "https://orbisdata00.github.io/crystal-baaz/",
  checkoutEnabled: env.VITE_SHOPIFY_CHECKOUT_ENABLED === "true",
  checkoutProvider: resolveCheckoutProvider({
    requested: env.VITE_CHECKOUT_PROVIDER,
    shopifyEnabled: env.VITE_SHOPIFY_CHECKOUT_ENABLED === "true",
    allowTestProvider: env.DEV === true,
  }),
  razorpayMagic: {
    enabled: env.VITE_RAZORPAY_MAGIC_ENABLED === "true",
    keyId: env.VITE_RAZORPAY_KEY_ID || "",
    backendUrl: env.VITE_RAZORPAY_BACKEND_URL || "",
  },
  razorpayTest: {
    enabled: env.DEV === true && env.VITE_CHECKOUT_PROVIDER === "razorpay_test" && /^rzp_test_/.test(env.VITE_RAZORPAY_KEY_ID || ""),
    keyId: env.VITE_RAZORPAY_KEY_ID || "",
    backendUrl: env.VITE_RAZORPAY_BACKEND_URL || "",
  },
  customerAccountClientId: env.VITE_SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID || "",
  customerAccountRedirectUri: env.VITE_SHOPIFY_CUSTOMER_ACCOUNT_REDIRECT_URI || "",
  customerAccountLogoutUri: env.VITE_SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URI || "",
};

export function resolveCheckoutProvider({ requested = "", shopifyEnabled = false, allowTestProvider = false } = {}) {
  const valid = ["shopify", "razorpay", "disabled", ...(allowTestProvider ? ["razorpay_test"] : [])];
  if (requested === "razorpay_test" && !allowTestProvider) return { provider: "disabled", conflict: true, reason: "test-provider-production-disabled" };
  if (requested && !valid.includes(requested)) return { provider: "disabled", conflict: true, reason: "unknown-provider" };
  if (requested) return { provider: requested, conflict: false, reason: "configured" };
  if (shopifyEnabled) return { provider: "shopify", conflict: false, reason: "legacy-shopify-flag" };
  return { provider: "disabled", conflict: false, reason: "default" };
}
