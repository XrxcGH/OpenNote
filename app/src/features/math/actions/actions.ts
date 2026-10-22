// Simplify and Solve for an equation written in LaTeX (Phase 10). Both run on the shared expression engine. Simplify
// tidies the expression, and gives a plain fraction when it has no letters in it. Solve finds the real values of the
// one letter that make an equation true, by looking for where its two sides meet, and says which it found. Neither
// pretends: what they cannot read or cannot find, they say so.
import {
  evaluateExact,
  findRoots,
  formatExpression,
  freeNames,
  simplify,
  tryParse,
  fractions,
} from '../../../core/expr';
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
  const found = findRoots((x) => compiled.expression.evaluate(x));
  if (found.length === 0) return { ok: false, reason: 'none' };
  const answer = found.map((value) => `${name} = ${rootLatex(value)}`).join(',\\ ');
  return { ok: true, latex: `${latex.trim()} \\quad\\Rightarrow\\quad ${answer}` };
}

/** A root as plain text: a whole number, a small fraction, or a number to six digits. */
function rootText(value: number): string {
  return rootLatex(value).replace(/\\frac\{(\d+)\}\{(\d+)\}/, '$1/$2');
}

/**
 * The short answer shown beside an equation as it is written: "x = 4" for an equation in one letter, or "= 5/6" for
 * an expression with no letters. Null when there is nothing to show, so writing never brings up noise.
 */
export function liveAnswer(latex: string): string | null {
  if (latex.trim() === '' || latex.length > 2000) return null;
  const sides = parseLatex(latex);
  if (!sides) return null;
  const nodes = sides.right ? [sides.left, sides.right] : [sides.left];
  const names = letters(...nodes);
  if (names.length === 0) {
    if (sides.right) return null;
    const value = constantLatex(sides.left);
    if (value === null) return null;
    const text = value.replace(/^(-?)\\frac\{(\d+)\}\{(\d+)\}$/, '$1$2/$3');
    const compact = (s: string) => s.replace(/\s+/g, '');
    return compact(text) === compact(latex) ? null : `= ${text}`;
  }
  if (!sides.right || names.length !== 1) return null;
  const [name] = names;
  const source = (node: Node) =>
    formatExpression(node).replace(new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`, 'g'), 'x');
  const compiled = compileExpression(`(${source(sides.left)})-(${source(sides.right)})`);
  if (!compiled.ok) return null;
  const found = findRoots((x) => compiled.expression.evaluate(x), { steps: 4000, limit: 4 });
  if (found.length === 0) return null;
  return found.map((value) => `${name} = ${rootText(value)}`).join(', ');
}

/** What an equation graphs as: the text of a graph block, and whether it draws in 3D. */
export interface EquationGraph {
  source: string;
  three: boolean;
}

/** The text of an expression with one letter renamed to x, as the grapher reads it. */
function asX(node: Node, name: string): string {
  const text = formatExpression(node);
  return name === 'x' ? text : text.replace(new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`, 'g'), 'x');
}

const isName = (node: Node, name: string) => node.type === 'name' && node.name === name;

/**
 * The graph of an equation, or null when it has nothing to draw. y = f(x) and an expression in x draw in 2D;
 * z = f(x, y) and an expression in x and y draw in 3D. An equation in one letter, such as 2x + 3 = 11, draws both
 * sides, so the answer is where they cross. Other letters become sliders.
 */
export function graphOfLatex(latex: string): EquationGraph | null {
  if (latex.trim() === '' || latex.length > 2000) return null;
  const at = topLevelEquals(latex);
  const head = at < 0 ? '' : latex.slice(0, at).trim();
  // f(x) = ... draws as y = ...
  if (/^[A-Za-z]\s*(?:\\left)?\(\s*x\s*(?:\\right)?\)$/.test(head)) return graphOfLatex(`y = ${latex.slice(at + 1)}`);
  const sides = parseLatex(latex);
  if (!sides) return null;
  const { left, right } = sides;
  const lettersOf = (node: Node) => letters(node);
  const plain = (node: Node) => formatExpression(node);
  if (right) {
    if (isName(left, 'y') && !lettersOf(right).includes('y')) {
      return { source: `y = ${plain(right)}`, three: false };
    }
    if (isName(left, 'z') && !lettersOf(right).includes('z')) {
      return { source: `z = ${plain(right)}`, three: true };
    }
    const all = letters(left, right);
    if (all.length === 1) {
      const [name] = all;
      return { source: `y = ${asX(left, name)}\ny = ${asX(right, name)}`, three: false };
    }
    return null;
  }
  const all = lettersOf(left);
  if (all.includes('x') && all.includes('y')) return { source: `z = ${plain(left)}`, three: true };
  if (all.includes('x')) return { source: `y = ${plain(left)}`, three: false };
  if (all.length === 1) return { source: `y = ${asX(left, all[0])}`, three: false };
  return null;
}
