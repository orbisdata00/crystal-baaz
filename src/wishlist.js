const STORAGE_KEY = "crystal-bazz-saved";
export const CUSTOMER_WISHLIST_NAMESPACE = "custom";
export const CUSTOMER_WISHLIST_KEY = "crystal_baaz_wishlist";
export const SHOPIFY_PRODUCT_GID = /^gid:\/\/shopify\/Product\/[1-9]\d{0,23}$/;

export function normalizeWishlistIds(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  const ids = entries.map(entry => typeof entry === "string" ? entry : entry?.productId)
    .filter(id => typeof id === "string" && SHOPIFY_PRODUCT_GID.test(id));
  return [...new Set(ids)];
}

export function mergeWishlistIds(...lists) {
  return [...new Set(lists.flatMap(list => normalizeWishlistIds(list)))];
}

export function toggleWishlistId(items, productId) {
  if (typeof productId !== "string" || !SHOPIFY_PRODUCT_GID.test(productId)) {
    throw new Error("This product cannot be saved to a customer wishlist yet.");
  }
  const current = normalizeWishlistIds(items);
  return current.includes(productId) ? current.filter(id => id !== productId) : [...current, productId];
}

export async function updateCustomerWishlist(account, update, { attempts = 4 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await account.readWishlist();
    const items = normalizeWishlistIds(update([...current.items]));
    if (items.length === current.items.length && items.every((id, index) => id === current.items[index])) return current;
    try {
      const saved = await account.writeWishlist(items, current.compareDigest);
      return { ...saved, items };
    } catch (error) {
      if (error?.code !== "INVALID_COMPARE_DIGEST" || attempt === attempts - 1) throw error;
    }
  }
  throw new Error("Your wishlist changed on another device. Please try again.");
}

export function persistWishlistToggle(storage, saved, productId) {
  const wasSaved = saved.includes(productId);
  const next = wasSaved ? saved.filter((id) => id !== productId) : [...saved, productId];
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    return { ok: true, saved: next, wasSaved };
  } catch {
    return { ok: false, saved, wasSaved };
  }
}
