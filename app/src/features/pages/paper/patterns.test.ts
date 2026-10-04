import { describe, expect, it } from 'vitest';
import { MAX_PAPER, contentBox, paperDimensions, sheetGeometry, type SheetGeometry } from '../pagination/geometry';
import { MAX_DOTS } from './basic';
import { horizontal, leaning, points, segments, vertical } from './pathData';
import { infinitePaths, paperPaths, spacingOf } from './patterns';
import { PRESETS, SPACINGS, withSpacing } from './presets';
import type { PageBackground } from './types';

const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));
const A4 = sheetGeometry(paperDimensions('a4', 'portrait'));
const A5_LANDSCAPE = sheetGeometry(paperDimensions('a5', 'landscape'), [48, 48, 48, 48]);
const SIZES: [string, SheetGeometry][] = [
  ['Letter', LETTER],
  ['A4', A4],
  ['A5 landscape', A5_LANDSCAPE],
];
const TOLERANCE = 0.011;
/** Names a plain object inherits. A page that uses one as a pattern or a color must not reach Object.prototype. */
const OBJECT_KEYS = ['constructor', '__proto__', 'toString'];

describe('plain paper', () => {
  it('draws nothing, and so does a pattern this version does not know', () => {
    for (const pattern of ['plain', 'hexagons']) {
      const paths = paperPaths({ pattern }, LETTER);
      expect([paths.rules, paths.strong, paths.dots, paths.margin]).toEqual(['', '', '', '']);
      expect(paths.labels).toEqual([]);
    }
  });

  it('treats a pattern named like an Object property as one it does not know', () => {
    for (const pattern of OBJECT_KEYS) {
      expect(spacingOf({ pattern, spacing: 20 })).toBe(20);
      expect(paperPaths({ pattern }, LETTER).rules).toBe('');
      expect(infinitePaths({ pattern }, { x: 0, y: 0, w: 816, h: 1056 }, LETTER).rules).toBe('');
    }
  });
});

describe('ruled paper', () => {
  it.each([
    ['narrow 6 mm', SPACINGS.ruledNarrow],
    ['college 7 mm', SPACINGS.ruledCollege],
    ['wide 8.7 mm', SPACINGS.ruledWide],
    ['custom 40', 40],
  ])('draws %s lines across the sheet between the margins, at every paper size', (_name, given) => {
    // Paper that text sits on is drawn a whole number of units apart.
    const spacing = Math.round(given);
    for (const [, g] of SIZES) {
      const [top, , bottom] = g.margins;
      const lines = segments(paperPaths({ pattern: 'ruled', spacing: given }, g).rules);
      const expected = Math.floor((g.height - top - bottom) / spacing + 0.001);
      expect(lines).toHaveLength(expected);
      expect(lines[0][1]).toBeCloseTo(top + spacing, 1);
      lines.forEach((l, i) => {
        expect(l[1]).toBeCloseTo(top + (i + 1) * spacing, 1);
        expect([l[0], l[2]]).toEqual([0, g.width]);
        expect(l[1]).toBeLessThanOrEqual(g.height - bottom + TOLERANCE);
      });
    }
  });

  it('draws the margin line at the left margin from the top of the sheet to the bottom, only when asked', () => {
    expect(paperPaths({ pattern: 'ruled' }, LETTER).margin).toBe('');
    expect(segments(paperPaths({ pattern: 'ruled', marginLine: true }, LETTER).margin)).toEqual([[72, 0, 72, 1056]]);
  });

  it('keeps a custom spacing within 12 to 96 units and defaults to 7 mm', () => {
    expect(spacingOf({ pattern: 'ruled', spacing: 3 })).toBe(12);
    expect(spacingOf({ pattern: 'ruled', spacing: 500 })).toBe(96);
    expect(spacingOf({ pattern: 'ruled', spacing: Number.NaN })).toBe(26.46);
    expect(spacingOf({ pattern: 'ruled' })).toBe(26.46);
    expect(withSpacing(PRESETS.dots, 4).spacing).toBe(8);
  });
});

