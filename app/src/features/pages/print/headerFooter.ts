// Headers and footers. Each has a left, center, and right part, written as a template with fields such as {page} and
// {title}. A band sits in the page's top or bottom margin, and is hidden when the margin is too small to hold it.

import type { SheetGeometry } from '../pagination/geometry';

export interface BandTemplate {
  readonly left?: string;
  readonly center?: string;
  readonly right?: string;
}

/** What a template can show. Fields without a value stay empty. */
export interface BandFields {
  readonly title?: string;
  readonly notebook?: string;
  readonly section?: string;
  /** A date already formatted for the person's language. */
  readonly date?: string;
}

export interface BandText {
  readonly left: string;
  readonly center: string;
  readonly right: string;
}

/** The size of band text in page units. */
export const BAND_FONT_SIZE = 11;
/** A band's box is this tall. */
export const BAND_HEIGHT = 16;
/** A band stays at least this far from the paper's edge, which printers may not reach. */
export const MIN_EDGE = 12;

const FIELD = /\{(page|pages|title|notebook|section|date)\}/g;

/** Fills in the fields of a template. Text outside fields is kept, and an unknown field stays as written. */
export function fillTemplate(
  template: string | undefined,
  fields: BandFields & { readonly page: number; readonly pages: number },
): string {
  return (template ?? '').replace(FIELD, (_all, name: keyof typeof fields) => String(fields[name] ?? ''));
}

export function fillBand(
  band: BandTemplate | undefined,
  fields: BandFields & { readonly page: number; readonly pages: number },
): BandText | null {
  if (!band) return null;
  const text = {
    left: fillTemplate(band.left, fields),
    center: fillTemplate(band.center, fields),
    right: fillTemplate(band.right, fields),
  };
  return text.left === '' && text.center === '' && text.right === '' ? null : text;
}

export interface BandBox {
  /** The box in sheet coordinates. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Where a band goes: in the middle of the top or bottom margin, from the left margin to the right margin. Null when the
 * margin is too small to hold it, which the sheet plan reports as a warning.
 */
export function bandBox(g: SheetGeometry, where: 'header' | 'footer'): BandBox | null {
  const [top, right, bottom, left] = g.margins;
  const margin = where === 'header' ? top : bottom;
  if (margin < BAND_HEIGHT + 2 * MIN_EDGE) return null;
  const y = where === 'header' ? (top - BAND_HEIGHT) / 2 : g.height - bottom + (bottom - BAND_HEIGHT) / 2;
  return { x: left, y, w: g.width - left - right, h: BAND_HEIGHT };
}
