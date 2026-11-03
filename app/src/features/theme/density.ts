// Density (ARCHITECTURE.md section 9.8): the size of buttons and rows. "Automatic" starts from the primary pointer,
// then follows the last pointer used. A touch pointerup switches to touch sizes. A pen does not, because the first
// stroke would resize the ribbon and move the page under the pen. A mouse pointerup switches back.
// It switches after the pointerup and its click, never in the middle of a gesture. Switching before the click moved
// the rows, so a first tap opened the item that slid under the finger (full walk A-A02-4).
// "Standard" and "Large" stay as chosen.
// A switch keeps the focused row where it was, so a magnifier user doesn't lose the spot.

import { setDensity } from '../../state/layout';
import type { Density } from '../../state/layout';
import { getSettings, settingsStore } from '../../state/settings';

/** A touch this wide (CSS px) is a palm; ink/view/touch.ts uses the same width. */
const PALM_PX = 28;

/** How long a switch waits for the click a pointerup makes, when none comes (a drag, a scroll). */
const CLICK_WAIT_MS = 400;

/** Touch uses touch sizes. A pen is precise and leaves the sizes as they are. */
function densityOf(pointerType: string): Density | null {
  if (pointerType === 'touch') return 'touch';
  return pointerType === 'mouse' ? 'mouse' : null;
}

/** The nearest ancestor that scrolls vertically. */
function scrollParent(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Runs the change, then scrolls so the focused element sits at the same distance from its container's top. */
function keepFocusInPlace(doc: Document, change: () => void): void {
  const focused = doc.activeElement;
  const container = focused && focused !== doc.body ? scrollParent(focused) : null;
  if (!focused || !container) return change();
  const offset = () => focused.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const before = offset();
  change();
  requestAnimationFrame(() => {
    if (focused.isConnected) container.scrollTop += offset() - before;
  });
}

/** Follows the density setting and, in Automatic, the last pointer. Returns a function that stops it. */
export function installDensity(view: Window = window): () => void {
  const primary = (): Density => (view.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse');
  let automatic = primary();
  const wanted = (): Density => {
    const { density } = getSettings().appearance;
    return density === 'auto' ? automatic : density;
  };
  let applied = wanted();
  // Only a real change acts, so a density that a test or another feature set by hand stays until the next one.
  const apply = () => {
    const next = wanted();
    if (next === applied) return;
    applied = next;
    keepFocusInPlace(view.document, () => setDensity(next));
  };
  const onPointerUp = (event: PointerEvent) => {
    // A palm lifting while the pen writes is not a finger: it must not resize the ribbon mid-stroke.
    if (event.pointerType === 'touch' && Math.max(event.width, event.height) >= PALM_PX) return;
    const seen = densityOf(event.pointerType);
    if (!seen || seen === automatic) return;
    automatic = seen;
    afterClick();
  };
  let waiting: (() => void) | null = null;
  /** Applies the change once the click this pointerup makes has reached its handlers, or after a short wait. */
  const afterClick = () => {
    waiting?.();
    const run = () => {
      waiting?.();
      apply();
    };
    const onClick = () => void view.setTimeout(run, 0);
    const timer = view.setTimeout(run, CLICK_WAIT_MS);
    view.addEventListener('click', onClick, { once: true });
    waiting = () => {
      waiting = null;
      view.clearTimeout(timer);
      view.removeEventListener('click', onClick);
    };
  };
  setDensity(applied);
  view.addEventListener('pointerup', onPointerUp, true);
  const stop = settingsStore.subscribe(apply);
  return () => {
    view.removeEventListener('pointerup', onPointerUp, true);
    waiting?.();
    stop();
  };
}
