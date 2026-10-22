// Editable curves: a chain of cubic Bezier segments with a point at each join and a handle on each side of it. The
// controls are stored flat, as a Bezier path's control polygon: point, out handle, next point's in handle, next point,
// and so on, so code that moves every point of a shape moves a curve too. A closed curve repeats its first point at
// the end. A point whose two handles lie on one line through it is smooth; one whose handles are folded into it, or
// point different ways, is a corner.
//
// A curve is stored like any shape, as an ordinary stroke of exact points: its first point twice, then 24 samples a
// segment at even steps of the curve's parameter, then the head of an arrow at either end. Reading the samples back
// with a least-squares fit gives each segment's handles to within the stroke's 1/64 unit steps, and no other shape
// starts on a doubled point, so a curve reads back as a curve (and an older version shows it as an ordinary shape).

import { distance } from '../primitives';
import type { Vec } from '../types';
import { headBarbs } from './arrow';
import type { Shape } from './types';

export type Spline = Extract<Shape, { kind: 'spline' }>;

/** Samples a segment stores, at even steps of its parameter. */
export const SEGMENT_SAMPLES = 24;
/** How far a stored sample may stray from the curve read back, in page units, before it is no curve. */
export const READ_TOLERANCE = 0.06;
/** Handles shorter than this, in page units, are folded into their point. */
const FOLDED = 0.5;
const DEGREES = Math.PI / 180;
/** Handles within this angle of one line read back as smooth. */
const SMOOTH_ANGLE = 3 * DEGREES;

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const mix = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const unit = (v: Vec): Vec | null => {
  const length = Math.hypot(v.x, v.y);
  return length < 1e-9 ? null : { x: v.x / length, y: v.y / length };
};

/** The point of one cubic segment at parameter `t`. */
export function bezierAt(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const [b0, b1, b2, b3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x, y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y };
}

/** How many segments a curve has. */
export function segmentCount(shape: Spline): number {
  return (shape.controls.length - 1) / 3;
}

/** How many points a curve has: a closed curve's repeated first point counts once. */
export function nodeCount(shape: Spline): number {
  return segmentCount(shape) + (shape.closed ? 0 : 1);
}

/** The four controls of segment `s`. */
export function segmentOf(shape: Spline, s: number): readonly [Vec, Vec, Vec, Vec] {
  const c = shape.controls;
  return [c[3 * s], c[3 * s + 1], c[3 * s + 2], c[3 * s + 3]];
}

/** Indices into the controls of point `k`'s in handle and out handle, or -1 where an open curve's end has none. */
function handleIndices(shape: Spline, k: number): { at: number; in: number; out: number } {
  const n = nodeCount(shape);
  const last = shape.controls.length - 1;
  if (shape.closed) return { at: 3 * k, in: k === 0 ? last - 1 : 3 * k - 1, out: 3 * k + 1 };
  return { at: 3 * k, in: k === 0 ? -1 : 3 * k - 1, out: k === n - 1 ? -1 : 3 * k + 1 };
}

/** Point `k` and its handles; a missing handle at an open curve's end is folded into the point. */
export function nodeOf(shape: Spline, k: number): { at: Vec; in: Vec; out: Vec } {
  const i = handleIndices(shape, k);
  const at = shape.controls[i.at];
  return { at, in: i.in < 0 ? at : shape.controls[i.in], out: i.out < 0 ? at : shape.controls[i.out] };
}

/** True when point `k`'s handles lie on one line through it: dragging one turns the other with it. */
export function isSmooth(shape: Spline, k: number): boolean {
  const { at, in: before, out: after } = nodeOf(shape, k);
  const a = sub(at, before);
  const b = sub(after, at);
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la < FOLDED && lb < FOLDED) return false;
  const i = handleIndices(shape, k);
  // An open curve's end has one handle: it is smooth while that handle is out.
  if (i.in < 0) return lb >= FOLDED;
  if (i.out < 0) return la >= FOLDED;
  if (la < FOLDED || lb < FOLDED) return false;
  const cross = (a.x * b.y - a.y * b.x) / (la * lb);
  const dot = (a.x * b.x + a.y * b.y) / (la * lb);
  const slack = Math.max(SMOOTH_ANGLE, Math.atan(READ_TOLERANCE / Math.min(la, lb)));
  return dot > 0 && Math.abs(Math.atan2(cross, dot)) <= slack;
}