describe('grid paper', () => {
  it.each([
    ['5 mm', SPACINGS.grid5mm],
    ['1/4 inch', SPACINGS.gridQuarterInch],
    ['1 cm', SPACINGS.grid1cm],
    ['custom 50', 50],
  ])('draws %s squares from the content box corner and ends on a whole square', (_name, given) => {
    const spacing = Math.round(given);
    for (const [, g] of SIZES) {
      const box = contentBox(g, 0);
      const cols = Math.floor(box.w / spacing + 0.001);
      const rows = Math.floor(box.h / spacing + 0.001);
      const lines = segments(paperPaths({ pattern: 'grid', spacing: given }, g).rules);
      const across = horizontal(lines);
      const down = vertical(lines);
      expect(down).toHaveLength(cols + 1);
      expect(across).toHaveLength(rows + 1);
      expect(down[0][0]).toBeCloseTo(box.x, 1);
      expect(across[0][1]).toBeCloseTo(box.y, 1);
      expect(down.at(-1)![0]).toBeCloseTo(box.x + cols * spacing, 1);
      for (const l of lines) {
        expect(l[0]).toBeGreaterThanOrEqual(box.x - TOLERANCE);
        expect(l[2]).toBeLessThanOrEqual(box.x + box.w + TOLERANCE);
        expect(l[1]).toBeGreaterThanOrEqual(box.y - TOLERANCE);
        expect(l[3]).toBeLessThanOrEqual(box.y + box.h + TOLERANCE);
      }
    }
  });
});

describe('dot grid', () => {
  it('puts one dot at each crossing of the grid, inside the content box', () => {
    for (const [, g] of SIZES) {
      const box = contentBox(g, 0);
      const step = Math.round(SPACINGS.dots);
      const dots = points(paperPaths({ pattern: 'dots', spacing: SPACINGS.dots }, g).dots);
      const cols = Math.floor(box.w / step + 0.001) + 1;
      const rows = Math.floor(box.h / step + 0.001) + 1;
      expect(dots).toHaveLength(cols * rows);
      expect(dots[0]).toEqual([box.x, box.y]);
      for (const [x, y] of dots) {
        expect(x).toBeLessThanOrEqual(box.x + box.w + TOLERANCE);
        expect(y).toBeLessThanOrEqual(box.y + box.h + TOLERANCE);
      }
    }
  });

  it('keeps every row and every k-th dot of each row on the largest paper, never more than MAX_DOTS', () => {
    const g = sheetGeometry({ width: MAX_PAPER, height: MAX_PAPER });
    const dots = points(paperPaths({ pattern: 'dots', spacing: 8 }, g).dots);
    expect(dots.length).toBeLessThanOrEqual(MAX_DOTS);
    expect(dots.length).toBeGreaterThan(MAX_DOTS / 2);
    // Text sits on the rows, so none is left out; the dots along a row thin out instead.
    const rows = [...new Set(dots.map(([, y]) => y))].sort((a, b) => a - b);
    expect(rows[1] - rows[0]).toBeCloseTo(8);
    expect(dots[1][0] - dots[0][0]).toBeGreaterThan(8);
  });
});

describe('isometric paper', () => {
  const step = SPACINGS.isometric;
  const box = contentBox(LETTER, 0);
  const lines = segments(paperPaths({ pattern: 'isometric', spacing: step }, LETTER).rules);

  it('has one vertical family spaced by the triangle height, and two families leaning 30 degrees', () => {
    const down = vertical(lines);
    expect(down[1][0] - down[0][0]).toBeCloseTo((step * Math.sqrt(3)) / 2, 1);
    const slopes = leaning(lines).map((l) => Math.abs((l[3] - l[1]) / (l[2] - l[0])));
    expect(slopes.length).toBeGreaterThan(40);
    for (const slope of slopes) expect(slope).toBeCloseTo(1 / Math.sqrt(3), 1);
    expect(horizontal(lines)).toHaveLength(0);
    expect(leaning(lines).some((l) => l[3] > l[1])).toBe(true);
    expect(leaning(lines).some((l) => l[3] < l[1])).toBe(true);
  });

  it('meets all three families at the corner, and stays inside the content box', () => {
    const fromCorner = leaning(lines).filter(
      (l) => Math.abs(l[0] - box.x) < 0.02 && Math.abs(l[1] - (box.y + step)) < 0.02,
    );
    expect(fromCorner).toHaveLength(2);
    for (const l of lines) {
      expect(Math.min(l[0], l[2])).toBeGreaterThanOrEqual(box.x - TOLERANCE);
      expect(Math.max(l[0], l[2])).toBeLessThanOrEqual(box.x + box.w + TOLERANCE);
      expect(Math.min(l[1], l[3])).toBeGreaterThanOrEqual(box.y - TOLERANCE);
      expect(Math.max(l[1], l[3])).toBeLessThanOrEqual(box.y + box.h + TOLERANCE);
    }
  });
});

