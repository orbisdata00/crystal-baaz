Crystal Baaz — MAIN hierarchy and shopping update

Implemented the final green/yellow/white/light-grey theme while retaining Crystal Baaz's name and gem identity. Homepage discovery, homepage sections, desktop category navigation and parent sidebar use the eight MAIN roots in workbook order. MAIN audit and explicit pending memberships are recorded in ../main-sheet-audit.json. Category artwork was not supplied: 160 main/auxiliary controls are listed in ../category-icon-checklist.json; no product images were substituted as category artwork. New Arrivals remains pending because a genuine selection is not established.

Shopping changes include a shared mobile control coordinator, confirmed Shopify cart updates and totals, compact product pages with actual variants/gallery, safe native sharing/clipboard fallback, and an eligible dismissible PWA install sheet. No checkout, payment integration, Shopify Admin changes or publishing was performed. Related products use shared explicit memberships; purchase-history recommendations were not fabricated.

Verification:
- npm test: 44 tests passed.
- Production build passed. Vite reports a main-chunk size warning (about 606 kB raw / 132 kB gzip); the separate workbook preview chunk is not loaded by the live shopping flow.
- production-audit.json: 36 responsive measurements across all 16 requested widths, no horizontal overflow, no browser runtime warnings/errors.
- Real Storefront cart sequence 0 → 1 → 2 → 1 → 0 passed; the temporary test item was removed.
- Verified actual multi-variant selection, modal/control suppression and restoration, install dismissal persistence, search, offline error with zero stale product cards, and no workbook fallback fetch.
- Cart/share failure, retry, hydration, duplicate input lock, quantity reconciliation and safe sharing branches are covered by mocked unit tests.

Screenshots in this directory show the final homepage, product, product with cart, category overview, full cart and install sheet at 400px, plus desktop product layout. The supplied screenshots were the visual reference: direct Blinkit browsing returned its anti-bot page (reference captures retained here). Native installation, iOS Safari instructions and OS share dialogs still need physical-device verification; browser eligibility/dismissal was exercised with controlled events.

Storefront query fields were checked against Shopify's primary schema documentation:
https://shopify.dev/docs/api/storefront/latest/objects/CartLineCost
https://shopify.dev/docs/api/storefront/latest/objects/CartCost

No private cart identifiers or credentials are included in the sharing payload or this report.
