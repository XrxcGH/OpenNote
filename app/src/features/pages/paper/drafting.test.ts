import { describe, expect, it } from 'vitest';
import { contentBox, paperDimensions, sheetGeometry } from '../pagination/geometry';
import {
  COMPUTATION,
  SHEETS,
  TITLE_FIELDS,
  UNITS_PER_INCH,
  UNITS_PER_MM,
  computationPaper,
  sheetUnits,
  threeViewLayout,
  titleBlock,
} from './drafting';
import type { ThreeViewText, TitleBlockText } from './drafting';
import { MAX_ELEMENTS, MAX_LABEL } from './template';
import { paperPaths } from './patterns';
import type { PaperTemplate } from './types';

const TEXT: ThreeViewText = {
  title: 'Title',
  drawnBy: 'Drawn by',
  date: 'Date',
  scale: 'Scale',
  sheet: 'Sheet',
  material: 'Material',
  tolerance: 'Tolerances unless otherwise specified',
  front: 'Front',
  top: 'Top',
  right: 'Right',
};
const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));
const box = contentBox(LETTER, 0);
const AREA = { width: box.w, height: box.h };

describe('sheet sizes', () => {
  it('match the standards in millimetres and in page units', () => {
    const byId = Object.fromEntries(SHEETS.map((s) => [s.id, s]));
    expect([byId.ansiA!.widthMm, byId.ansiA!.heightMm]).toEqual([215.9, 279.4]);
    expect([byId.ansiB!.widthMm, byId.ansiB!.heightMm]).toEqual([279.4, 431.8]);
    expect([byId.a4!.widthMm, byId.a4!.heightMm]).toEqual([210, 297]);
    expect([byId.a3!.widthMm, byId.a3!.heightMm]).toEqual([297, 420]);
    // ANSI A and B are exactly 8.5 x 11 in and 11 x 17 in
    expect(sheetUnits(byId.ansiA!).width).toBeCloseTo(8.5 * UNITS_PER_INCH, 9);
    expect(sheetUnits(byId.ansiA!).height).toBeCloseTo(11 * UNITS_PER_INCH, 9);
    expect(sheetUnits(byId.ansiB!).width).toBeCloseTo(11 * UNITS_PER_INCH, 9);
    expect(sheetUnits(byId.ansiB!).height).toBeCloseTo(17 * UNITS_PER_INCH, 9);
    expect(UNITS_PER_MM * 25.4).toBeCloseTo(96, 12);
  });
});

describe('title block', () => {
  const labels = (t: PaperTemplate) => t.elements.flatMap((e) => (e.kind === 'label' ? [e.text] : []));
  it('has the seven fields and the tolerance note', () => {
    const t = titleBlock('Title block', TEXT satisfies TitleBlockText, AREA);
    expect(TITLE_FIELDS).toEqual(['title', 'drawnBy', 'date', 'scale', 'sheet', 'material', 'tolerance']);
    expect(labels(t)).toEqual(TITLE_FIELDS.map((k) => TEXT[k]));
    expect(labels(t)).toContain('Tolerances unless otherwise specified');
  });
  it('sits in the bottom-right corner inside the area', () => {
    const t = titleBlock('Title block', TEXT, AREA);
    const frame = t.elements[0]!;
    if (frame.kind !== 'rect') throw new Error('first element is the frame');
    expect(frame.x + frame.w).toBeCloseTo(1, 12);
    expect(frame.y + frame.h).toBeCloseTo(1, 12);
    expect(frame.w * AREA.width).toBeLessThanOrEqual(6 * UNITS_PER_INCH + 1e-9);
  });
});