describe('music staff paper', () => {
  it('draws staves of five lines 2 mm apart with 6 spaces between staves, from the top of the content box', () => {
    for (const [, g] of SIZES) {
      const box = contentBox(g, 0);
      const step = SPACINGS.staff;
      const lines = segments(paperPaths({ pattern: 'staff', spacing: step }, g).rules);
      const staves = Math.floor((box.h - 4 * step) / (10 * step) + 0.001) + 1;
      expect(lines).toHaveLength(staves * 5);
      expect(lines[1][1] - lines[0][1]).toBeCloseTo(step, 1);
      expect(lines[5][1] - lines[4][1]).toBeCloseTo(6 * step, 1);
      expect(lines[0][1]).toBeCloseTo(box.y, 1);
      expect([lines[0][0], lines[0][2]]).toEqual([box.x, box.x + box.w]);
      expect(lines.at(-1)![1]).toBeLessThanOrEqual(box.y + box.h + TOLERANCE);
    }
  });
});

describe('infinite canvas', () => {
  const tile = { x: 0, y: 0, w: 1024, h: 1024 };

  it('draws ruled lines and lattices in step with sheet 0, through the tile without margins', () => {
    const sheet = paperPaths(PRESETS['ruled-college'], LETTER);
    const inTile = segments(infinitePaths(PRESETS['ruled-college'], tile, LETTER).rules);
    const inSheet = new Set(segments(sheet.rules).map((l) => l[1]));
    const shared = inTile.filter((l) => inSheet.has(l[1]));
    expect(shared.length).toBeGreaterThan(30);
    expect(inTile.every((l) => l[0] === 0 && l[2] === 1024)).toBe(true);
    const dotSheet = points(paperPaths(PRESETS.dots, LETTER).dots);
    const dotTile = new Set(points(infinitePaths(PRESETS.dots, tile, LETTER).dots).map(([x, y]) => `${x},${y}`));
    expect(dotSheet.filter(([x, y]) => x < 1024 && y < 1024).every(([x, y]) => dotTile.has(`${x},${y}`))).toBe(true);
  });

  it('keeps the grid, isometric lines, and margin line through a tile to its edges', () => {
    const grid = segments(infinitePaths(PRESETS['grid-5mm'], tile, LETTER).rules);
    expect(vertical(grid).every((l) => l[1] === 0 && l[3] === 1024)).toBe(true);
    const iso = segments(infinitePaths(PRESETS.isometric, tile, LETTER).rules);
    expect(iso.length).toBeGreaterThan(100);
    const ruled: PageBackground = { pattern: 'ruled', marginLine: true };
    expect(segments(infinitePaths(ruled, tile, LETTER).margin)).toEqual([[72, 0, 72, 1024]]);
    expect(infinitePaths(ruled, { ...tile, x: 500 }, LETTER).margin).toBe('');
  });

  it('draws sheet-based patterns once for each sheet a tile touches', () => {
    const tall = { x: 0, y: 900, w: 1024, h: 1400 };
    const strong = segments(infinitePaths(PRESETS.cornell, tall, LETTER).strong);
    const dividers = horizontal(strong).map((l) => l[1]);
    expect(dividers).toEqual([1056 - 72 - 192, 2 * 1056 - 72 - 192, 3 * 1056 - 72 - 192]);
  });
});
