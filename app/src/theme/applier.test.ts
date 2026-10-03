// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThemeApplier } from './applier';
import type { Theme } from './applier';

let written: Theme[];

function applier(crossfade = false) {
  written = [];
  return createThemeApplier({ write: (theme) => written.push(theme), crossfade: () => crossfade });
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('the theme applier timing', () => {
  it('shows the first theme at once without counting it toward the interval', () => {
    const themes = applier();
    themes.init('dark');
    themes.request('light');
    expect(written).toEqual(['dark', 'light']);
  });

  it('holds a change asked for within 350 ms until the interval ends', () => {
    const themes = applier();
    themes.init('light');
    themes.request('dark');
    themes.request('light');
    expect(written).toEqual(['light', 'dark']);
    expect(themes.current()).toBe('light');
    vi.advanceTimersByTime(350);
    expect(written).toEqual(['light', 'dark', 'light']);
  });

  it('applies nothing when the latest request is the theme already shown', () => {
    const themes = applier();
    themes.init('light');
    themes.request('dark');
    themes.request('light');
    themes.request('dark');
    vi.advanceTimersByTime(1000);
    expect(written).toEqual(['light', 'dark']);
  });

  it('never applies more than three changes in any second while requests keep coming', () => {
    const themes = applier();
    const times: number[] = [];
    const tracked = createThemeApplier({
      write: () => times.push(Date.now()),
      crossfade: () => false,
      now: () => Date.now(),
    });
    tracked.init('light');
    times.length = 0;
    for (let i = 0; i < 40; i += 1) {
      tracked.request(i % 2 === 0 ? 'dark' : 'light');
      vi.advanceTimersByTime(50);
    }
    const windows = times.map((start) => times.filter((time) => time >= start && time < start + 1000).length);
    expect(Math.max(...windows)).toBeLessThanOrEqual(3);
    themes.dispose();
  });
});

describe('the crossfade and its participants', () => {
  it('crossfades through a view transition when asked to', () => {
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { ready: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', { value: startViewTransition, configurable: true });
    const themes = applier(true);
    themes.init('light');
    themes.request('dark');
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(written).toEqual(['light', 'dark']);
  });

  it('switches at once, with no crossfade, when told not to fade', () => {
    const startViewTransition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { value: startViewTransition, configurable: true });
    const themes = applier(false);
    themes.init('light');
    themes.request('dark');
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(written).toEqual(['light', 'dark']);
  });

  it('writes as soon as every participant is ready', async () => {
    const themes = applier();
    let ready: () => void = () => {};
    themes.addParticipant({ prepare: () => new Promise<void>((resolve) => (ready = resolve)) });
    themes.init('light');
    themes.request('dark');
    expect(written).toEqual(['light']);
    ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual(['light', 'dark']);
  });

  it('stops waiting for a slow participant after 120 ms', async () => {
    const themes = applier();
    const remove = themes.addParticipant({ prepare: () => new Promise(() => {}) });
    themes.init('light');
    themes.request('dark');
    await vi.advanceTimersByTimeAsync(119);
    expect(written).toEqual(['light']);
    await vi.advanceTimersByTimeAsync(1);
    expect(written).toEqual(['light', 'dark']);
    remove();
  });
});
