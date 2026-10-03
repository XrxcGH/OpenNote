// The line focus band: the lines of a page the reader is on stay clear, and the rest dim. This file finds the band from
// the page's measured lines. Drawing it, and the keys that move it, are the view's.

import type { Rect } from '../pagination/geometry';
import type { FocusLines } from './aids';

/** A line's vertical extent in page units. */
export interface LineBox {
  readonly top: number;
  readonly height: number;
}

export interface FocusBand {
  /** The first and last line the band lights, as indexes into the lines. */
  readonly first: number;
  readonly last: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The band for `size` lines around the active one. The band keeps its size at the first and last lines by sliding
 * over them, so the lit lines are never fewer than the setting unless the page has fewer lines.
 */
export function focusBand(lines: readonly LineBox[], active: number, size: FocusLines): FocusBand | null {
  if (size === 0 || lines.length === 0) return null;
  const count = Math.min(size, lines.length);
  const middle = Math.min(Math.max(active, 0), lines.length - 1);
  const first = Math.min(Math.max(middle - Math.floor((count - 1) / 2), 0), lines.length - count);
  const last = first + count - 1;
  return { first, last, top: lines[first].top, bottom: lines[last].top + lines[last].height };
}

/** The line nearest to a y position, for following the pointer or the pen. Lines must be sorted by top. */
export function lineAtY(lines: readonly LineBox[], y: number): number {
  if (lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  // `lo` is the last line that starts at or above y. A y in the gap below it may be nearer the next line.
  const next = lines[lo + 1];
  if (next && y >= lines[lo].top + lines[lo].height && next.top - y < y - (lines[lo].top + lines[lo].height)) {
    return lo + 1;
  }
  return lo;
}

/** Moves the active line by `delta` lines, or by a whole band when `byBand` is set, and keeps it on the page. */
export function moveFocus(count: number, active: number, delta: number, size: FocusLines = 1, byBand = false): number {
  if (count === 0) return -1;
  const step = byBand ? delta * Math.max(size, 1) : delta;
  return Math.min(Math.max(active + step, 0), count - 1);
}

/** The two areas outside the band within `area`: the part above it and the part below, or null when empty. */
export function dimmedAreas(band: FocusBand, area: Rect): readonly [Rect | null, Rect | null] {
  const above = band.top - area.y;
  const below = area.y + area.h - band.bottom;
  return [
    above > 0 ? { x: area.x, y: area.y, w: area.w, h: above } : null,
    below > 0 ? { x: area.x, y: band.bottom, w: area.w, h: below } : null,
  ];
}
