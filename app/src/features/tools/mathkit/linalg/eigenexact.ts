// Eigenvalues and eigenvectors in exact arithmetic: the characteristic polynomial by the Faddeev-LeVerrier recurrence,
// its rational roots by the rational root theorem, the eigenspaces, and the diagonalization when every eigenvalue is
// rational. Eigenvalues that are not rational are given in decimals.
import { fractions } from '../../../../core/expr';
import { eigenvalues, sortEigenvalues } from '../eigen';
import { fmt } from '../numeric';
import { line, type NumLine, type NumOut } from '../numerics/common';
import { KitError, step, type KitStep } from '../types';
import {
  Z,
  ONE,
  add,
  div,
  equal,
  hcat,
  identity,
  isZero,
  latex,
  matrixLatex,
  mul,
  multiply,
  neg,
  nullBasis,
  q,
  readMatrix,
  requireSquare,
  rref,
  rows,
  sub,
  text,
  toNum,
  type Q,
  type QM,
} from './frac';

/** Coefficients of det(lambda I - A), highest power first. */
export function characteristicPolynomial(A: QM): Q[] {
  const n = rows(A);
  let M: QM = identity(n).map((r) => r.map(() => Z));
  const c: Q[] = new Array<Q>(n + 1).fill(Z);
  c[0] = ONE;
  for (let k = 1; k <= n; k++) {
    M = multiply(A, M).map((row, i) => row.map((v, j) => (i === j ? add(v, c[k - 1]) : v)));
    const AM = multiply(A, M);
    const trace = AM.reduce((s, row, i) => add(s, row[i]), Z);
    c[k] = div(neg(trace), q(k));
  }
  return c;
}

const evalPoly = (p: readonly Q[], x: Q): Q => p.reduce((s, a) => add(mul(s, x), a), Z);

/** Divides by (x - r), which must be a root. */
function deflate(p: readonly Q[], r: Q): Q[] {
  const out: Q[] = [];
  let carry = Z;
  for (let i = 0; i < p.length - 1; i++) {
    carry = add(mul(carry, r), p[i]);
    out.push(carry);
  }
  return out;
}

function divisors(n: bigint): bigint[] {
  const out: bigint[] = [];
  const limit = Number(n);
  if (!Number.isSafeInteger(limit) || limit > 1e12) return [];
  for (let d = 1; d * d <= limit; d++) {
    if (limit % d === 0) {
      out.push(BigInt(d));
      if (d * d !== limit) out.push(BigInt(limit / d));
    }
  }
  return out;
}

const lcm = (a: bigint, b: bigint): bigint => {
  let [x, y] = [a, b];
  while (y) [x, y] = [y, x % y];
  return (a / x) * b;
};

export interface RootFactor {
  value: Q;
  multiplicity: number;
}

/** The rational roots with multiplicities, and what is left of the polynomial after dividing them out. */
export function rationalRoots(poly: readonly Q[]): { roots: RootFactor[]; rest: Q[] } {
  let p = poly.slice();
  const roots: RootFactor[] = [];
  const take = (r: Q) => {
    let m = 0;
    while (p.length > 1 && isZero(evalPoly(p, r))) {
      p = deflate(p, r);
      m++;
    }
    if (m) roots.push({ value: r, multiplicity: m });
  };
  take(Z);
  if (p.length <= 1) return { roots, rest: p };
  const scale = p.reduce((l, a) => lcm(l, a.d), 1n);
  const ints = p.map((a) => (a.n * scale) / a.d);
  const constant = ints[ints.length - 1] < 0n ? -ints[ints.length - 1] : ints[ints.length - 1];
  const lead = ints[0] < 0n ? -ints[0] : ints[0];
  const tops = divisors(constant);
  const bottoms = divisors(lead);
  const seen = new Set<string>();
  for (const a of tops) {
    for (const b of bottoms) {
      for (const sign of [1n, -1n]) {
        const r = fractions.rational(sign * a, b);
        const key = `${r.n}/${r.d}`;
        if (seen.has(key)) continue;
        seen.add(key);
        take(r);
      }
    }
  }
  roots.sort((x, y) => fractions.compare(x.value, y.value));
  return { roots, rest: p };
}

const lambdaPower = (k: number) => (k === 0 ? '' : k === 1 ? '\\lambda' : `\\lambda^{${k}}`);

function polyLatexQ(p: readonly Q[]): string {
  const n = p.length - 1;
  const parts: string[] = [];
  p.forEach((a, i) => {
    if (isZero(a)) return;
    const k = n - i;
    const mag = a.n < 0n ? neg(a) : a;
    const body =
      k === 0 ? latex(mag) : mag.n === 1n && mag.d === 1n ? lambdaPower(k) : `${latex(mag)}${lambdaPower(k)}`;
    parts.push(parts.length === 0 ? (a.n < 0n ? `-${body}` : body) : ` ${a.n < 0n ? '-' : '+'} ${body}`);
  });
  return parts.join('') || '0';
}

