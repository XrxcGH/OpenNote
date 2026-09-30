// A tiny event emitter for the web fakes.

import type { Unsubscribe } from '../types';

export interface Emitter<T extends unknown[]> {
  on(listener: (...args: T) => void): Unsubscribe;
  emit(...args: T): void;
}

export function emitter<T extends unknown[]>(): Emitter<T> {
  const listeners = new Set<(...args: T) => void>();
  return {
    on(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit: (...args) => [...listeners].forEach((listener) => listener(...args)),
  };
}
