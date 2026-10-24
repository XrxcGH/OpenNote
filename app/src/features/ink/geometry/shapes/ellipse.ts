// Fitting a circle or an ellipse to a closed stroke (design 11.2).
//
// The fit takes the center and axis direction from the point cloud's covariance. It then solves for the two radii
// by least squares on the ellipse equation in that frame. It is a closed form with no iteration, and it is accurate
// for the evenly spaced points that resampling gives.

import type { Vec } from '../types';
import { centroid, principalAngle } from './lines';
import type { Shape } from './types';

/** An ellipse is accepted when the mean radial error is under this share of its radius. */
export const ELLIPSE_TOLERANCE = 0.06;
/** An ellipse whose short axis is at least this share of its long axis becomes a circle. */
export const CIRCLE_RATIO = 0.85;

const SNAP_RADIANS = (5 * Math.PI) / 180;

export interface EllipseFit {
  readonly center: Vec;
  readonly rx: number;
  readonly ry: number;
  readonly rotation: number;
  /** The mean distance of the points from the ellipse, as a share of its radius. */
  readonly error: number;
}

export function fitEllipse(points: readonly Vec[]): EllipseFit | null {
  const center = centroid(points);
  const rotation = principalAngle(points, center);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const axes = points.map((p) => ({
    u: (p.x - center.x) * cos + (p.y - center.y) * sin,
    v: -(p.x - center.x) * sin + (p.y - center.y) * cos,
  }));
  const radii = solveRadii(axes);
  if (!radii) return null;
  const [A, B] = radii;
  let error = 0;
  for (const { u, v } of axes) error += Math.abs(Math.sqrt(A * u * u + B * v * v) - 1);
  return { center, rx: 1 / Math.sqrt(A), ry: 1 / Math.sqrt(B), rotation, error: error / axes.length };
}

/** Least squares for A and B in A u^2 + B v^2 = 1, with A = 1 / rx^2 and B = 1 / ry^2. Null when no ellipse fits. */
function solveRadii(axes: readonly { u: number; v: number }[]): readonly [number, number] | null {
  let s40 = 0;
  let s22 = 0;
  let s04 = 0;
  let s20 = 0;
  let s02 = 0;
  for (const { u, v } of axes) {
    s40 += u ** 4;
    s22 += u * u * v * v;
    s04 += v ** 4;
    s20 += u * u;
    s02 += v * v;
  }
  const det = s40 * s04 - s22 * s22;
  if (Math.abs(det) < 1e-12) return null;
  const A = (s20 * s04 - s02 * s22) / det;
  const B = (s40 * s02 - s22 * s20) / det;
  return A > 0 && B > 0 ? [A, B] : null;
}

/** The shape for a fit: a circle when it is nearly round, otherwise an ellipse snapped upright when it nearly is. */
export function ellipseShape(fit: EllipseFit): Shape {
  const short = Math.min(fit.rx, fit.ry);
  const long = Math.max(fit.rx, fit.ry);
  if (short / long >= CIRCLE_RATIO) return { kind: 'circle', center: fit.center, radius: Math.sqrt(fit.rx * fit.ry) };
  // Snap to upright when the ellipse is within 5 degrees of the axes, swapping the radii for a quarter turn.
  let rotation = fit.rotation;
  let [rx, ry] = [fit.rx, fit.ry];
  if (Math.abs(rotation) <= SNAP_RADIANS) {
    rotation = 0;
  } else if (Math.abs(Math.abs(rotation) - Math.PI / 2) <= SNAP_RADIANS) {
    rotation = 0;
    [rx, ry] = [ry, rx];
  }
  return { kind: 'ellipse', center: fit.center, rx, ry, rotation };
}
