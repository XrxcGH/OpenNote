// Shape polish. A curved arrow's head follows the end tangent from the library, a handle drag, or recognition at any
// zoom. Its body's last segment runs along that tangent. Double and curved arrows end in a clean V at each head. Every
// recognized shape keeps one even width along its sides.

import { describe, expect, it } from 'vitest';
import { exactOutline, MITER_LIMIT } from '../../../../core/ink/path';
import { seededRandom } from '../fixtures';
import { densify } from '../simplify';
import type { Vec } from '../types';
import { headBarbs } from './arrow';
import { dragHandle } from './edit';
import { arcEnd, curvedArrowBody, sampleArc, shapePoints } from './generate';
import { libraryShape } from './library';
import { recognizeShape } from './recognize';
import type { Shape } from './types';

const deg = (rad: number) => (rad * 180) / Math.PI;
const unit = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const angle = (u: Vec, v: Vec) => Math.abs(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y));

/** The way a head at `tip` points: halfway between the ways each barb runs into the tip. */
function headAxis(tip: Vec, barbs: readonly [Vec, Vec]): Vec {
  const a = unit(sub(tip, barbs[0]));
  const b = unit(sub(tip, barbs[1]));
  return unit({ x: a.x + b.x, y: a.y + b.y });
}

/** The center of the circle through three points. */
function circumcenter(a: Vec, b: Vec, c: Vec): Vec {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const sq = (p: Vec) => p.x * p.x + p.y * p.y;
  return {
    x: (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d,
    y: (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d,
  };
}

const curved = (radius: number, sweep = 2.1): Extract<Shape, { kind: 'curvedArrow' }> => {
  const center = { x: 300, y: 300 };
  const { tip, direction } = arcEnd(center, radius, Math.PI, sweep);
  return { kind: 'curvedArrow', center, radius, start: Math.PI, sweep, barbs: headBarbs(tip, direction, 24) };
};

describe('a curved arrow head', () => {
  it('follows the end tangent from the library, at every size', () => {
    for (const size of [40, 170, 600]) {
      const points = libraryShape('curvedArrow', { x: 500, y: 500 }, size)[0];
      const [b0, tip, b1] = points.slice(-3);
      const body = points.slice(0, -3);
      const center = circumcenter(body[0], body[Math.floor(body.length / 2)], tip);
      const radial = unit(sub(tip, center));
      const forward = unit(sub(tip, body[body.length - 2]));
      const tangent = { x: -radial.y, y: radial.x };
      const along = tangent.x * forward.x + tangent.y * forward.y > 0 ? tangent : { x: -tangent.x, y: -tangent.y };
      expect(deg(angle(headAxis(tip, [b0, b1]), along)), `size ${size}`).toBeLessThan(0.05);
    }
  });

  it('follows the end tangent after either end is dragged', () => {
    const shape = curved(110);
    for (const [id, to] of [
      ['end', { x: 300, y: 160 }],
      ['end', { x: 420, y: 330 }],
      ['start', { x: 200, y: 380 }],
    ] as const) {
      const moved = dragHandle(shape, id, to) as typeof shape;
      const { tip, direction } = arcEnd(moved.center, moved.radius, moved.start, moved.sweep);
      expect(deg(angle(headAxis(tip, moved.barbs), direction)), `${id} to ${to.x},${to.y}`).toBeLessThan(0.05);
    }
  });

  it('follows the end tangent when recognized at every zoom', () => {
    // Drawn the same on screen at each zoom: the page sees it smaller, with denser samples and finer noise.
    for (const zoom of [0.5, 1, 2, 4, 8]) {
      const body = sampleArc({ x: 300 / zoom, y: 300 / zoom }, 110 / zoom, Math.PI, 2.1);
      const tip = body[body.length - 1];
      const way = unit(sub(tip, body[body.length - 2]));
      const [a, b] = headBarbs(tip, way, 28 / zoom);
      const random = seededRandom(Math.round(zoom * 10));
      const drawn = densify([...body, a, tip, b], 3.5 / zoom).map((p) => ({
        x: p.x + ((random() - 0.5) * 1) / zoom,
        y: p.y + ((random() - 0.5) * 1) / zoom,
      }));
      const match = recognizeShape(drawn, { extra: true, width: 2 / zoom });
      expect(match?.shape.kind, `zoom ${zoom}`).toBe('curvedArrow');
      const shape = match!.shape as Extract<Shape, { kind: 'curvedArrow' }>;
      const end = arcEnd(shape.center, shape.radius, shape.start, shape.sweep);
      expect(deg(angle(headAxis(end.tip, shape.barbs), end.direction)), `zoom ${zoom}`).toBeLessThan(0.05);
    }
  });

  it("meets its body's last segment along the tangent, at any radius", () => {
    for (const radius of [8, 30, 110, 400, 2000]) {
      const shape = curved(radius);
      const body = shapePoints(shape).slice(0, -3);
      expect(body).toEqual(curvedArrowBody(shape.center, shape.radius, shape.start, shape.sweep));
      const { tip, direction } = arcEnd(shape.center, shape.radius, shape.start, shape.sweep);
      const last = unit(sub(body[body.length - 1], body[body.length - 2]));
      expect(Math.hypot(body.at(-1)!.x - tip.x, body.at(-1)!.y - tip.y)).toBeLessThan(1e-9);
      expect(deg(angle(last, direction)), `radius ${radius}`).toBeLessThan(0.02);
      // Every body point stays on the circle.
      for (const p of body) expect(Math.hypot(p.x - 300, p.y - 300)).toBeCloseTo(radius, 9);
    }
  });
});

/** The nonzero winding of the filled pieces at `p`: inside when not 0. */
function inside(pieces: readonly Vec[][], p: Vec): boolean {
  let winding = 0;
  for (const poly of pieces) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.y <= p.y) {
        if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) winding++;
      } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) winding--;
    }
  }
  return winding !== 0;
}

