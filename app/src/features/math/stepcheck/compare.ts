// Comparing one line with the line before it: two values (expressions, antiderivatives, numbers, quantities,
// matrices), two equations (same solutions), two sets of inequalities (same solution set), and a line against the
// equations of a system. Symbolic first where it can decide; seeded sample points otherwise, and it says so. A step
// is only 'broken' with clear evidence; everything else that is not shown to be right is 'unchecked'.
import { build, formatExpression } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { expand, norm, TooLarge, toNode } from '../calculus/algebra';
import { derivativeOf } from '../calculus/derivative';
import { recognize } from '../calculus/exact';
import { decimalText, evaluator } from '../calculus/numeric';
import { textOf } from '../calculus/print';
import { solveQuestion } from '../calculus/solve';
import { matrixText, type Matrix } from './matrix';
import { variables, type Atom, type Scalar, type Value } from './read';
import { compareAt, numbersCompare, rng, samplePoint, zeroAt, zeros, type Fn, type Values } from './sample';
import { flip, type Rel } from './text';
import type { Method, ReasonCode, Verdict } from './types';
import { amount, formatQuantity } from '../../../core/expr';

export interface Outcome {
  verdict: Verdict;
  reason: ReasonCode;
  params: Record<string, string>;
  suggestion?: string;
  method: Method;
  confidence: number;
}

export const outcome = (
  verdict: Verdict,
  reason: ReasonCode,
  method: Method,
  confidence: number,
  params: Record<string, string> = {},
  suggestion?: string,
): Outcome => ({ verdict, reason, method, confidence, params, ...(suggestion ? { suggestion } : {}) });

const cannot = (reason: ReasonCode = 'cannotDecide', params: Record<string, string> = {}) =>
  outcome('unchecked', reason, 'none', 0, params);

// Text for the explanations ---------------------------------------------------------------------------------------

/** A number as a familiar exact value when there is one (1/3, 2pi, sqrt(2)), or else six figures. */
export function numberText(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e12) return String(value);
  const exact = recognize(value);
  return exact ? textOf(exact) : decimalText(value);
}

function pointText(point: Values | undefined): string {
  if (!point) return '';
  return Object.entries(point)
    .map(([name, value]) => `${name} = ${numberText(Math.round(value * 1e4) / 1e4)}`)
    .join(', ');
}

const nodeText = (node: Node): string => {
  try {
    return textOf(node);
  } catch {
    return formatExpression(node);
  }
};

// Symbolic ----------------------------------------------------------------------------------------------------------

/** True when a - b multiplies out to 0. False when it does not, or when the forms are too large to multiply out. */
export function symbolicSame(a: Node, b: Node): boolean {
  try {
    return formatExpression(toNode(expand(norm(build.sub(a, b))))) === '0';
  } catch (error) {
    if (error instanceof TooLarge || error instanceof RangeError) return false;
    return false;
  }
}

export const fn = (node: Node): Fn => evaluator(node);

/** The letters people write for a constant of integration. */
const CONSTANT_NAMES = new Set(['C', 'c', 'K', 'k']);

// Values ------------------------------------------------------------------------------------------------------------

/** The slope of a line in x, with each integral's slope its body times d(variable)/dx. */
function slope(s: Scalar, x: string): Node {
  let d = derivativeOf(s.node, x);
  for (const integral of s.integrals) {
    const outer = derivativeOf(s.node, integral.name);
    const inner = derivativeOf(integral.inner, x);
    d = build.add(d, build.mul(build.mul(outer, integral.body), inner));
  }
  return d;
}

function antiderivativeAnswer(a: Scalar): string | undefined {
  if (a.integrals.length !== 1 || a.origin !== 'integral') return undefined;
  const [integral] = a.integrals;
  if (integral.inner.type !== 'name') return undefined;
  const solved = solveQuestion({ kind: 'integral', body: integral.body, x: integral.inner.name });
  if (!solved.ok) return undefined;
  // The solver's answer may already end in + C.
  const { text } = solved.answer;
  return /\bC\b/.test(text) ? `= ${text}` : `= ${text} + C`;
}

function compareAntiderivatives(a: Scalar, b: Scalar, x: string, seed: number): Outcome {
  let da: Node;
  let db: Node;
  try {
    [da, db] = [slope(a, x), slope(b, x)];
  } catch {
    return cannot('cannotEvaluate');
  }
  const names = [...new Set([...variables(da), ...variables(db)])];
  const found = compareAt(fn(da), fn(db), names, seed);
  if (found.result === 'same') {
    const confidence = symbolicSame(da, db) ? 1 : 0.97;
    // The integral sign is gone and no + C came with it: right, but the constant belongs there.
    const done = (a.integrals.length > 0 || a.origin === 'integral') && b.integrals.length === 0;
    const constant = variables(b.node).some((name) => CONSTANT_NAMES.has(name));
    if (done && !constant) return outcome('ok', 'missingConstant', 'derivative', confidence, {}, `= ${b.text} + C`);
    return outcome('ok', 'antiderivative', 'derivative', confidence);
  }
  if (found.result === 'different') {
    return outcome('broken', 'antiderivativeOff', 'derivative', 0.97, { slope: nodeText(db) }, antiderivativeAnswer(a));
  }
  if (found.result === 'mixed') return cannot('someValues', { at: pointText(found.at) });
  return cannot('cannotEvaluate');
}

