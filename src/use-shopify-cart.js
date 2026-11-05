import { useEffect, useRef, useSyncExternalStore } from "react";
import { catalogService } from "./catalog-service.js";
import { addCartLine, changeCartQuantity, removeCartLine, reconcileShopifyCartLines } from "./cart.js";

const CART_ERROR = "Your cart could not be confirmed. Check your connection and retry.";
const ADD_ERROR = "Shopify could not add this item at the requested quantity. Retry to try again.";

function read(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

function applyIntent(lines, intent) {
  if (intent.type === "add") return addCartLine(lines, intent.product, intent.variantId, intent.quantity);
  if (intent.type === "update") return changeCartQuantity(lines, intent.key, intent.delta);
  return removeCartLine(lines, intent.key);
}

function operationKey(intent) {
  return intent.type === "add" ? `${intent.product.id}:${intent.variantId}` : intent.key;
}

function operationLabel(intent) {
  if (intent.type === "add") return intent.product.title || "item";
  return intent.label || "item";
}

function operationType(intent, currentLines) {
  if (intent.type === "add") return "add";
  if (intent.type === "remove") return "remove";
  const current = currentLines.find(line => line.key === intent.key);
  return current && current.quantity + intent.delta <= 0 ? "remove" : "quantity";
}

function describeIntent(intent, currentLines) {
  const line = currentLines.find(item => item.key === operationKey(intent));
  return {
    key: operationKey(intent),
    productId: intent.type === "add" ? intent.product.id : line?.productId,
    type: operationType(intent, currentLines),
    label: operationLabel(intent),
  };
}

// One controller owns confirmed Shopify state and serializes mutations. Local
// intent is optimistic, but is persisted and announced as successful only after
// Shopify returns the authoritative cart.
export function createShopifyCartController({ service = catalogService, storage, onProducts, onNotice } = {}) {
  const preview = service.source === "preview";
  const linesKey = preview ? "crystal-bazz-cart" : "crystal-baaz-shopify-cart-lines";
  const idKey = preview ? "crystal-bazz-shopify-cart" : "crystal-baaz-shopify-cart-id";
  const stored = read(storage, linesKey, []);
  const savedLines = Array.isArray(stored)
    ? stored.filter(line => line && typeof line.productId === "string" && typeof line.variantId === "string" && typeof line.key === "string" && Number.isInteger(line.quantity) && line.quantity > 0)
    : [];
  const savedId = read(storage, idKey, null);
  let state = {
    cart: [], cartId: typeof savedId === "string" ? savedId : null,
    remoteCart: null, pending: false, pendingKeys: [], pendingOperations: [],
    error: "",
  };
  let confirmedCart = [];
  let attemptedHydration = false;
  let ready = false;
  let processing = false;
  let failedOperation = null;
  const jobs = [];
  const listeners = new Set();

  function publish(patch) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  }

  function persist(cart = confirmedCart, cartId = state.cartId) {
    try {
      storage?.setItem(linesKey, JSON.stringify(cart));
      if (cartId) storage?.setItem(idKey, JSON.stringify(cartId));
      else storage?.removeItem(idKey);
    } catch { /* Storage may be unavailable; the confirmed in-memory cart still works. */ }
  }

  function pendingSnapshot(operations) {
    const unique = new Map();
    for (const operation of operations) {
      const detail = operation.detail || describeIntent(operation.intent, state.cart);
      unique.set(detail.key, detail);
    }
    return [...unique.values()];
  }

  function cartWithQueuedIntents() {
    return jobs.reduce((lines, operation) => applyIntent(lines, operation.intent), confirmedCart);
  }

  function setPendingSnapshot(extra = {}) {
    const operations = pendingSnapshot(jobs);
    publish({
      cart: cartWithQueuedIntents(),
      pending: operations.length > 0,
      pendingKeys: operations.map(operation => operation.key),
      pendingOperations: operations,
      ...extra,
    });
  }

  function settleCanceled(operations) {
    operations.forEach(operation => operation.resolve?.(false));
  }

  function failJob(job, desired, { error = CART_ERROR, remoteCart = null, uncertain = true } = {}) {
    const canceled = jobs.splice(0);
    failedOperation = {
      lines: desired,
      intents: [job.intent],
      options: { verified: ready },
      error,
    };
    if (job.intent.type === "add") onNotice?.(error);
    publish({
      cart: confirmedCart,
      cartId: remoteCart?.id || state.cartId,
      remoteCart: uncertain ? null : remoteCart,
      pending: false,
      pendingKeys: [],
      pendingOperations: [],
      error,
    });
    if (!uncertain) {
      confirmedCart = reconcileShopifyCartLines(desired, remoteCart);
      publish({ cart: confirmedCart, cartId: remoteCart?.id || state.cartId, remoteCart, error });
      persist();
    }
    settleCanceled(canceled);
  }

  async function runJob(job) {
    const desired = applyIntent(confirmedCart, job.intent);
    const beforeQuantity = confirmedCart.find(line => line.key === operationKey(job.intent))?.quantity || 0;
    const result = preview
      ? { cart: null, products: [] }
      : await service.syncCart(state.cartId, desired, state.remoteCart, { verified: true });
    const remoteCart = result?.cart ?? null;
    if (!preview && desired.length && !remoteCart) throw new Error("Missing cart response");
    const nextCart = preview ? desired : remoteCart ? reconcileShopifyCartLines(desired, remoteCart) : [];

    // A server refusal is a confirmed response. Adopt that cart, roll back this
    // intent, and keep a safe desired-state retry available.
    if (job.intent.type === "add") {
      const actualQuantity = nextCart.find(line => line.key === operationKey(job.intent))?.quantity || 0;
      if (actualQuantity <= beforeQuantity) {
        confirmedCart = nextCart;
        failJob(job, desired, { error: ADD_ERROR, remoteCart, uncertain: false });
        return false;
      }
    }

    confirmedCart = nextCart;
    const nextCartId = remoteCart?.id || null;
    publish({ cartId: nextCartId, remoteCart, error: "" });
    persist(confirmedCart, nextCartId);
    if (result?.products?.length) onProducts?.(result.products);
    if (job.intent.type === "add") onNotice?.("Added to cart.");
    return true;
  }

  async function processQueue() {
    if (processing || !jobs.length || failedOperation) return;
    processing = true;
    publish({ pending: true });
    try {
      while (jobs.length && !failedOperation) {
        const job = jobs[0];
        try {
          const succeeded = await runJob(job);
          if (!succeeded) break;
          jobs.shift();
          setPendingSnapshot({ error: "" });
          job.resolve(true);
        } catch {
          failJob(job, applyIntent(confirmedCart, job.intent));
          break;
        }
      }
    } finally {
      processing = false;
      if (!failedOperation) setPendingSnapshot();
      if (jobs.length && !failedOperation) void processQueue();
    }
  }

  async function synchronize(lines, { verified = false, operations = [], retry = false } = {}) {
    const result = preview
      ? { cart: null, products: [] }
      : await service.syncCart(state.cartId, lines, retry ? null : state.remoteCart, { verified });
    const remoteCart = result?.cart ?? null;
    if (!preview && lines.length && !remoteCart) throw new Error("Missing cart response");
    const nextCart = preview ? lines : remoteCart ? reconcileShopifyCartLines(lines, remoteCart) : [];
    for (const intent of operations) {
      if (intent.type === "add") {
        const expected = lines.find(line => line.key === operationKey(intent))?.quantity || 0;
        const actual = nextCart.find(line => line.key === operationKey(intent))?.quantity || 0;
        if (actual < expected) throw new Error(ADD_ERROR);
      }
    }
    confirmedCart = nextCart;
    ready = true;
    failedOperation = null;
    const nextCartId = remoteCart?.id || null;
    publish({ cart: nextCart, cartId: nextCartId, remoteCart, pending: false, pendingKeys: [], pendingOperations: [], error: "" });
    persist(nextCart, nextCartId);
    if (result?.products?.length) onProducts?.(result.products);
    if (operations.some(intent => intent.type === "add")) onNotice?.("Added to cart.");
    return true;
  }

  function enqueue(intent) {
    const key = operationKey(intent);
    if (!ready || failedOperation) {
      if (!state.pending) publish({ error: failedOperation?.error || "Your cart is still loading. Please try again." });
      return Promise.resolve(false);
    }
    if (state.pendingKeys.includes(key)) return Promise.resolve(false);
    const before = state.cart;
    const optimistic = applyIntent(before, intent);
    if (optimistic === before || (intent.type !== "remove" && optimistic.every((line, index) => line === before[index]))) return Promise.resolve(false);

    return new Promise(resolve => {
      const job = { intent, detail: describeIntent(intent, before), resolve };
      jobs.push(job);
      publish({
        cart: optimistic,
        pending: true,
        pendingKeys: pendingSnapshot(jobs).map(operation => operation.key),
        pendingOperations: pendingSnapshot(jobs),
        error: "",
      });
      void processQueue();
    });
  }

  const api = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async hydrate(catalog) {
      if (attemptedHydration || !catalog?.length) return false;
      attemptedHydration = true;
      if (!savedLines.length && !state.cartId) { ready = true; return true; }
      publish({ pending: true, error: "" });
      try {
        return await synchronize(savedLines, { verified: false });
      } catch {
        failedOperation = { lines: savedLines, intents: [], options: { verified: false }, error: CART_ERROR };
        publish({ pending: false, pendingKeys: [], pendingOperations: [], remoteCart: null, error: CART_ERROR });
        return false;
      }
    },
    add(product, variantId, quantity = 1) {
      const variant = product?.variants?.find(item => item.id === variantId);
      if (!Number.isInteger(quantity) || quantity < 1 || !variant || (!preview && variant.canPurchase !== true) || variant.available === false || !(Number(variant.price) > 0)) {
        publish({ error: "Please select an available product option." });
        return Promise.resolve(false);
      }
      return enqueue({ type: "add", product, variantId, quantity });
    },
    update(key, delta, label = "") {
      if (!Number.isInteger(delta) || !delta || !state.cart.some(line => line.key === key)) return Promise.resolve(false);
      const line = state.cart.find(item => item.key === key);
      const type = line.quantity + delta <= 0 ? "remove" : "update";
      return enqueue({ type, key, delta, label: label || line.variantTitle || line.productId });
    },
    remove(key, label = "") {
      const line = state.cart.find(item => item.key === key);
      if (!line) return Promise.resolve(false);
      return enqueue({ type: "remove", key, label: label || line.variantTitle || line.productId });
    },
    async retry() {
      if (!failedOperation || state.pending) return false;
      const operation = failedOperation;
      const pendingOperations = operation.intents.map(intent => describeIntent(intent, confirmedCart));
      publish({
        cart: operation.lines,
        pending: true,
        pendingKeys: pendingOperations.map(item => item.key),
        pendingOperations,
        error: "",
      });
      try {
        return await synchronize(operation.lines, { ...operation.options, operations: operation.intents, retry: true });
      } catch {
        publish({ cart: confirmedCart, pending: false, pendingKeys: [], pendingOperations: [], remoteCart: null, error: operation.error || CART_ERROR });
        return false;
      }
    },
  };
  return api;
}

export function useShopifyCart({ catalog, setCatalog, onNotice, service = catalogService }) {
  const callbacks = useRef({ setCatalog, onNotice });
  callbacks.current = { setCatalog, onNotice };
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    let storage;
    try { storage = globalThis.localStorage; } catch { /* Browser storage disabled. */ }
    controllerRef.current = createShopifyCartController({
      service,
      storage,
      onNotice: message => callbacks.current.onNotice?.(message),
      onProducts: products => callbacks.current.setCatalog?.(current => {
        const refreshed = new Map(products.map(product => [product.id, product]));
        return current.map(product => refreshed.get(product.id) || product);
      }),
    });
  }
  const controller = controllerRef.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.hydrate(catalog); }, [controller, catalog]);
  return { ...state, add: controller.add, update: controller.update, remove: controller.remove, retry: controller.retry };
}
