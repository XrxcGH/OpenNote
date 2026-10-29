// Canvas lock (A2-29): the toggle flips the saved choice and says so, and while it is on the page view's camera is
// held, for whichever viewport is shown, until the lock is turned off or the page goes.
import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from '../../../state/store';
import { renderApp } from '../../../test';
import { installCanvasLock, toggleCanvasLock } from './canvasLock';
import type { InkHost, InkViewport } from './host';
import { inkPrefs, setPrefs } from './prefs';

function fakeViewport(holds: string[]): InkViewport {
  return {
    holdCamera: (reason: string) => {
      holds.push(`hold ${reason}`);
      return () => holds.push(`release ${reason}`);
    },
  } as unknown as InkViewport;
}

afterEach(() => setPrefs({ canvasLock: false }));

describe('canvas lock', () => {
  it('toggles the saved choice', async () => {
    await renderApp();
    expect(inkPrefs.get().canvasLock).toBe(false);
    toggleCanvasLock();
    expect(inkPrefs.get().canvasLock).toBe(true);
    toggleCanvasLock();
    expect(inkPrefs.get().canvasLock).toBe(false);
  });

  it('holds the camera while on, moves with the viewport, and lets go when off or removed', async () => {
    await renderApp();
    const holds: string[] = [];
    const viewport = createStore<InkViewport | null>(fakeViewport(holds), 'test viewport');
    const host = { viewport } as unknown as InkHost;
    const stop = installCanvasLock(host);
    expect(holds).toEqual([]);
    toggleCanvasLock();
    expect(holds).toEqual(['hold canvasLock']);
    viewport.set(fakeViewport(holds));
    expect(holds).toEqual(['hold canvasLock', 'release canvasLock', 'hold canvasLock']);
    toggleCanvasLock();
    expect(holds.at(-1)).toBe('release canvasLock');
    toggleCanvasLock();
    stop();
    expect(holds.at(-1)).toBe('release canvasLock');
  });
});
