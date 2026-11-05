# Crystal Baaz visual corrections

The mobile image viewer, homepage composition and shared shopping proportions were corrected in the local React checkout. The existing Shopify cart, exact eight MAIN roots, disabled checkout and local-only scope are preserved.

## Issues, causes and corrections

| Area | Root cause observed | Correction |
| --- | --- | --- |
| Mobile image viewer | The previous viewer lived inside the product page and reused a translucent flex backdrop. The large inline photo remained visible beneath the viewer; the active image lacked a dedicated centered stage. Background scroll and modal history were uncontrolled. | A dedicated body portal, opaque full-screen grid, one active image, contained sizing, safe-area padding, focus containment, background `inert`, body scroll lock, synchronized gallery index, swipe/arrow navigation, Escape/close and a same-route history entry. Closing restores the original scroll position and contextual controls. |
| Desktop header | Small shared header/search proportions; cart displayed only a label/count. | Larger logo/search/control regions, aligned Account action, and actual Shopify item count plus confirmed total. Pending/error totals are explicitly unconfirmed. No delivery-time or location claims were added. |
| Hero | Plain text-only yellow panel and no secondary campaign row. | Wide approved campaign image plus three compact secondary cards using crops of the two existing approved Crystal Baaz banners. Copy links to real category routes without fabricated offers. Both assets were explicitly approved by the user in this session. |
| Categories | Empty-looking, padded text rectangles while all category artwork was missing. | Compact text-only controls without empty image containers. A consistent image-led style is available when approved icon URLs are supplied. Exact MAIN order remains unchanged. |
| Product cards | Image area derived from card width, variable vertical weight, title baselines and option rows shifting price controls. | Shared 176px desktop rail cards, controlled 144px image region, aligned two-line titles, reserved variant text, aligned prices/ADD and anchored option links. Mobile rails retain next-card previews; category product grids retain two columns. Desktop rail arrows added. |
| Product media | Bulk queries previously retrieved only the first image; featured/gallery metadata was not retained. Source omissions and document-only galleries were mixed with screenshot/lazy-loading blanks. | Query featured image plus complete product-gallery pagination (including the actual35-image Navratan gallery), deterministic same-product selection, cache schema bump, Shopify CDN width requests, fixed image regions and neutral unavailable states. Full-page visual captures scroll and await images rather than capturing unloaded lazy regions. |
| Discounts | Uniform badges were not backed by a dedicated source audit; currency metadata was not retained for display validation. | Strict finite positive selling/compare values, compare greater than selling, and identical currency checks. Actual Shopify prices were not changed. |
| Cart feedback | Success toast was anchored near the bottom and obscured View Cart in the final screenshot review. | Toast now appears below the header with pointer events disabled, clear of cart/purchase controls. Browser assertions check this separation. |
| New Arrivals | Large grey pending panel interrupted product discovery. | Small clean pending state, still second in the MAIN section order. No arbitrary products or arrival ranking added. |
| Footer | Sparse branding and four links. | Multi-column brand, existing information routes, wishlist and eight verified category links. Installation action appears only where supported. No fake social, policy, delivery or app-store links. |
| Mala example | Pearl/Ruby requested navigation previously ended in an unknown-category state. | Explicitly requested Pearl/Ruby navigation slots and sibling switching now show accurate pending membership states. No product assignments were inferred. Main roots were not expanded. |

## Shopify source audit

Read-only Storefront audit: **1,520 products and 1,929 complete variants**. All **1,929 variants genuinely round to 76%** from their individual same-currency selling/compare-at values; this is a merchant source-data pattern, not a universal hardcoded discount.

- **41 products** have no Shopify image.
- **37 products** have only the merchant's verified `Vidhi_1` care-sheet image, with no alternate product photograph. Their genuine image remains unchanged and they are flagged for client review.
- **48 screenshot-relevant selected URLs** were checked with HTTP HEAD: all returned 200 (18 PNG, 30 JPEG).
- No safe alternate-photo substitution was required by the current metadata rule. Unknown media is retained; the heuristic does not claim visual certification of every image.
- The CSV records every product's featured image, selected image, gallery, provenance/review status, price-validation counts and probe status. Full galleries and variants were paginated in the independent audit.

See [shopify-image-audit.csv](shopify-image-audit.csv) and [discount-findings.json](discount-findings.json).

## Validation

- `npm test`: **50/50 passed**.
- Production Vite build passed; the existing main bundle size warning remains (~613kB raw, ~134kB gzip). Workbook preview remains a separate lazy chunk and is not invoked in Shopify mode.
- Production Playwright audit: **70 responsive measurements, eight mobile gallery regressions, zero runtime issues and zero failed assertions**. Installed Google Chrome, DPR1 and 100% browser zoom: all requested widths (320,360,375,390,400,414,427,440,1024,1280,1366,1440,1600,1920).
- Production browser audit covers homepage, both category states, PDP/cart controls, all eight roots, pending Pearl/Ruby siblings, actual variant selection, wishlist, search, actual Shopify cart 0→1→2→1→0, safe share payload, install suppression/restoration and offline states.
- Specific 5 Mukhi regression covers one active image, body-level portal, opaque backdrop, contained sizing, scroll lock/restoration, close and browser Back at all eight mobile widths. The live product has one gallery image; its arrows correctly disable. A separate Blue Agate multi-image test covers switching, swipe and Escape.
- Largest gallery check: `navratan-pendant-6` renders all35 thumbnails, opens `1 / 35`, switches to `2 / 35`, and closes. See `full-gallery-check.json`.
- No Shopify Admin edits, checkout enablement or publication.

See [responsive-audit.json](responsive-audit.json), [mobile-gallery-audit.json](mobile-gallery-audit.json) and [before-after.html](before-after.html).

## Changed implementation

`src/product-gallery.js`, `src/product-media.js`, `src/shopping-ui.js`, `src/shopping.css`, `src/shopping-experience.js`, `src/catalog.js`, `src/shopify.js`, `src/app.js`, `src/category-hierarchy.js`, related tests/audit scripts, service-worker version and PWA vector renders.

## Comparison limits

The supplied Blinkit captures are the visual baseline. Equivalent 400×850 and1440×850 live Chrome attempts were blocked by the reference site's challenge, recorded in `reference-access.json`. Source screenshot CSS viewport/DPR is not encoded in the attachments, so the comparison page scales supplied captures to equal display widths and labels them. Current Crystal Baaz component dimensions are measured in CSS pixels in the responsive audit. This does **not** establish pixel-perfect identity, and no such claim is made.
