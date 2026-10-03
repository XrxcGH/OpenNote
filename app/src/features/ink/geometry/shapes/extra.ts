// More shapes (design 11.3): regular pentagons and hexagons, stars, circular arcs, curved arrows, and double arrows.
// They are tried only when a stroke is held to snap, or read back to give a shape its handles, never on the strokes
// of ordinary writing, where a curve is a letter and not an arc.

import { distance, polylineLength } from '../primitives';
import { resample, simplify } from '../simplify';
import type { Vec } from '../types';
import { arrowCandidate, headBarbs } from './arrow';
import { fitPolygon, pickCorners, polygonArea } from './corners';
import { POLYGON_TOLERANCE } from './polygons';
import type { Candidate } from './types';

const DEGREES = Math.PI / 180;
/** A regular polygon's sides may differ from their mean by this share. */
const SIDE_SPREAD = 0.28;
/** A star's inner corners and its outer corners may each differ from their mean by this share. */
const RADIUS_SPREAD = 0.22;
/** An arc is accepted when its points stray from the circle by less than this share of the radius. */
const ARC_TOLERANCE = 0.05;
const MIN_ARC_SWEEP = 40 * DEGREES;
const MAX_ARC_SWEEP = 335 * DEGREES;
const SIMPLIFY_SHARE = 0.03;
const MIN_BARB_ANGLE = 15 * DEGREES;
const MAX_BARB_ANGLE = 60 * DEGREES;

const mean = (values: readonly number[]) => values.reduce((s, v) => s + v, 0) / values.length;
const centerOf = (points: readonly Vec[]): Vec => ({
  x: mean(points.map((p) => p.x)),
  y: mean(points.map((p) => p.y)),
});

/** The smallest signed turn from angle a to angle b, in radians. */
function turn(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// ---- polygons and stars ----

function regularPolygon(corners: readonly Vec[], error: number): Candidate | null {
  const n = corners.length;
  const center = centerOf(corners);
  const radii = corners.map((c) => distance(c, center));
  const radius = mean(radii);
  const sides = corners.map((c, i) => distance(c, corners[(i + 1) % n]));
  const side = mean(sides);
  if (sides.some((s) => Math.abs(s - side) > SIDE_SPREAD * side)) return null;
  if (radii.some((r) => Math.abs(r - radius) > SIDE_SPREAD * radius)) return null;
  const rotation = Math.atan2(corners[0].y - center.y, corners[0].x - center.x);
  return { shape: { kind: 'polygon', sides: n, center, radius, rotation }, ratio: error / POLYGON_TOLERANCE };
}

/** A star from corners: the outline of a five- or six-pointed star, or a pentagram drawn without lifting. */
function starFrom(corners: readonly Vec[], error: number): Candidate | null {
  const n = corners.length;
  const center = centerOf(corners);
  const angles = corners.map((c) => Math.atan2(c.y - center.y, c.x - center.x));
  if (n === 5) {
    // A pentagram's strokes skip a corner each time: the corners step 144 degrees around the center.
    const steps = angles.map((a, i) => Math.abs(turn(a, angles[(i + 1) % n])));
    if (steps.some((s) => Math.abs(s - 144 * DEGREES) > 24 * DEGREES)) return null;
    const outer = mean(corners.map((c) => distance(c, center)));
    return {
      shape: { kind: 'star', points: 5, center, outer, inner: outer * 0.382, rotation: angles[0] },
      ratio: error / POLYGON_TOLERANCE,
    };
  }
  const points = n / 2;
  if (!Number.isInteger(points) || points < 5 || points > 6) return null;
  // Alternate corners are the tips; the other half are the notches. Try both ways and keep the one with the longer tips.
  const even = corners.filter((_, i) => i % 2 === 0);
  const odd = corners.filter((_, i) => i % 2 === 1);
  const evenR = mean(even.map((c) => distance(c, center)));
  const oddR = mean(odd.map((c) => distance(c, center)));
  const [tips, notches, tipR, notchR, first] =
    evenR >= oddR ? [even, odd, evenR, oddR, 0] : [odd, even, oddR, evenR, 1];
  const spread = (list: readonly Vec[], r: number) =>
    list.every((c) => Math.abs(distance(c, center) - r) <= RADIUS_SPREAD * r);
  if (!spread(tips, tipR) || !spread(notches, notchR)) return null;
  const ratio = notchR / tipR;
  if (ratio < 0.25 || ratio > 0.7) return null;
  return {
    shape: { kind: 'star', points, center, outer: tipR, inner: notchR, rotation: angles[first] },
    ratio: error / POLYGON_TOLERANCE,
  };
}

/** Pentagons, hexagons, and stars from a closed outline of evenly spaced points. */
export function closedExtras(outline: readonly Vec[]): Candidate[] {
  const found: Candidate[] = [];
  const fitFor = (count: number) => {
    const indices = pickCorners(outline, count);
    return indices && fitPolygon(outline, indices);
  };
  for (const count of [5, 6]) {
    const fit = fitFor(count);
    if (!fit || fit.error >= POLYGON_TOLERANCE || polygonArea(fit.corners) < 1) continue;
    const star = count === 5 ? starFrom(fit.corners, fit.error) : null;
    const regular = regularPolygon(fit.corners, fit.error);
    // Five corners that step around by 144 degrees are a pentagram, and the same corners in order are no pentagon.
    if (star) found.push(star);
    else if (regular) found.push(regular);
  }
  for (const count of [10, 12]) {
    const fit = fitFor(count);
    if (!fit || fit.error >= POLYGON_TOLERANCE) continue;
    const star = starFrom(fit.corners, fit.error);
    if (star) found.push(star);
  }
  return found;
}

// ---- arcs and curved arrows ----

export interface CircleFit {
  readonly center: Vec;
  readonly radius: number;
  /** The largest distance of any point from the circle, as a share of the radius. */
  readonly error: number;
}

/** Fits a circle to points by least squares (Kasa's method). */
export function fitCircle(points: readonly Vec[]): CircleFit | null {
  const c = centerOf(points);
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const p of points) {
    const u = p.x - c.x;
    const v = p.y - c.y;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = 0.5 * (suuu + suvv);
  const b2 = 0.5 * (svvv + svuu);
  const uc = (b1 * svv - b2 * suv) / det;
  const vc = (b2 * suu - b1 * suv) / det;
  const center = { x: c.x + uc, y: c.y + vc };
  const radius = mean(points.map((p) => distance(p, center)));
  if (!(radius > 0)) return null;
  const error = Math.max(...points.map((p) => Math.abs(distance(p, center) - radius))) / radius;
  return { center, radius, error };
}

/** The signed angle the points sweep around a center, following the path. */
function sweepOf(points: readonly Vec[], center: Vec): { start: number; sweep: number } {
  const angle = (p: Vec) => Math.atan2(p.y - center.y, p.x - center.x);
  let total = 0;
  for (let i = 1; i < points.length; i++) total += turn(angle(points[i - 1]), angle(points[i]));
  return { start: angle(points[0]), sweep: total };
}

function arcOf(points: readonly Vec[]): { fit: CircleFit; start: number; sweep: number } | null {
  const fit = fitCircle(points);
  if (!fit || fit.error > ARC_TOLERANCE) return null;
  const { start, sweep } = sweepOf(points, fit.center);
  if (Math.abs(sweep) < MIN_ARC_SWEEP || Math.abs(sweep) > MAX_ARC_SWEEP) return null;
  return { fit, start, sweep };
}

/** An open stroke that follows a circle for part of its way. */
export function arcCandidate(points: readonly Vec[]): Candidate | null {
  const even = resample(points, 48);
  const arc = arcOf(even);
  if (!arc) return null;
  return {
    shape: { kind: 'arc', center: arc.fit.center, radius: arc.fit.radius, start: arc.start, sweep: arc.sweep },
    ratio: arc.fit.error / ARC_TOLERANCE,
  };
}

/** Whether a head's barbs sit at a believable angle off the way back along the shaft, one on each side. */
function headFits(tip: Vec, barbs: readonly [Vec, Vec], back: Vec): boolean {
  const sides: number[] = [];
  for (const barb of barbs) {
    const length = distance(tip, barb);
    if (length === 0) return false;
    const cos = ((barb.x - tip.x) * back.x + (barb.y - tip.y) * back.y) / length;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle < MIN_BARB_ANGLE || angle > MAX_BARB_ANGLE) return false;
    sides.push(Math.sign(back.x * (barb.y - tip.y) - back.y * (barb.x - tip.x)));
  }
  return sides[0] * sides[1] < 0;
}

