import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whenPictureSelected } from './scanAfterPaste';
import type { Selecting } from './scanAfterPaste';

function fakeSelection() {
  const listeners = new Set<() => void>();
  let picture = false;
  const selecting: Selecting = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pictureSelected: () => picture,
  };
  return {
    selecting,
    listeners,
    select() {
      picture = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('whenPictureSelected', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not run while the pasted picture is not yet selected, and runs once it is', () => {
    const fake = fakeSelection();
    const run = vi.fn();
    whenPictureSelected(fake.selecting, run);
    vi.advanceTimersByTime(500);
    expect(run).not.toHaveBeenCalled();
    fake.select();
    expect(run).toHaveBeenCalledOnce();
    fake.select();
    expect(run).toHaveBeenCalledOnce();
    expect(fake.listeners.size).toBe(0);
  });

  it('gives up silently when no picture is ever selected', () => {
    const fake = fakeSelection();
    const run = vi.fn();
    whenPictureSelected(fake.selecting, run, 1000);
    vi.advanceTimersByTime(1500);
    fake.select();
    expect(run).not.toHaveBeenCalled();
    expect(fake.listeners.size).toBe(0);
  });
});
