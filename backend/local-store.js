import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const emptyState = () => ({ preparations: {}, sessions: {}, completions: {}, completionClaims: {}, webhookClaims: {}, webhookEvents: {}, standardTestOrders: {} });
const clone = value => value == null ? null : structuredClone(value);

/** Durable single-process store for local development only. Do not use across multiple server instances. */
export function createLocalRazorpayStore(filePath) {
  if (typeof filePath !== "string" || !filePath) throw new Error("A local checkout store path is required.");
  let queue = Promise.resolve();

  async function readState() {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      return { ...emptyState(), ...parsed };
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw new Error("The local Razorpay checkout store could not be read.");
    }
  }

  async function writeState(state) {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tempPath, filePath);
  }

  function transaction(operation) {
    const result = queue.then(async () => {
      const state = await readState();
      const value = await operation(state);
      await writeState(state);
      return clone(value);
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function lookup(selector) {
    return queue.then(async () => clone(await selector(await readState())));
  }

  return Object.freeze({
    claimPreparation: fingerprint => transaction(state => {
      const existing = Object.values(state.sessions).find(session => session.fingerprint === fingerprint && session.state === "prepared" && session.expiresAt > Date.now());
      if (existing) return { claimed: false, session: existing };
      if (state.preparations[fingerprint]) return { claimed: false };
      state.preparations[fingerprint] = { claimedAt: Date.now() };
      return { claimed: true };
    }),
    failPreparation: (fingerprint, result) => transaction(state => {
      delete state.preparations[fingerprint];
      return true;
    }),
    saveSession: session => transaction(state => {
      state.sessions[session.tokenDigest] = session;
      delete state.preparations[session.fingerprint];
      return true;
    }),
    getSessionByTokenDigest: digest => lookup(state => state.sessions[digest]),
    getSessionByRazorpayOrderId: orderId => lookup(state => Object.values(state.sessions).find(session => session.razorpayOrderId === orderId)),
    claimCompletion: digest => transaction(state => {
      if (state.completionClaims[digest]) return { claimed: false };
      state.completionClaims[digest] = { claimedAt: Date.now() };
      return { claimed: true };
    }),
    saveCompletion: (digest, value) => transaction(state => {
      state.completions[digest] = value;
      return true;
    }),
    getCompletion: digest => lookup(state => state.completions[digest]),
    claimWebhookEvent: eventId => transaction(state => {
      if (state.webhookClaims[eventId]) return { claimed: false };
      state.webhookClaims[eventId] = { claimedAt: Date.now() };
      return { claimed: true };
    }),
    saveWebhookEvent: (eventId, value) => transaction(state => {
      state.webhookEvents[eventId] = value;
      return true;
    }),
    saveStandardTestOrder: order => transaction(state => { state.standardTestOrders[order.id] = order; return true; }),
    getStandardTestOrder: orderId => lookup(state => state.standardTestOrders[orderId]),
    getStandardTestOrderByReference: reference => lookup(state => Object.values(state.standardTestOrders).find(order => order.reference === reference)),
    saveStandardTestVerification: (orderId, result) => transaction(state => {
      if (!state.standardTestOrders[orderId]) throw new Error("Test order was not found.");
      state.standardTestOrders[orderId] = { ...state.standardTestOrders[orderId], ...result };
      return true;
    }),
  });
}
