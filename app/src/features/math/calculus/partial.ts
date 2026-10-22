// Integrals of a ratio of polynomials with number coefficients: long division when the top is not smaller than the
// bottom, then partial fractions. The bottom is factored by its rational roots (repeated ones too), leaving at most
// one quadratic with no real roots, which completes the square into an arctangent. The fractions' numbers come from
// a small exact linear system, so 1/(x^2 - 1) splits into exactly 1/2 and -1/2.
import { build, fractions } from '../../../core/expr';
import type { Node, Rational } from '../../../core/expr';
import { expand, isRational, norm, rationalNode, tidy, ONE, ZERO } from './algebra';
import { factorsNode } from './integrate';
import type { Integrated, Integrator, Method } from './integrate';
import { latexOf } from './print';
import type { Step } from './types';

const R = fractions;
type Poly = Rational[];
const { num, name, add, sub, mul, div, pow, call } = build;
const MAX_DEGREE = 8;

const trim = (p: Poly): Poly => {
  const out = [...p];
  while (out.length > 1 && out[out.length - 1].n === 0n) out.pop();
  return out;
};
const degree = (p: Poly) => trim(p).length - 1;

/** A tree as a polynomial in x with number coefficients, lowest power first, or null. */
export function polynomial(node: Node, x: string): Poly | null {
  const out: Poly = [];
  for (const term of expand(norm(node))) {
    let power = 0;
    for (const f of term.factors) {
      if (f.base.type !== 'name' || f.base.name !== x || !isRational(f.exp) || f.exp.d !== 1n || f.exp.n < 0n)
        return null;
      power += Number(f.exp.n);
    }
    if (power > MAX_DEGREE) return null;
    while (out.length <= power) out.push(ZERO);
    out[power] = R.add(out[power], term.coef);
  }
  return trim(out.length ? out : [ZERO]);
}

function times(a: Poly, b: Poly): Poly {
  const out: Poly = Array.from({ length: a.length + b.length - 1 }, () => ZERO);
  a.forEach((p, i) => b.forEach((q, j) => (out[i + j] = R.add(out[i + j], R.mul(p, q)))));
  return trim(out);
}

/** Polynomial long division: quotient and remainder. */
function divide(a: Poly, b: Poly): [Poly, Poly] {
  const rest = [...trim(a)];
  const db = degree(b);
  const quotient: Poly = Array.from({ length: Math.max(1, rest.length - db) }, () => ZERO);
  for (let shift = rest.length - 1 - db; shift >= 0; shift -= 1) {
    const c = R.div(rest[shift + db], b[db]);
    quotient[shift] = c;
    for (let i = 0; i <= db; i += 1) rest[shift + i] = R.sub(rest[shift + i], R.mul(c, b[i]));
  }
  return [trim(quotient), trim(db === 0 ? [ZERO] : rest.slice(0, db))];
}

function polyNode(p: Poly, x: string): Node {
  return tidy(p.reduce<Node>((sum, c, i) => add(sum, mul(rationalNode(c), pow(name(x), num(i)))), num(0)));
}

function divisors(n: bigint): bigint[] {
  const m = n < 0n ? -n : n;
  const out: bigint[] = [];
  for (let d = 1n; d * d <= m && d <= 100_000n; d += 1n) if (m % d === 0n) out.push(d, m / d);
  return out;
}

const valueAt = (p: Poly, r: Rational) => p.reduceRight((acc, c) => R.add(R.mul(acc, r), c), ZERO);

/** The rational roots of p, each as often as it repeats, and what is left after dividing them out. */
function rationalRoots(p: Poly): { roots: Rational[]; rest: Poly } {
  const roots: Rational[] = [];
  let rest = p;
  const scaleOf = (q: Poly) => q.reduce((l, c) => (l * c.d) / gcd(l, c.d), 1n);
  for (let guard = 0; degree(rest) > 0 && guard < MAX_DEGREE; guard += 1) {
    const ints = rest.map((c) => R.mul(c, R.rational(scaleOf(rest))).n);
    const low = ints.findIndex((c) => c !== 0n);
    const candidates = low > 0 ? [ZERO] : candidatesOf(ints[0], ints[ints.length - 1]);
    const root = candidates.find((r) => valueAt(rest, r).n === 0n);
    if (!root) break;
    roots.push(root);
    rest = divide(rest, [R.neg(root), ONE])[0];
  }
  return { roots, rest };
}

function candidatesOf(first: bigint, last: bigint): Rational[] {
  const out: Rational[] = [];
  for (const p of divisors(first)) for (const q of divisors(last)) out.push(R.rational(p, q), R.rational(-p, q));
  return out;
}

function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** Solves a square system exactly by elimination. Null when it has no single answer. */
function solve(matrix: Rational[][], rhs: Rational[]): Rational[] | null {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    const pivot = m.findIndex((row, i) => i >= col && row[col].n !== 0n);
    if (pivot < 0) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let i = 0; i < n; i += 1) {
      if (i === col || m[i][col].n === 0n) continue;
      const k = R.div(m[i][col], m[col][col]);
      m[i] = m[i].map((v, j) => R.sub(v, R.mul(k, m[col][j])));
    }
  }
  return m.map((row, i) => R.div(row[n], row[i]));
}

