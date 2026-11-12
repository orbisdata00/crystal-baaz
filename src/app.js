import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import { Icon } from "./Icon.js";
import { catalogGroups, collections, formatVariantLabel, navigation, productHash, selectProducts, zodiacSigns } from "./catalog.js";
import { addCartLine, calculateCart, changeCartQuantity, removeCartLine, selectVariant, reconcileShopifyCartLines, createBuyNowHandler } from "./cart.js";
import { categoryTabs, discoveryById, discoverySections, discoveryHref, selectDiscoveryProducts } from "./discovery.js";
import { catalogService } from "./catalog-service.js";
import { parseRoute } from "./routes.js";
import { loadPreviewCatalog } from "./catalog.js";
import { categoryParents, getParentCategory, hierarchyHref } from "./category-hierarchy.js";
import { useShopifyCart } from "./use-shopify-cart.js";
import { ShoppingExperience, useExperience } from "./shopping-experience.js";
import { ProductImage, ShoppingHeader, ShoppingHome, ShoppingBrowse, ShoppingResults, ShoppingProduct, ShoppingCart, ShoppingSharedCart, ShoppingFooter, ShoppingBottom, ShoppingInformation } from "./shopping-ui.js";
import { parseSharedCartItems } from "./cart-share.js";
import { customerAccount, useCustomerAccount } from "./customer-account.js";
import { CustomerAccountPage } from "./customer-account-ui.js";
import { formatCurrencyAmount } from "./money.js";

const html = htm.bind(React.createElement);
const money = (amount) => formatCurrencyAmount(Number(amount || 0), "INR", 0);
const productLabel = (product) => product.title?.trim() || "Product title pending";
const discountPercent = (price, compareAt) => Number(compareAt) > Number(price) && Number(price) > 0 ? Math.round((1 - Number(price) / Number(compareAt)) * 100) : 0;
function useProductImageFallback(event) {
  const image = event.currentTarget;
  image.hidden = true;
  if (!image.parentElement?.querySelector(".shopping-image-unavailable")) {
    const unavailable = document.createElement("span");
    unavailable.className = "shopping-image-unavailable";
    unavailable.setAttribute("role", "img");
    unavailable.textContent = "Image unavailable";
    image.insertAdjacentElement("afterend", unavailable);
  }
}
const collectionByHandle = new Map(collections.map((item) => [item.handle, item]));
const groupById = new Map(catalogGroups.map((item) => [item.id, item]));

function getItemProducts(products, item) {
  if (item.kind === "collection") return selectProducts(products, { filter: { kind: "collection", value: item.target } });
  if (item.kind === "group") return selectProducts(products, { filter: { kind: "group", value: item.target } });
  if (item.kind === "zodiac") return selectProducts(products, { filter: { kind: "zodiac", value: item.target } });
  if (item.kind === "search") return selectProducts(products, { query: item.target });
  return [];
}

function getNavigationProducts(products, group) {
  if (!group) return [];
  if (group.label === "New Arrivals") return [];
  if (group.target && collectionByHandle.has(group.target)) return selectProducts(products, { filter: { kind: "collection", value: group.target } });
  const items = [...(group.items || []), ...(group.formItems || [])];
  const found = new Map();
  for (const item of items) for (const product of getItemProducts(products, item)) found.set(product.id, product);
  return [...found.values()];
}

function getHomepageItemProducts(products, item) {
  if (!item) return [];
  if (item.kind !== "search") return getItemProducts(products, item);
  const term = String(item.target || "").trim().toLowerCase();
  if (!term) return [];
  const terms = term.split(/\s+/).map((word) => word.replace(/s$/, ""));
  return products.filter((product) => {
    const text = `${product.title || ""} ${product.handle || ""} ${product.type || ""} ${(product.collectionTitles || []).join(" ")}`.toLowerCase();
    return terms.every((word) => text.includes(word));
  });
}

function getHomepageGroupProducts(products, group) {
  if (!group) return [];
  const found = new Map();
  for (const item of [...(group.items || []), ...(group.formItems || [])]) {
    if (!["collection", "group", "zodiac"].includes(item.kind)) continue;
    for (const product of getHomepageItemProducts(products, item)) {
      if (product.title?.trim() && product.image && product.image !== "/assets/product-placeholder.svg") found.set(product.id, product);
    }
  }
  return [...found.values()];
}

