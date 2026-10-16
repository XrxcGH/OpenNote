// Simplify and Solve for an equation written in LaTeX (Phase 10). Both run on the shared expression engine. Simplify
// tidies the expression, and gives a plain fraction when it has no letters in it. Solve finds the real values of the
// one letter that make an equation true, by looking for where its two sides meet, and says which it found. Neither
// pretends: what they cannot read or cannot find, they say so.
import { evaluateExact, formatExpression, freeNames, simplify, tryParse, fractions } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { compileExpression } from '../grapher';
import { Unsupported, latexToText, treeToLatex } from './convert';

export type ActionResult =
  { ok: true; latex: string } | { ok: false; reason: 'unsupported' | 'unchanged' | 'none' | 'letters' };

const CONSTANTS = new Set(['pi', 'e', 'tau', 'phi']);
const unsupported: ActionResult = { ok: false, reason: 'unsupported' };

/** The place of the first equals sign outside every bracket, or -1. LaTeX's own braces and \left( count as brackets. */
function topLevelEquals(latex: string): number {
  let depth = 0;
  for (let i = 0; i < latex.length; i += 1) {
    const c = latex[i];
    if (c === '\\') i += 1;
    else if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === '=' && depth === 0) return i;
  }
  return -1;
}

function parseOne(latex: string): Node | null {
  const parsed = tryParse(latexToText(latex));
  return parsed.ok ? parsed.value : null;
}

/** The two sides of an equation, or the whole expression with no right side. Null when it cannot be read. */
function parseLatex(latex: string): { left: Node; right: Node | null } | null {
  try {
    const at = topLevelEquals(latex);
    if (at < 0) {
      const left = parseOne(latex);
      return left && { left, right: null };
    }
    const [left, right] = [parseOne(latex.slice(0, at)), parseOne(latex.slice(at + 1))];
    return left && right && { left, right };
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

const letters = (...nodes: Node[]): string[] => [
  ...new Set(nodes.flatMap((node) => freeNames(node)).filter((name) => !CONSTANTS.has(name))),
];

function fractionLatex(value: fractions.Rational): string {
  const negative = fractions.sign(value) < 0;
  const magnitude = fractions.abs(value);
  const text = fractions.isInteger(magnitude)
    ? String(magnitude.n)
    : `\\frac{${String(magnitude.n)}}{${String(magnitude.d)}}`;
  return negative ? `-${text}` : text;
}

/** A constant expression as an exact fraction (or a rounded number when it is not rational), or null. */
function constantLatex(node: Node): string | null {
  try {
    const value = evaluateExact(node, { name: () => undefined });
    if (value.exact) return fractionLatex(value.value);
    return Number.isFinite(value.value) ? String(Number(value.value.toPrecision(10))) : null;
  } catch {
    return null;
  }
}

export function simplifyLatex(latex: string): ActionResult {
  const sides = parseLatex(latex);
  if (!sides) return unsupported;
  const one = (node: Node) =>
    letters(node).length === 0 ? (constantLatex(node) ?? treeToLatex(simplify(node))) : treeToLatex(simplify(node));
  const next = sides.right ? `${one(sides.left)} = ${one(sides.right)}` : one(sides.left);
  const compact = (text: string) => text.replace(/\s+/g, '');
  return compact(next) === compact(latex) ? { ok: false, reason: 'unchanged' } : { ok: true, latex: next };
}

const RANGE = 1000;
const STEPS = 20_000;
const TOLERANCE = 1e-7;

/** The values of x where `f` crosses or touches zero between -RANGE and RANGE, smallest first. */
function roots(f: (x: number) => number): number[] {
  const found: number[] = [];
  const add = (x: number) => {
    if (!found.some((other) => Math.abs(other - x) < 1e-6)) found.push(x);
  };
  const step = (2 * RANGE) / STEPS;
  let previousX = -RANGE;
  let previous = f(previousX);
  let beforePrevious = NaN;
  for (let i = 1; i <= STEPS; i += 1) {
    const x = -RANGE + i * step;
    const value = f(x);
    if (Number.isFinite(previous) && Number.isFinite(value)) {
      if (previous === 0) add(previousX);
      else if (previous * value < 0) {
        let [low, high] = [previousX, x];
        for (let k = 0; k < 80; k += 1) {
          const mid = (low + high) / 2;
          if (f(mid) * f(low) <= 0) high = mid;
          else low = mid;
        }
        const at = (low + high) / 2;
        // A jump across a gap in the function, such as 1/x at 0, is not a root.
        if (Math.abs(f(at)) < 1e-6 * (1 + Math.abs(previous) + Math.abs(value))) add(at);
      } else if (
        Number.isFinite(beforePrevious) &&
        Math.abs(previous) < Math.abs(beforePrevious) &&
        Math.abs(previous) <= Math.abs(value) &&
        Math.abs(previous) < 1e-4
      ) {
        // The curve touches zero without crossing, as (x - 1)^2 does.
        let [low, high] = [previousX - step, x];
        for (let k = 0; k < 100; k += 1) {
          const a = low + (high - low) / 3;
          const b = high - (high - low) / 3;
          if (Math.abs(f(a)) < Math.abs(f(b))) high = b;
          else low = a;
        }
        const at = (low + high) / 2;
        if (Math.abs(f(at)) < TOLERANCE) add(at);
      }
    }
    beforePrevious = previous;
    previousX = x;
    previous = value;
  }
  return found.sort((a, b) => a - b);
}

/** A root as LaTeX: a whole number, a small fraction, or a number to six digits. */
function rootLatex(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-7) return String(rounded === 0 ? 0 : rounded);
  for (let q = 2; q <= 12; q += 1) {
    const p = Math.round(value * q);
    if (Math.abs(value - p / q) < 1e-7) return `${p < 0 ? '-' : ''}\\frac{${Math.abs(p)}}{${q}}`;
  }
  return String(Number(value.toPrecision(6)));
}

export function solveLatex(latex: string): ActionResult {
  const sides = parseLatex(latex);
  if (!sides) return unsupported;
  const names = letters(sides.left, ...(sides.right ? [sides.right] : []));
  if (names.length !== 1) return { ok: false, reason: 'letters' };
  const [name] = names;
  const source = (node: Node) =>
    formatExpression(node).replace(new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`, 'g'), 'x');
  const text = sides.right ? `(${source(sides.left)})-(${source(sides.right)})` : source(sides.left);
  const compiled = compileExpression(text);
  if (!compiled.ok) return unsupported;
  const found = roots((x) => compiled.expression.evaluate(x));
  if (found.length === 0) return { ok: false, reason: 'none' };
  const answer = found.map((value) => `${name} = ${rootLatex(value)}`).join(',\\ ');
  return { ok: true, latex: `${latex.trim()} \\quad\\Rightarrow\\quad ${answer}` };
}
