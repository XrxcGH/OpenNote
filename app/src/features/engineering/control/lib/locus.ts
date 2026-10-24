// Root loci of 1 + K N/D = 0 for K ≥ 0, in the s-plane (stability: left half-plane) or the z-plane (stability:
// inside the unit circle): branches tracked over adaptive gain steps, stability boundary crossings, and the gain
// ranges that keep the closed loop stable.

import { cabs, cdiv, csub, cx, pevalC, rootsOf, type Complex, type Poly } from './tf';
import { padd, pderiv, pmul, trim } from './poly';
import { rootsOnGrid } from './num';

export type Plane = 's' | 'z';

export const closedPoly = (n: Poly, d: Poly, k: number): Poly =>
  padd(
    d,
    n.map((c) => c * k),
  );

/** True when every root is strictly stable for the plane (with a small margin for round-off). */
export function isStable(roots: readonly Complex[], plane: Plane, tol = 1e-9): boolean {
  return plane === 's' ? roots.every((r) => r.re < -tol) : roots.every((r) => cabs(r) < 1 - tol);
}

/** Matches each new root to the nearest previous one (greedy by distance), so branches stay continuous. */
function match(prev: readonly Complex[], next: readonly Complex[]): Complex[] {
  const pairs: [number, number, number][] = [];
  prev.forEach((p, i) => next.forEach((q, j) => pairs.push([cabs(csub(p, q)), i, j])));
  pairs.sort((a, b) => a[0] - b[0]);
  const out = new Array<Complex>(prev.length);
  const usedI = new Set<number>();
  const usedJ = new Set<number>();
  for (const [, i, j] of pairs) {
    if (usedI.has(i) || usedJ.has(j)) continue;
    out[i] = next[j];
    usedI.add(i);
    usedJ.add(j);
  }
  return out;
}

export interface Locus {
  readonly ks: readonly number[];
  /** branches[i][j]: the i-th closed-loop pole at gain ks[j]. */
  readonly branches: readonly (readonly Complex[])[];
}

/** Tracks the closed-loop poles from K = 0 to kMax, refining the gain step where the poles move fast. */
export function trackLocus(n: Poly, d: Poly, kMax: number, scale: number): Locus {
  const base: number[] = [0];
  const lo = kMax * 1e-6;
  for (let i = 0; i <= 120; i += 1) base.push(lo * (kMax / lo) ** (i / 120));
  let ks = base;
  let roots = ks.map((k) => rootsOf(closedPoly(n, d, k)));
  // Refine where any root jumps by more than 2% of the plot scale.
  for (let pass = 0; pass < 6; pass += 1) {
    const nextKs: number[] = [ks[0]];
    const nextRoots: Complex[][] = [roots[0]];
    let added = 0;
    for (let i = 1; i < ks.length; i += 1) {
      const m = match(roots[i - 1], roots[i]);
      const jump = Math.max(...m.map((z, j) => cabs(csub(z, roots[i - 1][j]))));
      if (jump > 0.02 * scale && ks.length + added < 3000) {
        const mid = (ks[i - 1] + ks[i]) / 2;
        nextKs.push(mid);
        nextRoots.push(rootsOf(closedPoly(n, d, mid)));
        added += 1;
      }
      nextKs.push(ks[i]);
      nextRoots.push(roots[i]);
    }
    ks = nextKs;
    roots = nextRoots;
    if (!added) break;
  }
  const count = roots[0].length;
  const branches: Complex[][] = Array.from({ length: count }, () => []);
  let prev = roots[0];
  roots.forEach((rs, j) => {
    const m = j === 0 ? rs : match(prev, rs);
    m.forEach((z, i) => branches[i].push(z));
    prev = m;
  });
  return { ks, branches };
}

export interface Crossing {
  /** ω (rad/s) for the s-plane; θ (rad) for the z-plane. */
  readonly at: number;
  readonly k: number;
  readonly point: Complex;
}

/** Splits P(jω) into real polynomials in ω: P(jω) = Pr(ω) + j Pi(ω). */
function splitJ(p: Poly): { re: Poly; im: Poly } {
  const re = p.map((c, k) => (k % 4 === 0 ? c : k % 4 === 2 ? -c : 0));
  const im = p.map((c, k) => (k % 4 === 1 ? c : k % 4 === 3 ? -c : 0));
  return { re, im };
}

