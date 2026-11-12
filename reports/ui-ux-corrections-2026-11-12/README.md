# Crystal Baaz UI corrections and QA

## Changes

- Removed SKU codes from customer-facing product, variant, PDP, wishlist, cart, and shared-cart text. Generic Shopify variants use neutral `Option N` labels; meaningful Shopify option values remain intact.
- Simplified product cards to one image/action tile, moved verified discounts onto the image, tightened card and section spacing, and added same-product image dots/swiping with adjacent-image preload.
- Fixed the gallery data gap: the full Shopify catalog query now requests up to five actual product images, which lets cards use the gallery data they already support.
- Kept the variant sheet responsive with a 44 × 44 px close control and separated image, option, availability, price, and action columns.
- Wishlist changes are announced only after storage succeeds, with active-heart state and add/remove toasts.
- Cart summaries use Shopify product thumbnails; totals stay marked unconfirmed until Shopify confirms them. Cart hydration now uses skeleton rows.
- Added an install/download icon and checked the iOS Add to Home Screen guidance.
- Kept INR formatting on the shared currency formatter with grouped whole-rupee values, removed visible product counts, and retained the New Arrivals three-row cap.
- Fixed the development JSON MIME mismatch. Vite now imports its transformed JSON module without a browser JSON assertion; Node and production keep the required JSON import attribute.
- Kept Shopify as the live source. New Arrivals remains in its honest pending state because the workbook does not yet confirm its product assignments.

## Merchant catalog correction report

`shopify-variant-corrections.csv` lists 400 generic Shopify variants across 117 products. It includes Shopify product and variant IDs, current option labels, and internal SKU references to help the merchant correct the option names in Shopify. It is a local QA artifact and is not shown to customers.

## Browser checks

- Verified live Shopify products render in the local storefront; no preview products were injected.
- Checked that rendered home, variant-sheet, and PDP text contains no `SKU:` labels or visible product counts.
- Opened the Blue Sapphire variant sheet: `Option 1` / ₹3,490 and `Option 2` / ₹3,890 fit within 390 px, with availability and no SKU text.
- Swiped a two-image product card; the image and active pagination dot advanced while the route stayed on home.
- Added and removed a wishlist item; the saved state returned to its original value, and both confirmation toasts appeared.
- Added a Shopify product to the cart, confirmed that Buy Now stayed on the home route and the actual Shopify thumbnail loaded, opened View Cart, then removed the test line. Checkout remained disabled.
- Emulated an iPhone Safari user agent and verified the install CTA opens the Add to Home Screen instructions with a 44 × 44 px close control.
- Checked for horizontal overflow at 320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440, and 1920 CSS px; none was found.
- These are headless Chrome checks and user-agent emulation. No physical iPhone, Android device, installed PWA, or Safari engine was available for verification.

## Automated checks

- `npm test`: 110 tests passed.
- `npm run build -- --outDir /tmp/crystal-baaz-build`: production build passed.
- `git diff --check`: clean at the time of this report.

## Captures

- `chrome-mobile-390.png` — 390 × 844 mobile storefront with live Shopify products and card image indicators.
- `chrome-desktop-1440.png` — 1440 × 1000 desktop storefront.
- `chrome-variant-sheet-390.png` — mobile variant selection sheet.
- `chrome-product-detail-390.png` — mobile PDP gallery and purchase controls.
- `chrome-view-cart-390.png` — confirmed Shopify thumbnail and current total in the sticky View Cart bar.
- `chrome-cart-390.png` — cart review during the reversible test add; the test line was removed afterward and checkout remained disabled.
- `chrome-install-ios-390.png` — iOS-install guidance in the mobile sheet.

The user-provided screenshots serve as the before/reference captures; these files are the after captures. No changes were published, no Shopify Admin records were edited, and checkout/payment was not enabled.
