// Fourier series and boundary value problems. A function can be given in pieces. The tool finds its Fourier
// coefficients by numerical integration and recognizes a closed form for them when there is a simple one, and it
// solves the heat, wave, and Laplace equations by separation of variables: eigenvalues from the boundary
// conditions, then coefficients from the starting data.
import { numberOf, readFunction } from '../expr';
import { fmt, integrate, toFraction } from '../numeric';
import { KitError, step, type KitStep } from '../types';

export interface Piece {
  text: string;
  f: (x: number) => number;
  a: number;
  b: number;
}

/** Reads a function given in pieces, one per line as "expression ; from ; to", or as one expression for everything. */
export function readPieces(source: string, lo: number, hi: number): Piece[] {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new KitError('empty');
  const pieces: Piece[] = lines.map((line) => {
    const parts = line.split(';').map((part) => part.trim());
    if (parts.length !== 1 && parts.length !== 3) throw new KitError('pieceFormat', line);
    const a = parts.length === 3 ? numberOf(parts[1]) : lo;
    const b = parts.length === 3 ? numberOf(parts[2]) : hi;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) throw new KitError('pieceRange', line);
    const fn = readFunction(parts[0], ['x']);
    return { text: parts[0], f: (x: number) => fn([x]), a, b };
  });
  pieces.sort((p, q) => p.a - q.a);
  for (let k = 1; k < pieces.length; k++) {
    if (pieces[k].a < pieces[k - 1].b - 1e-12) throw new KitError('pieceOverlap');
  }
  for (let i = 0; i <= 200; i++) {
    const x = lo + ((hi - lo) * (i + 0.5)) / 201;
    if (!pieces.some((p) => x >= p.a && x <= p.b)) throw new KitError('pieceGap', fmt(x, 4));
  }
  for (const piece of pieces) {
    const probe = piece.f((piece.a + piece.b) / 2);
    if (!Number.isFinite(probe)) throw new KitError('undefinedTerm', piece.text);
  }
  return pieces;
}

export function valueAt(pieces: readonly Piece[], x: number): number {
  const piece = pieces.find((p, k) => x >= p.a && (x < p.b || (k === pieces.length - 1 && x <= p.b)));
  return piece ? piece.f(x) : 0;
}

/** The integral of g(x) over [lo, hi], split at the breaks of the pieces. */
export function integratePieces(pieces: readonly Piece[], g: (x: number, f: number) => number, lo: number, hi: number): number {
  let total = 0;
  for (const piece of pieces) {
    const a = Math.max(lo, piece.a);
    const b = Math.min(hi, piece.b);
    if (b > a) total += integrate((x) => g(x, piece.f(x)), a, b, 1e-13);
  }
  return total;
}

type Pattern = { latex: string; at: (n: number) => number };

const SIGNS: { name: string; at: (n: number) => number }[] = [
  { name: 'all', at: () => 1 },
  { name: 'alt', at: (n) => (n % 2 === 1 ? 1 : -1) },
  { name: 'altNeg', at: (n) => (n % 2 === 1 ? -1 : 1) },
  { name: 'odd', at: (n) => (n % 2 === 1 ? 1 : 0) },
  { name: 'even', at: (n) => (n % 2 === 0 ? 1 : 0) },
  { name: 'oddAlt', at: (n) => (n % 2 === 0 ? 0 : n % 4 === 1 ? 1 : -1) },
  { name: 'evenAlt', at: (n) => (n % 2 === 1 ? 0 : n % 4 === 2 ? 1 : -1) },
];

