import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containsBounds } from '../../geometry/bounds';
import { applyToPoint, widthScale } from '../../geometry/matrix';
import { strokeOutline } from '../../geometry/outline';
import type { InkPoint, InkTool, Matrix, Stroke } from '../../geometry/types';
import { EDGE_MARGIN, inkBounds } from './inkBox';

const TOOLS: InkTool[] = ['pen', 'pencil', 'highlighter', 'marker', 'brush'];

// Positions are multiples of 1/64, as a record stores them, which also keeps the test away from denormal numbers.
const position = fc.integer({ min: -6400, max: 6400 }).map((steps) => steps / 64);

const point = fc.record({
  x: position,
  y: position,
  pressure: fc.double({ min: 0, max: 1, noNaN: true }),
  tiltX: fc.double({ min: -90, max: 90, noNaN: true }),
  tiltY: fc.double({ min: -90, max: 90, noNaN: true }),
});

const similarity = fc.record({
  s: fc.double({ min: 0.3, max: 3, noNaN: true }),
  a: fc.double({ min: 0, max: 6.28, noNaN: true }),
  e: fc.double({ min: -50, max: 50, noNaN: true }),
  f: fc.double({ min: -50, max: 50, noNaN: true }),
});

const line = (tool: InkTool, extra: Partial<InkPoint>): Stroke => ({
  id: 'l',
  tool,
  width: 4,
  startTime: 0,
  points: Array.from({ length: 12 }, (_, i) => ({ x: i * 3, y: 0, ...extra })),
});

const height = (stroke: Stroke) => inkBounds(stroke).maxY - inkBounds(stroke).minY;

describe('the box of a stroke’s ink', () => {
  it('is drawn from the outline, so a harder press and a flatter pencil make a bigger box', () => {
    expect(height(line('pen', { pressure: 1 }))).toBeGreaterThan(height(line('pen', { pressure: 0.1 })));
    const flat = line('pencil', { pressure: 0.5, tiltX: 0, tiltY: 60 });
    expect(height(flat)).toBeGreaterThan(height(line('pencil', { pressure: 0.5, tiltX: 0, tiltY: 0 })));
  });

  it('holds the centerline and the whole outline, grown by the edge margin', () => {
    const stroke = line('pen', { pressure: 0.9 });
    const box = inkBounds(stroke);
    const outline = strokeOutline(stroke.points, { tool: 'pen', width: 4 });
    for (const p of [...stroke.points, ...outline]) {
      expect(containsBounds(box, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })).toBe(true);
    }
    expect(box.minY).toBeLessThanOrEqual(Math.min(...outline.map((p) => p.y)) - EDGE_MARGIN + 1e-9);
  });

  it('is worked out once for each stroke', () => {
    const stroke = line('pen', { pressure: 0.5 });
    expect(inkBounds(stroke)).toBe(inkBounds(stroke));
  });
});

describe('the box of a moved, turned, and scaled stroke', () => {
  it('holds the transformed outline of any stroke, within 2 percent of its width', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOOLS),
        fc.array(point, { minLength: 2, maxLength: 30 }),
        fc.double({ min: 0.5, max: 20, noNaN: true }),
        similarity,
        (tool, points, width, m) => {
          const [c, s] = [m.s * Math.cos(m.a), m.s * Math.sin(m.a)];
          const transform: Matrix = [c, s, -s, c, m.e, m.f];
          const stroke: Stroke = { id: 's', tool, width, startTime: 0, points: points as InkPoint[], transform };
          const placed = strokeOutline(stroke.points, { tool, width }).map((p) => applyToPoint(transform, p));
          const box = inkBounds(stroke);
          const slack = 0.02 * width * widthScale(transform) + 1e-6;
          const xs = placed.map((p) => p.x);
          const ys = placed.map((p) => p.y);
          expect(Math.min(...xs)).toBeGreaterThanOrEqual(box.minX - slack);
          expect(Math.max(...xs)).toBeLessThanOrEqual(box.maxX + slack);
          expect(Math.min(...ys)).toBeGreaterThanOrEqual(box.minY - slack);
          expect(Math.max(...ys)).toBeLessThanOrEqual(box.maxY + slack);
        },
      ),
      { numRuns: 60 },
    );
  });
});
