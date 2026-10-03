// checks-disable-file brand-consistency: these tests compare against the color values in the brand tokens
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { strokeOutline } from '../geometry/outline';
import type { InkPoint, InkTool } from '../geometry/types';
import {
  alphaOf,
  HIGHLIGHTERS,
  PALETTE,
  paletteByName,
  paletteEntry,
  parseHex,
  PENS,
  resolveColor,
  slotsForTool,
  toCss,
} from './palette';
import { codeOfTool, DEFAULT_WIDTH_MM, mmToPage, pageToMm, toolFromCode, WIDTH_PRESETS_MM } from './tools';
import {
  eraserHoverPreview,
  maxWidthFactor,
  minWidthFactor,
  penHoverPreview,
  pressureForFactor,
  widthAt,
} from './width';

const TOOLS: InkTool[] = ['pen', 'pencil', 'highlighter', 'marker', 'brush'];

describe('the brand palette', () => {
  it('gives each pen and highlighter the slot the format names (spec 9.3)', () => {
    expect(PALETTE.map((e) => [e.slot, e.name])).toEqual([
      [1, 'Ink'],
      [2, 'Indigo'],
      [3, 'Brick'],
      [4, 'Fern'],
      [5, 'Plum'],
      [6, 'Amber'],
      [7, 'Walnut'],
      [32, 'Honey'],
      [33, 'Mint'],
      [34, 'Rose'],
      [35, 'Apricot'],
      [36, 'Lilac'],
    ]);
    expect(PENS).toHaveLength(7);
    expect(HIGHLIGHTERS).toHaveLength(5);
  });

  it('reads the colors from the brand tokens, light and dark', () => {
    expect(paletteEntry(1)?.light).toEqual([0x2b, 0x25, 0x21, 255]);
    expect(paletteEntry(3)?.dark).toEqual([0xf2, 0x90, 0x7f, 255]);
    expect(paletteEntry(32)?.light).toEqual([0xf2, 0xcf, 0x4a, 0x66]);
    expect(alphaOf(paletteEntry(32)!.light)).toBeCloseTo(0.4, 6);
  });

  it('draws a pen with its dark value in the dark theme and keeps a custom color as stored', () => {
    const brick = paletteEntry(3)!;
    expect(resolveColor({ slot: 3, color: brick.light }, 'light')).toEqual(brick.light);
    expect(resolveColor({ slot: 3, color: brick.light }, 'dark')).toEqual(brick.dark);
    expect(resolveColor({ slot: 0, color: [1, 2, 3, 255] }, 'dark')).toEqual([1, 2, 3, 255]);
    expect(resolveColor({ slot: 99, color: [9, 9, 9, 255] }, 'dark')).toEqual([9, 9, 9, 255]);
  });
});

describe('color text', () => {
  it('parses and prints colors', () => {
    expect(parseHex('#2F4F9A')).toEqual([0x2f, 0x4f, 0x9a, 255]);
    expect(parseHex('#2f4f9a80')).toEqual([0x2f, 0x4f, 0x9a, 128]);
    expect(parseHex('2F4F9A')).toBeNull();
    expect(parseHex('#12')).toBeNull();
    expect(toCss([0x2f, 0x4f, 0x9a, 255])).toBe('#2f4f9a');
    expect(toCss([242, 207, 74, 102])).toBe('rgb(242 207 74 / 0.4)');
  });

  it('finds an entry by name and offers each tool its own colors', () => {
    expect(paletteByName('mint')?.slot).toBe(33);
    expect(paletteByName('Teal')).toBeUndefined();
    expect(slotsForTool('highlighter')).toBe(HIGHLIGHTERS);
    expect(slotsForTool('pencil')).toBe(PENS);
  });
});

describe('the tools', () => {
  it('numbers the tools as the record does, and draws an unknown number as a pen', () => {
    expect(TOOLS.map(codeOfTool)).toEqual([0, 1, 2, 3, 4]);
    for (const tool of TOOLS) expect(toolFromCode(codeOfTool(tool))).toBe(tool);
    expect(toolFromCode(9)).toBe('pen');
  });

  it('lists the width presets of the Draw tab, and starts each tool on one of them', () => {
    expect(WIDTH_PRESETS_MM.pen).toEqual([0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0, 3.5]);
    expect(WIDTH_PRESETS_MM.pencil).toEqual([0.5, 0.7, 1.0, 2.0]);
    expect(WIDTH_PRESETS_MM.highlighter).toEqual([2, 4, 6, 8]);
    for (const tool of TOOLS) expect(WIDTH_PRESETS_MM[tool]).toContain(DEFAULT_WIDTH_MM[tool]);
  });

  it('converts millimeters to page units and back', () => {
    expect(mmToPage(1)).toBeCloseTo(3.7795, 4);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100, noNaN: true }), (mm) => Math.abs(pageToMm(mmToPage(mm)) - mm) < 1e-9),
    );
  });
});

