import { describe, expect, it } from 'vitest';
import { contentTop, paperDimensions, sheetGeometry } from './geometry';
import { belowBreak, inkBounds, sheetCount, sheetPieces, sheetSpan } from './freeform';

const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));
const A4 = sheetGeometry(paperDimensions('a4', 'portrait'));

describe('sheets of a freeform block', () => {
  it('puts a box inside one sheet on that sheet', () => {
    expect(sheetSpan(LETTER, { x: 100, y: 1100, w: 200, h: 300 })).toEqual({
      first: 1,
      last: 1,
      crossesBreak: false,
      offPaper: false,
    });
  });

  it('treats a box that ends on the sheet edge as belonging to the sheet above', () => {
    expect(sheetSpan(LETTER, { x: 0, y: 756, w: 100, h: 300 })).toMatchObject({ first: 0, last: 0 });
    expect(sheetSpan(LETTER, { x: 0, y: 1056, w: 100, h: 0 })).toMatchObject({ first: 1, last: 1 });
  });

  it('flags a box across a break, at each paper size', () => {
    for (const g of [LETTER, A4]) {
      const span = sheetSpan(g, { x: 100, y: g.height - 50, w: 100, h: 100 });
      expect(span).toMatchObject({ first: 0, last: 1, crossesBreak: true });
    }
    expect(sheetSpan(A4, { x: 100, y: 1000, w: 100, h: 2400 })).toMatchObject({ first: 0, last: 3 });
  });

  it('flags a box that sticks out of the paper', () => {
    expect(sheetSpan(LETTER, { x: 700, y: 10, w: 200, h: 10 }).offPaper).toBe(true);
    expect(sheetSpan(LETTER, { x: -5, y: 10, w: 20, h: 10 }).offPaper).toBe(true);
    expect(sheetSpan(LETTER, { x: 0, y: 10, w: 816, h: 10 }).offPaper).toBe(false);
  });

  it('splits a box at the sheet edges for clipping', () => {
    const pieces = sheetPieces(LETTER, { x: 10, y: 1000, w: 50, h: 1200 });
    expect(pieces.map((p) => [p.sheet, p.rect.y, p.rect.h])).toEqual([
      [0, 1000, 56],
      [1, 1056, 1056],
      [2, 2112, 88],
    ]);
  });

  it('counts sheets from the lowest bottom edge, never fewer than one', () => {
    expect(sheetCount(LETTER, [])).toBe(1);
    expect(sheetCount(LETTER, [500, 1056])).toBe(1);
    expect(sheetCount(LETTER, [500, 1056.5])).toBe(2);
    expect(sheetCount(A4, [3000])).toBe(3);
  });

  it('moves a box below the break to the next content top', () => {
    expect(belowBreak(LETTER, { x: 0, y: 1000, w: 10, h: 100 })).toBe(contentTop(LETTER, 1));
  });
});

describe('sheets of a stroke', () => {
  it('grows the bounds by half the pen width, and a stroke across an edge reaches both sheets', () => {
    const bounds = inkBounds(
      [
        { x: 100, y: 1050 },
        { x: 140, y: 1060 },
      ],
      8,
    );
    expect(bounds).toEqual({ x: 96, y: 1046, w: 48, h: 18 });
    expect(sheetSpan(LETTER, bounds!)).toMatchObject({ first: 0, last: 1, crossesBreak: true });
  });

  it('has no bounds without points', () => {
    expect(inkBounds([], 4)).toBeNull();
  });
});
