import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containsBounds } from '../../geometry/bounds';
import { applyToPoint, widthScale } from '../../geometry/matrix';
import { isExactStroke, strokeOutline, strokeShapes } from '../../geometry/outline';
import { pagePoints } from '../../geometry/strokeIndex';
import type { Bounds, InkPoint, InkTool, Matrix, Stroke } from '../../geometry/types';
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

type Sample = { x: number; y: number; pressure: number; tiltX: number; tiltY: number };
type Similarity = { s: number; a: number; e: number; f: number };

const bounds = (points: readonly { x: number; y: number }[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
});

const placedStroke = (
  tool: InkTool,
  points: InkPoint[],
  width: number,
  m: { s: number; a: number; e: number; f: number },
) => {
  const [c, s] = [m.s * Math.cos(m.a), m.s * Math.sin(m.a)];
  const transform: Matrix = [c, s, -s, c, m.e, m.f];
  const stroke: Stroke = { id: 's', tool, width, startTime: 0, points, transform };
  return { stroke, transform };
};

/** The bounds of every shape the renderer fills for a placed stroke (`strokePath`: page points, scaled width). */
function inkOf(stroke: Stroke, transform: Matrix): Bounds {
  const page = pagePoints(stroke).map((p, i) => ({ ...stroke.points[i], x: p.x, y: p.y }));
  const width = stroke.width * widthScale(transform);
  return bounds(strokeShapes(page, { tool: stroke.tool, width, exact: isExactStroke(stroke) }).flat());
}

// The macOS run of PR 114 found this one. Scaled by 0.3, a pen stroke that goes out, then back, draws an outline
// 1.09 units past its centerline. Scaling an outline built at the stroke's own size reached only 1 unit.
// Perfect-freehand's gaps are absolute, so the two shapes differ.
const scaledOutAndBack: [InkTool, Sample[], number, Similarity] = [
  'pen',
  [
    { x: 0, y: 0, pressure: 0, tiltX: 0, tiltY: 0 },
    { x: 0, y: -9.75, pressure: 0, tiltX: 0, tiltY: 0 },
    { x: 0, y: 0, pressure: 0, tiltX: 0, tiltY: 0 },
  ],
  14.608585266959999,
  { s: 0.3, a: 0, e: 0, f: 0 },
];

/** Runs `check` on the box and the ink's bounds, for any tool, points, width, and similarity. */
function overStrokes(
  check: (box: Bounds, ink: Bounds, eps: number, stroke: Stroke, transform: Matrix) => void,
  turn: (m: Similarity) => Similarity = (m) => m,
) {
  fc.assert(
    fc.property(
      fc.constantFrom(...TOOLS),
      fc.array(point, { minLength: 2, maxLength: 30 }),
      fc.double({ min: 0.5, max: 20, noNaN: true }),
      similarity,
      (tool, points, width, m) => {
        const { stroke, transform } = placedStroke(tool, points as InkPoint[], width, turn(m));
        const ink = inkOf(stroke, transform);
        // Rounding is a relative step of the largest coordinate, never a share of the stroke's width.
        const eps = 1e-9 * Math.max(1, ...Object.values(ink).map(Math.abs));
        check(inkBounds(stroke), ink, eps, stroke, transform);
      },
    ),
    { numRuns: 60, examples: [scaledOutAndBack] },
  );
}

describe('the box of a moved, turned, and scaled stroke', () => {
  it('holds every shape the renderer fills, grown by the edge margin', () => {
    overStrokes((box, ink, eps) => {
      expect(ink.minX).toBeGreaterThanOrEqual(box.minX + EDGE_MARGIN - eps);
      expect(ink.maxX).toBeLessThanOrEqual(box.maxX - EDGE_MARGIN + eps);
      expect(ink.minY).toBeGreaterThanOrEqual(box.minY + EDGE_MARGIN - eps);
      expect(ink.maxY).toBeLessThanOrEqual(box.maxY - EDGE_MARGIN + eps);
    });
  });

  it('holds the moved and turned outline of any stroke', () => {
    // Only a move and a turn: the outline of a scaled stroke is built at its own size, so it is not this shape.
    overStrokes(
      (box, _ink, eps, stroke, transform) => {
        const placed = bounds(
          strokeOutline(stroke.points, { tool: stroke.tool, width: stroke.width }).map((p) =>
            applyToPoint(transform, p),
          ),
        );
        expect(placed.minX).toBeGreaterThanOrEqual(box.minX - eps);
        expect(placed.maxX).toBeLessThanOrEqual(box.maxX + eps);
        expect(placed.minY).toBeGreaterThanOrEqual(box.minY - eps);
        expect(placed.maxY).toBeLessThanOrEqual(box.maxY + eps);
      },
      (m) => ({ ...m, s: 1 }),
    );
  });
});