function scalarSuggestion(a: Scalar): string | undefined {
  if (a.answer) return `= ${a.answer}`;
  if (variables(a.node).length === 0) {
    const value = fn(a.node)({});
    return Number.isFinite(value) ? `= ${numberText(value)}` : undefined;
  }
  try {
    const expanded = toNode(expand(norm(a.node)));
    const text = nodeText(expanded);
    return text.length <= 120 ? `= ${text}` : undefined;
  } catch {
    return undefined;
  }
}

/** The decimal places a side is written to, as in 1.414 (3), or null when it is not a decimal. */
function placesOf(text: string): number | null {
  const found = /^[+-]?\d*\.(\d+)$/.exec(text.replace(/\s+/g, ''));
  return found ? found[1].length : null;
}

/** True when `shown` is `exact` rounded, or cut short, to the places it is written to. */
function roundsTo(exact: number, shown: number, places: number): boolean {
  if (!Number.isFinite(exact) || !Number.isFinite(shown)) return false;
  const unit = 10 ** -places;
  const slack = 1e-9 * Math.max(1, Math.abs(exact));
  if (Math.abs(exact - shown) <= unit / 2 + slack) return true;
  return Math.abs(exact - shown) < unit && Math.abs(Math.trunc(exact / unit) * unit - shown) <= slack + unit * 1e-6;
}

/** True when a side is written with a decimal number in it, such as 9.81 × 2. */
const hasDecimal = (text: string) => /\d\.\d/.test(text);

/** sqrt(2) = 1.414: the same value, rounded to the places shown. Null when neither side is a decimal that fits. */
function rounded(a: Scalar, b: Scalar): Outcome | null {
  const [va, vb] = [fn(a.node)({}), fn(b.node)({})];
  for (const [exact, shown, text] of [
    [va, vb, b.text],
    [vb, va, a.text],
  ] as const) {
    const places = placesOf(text);
    if (places !== null && roundsTo(exact, shown, places)) {
      return outcome('ok', 'rounded', 'evaluation', 0.99, { places: String(places) });
    }
  }
  // 9.81 × 2 = 20: decimal working rounded to a whole number. Only when the other side has decimals, so 7/2 = 3 is
  // still a slip, and only rounded, never cut short.
  for (const [exact, shown, text, other] of [
    [va, vb, b.text, a.text],
    [vb, va, a.text, b.text],
  ] as const) {
    const whole = /^[+-]?\d+$/.test(text.replace(/\s+/g, '')) && hasDecimal(other);
    if (whole && Number.isFinite(exact) && Math.abs(exact - shown) <= 0.5 + 1e-9 * Math.max(1, Math.abs(exact))) {
      return outcome('ok', 'rounded', 'evaluation', 0.95, { places: '0' });
    }
  }
  return null;
}

function compareScalars(a: Scalar, b: Scalar, seed: number): Outcome {
  const names = [...new Set([...variables(a.node), ...variables(b.node)])];
  const plain = names.length === 0;
  const found = compareAt(fn(a.node), fn(b.node), names, seed);
  if (plain && found.result !== 'same') {
    const near = rounded(a, b);
    if (near) return near;
  }
  // The numbers decide first: the tidy forms take sqrt(x^2) as x, which is only so for x >= 0.
  if (found.result === 'same') {
    if (plain) return outcome('ok', 'sameValue', 'evaluation', 0.995);
    return symbolicSame(a.node, b.node)
      ? outcome('ok', 'equivalent', 'symbolic', 1)
      : outcome('ok', 'sampleConsistent', 'numeric', 0.97);
  }
  if (found.result === 'mixed') return cannot('someValues', { at: pointText(found.at) });
  if (found.result !== 'different') return cannot('cannotEvaluate');
  const method: Method = plain ? 'evaluation' : 'numeric';
  const suggestion = scalarSuggestion(a);
  if (a.origin === 'derivative') return outcome('broken', 'derivativeOff', method, 0.97, {}, suggestion);
  if (plain) {
    const value = fn(a.node)({});
    // 9.81 × 2 works out to 19.62, not 981/50: decimal working gets a decimal answer.
    const text = hasDecimal(a.text) || hasDecimal(b.text) ? decimalText(value) : numberText(value);
    const decimal = !a.answer && text !== numberText(value) ? `= ${text}` : suggestion;
    return outcome('broken', 'valueOff', method, 0.99, { value: text }, decimal);
  }
  if (found.ratio !== undefined && numbersCompare(found.ratio, -1) === 'same') {
    return outcome('broken', 'signFlipped', method, 0.97, {}, suggestion);
  }
  if (found.ratio !== undefined && Math.abs(found.ratio) > 1e-6) {
    return outcome('broken', 'factorOff', method, 0.97, { factor: numberText(found.ratio) }, suggestion);
  }
  if (found.offset !== undefined) {
    return outcome('broken', 'constantOff', method, 0.97, { offset: numberText(found.offset) }, suggestion);
  }
  const [left, right] = found.values ?? [NaN, NaN];
  const params = { at: pointText(found.at), left: numberText(left), right: numberText(right) };
  return outcome('broken', 'notEqual', method, 0.97, params, suggestion);
}

