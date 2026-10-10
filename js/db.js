// Minimal IndexedDB wrapper — enough for our four object stores, nothing more.

const DB_NAME = 'kanji-trainer';
const DB_VERSION = 1;

export const STORES = {
  progress: 'progress',   // key: char
  reviews: 'reviews',     // auto id, index by ts
  kv: 'kv',               // misc app state (key/value)
  backups: 'backups',     // auto id, rolling snapshots
};

let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.progress)) {
        db.createObjectStore(STORES.progress, { keyPath: 'char' });
      }
      if (!db.objectStoreNames.contains(STORES.reviews)) {
        const s = db.createObjectStore(STORES.reviews, { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
        s.createIndex('char', 'char');
      }
      if (!db.objectStoreNames.contains(STORES.kv)) db.createObjectStore(STORES.kv);
      if (!db.objectStoreNames.contains(STORES.backups)) {
        db.createObjectStore(STORES.backups, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blockiert — bitte andere Tabs dieser App schließen.'));
  });
  return dbp;
}

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export async function tx(names, mode, fn) {
  const db = await openDB();
  const t = db.transaction(names, mode);
  const stores = Array.isArray(names) ? names.map((n) => t.objectStore(n)) : t.objectStore(names);
  const out = await fn(stores, t);
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transaktion abgebrochen'));
  });
  return out;
}

export const get = (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key)));
export const getAll = (store) => tx(store, 'readonly', (s) => wrap(s.getAll()));
export const put = (store, val, key) => tx(store, 'readwrite', (s) => wrap(s.put(val, key)));
export const del = (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key)));
export const clearStore = (store) => tx(store, 'readwrite', (s) => wrap(s.clear()));
export const count = (store) => tx(store, 'readonly', (s) => wrap(s.count()));

export function putMany(store, vals) {
  return tx(store, 'readwrite', (s) => { for (const v of vals) s.put(v); });
}

/** Read records from an index within a key range, newest-last. */
export function getAllByIndex(store, index, range) {
  return tx(store, 'readonly', (s) => wrap(s.index(index).getAll(range)));
}
export { wrap };
