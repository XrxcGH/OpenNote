// Geometric optics in the paraxial limit, and Gaussian beams. Lengths are in meters and angles in radians. Light
// travels left to right; a distance is positive in the direction the light goes, so an object in front of an element
// has a positive distance and a real image behind it does too. A radius is positive when its center of curvature lies
// after the surface. Ray-transfer (ABCD) matrices act on (height y, angle theta) with theta the true angle in the
// medium, so a matrix's determinant is n_in / n_out. A mirror is unfolded: the light after it is drawn as if it went
// on through, and a concave mirror (R > 0 here) focuses like a lens of focal length R / 2.
import { fail } from '../kit/read';

/** Snell's law n1 sin(theta1) = n2 sin(theta2); null when the light is totally reflected. */
export function refract(n1: number, n2: number, theta1: number): number | null {
  const s = (n1 / n2) * Math.sin(theta1);
  return Math.abs(s) <= 1 ? Math.asin(s) : null;
}

/** The critical angle going from n1 into a lower n2, or null when there is none. */
export const criticalAngle = (n1: number, n2: number): number | null => (n2 < n1 ? Math.asin(n2 / n1) : null);

/** Brewster's angle from n1 onto n2. */
export const brewsterAngle = (n1: number, n2: number): number => Math.atan2(n2, n1);

export interface Image {
  /** Image distance: positive behind a lens (real), negative in front (virtual). */
  si: number;
  m: number;
  real: boolean;
  upright: boolean;
}

/** The thin lens (and unfolded mirror) equation 1/s + 1/s' = 1/f with s the object distance. */
export function thinLens(f: number, s: number): Image {
  if (!Number.isFinite(f) || f === 0) fail('kitPhysics.geooptics.errors.zeroFocal');
  if (Math.abs(s - f) <= 1e-12 * Math.max(Math.abs(s), Math.abs(f))) fail('kitPhysics.geooptics.errors.atFocus');
  const si = (s * f) / (s - f);
  const m = -si / s;
  return { si, m, real: si > 0, upright: m > 0 };
}

/** The lensmaker's equation, thick when d > 0: power in 1/m. R of Infinity is a flat face. n is relative to the medium. */
export function lensmaker(n: number, R1: number, R2: number, d = 0) {
  const c1 = Number.isFinite(R1) ? 1 / R1 : 0;
  const c2 = Number.isFinite(R2) ? 1 / R2 : 0;
  const power = (n - 1) * (c1 - c2 + ((n - 1) * d * c1 * c2) / n);
  if (Math.abs(power) < 1e-15) fail('kitPhysics.geooptics.errors.noPower');
  const f = 1 / power;
  // The back focal length from the second face, and the front one from the first face (thick lens in a medium).
  const bfl = f * (1 - ((n - 1) * d * c1) / n);
  const ffl = f * (1 + ((n - 1) * d * c2) / n);
  return { power, f, bfl, ffl };
}

export type Matrix = readonly [number, number, number, number];

export const multiply = (m: Matrix, k: Matrix): Matrix => [
  m[0] * k[0] + m[1] * k[2],
  m[0] * k[1] + m[1] * k[3],
  m[2] * k[0] + m[3] * k[2],
  m[2] * k[1] + m[3] * k[3],
];

export const IDENTITY: Matrix = [1, 0, 0, 1];
export const gapMatrix = (d: number): Matrix => [1, d, 0, 1];
export const lensMatrix = (f: number): Matrix => [1, 0, -1 / f, 1];
/** A mirror of radius R, unfolded; R > 0 is concave (focusing). */
export const mirrorMatrix = (R: number): Matrix => [1, 0, -2 / R, 1];
/** Refraction from index n1 into n2 at a face of radius R (Infinity for flat). */
export const surfaceMatrix = (n1: number, n2: number, R: number): Matrix => [
  1,
  0,
  Number.isFinite(R) ? (n1 - n2) / (R * n2) : 0,
  n1 / n2,
];

export type Element =
  | { kind: 'lens'; f: number }
  | { kind: 'gap'; d: number }
  | { kind: 'mirror'; R: number }
  | { kind: 'surface'; n: number; R: number };

export interface Traced {
  /** The matrix of the whole train, last element on the left. */
  matrix: Matrix;
  /** The matrix after each element. */
  partial: Matrix[];
  /** The index after the last element. */
  nOut: number;
  /** Where each element sits along the axis, from the first. */
  positions: number[];
  /** Each element's own matrix, in order. */
  each: Matrix[];
}

