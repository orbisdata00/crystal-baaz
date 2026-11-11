const APP_URL = new URL("./", self.location.href);
const CACHE_PREFIX = `crystal-bazz-public-${APP_URL.pathname}-`;
const CACHE_NAME = `${CACHE_PREFIX}v8`;
const appUrl = (path) => new URL(path, APP_URL).href;
const APP_SHELL = ["./", "offline.html", "manifest.webmanifest", "assets/pwa-icon-180.png", "assets/pwa-icon-192.png", "assets/pwa-icon-512.png"].map(appUrl);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const index = await cache.match(APP_URL.href);
    const markup = await index.text();
    const assets = [...markup.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi)]
      .map((match) => new URL(match[1], APP_URL).href);
    if (assets.length) await cache.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== APP_URL.origin || !url.pathname.startsWith(APP_URL.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await (await caches.open(CACHE_NAME)).put(APP_URL.href, response.clone());
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(APP_URL.href)) || (await cache.match(appUrl("offline.html"))) || new Response("You're offline. Reconnect to open Crystal Baaz.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  if (url.href === appUrl("service-worker.js")) return;
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok && response.type === "basic") caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    });
  }));
});
