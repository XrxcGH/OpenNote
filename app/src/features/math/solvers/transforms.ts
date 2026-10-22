// Laplace and Fourier transforms with the steps a course shows, and the tables of pairs and properties they use.
//
// The Laplace transform splits f(t) by linearity, looks each term up (1, t^n, sin, cos, sinh, cosh), and applies the
// properties: multiplying by t^n differentiates in s, and multiplying by e^(at) shifts s to s - a. The inverse takes a
// rational F(s), finds the poles, writes the partial fractions, and reads each one back from the table; a factor
// e^(-cs) becomes a step u(t - c) and a delay. The Fourier transform, F(ω) = ∫ f(t) e^(-iωt) dt, matches each term
// to a table pair by fitting the pair's parameter to samples of the function, and otherwise is found numerically.
// Every answer is checked numerically: the forward Laplace answer against ∫ f(t) e^(-st) dt at a real s, and the
// inverse by transforming it back.
import { dependsOn } from '../../../core/expr';
import { quadrature } from './integrate';
import {
  SolverError,
  build,
  compile,
  derive,
  isConstant,
  namesIn,
  niceNumber,
  numText,
  read,
  show,
  substitute,
  tidy,
  valueOf,
  type Node,
} from './expr';
import { fold, polyOf } from './integrate';
import { cabs, cx, degree, pdiv, rationalOf, roots, seriesDivide, shiftC, type Complex } from './polynomial';
import { step, type Step, type XY } from './steps';

const { add, mul, div, pow, num, neg, name } = build;

export interface TransformResult {
  readonly steps: readonly Step[];
  /** The transform (or the inverse) as text. */
  readonly text: string;
  /** True when the numeric check agreed. */
  readonly checked: boolean;
  /** Data for a graph: f(t) for an inverse, |F(ω)| for a Fourier transform, F(s) for real s for a Laplace one. */
  readonly graph: readonly XY[];
}

// ---------------------------------------------------------------------------------------------------------------
// Tables

export interface Pair {
  readonly id: string;
  readonly f: string;
  readonly F: string;
  readonly condition?: string;
}

export const LAPLACE_PAIRS: readonly Pair[] = [
  { id: 'one', f: '1', F: '1/s', condition: 's > 0' },
  { id: 'delta', f: 'δ(t)', F: '1' },
  { id: 'step', f: 'u(t − c)', F: 'e^(−cs)/s', condition: 's > 0' },
  { id: 't', f: 't', F: '1/s²', condition: 's > 0' },
  { id: 'tn', f: 'tⁿ', F: 'n!/sⁿ⁺¹', condition: 's > 0' },
  { id: 'exp', f: 'e^(at)', F: '1/(s − a)', condition: 's > a' },
  { id: 'texp', f: 'tⁿ·e^(at)', F: 'n!/(s − a)ⁿ⁺¹', condition: 's > a' },
  { id: 'sin', f: 'sin(bt)', F: 'b/(s² + b²)', condition: 's > 0' },
  { id: 'cos', f: 'cos(bt)', F: 's/(s² + b²)', condition: 's > 0' },
  { id: 'sinh', f: 'sinh(bt)', F: 'b/(s² − b²)', condition: 's > |b|' },
  { id: 'cosh', f: 'cosh(bt)', F: 's/(s² − b²)', condition: 's > |b|' },
  { id: 'expsin', f: 'e^(at)·sin(bt)', F: 'b/((s − a)² + b²)', condition: 's > a' },
  { id: 'expcos', f: 'e^(at)·cos(bt)', F: '(s − a)/((s − a)² + b²)', condition: 's > a' },
  { id: 'tsin', f: 't·sin(bt)', F: '2bs/(s² + b²)²', condition: 's > 0' },
  { id: 'tcos', f: 't·cos(bt)', F: '(s² − b²)/(s² + b²)²', condition: 's > 0' },
  { id: 'sqrt', f: '1/√t', F: '√(π/s)', condition: 's > 0' },
  { id: 'shifted', f: 'u(t − c)·f(t − c)', F: 'e^(−cs)·F(s)' },
];

