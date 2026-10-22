// Numbers for the calculus tools: evaluating a tree at a point, checking an antiderivative by its slope, integrating
// numerically, and reading a decimal back as a familiar exact value (a fraction, a multiple of pi, a square root).
// Every exact answer the tools give is checked here against a number worked out another way first.
import { build, compileNode } from '../../../core/expr';
import type { Compiled, Node } from '../../../core/expr';
import { TABLE } from '../grapher/dialect';

export type Values = Readonly<Record<string, number>>;
export type Fn = (values: Values) => number;

const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  e: Math.E,
  tau: 2 * Math.PI,
  phi: 1.618033988749895,
};

/** A tree as a function of its names. A name with no value is NaN, so a slip shows as no answer rather than a wrong one. */
export function evaluator(node: Node): Fn {
  const run = compileNode<Values>(node, {
    strict: false,
    table: TABLE,
    bind: (name): Compiled<Values> =>
      Object.hasOwn(CONSTANTS, name) ? () => CONSTANTS[name] : (values) => values[name] ?? NaN,
  });
  return (values) => {
    try {
      return run(values);
    } catch {
      return NaN;
    }
  };
}

/** The value of a tree with no letters, or NaN. */
export function valueOf(node: Node): number {
  return evaluator(node)({});
}

/** Points to test at: spread out, irregular, and on both sides of zero. */
export const SAMPLE_POINTS = [0.37, 0.81, 1.23, 1.71, 2.29, 2.94, -0.43, -1.17, 3.61, 0.12, 0.05, 0.21, -0.17, -0.29];

/** Values for the other letters in a check, such as the parameter in ax^2. */
export function parameterValues(names: readonly string[], x: string): Record<string, number> {
  const values: Record<string, number> = {};
  names
    .filter((name) => name !== x && !Object.hasOwn(CONSTANTS, name))
    .forEach((name, i) => (values[name] = 1.3 + 0.4 * i));
  return values;
}

/** The slope of f at x by a fourth-order central difference. */
function slope(f: (x: number) => number, x: number): number {
  const h = 1e-4 * Math.max(1, Math.abs(x));
  return (8 * (f(x + h) - f(x - h)) - (f(x + 2 * h) - f(x - 2 * h))) / (12 * h);
}

const close = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * True when F' matches f at enough sample points: the check every antiderivative passes before it is shown. Points
 * where either side is undefined are skipped, and at least three must agree.
 */
export function slopeMatches(antiderivative: Node, integrand: Node, x: string, names: readonly string[]): boolean {
  const F = evaluator(antiderivative);
  const f = evaluator(integrand);
  const fixed = parameterValues(names, x);
  let agreed = 0;
  for (const point of SAMPLE_POINTS) {
    const at = (value: number) => F({ ...fixed, [x]: value });
    const expected = f({ ...fixed, [x]: point });
    if (!Number.isFinite(expected) || Math.abs(expected) > 1e8) continue;
    const found = slope(at, point);
    if (!Number.isFinite(found)) continue;
    if (!close(found, expected, 2e-5)) return false;
    agreed += 1;
  }
  return agreed >= 3;
}

/** True when two trees agree at the sample points (where both are defined), at least three times. */
export function sameValues(a: Node, b: Node, x: string, names: readonly string[]): boolean {
  const [f, g] = [evaluator(a), evaluator(b)];
  const fixed = parameterValues(names, x);
  let agreed = 0;
  for (const point of SAMPLE_POINTS) {
    const [u, v] = [f({ ...fixed, [x]: point }), g({ ...fixed, [x]: point })];
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    if (!close(u, v, 1e-8)) return false;
    agreed += 1;
  }
  return agreed >= 3;
}

function simpsonPart(a: number, b: number, fa: number, fm: number, fb: number): number {
  return ((b - a) / 6) * (fa + 4 * fm + fb);
}

