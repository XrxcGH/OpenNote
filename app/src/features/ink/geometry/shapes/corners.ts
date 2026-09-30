// Corners of a closed stroke and the polygon they make (design 11.2). Corner finding follows ShortStraw (Wolin,
// Eoff, and Hammond, 2008): at a corner the "straw", the chord between the points a few steps before and after,
// is short. Each side is then fitted with a line and the corners move to where neighboring lines meet.

import { distance } from '../primitives';
import type { Vec } from '../types';
import { fitLine } from './lines';

/** Points on each side of a point that the straw spans. */
const STRAW_WINDOW = 3;
/** Corners closer than this share of the outline are merged, keeping the sharper one. */
const MIN_CORNER_GAP = 0.08;
/** A side's line is fitted without this share of the side at each end, where the corner rounds off. */
const SIDE_TRIM = 0.15;
/** Adjacent sides closer than this to parallel (the sine of the angle between them) have no clear corner. */
const MIN_CORNER_SINE = 0.2;

export interface PolygonFit {
  readonly corners: readonly Vec[];
  /** The mean distance of the points from the polygon's outline, as a share of the square root of its area. */
  readonly error: number;
}

/** Indices of the `count` sharpest corners of a closed outline, in path order, or null when there are too few. */
export function pickCorners(points: readonly Vec[], count: number): number[] | null {
  const n = points.length;
  const straws = points.map((_, i) => distance(points[(i - STRAW_WINDOW + n) % n], points[(i + STRAW_WINDOW) % n]));
  const minima = straws
    .map((straw, i) => ({ i, straw }))
    .filter(({ i, straw }) => [-2, -1, 1, 2].every((k) => straw <= straws[(i + k + n) % n]))
    .sort((a, b) => a.straw - b.straw);
  const gap = Math.max(2, Math.round(MIN_CORNER_GAP * n));
  const picked: number[] = [];
  for (const { i } of minima) {
    if (picked.every((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) >= gap)) picked.push(i);
    if (picked.length === count) return picked.sort((a, b) => a - b);
  }
  return null;
}

/** The points from corner `from` to corner `to` along a closed outline. The walk goes forward and wraps at the end. */
function sidePoints(points: readonly Vec[], from: number, to: number): Vec[] {
  const n = points.length;
  const side: Vec[] = [];
  for (let i = from; ; i = (i + 1) % n) {
    side.push(points[i]);
    if (i === to) return side;
  }
}

/** Where two lines meet, each given as a point and a direction, or null when they are nearly parallel. */
function meet(a: { p: Vec; d: Vec }, b: { p: Vec; d: Vec }): Vec | null {
  const cross = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(cross) < MIN_CORNER_SINE) return null;
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / cross;
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
}

/** Fits a line to the middle of each side, then finds the corners where neighboring lines meet. */
export function fitPolygon(points: readonly Vec[], cornerIndices: readonly number[]): PolygonFit | null {
  const lines: { p: Vec; d: Vec }[] = [];
  for (let k = 0; k < cornerIndices.length; k++) {
    const side = sidePoints(points, cornerIndices[k], cornerIndices[(k + 1) % cornerIndices.length]);
    const trim = Math.max(1, Math.floor(side.length * SIDE_TRIM));
    const fit = fitLine(side.slice(trim, side.length - trim));
    if (!fit || fit.length <= 0) return null;
    lines.push({
      p: fit.from,
      d: { x: (fit.to.x - fit.from.x) / fit.length, y: (fit.to.y - fit.from.y) / fit.length },
    });
  }
  const corners: Vec[] = [];
  for (let k = 0; k < lines.length; k++) {
    const corner = meet(lines[(k + lines.length - 1) % lines.length], lines[k]);
    if (!corner) return null;
    corners.push(corner);
  }
  const area = polygonArea(corners);
  if (area < 1e-6) return null;
  return { corners, error: outlineError(points, corners) / Math.sqrt(area) };
}

/** The area of a polygon by the shoelace formula, always positive. */
export function polygonArea(corners: readonly Vec[]): number {
  let twice = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** The mean distance from each point to the nearest side of the polygon. */
function outlineError(points: readonly Vec[], corners: readonly Vec[]): number {
  let total = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i < corners.length; i++) {
      best = Math.min(best, distanceToSegment(p, corners[i], corners[(i + 1) % corners.length]));
    }
    total += best;
  }
  return total / points.length;
}

function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const length = distance(a, b);
  if (length === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (length * length)));
  return distance(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}
