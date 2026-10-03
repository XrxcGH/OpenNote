// Pane motion (ARCHITECTURE.md section 11.4, BRAND.md section 9): collapsing slides the pane's content out over
// 250 ms while its column keeps its width, then the column snaps to the rail in one frame; expanding reverses the
// order, so the page settles once and never reflows mid-animation. With reduced motion it is a 100 ms crossfade.
// Any key press or pointer press during the slide jumps it to the end, because animations never block input.

import { osStore } from '../../state/os';
import { tokens } from '../../theme/tokens';

const running = new Map<Element, Animation>();

/** Whether movement should become a short crossfade: Windows, the browser, or the in-app setting asks for it. */
export function prefersReducedMotion(view: Window = window): boolean {
  const media = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  return media || view.document.documentElement.dataset.motion === 'reduce' || !osStore.get().animations;
}

/** Finishes every running pane slide at once. */
export function finishSlides(): void {
  [...running.values()].forEach((animation) => animation.finish());
}

function keyframes(direction: 'out' | 'in', reduce: boolean, rtl: boolean): Keyframe[] {
  const shown = reduce ? { opacity: 1 } : { transform: 'translateX(0)' };
  const hidden = reduce ? { opacity: 0 } : { transform: `translateX(${rtl ? '100%' : '-100%'})` };
  return direction === 'out' ? [shown, hidden] : [hidden, shown];
}

/**
 * Slides an element toward the inline start (out) or back (in). Resolves when the slide ends, is finished early,
 * or can't run. A new slide of the same element finishes the old one first.
 */
export function slide(element: HTMLElement | null, direction: 'out' | 'in'): Promise<void> {
  if (!element || typeof element.animate !== 'function') return Promise.resolve();
  running.get(element)?.finish();
  const reduce = prefersReducedMotion();
  const rtl = getComputedStyle(element).direction === 'rtl';
  const animation = element.animate(keyframes(direction, reduce, rtl), {
    duration: reduce ? tokens.motion.reducedDuration : tokens.motion.duration.gentle,
    easing: tokens.motion.easing.standard,
  });
  running.set(element, animation);
  const jump = () => animation.finish();
  window.addEventListener('keydown', jump, { capture: true, once: true });
  window.addEventListener('pointerdown', jump, { capture: true, once: true });
  const done = () => {
    running.delete(element);
    window.removeEventListener('keydown', jump, { capture: true });
    window.removeEventListener('pointerdown', jump, { capture: true });
  };
  return animation.finished.then(done, done);
}
