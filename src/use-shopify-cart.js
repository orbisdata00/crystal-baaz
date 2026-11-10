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
  let flushTimer = null;
  let failedOperation = null;
  const jobs = [];
  let inFlightJobs = [];
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
    return [...inFlightJobs, ...jobs].reduce((lines, operation) => applyIntent(lines, operation.intent), confirmedCart);
  }

  function setPendingSnapshot(extra = {}) {
    const operations = pendingSnapshot([...inFlightJobs, ...jobs]);
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

  function failJobs(batch, desired, { error = CART_ERROR, remoteCart = null, uncertain = true } = {}) {
    const canceled = [...batch, ...jobs.splice(0)];
    const intents = canceled.map(operation => operation.intent);
    failedOperation = {
      lines: intents.reduce((lines, intent) => applyIntent(lines, intent), confirmedCart),
      intents,
      options: { verified: ready },
      error,
    };
    inFlightJobs = [];
    if (intents.some(intent => intent.type === "add")) onNotice?.(error);
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
      confirmedCart = reconcileShopifyCartLines(failedOperation.lines, remoteCart);
      publish({ cart: confirmedCart, cartId: remoteCart?.id || state.cartId, remoteCart, error });
      persist();
    }
    settleCanceled(canceled);
  }

  async function runJobs(batch) {
    const desired = batch.reduce((lines, job) => applyIntent(lines, job.intent), confirmedCart);
    const beforeQuantities = new Map(batch.filter(job => job.intent.type === "add").map(job => [operationKey(job.intent), confirmedCart.find(line => line.key === operationKey(job.intent))?.quantity || 0]));
    const result = preview
      ? { cart: null, products: [] }
      : await service.syncCart(state.cartId, desired, state.remoteCart, { verified: true });
    const remoteCart = result?.cart ?? null;
    if (!preview && desired.length && !remoteCart) throw new Error("Missing cart response");
    const nextCart = preview ? desired : remoteCart ? reconcileShopifyCartLines(desired, remoteCart) : [];

    // A server refusal is a confirmed response. Adopt that cart, roll back this
    // intent, and keep a safe desired-state retry available.
    const refusedAdd = batch.some(job => job.intent.type === "add"
      && (nextCart.find(line => line.key === operationKey(job.intent))?.quantity || 0) <= beforeQuantities.get(operationKey(job.intent)));
    if (refusedAdd) {
      failJobs(batch, desired, { error: ADD_ERROR, remoteCart, uncertain: false });
      return false;
    }

    confirmedCart = nextCart;
    const nextCartId = remoteCart?.id || null;
    inFlightJobs = [];
    publish({ cart: cartWithQueuedIntents(), cartId: nextCartId, remoteCart, error: "" });
    persist(confirmedCart, nextCartId);
    if (result?.products?.length) onProducts?.(result.products);
    if (batch.some(job => job.intent.type === "add")) onNotice?.("Added to cart.");
    return true;
  }

  function scheduleQueue() {
    if (flushTimer || processing || failedOperation || !jobs.length) return;
    // Coalesce near-simultaneous taps into one cart state diff and one Shopify
    // mutation while the optimistic lines are visible immediately.
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void processQueue();
    }, 16);
  }

  async function processQueue() {
    if (processing || !jobs.length || failedOperation) return;
    processing = true;
    inFlightJobs = jobs.splice(0);
    const batch = inFlightJobs;
    const operations = pendingSnapshot([...inFlightJobs, ...jobs]);
    publish({ cart: cartWithQueuedIntents(), pending: true, pendingKeys: operations.map(operation => operation.key), pendingOperations: operations });
    try {
      try {
        await runJobs(batch);
        if (!failedOperation) batch.forEach(job => job.resolve(true));
      } catch {
        failJobs(batch, cartWithQueuedIntents());
      }
    } finally {
      processing = false;
      if (!failedOperation) setPendingSnapshot();
      if (jobs.length && !failedOperation) scheduleQueue();
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
      const operations = pendingSnapshot([...inFlightJobs, ...jobs]);
      publish({
        cart: optimistic,
        pending: true,
        pendingKeys: operations.map(operation => operation.key),
        pendingOperations: operations,
        error: "",
      });
      scheduleQueue();
    });
  }

  const api = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async hydrate() {
      if (attemptedHydration) return false;
      attemptedHydration = true;
      if (!savedLines.length && !state.cartId) { ready = true; return true; }
      publish({ pending: true, error: "" });
      try {
        if (!savedLines.length && state.cartId && service.restoreCart) {
          const restored = await service.restoreCart(state.cartId);
          confirmedCart = restored?.lines || [];
          ready = true;
          publish({ cart: confirmedCart, remoteCart: restored?.cart || null, pending: false, pendingKeys: [], pendingOperations: [], error: "" });
          if (restored?.products?.length) onProducts?.(restored.products);
          persist(confirmedCart, state.cartId);
          return true;
        }
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
        const merged = new Map(current.map(product => [product.id, refreshed.get(product.id) || product]));
        for (const product of products) if (!merged.has(product.id)) merged.set(product.id, product);
        return [...merged.values()];
      }),
    });
  }
  const controller = controllerRef.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.hydrate(); }, [controller]);
  return { ...state, add: controller.add, update: controller.update, remove: controller.remove, retry: controller.retry };
}
