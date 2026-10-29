// Canvas lock: the page stops scrolling, zooming, and panning by touch, pen, or wheel, so writing never moves it.
// The pen still draws. It holds the page view's camera, the way a pen stroke does, for as long as the lock is on.
// Reading mode is a different thing: it stops edits, and this stops nothing but the camera.
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { InkHost, InkViewport } from './host';
import { inkPrefs, setPrefs } from './prefs';

export function toggleCanvasLock(): void {
  const next = !inkPrefs.get().canvasLock;
  setPrefs({ canvasLock: next });
  announce(t(next ? 'ink.canvasLock.on' : 'ink.canvasLock.off'));
}

export function installCanvasLock(host: InkHost): () => void {
  let release: (() => void) | null = null;
  let held: InkViewport | null = null;
  const sync = () => {
    const viewport = host.viewport.get();
    const want = isEnabled('ink.canvasLock') && inkPrefs.get().canvasLock && viewport !== null;
    if (release && (!want || held !== viewport)) {
      release();
      release = null;
      held = null;
    }
    if (want && !release && viewport) {
      release = viewport.holdCamera('canvasLock');
      held = viewport;
    }
  };
  const stops = [host.viewport.subscribe(sync), inkPrefs.subscribe(sync)];
  sync();
  return () => {
    stops.forEach((stop) => stop());
    release?.();
  };
}
