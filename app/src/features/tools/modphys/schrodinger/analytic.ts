// Exact results to set beside the numerical ones: finite square well levels from the transcendental equations,
// transmission through steps and rectangular barriers or wells, transfer matrices for piecewise-constant
// potentials, the WKB estimate, and a spherical quantum dot. Lengths are in nm and energies in eV.
import { cabs, cadd, cdiv, cexp, cmul, csqrt, csub, cx } from '../../kits/num/complex';
import type { Complex } from '../../kits/num/complex';
import { brent } from '../../kits/num/roots';
import { C } from '../shared/constants';
import { fail, positive } from '../shared/errors';
import { HB2M } from './solver';

/** The first zeros of the Airy function Ai, for the linear (bouncing-ball) potential. */
export const AIRY_ZEROS = [
  2.338107410459767, 4.08794944413097, 5.520559828095551, 6.786708090071759, 7.944133587120853, 9.02265085334098,
  10.04017434155809, 11.00852430373326, 11.93601556323626, 12.828776752865757,
];

/**
 * Bound states of a finite square well of depth V0 and width L, measured from the bottom: even states solve
 * z tan z = √(z0² − z²) and odd states −z cot z = √(z0² − z²), with z0 = (L/2)√(2mV0)/ħ and E = z²ħ²/(2m a²).
 */
export function finiteWell(v0: number, width: number, massRatio: number): { z0: number; energies: number[] } {
  positive(v0, 'depth');
  positive(width, 'width');
  const a = width / 2;
  const c = HB2M / massRatio;
  const z0 = a * Math.sqrt(v0 / c);
  const energies: number[] = [];
  for (let n = 0; n * (Math.PI / 2) < z0; n += 1) {
    const lo = n * (Math.PI / 2) + 1e-12;
    const hi = Math.min((n + 1) * (Math.PI / 2) - 1e-12, z0);
    const even = n % 2 === 0;
    const f = (z: number) =>
      even
        ? z * Math.sin(z) - Math.sqrt(Math.max(0, z0 * z0 - z * z)) * Math.cos(z)
        : -z * Math.cos(z) - Math.sqrt(Math.max(0, z0 * z0 - z * z)) * Math.sin(z);
    if (f(lo) * f(hi) > 0) continue;
    const z = brent(f, lo, hi, 1e-15).x;
    energies.push((z * z * c) / (a * a));
  }
  return { z0, energies };
}

/** Transmission and reflection for a particle of energy E on a step of height V0 (either sign). */
export function step(e: number, v0: number, massRatio: number): { t: number; r: number; k1: number; k2: number } {
  positive(e, 'energy');
  const c = HB2M / massRatio;
  const k1 = Math.sqrt(e / c);
  if (e <= v0) return { t: 0, r: 1, k1, k2: Math.sqrt((v0 - e) / c) };
  const k2 = Math.sqrt((e - v0) / c);
  const r = ((k1 - k2) / (k1 + k2)) ** 2;
  return { t: 1 - r, r, k1, k2 };
}

/** Transmission through a rectangular barrier (V0 > 0) or over a well (V0 < 0) of width w. */
export function barrier(e: number, v0: number, w: number, massRatio: number): { t: number; k: number; kappa: number } {
  positive(e, 'energy');
  positive(w, 'width');
  const c = HB2M / massRatio;
  const k = Math.sqrt(e / c);
  if (v0 === 0) return { t: 1, k, kappa: 0 };
  if (e < v0) {
    const kappa = Math.sqrt((v0 - e) / c);
    return { t: 1 / (1 + (v0 * v0 * Math.sinh(kappa * w) ** 2) / (4 * e * (v0 - e))), k, kappa };
  }
  if (e === v0) return { t: 1 / (1 + (v0 * w * w) / (4 * c)), k, kappa: 0 };
  const k2 = Math.sqrt((e - v0) / c);
  return { t: 1 / (1 + (v0 * v0 * Math.sin(k2 * w) ** 2) / (4 * e * (e - v0))), k, kappa: k2 };
}

export interface Layer {
  /** Width in nm and potential in eV. */
  width: number;
  v: number;
}

/**
 * Transmission through layers between two zero-potential leads, by transfer matrices of the plane-wave amplitudes.
 * Wavenumbers may be imaginary inside a barrier, so the amplitudes are complex.
 */
