import test from "node:test";
import assert from "node:assert/strict";
import { categoryParents, mainCategories, getParentCategory, hierarchyHref, resolveHierarchy, productsForCategory } from "../src/category-hierarchy.js";
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
  assert.equal(mala.items.length, 2);
  assert.deepEqual(mala.items.map(item=>item.label), ["Pearl Mala", "Ruby Mala"]);
  assert.equal(resolveHierarchy(parseRoute(hierarchyHref("mala"))).state, "overview");
  const missing = resolveHierarchy(parseRoute(hierarchyHref("mala", "collection:pearl-mala")));
  assert.equal(missing.invalidSelection, false);
  assert.equal(missing.item.membershipVerified, false);
  assert.deepEqual(productsForCategory([{ id: "unrelated", collectionHandles: ["mala"] }], missing.item), []);
});

test("MAIN leaves Bracelets as its direct explicit product category", () => {
  const bracelets = getParentCategory("Bracelets");
  assert.equal(bracelets.items.length, 0);
  const products = [
    { id: "bracelet", collectionHandles: ["sphatik", "bracelets"] },
    { id: "murti", collectionHandles: ["sphatik"] },
    { id: "title-only", title: "Sphatik Bracelet", collectionHandles: [] },
  ];
  assert.deepEqual(productsForCategory(products, bracelets).map((p) => p.id), ["bracelet"]);
});

test("unverified Zodiac and Rudraksha scopes never infer membership from titles", () => {
  const aries = getParentCategory("zodiac-signs").items.find((item) => item.target === "Aries");
  const pendants = getParentCategory("Rudraksha").items.find((item) => item.label === "Pendants");
  assert.ok(aries);
  assert.ok(pendants);
  const products = [{ id: "ambiguous", title: "Aries Rudraksha pendant", tags: ["Aries"], collectionHandles: ["pendants"] }];
  assert.deepEqual(productsForCategory(products, aries), []);
  assert.deepEqual(productsForCategory(products, pendants), []);
  const bracelets = getParentCategory("Rudraksha").items.find((item) => item.label === "Bracelets");
  assert.equal(bracelets.target, "group-rudrakshabracelet");
  assert.deepEqual(productsForCategory(products, bracelets), []);
});

test("legacy direct collections and groups keep direct product destinations", () => {
  for (const hash of ["#collection/mala", "#collection/bracelets", "#group/group-rashirings", "#collection/money"]) {
    const state = resolveHierarchy(parseRoute(hash));
    assert.equal(state.state, "products", hash);
    assert.equal(state.invalidSelection, false, hash);
    assert.ok(state.item.target, hash);
  }
});

test("MAIN is the sole eight-root sequence and retains every declared child", () => {
  assert.deepEqual(mainCategories.map((p) => p.label), ["Best Seller", "New Arrivals", "Rashi / Zodiac", "Bracelets", "Rudraksha", "Crystal", "Puja", "Remedy"]);
  assert.equal(getParentCategory("Crystal").items.length, 35);
  assert.equal(getParentCategory("Remedy").items.length, 69);
  assert.equal(getParentCategory("Remedy").items.at(-1).label, "Missing Number 9");
  assert.equal(getParentCategory("Crystal").items[17].label, "Heart");
  assert.ok(getParentCategory("mala"));
  assert.ok(getParentCategory("all"));
  assert.ok(!mainCategories.some((p) => ["all", "mala"].includes(p.id)));
});

test("arrivals stay empty and pending without genuine arrival evidence", () => {
  const parent = getParentCategory("New Arrivals");
  assert.equal(parent.membershipVerified, false);
  assert.deepEqual(productsForCategory([{id:"imported", publishedAt:"2026-11-05", groupIds:["group-new-arrivals"]}], parent), []);
});

test("Money Magnet MAIN rule accepts only identified workbook-matched live products", () => {
  const money = getParentCategory("Best Seller").items.find((item) => item.label === "Money");
  const products = [
    {id:"gid://shopify/Product/1",workbookId:"mapped",title:"Natural Pyrite Owl",collectionHandles:[]},
    {id:"gid://shopify/Product/2",workbookId:"mapped",title:"Dhan bracelet",collectionHandles:[]},
    {id:"gid://shopify/Product/3",workbookId:"mapped",title:"Ordinary bracelet",collectionHandles:[]},
    {id:"preview",title:"Money Magnet",collectionHandles:[]},
    {id:"gid://shopify/Product/4",title:"Money Magnet",collectionHandles:[]},
  ];
  assert.deepEqual(productsForCategory(products, money).map((p)=>p.id), ["gid://shopify/Product/1","gid://shopify/Product/2"]);
  assert.deepEqual(productsForCategory(products, getParentCategory("Best Seller")).map((p)=>p.id), ["gid://shopify/Product/1","gid://shopify/Product/2"]);
});

test("Shop by Rashi retains all twelve ordered English/Hindi signs", () => {
  const shop = getParentCategory("Rashi / Zodiac").items.find((item)=>item.relatedParentId);
  const signs = resolveHierarchy(parseRoute(hierarchyHref(shop.relatedParentId)));
  assert.equal(signs.items.length,12);
  assert.equal(signs.items[0].label,"Aries - मेष");
  assert.equal(signs.items.at(-1).label,"Pisces – मीन");
});

test("saved pre-MAIN stone and zodiac URLs retain their verified scope", () => {
  const stone = resolveHierarchy(parseRoute("#collections?group=bracelets&category=collection%3Asphatik"));
  assert.equal(stone.invalidSelection,false);
  assert.equal(stone.item.requiredCollectionHandle,"bracelets");
  const products=[{id:"bracelet",collectionHandles:["bracelets","sphatik"]},{id:"murti",collectionHandles:["sphatik"]}];
  assert.deepEqual(productsForCategory(products,stone.item).map((p)=>p.id),["bracelet"]);
  const sign=resolveHierarchy(parseRoute("#collections?group=zodiac&category=zodiac%3AAries"));
  assert.equal(sign.invalidSelection,false);
  assert.equal(sign.parent.id,"zodiac-signs");
  assert.equal(sign.item.membershipVerified,false);
});
