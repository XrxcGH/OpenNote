// Affine transforms as six-number matrices (spec 9.3). Every function returns a new matrix.

import type { Matrix, Vec } from './types';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const ORIGIN: Vec = { x: 0, y: 0 };

/** The matrix that applies `inner` first and then `outer`. */
export function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

export function translation(dx: number, dy: number): Matrix {
  return [1, 0, 0, 1, dx, dy];
}

/** A scale about a fixed point, which stays where it is. */
export function scaling(sx: number, sy: number, about: Vec = ORIGIN): Matrix {
  return [sx, 0, 0, sy, about.x - sx * about.x, about.y - sy * about.y];
}

/** A rotation by `radians` about a fixed point (clockwise on screen, where y points down). */
export function rotation(radians: number, about: Vec = ORIGIN): Matrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, about.x - cos * about.x + sin * about.y, about.y - sin * about.x - cos * about.y];
}

export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

export function applyToPoint(m: Matrix, p: Vec): Vec {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** The points through a transform, or the same points when there is none. */
export function applyToPoints(m: Matrix | undefined, points: readonly Vec[]): readonly Vec[] {
  return m ? points.map((p) => applyToPoint(m, p)) : points;
}

export function determinant(m: Matrix): number {
  return m[0] * m[3] - m[1] * m[2];
}

/** The inverse, or null when the matrix flattens the plane. */
export function invert(m: Matrix): Matrix | null {
  const det = determinant(m);
  if (Math.abs(det) < 1e-12) return null;
  const [a, b, c, d, e, f] = m;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** How much a transform scales stroke width: the square root of the absolute determinant (design 6.3). */
export function widthScale(m: Matrix): number {
  return Math.sqrt(Math.abs(determinant(m)));
}
