import { describe, expect, it, vi } from 'vitest';
import { createStore, resetStores, shallowEqual } from './store';

describe('createStore', () => {
  it('notifies subscribers of changes', () => {
    const store = createStore({ count: 0 }, 'test.notify');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set({ count: 1 });
    store.set((state) => ({ count: state.count + 1 }));
    expect(store.get()).toEqual({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set({ count: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the next value is the same object', () => {
    const state = { count: 0 };
    const store = createStore(state, 'test.same');
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(state);
    store.set((current) => current);
    expect(listener).not.toHaveBeenCalled();
  });

  it('goes back to its initial value on resetStores, and tells subscribers', () => {
    const store = createStore({ count: 0 }, 'test.reset');
    store.set({ count: 5 });
    const listener = vi.fn();
    store.subscribe(listener);
    resetStores();
    expect(store.get()).toEqual({ count: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('shallowEqual', () => {
  it('compares arrays and objects one level deep', () => {
    const item = { id: 1 };
    expect(shallowEqual([1, item], [1, item])).toBe(true);
    expect(shallowEqual([1, item], [1, { id: 1 }])).toBe(false);
    expect(shallowEqual({ a: 1, b: item }, { a: 1, b: item })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual<unknown>([1], { 0: 1 })).toBe(false);
    expect(shallowEqual(Number.NaN, Number.NaN)).toBe(true);
  });
});
