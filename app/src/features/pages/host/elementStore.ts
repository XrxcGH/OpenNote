// Where the elements library is kept on this device. Elements carry their images, so they can outgrow the few megabytes
// that local storage allows; the library goes in IndexedDB as one record, and stays in memory where that is missing.
// The library itself, and every change to it, is the pure code in `elements/`.
import { createStore } from '../../../state/store';
import { EMPTY_LIBRARY } from '../elements';
import type { ElementLibrary, LibraryError, LibraryResult } from '../elements';

/** Where the library is kept. A test supplies its own. */
export interface LibraryStorage {
  load(): Promise<ElementLibrary | null>;
  save(library: ElementLibrary): Promise<boolean>;
}

const DATABASE = 'opennote.elements';
const STORE = 'library';
const KEY = 'library';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function request<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const done = work(db.transaction(STORE, mode).objectStore(STORE));
        done.onsuccess = () => {
          db.close();
          resolve(done.result);
        };
        done.onerror = () => {
          db.close();
          reject(done.error);
        };
      }),
  );
}

/** A value read back from storage, kept only if it has the library's two lists. */
function asLibrary(value: unknown): ElementLibrary | null {
  const found = value as Partial<ElementLibrary> | null;
  return found && Array.isArray(found.entries) && Array.isArray(found.folders) ? (found as ElementLibrary) : null;
}

const indexedStorage: LibraryStorage = {
  load: async () => {
    try {
      return typeof indexedDB === 'undefined' ? null : asLibrary(await request('readonly', (s) => s.get(KEY)));
    } catch {
      return null;
    }
  },
  save: async (library) => {
    try {
      if (typeof indexedDB === 'undefined') return false;
      await request('readwrite', (s) => s.put(library, KEY));
      return true;
    } catch {
      return false;
    }
  },
};

let storage: LibraryStorage = indexedStorage;
let loading: Promise<void> | null = null;

export const elementLibrary = createStore<ElementLibrary>(EMPTY_LIBRARY, 'element library');

/** Swaps the storage, for a test. */
export function useLibraryStorage(next: LibraryStorage): void {
  storage = next;
  loading = null;
  elementLibrary.set(EMPTY_LIBRARY);
}

/** Reads the library once. Later calls wait for the same read. */
export function loadElementLibrary(): Promise<void> {
  loading ??= storage.load().then((found) => {
    if (found) elementLibrary.set(found);
  });
  return loading;
}

export interface Changed {
  readonly error?: LibraryError | 'notSaved';
}

/**
 * Applies a library change and keeps the result. A change that cannot be made leaves the library as it was and says
 * why. A library that cannot be saved still holds the change until the window closes, and says `notSaved`.
 */
export async function changeLibrary(change: (library: ElementLibrary) => LibraryResult): Promise<Changed> {
  await loadElementLibrary();
  const result = change(elementLibrary.get());
  if (result.error) return { error: result.error };
  elementLibrary.set(result.library);
  return (await storage.save(result.library)) ? {} : { error: 'notSaved' };
}
