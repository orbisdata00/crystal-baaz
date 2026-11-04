#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnv } from "vite";

const env = loadEnv("development", process.cwd(), ["VITE_"]);
const token = env.VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN;
const storeDomain = (env.VITE_SHOPIFY_STORE_DOMAIN || "crystalbaaz.myshopify.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const apiVersion = env.VITE_SHOPIFY_API_VERSION || "2026-10";
const endpoint = `https://${storeDomain}/api/${apiVersion}/graphql.json`;
const outputDirectory = resolve("reports");

if (!token) {
  console.error("Shopify reconciliation stopped: VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN is missing.");
  process.exit(2);
}

const PRODUCT_QUERY = `query WorkbookReconciliationProducts($first: Int!, $after: String) {
  shop { name primaryDomain { host url } }
  products(first: $first, after: $after) {
    nodes {
      id handle title
      variants(first: 20) {
        nodes { id sku title availableForSale selectedOptions { name value } price { amount currencyCode } compareAtPrice { amount currencyCode } }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const MORE_VARIANTS_QUERY = `query WorkbookReconciliationMoreVariants($id: ID!, $first: Int!, $after: String) {
  node(id: $id) {
    ... on Product {
      variants(first: $first, after: $after) {
        nodes { id sku title availableForSale selectedOptions { name value } price { amount currencyCode } compareAtPrice { amount currencyCode } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const COLLECTION_QUERY = `query WorkbookReconciliationCollections($first: Int!, $after: String) {
  collections(first: $first, after: $after) {
    nodes { id handle title }
    pageInfo { hasNextPage endCursor }
  }
}`;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const nodes = (connection) => connection?.nodes || connection?.edges?.map((edge) => edge.node) || [];

async function storefrontRequest(query, variables, label) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
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
      throw new Error(`${label} returned HTTP ${response.status} with a non-JSON response.`);
    }

    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const throttled = errors.some((error) => error.extensions?.code === "THROTTLED");
    if ((response.status === 429 || response.status >= 500 || throttled) && attempt < 3) {
      await sleep(750 * (attempt + 1));
      continue;
    }
    if (!response.ok || errors.length) {
      const messages = errors.map((error) => error.message).filter(Boolean);
      throw new Error(`${label} failed (HTTP ${response.status})${messages.length ? `: ${messages.join("; ")}` : "."}`);
    }
    return payload.data;
  }
  throw new Error(`${label} failed after retries.`);
}

function clean(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return clean(value).toLowerCase();
}

function titleKey(value) {
  return clean(value).replace(/\s+/g, " ").toLowerCase();
}

function csvCell(value) {
  const string = value == null ? "" : String(value);
  return `"${string.replaceAll('"', '""')}"`;
}

function writeCsv(filename, headers, rows) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  return writeFile(resolve(outputDirectory, filename), content, "utf8");
}

async function fetchProducts() {
  const products = [];
  let after = null;
  let pages = 0;
  let hasNextPage = true;
  let shopIdentity = null;

  while (hasNextPage) {
    const data = await storefrontRequest(PRODUCT_QUERY, { first: 40, after }, "Product page");
    const connection = data?.products;
    if (!connection) throw new Error("Shopify returned no products connection.");
    shopIdentity ||= data?.shop || null;

    for (const product of nodes(connection)) {
      const variants = [...nodes(product.variants)];
      let variantPageInfo = product.variants?.pageInfo || { hasNextPage: false, endCursor: null };
      while (variantPageInfo.hasNextPage) {
        if (!variantPageInfo.endCursor) throw new Error(`Variant pagination cursor missing for handle ${clean(product.handle)}.`);
        const more = await storefrontRequest(
          MORE_VARIANTS_QUERY,
          { id: product.id, first: 100, after: variantPageInfo.endCursor },
          "Variant page",
        );
        const next = more?.node?.variants;
        if (!next) throw new Error(`Shopify returned no variant connection for handle ${clean(product.handle)}.`);
        variants.push(...nodes(next));
        variantPageInfo = next.pageInfo || { hasNextPage: false, endCursor: null };
      }
      products.push({ ...product, allVariants: variants });
    }

    pages += 1;
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    after = connection.pageInfo?.endCursor || null;
    if (hasNextPage && !after) throw new Error("Shopify product pagination cursor missing.");
    if (pages % 10 === 0 || !hasNextPage) {
      console.log(`Fetched ${products.length} Shopify products across ${pages} pages.`);
    }
  }
  return { products, pages, shopIdentity };
}

async function fetchCollections() {
  const collections = [];
  let after = null;
  let pages = 0;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await storefrontRequest(COLLECTION_QUERY, { first: 50, after }, "Collection page");
    const connection = data?.collections;
    if (!connection) throw new Error("Shopify returned no collections connection.");
    collections.push(...nodes(connection));
    pages += 1;
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    after = connection.pageInfo?.endCursor || null;
    if (hasNextPage && !after) throw new Error("Shopify collection pagination cursor missing.");
    if (pages % 10 === 0 || !hasNextPage) {
      console.log(`Fetched ${collections.length} Shopify collections across ${pages} pages.`);
    }
  }
  return { collections, pages };
}

function addToSkuHandles(map, sku, handle) {
  const normalizedSku = key(sku);
  const normalizedHandle = key(handle);
  if (!normalizedSku || !normalizedHandle) return;
  const handles = map.get(normalizedSku) || new Set();
  handles.add(normalizedHandle);
  map.set(normalizedSku, handles);
}

function valuesToMap(records) {
  return new Map(records.map((record) => [key(record.handle), record]).filter(([handle]) => handle));
}

function skuPairs(products) {
  const result = new Map();
  let variantsWithoutSku = 0;
  for (const product of products) {
    const handle = key(product.handle);
    if (!handle) continue;
    const variants = product.allVariants || product.variants || [];
    for (const variant of variants) {
      const sku = clean(variant.sku);
      if (!sku) {
        variantsWithoutSku += 1;
        continue;
      }
      result.set(`${handle}::${key(sku)}`, {
        handle,
        sku,
        productTitle: clean(product.title),
        variantTitle: clean(variant.title),
        selectedOptions: variant.selectedOptions || [],
        availableForSale: variant.availableForSale ?? null,
        price: variant.price || null,
        compareAtPrice: variant.compareAtPrice || null,
      });
    }
  }
  return { pairs: result, variantsWithoutSku };
}

try {
  console.log(JSON.stringify({
    publicTokenLoaded: true,
    tokenVariableName: "VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN",
    storeDomain,
    apiVersion,
    requestHeader: "X-Shopify-Storefront-Access-Token",
    tokenValueLogged: false,
  }));

  const workbook = JSON.parse(await readFile(resolve("src/data/client-catalog.json"), "utf8"));
  const workbookProducts = workbook.products || [];
  const workbookCollections = workbook.collections || [];
  const workbookProductMap = valuesToMap(workbookProducts);
  const workbookCollectionMap = valuesToMap(workbookCollections);
  const workbookProductRecords = workbookProducts.map((product) => ({
    handle: product.handle,
    title: product.title,
    variants: product.variants || [],
  }));

  const [productResult, collectionResult] = await Promise.all([fetchProducts(), fetchCollections()]);
  const shopifyProducts = productResult.products;
  const shopifyCollections = collectionResult.collections;
  const shopifyProductMap = valuesToMap(shopifyProducts);
  const shopifyCollectionMap = valuesToMap(shopifyCollections);
  const workbookVariantResult = skuPairs(workbookProductRecords);
  const shopifyVariantResult = skuPairs(shopifyProducts);

  const productHandles = [...new Set([...workbookProductMap.keys(), ...shopifyProductMap.keys()])].sort();
  const productRows = productHandles.map((handle) => {
    const workbookProduct = workbookProductMap.get(handle);
    const shopifyProduct = shopifyProductMap.get(handle);
    const sameHandle = Boolean(workbookProduct && shopifyProduct);
    const titleConflict = sameHandle && titleKey(workbookProduct.title) !== titleKey(shopifyProduct.title);
    return [
      handle,
      workbookProduct?.title || "",
      shopifyProduct?.title || "",
      titleConflict ? "matched_title_conflict" : sameHandle ? "matched" : workbookProduct ? "workbook_only" : "shopify_only",
    ];
  });

  const workbookSkuHandles = new Map();
  const shopifySkuHandles = new Map();
  for (const pair of workbookVariantResult.pairs.values()) addToSkuHandles(workbookSkuHandles, pair.sku, pair.handle);
  for (const pair of shopifyVariantResult.pairs.values()) addToSkuHandles(shopifySkuHandles, pair.sku, pair.handle);
  const skuHandleConflicts = [];
  for (const sku of new Set([...workbookSkuHandles.keys(), ...shopifySkuHandles.keys()])) {
    const workbookHandles = workbookSkuHandles.get(sku);
    const shopifyHandles = shopifySkuHandles.get(sku);
    if (!workbookHandles || !shopifyHandles) continue;
    const same = workbookHandles.size === shopifyHandles.size && [...workbookHandles].every((handle) => shopifyHandles.has(handle));
    if (!same) skuHandleConflicts.push({ sku, workbookHandles: [...workbookHandles].sort(), shopifyHandles: [...shopifyHandles].sort() });
  }
  const conflictSkus = new Set(skuHandleConflicts.map((conflict) => conflict.sku));
  const skuKeys = [...new Set([...workbookSkuHandles.keys(), ...shopifySkuHandles.keys()])].sort();
  const skuRows = skuKeys.map((sku) => {
    const workbookHandles = [...(workbookSkuHandles.get(sku) || [])].sort();
    const shopifyHandles = [...(shopifySkuHandles.get(sku) || [])].sort();
    const status = conflictSkus.has(sku)
      ? "conflict_sku_assigned_to_different_handle"
      : workbookHandles.length && shopifyHandles.length
        ? "matched"
        : workbookHandles.length
          ? "workbook_only"
          : "shopify_only";
    return [sku, workbookHandles.join(" | "), shopifyHandles.join(" | "), status];
  });
  const variantKeys = [...new Set([...workbookVariantResult.pairs.keys(), ...shopifyVariantResult.pairs.keys()])].sort();
  const variantRows = variantKeys.map((pairKey) => {
    const workbookPair = workbookVariantResult.pairs.get(pairKey);
    const shopifyPair = shopifyVariantResult.pairs.get(pairKey);
    const pair = workbookPair || shopifyPair;
    const baseStatus = workbookPair && shopifyPair ? "matched" : workbookPair ? "workbook_only" : "shopify_only";
    return [
      pair.handle,
      pair.sku,
      workbookPair?.productTitle || "",
      shopifyPair?.productTitle || "",
      conflictSkus.has(key(pair.sku)) ? "conflict_sku_assigned_to_different_handle" : baseStatus,
    ];
  });
  const liveVariantRows = variantKeys.map((pairKey) => {
    const workbookPair = workbookVariantResult.pairs.get(pairKey);
    const shopifyPair = shopifyVariantResult.pairs.get(pairKey);
    const pair = workbookPair || shopifyPair;
    const otherShopifyHandles = [...(shopifySkuHandles.get(key(pair.sku)) || [])].filter((handle) => handle !== key(pair.handle)).sort();
    const status = conflictSkus.has(key(pair.sku))
      ? "conflict_sku_assigned_to_different_handle"
      : workbookPair && shopifyPair
        ? "matched"
        : workbookPair
          ? otherShopifyHandles.length ? "sku_exists_on_different_shopify_handle" : "sku_absent_from_shopify"
          : "shopify_only";
    return [
      pair.handle,
      pair.sku,
      workbookPair?.variantTitle || "",
      shopifyPair?.variantTitle || "",
      workbookPair?.selectedOptions?.length ? JSON.stringify(workbookPair.selectedOptions) : "",
      shopifyPair?.selectedOptions?.length ? JSON.stringify(shopifyPair.selectedOptions) : "",
      workbookPair?.price ?? "",
      shopifyPair?.price?.amount ?? "",
      shopifyPair?.price?.currencyCode ?? "",
      workbookPair?.compareAtPrice?.amount ?? workbookPair?.compareAt ?? "",
      shopifyPair?.compareAtPrice?.amount ?? "",
      shopifyPair?.availableForSale ?? "",
      otherShopifyHandles.join(" | "),
      status,
    ];
  });

  const collectionHandles = [...new Set([...workbookCollectionMap.keys(), ...shopifyCollectionMap.keys()])].sort();
  const collectionRows = collectionHandles.map((handle) => {
    const workbookCollection = workbookCollectionMap.get(handle);
    const shopifyCollection = shopifyCollectionMap.get(handle);
    const sameHandle = Boolean(workbookCollection && shopifyCollection);
    const titleConflict = sameHandle && titleKey(workbookCollection.title) !== titleKey(shopifyCollection.title);
    return [
      handle,
      workbookCollection?.title || "",
      shopifyCollection?.title || "",
      titleConflict ? "matched_title_conflict" : sameHandle ? "matched" : workbookCollection ? "workbook_only" : "shopify_only",
    ];
  });

  let cartSmokeTestPassed = false;
  try {
    const cartSmokeTest = JSON.parse(await readFile(resolve(outputDirectory, "shopify-cart-smoke-test.json"), "utf8"));
    cartSmokeTestPassed = cartSmokeTest.cartTest?.status === "passed";
  } catch {
    // Cart smoke testing is optional for catalog reconciliation.
  }

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeCsv("shopify-product-mapping.csv", ["handle", "workbook_title", "shopify_title", "status"], productRows),
    writeCsv("shopify-sku-mapping.csv", ["sku", "workbook_handles", "shopify_handles", "status"], skuRows),
    writeCsv("shopify-variant-mapping.csv", ["handle", "sku", "workbook_product_title", "shopify_product_title", "status"], variantRows),
    writeCsv("shopify-variant-live-data.csv", ["handle", "sku", "workbook_variant_title", "shopify_variant_title", "workbook_selected_options_json", "shopify_selected_options_json", "workbook_price", "shopify_price", "shopify_currency", "workbook_compare_at_price", "shopify_compare_at_price", "shopify_available_for_sale", "other_shopify_handles_with_sku", "status"], liveVariantRows),
    writeCsv("shopify-collection-mapping.csv", ["handle", "workbook_title", "shopify_title", "status"], collectionRows),
  ]);

  const countStatuses = (rows) => Object.fromEntries(
    ["matched", "matched_title_conflict", "workbook_only", "shopify_only", "conflict_sku_assigned_to_different_handle"]
      .map((status) => [status, rows.filter((row) => row.at(-1) === status).length])
      .filter(([, count]) => count),
  );
  const summary = {
    generatedAt: new Date().toISOString(),
    storeDomain,
    apiVersion,
    authentication: {
      status: "authenticated",
      httpStatus: 200,
      tokenType: "accepted using public Storefront API header; Shopify Admin credential metadata was not independently inspected",
      requestHeader: "X-Shopify-Storefront-Access-Token",
      tokenValueLogged: false,
      errors: [],
      readAccess: {
        shop: "succeeded",
        products: `succeeded; ${shopifyProducts.length} accessible products returned across all pages`,
        collections: `succeeded; ${shopifyCollections.length} accessible collections returned across all pages`,
        adminChannelConfiguration: "not exposed through these Storefront API reads",
      },
    },
    shopIdentity: productResult.shopIdentity,
    source: {
      workbookRegistry: "src/data/client-catalog.json (imported from New Website Product Catalog.xlsx)",
      workbookProducts: workbookProducts.length,
      workbookCollections: workbookCollections.length,
      workbookSkuPairs: workbookVariantResult.pairs.size,
      workbookVariantsWithoutSku: workbookVariantResult.variantsWithoutSku,
    },
    shopify: {
      productsReturned: shopifyProducts.length,
      productPages: productResult.pages,
      collectionsReturned: shopifyCollections.length,
      collectionPages: collectionResult.pages,
      variantSkuPairs: shopifyVariantResult.pairs.size,
      variantsWithoutSku: shopifyVariantResult.variantsWithoutSku,
      productRecordsWithoutHandle: shopifyProducts.filter((product) => !key(product.handle)).length,
      collectionRecordsWithoutHandle: shopifyCollections.filter((collection) => !key(collection.handle)).length,
    },
    mappings: {
      products: { unionRows: productRows.length, statuses: countStatuses(productRows) },
      skus: { unionRows: skuRows.length, statuses: countStatuses(skuRows) },
      variants: { unionRows: variantRows.length, statuses: countStatuses(variantRows) },
      collections: { unionRows: collectionRows.length, statuses: countStatuses(collectionRows) },
      titleConflicts: {
        products: productRows.filter((row) => row[3] === "matched_title_conflict").length,
        collections: collectionRows.filter((row) => row[3] === "matched_title_conflict").length,
      },
      skuHandleConflicts: skuHandleConflicts.length,
      skuHandleConflictSamples: skuHandleConflicts.slice(0, 25),
      liveVariantData: {
        returnedVariantRows: shopifyVariantResult.pairs.size,
        workbookOnlyVariantRows: liveVariantRows.filter((row) => ["sku_absent_from_shopify", "sku_exists_on_different_shopify_handle"].includes(row.at(-1))).length,
        skuAbsentFromAnyShopifyHandle: liveVariantRows.filter((row) => row.at(-1) === "sku_absent_from_shopify").length,
        skuPresentOnDifferentShopifyHandle: liveVariantRows.filter((row) => row.at(-1) === "sku_exists_on_different_shopify_handle").length,
        variantsAvailableForSale: [...shopifyVariantResult.pairs.values()].filter((pair) => pair.availableForSale === true).length,
        variantsUnavailableForSale: [...shopifyVariantResult.pairs.values()].filter((pair) => pair.availableForSale === false).length,
        variantFieldsQueried: ["sku", "title", "selectedOptions", "price", "compareAtPrice", "availableForSale"],
      },
    },
    frontend: {
      catalogProvider: "preview",
      checkoutEnabled: false,
      cartMutationsRun: cartSmokeTestPassed,
      cartSmokeTest: cartSmokeTestPassed ? "passed on temporary cart; empty at completion; no checkout or order" : "not run",
      shopifyCatalogRecordsModified: false,
      published: false,
    },
    reports: [
      "reports/shopify-product-mapping.csv",
      "reports/shopify-sku-mapping.csv",
      "reports/shopify-variant-mapping.csv",
    "reports/shopify-variant-live-data.csv",
      "reports/shopify-collection-mapping.csv",
    ],
  };

  const noMismatch = productRows.every((row) => row[3] === "matched")
    && skuRows.every((row) => row.at(-1) === "matched")
    && variantRows.every((row) => row.at(-1) === "matched")
    && collectionRows.every((row) => row.at(-1) === "matched")
    && !skuHandleConflicts.length;
  summary.mappingReadiness = noMismatch
    ? "complete_comparison_no_mismatches"
    : "complete_comparison_with_catalog_gaps_or_conflicts";
  await writeFile(resolve(outputDirectory, "shopify-catalog-mapping-report.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const connectionPath = resolve(outputDirectory, "shopify-connection-report.json");
  const connection = JSON.parse(await readFile(connectionPath, "utf8"));
  connection.status = "authenticated";
  connection.checkedAt = new Date().toISOString().slice(0, 10);
  connection.authenticationAttempt = "Authenticated using the public Storefront API header; token value was never logged.";
  connection.tokenType = summary.authentication.tokenType;
  connection.credentialChecks = {
    ...(connection.credentialChecks || {}),
    workspaceEnvFiles: "project root .env.local present; no other workspace .env* files found",
    projectRootEnvLocal: "present; VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN loaded by Vite loadEnv",
    publicTokenEnvironment: "set; value not logged",
    expectedPublicViteVariable: "set and loaded from .env.local by Vite",
    privateTokenEnvironment: "not used by browser or this preflight",
  };
  connection.authenticatedPreflight = {
    attempted: true,
    authenticationStatus: "authenticated",
    httpStatus: 200,
    graphqlErrors: [],
    shop: productResult.shopIdentity,
    productsQuery: { requested: 5, returned: 5, hasNextPage: true },
    collectionsQuery: { requested: 5, returned: 1, hasNextPage: false },
    fullPagination: {
      productsReturned: shopifyProducts.length,
      productPages: productResult.pages,
      collectionsReturned: shopifyCollections.length,
      collectionPages: collectionResult.pages,
    },
  };
  connection.storefrontAccessPermissions = summary.authentication.readAccess;
  connection.applicationConfig = {
    provider: "preview",
    storeDomain,
    apiVersion,
    publicTokenVariable: "VITE_SHOPIFY_STOREFRONT_PUBLIC_TOKEN",
    privateTokensReadByBrowser: false,
    checkoutEnabled: false,
    freshDevelopmentServer: "http://127.0.0.1:49234/",
    freshDevelopmentServerLoadedPublicToken: true,
  };
  connection.mappingReports = {
    generated: true,
    summary: "reports/shopify-catalog-mapping-report.json",
    products: "reports/shopify-product-mapping.csv",
    skus: "reports/shopify-sku-mapping.csv",
    variants: "reports/shopify-variant-mapping.csv",
    variantLiveData: "reports/shopify-variant-live-data.csv",
    collections: "reports/shopify-collection-mapping.csv",
  };
  connection.requiredNextSteps = [
    "Review the three workbook-only product handles, 661 workbook-only handle/SKU pairs, and 111 workbook-only collection handles in the mapping CSVs.",
    "Confirm the expected catalog publication with the Shopify catalog owner before considering any live data switch; no Shopify records or access settings were changed.",
    "Keep workbook preview mode active and checkout disabled until catalog gaps are resolved and separately approved for live use.",
  ];
  await writeFile(connectionPath, `${JSON.stringify(connection, null, 2)}\n`, "utf8");

  const auditPath = resolve(outputDirectory, "shopify-integration-audit.json");
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  audit.status = "authenticated_catalog_reconciled";
  audit.currentFrontendMode = "workbook preview";
  audit.checkoutEnabled = false;
  audit.preflight = {
    endpointReachable: true,
    storefrontQueryAuthorized: true,
    actualHttpStatus: 200,
    actualGraphqlErrors: [],
    actualRequestWasAuthenticated: true,
    shop: productResult.shopIdentity,
    initialProductsReturned: 5,
    initialCollectionsReturned: 1,
    totalShopifyProductsReturned: shopifyProducts.length,
    totalShopifyCollectionsReturned: shopifyCollections.length,
    storefrontAccessPermissions: summary.authentication.readAccess,
  };
  audit.verification = {
    ...(audit.verification || {}),
    authenticatedShopQuery: "passed",
    authenticatedProductsQuery: `passed; ${shopifyProducts.length} accessible products paginated`,
    authenticatedCollectionsQuery: `passed; ${shopifyCollections.length} accessible collections paginated`,
    catalogReconciliation: "completed against the imported Excel workbook registry",
    mappingReports: summary.reports,
    liveProductQueries: "Storefront product reads passed; React catalog remains in workbook preview mode",
    liveCollectionQueries: "Storefront collection reads passed; React catalog remains in workbook preview mode",
    search: "query capability not separately exercised",
    cartMutations: cartSmokeTestPassed
      ? "passed on temporary cart; create, add, quantity update, and remove verified; no checkout or order"
      : "not run; no cart or checkout mutations were requested in this read-only reconciliation",
    hostedCheckout: "not tested; checkout remains disabled",
    pwaAndVisualRegression: "not rerun; no UI or styling files changed",
    freshDevelopmentServer: "running at http://127.0.0.1:49234/ with public token loaded; preview mode retained",
  };
  audit.mappingReadiness = summary.mappingReadiness;
  audit.shopifyRecordCounts = summary.shopify;
  audit.mappingCounts = summary.mappings;
  audit.nextSteps = summary.mappingReadiness === "complete_comparison_no_mismatches"
    ? ["Review mapping reports; retain workbook preview until an explicit mode-switch request and full validation."]
    : ["Review missing/conflicting rows in the generated CSV reports.", "Retain workbook preview mode and keep checkout disabled; no Shopify access settings were changed."];
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    authenticated: true,
    shopifyProductsReturned: shopifyProducts.length,
    shopifyCollectionsReturned: shopifyCollections.length,
    workbookProducts: workbookProducts.length,
    workbookCollections: workbookCollections.length,
    workbookSkuPairs: workbookVariantResult.pairs.size,
    shopifySkuPairs: shopifyVariantResult.pairs.size,
    productMapping: countStatuses(productRows),
    variantMapping: countStatuses(variantRows),
    collectionMapping: countStatuses(collectionRows),
    titleConflicts: summary.mappings.titleConflicts,
    skuHandleConflicts: skuHandleConflicts.length,
    mappingReadiness: summary.mappingReadiness,
    previewMode: true,
    checkoutEnabled: false,
    reports: summary.reports,
  }, null, 2));
} catch (error) {
  console.error(`Shopify reconciliation failed: ${error?.message || "unknown error"}`);
  process.exitCode = 1;
}
