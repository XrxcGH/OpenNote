// A small external store on React's useSyncExternalStore (ARCHITECTURE.md section 5.1). One store per slice.
// Components read through selectors, so a change re-renders only what it touches. Commands and platform events
// use get and set directly, outside React. The API mirrors Zustand's, so a switch later would be mechanical.

import { useMemo, useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  /** A no-op when the next value is the same object (Object.is). */
  set(next: T | ((current: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

const resets = new Map<string, () => void>();

/** Creates a store and registers it with resetStores. `name` shows in errors and must be unique. */
export function createStore<T>(initial: T, name: string): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const notify = () => [...listeners].forEach((listener) => listener());
  const store: Store<T> = {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  resets.set(name, () => {
    state = initial;
    notify();
  });
  return store;
}

/** Puts every store back to its initial value. Tests call it in beforeEach. */
export function resetStores(): void {
  resets.forEach((reset) => reset());
}

/**
 * A snapshot function that caches the last state and selection, so a selector that builds a new array doesn't
 * loop, and an equal selection keeps its earlier value.
 */
function cachedSelection<T, S>(store: Store<T>, select: (state: T) => S, equal: (a: S, b: S) => boolean): () => S {
  let last: { state: T; value: S } | null = null;
  return () => {
    const state = store.get();
    if (last && Object.is(last.state, state)) return last.value;
    const next = select(state);
    const value = last && equal(last.value, next) ? last.value : next;
    last = { state, value };
    return value;
  };
}

/** Re-renders only when the selected value changes (Object.is, or a custom equality). */
export function useStore<T, S>(
  store: Store<T>,
  select: (state: T) => S,
  equal: (a: S, b: S) => boolean = Object.is,
): S {
  const getSelection = useMemo(() => cachedSelection(store, select, equal), [store, select, equal]);
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

/** Equal when both are the same, or arrays or plain objects whose items or own keys are the same (Object.is). */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