/** Adaptive Simpson's rule over [a, b]. NaN when the integrand is undefined somewhere or the work runs out. */
export function integrateNumerically(f: (x: number) => number, a: number, b: number): number {
  let budget = 200_000;
  const run = (
    lo: number,
    hi: number,
    flo: number,
    fmid: number,
    fhi: number,
    whole: number,
    depth: number,
  ): number => {
    const mid = (lo + hi) / 2;
    const [left, right] = [(lo + mid) / 2, (mid + hi) / 2];
    const [fl, fr] = [f(left), f(right)];
    budget -= 2;
    if (!Number.isFinite(fl) || !Number.isFinite(fr) || budget < 0) return NaN;
    const a1 = simpsonPart(lo, mid, flo, fl, fmid);
    const a2 = simpsonPart(mid, hi, fmid, fr, fhi);
    if (depth > 40 || Math.abs(a1 + a2 - whole) <= 1e-12 * Math.max(1, Math.abs(whole))) return a1 + a2;
    return run(lo, mid, flo, fl, fmid, a1, depth + 1) + run(mid, hi, fmid, fr, fhi, a2, depth + 1);
  };
  if (a === b) return 0;
  // Starting from many slices keeps narrow bumps from being missed.
  const slices = 64;
  let total = 0;
  for (let i = 0; i < slices; i += 1) {
    const lo = a + ((b - a) * i) / slices;
    const hi = a + ((b - a) * (i + 1)) / slices;
    const [flo, fmid, fhi] = [f(lo), f((lo + hi) / 2), f(hi)];
    if (![flo, fmid, fhi].every(Number.isFinite)) return NaN;
    total += run(lo, hi, flo, fmid, fhi, simpsonPart(lo, hi, flo, fmid, fhi), 0);
  }
  return total;
}

/** True when f has a value everywhere on [a, b] that the check can see: no division by zero, no log of zero. */
export function definedOn(f: (x: number) => number, a: number, b: number): boolean {
  const steps = 997;
  for (let i = 0; i <= steps; i += 1) {
    const value = f(a + ((b - a) * i) / steps);
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) return false;
  }
  return true;
}

/** Six significant figures, without trailing zeros: 0.333333, 2.71828, 1.5e-7. */
export function decimalText(value: number): string {
  if (Object.is(value, -0) || Math.abs(value) < 1e-15) return '0';
  const text = value.toPrecision(6);
  if (text.includes('e')) return text.replace(/\.?0+e/, 'e').replace('e+', 'e');
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** The parts of a tree that can make it undefined: denominators, logs' insides, and the cosine under tan and sec. */
function dangers(node: Node, out: Node[] = []): Node[] {
  const { call } = build;
  if (node.type === 'binary') {
    if (node.op === '/') out.push(node.right);
    if (node.op === '^' && valueOf(node.right) < 0) out.push(node.left);
    dangers(node.left, out);
    dangers(node.right, out);
  } else if (node.type === 'unary' || node.type === 'postfix') dangers(node.arg, out);
  else if (node.type === 'call') {
    const [arg] = node.args;
    if (node.name === 'ln' || node.name === 'log') out.push(arg);
    if (node.name === 'tan' || node.name === 'sec') out.push(call('cos', arg));
    if (node.name === 'cot' || node.name === 'csc') out.push(call('sin', arg));
    node.args.forEach((one) => dangers(one, out));
  }
  return out;
}

/**
 * True when the function has a pole or a gap strictly between the ends: some denominator, log inside, or cosine
 * under tan changes sign or reaches zero there. The ends themselves are left to the limits.
 */
export function breaksInside(node: Node, x: string, a: number, b: number): boolean {
  const steps = 4000;
  return dangers(node).some((part) => {
    const f = evaluator(part);
    let previous = NaN;
    for (let i = 1; i < steps; i += 1) {
      const value = f({ [x]: a + ((b - a) * i) / steps });
      if (value === 0 || (Number.isFinite(previous) && Math.sign(value) !== Math.sign(previous))) return true;
      previous = value;
    }
    return false;
  });
}
