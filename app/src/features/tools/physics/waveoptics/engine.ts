// Wave optics in closed form: slits, gratings, circular apertures, thin films, Malus's law, the Fresnel equations,
// and Jones calculus. Everything is in SI units with angles in radians. Jones vectors use the e^{i(kz - wt)} phase
// convention, so a wave plate delays its slow axis by e^{i Gamma}, and (1, -i)/sqrt 2 is right circular: clockwise
// as seen facing the oncoming light.
import { fail } from '../kit/read';

/** The first zero of J1 over pi, the Rayleigh criterion's 1.21967. */
export const AIRY = 3.831705970207512 / Math.PI;

/** sin(x) / x, 1 at 0. */
export const sinc = (x: number): number => (Math.abs(x) < 1e-8 ? 1 - (x * x) / 6 : Math.sin(x) / x);

/** Bessel J1 by its integral (1/pi) * integral from 0 to pi of cos(tau - x sin tau), Simpson's rule on 400 panels. */
export function besselJ1(x: number): number {
  const n = 400;
  const h = Math.PI / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const tau = i * h;
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    sum += w * Math.cos(tau - x * Math.sin(tau));
  }
  return (sum * h) / 3 / Math.PI;
}

/** The angle whose sine is s, or null past 1 (no such order or ray). */
const asinOrNull = (s: number): number | null => (Math.abs(s) <= 1 ? Math.asin(s) : null);

/** Position on a screen at distance L for angle theta: L tan theta. */
export const screenY = (L: number, theta: number): number => L * Math.tan(theta);

/** Double slit: bright fringe m at d sin theta = m lambda. The small-angle spacing is lambda L / d. */
export function doubleSlit(lambda: number, d: number, L: number, orders: number) {
  if (lambda >= d) fail('kitPhysics.waveoptics.errors.slitTooNarrow');
  const fringes: { m: number; theta: number; y: number }[] = [];
  for (let m = 0; m <= orders; m++) {
    const theta = asinOrNull((m * lambda) / d);
    if (theta === null) break;
    fringes.push({ m, theta, y: screenY(L, theta) });
  }
  return { spacing: (lambda * L) / d, fringes };
}

/** Intensity relative to the center for slits d apart, each a wide (a = 0 for narrow slits), at angle theta. */
export function slitIntensity(lambda: number, d: number, a: number, theta: number): number {
  const s = Math.sin(theta);
  const phi = (Math.PI * d * s) / lambda;
  const beta = (Math.PI * a * s) / lambda;
  return Math.cos(phi) ** 2 * sinc(beta) ** 2;
}

/** Single slit: minima at a sin theta = m lambda. */
export function singleSlit(lambda: number, a: number, L: number) {
  const theta = asinOrNull(lambda / a);
  if (theta === null) fail('kitPhysics.waveoptics.errors.slitTooNarrow');
  const y = screenY(L, theta);
  return { theta, y, small: (lambda * L) / a, width: 2 * y };
}

/** Grating with d between lines: every order with |m lambda / d| <= 1, its angle, and the resolving power m N. */
export function grating(lambda: number, d: number) {
  const orders: { m: number; theta: number }[] = [];
  const top = Math.floor(d / lambda + 1e-12);
  for (let m = 1; m <= top; m++) {
    const theta = asinOrNull((m * lambda) / d);
    if (theta !== null) orders.push({ m, theta });
  }
  if (!orders.length) fail('kitPhysics.waveoptics.errors.noOrders');
  return orders;
}

/** Rayleigh criterion for a circular aperture of diameter D: theta = 1.21967 lambda / D. */
export function rayleigh(lambda: number, D: number) {
  const s = (AIRY * lambda) / D;
  if (s >= 1) fail('kitPhysics.waveoptics.errors.apertureTooSmall');
  return { theta: Math.asin(s), small: s };
}

/** Airy pattern intensity relative to the center: (2 J1(x) / x)², x = pi D sin theta / lambda. */
export function airy(lambda: number, D: number, theta: number): number {
  const x = (Math.PI * D * Math.sin(theta)) / lambda;
  return Math.abs(x) < 1e-8 ? 1 : ((2 * besselJ1(x)) / x) ** 2;
}

/** How many half-wave phase flips a film's two reflections add: one at each surface going to a higher index. */
export function filmFlips(nAbove: number, nFilm: number, nBelow: number): number {
  if (nFilm === nAbove) fail('kitPhysics.waveoptics.errors.noFilm');
  return (nFilm > nAbove ? 1 : 0) + (nBelow > nFilm ? 1 : 0);
}

/**
 * Film thicknesses for bright and dark reflection at lambda (in vacuum). With one flip, 2 n t = (m + ½) lambda is
 * bright and 2 n t = m lambda is dark; with none or two, the other way round. Thickness 0 is left out.
 */
export function filmThicknesses(lambda: number, n: number, flips: number, count: number) {
  const step = lambda / (2 * n);
  const half = Array.from({ length: count }, (_, m) => (m + 0.5) * step);
  const whole = Array.from({ length: count }, (_, m) => (m + 1) * step);
  return flips === 1 ? { bright: half, dark: whole } : { bright: whole, dark: half };
}