const sameShape = (a: Matrix, b: Matrix) => a.length === b.length && a[0].length === b[0].length;
const asRow = (m: Matrix): Matrix => (m[0].length === 1 && m.length > 1 ? [m.map((row) => row[0])] : m);

function compareMatrices(a: Matrix, b: Matrix): Outcome {
  const [x, y] = [asRow(a), asRow(b)];
  if (!sameShape(x, y)) {
    return outcome('broken', 'matrixShape', 'matrix', 0.99, {
      rows: String(x.length),
      columns: String(x[0].length),
    });
  }
  for (let i = 0; i < x.length; i += 1) {
    for (let j = 0; j < x[i].length; j += 1) {
      const how = numbersCompare(x[i][j], y[i][j]);
      if (how === 'unsure') return cannot('cannotDecide');
      if (how === 'different') {
        const params = { row: String(i + 1), column: String(j + 1), value: numberText(x[i][j]) };
        return outcome('broken', 'matrixEntry', 'matrix', 0.99, params, `= ${matrixText(x)}`);
      }
    }
  }
  return outcome('ok', 'sameMatrix', 'matrix', 1);
}

export interface ChainState {
  /** True once a line of the chain had an indefinite integral: values then compare by their slopes. */
  anti: boolean;
  base: string;
}

/** Compares two values in a chain of equal values. `a` is the earlier one. */
export function compareValues(a: Value, b: Value, chain: ChainState, seed: number): Outcome {
  if (b.kind === 'invalid') return outcome('broken', b.reason, b.reason === 'matrixShape' ? 'matrix' : 'units', 0.99);
  if (a.kind === 'invalid' || a.kind === 'unknown') return cannot(a.reason);
  if (b.kind === 'unknown') return cannot(b.reason);
  if (a.kind === 'infinite' || b.kind === 'infinite') {
    if (a.kind === 'infinite' && b.kind === 'infinite') {
      return a.sign === b.sign
        ? outcome('ok', 'sameValue', 'evaluation', 0.99)
        : outcome('broken', 'valueOff', 'evaluation', 0.99, { value: a.sign > 0 ? '∞' : '-∞' });
    }
    const other = a.kind === 'infinite' ? b : a;
    if (other.kind === 'scalar' && variables(other.node).length === 0 && Number.isFinite(fn(other.node)({}))) {
      const value = a.kind === 'infinite' ? (a.sign > 0 ? '∞' : '-∞') : numberText(fn((a as Scalar).node)({}));
      return outcome('broken', 'valueOff', 'evaluation', 0.95, { value }, `= ${value}`);
    }
    return cannot();
  }
  if (a.kind === 'matrix' && b.kind === 'matrix') return compareMatrices(a.m, b.m);
  if (a.kind === 'quantity' && b.kind === 'quantity') {
    if (a.q.dim.some((d, i) => d !== b.q.dim[i])) return outcome('broken', 'unitKind', 'units', 0.99);
    const how = numbersCompare(a.q.si, b.q.si);
    if (how === 'same') return outcome('ok', 'sameQuantity', 'units', 0.99);
    if (how === 'unsure') return cannot();
    const shown = b.q.display ? { ...a.q, display: b.q.display } : a.q;
    const value = formatQuantity(shown);
    return outcome('broken', 'unitValue', 'units', 0.99, { value }, `= ${value}`);
  }
  if (a.kind === 'quantity' || b.kind === 'quantity') {
    const quantity = a.kind === 'quantity' ? a : b.kind === 'quantity' ? b : null;
    const other = quantity === a ? b : a;
    if (!quantity) return cannot();
    const { q } = quantity;
    if (other.kind !== 'scalar' || variables(other.node).length > 0 || q.dim.some((d) => d !== 0)) return cannot();
    const how = numbersCompare(amount(q), fn(other.node)({}));
    return how === 'same' ? outcome('ok', 'sameQuantity', 'units', 0.99) : cannot();
  }
  if (a.kind !== 'scalar' || b.kind !== 'scalar') return cannot();
  if (chain.anti || a.integrals.length > 0 || b.integrals.length > 0) {
    const base = a.integrals[0]?.base ?? b.integrals[0]?.base ?? chain.base;
    return compareAntiderivatives(a, b, base, seed);
  }
  const found = compareScalars(a, b, seed);
  if (found.verdict !== 'broken' || (!a.alt && !b.alt)) return found;
  // 1/2x, then = 1/(2x): right when the slash is read the other way, so the line is not shown as a slip.
  const readings: [Node, Node][] = [
    [a.alt ?? a.node, b.node],
    [a.node, b.alt ?? b.node],
    [a.alt ?? a.node, b.alt ?? b.node],
  ];
  for (const [x, y] of readings) {
    const again = compareScalars({ ...a, node: x }, { ...b, node: y }, seed);
    if (again.verdict === 'ok') return again;
  }
  return cannot('ambiguous', { text: a.alt ? a.text : b.text });
}