function factoredLatex(roots: readonly RootFactor[], rest: readonly Q[]): string {
  const fs = roots.map((r) => {
    const sign = r.value.n < 0n ? '+' : '-';
    const mag = r.value.n < 0n ? neg(r.value) : r.value;
    const inside = isZero(r.value) ? '\\lambda' : `\\lambda ${sign} ${latex(mag)}`;
    return r.multiplicity > 1 ? `(${inside})^{${r.multiplicity}}` : `(${inside})`;
  });
  if (rest.length > 1) fs.push(`(${polyLatexQ(rest)})`);
  return fs.join('');
}

function minus(A: QM, lambda: Q): QM {
  return A.map((row, i) => row.map((v, j) => (i === j ? sub(v, lambda) : v)));
}

const vec = (v: QM) => `(${v.map((r) => text(r[0])).join(', ')})`;

export function eigenSteps(aText: string): NumOut {
  const A = readMatrix(aText, 'A');
  requireSquare(A);
  const n = rows(A);
  const poly = characteristicPolynomial(A);
  const { roots, rest } = rationalRoots(poly);
  const steps: KitStep[] = [
    step('laSetup', matrixLatex(A), {}),
    step('laCharPoly', `p(\\lambda)=\\det(\\lambda I-A)=${polyLatexQ(poly)}=${factoredLatex(roots, rest)}`),
  ];
  const lines: NumLine[] = [];
  const spaces: { value: Q; mult: number; basis: QM[] }[] = [];
  for (const r of roots) {
    const e = rref(minus(A, r.value));
    const basis = nullBasis(e.m, e.pivots, n);
    spaces.push({ value: r.value, mult: r.multiplicity, basis });
    steps.push(
      step(
        'laEigenspace',
        `(A-${text(r.value)}I)\\mathbf{v}=\\mathbf{0}:\\ ${basis.map((v) => matrixLatex(v)).join(',\\ ')}`,
        {
          value: text(r.value),
          algebraic: String(r.multiplicity),
          geometric: String(basis.length),
        },
      ),
    );
  }
  lines.push(
    line('laEigenvalues', {
      values:
        roots.map((r) => (r.multiplicity > 1 ? `${text(r.value)} (x${r.multiplicity})` : text(r.value))).join(', ') ||
        '-',
    }),
  );
  if (rest.length > 1) return withApproximate(A, lines, steps, roots, rest);
  const defective = spaces.find((s) => s.basis.length < s.mult);
  if (defective) {
    lines.push(
      line('laDefective', {
        value: text(defective.value),
        algebraic: String(defective.mult),
        geometric: String(defective.basis.length),
      }),
    );
    steps.push(step('laNotDiagonalizable', undefined, { value: text(defective.value) }));
    return { lines, tables: [], plots: [], fields: [], steps, latex: `p(\\lambda)=${factoredLatex(roots, rest)}` };
  }
  const columns = spaces.flatMap((s) => s.basis);
  const P = hcat(...columns);
  const D = identity(n).map((r, i) =>
    r.map((_, j) => (i === j ? spaces.flatMap((s) => s.basis.map(() => s.value))[i] : Z)),
  );
  const inv = rref(hcat(P, identity(n)), { limit: n, bar: n });
  const Pinv = inv.m.map((r) => r.slice(n));
  const ok = equal(multiply(multiply(P, D), Pinv), A);
  steps.push(
    step('laDiagonalize', `P=${matrixLatex(P)},\\ D=${matrixLatex(D)},\\ P^{-1}=${matrixLatex(Pinv)}`),
    step('laDiagCheck', `PDP^{-1}=A\\ \\text{${ok ? 'holds' : 'fails'}}`),
  );
  lines.push(line('laDiagonalizable', { vectors: spaces.map((s) => s.basis.map(vec).join(', ')).join('; ') }));
  return {
    lines,
    tables: [],
    plots: [],
    fields: [],
    steps,
    latex: `A=PDP^{-1},\\ P=${matrixLatex(P)},\\ D=${matrixLatex(D)}`,
  };
}

/** When some roots are not rational, the whole spectrum in decimals. */
function withApproximate(
  A: QM,
  lines: NumLine[],
  steps: KitStep[],
  roots: readonly RootFactor[],
  rest: readonly Q[],
): NumOut {
  const all = eigenvalues(A.map((r) => r.map(toNum)));
  if (!all) throw new KitError('laNoConverge');
  const known = roots.flatMap((r) => new Array<number>(r.multiplicity).fill(toNum(r.value)));
  const remaining = sortEigenvalues(all).filter((z) => {
    const k = known.findIndex((v) => Math.abs(v - z.re) < 1e-7 && Math.abs(z.im) < 1e-7);
    if (k >= 0) {
      known.splice(k, 1);
      return false;
    }
    return true;
  });
  const shown = remaining.map((z) =>
    z.im === 0 ? fmt(z.re, 8) : `${fmt(z.re, 8)} ${z.im < 0 ? '-' : '+'} ${fmt(Math.abs(z.im), 8)}i`,
  );
  steps.push(step('laIrrational', `${polyLatexQ(rest)}=0`, { values: shown.join(', ') }));
  lines.push(line('laEigenApprox', { values: shown.join(', ') }));
  return { lines, tables: [], plots: [], fields: [], steps, latex: `p(\\lambda)=${factoredLatex(roots, rest)}` };
}
