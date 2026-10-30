// Two-body orbital mechanics in SI units (m, m/s, s, rad): state vectors and classical elements both ways, Kepler's
// equation, universal-variable propagation for every conic, ground tracks, J2 drift, and eclipses. The algorithms
// follow Curtis, Orbital Mechanics for Engineering Students (4.2, 4.5, 3.3, 3.4).
import { fail } from '../kit/read';

export type Vec = [number, number, number];

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const TWO_PI = 2 * Math.PI;
/** An angle in [0, 2 pi). */
export const wrap = (angle: number): number => ((angle % TWO_PI) + TWO_PI) % TWO_PI;

export interface Body {
  id: string;
  /** Gravitational parameter, m³/s². */
  mu: number;
  /** Equatorial radius, m. */
  radius: number;
  J2: number;
  /** Rotation rate, rad/s. */
  rotation: number;
}

/** Earth (WGS 84 and EGM2008 J2), the Moon, Mars, and the Sun. */
export const BODIES: readonly Body[] = [
  { id: 'earth', mu: 3.986004418e14, radius: 6_378_137, J2: 1.08262668e-3, rotation: 7.2921159e-5 },
  { id: 'moon', mu: 4.9028e12, radius: 1_737_400, J2: 2.033e-4, rotation: 2.6617e-6 },
  { id: 'mars', mu: 4.282837e13, radius: 3_396_190, J2: 1.96045e-3, rotation: 7.088218e-5 },
  { id: 'sun', mu: 1.32712440018e20, radius: 695_700_000, J2: 0, rotation: 2.865e-6 },
];
export const EARTH = BODIES[0];

export interface Elements {
  a: number;
  e: number;
  i: number;
  raan: number;
  argp: number;
  nu: number;
  /** Specific angular momentum, m²/s, and specific energy, J/kg. */
  h: number;
  energy: number;
  /** True when the node line or the periapsis is undefined and the reported angle stands in for it. */
  equatorial: boolean;
  circular: boolean;
}

export interface Workings {
  hVec: Vec;
  nVec: Vec;
  eVec: Vec;
  vr: number;
}

const SMALL = 1e-10;

/** Classical orbital elements from a state vector (Curtis algorithm 4.2), with the vectors it passes through. */
export function stateToElements(r: Vec, v: Vec, mu: number): Elements & { work: Workings } {
  const rm = norm(r);
  const vm = norm(v);
  if (rm === 0) fail('kitPhysics.orbits.errors.zeroRadius');
  const vr = dot(r, v) / rm;
  const hVec = cross(r, v);
  const h = norm(hVec);
  if (h <= SMALL * rm * Math.max(vm, 1)) fail('kitPhysics.orbits.errors.radial');
  const i = Math.acos(Math.max(-1, Math.min(1, hVec[2] / h)));
  const nVec: Vec = [-hVec[1], hVec[0], 0];
  const n = norm(nVec);
  const eVec = scale(add(scale(r, vm * vm - mu / rm), scale(v, -rm * vr)), 1 / mu);
  const e = norm(eVec);
  const energy = (vm * vm) / 2 - mu / rm;
  const a = Math.abs(1 - e) < 1e-12 ? Infinity : (h * h) / mu / (1 - e * e);
  const equatorial = n <= SMALL * h;
  const circular = e < 1e-9;
  const angle = (x: number) => Math.acos(Math.max(-1, Math.min(1, x)));
  // Undefined angles: an equatorial orbit measures from the x axis; a circular orbit measures from the node.
  let raan = equatorial ? 0 : angle(nVec[0] / n);
  if (!equatorial && nVec[1] < 0) raan = TWO_PI - raan;
  const ref: Vec = equatorial ? [1, 0, 0] : scale(nVec, 1 / n);
  let argp = 0;
  if (!circular) {
    argp = angle(dot(ref, eVec) / e);
    const below = equatorial ? (hVec[2] >= 0 ? eVec[1] < 0 : eVec[1] > 0) : eVec[2] < 0;
    if (below) argp = TWO_PI - argp;
  }
  const from: Vec = circular ? ref : scale(eVec, 1 / e);
  let nu = angle(dot(from, r) / rm);
  const behind = circular ? dot(cross(from, r), hVec) < 0 : vr < 0;
  if (behind) nu = TWO_PI - nu;
  return { a, e, i, raan, argp, nu, h, energy, equatorial, circular, work: { hVec, nVec, eVec, vr } };
}

