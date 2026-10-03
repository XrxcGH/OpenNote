// Windowing for long trees (ARCHITECTURE.md section 13.2). Up to 300 rows render in full, so NVDA's browse mode
// sees an ordinary list. Past that, only the rows in view render, with 20 rows of overscan, because rows have
// fixed heights. The focused, selected, and renaming rows always render, so focus is never lost to windowing.

import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

export const WINDOW_THRESHOLD = 300;
export const OVERSCAN = 20;

export interface Viewport {
  readonly scrollTop: number;
  readonly height: number;
}

/** The first row and one past the last row in view, with overscan on both sides. */
export function visibleRange(count: number, rowHeight: number, viewport: Viewport, overscan = OVERSCAN) {
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, viewport.scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, viewport.scrollTop) + Math.max(0, viewport.height)) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/**
 * The indexes to render, in order: every row when there are few, otherwise the rows in view plus the pinned ones
 * (focused, selected, renaming) wherever they are.
 */
export function renderedIndexes(
  count: number,
  rowHeight: number,
  viewport: Viewport,
  pinned: readonly number[],
): readonly number[] {
  if (count <= WINDOW_THRESHOLD) return Array.from({ length: count }, (_, i) => i);
  const { start, end } = visibleRange(count, rowHeight, viewport);
  const set = new Set<number>();
  for (let i = start; i < end; i += 1) set.add(i);
  for (const index of pinned) if (index >= 0 && index < count) set.add(index);
  return [...set].sort((a, b) => a - b);
}

/** Follows a scroll container's position and height. Before the first measure it assumes one screen of rows. */
export function useViewport(ref: RefObject<HTMLElement | null>, active: boolean): Viewport {
  const [viewport, setViewport] = useState<Viewport>({ scrollTop: 0, height: 800 });
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    setViewport((current) =>
      current.scrollTop === element.scrollTop && current.height === element.clientHeight
        ? current
        : { scrollTop: element.scrollTop, height: element.clientHeight },
    );
  }, [ref]);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [ref, active, measure]);
  return viewport;
}
