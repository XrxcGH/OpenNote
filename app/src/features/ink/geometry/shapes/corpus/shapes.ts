// The shapes of the hand-drawn corpus: every shape the recognizer supports, as a hand means to draw it, in all
// sizes, rotations, starting corners, and both directions.

import type { Vec } from '../../types';
import type { ShapeKind } from '../types';
import {
  arcPoints,
  around,
  curve,
  DEG,
  densePolyline,
  pick,
  polyline,
  regular,
  rotate,
  rotateAll,
  uniform,
  type Intent,
  type Rand,
} from './intent';

/** An oval as a hand draws it. It is a little egg-shaped and lumpy, and spirals in or out. It may overrun its start. */
function oval(r: Rand, rx: number, ry: number): Intent {
  const start = uniform(r, 0, 2 * Math.PI);
  const way = r() < 0.5 ? 1 : -1;
  const turns = 1 + (r() < 0.75 ? uniform(r, 0, 0.22) : uniform(r, -0.07, 0));
  const egg = uniform(r, 0, 0.035);
  const lump = uniform(r, 0, 0.015);
  const [p2, p3] = [uniform(r, 0, 6.3), uniform(r, 0, 6.3)];
  const spiral = uniform(r, -0.05, 0.05);
  const count = Math.ceil(Math.max(rx, ry) * 2 * Math.PI * turns);
  const points = Array.from({ length: count + 1 }, (_, k) => {
    const s = k / count;
    const a = start + way * 2 * Math.PI * turns * s;
    const scale = (1 + egg * Math.cos(a + p2) + lump * Math.cos(3 * a + p3)) * (1 + spiral * s);
    return { x: rx * scale * Math.cos(a), y: ry * scale * Math.sin(a) };
  });
  return curve(points);
}

/** An arrow's head drawn in the same stroke: out along one barb, back to the tip, out along the other. */
function head(tip: Vec, back: number, r: Rand, length: number): Vec[] {
  const spread = [uniform(r, 20, 45) * DEG, uniform(r, 20, 45) * DEG];
  const first = r() < 0.5 ? 1 : -1;
  const barb = (sign: number, angle: number): Vec => ({
    x: tip.x + length * uniform(r, 0.8, 1.2) * Math.cos(back + sign * angle),
    y: tip.y + length * uniform(r, 0.8, 1.2) * Math.sin(back + sign * angle),
  });
  return [barb(first, spread[0]), tip, barb(-first, spread[1])];
}
export interface ShapeSpec {
  readonly name: string;
  readonly expect: ShapeKind;
  readonly extraOnly?: boolean;
  /** The intent, about `size` across, centered on the origin. */
  readonly make: (r: Rand, size: number) => Intent;
}

/** A rotation that keeps a box level most of the time, as people draw boxes, and turns it freely otherwise. */
const boxTurn = (r: Rand): number => (r() < 0.65 ? uniform(r, -4, 4) * DEG : uniform(r, 0, Math.PI));
const startAndWay = (r: Rand, n: number): [number, boolean] => [Math.floor(r() * n), r() < 0.5];

function box(r: Rand, w: number, h: number, turn: number): Intent {
  const corners = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => rotate(p, turn));
  const [from, reverse] = r() < 0.5 ? [0, false] : startAndWay(r, 4);
  return polyline(around(corners, from, reverse), true);
}

function closedShape(r: Rand, corners: Vec[]): Intent {
  const [from, reverse] = startAndWay(r, corners.length);
  return polyline(around(corners, from, reverse), true);
}

/** Corners of a triangle with the given angles (degrees, summing to 180), about `size` across. */
function triangle(angles: readonly [number, number, number], size: number, turn: number): Vec[] {
  const [a, b] = [angles[0] * DEG, angles[1] * DEG];
  const third = Math.PI - a - b;
  const base = size;
  const side = (base * Math.sin(b)) / Math.sin(third);
  const pts = [
    { x: 0, y: 0 },
    { x: base, y: 0 },
    { x: side * Math.cos(a), y: -side * Math.sin(a) },
  ];
  const c = { x: (pts[0].x + pts[1].x + pts[2].x) / 3, y: (pts[0].y + pts[1].y + pts[2].y) / 3 };
  return rotateAll(
    pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y })),
    turn,
  );
}