const unit = (from: Vec, to: Vec): Vec => {
  const length = distance(from, to) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** An arc that ends in an arrow head: the head is the last four corners, as for a straight arrow. */
export function curvedArrowCandidate(points: readonly Vec[], size: number, width: number): Candidate | null {
  const vertices = simplify(points, SIMPLIFY_SHARE * size);
  if (vertices.length < 6) return null;
  const [tip, barbA, , barbB] = vertices.slice(-4);
  const at = points.findIndex((p) => p === tip);
  const body = at > 8 ? points.slice(0, at + 1) : null;
  if (!body) return null;
  const arc = arcOf(resample(body, 48));
  if (!arc) return null;
  const tail = body.slice(-Math.max(3, Math.floor(body.length * 0.08)));
  const back = unit(tip, tail[0]);
  if (!headFits(tip, [barbA, barbB], back)) return null;
  const direction = unit(tail[0], tip);
  const armLength = Math.max(10, 4 * width, distance(tip, barbA));
  const barbs = headBarbs(tip, direction, Math.min(armLength, polylineLength(body) * 0.4));
  return {
    shape: {
      kind: 'curvedArrow',
      center: arc.fit.center,
      radius: arc.fit.radius,
      start: arc.start,
      sweep: arc.sweep,
      barbs,
    },
    ratio: arc.fit.error / ARC_TOLERANCE,
  };
}

// ---- double arrows ----

/** A shaft with a head at each end, drawn as head, shaft, head without lifting. */
export function doubleArrowCandidate(points: readonly Vec[], size: number, width: number): Candidate | null {
  const vertices = simplify(points, SIMPLIFY_SHARE * size);
  if (vertices.length < 8) return null;
  const [barbA, tipA, barbB, tipAgain] = vertices;
  const start = points.findIndex((p) => p === tipAgain);
  if (start < 0 || start > points.length / 2) return null;
  const tail = arrowCandidate(points.slice(start), size, width);
  if (!tail || tail.shape.kind !== 'arrow') return null;
  const { from, tip, barbs } = tail.shape;
  const forward = unit(from, tip);
  if (!headFits(tipA, [barbA, barbB], forward)) return null;
  const length = Math.max(distance(tip, barbs[0]), distance(tipA, barbA) * 0.5);
  return {
    shape: {
      kind: 'doubleArrow',
      from,
      to: tip,
      barbsFrom: headBarbs(from, unit(tip, from), length),
      barbsTo: barbs,
    },
    ratio: tail.ratio,
  };
}