/** A closed form n -> c_n for a list of coefficients 1..N, when it is a simple one (K / (n^p pi^q) with a sign pattern). */
export function recognizePattern(values: readonly number[], name: string): Pattern | null {
  if (values.every((v) => Math.abs(v) < 1e-10)) return { latex: `${name}=0`, at: () => 0 };
  for (const p of [0, 1, 2, 3]) {
    for (const q of [0, 1, 2]) {
      const scaled = values.map((v, i) => v * (i + 1) ** p * Math.PI ** q);
      for (const sign of SIGNS) {
        const first = scaled.findIndex((_, i) => sign.at(i + 1) !== 0);
        if (first < 0 || sign.at(first + 1) === 0) continue;
        const K = scaled[first] / sign.at(first + 1);
        const fits = scaled.every((v, i) => Math.abs(v - K * sign.at(i + 1)) <= 1e-8 * Math.max(1, Math.abs(K)));
        const ratio = toFraction(Math.abs(K), 48, 1e-8);
        if (!fits || !ratio || K === 0) continue;
        const numerator = `${K < 0 ? '-' : ''}${ratio[0]}`;
        const n = p === 0 ? '' : p === 1 ? 'n' : `n^{${p}}`;
        const pi = q === 0 ? '' : q === 1 ? '\\pi' : `\\pi^{${q}}`;
        const denominator = `${ratio[1] > 1 ? ratio[1] : ''}${n}${pi}`;
        const core = denominator ? `\\frac{${numerator}}{${denominator}}` : numerator;
        const text = (suffix: string) => `${name}=${suffix}`;
        const amount = (n: number) => (K * sign.at(n)) / (n ** p * Math.PI ** q);
        if (sign.name === 'all') return { latex: text(core), at: amount };
        if (sign.name === 'alt') return { latex: text(`(-1)^{n+1}${core}`), at: amount };
        if (sign.name === 'altNeg') return { latex: text(`(-1)^{n}${core}`), at: amount };
        const where = sign.name.startsWith('odd') ? 'n\\text{ odd}' : 'n\\text{ even}';
        const other = sign.name.startsWith('odd') ? 'n\\text{ even}' : 'n\\text{ odd}';
        const body = sign.name === 'oddAlt' ? `(-1)^{(n-1)/2}${core}` : sign.name === 'evenAlt' ? `(-1)^{n/2+1}${core}` : core;
        return { latex: text(`\\begin{cases}${body}&${where}\\\\0&${other}\\end{cases}`), at: amount };
      }
    }
  }
  return null;
}

export type FourierKind = 'full' | 'sine' | 'cosine';

export interface FourierResult {
  kind: FourierKind;
  L: number;
  a0: number;
  a: number[];
  b: number[];
  aPattern: Pattern | null;
  bPattern: Pattern | null;
  /** The partial sum with N terms. */
  partial: (x: number, N?: number) => number;
  parseval: { integral: number; series: number };
  gibbs: { jump: number; overshoot: number; at: number } | null;
  steps: KitStep[];
  samples: { f: [number, number][]; sum: [number, number][] };
}

const FORMULAS: Record<FourierKind, { a: string; b: string }> = {
  full: {
    a: 'a_n=\\frac{1}{L}\\int_{-L}^{L} f(x)\\cos\\frac{n\\pi x}{L}\\,dx',
    b: 'b_n=\\frac{1}{L}\\int_{-L}^{L} f(x)\\sin\\frac{n\\pi x}{L}\\,dx',
  },
  sine: { a: '', b: 'b_n=\\frac{2}{L}\\int_{0}^{L} f(x)\\sin\\frac{n\\pi x}{L}\\,dx' },
  cosine: { a: 'a_n=\\frac{2}{L}\\int_{0}^{L} f(x)\\cos\\frac{n\\pi x}{L}\\,dx', b: '' },
};

