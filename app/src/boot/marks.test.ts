import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '../platform/web';
import { FRAME_FALLBACK_MS, PAGE_READY_FALLBACK_MS, reportFirstPaint, reportPageReady, resetMarks } from './marks';

function fakeView(frames: boolean): Window {
  const view = {
    document: { documentElement: { getAttribute: () => 'dark' } },
    requestAnimationFrame: (callback: () => void) => {
      if (frames) queueMicrotask(callback);
      return 0;
    },
    setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
  };
  return view as unknown as Window;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetMarks();
});

afterEach(() => vi.useRealTimers());

describe('start-up marks', () => {
  it('reports the first paint after two frames, then the shell', async () => {
    const platform = createWebPlatform();
    const paint = vi.spyOn(platform.lifecycle, 'firstPaint');
    reportFirstPaint(platform, fakeView(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(platform.perf.marks).toEqual(['firstPaint', 'shellReady']);
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('reports anyway when no animation frames run', async () => {
    const platform = createWebPlatform();
    reportFirstPaint(platform, fakeView(false));
    expect(platform.perf.marks).toEqual([]);
    await vi.advanceTimersByTimeAsync(FRAME_FALLBACK_MS);
    expect(platform.perf.marks).toEqual(['firstPaint', 'shellReady']);
  });

  it('reports the page once, with the first call winning', async () => {
    const platform = createWebPlatform();
    const ready = vi.spyOn(platform.lifecycle, 'ready');
    reportFirstPaint(platform, fakeView(true));
    await vi.advanceTimersByTimeAsync(0);
    reportPageReady(platform, 'p1');
    reportPageReady(platform, 'p2');
    await vi.advanceTimersByTimeAsync(PAGE_READY_FALLBACK_MS);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0]?.[0]).toMatchObject({ pageId: 'p1' });
    expect(platform.perf.marks.filter((mark) => mark === 'pageReady')).toHaveLength(1);
  });

  it('reports for the shell when no page view does, so the updater still starts its healthy timer', async () => {
    const platform = createWebPlatform();
    const ready = vi.spyOn(platform.lifecycle, 'ready');
    reportFirstPaint(platform, fakeView(true));
    await vi.advanceTimersByTimeAsync(PAGE_READY_FALLBACK_MS);
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ pageId: null }));
  });
});