// Equations ---------------------------------------------------------------------------------------------------------

export interface Equation {
  /** Zero exactly where the equation holds: left - right, or a product of them for "x = 1 or x = 2". */
  f: Fn;
  /** The size of the sides there, for tolerances. */
  scale: Fn;
  node: Node;
  names: string[];
}

const difference = (atom: Atom): Node => build.sub(atom.left.node, atom.right.node);

export function equationOf(groups: Atom[][]): Equation | null {
  const single = groups.every((g) => g.length === 1 && g[0].rel === '=');
  if (!single || groups.some((g) => g[0].left.integrals.length + g[0].right.integrals.length > 0)) return null;
  const atoms = groups.map((g) => g[0]);
  const node = atoms.map(difference).reduce((product, next) => build.mul(product, next));
  const fs = atoms.map((atom) => [fn(atom.left.node), fn(atom.right.node)] as const);
  const f = fn(node);
  const scale: Fn = (p) => fs.reduce((size, [l, r]) => size * (1 + Math.abs(l(p)) + Math.abs(r(p))), 1);
  return { f, scale, node, names: variables(node) };
}

/** The ratio of two functions when it is the same nonzero number at every usable sample point, or null. */
function steadyRatio(a: Fn, b: Fn, names: readonly string[], seed: number): number | null {
  if (names.length === 0) return null;
  const next = rng(seed + 3);
  const ratios: number[] = [];
  for (let tries = 0; tries < 120 && ratios.length < 16; tries += 1) {
    const p = samplePoint(names, next);
    const [x, y] = [a(p), b(p)];
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) < 1e-9 || Math.abs(x) < 1e-9) continue;
    ratios.push(x / y);
  }
  if (ratios.length < 6) return null;
  const first = ratios[0];
  return ratios.every((r) => Math.abs(r - first) <= 1e-6 * Math.max(1, Math.abs(first))) ? first : null;
}

export function sameEquation(a: Equation, b: Equation, seed: number): boolean {
  const names = [...new Set([...a.names, ...b.names])];
  return steadyRatio(a.f, b.f, names, seed) !== null;
}

/** The additive terms of a tree, each with its sign, for "the sign of 3 changed". */
function terms(node: Node, sign = 1, out: { node: Node; sign: number }[] = []): { node: Node; sign: number }[] {
  if (node.type === 'binary' && (node.op === '+' || node.op === '-')) {
    terms(node.left, sign, out);
    terms(node.right, node.op === '-' ? -sign : sign, out);
  } else if (node.type === 'unary' && node.op === '-') terms(node.arg, -sign, out);
  else out.push({ node, sign });
  return out;
}

const sumOf = (list: { node: Node; sign: number }[]): Node =>
  list.length === 0
    ? build.num(0)
    : list
        .map((t) => (t.sign < 0 ? build.neg(t.node) : t.node))
        .reduce((total, next) =>
          next.type === 'unary' && next.op === '-' ? build.sub(total, next.arg) : build.add(total, next),
        );

/** The sign slip of moving a term, as a broken outcome with the corrected line, or null when there is none. */
export function signSlipOutcome(prev: Equation, atom: Atom, seed: number): Outcome | null {
  const slip = signSlip(prev, atom, seed);
  return slip ? outcome('broken', 'signMoved', 'solutions', 0.97, { term: slip.term }, slip.line) : null;
}

