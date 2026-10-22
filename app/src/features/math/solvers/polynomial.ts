// Polynomials with number coefficients (lowest power first) and the complex numbers their roots need: arithmetic,
// rational functions read from a tree, and every root by the Durand-Kerner method, polished by Newton's method and
// gathered into repeated roots.
import { dependsOn } from '../../../core/expr';
import { compile, isConstant, valueOf, type Node } from './expr';

export interface Complex {
  readonly re: number;
  readonly im: number;
}

export const cx = (re: number, im = 0): Complex => ({ re, im });
export const cadd = (a: Complex, b: Complex): Complex => cx(a.re + b.re, a.im + b.im);
export const csub = (a: Complex, b: Complex): Complex => cx(a.re - b.re, a.im - b.im);
export const cmul = (a: Complex, b: Complex): Complex => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
export const cabs = (a: Complex): number => Math.hypot(a.re, a.im);

/** Coefficients, lowest power first. */
export type Poly = number[];

export function trim(p: Poly): Poly {
  const out = [...p];
  const scale = Math.max(1e-300, ...out.map(Math.abs));
  while (out.length > 1 && Math.abs(out[out.length - 1]) <= 1e-14 * scale) out.pop();
  return out;
}

export const degree = (p: Poly): number => trim(p).length - 1;

export function padd(a: Poly, b: Poly, sign = 1): Poly {
  return trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + sign * (b[i] ?? 0)));
}

export function pmul(a: Poly, b: Poly): Poly {
  const out = Array.from({ length: a.length + b.length - 1 }, () => 0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] += x * y)));
  return trim(out);
}

/** Quotient and remainder. */
export function pdiv(a: Poly, b: Poly): { q: Poly; r: Poly } {
  const d = trim(b);
  let r = trim(a);
  const q = Array.from({ length: Math.max(1, r.length - d.length + 1) }, () => 0);
  while (r.length >= d.length && !(r.length === 1 && r[0] === 0)) {
    const shift = r.length - d.length;
    const factor = r[r.length - 1] / d[d.length - 1];
    q[shift] = factor;
    r = trim(r.map((x, i) => (i >= shift ? x - factor * (d[i - shift] ?? 0) : x)).slice(0, r.length - 1));
    if (r.length < d.length) break;
  }
  return { q: trim(q), r: r.length ? r : [0] };
}

export function pevalC(p: Poly, z: Complex): Complex {
  let out = cx(0);
  for (let i = p.length - 1; i >= 0; i -= 1) out = cadd(cmul(out, z), cx(p[i]));
  return out;
}

export const peval = (p: Poly, x: number): number => p.reduceRight((sum, c) => sum * x + c, 0);

export const pderiv = (p: Poly): Poly =>
  trim(
    p
      .slice(1)
      .map((c, i) => c * (i + 1))
      .concat(p.length > 1 ? [] : [0]),
  );

/** A rational function N/D of `v` with number coefficients, read from a tree, or null. */
export function rationalOf(node: Node, v: string): { n: Poly; d: Poly } | null {
  if (!dependsOn(node, v)) {
    if (!isConstant(node)) return null;
    const value = valueOf(node);
    return Number.isFinite(value) ? { n: [value], d: [1] } : null;
  }
  switch (node.type) {
    case 'name':
      return { n: [0, 1], d: [1] };
    case 'unary': {
      const inner = rationalOf(node.arg, v);
      if (!inner || node.op === '√') return null;
      return node.op === '-' ? { n: inner.n.map((c) => -c), d: inner.d } : inner;
    }
    case 'binary': {
      const a = rationalOf(node.left, v);
      if (!a) return null;
      if (node.op === '^') {
        if (!isConstant(node.right)) return null;
        const k = valueOf(node.right);
        if (!Number.isInteger(k) || Math.abs(k) > 12) return null;
        let n: Poly = [1];
        let d: Poly = [1];
        for (let i = 0; i < Math.abs(k); i += 1) [n, d] = [pmul(n, a.n), pmul(d, a.d)];
        return k >= 0 ? { n, d } : { n: d, d: n };
      }
      const b = rationalOf(node.right, v);
      if (!b) return null;
      if (node.op === '+' || node.op === '-')
        return { n: padd(pmul(a.n, b.d), pmul(b.n, a.d), node.op === '-' ? -1 : 1), d: pmul(a.d, b.d) };
      if (node.op === '*') return { n: pmul(a.n, b.n), d: pmul(a.d, b.d) };
      if (node.op === '/') return { n: pmul(a.n, b.d), d: pmul(a.d, b.n) };
      return null;
    }
    default:
      return null;
  }
}

