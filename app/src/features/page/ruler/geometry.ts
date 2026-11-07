// The ruler's arithmetic, apart from the DOM (text DESIGN.md 5.4). A drag is measured in client pixels.
// The same drag means fewer points when the page is zoomed in: points = pixels x 0.75 / zoom.
import type { Indent, TabAlign, TabStop } from '../../../editor/paragraph/attributes';
import { MAX_TAB_STOPS } from '../../../editor/paragraph/attributes';
import { roundPoints } from './units';

/** A drag shorter than this many pixels is a tap and moves nothing. */
export const DRAG_THRESHOLD_PX = 4;
/** The marker's target size for pen and touch. */
export const HIT_PX = 44;
/** A dragged tab stop released farther than this many pixels above or below the ruler is removed. */
export const REMOVE_DISTANCE_PX = 24;
export const MAX_POINTS = 1584;

export type MarkerKind = 'first' | 'hanging' | 'left' | 'right' | 'tab';

/** Points for a pixel distance in the client, at the page's zoom (1 is 100 percent). */
export function pixelsToPoints(pixels: number, zoom: number): number {
  return (pixels * 0.75) / (zoom > 0 ? zoom : 1);
}

export function pointsToPixels(points: number, zoom: number): number {
  return (points * (zoom > 0 ? zoom : 1)) / 0.75;
}

/** The value after a drag of `dx` pixels from `start` points, on the snap grid unless `free` (Alt). */
export function dragValue(start: number, dx: number, zoom: number, grid: number, free: boolean): number {
  const raw = start + pixelsToPoints(dx, zoom);
  return roundPoints(free ? raw : Math.round(raw / grid) * grid);
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The first-line marker's position from the left edge of the content box. */
export const firstLineAt = (indent: Indent): number => indent.start + indent.first;

/** The least width of the text column between the right marker and the others: 1/16 inch. */
export const MIN_COLUMN = 4.5;

export interface Limits {
  min: number;
  max: number;
}

/**
 * Where a marker may go, in points from the left edge. No marker passes another, so the text column keeps at least
 * MIN_COLUMN. A negative indent is valid down to -MAX_POINTS. A tab stop stays inside the box.
 */
export function markerLimits(kind: MarkerKind, indent: Indent, width: number): Limits {
  if (kind === 'tab') return { min: 0, max: Math.max(0, width) };
  if (kind === 'right') {
    const min = Math.max(firstLineAt(indent), indent.start, width - MAX_POINTS) + MIN_COLUMN;
    return { min, max: Math.max(min, width, width - indent.end) };
  }
  const room = width - indent.end - MIN_COLUMN;
  const max = kind === 'left' ? room - Math.max(0, indent.first) : room;
  return { min: -MAX_POINTS, max: Math.max(-MAX_POINTS, max) };
}

/**
 * The indent after a marker moves to `position` points from the left edge (from the right edge for `right`), kept
 * inside `markerLimits`. The first-line marker changes only `first`. The hanging marker moves the left indent and
 * keeps the first line where it is. The left marker moves both, as Word's three marker parts do.
 */
export function movedIndent(kind: MarkerKind, indent: Indent, position: number, width: number): Indent {
  const lim = markerLimits(kind, indent, width);
  if (kind === 'right')
    return { ...indent, end: roundPoints(width - clamp(roundPoints(width - position), lim.min, lim.max)) };
  const at = clamp(roundPoints(position), lim.min, lim.max);
  const first = (value: number) => clamp(roundPoints(value), -MAX_POINTS, MAX_POINTS);
  if (kind === 'first') return { ...indent, first: first(at - indent.start) };
  if (kind === 'hanging') return { ...indent, start: at, first: first(firstLineAt(indent) - at) };
  return { ...indent, start: at };
}

/** A marker's position as `movedIndent` reads it: points from the left edge, or from the right edge for `right`. */
export function markerPosition(kind: MarkerKind, indent: Indent): number {
  if (kind === 'first') return firstLineAt(indent);
  if (kind === 'right') return indent.end;
  return indent.start;
}

/** A tab stop at `pos`, replacing one that is already there. At most 64 stops; the list stays sorted. */
export function withTab(stops: readonly TabStop[], stop: TabStop): TabStop[] | null {
  const pos = roundPoints(clamp(stop.pos, 0, MAX_POINTS));
  const rest = stops.filter((s) => s.pos !== pos);
  if (rest.length >= MAX_TAB_STOPS) return null;
  return [...rest, { ...stop, pos }].sort((a, b) => a.pos - b.pos);
}

/** A stop moves: the one at `from` goes to `to`, keeping its type and leader. */
export function movedTab(stops: readonly TabStop[], from: number, to: number): TabStop[] {
  const old = stops.find((s) => s.pos === from);
  if (!old) return [...stops];
  return withTab(
    stops.filter((s) => s !== old),
    { ...old, pos: to },
  ) as TabStop[];
}

export function withoutTab(stops: readonly TabStop[], pos: number): TabStop[] {
  return stops.filter((s) => s.pos !== pos);
}

/** The tab stops as the document stores them: none is null. */
export function storedTabs(stops: readonly TabStop[]): TabStop[] | null {
  return stops.length === 0 ? null : [...stops];
}

/** The types the selector cycles through; the last two set the indents instead of a tab stop. */
export const TAB_TYPES = ['start', 'center', 'end', 'decimal', 'bar', 'first', 'hanging'] as const;
export type TabType = (typeof TAB_TYPES)[number];

export function isTabAlign(type: TabType): type is Extract<TabType, TabAlign> {
  return type !== 'first' && type !== 'hanging';
}

/** Whether a pointer at `offset` pixels above or below the ruler's band has left it. */
export function offRuler(offset: number): boolean {
  return Math.abs(offset) > REMOVE_DISTANCE_PX;
}
