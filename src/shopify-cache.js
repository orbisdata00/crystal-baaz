const DB_NAME = "crystal-baaz-storefront";
const STORE_NAME = "catalog-cache";
const memoryCache = new Map();

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function transactionRequest(db, mode, action) {
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCatalogCache(key, maxAgeMs) {
  const memory = memoryCache.get(key);
  if (memory && Date.now() - memory.savedAt < maxAgeMs) return memory.value;
  const db = await openDatabase();
  if (!db) return null;
  const record = await transactionRequest(db, "readonly", (store) => store.get(key));
  db.close();
  if (!record || Date.now() - record.savedAt >= maxAgeMs) return null;
  memoryCache.set(key, record);
  return record.value;
}

export async function setCatalogCache(key, value) {
  const record = { savedAt: Date.now(), value };
  memoryCache.set(key, record);
  const db = await openDatabase();
  if (!db) return;
  await transactionRequest(db, "readwrite", (store) => store.put(record, key));
  db.close();
}
