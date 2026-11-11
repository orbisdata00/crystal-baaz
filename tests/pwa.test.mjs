import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const workerSource = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");

function createWorker(base) {
  const listeners = {};
  const entries = new Map();
  const cachedUrls = [];
  const cache = {
    async addAll(urls) {
      for (const url of urls) {
        cachedUrls.push(url);
        entries.set(url, new Response(url === base
          ? '<script src="./assets/index.js"></script><link href="./assets/index.css" rel="stylesheet">'
          : "cached"));
      }
    },
    async match(url) { return entries.get(url)?.clone(); },
    async put(url, response) { entries.set(url, response); },
  };
  const prefix = `crystal-bazz-public-${new URL(base).pathname}-`;
  const cacheNames = new Set([`${prefix}old`, "another-app"]);
  const caches = {
    async open(name) { cacheNames.add(name); return cache; },
    async keys() { return [...cacheNames]; },
    async delete(name) { return cacheNames.delete(name); },
    async match(url) { return cache.match(url); },
  };
  runInNewContext(workerSource, {
    URL, Response, caches,
    fetch: async () => { throw new TypeError("Offline"); },
    self: {
      location: new URL("service-worker.js", base),
      addEventListener(type, handler) { listeners[type] = handler; },
      async skipWaiting() {},
      clients: { async claim() {} },
    },
  });
  return { listeners, entries, cachedUrls, cacheNames, prefix };
}

for (const path of ["/", "/crystal-baaz/"]) {
  const base = `https://example.test${path}`;

  test(`PWA links stay within ${path}`, async () => {
    const markup = await readFile(new URL("../index.html", import.meta.url), "utf8");
    const manifestHref = markup.match(/rel="manifest" href="([^"]+)"/)[1];
    const manifestUrl = new URL(manifestHref, base);
    assert.equal(manifestUrl.href, `${base}manifest.webmanifest`);
    const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
    assert.equal(new URL(manifest.start_url, manifestUrl).href, base);
    assert.equal(new URL(manifest.scope, manifestUrl).href, base);
    for (const icon of manifest.icons) {
      assert.equal(new URL(icon.src, manifestUrl).href, `${base}assets/${icon.src.split("/").at(-1)}`);
    }
    const touchIcon = markup.match(/rel="apple-touch-icon"[^>]+href="([^"]+)"/)[1];
    assert.equal(new URL(touchIcon, base).href, `${base}assets/pwa-icon-180.png`);
    const offline = await readFile(new URL("../public/offline.html", import.meta.url), "utf8");
    assert.equal(new URL(offline.match(/<a href="([^"]+)"/)[1], `${base}offline.html`).href, base);
  });

  test(`service worker caches the shell and relative bundles under ${path}`, async () => {
    const { listeners, cachedUrls, cacheNames, prefix } = createWorker(base);
    let installed;
    listeners.install({ waitUntil(promise) { installed = promise; } });
    await installed;
    for (const asset of ["", "offline.html", "manifest.webmanifest", "assets/pwa-icon-192.png", "assets/index.js", "assets/index.css"]) {
      assert.ok(cachedUrls.includes(`${base}${asset}`), asset);
    }
    assert.ok(cachedUrls.every((url) => url.startsWith(base)));
    let activated;
    listeners.activate({ waitUntil(promise) { activated = promise; } });
    await activated;
    assert.ok(!cacheNames.has(`${prefix}old`));
    assert.ok(cacheNames.has("another-app"));
  });

  test(`offline navigation uses only the app's cache under ${path}`, async () => {
    const { listeners, entries } = createWorker(base);
    entries.set(base, new Response("app shell"));
    let response;
    const navigate = () => listeners.fetch({
      request: { url: `${base}index.html`, method: "GET", mode: "navigate" },
      respondWith(promise) { response = promise; },
    });
    navigate();
    assert.equal(await (await response).text(), "app shell");
    entries.delete(base);
    entries.set(`${base}offline.html`, new Response("offline page"));
    navigate();
    assert.equal(await (await response).text(), "offline page");
    entries.clear();
    navigate();
    assert.equal((await response).status, 503);
    for (const url of ["https://other.test/", `${base}service-worker.js`, ...(path !== "/" ? ["https://example.test/another-app/"] : [])]) {
      listeners.fetch({
        request: { url, method: "GET", mode: "cors" },
        respondWith() { assert.fail(`Worker must not intercept ${url}`); },
      });
    }
  });
}