/** A root and how many times it repeats. */
export interface Root {
  readonly z: Complex;
  readonly times: number;
}

/** Every complex root of p, with repeated roots gathered. Roots within 1e-9 of the real line are made real. */
export function roots(input: Poly): Root[] {
  const p = trim(input);
  const n = p.length - 1;
  if (n < 1) return [];
  const lead = p[n];
  const monic = p.map((c) => c / lead);
  let zs: Complex[] = Array.from({ length: n }, (_, k) => {
    const angle = (2 * Math.PI * k) / n + 0.4;
    const radius = 1 + Math.max(...monic.slice(0, n).map(Math.abs));
    return cx(radius * Math.cos(angle) * 0.5, radius * Math.sin(angle) * 0.5);
  });
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    let moved = 0;
    zs = zs.map((z, i) => {
      let den = cx(1);
      zs.forEach((w, j) => {
        if (j !== i) den = cmul(den, csub(z, w));
      });
      const next = csub(z, cdiv(pevalC(monic, z), den));
      moved = Math.max(moved, cabs(csub(next, z)));
      return Number.isFinite(next.re) && Number.isFinite(next.im) ? next : cx(z.re + 1e-3, z.im + 1e-3);
    });
    if (moved < 1e-15) break;
  }
  // Gather the roots that land close together: a root repeated m times comes out spread by about eps^(1/m).
  const scale = Math.max(1, ...zs.map(cabs));
  const groups: Complex[][] = [];
  for (const z of zs) {
    const group = groups.find((g) => cabs(csub(g[0], z)) < 2e-4 * scale);
    if (group) group.push(z);
    else groups.push([z]);
  }
  return groups.map((g) => {
    let z = cx(g.reduce((s, w) => s + w.re, 0) / g.length, g.reduce((s, w) => s + w.im, 0) / g.length);
    // A root repeated m times is a simple root of the (m-1)th derivative: Newton's method there sharpens it.
    if (g.length > 1 && Math.abs(z.im) < 2e-4 * scale) z = cx(z.re);
    let target = monic;
    for (let i = 1; i < g.length; i += 1) target = pderiv(target);
    const dp = pderiv(target);
    for (let i = 0; i < 4; i += 1) {
      const step = cdiv(pevalC(target, z), pevalC(dp, z));
      if (!Number.isFinite(step.re) || !Number.isFinite(step.im)) break;
      z = csub(z, step);
    }
    const tidyPart = (x: number) => (Math.abs(x) < 1e-9 * scale ? 0 : x);
    return { z: cx(tidyPart(z.re), tidyPart(z.im)), times: g.length };
  });
}

/** Taylor coefficients of p about z: p(z + h) = Σ c_k h^k. */
export function shiftC(p: Poly, z: Complex): Complex[] {
  const c: Complex[] = p.map((x) => cx(x));
  const n = c.length;
  for (let i = 0; i < n; i += 1) for (let j = n - 2; j >= i; j -= 1) c[j] = cadd(c[j], cmul(z, c[j + 1]));
  return c;
}

/** The first `count` Taylor coefficients of the quotient p/q, given the coefficients of p and of q. */
export function seriesDivide(a: readonly Complex[], b: readonly Complex[], count: number): Complex[] {
  const out: Complex[] = [];
  for (let k = 0; k < count; k += 1) {
    let sum = a[k] ?? cx(0);
    for (let j = 1; j <= k; j += 1) sum = csub(sum, cmul(b[j] ?? cx(0), out[k - j]));
    out.push(cdiv(sum, b[0]));
  }
  return out;
}

/** A tree as a function of one variable, for checking. */
export const fnOf = (node: Node, v: string) => {
  const fn = compile(node, [v]);
  return (x: number) => fn([x]);
};
