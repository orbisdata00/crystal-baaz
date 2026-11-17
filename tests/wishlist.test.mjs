import assert from "node:assert/strict";
import test from "node:test";
import { mergeWishlistIds, normalizeWishlistIds, persistWishlistToggle, updateCustomerWishlist } from "../src/wishlist.js";

test("wishlist updates only after persistence succeeds", () => {
  const values = new Map();
  const storage = { setItem(key, value) { values.set(key, value); } };
  const added = persistWishlistToggle(storage, [], "product-1");
  assert.deepEqual(added, { ok: true, saved: ["product-1"], wasSaved: false });
  assert.deepEqual(JSON.parse(values.get("crystal-bazz-saved")), ["product-1"]);
  const removed = persistWishlistToggle(storage, added.saved, "product-1");
  assert.deepEqual(removed, { ok: true, saved: [], wasSaved: true });
  assert.deepEqual(JSON.parse(values.get("crystal-bazz-saved")), []);
});

test("wishlist keeps its current state when browser storage rejects a change", () => {
  const current = ["product-1"];
  const result = persistWishlistToggle({ setItem() { throw new Error("storage unavailable"); } }, current, "product-2");
  assert.equal(result.ok, false);
  assert.strictEqual(result.saved, current);
});

test("customer wishlist accepts only real Shopify product IDs and merges without duplicates", () => {
  const first = "gid://shopify/Product/123";
  const second = "gid://shopify/Product/456";
  assert.deepEqual(normalizeWishlistIds({ version: 1, items: [{ productId: first }, { productId: "preview-1" }, { productId: first }] }), [first]);
  assert.deepEqual(mergeWishlistIds([first], [first, second]), [first, second]);
});

test("guest merge retries a compare-digest conflict without overwriting another device's item", async () => {
  const guest = "gid://shopify/Product/123";
  const remoteItem = "gid://shopify/Product/456";
  const concurrentItem = "gid://shopify/Product/789";
  let remote = { items: [remoteItem], compareDigest: "digest-1" };
  let writes = 0;
  const account = {
    async readWishlist() { return { ...remote, items: [...remote.items] }; },
    async writeWishlist(items, digest) {
      writes += 1;
      if (writes === 1) {
        remote = { items: [...remote.items, concurrentItem], compareDigest: "digest-2" };
        const error = new Error("stale digest"); error.code = "INVALID_COMPARE_DIGEST"; throw error;
      }
      assert.equal(digest, "digest-2");
      remote = { items: [...items], compareDigest: "digest-3" };
      return { compareDigest: remote.compareDigest };
    },
  };
  const saved = await updateCustomerWishlist(account, items => mergeWishlistIds(items, [guest]));
  assert.deepEqual(saved.items, [remoteItem, concurrentItem, guest]);
  assert.deepEqual(remote.items, saved.items);
  assert.equal(writes, 2);
});
