// Only public Storefront API values may be read by this Vite/browser bundle.
// Private Storefront tokens must stay in a server-side runtime and are not read here.
const env = import.meta.env || {};

// Shopify is opt-in for local verification. Production and unspecified builds stay on preview.
export const catalogProvider = env.VITE_CATALOG_SOURCE === "shopify" ? "shopify" : "preview";

export const shopifyConfig = {
  storeDomain: env.VITE_SHOPIFY_STORE_DOMAIN || "crystalbaaz.myshopify.com",
  storefrontAccessToken: env.VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN || "",
  apiVersion: env.VITE_SHOPIFY_API_VERSION || "2026-10",
};
