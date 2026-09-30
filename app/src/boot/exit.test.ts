import { afterEach, describe, expect, it, vi } from 'vitest';
import { beforeExit } from '../registries';
import { toastStore } from '../state/toasts';
import { createTestPlatform } from '../test/platform';
import { answerBeforeExit, installExitHandshake } from './exit';

const unregister: (() => void)[] = [];

type Answer = { ok: true } | { ok: false; reason: 'errors.commandFailed' };

function hook(id: string, order: number, result: () => Promise<Answer>) {
  const run = vi.fn(result);
  unregister.push(beforeExit.register({ id, order, run }));
  return run;
}

afterEach(() => {
  unregister.splice(0).forEach((stop) => stop());
  toastStore.set({ current: null, queue: [] });
});

describe('the exit handshake in the interface', () => {
  it('runs the hooks in order and says ok when none refuses', async () => {
    const platform = createTestPlatform();
    const exitReady = vi.spyOn(platform.lifecycle, 'exitReady');
    const order: string[] = [];
    hook('b', 20, () => {
      order.push('b');
      return Promise.resolve({ ok: true });
    });
    hook('a', 10, () => {
      order.push('a');
      return Promise.resolve({ ok: true });
    });
    await answerBeforeExit(platform, 'close');
    expect(order).toEqual(['a', 'b']);
    expect(exitReady).toHaveBeenCalledWith({ ok: true });
  });

  it('stops at the first refusal, keeps the window open, and explains in a toast', async () => {
    const platform = createTestPlatform();
    const exitReady = vi.spyOn(platform.lifecycle, 'exitReady');
    hook('first', 10, () => Promise.resolve({ ok: false, reason: 'errors.commandFailed' }));
    const second = hook('second', 20, () => Promise.resolve({ ok: true }));
    await answerBeforeExit(platform, 'close');
    expect(second).not.toHaveBeenCalled();
    expect(exitReady).toHaveBeenCalledWith({ ok: false, reason: 'errors.commandFailed' });
    expect(toastStore.get().current?.message).toMatch(/didn't work/i);
  });

  it('logs a hook that throws and still lets the app close', async () => {
    const platform = createTestPlatform();
    const exitReady = vi.spyOn(platform.lifecycle, 'exitReady');
    hook('broken', 10, () => Promise.reject(new Error('disk on fire')));
    await answerBeforeExit(platform, 'sessionEnd');
    expect(exitReady).toHaveBeenCalledWith({ ok: true });
    expect(platform.logEntries.some(([, message]) => message.includes('disk on fire'))).toBe(true);
  });

  it("answers Rust's request, with the reason it gave", async () => {
    const platform = createTestPlatform();
    const exitReady = vi.spyOn(platform.lifecycle, 'exitReady');
    const run = hook('one', 10, () => Promise.resolve({ ok: true }));
    const stop = installExitHandshake(platform);
    platform.lifecycle.requestExit('moveApp');
    await vi.waitFor(() => expect(exitReady).toHaveBeenCalledWith({ ok: true }));
    expect(run).toHaveBeenCalledWith('moveApp');
    stop();
  });
});