/** The curve's samples, from its first point to its last, as the stroke stores them after the doubled first point. */
export function sampleSpline(shape: Spline): Vec[] {
  const out: Vec[] = [shape.controls[0]];
  for (let s = 0; s < segmentCount(shape); s++) {
    const [p0, p1, p2, p3] = segmentOf(shape, s);
    for (let j = 1; j <= SEGMENT_SAMPLES; j++) out.push(bezierAt(p0, p1, p2, p3, j / SEGMENT_SAMPLES));
  }
  return out;
}

/** The polyline a curve stores: the head at its start, its first point twice, its samples, and the head at its end. */
export function splinePoints(shape: Spline): Vec[] {
  const body = sampleSpline(shape);
  const start = shape.startBarbs ? [shape.startBarbs[0], body[0], shape.startBarbs[1]] : [];
  const tip = body[body.length - 1];
  const end = shape.endBarbs ? [shape.endBarbs[0], tip, shape.endBarbs[1]] : [];
  return [...start, body[0], ...body, ...end];
}

/** The way the curve heads at its end (or, with `start`, back out of its start), for an arrow's head. */
function endDirection(shape: Spline, start: boolean): Vec | null {
  const c = shape.controls;
  const order = start ? c.slice(0, 4) : c.slice(-4).reverse();
  for (let i = 1; i < order.length; i++) {
    const d = unit(sub(order[0], order[i]));
    if (d) return d;
  }
  return null;
}

/** The curve with its arrow heads redrawn at its ends, the length they had. */
export function withHeads(shape: Spline): Spline {
  const redo = (barbs: readonly [Vec, Vec] | undefined, start: boolean): readonly [Vec, Vec] | undefined => {
    if (!barbs) return undefined;
    const tip = start ? shape.controls[0] : shape.controls[shape.controls.length - 1];
    const direction = endDirection(shape, start);
    return direction ? headBarbs(tip, direction, distance(tip, barbs[0]) || 12) : barbs;
  };
  const startBarbs = redo(shape.startBarbs, true);
  const endBarbs = redo(shape.endBarbs, false);
  return {
    ...shape,
    ...(startBarbs ? { startBarbs } : {}),
    ...(endBarbs ? { endBarbs } : {}),
  };
}

