// What each screen last loaded, so it shows instantly next time (going back to
// a page, or opening the app) while the fresh data loads behind it.
//
// Kept in memory, and on the phone in IndexedDB (which can hold Maps and Dates)
// for the next time the app opens. Everything belongs to the signed-in person:
// it's wiped when they sign out or someone else signs in.

const DB = 'gshq-cache';
const STORE = 'screens';
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const MAX_ENTRIES = 300;

interface Entry { data: unknown; at: number }

const memory = new Map<string, Entry>();
let owner: string | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

/**
 * Load what's saved on the phone into memory. Called once as the app opens
 * (while the splash is up); gives up after `timeoutMs` so it never holds the app back.
 */
export async function loadCache(timeoutMs = 400): Promise<void> {
  const read = (async () => {
    const d = await db();
    if (!d) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = d.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).openCursor();
        const cutoff = Date.now() - MAX_AGE_MS;
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          const e = c.value as Entry;
          if (!e || e.at <= cutoff) c.delete(); // old: tidy it away
          else if (!memory.has(String(c.key))) memory.set(String(c.key), e);
          c.continue();
        };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  })();
  await Promise.race([read, new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** Whose data the cache holds. A different person (or signing out) wipes it. */
export function setCacheOwner(userId: string | null) {
  const prev = owner ?? readOwner();
  owner = userId;
  if (prev !== userId) {
    memory.clear();
    void db().then((d) => { try { d?.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch { /* ignore */ } });
  }
  try { userId ? localStorage.setItem('gshq-cache-owner', userId) : localStorage.removeItem('gshq-cache-owner'); } catch { /* ignore */ }
}
function readOwner(): string | null {
  try { return localStorage.getItem('gshq-cache-owner'); } catch { return null; }
}

/**
 * A key for a screen's data: which loader (its source text) and its inputs.
 * Only loaders whose inputs are plain values (ids, flags) are cached.
 */
export function cacheKey(fn: () => unknown, deps: unknown[]): string | null {
  if (!deps.every((d) => d === null || d === undefined || ['string', 'number', 'boolean'].includes(typeof d))) return null;
  return `${fn.toString()}|${JSON.stringify(deps)}`;
}

export function cached<T>(key: string | null): T | undefined {
  return key ? (memory.get(key)?.data as T | undefined) : undefined;
}

export function remember(key: string | null, data: unknown) {
  if (!key || !(owner ?? readOwner())) return;
  const entry = { data, at: Date.now() };
  memory.delete(key);
  memory.set(key, entry);
  if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
  void db().then((d) => {
    if (!d) return;
    try {
      // Data that can't be saved (it holds functions) just stays in memory.
      d.transaction(STORE, 'readwrite').objectStore(STORE).put(entry, key);
    } catch { /* ignore */ }
  });
}

/** Tests: start empty. */
export function resetCacheForTests() {
  memory.clear();
  owner = null;
}
