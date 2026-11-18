# Breeze / Juspay Blaze integration readiness

Assessment date: 18 November 2026 (updated after scaffold implementation)

## Decision

The storefront now implements the PDF's **Breeze Shopify Headless Web Component path**, but is not ready to take payments. Breeze's approved latest script and `breeze-button` attributes replace the earlier generic Blaze SDK `initiate/process` scaffold; the SDK package was removed to avoid two competing checkout flows. The feature remains disabled by default. Merchant confirmation is still needed for the Shopify cart secret-key handoff, exact payload acceptance, order verification, and when the `clear-cart` event is safe to act on.

No payment was initiated. The existing Shopify checkout feature flag remains unchanged. The new Breeze feature flag is `false` by default, and checkout remains disabled by default.

## Existing storefront architecture

- Vite builds a React storefront and deploys static assets through GitHub Pages. A browser bundle cannot safely hold Breeze's server-side `authToken` or perform authenticated server operations.
- `src/shopify.js` stores the Shopify Storefront API access token in the browser configuration. It reads and mutates Shopify Storefront Cart API carts, including actual variant IDs, quantities, and Shopify-calculated `cost` values.
- The Shopify cart already has `checkoutUrl`; `loadShopifyCheckoutDestination` validates that URL against the Shopify store and primary domain before redirecting.
- `src/catalog-service.js` and `src/app.js` gate checkout behind `VITE_SHOPIFY_CHECKOUT_ENABLED`, which is `false` in `.env.example`.
- The cart UI requires confirmed Shopify cart lines and displays checkout as unavailable while checkout is disabled.
- There is no deployed server or serverless API in this repository and no webhook route. GitHub Pages cannot host these endpoints.

## Integration documents reviewed

The supplied five-page PDF specifies `https://sdk.breeze.in/electron/latest/index.js`, the `shopifystorefront` platform, a `<breeze-button>` with stringified Shopify cart data, lowercase string attributes, and a `breezeEvent` whose `detail` is `clear-cart`. Its Storefront sample uses an array for `lines`; the mapper preserves that shape and adds the requested discount, SKU/weight, product description/type/vendor/gift-card/online-store fields. It also uses the approved button styling and disables analytics/tracker attributes. The earlier Blaze SDK package was removed because that generic integration is not the selected headless flow. The Breeze-hosted guide was not independently accessible during this assessment; the merchant-provided PDF is the button specification.

Shopify's [Storefront cart guide](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage) says cart IDs include a secret key and must be treated like a password, not put in public pages or shareable links. The PDF requires passing cart data to a third-party element; the merchant must confirm that the full Storefront cart ID and checkout URL are intended to be transferred to Breeze and how they are protected. The current button stays disabled by default until that handoff is approved. Shopify's current schema confirms cart discount codes, cart/line discount allocations, and decimal-string cart/line totals; no Ajax `/cart.js` token is synthesized.

## Merchant inputs required before implementation

1. Breeze approval of the exact GraphQL cart payload, including the Storefront `lines` array, decimal money strings, the secret-bearing cart ID and checkout URL, buyer email/phone, and optional null fields.
2. Confirmation that the merchant's Breeze account and supplied script configuration target sandbox, plus any required merchant-side setup/allowlisting.
3. Server-side payment/order verification contract, including how `clear-cart` maps to a specific checkout/session and order.
4. Approved Shopify order creation/association and payment reconciliation method, including refunds, fulfillment, and duplicate processing.
5. Any official webhook schemas, signature verification, retries, and idempotency requirements.
6. A deployed HTTPS backend/serverless runtime and secure secret configuration. GitHub Pages cannot host these endpoints.

## Safe implementation sequence after onboarding

1. Obtain written approval of the exact cart-data handoff and sandbox configuration; keep the feature flag off until then.
2. Add a backend/serverless service for the confirmed status/webhook and order-sync contracts. Keep secrets server-side.
3. Verify payment status server-side, then reconcile Shopify order state through the approved method with idempotency.
4. Test sandbox success/failure/cancel/retry, webhook replay, totals, and desktop/mobile behavior without creating live orders or charges.
5. Keep production disabled until the merchant approves and end-to-end reconciliation is verified.

## Current completion and blockers

Completed: repository architecture review, paginated full-cart fetch, mapped stringified headless cart payload, single-load script manager, `breeze-button` attributes and event listener, dependency-injected backend verification/order boundaries, feature flag default-off, and mocked tests.

The PDP sticky purchase bar now renders an offer only when the offer is explicitly marked both `verified` and `active`; the unverified hardcoded prepaid promotion was removed.

Verification: all 132 automated tests pass and the Vite production build succeeds. The dependency audit could not reach the npm audit endpoint in this environment. No Chromium/Playwright executable is installed, so real-browser screenshots and UI interaction checks were not available. No real Breeze script render, sandbox payment/order test, or Shopify order synchronization was performed.

Blocked by merchant/platform inputs: approval of transmitting Shopify's secret-bearing cart ID/checkout URL and buyer contact fields; confirmation that the supplied Breeze script is configured for this merchant's sandbox; an authoritative completion-verification and order-sync contract; and a secure deployed backend. The PDF's `clear-cart` event has no checkout/session reference, so it cannot safely trigger clearing or order success by itself.
