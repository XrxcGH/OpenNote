// Fitting a straight line to a stroke, and snapping its angle (design 11.2).

import type { Vec } from '../types';

export interface LineFit {
  /** Where the stroke starts and ends, projected onto the fitted line. */
  readonly from: Vec;
  readonly to: Vec;
  readonly length: number;
  /** The largest distance of any point from the line. */
  readonly maxDeviation: number;
}

/** A line is accepted when no point strays farther than this share of its length. */
export const LINE_TOLERANCE = 0.035;

const DEGREES = Math.PI / 180;
/** Lines snap to the nearest multiple of this many degrees when within SNAP_TOLERANCE of it. */
const SNAP_STEP = 15;
const SNAP_TOLERANCE = 4;
/** Near horizontal or vertical, lines snap from a little farther away. */
const AXIS_SNAP_TOLERANCE = 6;

export function centroid(points: readonly Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** The angle of the longest axis of a point cloud, from its covariance. */
export function principalAngle(points: readonly Vec[], center: Vec): number {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** Total least squares: the line closest to the points in the perpendicular sense. Null for fewer than two points. */
export function fitLine(points: readonly Vec[]): LineFit | null {
  if (points.length < 2) return null;
  const c = centroid(points);
  const angle = principalAngle(points, c);
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  const first = points[0];
  const last = points[points.length - 1];
  if ((last.x - first.x) * dx + (last.y - first.y) * dy < 0) {
    dx = -dx;
    dy = -dy;
  }
  const along = (p: Vec) => (p.x - c.x) * dx + (p.y - c.y) * dy;
  const at = (t: number): Vec => ({ x: c.x + dx * t, y: c.y + dy * t });
  let maxDeviation = 0;
  for (const p of points) maxDeviation = Math.max(maxDeviation, Math.abs((p.x - c.x) * dy - (p.y - c.y) * dx));
  return { from: at(along(first)), to: at(along(last)), length: along(last) - along(first), maxDeviation };
}

/**
 * Snaps a direction: to 0, 90, 180, or 270 degrees within 6 degrees, and otherwise to the nearest multiple of
 * 15 degrees within 4 degrees (FEATURES.md: lines snap to 15 degree steps near horizontal and vertical).
 */
export function snapAngle(radians: number): number {
  const degrees = radians / DEGREES;
  const axis = Math.round(degrees / 90) * 90;
  if (Math.abs(degrees - axis) <= AXIS_SNAP_TOLERANCE) return axis * DEGREES;
  const step = Math.round(degrees / SNAP_STEP) * SNAP_STEP;
  return Math.abs(degrees - step) <= SNAP_TOLERANCE ? step * DEGREES : radians;
}

/** Turns a segment about its midpoint to a snapped angle, keeping its length. */
export function snapSegment(from: Vec, to: Vec): readonly [Vec, Vec] {
  const angle = snapAngle(Math.atan2(to.y - from.y, to.x - from.x));
  const half = Math.hypot(to.x - from.x, to.y - from.y) / 2;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const ux = Math.cos(angle) * half;
  const uy = Math.sin(angle) * half;
  return [
    { x: mid.x - ux, y: mid.y - uy },
    { x: mid.x + ux, y: mid.y + uy },
  ];
}