/** A term whose sign, turned around, makes the new equation match the old one: the sign slip of moving a term. */
function signSlip(prev: Equation, atom: Atom, seed: number): { term: string; line: string } | null {
  const sides = [terms(atom.left.node), terms(atom.right.node)];
  for (let side = 0; side < 2; side += 1) {
    for (let k = 0; k < sides[side].length && k < 12; k += 1) {
      const changed = sides.map((list, s) =>
        s === side ? list.map((t, i) => (i === k ? { ...t, sign: -t.sign } : t)) : list,
      );
      const [left, right] = changed.map(sumOf);
      const node = build.sub(left, right);
      const names = [...new Set([...prev.names, ...variables(node)])];
      if (steadyRatio(prev.f, fn(node), names, seed) !== null) {
        return { term: nodeText(sides[side][k].node), line: `${nodeText(left)} = ${nodeText(right)}` };
      }
    }
  }
  return null;
}

function equationSuggestion(prev: Equation, groups: Atom[][], seed: number): string | undefined {
  if (prev.names.length !== 1) return undefined;
  const [x] = prev.names;
  const roots = zeros(prev.f, prev.names, seed).map((p) => p[x]);
  if (roots.length === 0 || roots.length > 4) return undefined;
  const atom = groups[0][0];
  const isBare = atom.left.node.type === 'name' && atom.left.node.name === x;
  if (isBare) return roots.map((r) => `${x} = ${numberText(r)}`).join(' or ');
  if (roots.length !== 1 || groups.length !== 1) return undefined;
  const at = { [x]: roots[0] };
  if (variables(atom.right.node).length === 0) {
    return `${nodeText(atom.left.node)} = ${numberText(fn(atom.left.node)(at))}`;
  }
  if (variables(atom.left.node).length === 0) {
    return `${numberText(fn(atom.right.node)(at))} = ${nodeText(atom.right.node)}`;
  }
  return undefined;
}

/**
 * x = 7/3, then x = 2.33: every solution of the line before, rounded to the places shown, and as many of them. Null
 * when the line is not answers written as decimals.
 */
function roundedSolutions(prev: Equation, groups: Atom[][], seed: number): Outcome | null {
  if (prev.names.length !== 1) return null;
  const [x] = prev.names;
  const shown: { value: number; places: number }[] = [];
  for (const g of groups) {
    if (g.length !== 1 || g[0].rel !== '=') return null;
    const [atom] = g;
    const [name, value] =
      atom.left.node.type === 'name' ? [atom.left.node.name, atom.right] : [nameOf(atom.right.node), atom.left];
    const places = placesOf(value.text);
    if (name !== x || places === null || variables(value.node).length > 0) return null;
    shown.push({ value: fn(value.node)({}), places });
  }
  const roots = zeros(prev.f, prev.names, seed).map((p) => p[x]);
  if (roots.length === 0 || roots.length !== shown.length) return null;
  const all = roots.every((root) => shown.some((s) => roundsTo(root, s.value, s.places)));
  return all ? outcome('ok', 'rounded', 'solutions', 0.95, { places: String(shown[0].places) }) : null;
}

const nameOf = (node: Node): string | null => (node.type === 'name' ? node.name : null);

/** x = 3 on a line of its own: the letter and its value, else null. */
export function rootOf(groups: Atom[][]): { name: string; value: Node } | null {
  if (groups.length !== 1 || groups[0].length !== 1) return null;
  return atomRoot(groups[0][0]);
}

function atomRoot({ left, rel, right }: Atom): { name: string; value: Node } | null {
  if (rel !== '=') return null;
  const [name, side] = left.node.type === 'name' ? [left.node.name, right] : [nameOf(right.node), left];
  if (name === null || variables(side.node).length > 0 || !Number.isFinite(fn(side.node)({}))) return null;
  return { name, value: side.node };
}

/** x = 2, y = 3 (or x = 2 and y = 3): every letter the line gives a value, or null when it does anything else. */
export function rootsOf(groups: Atom[][]): { name: string; value: Node }[] | null {
  if (groups.length !== 1 || groups[0].length === 0) return null;
  const roots = groups[0].map(atomRoot);
  return roots.every((root) => root !== null) ? (roots as { name: string; value: Node }[]) : null;
}

/** The real solutions of an equation in one unknown, at most ten. */
export function solutionsOf(eq: Equation, seed: number): number[] {
  return eq.names.length === 1 ? zeros(eq.f, eq.names, seed).map((p) => p[eq.names[0]]) : [];
}

/** True when the value is a solution of the equation. */
export const solves = (eq: Equation, name: string, value: number): boolean =>
  zeroAt(eq.f, eq.scale, { [name]: value }) === 'yes';

/**
 * 2x + 3, then = 7: an expression in letters no line gave, then a number. Unchecked with a value that makes it true
 * (x = 2), since the line may be the start of solving it; null when no value does, as for x^2 + 1 then = 0.
 */
