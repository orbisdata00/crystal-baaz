# Mobile product tile refresh

`comparison.html` pairs the supplied current PWA capture with the updated 375 CSS px product rail. The original screenshot is kept intact; its saved pixel dimensions are known, but its original CSS viewport and DPR are not.

## Chrome measurements

- The app rendered with `data-catalog-source="shopify"` and `data-catalog-loaded="true"`; no preview catalog or fallback product records were used. The home page showed 68 product cards.
- At all requested widths (320, 360, 375, 390, 400, 414, 427, and 440 CSS px), the page had no horizontal overflow. The image, wishlist, and ADD/quantity controls were inside the image tile; price and title were outside it.
- At 375 CSS px, the image tile measured 105 × 146 CSS px, the bold title measured 12 px/700, the selling price 13 px/700, and the floating navigation 345 × 68 CSS px with a 999 px radius.
- The rails show several items and a visible image preview of the next card. Wishlist and ADD/quantity controls remain hidden until a tile is fully in view, so rail clipping never cuts through a control. Individual screenshots for the home view and product rail are saved for all eight widths; `responsive-measurements.json` contains element bounds and computed styles.
- The production build was previewed at 375 CSS px. Its manifest loaded, the service worker activated, Shopify data rendered, and the product tile had no overflow. See `production-rail-375.png` and `production-measurements.json`.
- At 1440 CSS px, the desktop rail rendered with no overflow; the real Shopify variant sheet opened and listed two options. See `desktop-rail-1440.png` and `desktop-measurements.json`.
- The eight responsive screenshot pairs use the local Vite server; the production preview was separately checked at 375 px and confirmed the manifest and active service worker.
- Existing licensed DM Sans remains in use. The live Blinkit URL returned a Cloudflare access-denied page in Chrome; although the page exposed loaded Okra font faces, its product DOM was unavailable, so the report does not claim exact computed Blinkit product typography. No Blinkit font files were copied.

## Verification

- `npm test`: 53 tests pass, including the added product tile structure, cart quantity, discount, and mobile navigation checks.
- `npm run build`: passes. Vite reports the existing >500 kB bundle-size advisory.
- No live Shopify cart was mutated during browser review.
- Shopify checkout remains disabled; no Shopify Admin data or publishing actions were used.
