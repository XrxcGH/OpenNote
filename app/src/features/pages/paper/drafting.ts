// Engineering paper: computation paper, a three-view layout with projection lines, and a title block. Like the other
// built-in templates these are data, not code, and applying one copies it into the page. The label text comes from the
// caller's strings. The sheet sizes are the drafting standards' (ANSI A and B, ISO A4 and A3).

import type { AreaSize } from './templates';
import type { PaperTemplate, TemplateElement, Weight } from './types';

/** Fixed IDs for the drafting templates. */
export const DRAFTING_IDS = {
  computation: 'builtin-computation-paper',
  threeView: 'builtin-three-view',
  titleBlock: 'builtin-title-block',
} as const;

export type DraftingKey = keyof typeof DRAFTING_IDS;

/** Page units (1/96 inch) in one millimetre and one inch. */
export const UNITS_PER_MM = 96 / 25.4;
export const UNITS_PER_INCH = 96;

export interface Sheet {
  readonly id: 'ansiA' | 'ansiB' | 'a4' | 'a3';
  /** Portrait width and height in millimetres, exactly as the standards state them. */
  readonly widthMm: number;
  readonly heightMm: number;
}

/** ANSI A is 8.5 x 11 in and ANSI B is 11 x 17 in; ISO A4 is 210 x 297 mm and A3 is 297 x 420 mm. */
export const SHEETS: readonly Sheet[] = [
  { id: 'ansiA', widthMm: 215.9, heightMm: 279.4 },
  { id: 'ansiB', widthMm: 279.4, heightMm: 431.8 },
  { id: 'a4', widthMm: 210, heightMm: 297 },
  { id: 'a3', widthMm: 297, heightMm: 420 },
];

/** A sheet's portrait size in page units. */
export function sheetUnits(sheet: Sheet): { width: number; height: number } {
  return { width: sheet.widthMm * UNITS_PER_MM, height: sheet.heightMm * UNITS_PER_MM };
}

/** Computation paper: 5 squares to the inch, with a heavier line every inch. */
export const COMPUTATION = { squaresPerInch: 5, spacing: UNITS_PER_INCH / 5 } as const;

export interface TitleBlockText {
  readonly title: string;
  readonly drawnBy: string;
  readonly date: string;
  readonly scale: string;
  readonly sheet: string;
  readonly material: string;
  /** The tolerance note's caption, such as "Tolerances unless otherwise specified". */
  readonly tolerance: string;
}

export interface ThreeViewText extends TitleBlockText {
  readonly front: string;
  readonly top: string;
  readonly right: string;
}

const line = (x1: number, y1: number, x2: number, y2: number, weight: Weight = 'rule'): TemplateElement => ({
  kind: 'line',
  x1,
  y1,
  x2,
  y2,
  weight,
});

const rect = (x: number, y: number, w: number, h: number, weight: Weight = 'rule'): TemplateElement => ({
  kind: 'rect',
  x,
  y,
  w,
  h,
  weight,
  fill: 'none',
});

const label = (x: number, y: number, text: string): TemplateElement => ({ kind: 'label', x, y, text, size: 'caption' });

/** The title block's fields in the order they are laid out; the tests and the tool read them from here. */
export const TITLE_FIELDS = ['title', 'drawnBy', 'date', 'scale', 'sheet', 'material', 'tolerance'] as const;

/**
 * The block hugs the bottom-right corner: at most 6 in wide and 1.6 in tall, and never more than 70 percent of the
 * width or 22 percent of the height. Returns the elements.
 */