export function someValues(a: Scalar, b: Scalar, seed: number): Outcome | null {
  const eq = equationOf([[{ left: a, rel: '=', right: b }]]);
  if (!eq || eq.names.length === 0) return null;
  const [point] = zeros(eq.f, eq.names, seed);
  return point ? cannot('someValues', { at: pointText(point) }) : null;
}

/** Compares two equations by their solutions. */
export function compareEquations(prev: Equation, cur: Equation, groups: Atom[][], seed: number): Outcome {
  const names = [...new Set([...prev.names, ...cur.names])];
  if (names.length === 0) return cannot();
  const ratio = steadyRatio(prev.f, cur.f, names, seed);
  if (ratio !== null) {
    const exact = recognize(ratio);
    const symbolic = exact !== null && symbolicSame(prev.node, build.mul(exact, cur.node));
    return outcome('ok', 'sameSolutions', symbolic ? 'symbolic' : 'numeric', symbolic ? 1 : 0.97);
  }
  const near = roundedSolutions(prev, groups, seed);
  if (near) return near;
  const s0 = zeros(prev.f, names, seed);
  const s1 = zeros(cur.f, names, seed + 1);
  if (s0.length === 0 && s1.length === 0) return cannot('noRealSolutions');
  const forward = s0.map((p) => zeroAt(cur.f, cur.scale, p));
  const backward = s1.map((p) => zeroAt(prev.f, prev.scale, p));
  const keeps = forward.every((z) => z === 'yes');
  const loses = forward.findIndex((z) => z === 'no');
  const adds = backward.findIndex((z) => z === 'no');
  const comesBack = backward.every((z) => z === 'yes');
  if (keeps && comesBack && s0.length > 0) return outcome('ok', 'sameSolutions', 'solutions', 0.95);
  if (keeps && adds >= 0 && s0.length > 0) {
    return outcome('ok', 'addsSolutions', 'solutions', 0.9, { at: pointText(s1[adds]) });
  }
  if (loses >= 0 && comesBack && s1.length > 0) return cannot('lostSolutions', { at: pointText(s0[loses]) });
  // x = (2 ± sqrt(4 - 32))/2 after x^2 - 2x - 8 = 0: the line before has real solutions and this one has no real
  // value anywhere, so no solution at all.
  if (s0.length > 0 && s1.length === 0 && nowhereReal(cur.f, names, seed)) {
    return outcome(
      'broken',
      'notAtSolution',
      'solutions',
      0.95,
      { at: pointText(s0[0]) },
      equationSuggestion(prev, groups, seed),
    );
  }
  // 2x = 0 after ln(2x) = 0: this line's solutions are where the line before has no value, and it lost the real one.
  const outside = (p: Values) => !Number.isFinite(prev.f(p));
  const undefinedThere = s1.length > 0 && backward.every((z, i) => z === 'no' || outside(s1[i]));
  if (loses >= 0 && undefinedThere && s1.some(outside)) {
    const suggestion = equationSuggestion(prev, groups, seed);
    return outcome(
      'broken',
      'differentSolutions',
      'solutions',
      0.95,
      { at: pointText(s1.find(outside) ?? s1[0]) },
      suggestion,
    );
  }
  if (loses >= 0 && (adds >= 0 || s1.length === 0)) {
    const groupsAtom = groups[0]?.[0];
    const slip = groups.length === 1 && groups[0].length === 1 && groupsAtom ? signSlip(prev, groupsAtom, seed) : null;
    if (slip) return outcome('broken', 'signMoved', 'solutions', 0.97, { term: slip.term }, slip.line);
    const suggestion = equationSuggestion(prev, groups, seed);
    if (adds >= 0) {
      return outcome('broken', 'differentSolutions', 'solutions', 0.95, { at: pointText(s1[adds]) }, suggestion);
    }
    return outcome('broken', 'notAtSolution', 'solutions', 0.95, { at: pointText(s0[loses]) }, suggestion);
  }
  if (s0.length === 0 && adds >= 0) return cannot('addsSolutions', { at: pointText(s1[adds]) });
  return cannot();
}

/** True when f has no real value at any of many sample points, as x - (2 ± sqrt(-28))/2 has none. */
function nowhereReal(f: Fn, names: readonly string[], seed: number): boolean {
  const next = rng(seed + 29);
  for (let k = 0; k < 40; k += 1) if (Number.isFinite(f(samplePoint(names, next, k % 2 === 0)))) return false;
  return true;
}

// Systems -----------------------------------------------------------------------------------------------------------

interface Linear {
  coef: number[];
  c: number;
}

