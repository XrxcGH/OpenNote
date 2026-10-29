// Vectors in two and three dimensions: the dot and cross products, lengths, angles, and projections. A 2D vector is
// a 3D one with z = 0, so one set of functions serves both. Plain numbers in, plain numbers out.
import { compileMulti } from './multivar';

export type Vec3 = readonly [number, number, number];

export const vec = (x: number, y: number, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** The vector of length 1 in the direction of `a`, or null for the zero vector. */
export function unit(a: Vec3): Vec3 | null {
  const length = norm(a);
  return length === 0 ? null : scale(a, 1 / length);
}

/** The angle between `a` and `b` in radians, from 0 to π. Null when either is the zero vector. */
export function angleBetween(a: Vec3, b: Vec3): number | null {
  const lengths = norm(a) * norm(b);
  if (lengths === 0) return null;
  // Clamped, because rounding can put the cosine a hair past 1 for parallel vectors.
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / lengths)));
}

/** The scalar projection of `a` onto `b` (comp_b a = a·b / |b|). Null when `b` is the zero vector. */
export function scalarProjection(a: Vec3, b: Vec3): number | null {
  const length = norm(b);
  return length === 0 ? null : dot(a, b) / length;
}

/** The vector projection of `a` onto `b` (proj_b a = (a·b / b·b) b). Null when `b` is the zero vector. */
export function projection(a: Vec3, b: Vec3): Vec3 | null {
  const bb = dot(b, b);
  return bb === 0 ? null : scale(b, dot(a, b) / bb);
}

/** The scalar triple product a · (b × c): the signed volume of the box the three vectors span. */
export const tripleProduct = (a: Vec3, b: Vec3, c: Vec3): number => dot(a, cross(b, c));

/** The area of the parallelogram `a` and `b` span, |a × b|. */
export const parallelogramArea = (a: Vec3, b: Vec3): number => norm(cross(a, b));

/** Rounds away floating-point dust, so 0.30000000000000004 shows as 0.3 and -1e-17 as 0. */
export function tidy(value: number, digits = 10): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toPrecision(digits));
  return Math.abs(rounded) < 1e-12 ? 0 : rounded;
}

/** A vector as text, such as ⟨1, -2, 3⟩. */
export function vecText(a: Vec3, digits = 4): string {
  return `⟨${a.map((part) => String(tidy(Number(part.toPrecision(digits))))).join(', ')}⟩`;
}

/** The value of a number or a constant expression such as `sqrt(2)` or `pi/4`. NaN when it is not one. */
export function readNumber(text: string): number {
  const read = compileMulti(text, []);
  return read.ok ? read.expression.evaluate({}) : NaN;
}

/**
 * Reads "1, 2, 3", "<1, 2, 3>", "(1 2 3)", or "1 2" (z = 0) as a vector. Parts may be expressions such as
 * `sqrt(2)`; with commas, a part may have spaces in it. Null for anything else.
 */
export function readVec(text: string): Vec3 | null {
  const inner = text.trim().replace(/^[<(⟨[]|[>)⟩\]]$/g, '');
  const parts = (inner.includes(',') || inner.includes(';') ? inner.split(/[,;]/) : inner.split(/\s+/))
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length < 2 || parts.length > 3) return null;
  const values = parts.map(readNumber);
  if (!values.every(Number.isFinite)) return null;
  return [values[0], values[1], values[2] ?? 0];
}
