import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkBeforeOutput, checkFirstOn, setCheckFirst } from './gate';

describe('check accessibility first', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });

  it('is off until the person turns it on, and remembers the choice', () => {
    expect(checkFirstOn()).toBe(false);
    setCheckFirst(true);
    expect(checkFirstOn()).toBe(true);
    setCheckFirst(false);
    expect(checkFirstOn()).toBe(false);
  });

  it('lets output go ahead without a check when it is off or nothing is written', async () => {
    let reviewed = false;
    const review = () => {
      reviewed = true;
    };
    expect(await checkBeforeOutput(['a'], review)).toBe(true);
    setCheckFirst(true);
    expect(await checkBeforeOutput([], review)).toBe(true);
    expect(reviewed).toBe(false);
  });
});