/** Multiplies the elements' matrices in order, starting in a medium of index n0. */
export function traceSystem(elements: readonly Element[], n0: number): Traced {
  let matrix = IDENTITY;
  let n = n0;
  let z = 0;
  const partial: Matrix[] = [];
  const positions: number[] = [];
  const each: Matrix[] = [];
  for (const element of elements) {
    positions.push(z);
    let m: Matrix;
    if (element.kind === 'lens') {
      if (element.f === 0) fail('kitPhysics.geooptics.errors.zeroFocal');
      m = lensMatrix(element.f);
    } else if (element.kind === 'gap') {
      m = gapMatrix(element.d);
      z += element.d;
    } else if (element.kind === 'mirror') {
      if (element.R === 0) fail('kitPhysics.geooptics.errors.zeroRadius');
      m = mirrorMatrix(element.R);
    } else {
      if (element.R === 0) fail('kitPhysics.geooptics.errors.zeroRadius');
      m = surfaceMatrix(n, element.n, element.R);
      n = element.n;
    }
    matrix = multiply(m, matrix);
    partial.push(matrix);
    each.push(m);
  }
  return { matrix, partial, nOut: n, positions, each };
}

export interface Cardinal {
  /** Rear effective focal length -1/C, from the rear principal plane, in the last medium. */
  efl: number;
  /** Front effective focal length -det/C (= -(n_in/n_out)/C). */
  frontEfl: number;
  /** Back focal length -A/C: from the last element to the rear focal point. */
  bfl: number;
  /** Front focal length -D/C: from the first element back to the front focal point, positive in front. */
  ffl: number;
}

/** The focal lengths a system matrix gives, or null for an afocal system (C = 0). */
export function cardinal(m: Matrix): Cardinal | null {
  const [A, , C, D] = m;
  if (Math.abs(C) < 1e-12) return null;
  const det = m[0] * m[3] - m[1] * m[2];
  return { efl: -1 / C, frontEfl: -det / C, bfl: -A / C, ffl: -D / C };
}

/**
 * The image of an object a distance s in front of the first element: s' after the last, and the magnification. With
 * a gap s' after the system the matrix is [A + s'C, B + s'D; C, D], and the image is where its B is 0.
 */
export function imageThrough(m: Matrix, s: number) {
  const [A, B, C, D] = multiply(m, gapMatrix(s));
  if (Math.abs(D) < 1e-12) fail('kitPhysics.geooptics.errors.atFocus');
  const si = -B / D;
  return { si, m: A + si * C, real: si > 0, matrix: [A, B, C, D] as Matrix };
}

/** Numerical aperture of a step-index fiber, and its acceptance half-angle in a medium of index n0. */
export function fiber(nCore: number, nClad: number, n0: number) {
  if (nClad >= nCore) fail('kitPhysics.geooptics.errors.noGuide');
  const na = Math.sqrt(nCore * nCore - nClad * nClad);
  const s = na / n0;
  return { na, acceptance: s >= 1 ? Math.PI / 2 : Math.asin(s), critical: Math.asin(nClad / nCore) };
}

/** The first zero of J0: a step-index fiber with V below it carries one mode. */
export const SINGLE_MODE_V = 2.404825557695773;

export interface Beam {
  zR: number;
  w: number;
  /** Radius of curvature of the wavefront; Infinity at the waist. */
  R: number;
  gouy: number;
  /** Far-field half-angle of divergence. */
  theta: number;
}

/** A Gaussian beam of waist w0 (1/e² radius) and wavelength lambda in the medium, a distance z from its waist. */
export function gaussianBeam(lambda: number, w0: number, z: number, m2 = 1): Beam {
  const zR = (Math.PI * w0 * w0) / (m2 * lambda);
  const ratio = z / zR;
  return {
    zR,
    w: w0 * Math.sqrt(1 + ratio * ratio),
    R: z === 0 ? Infinity : z * (1 + 1 / (ratio * ratio)),
    gouy: Math.atan(ratio),
    theta: (m2 * lambda) / (Math.PI * w0),
  };
}

/** A beam's q parameter after an ABCD matrix: q2 = (A q1 + B) / (C q1 + D), with q = z + i zR. */
export function transformQ(m: Matrix, q: readonly [number, number]): [number, number] {
  const [A, B, C, D] = m;
  const top: [number, number] = [A * q[0] + B, A * q[1]];
  const bottom: [number, number] = [C * q[0] + D, C * q[1]];
  const d2 = bottom[0] * bottom[0] + bottom[1] * bottom[1];
  return [(top[0] * bottom[0] + top[1] * bottom[1]) / d2, (top[1] * bottom[0] - top[0] * bottom[1]) / d2];
}

/** A beam with its waist d1 before a thin lens f: the q after the lens, the new waist and where it sits. */
export function beamThroughLens(lambda: number, w0: number, d1: number, f: number, m2 = 1) {
  const zR = (Math.PI * w0 * w0) / (m2 * lambda);
  const q2 = transformQ(lensMatrix(f), [d1, zR]);
  // q2 = z + i zR' with z the distance past the new waist, so the waist sits -z after the lens.
  const zR2 = q2[1];
  return { zR, q2, d2: -q2[0], zR2, w02: Math.sqrt((zR2 * m2 * lambda) / Math.PI) };
}
