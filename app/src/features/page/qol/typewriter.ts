// Typewriter scrolling (FEATURES.md, Typewriter scrolling): while the person types, the line with the caret stays
// at one height, centered by default, and the page moves under it. It is off by default. With reduced motion on,
// the page jumps instead of gliding. Pointer selections and scrolling by hand are left alone: only typing and
// keys move the page.
import { osStore } from '../../../state/os';
import type { MountedPage } from '../mount';
import { pageExtrasPrefs } from './prefs';

/** How far the page must move (in px, down is positive) to put a caret at `caretY` at `at` percent of the view. */
export function typewriterDelta(caretY: number, view: { top: number; height: number }, at: number): number {
  return caretY - (view.top + (view.height * at) / 100);
}

/** Moves smaller than this are not worth a scroll. */
const SLACK = 2;
const NAVIGATION = new Set(['PageUp', 'PageDown', 'Home', 'End']);

export function attachTypewriter(mounted: MountedPage): () => void {
  if (!mounted.host.flag('page.typewriter') || mounted.page.readOnly) return () => undefined;
  const scroller = mounted.viewport.viewport;
  let frame = 0;
  let typing = false;

  const run = () => {
    frame = 0;
    const prefs = pageExtrasPrefs.get();
    if (!prefs.typewriter || !typing) return;
    typing = false;
    const active = mounted.pool.active();
    if (!active) return;
    const { view } = active.editor;
    const { selection } = view.state;
    if (!selection.empty) return;
    let caret: { top: number; bottom: number };
    try {
      caret = view.coordsAtPos(selection.head);
    } catch {
      return;
    }
    const box = scroller.getBoundingClientRect();
    const delta = typewriterDelta(
      (caret.top + caret.bottom) / 2,
      { top: box.top, height: box.height },
      prefs.typewriterAt,
    );
    if (Math.abs(delta) < SLACK) return;
    const glide = osStore.get().animations;
    if (typeof scroller.scrollBy === 'function')
      scroller.scrollBy({ top: delta, behavior: glide ? 'smooth' : 'instant' });
  };

  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(run);
  };
  const onInput = () => {
    typing = true;
    schedule();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.startsWith('Arrow') || NAVIGATION.has(event.key)) {
      typing = true;
      schedule();
    }
  };
  scroller.addEventListener('input', onInput, true);
  scroller.addEventListener('keyup', onKey, true);
  return () => {
    scroller.removeEventListener('input', onInput, true);
    scroller.removeEventListener('keyup', onKey, true);
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}