/** The Fourier series of a piecewise function on (-L, L), or its half-range sine or cosine series on (0, L). */
export function fourierSeries(source: string, kind: FourierKind, L: number, terms: number): FourierResult {
  if (!(L > 0) || !Number.isFinite(L)) throw new KitError('badLength');
  if (!Number.isInteger(terms) || terms < 1 || terms > 200) throw new KitError('badTerms');
  const lo = kind === 'full' ? -L : 0;
  const pieces = readPieces(source, lo, L);
  const k = (n: number) => (n * Math.PI) / L;
  const scale = kind === 'full' ? 1 / L : 2 / L;
  const cosCoefficient = (n: number) => scale * integratePieces(pieces, (x, f) => f * Math.cos(k(n) * x), lo, L);
  const sinCoefficient = (n: number) => scale * integratePieces(pieces, (x, f) => f * Math.sin(k(n) * x), lo, L);
  const a0 = cosCoefficient(0);
  const a = kind === 'sine' ? [] : Array.from({ length: terms }, (_, i) => cosCoefficient(i + 1));
  const b = kind === 'cosine' ? [] : Array.from({ length: terms }, (_, i) => sinCoefficient(i + 1));
  const partial = (x: number, N = terms) => {
    let sum = kind === 'sine' ? 0 : a0 / 2;
    for (let n = 1; n <= Math.min(N, terms); n++) {
      if (a.length) sum += a[n - 1] * Math.cos(k(n) * x);
      if (b.length) sum += b[n - 1] * Math.sin(k(n) * x);
    }
    return sum;
  };
  const energy = scale === 1 / L ? 1 / L : 2 / L;
  const integral = energy * integratePieces(pieces, (_x, f) => f * f, lo, L);
  const series = (kind === 'sine' ? 0 : (a0 * a0) / 2) + a.reduce((s, v) => s + v * v, 0) + b.reduce((s, v) => s + v * v, 0);
  // The period is 2L; the series repeats the function (or its odd/even extension) outside the interval.
  const aPattern = a.length >= 6 ? recognizePattern(a.slice(0, 12), 'a_n') : null;
  const bPattern = b.length >= 6 ? recognizePattern(b.slice(0, 12), 'b_n') : null;
  const steps: KitStep[] = [
    step('fsSetup', kind === 'full' ? 'f(x)\\sim\\frac{a_0}{2}+\\sum_{n\\ge1}\\left(a_n\\cos\\frac{n\\pi x}{L}+b_n\\sin\\frac{n\\pi x}{L}\\right)' : kind === 'sine' ? 'f(x)\\sim\\sum_{n\\ge1} b_n\\sin\\frac{n\\pi x}{L}' : 'f(x)\\sim\\frac{a_0}{2}+\\sum_{n\\ge1} a_n\\cos\\frac{n\\pi x}{L}', {
      kind,
      L: fmt(L, 8),
    }),
  ];
  if (a.length) steps.push(step('fsCoefficientA', FORMULAS[kind].a), step('fsA0', `a_0=${fmt(a0, 10)}`, { a0: fmt(a0, 10) }));
  if (b.length) steps.push(step('fsCoefficientB', FORMULAS[kind].b));
  if (aPattern) steps.push(step('fsPattern', aPattern.latex));
  if (bPattern) steps.push(step('fsPattern', bPattern.latex));
  steps.push(
    step('fsParseval', undefined, { lhs: fmt(integral, 10), rhs: fmt(series, 10), n: String(terms) }),
  );
  // Jumps between pieces and at the ends of the period, for the Gibbs overshoot.
  let gibbs: FourierResult['gibbs'] = null;
  const edges: { x: number; left: number; right: number }[] = [];
  for (let i = 1; i < pieces.length; i++) {
    edges.push({ x: pieces[i].a, left: pieces[i - 1].f(pieces[i - 1].b), right: pieces[i].f(pieces[i].a) });
  }
  if (kind === 'full') {
    const first = pieces[0].f(pieces[0].a);
    const last = pieces[pieces.length - 1].f(pieces[pieces.length - 1].b);
    edges.push({ x: L, left: last, right: first });
  }
  if (kind === 'sine') {
    const first = pieces[0].f(pieces[0].a);
    const last = pieces[pieces.length - 1].f(pieces[pieces.length - 1].b);
    edges.push({ x: 0, left: -first, right: first }, { x: L, left: last, right: -last });
  }
  const jumpy = edges
    .filter((e) => Math.abs(e.left - e.right) > 1e-9)
    .sort((p, q) => Math.abs(q.left - q.right) - Math.abs(p.left - p.right));
  if (jumpy.length && terms >= 8) {
    const e = jumpy[0];
    const high = Math.max(e.left, e.right);
    const low = Math.min(e.left, e.right);
    const width = (3 * L) / terms;
    let best = 0;
    let where = e.x;
    for (let i = -400; i <= 400; i++) {
      const x = e.x + (width * i) / 400;
      const v = partial(x);
      const over = Math.max(v - high, low - v);
      if (over > best) {
        best = over;
        where = x;
      }
    }
    const jump = high - low;
    gibbs = { jump, overshoot: best, at: where };
    const vars = { jump: fmt(jump, 6), overshoot: fmt(best, 6), percent: fmt((100 * best) / jump, 4) };
    steps.push(step('fsGibbs', undefined, vars));
  }
  const shown = kind === 'full' ? 2 * L : L;
  const count = 400;
  const f: [number, number][] = [];
  const sum: [number, number][] = [];
  for (let i = 0; i <= count; i++) {
    const x = lo + (shown * i) / count;
    f.push([x, valueAt(pieces, x)]);
    sum.push([x, partial(x)]);
  }
  return { kind, L, a0, a, b, aPattern, bPattern, partial, parseval: { integral, series }, gibbs, steps, samples: { f, sum } };
}

// ---------------------------------------------------------------------------------------------------------------
// Boundary value problems
// ---------------------------------------------------------------------------------------------------------------

export type Conditions = 'DD' | 'NN' | 'DN' | 'ND' | 'DR';