export const SHAPES: readonly ShapeSpec[] = [
  {
    name: 'line',
    expect: 'line',
    make: (r, size) =>
      polyline(
        rotateAll(
          [
            { x: -size / 2, y: 0 },
            { x: size / 2, y: 0 },
          ],
          uniform(r, 0, 2 * Math.PI),
        ),
      ),
  },
  {
    name: 'arrow',
    expect: 'arrow',
    make: (r, size) => {
      const turn = uniform(r, 0, 2 * Math.PI);
      const tail = rotate({ x: -size / 2, y: 0 }, turn);
      const tip = rotate({ x: size / 2, y: 0 }, turn);
      return polyline([tail, tip, ...head(tip, turn + Math.PI, r, size * uniform(r, 0.12, 0.28))]);
    },
  },
  {
    name: 'rectangle',
    expect: 'rectangle',
    make: (r, size) => {
      const aspect = uniform(r, 1.25, 2.8);
      const w = size / Math.hypot(1, 1 / aspect);
      return box(r, w, w / aspect, boxTurn(r));
    },
  },
  {
    name: 'square',
    expect: 'rectangle',
    make: (r, size) => box(r, size / Math.SQRT2, size / Math.SQRT2, boxTurn(r)),
  },
  {
    name: 'diamond',
    expect: 'rectangle',
    make: (r, size) => box(r, size / Math.SQRT2, size / Math.SQRT2, (45 + uniform(r, -4, 4)) * DEG),
  },
  {
    name: 'equilateral triangle',
    expect: 'triangle',
    make: (r, size) => closedShape(r, triangle([60, 60, 60], size, uniform(r, 0, 2 * Math.PI))),
  },
  {
    name: 'right triangle',
    expect: 'triangle',
    make: (r, size) => {
      const a = uniform(r, 30, 60);
      return closedShape(
        r,
        triangle([90, a, 90 - a], size, pick(r, [0, 90, 180, 270]) * DEG + uniform(r, -4, 4) * DEG),
      );
    },
  },
  {
    name: 'isosceles triangle',
    expect: 'triangle',
    make: (r, size) => {
      const apex = uniform(r, 30, 100);
      const base = (180 - apex) / 2;
      return closedShape(r, triangle([base, base, apex], size, uniform(r, -6, 6) * DEG));
    },
  },
  {
    name: 'obtuse triangle',
    expect: 'triangle',
    make: (r, size) => {
      const wide = uniform(r, 100, 125);
      const a = uniform(r, 22, 180 - wide - 22);
      return closedShape(r, triangle([a, 180 - wide - a, wide], size, uniform(r, 0, 2 * Math.PI)));
    },
  },
  {
    name: 'circle',
    expect: 'circle',
    make: (r, size) => {
      const radius = size / 2;
      const aspect = uniform(r, 0.94, 1.06);
      const o = oval(r, radius * Math.sqrt(aspect), radius / Math.sqrt(aspect));
      return { ...o, points: rotateAll(o.points, uniform(r, 0, Math.PI)) };
    },
  },
  {
    name: 'ellipse',
    expect: 'ellipse',
    make: (r, size) => {
      const aspect = uniform(r, 1.5, 2.6);
      const rx = size / 2;
      const o = oval(r, rx, rx / aspect);
      return { ...o, points: rotateAll(o.points, r() < 0.6 ? uniform(r, -5, 5) * DEG : uniform(r, 0, Math.PI)) };
    },
  },
  {
    name: 'pentagon',
    expect: 'polygon',
    extraOnly: true,
    make: (r, size) => closedShape(r, regular(5, size / 2, uniform(r, 0, 2 * Math.PI))),
  },
  {
    name: 'hexagon',
    expect: 'polygon',
    extraOnly: true,
    make: (r, size) => closedShape(r, regular(6, size / 2, uniform(r, 0, 2 * Math.PI))),
  },
  {
    name: 'star',
    expect: 'star',
    extraOnly: true,
    make: (r, size) => {
      const inner = uniform(r, 0.36, 0.5);
      const turn = -Math.PI / 2 + uniform(r, -8, 8) * DEG;
      const tips = Array.from({ length: 10 }, (_, i) => {
        const radius = ((i % 2 === 0 ? 1 : inner) * size) / 2;
        return { x: radius * Math.cos(turn + (Math.PI * i) / 5), y: radius * Math.sin(turn + (Math.PI * i) / 5) };
      });
      return polyline(around(tips, 0, r() < 0.5), true);
    },
  },
  {
    name: 'trapezoid',
    expect: 'freeform',
    extraOnly: true,
    make: (r, size) => {
      const w = size * 0.8;
      const top = w * uniform(r, 0.4, 0.65);
      const h = w * uniform(r, 0.45, 0.7);
      const corners = [
        { x: -top / 2, y: -h / 2 },
        { x: top / 2, y: -h / 2 },
        { x: w / 2, y: h / 2 },
        { x: -w / 2, y: h / 2 },
      ];
      return closedShape(r, rotateAll(corners, uniform(r, -5, 5) * DEG));
    },
  },
  {
    name: 'parallelogram',
    expect: 'freeform',
    extraOnly: true,
    make: (r, size) => {
      const w = size * 0.65;
      const h = w * uniform(r, 0.45, 0.65);
      const skew = h * uniform(r, 0.5, 0.8);
      const corners = [
        { x: -w / 2 + skew / 2, y: -h / 2 },
        { x: w / 2 + skew / 2, y: -h / 2 },
        { x: w / 2 - skew / 2, y: h / 2 },
        { x: -w / 2 - skew / 2, y: h / 2 },
      ];
      return closedShape(r, rotateAll(corners, uniform(r, -5, 5) * DEG));
    },
  },
  {
    name: 'house',
    expect: 'freeform',
    extraOnly: true,
    make: (r, size) => {
      const w = size * 0.6;
      const wall = w * uniform(r, 0.6, 0.9);
      const roof = w * uniform(r, 0.35, 0.6);
      const corners = [
        { x: 0, y: -roof - wall / 2 },
        { x: w / 2, y: -wall / 2 },
        { x: w / 2, y: wall / 2 },
        { x: -w / 2, y: wall / 2 },
        { x: -w / 2, y: -wall / 2 },
      ];
      return closedShape(r, rotateAll(corners, uniform(r, -5, 5) * DEG));
    },
  },
  {
    name: 'L shape',
    expect: 'freeform',
    extraOnly: true,
    make: (r, size) => {
      const s = size * 0.65;
      const t = s * uniform(r, 0.3, 0.45);
      const corners = [
        { x: -s / 2, y: -s / 2 },
        { x: -s / 2 + t, y: -s / 2 },
        { x: -s / 2 + t, y: s / 2 - t },
        { x: s / 2, y: s / 2 - t },
        { x: s / 2, y: s / 2 },
        { x: -s / 2, y: s / 2 },
      ];
      return closedShape(r, rotateAll(corners, pick(r, [0, 90, 180, 270]) * DEG + uniform(r, -4, 4) * DEG));
    },
  },
  {
    name: 'kite',
    expect: 'freeform',
    extraOnly: true,
    make: (r, size) => {
      const h = size * 0.9;
      const w = h * uniform(r, 0.45, 0.65);
      const cross = h * uniform(r, 0.25, 0.35);
      const corners = [
        { x: 0, y: -h / 2 },
        { x: w / 2, y: -h / 2 + cross },
        { x: 0, y: h / 2 },
        { x: -w / 2, y: -h / 2 + cross },
      ];
      return closedShape(r, rotateAll(corners, uniform(r, -6, 6) * DEG));
    },
  },
  {
    name: 'arc',
    expect: 'arc',
    extraOnly: true,
    make: (r, size) => {
      const sweep = uniform(r, 70, 220) * DEG * (r() < 0.5 ? 1 : -1);
      const radius = size / 2;
      return curve(arcPoints(radius, uniform(r, 0, 2 * Math.PI), sweep));
    },
  },
  {
    name: 'curved arrow',
    expect: 'curvedArrow',
    extraOnly: true,
    make: (r, size) => {
      const sweep = uniform(r, 70, 200) * DEG * (r() < 0.5 ? 1 : -1);
      const radius = size / 2;
      const start = uniform(r, 0, 2 * Math.PI);
      const body = arcPoints(radius, start, sweep);
      const tip = body[body.length - 1];
      const before = body[body.length - 3];
      const back = Math.atan2(before.y - tip.y, before.x - tip.x);
      return curve([...body, ...densePolyline(head(tip, back, r, radius * uniform(r, 0.25, 0.45)))]);
    },
  },
  {
    name: 'double arrow',
    expect: 'doubleArrow',
    extraOnly: true,
    make: (r, size) => {
      const turn = uniform(r, 0, 2 * Math.PI);
      const from = rotate({ x: -size / 2, y: 0 }, turn);
      const to = rotate({ x: size / 2, y: 0 }, turn);
      const length = size * uniform(r, 0.12, 0.25);
      const first = head(from, turn, r, length);
      return polyline([first[2], from, first[0], from, to, ...head(to, turn + Math.PI, r, length)]);
    },
  },
];
