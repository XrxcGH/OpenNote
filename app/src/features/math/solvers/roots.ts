// Root finding: Newton's method, bisection, and the secant method, each with its iteration table, a report of how it
// ended (converged, diverged, stuck on a flat tangent, caught in a cycle, out of iterations), the order of
// convergence estimated from the last steps, and the lines to draw: Newton's tangents, the secants, or the bisection
// brackets.
import { SolverError, compile, derive, namesIn, numberText, read, show } from './expr';
import { samples, step, type Step, type XY } from './steps';

export type RootMethod = 'newton' | 'bisection' | 'secant';
export type RootOutcome = 'converged' | 'diverged' | 'flat' | 'cycle' | 'iterations' | 'noSignChange' | 'undefined';

export interface RootInput {
  readonly f: string;
  readonly method: RootMethod;
  /** The first guess, or the left end for bisection. */
  readonly x0: number;
  /** The second guess for the secant method, or the right end for bisection. */
  readonly x1?: number;
  readonly tolerance?: number;
  readonly maxIterations?: number;
}

export interface RootRow {
  readonly n: number;
  readonly x: number;
  readonly fx: number;
  /** f′(x) for Newton's method. */
  readonly dfx?: number;
  /** The bracket for bisection. */
  readonly a?: number;
  readonly b?: number;
  /** The change in x on this step. */
  readonly change: number;
}

export interface RootResult {
  readonly rows: readonly RootRow[];
  readonly outcome: RootOutcome;
  readonly root: number | null;
  /** The order of convergence estimated from the last three steps, or null. */
  readonly order: number | null;
  readonly steps: readonly Step[];
  readonly graph: { readonly f: readonly XY[]; readonly lines: readonly (readonly [XY, XY])[] };
}

