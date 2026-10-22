// The differential equation solver: separable and first-order linear equations, and second-order linear equations
// with constant coefficients, each worked with the steps a course shows. Every solution is also followed numerically
// (fourth-order Runge-Kutta) from the initial condition, which draws the curve, checks the worked answer, and is the
// answer when the steps cannot be finished by hand. The plot data is a slope field for a first-order equation and a
// phase plane (y against y') for a second-order one.
import { dependsOn } from '../../../core/expr';
import { antiderivative, collect, fold, polyOf } from './integrate';
import {
  SolverError,
  asFraction,
  build,
  compile,
  derive,
  isConstant,
  namesIn,
  niceNumber,
  numText,
  numberText,
  read,
  show,
  tidy,
  valueOf,
  type Node,
} from './expr';
import { solveLinear, leastSquares } from './linalg';
import { step, type Step, type XY } from './steps';

export type OdeKind = 'separable' | 'linear' | 'second';

export interface OdeInput {
  readonly kind: OdeKind;
  /** Separable: dy/dx as an expression in x and y. */
  readonly rhs?: string;
  /** First-order linear y' + P(x) y = Q(x). */
  readonly p?: string;
  readonly q?: string;
  /** Second order: a y'' + b y' + c y = g(x). */
  readonly a?: string;
  readonly b?: string;
  readonly c?: string;
  readonly g?: string;
  readonly x0: number;
  readonly y0: number;
  /** y'(x0), for a second-order equation. */
  readonly v0?: number;
  /** The x range to draw. */
  readonly from: number;
  readonly to: number;
}

export interface Arrow {
  readonly x: number;
  readonly y: number;
  /** A unit direction. */
  readonly dx: number;
  readonly dy: number;
}

export interface OdeResult {
  readonly steps: readonly Step[];
  /** y as text, such as 2 - 2·exp(-2·x), or null when only the numeric solution exists. */
  readonly solution: string | null;
  /** The worked solution as a function, or null. */
  readonly exact: ((x: number) => number) | null;
  /** The numeric solution, from `from` to `to`. */
  readonly curve: readonly XY[];
  /** The phase plot: y' against y for a second-order equation; empty for a first-order one. */
  readonly phase: readonly XY[];
  /** The slope field (x, y) or the phase-plane field (y, y'). */
  readonly field: readonly Arrow[];
}

const { mul, div, add, sub, num, call } = build;

/** One RK4 run for y' = f(x, y) as a system, both ways from x0. */
function rk4(
  f: (x: number, y: readonly number[]) => number[],
  x0: number,
  y0: readonly number[],
  from: number,
  to: number,
  count = 400,
) {
  const run = (end: number, n: number) => {
    const out: { x: number; y: number[] }[] = [{ x: x0, y: [...y0] }];
    if (end === x0 || n === 0) return out;
    const h = (end - x0) / n;
    let x = x0;
    let y = [...y0];
    for (let i = 0; i < n; i += 1) {
      const k1 = f(x, y);
      const k2 = f(
        x + h / 2,
        y.map((v, j) => v + (h / 2) * k1[j]),
      );
      const k3 = f(
        x + h / 2,
        y.map((v, j) => v + (h / 2) * k2[j]),
      );
      const k4 = f(
        x + h,
        y.map((v, j) => v + h * k3[j]),
      );
      y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      x = x0 + h * (i + 1);
      if (!y.every((v) => Number.isFinite(v) && Math.abs(v) < 1e12)) break;
      out.push({ x, y: [...y] });
    }
    return out;
  };
  const span = to - from || 1;
  const back = run(from, Math.max(0, Math.round((count * (x0 - from)) / span)))
    .slice(1)
    .reverse();
  const ahead = run(to, Math.max(0, Math.round((count * (to - x0)) / span)));
  return [...back, ...ahead];
}

