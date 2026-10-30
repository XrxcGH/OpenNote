// Impulsive orbital maneuvers in SI units: Hohmann and bi-elliptic transfers, plane changes, phasing orbits, and
// Lambert's problem by universal variables (Curtis, Orbital Mechanics for Engineering Students, algorithm 5.2).
import { fail } from '../kit/read';
import { stumpff } from '../orbits/engine';
import type { Vec } from '../orbits/engine';

const circular = (mu: number, r: number) => Math.sqrt(mu / r);
/** Vis-viva: the speed at radius r on an orbit of semi-major axis a. */
export const visViva = (mu: number, r: number, a: number): number => Math.sqrt(mu * (2 / r - 1 / a));

/** Two burns on an ellipse tangent to both circles; the second burn can also turn the plane by di. */
export function hohmann(r1: number, r2: number, mu: number, di = 0) {
  if (!(r1 > 0 && r2 > 0)) fail('kitPhysics.maneuvers.errors.radius');
  const a = (r1 + r2) / 2;
  const v1 = circular(mu, r1);
  const v2 = circular(mu, r2);
  const vt1 = visViva(mu, r1, a);
  const vt2 = visViva(mu, r2, a);
  const dv1 = Math.abs(vt1 - v1);
  // The law of cosines on the velocity vectors before and after the burn.
  const dv2 = Math.sqrt(vt2 * vt2 + v2 * v2 - 2 * vt2 * v2 * Math.cos(di));
  return {
    a,
    e: Math.abs(r2 - r1) / (r1 + r2),
    v1,
    v2,
    vt1,
    vt2,
    dv1,
    dv2,
    total: dv1 + dv2,
    time: Math.PI * Math.sqrt(a ** 3 / mu),
  };
}

/** Three burns: out to rb on a first ellipse, then down (or up) to r2 on a second. */
export function biElliptic(r1: number, r2: number, rb: number, mu: number) {
  if (!(rb >= Math.max(r1, r2))) fail('kitPhysics.maneuvers.errors.rbSmall');
  const a1 = (r1 + rb) / 2;
  const a2 = (r2 + rb) / 2;
  const dv1 = Math.abs(visViva(mu, r1, a1) - circular(mu, r1));
  const dv2 = Math.abs(visViva(mu, rb, a2) - visViva(mu, rb, a1));
  const dv3 = Math.abs(visViva(mu, r2, a2) - circular(mu, r2));
  return {
    a1,
    a2,
    dv1,
    dv2,
    dv3,
    total: dv1 + dv2 + dv3,
    time: Math.PI * (Math.sqrt(a1 ** 3 / mu) + Math.sqrt(a2 ** 3 / mu)),
  };
}

/** A plane change of di at speed v alone, and combined with a speed change from v1 to v2. */
export const planeChange = (v: number, di: number): number => 2 * v * Math.sin(di / 2);
export const combinedChange = (v1: number, v2: number, di: number): number =>
  Math.sqrt(v1 * v1 + v2 * v2 - 2 * v1 * v2 * Math.cos(di));

/**
 * A phasing orbit for a chaser on a circular orbit of radius r, with the target `phase` ahead (negative: behind),
 * caught up after `revs` turns of the phasing orbit. Its period is T (1 - phase / (2 pi revs)).
 */
export function phasing(r: number, phase: number, revs: number, mu: number, bodyRadius: number) {
  const T = 2 * Math.PI * Math.sqrt(r ** 3 / mu);
  const Tp = T * (1 - phase / (2 * Math.PI * revs));
  if (!(Tp > 0)) fail('kitPhysics.maneuvers.errors.phaseTooBig');
  const a = Math.cbrt(mu * (Tp / (2 * Math.PI)) ** 2);
  const other = 2 * a - r;
  if (other <= bodyRadius) fail('kitPhysics.maneuvers.errors.phasingLow');
  const v = circular(mu, r);
  const vp = visViva(mu, r, a);
  const dv = Math.abs(vp - v);
  return { T, Tp, a, other, v, vp, dv, total: 2 * dv, wait: revs * Tp };
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);

/**
 * Lambert's problem: the orbit from r1 to r2 in time dt, the short way round for a prograde transfer. Universal
 * variables with z found by bisection: the time of flight grows with z, so the root is bracketed.
 */
export function lambert(r1v: Vec, r2v: Vec, dt: number, mu: number, prograde = true) {
  if (!(dt > 0)) fail('kitPhysics.maneuvers.errors.time');
  const r1 = norm(r1v);
  const r2 = norm(r2v);
  if (r1 === 0 || r2 === 0) fail('kitPhysics.maneuvers.errors.radius');
  const c = cross(r1v, r2v);
  let theta = Math.acos(Math.max(-1, Math.min(1, dot(r1v, r2v) / (r1 * r2))));
  if (prograde ? c[2] < 0 : c[2] >= 0) theta = 2 * Math.PI - theta;
  const A = Math.sin(theta) * Math.sqrt((r1 * r2) / (1 - Math.cos(theta)));
  // Within about a thousandth of a degree of 0° or 180°, the transfer plane is too poorly set to trust.
  if (!Number.isFinite(A) || Math.abs(Math.sin(theta)) < 2e-5) fail('kitPhysics.maneuvers.errors.collinear');
  const y = (z: number) => {
    const { C, S } = stumpff(z);
    return r1 + r2 + (A * (z * S - 1)) / Math.sqrt(C);
  };
  const F = (z: number) => {
    const yz = y(z);
    if (yz < 0) return -Infinity;
    const { C, S } = stumpff(z);
    return (yz / C) ** 1.5 * S + A * Math.sqrt(yz) - Math.sqrt(mu) * dt;
  };
  // Just short of one revolution (z = 4 pi²), where C(z) still has digits to spare.
  let high = 4 * Math.PI * Math.PI * (1 - 1e-6);
  let low = -4;
  while (F(low) > 0 && low > -1e6) low *= 2;
  if (F(low) > 0) fail('kitPhysics.maneuvers.errors.noLambert');
  if (!(F(high) > 0)) fail('kitPhysics.maneuvers.errors.multiRev');
  for (let k = 0; k < 300 && high - low > 1e-14 * Math.max(1, Math.abs(low)); k++) {
    const mid = (low + high) / 2;
    if (F(mid) < 0) low = mid;
    else high = mid;
  }
  const z = (low + high) / 2;
  const yz = y(z);
  const f = 1 - yz / r1;
  const g = A * Math.sqrt(yz / mu);
  const gdot = 1 - yz / r2;
  const v1: Vec = [(r2v[0] - f * r1v[0]) / g, (r2v[1] - f * r1v[1]) / g, (r2v[2] - f * r1v[2]) / g];
  const v2: Vec = [(gdot * r2v[0] - r1v[0]) / g, (gdot * r2v[1] - r1v[1]) / g, (gdot * r2v[2] - r1v[2]) / g];
  return { v1, v2, theta, z, A, f, g, gdot };
}