/** Gains K > 0 where a closed-loop pole lies on the stability boundary (the jω axis or the unit circle). */
export function boundaryCrossings(n: Poly, d: Poly, plane: Plane): Crossing[] {
  const out: Crossing[] = [];
  const push = (at: number, point: Complex) => {
    const nv = pevalC(n, point);
    if (cabs(nv) < 1e-14) return;
    const kc = cdiv(pevalC(d, point), nv);
    const k = -kc.re;
    if (
      k > 1e-12 &&
      Math.abs(kc.im) <= 1e-6 * Math.max(1, Math.abs(k)) &&
      !out.some((c) => Math.abs(c.at - at) < 1e-9 * Math.max(1, at))
    )
      out.push({ at, k, point });
  };
  if (plane === 's') {
    const D = splitJ(d);
    const N = splitJ(n);
    const im = trim(padd(pmul(D.im, N.re), pmul(D.re, N.im), -1));
    push(0, cx(0));
    if (!(im.length === 1 && im[0] === 0))
      for (const r of rootsOf(im))
        if (Math.abs(r.im) < 1e-7 * Math.max(1, Math.abs(r.re)) && r.re > 1e-12) push(r.re, cx(0, r.re));
  } else {
    const f = (t: number) => {
      const z = cx(Math.cos(t), Math.sin(t));
      const dv = pevalC(d, z);
      const nv = pevalC(n, z);
      return dv.im * nv.re - dv.re * nv.im;
    };
    push(0, cx(1));
    push(Math.PI, cx(-1));
    const grid = Array.from({ length: 4001 }, (_, i) => (Math.PI * i) / 4000).slice(1, -1);
    for (const t of rootsOnGrid(f, grid)) push(t, cx(Math.cos(t), Math.sin(t)));
  }
  return out.sort((a, b) => a.k - b.k);
}

/** The intervals of K > 0 for which the closed loop is stable (the last may run to Infinity). */
export function stableRanges(n: Poly, d: Poly, plane: Plane): [number, number][] {
  const ks = [0, ...boundaryCrossings(n, d, plane).map((c) => c.k)];
  const unique = ks.filter((k, i) => i === 0 || k > ks[i - 1] * (1 + 1e-9));
  const out: [number, number][] = [];
  for (let i = 0; i < unique.length; i += 1) {
    const lo = unique[i];
    const hi = i + 1 < unique.length ? unique[i + 1] : Infinity;
    const probe = Number.isFinite(hi) ? (lo + hi) / 2 : lo === 0 ? 1 : lo * 2;
    if (isStable(rootsOf(closedPoly(n, d, probe)), plane)) {
      const last = out[out.length - 1];
      if (last && last[1] === lo) last[1] = hi;
      else out.push([lo, hi]);
    }
  }
  return out;
}

/** Breakaway and break-in points: roots of D′N − DN′ = 0 where K = −D/N is real and positive. */
export function breakPoints(n: Poly, d: Poly): { point: Complex; k: number }[] {
  const eq = trim(padd(pmul(pderiv(d), n), pmul(d, pderiv(n)), -1));
  if (eq.length < 2) return [];
  const out: { point: Complex; k: number }[] = [];
  for (const r of rootsOf(eq)) {
    const nv = pevalC(n, r);
    if (cabs(nv) < 1e-14) continue;
    const kc = cdiv(pevalC(d, r), nv);
    const k = -kc.re;
    if (k > 1e-12 && Math.abs(kc.im) < 1e-6 * Math.max(1, k)) out.push({ point: r, k });
  }
  return out;
}

/** The gain that puts a closed-loop pole at s₀, and the angle of N/D there (180° on the locus). */
export function gainAt(n: Poly, d: Poly, s0: Complex): { k: number; angleDeg: number; onLocus: boolean } {
  const g = cdiv(pevalC(n, s0), pevalC(d, s0));
  const k = 1 / cabs(g);
  const angleDeg = (Math.atan2(g.im, g.re) * 180) / Math.PI;
  return { k, angleDeg, onLocus: Math.abs(Math.abs(angleDeg) - 180) < 1e-3 };
}
