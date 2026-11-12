import iconRegistry from "./data/category-icons.json" with { type: "json" };

const iconBaseUrl = import.meta.env?.BASE_URL || "./";
const temporaryRegistry = iconRegistry.temporary || {};
const sprites = temporaryRegistry.sprites || {};
const overrides = temporaryRegistry.overrides || {};

function categoryIconKey(item) {
  if (item?.iconKey) return item.iconKey;
  if (item?.parentId) return `${item.parentId}/${item.kind}:${item.target}`;
  return `parent/${item?.id || item?.target || ""}`;
}

function inferredSprite(item) {
  const label = String(item?.label || "").toLowerCase();
  const parent = String(item?.parentId || "").toLowerCase();
  const target = String(item?.target || "").toLowerCase();
  const text = `${label} ${target}`;
  if (/(best seller|new arrival)/.test(text)) return "gift";
  if (/(rudraksha|mukhi)/.test(text)) {
    if (/(bracelet|wrist)/.test(text)) return "rudrakshaBracelet";
    if (/(mala|japa|rosary)/.test(text)) return "mala";
    if (/(pendant|kavach|amulet)/.test(text)) return "pendant";
    return "rudraksha";
  }
  if (/(mala|japa|rosary)/.test(text)) return "mala";
  if (/(earring|tops)/.test(text)) return "earrings";
  if (/(\bring(?:s)?\b|anguthi)/.test(text)) return "ring";
  if (/(anklet|bangle)/.test(text)) return "ankletBangle";
  if (/(bracelet|wristband)/.test(text)) return "crystalBracelet";
  if (/(pendant|kavach|amulet)/.test(text)) return "pendant";
  if (/(zodiac|rashi|aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)/.test(text)) return "zodiac";
  if (/(puja|pooja|diya|shaligram|yantra)/.test(text) || parent === "pooja") return "pujaDiya";
  if (/(sphere|spheres|ball)/.test(text)) return "spheres";
  if (/pyramid/.test(text)) return "pyramid";
  if (/(cluster|geode)/.test(text)) return "crystalCluster";
  if (/(gift|gifting)/.test(text)) return "gift";
  if (/(gemstone|gem\b|crystal|agate|amethyst|quartz|jasper|obsidian|malachite|tourmaline|citrine|rose quartz|stone)/.test(text)
    || ["crystals", "intentions"].includes(parent)) return "gemstones";
  if (["rudraksha"].includes(parent)) return "rudraksha";
  if (["best-seller", "new-arrivals", "intentions"].includes(parent)) return "assortment";
  return null;
}

function imageUrlForHandle(collectionImages, handle) {
  if (!handle) return "";
  const entry = collectionImages?.[handle];
  const url = typeof entry === "string" ? entry : entry?.url;
  if (!url) return "";
  try {
    const imageUrl = new URL(url);
    if (imageUrl.hostname === "cdn.shopify.com") imageUrl.searchParams.set("width", "320");
    return imageUrl.href;
  } catch {
    return url;
  }
}

export function resolveCategoryArtwork(item, collectionImages = {}) {
  const collectionHandle = item?.collectionImageHandle
    || (item?.kind === "collection" || item?.kind === "category" ? item.target : "");
  const shopifyUrl = imageUrlForHandle(collectionImages, collectionHandle);
  const iconKey = categoryIconKey(item);
  const approvedUrl = iconRegistry.icons?.[iconKey];
  const spriteName = overrides[iconKey] || inferredSprite(item);
  const spriteIndex = sprites[spriteName];
  const hasSprite = Number.isInteger(spriteIndex);
  const assetUrl = temporaryRegistry.assetUrl
    ? `${iconBaseUrl}${temporaryRegistry.assetUrl.replace(/^\/+/, "")}`
    : "";
  const temporary = hasSprite && assetUrl
    ? { name: spriteName, index: spriteIndex, columns: temporaryRegistry.columns || 4, rows: temporaryRegistry.rows || 4, assetUrl }
    : null;
  if (shopifyUrl) return { source: "shopify", url: shopifyUrl, temporary };
  if (approvedUrl) return { source: "approved", url: approvedUrl, temporary };
  return temporary ? { source: "temporary", temporary } : null;
}

