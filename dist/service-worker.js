const CACHE_PREFIX = "crystal-bazz-public-";
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const APP_SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/assets/pwa-icon-180.png", "/assets/pwa-icon-192.png", "/assets/pwa-icon-512.png", "/assets/product-placeholder.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const index = await cache.match("/");
    const markup = await index.text();
    const assets = [...markup.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi)]
      .map((match) => new URL(match[1], self.location.origin).href);
    if (assets.length) await cache.addAll(assets);
  })().catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await (await caches.open(CACHE_NAME)).put("/", response.clone());
        return response;
      } catch {
        return (await caches.match("/")) || (await caches.match("/offline.html")) || new Response("You're offline. Reconnect to open Crystal Baaz.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  if (url.pathname === "/service-worker.js") return;
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok && response.type === "basic") caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    });
  }));
});
