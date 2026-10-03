// The print plan: which sheets print, how big each printed sheet box is, and what its header and footer say. It
// follows ADR 0006: the sheet box is never larger than the page Chromium writes for the paper size, so printing
// never shrinks the page to fit, and nothing about the box depends on the screen.

import {
  CHROMIUM_PAGES_PT,
  MAX_SHEETS,
  POINTS_PER_UNIT,
  printSheet,
  type CustomSize,
  type SheetGeometry,
} from '../pagination/geometry';
import { bandBox, fillBand, type BandBox, type BandFields, type BandTemplate, type BandText } from './headerFooter';
import { parsePageRange, type Parity, type RangeError } from './range';

export interface PrintOptions {
  /** A page range such as `1-3, 5`. Empty prints every sheet. */
  readonly range?: string;
  readonly parity?: Parity;
  /** Prints the paper pattern and tints. Default true. */
  readonly background?: boolean;
  /** Prints handwriting. Default true. */
  readonly ink?: boolean;
  readonly header?: BandTemplate;
  readonly footer?: BandTemplate;
  /** `sheet` numbers a printed sheet by its place on the page. `printed` counts from 1 through the sheets chosen. */
  readonly numbering?: 'sheet' | 'printed';
  /** The page Chromium writes for this paper size, in points, if the host measured it. */
  readonly pagePt?: CustomSize;
  readonly fields?: BandFields;
}

export interface PrintSheet {
  /** The sheet's place on the page, from 0. */
  readonly index: number;
  /** The number the header and footer show. */
  readonly number: number;
  readonly header: BandText | null;
  readonly footer: BandText | null;
}

export type PrintWarning =
  | { readonly kind: 'range'; readonly error: RangeError }
  | { readonly kind: 'marginTooSmall'; readonly band: 'header' | 'footer' }
  /** The page needs more than `limit` sheets. Only the first `limit` print. */
  | { readonly kind: 'tooManySheets'; readonly limit: number };

export interface PrintPlan {
  /** The paper in page units. */
  readonly paper: CustomSize;
  /** The printed sheet box in CSS pixels: the paper, or less where Chromium's page is smaller (ADR 0006, rule 2). */
  readonly box: CustomSize;
  /** The sheets on the page, including those that do not print. */
  readonly total: number;
  readonly sheets: readonly PrintSheet[];
  readonly header: BandBox | null;
  readonly footer: BandBox | null;
  readonly background: boolean;
  readonly ink: boolean;
  readonly warnings: readonly PrintWarning[];
}

/** A paper counts as a measured size when both sides are within this many page units of Chromium's page. */
const MATCH = 1;

/** The page Chromium writes for a paper, in points, or undefined for a size the app has not measured. */
export function chromiumPageFor(paper: CustomSize): CustomSize | undefined {
  const sideways = paper.width > paper.height;
  for (const page of Object.values(CHROMIUM_PAGES_PT)) {
    const w = (sideways ? page.height : page.width) / POINTS_PER_UNIT;
    const h = (sideways ? page.width : page.height) / POINTS_PER_UNIT;
    if (Math.abs(paper.width - w) <= MATCH && Math.abs(paper.height - h) <= MATCH) {
      return sideways ? { width: page.height, height: page.width } : page;
    }
  }
  return undefined;
}

export function planPrint(g: SheetGeometry, sheetsNeeded: number, options: PrintOptions = {}): PrintPlan {
  const paper = { width: g.width, height: g.height };
  const box = printSheet(paper, options.pagePt ?? chromiumPageFor(paper));
  const warnings: PrintWarning[] = [];
  const totalSheets = Math.min(sheetsNeeded, MAX_SHEETS);
  if (sheetsNeeded > MAX_SHEETS) warnings.push({ kind: 'tooManySheets', limit: MAX_SHEETS });
  const parsed = parsePageRange(options.range ?? '', totalSheets, options.parity);
  const picked =
    parsed.error === 'syntax' || parsed.error === 'empty'
      ? parsePageRange('', totalSheets, 'all').sheets
      : parsed.sheets;
  if (parsed.error) warnings.push({ kind: 'range', error: parsed.error });
  const header = options.header ? bandBox(g, 'header') : null;
  const footer = options.footer ? bandBox(g, 'footer') : null;
  if (options.header && !header) warnings.push({ kind: 'marginTooSmall', band: 'header' });
  if (options.footer && !footer) warnings.push({ kind: 'marginTooSmall', band: 'footer' });
  const sheets = picked.map((index, ordinal): PrintSheet => {
    const fields = {
      ...options.fields,
      page: options.numbering === 'printed' ? ordinal + 1 : index + 1,
      pages: options.numbering === 'printed' ? picked.length : totalSheets,
    };
    return {
      index,
      number: fields.page,
      header: header ? fillBand(options.header, fields) : null,
      footer: footer ? fillBand(options.footer, fields) : null,
    };
  });
  return {
    paper,
    box,
    total: totalSheets,
    sheets,
    header,
    footer,
    background: options.background !== false,
    ink: options.ink !== false,
    warnings,
  };
}
