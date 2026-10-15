import { beforeEach, describe, expect, it } from 'vitest';
import { dismissReadable, externalStore, markReadable } from './externalStore';

describe('the offer to bring in an edited page.md', () => {
  beforeEach(() => externalStore.set({ changed: {}, tick: 0 }));

  it('is not made again, when the page opens, after it was turned down', () => {
    markReadable('p2');
    expect(externalStore.get().changed.p2).toBe('readable');
    dismissReadable('p2');
    expect(externalStore.get().changed.p2).toBeUndefined();
    markReadable('p2');
    expect(externalStore.get().changed.p2).toBeUndefined();
  });
});