/** An equation's left - right as a0 + a.x when it is linear in the names, checked at sample points; else null. */
function linearOf(f: Fn, names: readonly string[], seed: number): Linear | null {
  const next = rng(seed + 11);
  const base = samplePoint(names, next);
  const f0 = f(base);
  if (!Number.isFinite(f0)) return null;
  const coef = names.map((name) => f({ ...base, [name]: base[name] + 1 }) - f0);
  const c = f0 - names.reduce((sum, name, i) => sum + coef[i] * base[name], 0);
  for (let k = 0; k < 4; k += 1) {
    const p = samplePoint(names, next, true);
    const expected = c + names.reduce((sum, name, i) => sum + coef[i] * p[name], 0);
    if (numbersCompare(f(p), expected) !== 'same') return null;
  }
  return { coef, c };
}

/** Solves A s = b: a solution and the directions it may move in, or null when there is none. */
function solveLinear(rows: Linear[], n: number): { point: number[]; free: number[][] } | null {
  const a = rows.map((row) => [...row.coef, -row.c]);
  const pivots: number[] = [];
  let r = 0;
  for (let col = 0; col < n && r < a.length; col += 1) {
    let best = r;
    for (let i = r + 1; i < a.length; i += 1) if (Math.abs(a[i][col]) > Math.abs(a[best][col])) best = i;
    if (Math.abs(a[best][col]) < 1e-9) continue;
    [a[r], a[best]] = [a[best], a[r]];
    const p = a[r][col];
    a[r] = a[r].map((x) => x / p);
    for (let i = 0; i < a.length; i += 1) {
      if (i === r) continue;
      const factor = a[i][col];
      if (factor !== 0) a[i] = a[i].map((x, j) => x - factor * a[r][j]);
    }
    pivots.push(col);
    r += 1;
  }
  for (let i = r; i < a.length; i += 1) if (Math.abs(a[i][n]) > 1e-7 * Math.max(1, ...a[i].map(Math.abs))) return null;
  const point = new Array<number>(n).fill(0);
  pivots.forEach((col, i) => (point[col] = a[i][n]));
  const free: number[][] = [];
  for (let col = 0; col < n; col += 1) {
    if (pivots.includes(col)) continue;
    const v = new Array<number>(n).fill(0);
    v[col] = 1;
    pivots.forEach((pc, i) => (v[pc] = -a[i][col]));
    free.push(v);
  }
  return { point, free };
}

function atomsLinear(atoms: Atom[], names: string[], seed: number): Linear[] | null {
  const out: Linear[] = [];
  for (const atom of atoms) {
    const linear = linearOf(fn(difference(atom)), names, seed);
    if (!linear) return null;
    out.push(linear);
  }
  return out;
}

/** Whether linear equations have a solution together; null when one of them is not linear. */
export function systemState(atoms: Atom[], seed: number): 'consistent' | 'inconsistent' | null {
  const names = [...new Set(atoms.flatMap((atom) => variables(difference(atom))))];
  const rows = atomsLinear(atoms, names, seed);
  if (!rows) return null;
  return solveLinear(rows, names.length) ? 'consistent' : 'inconsistent';
}

/** True when the equations have a solution together. */
export function consistent(atoms: Atom[], seed: number): boolean {
  return systemState(atoms, seed) === 'consistent';
}

/**
 * Checks a line against the equations so far, when they are all linear: the line must hold at every solution of
 * them. Null when something is not linear, so the caller can compare with the previous line instead.
 */
export function compareWithSystem(facts: Atom[], groups: Atom[][], seed: number): Outcome | null {
  if (groups.length !== 1 || groups[0].some((atom) => atom.rel !== '=')) return null;
  const atoms = groups[0];
  const names = [...new Set([...facts, ...atoms].flatMap((atom) => variables(difference(atom))))];
  if (names.length === 0) return null;
  const rows = atomsLinear(facts, names, seed);
  if (!rows) return null;
  const solved = solveLinear(rows, names.length);
  if (!solved) return cannot();
  const next = rng(seed + 5);
  const points = [solved.point, ...solved.free.map((v) => solved.point.map((x, i) => x + v[i]))];
  for (let k = 0; k < 2 && solved.free.length > 0; k += 1) {
    const weights = solved.free.map(() => next() * 4 - 2);
    points.push(solved.point.map((x, i) => x + solved.free.reduce((s, v, j) => s + weights[j] * v[i], 0)));
  }
  const asValues = (p: number[]): Values => Object.fromEntries(names.map((name, i) => [name, p[i]]));
  let unsure = false;
  for (const atom of atoms) {
    const f = fn(difference(atom));
    const [l, r] = [fn(atom.left.node), fn(atom.right.node)];
    const scale: Fn = (p) => Math.abs(l(p)) + Math.abs(r(p));
    for (const p of points) {
      const z = zeroAt(f, scale, asValues(p));
      if (z === 'no') {
        const unique = solved.free.length === 0;
        const at = unique ? pointText(asValues(solved.point)) : '';
        const bare = atom.left.node.type === 'name' ? atom.left.node.name : null;
        const index = bare ? names.indexOf(bare) : -1;
        const suggestion = unique && bare && index >= 0 ? `${bare} = ${numberText(solved.point[index])}` : undefined;
        return outcome('broken', 'notAtSolution', 'system', 0.97, { at }, suggestion);
      }
      if (z === 'unsure') unsure = true;
    }
  }
  return unsure ? cannot() : outcome('ok', 'followsSystem', 'system', 0.99);
}

