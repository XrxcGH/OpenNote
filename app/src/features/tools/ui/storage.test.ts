// @vitest-environment jsdom
// The tools' device storage: other windows' writes are heard, and a write that changes nothing is not made.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStored, saveStored, watchStored } from './storage';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const heard = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }));

describe('watching another window', () => {
  it('hears its own key and a full clear, not other keys, and stops when told to', () => {
    const changed = vi.fn();
    const stop = watchStored('timers', changed);
    heard('opennote.tools.exams');
    expect(changed).not.toHaveBeenCalled();
    heard('opennote.tools.timers');
    heard(null);
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    heard('opennote.tools.timers');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('does not write a value that is already stored, so two windows cannot echo it back and forth', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    saveStored('timers', { a: 1 });
    saveStored('timers', { a: 1 });
    expect(set).toHaveBeenCalledTimes(1);
    saveStored('timers', { a: 2 });
    expect(set).toHaveBeenCalledTimes(2);
    expect(loadStored('timers', null)).toEqual({ a: 2 });
  });
});
