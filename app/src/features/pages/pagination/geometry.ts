// Sheet geometry for paginated pages (DEVELOPMENT.md Phase 6, format spec 5.4). Every value is in page units
// (1/96 inch). Sheet k covers y from k × height to (k + 1) × height, in both infinite and paginated view, so
// switching views never moves a block. Nothing here touches the DOM.

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Top, right, bottom, and left, in page units. */
export type Margins = readonly [top: number, right: number, bottom: number, left: number];

export type PaperSizeName = 'a4' | 'a5' | 'letter' | 'legal' | 'tabloid' | 'custom';
export type Orientation = 'portrait' | 'landscape';

/** A sheet's size and the margins that bound the flowing content. The two sizes are the truth. */
export interface SheetGeometry {
  readonly width: number;
  readonly height: number;
  readonly margins: Margins;
}

/** Portrait sizes from the format spec. */
export const PAPER_SIZES = {
  a4: { width: 793.7, height: 1122.52 },
  a5: { width: 559.37, height: 793.7 },
  letter: { width: 816, height: 1056 },
  legal: { width: 816, height: 1344 },
  tabloid: { width: 1056, height: 1632 },
} as const;

/** Each side's margin for the presets, in page units: 0.75 in, 0.5 in, and 1 in. */
export const MARGIN_PRESETS = {
  normal: [72, 72, 72, 72],
  narrow: [48, 48, 48, 48],
  wide: [96, 96, 96, 96],
} as const satisfies Record<string, Margins>;

/** Half the width of the gap drawn between sheets on screen. Nothing prints in it. */
export const GAP_HALF = 12;
/** The smallest margin the interface writes, so the gap edges always fall inside the margins. */
export const MIN_MARGIN = 24;
/** Measured values carry rounding noise. Differences below this are equal. */
export const EPS = 0.01;

export interface CustomSize {
  readonly width: number;
  readonly height: number;
}

/** The page size in page units, as oriented. A custom or unknown size uses the given fallback dimensions. */
export function paperDimensions(size: PaperSizeName, orientation: Orientation, custom?: CustomSize): CustomSize {
  const base = size === 'custom' ? (custom ?? PAPER_SIZES.letter) : PAPER_SIZES[size];
  return orientation === 'landscape' ? { width: base.height, height: base.width } : { ...base };
}

/** Keeps each margin between MIN_MARGIN and half the paper in that direction. */
export function clampMargins(margins: Margins, width: number, height: number): Margins {
  const [top, right, bottom, left] = margins;
  const side = (value: number, limit: number) => Math.min(Math.max(value, MIN_MARGIN), limit / 2);
  return [side(top, height), side(right, width), side(bottom, height), side(left, width)];
}

export function sheetGeometry(size: CustomSize, margins: Margins = MARGIN_PRESETS.normal): SheetGeometry {
  return { width: size.width, height: size.height, margins: clampMargins(margins, size.width, size.height) };
}

/** The y of the top edge of sheet k. */
export function sheetTop(g: SheetGeometry, k: number): number {
  return k * g.height;
}

/** The y where flowing content starts on sheet k. */
export function contentTop(g: SheetGeometry, k: number): number {
  return k * g.height + g.margins[0];
}

/** The y where flowing content must stop on sheet k. */
export function contentBottom(g: SheetGeometry, k: number): number {
  return (k + 1) * g.height - g.margins[2];
}

/** The content box of sheet k, in page coordinates. */
export function contentBox(g: SheetGeometry, k: number): Rect {
  const [top, right, bottom, left] = g.margins;
  return { x: left, y: k * g.height + top, w: g.width - left - right, h: g.height - top - bottom };
}

/** The sheet that holds y, or 0 above the page. A y exactly on a sheet edge belongs to the lower sheet. */
export function sheetAt(g: SheetGeometry, y: number): number {
  return Math.max(0, Math.floor((y + EPS) / g.height));
}

/**
 * The sheet whose content box ends below y: the first sheet a flowing item starting at y could sit on. It is the
 * next sheet when y falls in a bottom margin, which is where content never goes.
 */
export function flowSheetAt(g: SheetGeometry, y: number): number {
  return Math.max(0, Math.floor((y + g.margins[2] + EPS) / g.height));
}

/** True when y falls in the band of the gap drawn over a sheet edge, where the screen hides content. */
export function inGap(g: SheetGeometry, y: number): boolean {
  const edge = Math.round(y / g.height);
  return edge > 0 && Math.abs(y - edge * g.height) < GAP_HALF;
}

/** Points per page unit: a page unit is 1/96 inch and a point 1/72 inch. */
export const POINTS_PER_UNIT = 72 / 96;

/**
 * The page Chromium writes for a paper size, in points (ADR 0006, rule 2). Letter is exact. A4 comes out 0.32 points
 * narrow in WebView2 154. A probe of the running WebView2 replaces these.
 */
export const CHROMIUM_PAGES_PT = {
  letter: { width: 612, height: 792 },
  a4: { width: 594.96, height: 841.92 },
} as const;

/**
 * The size of a printed sheet box: the smaller of the paper and the page Chromium writes, so print never shrinks the
 * page to fit. The part of the paper past the printed box lies in the margin and is clipped.
 */
export function printSheet(size: CustomSize, pagePt?: CustomSize): CustomSize {
  if (!pagePt) return size;
  return {
    width: Math.min(size.width, pagePt.width / POINTS_PER_UNIT),
    height: Math.min(size.height, pagePt.height / POINTS_PER_UNIT),
  };
}