export function titleBlockElements(text: TitleBlockText, area: AreaSize): TemplateElement[] {
  const width = Math.min(6 * UNITS_PER_INCH, area.width * 0.7);
  const height = Math.min(1.6 * UNITS_PER_INCH, area.height * 0.22);
  const w = width / area.width;
  const h = height / area.height;
  const x = 1 - w;
  const y = 1 - h;
  const at = (fx: number, fy: number) => ({ x: x + fx * w, y: y + fy * h });
  const cap = (fx: number, fy: number, t: string) => {
    const p = at(fx + 0.012, fy);
    return label(p.x, p.y, t);
  };
  const seg = (fx1: number, fy1: number, fx2: number, fy2: number, weight: Weight = 'rule') => {
    const a = at(fx1, fy1);
    const b = at(fx2, fy2);
    return line(a.x, a.y, b.x, b.y, weight);
  };
  // Rows: the title takes the top 40 percent, then drawn by, date, scale and sheet, then material and the note.
  return [
    rect(x, y, w, h, 'strong'),
    seg(0, 0.4, 1, 0.4),
    seg(0, 0.7, 1, 0.7),
    seg(0.35, 0.4, 0.35, 0.7),
    seg(0.6, 0.4, 0.6, 0.7),
    seg(0.8, 0.4, 0.8, 0.7),
    seg(0.4, 0.7, 0.4, 1),
    cap(0, 0.12, text.title),
    cap(0, 0.52, text.drawnBy),
    cap(0.35, 0.52, text.date),
    cap(0.6, 0.52, text.scale),
    cap(0.8, 0.52, text.sheet),
    cap(0, 0.82, text.material),
    cap(0.4, 0.82, text.tolerance),
  ];
}

/** A title block alone on the sheet. */
export function titleBlock(name: string, text: TitleBlockText, area: AreaSize): PaperTemplate {
  return { id: DRAFTING_IDS.titleBlock, title: name, area: 'content', elements: titleBlockElements(text, area) };
}

/** A 5-per-inch grid with a heavier line every inch, over the whole content box. */
export function computationPaper(name: string, area: AreaSize): PaperTemplate {
  const elements: TemplateElement[] = [{ kind: 'grid', x: 0, y: 0, w: 1, h: 1, spacing: COMPUTATION.spacing }];
  for (let px = UNITS_PER_INCH; px < area.width - 0.5; px += UNITS_PER_INCH) {
    elements.push(line(px / area.width, 0, px / area.width, 1, 'strong'));
  }
  for (let py = UNITS_PER_INCH; py < area.height - 0.5; py += UNITS_PER_INCH) {
    elements.push(line(0, py / area.height, 1, py / area.height, 'strong'));
  }
  return { id: DRAFTING_IDS.computation, title: name, area: 'content', elements };
}

/**
 * Front, top and right views in the third-angle arrangement: the top view above the front view and the right view
 * to its right, joined by the projection lines that carry widths up and heights across. A title block sits below.
 */
export function threeViewLayout(name: string, text: ThreeViewText, area: AreaSize): PaperTemplate {
  const block = Math.min(1.6 * UNITS_PER_INCH, area.height * 0.22) / area.height;
  const usable = 1 - block - 0.04;
  // Two rows of views with a gap between them for the projection lines.
  const rowH = (usable - 0.1) / 2;
  const topY = 0.02;
  const frontY = topY + rowH + 0.1;
  const frontX = 0.06;
  const frontW = 0.4;
  const rightX = frontX + frontW + 0.1;
  const rightW = 0.28;
  const elements: TemplateElement[] = [
    rect(frontX, topY, frontW, rowH),
    rect(frontX, frontY, frontW, rowH),
    rect(rightX, frontY, rightW, rowH),
    label(frontX + 0.01, topY + 0.03, text.top),
    label(frontX + 0.01, frontY + 0.03, text.front),
    label(rightX + 0.01, frontY + 0.03, text.right),
    // Widths: the front view's left and right edges carried up to the top view.
    line(frontX, topY + rowH, frontX, frontY),
    line(frontX + frontW, topY + rowH, frontX + frontW, frontY),
    // Heights: the front view's top and bottom edges carried across to the right view.
    line(frontX + frontW, frontY, rightX, frontY),
    line(frontX + frontW, frontY + rowH, rightX, frontY + rowH),
    ...titleBlockElements(text, area),
  ];
  return { id: DRAFTING_IDS.threeView, title: name, area: 'content', elements };
}
