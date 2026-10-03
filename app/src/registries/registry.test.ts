import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from './registry';

describe('createRegistry', () => {
  it('lists items in registration order and finds them by id', () => {
    const registry = createRegistry<{ id: string; n: number }>('test');
    registry.register({ id: 'b', n: 2 });
    registry.register({ id: 'a', n: 1 });
    expect(registry.list().map((item) => item.id)).toEqual(['b', 'a']);
    expect(registry.get('a')?.n).toBe(1);
    expect(registry.get('c')).toBeUndefined();
  });

  it('throws on a duplicate id', () => {
    const registry = createRegistry<{ id: string }>('test');
    registry.register({ id: 'a' });
    expect(() => registry.register({ id: 'a' })).toThrow('already has an item with the id "a"');
  });

  it('unregisters, and tells subscribers about every change', () => {
    const registry = createRegistry<{ id: string }>('test');
    const listener = vi.fn();
    registry.subscribe(listener);
    const unregister = registry.register({ id: 'a' });
    const list = registry.list();
    unregister();
    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.list()).toEqual([]);
    expect(list).toHaveLength(1);
  });
});
