# Razorpay Magic Checkout readiness

## Implemented

- Added `razorpay` to the existing mutually exclusive checkout provider selector. The selected provider never falls back to Shopify automatically.
- Added a Shopify Storefront cart fetcher for the backend. It follows all line cursors and rejects carts that change while being read.
- Mapped the Shopify Cart GID token and product/variant GIDs to Razorpay's documented Magic Shopify cart fields. Numeric IDs must be safe JavaScript integers; unsupported IDs and ambiguous coupon/duplicate-line cases fail closed.
- Added Vite-compatible loading for `https://checkout.razorpay.com/v1/magic-checkout.js`, Magic Checkout opening, coupon prefill, dismissal/failure handling and a verified-completion request.
- Added backend calls for `/v1/magic/checkout/shopify`, `/v1/magic/order/shopify`, payment status retrieval, and `/v1/1cc/shopify/complete`.
- Added server-side checkout-session correlation, captured payment checks, HMAC payment-signature checks, order/payment amount reconciliation, Shopify order URL validation, webhook signature validation over the raw body, and event/completion idempotency adapter boundaries.
- Added a strict-origin HTTPS browser API handler. Webhooks use their raw-body signature and do not rely on browser CORS.
- Cart changes are disabled while checkout is open. After verified completion the client decrements only captured line IDs/quantities still present; uncertain lines remain for Shopify rehydration.

## Configuration and activation

Frontend variables are documented in `.env.example`. The GitHub Pages workflow pins `VITE_RAZORPAY_MAGIC_ENABLED=false` and continues to default the provider to `disabled`.

The backend uses `readRazorpayMagicServerConfig()` and requires all of:

- `RAZORPAY_MAGIC_ENABLED=true`
- `RAZORPAY_MAGIC_AUTHORIZED=true`
- `RAZORPAY_MAGIC_TEST_MODE_SUPPORTED=true` when `RAZORPAY_MODE=test`
- server-only Key ID, Key Secret and Webhook Secret
- a Shopify Storefront token and exact shop domain
- a durable store implementing preparation claims, checkout-session lookup, completion claims, and webhook event idempotency methods

A local-only Node server and file-backed single-process store are now available for connectivity and adapter testing. The store is not suitable for multi-instance/serverless deployments. No hosted backend is configured.

## Merchant-dependent checks

Razorpay's headless Shopify guide says the Integration Team must connect the Shopify store to the Razorpay MID by creating the Magic app and authorizing it; otherwise Magic API requests return `Authorization Failed`. The guide's prerequisites and examples specify live keys. Test mode therefore stays disabled until Razorpay confirms that the merchant-linked Magic endpoints support the intended test credentials.

The Shopify cart token is derived only from the documented `gid://shopify/Cart/<token>?key=...` structure. Confirm this exact identifier format with the merchant integration before activation. Razorpay's example requires safe numeric product and variant IDs; the adapter rejects IDs that cannot be represented exactly.

## Verification status

- Automated tests use mocked Razorpay and Shopify responses; they do not create a live or sandbox transaction.
- Production build is run locally, but no deployment is performed.
- The local service supports `GET /health` and uses `http://localhost:3001`; start it with `npm run backend:dev`.
- The local backend environment keeps Magic API calls disabled and authorization false. The development storefront stays on `VITE_CHECKOUT_PROVIDER=disabled`.
- No public webhook URL, hosted backend, MID authorization, or enabled Magic app is configured here.
- No customer payment is enabled by default.


## Local development service

Copy `backend/.env.example` to `backend/.env`, then provide backend-only credentials there. `backend/.env` is ignored by Git and loaded by Node with `--env-file`; it is never read by Vite. Start Vite and the backend in separate terminals with `npm run dev` and `npm run backend:dev`. Check `http://localhost:3001/health`. The server binds to `127.0.0.1`, permits only the configured local storefront origin, and does not call Razorpay while Magic activation is disabled.

The JSON store is local development infrastructure only. It is not production-grade shared persistence. Do not enable Magic API calls until Razorpay confirms Shopify MID linking and test-mode support and a production backend with durable atomic storage is deployed.
