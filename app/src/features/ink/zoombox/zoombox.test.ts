import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Bounds } from '../geometry/types';
import {
  ADVANCE_DELAY_MS,
  advance,
  lineNumber,
  lineStep,
  moveBox,
  newLine,
  revealDelta,
  shouldAdvance,
} from './advance';
import type { Margins } from './advance';
import {
  boxAt,
  boxBounds,
  boxSize,
  DEFAULT_MAGNIFICATION,
  pageToStrip,
  stripHeight,
  stripToPage,
  stripWidth,
} from './mapping';
import type { Magnification, Strip, ZoomBox } from './mapping';

const strip: Strip = { origin: { x: 40, y: 600 }, width: 900, height: 240 };
const box = (x = 100, y = 200, width = 300, height = 80): ZoomBox => ({ origin: { x, y }, width, height });
const margins: Margins = { left: 50, right: 750 };

describe('the strip and the box', () => {
  it('docks at 30 percent of the pane, between 160 and 320 pixels', () => {
    expect(stripHeight(500)).toBe(160);
    expect(stripHeight(800)).toBe(240);
    expect(stripHeight(2000)).toBe(320);
  });

  it('makes the box the strip divided by the magnification and the zoom', () => {
    expect(DEFAULT_MAGNIFICATION).toBe(3);
    expect(boxSize(strip, 3, 1)).toEqual({ width: 300, height: 80 });
    expect(boxSize(strip, 2, 1)).toEqual({ width: 450, height: 120 });
    expect(boxSize(strip, 4, 2)).toEqual({ width: 112.5, height: 30 });
    expect(boxAt({ x: 5, y: 6 }, strip, 3, 1)).toEqual({ origin: { x: 5, y: 6 }, width: 300, height: 80 });
  });

  it('maps strip points to page points, and back', () => {
    const b = box();
    expect(stripToPage({ x: 40, y: 600 }, strip, b, 3, 1)).toEqual({ x: 100, y: 200 });
    expect(stripToPage({ x: 940, y: 840 }, strip, b, 3, 1)).toEqual({ x: 400, y: 280 });
    expect(stripWidth(2, 3, 1.5)).toBe(9);
  });

  it('maps there and back to the same point for any strip, box, magnification, and zoom', () => {
    const number = fc.double({ min: -500, max: 500, noNaN: true });
    fc.assert(
      fc.property(
        fc.record({ x: number, y: number }),
        fc.record({ x: number, y: number }),
        fc.constantFrom<Magnification>(2, 3, 4),
        fc.double({ min: 0.25, max: 4, noNaN: true }),
        (p, origin, magnification, zoom) => {
          const b = boxAt(origin, strip, magnification, zoom);
          const back = pageToStrip(stripToPage(p, strip, b, magnification, zoom), strip, b, magnification, zoom);
          expect(Math.abs(back.x - p.x)).toBeLessThan(1e-6);
          expect(Math.abs(back.y - p.y)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it('puts the whole strip inside the box', () => {
    const b = boxAt({ x: 10, y: 20 }, strip, 3, 2);
    const corner = stripToPage({ x: strip.origin.x + strip.width, y: strip.origin.y + strip.height }, strip, b, 3, 2);
    const area = boxBounds(b);
    expect(corner.x).toBeCloseTo(area.maxX, 9);
    expect(corner.y).toBeCloseTo(area.maxY, 9);
  });
});

const stroke = (maxX: number): Bounds => ({ minX: 110, minY: 210, maxX, maxY: 260 });

describe('advancing along the line', () => {
  it('moves on when the last stroke reaches the right quarter of the box, after 300 ms', () => {
    expect(ADVANCE_DELAY_MS).toBe(300);
    expect(shouldAdvance(box(), stroke(324))).toBe(false);
    expect(shouldAdvance(box(), stroke(325))).toBe(true);
    expect(shouldAdvance(box(), stroke(450))).toBe(true);
  });

  it('moves right by half the box width', () => {
    const move = advance(box(), margins);
    expect(move.wrapped).toBe(false);
    expect(move.box.origin).toEqual({ x: 250, y: 200 });
    expect(move.box.width).toBe(300);
  });

  it('wraps to the next line at the right margin: the ruling, or 1.25 box heights', () => {
    const wrapped = advance(box(500, 200), margins);
    expect(wrapped.wrapped).toBe(true);
    expect(wrapped.box.origin).toEqual({ x: 50, y: 300 });
    expect(advance(box(500, 200), margins, 32).box.origin).toEqual({ x: 50, y: 232 });
    expect(lineStep(box())).toBe(100);
    expect(lineStep(box(), 0)).toBe(100);
    expect(lineStep(box(), 28)).toBe(28);
  });

  it('does not wrap forever when the box is wider than the line', () => {
    const narrow: Margins = { left: 50, right: 200 };
    const first = advance(box(50, 0), narrow);
    expect(first.wrapped).toBe(false);
    expect(advance(first.box, narrow).wrapped).toBe(true);
  });

  it('starts a new line by hand at the left margin', () => {
    expect(newLine(box(400, 200), margins, 30).origin).toEqual({ x: 50, y: 230 });
  });

  it('keeps every box on the line, and moves forward without end', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.double({ min: 40, max: 400, noNaN: true }), (steps, width) => {
        let current = box(margins.left, 0, width, 50);
        let previous = lineNumber(current, 0);
        for (let i = 0; i < steps; i++) {
          const move = advance(current, margins);
          current = move.box;
          if (!move.wrapped)
            expect(current.origin.x + current.width).toBeLessThanOrEqual(margins.right + width / 2 + 1e-6);
          expect(current.origin.x).toBeGreaterThanOrEqual(margins.left);
          const line = lineNumber(current, 0);
          expect(line).toBeGreaterThanOrEqual(previous);
          previous = line;
        }
      }),
    );
  });
});

describe('moving the box by hand', () => {
  it('moves a quarter of the width with the arrows, or one line up and down', () => {
    expect(moveBox(box(), 'right', margins).origin).toEqual({ x: 175, y: 200 });
    expect(moveBox(box(), 'left', margins).origin).toEqual({ x: 50, y: 200 });
    expect(moveBox(box(60), 'left', margins).origin.x).toBe(50);
    expect(moveBox(box(), 'down', margins, 30).origin.y).toBe(230);
    expect(moveBox(box(), 'up', margins).origin.y).toBe(100);
  });

  it('goes to the margin with Home, and to the end of the ink with End', () => {
    expect(moveBox(box(), 'home', margins).origin.x).toBe(50);
    expect(moveBox(box(), 'end', margins, undefined, 620).origin.x).toBe(620);
    expect(moveBox(box(), 'end', margins).origin.x).toBe(50);
  });

  it('counts lines from 1 for the announcement', () => {
    expect(lineNumber(box(50, 100), 100, 30)).toBe(1);
    expect(lineNumber(box(50, 190), 100, 30)).toBe(4);
    expect(lineNumber(box(50, 0), 100, 30)).toBe(1);
  });

  it('scrolls the least that brings the box into view, with room around it', () => {
    const view: Bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    expect(revealDelta(box(100, 200), view)).toEqual({ x: 0, y: 0 });
    expect(revealDelta(box(600, 200), view)).toEqual({ x: 124, y: 0 });
    expect(revealDelta(box(100, 560), view)).toEqual({ x: 0, y: 64 });
    expect(revealDelta(box(-100, -50), view)).toEqual({ x: -124, y: -74 });
  });
});
