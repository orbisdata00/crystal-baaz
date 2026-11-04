#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnv } from "vite";

const env = loadEnv("development", process.cwd(), ["VITE_"]);
const token = env.VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN;
const storeDomain = (env.VITE_SHOPIFY_STORE_DOMAIN || "crystalbaaz.myshopify.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const apiVersion = env.VITE_SHOPIFY_API_VERSION || "2026-10";
const endpoint = `https://${storeDomain}/api/${apiVersion}/graphql.json`;
const reportPath = resolve("reports/shopify-cart-smoke-test.json");
const connectionPath = resolve("reports/shopify-connection-report.json");
const auditPath = resolve("reports/shopify-integration-audit.json");
const report = {
  generatedAt: new Date().toISOString(),
  storeDomain,
  apiVersion,
  tokenVariable: "VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN",
  tokenPresent: Boolean(token),
  tokenValueLogged: false,
  publicHeader: "X-Shopify-Storefront-Access-Token",
  cartTest: { status: "not_run", placedOrder: false, checkoutOpened: false, cartIdLogged: false },
};

async function request(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { httpStatus: response.status, errors: [`Non-JSON response (HTTP ${response.status})`], data: null };
  }
  return {
    httpStatus: response.status,
    errors: (payload.errors || []).map((error) => error.message || "GraphQL error"),
    data: payload.data || null,
  };
}

function userErrors(payload) {
  return (payload?.userErrors || []).map((error) => error.message || "Shopify user error");
}