/** Solves for the two inner controls of a segment from its samples, by least squares with the ends held. */
function fitSegment(samples: readonly Vec[], p0: Vec, p3: Vec): [Vec, Vec] {
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let rx1 = 0;
  let ry1 = 0;
  let rx2 = 0;
  let ry2 = 0;
  for (let j = 0; j < samples.length; j++) {
    const t = j / (samples.length - 1);
    const u = 1 - t;
    const [b0, b1, b2, b3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    const rx = samples[j].x - b0 * p0.x - b3 * p3.x;
    const ry = samples[j].y - b0 * p0.y - b3 * p3.y;
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    rx1 += b1 * rx;
    ry1 += b1 * ry;
    rx2 += b2 * rx;
    ry2 += b2 * ry;
  }
  const det = a11 * a22 - a12 * a12;
  return [
    { x: (a22 * rx1 - a12 * rx2) / det, y: (a22 * ry1 - a12 * ry2) / det },
    { x: (a11 * rx2 - a12 * rx1) / det, y: (a11 * ry2 - a12 * ry1) / det },
  ];
}

/**
 * The curve a stored stroke holds, read back from its points, or null when it holds none. `tolerance` grows with the
 * stroke's scale when it was resized, since its stored steps grow with it.
 */
export function readSpline(points: readonly Vec[], tolerance = READ_TOLERANCE): Spline | null {
  const same = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
  for (const [s, e] of [
    [0, 0],
    [0, 3],
    [3, 0],
    [3, 3],
  ] as const) {
    const body = points.slice(s, points.length - e);
    if (body.length < SEGMENT_SAMPLES + 2 || (body.length - 2) % SEGMENT_SAMPLES !== 0) continue;
    if (body[0].x !== body[1].x || body[0].y !== body[1].y) continue;
    const samples = body.slice(1);
    if (s && !same(points[1], samples[0])) continue;
    if (e && !same(points[points.length - 2], samples[samples.length - 1])) continue;
    const controls: Vec[] = [samples[0]];
    let fits = true;
    for (let k = 0; fits && k + SEGMENT_SAMPLES < samples.length; k += SEGMENT_SAMPLES) {
      const run = samples.slice(k, k + SEGMENT_SAMPLES + 1);
      const [p0, p3] = [run[0], run[run.length - 1]];
      const [p1, p2] = fitSegment(run, p0, p3);
      fits = run.every(
        (q, j) => distance(q, bezierAt(p0, p1, p2, p3, j / SEGMENT_SAMPLES)) <= tolerance && Number.isFinite(p1.x),
      );
      controls.push(p1, p2, p3);
    }
    if (!fits) continue;
    const closed = !s && !e && controls.length >= 7 && same(controls[0], controls[controls.length - 1]);
    if (closed) controls[controls.length - 1] = controls[0];
    return {
      kind: 'spline',
      controls,
      closed,
      ...(s ? { startBarbs: [points[0], points[2]] as const } : {}),
      ...(e ? { endBarbs: [points[points.length - 3], points[points.length - 1]] as const } : {}),
    };
  }
  return null;
}

/** Replaces some controls, keeping a closed curve's repeated first point in step. */
function withControls(shape: Spline, change: (controls: Vec[]) => void): Spline {
  const controls = [...shape.controls];
  change(controls);
  return withHeads({ ...shape, controls });
}

/**
 * The curve after a handle is dragged to a page point. `n3` moves point 3 with its handles; `i3` and `o3` move its in
 * and out handle, and on a smooth point the other handle turns to stay on its line, keeping its length. `from` and
 * `to` move the ends of an open curve, for connectors.
 */
export function dragSpline(shape: Spline, id: string, to: Vec): Spline {
  const n = nodeCount(shape);
  const kind = id === 'from' ? 'n' : id === 'to' ? 'n' : id[0];
  const k = id === 'from' ? 0 : id === 'to' ? n - 1 : Number(id.slice(1));
  if (!(k >= 0 && k < n) || !Number.isInteger(k) || !'nio'.includes(kind)) return shape;
  const i = handleIndices(shape, k);
  const last = shape.controls.length - 1;
  if (kind === 'n') {
    return withControls(shape, (c) => {
      const delta = sub(to, c[i.at]);
      for (const index of [i.at, i.in, i.out]) if (index >= 0) c[index] = add(c[index], delta);
      if (shape.closed && k === 0) c[last] = c[0];
    });
  }
  const moved = kind === 'i' ? i.in : i.out;
  const other = kind === 'i' ? i.out : i.in;
  if (moved < 0) return shape;
  const smooth = other >= 0 && isSmooth(shape, k);
  return withControls(shape, (c) => {
    c[moved] = to;
    if (!smooth) return;
    const at = c[i.at];
    const direction = unit(sub(at, to));
    const length = distance(at, c[other]);
    if (direction && length >= FOLDED) c[other] = add(at, scale(direction, length));
  });
}

/** The handles a curve shows: each point, then each handle that is not folded into its point. */
export function splineHandles(shape: Spline): { id: string; at: Vec }[] {
  const out: { id: string; at: Vec }[] = [];
  const n = nodeCount(shape);
  for (let k = 0; k < n; k++) out.push({ id: `n${k}`, at: shape.controls[3 * k] });
  for (let k = 0; k < n; k++) {
    const i = handleIndices(shape, k);
    const at = shape.controls[i.at];
    for (const [name, index] of [
      ['i', i.in],
      ['o', i.out],
    ] as const) {
      if (index >= 0 && distance(at, shape.controls[index]) >= FOLDED)
        out.push({ id: `${name}${k}`, at: shape.controls[index] });
    }
  }
  return out;
}

/** The curve with a point added on segment `s` at parameter `t`, splitting it so the curve keeps its path. */
export function insertNode(shape: Spline, s: number, t = 0.5): Spline {
  if (!(s >= 0 && s < segmentCount(shape))) return shape;
  const [p0, p1, p2, p3] = segmentOf(shape, s);
  const a = mix(p0, p1, t);
  const b = mix(p1, p2, t);
  const c = mix(p2, p3, t);
  const d = mix(a, b, t);
  const e = mix(b, c, t);
  const m = mix(d, e, t);
  return withControls(shape, (controls) => controls.splice(3 * s + 1, 2, a, d, m, e, c));
}

/** Where on the curve lies nearest `p`: the segment and parameter, and how far away it is. */
export function nearestOnSpline(shape: Spline, p: Vec): { segment: number; t: number; distance: number } {
  let best = { segment: 0, t: 0.5, distance: Infinity };
  for (let s = 0; s < segmentCount(shape); s++) {
    const [p0, p1, p2, p3] = segmentOf(shape, s);
    const steps = 48;
    for (let j = 0; j <= steps; j++) {
      const q = bezierAt(p0, p1, p2, p3, j / steps);
      const d = distance(p, q);
      if (d < best.distance) best = { segment: s, t: j / steps, distance: d };
    }
  }
  return best;
}

/** The curve with point `k` taken out, joining its neighbors with their own handles. Two points always stay. */
export function removeNode(shape: Spline, k: number): Spline {
  const n = nodeCount(shape);
  if (!(k >= 0 && k < n) || n <= (shape.closed ? 3 : 2)) return shape;
  if (!shape.closed) {
    return withControls(shape, (c) => {
      if (k === 0) c.splice(0, 3);
      else if (k === n - 1) c.splice(c.length - 3, 3);
      else c.splice(3 * k - 1, 3);
    });
  }
  // Turn the closed curve so the point is its second, then take it out and close it again.
  const c = shape.controls;
  const r = (k - 1 + n) % n;
  const turned = [...c.slice(3 * r, 3 * n), ...c.slice(0, 3 * r), c[3 * r]];
  turned.splice(2, 3);
  turned[turned.length - 1] = turned[0];
  return withHeads({ ...shape, controls: turned });
}

/**
 * The curve with point `k` made smooth, its handles along the line between its neighbors a third of the way to each,
 * or made a corner, its handles folded into it.
 */
export function setSmooth(shape: Spline, k: number, smooth: boolean): Spline {
  const n = nodeCount(shape);
  if (!(k >= 0 && k < n)) return shape;
  const i = handleIndices(shape, k);
  const c = shape.controls;
  const at = c[i.at];
  if (!smooth) {
    return withControls(shape, (controls) => {
      for (const index of [i.in, i.out]) if (index >= 0) controls[index] = at;
    });
  }
  const prev = shape.closed || k > 0 ? c[3 * ((k - 1 + n) % n)] : null;
  const next = shape.closed || k < n - 1 ? c[3 * ((k + 1) % n)] : null;
  const direction = unit(sub(next ?? at, prev ?? at));
  if (!direction) return shape;
  return withControls(shape, (controls) => {
    if (i.in >= 0 && prev) controls[i.in] = sub(at, scale(direction, distance(at, prev) / 3));
    if (i.out >= 0 && next) controls[i.out] = add(at, scale(direction, distance(at, next) / 3));
  });
}

/** True when a curve's points are too close together to tell apart: the curve is no use and should not be stored. */
export function isDegenerate(shape: Spline): boolean {
  for (let s = 0; s < segmentCount(shape); s++) {
    const [p0, , , p3] = segmentOf(shape, s);
    if (distance(p0, p3) < FOLDED) return true;
  }
  return false;
}
