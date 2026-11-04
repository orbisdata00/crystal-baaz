# Crystal Baaz

Responsive React storefront and installable PWA preview built from the client’s product workbook. The mobile homepage opens with search, horizontal category tabs, and four-column pastel discovery grids. Product and collection discovery, search, sorting and collection filters, product details, a local wishlist and preview bag, and a Shopify Storefront API adapter are included. Account and order routes are present as disabled setup placeholders until customer authentication is configured. Catalog records are marked preview-only. Checkout is disabled until merchant settings and product data are approved.

## Workbook import and review

Run the importer with the client workbook:

```sh
npm run catalog:import -- "/path/to/New Website Product Catalog.xlsx"
```

The importer reads all 10 worksheets and produces the storefront fixture at `src/data/client-catalog.json`, plus auditable mappings and exception reports under `reports/catalog/`:

- `canonical-products.json`, `canonical-variants.json`, and `canonical-memberships.json` preserve grouped source records, SKU rows, and explicit collection assignments with source row references.
- `canonical-collections.json` retains the 111 workbook collection handles and target counts.
- `canonical-navigation-groups.json` keeps the client-curated SKU groups separate from collection records.
- `catalog-validation-report.csv` summarizes workbook counts and blockers; `unresolved-items.csv` lists affected source rows and details.
- `home-discovery-mapping.csv` records the exact collection or title-search sources used for homepage discovery tiles, including partial and empty mappings.
- `import-preview.html` provides a static visual audit of the mapped catalog.
- `reports/screenshots/` contains responsive captures and `responsive-audit.json` for the 320–1440px viewport audit. Run `node scripts/capture_responsive_audit.mjs` with a local preview and Chrome DevTools on port 9223 to refresh them.

Exact collection labels and unique SKU references are mapped. Prose-based rules, duplicate SKU values, missing mappings, and count mismatches remain unresolved for client review. The storefront fixture omits raw descriptions and inventory and does not treat source image URLs as rights- or reachability-verified.

The discovery page uses only workbook collection memberships and product-title matches. Incomplete mappings, such as Home Decor & Vastu with no assigned products, remain visible in the mapping report. The source screenshot referenced in the design request was not present in the supplied attachment directory, so the written colors and layout description were used; the screenshots are not represented as pixel-perfect comparisons.

## PWA

`public/manifest.webmanifest` defines the installable app identity, icons, standalone display mode, and warm-white theme. A service worker caches the public app shell and same-origin static files, with a small offline fallback page. Checkout, inventory updates, private data, and third-party payment pages are not cached or available offline. The mobile bottom navigation includes Home, Categories, Search, Wishlist, and Cart, with device safe-area padding.

## Shopify and payments

`src/config.js` intentionally contains no store domain or Storefront API token. When supplied, configure only the merchant’s public Storefront API access token there. The Storefront adapter uses Shopify API version `2026-10`; it does not contain an Admin API token or write catalog data to Shopify.

Juspay setup is not included because merchant, Shopify, region, and payment compatibility details have not been provided. Checkout remains disabled in the private preview; no live payments or orders can be created from it.

## Local development

Use Node.js 20.19 or newer. Run `npm install`, then `npm run dev` to open the local preview. Run `npm test` for catalog, discovery, routing, cart, and Storefront adapter checks. `npm run build` creates the static production build in `dist/`; `npm run preview` serves that build locally.
# crystal-baaz