async function persist() {
  await mkdir(resolve("reports"), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (!token) {
  report.status = "blocked_missing_public_token";
  report.error = "VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN is missing; no tokenless request was sent.";
  await persist();
  console.error(report.error);
  process.exit(2);
}

let activeCartId = null;
let lastCartLines = [];

try {
  const preflight = await request(`query CrystalBaazAuthenticatedPreflight {
    shop { name primaryDomain { host url } }
    products(first: 5) {
      nodes { id handle title variants(first: 5) { nodes { id sku availableForSale } } }
      pageInfo { hasNextPage endCursor }
    }
    collections(first: 5) {
      nodes { id handle title }
      pageInfo { hasNextPage endCursor }
    }
  }`);
  report.preflight = {
    httpStatus: preflight.httpStatus,
    graphqlErrors: preflight.errors,
    authenticated: preflight.httpStatus === 200 && preflight.errors.length === 0,
    shop: preflight.data?.shop || null,
    products: {
      requested: 5,
      returned: preflight.data?.products?.nodes?.length || 0,
      hasNextPage: Boolean(preflight.data?.products?.pageInfo?.hasNextPage),
    },
    collections: {
      requested: 5,
      returned: preflight.data?.collections?.nodes?.length || 0,
      hasNextPage: Boolean(preflight.data?.collections?.pageInfo?.hasNextPage),
    },
  };
  if (preflight.httpStatus !== 200 || preflight.errors.length || !preflight.data?.shop) {
    throw new Error("Authenticated preflight failed; cart mutations were not attempted.");
  }

  const candidates = (preflight.data.products?.nodes || []).flatMap((product) =>
    (product.variants?.nodes || [])
      .filter((variant) => variant.availableForSale && variant.id)
      .map((variant) => ({ product, variant })),
  );
  const selection = candidates[0];
  if (!selection) {
    report.cartTest = { ...report.cartTest, status: "blocked_no_available_variant" };
    throw new Error("The first five products contained no available variant for a safe cart test.");
  }

  const cartFields = `cart { id totalQuantity lines(first: 10) {
    nodes { id quantity merchandise { ... on ProductVariant { id } } }
  } }`;
  const operations = [];
  const capture = (name, result, payload, errors = []) => {
    operations.push({ name, httpStatus: result.httpStatus, graphqlErrors: result.errors, userErrors: errors });
    return payload;
  };

  const created = await request(`mutation CrystalBaazSmokeCartCreate { cartCreate(input: {}) { ${cartFields} userErrors { field message } } }`);
  const createdPayload = created.data?.cartCreate;
  const createErrors = userErrors(createdPayload);
  capture("cartCreate", created, createdPayload, createErrors);
  if (created.httpStatus !== 200 || created.errors.length || createErrors.length || !createdPayload?.cart?.id) {
    report.cartTest = { ...report.cartTest, status: "failed", operations };
    throw new Error("Shopify cartCreate did not return a usable temporary cart.");
  }
  activeCartId = createdPayload.cart.id;

  const added = await request(`mutation CrystalBaazSmokeCartAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) { ${cartFields} userErrors { field message } }
  }`, { cartId: activeCartId, lines: [{ merchandiseId: selection.variant.id, quantity: 1 }] });
  const addedPayload = added.data?.cartLinesAdd;
  const addErrors = userErrors(addedPayload);
  capture("cartLinesAdd", added, addedPayload, addErrors);
  if (added.httpStatus !== 200 || added.errors.length || addErrors.length || !addedPayload?.cart) {
    report.cartTest = { ...report.cartTest, status: "failed", operations };
    throw new Error("Shopify cartLinesAdd failed for the temporary cart.");
  }
  lastCartLines = addedPayload.cart.lines?.nodes || [];
  const lineId = lastCartLines[0]?.id;
  if (!lineId) throw new Error("Shopify added the test variant but returned no cart line ID.");

  const updated = await request(`mutation CrystalBaazSmokeCartUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) { ${cartFields} userErrors { field message } }
  }`, { cartId: activeCartId, lines: [{ id: lineId, quantity: 2 }] });
  const updatedPayload = updated.data?.cartLinesUpdate;
  const updateErrors = userErrors(updatedPayload);
  capture("cartLinesUpdate", updated, updatedPayload, updateErrors);
  if (updated.httpStatus !== 200 || updated.errors.length || updateErrors.length || updatedPayload?.cart?.totalQuantity !== 2) {
    report.cartTest = { ...report.cartTest, status: "failed", operations };
    throw new Error("Shopify cartLinesUpdate did not set the temporary line quantity to two.");
  }
  lastCartLines = updatedPayload.cart.lines?.nodes || [];
  const updatedLineId = lastCartLines[0]?.id || lineId;

  const removed = await request(`mutation CrystalBaazSmokeCartRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { ${cartFields} userErrors { field message } }
  }`, { cartId: activeCartId, lineIds: [updatedLineId] });
  const removedPayload = removed.data?.cartLinesRemove;
  const removeErrors = userErrors(removedPayload);
  capture("cartLinesRemove", removed, removedPayload, removeErrors);
  if (removed.httpStatus !== 200 || removed.errors.length || removeErrors.length || removedPayload?.cart?.totalQuantity !== 0) {
    report.cartTest = { ...report.cartTest, status: "failed", operations };
    throw new Error("Shopify cartLinesRemove did not empty the temporary cart.");
  }
  lastCartLines = removedPayload.cart.lines?.nodes || [];

  report.cartTest = {
    status: "passed",
    operations,
    testProductHandle: selection.product.handle,
    startingQuantity: 1,
    updatedQuantity: 2,
    finalQuantity: removedPayload.cart.totalQuantity,
    finalCartEmpty: lastCartLines.length === 0,
    temporaryCartIdCreated: true,
    cartIdLogged: false,
    checkoutUrlRequested: false,
    checkoutOpened: false,
    placedOrder: false,
    note: "Temporary cart was created, populated, quantity-updated, and emptied; no checkout or order was initiated.",
  };
  report.status = "passed";
  await persist();

  const connection = JSON.parse(await readFile(connectionPath, "utf8"));
  connection.authenticatedPreflight = {
    ...connection.authenticatedPreflight,
    attempted: true,
    authenticationStatus: "authenticated",
    httpStatus: preflight.httpStatus,
    graphqlErrors: preflight.errors,
    shop: preflight.data.shop,
    productsQuery: {
      requested: 5,
      returned: report.preflight.products.returned,
      hasNextPage: report.preflight.products.hasNextPage,
    },
    collectionsQuery: {
      requested: 5,
      returned: report.preflight.collections.returned,
      hasNextPage: report.preflight.collections.hasNextPage,
    },
  };
  connection.cartApiTest = report.cartTest;
  await writeFile(connectionPath, `${JSON.stringify(connection, null, 2)}\n`, "utf8");

  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  audit.verification = {
    ...(audit.verification || {}),
    authenticatedShopQuery: "passed",
    authenticatedProductsQuery: `passed; first page returned ${report.preflight.products.returned}`,
    authenticatedCollectionsQuery: `passed; first page returned ${report.preflight.collections.returned}`,
    cartMutations: "passed on temporary cart; create, add, quantity update, and remove verified; no checkout or order",
  };
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  const mappingPath = resolve("reports/shopify-catalog-mapping-report.json");
  const mapping = JSON.parse(await readFile(mappingPath, "utf8"));
  mapping.frontend.cartMutationsRun = true;
  mapping.frontend.cartSmokeTest = "passed on temporary cart; empty at completion; no checkout or order";
  await writeFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    tokenPresent: report.tokenPresent,
    tokenValueLogged: false,
    preflight: report.preflight,
    cartTest: {
      status: report.cartTest.status,
      operations: operations.map(({ name, httpStatus, graphqlErrors, userErrors }) => ({ name, httpStatus, graphqlErrors, userErrors })),
      updatedQuantity: report.cartTest.updatedQuantity,
      finalCartEmpty: report.cartTest.finalCartEmpty,
      placedOrder: false,
      checkoutOpened: false,
    },
  }, null, 2));
} catch (error) {
  if (activeCartId && lastCartLines.length) {
    try {
      await request(`mutation CrystalBaazSmokeCleanup($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { totalQuantity } userErrors { field message } }
      }`, { cartId: activeCartId, lineIds: lastCartLines.map((line) => line.id) });
      report.cartTest.cleanupAttempted = true;
    } catch {
      report.cartTest.cleanupAttempted = true;
      report.cartTest.cleanupSucceeded = false;
    }
  }
  report.status ||= "failed";
  report.error = error?.message || "Storefront preflight/cart smoke test failed.";
  await persist();
  console.error(report.error);
  process.exitCode = 1;
}