export function transfer(layers: readonly Layer[], e: number, massRatio: number): number {
  positive(e, 'energy');
  const c = HB2M / massRatio;
  const kOf = (v: number): Complex => csqrt(cx((e - v) / c));
  // M maps (A, B) on the left of the structure to the right; start as the identity.
  let m: [Complex, Complex, Complex, Complex] = [cx(1), cx(0), cx(0), cx(1)];
  let x = 0;
  let kPrev = kOf(0);
  const interfaceAt = (k1: Complex, k2: Complex, at: number): [Complex, Complex, Complex, Complex] => {
    // Continuity of ψ and ψ' at x = at between e^{±ik1x} and e^{±ik2x}.
    const r = cdiv(k1, k2);
    const half = cx(0.5);
    const plus = cmul(half, cadd(cx(1), r));
    const minus = cmul(half, csub(cx(1), r));
    const i = cx(0, 1);
    const e12m = cexp(cmul(i, cmul(csub(k1, k2), cx(at))));
    const e12p = cexp(cmul(i, cmul(cadd(k1, k2), cx(at))));
    const e21p = cexp(cmul(cx(0, -1), cmul(cadd(k1, k2), cx(at))));
    const e21m = cexp(cmul(cx(0, -1), cmul(csub(k1, k2), cx(at))));
    return [cmul(plus, e12m), cmul(minus, e21p), cmul(minus, e12p), cmul(plus, e21m)];
  };
  const mul = (p: typeof m, q: typeof m): typeof m => [
    cadd(cmul(p[0], q[0]), cmul(p[1], q[2])),
    cadd(cmul(p[0], q[1]), cmul(p[1], q[3])),
    cadd(cmul(p[2], q[0]), cmul(p[3], q[2])),
    cadd(cmul(p[2], q[1]), cmul(p[3], q[3])),
  ];
  for (const layer of layers) {
    positive(layer.width, 'width');
    if (!Number.isFinite(layer.v)) fail('badList');
    const k = kOf(layer.v);
    const kk = cabs(k) === 0 ? cx(1e-9) : k;
    m = mul(interfaceAt(kPrev, kk, x), m);
    kPrev = kk;
    x += layer.width;
  }
  m = mul(interfaceAt(kPrev, kOf(0), x), m);
  // Incoming A = 1 from the left, nothing from the right: t = det / M22 with equal leads, |t|² = 1/|M22|².
  return 1 / cabs(m[3]) ** 2;
}

/** The Gamow tunneling factor e^(−2πη), η = Z₁Z₂e²/(4πε₀ħv), for charges Z₁ and Z₂ at kinetic energy E (MeV). */
export function gamow(z1: number, z2: number, mev: number, reducedMassU: number): { eta: number; factor: number } {
  positive(mev, 'energy');
  positive(reducedMassU, 'mass');
  const v = Math.sqrt((2 * mev * 1e6 * C.e) / (reducedMassU * C.u));
  const eta = (z1 * z2 * C.e * C.e) / (4 * Math.PI * C.eps0 * C.hbar * v);
  return { eta, factor: Math.exp(-2 * Math.PI * eta) };
}

/** The WKB estimate e^(−2κw) for a rectangular barrier. */
export const wkbRectangle = (e: number, v0: number, w: number, massRatio: number) =>
  e >= v0 ? 1 : Math.exp(-2 * w * Math.sqrt((v0 - e) / (HB2M / massRatio)));

/** The ground state of a spherical well of radius R: infinite (V0 = 0) or of depth V0, from the bottom. */
export function quantumDot(radius: number, v0: number, massRatio: number): { energy: number; bound: boolean } {
  positive(radius, 'radius');
  const c = HB2M / massRatio;
  if (v0 === 0) return { energy: (Math.PI ** 2 * c) / radius ** 2, bound: true };
  positive(v0, 'depth');
  // l = 0 states are the odd states of a finite well of half-width R: −z cot z = √(z0² − z²).
  const z0 = radius * Math.sqrt(v0 / c);
  if (z0 <= Math.PI / 2) return { energy: NaN, bound: false };
  const f = (z: number) => -z * Math.cos(z) - Math.sqrt(Math.max(0, z0 * z0 - z * z)) * Math.sin(z);
  const z = brent(f, Math.PI / 2 + 1e-12, Math.min(Math.PI, z0), 1e-15).x;
  return { energy: (z * z * c) / radius ** 2, bound: true };
}
