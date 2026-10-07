// Shapes snapped to the paper's lines: lines, arrows, rectangles, ellipses, circles, triangles, polygons, library
// shapes, moves, and keyboard nudges, on ruled, grid, and dot paper, with the header, sheets, zoom, and Alt.
import { describe, expect, it } from 'vitest';
import { snapToLattice, UNBOUNDED } from '../../../core/paperLattice';
import type { PaperLattice } from '../../../core/paperLattice';
import { shapePoints } from '../geometry/shapes';
import type { Shape } from '../geometry/shapes';
import type { Vec } from '../geometry/types';
import { anchorsOf, nudge, paperSnapFor, snapMove, snapPolylines, snapShape } from './paper';
import type { PaperSnap } from './paper';

const H = 1056;
const grid: PaperLattice = {
  kind: 'grid',
  step: 20,
  origin: { x: 96, y: 72 },
  area: { x: 96, y: 72, w: 620, h: 900 },
  sheet: H,
  margin: null,
  from: 132,
};
const dots: PaperLattice = { ...grid, kind: 'dots' };
const ruled: PaperLattice = {
  kind: 'ruled',
  step: 26,
  origin: { x: 96, y: 72 },
  area: { x: 0, y: 98, w: 816, h: 886 },
  sheet: H,
  margin: 96,
};
const at = (lattice: PaperLattice, zoom = 1): PaperSnap => paperSnapFor(lattice, zoom, { on: true, alt: false })!;

/** True when a point is on a line of the lattice: snapping it with no reach leaves it where it is. */
function onPaper(lattice: PaperLattice, p: Vec, axis: 'x' | 'y' | 'both' = 'both'): boolean {
  const hit = snapToLattice(lattice, p, 1e-6);
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
  const x = hit.x && near(hit.point.x, p.x);
  const y = hit.y && near(hit.point.y, p.y);
  return axis === 'x' ? x : axis === 'y' ? y : x && y;
}

describe('paperSnapFor', () => {
  it('is off for paper with no lines, when snapping is off, and while Alt is held', () => {
    expect(paperSnapFor(null, 1, { on: true, alt: false })).toBeNull();
    expect(paperSnapFor(grid, 1, { on: false, alt: false })).toBeNull();
    expect(paperSnapFor(grid, 1, { on: true, alt: true })).toBeNull();
  });

  it('reaches a third of the spacing, and at least 6 screen pixels at 50 percent', () => {
    expect(at(grid, 1).reach).toBeCloseTo(20 / 3);
    expect(at(grid, 2).reach).toBeCloseTo(20 / 3);
    expect(at({ ...grid, step: 12 }, 0.5).reach).toBe(6);
  });
});

