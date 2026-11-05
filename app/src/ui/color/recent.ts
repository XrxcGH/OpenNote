// The most recent custom colors, per notebook, newest first, at most ten. They are device state: kept on this
// device, never in the notebook. The storage is a small adapter so tests and the app can supply their own.

import { createStore, useStore } from '../../state/store';

export const RECENT_LIMIT = 10;
/** The most notebooks kept, newest first, so the stored object cannot grow without bound. */
export const NOTEBOOK_LIMIT = 50;
const KEY = 'opennote.recentColors';

export interface RecentStorage {
  read(): string | null;
  write(text: string): void;
}

const browserStorage: RecentStorage = {
  read() {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  },
  write(text) {
    try {
      globalThis.localStorage?.setItem(KEY, text);
    } catch {
      // Storage can be blocked. The list then lasts until the app closes.
    }
  },
};

let storage: RecentStorage = browserStorage;

function load(): Readonly<Record<string, readonly string[]>> {
  try {
    const raw: unknown = JSON.parse(storage.read() ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
    for (const [id, list] of Object.entries(raw).slice(-NOTEBOOK_LIMIT)) {
      if (Array.isArray(list)) {
        out[id] = list.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c)).slice(0, RECENT_LIMIT);
      }
    }
    return out;
  } catch {
    return {};
  }
}

const store = createStore<Readonly<Record<string, readonly string[]>>>(load(), 'recentColors');

/** Swaps where the list is kept, and reloads it. */
export function setRecentStorage(next: RecentStorage | null): void {
  storage = next ?? browserStorage;
  store.set(load());
}

export function recentColors(notebookId: string): readonly string[] {
  return store.get()[notebookId] ?? [];
}

/** Puts a custom color first, drops its earlier place, and keeps the ten newest. */
export function rememberColor(notebookId: string, hex: string): void {
  const color = hex.toLowerCase();
  const next = [color, ...recentColors(notebookId).filter((c) => c !== color)].slice(0, RECENT_LIMIT);
  // The notebook just used goes last; the oldest fall away past the cap.
  const rest = Object.entries(store.get()).filter(([id]) => id !== notebookId);
  const all: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
  for (const [id, list] of [...rest, [notebookId, next] as const].slice(-NOTEBOOK_LIMIT)) all[id] = list;
  store.set(all);
  storage.write(JSON.stringify(all));
}

const NONE: readonly string[] = [];
export function useRecentColors(notebookId: string): readonly string[] {
  return useStore(store, (all) => all[notebookId] ?? NONE);
}
