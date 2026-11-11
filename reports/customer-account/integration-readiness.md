# Crystal Baaz Customer Accounts and Checkout Readiness

## Current integration points

- The storefront is a Vite React single-page app with hash routes. Its Account header action opens `#account`.
- Shopify Storefront API cart mutations, cart persistence and cart review already exist in `src/shopify.js`, `src/catalog-service.js` and `src/use-shopify-cart.js`.
- Before this change, Account showed a setup-pending message and checkout was always disabled.
- This repository has no backend/BFF or serverless API layer. `.env.local` contains Storefront API configuration only; the Customer Account API Client ID and HTTPS callback/logout URLs are not configured. No credential values were read into output or changed.

## Implemented architecture

- Uses Shopify Customer Account API public-client OAuth authorization-code flow with PKCE S256. Authentication endpoints and Customer Account GraphQL endpoint are discovered from the Shopify `.well-known` endpoints at runtime.
- Validates the OAuth `state`, ID-token signature through Shopify JWKS, issuer, audience, expiry and nonce. Profile, addresses and recent orders are loaded only from the authenticated Customer Account API. Customers can create, edit, set the default, and delete saved addresses; order rows expand to show actual Shopify line items.
- Access, ID and any refresh tokens stay in JavaScript memory. Only the short-lived OAuth transaction and a non-secret session-resume hint are kept in `sessionStorage`. A page refresh attempts Shopify `prompt=none`; Shopify-hosted login is used again if that session is no longer active. Cart storage is untouched by sign-in and logout.
- Uses Shopify's documented `sso=silent` checkout handoff for an authenticated account. Guest carts remain supported. A fresh `cart.checkoutUrl` is requested only when the buyer presses the checkout control.
- Checkout is controlled by `VITE_SHOPIFY_CHECKOUT_ENABLED` and is disabled unless its value is exactly `true`. No checkout URL is opened in these tests.

## Required Shopify and deployment setup

1. Enable new Customer Accounts and the Customer Account API for the Crystal Baaz Headless storefront.
2. Grant the Headless client `customer_read_customers` and `customer_read_orders` permissions and complete Shopify's protected customer data approval where required. Add `customer_write_customers` to enable saved address creation, editing, default selection and deletion. Address writes remain subject to the customer's authenticated session and Shopify validation.
3. Register the exact public HTTPS callback, logout URI and JavaScript origin used by the deployed site. Configure the public Client ID and URLs using the variables in `.env.example`. The Client ID is public; do not add a Client Secret or private Storefront token to `VITE_` variables.
4. Ensure the hosting platform serves the SPA at the registered callback path so the callback query can be handled before the hash route resumes.
5. For local testing, use an HTTPS tunnel whose origin and callback are registered in Shopify. Plain HTTP localhost is intentionally rejected by the account client.

Environment values to add to the deployment environment:

```dotenv
VITE_SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID=
VITE_SHOPIFY_CUSTOMER_ACCOUNT_REDIRECT_URI=https://<registered-site>/account/callback
VITE_SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URI=https://<registered-site>/
VITE_SHOPIFY_CHECKOUT_ENABLED=false
```

The first three values must match Shopify's Customer Account API settings exactly. Leave the checkout flag false until the merchant finishes payment, shipping, tax and policy checks and approves enabling it.

## Payment-provider readiness

This workspace has no Shopify Admin connection, so payment-provider status, test mode, shipping zones, tax setup, policies and actual checkout accessibility could not be inspected. Juspay support/activation for this specific Shopify store is also unverified. Shopify's merchant documentation places provider activation in Shopify Admin and makes provider availability dependent on the merchant's market and provider eligibility. Juspay's public gateway onboarding material does not establish that this store has an approved Shopify integration. No separate Juspay browser payment flow was added.

## Verification boundary

- Unit coverage includes OAuth state mismatch, nonce mismatch, tampered JWT, PKCE, session refresh, account API data loading, address CRUD/default mutations, logout, feature-flag behavior, fresh checkout URL retrieval, guest checkout and authenticated SSO URL construction.
- The actual Shopify hosted login, customer data permissions, checkout destination and payment test flow require the missing registered Client ID, HTTPS origin and Shopify Admin setup. They cannot be truthfully marked end-to-end verified until those merchant dependencies are supplied. A local Chrome launch attempt aborted before opening the app, so browser screenshots/responsive checks could not be captured in this environment.
- No Shopify Admin setting was changed, no order or payment was submitted, no checkout feature flag was enabled, and the site was not published.

## Official references checked

- [Shopify Customer Account API authentication and reference](https://shopify.dev/docs/api/customer/latest)
- [Shopify Customer Account API authentication guide](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/authenticate-customers)
- [Shopify Customer Account API address mutations](https://shopify.dev/docs/api/customer/latest/objects/Mutation)
- [Shopify cart and checkout URL guide](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage)
- [Shopify third-party payment provider setup](https://help.shopify.com/en/manual/payments/third-party-providers)
- [Juspay gateway onboarding](https://juspay.io/in/docs/payment-gateway-integrations/docs/gateway-onboarding-guide/get-started)
