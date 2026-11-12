import assert from "node:assert/strict";
import test from "node:test";
import { persistWishlistToggle } from "../src/wishlist.js";

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