describe('computation paper', () => {
  const t = computationPaper('Computation paper', AREA);
  it('has 5 squares per inch', () => {
    expect(COMPUTATION.spacing).toBeCloseTo(19.2, 12);
    const grid = t.elements.find((e) => e.kind === 'grid');
    expect(grid && 'spacing' in grid ? grid.spacing : 0).toBeCloseTo(UNITS_PER_INCH / 5, 12);
  });
  it('has a heavier line every inch', () => {
    const strong = t.elements.filter((e) => e.kind === 'line' && e.weight === 'strong');
    const vertical = strong.filter((e) => e.kind === 'line' && e.x1 === e.x2);
    const horizontal = strong.filter((e) => e.kind === 'line' && e.y1 === e.y2);
    // a letter page's content box is 7 in wide and 9.5 in tall (one inch margins): lines at 1 .. 6 and 1 .. 9
    expect(vertical).toHaveLength(Math.ceil(AREA.width / UNITS_PER_INCH - 1e-9) - 1);
    expect(horizontal).toHaveLength(Math.ceil(AREA.height / UNITS_PER_INCH - 1e-9) - 1);
    const first = vertical[0]!;
    if (first.kind === 'line') expect(first.x1 * AREA.width).toBeCloseTo(UNITS_PER_INCH, 9);
  });
});

describe('three-view layout', () => {
  const t = threeViewLayout('Three views', TEXT, AREA);
  it('arranges top above front and right beside it, with projection lines', () => {
    const frames = t.elements.filter((e) => e.kind === 'rect').slice(0, 3);
    const [top, front, right] = frames.map((e) => (e.kind === 'rect' ? e : null)!);
    expect(top.x).toBeCloseTo(front.x, 12);
    expect(top.y + top.h).toBeLessThan(front.y);
    expect(right.y).toBeCloseTo(front.y, 12);
    expect(right.x).toBeGreaterThan(front.x + front.w);
    const lines = t.elements.filter((e) => e.kind === 'line');
    // two vertical (widths) and two horizontal (heights) projection lines, plus the title block's own rules
    expect(
      lines.filter(
        (e) => e.kind === 'line' && e.x1 === e.x2 && e.y1 >= top.y + top.h - 1e-12 && e.y2 <= front.y + 1e-12,
      ),
    ).toHaveLength(2);
    expect(
      lines.filter(
        (e) => e.kind === 'line' && e.y1 === e.y2 && e.x1 >= front.x + front.w - 1e-12 && e.x2 <= right.x + 1e-12,
      ),
    ).toHaveLength(2);
  });
  it('keeps the views clear of the title block', () => {
    const rects = t.elements.filter((e) => e.kind === 'rect');
    const block = rects[3]!;
    const views = rects.slice(0, 3);
    if (block.kind !== 'rect') throw new Error('block');
    for (const v of views) if (v.kind === 'rect') expect(v.y + v.h).toBeLessThan(block.y);
  });
});

describe('every drafting template obeys the reader limits on every sheet', () => {
  const sizes = SHEETS.flatMap((s) => [s.id, `${s.id}-landscape`]);
  it.each(sizes)('%s', (id) => {
    const sheet = SHEETS.find((s) => id.startsWith(s.id))!;
    const { width, height } = sheetUnits(sheet);
    const landscape = id.endsWith('landscape');
    const geo = sheetGeometry(landscape ? { width: height, height: width } : { width, height });
    const b = contentBox(geo, 0);
    const area = { width: b.w, height: b.h };
    for (const t of [computationPaper('c', area), threeViewLayout('v', TEXT, area), titleBlock('b', TEXT, area)]) {
      expect(t.elements.length).toBeLessThanOrEqual(MAX_ELEMENTS);
      for (const e of t.elements) {
        if (e.kind === 'label') {
          expect(e.text.length).toBeLessThanOrEqual(MAX_LABEL);
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.x).toBeLessThanOrEqual(1);
          expect(e.y).toBeGreaterThanOrEqual(0);
          expect(e.y).toBeLessThanOrEqual(1);
        } else if (e.kind === 'line') {
          for (const v of [e.x1, e.y1, e.x2, e.y2]) expect(v).toBeGreaterThanOrEqual(-1e-12);
          for (const v of [e.x1, e.x2, e.y1, e.y2]) expect(v).toBeLessThanOrEqual(1 + 1e-12);
        } else if (e.kind === 'rect') {
          expect(e.x + e.w).toBeLessThanOrEqual(1 + 1e-12);
          expect(e.y + e.h).toBeLessThanOrEqual(1 + 1e-12);
        }
      }
      // and the generator draws them without throwing
      const paths = paperPaths({ pattern: 'template', template: t }, geo);
      expect(paths).toBeDefined();
    }
  });
});
