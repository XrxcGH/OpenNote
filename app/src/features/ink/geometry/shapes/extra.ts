// More shapes (design 11.3): regular pentagons and hexagons, stars, circular arcs, curved arrows, and double arrows.
// They are tried only when a stroke is held to snap, or read back to give a shape its handles, never on the strokes
// of ordinary writing, where a curve is a letter and not an arc.

import { distance, polylineLength, segmentsIntersect } from '../primitives';
import { resample } from '../simplify';
import type { Vec } from '../types';
import {
  afterLanding,
  endHeads,
  headBarbs,
  headFitRatio,
  headLength,
  landed,
  onlyLanding,
  shaftLine,
  sharpTurns,
} from './arrow';
import { snapSegment } from './lines';
import { fitPolygon, pickCorners, polygonArea } from './corners';
import { ELLIPSE_TOLERANCE, fitEllipse } from './ellipse';
import { POLYGON_TOLERANCE } from './polygons';
import type { Candidate } from './types';

const DEGREES = Math.PI / 180;
/** A regular polygon's sides may differ from their mean by this share. */
const SIDE_SPREAD = 0.28;
/** A star's tips may differ from their mean distance from the center by this share of it. */
const RADIUS_SPREAD = 0.22;
/** Its notches, nearer the center, by this share of the tips' distance. */
const NOTCH_SPREAD = 0.12;
/**
 * A regular polygon's corners all turn the path by the same angle, within this on average (root mean square). A hand
 * turns one corner a good way off, but a house turns all five off at once.
 */
const TURN_SPREAD = 16 * DEGREES;
/** An arc is accepted when its points stray from the circle by less than this share of the radius. */
const ARC_TOLERANCE = 0.05;
const MIN_ARC_SWEEP = 40 * DEGREES;
const MAX_ARC_SWEEP = 335 * DEGREES;

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
  const heading = (i: number) =>
    Math.atan2(corners[(i + 1) % n].y - corners[i].y, corners[(i + 1) % n].x - corners[i].x);
  const turns = corners.map((_, i) => Math.abs(turn(heading((i + n - 1) % n), heading(i))));
  if (Math.sqrt(mean(turns.map((t) => (t - (2 * Math.PI) / n) ** 2))) > TURN_SPREAD) return null;
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
  const spread = (list: readonly Vec[], r: number, reach: number) =>
    list.every((c) => Math.abs(distance(c, center) - r) <= reach);
  if (!spread(tips, tipR, RADIUS_SPREAD * tipR) || !spread(notches, notchR, NOTCH_SPREAD * tipR)) return null;
  const ratio = notchR / tipR;
  if (ratio < 0.25 || ratio > 0.7) return null;
  return {
    shape: { kind: 'star', points, center, outer: tipR, inner: notchR, rotation: angles[first] },
    ratio: error / POLYGON_TOLERANCE,
  };
}

/** Most corners an irregular polygon may have. */
const MAX_FREEFORM_CORNERS = 7;
/** An irregular polygon's corners each turn the path by at least this much, or they are no corner. */
const MIN_CORNER_TURN = 30 * DEGREES;
/** Its sides are each at least this share of its perimeter, so a crowded pair of corners is no polygon. */
const MIN_SIDE_SHARE = 0.07;
/** One more corner is taken only when it cuts the fit error below this share of the fewer-cornered fit's. */
const EXTRA_CORNER_GAIN = 0.4;
/**
 * ...and only when that fit is near exact, as for points a shape generated, or the fewer-cornered fit is loose, as when
 * a hand-drawn house is read as four corners and the roof is cut off. A wobble on a well-fitted shape adds no corner.
 */
const EXACT_FIT = 0.1;
const LOOSE_FIT = 0.3;
const GOOD_FIT = 0.2;
/** A four-cornered outline whose corners all turn within this of a right angle is a sloppy rectangle, not a new shape. */
const NEAR_RIGHT_ANGLE = 22 * DEGREES;
/**
 * ...unless a corner is past the rectangle's own tolerance and two opposite sides are parallel within this: a narrow
 * trapezoid or a slightly slanted parallelogram, drawn on purpose, which the rectangle turns down.
 */
const RECTANGLE_TOLERANCE = 15 * DEGREES;
const PARALLEL = 4 * DEGREES;

/** Whether two opposite sides of a four-cornered outline run within `PARALLEL` of each other. */
function parallelPair(corners: readonly Vec[]): boolean {
  const heading = (i: number) =>
    Math.atan2(corners[(i + 1) % 4].y - corners[i].y, corners[(i + 1) % 4].x - corners[i].x);
  return [0, 1].some((i) => Math.abs(Math.abs(turn(heading(i), heading(i + 2))) - Math.PI) < PARALLEL);
}

/** Whether the corners make a simple polygon: no side crosses another, every corner is sharp, no side is tiny. */
function cleanPolygon(corners: readonly Vec[]): boolean {
  const n = corners.length;
  const sides = corners.map((c, i) => distance(c, corners[(i + 1) % n]));
  const perimeter = sides.reduce((s, d) => s + d, 0);
  if (sides.some((d) => d < MIN_SIDE_SHARE * perimeter)) return false;
  let nearRight = 0;
  let pastRectangle = false;
  for (let i = 0; i < n; i++) {
    const a = corners[(i + n - 1) % n];
    const b = corners[i];
    const c = corners[(i + 1) % n];
    const heading = Math.abs(turn(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(c.y - b.y, c.x - b.x)));
    if (heading < MIN_CORNER_TURN) return false;
    if (Math.abs(heading - Math.PI / 2) < NEAR_RIGHT_ANGLE) nearRight++;
    if (Math.abs(heading - Math.PI / 2) >= RECTANGLE_TOLERANCE) pastRectangle = true;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(corners[i], corners[(i + 1) % n], corners[j], corners[(j + 1) % n])) return false;
    }
  }
  return !(n === 4 && nearRight === 4) || (pastRectangle && parallelPair(corners));
}

