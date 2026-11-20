import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createLocalRazorpayStore } from "./local-store.js";
import { createRazorpayMagicBackend, createShopifyMagicCartFetcher, readRazorpayMagicServerConfig } from "./razorpay-magic.js";
import { createRazorpayMagicHttpHandler } from "./razorpay-magic-http.js";
import { createRazorpayStandardTestBackend } from "./razorpay-standard-test.js";

const here = dirname(fileURLToPath(import.meta.url));

export function createLocalRazorpayServer({ env = process.env, storePath = resolve(here, ".local-checkout-store.json") } = {}) {
  const config = readRazorpayMagicServerConfig(env);
  const fetchShopifyCart = async cartId => createShopifyMagicCartFetcher({
    storeDomain: env.SHOPIFY_STORE_DOMAIN || config.shopDomain,
    storefrontToken: env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN || "",
    apiVersion: env.SHOPIFY_API_VERSION || "2026-10",
  })(cartId);
  const store = createLocalRazorpayStore(storePath);
  const backend = createRazorpayMagicBackend({ config, fetchShopifyCart, store });
  const standardTestBackend = createRazorpayStandardTestBackend({
    config: { enabled: env.RAZORPAY_TEST_CHECKOUT_ENABLED === "true", mode: env.RAZORPAY_MODE === "live" ? "live" : "test", keyId: env.RAZORPAY_KEY_ID || "", keySecret: env.RAZORPAY_KEY_SECRET || "" },
    fetchShopifyCart,
    store,
  });
  const allowedOrigin = env.STOREFRONT_ORIGIN || "http://localhost:5173";
  const handle = createRazorpayMagicHttpHandler({ backend, standardTestBackend, allowedOrigin });
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ message: "The local Razorpay service failed safely." }));
    });
  });
  return { server, config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { server } = createLocalRazorpayServer();
    const port = Number(process.env.PORT || 3001);
    const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
    server.listen(port, host, () => process.stdout.write(`Razorpay backend listening on ${host}:${port}\n`));
    server.on("error", () => { process.stderr.write("Local Razorpay backend could not start. Check the port and private environment file.\n"); process.exitCode = 1; });
  } catch {
    process.stderr.write("Local Razorpay backend configuration is incomplete. Check backend/.env without sharing its contents.\n");
    process.exitCode = 1;
  }
}