/** A state vector from classical elements (Curtis algorithm 4.5), through the perifocal frame. */
export function elementsToState(a: number, e: number, i: number, raan: number, argp: number, nu: number, mu: number) {
  if (e < 0) fail('kitPhysics.orbits.errors.eccentricity');
  if (e === 1) fail('kitPhysics.orbits.errors.parabola');
  if (e < 1 && !(a > 0)) fail('kitPhysics.orbits.errors.ellipseA');
  if (e > 1 && !(a < 0)) fail('kitPhysics.orbits.errors.hyperbolaA');
  const p = a * (1 - e * e);
  if (e > 1 && Math.cos(nu) <= -1 / e) fail('kitPhysics.orbits.errors.asymptote');
  const rm = p / (1 + e * Math.cos(nu));
  const rp: Vec = [rm * Math.cos(nu), rm * Math.sin(nu), 0];
  const k = Math.sqrt(mu / p);
  const vp: Vec = [-k * Math.sin(nu), k * (e + Math.cos(nu)), 0];
  const [cO, sO, ci, si, cw, sw] = [
    Math.cos(raan),
    Math.sin(raan),
    Math.cos(i),
    Math.sin(i),
    Math.cos(argp),
    Math.sin(argp),
  ];
  // The perifocal-to-inertial rotation R3(-raan) R1(-i) R3(-argp).
  const Q = [
    [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si],
    [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
    [sw * si, cw * si, ci],
  ];
  const rotate = (x: Vec): Vec => [dot(Q[0] as Vec, x), dot(Q[1] as Vec, x), dot(Q[2] as Vec, x)];
  return { r: rotate(rp), v: rotate(vp), rPerifocal: rp, vPerifocal: vp, p };
}

/** Kepler's equation M = E - e sin E (ellipse) or M = e sinh F - F (hyperbola), by Newton's method. */
export function solveKepler(M: number, e: number): { E: number; iterations: number } {
  if (e < 0) fail('kitPhysics.orbits.errors.eccentricity');
  if (e < 1) {
    const m = wrap(M + Math.PI) - Math.PI;
    // Danby's starting value converges for every eccentricity below 1.
    let E = m + 0.85 * e * Math.sign(Math.sin(m) || 1);
    for (let k = 1; k <= 60; k++) {
      const step = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
      E -= step;
      if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(E))) return { E: E + (M - m), iterations: k };
    }
    return { E: E + (M - m), iterations: 60 };
  }
  if (e === 1) fail('kitPhysics.orbits.errors.parabola');
  let F = Math.asinh(M / e);
  for (let k = 1; k <= 100; k++) {
    const step = (e * Math.sinh(F) - F - M) / (e * Math.cosh(F) - 1);
    F -= step;
    if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(F))) return { E: F, iterations: k };
  }
  return { E: F, iterations: 100 };
}

/** True anomaly from the eccentric (or hyperbolic) anomaly, and back. */
export function trueFromEccentric(E: number, e: number): number {
  if (e < 1) return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(E / 2));
}

export function eccentricFromTrue(nu: number, e: number): number {
  if (e < 1) return 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  return 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
}

/** Mean anomaly from the eccentric (or hyperbolic) anomaly. */
export const meanFromEccentric = (E: number, e: number): number => (e < 1 ? E - e * Math.sin(E) : e * Math.sinh(E) - E);

/** Stumpff functions C(z) and S(z), with series near z = 0. */
export function stumpff(z: number): { C: number; S: number } {
  if (Math.abs(z) < 1e-3) {
    return {
      C: 1 / 2 - z / 24 + (z * z) / 720 - (z * z * z) / 40320,
      S: 1 / 6 - z / 120 + (z * z) / 5040 - (z * z * z) / 362880,
    };
  }
  if (z > 0) {
    const s = Math.sqrt(z);
    return { C: (1 - Math.cos(s)) / z, S: (s - Math.sin(s)) / (s * s * s) };
  }
  const s = Math.sqrt(-z);
  return { C: (Math.cosh(s) - 1) / -z, S: (Math.sinh(s) - s) / (s * s * s) };
}

