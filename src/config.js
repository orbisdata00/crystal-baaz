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
  publicSiteUrl: env.VITE_PUBLIC_SITE_URL || "",
};
