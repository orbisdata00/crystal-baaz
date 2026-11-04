import { selectProducts } from "./catalog.js";

export const categoryTabs = [
  { label: "All", icon: "grid", href: "#collections" },
  { label: "Bracelets", icon: "bracelet", href: "#collection/bracelets" },
  { label: "Rings", icon: "ring", href: "#collection/rings" },
  { label: "Pendants", icon: "pendant", href: "#collection/pendants" },
  { label: "Home Decor", icon: "home", href: "#collection/home-decor-vastu" },
  { label: "Spiritual", icon: "sparkle", href: "#nav/Puja" },
  { label: "Rudraksha", icon: "sparkle", href: "#nav/Rudraksha" },
  { label: "Crystals", icon: "sparkle", href: "#crystals" },
  { label: "Puja", icon: "sparkle", href: "#nav/Puja" },
];

export const discoverySections = [
  {
    id: "crystal-categories",
    title: "Crystal Categories",
    items: [
      { id: "tumbles-and-chips", title: "Tumble Stones & Chips", collectionHandles: ["tumbles"], imageHandles: ["tumbles"], imageMatch: "tumble", note: "Tumbles mapped; chips have no separate collection." },
      { id: "crystal-bracelets", title: "Crystal Bracelets", collectionHandles: ["bracelets"], imageHandles: ["bracelets"], imageMatch: "bracelet" },
      { id: "crystal-towers-points", title: "Crystal Towers & Points", collectionHandles: ["pencil-towers"], imageHandles: ["pencil-towers"], imageMatch: "pencil", note: "Towers mapped; points have no separate collection." },
      { id: "crystal-spheres-shapes", title: "Crystal Spheres & Shapes", collectionHandles: ["sphere"], imageHandles: ["sphere"], imageMatch: "sphere", note: "Spheres mapped; other shapes are not a separate collection." },
      { id: "crystal-rings", title: "Crystal Rings", collectionHandles: ["rings"], imageHandles: ["rings"], imageMatch: "ring" },
      { id: "crystal-pendants", title: "Crystal Pendants", collectionHandles: ["pendants"], imageHandles: ["pendants"], imageMatch: "pendant" },
      { id: "statues-god-idols", title: "Statues & God Idols", collectionHandles: ["statue-murti", "ganesh-ji-murti"], imageHandles: ["ganesh-ji-murti", "statue-murti"], imageMatch: "murti" },
      { id: "home-decor-vastu", title: "Home Decor & Vastu", collectionHandles: ["home-decor-vastu"], imageHandles: ["home-decor-vastu"], note: "Collection exists, but has no mapped products yet." },
    ],
  },
  {
    id: "intentions",
    title: "By Intention",
    note: "Shopping themes from workbook collection names and product titles; they do not verify health, financial, or other outcomes.",
    items: [
      { id: "protection-negativity", title: "Protection & Negativity Shield", collectionHandles: ["nazar"], imageHandles: ["nazar"], imageMatch: "obsidian bracelet" },
      { id: "wealth-abundance", title: "Wealth & Abundance", collectionHandles: ["money"], imageHandles: ["money"], imageMatch: "pyrite bracelet" },
      { id: "love-relationships", title: "Love & Relationships", collectionHandles: ["love"], imageHandles: ["love"], imageMatch: "rose quartz bracelet" },
      { id: "chakra-balance", title: "Chakra Healing & Balance", searchTerm: "7 chakra", imageMatch: "7 chakra", note: "Product-title matches only; claims are unverified." },
      { id: "healing-wellness", title: "Healing & Wellness", searchTerm: "healing", note: "Product-title matches only; claims are unverified." },
      { id: "peace-calm", title: "Peace & Calm", searchTerm: "peace and calm", note: "Product-title matches only; claims are unverified." },
      { id: "success-career", title: "Success & Career", searchTerm: "success", note: "Product-title matches only; claims are unverified." },
      { id: "good-luck-beginnings", title: "Good Luck & New Beginnings", searchTerm: "luck", note: "Product-title matches only; claims are unverified." },
    ],
  },
  {
    id: "more-to-explore",
    title: "More to Explore",
    items: [
      { id: "rudraksha-products", title: "Rudraksha", searchTerm: "rudraksha", imageMatch: "rudraksha", note: "Exact product-title matches only; no collection assignment is inferred." },
      { id: "malas-jap-mala", title: "Malas & Jap Mala", collectionHandles: ["mala", "jaap-mala"], imageHandles: ["mala", "jaap-mala"], imageMatch: "mala" },
      { id: "keyrings-accessories", title: "Keyrings & Accessories", collectionHandles: ["keyrings"], imageHandles: ["keyrings"], imageMatch: "keyring" },
      { id: "crystal-sprays-oils", title: "Crystal Sprays & Oils", collectionHandles: ["aura-spray"], imageHandles: ["aura-spray"], imageMatch: "spray", note: "Sprays mapped; oils have no separate collection." },
      { id: "gift-sets-combos", title: "Gift Sets & Combos", collectionHandles: ["gifts", "sets"], imageHandles: ["gifts", "sets"], imageMatch: "gift", note: "Gift and set collections mapped; combo mapping needs review." },
      { id: "puja-essentials", title: "Puja Essentials", collectionHandles: ["shaligram", "ganesh-ji-murti", "shivling", "yantra", "jaap-mala", "diyas"], imageHandles: ["shaligram", "ganesh-ji-murti", "shivling", "yantra", "jaap-mala", "diyas"], imageMatch: "shaligram", note: "Products come from these six workbook collections." },
    ],
  },
];

export const discoveryById = new Map(discoverySections.flatMap((section) => section.items.map((item) => [item.id, item])));

export function selectDiscoveryProducts(products, item) {
  const selected = new Map();
  for (const handle of item?.collectionHandles || []) {
    for (const product of selectProducts(products, { filter: { kind: "collection", value: handle } })) selected.set(product.id, product);
  }
  if (item?.searchTerm) {
    const terms = String(item.searchTerm).toLowerCase().split(/\s+/).filter(Boolean);
    for (const product of products) {
      const text = `${product.title || ""} ${product.handle || ""} ${product.type || ""} ${(product.collectionTitles || []).join(" ")}`.toLowerCase();
      if (terms.every((term) => text.includes(term))) selected.set(product.id, product);
    }
  }
  return [...selected.values()];
}

export function discoveryHref(item) {
  if (item.searchTerm) return `#search/${encodeURIComponent(item.searchTerm)}`;
  if (item.collectionHandles?.length === 1) return `#collection/${encodeURIComponent(item.collectionHandles[0])}`;
  return `#discovery/${encodeURIComponent(item.id)}`;
}
