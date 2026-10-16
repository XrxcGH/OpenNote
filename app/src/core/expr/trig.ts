// Trigonometry in degrees or radians. Angles that are whole degrees with a known sine, such as 30, 45, 60, and
// every multiple of 90, give exact answers, so sin(180°) is 0 and not 1.2e-16, and tan(90°) is an error.

import { fail } from './numeric';

export type AngleMode = 'deg' | 'rad';

const FIRST_QUADRANT = new Map<number, number>([
  [0, 0],
  [30, 0.5],
  [45, Math.SQRT1_2],
  [60, Math.sqrt(3) / 2],
  [90, 1],
]);

const toDegrees = (x: number, mode: AngleMode) => (mode === 'deg' ? x : (x * 180) / Math.PI);
const toRadians = (x: number, mode: AngleMode) => (mode === 'deg' ? (x * Math.PI) / 180 : x);

/** Converts an angle in radians to the current mode. */
export function fromRadians(radians: number, mode: AngleMode): number {
  return mode === 'deg' ? (radians * 180) / Math.PI : radians;
}

/** Converts degrees to the current mode, for the degree sign. */
export function degreesToMode(degrees: number, mode: AngleMode): number {
  return mode === 'deg' ? degrees : (degrees * Math.PI) / 180;
}

function exactSine(degrees: number): number | null {
  const whole = Math.round(degrees);
  if (Math.abs(degrees) > 1e9 || Math.abs(degrees - whole) > 1e-9) return null;
  const turn = ((whole % 360) + 360) % 360;
  const half = turn > 180 ? turn - 180 : turn;
  const base = FIRST_QUADRANT.get(half > 90 ? 180 - half : half);
  return base === undefined ? null : (turn > 180 ? -1 : 1) * base;
}

export function sin(x: number, mode: AngleMode): number {
  return exactSine(toDegrees(x, mode)) ?? Math.sin(toRadians(x, mode));
}

export function cos(x: number, mode: AngleMode): number {
  return exactSine(toDegrees(x, mode) + 90) ?? Math.cos(toRadians(x, mode));
}

/** The tangent. Throws a 'domain' error where the cosine is exactly zero. */
export function tan(x: number, mode: AngleMode): number {
  const degrees = toDegrees(x, mode);
  const sine = exactSine(degrees);
  const cosine = exactSine(degrees + 90);
  if (cosine === 0) fail('domain');
  return sine !== null && cosine !== null ? sine / cosine : Math.tan(toRadians(x, mode));
}
