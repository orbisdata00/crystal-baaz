import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createCustomerAccountClient,
  createPkceChallenge,
  isSecureShopifyUrl,
  verifyCustomerIdToken,
} from "../src/customer-account.js";
import { createCatalogService } from "../src/catalog-service.js";
import { createHostedCheckout } from "../src/shopify.js";
import { CustomerAccountPage } from "../src/customer-account-ui.js";

const encoder = new TextEncoder();
const base64url = value => Buffer.from(value).toString("base64url");

async function createSignedIdToken({ nonce, now = Date.now(), keys, clientId = "public-client-id", issuer = "https://shopify.com/authentication/test-store" }) {
  const header = base64url(JSON.stringify({ alg: "RS256", kid: keys.kid, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: issuer, aud: clientId, sub: "shopify-customer-123", exp: Math.floor(now / 1000) + 600, iat: Math.floor(now / 1000), ...(nonce ? { nonce } : {}) }));
  const signed = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signed).toString("base64url")}`;
}

async function createKeys() {
  const pair = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "shopify-test-key";
  jwk.use = "sig";
  return { ...pair, jwk, kid: jwk.kid };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeBrowser() {
  const values = new Map();
  const assigned = [];
  const location = {
    origin: "https://crystalbaaz.example",
    protocol: "https:",
    pathname: "/",
    hash: "#account",
    href: "https://crystalbaaz.example/#account",
    assign(value) { assigned.push(value); },
  };
  const sessionStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const history = {
    replaceState(_state, _title, value) {
      const url = new URL(value, location.origin);
      location.pathname = url.pathname;
      location.hash = url.hash;
      location.href = url.href;
    },
  };
  return { location, sessionStorage, history, assigned, values, dispatchEvent() {} };
}

const configured = {
  storeDomain: "crystalbaaz.myshopify.com",
  customerAccountClientId: "public-client-id",
  customerAccountRedirectUri: "https://crystalbaaz.example/account/callback",
  customerAccountLogoutUri: "https://crystalbaaz.example/",
};

test("account view renders setup state and address management from actual account data", () => {
  const account = { login() {}, logout() {}, updateAddress() {}, deleteAddress() {}, createAddress() {} };
  const pending = renderToStaticMarkup(React.createElement(CustomerAccountPage, { state: { status: "unconfigured", error: "Setup pending" }, account }));
  assert.match(pending, /Customer sign-in setup is pending/);
  assert.match(pending, /Setup pending/);

  const address = { id: "gid://shopify/CustomerAddress/42", firstName: "Asha", lastName: "Rao", address1: "12 Market Road", city: "Pune", zoneCode: "MH", countryCode: "IN", zip: "411001", formatted: ["Asha Rao", "12 Market Road", "Pune, MH 411001", "India"] };
  const dashboard = renderToStaticMarkup(React.createElement(CustomerAccountPage, { state: { status: "authenticated", customer: {
    id: "gid://shopify/Customer/42", displayName: "Asha Rao", emailAddress: { emailAddress: "asha@example.test" },
    defaultAddress: address, addresses: { nodes: [{ ...address, id: "gid://shopify/CustomerAddress/43", address1: "18 Garden Lane", isDefault: false }] }, orders: { nodes: [] },
  } }, account }));
  assert.match(dashboard, /asha@example\.test/);
  assert.match(dashboard, /Add address/);
  assert.match(dashboard, /Default address/);
  assert.match(dashboard, /Make default/);
  assert.match(dashboard, /Edit/);
  assert.match(dashboard, /Delete/);
});

test("public OAuth client uses PKCE S256 and rejects insecure or unregistered origins", async () => {
  const verifier = "secure-verifier-from-cryptographic-randomness";
  assert.match(await createPkceChallenge(verifier, webcrypto), /^[A-Za-z0-9_-]+$/);
  assert.equal(isSecureShopifyUrl("https://accounts.shopify.com/auth"), true);
  assert.equal(isSecureShopifyUrl("http://accounts.shopify.com/auth"), false);
  assert.equal(isSecureShopifyUrl("https://user:pass@accounts.shopify.com/auth"), false);

  const browser = makeBrowser();
  let fetchCount = 0;
  const client = createCustomerAccountClient({
    config: configured,
    windowRef: browser,
    cryptoApi: webcrypto,
    fetchImpl: async () => {
      fetchCount += 1;
      return response({ authorization_endpoint: "https://shopify.test/authorize", token_endpoint: "https://shopify.test/token", end_session_endpoint: "https://shopify.test/logout", jwks_uri: "https://shopify.test/jwks", issuer: "https://shopify.test" });
    },
  });
  assert.equal(await client.initialize().then(() => client.getSnapshot().status), "signed-out");
  assert.equal(await client.login(), true);
  const authorization = new URL(browser.assigned[0]);
  const transaction = JSON.parse(browser.sessionStorage.getItem("crystal-baaz-customer-oauth-transaction"));
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("redirect_uri"), configured.customerAccountRedirectUri);
  assert.equal(authorization.searchParams.get("state"), transaction.state);
  assert.equal(authorization.searchParams.get("nonce"), transaction.nonce);
  assert.equal(authorization.searchParams.get("code_challenge"), await createPkceChallenge(transaction.verifier, webcrypto));
  assert.equal(authorization.searchParams.get("client_id"), configured.customerAccountClientId);

  const insecure = createCustomerAccountClient({ config: { ...configured, customerAccountRedirectUri: "http://crystalbaaz.example/callback" }, windowRef: browser, cryptoApi: webcrypto, fetchImpl: async () => response({}) });
  await insecure.initialize();
  assert.equal(insecure.getSnapshot().status, "unconfigured");
  assert.equal(fetchCount, 1);
});

test("Customer Account API validates signed identity, state, nonce, callback, dashboard scopes, refresh and logout", async () => {
  const keys = await createKeys();
  const browser = makeBrowser();
  const calls = [];
  const addressMutations = [];
  let now = Date.now();
  let transaction;
  const discovery = {
    authorization_endpoint: "https://crystalbaaz.myshopify.com/authentication/oauth/authorize",
    token_endpoint: "https://crystalbaaz.myshopify.com/authentication/oauth/token",
    end_session_endpoint: "https://crystalbaaz.myshopify.com/authentication/logout",
    jwks_uri: "https://crystalbaaz.myshopify.com/authentication/.well-known/jwks.json",
    issuer: "https://shopify.com/authentication/test-store",
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/.well-known/openid-configuration")) return response(discovery);
    if (String(url).endsWith("/.well-known/customer-account-api")) return response({ graphql_api: "https://crystalbaaz.myshopify.com/customer/api/2026-10/graphql" });
    if (url === discovery.jwks_uri) return response({ keys: [keys.jwk] });
    if (url === discovery.token_endpoint) {
      const form = new URLSearchParams(init.body);
      if (form.get("grant_type") === "authorization_code") {
        assert.equal(form.get("redirect_uri"), configured.customerAccountRedirectUri);
        assert.equal(form.get("code_verifier"), transaction.verifier);
        return response({ access_token: "access-token-one", refresh_token: "refresh-token-one", expires_in: 1, id_token: await createSignedIdToken({ nonce: transaction.nonce, now, keys }) });
      }
      if (form.get("grant_type") === "refresh_token") {
        assert.equal(form.get("refresh_token"), "refresh-token-one");
        return response({ access_token: "access-token-two", refresh_token: "refresh-token-two", expires_in: 3600, id_token: await createSignedIdToken({ now, keys }) });
      }
      return response({ error: "unsupported_grant_type" }, 400);
    }
    if (String(url).endsWith("/graphql")) {
      assert.equal(init.headers.Authorization, "access-token-two");
      const request = JSON.parse(init.body);
      if (request.query.includes("customerAddressCreate")) {
        addressMutations.push({ query: request.query, variables: request.variables });
        return response({ data: { customerAddressCreate: { customerAddress: { id: "gid://shopify/CustomerAddress/1", ...request.variables.address }, userErrors: [] } } });
      }
      if (request.query.includes("customerAddressUpdate")) {
        addressMutations.push({ query: request.query, variables: request.variables });
        return response({ data: { customerAddressUpdate: { customerAddress: { id: request.variables.addressId, ...request.variables.address }, userErrors: [] } } });
      }
      if (request.query.includes("customerAddressDelete")) {
        addressMutations.push({ query: request.query, variables: request.variables });
        return response({ data: { customerAddressDelete: { deletedAddressId: request.variables.addressId, userErrors: [] } } });
      }
      assert.match(request.query, /orders\(first: 10, reverse: true\)/);
      assert.match(request.query, /addresses\(first: 10, skipDefault: true\)/);
      assert.match(request.query, /defaultAddress \{[^}]*countryCode/s);
      return response({ data: { customer: {
        id: "gid://shopify/Customer/123", displayName: "Test Customer",
        emailAddress: { emailAddress: "customer@example.test" },
        defaultAddress: { id: "address-1", formatted: ["Test Customer", "Example City"] },
        addresses: { nodes: [] }, orders: { nodes: [{ id: "order-1", name: "#1001", lineItems: { nodes: [{ title: "Actual Shopify order line", quantity: 1 }] } }] },
      } } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const startClient = createCustomerAccountClient({ config: configured, windowRef: browser, fetchImpl, cryptoApi: webcrypto, now: () => now });
  await startClient.initialize();
  await startClient.login();
  transaction = JSON.parse(browser.sessionStorage.getItem("crystal-baaz-customer-oauth-transaction"));

  browser.location.pathname = "/account/callback";
  browser.location.href = `${configured.customerAccountRedirectUri}?code=one-use-code&state=${transaction.state}`;
  const callbackClient = createCustomerAccountClient({ config: configured, windowRef: browser, fetchImpl, cryptoApi: webcrypto, now: () => now });
  await callbackClient.initialize();
  assert.equal(callbackClient.getSnapshot().status, "authenticated");
  assert.equal(browser.sessionStorage.getItem("crystal-baaz-customer-oauth-transaction"), null);
  assert.equal(browser.sessionStorage.getItem("crystal-baaz-customer-session-hint"), "1");
  assert.ok([...browser.values.values()].every(value => !String(value).includes("access-token") && !String(value).includes("refresh-token") && !String(value).includes("id_token")));

  now += 2000;
  const customer = await callbackClient.loadDashboard();
  assert.equal(customer.displayName, "Test Customer");
  assert.equal(customer.orders.nodes[0].name, "#1001");
  const refresh = calls.find(call => call.url === discovery.token_endpoint && new URLSearchParams(call.init.body).get("grant_type") === "refresh_token");
  assert.ok(refresh, "expired access tokens use the in-memory refresh token when Shopify issues one");

  const newAddress = { firstName: "Asha", lastName: "Rao", address1: "12 Market Road", city: "Pune", zoneCode: "MH", countryCode: "IN", zip: "411001", phoneNumber: "+919876543210" };
  const createdAddress = await callbackClient.createAddress({ ...newAddress, ignored: "not forwarded" }, { defaultAddress: true });
  assert.equal(createdAddress.id, "gid://shopify/CustomerAddress/1");
  assert.deepEqual(addressMutations[0].variables, { address: newAddress, defaultAddress: true });
  await callbackClient.updateAddress(createdAddress.id, null, { defaultAddress: true });
  assert.deepEqual(addressMutations[1].variables, { addressId: createdAddress.id, defaultAddress: true });
  assert.equal(await callbackClient.deleteAddress(createdAddress.id), createdAddress.id);
  assert.equal(addressMutations.length, 3);
  await assert.rejects(callbackClient.deleteAddress("not-a-customer-address-id"), /Choose a saved Shopify address/);

  await callbackClient.logout();
  const logoutUrl = new URL(browser.assigned.at(-1));
  assert.equal(logoutUrl.origin + logoutUrl.pathname, discovery.end_session_endpoint);
  assert.ok(logoutUrl.searchParams.get("id_token_hint"));
  assert.equal(logoutUrl.searchParams.get("post_logout_redirect_uri"), configured.customerAccountLogoutUri);
  assert.equal(callbackClient.getSnapshot().status, "signed-out");
  assert.equal(browser.sessionStorage.getItem("crystal-baaz-customer-session-hint"), null);
});

test("Shopify public app sessions without refresh tokens renew through silent authorization", async () => {
  const keys = await createKeys();
  const browser = makeBrowser();
  let now = Date.now();
  let transaction;
  const grants = [];
  const discovery = {
    authorization_endpoint: "https://crystalbaaz.myshopify.com/authentication/oauth/authorize",
    token_endpoint: "https://crystalbaaz.myshopify.com/authentication/oauth/token",
    end_session_endpoint: "https://crystalbaaz.myshopify.com/authentication/logout",
    jwks_uri: "https://crystalbaaz.myshopify.com/authentication/.well-known/jwks.json",
    issuer: "https://shopify.com/authentication/test-store",
  };
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith("/.well-known/openid-configuration")) return response(discovery);
    if (url === discovery.jwks_uri) return response({ keys: [keys.jwk] });
    if (url === discovery.token_endpoint) {
      const form = new URLSearchParams(init.body);
      grants.push(form.get("grant_type"));
      assert.equal(form.get("grant_type"), "authorization_code");
      return response({
        access_token: "short-lived-public-app-token",
        expires_in: 1,
        id_token: await createSignedIdToken({ nonce: transaction.nonce, now, keys }),
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const startClient = createCustomerAccountClient({ config: configured, windowRef: browser, fetchImpl, cryptoApi: webcrypto, now: () => now });
  await startClient.initialize();
  await startClient.login();
  transaction = JSON.parse(browser.sessionStorage.getItem("crystal-baaz-customer-oauth-transaction"));

  browser.location.pathname = "/account/callback";
  browser.location.href = `${configured.customerAccountRedirectUri}?code=initial&state=${transaction.state}`;
  const callbackClient = createCustomerAccountClient({ config: configured, windowRef: browser, fetchImpl, cryptoApi: webcrypto, now: () => now });
  await callbackClient.initialize();
  assert.equal(callbackClient.getSnapshot().status, "authenticated");

  now += 2000;
  await assert.rejects(callbackClient.loadDashboard(), /needs to be renewed/);
  await new Promise(resolve => setTimeout(resolve, 0));
  const renewal = new URL(browser.assigned.at(-1));
  assert.equal(renewal.searchParams.get("prompt"), "none");
  assert.equal(renewal.searchParams.get("response_type"), "code");
  assert.equal(renewal.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(grants, ["authorization_code"]);
  assert.ok([...browser.values.values()].every(value => !String(value).includes("short-lived-public-app-token")));
});

test("invalid OAuth state, nonce and JWT signature are rejected before customer data is fetched", async () => {
  const keys = await createKeys();
  const now = Date.now();
  const jwt = await createSignedIdToken({ nonce: "expected", now, keys });
  const fetchJwks = async () => response({ keys: [keys.jwk] });
  await assert.rejects(verifyCustomerIdToken(jwt, {
    clientId: configured.customerAccountClientId, issuer: "https://shopify.com/authentication/test-store",
    nonce: "different", jwksUri: "https://accounts.shopify.com/jwks", fetchImpl: fetchJwks, cryptoApi: webcrypto, now,
  }), /identity verification failed/);
  const [header, payload, signature] = jwt.split(".");
  const tampered = `${header}.${base64url(JSON.stringify({ iss: "https://shopify.com/authentication/test-store", aud: configured.customerAccountClientId, sub: "attacker", exp: Math.floor(now / 1000) + 600, nonce: "expected" }))}.${signature}`;
  await assert.rejects(verifyCustomerIdToken(tampered, {
    clientId: configured.customerAccountClientId, issuer: "https://shopify.com/authentication/test-store",
    nonce: "expected", jwksUri: "https://accounts.shopify.com/jwks", fetchImpl: fetchJwks, cryptoApi: webcrypto, now,
  }), /identity verification failed/);

  const browser = makeBrowser();
  browser.location.pathname = "/account/callback";
  browser.location.href = `${configured.customerAccountRedirectUri}?code=bad&state=attacker-state`;
  browser.sessionStorage.setItem("crystal-baaz-customer-oauth-transaction", JSON.stringify({ state: "real-state", verifier: "unused", nonce: "nonce", returnPath: "/#account", createdAt: now }));
  let tokenCalls = 0;
  const client = createCustomerAccountClient({ config: configured, windowRef: browser, cryptoApi: webcrypto, now: () => now, fetchImpl: async url => {
    if (String(url).endsWith("/.well-known/openid-configuration")) return response({
      authorization_endpoint: "https://shopify.test/authorize", token_endpoint: "https://shopify.test/token",
      end_session_endpoint: "https://shopify.test/logout", jwks_uri: "https://shopify.test/jwks", issuer: "https://shopify.test",
    });
    if (String(url).endsWith("/token")) tokenCalls += 1;
    return response({});
  } });
  await client.initialize();
  assert.equal(tokenCalls, 0);
  assert.equal(client.getSnapshot().status, "error");
  assert.equal(client.getSnapshot().customer, null);
});

test("checkout handoff re-reads Shopify checkoutUrl, preserves guest mode, and adds documented SSO only for signed-in customers", async () => {
  let queriedCart = "";
  const checkout = await createHostedCheckout({ id: "gid://shopify/Cart/cart-1" }, null, null, {
    enabled: true,
    loadDestination: async id => { queriedCart = id; return { checkoutUrl: "https://crystalbaaz.myshopify.com/checkouts/current?key=one", cart: { id } }; },
  });
  assert.equal(queriedCart, "gid://shopify/Cart/cart-1");
  assert.equal(new URL(checkout.url).searchParams.has("sso"), false);
  const authenticated = await createHostedCheckout({ id: "gid://shopify/Cart/cart-2" }, null, null, {
    enabled: true, authenticated: true,
    loadDestination: async id => ({ checkoutUrl: `https://crystalbaaz.myshopify.com/checkouts/${id.slice(-1)}`, cart: { id } }),
  });
  assert.equal(new URL(authenticated.url).searchParams.get("sso"), "silent");
  assert.deepEqual(await createHostedCheckout({ id: "gid://shopify/Cart/cart-1" }, null, null, { enabled: false }), { disabled: true });

  const service = createCatalogService({ provider: "shopify", checkoutEnabled: true, workbook: [], adapter: {
    hasConnection: () => true,
    loadCheckoutDestination: async id => ({ checkoutUrl: "https://checkout.example/current", cart: { id } }),
  } });
  assert.equal(service.canCheckout, true);
  assert.equal((await service.checkout("gid://shopify/Cart/cart-3", { authenticated: true })).url, "https://checkout.example/current?sso=silent");
});
