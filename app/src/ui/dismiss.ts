// Light dismissal for non-modal overlays (ARCHITECTURE.md section 4.5): a press outside the overlay and its
// control, or focus moving elsewhere, closes it. Presses and focus inside other open overlays in the top layer,
// such as a menu opened from inside a popover, don't count as outside.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

function isOutside(target: EventTarget | null, inside: readonly RefObject<Element | null>[]): boolean {
  if (!(target instanceof Node)) return false;
  if (inside.some((ref) => ref.current?.contains(target))) return false;
  const element = target instanceof Element ? target : target.parentElement;
  const overlay = element?.closest('[popover], dialog[open]');
  // An overlay that holds this one, such as the dialog it opened in, is still outside.
  return !overlay || inside.some((ref) => ref.current && overlay.contains(ref.current));
}

/**
 * Calls onDismiss when a press lands outside every element in `inside`, or focus moves outside them all.
 * `active` turns it off without unmounting.
 */
export function useDismiss(inside: readonly RefObject<Element | null>[], onDismiss: () => void, active = true): void {
  const latest = useRef({ inside, onDismiss });
  useLayoutEffect(() => {
    latest.current = { inside, onDismiss };
  });
  useEffect(() => {
    if (!active) return;
    const check = (event: Event) => {
      if (isOutside(event.target, latest.current.inside)) latest.current.onDismiss();
    };
    document.addEventListener('pointerdown', check, true);
    document.addEventListener('focusin', check, true);
    return () => {
      document.removeEventListener('pointerdown', check, true);
      document.removeEventListener('focusin', check, true);
    };
  }, [active]);
}