/** Wavelengths in [low, high] that a film of thickness t reflects brightly or cancels, longest first. */
export function filmWavelengths(t: number, n: number, flips: number, low: number, high: number) {
  const path = 2 * n * t;
  const list = (offset: number) => {
    const out: number[] = [];
    for (let m = 0; m < 10_000; m++) {
      const order = m + offset;
      if (order <= 0) continue;
      const lambda = path / order;
      if (lambda < low) break;
      if (lambda <= high) out.push(lambda);
    }
    return out;
  };
  return flips === 1 ? { bright: list(0.5), dark: list(0) } : { bright: list(0), dark: list(0.5) };
}

/** Malus's law through a chain of ideal polarizers. Unpolarized light loses half at the first. */
export function malus(I0: number, angles: readonly number[], incoming: number | null) {
  let I = I0;
  let axis = incoming;
  return angles.map((angle) => {
    I = axis === null ? I / 2 : I * Math.cos(angle - axis) ** 2;
    axis = angle;
    return I;
  });
}

export interface Fresnel {
  thetaT: number | null;
  rs: number;
  rp: number;
  Rs: number;
  Rp: number;
  tir: boolean;
}

/** The Fresnel equations for amplitudes and powers, from index n1 into n2 at incidence theta. */
export function fresnel(n1: number, n2: number, theta: number): Fresnel {
  const ci = Math.cos(theta);
  const st = (n1 / n2) * Math.sin(theta);
  if (st > 1) return { thetaT: null, rs: 1, rp: 1, Rs: 1, Rp: 1, tir: true };
  const ct = Math.sqrt((1 - st) * (1 + st));
  const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  const rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
  return { thetaT: Math.asin(st), rs, rp, Rs: rs * rs, Rp: rp * rp, tir: false };
}

/** Brewster's angle atan(n2 / n1), and the critical angle asin(n2 / n1) when n2 < n1. */
export const brewster = (n1: number, n2: number): number => Math.atan2(n2, n1);
export const critical = (n1: number, n2: number): number | null => (n2 < n1 ? Math.asin(n2 / n1) : null);

// Jones calculus with complex numbers as [re, im].
export type Cx = readonly [number, number];
export type Jones = readonly [Cx, Cx];
type Matrix = readonly [readonly [Cx, Cx], readonly [Cx, Cx]];

const mul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const add = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
const real = (x: number): Cx => [x, 0];
const polar = (r: number, phase: number): Cx => [r * Math.cos(phase), r * Math.sin(phase)];
const abs2 = (a: Cx): number => a[0] * a[0] + a[1] * a[1];

/** A linear retarder with its fast axis at theta and retardance gamma: R(-theta) diag(1, e^{i gamma}) R(theta). */
export function retarder(theta: number, gamma: number): Matrix {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = polar(1, gamma);
  const cc = add(real(c * c), mul(real(s * s), e));
  const ss = add(real(s * s), mul(real(c * c), e));
  const cs = mul(real(c * s), add(real(1), mul(real(-1), e)));
  return [
    [cc, cs],
    [cs, ss],
  ];
}

/** An ideal linear polarizer with its transmission axis at theta. */
export function polarizer(theta: number): Matrix {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    [real(c * c), real(c * s)],
    [real(c * s), real(s * s)],
  ];
}

export const applyJones = (m: Matrix, v: Jones): Jones => [
  add(mul(m[0][0], v[0]), mul(m[0][1], v[1])),
  add(mul(m[1][0], v[0]), mul(m[1][1], v[1])),
];

/** A Jones vector from the two amplitudes and the phase of y ahead of x. */
export const jonesOf = (ax: number, ay: number, phase: number): Jones => [real(ax), polar(ay, phase)];

export interface PolarizationState {
  intensity: number;
  /** Azimuth of the major axis, -90 to 90 degrees in radians, and ellipticity angle chi (tan chi = b / a, signed). */
  azimuth: number;
  ellipticity: number;
  kind: 'none' | 'linear' | 'circular' | 'elliptical';
  /** 'cw' turns clockwise as seen facing the oncoming light (right-handed here); 'ccw' counterclockwise. */
  turn: 'cw' | 'ccw' | null;
  stokes: readonly [number, number, number, number];
}

/** The polarization a Jones vector describes, through its Stokes parameters. */
export function describe(v: Jones): PolarizationState {
  const [ex, ey] = v;
  const S0 = abs2(ex) + abs2(ey);
  const S1 = abs2(ex) - abs2(ey);
  // Ex* Ey
  const cross: Cx = [ex[0] * ey[0] + ex[1] * ey[1], ex[0] * ey[1] - ex[1] * ey[0]];
  const S2 = 2 * cross[0];
  const S3 = 2 * cross[1];
  const stokes = [S0, S1, S2, S3] as const;
  if (S0 < 1e-24) return { intensity: 0, azimuth: 0, ellipticity: 0, kind: 'none', turn: null, stokes };
  const azimuth = 0.5 * Math.atan2(S2, S1);
  const ellipticity = 0.5 * Math.asin(Math.max(-1, Math.min(1, S3 / S0)));
  const r = Math.abs(S3) / S0;
  const kind = r < 1e-9 ? 'linear' : r > 1 - 1e-9 ? 'circular' : 'elliptical';
  const turn = kind === 'linear' ? null : S3 > 0 ? 'ccw' : 'cw';
  return { intensity: S0, azimuth, ellipticity, kind, turn, stokes };
}
