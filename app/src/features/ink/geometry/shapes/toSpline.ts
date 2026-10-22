// Making a curve: a line, an arrow, a connector, a recognized shape, or freehand ink becomes an editable curve that
// follows the same path, so its points and handles can be dragged to bend it around other things on the page.

import { distance } from '../primitives';
import { simplify } from '../simplify';
import type { Vec } from '../types';
import { polygonCorners, starCorners } from './generate';
import { withHeads } from './spline';
import type { Spline } from './spline';
import type { Shape } from './types';

const DEGREES = Math.PI / 180;
/** Freehand ink turns a corner where it bends more sharply than this between two kept points. */
const INK_CORNER = 60 * DEGREES;
/** Freehand ink is simplified to this share of its box diagonal before its points become the curve's points. */
const INK_SIMPLIFY = 0.02;
/** Ink that ends this close to where it began, as a share of its box diagonal, makes a closed curve. */
const INK_CLOSE = 0.05;

const third = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** A straight run from `a` to `b` as a curve's segment controls after `a`: two handles on the line and `b`. */
const straight = (a: Vec, b: Vec): Vec[] => [third(a, b, 1 / 3), third(a, b, 2 / 3), b];

/** A curve of corners through `points`; closed when `closed`, and then the first point is not repeated in `points`. */
function cornerCurve(points: readonly Vec[], closed: boolean): Spline {
  const controls: Vec[] = [points[0]];
  const ring = closed ? [...points, points[0]] : points;
  for (let i = 1; i < ring.length; i++) controls.push(ring[i - 1], ring[i], ring[i]);
  return { kind: 'spline', controls, closed };
}

/** Controls for an arc of a circle, in segments of at most a quarter turn. */
function arcControls(center: Vec, radius: number, start: number, sweep: number): Vec[] {
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / count;
  const k = (4 / 3) * Math.tan(step / 4) * radius;
  const at = (angle: number): Vec => ({
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  });
  const tangent = (angle: number): Vec => ({ x: -Math.sin(angle), y: Math.cos(angle) });
  const controls: Vec[] = [at(start)];
  for (let i = 0; i < count; i++) {
    const a = start + step * i;
    const b = a + step;
    const [p0, p3] = [at(a), at(b)];
    const [t0, t3] = [tangent(a), tangent(b)];
    controls.push({ x: p0.x + k * t0.x, y: p0.y + k * t0.y }, { x: p3.x - k * t3.x, y: p3.y - k * t3.y }, p3);
  }
  return controls;
}

/** An ellipse as a closed curve of four smooth points at the ends of its axes. */
function ellipseCurve(center: Vec, rx: number, ry: number, rotation: number): Spline {
  const unitCircle = arcControls({ x: 0, y: 0 }, 1, 0, 2 * Math.PI);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const controls = unitCircle.map((p) => {
    const u = p.x * rx;
    const v = p.y * ry;
    return { x: center.x + u * cos - v * sin, y: center.y + u * sin + v * cos };
  });
  controls[controls.length - 1] = controls[0];
  return { kind: 'spline', controls, closed: true };
}

/** The shape as an editable curve along the same path, or null for a curve already. */
export function toSpline(shape: Shape): Spline | null {
  switch (shape.kind) {
    case 'spline':
      return null;
    case 'line':
      return { kind: 'spline', controls: [shape.from, ...straight(shape.from, shape.to)], closed: false };
    case 'arrow':
      return withHeads({
        kind: 'spline',
        controls: [shape.from, ...straight(shape.from, shape.tip)],
        closed: false,
        endBarbs: shape.barbs,
      });
    case 'doubleArrow':
      return withHeads({
        kind: 'spline',
        controls: [shape.from, ...straight(shape.from, shape.to)],
        closed: false,
        startBarbs: shape.barbsFrom,
        endBarbs: shape.barbsTo,
      });
    case 'arc':
      return {
        kind: 'spline',
        controls: arcControls(shape.center, shape.radius, shape.start, shape.sweep),
        closed: false,
      };
    case 'curvedArrow':
      return withHeads({
        kind: 'spline',
        controls: arcControls(shape.center, shape.radius, shape.start, shape.sweep),
        closed: false,
        endBarbs: shape.barbs,
      });
    case 'circle':
      return ellipseCurve(shape.center, shape.radius, shape.radius, 0);
    case 'ellipse':
      return ellipseCurve(shape.center, shape.rx, shape.ry, shape.rotation);
    case 'rectangle':
    case 'triangle':
    case 'freeform':
      return cornerCurve(shape.corners, true);
    case 'polygon':
      return cornerCurve(polygonCorners(shape.center, shape.radius, shape.sides, shape.rotation).slice(0, -1), true);
    case 'star':
      return cornerCurve(
        starCorners(shape.center, shape.outer, shape.inner, shape.points, shape.rotation).slice(0, -1),
        true,
      );
  }
}

/**
 * Freehand ink as a curve: the stroke is thinned to the points that keep its path, and each becomes a curve point,
 * smooth where the ink flows through it and a corner where it turns sharply. Returns null for ink too small or too
 * short to make one.
 */
export function splineFromInk(points: readonly Vec[]): Spline | null {
  if (points.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  if (diagonal < 2) return null;
  const kept = simplify(
    points.map((p) => ({ x: p.x, y: p.y })),
    Math.max(0.75, INK_SIMPLIFY * diagonal),
  ).filter((p, i, all) => i === 0 || distance(p, all[i - 1]) >= 1);
  if (kept.length < 2) return null;
  const closed = kept.length >= 4 && distance(kept[0], kept[kept.length - 1]) <= INK_CLOSE * diagonal;
  const nodes = closed ? kept.slice(0, -1) : kept;
  const n = nodes.length;
  const neighbor = (i: number): [Vec | null, Vec | null] => [
    closed || i > 0 ? nodes[(i - 1 + n) % n] : null,
    closed || i < n - 1 ? nodes[(i + 1) % n] : null,
  ];
  const handles = nodes.map((at, i) => {
    const [prev, next] = neighbor(i);
    const into = prev ? Math.atan2(at.y - prev.y, at.x - prev.x) : null;
    const outof = next ? Math.atan2(next.y - at.y, next.x - at.x) : null;
    let turn = into !== null && outof !== null ? Math.abs(outof - into) : 0;
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > INK_CORNER) return { in: at, out: at };
    const dx = (next ?? at).x - (prev ?? at).x;
    const dy = (next ?? at).y - (prev ?? at).y;
    const length = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / length, dy / length];
    const back = prev ? distance(at, prev) / 3 : 0;
    const ahead = next ? distance(at, next) / 3 : 0;
    return { in: { x: at.x - ux * back, y: at.y - uy * back }, out: { x: at.x + ux * ahead, y: at.y + uy * ahead } };
  });
  const controls: Vec[] = [nodes[0]];
  const segments = closed ? n : n - 1;
  for (let s = 0; s < segments; s++) {
    const b = (s + 1) % n;
    controls.push(handles[s].out, handles[b].in, nodes[b]);
  }
  return { kind: 'spline', controls, closed };
}
