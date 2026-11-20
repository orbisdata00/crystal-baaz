import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalRazorpayStore } from "../backend/local-store.js";
import { createRazorpayMagicHttpHandler } from "../backend/razorpay-magic-http.js";
import { createLocalRazorpayServer } from "../backend/server.js";

async function invoke(handler, { method = "GET", url = "/", headers = {}, body = "" } = {}) {
  const request = { method, url, headers, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); } };
  const response = { headers: {}, status: 200, body: "", setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, writeHead(status) { this.status = status; }, end(value = "") { this.body += value; } };
  await handler(request, response);
  return { status: response.status, headers: response.headers, body: response.body ? JSON.parse(response.body) : null };
}

test("local checkout store persists sessions and serializes idempotency claims", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crystal-baaz-razorpay-"));
  const file = join(dir, "store.json");
  try {
    const store = createLocalRazorpayStore(file);
    const claims = await Promise.all([store.claimPreparation("fingerprint"), store.claimPreparation("fingerprint")]);
    assert.equal(claims.filter(claim => claim.claimed).length, 1);
    const session = { tokenDigest: "digest", fingerprint: "fingerprint", razorpayOrderId: "order_abc", state: "prepared", expiresAt: Date.now() + 60_000 };
    await store.saveSession(session);
    const reopened = createLocalRazorpayStore(file);
    assert.equal((await reopened.getSessionByTokenDigest("digest")).razorpayOrderId, "order_abc");
    assert.equal((await reopened.getSessionByRazorpayOrderId("order_abc")).tokenDigest, "digest");
    assert.equal((await reopened.claimPreparation("fingerprint")).session.tokenDigest, "digest");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("HTTP health checks support hosting probes without relaxing checkout origin restrictions", async () => {
  for (const allowedOrigin of ["http://localhost:5173", "https://example.com"]) {
    let called = false;
    const handler = createRazorpayMagicHttpHandler({ backend: { prepareCheckout: () => { called = true; } }, allowedOrigin });
    const healthy = await invoke(handler, { url: "/health", headers: { origin: allowedOrigin } });
    assert.equal(healthy.status, 200);
    assert.equal(healthy.headers["access-control-allow-origin"], allowedOrigin);
    assert.equal(healthy.body.ok, true);
    const crossOrigin = await invoke(handler, { url: "/health", headers: { origin: "https://other.example.com" } });
    assert.equal(crossOrigin.status, 200);
    assert.equal(crossOrigin.body.ok, true);
    assert.equal(crossOrigin.headers["access-control-allow-origin"], undefined);
    const probe = await invoke(handler, { url: "/health" });
    assert.equal(probe.status, 200);
    assert.equal(probe.body.ok, true);
    const blocked = await invoke(handler, { method: "POST", url: "/api/razorpay/magic/prepare", headers: { origin: "https://other.example.com" } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers["access-control-allow-origin"], undefined);
    assert.equal(called, false);
  }
});

test("disabled merchant authorization fails closed without contacting Razorpay", async () => {
  let attempted = false;
  const handler = createRazorpayMagicHttpHandler({
    allowedOrigin: "http://localhost:5173",
    backend: { prepareCheckout: async () => { attempted = true; throw new Error("Razorpay Magic Checkout is disabled or merchant authorization is incomplete."); } },
  });
  const response = await invoke(handler, {
    method: "POST", url: "/api/razorpay/magic/prepare",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ shopifyCartId: "gid://shopify/Cart/test?key=test" }),
  });
  assert.equal(response.status, 503);
  assert.match(response.body.message, /authorization is incomplete/);
  assert.equal(attempted, true);
});

test("Razorpay Shopify MID authorization rejection is reported without leaking upstream details", async () => {
  const handler = createRazorpayMagicHttpHandler({
    allowedOrigin: "http://localhost:5173",
    backend: { prepareCheckout: async () => { throw new Error("Razorpay Magic merchant authorization failed. Secret upstream body"); } },
  });
  const response = await invoke(handler, {
    method: "POST", url: "/api/razorpay/magic/prepare",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ shopifyCartId: "gid://shopify/Cart/test?key=test" }),
  });
  assert.equal(response.status, 502);
  assert.match(response.body.message, /has not authorized this Shopify store/);
  assert.doesNotMatch(JSON.stringify(response.body), /Secret upstream/);
});

test("invalid HTTP methods are rejected without backend calls", async () => {
  let called = false;
  const handler = createRazorpayMagicHttpHandler({ allowedOrigin: "http://localhost:5173", backend: { prepareCheckout: () => { called = true; } } });
  const response = await invoke(handler, { method: "GET", url: "/api/razorpay/magic/prepare", headers: { origin: "http://localhost:5173" } });
  assert.equal(response.status, 405);
  assert.equal(called, false);
});

test("local server can start health-only with missing payment and Shopify credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crystal-baaz-health-only-"));
  try {
    const { server, config } = createLocalRazorpayServer({ env: { STOREFRONT_ORIGIN: "http://localhost:5173" }, storePath: join(dir, "store.json") });
    assert.equal(server.listening, false);
    assert.equal(config.enabled, false);
    assert.equal(config.keyId, "");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("invalid JSON request is rejected without calling the checkout backend", async () => {
  let called = false;
  const handler = createRazorpayMagicHttpHandler({ allowedOrigin: "http://localhost:5173", backend: { prepareCheckout: () => { called = true; } } });
  const response = await invoke(handler, {
    method: "POST", url: "/api/razorpay/magic/prepare",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: "{invalid",
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("unexpected backend failures return a generic message without leaking details", async () => {
  const handler = createRazorpayMagicHttpHandler({
    allowedOrigin: "http://localhost:5173",
    backend: { prepareCheckout: async () => { throw new Error("private upstream response body"); } },
  });
  const response = await invoke(handler, {
    method: "POST", url: "/api/razorpay/magic/prepare",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ shopifyCartId: "gid://shopify/Cart/test?key=test" }),
  });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /could not be completed/);
  assert.doesNotMatch(JSON.stringify(response.body), /private upstream/);
});
