// Headers and footers. Each has a left, center, and right part, written as a template with fields such as {page} and
// {title}. A band sits in the page's top or bottom margin, and is hidden when the margin is too small to hold it.

import { formatNumber } from '../../editor/paragraph/numberFormats';

/** The size and margins (top, right, bottom, left) of a sheet, in page units. */
interface SheetGeometry {
  readonly width: number;
  readonly height: number;
  readonly margins: readonly [number, number, number, number];
}

/** The three parts of a band. */
export interface BandParts {
  readonly left?: string;
  readonly center?: string;
  readonly right?: string;
}

/** A band. `firstPage` is what the first sheet shows instead (R-PRN-1); an empty one hides the band there. */
export interface BandTemplate extends BandParts {
  readonly firstPage?: BandParts;
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

/** The values of a band's fields. `page` is already written in the page number format. */
export type BandValues = BandFields & { readonly page: number | string; readonly pages: number };

const FIELD = /\{(page|pages|title|notebook|section|date)\}/g;

/** Fills in the fields of a template. Text outside fields is kept, and an unknown field stays as written. */
export function fillTemplate(template: string | undefined, fields: BandValues): string {
  return (template ?? '').replace(FIELD, (_all, name: keyof typeof fields) => String(fields[name] ?? ''));
}

export function fillBand(band: BandParts | undefined, fields: BandValues): BandText | null {
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

/** The band a sheet shows: the first sheet's own band when the template has one (R-PRN-1), else the band itself. */
export function bandForSheet(band: BandTemplate | undefined, sheet: number): BandParts | undefined {
  return sheet === 0 && band?.firstPage ? band.firstPage : band;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The longest text of one band part (R-PRN-1). */
export const MAX_BAND_PART = 200;

function readParts(raw: unknown): BandParts | undefined {
  if (!isObject(raw)) return undefined;
  const part = (key: 'left' | 'center' | 'right'): { [k in typeof key]?: string } => {
    const value = raw[key];
    return typeof value === 'string' && value.length <= MAX_BAND_PART ? { [key]: value } : {};
  };
  return { ...part('left'), ...part('center'), ...part('right') };
}

function readBand(raw: unknown): BandTemplate | undefined {
  const parts = readParts(raw);
  if (!parts || !isObject(raw)) return undefined;
  const first = readParts(raw.firstPage);
  return first ? { ...parts, firstPage: first } : parts;
}

/** A page's saved headers and footers (`view.print`, R-PRN-1). A value that is not a band reads as missing. */
export function readSavedBands(view: unknown): { readonly header?: BandTemplate; readonly footer?: BandTemplate } {
  const print = isObject(view) ? view.print : undefined;
  if (!isObject(print)) return {};
  const header = readBand(print.header);
  const footer = readBand(print.footer);
  return { ...(header ? { header } : {}), ...(footer ? { footer } : {}) };
}

export const PAGE_NUMBER_FORMATS = ['decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter'] as const;
export type PageNumberFormat = (typeof PAGE_NUMBER_FORMATS)[number];

/** How page numbers are counted and written (`view.text.pageNumbers`, R-VIEW-3). */
export interface PageNumberSettings {
  readonly format: PageNumberFormat;
  readonly start: number;
}

export const DEFAULT_PAGE_NUMBERS: PageNumberSettings = { format: 'decimal', start: 1 };

const textOf = (view: unknown): Record<string, unknown> | undefined => {
  const text = isObject(view) ? view.text : undefined;
  return isObject(text) ? text : undefined;
};

/** A page's page number settings. A value out of range reads as the default for that key (R-VIEW-4). */
export function readPageNumbers(view: unknown): PageNumberSettings {
  const raw = textOf(view)?.pageNumbers;
  if (!isObject(raw)) return DEFAULT_PAGE_NUMBERS;
  const format = PAGE_NUMBER_FORMATS.find((f) => f === raw.format) ?? DEFAULT_PAGE_NUMBERS.format;
  const start =
    typeof raw.start === 'number' && Number.isInteger(raw.start) && raw.start >= 0 && raw.start <= 32767
      ? raw.start
      : DEFAULT_PAGE_NUMBERS.start;
  return { format, start };
}

/** The text of `{page}` on the sheet at `sheet` (counted from 0): the start number plus the sheets before it. */
export function pageNumberLabel(settings: PageNumberSettings, sheet: number): string {
  return formatNumber(settings.start + sheet, settings.format);
}

/** Line numbers in print (`view.text.lineNumbers`, R-VIEW-2). */
export interface LineNumberSettings {
  readonly start: number;
  readonly countBy: number;
  readonly restart: 'page' | 'continuous';
}

const whole = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;

/** The page's line number settings, or null for no line numbers. An empty object turns them on with the defaults. */
export function readLineNumbers(view: unknown): LineNumberSettings | null {
  const raw = textOf(view)?.lineNumbers;
  if (!isObject(raw)) return null;
  return {
    start: whole(raw.start, 1, 32767, 1),
    countBy: whole(raw.countBy, 1, 100, 1),
    restart: raw.restart === 'continuous' ? 'continuous' : 'page',
  };
}
