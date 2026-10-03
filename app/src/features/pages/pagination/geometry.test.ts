import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_PAGES_PT,
  MARGIN_PRESETS,
  clampMargins,
  contentBottom,
  contentBox,
  contentTop,
  flowSheetAt,
  inGap,
  paperDimensions,
  printSheet,
  sheetAt,
  sheetGeometry,
} from './geometry';

const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));

describe('paper sizes', () => {
  it('match the format spec and turn over for landscape', () => {
    expect(paperDimensions('a4', 'portrait')).toEqual({ width: 793.7, height: 1122.52 });
    expect(paperDimensions('legal', 'landscape')).toEqual({ width: 1344, height: 816 });
    expect(paperDimensions('tabloid', 'portrait')).toEqual({ width: 1056, height: 1632 });
    expect(paperDimensions('a5', 'portrait')).toEqual({ width: 559.37, height: 793.7 });
  });

  it('take a custom size as given, and fall back to Letter without one', () => {
    expect(paperDimensions('custom', 'portrait', { width: 500, height: 700 })).toEqual({ width: 500, height: 700 });
    expect(paperDimensions('custom', 'landscape', { width: 500, height: 700 })).toEqual({ width: 700, height: 500 });
    expect(paperDimensions('custom', 'portrait')).toEqual({ width: 816, height: 1056 });
  });
});

describe('sheet geometry', () => {
  it('places the content box of each sheet by the sheet height and the margins', () => {
    expect(contentBox(LETTER, 0)).toEqual({ x: 72, y: 72, w: 672, h: 912 });
    expect(contentBox(LETTER, 2)).toEqual({ x: 72, y: 2 * 1056 + 72, w: 672, h: 912 });
    expect(contentTop(LETTER, 1)).toBe(1056 + 72);
    expect(contentBottom(LETTER, 1)).toBe(2 * 1056 - 72);
  });

  it('keeps margins between 24 units and half the paper', () => {
    expect(clampMargins([0, 2000, 10, 24], 816, 1056)).toEqual([24, 408, 24, 24]);
    expect(sheetGeometry({ width: 816, height: 1056 }, MARGIN_PRESETS.narrow).margins).toEqual([48, 48, 48, 48]);
  });

  it('always leaves a content box of at least 48 units', () => {
    // Half the paper each would leave no content box at all, and the paginator nothing to fill.
    expect(clampMargins([600, 72, 600, 72], 816, 1056)).toEqual([504, 72, 504, 72]);
    const small = sheetGeometry({ width: 300, height: 144 });
    expect(small.margins).toEqual([48, 72, 48, 72]);
    expect(contentBox(small, 0).h).toBe(48);
    // Uneven margins give up room in proportion to how far each is above the smallest margin.
    const [top, , bottom] = clampMargins([1000, 24, 500, 24], 816, 1056);
    expect(top + bottom).toBeCloseTo(1056 - 48);
    expect(top - 24).toBeCloseTo(((528 - 24) / (500 - 24)) * (bottom - 24));
  });

  it('finds the sheet of a y, and the sheet a flowing item could sit on', () => {
    expect(sheetAt(LETTER, 0)).toBe(0);
    expect(sheetAt(LETTER, 1055.9)).toBe(0);
    expect(sheetAt(LETTER, 1056)).toBe(1);
    expect(sheetAt(LETTER, -40)).toBe(0);
    // The bottom margin of sheet 0 belongs to sheet 1 for flowing content, which can't stay there.
    expect(flowSheetAt(LETTER, 983)).toBe(0);
    expect(flowSheetAt(LETTER, 1000)).toBe(1);
  });

  it('draws the gap 12 units each side of every edge but the page top', () => {
    expect(inGap(LETTER, 1056 - 11)).toBe(true);
    expect(inGap(LETTER, 1056 + 11)).toBe(true);
    expect(inGap(LETTER, 1056 + 12)).toBe(false);
    expect(inGap(LETTER, 5)).toBe(false);
  });
});

describe('printed sheets', () => {
  it('use the page Chromium writes when it is narrower than the paper', () => {
    const a4 = paperDimensions('a4', 'portrait');
    const printed = printSheet(a4, CHROMIUM_PAGES_PT.a4);
    expect(printed.width).toBeCloseTo(793.28, 2);
    expect(printed.height).toBeCloseTo(1122.56, 1);
    expect(printed.height).toBeLessThanOrEqual(a4.height);
  });

  it('keep Letter as it is, and the paper when nothing was probed', () => {
    expect(printSheet(paperDimensions('letter', 'portrait'), CHROMIUM_PAGES_PT.letter)).toEqual({
      width: 816,
      height: 1056,
    });
    expect(printSheet({ width: 500, height: 600 })).toEqual({ width: 500, height: 600 });
  });
});
