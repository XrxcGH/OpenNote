// Title bar overflow by priority (ARCHITECTURE.md section 10.2). When the items don't fit, the bar overflows, and
// it steps to the next level: first the app name hides, then the breadcrumb shortens from the start, then items
// become icon-only, then items move into a More button, lowest priority first. Each step remembers the width it
// needed, so the bar steps back only when that width returns and never flickers between two levels.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface Fit {
  /** Changes when the bar's content changes, which starts fitting again from the lowest level. */
  key: string;
  level: number;
  /** The bar width each level needed: the level is kept while the bar is at least that wide. */
  needs: readonly number[];
}

export interface FitRange {
  min: number;
  max: number;
}

/** The level for a measurement: one up while the bar overflows, one down once the lower level fits again. */
export function nextFit(fit: Fit, measured: { width: number; overflow: number }, range: FitRange): Fit {
  const { level, needs } = fit;
  if (level < range.min) return { ...fit, level: range.min };
  if (level > range.max) return { ...fit, level: range.max };
  const overflows = measured.overflow > 0.5;
  if (overflows && level < range.max) {
    const next = [...needs];
    next[level] = measured.width + measured.overflow;
    return { ...fit, level: level + 1, needs: next };
  }
  const below = needs[level - 1];
  if (!overflows && level > range.min && below !== undefined && measured.width >= below) {
    return { ...fit, level: level - 1 };
  }
  return fit;
}

/**
 * How far the bar's children reach past its inline end, in pixels. It measures the children themselves, because
 * scrollWidth also counts the touch hit areas that buttons draw a few pixels outside their box.
 */
export function overflowOf(bar: HTMLElement): number {
  const box = bar.getBoundingClientRect();
  const rtl = getComputedStyle(bar).direction === 'rtl';
  const reach = Array.from(bar.children, (child) => {
    const rect = child.getBoundingClientRect();
    return rtl ? box.left - rect.left : rect.right - box.right;
  });
  return Math.max(0, ...reach);
}

/**
 * The overflow level of a bar. It measures when the bar or a watched group inside it changes size, and again
 * after each level change, so fitting settles before the bar paints.
 */
export function useFit(
  bar: RefObject<HTMLElement | null>,
  watched: RefObject<readonly (HTMLElement | null)[]>,
  range: FitRange & { key: string },
): number {
  const [fit, setFit] = useState<Fit>({ key: range.key, level: range.min, needs: [] });
  // The content changed: start again from the lowest level (React's pattern for state derived from props).
  if (fit.key !== range.key) setFit({ key: range.key, level: range.min, needs: [] });
  const measure = useRef(() => {});
  const { min, max } = range;
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    measure.current = () => {
      const measured = { width: element.clientWidth, overflow: overflowOf(element) };
      setFit((current) => nextFit(current, measured, { min, max }));
    };
    const observer = new ResizeObserver(() => measure.current());
    [element, ...(watched.current ?? [])].forEach((target) => target && observer.observe(target));
    return () => observer.disconnect();
  }, [bar, watched, min, max, fit.key]);
  // A level change can shrink the overflow without resizing anything observed, so measure after each one.
  useLayoutEffect(() => measure.current(), [fit.level, fit.key]);
  return Math.min(Math.max(fit.level, min), max);
}