/** How far `p` lies from the polyline. */
function fromLine(points: readonly Vec[], p: Vec): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const d = sub(points[i], a);
    const l2 = d.x * d.x + d.y * d.y || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2));
    best = Math.min(best, Math.hypot(p.x - a.x - t * d.x, p.y - a.y - t * d.y));
  }
  return best;
}

const RECOGNIZED: Shape[] = [
  { kind: 'line', from: { x: 0, y: 0 }, to: { x: 200, y: 30 } },
  {
    kind: 'arrow',
    from: { x: 0, y: 0 },
    tip: { x: 200, y: 0 },
    barbs: headBarbs({ x: 200, y: 0 }, { x: 1, y: 0 }, 24),
  },
  {
    kind: 'doubleArrow',
    from: { x: 0, y: 0 },
    to: { x: 200, y: 60 },
    barbsFrom: headBarbs({ x: 0, y: 0 }, unit({ x: -200, y: -60 }), 24),
    barbsTo: headBarbs({ x: 200, y: 60 }, unit({ x: 200, y: 60 }), 24),
  },
  curved(110),
  curved(40, -1.4),
  {
    kind: 'rectangle',
    corners: [
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 90 },
      { x: 0, y: 90 },
    ],
  },
  {
    kind: 'triangle',
    corners: [
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 60, y: 110 },
    ],
  },
  { kind: 'circle', center: { x: 0, y: 0 }, radius: 70 },
  { kind: 'ellipse', center: { x: 0, y: 0 }, rx: 110, ry: 45, rotation: 0.4 },
  { kind: 'polygon', center: { x: 0, y: 0 }, radius: 80, sides: 6, rotation: 0.2 },
  { kind: 'star', center: { x: 0, y: 0 }, outer: 90, inner: 40, points: 5, rotation: 0 },
  { kind: 'arc', center: { x: 0, y: 0 }, radius: 90, start: 0.3, sweep: 2.4 },
] as Shape[];

/** The places along a shape's sides, away from its corners, where its fill is not one band of `width`. */
function uneven(shape: Shape, width: number): string[] {
  const half = width / 2;
  const line = shapePoints(shape);
  const pieces = exactOutline(line, width);
  // Only places farther from every corner than a miter reaches: there the fill is exactly a band.
  const corner = (p: Vec) => line.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < half * MITER_LIMIT + 1e-6);
  const found: string[] = [];
  const check = (on: Vec, n: Vec, what: string) => {
    for (const sign of [1, -1]) {
      const at = (k: number) => ({ x: on.x + n.x * half * k * sign, y: on.y + n.y * half * k * sign });
      if (!inside(pieces, at(0.98))) found.push(`${what}: thin`);
      // Just past the edge is outside unless another part of the line runs there.
      const out = at(1.02);
      if (fromLine(line, out) > half * 1.01 && inside(pieces, out)) found.push(`${what}: bulge`);
    }
  };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const d = sub(line[i], a);
    const n = unit({ x: -d.y, y: d.x });
    const places = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => ({ x: a.x + d.x * t, y: a.y + d.y * t }));
    places.filter((on) => !corner(on)).forEach((on, k) => check(on, n, `${shape.kind} side ${i} place ${k}`));
  }
  return found;
}

describe('recognized shapes', () => {
  it('keep one even width along every side, with no bulge or thin spot between corners', () => {
    for (const width of [1, 4, 9]) {
      for (const shape of RECOGNIZED) expect(uneven(shape, width), `width ${width}`).toEqual([]);
    }
  });

  it('end double and curved arrows in a clean V at each head, with no spike past it', () => {
    const width = 4;
    const half = width / 2;
    const spike = (tip: Vec, axis: Vec, line: readonly Vec[]) =>
      Math.max(
        ...exactOutline(line, width).flatMap((poly) =>
          poly.map((p) => (p.x - tip.x) * axis.x + (p.y - tip.y) * axis.y),
        ),
      );
    // The V of barbs 30 degrees off the shaft reaches half a width over sin 30 past the tip.
    const v = half / Math.sin(Math.PI / 6);
    const double = RECOGNIZED[2] as Extract<Shape, { kind: 'doubleArrow' }>;
    const line = shapePoints(double);
    expect(spike(double.to, headAxis(double.to, double.barbsTo), line)).toBeCloseTo(v, 6);
    expect(spike(double.from, headAxis(double.from, double.barbsFrom), line)).toBeCloseTo(v, 6);
    for (const radius of [30, 110, 400]) {
      const shape = curved(radius);
      const { tip } = arcEnd(shape.center, shape.radius, shape.start, shape.sweep);
      expect(spike(tip, headAxis(tip, shape.barbs), shapePoints(shape)), `radius ${radius}`).toBeCloseTo(v, 6);
    }
  });
});