/** The state after time dt by universal variables (Curtis algorithms 3.3 and 3.4), for any conic. */
export function propagate(r0: Vec, v0: Vec, dt: number, mu: number) {
  const rm = norm(r0);
  const vm = norm(v0);
  if (rm === 0) fail('kitPhysics.orbits.errors.zeroRadius');
  const alpha = 2 / rm - (vm * vm) / mu;
  // On an ellipse, whole periods change nothing: step only the remainder, so the solve starts close.
  let t = dt;
  if (alpha > 0) {
    const period = TWO_PI / Math.sqrt(mu * alpha ** 3);
    t = dt - period * Math.round(dt / period);
  }
  const vr = dot(r0, v0) / rm;
  const sq = Math.sqrt(mu);
  let x = sq * Math.abs(alpha) * t;
  if (alpha <= 0 || !Number.isFinite(x)) x = (Math.sign(t) * Math.sqrt(mu) * Math.abs(t)) / rm;
  let converged = false;
  for (let k = 0; k < 200; k++) {
    const z = alpha * x * x;
    const { C, S } = stumpff(z);
    const F = ((rm * vr) / sq) * x * x * C + (1 - alpha * rm) * x * x * x * S + rm * x - sq * t;
    const dF = ((rm * vr) / sq) * x * (1 - z * S) + (1 - alpha * rm) * x * x * C + rm;
    const step = F / dF;
    x -= step;
    if (Math.abs(step) <= 1e-13 * Math.max(1, Math.abs(x))) {
      converged = true;
      break;
    }
  }
  if (!converged) fail('kitPhysics.orbits.errors.noConverge');
  const z = alpha * x * x;
  const { C, S } = stumpff(z);
  const f = 1 - ((x * x) / rm) * C;
  const g = t - (x * x * x * S) / sq;
  const r = add(scale(r0, f), scale(v0, g));
  const r1 = norm(r);
  const fdot = (sq / (r1 * rm)) * (alpha * x * x * x * S - x);
  const gdot = 1 - ((x * x) / r1) * C;
  const v = add(scale(r0, fdot), scale(v0, gdot));
  return { r, v, chi: x, alpha, f, g, fdot, gdot };
}

/** The period of an ellipse of semi-major axis a. */
export const period = (a: number, mu: number): number => TWO_PI * Math.sqrt((a * a * a) / mu);

/** The radius of a circular orbit with this period: (mu (T / 2 pi)²)^(1/3). */
export const radiusForPeriod = (T: number, mu: number): number => Math.cbrt(mu * (T / TWO_PI) ** 2);

/** Secular J2 drift of the node and periapsis, rad/s (Curtis 4.52 and 4.53). */
export function j2Rates(a: number, e: number, i: number, body: Body) {
  const k = (1.5 * Math.sqrt(body.mu) * body.J2 * body.radius ** 2) / ((1 - e * e) ** 2 * a ** 3.5);
  return { raanRate: -k * Math.cos(i), argpRate: -k * (2.5 * Math.sin(i) ** 2 - 2) };
}

/** The Sun's mean motion against the equinox (one tropical year), rad/s: what a Sun-synchronous node must match. */
export const SUN_RATE = TWO_PI / (365.2421897 * 86_400);

/** The inclination that makes the node drift with the Sun, or null when no inclination can. */
export function sunSynchronous(a: number, e: number, body: Body): number | null {
  const k = (1.5 * Math.sqrt(body.mu) * body.J2 * body.radius ** 2) / ((1 - e * e) ** 2 * a ** 3.5);
  const c = -SUN_RATE / k;
  return Math.abs(c) <= 1 ? Math.acos(c) : null;
}

/** The fraction of a circular orbit spent in a cylindrical shadow, for a Sun at angle beta from the orbit plane. */
export function eclipseFraction(r: number, beta: number, R: number): number {
  const h = r - R;
  const limit = Math.asin(R / r);
  if (Math.abs(beta) >= limit) return 0;
  return Math.acos(Math.sqrt(h * h + 2 * R * h) / (r * Math.cos(beta))) / Math.PI;
}

/** Latitude and longitude beneath the spacecraft, rad, with the body turning at its rotation rate from angle theta0. */
export function subPoint(r: Vec, t: number, body: Body, theta0: number): [number, number] {
  const theta = theta0 + body.rotation * t;
  const x = Math.cos(theta) * r[0] + Math.sin(theta) * r[1];
  const y = -Math.sin(theta) * r[0] + Math.cos(theta) * r[1];
  return [Math.asin(r[2] / norm(r)), Math.atan2(y, x)];
}

/**
 * A ground track from classical elements over `duration`: Kepler's equation for the motion and, when `withJ2`, the
 * node and periapsis drifting at their J2 rates.
 */
export function groundTrack(
  el: { a: number; e: number; i: number; raan: number; argp: number; nu: number },
  duration: number,
  body: Body,
  theta0: number,
  withJ2: boolean,
  steps = 720,
): [number, number][] {
  if (!(el.e < 1)) fail('kitPhysics.orbits.errors.closedOnly');
  const n = Math.sqrt(body.mu / el.a ** 3);
  const rates = withJ2 ? j2Rates(el.a, el.e, el.i, body) : { raanRate: 0, argpRate: 0 };
  const M0 = meanFromEccentric(eccentricFromTrue(el.nu, el.e), el.e);
  const points: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const t = (duration * k) / steps;
    const nu = trueFromEccentric(solveKepler(M0 + n * t, el.e).E, el.e);
    const { r } = elementsToState(
      el.a,
      el.e,
      el.i,
      el.raan + rates.raanRate * t,
      el.argp + rates.argpRate * t,
      nu,
      body.mu,
    );
    points.push(subPoint(r, t, body, theta0));
  }
  return points;
}

export { cross, dot, norm };