// Inequalities ------------------------------------------------------------------------------------------------------

const holds = (rel: Rel, d: number): boolean =>
  rel === '<'
    ? d < 0
    : rel === '>'
      ? d > 0
      : rel === '<='
        ? d <= 0
        : rel === '>='
          ? d >= 0
          : rel === '='
            ? d === 0
            : d !== 0;

interface Compiled {
  groups: { l: Fn; r: Fn; rel: Rel }[][];
}

function compile(groups: Atom[][], flipped = false): Compiled {
  return {
    groups: groups.map((g) =>
      g.map((atom) => ({ l: fn(atom.left.node), r: fn(atom.right.node), rel: flipped ? flip(atom.rel) : atom.rel })),
    ),
  };
}

/** Whether the line holds at a point, or null at a boundary or where a side has no value. */
function truth(c: Compiled, p: Values): boolean | null {
  let any = false;
  for (const g of c.groups) {
    let all = true;
    for (const atom of g) {
      const [l, r] = [atom.l(p), atom.r(p)];
      if (!Number.isFinite(l) || !Number.isFinite(r)) return null;
      const d = l - r;
      if (Math.abs(d) <= 1e-6 * (1 + Math.abs(l) + Math.abs(r))) return null;
      if (!holds(atom.rel, d)) all = false;
    }
    if (all) any = true;
  }
  return any;
}

function inequalityPoints(groups: Atom[][], names: string[], seed: number): Values[] {
  const points: Values[] = [];
  if (names.length === 1) {
    const [x] = names;
    for (let i = 0; i <= 400; i += 1) points.push({ [x]: -20 + i * 0.1 + 0.0137 });
    for (const g of groups) {
      for (const atom of g) {
        for (const root of zeros(fn(difference(atom)), names, seed)) {
          for (const offset of [-1e-3, 1e-3, -0.05, 0.05]) points.push({ [x]: root[x] + offset });
        }
      }
    }
    return points;
  }
  const next = rng(seed + 13);
  for (let i = 0; i < 500; i += 1) points.push(samplePoint(names, next, i % 2 === 0));
  return points;
}

export function relationsText(groups: Atom[][], flipped = false): string {
  return groups
    .map((g) => {
      let out = '';
      g.forEach((atom, i) => {
        const rel = flipped ? flip(atom.rel) : atom.rel;
        const chained = i > 0 && g[i - 1].right === atom.left;
        out += chained
          ? ` ${rel} ${nodeText(atom.right.node)}`
          : `${i > 0 ? ', ' : ''}${nodeText(atom.left.node)} ${rel} ${nodeText(atom.right.node)}`;
      });
      return out;
    })
    .join(' or ');
}

/** Compares two lines with inequalities by where each holds, at many points on both sides of every boundary. */
export function compareInequalities(prev: Atom[][], cur: Atom[][], seed: number): Outcome {
  const names = [...new Set([...prev, ...cur].flat().flatMap((atom) => variables(difference(atom))))];
  if (names.length === 0) return cannot();
  const points = inequalityPoints([...prev, ...cur], names, seed);
  const [a, b, flipped] = [compile(prev), compile(cur), compile(cur, true)];
  let usable = 0;
  let mismatch: Values | null = null;
  let flippedMismatch = false;
  for (const p of points) {
    const [ta, tb, tf] = [truth(a, p), truth(b, p), truth(flipped, p)];
    if (ta === null || tb === null) continue;
    usable += 1;
    const size = (q: Values) => Math.max(...Object.values(q).map(Math.abs));
    if (ta !== tb && (!mismatch || size(p) < size(mismatch))) mismatch = p;
    if (tf !== null && tf !== ta) flippedMismatch = true;
  }
  if (usable < 40) return cannot();
  if (!mismatch) return outcome('ok', 'sameInequality', 'sampling', 0.95);
  if (!flippedMismatch) return outcome('broken', 'inequalityFlip', 'sampling', 0.95, {}, relationsText(cur, true));
  return outcome('broken', 'inequalitySet', 'sampling', 0.93, { at: pointText(mismatch) });
}