/** The thickness of a straight stroke's outline in the middle, away from its round ends. */
function drawnThickness(tool: InkTool, width: number, point: Partial<InkPoint>): number {
  const points: InkPoint[] = Array.from({ length: 60 }, (_, i) => ({ x: i * 2, y: 0, time: i * 8, ...point }));
  const middle = strokeOutline(points, { tool, width }).filter((p) => p.x > 40 && p.x < 80);
  const ys = middle.map((p) => p.y);
  return Math.max(...ys) - Math.min(...ys);
}

describe('width from pressure and tilt', () => {
  it('matches the width the outline draws, for every tool', () => {
    for (const tool of TOOLS) {
      for (const pressure of [0.1, 0.5, 0.9]) {
        const drawn = drawnThickness(tool, 6, { pressure, tiltX: 0, tiltY: 0 });
        expect(drawn).toBeCloseTo(widthAt(tool, 6, { x: 0, y: 0, pressure }), 0);
      }
    }
  });
});

describe('width from tilt and transform', () => {
  it('widens the pencil with tilt and leaves the pen alone', () => {
    const flat = { x: 0, y: 0, pressure: 0.5, tiltX: 80, tiltY: 0 };
    const upright = { x: 0, y: 0, pressure: 0.5 };
    expect(widthAt('pencil', 4, flat)).toBeGreaterThan(widthAt('pencil', 4, upright) * 1.9);
    expect(widthAt('pen', 4, flat)).toBe(widthAt('pen', 4, upright));
    const drawn = drawnThickness('pencil', 4, { pressure: 0.5, tiltX: 80, tiltY: 0 });
    expect(drawn).toBeCloseTo(widthAt('pencil', 4, flat), 0);
  });

  it('draws the highlighter, and any stroke without pressure, at the nominal width', () => {
    expect(widthAt('highlighter', 24, { x: 0, y: 0, pressure: 1 })).toBe(24);
    expect(widthAt('pen', 2, { x: 0, y: 0, pressure: 1 }, { pressure: false })).toBe(2);
    expect(widthAt('pen', 2, { x: 0, y: 0 })).toBe(2);
  });

  it('scales with the stroke transform', () => {
    expect(widthAt('pen', 2, { x: 0, y: 0, pressure: 0.8 }, { scale: 3 })).toBeCloseTo(
      3 * widthAt('pen', 2, { x: 0, y: 0, pressure: 0.8 }),
      9,
    );
  });

  it('stays between the tool factors, and rises with pressure', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOOLS),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 90, noNaN: true }),
        (tool, a, b, tilt) => {
          const [low, high] = a < b ? [a, b] : [b, a];
          const at = (pressure: number) => widthAt(tool, 10, { x: 0, y: 0, pressure, tiltX: tilt, tiltY: 0 });
          expect(at(low)).toBeLessThanOrEqual(at(high) + 1e-9);
          expect(at(a)).toBeGreaterThanOrEqual(10 * minWidthFactor(tool) - 1e-9);
          expect(at(a)).toBeLessThanOrEqual(10 * maxWidthFactor(tool) + 1e-9);
        },
      ),
    );
  });

  it('finds the pressure for a width, where the tool has one', () => {
    expect(pressureForFactor('pen', 1)).toBeCloseTo(0.5, 9);
    expect(pressureForFactor('pen', 0.5)).toBeCloseTo(0, 9);
    expect(pressureForFactor('pen', 1.5)).toBeCloseTo(1, 9);
    expect(pressureForFactor('highlighter', 1)).toBeNull();
  });
});

describe('the hover cursor', () => {
  it('shows the pen tip at the zoom, kept between 3 and 32 pixels', () => {
    expect(penHoverPreview(2, 1).diameter).toBe(3);
    expect(penHoverPreview(10, 2).diameter).toBe(20);
    expect(penHoverPreview(40, 2).diameter).toBe(32);
  });

  it('shows the eraser as a cursor up to 128 pixels, and as a ring beyond', () => {
    expect(eraserHoverPreview(20, 1)).toEqual({ diameter: 40, ring: false });
    expect(eraserHoverPreview(100, 1)).toEqual({ diameter: 200, ring: true });
  });
});
