import test from "node:test";
import assert from "node:assert/strict";
import { categoryParents, getParentCategory, hierarchyHref, resolveHierarchy, productsForCategory } from "../src/category-hierarchy.js";
import { parseRoute } from "../src/routes.js";

test("category route roundtrips preserve parent and sibling selection", () => {
  for (const parent of categoryParents.filter((item) => item.items.length > 1)) {
    for (const sibling of parent.items.slice(0, 2)) {
      const state = resolveHierarchy(parseRoute(hierarchyHref(parent.id, sibling.id)));
      assert.equal(state.parent.id, parent.id);
      assert.equal(state.item.id, sibling.id);
      assert.equal(state.state, "products");
      assert.equal(state.invalidSelection, false);
    }
  }
});

test("missing Mala children never fall through to unrelated Mala products", () => {
  const mala = getParentCategory("Mala");
  assert.equal(mala.items.length, 0);
  assert.equal(resolveHierarchy(parseRoute(hierarchyHref("mala"))).item.target, "mala");
  const missing = resolveHierarchy(parseRoute(hierarchyHref("mala", "collection:pearl-mala")));
  assert.equal(missing.invalidSelection, true);
  assert.equal(missing.item, null);
  assert.deepEqual(productsForCategory([{ id: "unrelated", collectionHandles: ["mala"] }], missing.item), []);
});

test("Bracelets child membership intersects the verified parent membership", () => {
  const sphatik = getParentCategory("Bracelets").items.find((item) => item.target === "sphatik");
  const products = [
    { id: "bracelet", collectionHandles: ["sphatik", "bracelets"] },
    { id: "murti", collectionHandles: ["sphatik"] },
    { id: "title-only", title: "Sphatik Bracelet", collectionHandles: [] },
  ];
  assert.deepEqual(productsForCategory(products, sphatik).map((product) => product.id), ["bracelet"]);
});

test("unverified Zodiac and Rudraksha scopes do not use product-title inference", () => {
  const aries = getParentCategory("Zodiac Sign").items.find((item) => item.target === "Aries");
  const rudrakshaBracelets = getParentCategory("Rudraksha").items.find((item) => item.target === "bracelets");
  const products = [{ id: "ambiguous", title: "Aries Rudraksha bracelet", tags: ["Aries"], collectionHandles: ["bracelets"] }];
  assert.deepEqual(productsForCategory(products, aries), []);
  assert.deepEqual(productsForCategory(products, rudrakshaBracelets), []);
});

test("legacy direct collections and groups keep direct product destinations", () => {
  for (const hash of ["#collection/mala", "#collection/bracelets", "#group/group-rashirings", "#collection/money"]) {
    const state = resolveHierarchy(parseRoute(hash));
    assert.equal(state.state, "products", hash);
    assert.equal(state.invalidSelection, false, hash);
    assert.ok(state.item.target, hash);
  }
});
