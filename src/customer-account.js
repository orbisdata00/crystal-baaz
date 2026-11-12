import { useSyncExternalStore } from "react";
import { shopifyConfig } from "./config.js";

const TRANSACTION_KEY = "crystal-baaz-customer-oauth-transaction";
const SESSION_HINT_KEY = "crystal-baaz-customer-session-hint";
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const CUSTOMER_ADDRESS_FIELDS = `
  id firstName lastName company address1 address2 city province zoneCode countryCode territoryCode zip phoneNumber
  formatted(withName: true)
`;

const ACCOUNT_QUERY = `query CrystalBaazCustomerAccount {
  customer {
    id displayName firstName lastName
    emailAddress { emailAddress }
    phoneNumber { phoneNumber }
    defaultAddress { ${CUSTOMER_ADDRESS_FIELDS} }
    addresses(first: 10, skipDefault: true) {
      nodes { ${CUSTOMER_ADDRESS_FIELDS} }
    }
    orders(first: 10, reverse: true) {
      nodes {
        id name createdAt financialStatus fulfillmentStatus
        totalPrice { amount currencyCode }
        lineItems(first: 20) { nodes { title quantity } }
      }
    }
  }
}`;

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function randomToken(cryptoApi, size = 32) {
  const bytes = new Uint8Array(size);
  cryptoApi.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function createPkceChallenge(verifier, cryptoApi = globalThis.crypto) {
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function isSecureShopifyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function verifyCustomerIdToken(idToken, {
  clientId, issuer, nonce, jwksUri, jwksFallbackUris = [], fetchImpl = fetch, cryptoApi = globalThis.crypto,
  now = Date.now(),
} = {}) {
  if (typeof idToken !== "string") throw new Error("Shopify returned an invalid identity token.");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Shopify returned an invalid identity token.");
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (!header.kid || !["RS256", "ES256"].includes(header.alg)) throw new Error("Shopify returned an unsupported identity token.");
  let jwk = null;
  let receivedKeySet = false;
  const keySetUris = [...new Set([...jwksFallbackUris, jwksUri].filter(Boolean))];
  for (const keySetUri of keySetUris) {
    try {
      const response = await fetchImpl(keySetUri, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      receivedKeySet = true;
      const keySet = await response.json();
      jwk = keySet.keys?.find(key => key.kid === header.kid && key.use !== "enc") || null;
      if (jwk) break;
    } catch { /* Try Shopify's documented shop-domain JWKS URL next. */ }
  }
  if (!jwk) throw new Error(receivedKeySet ? "Shopify identity verification failed." : "Shopify identity verification is unavailable. Please retry.");

  let importAlgorithm;
  let verifyAlgorithm;
  if (header.alg === "RS256") {
    importAlgorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    verifyAlgorithm = { name: "RSASSA-PKCS1-v1_5" };
  } else {
    importAlgorithm = { name: "ECDSA", namedCurve: "P-256" };
    verifyAlgorithm = { name: "ECDSA", hash: "SHA-256" };
  }
  const publicKey = await cryptoApi.subtle.importKey("jwk", jwk, importAlgorithm, false, ["verify"]);
  const validSignature = await cryptoApi.subtle.verify(
    verifyAlgorithm,
    publicKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const nowSeconds = Math.floor(now / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!validSignature || claims.iss !== issuer || !audience.includes(clientId)
    || (audience.length > 1 && claims.azp !== clientId)
    || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds - 60
    || (claims.nbf != null && claims.nbf > nowSeconds + 60)
    || (claims.iat != null && claims.iat > nowSeconds + 60)
    || (nonce && claims.nonce !== nonce)
    || typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("Shopify identity verification failed. Please sign in again.");
  }
  return claims;
}

function storefrontBasePath(config, location) {
  try {
    const siteUrl = new URL(config.publicSiteUrl || `${location.origin}/`, location.origin);
    if (siteUrl.origin !== location.origin || !siteUrl.pathname.startsWith("/")) return "/";
    return siteUrl.pathname.endsWith("/") ? siteUrl.pathname : `${siteUrl.pathname}/`;
  } catch {
    return "/";
  }
}

function safeReturnPath(value, origin, basePath = "/") {
  const fallback = `${basePath}#account`;
  try {
    const url = new URL(value || fallback, origin);
    if (url.origin !== origin || !url.pathname.startsWith(basePath) || url.pathname.startsWith("//")) return fallback;
    return `${url.pathname}${url.hash || "#account"}`;
  } catch {
    return fallback;
  }
}

function customerConfiguration(config, location) {
  const basePath = storefrontBasePath(config, location);
  const callback = config.customerAccountRedirectUri;
  const logout = config.customerAccountLogoutUri;
  let callbackUrl;
  let logoutUrl;
  try { callbackUrl = new URL(callback); logoutUrl = new URL(logout); } catch { return null; }
  if (!config.customerAccountClientId || !isSecureShopifyUrl(callbackUrl.href) || !isSecureShopifyUrl(logoutUrl.href)
    || callbackUrl.origin !== location.origin || logoutUrl.origin !== location.origin
    || (config.publicSiteUrl && (callbackUrl.pathname !== basePath || logoutUrl.pathname !== basePath))
    || callbackUrl.hash || logoutUrl.hash) return null;
  return { clientId: config.customerAccountClientId, callbackUri: callbackUrl.href, logoutUri: logoutUrl.href };
}

function customerJwksFallbackUris(config, endpoints) {
  const domain = config.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const shopDomainJwks = `https://${domain}/authentication/.well-known/jwks.json`;
  try {
    // Shopify's documented JWKS URL is served from the storefront domain. Some
    // discovery responses instead return an issuer-host URL without browser CORS.
    return new URL(endpoints.jwks_uri).hostname === "shopify.com" ? [shopDomainJwks] : [];
  } catch {
    return [];
  }
}

export function createCustomerAccountClient({
  config = shopifyConfig,
  windowRef = typeof window === "undefined" ? null : window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  cryptoApi = globalThis.crypto,
  now = Date.now,
} = {}) {
  const listeners = new Set();
  let current = { status: "signed-out", customer: null, error: "" };
  let openIdPromise = null;
  let apiDiscoveryPromise = null;
  let initialized = false;
  let tokens = null;

  const notify = () => listeners.forEach(listener => listener());
  const publish = patch => { current = { ...current, ...patch }; notify(); };
  const available = () => Boolean(windowRef && fetchImpl && cryptoApi?.subtle && customerConfiguration(config, windowRef.location));
  const configurationMessage = () => !config.customerAccountClientId
    ? "Shopify Customer Accounts are not configured yet. Add the public Client ID and registered HTTPS callback URLs."
    : "Open Crystal Baaz on its registered HTTPS domain to use customer sign-in.";

  async function discoverOpenId() {
    if (!available()) throw new Error(configurationMessage());
    if (!openIdPromise) {
      const domain = config.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      openIdPromise = fetchImpl(`https://${domain}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } })
        .then(async response => {
          if (!response.ok) throw new Error("Shopify Customer Accounts are not available for this store yet.");
          const discovery = await response.json();
          for (const key of ["authorization_endpoint", "token_endpoint", "end_session_endpoint", "jwks_uri"]) {
            if (!isSecureShopifyUrl(discovery[key])) throw new Error("Shopify returned incomplete customer authentication settings.");
          }
          if (typeof discovery.issuer !== "string" || !discovery.issuer.startsWith("https://")) throw new Error("Shopify returned incomplete customer authentication settings.");
          return discovery;
        }).catch(error => { openIdPromise = null; throw error; });
    }
    return openIdPromise;
  }

  async function discoverCustomerApi() {
    if (!apiDiscoveryPromise) {
      const domain = config.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      apiDiscoveryPromise = fetchImpl(`https://${domain}/.well-known/customer-account-api`, { headers: { Accept: "application/json" } })
        .then(async response => {
          if (!response.ok) throw new Error("Shopify Customer Account API is not available for this store yet.");
          const result = await response.json();
          if (!isSecureShopifyUrl(result.graphql_api)) throw new Error("Shopify returned an invalid customer API endpoint.");
          return result.graphql_api;
        }).catch(error => { apiDiscoveryPromise = null; throw error; });
    }
    return apiDiscoveryPromise;
  }

  function readTransaction() {
    try {
      const value = JSON.parse(windowRef.sessionStorage.getItem(TRANSACTION_KEY) || "null");
      return value && now() - value.createdAt <= TRANSACTION_TTL_MS ? value : null;
    } catch { return null; }
  }

  function clearTransaction() {
    try { windowRef?.sessionStorage?.removeItem(TRANSACTION_KEY); } catch { /* Storage can be unavailable. */ }
  }

  function returnTo(path) {
    const safe = safeReturnPath(path, windowRef.location.origin, storefrontBasePath(config, windowRef.location));
    windowRef.history.replaceState({}, "", safe);
    try { windowRef.dispatchEvent(new Event("popstate")); } catch { /* The URL still restores on the next render. */ }
  }

  async function beginAuthorization({ prompt = "login", returnPath } = {}) {
    if (!available()) {
      publish({ status: "unconfigured", error: configurationMessage(), customer: null });
      return false;
    }
    publish({ status: "authenticating", error: "" });
    try {
      const endpoints = await discoverOpenId();
      const transaction = {
        state: randomToken(cryptoApi),
        nonce: randomToken(cryptoApi),
        verifier: randomToken(cryptoApi, 48),
        returnPath: safeReturnPath(returnPath || `${windowRef.location.pathname}${windowRef.location.hash}`, windowRef.location.origin, storefrontBasePath(config, windowRef.location)),
        silent: prompt === "none",
        createdAt: now(),
      };
      windowRef.sessionStorage.setItem(TRANSACTION_KEY, JSON.stringify(transaction));
      const challenge = await createPkceChallenge(transaction.verifier, cryptoApi);
      const authorization = new URL(endpoints.authorization_endpoint);
      authorization.searchParams.set("scope", "openid email customer-account-api:full");
      authorization.searchParams.set("client_id", config.customerAccountClientId);
      authorization.searchParams.set("response_type", "code");
      authorization.searchParams.set("redirect_uri", customerConfiguration(config, windowRef.location).callbackUri);
      authorization.searchParams.set("state", transaction.state);
      authorization.searchParams.set("nonce", transaction.nonce);
      authorization.searchParams.set("code_challenge", challenge);
      authorization.searchParams.set("code_challenge_method", "S256");
      if (prompt === "none") authorization.searchParams.set("prompt", "none");
      windowRef.location.assign(authorization.href);
      return true;
    } catch (error) {
      clearTransaction();
      publish({ status: "error", error: error.message || "Could not start Shopify sign-in." });
      return false;
    }
  }

  async function exchangeCode(code, transaction, endpoints) {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.customerAccountClientId,
      redirect_uri: customerConfiguration(config, windowRef.location).callbackUri,
      code,
      code_verifier: transaction.verifier,
    });
    const response = await fetchImpl(endpoints.token_endpoint, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
    });
    if (!response.ok) throw new Error("Shopify could not complete sign-in. Check the Customer Account API setup and try again.");
    const result = await response.json();
    if (!result.access_token || !result.id_token || !Number.isFinite(Number(result.expires_in))) throw new Error("Shopify returned an incomplete sign-in response.");
    const claims = await verifyCustomerIdToken(result.id_token, {
      clientId: config.customerAccountClientId,
      issuer: endpoints.issuer,
      nonce: transaction.nonce,
      jwksUri: endpoints.jwks_uri,
      jwksFallbackUris: customerJwksFallbackUris(config, endpoints),
      fetchImpl,
      cryptoApi,
      now: now(),
    });
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token || "",
      idToken: result.id_token,
      expiresAt: now() + Math.max(1, Number(result.expires_in)) * 1000,
      subject: claims.sub,
      endpoints,
    };
  }

  async function completeCallback() {
    const callbackUrl = new URL(windowRef.location.href);
    const transaction = readTransaction();
    const returnedState = callbackUrl.searchParams.get("state");
    const code = callbackUrl.searchParams.get("code");
    const providerError = callbackUrl.searchParams.get("error");
    windowRef.history.replaceState({}, "", `${callbackUrl.pathname}${callbackUrl.hash}`);
    clearTransaction();
    try {
      if (!transaction || !returnedState || returnedState !== transaction.state) throw new Error("Shopify sign-in could not be verified. Please start again.");
      if (providerError) {
        const silentFailure = transaction.silent && ["login_required", "interaction_required"].includes(providerError);
        if (silentFailure) {
          windowRef.sessionStorage.removeItem(SESSION_HINT_KEY);
          tokens = null;
          publish({ status: "signed-out", customer: null, error: "" });
        } else {
          publish({ status: "signed-out", customer: null, error: "Sign-in was not completed. You can try again." });
        }
        returnTo(transaction.returnPath);
        return;
      }
      if (!code) throw new Error("Shopify did not return a sign-in code. Please try again.");
      const endpoints = await discoverOpenId();
      tokens = await exchangeCode(code, transaction, endpoints);
      windowRef.sessionStorage.setItem(SESSION_HINT_KEY, "1");
      publish({ status: "authenticated", customer: null, error: "", subject: tokens.subject });
      returnTo(transaction.returnPath);
    } catch (error) {
      tokens = null;
      try { windowRef.sessionStorage.removeItem(SESSION_HINT_KEY); } catch { /* Storage can be unavailable. */ }
      publish({ status: "error", customer: null, error: error.message || "Shopify sign-in failed." });
      returnTo(transaction?.returnPath || `${storefrontBasePath(config, windowRef.location)}#account`);
    }
  }

  async function refreshTokens() {
    if (!tokens?.refreshToken) return false;
    const endpoints = tokens.endpoints || await discoverOpenId();
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.customerAccountClientId,
      refresh_token: tokens.refreshToken,
    });
    const response = await fetchImpl(endpoints.token_endpoint, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
    });
    if (!response.ok) return false;
    const result = await response.json();
    if (!result.access_token || !Number.isFinite(Number(result.expires_in))) return false;
    if (result.id_token) {
      await verifyCustomerIdToken(result.id_token, {
        clientId: config.customerAccountClientId, issuer: endpoints.issuer,
        jwksUri: endpoints.jwks_uri, jwksFallbackUris: customerJwksFallbackUris(config, endpoints), fetchImpl, cryptoApi, now: now(),
      });
    }
    tokens = {
      ...tokens,
      accessToken: result.access_token,
      refreshToken: result.refresh_token || tokens.refreshToken,
      idToken: result.id_token || tokens.idToken,
      expiresAt: now() + Math.max(1, Number(result.expires_in)) * 1000,
    };
    return true;
  }

  async function ensureAccessToken() {
    if (!tokens) throw new Error("Sign in to view your Shopify account.");
    if (tokens.expiresAt > now() + 60_000) return tokens.accessToken;
    if (await refreshTokens()) return tokens.accessToken;
    const returnPath = safeReturnPath(`${windowRef.location.pathname}${windowRef.location.hash || "#account"}`, windowRef.location.origin, storefrontBasePath(config, windowRef.location));
    void beginAuthorization({ prompt: "none", returnPath });
    throw new Error("Your Shopify session needs to be renewed. Reconnecting securely…");
  }

  async function queryCustomerApi(query = ACCOUNT_QUERY, variables = {}) {
    const accessToken = await ensureAccessToken();
    const endpoint = await discoverCustomerApi();
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: accessToken },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 401) {
      tokens = null;
      publish({ status: "signed-out", customer: null, error: "Your Shopify session expired. Sign in again to continue." });
      try { windowRef.sessionStorage.removeItem(SESSION_HINT_KEY); } catch { /* Storage can be unavailable. */ }
      throw new Error("Your Shopify session expired. Sign in again to continue.");
    }
    if (!response.ok) throw new Error("Shopify account information could not be loaded. Please retry.");
    const result = await response.json();
    if (result.errors?.length) throw new Error(result.errors[0].message || "Shopify account information could not be loaded.");
    return result.data;
  }

  async function loadDashboard() {
    const data = await queryCustomerApi();
    if (!data?.customer) throw new Error("Shopify did not return an account for this session.");
    publish({ status: "authenticated", customer: data.customer, error: "" });
    return data.customer;
  }

  async function customerMutation(field, query, variables) {
    const data = await queryCustomerApi(query, variables);
    const result = data?.[field];
    if (!result) throw new Error("Shopify could not update your account. Please retry.");
    if (result.userErrors?.length) throw new Error(result.userErrors.map(error => error.message).filter(Boolean).join(" ") || "Shopify could not update your account.");
    return result;
  }

  function saveAddressFields(address = {}) {
    return Object.fromEntries(Object.entries({
      firstName: address.firstName,
      lastName: address.lastName,
      company: address.company,
      address1: address.address1,
      address2: address.address2,
      city: address.city,
      zoneCode: address.zoneCode,
      countryCode: address.countryCode || address.territoryCode,
      zip: address.zip,
      phoneNumber: address.phoneNumber,
    }).filter(([, value]) => value !== undefined));
  }

  async function createAddress(address, { defaultAddress = false } = {}) {
    const result = await customerMutation("customerAddressCreate", `mutation CrystalBaazCustomerAddressCreate($address: CustomerAddressInput!, $defaultAddress: Boolean) {
      customerAddressCreate(address: $address, defaultAddress: $defaultAddress) {
        customerAddress { ${CUSTOMER_ADDRESS_FIELDS} }
        userErrors { field message code }
      }
    }`, { address: saveAddressFields(address), defaultAddress });
    return result.customerAddress;
  }

  async function updateAddress(addressId, address, { defaultAddress } = {}) {
    if (typeof addressId !== "string" || !addressId.startsWith("gid://shopify/CustomerAddress/")) throw new Error("Choose a saved Shopify address to update.");
    const input = address == null ? undefined : saveAddressFields(address);
    const result = await customerMutation("customerAddressUpdate", `mutation CrystalBaazCustomerAddressUpdate($addressId: ID!, $address: CustomerAddressInput, $defaultAddress: Boolean) {
      customerAddressUpdate(addressId: $addressId, address: $address, defaultAddress: $defaultAddress) {
        customerAddress { ${CUSTOMER_ADDRESS_FIELDS} }
        userErrors { field message code }
      }
    }`, { addressId, ...(input ? { address: input } : {}), ...(defaultAddress == null ? {} : { defaultAddress }) });
    return result.customerAddress;
  }

  async function deleteAddress(addressId) {
    if (typeof addressId !== "string" || !addressId.startsWith("gid://shopify/CustomerAddress/")) throw new Error("Choose a saved Shopify address to delete.");
    const result = await customerMutation("customerAddressDelete", `mutation CrystalBaazCustomerAddressDelete($addressId: ID!) {
      customerAddressDelete(addressId: $addressId) { deletedAddressId userErrors { field message code } }
    }`, { addressId });
    return result.deletedAddressId;
  }

  async function logout() {
    const idToken = tokens?.idToken;
    const customerSettings = customerConfiguration(config, windowRef.location);
    tokens = null;
    clearTransaction();
    try { windowRef.sessionStorage.removeItem(SESSION_HINT_KEY); } catch { /* Storage can be unavailable. */ }
    publish({ status: available() ? "signed-out" : "unconfigured", customer: null, error: "" });
    if (!idToken || !customerSettings) {
      windowRef.history.replaceState({}, "", `${storefrontBasePath(config, windowRef.location)}#home`);
      windowRef.dispatchEvent?.(new Event("popstate"));
      return;
    }
    try {
      const endpoints = await discoverOpenId();
      const url = new URL(endpoints.end_session_endpoint);
      url.searchParams.set("id_token_hint", idToken);
      url.searchParams.set("post_logout_redirect_uri", customerSettings.logoutUri);
      windowRef.location.assign(url.href);
    } catch {
      windowRef.history.replaceState({}, "", `${storefrontBasePath(config, windowRef.location)}#home`);
      windowRef.dispatchEvent?.(new Event("popstate"));
    }
  }

  async function initialize() {
    if (initialized || !windowRef) return current;
    initialized = true;
    if (!available()) {
      publish({ status: "unconfigured", error: configurationMessage(), customer: null });
      return current;
    }
    const configuredCallback = new URL(customerConfiguration(config, windowRef.location).callbackUri);
    const currentUrl = new URL(windowRef.location.href);
    const hasOAuthResponse = ["code", "state", "error"].some(parameter => currentUrl.searchParams.has(parameter));
    if (windowRef.location.pathname === configuredCallback.pathname && hasOAuthResponse) {
      await completeCallback();
      return current;
    }
    try {
      if (windowRef.sessionStorage.getItem(SESSION_HINT_KEY) === "1") {
        await beginAuthorization({ prompt: "none", returnPath: safeReturnPath(`${windowRef.location.pathname}${windowRef.location.hash || "#account"}`, windowRef.location.origin, storefrontBasePath(config, windowRef.location)) });
      } else {
        publish({ status: "signed-out", customer: null, error: "" });
      }
    } catch {
      publish({ status: "signed-out", customer: null, error: "" });
    }
    return current;
  }

  return Object.freeze({
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return current; },
    get isAuthenticated() { return current.status === "authenticated" && Boolean(tokens); },
    get isConfigured() { return available(); },
    initialize,
    login() { return beginAuthorization({ prompt: "login" }); },
    logout,
    loadDashboard,
    queryCustomerApi,
    createAddress,
    updateAddress,
    deleteAddress,
  });
}

export const customerAccount = createCustomerAccountClient();
export function useCustomerAccount() {
  return useSyncExternalStore(customerAccount.subscribe, customerAccount.getSnapshot, customerAccount.getSnapshot);
}

export const customerAccountQueries = Object.freeze({ dashboard: ACCOUNT_QUERY });
