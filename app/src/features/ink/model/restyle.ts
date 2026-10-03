// Changing how finished strokes look (architecture 8.6): recolor and width. The raw points never change. A pen color
// changes pen, pencil, marker, and brush strokes, and a highlighter color changes highlighter strokes, so a mixed
// selection can take either menu.

import { widthScale } from '../geometry/matrix';
import { paletteEntry } from '../pens/palette';
import type { PaletteKind, Rgba } from '../pens/palette';
import { MAX_WIDTH_MM, MIN_WIDTH_MM, mmToPage } from '../pens/tools';
import type { InkStroke } from './types';

export const THICKER = 1.25;
export const THINNER = 0.8;

export interface PickedColor {
  /** A palette slot, or 0 for a custom color. */
  readonly slot: number;
  /** The light-theme color to store. */
  readonly color: Rgba;
}

/** The kind of tool a color is for. A palette slot knows its kind. A custom color needs the caller to say. */
export function kindOfStroke(stroke: InkStroke): PaletteKind {
  return stroke.tool === 'highlighter' ? 'highlighter' : 'pen';
}

/** Recolors the strokes the color is meant for, and returns every stroke in order, the others unchanged. */
export function recolor(strokes: readonly InkStroke[], picked: PickedColor, kind?: PaletteKind): InkStroke[] {
  const target = kind ?? paletteEntry(picked.slot)?.kind ?? 'pen';
  return strokes.map((stroke) =>
    kindOfStroke(stroke) === target ? { ...stroke, slot: picked.slot, color: picked.color } : stroke,
  );
}

/** The stroke's nominal width after a scale, kept so that its drawn width stays between 0.1 and 24 mm. */
export function scaledWidth(stroke: InkStroke, factor: number): number {
  const drawn = stroke.transform ? widthScale(stroke.transform) : 1;
  const low = mmToPage(MIN_WIDTH_MM) / drawn;
  const high = mmToPage(MAX_WIDTH_MM) / drawn;
  return Math.min(high, Math.max(low, stroke.width * factor));
}

/** Scales the nominal widths of strokes by a factor, such as 1.25 for "Thicker" and 0.8 for "Thinner". */
export function scaleWidths(strokes: readonly InkStroke[], factor: number): InkStroke[] {
  return strokes.map((stroke) => ({ ...stroke, width: scaledWidth(stroke, factor) }));
}

/** Sets the drawn width of every stroke, in page units, for the width picker. A resized stroke keeps its scale. */
export function setDrawnWidth(strokes: readonly InkStroke[], drawn: number): InkStroke[] {
  return strokes.map((stroke) => {
    const scale = stroke.transform ? widthScale(stroke.transform) : 1;
    return { ...stroke, width: scaledWidth({ ...stroke, width: drawn / scale }, 1) };
  });
}