/** Unit arrows on a grid over the box. */
function arrows(
  f: (x: number, y: number) => [number, number],
  box: { x0: number; x1: number; y0: number; y1: number },
  n = 15,
): Arrow[] {
  const out: Arrow[] = [];
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n; j += 1) {
      const x = box.x0 + ((box.x1 - box.x0) * (i + 0.5)) / n;
      const y = box.y0 + ((box.y1 - box.y0) * (j + 0.5)) / n;
      const [dx, dy] = f(x, y);
      // The field is drawn in the plot's own proportions, so slopes look right on screen.
      const sx = dx / (box.x1 - box.x0);
      const sy = dy / (box.y1 - box.y0);
      const length = Math.hypot(sx, sy);
      if (Number.isFinite(length) && length > 0) out.push({ x, y, dx: sx / length, dy: sy / length });
    }
  return out;
}

function boxAround(points: readonly XY[], fallback: number): { y0: number; y1: number } {
  const ys = points.map((p) => p.y).filter(Number.isFinite);
  let [y0, y1] = ys.length ? [Math.min(...ys), Math.max(...ys)] : [-fallback, fallback];
  if (y1 - y0 < 1e-9) [y0, y1] = [y0 - 1, y1 + 1];
  const pad = (y1 - y0) * 0.15;
  return { y0: y0 - pad, y1: y1 + pad };
}

/** The factors of a top-level product or quotient. */
function factors(node: Node): { node: Node; up: boolean }[] {
  if (node.type === 'binary' && node.op === '*') return [...factors(node.left), ...factors(node.right)];
  if (node.type === 'binary' && node.op === '/')
    return [...factors(node.left), ...factors(node.right).map((f) => ({ ...f, up: !f.up }))];
  if (node.type === 'unary' && node.op === '-') return [{ node: num(-1), up: true }, ...factors(node.arg)];
  return [{ node, up: true }];
}

function joinFactors(list: readonly { node: Node; up: boolean }[]): Node {
  let out: Node = num(1);
  for (const f of list) out = f.up ? mul(out, f.node) : div(out, f.node);
  return tidy(out);
}

/** Solves an equation. Throws a SolverError for input it cannot read or an equation of the wrong form. */
export function solveOde(input: OdeInput): OdeResult {
  if (!(input.to > input.from) || !Number.isFinite(input.x0) || !Number.isFinite(input.y0))
    throw new SolverError('ode-range');
  if (input.kind === 'second') return second(input);
  return input.kind === 'separable' ? separable(input) : linearFirst(input);
}

function firstOrderResult(
  input: OdeInput,
  F: (x: number, y: number) => number,
  steps: Step[],
  solution: Node | null,
): OdeResult {
  const run = rk4((x, y) => [F(x, y[0])], input.x0, [input.y0], input.from, input.to);
  const curve = run.map((p) => ({ x: p.x, y: p.y[0] }));
  let exact: ((x: number) => number) | null = null;
  let text: string | null = null;
  if (solution) {
    const fn = compile(solution, ['x']);
    // The worked answer must follow the numeric one where both exist.
    const agrees = run.every((p) => {
      const value = fn([p.x]);
      return !Number.isFinite(value) || Math.abs(value - p.y[0]) <= 1e-5 * Math.max(1, Math.abs(p.y[0]));
    });
    if (agrees) {
      exact = (x) => fn([x]);
      text = show(solution);
      steps.push(step('odeSolution', `y = ${text}`));
    } else steps.push(step('odeNumericOnly'));
  } else steps.push(step('odeNumericOnly'));
  const box = { x0: input.from, x1: input.to, ...boxAround(curve, 2) };
  return { steps, solution: text, exact, curve, phase: [], field: arrows((x, y) => [1, F(x, y)], box) };
}

