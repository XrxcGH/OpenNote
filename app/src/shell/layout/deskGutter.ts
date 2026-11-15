// The desk gutter: at the Wide size class an open page sits on the desk with a strip of window light (day) or evening
// sky on each side. The strips take only width the text column does not need, so the column never narrows. The rule is
// pure: the hook that measures the region and writes the result is useDeskGutter.ts.

import type { SizeClass } from './sizeClass';

/** The reading column at the note size, 72ch of the reading font, as measured in Chromium. */
export const DEFAULT_COLUMN = 667;

/** The smallest gutter worth drawing, in px. Anything less comes out as 0. */
export const MIN_GUTTER = 8;

/** Extra room a growing gutter needs before it applies, so a resize next to a threshold does not flap it. */
export const HYSTERESIS = 4;

export interface GutterInput {
  sizeClass: SizeClass;
  /** The page region's width in CSS px. */
  region: number;
  /** The page viewport's scroll bar width in CSS px. */
  scrollbar: number;
  /** The flow column's width in page units: the page's own content width, or 72ch of the reading font. */
  column: number;
  /** The page zoom as a factor (1 is 100%). */
  zoom: number;
  /** The page is shown in sheets with breaks. */
  paginated: boolean;
  forcedColors: boolean;
  /** Reading order or Contents is open beside the page. */
  pagePaneOpen: boolean;
  /** The dark theme shows the Paper page color. */
  paperInDark: boolean;
}

/**
 * The narrowest viewport content box, in CSS px, in which the flow column is still its full width. It solves
 * min(column, W / zoom - 2m) = column with m = max(32, min(48, 5 percent of W / zoom)) (layout.module.css and
 * viewport.module.css): the margin is 32 up to a 640 unit box, 5 percent of the box up to 960, and 48 beyond.
 */
export function needFor(zoom: number, column: number): number {
  const small = column + 64;
  const middle = column / 0.9;
  const units = small <= 640 ? small : middle <= 960 ? middle : column + 96;
  return Math.ceil(zoom * units);
}

/** The most a gutter can be: 24 up to a 1,120 px region, then 1 px more per 16 px, up to 40. */
export function capFor(region: number): number {
  return Math.min(40, Math.max(24, 24 + Math.floor((region - 1120) / 16)));
}

function gutterFrom(spare: number, region: number): number {
  const gutter = Math.min(Math.floor(spare / 2), capFor(region));
  return gutter < MIN_GUTTER ? 0 : gutter;
}

function sparePx(input: GutterInput): number {
  return input.region - input.scrollbar - needFor(input.zoom, input.column);
}

function allowed(input: GutterInput): boolean {
  return (
    input.sizeClass === 'wide' && !input.paginated && !input.forcedColors && !input.pagePaneOpen && !input.paperInDark
  );
}

/** The gutter on each side of the open page, in whole CSS px. */
export function deskGutter(input: GutterInput): number {
  return allowed(input) ? gutterFrom(sparePx(input), input.region) : 0;
}

/**
 * The gutter to show now, given the one shown. A smaller value applies at once, so the column never narrows. A larger
 * one applies only when the gutter computed with 4 px less room is also above the shown one.
 */
export function nextGutter(shown: number, input: GutterInput): number {
  const gutter = deskGutter(input);
  if (gutter <= shown) return gutter;
  return gutterFrom(sparePx(input) - HYSTERESIS, input.region) > shown ? gutter : shown;
}
