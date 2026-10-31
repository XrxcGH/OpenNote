// A Gaussian wave packet in one dimension, moved in time by the Crank-Nicolson scheme
// (1 + iHΔt/2ħ) ψₙ₊₁ = (1 − iHΔt/2ħ) ψₙ, which keeps the norm. The tridiagonal system is solved by the Thomas
// algorithm in complex arithmetic. Lengths are in nm, energies in eV, and times in fs.
import { cadd, cdiv, cmul, csub, cx } from '../../kits/num/complex';
import type { Complex } from '../../kits/num/complex';
import { C } from '../shared/constants';
import { fail, positive } from '../shared/errors';
import { HB2M } from './solver';

/** ħ in eV fs. */
export const HBAR_EV_FS = (C.hbar / C.e) * 1e15;

export interface PacketSetup {
  /** The domain, grid points, packet center and width, mean energy, and mass ratio. */
  lo: number;
  hi: number;
  n: number;
  x0: number;
  sigma: number;
  energy: number;
  massRatio: number;
  /** A rectangular barrier from 0 to `width` of height `v0` (eV); zero width for free motion. */
  v0: number;
  width: number;
  /** The total time (fs) and the number of steps. */
  time: number;
  steps: number;
}

export interface PacketRun {
  x: Float64Array;
  /** |ψ|² at the start, halfway, and the end. */
  snapshots: Float64Array[];
  /** Probability beyond the barrier's right edge and before its left edge at the end. */
  transmitted: number;
  reflected: number;
  norm: number;
  meanX: number;
  k0: number;
  /**
   * The probability current j = (ħ/m) Im(ψ* ∂ψ/∂x) through the barrier's right edge (x = width): its largest value
   * over the run (fs⁻¹; in one dimension a current is probability per time) and its integral over time, which is the
   * probability that has crossed the edge and so checks `transmitted`.
   */
  peakCurrent: number;
  crossed: number;
}

export function runPacket(s: PacketSetup): PacketRun {
  if (!(s.hi > s.lo) || !Number.isInteger(s.n) || s.n < 100 || s.n > 4000) fail('badGrid');
  positive(s.sigma, 'width');
  positive(s.energy, 'energy');
  positive(s.massRatio, 'massRatio');
  positive(s.time, 'time');
  if (!Number.isInteger(s.steps) || s.steps < 1 || s.steps > 5000) fail('badGrid');
  const c = HB2M / s.massRatio;
  const h = (s.hi - s.lo) / (s.n + 1);
  const x = Float64Array.from({ length: s.n }, (_, i) => s.lo + (i + 1) * h);
  const k0 = Math.sqrt(s.energy / c);
  let psi: Complex[] = Array.from(x, (xi) => {
    const g = Math.exp(-((xi - s.x0) ** 2) / (4 * s.sigma ** 2));
    return cx(g * Math.cos(k0 * xi), g * Math.sin(k0 * xi));
  });
  const normOf = (p: readonly Complex[]) => p.reduce((sum, a) => sum + (a.re * a.re + a.im * a.im) * h, 0);
  const n0 = Math.sqrt(normOf(psi));
  psi = psi.map((a) => cx(a.re / n0, a.im / n0));
  const v = Array.from(x, (xi) => (xi >= 0 && xi <= s.width ? s.v0 : 0));
  const dt = s.time / s.steps;
  const t = c / (h * h);
  const alpha = dt / (2 * HBAR_EV_FS);
  // A = 1 + iαH, B = 1 − iαH, with H = tridiagonal(−t, 2t + V, −t).
  const aDiag = v.map((vi) => cx(1, alpha * (2 * t + vi)));
  const aOff = cx(0, -alpha * t);
  const bDiag = v.map((vi) => cx(1, -alpha * (2 * t + vi)));
  const bOff = cx(0, alpha * t);
  const snapshots: Float64Array[] = [Float64Array.from(psi, (a) => a.re * a.re + a.im * a.im)];
  // The current between the grid points on either side of the right edge, with ħ/m = 2(ħ²/2m)/ħ in nm² fs⁻¹.
  const edge = Math.min(
    Math.max(
      x.findIndex((xi) => xi > s.width),
      1,
    ),
    s.n - 1,
  );
  const current = (p: readonly Complex[]) => {
    const a = p[edge - 1]!;
    const b = p[edge]!;
    const mid = cx((a.re + b.re) / 2, (a.im + b.im) / 2);
    const slope = cx((b.re - a.re) / h, (b.im - a.im) / h);
    return ((2 * c) / HBAR_EV_FS) * (mid.re * slope.im - mid.im * slope.re);
  };
  let jLast = current(psi);
  let peakCurrent = jLast;
  let crossed = 0;
  // Factor A once: the Thomas forward sweep coefficients do not change between steps.
  const cPrime: Complex[] = new Array<Complex>(s.n);
  const denom: Complex[] = new Array<Complex>(s.n);
  denom[0] = aDiag[0]!;
  cPrime[0] = cdiv(aOff, denom[0]);
  for (let i = 1; i < s.n; i += 1) {
    denom[i] = csub(aDiag[i]!, cmul(aOff, cPrime[i - 1]!));
    cPrime[i] = cdiv(aOff, denom[i]!);
  }
  for (let step = 1; step <= s.steps; step += 1) {
    const rhs = psi.map((a, i) => {
      let r = cmul(bDiag[i]!, a);
      if (i > 0) r = cadd(r, cmul(bOff, psi[i - 1]!));
      if (i < s.n - 1) r = cadd(r, cmul(bOff, psi[i + 1]!));
      return r;
    });
    const y: Complex[] = new Array<Complex>(s.n);
    y[0] = cdiv(rhs[0]!, denom[0]!);
    for (let i = 1; i < s.n; i += 1) y[i] = cdiv(csub(rhs[i]!, cmul(aOff, y[i - 1]!)), denom[i]!);
    for (let i = s.n - 2; i >= 0; i -= 1) y[i] = csub(y[i]!, cmul(cPrime[i]!, y[i + 1]!));
    psi = y;
    const j = current(psi);
    crossed += ((jLast + j) / 2) * dt;
    peakCurrent = Math.max(peakCurrent, j);
    jLast = j;
    if (step === Math.round(s.steps / 2) || step === s.steps)
      snapshots.push(Float64Array.from(psi, (a) => a.re * a.re + a.im * a.im));
  }
  const density = snapshots.at(-1)!;
  let transmitted = 0;
  let reflected = 0;
  let meanX = 0;
  for (let i = 0; i < s.n; i += 1) {
    const w = density[i]! * h;
    if (x[i]! > s.width) transmitted += w;
    if (x[i]! < 0) reflected += w;
    meanX += x[i]! * w;
  }
  return { x, snapshots, transmitted, reflected, norm: normOf(psi), meanX, k0, peakCurrent, crossed };
}
