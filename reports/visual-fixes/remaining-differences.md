# Remaining differences and client data gaps

- **Category artwork:**162 main/auxiliary category controls lack approved artwork. They deliberately use compact text controls. Supplying actual category artwork is required for Blinkit's image-first discovery density; no unrelated product photograph was substituted. Registry/checklist: `src/data/category-icons.json` and `reports/category-icon-checklist.json`.
- **Product media:**41 products have no Shopify image;37 have only the verified care sheet. Actual product photographs must be supplied/approved by the merchant. Admin records were not modified. Unknown gallery metadata is preserved rather than guessed to be photography.
- **New Arrivals:**approval/product list remains missing. The section stays second and compact without arbitrary products.
- **Pearl/Ruby Mala:**requested navigation exists and sibling switching works, but product assignments and artwork are pending. Other unsupported Mala types remain uncreated.
- **Brand imagery:**the user-approved Crystal Baaz banners depict jewellery/crystals and differ from Blinkit's groceries. Two approved source banners supply the wide hero and responsive secondary crops; no new promotional artwork or offer claims were fabricated.
- **Header/navigation:**Crystal Baaz keeps its exact eight-root category navigation and omits unsupported delivery/location claims. This adds a navigation row and changes the reference header's composition intentionally.
- **Footer:**existing About/Contact/FAQ/policy routes are linked; content approval for the informational pages remains as previously configured. Social URLs and app-store listings were not supplied and are omitted. PWA installation appears only when supported.
- **Typography:**existing DM Sans is retained. Blinkit's proprietary fonts/assets were not copied.
- **Browser reference:**live Blinkit Chrome screenshots were blocked at400 and1440 CSSpx. Supplied screenshots provide the comparison baseline; their original CSS viewport/DPR cannot be independently established. The report does not claim a literal pixel-identical result.
- **Native device checks:**physical iOS/Android installation and OS share sheets require device verification. Controlled install/share branches, actual desktop/mobile CSS layouts and Shopify cart operations were tested.
- **Build:**production build passes with the existing >500kB main-chunk warning. No payment/order/publishing actions were performed.
