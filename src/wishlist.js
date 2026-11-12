const STORAGE_KEY = "crystal-bazz-saved";

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