export interface Eigenpair {
  n: number;
  mu: number;
  phi: (x: number) => number;
}

/** The eigenpairs of X'' = -mu^2 X on (0, L) for the boundary conditions (Dirichlet, Neumann, or Robin at x = L). */
export function eigenpairs(bc: Conditions, L: number, count: number, h = 1): Eigenpair[] {
  if (!(L > 0)) throw new KitError('badLength');
  const out: Eigenpair[] = [];
  for (let n = 1; n <= count; n++) {
    if (bc === 'DD') {
      const mu = (n * Math.PI) / L;
      out.push({ n, mu, phi: (x) => Math.sin(mu * x) });
    } else if (bc === 'NN') {
      const mu = ((n - 1) * Math.PI) / L;
      out.push({ n: n - 1, mu, phi: (x) => Math.cos(mu * x) });
    } else if (bc === 'DN') {
      const mu = ((n - 0.5) * Math.PI) / L;
      out.push({ n, mu, phi: (x) => Math.sin(mu * x) });
    } else if (bc === 'ND') {
      const mu = ((n - 0.5) * Math.PI) / L;
      out.push({ n, mu, phi: (x) => Math.cos(mu * x) });
    } else {
      if (!(h >= 0) || !Number.isFinite(h)) throw new KitError('badRobin');
      // mu cos(mu L) + h sin(mu L) = 0 has exactly one root in each ((n - 1/2) pi / L, n pi / L).
      const g = (mu: number) => mu * Math.cos(mu * L) + h * Math.sin(mu * L);
      let lo = ((n - 0.5) * Math.PI) / L + 1e-12;
      let hi = (n * Math.PI) / L;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (g(lo) * g(mid) <= 0) hi = mid;
        else lo = mid;
      }
      const mu = (lo + hi) / 2;
      out.push({ n, mu, phi: (x) => Math.sin(mu * x) });
    }
  }
  return out;
}

export const CONDITION_LATEX: Record<Conditions, string> = {
  DD: 'u(0,t)=u(L,t)=0',
  NN: 'u_x(0,t)=u_x(L,t)=0',
  DN: 'u(0,t)=0,\\; u_x(L,t)=0',
  ND: 'u_x(0,t)=0,\\; u(L,t)=0',
  DR: 'u(0,t)=0,\\; u_x(L,t)+h\\,u(L,t)=0',
};

export type Equation = 'heat' | 'wave';

export interface SeriesSolution {
  equation: Equation;
  pairs: Eigenpair[];
  coefficients: number[];
  velocity: number[];
  /** u(x, t). */
  at: (x: number, t: number) => number;
  steps: KitStep[];
  snapshots: { t: number; points: [number, number][] }[];
}

