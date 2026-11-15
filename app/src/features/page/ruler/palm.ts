// Palm rejection for the ruler (ADR 0027 applies to it too). The ruler is DOM, outside the ink surface.
// The palm classifier watches that surface, so the ruler applies the same two rules by itself.
// A large touch contact is a palm. A touch while the pen is near is a resting hand.
import { useEffect } from 'react';

/** A touch within this long of the pen being seen is a resting hand. */
const PEN_NEAR_MS = 1500;
/** A fingertip is about 10 mm across; a contact wider than this many CSS pixels is a palm or a fist. */
const PALM_SIZE_PX = 70;
let penSeenAt = -Infinity;

/** Whether a press is a palm: a large touch contact, or a touch while the pen is near. */
export function isPalm(event: { pointerType: string; width?: number; height?: number }): boolean {
  if (event.pointerType !== 'touch') return false;
  if (Math.max(event.width ?? 0, event.height ?? 0) > PALM_SIZE_PX) return true;
  return performance.now() - penSeenAt < PEN_NEAR_MS;
}

/** Watches for the pen, hovering or touching, anywhere in the window. */
export function useWatchPen(): void {
  useEffect(() => {
    const seen = (event: globalThis.PointerEvent) => {
      if (event.pointerType === 'pen') penSeenAt = performance.now();
    };
    document.addEventListener('pointermove', seen, true);
    document.addEventListener('pointerdown', seen, true);
    return () => {
      document.removeEventListener('pointermove', seen, true);
      document.removeEventListener('pointerdown', seen, true);
    };
  }, []);
}
