import { afterEach, describe, expect, it, vi } from 'vitest';
import { beforeExit } from '../registries';
import { toastStore } from '../state/toasts';
import { createTestPlatform } from '../test/platform';
import { answerBeforeExit, installExitHandshake, joinExitHandshake } from './exit';

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

describe('a refusal in the exit handshake', () => {
  it('offers "Close anyway" when the refusing hook has a way out, and says what the hook said', async () => {
    const platform = createTestPlatform();
    const exitReady = vi.spyOn(platform.lifecycle, 'exitReady');
    const close = vi.spyOn(platform.window, 'close');
    const retry = vi.spyOn(platform.lifecycle, 'closeAnyway');
    const closeAnyway = vi.fn();
    const answer = { ok: false, reason: 'errors.commandFailed', message: 'The disk is full.', closeAnyway } as const;
    unregister.push(beforeExit.register({ id: 'stuck', order: 10, run: () => Promise.resolve(answer) }));
    await answerBeforeExit(platform, 'close');
    expect(exitReady).toHaveBeenCalledWith({ ok: false, reason: 'errors.commandFailed' });
    const toast = toastStore.get().current;
    expect(toast?.message).toBe('The disk is full.');
    expect(toast?.action?.label).toBe('Close anyway');
    expect(closeAnyway).not.toHaveBeenCalled();
    await toast?.action?.run();
    expect(closeAnyway).toHaveBeenCalledOnce();
    // Rust repeats what this window refused: in a page window that was the app's exit, which closing only this
    // window wouldn't repeat.
    expect(retry).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('shows no action when the refusing hook has no way out', async () => {
    const platform = createTestPlatform();
    hook('first', 10, () => Promise.resolve({ ok: false, reason: 'errors.commandFailed' }));
    await answerBeforeExit(platform, 'close');
    expect(toastStore.get().current?.action).toBeUndefined();
  });
});

// F3-3: only the main window answered, so a page window closed (or the app exited) with its last typing unsent.
describe('the windows in the exit handshake', () => {
  it('lets a page or quick capture window flush its pages before it or the app closes', async () => {
    for (const kind of ['page', 'capture'] as const) {
      const platform = createTestPlatform();
      const exitReady = vi.spyOn(platform.lifecycle, 'exitReady');
      const listening = vi.spyOn(platform.lifecycle, 'firstPaint');
      const flush = hook(`page.flush.${kind}`, 10, () => Promise.resolve({ ok: true }));
      const stop = joinExitHandshake(platform, kind);
      expect(listening).toHaveBeenCalledOnce();
      platform.lifecycle.requestExit('close');
      await vi.waitFor(() => expect(exitReady).toHaveBeenCalledWith({ ok: true }));
      expect(flush).toHaveBeenCalledWith('close');
      stop?.();
      unregister.splice(0).forEach((done) => done());
    }
  });

  it('leaves the main window to report its own first paint, and a tool window out', () => {
    const platform = createTestPlatform();
    const listening = vi.spyOn(platform.lifecycle, 'firstPaint');
    const listen = vi.spyOn(platform.lifecycle, 'onBeforeExit');
    expect(joinExitHandshake(platform, 'tool')).toBeNull();
    expect(listen).not.toHaveBeenCalled();
    joinExitHandshake(platform, 'main')?.();
    expect(listen).toHaveBeenCalledOnce();
    expect(listening).not.toHaveBeenCalled();
  });
});
