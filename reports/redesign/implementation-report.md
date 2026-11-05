# Crystal Baaz shopping redesign — 5 November 2026

Implemented locally using the existing React/Vite application. Checkout remains disabled. No publication or Shopify catalog edits were performed.

## Implemented shopping experience

- Compact burgundy, cream and gold shopping header with prominent search and debounced live-product suggestions.
- Text category discovery, compact product rails with a partially visible next card, and shared Shopify product cards with ADD, unavailable/out-of-stock states, quantity controls and variant selection.
- One reusable hierarchy for desktop and PWA. State A keeps parent navigation on the left and the selected parent's declared children on the right. State B keeps sibling navigation on the left, with active selection, filters, sort and incremental rendering on the right. Parents without declared children open their direct listing.
- Category and product panes scroll independently. Browser back/forward and direct hash-route refresh preserve category context. The mobile grid has two columns on standard phone widths; desktop has four or more where space allows.
- Compact product detail, verified Shopify descriptions and variants, search, persistent wishlist, desktop cart drawer and mobile cart interface. Dialogs lock background scrolling and retain keyboard focus.
- Accounts, order lookup and unconfirmed store policies display accurate unavailable/pending information rather than simulated functionality.

## Shopify data boundary

Shopify is now the default source; explicit workbook preview remains available in code. Only relationship metadata and SKU matching are taken from the workbook in live mode. Titles, prices, compare-at values, descriptions, availability and images come from Shopify. Missing images display a neutral unavailable-image state. Missing Shopify copy/media is never filled from workbook product records.

Live browser verification loaded **1,520 Shopify products**, all matched to workbook handles; **3 workbook products were absent from Shopify**. Unverified variants retain disabled purchase actions. Cart synchronization re-fetches product/variant details, reconciles inventory-adjusted quantities, and uses Shopify's returned subtotal. Invalid variants are rejected without silently choosing a different variant.

The initial JavaScript bundle is approximately **566 KB (124 KB gzip)**, down from approximately 4.8 MB. The full workbook is a separate optional lazy chunk and was **not requested in active Shopify mode**, verified in production Chrome. The live index fetch uses paginated GraphQL requests, small variant/image selections and omits full descriptions until product details are requested. Vite still emits its size warning for the main and optional preview chunks.

## Browser and automated verification

- **26 automated tests passed**, including source separation, SKU approval, cart behavior, hierarchy safety and cached service response consistency.
- [Responsive Chrome audit](browser-audit.json): **12 parent categories, 202 category/leaf selections, 14 viewport widths, zero failures**. Every displayed product was checked against its explicit membership. Sibling switching, back/forward, direct refresh, filtering, sorting, search and wishlist passed.
- Desktop widths: 1024, 1280, 1366, 1440, 1600 and 1920. Mobile/tablet widths: 320, 360, 375, 390, 414, 427, 440 and 768.
- Live Shopify cart: add, quantity 1→2, server subtotal ₹11,900→₹23,800, reload persistence and removal passed. The test cart was emptied afterward; no order/payment was placed.
- [Production audit](production-audit.json): manifest/icons returned 200, service worker activated and controlled the app, standalone display declared, no preview product chunk requested, API failure showed Retry without fallback, Retry recovered, and offline mode showed an accurate error with no product cards. No runtime exceptions were recorded.
- [Final account/dialog check](final-ui-check.json): compact account screens at 390/1440px and variant dialog scroll locking, Tab focus containment and Escape dismissal passed against the final production bundle.
- Production build passed. Native installation on physical iOS/Android devices was not performed; installability metadata and service-worker behavior were checked in desktop Chrome.

## Blinkit and client-sketch comparison

[Visual comparison of both client sketches and implemented states](sketch-comparison.html).

Chrome attempted Blinkit at desktop/mobile widths but received its Cloudflare “Just a moment…” challenge. The browser challenge screenshots and [reference attempt measurements](blinkit-reference-audit.json) are retained. The client's supplied Blinkit screenshots were used for sidebar proportions, compact cards, partial next-card visibility, variant sheets and cart interactions. Public Blinkit HTML/CSS was also accessible; its 86px desktop header informed the shopping header proportions. Interactive reference measurements beyond the challenge could not be collected. No Blinkit artwork, brand colors or proprietary fonts were copied; the existing DM Sans font is retained.

## Source-data requirements still pending

The requested **Mala → Pearl Mala → Ruby Mala flow cannot be completed from the supplied relationships**. Mala has **138 verified live products**, but no declared child categories or Pearl/Ruby product assignments. It opens a direct listing with Mala highlighted in the parent sidebar. No fixed count of 25 or guessed child mappings was introduced. Missing-child URLs return an accurate unmapped-category state.

Other relationship gaps are documented in the [hierarchy audit](../category-hierarchy-audit.json): Zodiac sign names have no explicit product memberships; broad Rudraksha child collections lack parent scope; Rashi Rings is a leaf group, and Rashi Pendants has no explicit products. Fourteen title-search links were excluded from the verified hierarchy instead of being treated as collection assignments.

**209 icon slots** await actual client assets. All category controls remain usable as text. Add approved assets to `src/data/category-icons.json` using the keys in the [icon checklist](../category-icon-checklist.json). Product photos and generated artwork are not substituted for client category icons.

To enable the full Mala example, the client needs to confirm the child-category hierarchy and supply the corresponding Shopify product handles or SKUs, plus approved category icon assets.

## Screenshots

| Surface | Mobile | Desktop |
|---|---|---|
| Home | [390px](production-home-390.png) | [1440px](production-home-1440.png) |
| State A: parent overview | [390px](production-overview-390.png) | [1440px](production-overview-1440.png) |
| State B: Pooja → Shaligram | [390px](production-products-390.png) | [1440px](production-products-1440.png) |
| Mala: verified leaf listing | [390px](mala-products-390.png) | [1440px](mala-products-1440.png) |
| Shopify cart | [390px](cart-mobile-390.png) | [1440px](cart-desktop-1440.png) |

Additional captures: [product detail](product-detail-390.png), [variant selector](variant-selector-390.png), [partial next card](product-rail-390.png), [Shopify error/Retry](shopify-error-retry-390.png), [offline](offline-390.png).

## Modified implementation files

- `src/shopping-ui.js`, `src/shopping.css`: shopping components and responsive layout.
- `src/category-hierarchy.js`, `src/data/category-icons.json`: reusable verified navigation and centralized asset mapping.
- `src/app.js`: shared app state, new surfaces, route integration, loading/retry/offline handling, cart error recovery.
- `src/catalog.js`, `src/catalog-service.js`, `src/config.js`, `src/shopify.js`, `src/cart.js`: Shopify defaults, strict data boundary, cached result contract fix, fresh cart verification and smaller catalog index requests.
- `src/data/catalog-registry.json`, `src/data/product-mapping.json`: lightweight relationship/SKU manifests; full workbook remains separate.
- `index.html`, `public/service-worker.js`: shopping metadata/style and service-worker cache invalidation.
- `tests/storefront.test.mjs`, `tests/category-hierarchy.test.mjs`: regression coverage.
- `scripts/audit_category_hierarchy.mjs`, `scripts/cdp-client.mjs`, `scripts/audit_shopping_redesign.mjs`, `scripts/audit_production_shopping.mjs`, `scripts/audit_final_shopping_ui.mjs`: reproducible reports and Chrome checks.

[Consolidated verification summary](verification-summary.json). Final production script: `index-BwZ_elEz.js`.
