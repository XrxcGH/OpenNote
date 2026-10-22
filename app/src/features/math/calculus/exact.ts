// Exact values of functions at plain numbers, for the normal form: sin(pi/6) is 1/2, cos(pi/4) is sqrt(2)/2,
// arctan(1) is pi/4, ln(1) is 0, and |2 - 5| is 3. Only the values a textbook would write are folded; anything else,
// such as ln(2), stays as written. Each value is found as a number first and only recognized when it is very close.
import { build, freeNames } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { valueOf } from './numeric';

const KNOWN = new Set(['pi', 'e']);
const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
const INVERSE = new Set(['asin', 'acos', 'atan', 'acot', 'asec', 'acsc']);

const isConstant = (nodes: readonly Node[]) => nodes.every((node) => freeNames(node).every((n) => KNOWN.has(n)));

/** p/q close to the value with q at most maxDen, or null. */
export function nearRational(value: number, maxDen: number): [number, number] | null {
  for (let q = 1; q <= maxDen; q += 1) {
    const p = Math.round(value * q);
    if (Math.abs(p) < 1e9 && Math.abs(value - p / q) <= 1e-12 * Math.max(1, Math.abs(value))) return [p, q];
  }
  return null;
}

const ratio = (p: number, q: number): Node => (q === 1 ? build.num(p) : build.div(build.num(p), build.num(q)));

/** A trig value at a rational multiple of pi: a fraction, or a square root of one. */
function trigValue(arg: Node, value: number): Node | null {
  if (!nearRational(valueOf(arg) / Math.PI, 12)) return null;
  const squared = nearRational(value * value, 12);
  if (!squared) return null;
  const root = build.call('sqrt', ratio(squared[0], squared[1]));
  return value < 0 ? build.neg(root) : root;
}

/** The exact value of a function of plain numbers, or null to leave it as written. */
export function foldCall(fn: string, args: readonly Node[]): Node | null {
  if (args.length !== 1 || !isConstant(args)) return null;
  const value = valueOf(build.call(fn, ...args));
  if (!Number.isFinite(value)) return null;
  if (fn === 'abs') {
    const inner = valueOf(args[0]);
    return inner >= 0 ? args[0] : build.neg(args[0]);
  }
  const whole = Math.round(value);
  if (Math.abs(value - whole) <= 1e-12 * Math.max(1, Math.abs(value)) && Math.abs(whole) < 1e9) return build.num(whole);
  if (TRIG.has(fn)) return trigValue(args[0], value);
  if (INVERSE.has(fn)) {
    const turns = nearRational(value / Math.PI, 12);
    return turns ? build.mul(ratio(turns[0], turns[1]), build.name('pi')) : null;
  }
  if (fn === 'ln' && freeNames(args[0]).includes('e')) {
    const found = nearRational(value, 6);
    return found ? ratio(found[0], found[1]) : null;
  }
  return null;
}

const sqrtOf = (n: number) => build.call('sqrt', build.num(n));

/** Familiar constants a numeric answer may be, as trees: pi, e, square roots, logs, and their simple multiples. */
const FAMILIAR: readonly [number, () => Node][] = [
  [Math.PI, () => build.name('pi')],
  [Math.PI * Math.PI, () => build.pow(build.name('pi'), build.num(2))],
  [Math.E, () => build.name('e')],
  [1 / Math.E, () => build.pow(build.name('e'), build.num(-1))],
  [Math.E * Math.E, () => build.pow(build.name('e'), build.num(2))],
  [Math.sqrt(Math.E), () => build.call('sqrt', build.name('e'))],
  [Math.sqrt(Math.PI), () => build.call('sqrt', build.name('pi'))],
  [Math.LN2, () => build.call('ln', build.num(2))],
  [Math.log(3), () => build.call('ln', build.num(3))],
  [Math.log(5), () => build.call('ln', build.num(5))],
  ...[2, 3, 5, 6, 7].map((n): [number, () => Node] => [Math.sqrt(n), () => sqrtOf(n)]),
];

/**
 * A familiar exact value close to a number found numerically: a fraction, or a fraction times pi, e, a square root,
 * or a log. Null when nothing simple is that close, so the answer stays a decimal.
 */
export function recognize(value: number, tolerance = 1e-9): Node | null {
  if (!Number.isFinite(value)) return null;
  const near = (v: number, maxDen: number): [number, number] | null => {
    for (let q = 1; q <= maxDen; q += 1) {
      const p = Math.round(v * q);
      if (Math.abs(p) < 10_000 && Math.abs(v - p / q) <= tolerance * Math.max(1, Math.abs(v))) return [p, q];
    }
    return null;
  };
  const plain = near(value, 64);
  if (plain) return ratio(plain[0], plain[1]);
  for (const [constant, make] of FAMILIAR) {
    const times = near(value / constant, 12);
    if (times && times[0] !== 0) return build.mul(ratio(times[0], times[1]), make());
  }
  return null;
}
