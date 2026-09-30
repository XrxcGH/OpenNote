import { describe, expect, it } from 'vitest';
import { ellipsePoints, seededRandom } from '../fixtures';
import { densify } from '../simplify';
import type { Vec } from '../types';
import { snapAngle } from './lines';
import { recognizeShape } from './recognize';
import type { Shape } from './types';

const DEG = Math.PI / 180;

/** A hand-drawn version of a polyline: points every few units, each nudged by up to `noise` units. */
function handDrawn(path: readonly Vec[], seed = 1, noise = 0.8): Vec[] {
  const random = seededRandom(seed);
  return densify(path, 3.5).map((p) => ({
    x: p.x + (random() - 0.5) * 2 * noise,
    y: p.y + (random() - 0.5) * 2 * noise,
  }));
}

function rotated(points: readonly Vec[], degrees: number, about: Vec): Vec[] {
  const cos = Math.cos(degrees * DEG);
  const sin = Math.sin(degrees * DEG);
  return points.map((p) => ({
    x: about.x + (p.x - about.x) * cos - (p.y - about.y) * sin,
    y: about.y + (p.x - about.x) * sin + (p.y - about.y) * cos,
  }));
}

const kind = (shape: Shape | undefined) => shape?.kind;

describe('recognizing lines', () => {
  const line = (degrees: number) =>
    rotated(
      handDrawn(
        [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
        ],
        2,
      ),
      degrees,
      { x: 100, y: 100 },
    );

  it('snaps a line near horizontal to exactly horizontal, keeping its length', () => {
    const match = recognizeShape(line(3))!;
    expect(match.shape.kind).toBe('line');
    if (match.shape.kind !== 'line') return;
    expect(match.shape.from.y).toBeCloseTo(match.shape.to.y, 9);
    expect(Math.hypot(match.shape.to.x - match.shape.from.x, 0)).toBeCloseTo(200, -1);
    expect(match.points).toHaveLength(2);
  });

  it('snaps to 15 degree steps, and to vertical within 6 degrees', () => {
    const angleOf = (degrees: number) => {
      const match = recognizeShape(line(degrees))!;
      if (match.shape.kind !== 'line') throw new Error(`expected a line, got ${match.shape.kind}`);
      const { from, to } = match.shape;
      return Math.atan2(to.y - from.y, to.x - from.x) / DEG;
    };
    expect(angleOf(17)).toBeCloseTo(15, 6);
    expect(angleOf(43)).toBeCloseTo(45, 6);
    expect(angleOf(86)).toBeCloseTo(90, 6);
    expect(angleOf(22)).toBeCloseTo(22, 0);
  });

  it('follows the snapping rule directly', () => {
    expect(snapAngle(5 * DEG) / DEG).toBeCloseTo(0, 9);
    expect(snapAngle(84.5 * DEG) / DEG).toBeCloseTo(90, 9);
    expect(snapAngle(22.5 * DEG) / DEG).toBeCloseTo(22.5, 9);
    expect(snapAngle(-178 * DEG) / DEG).toBeCloseTo(-180, 9);
  });
});