function productFacets(product) {
  const values = [product.category, product.type, ...(product.collectionTitles || [])];
  for (const attribute of product.attributes || []) {
    if (attribute.value) values.push(...String(attribute.value).split(",").map((value) => value.trim()));
  }
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function matchesProductFacet(product, facet) {
  return !facet || productFacets(product).some((value) => value.toLowerCase() === facet.toLowerCase());
}

function Logo({ onHome }) {
  return html`<button className="brand brand-button" type="button" onClick=${onHome} aria-label="Crystal Baaz home">
    <span className="brand-mark"><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 3 34 12v16L20 37 6 28V12L20 3Z"/><path d="m6 12 14 7 14-7M20 19v18M13 7l7 12 7-12"/></svg></span>
    <span className="brand-name">crystal baaz<span className="brand-dot">.</span><small>client catalog preview</small></span>
  </button>`;
}

function MenuItem({ item, onSelect }) {
  const count = item.kind === "collection" ? collectionByHandle.get(item.target)?.actual_explicit_assignments : groupById.get(item.target)?.explicit_product_count;
  return html`<button className="mega-menu-link" type="button" onClick=${() => onSelect(item)}>
    <span>${item.label}</span><small>${count ? `${count} mapped` : item.kind === "zodiac" ? "View sign" : "Mapping in progress"}</small>
  </button>`;
}

function Header({ cartCount, savedCount, onCart, onWishlist, onAccount, onHome, onNavigate, onSearch, query, setQuery }) {
  const [openMenu, setOpenMenu] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const selectItem = (item) => {
    setOpenMenu(""); setMobileOpen(false); setSearchOpen(false);
    if (item.kind === "collection") onNavigate(`#collection/${encodeURIComponent(item.target)}`);
    else if (item.kind === "group") onNavigate(`#group/${encodeURIComponent(item.target)}`);
    else if (item.kind === "zodiac") onNavigate(`#zodiac/${encodeURIComponent(item.target)}`);
    else onSearch(item.target);
  };
  const selectGroup = (group) => {
    setOpenMenu(""); setMobileOpen(false);
    if (group.label === "Bracelets" && collectionByHandle.has("bracelets")) onNavigate("#collection/bracelets");
    else onNavigate(`#nav/${encodeURIComponent(group.label)}`);
  };

  return html`<${React.Fragment}>
    <div className="announcement"><span>Crystal Baaz · client catalog preview</span><b>Catalog details are being validated</b><button type="button" onClick=${() => onNavigate("#collections")}>Browse collections <span>↗</span></button></div>
    <header className="site-header" id="top">
      <div className="header-inner">
        <button className="icon-button menu-toggle" type="button" aria-label=${mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded=${mobileOpen} onClick=${() => setMobileOpen(!mobileOpen)}><${Icon} name=${mobileOpen ? "close" : "menu"}/></button>
        <${Logo} onHome=${onHome}/>
        <div className="header-tools">
          <button className="icon-button account-tool" type="button" aria-label="Customer account, setup pending" onClick=${onAccount}><${Icon} name="user"/><span className="tool-label">Account</span></button>
          <button className="icon-button wishlist-tool" type="button" aria-label=${`Wishlist, ${savedCount} items`} onClick=${onWishlist}><${Icon} name="heart"/><span className="tool-label">Saved</span>${savedCount > 0 && html`<i className="saved-count">${savedCount}</i>`}</button>
          <button className="icon-button search-tool" type="button" aria-label="Search catalog" onClick=${() => { if (window.matchMedia("(max-width: 780px)").matches) onSearch(query); else setSearchOpen(!searchOpen); }}><${Icon} name="search"/><span className="tool-label">Search</span></button>
          <button className="icon-button bag-tool" type="button" aria-label=${`Bag, ${cartCount} items`} onClick=${onCart}><${Icon} name="bag"/><span className="tool-label">Bag</span>${cartCount > 0 && html`<i className="bag-count">${cartCount}</i>`}</button>
        </div>
      </div>
      <nav className="main-nav" aria-label="Main navigation">
        ${navigation.map((group) => html`<div key=${group.label} className=${`nav-mega ${openMenu === group.label ? "is-open" : ""}`} onMouseEnter=${() => setOpenMenu(group.label)} onMouseLeave=${() => setOpenMenu("")}>
          <button type="button" className="nav-mega-trigger" aria-expanded=${openMenu === group.label} onClick=${() => selectGroup(group)}>${group.label}<span className="nav-chevron" aria-hidden="true">⌄</span></button>
          <div className="mega-menu" aria-label=${`${group.label} links`}>
            <div className="mega-menu-intro"><span className="eyebrow">BROWSE BY CATEGORY</span><h3>${group.label}</h3><p>Links and product groupings follow the client workbook. Unmapped categories stay marked for review.</p><button type="button" className="text-link" onClick=${() => selectGroup(group)}>View ${group.label} <span>↗</span></button></div>
            <div className="mega-menu-list">${(group.items || []).slice(0, 16).map((item) => html`<${MenuItem} key=${`${group.label}-${item.label}`} item=${item} onSelect=${selectItem}/>`)}
              ${group.formItems && html`<div key=${`${group.label}-form-heading`} className="mega-menu-subhead">Shop by product form</div>${group.formItems.slice(0, 10).map((item) => html`<${MenuItem} key=${`${group.label}-form-${item.label}`} item=${item} onSelect=${selectItem}/>` )}`}
            </div>
          </div>
        </div>`)}
      </nav>
      ${searchOpen && html`<div className="search-panel"><form className="search-form" onSubmit=${(event) => { event.preventDefault(); onSearch(query); setSearchOpen(false); }}><${Icon} name="search"/><input autoFocus value=${query} onChange=${(event) => setQuery(event.target.value)} placeholder="Search product names or collections" aria-label="Search product names or collections"/><button type="submit" className="button button--dark">Search</button><button type="button" className="icon-button" onClick=${() => setSearchOpen(false)} aria-label="Close search"><${Icon} name="close"/></button></form></div>`}
      ${mobileOpen && html`<nav className="mobile-nav" aria-label="Mobile navigation">
        <button className="mobile-nav-all" type="button" onClick=${() => { setMobileOpen(false); onNavigate("#collections"); }}>Browse all collections <span>↗</span></button>
        ${navigation.map((group) => html`<details key=${group.label} className="mobile-nav-group"><summary>${group.label}<span>＋</span></summary><div className="mobile-nav-links"><button type="button" onClick=${() => selectGroup(group)}>View ${group.label}</button>${(group.items || []).map((item) => html`<${MenuItem} key=${`${group.label}-mobile-${item.label}`} item=${item} onSelect=${selectItem}/>`)}${(group.formItems || []).map((item) => html`<${MenuItem} key=${`mobile-form-${item.label}`} item=${item} onSelect=${selectItem}/>` )}</div></details>`)}
      </nav>`}
    </header>
  </${React.Fragment}>`;
}

function SectionTitle({ eyebrow, title, note, action }) {
  return html`<div className="section-heading"><div><span className="eyebrow">${eyebrow}</span><h2>${title}</h2>${note && html`<p className="section-subtitle">${note}</p>`}</div>${action}</div>`;
}

function HomeSearch({ products, onSearch }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState(() => {
    try { return JSON.parse(localStorage.getItem("crystal-bazz-recent-searches") || "[]"); } catch { return []; }
  });
  const Recognition = typeof window === "undefined" ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
  const matches = query.trim() ? products.filter((product) => product.title?.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 4) : [];
  const collectionMatches = query.trim() ? collections.filter((collection) => collection.title.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 2) : [];

  const submit = (value = query) => {
    const term = value.trim();
    if (!term) return;
    const next = [term, ...recent.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem("crystal-bazz-recent-searches", JSON.stringify(next)); } catch { /* Storage is optional. */ }
    setFocused(false);
    onSearch(term);
  };
  const startVoiceSearch = () => {
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "en-IN";
    recognition.onresult = (event) => { const heard = event.results?.[0]?.[0]?.transcript || ""; setQuery(heard); submit(heard); };
    recognition.onerror = () => setFocused(true);
    recognition.start();
  };
  const showSuggestions = focused && (query.trim() ? matches.length + collectionMatches.length > 0 : recent.length > 0);

  return html`<section className="home-search-section" aria-label="Search the Crystal Baaz catalog">
    <form className="home-search" role="search" onSubmit=${(event) => { event.preventDefault(); submit(); }}>
      <${Icon} name="search" size=${20}/>
      <input value=${query} onFocus=${() => setFocused(true)} onBlur=${() => setTimeout(() => setFocused(false), 140)} onChange=${(event) => setQuery(event.target.value)} placeholder="Search for crystals, bracelets, rudraksha and more" aria-label="Search for crystals, bracelets, rudraksha and more" autoComplete="off"/>
      ${Recognition && html`<button className="voice-search" type="button" aria-label="Search by voice" onMouseDown=${(event) => event.preventDefault()} onClick=${startVoiceSearch}><${Icon} name="mic" size=${18}/></button>`}
      <button className="home-search-submit" type="submit" aria-label="Submit search"><${Icon} name="arrow" size=${18}/></button>
    </form>
    ${showSuggestions && html`<div className="home-search-suggestions" role="listbox" aria-label=${query.trim() ? "Search suggestions" : "Recent searches"}>
      ${!query.trim() && html`<span className="suggestion-heading">Recent searches</span>${recent.map((term) => html`<button type="button" key=${term} onMouseDown=${(event) => event.preventDefault()} onClick=${() => submit(term)}><${Icon} name="search" size=${14}/>${term}</button>`)}`}
      ${matches.map((product) => html`<button type="button" key=${product.id} onMouseDown=${(event) => event.preventDefault()} onClick=${() => submit(product.title)}><${Icon} name="search" size=${14}/><span>${product.title}</span><small>Product</small></button>`)}
      ${collectionMatches.map((collection) => html`<button type="button" key=${collection.handle} onMouseDown=${(event) => event.preventDefault()} onClick=${() => submit(collection.title)}><${Icon} name="grid" size=${14}/><span>${collection.title}</span><small>Collection</small></button>`)}
    </div>`}
  </section>`;
}

function CategoryTabs({ onNavigate, route }) {
  const isActive = (tab) => {
    if (tab.href === "#collections") return route.page === "home" || route.page === "collections";
    if (tab.href === "#crystals") return route.page === "crystals";
    if (tab.href.startsWith("#collection/")) return route.page === "collection" && route.handle === tab.href.split("/")[1];
    if (tab.href.startsWith("#nav/")) return route.page === "nav" && route.label.toLowerCase() === decodeURIComponent(tab.href.split("/")[1]).toLowerCase();
    return false;
  };
  return html`<nav className="category-tabs" aria-label="Shop by category">${categoryTabs.map((tab) => html`<button key=${tab.label} className=${`category-tab ${isActive(tab) ? "is-active" : ""}`} type="button" onClick=${() => onNavigate(tab.href)} aria-current=${isActive(tab) ? "page" : undefined} aria-label=${`Browse ${tab.label}`}><span className="category-tab-icon"><${Icon} name=${tab.icon} size=${21}/></span><span>${tab.label}</span></button>`)}</nav>`;
}

const mobileGroupTabs = [
  { label: "Category", icon: "grid", href: "#collections" },
  { label: "Crystal", icon: "sparkle", href: "#crystals" },
  { label: "Problem", icon: "heart", href: "#nav/Remedy" },
  { label: "Zodiac Sign", icon: "sparkle", href: "#zodiac" },
  { label: "Pooja", icon: "sparkle", href: "#nav/Puja" },
  { label: "Bracelets", icon: "bracelet", href: "#collection/bracelets" },
  { label: "Rudraksha", icon: "sparkle", href: "#nav/Rudraksha" },
];

const mobileCategoryItemKey = (item) => `${item.kind}:${item.target}`;

function buildMobileCategoryGroups() {
  const byLabel = new Map(navigation.map((group) => [group.label, group]));
  const rashiItems = byLabel.get("Rashi | Zodiac")?.items || [];
  const crystal = byLabel.get("Crystal");
  const unique = (items) => [...new Map(items.map((item) => [mobileCategoryItemKey(item), item])).values()];
  return [
    { label: "Category", icon: "grid", items: collections.map((item) => ({ kind: "collection", target: item.handle, label: item.title })) },
    { label: "Crystal", icon: "sparkle", items: unique([...(crystal?.items || []), ...(crystal?.formItems || [])]) },
    { label: "Problem", icon: "heart", items: unique(byLabel.get("Remedy")?.items || []) },
    { label: "Zodiac Sign", icon: "sparkle", items: unique(rashiItems.filter((item) => item.kind === "zodiac")) },
    { label: "Pooja", icon: "sparkle", items: unique(byLabel.get("Puja")?.items || []) },
    { label: "Bracelets", icon: "bracelet", items: unique(byLabel.get("Bracelets")?.items || []) },
    { label: "Rudraksha", icon: "sparkle", items: unique(byLabel.get("Rudraksha")?.items || []) },
  ];
}

const mobileCategoryGroups = buildMobileCategoryGroups();

function mobileCategoryHref(groupLabel, item = null) {
  const params = new URLSearchParams();
  params.set("group", groupLabel);
  if (item) params.set("category", mobileCategoryItemKey(item));
  return `#collections?${params.toString()}`;
}

const mobileCategoryShortcuts = [
  { label: "Rashi Rings", kind: "group", target: "group-rashirings" },
  { label: "Bracelets", kind: "collection", target: "bracelets" },
  { label: "Zodiac Bracelets", kind: "search", target: "Zodiac bracelets" },
  { label: "Mala", kind: "collection", target: "mala" },
  { label: "Earrings & Tops", kind: "collection", target: "earrings-tops" },
  { label: "Pendants", kind: "collection", target: "pendants" },
  { label: "Anklet", kind: "collection", target: "anklet" },
  { label: "Frames", kind: "collection", target: "frames" },
  { label: "Spheres & Balls", kind: "collection", target: "sphere" },
  { label: "Pyramids", kind: "collection", target: "pyramid" },
  { label: "Clusters", kind: "collection", target: "cluster" },
  { label: "Rings", kind: "collection", target: "rings" },
  { label: "Bangles", kind: "collection", target: "bangle" },
  { label: "Agate Slices", kind: "collection", target: "agate-slices" },
  { label: "Angels", kind: "collection", target: "angels" },
  { label: "Puja Essentials", kind: "collection", target: "shaligram" },
];

function MobileCategoryNavigation({ onNavigate, route, className = "" }) {
  const isActive = (item) => route.page === "collections"
    ? (route.group || "Category") === item.label
    : item.label === "Category"
    ? route.page === "home" || route.page === "group" || route.page === "discovery" || (route.page === "collection" && route.handle !== "bracelets")
    : item.label === "Crystal" ? route.page === "crystals" || route.handle === "crystal"
      : item.label === "Problem" ? route.page === "nav" && route.label?.toLowerCase() === "remedy"
        : item.label === "Zodiac Sign" ? route.page === "zodiac"
          : item.label === "Pooja" ? route.page === "nav" && route.label?.toLowerCase() === "puja"
            : item.label === "Bracelets" ? route.page === "collection" && route.handle === "bracelets"
              : route.page === "nav" && route.label?.toLowerCase() === "rudraksha";
  const selectGroup = (item) => {
    const group = mobileCategoryGroups.find((candidate) => candidate.label === item.label);
    if (group) onNavigate(mobileCategoryHref(group.label));
    else onNavigate(item.href);
  };
  return html`<nav className=${`mobile-category-navigation ${className}`} aria-label="Browse product groups">${mobileGroupTabs.map((item) => html`<button key=${item.label} type="button" className=${`mobile-category-pill ${isActive(item) ? "is-active" : ""}`} aria-current=${isActive(item) ? "page" : undefined} onClick=${() => selectGroup(item)}><${Icon} name=${item.icon} size=${16}/><span>${item.label}</span></button>`)}</nav>`;
}

function MobileCategoryTiles({ catalog, onNavigate }) {
  return html`<div className="mobile-category-tiles" role="list" aria-label="Popular product categories">${mobileCategoryShortcuts.map((item) => {
    const product = getItemProducts(catalog, item).find((candidate) => candidate.image && candidate.image !== "/assets/product-placeholder.svg");
    const href = item.kind === "collection" ? `#collection/${encodeURIComponent(item.target)}` : item.kind === "group" ? `#group/${encodeURIComponent(item.target)}` : `#search/${encodeURIComponent(item.target)}`;
    return html`<button type="button" key=${`${item.kind}-${item.target}`} role="listitem" onClick=${() => onNavigate(href)}><span className="mobile-category-tile-image">${product ? html`<img src=${product.image} alt="" loading="lazy" onError=${(event) => { event.currentTarget.hidden = true; event.currentTarget.closest(".mobile-category-tile-image")?.classList.add("is-fallback"); }}/>` : html`<${Icon} name="sparkle" size=${24}/>`}</span><span>${item.label}</span></button>`;
  })}</div>`;
}

function MobileCategoryOverview({ group, catalog, onSelect }) {
  return html`<section className="mobile-category-overview" aria-label=${`${group.label} subcategories`}>
    <header className="mobile-category-overview-heading"><div><h1>${group.label}</h1><p>Choose a subcategory to view its mapped products.</p></div><span>${group.items.length} options</span></header>
    <div className="mobile-subcategory-grid" role="list">
      ${group.items.map((item) => {
        const products = getItemProducts(catalog, item);
        const image = products.find((product) => product.image && product.image !== "/assets/product-placeholder.svg")?.image;
        const count = products.length;
        return html`<button type="button" key=${mobileCategoryItemKey(item)} role="listitem" className="mobile-subcategory-card" onClick=${() => onSelect(item)} aria-label=${`${item.label}, ${count} mapped products`}>
          <span className="mobile-subcategory-image">${image ? html`<img src=${image} alt="" loading="lazy" decoding="async" onError=${useProductImageFallback}/>` : html`<${Icon} name="sparkle" size=${22}/>`}</span>
          <span className="mobile-subcategory-title">${item.label}</span>
          <small>${count ? `${count} products` : "Mapping pending"}</small>
        </button>`;
      })}
    </div>
  </section>`;
}

function getSidebarEntries(route) {
  const activeKey = route.handle || route.id || route.sign || route.label || "";
  const parent = navigation.find((group) => [...(group.items || []), ...(group.formItems || [])].some((item) => item.target === activeKey));
  if (parent) {
    const seen = new Set();
    return [...(parent.items || []), ...(parent.formItems || [])].filter((item) => {
      if (!["collection", "group", "zodiac", "search"].includes(item.kind)) return false;
      const key = `${item.kind}:${item.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return collections.filter((item) => item.actual_explicit_assignments > 0).map((item) => ({ kind: "collection", target: item.handle, label: item.title }));
}

