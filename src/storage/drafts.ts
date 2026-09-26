/**
 * Crash/refresh recovery.
 *
 * While there are unsaved changes, the application keeps an *encrypted* copy of
 * the working tree in IndexedDB (same key and format as a saved file). Plaintext
 * is never written to browser storage. The draft is deleted after a successful
 * save, when the user discards it, or when they start over.
 */

const DB_NAME = 'family-tree';
const STORE = 'drafts';
const KEY = 'current';

export interface Draft {
  /** Encrypted container JSON. */
  container: string;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB error'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function saveDraft(draft: Draft): Promise<void> {
  await withStore('readwrite', (store) => store.put(draft, KEY));
}

export async function loadDraft(): Promise<Draft | undefined> {
  try {
    const value = await withStore<unknown>('readonly', (store) => store.get(KEY));
    if (
      typeof value === 'object' && value !== null &&
      typeof (value as Draft).container === 'string' && typeof (value as Draft).savedAt === 'string'
    ) {
      return value as Draft;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    // Storage unavailable: there is nothing to clear.
  }
}