describe('recognizing curves', () => {
  it('recognizes a circle, even when the end overshoots the start', () => {
    const around = ellipsePoints({ center: { x: 200, y: 200 }, rx: 60, ry: 60, count: 70, start: 1, turns: 1.08 });
    const match = recognizeShape(handDrawn(around, 3))!;
    expect(match.shape.kind).toBe('circle');
    if (match.shape.kind !== 'circle') return;
    expect(match.shape.radius).toBeGreaterThan(57);
    expect(match.shape.radius).toBeLessThan(63);
    expect(match.shape.center.x).toBeCloseTo(200, -1);
    expect(match.points[0]).toEqual(match.points[match.points.length - 1]);
    expect(match.confidence).toBeGreaterThan(0.5);
  });

  it('recognizes a tilted ellipse and keeps its tilt', () => {
    const base = ellipsePoints({ center: { x: 200, y: 200 }, rx: 100, ry: 40, count: 80, start: 2 });
    const match = recognizeShape(handDrawn(rotated(base, 30, { x: 200, y: 200 }), 4))!;
    expect(match.shape.kind).toBe('ellipse');
    if (match.shape.kind !== 'ellipse') return;
    expect(match.shape.rotation / DEG).toBeCloseTo(30, -1);
    expect(match.shape.rx).toBeCloseTo(100, -1);
    expect(match.shape.ry).toBeCloseTo(40, -1);
  });

  it('turns an ellipse that is nearly upright fully upright', () => {
    const base = ellipsePoints({ center: { x: 200, y: 200 }, rx: 100, ry: 40, count: 80 });
    const match = recognizeShape(handDrawn(rotated(base, 3, { x: 200, y: 200 }), 5))!;
    if (match.shape.kind !== 'ellipse') throw new Error(`expected an ellipse, got ${match.shape.kind}`);
    expect(match.shape.rotation).toBe(0);
  });

  it('samples curves finely enough to stay within 0.1 units', () => {
    const match = recognizeShape(handDrawn(ellipsePoints({ center: { x: 200, y: 200 }, rx: 60, ry: 60 }), 6))!;
    if (match.shape.kind !== 'circle') throw new Error(`expected a circle, got ${match.shape.kind}`);
    const { center, radius } = match.shape;
    for (let i = 1; i < match.points.length; i++) {
      const mid = {
        x: (match.points[i].x + match.points[i - 1].x) / 2,
        y: (match.points[i].y + match.points[i - 1].y) / 2,
      };
      expect(radius - Math.hypot(mid.x - center.x, mid.y - center.y)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });
});

const box = (w: number, h: number, at: Vec) => [
  at,
  { x: at.x + w, y: at.y },
  { x: at.x + w, y: at.y + h },
  { x: at.x, y: at.y + h },
  at,
];

describe('recognizing polygons', () => {
  it('recognizes an upright rectangle and squares its corners', () => {
    const match = recognizeShape(handDrawn(rotated(box(200, 120, { x: 100, y: 100 }), 4, { x: 200, y: 160 }), 7))!;
    expect(match.shape.kind).toBe('rectangle');
    if (match.shape.kind !== 'rectangle') return;
    const [a, b, c] = match.shape.corners;
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(b.x).toBeCloseTo(c.x, 9);
    expect(Math.abs(b.x - a.x)).toBeCloseTo(200, -1);
    expect(Math.abs(c.y - b.y)).toBeCloseTo(120, -1);
    expect(match.shape.square).toBe(false);
  });
});

describe('recognizing tilted polygons and triangles', () => {
  it('keeps a rectangle that is clearly tilted at its tilt, and finds squares', () => {
    const tilted = recognizeShape(handDrawn(rotated(box(200, 120, { x: 100, y: 100 }), 25, { x: 200, y: 160 }), 8))!;
    if (tilted.shape.kind !== 'rectangle') throw new Error(`expected a rectangle, got ${tilted.shape.kind}`);
    const [a, b] = tilted.shape.corners;
    expect(Math.atan2(b.y - a.y, b.x - a.x) / DEG).toBeCloseTo(25, -1);
    const square = recognizeShape(handDrawn(box(150, 150, { x: 0, y: 0 }), 9))!;
    expect(kind(square.shape)).toBe('rectangle');
    expect(square.shape.kind === 'rectangle' && square.shape.square).toBe(true);
  });

  it('recognizes triangles, and makes near-regular ones regular', () => {
    const general = [
      { x: 100, y: 300 },
      { x: 300, y: 320 },
      { x: 180, y: 120 },
      { x: 100, y: 300 },
    ];
    const s = 160;
    const regular = [
      { x: 100, y: 300 },
      { x: 100 + s, y: 300 },
      { x: 100 + s / 2, y: 300 - s * Math.sin(60 * DEG) + 6 },
      { x: 100, y: 300 },
    ];
    const a = recognizeShape(handDrawn(general, 10))!.shape;
    const b = recognizeShape(handDrawn(regular, 11))!.shape;
    expect(a.kind === 'triangle' && a.variant).toBe('general');
    expect(b.kind === 'triangle' && b.variant).toBe('equilateral');
    if (b.kind !== 'triangle') return;
    const [p, q, r] = b.corners;
    const sides = [
      Math.hypot(p.x - q.x, p.y - q.y),
      Math.hypot(q.x - r.x, q.y - r.y),
      Math.hypot(r.x - p.x, r.y - p.y),
    ];
    expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(1e-6);
  });
});

describe('recognizing right triangles', () => {
  it('makes a nearly right triangle exactly right', () => {
    const right = [
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 290, y: 306 },
      { x: 100, y: 100 },
    ];
    const shape = recognizeShape(handDrawn(right, 12))!.shape;
    if (shape.kind !== 'triangle') throw new Error(`expected a triangle, got ${shape.kind}`);
    expect(shape.variant).toBe('right');
    const [p, q, r] = shape.corners;
    const dots = [
      (q.x - p.x) * (r.x - p.x) + (q.y - p.y) * (r.y - p.y),
      (p.x - q.x) * (r.x - q.x) + (p.y - q.y) * (r.y - q.y),
      (p.x - r.x) * (q.x - r.x) + (p.y - r.y) * (q.y - r.y),
    ];
    expect(Math.min(...dots.map(Math.abs))).toBeLessThan(1e-6);
  });
});

describe('recognizing arrows', () => {
  /** A shaft from (100, 200) to (300, 200) with a head: tip, barb, tip, barb at 28 degrees, 40 units long. */
  const arrow = (degrees: number) => {
    const back = (sign: number): Vec => ({ x: 300 - 40 * Math.cos(28 * DEG), y: 200 + sign * 40 * Math.sin(28 * DEG) });
    const tip = { x: 300, y: 200 };
    return rotated([{ x: 100, y: 200 }, tip, back(1), tip, back(-1)], degrees, { x: 100, y: 200 });
  };

  it('recognizes a shaft with a head as one arrow and redraws the head at 30 degrees', () => {
    const match = recognizeShape(handDrawn(arrow(0), 13))!;
    expect(match.shape.kind).toBe('arrow');
    if (match.shape.kind !== 'arrow') return;
    const { from, tip, barbs } = match.shape;
    expect(from.y).toBeCloseTo(tip.y, 9);
    expect(tip.x - from.x).toBeCloseTo(200, -1);
    const [b1, b2] = barbs;
    expect(b1.x).toBeCloseTo(b2.x, 9);
    expect(b1.y + b2.y).toBeCloseTo(2 * tip.y, 9);
    expect(Math.atan2(tip.y - b1.y, tip.x - b1.x) / DEG).toBeCloseTo(30, 6);
    expect(match.points).toHaveLength(5);
  });

  it('snaps the shaft of a slightly tilted arrow to 15 degree steps', () => {
    const match = recognizeShape(handDrawn(arrow(16), 14))!;
    if (match.shape.kind !== 'arrow') throw new Error(`expected an arrow, got ${match.shape.kind}`);
    const { from, tip } = match.shape;
    expect(Math.atan2(tip.y - from.y, tip.x - from.x) / DEG).toBeCloseTo(15, 6);
  });
});

describe('leaving handwriting and scribbles alone', () => {
  it('rejects tiny strokes, open arcs, and zigzags', () => {
    expect(
      recognizeShape(
        handDrawn(
          [
            { x: 0, y: 0 },
            { x: 8, y: 6 },
          ],
          15,
          0.2,
        ),
      ),
    ).toBeNull();
    const arc = ellipsePoints({ center: { x: 200, y: 200 }, rx: 80, ry: 80, count: 60, turns: 0.7 });
    expect(recognizeShape(handDrawn(arc, 16))).toBeNull();
    const zigzag = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 60 },
      { x: 100, y: 60 },
    ];
    expect(recognizeShape(handDrawn(zigzag, 17))).toBeNull();
  });

  it('rejects a wavy scribble that turns more than three times around', () => {
    const scribble = Array.from({ length: 300 }, (_, i) => ({ x: i * 1.5, y: 30 * Math.sin(i / 3) }));
    expect(recognizeShape(scribble)).toBeNull();
  });

  it('takes under 5 ms for a stroke, judged by the best of several runs', () => {
    const points = handDrawn(ellipsePoints({ center: { x: 200, y: 200 }, rx: 80, ry: 50, count: 90 }), 18);
    recognizeShape(points);
    let best = Infinity;
    for (let i = 0; i < 30; i++) {
      const started = performance.now();
      recognizeShape(points);
      best = Math.min(best, performance.now() - started);
    }
    expect(best).toBeLessThan(5);
  });
});
