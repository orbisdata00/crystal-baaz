const MAX_BODY = 32 * 1024;

/** Mount this handler in an HTTPS Node server after supplying a persistent Razorpay backend/store. */
export function createRazorpayMagicHttpHandler({ backend, standardTestBackend = null, allowedOrigin } = {}) {
  const httpsOrigin = typeof allowedOrigin === "string" && allowedOrigin.startsWith("https://");
  const localHttpOrigin = typeof allowedOrigin === "string" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(allowedOrigin);
  if (!backend || (!httpsOrigin && !localHttpOrigin)) throw new Error("Razorpay API handler requires a backend and an exact HTTPS or loopback storefront origin.");
  return async function handle(request, response) {
    const origin = request.headers.origin;
    const route = new URL(request.url, allowedOrigin).pathname;
    const isWebhook = route === "/api/razorpay/magic/webhook";
    if (!isWebhook && ((origin && origin !== allowedOrigin) || (!origin && !localHttpOrigin))) { response.writeHead(403, { "Cache-Control": "no-store" }); response.end(); return; }
    if (!isWebhook && origin === allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (route === "/health" && request.method === "GET") {
      response.writeHead(200);
      response.end(JSON.stringify({ ok: true, service: "crystal-baaz-razorpay-local" }));
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
      response.end(); return;
    }
    if (request.method !== "POST") { response.writeHead(405); response.end(JSON.stringify({ message: "Method not allowed." })); return; }
    const standardTestRoute = new Set(["/api/razorpay/test/create-order", "/api/razorpay/test/verify-payment"]).has(route);
    if (!standardTestRoute && !new Set(["/api/razorpay/magic/prepare", "/api/razorpay/magic/complete", "/api/razorpay/magic/webhook"]).has(route)) { response.writeHead(404); response.end(JSON.stringify({ message: "Not found." })); return; }
    if (standardTestRoute && !standardTestBackend) { response.writeHead(404); response.end(JSON.stringify({ message: "Not found." })); return; }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_BODY) { response.writeHead(413); response.end(JSON.stringify({ message: "Request too large." })); return; }
        chunks.push(buffer);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let result, status = 200;
      if (isWebhook) {
        result = await backend.handleWebhook({ rawBody: raw, signature: request.headers["x-razorpay-signature"], eventId: request.headers["x-razorpay-event-id"] });
        if (result.pending) status = 202;
      } else {
        const body = JSON.parse(raw || "{}");
        if (standardTestRoute) result = route.endsWith("create-order")
          ? await standardTestBackend.createOrder({ shopifyCartId: body.shopifyCartId })
          : await standardTestBackend.verifyPayment(body);
        else result = route.endsWith("/prepare")
          ? await backend.prepareCheckout({ shopifyCartId: body.shopifyCartId })
          : await backend.completeCheckout(body);
      }
      response.writeHead(status); response.end(JSON.stringify(result));
    } catch (error) {
      // Detailed exception messages may contain upstream information; log only in a redacted server logger.
      const detail = String(error?.message || "");
      if (/authorization failed/i.test(detail)) {
        response.writeHead(502); response.end(JSON.stringify({ message: "Razorpay has not authorized this Shopify store for Magic Checkout." }));
      } else if (/disabled or merchant authorization is incomplete/i.test(detail)) {
        response.writeHead(503); response.end(JSON.stringify({ message: "Razorpay Magic Checkout is disabled or merchant authorization is incomplete." }));
      } else if (/test checkout is disabled|test credentials/i.test(detail)) {
        response.writeHead(503); response.end(JSON.stringify({ message: "Razorpay test checkout is disabled or test credentials are missing." }));
      } else if (standardTestRoute) {
        response.writeHead(400); response.end(JSON.stringify({ message: "Razorpay test payment could not be verified. The cart remains unchanged." }));
      } else {
        response.writeHead(isWebhook ? 500 : 400); response.end(JSON.stringify({ message: "Razorpay checkout could not be completed. Your cart has not been cleared." }));
      }
    }
  };
}