/** The heat equation u_t = alpha u_xx or the wave equation u_tt = c^2 u_xx on (0, L) by separation of variables. */
export function solveBvp(options: {
  equation: Equation;
  conditions: Conditions;
  L: number;
  speed: number;
  initial: string;
  velocity?: string;
  terms: number;
  h?: number;
  times: number[];
}): SeriesSolution {
  const { equation, conditions, L, speed, terms } = options;
  if (!(speed > 0) || !Number.isFinite(speed)) throw new KitError('badSpeed');
  if (!Number.isInteger(terms) || terms < 1 || terms > 200) throw new KitError('badTerms');
  const pieces = readPieces(options.initial, 0, L);
  const velocityPieces = equation === 'wave' ? readPieces(options.velocity ?? '0', 0, L) : null;
  const pairs = eigenpairs(conditions, L, terms, options.h ?? 1);
  const project = (source: readonly Piece[], pair: Eigenpair) => {
    const num = integratePieces(source, (x, f) => f * pair.phi(x), 0, L);
    const den = integrate((x) => pair.phi(x) ** 2, 0, L, 1e-13);
    return num / den;
  };
  const coefficients = pairs.map((pair) => project(pieces, pair));
  const velocity = pairs.map((pair) => (velocityPieces ? project(velocityPieces, pair) : 0));
  const timeFactor = (pair: Eigenpair, k: number, t: number) => {
    if (equation === 'heat') return coefficients[k] * Math.exp(-speed * pair.mu * pair.mu * t);
    const w = speed * pair.mu;
    if (w === 0) return coefficients[k] + velocity[k] * t;
    return coefficients[k] * Math.cos(w * t) + (velocity[k] / w) * Math.sin(w * t);
  };
  const at = (x: number, t: number) => pairs.reduce((s, pair, k) => s + timeFactor(pair, k, t) * pair.phi(x), 0);
  const symbol = equation === 'heat' ? '\\alpha' : 'c';
  const steps: KitStep[] = [
    step(equation === 'heat' ? 'pdeHeat' : 'pdeWave', equation === 'heat' ? 'u_t=\\alpha\\,u_{xx}' : 'u_{tt}=c^{2}u_{xx}', {
      conditions: CONDITION_LATEX[conditions],
    }),
    step('pdeSeparate', 'u(x,t)=X(x)\\,T(t)\\;\\Rightarrow\\;X\'\'=-\\mu^{2}X', {}),
    step('pdeEigen', undefined, {
      mus: pairs.slice(0, 3).map((p) => fmt(p.mu, 6)).join(', '),
      conditions: conditions,
    }),
    step('pdeTime', equation === 'heat' ? `T_n(t)=e^{-${symbol}\\mu_n^{2}t}` : 'T_n(t)=A_n\\cos(c\\mu_nt)+B_n\\sin(c\\mu_nt)'),
    step('pdeCoefficients', 'c_n=\\frac{\\int_0^L f(x)\\varphi_n(x)\\,dx}{\\int_0^L\\varphi_n(x)^{2}\\,dx}', {
      list: coefficients.slice(0, 4).map((c) => fmt(c, 6)).join(', '),
    }),
  ];
  const snapshots = options.times.map((t) => ({
    t,
    points: Array.from({ length: 101 }, (_, i): [number, number] => [(L * i) / 100, at((L * i) / 100, t)]),
  }));
  return { equation, pairs, coefficients, velocity, at, steps, snapshots };
}

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface LaplaceSolution {
  /** u(x, y). */
  at: (x: number, y: number) => number;
  coefficients: number[];
  steps: KitStep[];
  grid: number[][];
}

/** Laplace's equation on the rectangle [0, a] x [0, b], with u = f on one side and u = 0 on the other three. */
export function solveLaplace(a: number, b: number, side: Side, source: string, terms: number): LaplaceSolution {
  if (!(a > 0) || !(b > 0)) throw new KitError('badLength');
  if (!Number.isInteger(terms) || terms < 1 || terms > 200) throw new KitError('badTerms');
  // A side along x uses the width a, a side along y uses the height b, so work in the side's own coordinates.
  const along = side === 'top' || side === 'bottom' ? a : b;
  const across = side === 'top' || side === 'bottom' ? b : a;
  const pieces = readPieces(source, 0, along);
  const coefficients = Array.from({ length: terms }, (_, i) => {
    const k = ((i + 1) * Math.PI) / along;
    return (2 / along) * integratePieces(pieces, (s, f) => f * Math.sin(k * s), 0, along);
  });
  // u(s, r): s along the side with the data, r the distance from the side opposite to it (r = across at the data).
  const solved = (s: number, r: number) =>
    coefficients.reduce((sum, c, i) => {
      const k = ((i + 1) * Math.PI) / along;
      const ratio = (Math.exp(k * (r - across)) - Math.exp(-k * (r + across))) / (1 - Math.exp(-2 * k * across));
      return sum + c * Math.sin(k * s) * ratio;
    }, 0);
  const at = (x: number, y: number) => {
    if (side === 'top') return solved(x, y);
    if (side === 'bottom') return solved(x, b - y);
    if (side === 'right') return solved(y, x);
    return solved(y, a - x);
  };
  const grid = Array.from({ length: 5 }, (_, j) => Array.from({ length: 5 }, (_, i) => at((a * i) / 4, (b * (4 - j)) / 4)));
  const steps: KitStep[] = [
    step('pdeLaplace', '\\nabla^{2}u=u_{xx}+u_{yy}=0', { a: fmt(a, 6), b: fmt(b, 6) }),
    step('pdeLaplaceSeries', 'u=\\sum_{n\\ge1}c_n\\sin\\frac{n\\pi s}{\\ell}\\,\\frac{\\sinh(n\\pi r/\\ell)}{\\sinh(n\\pi h/\\ell)}'),
    step('pdeCoefficients', 'c_n=\\frac{2}{\\ell}\\int_0^{\\ell} f(s)\\sin\\frac{n\\pi s}{\\ell}\\,ds', {
      list: coefficients.slice(0, 4).map((c) => fmt(c, 6)).join(', '),
    }),
  ];
  return { at, coefficients, steps, grid };
}