describe('snapShape', () => {
  it('puts both ends of a line near crossings on the crossings', () => {
    const line: Shape = { kind: 'line', from: { x: 137, y: 153 }, to: { x: 214, y: 237 } };
    const { shape, marks } = snapShape(at(grid), line);
    expect(shape).toEqual({ kind: 'line', from: { x: 136, y: 152 }, to: { x: 216, y: 232 } });
    expect(marks).toHaveLength(2);
  });

  it('keeps a level line level when one end reaches a line', () => {
    const line: Shape = { kind: 'line', from: { x: 140, y: 154 }, to: { x: 300, y: 154 } };
    const { shape } = snapShape(at(grid), line);
    expect(shape.kind === 'line' && shape.from.y === 152 && shape.to.y === 152).toBe(true);
  });

  it('lays a line drawn close to level on ruled paper on the nearest rule, however far', () => {
    const line: Shape = { kind: 'line', from: { x: 150, y: 136 }, to: { x: 400, y: 140 } };
    const { shape } = snapShape(at(ruled), line);
    if (shape.kind !== 'line') throw new Error('not a line');
    expect(shape.from.y).toBe(150);
    expect(shape.to.y).toBe(150);
    expect(shape.from.x).toBe(150);
  });

  it('snaps an arrow by its tail and tip and keeps its head', () => {
    const arrow: Shape = {
      kind: 'arrow',
      from: { x: 135, y: 191 },
      tip: { x: 296, y: 254 },
      barbs: [
        { x: 280, y: 240 },
        { x: 284, y: 262 },
      ],
    };
    const { shape } = snapShape(at(grid), arrow);
    if (shape.kind !== 'arrow') throw new Error('not an arrow');
    expect(shape.from).toEqual({ x: 136, y: 192 });
    expect(shape.tip).toEqual({ x: 296, y: 252 });
    for (const barb of shape.barbs) expect(Math.hypot(barb.x - 296, barb.y - 252)).toBeGreaterThan(5);
  });

  it('gives a rectangle whose corners reach lines a size in whole spacings', () => {
    const corners: [Vec, Vec, Vec, Vec] = [
      { x: 138, y: 151 },
      { x: 254, y: 151 },
      { x: 254, y: 233 },
      { x: 138, y: 233 },
    ];
    const { shape } = snapShape(at(grid), { kind: 'rectangle', corners, square: false });
    if (shape.kind !== 'rectangle') throw new Error('not a rectangle');
    for (const corner of shape.corners) expect(onPaper(grid, corner)).toBe(true);
    expect((shape.corners[1].x - shape.corners[0].x) % 20).toBeCloseTo(0);
  });

  it('moves a rectangle by one corner when only that one reaches, keeping its size', () => {
    const corners: [Vec, Vec, Vec, Vec] = [
      { x: 138, y: 151 },
      { x: 248, y: 151 },
      { x: 248, y: 241 },
      { x: 138, y: 241 },
    ];
    const { shape } = snapShape(at(grid), { kind: 'rectangle', corners, square: false });
    if (shape.kind !== 'rectangle') throw new Error('not a rectangle');
    expect(shape.corners[0]).toEqual({ x: 136, y: 152 });
    expect(shape.corners[2]).toEqual({ x: 246, y: 242 });
  });

  it('snaps an ellipse by its box, and keeps a circle round', () => {
    const ellipse = snapShape(at(grid), { kind: 'ellipse', center: { x: 197, y: 213 }, rx: 61, ry: 41, rotation: 0 });
    if (ellipse.shape.kind !== 'ellipse') throw new Error('not an ellipse');
    expect(ellipse.shape).toMatchObject({ center: { x: 196, y: 212 }, rx: 60, ry: 40 });
    const circle = snapShape(at(grid), { kind: 'circle', center: { x: 197, y: 213 }, radius: 39 });
    if (circle.shape.kind !== 'circle') throw new Error('not a circle');
    expect(circle.shape.radius).toBe(40);
    expect(onPaper(grid, { x: circle.shape.center.x - 40, y: circle.shape.center.y - 40 })).toBe(true);
  });

  it('snaps each corner of a triangle and the middle and a corner of a polygon', () => {
    const tri = snapShape(at(grid), {
      kind: 'triangle',
      corners: [
        { x: 137, y: 153 },
        { x: 257, y: 153 },
        { x: 195, y: 233 },
      ],
      variant: 'general',
    });
    if (tri.shape.kind !== 'triangle') throw new Error('not a triangle');
    for (const corner of tri.shape.corners) expect(onPaper(grid, corner)).toBe(true);
    const pentagon = snapShape(at(grid), {
      kind: 'polygon',
      sides: 5,
      center: { x: 297, y: 333 },
      radius: 40,
      rotation: -Math.PI / 2,
    });
    if (pentagon.shape.kind !== 'polygon') throw new Error('not a polygon');
    expect(pentagon.shape.center).toEqual({ x: 296, y: 332 });
    expect(onPaper(grid, shapePoints(pentagon.shape)[0])).toBe(true);
  });

  it('snaps to dots only where a dot is near, never to a row alone', () => {
    const near = snapShape(at(dots), { kind: 'line', from: { x: 137, y: 153 }, to: { x: 214, y: 237 } });
    if (near.shape.kind !== 'line') throw new Error('not a line');
    expect(near.shape.from).toEqual({ x: 136, y: 152 });
    const far = snapShape(at(dots), { kind: 'line', from: { x: 146, y: 153 }, to: { x: 205, y: 223 } });
    expect(far.marks).toHaveLength(0);
  });

  it('snaps to the lines of a later sheet, and never into the header of the first', () => {
    const line: Shape = { kind: 'line', from: { x: 137, y: H + 93 }, to: { x: 214, y: H + 151 } };
    const { shape } = snapShape(at(grid), line);
    if (shape.kind !== 'line') throw new Error('not a line');
    expect(shape.from).toEqual({ x: 136, y: H + 92 });
    const header = snapShape(at(grid), { kind: 'line', from: { x: 137, y: 110 }, to: { x: 137, y: 300 } });
    if (header.shape.kind !== 'line') throw new Error('not a line');
    expect(header.shape.from.y).toBe(110);
  });

  it('snaps alike at 50, 100, and 200 percent when the paper is coarse enough', () => {
    const line: Shape = { kind: 'line', from: { x: 141, y: 157 }, to: { x: 210, y: 228 } };
    for (const zoom of [0.5, 1, 2]) {
      const { shape } = snapShape(at(grid, zoom), line);
      expect(shape.kind === 'line' && shape.from).toEqual({ x: 136, y: 152 });
    }
  });
});

describe('snapPolylines', () => {
  it('fits a library shape to whole spacings on the paper', () => {
    const square = [
      { x: 113, y: 155 },
      { x: 277, y: 155 },
      { x: 277, y: 330 },
      { x: 113, y: 330 },
      { x: 113, y: 155 },
    ];
    const { lines } = snapPolylines(at(grid), [square]);
    for (const p of lines[0]) expect(onPaper(grid, p)).toBe(true);
  });
});

describe('moves and nudges', () => {
  const rect: Shape = {
    kind: 'rectangle',
    corners: [
      { x: 136, y: 152 },
      { x: 236, y: 152 },
      { x: 236, y: 212 },
      { x: 136, y: 212 },
    ],
    square: false,
  };

  it('snaps a drag so the shape lands on the lines', () => {
    const { delta, marks } = snapMove(at(grid), anchorsOf(rect), { x: 43, y: 23 });
    expect(delta).toEqual({ x: 40, y: 20 });
    expect(marks.length).toBeGreaterThan(0);
  });

  it('moves a shape one spacing with each arrow key', () => {
    expect(nudge(at(grid), anchorsOf(rect), [1, 0])).toEqual({ x: 20, y: 0 });
    expect(nudge(at(grid), anchorsOf(rect), [0, -1])).toEqual({ x: 0, y: -20 });
    expect(nudge(at(ruled), [{ x: 140, y: 150 }], [1, 0])).toEqual({ x: 26, y: 0 });
    expect(nudge(at(ruled), [{ x: 140, y: 140 }], [0, 1])).toEqual({ x: 0, y: 10 });
  });

  it('works on a page with no sheets', () => {
    const infinite: PaperLattice = { ...grid, area: UNBOUNDED, sheet: null, from: undefined };
    const { delta } = snapMove(at(infinite), [{ x: 5016, y: 8992 }], { x: 21, y: 18 });
    expect(delta).toEqual({ x: 20, y: 20 });
  });
});