interface Piece {
  /** The polynomial each unknown multiplies, and how the fraction it gives is built. */
  basis: Poly;
  build: (c: Rational) => Node;
}

function piecesOf(bottom: Poly, roots: Rational[], quad: Poly | null, x: string): Piece[] {
  const pieces: Piece[] = [];
  const X = name(x);
  const counts = new Map<string, { r: Rational; m: number }>();
  for (const r of roots) {
    const key = `${r.n}/${r.d}`;
    counts.set(key, { r, m: (counts.get(key)?.m ?? 0) + 1 });
  }
  for (const { r, m } of counts.values()) {
    for (let j = 1; j <= m; j += 1) {
      let factor: Poly = [ONE];
      for (let k = 0; k < j; k += 1) factor = times(factor, [R.neg(r), ONE]);
      const linear = sub(X, rationalNode(r));
      pieces.push({ basis: divide(bottom, factor)[0], build: (c) => div(rationalNode(c), pow(linear, num(j))) });
    }
  }
  if (quad) {
    const rest = divide(bottom, quad)[0];
    const q = polyNode(quad, x);
    pieces.push({ basis: times(rest, [ZERO, ONE]), build: (c) => div(mul(rationalNode(c), X), q) });
    pieces.push({ basis: rest, build: (c) => div(rationalNode(c), q) });
  }
  return pieces;
}

/** (B x + C) / (x^2 + p x + q) with no real roots: a log and an arctangent, by completing the square. */
function quadratic(I: Integrator, B: Rational, C: Rational, quad: Poly): Integrated {
  const x = name(I.x);
  const [q, p] = [quad[0], quad[1]];
  const half = R.div(p, R.rational(2n));
  const k = R.sub(q, R.mul(half, half));
  const root = pow(rationalNode(k), div(num(1), num(2)));
  const shifted = add(x, rationalNode(half));
  const logPart = mul(rationalNode(R.div(B, R.rational(2n))), call('ln', polyNode(quad, I.x)));
  const atanPart = mul(div(rationalNode(R.sub(C, R.mul(B, half))), root), call('atan', div(shifted, root)));
  const F = tidy(add(logPart, atanPart));
  const f = tidy(div(add(mul(rationalNode(B), x), rationalNode(C)), polyNode(quad, I.x)));
  const square = `${latexOf(polyNode(quad, I.x))} = ${latexOf(pow(shifted, num(2)))} + ${latexOf(rationalNode(k))}`;
  return { node: F, step: I.step('completeSquare', f, F, [], square) };
}

/** Partial fractions, with long division first when it is needed. */
export const partialFractions: Method = (g, I) => {
  const [term] = norm(g);
  const below = (f: (typeof term.factors)[number]) => isRational(f.exp) && f.exp.n < 0n;
  if (!term || !term.factors.some(below)) return null;
  const top = polynomial(factorsNode(term.factors.filter((f) => !below(f))), I.x);
  const bottom = polynomial(tidy(div(num(1), factorsNode(term.factors.filter(below)))), I.x);
  if (!top || !bottom || degree(bottom) < 1) return null;
  const [quotient, remainder] = divide(top, bottom);
  const { roots, rest } = rationalRoots(bottom);
  const quad = degree(rest) === 2 ? rest.map((c) => R.div(c, rest[2])) : null;
  if (degree(rest) > 2 || (quad && R.compare(R.mul(quad[1], quad[1]), R.mul(R.rational(4n), quad[0])) >= 0))
    return null;
  const pieces = piecesOf(bottom, roots, quad, I.x);
  const size = degree(bottom);
  const matrix = Array.from({ length: size }, (_, row) => pieces.map((piece) => piece.basis[row] ?? ZERO));
  const values = solve(
    matrix,
    Array.from({ length: size }, (_, row) => remainder[row] ?? ZERO),
  );
  if (!values) return null;
  const steps: Step[] = [];
  const parts: Node[] = [];
  let F: Node = num(0);
  const quotientNode = polyNode(quotient, I.x);
  if (degree(top) >= size) {
    const latex = `${latexOf(g)} = ${latexOf(quotientNode)} + ${latexOf(div(polyNode(remainder, I.x), polyNode(bottom, I.x)))}`;
    steps.push({ rule: 'longDivision', latex });
    parts.push(quotientNode);
    const found = I.child().integrate(quotientNode);
    if (!found) return null;
    steps.push(found.step);
    F = found.node;
  }
  const linearCount = pieces.length - (quad ? 2 : 0);
  for (let i = 0; i < linearCount; i += 1) {
    if (values[i].n === 0n) continue;
    const piece = tidy(pieces[i].build(values[i]));
    parts.push(piece);
    const found = I.child().integrate(piece);
    if (!found) return null;
    steps.push(found.step);
    F = add(F, found.node);
  }
  if (quad) {
    const [B, C] = values.slice(linearCount);
    parts.push(tidy(add(pieces[linearCount].build(B), pieces[linearCount + 1].build(C))));
    const found = quadratic(I, B, C, quad);
    steps.push(found.step);
    F = add(F, found.node);
  }
  const node = tidy(F);
  const split = `${latexOf(g)} = ${parts
    .map((part) => latexOf(part))
    .join(' + ')
    .replace(/\+ -/g, '- ')}`;
  return { node, step: I.step('partialFractions', g, node, steps, split) };
};
