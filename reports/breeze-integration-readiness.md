# Breeze / Juspay Blaze integration readiness

Assessment date: 18 November 2026 (updated after scaffold implementation)

## Decision

The storefront now has a **Breeze integration scaffold, but is not ready to take payments**. The official web SDK dependency and browser/backend adapter boundaries are present. Breeze credentials, a deployed backend runtime, webhook endpoint, and merchant-approved Shopify headless/order workflow are still absent. The available public documentation does not define this merchant's cart mapping, signature contract, Shopify order creation, or webhook schemas. Do not enable Breeze or route checkout to it until Breeze and the Shopify merchant account confirm those contracts.

No payment was initiated. The existing Shopify checkout feature flag remains unchanged. The new Breeze feature flag is `false` by default, and checkout remains disabled by default.

## Existing storefront architecture

- Vite builds a React storefront and deploys static assets through GitHub Pages. A browser bundle cannot safely hold Breeze's server-side `authToken` or perform authenticated server operations.
- `src/shopify.js` stores the Shopify Storefront API access token in the browser configuration. It reads and mutates Shopify Storefront Cart API carts, including actual variant IDs, quantities, and Shopify-calculated `cost` values.
- The Shopify cart already has `checkoutUrl`; `loadShopifyCheckoutDestination` validates that URL against the Shopify store and primary domain before redirecting.
- `src/catalog-service.js` and `src/app.js` gate checkout behind `VITE_SHOPIFY_CHECKOUT_ENABLED`, which is `false` in `.env.example`.
- The cart UI requires confirmed Shopify cart lines and displays checkout as unavailable while checkout is disabled.
- There is no server or serverless API in this repository and no webhook route. GitHub Pages cannot host these endpoints.

## Official SDK contract confirmed

The public [Blaze Web SDK README](https://github.com/juspay/blaze-sdk-web) documents installation of `@juspay/blaze-sdk-web`, a browser import, `BlazeSDK.initiate(...)`, and `BlazeSDK.process(...)`. Its initialization example includes `merchantId`, `shopUrl`, `environment`, `requestId`, and service `in.breeze.onecco`. The README explicitly leaves the process payload dependent on the selected action's schema.

The [Blaze Backend SDK README](https://github.com/juspay/blaze-sdk-web/blob/release/BACKEND_README.md) documents importing `@juspay/blaze-sdk-web/backend`, backend initialization with `authToken`, and an example `initiatePayments` payload. That example demonstrates a cart `totalPrice` in smallest currency units, but does not define a supported conversion from a Shopify Storefront Cart ID to a Breeze cart, nor does it authorize creating or marking a Shopify order paid. It is an example, not a confirmed contract for this merchant.

The supplied [Breeze integration documentation](https://docs.breeze.in/sdk-integration) was inaccessible during this review. Consequently, order create/status/platform webhook event schemas, signature verification, cart-signature requirements, and retry/idempotency details were not verified and must not be invented.

## Merchant inputs required before implementation

1. Breeze confirmation that this merchant account supports a Shopify headless storefront and its existing Storefront Cart API.
2. Breeze sandbox merchant ID, shop URL/mapping, and sandbox credentials, exchanged through a secure backend secret store (not committed or added to Vite variables).
3. Breeze's exact process action/schema for the chosen hosted or headless checkout, including request IDs and callback/event meanings.
4. Documented cart identity/mapping, line item/variant representation, currency units, cart signature generation/validation, and authoritative totals rules.
5. Approved flow for customer/address handoff, discounts, shipping, taxes, COD and online payment methods.
6. Written Shopify order creation and payment reconciliation approach, including refund, fulfillment, duplicate protection, and which platform owns final order state.
7. Official webhook URL requirements, event schemas, signature verification, retry behavior, and idempotency guidance.
8. A deployed HTTPS backend/serverless runtime and secure secret configuration. This is a hosting change beyond the current static GitHub Pages app.

## Safe implementation sequence after onboarding

1. Add a backend/serverless service using the official backend SDK and merchant-provided contracts. Keep secrets and authentication server-side.
2. Have the backend fetch/validate the Shopify cart through an approved Shopify credential/API arrangement; never trust browser totals or accept an arbitrary cart amount.
3. Implement the documented cart adapter and Breeze session/process payload; only then add a frontend SDK module and explicit sandbox feature flag, disabled by default.
4. Verify payment status server-side from authenticated Breeze APIs/webhooks, then synchronize Shopify order state through the approved supported mechanism with idempotency.
5. Test sandbox flow, failure/cancel/retry, webhook replay, amount/discount/shipping/tax consistency, desktop and mobile, and ensure no live orders/payments are generated.
6. Keep production disabled until the merchant approves production credentials and the complete reconciliation flow.

## Current completion and blockers

Completed: repository architecture review, existing feature-flag/cart review, SDK initialization wrapper, authoritative cart intent mapping, fail-closed checkout coordinator, dependency-injected backend boundaries, and mocked tests.

Blocked by merchant/platform inputs: Breeze sandbox access and account compatibility confirmation, exact process/cart/webhook contracts, approved Shopify order reconciliation, and a secure deployed backend. No sandbox checkout or payment/order tests can be run without these. Do not install or invoke a checkout SDK in the static client until its supported process action and backend flow are established.