function separable(input: OdeInput): OdeResult {
  const rhs = read(input.rhs ?? '');
  for (const used of namesIn(rhs)) if (used !== 'x' && used !== 'y') throw new SolverError('unknown-name', used);
  const parts = factors(rhs);
  if (parts.some((f) => dependsOn(f.node, 'x') && dependsOn(f.node, 'y'))) throw new SolverError('not-separable');
  const fx = joinFactors(parts.filter((f) => !dependsOn(f.node, 'y')));
  const yParts = parts.filter((f) => dependsOn(f.node, 'y'));
  const gy = joinFactors(yParts);
  const overG = joinFactors(yParts.map((f) => ({ ...f, up: !f.up })));
  const F2 = compile(rhs, ['x', 'y']);
  const F = (x: number, y: number) => F2([x, y]);
  const steps: Step[] = [step('odeSeparable', `dy/dx = (${show(fx)})·(${show(gy)})`)];
  steps.push(step('odeSeparate', `(${show(overG)}) dy = (${show(fx)}) dx`));
  const H = antiderivative(overG, 'y');
  const G = antiderivative(fx, 'x');
  if (!H || !G) return firstOrderResult(input, F, steps, null);
  steps.push(step('odeIntegrateBoth', `${show(H)} = ${show(G)} + C`));
  const Gx = compile(G, ['x']);
  const g0 = Gx([input.x0]);
  const C = compile(H, ['y'])([input.y0]) - g0;
  steps.push(step('odeConstant', `C = ${niceNumber(C)}`, { x0: numberText(input.x0), y0: numberText(input.y0) }));

  // Solving for y by hand: g(y) linear in y (exponential growth, Newton's cooling) or a power of y.
  let solution: Node | null = null;
  const poly = polyOf(gy, 'y');
  const shift = sub(G, num(g0));
  if (poly && [...poly.keys()].every((k) => k <= 1) && poly.has(1)) {
    const b = valueOf(fold(tidy(poly.get(1)!)));
    const a = poly.has(0) ? valueOf(fold(tidy(poly.get(0)!))) : 0;
    // y = ((b y0 + a) e^(b (G(x) - G(x0))) - a) / b
    solution = div(sub(mul(num(b * input.y0 + a), call('exp', mul(num(b), shift))), num(a)), num(b));
  } else {
    const power = powerOfY(gy);
    if (power && power.n !== 1) {
      const { k, n } = power;
      // y^(1-n) / (k (1-n)) = G(x) + C, so y = (k (1-n) (G(x) + C))^(1/(1-n)).
      const inner = mul(num(k * (1 - n)), add(G, num(C)));
      const root = 1 / (1 - n);
      solution = Number.isInteger(root) || input.y0 > 0 ? build.pow(inner, num(root)) : null;
      if (solution && n % 2 === 1 && Number.isInteger(n) && input.y0 < 0) solution = build.neg(solution);
    }
  }
  return firstOrderResult(input, F, steps, solution && tidy(solution));
}

/** g(y) = k y^n for constants k and n, found from samples, or null. */
function powerOfY(gy: Node): { k: number; n: number } | null {
  const g = compile(gy, ['y']);
  const k = g([1]);
  const n = Math.log(g([2]) / k) / Math.LN2;
  if (!Number.isFinite(k) || !Number.isFinite(n) || k === 0) return null;
  const rounded = Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : n;
  for (const y of [0.5, 1.7, 3.1])
    if (Math.abs(g([y]) - k * y ** rounded) > 1e-9 * Math.max(1, Math.abs(g([y])))) return null;
  return { k, n: rounded };
}

/** e^(c·ln|u|) is u^c; anything else stays e^(...). */
function expOf(I: Node): Node {
  const parts = factors(tidy(I));
  const logs = parts.filter((f) => f.node.type === 'call' && f.node.name === 'ln');
  if (logs.length === 1 && logs[0].up) {
    const rest = joinFactors(parts.filter((f) => f !== logs[0]));
    const log = logs[0].node as Extract<Node, { type: 'call' }>;
    const inner = log.args[0].type === 'call' && log.args[0].name === 'abs' ? log.args[0].args[0] : log.args[0];
    if (isConstant(rest)) return tidy(build.pow(inner, rest));
  }
  return call('exp', I);
}

