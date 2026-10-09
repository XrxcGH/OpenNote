// Density (ARCHITECTURE.md section 9.8): the size of buttons and rows. "Automatic" starts from the primary pointer,
// then follows the last pointer used: a touch pointerup switches to touch sizes (a pen does not: the first stroke would resize the ribbon and
// move the page under the pen), a mouse pointerup switches back. It switches on pointerup only, never in the middle of a gesture. "Standard" and "Large" stay as chosen.
// A switch keeps the focused row where it was, so a magnifier user doesn't lose the spot.

import { setDensity } from '../../state/layout';
import type { Density } from '../../state/layout';
import { getSettings, settingsStore } from '../../state/settings';

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
    const seen = densityOf(event.pointerType);
    if (!seen || seen === automatic) return;
    automatic = seen;
    apply();
  };
  setDensity(applied);
  view.addEventListener('pointerup', onPointerUp, true);
  const stop = settingsStore.subscribe(apply);
  return () => {
    view.removeEventListener('pointerup', onPointerUp, true);
    stop();
  };
}
