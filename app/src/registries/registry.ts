// The registry behind every extension point (ARCHITECTURE.md section 7.1). Features add items from their
// register.ts, so a later phase adds a feature without editing shell files.

import { useSyncExternalStore } from 'react';

export interface Registry<T extends { readonly id: string }> {
  /** Throws on a duplicate id. Returns a function that removes the item again. */
  register(item: T): () => void;
  get(id: string): T | undefined;
  /** In registration order. Consumers sort, and filter by flag. */
  list(): readonly T[];
  subscribe(listener: () => void): () => void;
}

export function createRegistry<T extends { readonly id: string }>(name: string): Registry<T> {
  const items = new Map<string, T>();
  const listeners = new Set<() => void>();
  let snapshot: readonly T[] = [];
  const changed = () => {
    snapshot = [...items.values()];
    [...listeners].forEach((listener) => listener());
  };
  return {
    register(item) {
      if (items.has(item.id)) throw new Error(`The ${name} registry already has an item with the id "${item.id}".`);
      items.set(item.id, item);
      changed();
      return () => {
        if (items.get(item.id) !== item) return;
        items.delete(item.id);
        changed();
      };
    },
    get: (id) => items.get(id),
    list: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The registry's items, re-rendering when one is added or removed. */
export function useRegistry<T extends { readonly id: string }>(registry: Registry<T>): readonly T[] {
  return useSyncExternalStore(registry.subscribe, registry.list, registry.list);
}