function linearFirst(input: OdeInput): OdeResult {
  const P = read(input.p ?? '0');
  const Q = read(input.q ?? '0');
  for (const used of [...namesIn(P), ...namesIn(Q)]) if (used !== 'x') throw new SolverError('unknown-name', used);
  const [p, q] = [compile(P, ['x']), compile(Q, ['x'])];
  const F = (x: number, y: number) => q([x]) - p([x]) * y;
  const steps: Step[] = [step('odeLinear', `y' + (${show(P)})·y = ${show(Q)}`)];
  const I = antiderivative(P, 'x');
  if (!I) return firstOrderResult(input, F, steps, null);
  const mu = expOf(I);
  steps.push(step('odeFactor', `μ(x) = e^(∫ P dx) = ${show(mu)}`));
  steps.push(step('odeMultiply', `d/dx [${show(mu)}·y] = ${show(mul(mu, Q))}`));
  const G = antiderivative(tidy(mul(mu, Q)), 'x');
  if (!G) return firstOrderResult(input, F, steps, null);
  const Gn = collect(G, 'x');
  steps.push(step('odeIntegrateRight', `${show(mu)}·y = ${show(Gn)} + C`));
  const muFn = compile(mu, ['x']);
  const C = input.y0 * muFn([input.x0]) - compile(Gn, ['x'])([input.x0]);
  steps.push(step('odeConstant', `C = ${niceNumber(C)}`, { x0: numberText(input.x0), y0: numberText(input.y0) }));
  return firstOrderResult(input, F, steps, tidy(div(add(Gn, num(C)), mu)));
}

/** A function of x for the second-order solver, kept as text and as a tree. */
interface Basis {
  readonly text: string;
  readonly node: Node;
}

const basis = (text: string): Basis => ({ text, node: read(text) });