export const LAPLACE_PROPERTIES: readonly Pair[] = [
  { id: 'linearity', f: 'a·f(t) + b·g(t)', F: 'a·F(s) + b·G(s)' },
  { id: 'shiftS', f: 'e^(at)·f(t)', F: 'F(s − a)' },
  { id: 'shiftT', f: 'u(t − c)·f(t − c)', F: 'e^(−cs)·F(s)' },
  { id: 'timesT', f: 'tⁿ·f(t)', F: '(−1)ⁿ·dⁿF/dsⁿ' },
  { id: 'derivative', f: 'f′(t)', F: 's·F(s) − f(0)' },
  { id: 'second', f: 'f″(t)', F: 's²·F(s) − s·f(0) − f′(0)' },
  { id: 'integral', f: '∫₀ᵗ f(τ) dτ', F: 'F(s)/s' },
  { id: 'convolution', f: '(f ∗ g)(t)', F: 'F(s)·G(s)' },
  { id: 'scaling', f: 'f(at)', F: '(1/a)·F(s/a)' },
  { id: 'initial', f: 'f(0⁺)', F: 'lim s·F(s) as s → ∞' },
  { id: 'final', f: 'lim f(t) as t → ∞', F: 'lim s·F(s) as s → 0' },
];

export const FOURIER_PAIRS: readonly Pair[] = [
  { id: 'expAbs', f: 'e^(−a|t|)', F: '2a/(a² + ω²)', condition: 'a > 0' },
  { id: 'gauss', f: 'e^(−at²)', F: '√(π/a)·e^(−ω²/(4a))', condition: 'a > 0' },
  { id: 'lorentz', f: '1/(a² + t²)', F: '(π/a)·e^(−a|ω|)', condition: 'a > 0' },
  { id: 'rect', f: '1 for |t| < a, else 0', F: '2·sin(aω)/ω' },
  { id: 'sinc', f: 'sin(at)/t', F: 'π for |ω| < a, else 0' },
  { id: 'oneSided', f: 'e^(−at)·u(t)', F: '1/(a + iω)', condition: 'a > 0' },
  { id: 'delta', f: 'δ(t)', F: '1' },
  { id: 'one', f: '1', F: '2π·δ(ω)' },
  { id: 'cos', f: 'cos(ω₀t)', F: 'π·[δ(ω − ω₀) + δ(ω + ω₀)]' },
  { id: 'sin', f: 'sin(ω₀t)', F: '−iπ·[δ(ω − ω₀) − δ(ω + ω₀)]' },
  { id: 'triangle', f: '1 − |t|/a for |t| < a, else 0', F: 'a·sinc²(aω/2), with sinc x = sin x / x' },
];

export const FOURIER_PROPERTIES: readonly Pair[] = [
  { id: 'linearity', f: 'a·f(t) + b·g(t)', F: 'a·F(ω) + b·G(ω)' },
  { id: 'shiftT', f: 'f(t − t₀)', F: 'e^(−iωt₀)·F(ω)' },
  { id: 'modulation', f: 'e^(iω₀t)·f(t)', F: 'F(ω − ω₀)' },
  { id: 'scaling', f: 'f(at)', F: '(1/|a|)·F(ω/a)' },
  { id: 'derivative', f: 'f′(t)', F: 'iω·F(ω)' },
  { id: 'timesT', f: 't·f(t)', F: 'i·dF/dω' },
  { id: 'convolution', f: '(f ∗ g)(t)', F: 'F(ω)·G(ω)' },
  { id: 'product', f: 'f(t)·g(t)', F: '(1/2π)·(F ∗ G)(ω)' },
  { id: 'duality', f: 'F(t)', F: '2π·f(−ω)' },
  { id: 'parseval', f: '∫ |f(t)|² dt', F: '(1/2π)·∫ |F(ω)|² dω' },
];

