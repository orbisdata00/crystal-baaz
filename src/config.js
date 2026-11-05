// Only public Storefront API values may be read by this Vite/browser bundle.
// Private Storefront tokens must stay in a server-side runtime and are not read here.
const env = import.meta.env || {};

// Live Shopify data is the default. Workbook preview must be explicitly selected.
export const catalogProvider = env.VITE_CATALOG_SOURCE === "preview" ? "preview" : "shopify";

export const shopifyConfig = {
  storeDomain: env.VITE_SHOPIFY_STORE_DOMAIN || "crystalbaaz.myshopify.com",
  storefrontAccessToken: env.VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN || "",
  apiVersion: env.VITE_SHOPIFY_API_VERSION || "2026-10",
};