function second(input: OdeInput): OdeResult {
  const [a, b, c] = [input.a ?? '1', input.b ?? '0', input.c ?? '0'].map((one) => {
    const node = read(one);
    if (!isConstant(node)) throw new SolverError('ode-coefficients');
    return valueOf(node);
  });
  if (!Number.isFinite(a) || a === 0 || !Number.isFinite(b) || !Number.isFinite(c))
    throw new SolverError('ode-coefficients');
  const gNode = read(input.g?.trim() ? input.g : '0');
  for (const used of namesIn(gNode)) if (used !== 'x') throw new SolverError('unknown-name', used);
  const g = compile(gNode, ['x']);
  const v0 = input.v0 ?? 0;
  const lhs = `${numText(a)}·y'' + ${numText(b)}·y' + ${numText(c)}·y`.replace(/\((-?[\d./]+)\)/g, '$1');
  const steps: Step[] = [step('odeSecond', `${lhs} = ${show(gNode)}`)];
  steps.push(step('odeCharacteristic', `${niceNumber(a)}·r^2 + ${niceNumber(b)}·r + ${niceNumber(c)} = 0`));

  // The homogeneous solution from the roots of a r^2 + b r + c.
  const disc = b * b - 4 * a * c;
  const roots: { re: number; im: number; times: number }[] = [];
  let h1: Basis;
  let h2: Basis;
  const tol = 1e-12 * Math.max(1, b * b, Math.abs(4 * a * c));
  if (Math.abs(disc) <= tol) {
    const r = -b / (2 * a);
    roots.push({ re: r, im: 0, times: 2 });
    h1 = basis(`exp(${numText(r)}*x)`);
    h2 = basis(`x*exp(${numText(r)}*x)`);
    steps.push(step('odeRootRepeated', `r = ${niceNumber(r)}`));
    steps.push(step('odeHomogeneous', `y_h = (C₁ + C₂·x)·e^(${niceNumber(r)}·x)`));
  } else if (disc > 0) {
    const r1 = (-b + Math.sqrt(disc)) / (2 * a);
    const r2 = (-b - Math.sqrt(disc)) / (2 * a);
    roots.push({ re: r1, im: 0, times: 1 }, { re: r2, im: 0, times: 1 });
    h1 = basis(`exp(${numText(r1)}*x)`);
    h2 = basis(`exp(${numText(r2)}*x)`);
    steps.push(step('odeRootsReal', `r₁ = ${niceNumber(r1)}, r₂ = ${niceNumber(r2)}`));
    steps.push(step('odeHomogeneous', `y_h = C₁·e^(${niceNumber(r1)}·x) + C₂·e^(${niceNumber(r2)}·x)`));
  } else {
    const re = -b / (2 * a);
    const im = Math.sqrt(-disc) / (2 * a);
    roots.push({ re, im: Math.abs(im), times: 1 });
    const e = re === 0 ? '' : `exp(${numText(re)}*x)*`;
    h1 = basis(`${e}cos(${numText(Math.abs(im))}*x)`);
    h2 = basis(`${e}sin(${numText(Math.abs(im))}*x)`);
    steps.push(step('odeRootsComplex', `r = ${niceNumber(re)} ± ${niceNumber(Math.abs(im))}i`));
    const ePart = re === 0 ? '' : `e^(${niceNumber(re)}·x)·`;
    steps.push(
      step(
        'odeHomogeneous',
        `y_h = ${ePart}(C₁·cos(${niceNumber(Math.abs(im))}·x) + C₂·sin(${niceNumber(Math.abs(im))}·x))`,
      ),
    );
  }

  // A particular solution by undetermined coefficients.
  let particular: Node = num(0);
  const zeroForcing = isConstant(gNode) && valueOf(gNode) === 0;
  if (!zeroForcing) {
    const guess = guessFor(gNode, roots);
    if (!guess) throw new SolverError('ode-forcing');
    steps.push(
      step('odeGuess', `y_p = ${guess.map((one, i) => `A${subscript(i + 1)}·${show(one.node)}`).join(' + ')}`),
    );
    const L = guess.map((one) => {
      const [d0, d1, d2] = [one.node, derive(one.node, 'x'), derive(one.node, 'x', 2)].map((n) => compile(n, ['x']));
      return (x: number) => a * d2([x]) + b * d1([x]) + c * d0([x]);
    });
    const xs = Array.from({ length: guess.length + 4 }, (_, i) => 0.2 + 0.31 * i);
    const coefficients = leastSquares(
      xs.map((x) => L.map((fn) => fn(x))),
      xs.map((x) => g([x])),
    );
    if (!coefficients) throw new SolverError('ode-forcing');
    const fits = xs.every(
      (x) =>
        Math.abs(L.reduce((s, fn, i) => s + coefficients[i] * fn(x), 0) - g([x])) <=
        1e-7 * Math.max(1, Math.abs(g([x]))),
    );
    if (!fits) throw new SolverError('ode-forcing');
    particular = tidy(
      guess.map((one, i) => mul(read(numText(clean(coefficients[i]))), one.node)).reduce((s, t) => add(s, t)),
    );
    steps.push(step('odeParticular', `y_p = ${show(particular)}`));
  }

  // The constants from y(x0) and y'(x0).
  const [p0, p1] = [particular, derive(particular, 'x')].map((n) => compile(n, ['x'])([input.x0]));
  const hv = [h1, h2].map((h) => [compile(h.node, ['x'])([input.x0]), compile(derive(h.node, 'x'), ['x'])([input.x0])]);
  const C = solveLinear(
    [
      [hv[0][0], hv[1][0]],
      [hv[0][1], hv[1][1]],
    ],
    [input.y0 - p0, v0 - p1],
  );
  if (!C) throw new SolverError('ode-range');
  const [C1, C2] = C.map(clean);
  steps.push(
    step('odeConstants', `C₁ = ${niceNumber(C1)}, C₂ = ${niceNumber(C2)}`, {
      x0: numberText(input.x0),
      y0: numberText(input.y0),
      v0: numberText(v0),
    }),
  );
  const solution = tidy(add(add(mul(read(numText(C1)), h1.node), mul(read(numText(C2)), h2.node)), particular));

  const f = (x: number, y: readonly number[]) => [y[1], (g([x]) - b * y[1] - c * y[0]) / a];
  const run = rk4(f, input.x0, [input.y0, v0], input.from, input.to);
  const curve = run.map((p) => ({ x: p.x, y: p.y[0] }));
  const phase = run.map((p) => ({ x: p.y[0], y: p.y[1] }));
  const fn = compile(solution, ['x']);
  const agrees = run.every((p) => Math.abs(fn([p.x]) - p.y[0]) <= 1e-5 * Math.max(1, Math.abs(p.y[0])));
  const text = agrees ? show(solution) : null;
  steps.push(agrees ? step('odeSolution', `y = ${text}`) : step('odeNumericOnly'));
  const xs = phase.map((p) => p.x);
  const box = {
    x0: Math.min(...xs) - 0.5,
    x1: Math.max(...xs) + 0.5,
    ...boxAround(phase, 2),
  };
  const field = arrows((y, v) => [v, (-b * v - c * y) / a], box);
  return { steps, solution: text, exact: agrees ? (x) => fn([x]) : null, curve, phase, field };
}