export function findRoot(input: RootInput): RootResult {
  const node = read(input.f);
  for (const used of namesIn(node)) if (used !== 'x') throw new SolverError('unknown-name', used);
  const fn = compile(node, ['x']);
  const f = (x: number) => fn([x]);
  const tolerance = input.tolerance ?? 1e-10;
  const max = Math.min(200, Math.max(1, input.maxIterations ?? 50));
  const steps: Step[] = [];
  const rows: RootRow[] = [];
  const lines: [XY, XY][] = [];
  let outcome: RootOutcome = 'iterations';
  let root: number | null = null;

  if (input.method === 'newton') {
    let dNode;
    try {
      dNode = derive(node, 'x');
    } catch {
      dNode = null;
    }
    const d = dNode ? compile(dNode, ['x']) : null;
    const df = (x: number) => (d ? d([x]) : (f(x + 1e-6) - f(x - 1e-6)) / 2e-6);
    steps.push(
      step('rootNewton', `x₍ₙ₊₁₎ = xₙ − f(xₙ)/f′(xₙ),  f′(x) = ${dNode ? show(dNode) : '≈ (f(x + h) − f(x − h))/2h'}`),
    );
    let x = input.x0;
    const seen: number[] = [];
    for (let n = 0; n < max; n += 1) {
      const fx = f(x);
      const dfx = df(x);
      if (!Number.isFinite(fx) || !Number.isFinite(dfx)) {
        outcome = 'undefined';
        break;
      }
      if (fx === 0) {
        rows.push({ n, x, fx, dfx, change: 0 });
        [outcome, root] = ['converged', x];
        break;
      }
      if (dfx === 0 || Math.abs(dfx) < 1e-300) {
        rows.push({ n, x, fx, dfx, change: NaN });
        outcome = 'flat';
        break;
      }
      const next = x - fx / dfx;
      rows.push({ n, x, fx, dfx, change: next - x });
      lines.push(
        [
          { x, y: 0 },
          { x, y: fx },
        ],
        [
          { x, y: fx },
          { x: next, y: 0 },
        ],
      );
      const verdict = judge(rows, next, seen, tolerance, f);
      seen.push(x);
      if (verdict) {
        outcome = verdict;
        if (verdict === 'converged') {
          root = next;
          rows.push({ n: n + 1, x: next, fx: f(next), dfx: df(next), change: 0 });
        }
        break;
      }
      x = next;
    }
  } else if (input.method === 'secant') {
    steps.push(step('rootSecant', 'x₍ₙ₊₁₎ = xₙ − f(xₙ)·(xₙ − xₙ₋₁)/(f(xₙ) − f(xₙ₋₁))'));
    let [prev, x] = [input.x0, input.x1 ?? input.x0 + 1];
    const seen: number[] = [prev];
    rows.push({ n: 0, x: prev, fx: f(prev), change: NaN });
    for (let n = 1; n < max; n += 1) {
      const [fp, fx] = [f(prev), f(x)];
      if (!Number.isFinite(fp) || !Number.isFinite(fx)) {
        outcome = 'undefined';
        break;
      }
      if (fx === 0) {
        rows.push({ n, x, fx, change: 0 });
        [outcome, root] = ['converged', x];
        break;
      }
      if (fx === fp) {
        rows.push({ n, x, fx, change: NaN });
        outcome = 'flat';
        break;
      }
      const next = x - (fx * (x - prev)) / (fx - fp);
      rows.push({ n, x, fx, change: next - x });
      lines.push([
        { x: prev, y: fp },
        { x: next, y: 0 },
      ]);
      const verdict = judge(rows, next, seen, tolerance, f);
      seen.push(x);
      if (verdict) {
        outcome = verdict;
        if (verdict === 'converged') {
          root = next;
          rows.push({ n: n + 1, x: next, fx: f(next), change: 0 });
        }
        break;
      }
      [prev, x] = [x, next];
    }
  } else {
    let [a, b] = [Math.min(input.x0, input.x1 ?? input.x0), Math.max(input.x0, input.x1 ?? input.x0)];
    let [fa, fb] = [f(a), f(b)];
    steps.push(
      step(
        'rootBisection',
        `[a, b] = [${numberText(a)}, ${numberText(b)}],  f(a) = ${numberText(fa)},  f(b) = ${numberText(fb)}`,
      ),
    );
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) outcome = 'undefined';
    else if (fa === 0 || fb === 0) [outcome, root] = ['converged', fa === 0 ? a : b];
    else if (Math.sign(fa) === Math.sign(fb)) outcome = 'noSignChange';
    else {
      let last = a;
      for (let n = 0; n < max; n += 1) {
        const mid = (a + b) / 2;
        const fm = f(mid);
        rows.push({ n, x: mid, fx: fm, a, b, change: mid - last });
        lines.push([
          { x: a, y: 0 },
          { x: b, y: 0 },
        ]);
        last = mid;
        if (!Number.isFinite(fm)) {
          outcome = 'undefined';
          break;
        }
        if (fm === 0 || (b - a) / 2 < tolerance) {
          [outcome, root] = ['converged', mid];
          break;
        }
        if (Math.sign(fm) === Math.sign(fa)) [a, fa] = [mid, fm];
        else [b, fb] = [mid, fm];
      }
    }
  }

  const order = estimateOrder(rows);
  const report: Record<RootOutcome, Step> = {
    converged: step('rootConverged', root === null ? '' : `x ≈ ${numberText(root, 12)}`, {
      n: String(Math.max(0, rows.length - 1)),
      order: order === null ? '' : numberText(order, 3),
    }),
    diverged: step('rootDiverged'),
    flat: step('rootFlat'),
    cycle: step('rootCycle'),
    iterations: step('rootIterations', '', { n: String(max) }),
    noSignChange: step('rootNoSignChange'),
    undefined: step('rootUndefined'),
  };
  steps.push(report[outcome]);
  const xs = [...rows.map((r) => r.x), input.x0, input.x1 ?? input.x0].filter(
    (x) => Number.isFinite(x) && Math.abs(x) < 1e6,
  );
  let [lo, hi] = [Math.min(...xs), Math.max(...xs)];
  if (hi - lo < 1e-6) [lo, hi] = [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.25;
  return { rows, outcome, root, order, steps, graph: { f: samples(f, lo - pad, hi + pad, 300), lines } };
}

/** How the run ends after this step, or null to go on. */
function judge(
  rows: readonly RootRow[],
  next: number,
  seen: readonly number[],
  tolerance: number,
  f: (x: number) => number,
): RootOutcome | null {
  const last = rows[rows.length - 1];
  if (!Number.isFinite(next) || Math.abs(next) > 1e12) return 'diverged';
  if (
    Math.abs(next - last.x) <= tolerance * Math.max(1, Math.abs(next)) &&
    Math.abs(f(next)) < 1e-6 * Math.max(1, Math.abs(rows[0].fx))
  )
    return 'converged';
  if (seen.slice(0, -1).some((x) => Math.abs(x - next) <= 1e-9 * Math.max(1, Math.abs(x)))) return 'cycle';
  // Steps that keep growing for six in a row mean the guesses run away.
  if (rows.length >= 6) {
    const sizes = rows.slice(-6).map((r) => Math.abs(r.change));
    if (sizes.every((size, i) => i === 0 || size > sizes[i - 1] * 1.05)) return 'diverged';
  }
  return null;
}

/** q ≈ ln(e₃/e₂)/ln(e₂/e₁) from the last three changes that are not yet at rounding level. */
function estimateOrder(rows: readonly RootRow[]): number | null {
  const changes = rows.map((r) => Math.abs(r.change)).filter((c) => Number.isFinite(c) && c > 1e-14);
  if (changes.length < 3) return null;
  const [e1, e2, e3] = changes.slice(-3);
  const q = Math.log(e3 / e2) / Math.log(e2 / e1);
  return Number.isFinite(q) && q > 0 ? q : null;
}
