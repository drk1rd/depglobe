// Tiny async KV with TTL. IndexedDB in the browser, in-memory in Node.
const TTL_MS = 7 * 24 * 3600 * 1000;
const DB = 'depglobe';
const STORE = 'kv';

const memory = new Map<string, { t: number; v: unknown }>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const m = memory.get(key);
  if (m && Date.now() - m.t < TTL_MS) return m.v as T;
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as { t: number; v: T } | undefined;
        if (rec && Date.now() - rec.t < TTL_MS) {
          memory.set(key, rec);
          resolve(rec.v);
        } else resolve(undefined);
      };
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function cacheSet(key: string, v: unknown): Promise<void> {
  const rec = { t: Date.now(), v };
  memory.set(key, rec);
  const d = await db();
  if (!d) return;
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(rec, key);
  } catch {}
}

export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const v = await fn();
  await cacheSet(key, v);
  return v;
}