/** A coefficient with rounding noise taken off, so 0.4999999999 is 1/2. */
function clean(x: number): number {
  const fraction = asFraction(x, 1000, 1e-9);
  return fraction ? fraction[0] / fraction[1] : Math.abs(x) < 1e-12 ? 0 : x;
}

const subscript = (n: number): string => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);

/**
 * The trial functions for the forcing: for each term p(x) e^(kx) cos(wx) or sin(wx), the powers of x up to p's degree
 * times the exponential and trig parts, times x^s where k ± wi is a root s times over.
 */
function guessFor(g: Node, roots: readonly { re: number; im: number; times: number }[]): Basis[] | null {
  const terms: Node[] = [];
  const split = (n: Node, sign: boolean): void => {
    if (n.type === 'binary' && (n.op === '+' || n.op === '-')) {
      split(n.left, sign);
      split(n.right, n.op === '-' ? !sign : sign);
    } else terms.push(n);
  };
  split(tidy(g), true);
  const out = new Map<string, Basis>();
  for (const term of terms) {
    let degree = 0;
    let k = 0;
    let w = 0;
    for (const f of factors(term)) {
      if (!f.up) {
        if (!isConstant(f.node)) return null;
        continue;
      }
      const n = f.node;
      if (isConstant(n)) continue;
      const poly = polyOf(n, 'x');
      if (poly) {
        degree += Math.max(...poly.keys());
        continue;
      }
      const arg =
        n.type === 'call' && n.args.length === 1
          ? n.args[0]
          : n.type === 'binary' && n.op === '^' && n.left.type === 'name' && n.left.name === 'e'
            ? n.right
            : null;
      const fn = n.type === 'call' ? n.name : 'exp';
      const lin = arg && polyOf(arg, 'x');
      if (!lin || [...lin.keys()].some((p) => p > 1) || (lin.has(0) && valueOf(fold(tidy(lin.get(0)!))) !== 0))
        return null;
      const rate = valueOf(fold(tidy(lin.get(1) ?? num(0))));
      if (fn === 'exp') k += rate;
      else if ((fn === 'sin' || fn === 'cos') && w === 0) w = Math.abs(rate);
      else if (fn === 'sinh' || fn === 'cosh') return null;
      else return null;
    }
    const s = roots
      .filter((r) => Math.abs(r.re - k) < 1e-9 && Math.abs(r.im - w) < 1e-9)
      .reduce((sum, r) => sum + r.times, 0);
    for (let j = 0; j <= degree; j += 1) {
      const power = j + s;
      const xPart = power === 0 ? '' : power === 1 ? 'x*' : `x^${power}*`;
      const ePart = k === 0 ? '' : `exp(${numText(k)}*x)*`;
      const parts =
        w === 0
          ? [`${xPart}${ePart}1`]
          : [`${xPart}${ePart}cos(${numText(w)}*x)`, `${xPart}${ePart}sin(${numText(w)}*x)`];
      for (const text of parts) {
        const tidyText = text.replace(/\*1$/, '').replace(/^1$/, '1');
        if (!out.has(tidyText)) out.set(tidyText, basis(tidyText));
      }
    }
  }
  return [...out.values()];
}