/**
 * An irregular polygon of 4 to 7 corners: the fewest corners that describe the outline well. A trapezoid, a house,
 * and an L all come out here, where the regular shapes and the rectangle do not fit.
 */
function freeformCandidate(outline: readonly Vec[]): Candidate | null {
  let best: { corners: readonly Vec[]; error: number } | null = null;
  // A round outline fits more corners ever better, so it never takes a corner for a loose fit alone.
  const round = (fitEllipse(outline)?.error ?? Infinity) < ELLIPSE_TOLERANCE;
  for (let count = 4; count <= MAX_FREEFORM_CORNERS; count++) {
    const indices = pickCorners(outline, count);
    const fit = indices && fitPolygon(outline, indices);
    if (!fit || fit.error >= POLYGON_TOLERANCE || !cleanPolygon(fit.corners)) continue;
    // The fewest corners that fit win, unless one more corner explains the outline far better: a house fits a
    // four-sided shape loosely and a five-sided one well, and the roof must keep its handle.
    const loose =
      !round && best !== null && best.error > LOOSE_FIT * POLYGON_TOLERANCE && fit.error < GOOD_FIT * POLYGON_TOLERANCE;
    if (best && (fit.error >= EXTRA_CORNER_GAIN * best.error || !(fit.error < EXACT_FIT * POLYGON_TOLERANCE || loose)))
      break;
    best = { corners: fit.corners, error: fit.error };
  }
  return best && { shape: { kind: 'freeform', corners: best.corners }, ratio: best.error / POLYGON_TOLERANCE };
}

/** Pentagons, hexagons, stars, and irregular polygons from a closed outline of evenly spaced points. */
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
  const freeform = freeformCandidate(outline);
  if (freeform) found.push(freeform);
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

const unit = (from: Vec, to: Vec): Vec => {
  const length = distance(from, to) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** An arc that ends in an arrow head, drawn as for a straight arrow. */
export function curvedArrowCandidate(points: readonly Vec[], _size: number, width: number): Candidate | null {
  const { path, at } = sharpTurns(points);
  let best: Candidate | null = null;
  for (const { head, tipAt, before } of endHeads(path, at)) {
    if (!onlyLanding(path, at, before)) continue;
    const body = path.slice(afterLanding(at, before, tipAt), tipAt + 1);
    if (body.length < 8) continue;
    const arc = arcOf(resample(body, 48));
    if (!arc) continue;
    // The arc runs back to where the pen landed, past the stretch left out of the fit.
    const { center, radius } = arc.fit;
    const landing = path[landed(at, before)];
    const start = Math.atan2(landing.y - center.y, landing.x - center.x);
    const sweep = arc.sweep + turn(start, arc.start);
    // The arc's end, and the way it runs there: along the circle, turning the way the arc sweeps.
    const endAngle = arc.start + arc.sweep;
    const tip = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) };
    const way = Math.sign(arc.sweep);
    const direction = { x: -Math.sin(endAngle) * way, y: Math.cos(endAngle) * way };
    const length = polylineLength(body);
    const ratio = Math.max(arc.fit.error / ARC_TOLERANCE, headFitRatio(head, direction, length));
    if (!(ratio < 1) || (best && best.ratio <= ratio)) continue;
    const barbs = headBarbs(tip, direction, headLength(head, width, length));
    best = { shape: { kind: 'curvedArrow', center, radius, start, sweep, barbs }, ratio };
  }
  return best;
}

// ---- double arrows ----

/** A shaft with a head at each end, drawn head, shaft, head in one stroke: each end holds a straight arrow's head. */
export function doubleArrowCandidate(points: readonly Vec[], _size: number, width: number): Candidate | null {
  const { path, at } = sharpTurns(points);
  const n = path.length;
  // The first head, drawn barb, tip, barb, tip, is a straight arrow's head drawn backwards from the shaft.
  const reversed = [...path].reverse();
  const reversedAt = at.map((i) => n - 1 - i).reverse();
  let best: Candidate | null = null;
  for (const end of endHeads(path, at)) {
    for (const start of endHeads(reversed, reversedAt)) {
      const fromAt = n - 1 - start.tipAt;
      if (fromAt >= end.tipAt || at.some((i) => i > fromAt && i < end.tipAt)) continue;
      const shaft = shaftLine(path, fromAt, end.tipAt, fromAt, true);
      if (!shaft) continue;
      const forward = unit(shaft.from, shaft.to);
      const backward = { x: -forward.x, y: -forward.y };
      const ratio = Math.max(
        shaft.ratio,
        headFitRatio(end.head, forward, shaft.length),
        headFitRatio(start.head, backward, shaft.length),
      );
      if (!(ratio < 1) || (best && best.ratio <= ratio)) continue;
      const [from, to] = snapSegment(shaft.from, shaft.to);
      const length = Math.max(headLength(end.head, width, shaft.length), headLength(start.head, width, shaft.length));
      best = {
        shape: {
          kind: 'doubleArrow',
          from,
          to,
          barbsFrom: headBarbs(from, unit(to, from), length),
          barbsTo: headBarbs(to, unit(from, to), length),
        },
        ratio,
      };
    }
  }
  return best;
}