/** The rows of a table that match a search: every word must appear in the pair, its condition, or its name. */
export function searchTable(table: readonly Pair[], query: string, names: (id: string) => string = () => ''): Pair[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return table.filter((pair) => {
    const text = `${pair.f} ${pair.F} ${pair.condition ?? ''} ${names(pair.id)}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Laplace, forward

/** The terms of a sum, each with its sign. */
function termsOf(node: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node, negative: boolean): void => {
    if (n.type === 'binary' && (n.op === '+' || n.op === '-')) {
      walk(n.left, negative);
      walk(n.right, n.op === '-' ? !negative : negative);
    } else if (n.type === 'unary' && n.op === '-') walk(n.arg, !negative);
    else out.push(negative ? neg(n) : n);
  };
  walk(tidy(node), false);
  return out;
}

function factorList(node: Node): { node: Node; up: boolean }[] {
  if (node.type === 'binary' && node.op === '*') return [...factorList(node.left), ...factorList(node.right)];
  if (node.type === 'binary' && node.op === '/')
    return [...factorList(node.left), ...factorList(node.right).map((f) => ({ ...f, up: !f.up }))];
  if (node.type === 'unary' && node.op === '-') return [{ node: num(-1), up: true }, ...factorList(node.arg)];
  return [{ node, up: true }];
}

/** The rate k of a linear argument k·v with no constant part, or null. */
function rateOf(arg: Node, v: string): number | null {
  const poly = polyOf(arg, v);
  if (!poly || [...poly.keys()].some((p) => p > 1)) return null;
  if (poly.has(0) && Math.abs(valueOf(fold(tidy(poly.get(0)!)))) > 1e-14) return null;
  const k = valueOf(fold(tidy(poly.get(1) ?? num(0))));
  return Number.isFinite(k) ? k : null;
}

interface LaplaceTerm {
  c: number;
  n: number;
  a: number;
  trig: { fn: 'sin' | 'cos' | 'sinh' | 'cosh'; b: number } | null;
}

/** A term as c·t^n·e^(at)·trig(bt), or null. */
function laplaceTerm(term: Node): LaplaceTerm | null {
  const out: LaplaceTerm = { c: 1, n: 0, a: 0, trig: null };
  for (const { node, up } of factorList(term)) {
    if (!dependsOn(node, 't')) {
      if (!isConstant(node)) return null;
      out.c = up ? out.c * valueOf(node) : out.c / valueOf(node);
      continue;
    }
    if (!up) return null;
    if (node.type === 'name') {
      out.n += 1;
      continue;
    }
    if (node.type === 'binary' && node.op === '^' && node.left.type === 'name' && node.left.name === 't') {
      if (!isConstant(node.right)) return null;
      const k = valueOf(node.right);
      if (!Number.isInteger(k) || k < 0) return null;
      out.n += k;
      continue;
    }
    const isE = node.type === 'binary' && node.op === '^' && node.left.type === 'name' && node.left.name === 'e';
    const call = node.type === 'call' && node.args.length === 1 ? node : null;
    const arg = isE ? (node as Extract<Node, { type: 'binary' }>).right : call?.args[0];
    const fn = isE ? 'exp' : call?.name;
    if (!arg || !fn) return null;
    const k = rateOf(arg, 't');
    if (k === null) return null;
    if (fn === 'exp') out.a += k;
    else if ((fn === 'sin' || fn === 'cos' || fn === 'sinh' || fn === 'cosh') && !out.trig) out.trig = { fn, b: k };
    else return null;
  }
  return Number.isFinite(out.c) ? out : null;
}

/**
 * ∫ f(t) e^(−st) dt from `start` to infinity, in short panels out to where e^(−st) is below 1e-26, so an
 * oscillating f keeps full accuracy.
 */
export function laplaceNumeric(f: (t: number) => number, s: number, start = 0): number {
  const end = start + 60 / s;
  const panels = 96;
  let sum = 0;
  for (let i = 0; i < panels; i += 1) {
    const a = start + ((end - start) * i) / panels;
    const b = start + ((end - start) * (i + 1)) / panels;
    sum += quadrature((t) => f(t) * Math.exp(-s * t), a, b, true);
  }
  return sum;
}

const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));

/** The Laplace transform of f(t). Throws a SolverError when a term is not in the table. */
export function laplace(source: string): TransformResult {
  const f = read(source);
  for (const used of namesIn(f)) if (used !== 't') throw new SolverError('unknown-name', used);
  const terms = termsOf(f);
  const steps: Step[] = [];
  if (terms.length > 1) steps.push(step('laplaceLinearity', terms.map((t) => `L{${show(t)}}`).join(' + ')));
  const s = name('s');
  const results: Node[] = [];
  let abscissa = 0;
  for (const term of terms) {
    const parts = laplaceTerm(term);
    if (!parts) throw new SolverError('laplace-term', show(term));
    const { c, n, a, trig } = parts;
    let F: Node;
    if (!trig) {
      F = div(num(fact(n)), pow(s, num(n + 1)));
      steps.push(step('laplaceTable', `L{${n === 0 ? '1' : n === 1 ? 't' : `t^${n}`}} = ${show(F)}`));
    } else {
      const b = num(trig.b);
      const sq = pow(s, num(2));
      const b2 = pow(b, num(2));
      const plus = trig.fn === 'sin' || trig.fn === 'cos';
      const den = plus ? add(sq, b2) : build.sub(sq, b2);
      F = div(trig.fn === 'sin' || trig.fn === 'sinh' ? b : s, den);
      steps.push(step('laplaceTable', `L{${trig.fn}(${niceNumber(trig.b)}t)} = ${show(F)}`));
      if (n > 0) {
        let d = F;
        for (let i = 0; i < n; i += 1) d = derive(d, 's');
        F = tidy(n % 2 ? neg(d) : d);
        steps.push(
          step(
            'laplaceTimesT',
            `L{t^${n}·${trig.fn}(${niceNumber(trig.b)}t)} = (−1)^${n}·d^${n}/ds^${n} [...] = ${show(F)}`,
            { n: String(n) },
          ),
        );
      }
      if (!plus) abscissa = Math.max(abscissa, Math.abs(trig.b) + a);
    }
    if (a !== 0) {
      F = tidy(substitute(F, 's', build.sub(s, num(a))));
      steps.push(step('laplaceShift', `s → s − ${niceNumber(a)}: ${show(F)}`, { a: niceNumber(a) }));
    }
    abscissa = Math.max(abscissa, a);
    results.push(c === 1 ? F : mul(num(c), F));
  }
  const total = tidy(results.reduce((x, y) => add(x, y)));
  const text = show(total);
  const s0 = abscissa + 1.5;
  const Fn = compile(total, ['s']);
  const fn = compile(f, ['t']);
  const numeric = laplaceNumeric((t) => fn([t]), s0);
  const checked = Math.abs(numeric - Fn([s0])) <= 1e-6 * Math.max(1, Math.abs(numeric));
  steps.push(step('laplaceResult', `F(s) = ${text},  s > ${niceNumber(abscissa)}`));
  const graph: XY[] = [];
  for (let i = 0; i <= 120; i += 1) {
    const x = abscissa + 0.05 + (i / 120) * 8;
    const y = Fn([x]);
    graph.push({ x, y: Number.isFinite(y) && Math.abs(y) < 1e6 ? y : NaN });
  }
  return { steps, text, checked, graph };
}

// ---------------------------------------------------------------------------------------------------------------
// Laplace, inverse

/** A term of f(t): c·t^k·e^(at)·cos(bt) or sin(bt). */
interface TimeTerm {
  c: number;
  k: number;
  a: number;
  b: number;
  fn: 'cos' | 'sin' | null;
}

function termText({ c, k, a, b, fn }: TimeTerm, t = 't'): string {
  const parts = [numText(c)];
  if (k === 1) parts.push(t);
  if (k > 1) parts.push(`${t}^${k}`);
  if (a !== 0) parts.push(`exp(${numText(a)}*${t})`);
  if (fn) parts.push(`${fn}(${numText(b)}*${t})`);
  return parts.join('*');
}

/** The inverse Laplace transform of F(s). */
export function inverseLaplace(source: string): TransformResult {
  const F = read(source);
  for (const used of namesIn(F)) if (used !== 's') throw new SolverError('unknown-name', used);
  const steps: Step[] = [];
  // A delay: a factor e^(-cs) with c > 0.
  let delay = 0;
  let rest = F;
  const factors = factorList(tidy(F));
  const delays = factors.filter(
    (f) =>
      f.up &&
      ((f.node.type === 'call' && f.node.name === 'exp') ||
        (f.node.type === 'binary' && f.node.op === '^' && f.node.left.type === 'name' && f.node.left.name === 'e')),
  );
  if (delays.length === 1) {
    const node = delays[0].node;
    const arg = node.type === 'call' ? node.args[0] : (node as Extract<Node, { type: 'binary' }>).right;
    const k = rateOf(arg, 's');
    if (k !== null && k < 0) {
      delay = -k;
      rest = factors
        .filter((f) => f !== delays[0])
        .reduce<Node>((acc, f) => (f.up ? mul(acc, f.node) : div(acc, f.node)), num(1));
      steps.push(
        step('inverseDelay', `e^(−${niceNumber(delay)}s) → u(t − ${niceNumber(delay)})·f(t − ${niceNumber(delay)})`, {
          c: niceNumber(delay),
        }),
      );
    }
  }
  const rational = rationalOf(tidy(rest), 's');
  if (!rational) throw new SolverError('inverse-form');
  const { q, r } = pdiv(rational.n, rational.d);
  if (degree(q) > 0 || Math.abs(q[0] ?? 0) > 1e-12) throw new SolverError('inverse-improper');
  const den = rational.d;
  const lead = den[den.length - 1];
  const N = r.map((c) => c / lead);
  const D = den.map((c) => c / lead);
  steps.push(step('inverseRational', `F(s) = (${polyText(N, 's')}) / (${polyText(D, 's')})`));
  const poles = roots(D);
  steps.push(
    step('inversePoles', poles.map((p) => `s = ${complexText(p.z)}${p.times > 1 ? ` (×${p.times})` : ''}`).join(', ')),
  );

  const terms: TimeTerm[] = [];
  const fractions: string[] = [];
  for (const pole of poles) {
    if (pole.z.im < 0) continue;
    const m = pole.times;
    // D(s) = (s - p)^m Q(s): the Taylor coefficients of N/Q at p give the partial fraction numerators.
    const shiftedD = shiftC(D, pole.z);
    const Q = shiftedD.slice(m);
    const g = seriesDivide(shiftC(N, pole.z), Q, m);
    for (let j = 1; j <= m; j += 1) {
      const A = g[m - j];
      const k = j - 1;
      const scale = 1 / fact(k);
      if (pole.z.im === 0) {
        if (Math.abs(A.re) < 1e-12) continue;
        fractions.push(
          `${niceNumber(A.re)}/(s − ${niceNumber(pole.z.re)})${j > 1 ? `^${j}` : ''}`.replace('− −', '+ '),
        );
        terms.push({ c: A.re * scale, k, a: pole.z.re, b: 0, fn: null });
      } else {
        // A pair p, p̄: 2 Re(A e^(pt)) t^k/k! = 2 e^(αt) t^k/k! (Re A cos βt − Im A sin βt).
        if (cabs(A) < 1e-12) continue;
        if (j === 1) {
          const B = 2 * A.re;
          const C = -2 * (A.re * pole.z.re + A.im * pole.z.im);
          fractions.push(
            `(${niceNumber(B)}·s + ${niceNumber(C)})/(s² − ${niceNumber(2 * pole.z.re)}·s + ${niceNumber(pole.z.re ** 2 + pole.z.im ** 2)})`,
          );
        } else fractions.push(`(${complexText(A)})/(s − ${complexText(pole.z)})^${j} + conjugate`);
        if (Math.abs(A.re) > 1e-12) terms.push({ c: 2 * A.re * scale, k, a: pole.z.re, b: pole.z.im, fn: 'cos' });
        if (Math.abs(A.im) > 1e-12) terms.push({ c: -2 * A.im * scale, k, a: pole.z.re, b: pole.z.im, fn: 'sin' });
      }
    }
  }
  steps.push(step('inversePartial', fractions.join(' + ').replace(/\+ −/g, '− ')));
  if (!terms.length) terms.push({ c: 0, k: 0, a: 0, b: 0, fn: null });
  const t = delay ? `(t-${numText(delay)})` : 't';
  const sum = terms.map((one) => termText(one, t)).join(' + ');
  const body = tidy(read(sum));
  const text = delay ? `u(t − ${niceNumber(delay)})·(${show(body)})` : show(body);
  steps.push(step('inverseTable'));
  steps.push(step('inverseResult', `f(t) = ${text}`));
  // The check: transform the answer back at a real s to the right of every pole.
  const fn = compile(body, ['t']);
  const right = Math.max(0, ...poles.map((p) => p.z.re));
  const s0 = right + 1.5;
  const back = laplaceNumeric((tt) => fn([tt]), s0, delay);
  const want = compile(F, ['s'])([s0]);
  const checked = Math.abs(back - want) <= 1e-6 * Math.max(1, Math.abs(want));
  const graph: XY[] = [];
  const span = Math.max(6, delay * 2 + 4);
  for (let i = 0; i <= 240; i += 1) {
    const x = (i / 240) * span;
    const y = x < delay ? 0 : fn([x]);
    graph.push({ x, y: Number.isFinite(y) && Math.abs(y) < 1e6 ? y : NaN });
  }
  return { steps, text, checked, graph };
}

function polyText(p: readonly number[], v: string): string {
  const parts: string[] = [];
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const c = p[i];
    if (Math.abs(c) < 1e-12) continue;
    const x = i === 0 ? '' : i === 1 ? v : `${v}^${i}`;
    const mag = Math.abs(c);
    const coefficient = x && Math.abs(mag - 1) < 1e-12 ? '' : niceNumber(mag);
    parts.push(`${c < 0 ? '−' : parts.length ? '+' : ''} ${coefficient}${coefficient && x ? '·' : ''}${x}`.trim());
  }
  return parts.join(' ').replace(/^\+ /, '') || '0';
}

function complexText(z: Complex): string {
  if (z.im === 0) return niceNumber(z.re);
  const im = `${niceNumber(Math.abs(z.im))}i`;
  if (z.re === 0) return z.im < 0 ? `−${im}` : im;
  return `${niceNumber(z.re)} ${z.im < 0 ? '−' : '+'} ${im}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Fourier

interface Family {
  readonly id: 'expAbs' | 'gauss' | 'lorentz';
  /** The time function and its transform, for a > 0. */
  readonly time: (a: number, t: number) => number;
  readonly freq: (a: number, w: number) => number;
  readonly timeText: (a: string) => string;
  readonly freqText: (a: string) => string;
}

const FAMILIES: readonly Family[] = [
  {
    id: 'expAbs',
    time: (a, t) => Math.exp(-a * Math.abs(t)),
    freq: (a, w) => (2 * a) / (a * a + w * w),
    timeText: (a) => `exp(-${a}*abs(t))`,
    freqText: (a) => `2*${a}/(${a}^2 + w^2)`,
  },
  {
    id: 'gauss',
    time: (a, t) => Math.exp(-a * t * t),
    freq: (a, w) => Math.sqrt(Math.PI / a) * Math.exp((-w * w) / (4 * a)),
    timeText: (a) => `exp(-${a}*t^2)`,
    freqText: (a) => `sqrt(pi/${a})*exp(-w^2/(4*${a}))`,
  },
  {
    id: 'lorentz',
    time: (a, t) => 1 / (a * a + t * t),
    freq: (a, w) => (Math.PI / a) * Math.exp(-a * Math.abs(w)),
    timeText: (a) => `1/(${a}^2 + t^2)`,
    freqText: (a) => `pi/${a}*exp(-${a}*abs(w))`,
  },
];

/** Fits c·g(a, x) to samples of h: a from the ratio h(1)/h(0), then checked at more points. */
function fit(h: (x: number) => number, g: (a: number, x: number) => number): { a: number; c: number } | null {
  const [h0, h1] = [h(0), h(1)];
  if (!Number.isFinite(h0) || !Number.isFinite(h1) || h0 === 0) return null;
  const ratio = h1 / h0;
  if (!(ratio > 0 && ratio < 1)) return null;
  // g(a, 1)/g(a, 0) moves one way as a grows for every family here, so bisection on log a finds it.
  const r = (logA: number) => g(Math.exp(logA), 1) / g(Math.exp(logA), 0);
  const falling = r(-12) > r(12);
  let [lo, hi] = [-12, 12];
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (r(mid) > ratio === falling) lo = mid;
    else hi = mid;
  }
  const a = Math.exp((lo + hi) / 2);
  const c = h0 / g(a, 0);
  for (const x of [-2.3, -0.7, 0.4, 1.9, 3.1])
    if (Math.abs(h(x) - c * g(a, x)) > 1e-9 * Math.max(1, Math.abs(h(x)))) return null;
  return { a, c };
}

const paramText = (a: number) => numText(Number(a.toPrecision(12)));

/** The Fourier transform of f(t), as F(ω) = ∫ f(t) e^(−iωt) dt. */
export function fourier(source: string): TransformResult {
  return fourierBoth(source, 'forward');
}

/** The inverse Fourier transform of F(ω), as f(t) = (1/2π) ∫ F(ω) e^(iωt) dω. */
export function inverseFourier(source: string): TransformResult {
  return fourierBoth(source, 'inverse');
}

function fourierBoth(source: string, direction: 'forward' | 'inverse'): TransformResult {
  const from = direction === 'forward' ? 't' : 'w';
  const node = read(source.replace(/ω/g, 'w'));
  for (const used of namesIn(node)) if (used !== from) throw new SolverError('unknown-name', used);
  const terms = termsOf(node);
  const steps: Step[] = [];
  if (terms.length > 1) steps.push(step('fourierLinearity', terms.map((one) => show(one)).join(' + ')));
  const out: string[] = [];
  for (const term of terms) {
    const h = compile(term, [from]);
    let matched = false;
    for (const family of FAMILIES) {
      const found = fit((x) => h([x]), direction === 'forward' ? family.time : family.freq);
      if (!found) continue;
      const a = paramText(found.a);
      const result =
        direction === 'forward'
          ? `${numText(found.c)}*(${family.freqText(a)})`
          : `${numText(found.c)}*(${family.timeText(a)})`;
      const pair = FOURIER_PAIRS.find((one) => one.id === family.id)!;
      steps.push(step('fourierTable', `${pair.f} ↔ ${pair.F}, a = ${niceNumber(found.a)}`, { a: niceNumber(found.a) }));
      out.push(result);
      matched = true;
      break;
    }
    if (!matched) throw new SolverError('fourier-term', show(term));
  }
  const total = tidy(read(out.join(' + ')));
  const to = direction === 'forward' ? 'w' : 't';
  const text = show(total).replace(/\bw\b/g, 'ω');
  const head = direction === 'forward' ? 'F(ω)' : 'f(t)';
  steps.push(step(direction === 'forward' ? 'fourierResult' : 'fourierInverseResult', `${head} = ${text}`));
  // The check: a numeric transform of whichever side dies away fast must give the other side.
  const result = compile(total, [to]);
  const input = compile(node, [from]);
  const [time, freq] =
    direction === 'forward'
      ? [(t: number) => input([t]), (w: number) => result([w])]
      : [(t: number) => result([t]), (w: number) => input([w])];
  const checked = checkPair(time, freq);
  const graph: XY[] = [];
  for (let i = 0; i <= 200; i += 1) {
    const x = -10 + i / 10;
    const y = result([x]);
    graph.push({ x, y: Number.isFinite(y) ? y : NaN });
  }
  return { steps, text, checked, graph };
}

/** How far out f must go before it is negligible, or null when it dies away too slowly to integrate well. */
function reach(f: (t: number) => number): number | null {
  let L = 1;
  while (L < 400 && Math.max(Math.abs(f(L)), Math.abs(f(-L))) > 1e-14) L *= 1.5;
  return L < 400 ? L : null;
}

/** True when f and F agree as a Fourier pair at a few points, tested from the side that dies away fast. */
function checkPair(f: (t: number) => number, F: (w: number) => number): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  if (reach(f) !== null) return [0.5, 1.3].every((w) => close(numericFourier(f, w).re, F(w)));
  if (reach(F) !== null) return [0.5, 1.3].every((t) => close(numericFourier(F, t).re / (2 * Math.PI), f(t)));
  return false;
}

/** ∫ f(t) e^(−iωt) dt over the whole line, for a function that dies away: real and imaginary parts. */
export function numericFourier(f: (t: number) => number, w: number): Complex {
  // Out to where f is negligible, in panels short enough for the oscillation.
  const L = reach(f) ?? 400;
  const panels = Math.max(16, Math.ceil((L * Math.max(1, Math.abs(w))) / 2));
  let re = 0;
  let im = 0;
  for (let i = 0; i < panels; i += 1) {
    const a = -L + (2 * L * i) / panels;
    const b = a + (2 * L) / panels;
    re += quadrature((t) => f(t) * Math.cos(w * t), a, b, true);
    im -= quadrature((t) => f(t) * Math.sin(w * t), a, b, true);
  }
  return cx(re, im);
}
