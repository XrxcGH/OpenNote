// Dictionaries for other languages, added by choosing a file. A dictionary file is JSON with a name, a language, and
// the words in the same shape as the bundled chunks. The words are kept in this browser's own storage on this device
// (IndexedDB, because a dictionary is larger than the small settings storage), listed with their size, and removed on
// request. Nothing is downloaded: the file is the person's own.
import { POS_LIST } from './types';
import type { Chunk, ChunkLoader, PosEntry } from './types';
import { chunkKey } from './lookup';

export const PACK_FORMAT = 'opennote-dictionary';
/** The largest dictionary file that is read, in bytes. */
export const MAX_PACK_BYTES = 40 * 1024 * 1024;

export interface PackInfo {
  id: string;
  name: string;
  /** A language tag, such as "es". */
  language: string;
  words: number;
  /** The size of the file it came from, in bytes. */
  bytes: number;
}

export interface Pack {
  info: PackInfo;
  entries: Readonly<Record<string, readonly PosEntry[]>>;
}

export type PackProblem = 'notJson' | 'format' | 'empty' | 'tooLarge';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function sensesOk(senses: unknown): boolean {
  return (
    Array.isArray(senses) &&
    senses.length > 0 &&
    senses.every(
      (sense) =>
        Array.isArray(sense) &&
        typeof sense[0] === 'string' &&
        Array.isArray(sense[1]) &&
        sense[1].every((one) => typeof one === 'string') &&
        (sense[2] === undefined || typeof sense[2] === 'string'),
    )
  );
}

/** Reads a dictionary file. The words must be well formed, so a damaged file is refused and never half used. */
export function readPackFile(text: string, id: string): { pack: Pack } | { problem: PackProblem } {
  if (text.length > MAX_PACK_BYTES) return { problem: 'tooLarge' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { problem: 'notJson' };
  }
  if (
    !isRecord(data) ||
    data.format !== PACK_FORMAT ||
    typeof data.name !== 'string' ||
    data.name.trim() === '' ||
    typeof data.language !== 'string' ||
    !isRecord(data.entries)
  )
    return { problem: 'format' };
  const entries: Record<string, PosEntry[]> = {};
  for (const [word, value] of Object.entries(data.entries)) {
    if (
      !Array.isArray(value) ||
      !value.every((entry) => Array.isArray(entry) && POS_LIST.includes(entry[0]) && sensesOk(entry[1]))
    )
      return { problem: 'format' };
    entries[word.toLocaleLowerCase()] = value as PosEntry[];
  }
  const words = Object.keys(entries).length;
  if (words === 0) return { problem: 'empty' };
  return {
    pack: {
      info: {
        id,
        name: data.name.trim().slice(0, 80),
        language: data.language.slice(0, 20),
        words,
        bytes: text.length,
      },
      entries,
    },
  };
}

/** A pack's words as chunks by first letter, for the look-up. */
export function packLoader(pack: Pack): ChunkLoader {
  const byKey = new Map<string, Record<string, readonly PosEntry[]>>();
  for (const [word, entry] of Object.entries(pack.entries)) {
    const key = chunkKey(word);
    byKey.set(key, { ...(byKey.get(key) ?? {}), [word]: entry });
  }
  return async (key) => (byKey.get(key) as Chunk | undefined) ?? null;
}

/** Where added dictionaries are kept. */
export interface PackStore {
  list(): Promise<PackInfo[]>;
  get(id: string): Promise<Pack | null>;
  put(pack: Pack): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memoryPackStore(): PackStore {
  const held = new Map<string, Pack>();
  return {
    list: async () => [...held.values()].map((pack) => pack.info),
    get: async (id) => held.get(id) ?? null,
    put: async (pack) => void held.set(pack.info.id, pack),
    remove: async (id) => void held.delete(id),
  };
}

const DB = 'opennote-dictionaries';
const STORE = 'packs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'info.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The browser's own storage for this device. Falls back to memory where the browser has none. */
export function browserPackStore(): PackStore {
  if (typeof indexedDB === 'undefined') return memoryPackStore();
  const use = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await done(run(db.transaction(STORE, mode).objectStore(STORE)));
    } finally {
      db.close();
    }
  };
  return {
    async list() {
      const all = await use('readonly', (store) => store.getAll() as IDBRequest<Pack[]>);
      return all.map((pack) => pack.info);
    },
    async get(id) {
      return (await use('readonly', (store) => store.get(id) as IDBRequest<Pack | undefined>)) ?? null;
    },
    async put(pack) {
      await use('readwrite', (store) => store.put(pack));
    },
    async remove(id) {
      await use('readwrite', (store) => store.delete(id));
    },
  };
}
