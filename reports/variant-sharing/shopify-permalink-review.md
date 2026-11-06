# Shopify permalink review

Checked 2026-11-06 against the Crystal Baaz Storefront and Shopify’s current developer documentation.

## Store capability check

`https://crystalbaaz.myshopify.com/.well-known/ucp` returned HTTP 302 and redirected to the password page. The store’s machine-readable UCP profile, `dev.ucp.shopping.permalink` capability, and `/buy` endpoint therefore could not be confirmed.

## Decision

Shopify documents `/buy` Cart and Checkout Permalinks as the successor to legacy `/cart` links. The endpoint must be read from the store’s UCP profile. A permalink defaults to checkout (with a documented option to continue to another store page) and hands the buyer to Shopify without letting the PWA inspect or merge the recipient’s current headless cart. That flow does not meet Crystal Baaz’s checkout-disabled share preview and confirm-before-merge requirements.

Crystal Baaz uses a headless share route instead. Product links keep the existing hash route and selected Shopify variant ID. Shared-cart links contain only numeric Shopify variant IDs and quantities; opening one resolves current Storefront product, price, and availability, and adding requires confirmation when the recipient already has cart items. Checkout stays disabled.

## Shopify references

- [Create Cart and Checkout Permalinks](https://shopify.dev/docs/agents/carts-and-checkout/permalinks)
- [Carts and checkout for agents](https://shopify.dev/docs/agents/carts-and-checkout)
- [Shopify changelog: Cart and checkout permalinks now support UCP at `/buy`](https://shopify.dev/changelog/posts/cart-and-checkout-permalinks-now-support-ucp-at-buy)
