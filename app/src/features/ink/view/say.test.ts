// The page's buttons share one status toast, so what it shows is always the latest thing done.
import { beforeEach, describe, expect, it } from 'vitest';
import { toastStore } from '../../../state/toasts';
import { say } from './say';

describe('say', () => {
  beforeEach(() => toastStore.set({ current: null, queue: [] }));

  it('replaces the last status instead of queueing behind it', () => {
    say('Server added');
    say('Router added');
    say('Line');
    const { current, queue } = toastStore.get();
    expect(current?.message).toBe('Line');
    expect(queue).toHaveLength(0);
  });
});