function CategorySidebar({ route, catalog, onNavigate }) {
  const items = getSidebarEntries(route);
  return html`<aside className="category-sidebar" aria-label="Categories"><div className="category-sidebar-list">${items.map((item) => {
    const matches = getItemProducts(catalog, item);
    const image = matches.find((product) => product.image && product.image !== "/assets/product-placeholder.svg")?.image;
    const isActive = item.target === (route.handle || route.id || route.sign) || item.label?.toLowerCase() === route.label?.toLowerCase();
    const href = item.kind === "collection" ? `#collection/${encodeURIComponent(item.target)}` : item.kind === "group" ? `#group/${encodeURIComponent(item.target)}` : item.kind === "zodiac" ? `#zodiac/${encodeURIComponent(item.target)}` : `#search/${encodeURIComponent(item.target)}`;
    return html`<button type="button" key=${`${item.kind}-${item.target}`} className=${`category-sidebar-item ${isActive ? "is-active" : ""}`} onClick=${() => onNavigate(href)}><span className="category-sidebar-thumb">${image ? html`<img src=${image} alt="" loading="lazy" onError=${useProductImageFallback}/>` : html`<${Icon} name="sparkle" size=${20}/>`}</span><span>${item.label}</span></button>`;
  })}</div></aside>`;
}

function DiscoveryTile({ item, products, index, onNavigate }) {
  const matches = selectDiscoveryProducts(products, item);
  const imagesFrom = item.imageHandles?.length
    ? item.imageHandles.flatMap((handle) => selectProducts(products, { filter: { kind: "collection", value: handle } }))
    : matches;
  const rankedImages = [...imagesFrom].sort((left, right) => {
    const term = item.imageMatch?.toLowerCase();
    const score = (product) => (term && product.title?.toLowerCase().includes(term) ? 2 : 0) - (/how to use|certificate|instruction|catalog/i.test(product.title || "") ? 3 : 0);
    return score(right) - score(left);
  });
  const candidateImages = [...new Set(rankedImages.map((product) => product.image || product.images?.[0]).filter((image) => image && image !== "/assets/product-placeholder.svg"))];
  const [imageIndex, setImageIndex] = useState(0);
  const image = candidateImages[imageIndex] || "";
  const tint = ["#F2EAF8", "#FBE8EB", "#E9F3ED", "#EAF1FA", "#FFF0E7", "#F1EDF8", "#F7EFE9", "#EBF2EE"][index % 8];
  const descriptor = item.note || `${matches.length} workbook product${matches.length === 1 ? "" : "s"}`;
  return html`<button className=${`discovery-tile ${image ? "has-image" : "no-image"}`} style=${{ "--tile-tint": tint }} type="button" onClick=${() => onNavigate(discoveryHref(item))} aria-label=${`${item.title}. ${descriptor}`}>
    <span className="discovery-tile-art"><${Icon} name="sparkle" size=${27}/>${image && html`<img src=${image} alt="" loading="lazy" decoding="async" onError=${(event) => { if (imageIndex + 1 < candidateImages.length) setImageIndex(imageIndex + 1); else event.currentTarget.hidden = true; }}/>`}</span>
    <span className="discovery-tile-title">${item.title}</span>
    <span className="discovery-tile-meta">${matches.length ? `${matches.length} items` : "Mapping pending"}</span>
  </button>`;
}

function Carousel({ label, className = "", children }) {
  const trackRef = useRef(null);
  const scrollByPage = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(180, track.clientWidth * 0.72), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const onKeyDown = (event) => {
    if (event.target !== trackRef.current || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    scrollByPage(event.key === "ArrowRight" ? 1 : -1);
  };
  return html`<div className=${`carousel ${className}`}>
    <div className="carousel-track" ref=${trackRef} role="region" aria-label=${label} tabIndex="0" onKeyDown=${onKeyDown}>${children}</div>
    <button className="carousel-arrow carousel-arrow--previous" type="button" onClick=${() => scrollByPage(-1)} aria-label=${`Scroll ${label} left`}><${Icon} name="arrow" size=${18}/></button>
    <button className="carousel-arrow carousel-arrow--next" type="button" onClick=${() => scrollByPage(1)} aria-label=${`Scroll ${label} right`}><${Icon} name="arrow" size=${18}/></button>
  </div>`;
}

function DiscoverySection({ section, products, onNavigate }) {
  const items = section.items.map((item, index) => html`<${DiscoveryTile} key=${item.id} item=${item} products=${products} index=${index} onNavigate=${onNavigate}/>`);
  return html`<section className=${`discovery-section discovery-section--${section.id}`} id=${section.id}><div className="discovery-section-heading"><h2>${section.title}</h2>${section.note && html`<p>${section.note}</p>`}</div><${Carousel} label=${section.title} className="discovery-carousel">${items}</${Carousel}></section>`;
}

function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > 480);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  if (!visible) return null;
  return html`<button className="back-to-top" type="button" onClick=${() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}><${Icon} name="arrowUp" size=${17}/> Back to top</button>`;
}

function MobileBottomNavigation({ route, cartCount, savedCount, onNavigate }) {
  const items = [
    { label: "Home", icon: "homeTab", active: route.page === "home", href: "#home" },
    { label: "Categories", icon: "grid", active: ["collections", "collection", "group", "discovery", "nav", "crystals"].includes(route.page), href: "#collections" },
    { label: "Copilot", icon: "sparkle", active: route.page === "copilot", href: "#copilot" },
    { label: "Cart", icon: "bag", active: ["cart", "checkout"].includes(route.page), href: "#cart", count: cartCount },
    { label: "WhatsApp", icon: "chat", active: route.page === "contact", href: "#contact" },
  ];
  return html`<nav className="mobile-bottom-navigation" aria-label="Bottom navigation">${items.map((item) => html`<button key=${item.label} className=${`mobile-bottom-item ${item.active ? "is-active" : ""}`} type="button" onClick=${() => onNavigate(item.href)} aria-current=${item.active ? "page" : undefined}><span className="mobile-bottom-icon"><${Icon} name=${item.icon} size=${20}/>${item.count > 0 && html`<i>${item.count}</i>`}</span><span>${item.label}</span></button>`)}</nav>`;
}

function ProductCard({ product, onOpen, onAdd, isSaved, onSave, cart = [], onUpdate = () => {} }) {
  const title = productLabel(product);
  const defaultVariant = selectVariant(product);
  const defaultSize = defaultVariant?.title || product.sizes?.[0] || "One size";
  const defaultVariantId = defaultVariant?.id || `${product.id}:${defaultSize}`;
  const price = Number(defaultVariant?.price ?? product.price);
  const compareAt = Number(defaultVariant?.compareAt ?? product.compareAt);
  const hasPrice = Number.isFinite(price) && price > 0;
  const addEnabled = hasPrice && Boolean(defaultVariant?.id) && product.variantsComplete !== false
    && defaultVariant?.canPurchase === true && defaultVariant?.available === true;
  const addLabel = addEnabled ? "Buy Now" : hasPrice ? "Unavailable" : "Price pending";
  const cartLine = cart.find((line) => line.productId === product.id && line.key === `${product.id}:${defaultVariantId}`);
  return html`<article className="product-card">
    <div className="product-image-wrap">
      <button type="button" className="product-open" onClick=${() => onOpen(product)} aria-label=${`View ${title}`}><${ProductImage} className="product-image" src=${product.image} alt=${title}/></button>
      <span className="product-badge">${product.previewOnly ? "Catalog preview" : "Shopify"}</span>
      <button className=${`save-button ${isSaved ? "is-saved" : ""}`} type="button" aria-label=${isSaved ? "Remove from wishlist" : "Add to wishlist"} aria-pressed=${isSaved} onClick=${() => onSave(product.id)}><${Icon} name="heart" size=${17}/></button>
    </div>
    <div className="product-info"><button className="product-title" type="button" onClick=${() => onOpen(product)}>${title}</button>
      <p className="product-meta">${(product.collectionTitles || []).slice(0, 2).join(" · ") || product.type || "Catalog record"}</p>
      <div className="product-price">${hasPrice ? html`<strong>${(product.variants || []).length > 1 ? "From " : ""}${money(price)}</strong>` : html`<strong className="price-pending">Price pending review</strong>`}${discountPercent(price, compareAt) > 0 && html`<del key="compare-at">MRP ${money(compareAt)}</del><span key="discount" className="product-discount">${discountPercent(price, compareAt)}% off</span>`}<span className="price-note">${product.previewOnly ? "Workbook price · preview only" : "Shopify Storefront price"}</span></div>
    </div>
    <div className="desktop-product-action">${cartLine ? html`<div className="quick-quantity" role="group" aria-label=${`Quantity for ${title}`}><button type="button" onClick=${() => onUpdate(cartLine.key, -1)} aria-label=${`Decrease ${title} quantity`}><${Icon} name="minus" size=${14}/></button><span aria-live="polite">${cartLine.quantity}</span><button type="button" onClick=${() => onUpdate(cartLine.key, 1)} aria-label=${`Increase ${title} quantity`}><${Icon} name="plus" size=${14}/></button></div>` : html`<button className="quick-add" type="button" disabled=${!addEnabled} onClick=${() => onAdd(product, defaultVariant.id)}>${addLabel}</button>`}</div>
    <div className="mobile-product-action">${cartLine ? html`<div className="mobile-card-quantity" role="group" aria-label=${`Quantity for ${title}`}><button type="button" onClick=${() => onUpdate(cartLine.key, -1)} aria-label=${`Decrease ${title} quantity`}><${Icon} name="minus" size=${15}/></button><span aria-live="polite">${cartLine.quantity}</span><button type="button" onClick=${() => onUpdate(cartLine.key, 1)} aria-label=${`Increase ${title} quantity`}><${Icon} name="plus" size=${15}/></button></div>` : html`<button type="button" disabled=${!addEnabled} onClick=${() => onAdd(product, defaultVariant.id)}>${addLabel}</button>`}</div>
  </article>`;
}

function ProductGrid({ products, onOpen, onAdd, saved, onSave, cart = [], onUpdate = () => {} }) {
  if (!products.length) return html`<div className="no-products"><span>✧</span><h3>No mapped products in this view yet.</h3><p>Collection membership and product details are still being reconciled against the client workbook.</p></div>`;
  return html`<div className="product-grid">${products.map((product) => html`<${ProductCard} key=${product.id} product=${product} onOpen=${onOpen} onAdd=${onAdd} isSaved=${saved.includes(product.id)} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/>` )}</div>`;
}

function ProductCarousel({ label, products, onOpen, onAdd, saved, onSave, cart = [], onUpdate = () => {} }) {
  if (!products.length) return null;
  return html`<${Carousel} label=${label} className="product-carousel">${products.map((product) => html`<${ProductCard} key=${product.id} product=${product} onOpen=${onOpen} onAdd=${onAdd} isSaved=${saved.includes(product.id)} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/>` )}</${Carousel}>`;
}

function CollectionCard({ collection, onClick, index = 0 }) {
  const colors = ["#e9e6dd", "#e8e9e1", "#eee3de", "#e6e8e7", "#e9e2d8", "#e9e7ed"];
  return html`<button type="button" className="category-card collection-directory-card" style=${{ "--category-bg": colors[index % colors.length] }} onClick=${onClick}>
    <span className="category-index">${String(index + 1).padStart(2, "0")}</span><span className="category-symbol">✧</span><span className="category-name">${collection.title}</span>
    <span className="collection-card-count">${collection.actual_explicit_assignments != null ? `${collection.actual_explicit_assignments} mapped` : `${collection.productsCount?.count || 0} products`}</span>
    <span className="category-arrow"><${Icon} name="arrow" size=${15}/></span><i className="category-orb"></i>
  </button>`;
}

function CollectionDirectory({ onOpenCollection, route, catalog, sort, setSort, typeFilter, setTypeFilter, pageSize, onMore, onOpen, onAdd, saved, onSave, cart, onUpdate, error = "", onNavigate }) {
  const [search, setSearch] = useState("");
  const filtered = collections.filter((item) => `${item.title} ${item.handle}`.toLowerCase().includes(search.toLowerCase()));
  return html`<main className="page-main mobile-categories-page">
    <${MobileCategoriesPage} route=${route} catalog=${catalog} sort=${sort} setSort=${setSort} typeFilter=${typeFilter} setTypeFilter=${setTypeFilter} pageSize=${pageSize} onMore=${onMore} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate} error=${error} onNavigate=${onNavigate}/>
    <section className="page-hero section-pad"><div className="eyebrow">CLIENT COLLECTION REGISTRY</div><h1>Browse all <em>collections.</em></h1><p>${collections.length} collection titles and handles from the workbook. Product assignments shown here are exact mapped records; mismatches remain flagged for review.</p><label className="directory-search"><${Icon} name="search"/><input value=${search} onChange=${(event) => setSearch(event.target.value)} aria-label="Filter collections" placeholder="Find a collection by name or handle"/></label></section>
    <section className="collection-directory section-pad"><div className="directory-summary">${filtered.length} of ${collections.length} collections</div><div className="category-grid directory-grid">${filtered.map((collection, index) => html`<${CollectionCard} key=${collection.handle} collection=${collection} index=${index} onClick=${() => onOpenCollection(collection.handle)}/>` )}</div></section>
  </main>`;
}

function productAvailability(product) {
  if (typeof product?.available === "boolean") return product.available;
  if (typeof product?.availability === "boolean") return product.availability;
  if (typeof product?.canPurchase === "boolean" && !product.previewOnly && !(product.dataQuality || []).includes("placeholder_inventory")) return product.canPurchase;
  return null;
}

function FilterDrawer({ open, onClose, typeFilter, setTypeFilter, typeOptions, sort, setSort, minPrice, setMinPrice, maxPrice, setMaxPrice, availability = "", setAvailability = () => {}, availabilityVerified = false, showAvailability = false }) {
  if (!open) return null;
  return html`<div className="filter-overlay" role="presentation" onMouseDown=${(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="filter-drawer" role="dialog" aria-modal="true" aria-labelledby="filter-title"><div className="filter-drawer-head"><h2 id="filter-title">Filter & sort</h2><button type="button" onClick=${onClose} aria-label="Close filters"><${Icon} name="close"/></button></div><label>Catalog category<select value=${typeFilter} onChange=${(event) => setTypeFilter(event.target.value)}><option value="">All categories</option>${typeOptions.map((option) => html`<option key=${option} value=${option}>${option}</option>`)}</select></label><div className="filter-price-range"><span>Price range</span><div><label><span className="sr-only">Minimum price</span><input type="number" min="0" inputMode="numeric" placeholder="Min ₹" value=${minPrice} onChange=${(event) => setMinPrice(event.target.value)}/></label><label><span className="sr-only">Maximum price</span><input type="number" min="0" inputMode="numeric" placeholder="Max ₹" value=${maxPrice} onChange=${(event) => setMaxPrice(event.target.value)}/></label></div></div>${showAvailability && html`<label>Availability<select value=${availability} onChange=${(event) => setAvailability(event.target.value)}><option value="">All availability</option><option value="available" disabled=${!availabilityVerified}>Available</option><option value="unavailable" disabled=${!availabilityVerified}>Unavailable</option></select>${!availabilityVerified && html`<small className="availability-note">Stock is not verified in the client workbook.</small>`}</label>`}<label>Sort by<select value=${sort} onChange=${(event) => setSort(event.target.value)}><option value="featured">Catalog order</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="title">Title: A to Z</option></select></label><div className="filter-drawer-actions"><button type="button" className="filter-clear" onClick=${() => { setTypeFilter(""); setMinPrice(""); setMaxPrice(""); setAvailability(""); setSort("featured"); }}>Clear all</button><button type="button" className="filter-apply" onClick=${onClose}>Show results</button></div></section></div>`;
}

function MobileCategoriesPage({ route, catalog, sort, setSort, typeFilter, setTypeFilter, pageSize, onMore, onOpen, onAdd, saved, onSave, cart, onUpdate, error, onNavigate }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [availability, setAvailability] = useState("");
  const listRef = useRef(null);
  const railRef = useRef(null);
  const group = mobileCategoryGroups.find((item) => item.label === route.group) || mobileCategoryGroups[0];
  const selectedItem = route.category ? group.items.find((item) => mobileCategoryItemKey(item) === route.category) || null : null;
  const itemKey = selectedItem ? mobileCategoryItemKey(selectedItem) : "";
  const rawProducts = selectedItem ? getItemProducts(catalog, selectedItem) : [];
  const typeOptions = [...new Set(rawProducts.flatMap(productFacets))].sort((a, b) => a.localeCompare(b));
  const availabilityVerified = rawProducts.some((product) => productAvailability(product) !== null);
  let filteredProducts = rawProducts.filter((product) => {
    const price = Number(product.price);
    if (typeFilter && !matchesProductFacet(product, typeFilter)) return false;
    if (minPrice && (!Number.isFinite(price) || price < Number(minPrice))) return false;
    if (maxPrice && (!Number.isFinite(price) || price > Number(maxPrice))) return false;
    if (availability) {
      const available = productAvailability(product);
      if (available === null || (availability === "available") !== available) return false;
    }
    return true;
  });
  if (sort !== "featured") filteredProducts = selectProducts(filteredProducts, { sort });
  const visibleProducts = filteredProducts.slice(0, pageSize);
  const activeFilterCount = Number(Boolean(typeFilter)) + Number(Boolean(minPrice)) + Number(Boolean(maxPrice)) + Number(Boolean(availability));

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setMinPrice(""); setMaxPrice(""); setAvailability("");
  }, [itemKey]);
  useEffect(() => {
    if (railRef.current) railRef.current.scrollTop = 0;
  }, [group.label]);

  const selectCategory = (item) => onNavigate(mobileCategoryHref(group.label, item));
  const productCards = html`<${ProductGrid} products=${visibleProducts} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/>`;
  return html`<section className=${`mobile-categories-app ${!selectedItem ? "mobile-categories-app--overview" : ""}`} aria-label="Browse client catalog categories">
    ${!selectedItem ? html`<div className="mobile-category-overview-scroll"><${MobileCategoryOverview} group=${group} catalog=${catalog} onSelect=${selectCategory}/></div>` : html`<${React.Fragment}>
    <aside className="category-sidebar category-sidebar--browser" aria-label="${group.label} categories">
      <div className="category-sidebar-list" ref=${railRef}>${group.items.map((item) => {
        const matches = getItemProducts(catalog, item);
        const image = matches.find((product) => product.image && product.image !== "/assets/product-placeholder.svg")?.image;
        const active = mobileCategoryItemKey(item) === itemKey;
        return html`<button type="button" key=${mobileCategoryItemKey(item)} className=${`category-sidebar-item ${active ? "is-active" : ""}`} aria-current=${active ? "true" : undefined} onClick=${() => selectCategory(item)}><span className="category-sidebar-thumb"><span className="category-sidebar-fallback" aria-hidden="true">${item.label.trim().slice(0, 1)}</span>${image && html`<img src=${image} alt="" loading="lazy" decoding="async" onError=${(event) => { event.currentTarget.hidden = true; }}/>`}</span><span>${item.label}</span></button>`;
      })}</div>
    </aside>
    <section className="mobile-catalog-main mobile-categories-products" aria-label="${selectedItem?.label || group.label} products" ref=${listRef}>
      <header className="mobile-catalog-heading mobile-categories-heading"><h1>${selectedItem?.label || group.label}</h1><span>${filteredProducts.length} ${filteredProducts.length === 1 ? "product" : "products"}</span><button type="button" onClick=${() => setFilterOpen(true)}><${Icon} name="filter" size=${17}/>Filter${activeFilterCount ? html`<i>${activeFilterCount}</i>` : null}</button></header>
      ${error && html`<div className="inline-error" role="status">${error}</div>`}
      ${rawProducts.length === 0 ? html`<div className="no-products"><span>✧</span><h3>No mapped products here yet.</h3><p>This workbook category has no product assignments in the current preview.</p></div>` : filteredProducts.length === 0 ? html`<div className="no-products"><span>⌕</span><h3>No products match these filters.</h3><p>Change the price or category filter to see more workbook products.</p><button className="button button--outline" type="button" onClick=${() => { setTypeFilter(""); setMinPrice(""); setMaxPrice(""); setAvailability(""); }}>Clear filters</button></div>` : productCards}
      ${filteredProducts.length > pageSize && html`<div className="load-more"><span>Showing ${visibleProducts.length} of ${filteredProducts.length}</span><button className="button button--outline" type="button" onClick=${onMore}>Load more</button></div>`}
      <p className="preview-disclaimer">Client workbook preview · ratings, certifications, and stock are shown only when verified.</p>
    </section>
    <${FilterDrawer} open=${filterOpen} onClose=${() => setFilterOpen(false)} typeFilter=${typeFilter} setTypeFilter=${setTypeFilter} typeOptions=${typeOptions} sort=${sort} setSort=${setSort} minPrice=${minPrice} setMinPrice=${setMinPrice} maxPrice=${maxPrice} setMaxPrice=${setMaxPrice} availability=${availability} setAvailability=${setAvailability} availabilityVerified=${availabilityVerified} showAvailability=${true}/>
    </>`}
  </section>`;
}

function CatalogPage({ title, eyebrow, description, products, total, sort, setSort, typeFilter, setTypeFilter, typeOptions, pageSize, hasNextPage = false, onMore, onOpen, onAdd, saved, onSave, cart, onUpdate, pending = false, liveCatalog = false, error = "", route, catalog, onNavigate }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const priceFiltered = products.filter((product) => {
    const price = Number(product.price);
    if (minPrice && (!Number.isFinite(price) || price < Number(minPrice))) return false;
    if (maxPrice && (!Number.isFinite(price) || price > Number(maxPrice))) return false;
    return true;
  });
  const page = priceFiltered.slice(0, pageSize);
  const activeFilterCount = Number(Boolean(typeFilter)) + Number(Boolean(minPrice)) + Number(Boolean(maxPrice));
  const results = (items) => html`<${ProductGrid} products=${items} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/>`;
  const browseRoute = ["collections", "collection", "group", "discovery", "nav"].includes(route.page);
  return html`<main className="page-main catalog-page">
    <section className="page-hero section-pad desktop-catalog-hero"><div className="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p>${pending && html`<div className="pending-note"><span>Catalog mapping in progress</span><p>The workbook names this category, but its final product list still needs client confirmation.</p></div>`}</section>
    <section className=${`mobile-catalog-layout ${browseRoute ? "has-sidebar" : "no-sidebar"}`}>${browseRoute && html`<${CategorySidebar} route=${route} catalog=${catalog} onNavigate=${onNavigate}/>`}<div className="mobile-catalog-main"><header className="mobile-catalog-heading"><h1>${title}</h1><span>${priceFiltered.length} products</span><button type="button" onClick=${() => setFilterOpen(true)}><${Icon} name="filter" size=${17}/>Filter${activeFilterCount ? html`<i>${activeFilterCount}</i>` : null}</button></header>${error && html`<div className="inline-error" role="status">${error}</div>`}${pending && html`<div className="pending-note"><span>Catalog mapping in progress</span><p>The final product list still needs client confirmation.</p></div>`}${results(page)}${(priceFiltered.length > pageSize || hasNextPage) && html`<div className="load-more"><span>Showing ${page.length} of ${priceFiltered.length}</span><button className="button button--outline" type="button" onClick=${onMore}>Load more</button></div>`}<p className="preview-disclaimer">Catalog preview · product details and availability remain under review.</p></div><${FilterDrawer} open=${filterOpen} onClose=${() => setFilterOpen(false)} typeFilter=${typeFilter} setTypeFilter=${setTypeFilter} typeOptions=${typeOptions} sort=${sort} setSort=${setSort} minPrice=${minPrice} setMinPrice=${setMinPrice} maxPrice=${maxPrice} setMaxPrice=${setMaxPrice}/></section>
    <section className="products-section section-pad listing-section desktop-catalog-listing"><div className="listing-topline"><span>${total} mapped ${total === 1 ? "product" : "products"}</span><span className="catalog-status">${liveCatalog ? "Shopify Storefront" : "Client workbook preview"}</span></div>${error && html`<div className="inline-error" role="status">${error}</div>`}<div className="collection-toolbar listing-toolbar"><label className="type-filter"><span>Filter by collection</span><select value=${typeFilter} onChange=${(event) => setTypeFilter(event.target.value)} aria-label="Filter by collection"><option value="">All mapped categories</option>${typeOptions.map((option) => html`<option key=${option} value=${option}>${option}</option>`)}</select></label><label className="sort-control"><span>Sort:</span><select value=${sort} onChange=${(event) => setSort(event.target.value)} aria-label="Sort products"><option value="featured">Catalog order</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="title">Title: A to Z</option></select></label></div>${results(products.slice(0, pageSize))}${(products.length > pageSize || hasNextPage) && html`<div className="load-more"><span>Showing ${Math.min(products.length, pageSize)}${liveCatalog ? " loaded" : ` of ${products.length}`}</span><button className="button button--outline" type="button" onClick=${onMore}>Load more products <${Icon} name="arrow" size=${16}/></button></div>`}${products.length > 0 && html`<p className="preview-disclaimer">Preview only. Inventory, weights, content approval, and product options are not verified. No real orders or payments can be placed.</p>`}</section>
  </main>`;
}

function ZodiacHub({ selectedSign, products, onSelectSign, onOpen, onAdd, saved, onSave, cart, onUpdate }) {
  const sign = zodiacSigns.find((item) => item.name.toLowerCase() === (selectedSign || "").toLowerCase());
  const signProducts = sign ? selectProducts(products, { filter: { kind: "zodiac", value: sign.name } }) : [];
  return html`<main className="page-main">
    <section className="page-hero section-pad"><div className="eyebrow">RASHI / ZODIAC</div><h1>${sign ? html`${sign.name} <em>${sign.hindi}</em>` : html`Find your <em>sign.</em>`}</h1><p>Choose a sign to see products explicitly named for it in the client catalog. The preview does not infer crystal compatibility.</p></section>
    <section className="zodiac-section section-pad zodiac-page"><div className="zodiac-grid">${zodiacSigns.map((item) => html`<button key=${item.name} className=${`zodiac-card ${item.name === sign?.name ? "is-selected" : ""}`} type="button" onClick=${() => onSelectSign(item.name)}><span className="zodiac-symbol">${item.symbol}</span><span className="zodiac-name">${item.name}</span><small>${item.hindi}</small><span className="zodiac-link">View named products <${Icon} name="arrow" size=${13}/></span></button>` )}</div></section>
    ${sign && html`<section className="products-section section-pad listing-section"><${SectionTitle} eyebrow="EXPLICIT TITLE MATCHES" title=${html`${sign.name} products`} note="Only product titles that mention this sign appear here."/><${ProductGrid} products=${signProducts.slice(0, 24)} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/></section>`}
  </main>`;
}

function CrystalHub({ onOpenCollection }) {
  const crystalNav = navigation.find((group) => group.label === "Crystal");
  const items = (crystalNav?.items || []).filter((item) => item.kind === "collection");
  return html`<main className="page-main"><section className="page-hero section-pad"><div className="eyebrow">CRYSTALS</div><h1>Shop by <em>crystal.</em></h1><p>Crystal types and handles come from the workbook. A collection opens only the products mapped to that exact collection.</p></section>
    <section className="category-section section-pad crystal-type-page"><div className="crystal-grid">${items.map((item, index) => { const record = collectionByHandle.get(item.target); return html`<button key=${item.target} className="crystal-card" style=${{ "--stone-tint": ["#e9e5ed", "#eee8da", "#e3e9df", "#e6e9e8"][index % 4] }} onClick=${() => onOpenCollection(item.target)}><span className="crystal-card-symbol">✧</span><span className="crystal-card-name">${item.label}</span><small>${record?.actual_explicit_assignments || 0} mapped</small><span className="crystal-card-arrow"><${Icon} name="arrow" size=${14}/></span></button>`;})}</div></section>
  </main>`;
}

function ProductPage({ product, products, onBack, onOpen, onAdd, onSave, onNotice, isSaved, cart, onUpdate }) {
  const [imageIndex, setImageIndex] = useState(0);
  const firstPricedVariant = Math.max(0, product?.variants?.findIndex((item) => item.canPurchase !== false && Number(item.price) > 0 && item.available !== false) ?? 0);
  const [variantIndex, setVariantIndex] = useState(firstPricedVariant);
  const [quantity, setQuantity] = useState(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showAllOffers, setShowAllOffers] = useState(false);
  const touchStart = useRef(null);
  const addLock = useRef(false);
  const [buying, setBuying] = useState(false);
  useEffect(() => { setImageIndex(0); setVariantIndex(Math.max(0, product?.variants?.findIndex((item) => item.canPurchase !== false && Number(item.price) > 0 && item.available !== false) ?? 0)); setQuantity(1); setLightboxOpen(false); setShowAllOffers(false); setBuying(false); addLock.current = false; }, [product?.id]);
  useEffect(() => {
    const selected = product?.variants?.[variantIndex];
    const approved = product?.variants?.findIndex((item) => item.canPurchase === true && Number(item.price) > 0 && item.available === true) ?? -1;
    if (approved >= 0 && selected?.canPurchase !== true) setVariantIndex(approved);
  }, [product?.variantsComplete, product?.variants?.length]);
  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event) => {
      const mediaCount = Math.max(1, product?.media?.length || product?.images?.length || 1);
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowRight") setImageIndex((current) => (current + 1) % mediaCount);
      if (event.key === "ArrowLeft") setImageIndex((current) => (current - 1 + mediaCount) % mediaCount);
    };
    window.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", handleKey); };
  }, [lightboxOpen, product?.id]);
  if (!product) return html`<main className="page-main"><section className="page-hero section-pad"><h1>Product not found.</h1><p>This handle is not available in the current catalog preview.</p><button className="button button--outline" onClick=${onBack}>Back to catalog</button></section></main>`;

  const title = productLabel(product);
  const sourceMedia = Array.isArray(product.media) ? product.media : [];
  const mediaItems = sourceMedia.map((item) => {
    const type = String(item.type || item.mediaContentType || "image").toLowerCase();
    const src = item.url || item.src || item.sources?.[0]?.url || item.image?.url || item.previewImage?.url;
    return src ? { type: type.includes("video") ? "video" : "image", src, poster: item.previewImage?.url || item.image?.url || "" } : null;
  }).filter(Boolean);
  if (!mediaItems.length) mediaItems.push({ type: "unavailable" });
  const selectedMedia = mediaItems[imageIndex] || mediaItems[0];
  const variants = product.variants || [];
  const variant = variants[variantIndex];
  const price = variant ? Number(variant.price) : Number(product.price);
  const compareAt = variant ? Number(variant.compareAt ?? variant.compare_at_price) : Number(product.compareAt);
  const discount = discountPercent(price, compareAt);
  const canAdd = Number.isFinite(price) && price > 0 && Boolean(variant?.id) && variant?.canPurchase === true && variant?.available === true;
  const related = (product.collectionHandles || []).flatMap((handle) => selectProducts(products, { filter: { kind: "collection", value: handle } })).filter((item, index, items) => item.id !== product.id && items.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 4);
  const hasReviewData = Number.isFinite(Number(product.rating)) && Number(product.rating) > 0 && Number(product.reviewCount) > 0;
  const description = typeof product.description === "string" ? product.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
  const genericDescription = !description || /^(product details are (being reviewed|pending)|description pending)/i.test(description);
  const attributes = Array.isArray(product.attributes) ? product.attributes.filter((item) => item && item.label && item.value) : [];
  const detailAttributes = [...attributes, ...(variant?.sku ? [{ label: "SKU", value: variant.sku }] : [])];
  const offers = Array.isArray(product.offers) ? product.offers.filter((offer) => offer && (offer.title || offer.text || offer.description)) : [];
  const reviews = Array.isArray(product.reviews) ? product.reviews.filter((review) => review && (review.text || review.body || review.content)) : [];
  const imageUrl = (event) => {
    const image = event.currentTarget;
    if (image.closest(".detail-photo")) {
      const nextImage = mediaItems.findIndex((item, index) => index > imageIndex && item.type === "image" && item.src !== selectedMedia.src);
      if (nextImage >= 0) { setImageIndex(nextImage); return; }
    }
    useProductImageFallback(event);
  };
  const changeMedia = (direction) => setImageIndex((current) => (current + direction + mediaItems.length) % mediaItems.length);
  const shareProduct = async () => {
    const shareData = { title, text: `Explore ${title} at Crystal Baaz`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareData.url); onNotice?.("Product link copied."); }
      else onNotice?.("Copy this product link from your browser address bar.");
    } catch (error) { if (error?.name !== "AbortError") onNotice?.("Product link could not be shared from this browser."); }
  };
  const addProduct = async () => {
    if (!canAdd || addLock.current) return;
    addLock.current = true;
    setBuying(true);
    try { await onAdd(product, variant.id, quantity); }
    finally { addLock.current = false; setBuying(false); }
  };
  const copyOffer = async (offer) => {
    if (!offer.code || !navigator.clipboard?.writeText) return;
    try { await navigator.clipboard.writeText(offer.code); onNotice?.("Offer code copied."); }
    catch { onNotice?.("Offer code could not be copied."); }
  };
  const renderMedia = (isLightbox = false) => selectedMedia.type === "video"
    ? html`<video src=${selectedMedia.src} poster=${selectedMedia.poster || undefined} controls playsInline preload="metadata" aria-label=${`${title} product video`}></video>`
    : selectedMedia.type === "unavailable" ? html`<span className="shopping-image-unavailable" role="img" aria-label="Image unavailable">Image unavailable</span>`
      : html`<img src=${selectedMedia.src} alt=${title} onError=${imageUrl} draggable="false"/>`;
  const detailImages = mediaItems.filter((item) => item.type !== "unavailable").map((item, index) => html`<button type="button" key=${`${item.src}-${index}`} className=${`detail-thumb ${imageIndex === index ? "is-active" : ""}`} onClick=${() => setImageIndex(index)} aria-label=${`Show product ${item.type === "video" ? "video" : "image"} ${index + 1}`} aria-current=${imageIndex === index ? "true" : undefined}><img src=${item.poster || item.src} alt="" loading="lazy" onError=${imageUrl}/>${item.type === "video" && html`<span className="detail-thumb-play" aria-hidden="true">▶</span>`}</button>`);
  const priceContent = html`<div className="detail-price"><strong>${Number.isFinite(price) && price > 0 ? money(price) : "Price pending"}</strong>${discount > 0 && html`<del key="compare-at">${money(compareAt)}</del><span key="discount" className="product-discount">${discount}% off</span>`}</div>`;
  const quantityControl = html`<div className="qty-control detail-quantity" aria-label="Quantity"><button type="button" onClick=${() => setQuantity((current) => Math.max(1, current - 1))} aria-label="Decrease quantity"><${Icon} name="minus" size=${16}/></button><span aria-live="polite">${quantity}</span><button type="button" onClick=${() => setQuantity((current) => current + 1)} aria-label="Increase quantity"><${Icon} name="plus" size=${16}/></button></div>`;
  const addButton = (mobile = false) => html`<button className=${`button button--dark detail-add ${mobile ? "detail-add-mobile" : ""}`} type="button" disabled=${!canAdd || buying} aria-busy=${buying} onClick=${addProduct} aria-label=${buying ? "Saving item to cart" : canAdd ? `Buy Now ${title}` : Number.isFinite(price) && price > 0 ? `Unavailable: ${title}` : `Price pending: ${title}`}>${canAdd ? "Buy Now" : Number.isFinite(price) && price > 0 ? "Unavailable" : "Price pending"}</button>`;

  return html`<main className="page-main product-page"><div className="product-breadcrumb section-pad"><button type="button" onClick=${onBack}>Catalog</button><span>›</span><span>${title}</span></div>
    <section className="product-detail product-detail-page section-pad">
      <div className="detail-gallery">
        <div className="detail-photo" onTouchStart=${(event) => { touchStart.current = event.touches[0].clientX; }} onTouchEnd=${(event) => { if (touchStart.current === null) return; const delta = event.changedTouches[0].clientX - touchStart.current; if (Math.abs(delta) > 42 && mediaItems.length > 1) changeMedia(delta < 0 ? 1 : -1); touchStart.current = null; }}>
          <button type="button" className="detail-gallery-back" onClick=${onBack} aria-label="Back to catalog"><${Icon} name="arrowLeft" size=${19}/></button>
          <button type="button" className=${`detail-gallery-save ${isSaved ? "is-saved" : ""}`} onClick=${() => onSave(product.id)} aria-label=${isSaved ? "Remove from wishlist" : "Save to wishlist"} aria-pressed=${Boolean(isSaved)}><${Icon} name="heart" size=${19}/></button>
          <button type="button" className="detail-gallery-share" onClick=${shareProduct} aria-label="Share product"><${Icon} name="share" size=${18}/></button>
          <button type="button" className="detail-photo-media" onClick=${() => setLightboxOpen(true)} aria-label="View product image full screen">${renderMedia()}</button>
          <button type="button" className="detail-gallery-zoom" onClick=${() => setLightboxOpen(true)} aria-label="Zoom product image"><${Icon} name="zoom" size=${18}/></button>
          ${mediaItems.length > 1 && html`<div className="detail-gallery-count" aria-live="polite">${imageIndex + 1} / ${mediaItems.length}</div>`}
        </div>
        ${mediaItems.length > 1 && html`<div className="detail-thumbs" aria-label="Product media">${detailImages}</div>`}
      </div>
      <div className="detail-content">
        <div className="detail-mobile-status"><span className="detail-preview-pill">${product.previewOnly ? "Catalog preview" : "Product details"}</span>${product.previewOnly && html`<span className="detail-checkout-note">Checkout disabled</span>`}</div>
        <h1>${title}</h1>
        ${hasReviewData && html`<a className="detail-rating" href="#product-reviews" onClick=${(event) => { if (!product.reviews?.length) event.preventDefault(); }}><span className="rating-stars" aria-label="Rated ${product.rating} out of 5">★★★★★</span><strong>${Number(product.rating).toFixed(1)}</strong><span>(${Number(product.reviewCount).toLocaleString("en-IN")})</span></a>`}
        ${priceContent}
        ${variants.length > 1 && html`<div className="detail-options"><div className="detail-option-head"><span>Choose an option</span></div><div className="size-options">${variants.map((item, index) => html`<button key=${item.id} type="button" className=${`size-option ${variantIndex === index ? "is-selected" : ""}`} disabled=${item.available === false || item.canPurchase === false || !(Number(item.price) > 0)} onClick=${() => setVariantIndex(index)}>${item.selectedOptions?.map((option) => option.value).join(" / ") || item.title}${Number(item.price) > 0 ? ` · ${money(item.price)}` : " · Price pending"}</button>` )}</div></div>`}
        ${detailAttributes.length > 0 && html`<dl className="detail-attributes">${detailAttributes.map((item) => html`<div key=${item.label}><dt>${item.label}</dt><dd>${item.value}</dd></div>`)}</dl>`}
        ${offers.length > 0 && html`<section className="detail-offers" aria-label="Available offers"><h2>Available offers</h2>${offers.slice(0, showAllOffers ? offers.length : 2).map((offer, index) => html`<article key=${offer.code || offer.title || index} className="detail-offer"><span className="detail-offer-icon"><${Icon} name="sparkle" size=${16}/></span><div><strong>${offer.title || offer.text}</strong>${offer.description && html`<p>${offer.description}</p>`}${offer.expiresAt && html`<small>Valid until ${offer.expiresAt}</small>`}${offer.terms && html`<details className="detail-offer-terms"><summary>Terms & conditions</summary><p>${offer.terms}</p></details>`}</div>${offer.code && html`<button type="button" onClick=${() => copyOffer(offer)} aria-label=${`Copy offer code ${offer.code}`}>${offer.code}</button>`}</article>`)}${offers.length > 2 && html`<button type="button" className="detail-offers-toggle" onClick=${() => setShowAllOffers((shown) => !shown)}>${showAllOffers ? "Show less" : `View all ${offers.length} offers`} <${Icon} name=${showAllOffers ? "arrowUp" : "arrow"} size=${13}/></button>`}</section>`}
        ${genericDescription ? html`<p className="detail-preview-copy">Product description is being prepared.</p>` : html`<p className="detail-description">${description}</p>`}
        ${(product.collectionTitles || []).length > 0 && html`<div className="product-collections"><span>Explore in</span><div>${product.collectionTitles.map((collectionTitle) => html`<span key=${collectionTitle}>${collectionTitle}</span>`)}</div></div>`}
        <div className="detail-cart-row">${quantityControl}${addButton()}</div>
      </div>
    </section>
    ${related.length > 0 && html`<section className="products-section section-pad related-products"><${SectionTitle} eyebrow="EXPLORE MORE" title=${html`Related products`} note="Other items in these catalog collections."/><${ProductCarousel} label="Related products" products=${related} onOpen=${onOpen} onAdd=${onAdd} saved=${[]} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/></section>`}
    ${reviews.length > 0 && html`<section id="product-reviews" className="product-reviews section-pad"><h2>Customer reviews</h2>${reviews.map((review, index) => html`<article key=${review.id || index}><strong>${review.title || review.author || "Customer"}</strong><p>${review.text || review.body || review.content}</p></article>`)}</section>`}
    ${canAdd && html`<aside className="detail-sticky-actions" aria-label="Buy Now options">${quantityControl}<div className="detail-sticky-price"><strong>${money(price * quantity)}</strong>${discount > 0 && html`<small>${discount}% off</small>`}</div>${addButton(true)}</aside>`}
    ${lightboxOpen && html`<div className="detail-lightbox" role="dialog" aria-modal="true" aria-label=${`${title} product media`} onClick=${(event) => { if (event.target === event.currentTarget) setLightboxOpen(false); }}><button type="button" className="detail-lightbox-close" onClick=${() => setLightboxOpen(false)} aria-label="Close image viewer"><${Icon} name="close" size=${24}/></button>${mediaItems.length > 1 && html`<button type="button" className="detail-lightbox-prev" onClick=${() => changeMedia(-1)} aria-label="Previous image"><${Icon} name="arrowLeft" size=${24}/></button>`}<div className="detail-lightbox-media">${renderMedia(true)}</div>${mediaItems.length > 1 && html`<button type="button" className="detail-lightbox-next" onClick=${() => changeMedia(1)} aria-label="Next image"><${Icon} name="arrow" size=${24}/></button>`}<span className="detail-lightbox-count">${imageIndex + 1} / ${mediaItems.length}</span></div>`}
  </main>`;
}

function CartPage({ cart, catalog, onUpdate, onRemove, onCheckout, checkoutBusy, checkoutEnabled, serverSubtotal }) {
  const totals = calculateCart(cart, catalog);
  const displayedSubtotal = Number.isFinite(serverSubtotal) ? serverSubtotal : totals.subtotal;
  const originalTotal = totals.lines.reduce((sum, line) => Number(line.compareAt) > Number(line.price) ? sum + Number(line.compareAt) * line.quantity : sum, 0);
  const savings = originalTotal > displayedSubtotal ? originalTotal - displayedSubtotal : 0;
  const canCheckout = checkoutEnabled && totals.lines.length > 0 && totals.lines.every((line) => line.variantId?.startsWith("gid://shopify/ProductVariant/"));
  return html`<main className="page-main cart-route"><section className="page-hero section-pad cart-hero"><div className="eyebrow">YOUR BAG</div><h1>Your <em>cart.</em></h1><p>Cart changes are stored in this browser. Checkout remains disabled until Shopify is configured.</p></section>
    <section className="cart-page section-pad">${totals.lines.length ? html`<div key="cart-list" className="cart-list">${totals.lines.map((line, index) => { const discount = discountPercent(line.price, line.compareAt); const lineKey = line.key || `${line.productId}:${line.variantId || line.variantTitle || index}`; const variant = line.product.variants?.find(item => item.id === line.variantId); const variantLabel = formatVariantLabel(line.product, variant); return html`<article key=${lineKey} className="cart-line cart-page-line"><${ProductImage} src=${variant?.image || line.product.image} alt=${productLabel(line.product)}/><div className="cart-line-info"><h2>${productLabel(line.product)}</h2>${variantLabel&&html`<span>${variantLabel}</span>`}<div className="cart-line-price"><strong>${line.price ? money(line.price * line.quantity) : "Price pending"}</strong>${discount > 0 && html`<del key="compare-at">${money(line.compareAt * line.quantity)}</del><i key="discount">${discount}% off</i>`}</div><div className="cart-qty"><button type="button" aria-label="Decrease quantity" onClick=${() => onUpdate(line.key || lineKey, -1)}><${Icon} name="minus" size=${13}/></button><span>${line.quantity}</span><button type="button" aria-label="Increase quantity" onClick=${() => onUpdate(line.key || lineKey, 1)}><${Icon} name="plus" size=${13}/></button></div></div><button className="remove-line" type="button" onClick=${() => onRemove(line.key || lineKey)} aria-label="Remove item"><${Icon} name="trash" size=${16}/></button></article>`;})}</div><aside key="cart-summary" className="cart-summary"><div className="subtotal-row"><span>Cart total</span><strong>${money(displayedSubtotal)}</strong>${savings > 0 && html`<del key="original-total">${money(originalTotal)}</del><small key="savings">You save ${money(savings)}</small>`}</div><p>Shipping, taxes, and stock are not verified in this preview.</p><button className="button button--dark checkout-button" type="button" disabled=${!canCheckout || checkoutBusy} onClick=${onCheckout}>${checkoutBusy ? "Preparing checkout…" : canCheckout ? "Continue to Shopify checkout" : "Checkout unavailable in preview"}</button><span className="secure-note">No payment is taken in this preview.</span></aside>` : html`<div className="cart-empty"><span className="empty-sparkle">✧</span><h3>Your cart is empty.</h3><p>Browse the client catalog to add priced items to your preview cart.</p></div>`}</section>
  </main>`;
}

function SearchPage({ catalog, query, setQuery, onOpen, onAdd, saved, onSave, cart, onUpdate }) {
  const [visibleCount, setVisibleCount] = useState(24);
  const normalized = query.trim().toLowerCase();
  const matches = normalized ? selectProducts(catalog, { query: normalized }) : [];
  const suggestions = normalized ? collections.filter((collection) => collection.title.toLowerCase().includes(normalized)).slice(0, 4) : collections.slice(0, 6);
  useEffect(() => setVisibleCount(24), [normalized]);
  return html`<main className="page-main search-route"><div className="mobile-search-header"><form onSubmit=${(event) => event.preventDefault()} role="search"><${Icon} name="search" size=${20}/><input autoFocus value=${query} onChange=${(event) => setQuery(event.target.value)} placeholder="Search products…" aria-label="Search the catalog"/><button type="button" aria-label="Clear search" onClick=${() => setQuery("")}><${Icon} name="close" size=${17}/></button></form></div><section className="search-results section-pad"><div className="search-results-heading"><h1>${normalized ? "Search results" : "Discover the catalog"}</h1>${normalized && html`<span>${matches.length} products</span>`}</div>${!normalized && html`<div className="search-suggestions"><h2>Browse collections</h2>${suggestions.map((collection) => html`<button type="button" key=${collection.handle} onClick=${() => { setQuery(collection.title); }}><${Icon} name="search" size=${15}/>${collection.title}<${Icon} name="chevron" size=${15}/></button>`)}</div>`}${normalized && matches.length ? html`<${ProductGrid} key="search-results" products=${matches.slice(0, visibleCount)} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/>${matches.length > visibleCount && html`<div key="search-load-more" className="load-more"><span>Showing ${Math.min(visibleCount, matches.length)} of ${matches.length}</span><button className="button button--outline" type="button" onClick=${() => setVisibleCount((count) => count + 24)}>Load more</button></div>`}` : normalized ? html`<div className="search-empty"><${Icon} name="search" size=${27}/><h2>No products found</h2><p>Try another product name, handle, SKU, or workbook category.</p></div>` : html`<p className="search-hint">Search product names, SKUs, tags, descriptions, and categories from the client workbook.</p>`}</section></main>`;
}

function ProfilePage({ onNavigate, onNotice }) {
  const items = [
    ["My Orders", "View order history", "bag", "#orders"],
    ["Wishlist", "Saved items", "heart", "#wishlist"],
    ["Shipping Policy", "Delivery information pending", "truck", "#policies"],
    ["Return & Refund", "Policy details pending", "check", "#policies"],
    ["Privacy Policy", "Privacy details pending", "user", "#policies"],
    ["Help & Support", "Verified contact details pending", "chat", "#contact"],
  ];
  return html`<main className="page-main profile-page"><section className="profile-desktop page-hero section-pad content-page"><div className="eyebrow">CRYSTAL BAAZ</div><h1>Customer account</h1><p>Shopify customer sign-in is not connected. Account access will be enabled after the client configures a supported authentication flow. This preview does not collect customer data.</p><div className="content-preview-note">This private preview uses the client product workbook for catalog structure. No customer reviews, certification claims, or delivery promises are shown.</div></section><div className="profile-mobile-content"><section className="profile-welcome"><span className="profile-avatar"><${Icon} name="user" size=${25}/></span><div><h1>Welcome, Guest</h1><p>Sign in for a personalized experience</p></div><div className="profile-auth-actions"><button type="button" onClick=${() => onNotice("Customer sign-in will be available after account setup.")}>Sign In</button><button type="button" onClick=${() => onNotice("Account creation is not connected in this preview.")}>Create Account</button></div></section><section className="profile-menu" aria-label="Account links">${items.map(([title, subtitle, icon, href]) => html`<button type="button" key=${title} className="profile-menu-row" onClick=${() => onNavigate(href)}><span className="profile-menu-icon"><${Icon} name=${icon} size=${20}/></span><span className="profile-menu-copy"><b>${title}</b><small>${subtitle}</small></span><${Icon} name="chevron" size=${18}/></button>`)}</section><div className="profile-preview-note">Guest preview · customer accounts and order history are not connected.</div></div></main>`;
}

function ContentPage({ page, onNavigate }) {
  const content = {
    about: ["About Crystal Baaz", "Approved brand story and client information will be added when supplied."],
    contact: ["Contact", "Verified contact details have not been supplied for this preview."],
    copilot: ["Crystal Copilot", "The shopping assistant is not available in this preview yet. Your client catalog can still be browsed by category or search."],
    account: ["Customer account", "Shopify customer sign-in is not connected. Account access will be enabled after the client configures a supported authentication flow. This preview does not collect customer data."],
    orders: ["Order tracking", "Order lookup is disabled until Shopify customer authentication and an approved order-status integration are configured. No order status is simulated in this preview."],
    faq: ["Frequently asked questions", "Product availability, care, delivery, and return details will be added after client approval and Shopify setup."],
    policies: ["Store policies", "Shipping, returns, privacy, and terms require client-approved policy text before checkout is enabled."],
  }[page] || ["Information", "Content is pending client approval."];
  const relatedAction = page === "account"
    ? html`<button className="text-link" type="button" onClick=${() => onNavigate("#orders")}>Order tracking <span>↗</span></button>`
    : page === "orders" ? html`<button className="text-link" type="button" onClick=${() => onNavigate("#account")}>Customer account <span>↗</span></button>` : null;
  return html`<main className="page-main"><section className="page-hero section-pad content-page"><div className="eyebrow">CRYSTAL BAAZ</div><h1>${content[0]}</h1><p>${content[1]}</p><div className="content-preview-note">This private preview uses the client product workbook for catalog structure. No customer reviews, certification claims, or delivery promises are shown.</div>${relatedAction}</section></main>`;
}

function Footer({ onNavigate }) {
  return html`<footer className="site-footer catalog-footer"><div className="footer-main"><div className="footer-brand-col"><span className="brand-name">crystal baaz<span className="brand-dot">.</span></span><small className="footer-preview-note">Client catalog preview · inventory and checkout are under verification.</small></div><div className="footer-links"><div><b>Browse</b><button type="button" onClick=${() => onNavigate("#collections")}>All collections</button><button type="button" onClick=${() => onNavigate("#zodiac")}>Rashi / Zodiac</button><button type="button" onClick=${() => onNavigate("#crystals")}>Crystal types</button><button type="button" onClick=${() => onNavigate("#wishlist")}>Wishlist</button></div><div><b>Information</b><button type="button" onClick=${() => onNavigate("#about")}>About</button><button type="button" onClick=${() => onNavigate("#contact")}>Contact</button><button type="button" onClick=${() => onNavigate("#faq")}>FAQs</button><button type="button" onClick=${() => onNavigate("#policies")}>Policies</button></div></div></div><div className="footer-bottom"><span>© ${new Date().getFullYear()} Crystal Baaz</span></div></footer>`;
}

function HomePage({ catalog, onNavigate, onSearch, onOpen, onAdd, saved, onSave, cart, onUpdate, route }) {
  const [selectedCategory, setSelectedCategory] = useState(mobileCategoryShortcuts[0]);
  const [selectedCrystal, setSelectedCrystal] = useState(null);
  const bestGroup = navigation.find((group) => group.label === "Best Seller");
  const newArrivalGroup = navigation.find((group) => group.label === "New Arrivals");
  const crystalGroup = navigation.find((group) => group.label === "Crystal");
  const pujaGroup = navigation.find((group) => group.label === "Puja");
  const jewelleryGroup = navigation.find((group) => group.label === "Bracelets");
  const bestProducts = getHomepageGroupProducts(catalog, bestGroup).slice(0, 12);
  const newArrivalProducts = getHomepageGroupProducts(catalog, newArrivalGroup).slice(0, 12);
  const crystalItems = (crystalGroup?.items || []).filter((item) => ["collection", "group"].includes(item.kind));
  const activeCrystal = crystalItems.find((item) => item.target === selectedCrystal?.target) || crystalItems[0];
  const crystalProducts = getHomepageItemProducts(catalog, activeCrystal).slice(0, 12);
  const categoryRailItems = mobileCategoryShortcuts.slice(0, 7);
  const activeCategory = categoryRailItems.find((item) => item.target === selectedCategory?.target) || categoryRailItems[0];
  const categoryProducts = getHomepageItemProducts(catalog, activeCategory).slice(0, 12);
  const pujaProducts = getHomepageGroupProducts(catalog, pujaGroup).slice(0, 12);
  const jewelleryProducts = getHomepageGroupProducts(catalog, jewelleryGroup).slice(0, 12);
  const decorProducts = ["pyramid", "pencils", "sphere", "cluster", "agate-slices"].flatMap((handle) => selectProducts(catalog, { filter: { kind: "collection", value: handle } })).filter((product, index, products) => product.title?.trim() && products.findIndex((candidate) => candidate.id === product.id) === index).slice(0, 12);
  const section = (eyebrow, title, note, products, label, href) => {
    const sectionSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return html`<section className=${`products-section section-pad home-reference-rail home-${sectionSlug}`}><div className="section-content"><${SectionTitle} eyebrow=${eyebrow} title=${title} note=${note} action=${html`<button className="text-link" type="button" onClick=${() => onNavigate(href)}>View all <span>→</span></button>`}/><${ProductCarousel} label=${label} products=${products} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/></div></section>`;
  };
  return html`<main className="home-page">
    <section className="hero-section catalog-hero">
      <img className="campaign-image" src="/assets/crystal-bazz-campaign-hero.png" alt="Crystal bracelets, crystal clusters and festive brass lamps arranged for gifting" fetchPriority="high"/>
      <div className="hero-copy"><div className="hero-kicker"><span className="kicker-mark">✧</span> CRYSTAL BAAZ · CLIENT CATALOG</div><h1>Find your next <em>favourite.</em></h1><p>Explore crystals, jewellery and spiritual essentials from the client catalog.</p><div className="hero-actions"><button className="button button--dark" type="button" onClick=${() => onNavigate("#collections")}>Browse collections <${Icon} name="arrow" size=${16}/></button><button className="text-link" type="button" onClick=${() => onNavigate("#zodiac")}>Shop by Rashi <span>↗</span></button></div></div>
      <span className="campaign-slide-indicator" aria-hidden="true"><i></i><i></i><i></i></span>
    </section>
    <section className="value-strip catalog-value-strip"><div><span className="value-icon">◇</span><p><b>Workbook catalog</b><small>Client collection names retained</small></p></div><i></i><div><span className="value-icon">✧</span><p><b>Product details under review</b><small>Shown only where provided</small></p></div><i></i><div><span className="value-icon">↗</span><p><b>Preview shopping bag</b><small>Checkout and payments disabled</small></p></div></section>
    <div className="home-discovery">
      <div className="mobile-discovery-sticky">
        <${HomeSearch} products=${catalog} onSearch=${onSearch}/>
        <${CategoryTabs} onNavigate=${onNavigate} route=${route}/>
      </div>
      <section className="mobile-browse-categories"><div className="mobile-browse-heading"><h2>Browse Categories</h2><button type="button" onClick=${() => onNavigate("#collections")}>View all <${Icon} name="chevron" size=${15}/></button></div><p>Explore handpicked catalog groups from Crystal Baaz.</p><${MobileCategoryNavigation} onNavigate=${onNavigate} route=${route}/><${MobileCategoryTiles} catalog=${catalog} onNavigate=${onNavigate}/></section>
    </div>
    ${newArrivalProducts.length ? html`<section className="products-section section-pad home-reference-rail home-new-arrivals"><div className="section-content"><${SectionTitle} eyebrow="✧ CLIENT WORKBOOK GROUP" title="New Arrivals" note="Products in the workbook’s New Arrivals group; arrival timing has not been independently verified." action=${html`<button className="text-link" type="button" onClick=${() => onNavigate("#collections")}>View all <span>→</span></button>`}/><${ProductCarousel} label="Products in the New Arrivals workbook group" products=${newArrivalProducts} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/><div className="rail-position-note">Showing ${Math.min(newArrivalProducts.length, 6)} of ${newArrivalProducts.length} mapped products</div></div></section>` : null}
    <section className="home-promo-banner"><img src="/assets/crystal-bazz-gifting-banner.png" alt="Crystal Baaz gifting scene with gemstone jewellery, brass frames and lamps" loading="lazy"/><div className="home-promo-copy"><span>CRYSTAL BAAZ · CLIENT CATALOG</span><h2>Bring a little light to your everyday.</h2><p>Explore gemstones, jewellery and meaningful pieces from the client workbook.</p><button type="button" onClick=${() => onNavigate("#collections")}>Explore the catalog <${Icon} name="arrow" size=${15}/></button></div></section>
    <section className="products-section section-pad home-reference-rail home-category-rail"><div className="section-content"><${SectionTitle} eyebrow="EXPLORE BY CATEGORY" title="Category" note="Choose a catalog category to see its mapped products." action=${html`<button className="text-link" type="button" onClick=${() => onNavigate("#collections")}>View all <span>→</span></button>`}/><div className="home-category-filters" role="tablist" aria-label="Product categories">${categoryRailItems.map((item) => html`<button key=${item.target} type="button" role="tab" aria-selected=${activeCategory?.target === item.target} className=${`mobile-category-pill ${activeCategory?.target === item.target ? "is-active" : ""}`} onClick=${() => setSelectedCategory(item)}>${item.label.replace(" & Tops", "")}</button>`)}</div>${categoryProducts.length ? html`<${ProductCarousel} label=${`${activeCategory?.label || "Selected category"} products`} products=${categoryProducts} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/>` : html`<div className="home-rail-empty">This category is listed in the workbook. Its product assignments are still being reviewed.</div>`}</div></section>
    <section className="home-quiz-banner"><div><span>CRYSTAL BAAZ · EXPLORE BY INTENTION</span><h2>Find a crystal that feels like <em>you.</em></h2><p>Browse the client catalog by crystal type and discover the collections available in this preview.</p><button type="button" onClick=${() => onNavigate("#crystals")}>Explore crystals <${Icon} name="arrow" size=${15}/></button></div></section>
    <section className="products-section section-pad home-reference-rail home-crystal-rail"><div className="section-content"><${SectionTitle} eyebrow="SHOP BY STONE" title="Crystal" note="Crystal collections from the client workbook." action=${html`<button className="text-link" type="button" onClick=${() => onNavigate("#crystals")}>View all <span>→</span></button>`}/><div className="home-category-filters" role="tablist" aria-label="Crystal collections">${crystalItems.slice(0, 7).map((item) => html`<button key=${item.target} type="button" role="tab" aria-selected=${activeCrystal?.target === item.target} className=${`mobile-category-pill ${activeCrystal?.target === item.target ? "is-active" : ""}`} onClick=${() => setSelectedCrystal(item)}>${item.label}</button>`)}</div>${crystalProducts.length ? html`<${ProductCarousel} label="${activeCrystal?.label || "Crystal"} products" products=${crystalProducts} onOpen=${onOpen} onAdd=${onAdd} saved=${saved} onSave=${onSave} cart=${cart} onUpdate=${onUpdate}/>` : html`<div className="home-rail-empty">Crystal collection product mapping is being reviewed.</div>`}</div></section>
    <section className="home-editorial-note"><div className="home-editorial-title"><span>CATALOG PREVIEW</span><h2>Made for browsing, with details kept clear.</h2><p>Collection names and product records come from the Crystal Baaz workbook. Descriptions and purchase setup are still being reviewed.</p></div><div className="home-editorial-cards"><article><span>01</span><b>Client workbook</b><p>Browse the supplied product and collection structure.</p></article><article><span>02</span><b>Details under review</b><p>Claims and product information appear only as provided.</p></article><article><span>03</span><b>Preview bag</b><p>Cart interactions work locally; checkout is disabled.</p></article></div></section>
    ${section("CLIENT WORKBOOK CATEGORY", "Pooja Needs", "Spiritual accessories and altar essentials listed in the catalog.", pujaProducts, "Pooja needs products", "#nav/Puja")}
    ${section("JEWELLERY", "Jewellery", "Bracelets and wearable crystal collections from the workbook.", jewelleryProducts, "Jewellery products", "#nav/Bracelets")}
    ${section("DECOR", "Decor", "Pyramids, spheres and crystal pieces for your space.", decorProducts, "Decor products", "#collection/pyramid")}
    <section className="home-why-section"><div className="home-why-art"><img src="/assets/crystal-bazz-campaign-hero.png" alt="A warm crystal arrangement with gemstone bracelets and lamps" loading="lazy"/></div><div className="home-why-copy"><span>WHY CRYSTAL BAAZ</span><h2>A thoughtful catalog for crystal discovery.</h2><p>This preview is built around the client’s own products and collection names. Product claims, availability, delivery and checkout remain subject to verification.</p><button type="button" onClick=${() => onNavigate("#collections")}>Browse the catalog <${Icon} name="arrow" size=${15}/></button></div></section>
    <section className="faq-section section-pad"><div className="faq-intro"><span className="eyebrow">PREVIEW INFORMATION</span><h2>Good to <em>know.</em></h2><p>This page uses the client catalog as its data source.</p><button type="button" className="text-link" onClick=${() => onNavigate("#faq")}>Read the FAQs <span>↗</span></button></div><div className="faq-list"><details><summary>Can I place an order? <span>＋</span></summary><p>No. The current view is a private catalog preview. Shopify checkout will remain disabled until the merchant connection and product data are verified.</p></details><details><summary>Why are some prices missing? <span>＋</span></summary><p>The workbook has SKU rows without final prices. Those products show a pending price and cannot be added to the preview bag.</p></details><details><summary>Are product claims and certifications verified? <span>＋</span></summary><p>Descriptions and claims are under review. No ratings, certification marks, or health outcomes are presented as verified facts.</p></details></div></section>
  </main>`;
}

function StoreApp() {
  const experience = useExperience();
  const accountState = useCustomerAccount();
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const productReturnHash = useRef("#collections");
  const [catalog, setCatalog] = useState([]);
  const [sharedCartData, setSharedCartData] = useState({ itemsKey: "", items: [], loading: false, error: "" });
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  const [retryTick, setRetryTick] = useState(0);
  const cartReturnHash = useRef("#home");
  const [liveCatalog, setLiveCatalog] = useState(false);
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [shopifyProductCount, setShopifyProductCount] = useState(0);
  const [catalogError, setCatalogError] = useState(() => catalogService.source === "shopify" && !catalogService.hasConnection ? "Shopify mode is selected, but public Storefront API configuration is missing." : "");
  const [pageSize, setPageSize] = useState(24);
  const [sort, setSort] = useState(() => parseRoute(window.location.hash).sort || "featured");
  const [typeFilter, setTypeFilter] = useState(() => parseRoute(window.location.hash).facet || "");
  const [query, setQuery] = useState(() => parseRoute(window.location.hash).query || "");
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("crystal-bazz-saved") || "[]"); } catch { return []; } });
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [toast, setToast] = useState("");
  const cartState = useShopifyCart({ catalog, setCatalog, onNotice: setToast });
  const { cart, remoteCart: shopifyCart, pending: cartSyncing, pendingKeys: cartPendingKeys, pendingOperations: cartPendingOperations, error: cartError } = cartState;

  useEffect(() => { void customerAccount.initialize(); }, []);

  const navigate = useCallback((hash) => {
    window.history.pushState({}, "", hash || "#home");
    const next = parseRoute(hash || "#home");
    setRoute(next); setSort(next.sort || "featured"); setTypeFilter(next.facet || ""); setPageSize(24);
    if (next.page === "search") setQuery(next.query);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  useEffect(() => {
    const syncRoute = () => { const next = parseRoute(window.location.hash); setRoute(next); setSort(next.sort || "featured"); setTypeFilter(next.facet || ""); setPageSize(24); if (next.page === "search") setQuery(next.query); };
    window.addEventListener("popstate", syncRoute); window.addEventListener("hashchange", syncRoute);
    return () => { window.removeEventListener("popstate", syncRoute); window.removeEventListener("hashchange", syncRoute); };
  }, []);
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }, []);
  useEffect(() => { localStorage.setItem("crystal-bazz-saved", JSON.stringify(saved)); }, [saved]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 3200); return () => clearTimeout(timer); } }, [toast]);

  useEffect(() => {
    let active = true;
    const loadRouteCatalog = async () => {
      if (catalogService.source !== "shopify") {
        try { const previewProducts = await loadPreviewCatalog(); if (active) setCatalog(previewProducts); } catch { if (active) setCatalogError("Preview catalog could not be loaded."); } finally { if (active) setLoading(false); }
        return;
      }
      if (!catalogService.isLive) { setCatalogError("Shopify Storefront API configuration is missing."); setLoading(false); return; }
      setCatalogError("");
      setLoading(route.page === "product" || catalog.length === 0);
      try {
        const result = await catalogService.loadRoute(route, { sort });
        if (!active || !result) return;
        if (result.products) {
          setCatalog(result.products); setPageInfo(result.pageInfo); setLiveCatalog(true); setPageSize(24);
          setCatalogLoadingMore(Boolean(result.pageInfo?.hasNextPage || !result.fresh));
          setShopifyProductCount(result.mapping?.shopifyProducts || result.products.length);
          if (result.fresh && route.page !== "product") performance.mark("crystal-shopify-first-page-ready");
          const workbookToShopifyId = new Map(result.products.map((product) => [product.workbookId, product.id]));
          setSaved((items) => items.map((id) => workbookToShopifyId.get(id) || id));
        }
        if (route.page === "product") {
          const product = result.product;
          if (active && product) {
            setCatalog((current) => current.some((item) => item.id === product.id) ? current.map((item) => item.id === product.id ? product : item) : [product, ...current]);
            if (!result.products.some((item) => item.id === product.id)) setCatalog((current) => [product, ...current]);
          }
        }
        if (route.page !== "product") {
          setLoading(false);
        }
      } catch (error) { if (active) setCatalogError(error.message || "The Shopify catalog could not be loaded."); } finally { if (active) setLoading(false); }
    };
    loadRouteCatalog();
    return () => { active = false; };
  }, [route.page, route.handle, retryTick]);

  useEffect(() => {
    if (catalogService.source !== "shopify" || !liveCatalog || !catalogLoadingMore || route.page === "product") return undefined;
    let active = true;
    const unsubscribe = catalogService.subscribeCatalogPages((page) => {
      if (!active) return;
      setCatalog(page.products);
      setPageInfo(page.pageInfo);
      setCatalogLoadingMore(Boolean(page.pageInfo?.hasNextPage));
      setShopifyProductCount(page.mapping?.shopifyProducts || page.products.length);
      if (page.event === "catalog-complete") performance.mark("crystal-shopify-catalog-complete");
      setLiveCatalog(true);
      setSaved((items) => {
        const byWorkbookId = new Map(page.products.map(product => [product.workbookId, product.id]));
        return items.map(id => byWorkbookId.get(id) || id);
      });
    });
    void catalogService.loadRemainingCatalog().then((complete) => {
      if (active && complete) {
        setCatalog(complete.products);
        setPageInfo(complete.pageInfo);
        setCatalogLoadingMore(false);
        setShopifyProductCount(complete.mapping?.shopifyProducts || complete.products.length);
      }
    }).catch(error => {
      if (active) {
        setCatalogLoadingMore(false);
        setCatalogError(error.message || "More Shopify products could not be loaded.");
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [route.page, liveCatalog, catalogLoadingMore, retryTick]);

  useEffect(() => {
    if (route.page !== "shared-cart") return undefined;
    let active = true;
    const itemsKey = route.items || "";
    const parsed = parseSharedCartItems(itemsKey);
    if (!parsed.ok) {
      setSharedCartData({ itemsKey, items: [], loading: false, error: "This shared cart link is invalid or has expired. Ask the sender for a new link." });
      return undefined;
    }
    if (!online) {
      setSharedCartData({ itemsKey, items: [], loading: false, error: "Reconnect to verify current Shopify prices and availability." });
      return undefined;
    }
    if (!catalogService.isLive) {
      setSharedCartData({ itemsKey, items: [], loading: false, error: "Shared carts require live Shopify data. Preview catalog items are not added from shared links." });
      return undefined;
    }
    setSharedCartData({ itemsKey, items: [], loading: true, error: "" });
    catalogService.resolveSharedVariants(parsed.items.map(item => item.variantId)).then(resolved => {
      if (!active) return;
      const items = parsed.items.map((item, index) => ({ ...item, ...(resolved[index] || { status: "missing", product: null, variant: null }) }));
      const products = items.map(item => item.product).filter(Boolean);
      if (products.length) setCatalog(current => {
        const next = new Map(current.map(product => [product.id, product]));
        for (const product of products) {
          const existing = next.get(product.id);
          if (!existing) { next.set(product.id, product); continue; }
          const variants = new Map((existing.variants || []).map(variant => [variant.id, variant]));
          for (const variant of product.variants || []) variants.set(variant.id, variant);
          next.set(product.id, { ...existing, variants: [...variants.values()], options: existing.options?.length ? existing.options : product.options });
        }
        return [...next.values()];
      });
      setSharedCartData({ itemsKey, items, loading: false, error: "" });
    }).catch(error => {
      if (active) setSharedCartData({ itemsKey, items: [], loading: false, error: error.message || "Shopify could not verify the shared cart." });
    });
    return () => { active = false; };
  }, [route.page, route.items, online, retryTick]);

  const addToCart = useCallback(async (product, variantSelector, quantity = 1) => {
    if (!navigator.onLine) { setToast("Reconnect to update your Shopify cart."); return false; }
    let selectedProduct = product;
    if (catalogService.isLive && (product.stale === true || !product.variantsComplete)) {
      try {
        const result = await catalogService.loadRoute({ page: "product", handle: product.handle });
        if (!result?.product) { setToast("This product could not be verified with Shopify."); return false; }
        selectedProduct = result.product;
        setCatalog((current) => {
          const details = new Map(current.map(item => [item.id, item]));
          for (const item of result.products || []) details.set(item.id, item);
          details.set(selectedProduct.id, selectedProduct);
          return [...details.values()];
        });
      } catch (error) {
        setToast(error.message || "Product variants could not be verified with Shopify.");
        return;
      }
    }
    let variant = selectVariant(selectedProduct, variantSelector);
    const identityVerified = selectedProduct.variants.length <= 1 || Boolean(formatVariantLabel(selectedProduct, variant));

    const price = Number(variant?.price ?? selectedProduct.price);
    if (!identityVerified || !Number.isFinite(price) || price <= 0 || variant?.canPurchase === false || variant?.available === false || (catalogService.isLive && variant?.canPurchase !== true)) {
      setToast(!identityVerified ? "Shopify option details need correction before this variant can be purchased." : catalogService.isLive ? "No exact, available Shopify variant matches this workbook SKU." : "This SKU has no valid workbook price or is blocked for review.");
      return;
    }
    return cartState.add(selectedProduct, variant.id, quantity);
  }, [cartState.add]);
  const addSharedItems = useCallback(async (items) => {
    if (!catalogService.isLive || !navigator.onLine) return false;
    for (const item of items) {
      const added = await addToCart(item.product, item.variantId, item.quantity);
      if (!added) return false;
    }
    return true;
  }, [addToCart]);
  const updateCart = useCallback((key, delta, label) => cartState.update(key, delta, label), [cartState.update]);
  const removeCart = useCallback((key, label) => cartState.remove(key, label), [cartState.remove]);
  const toggleSaved = useCallback((id) => setSaved((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]), []);
  const openProduct = useCallback((product) => { productReturnHash.current = window.location.hash || "#collections"; navigate(productHash(product)); }, [navigate]);
  const openSharedProduct = useCallback((product, variantId) => { productReturnHash.current = window.location.hash || "#home"; navigate(productHash(product, variantId)); }, [navigate]);
  const checkout = async () => {
    if (!catalogService.canCheckout) { setToast("Shopify checkout is not enabled for this storefront yet."); return; }
    if (!shopifyCart?.id || cartSyncing || cartError) { setToast("Confirm your current Shopify cart before checkout."); return; }
    setCheckoutBusy(true);
    setToast("");
    try {
      const result = await catalogService.checkout(shopifyCart.id, { authenticated: customerAccount.isAuthenticated });
      if (result.disabled || !result.url) { setToast("Shopify checkout is unavailable for this cart."); return; }
      window.location.assign(result.url);
    } catch (error) {
      setToast(error.message || "Shopify could not prepare checkout. Please retry.");
    } finally {
      setCheckoutBusy(false);
    }
  };

  const updateViewOption = (name, value) => {
    const currentHash = window.location.hash || "#home";
    const [path, queryString = ""] = currentHash.split("?");
    const params = new URLSearchParams(queryString);
    if (value && value !== "featured") params.set(name, value); else params.delete(name);
    const nextHash = `${path}${params.size ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, "", nextHash);
    const next = parseRoute(nextHash); setRoute(next); setSort(next.sort || "featured"); setTypeFilter(next.facet || ""); setPageSize(24);
  };
  const loadMore = async () => {
    if (liveCatalog && pageInfo.hasNextPage && pageInfo.endCursor) {
      try {
        const result = await catalogService.loadMore(route, { sort, pageInfo });
        if (result) {
          setCatalog(result.products);
          setPageInfo(result.pageInfo);
          setCatalogLoadingMore(Boolean(result.pageInfo?.hasNextPage));
        }
      } catch (error) { setCatalogError(error.message || "More products could not be loaded."); }
      return;
    }
    setPageSize((current) => current + 24);
  };

  const routeGroup = route.page === "group" ? groupById.get(route.id) : null;
  const routeNav = route.page === "nav" ? navigation.find((group) => group.label.toLowerCase() === route.label.toLowerCase()) : null;
  const routeDiscovery = route.page === "discovery" ? discoveryById.get(route.id) : null;
  let rawProducts = catalog;
  let title = "All products";
  let eyebrow = "CLIENT CATALOG";
  let description = "Products are grouped by handle from the client workbook. Prices, content, variants, stock, and weights remain under review.";
  let pending = false;
  if (route.page === "collection") {
    const collection = collectionByHandle.get(route.handle);
    title = collection?.title || route.handle;
    eyebrow = "CLIENT COLLECTION";
    description = `Collection handle: ${route.handle}. ${collection?.actual_explicit_assignments || 0} explicit product assignments are mapped from the workbook.`;
    rawProducts = selectProducts(catalog, { filter: { kind: "collection", value: route.handle } });
  } else if (route.page === "discovery" && routeDiscovery) {
    title = routeDiscovery.title; eyebrow = "CLIENT CATALOG DISCOVERY";
    description = `Products come only from workbook collection memberships and title matches. ${routeDiscovery.note || ""}`.trim();
    rawProducts = selectDiscoveryProducts(catalog, routeDiscovery);
  } else if (route.page === "group" && routeGroup) {
    title = routeGroup.title; eyebrow = "CLIENT-CURATED GROUP";
    description = `${routeGroup.explicit_product_count || 0} explicit product matches from the SKU list. This group is separate from the 111 Shopify collection registry.`;
    rawProducts = selectProducts(catalog, { filter: { kind: "group", value: route.id } });
  } else if (route.page === "nav" && routeNav) {
    title = routeNav.label; eyebrow = "CLIENT NAVIGATION";
    description = routeNav.label === "New Arrivals" ? "The workbook does not identify arrival dates or a final new-arrivals product list." : "Products appear here only when linked by an explicit workbook collection or SKU group.";
    pending = routeNav.label === "New Arrivals" || (routeNav.kind === "pending" && !routeNav.items?.length);
    rawProducts = getNavigationProducts(catalog, routeNav);
  } else if (route.page === "search") {
    title = route.query ? `Search: ${route.query}` : "Search the catalog"; eyebrow = "SEARCH";
    description = "Search matches product titles and explicit collection names in the current catalog.";
    rawProducts = selectProducts(catalog, { query: route.query });
  } else if (route.page === "wishlist") {
    title = "Your wishlist"; eyebrow = "SAVED PRODUCTS"; description = "Wishlist items are saved in this browser until an account service is configured.";
    rawProducts = selectProducts(catalog, { filter: { kind: "saved" }, saved });
  } else if (route.page === "zodiac" && route.sign) {
    const sign = zodiacSigns.find((item) => item.name.toLowerCase() === route.sign.toLowerCase());
    title = sign ? `${sign.name} · ${sign.hindi}` : route.sign; eyebrow = "RASHI / ZODIAC";
    description = "Only products explicitly named for this sign are shown. No crystal compatibility is inferred.";
    rawProducts = selectProducts(catalog, { filter: { kind: "zodiac", value: route.sign } });
  }
  const typeOptions = [...new Set(rawProducts.flatMap(productFacets))].sort((a, b) => a.localeCompare(b));
  if (typeFilter) rawProducts = rawProducts.filter((product) => matchesProductFacet(product, typeFilter));
  const products = sort === "featured" ? rawProducts : selectProducts(rawProducts, { sort });
  const activeProduct = route.page === "product" ? catalog.find((product) => product.handle === route.handle || product.id === route.handle) : null;
  const cartCount = calculateCart(cart, catalog).count;
  const retryCatalog = () => setRetryTick(value => value + 1);
  const openCart = useCallback(() => { if (route.page !== "cart") cartReturnHash.current = window.location.hash || "#home"; navigate("#cart"); }, [route.page, navigate]);
  const buyNow = useMemo(() => createBuyNowHandler(addToCart), [addToCart]);
  const shared = { onOpen: openProduct, onAdd: buyNow, onSave: toggleSaved, saved, cart, pendingKeys: cartPendingKeys, pendingOperations: cartPendingOperations, onUpdate: updateCart, onNavigate: navigate, onNotice: setToast };
  const dataState = { loading, loadingMore: catalogLoadingMore, error: !online ? "You are offline. Reconnect to load current Shopify products and prices." : catalogError, onRetry: retryCatalog };
  const sortProducts = value => { setSort(value); setPageSize(24); updateViewOption("sort", value); };
  const pageContent = () => {
    if (["home", "cart"].includes(route.page)) return html`<${ShoppingHome} catalog=${catalog} ...${shared} ...${dataState}/>`;
    if (route.page === "account") return html`<${CustomerAccountPage} state=${accountState} account=${customerAccount}/>`;
    if (route.page === "shared-cart") return html`<${ShoppingSharedCart} items=${sharedCartData.items} loading=${sharedCartData.loading} error=${sharedCartData.error} cartCount=${cartCount} cartSyncing=${cartSyncing} cartError=${cartError} onRetryVerification=${retryCatalog} onRetryCart=${cartState.retry} onAddItems=${addSharedItems} onNavigate=${navigate} onOpenProduct=${openSharedProduct}/>`;
    let browseRoute = route;
    if (route.page === "nav" && getParentCategory(route.label)) browseRoute = { ...route, page: "collections", group: getParentCategory(route.label).id };
    if (route.page === "crystals") browseRoute = { ...route, page: "collections", group: "crystals" };
    if (route.page === "zodiac") browseRoute = { ...route, page: "collections", group: "zodiac", category: route.sign ? `zodiac:${route.sign}` : "" };
    if (["collections", "collection", "group"].includes(browseRoute.page)) return html`<${ShoppingBrowse} route=${browseRoute} catalog=${catalog} sort=${sort} onSort=${sortProducts} pageSize=${pageSize} onMore=${loadMore} ...${shared} ...${dataState}/>`;
    if (route.page === "product") return html`<${ShoppingProduct} key=${route.handle} product=${activeProduct} selectedVariantId=${route.variantId||""} catalog=${catalog} onBack=${() => navigate(productReturnHash.current || "#collections")} ...${shared} ...${dataState}/>`;
    if (route.page === "search" || route.page === "wishlist") return html`<${ShoppingResults} catalog=${catalog} title=${route.page === "wishlist" ? "Your wishlist" : route.query ? `Search results for “${route.query}”` : "Search products"} query=${route.query || ""} savedOnly=${route.page === "wishlist"} pageSize=${pageSize} onMore=${loadMore} sort=${sort} onSort=${sortProducts} ...${shared} ...${dataState}/>`;
    if (route.page === "nav" || route.page === "discovery") {
      const items = routeNav ? [...(routeNav.items || []), ...(routeNav.formItems || [])].filter(item => ["collection", "group"].includes(item.kind)) : (routeDiscovery?.collectionHandles || []).map(target => ({ kind: "collection", target }));
      const verified = [...new Map(items.flatMap(item => getItemProducts(catalog,item)).map(product => [product.id, product])).values()];
      return html`<${ShoppingResults} catalog=${verified} title=${title} pageSize=${pageSize} onMore=${loadMore} sort=${sort} onSort=${sortProducts} ...${shared} ...${dataState}/>`;
    }
    return html`<${ShoppingInformation} page=${route.page} onNavigate=${navigate}/>`;
  };
  return html`<div className="shopping-shell" data-catalog-source=${catalogService.source} data-catalog-loaded=${liveCatalog} data-catalog-loading-more=${catalogLoadingMore} data-catalog-product-count=${catalog.length} data-shopify-product-count=${shopifyProductCount} data-route=${route.page} data-cart-pending=${cartSyncing} data-mobile-mode=${experience.mode(route.page, cartCount)}>
    <${ShoppingHeader} route=${route} onBack=${() => navigate(productReturnHash.current)} catalog=${catalog} query=${query} setQuery=${setQuery} onSearch=${term => navigate(`#search/${encodeURIComponent(term || "")}`)} onNavigate=${navigate} onCart=${openCart} cartCount=${cartCount} remoteCart=${shopifyCart} pending=${cartSyncing} cartError=${cartError} savedCount=${saved.length} loading=${loading} accountAuthenticated=${accountState.status === "authenticated"}/>
    ${pageContent()}
    <${ShoppingFooter} onNavigate=${navigate}/>
    ${toast && route.page !== "cart" && html`<div className="toast" role=${cartError ? "alert" : "status"}><span>${toast}</span>${cartError && html`<button type="button" onClick=${() => { setToast(""); void cartState.retry(); }}>Retry</button>`}</div>`}
    <${experience.Controls} route=${route} count=${cartCount} remoteCart=${shopifyCart} pending=${cartSyncing} error=${cartError} onCart=${openCart}/>
    <${ShoppingBottom} route=${route} onNavigate=${navigate} onCart=${openCart} count=${cartCount}/>
    ${route.page === "cart" && html`<${ShoppingCart} cart=${cart} catalog=${catalog} remoteCart=${shopifyCart} syncing=${cartSyncing} pendingKeys=${cartPendingKeys} pendingOperations=${cartPendingOperations} error=${!online ? "Reconnect to update your Shopify cart." : cartError} onRetry=${cartState.retry} onClose=${() => navigate(cartReturnHash.current)} onUpdate=${updateCart} onRemove=${removeCart} checkoutEnabled=${catalogService.canCheckout} checkoutBusy=${checkoutBusy} onCheckout=${checkout}/>`}
  </div>`;
}

createRoot(document.getElementById("root")).render(html`<${ShoppingExperience}><${StoreApp}/><//>`);
