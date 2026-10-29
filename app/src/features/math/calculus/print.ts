// Writes a normal form (algebra.ts) the way a textbook does: as LaTeX for equations, and as plain text for lines of
// a page. A term is its number and factors over its denominator: \frac{x^{3}}{3}, -\frac{1}{2x^{2}}, 2x\cos x^{2}.
// Square roots draw as roots, e^(2x) as a power of e, ln|x| with bars, sin^2 x as \sin^{2} x, 1/cos^2 x as
// \sec^{2} x, and terms over one number share it: (x + 1)/2 rather than x/2 + 1/2.
import { build, fractions } from '../../../core/expr';
import type { Node, Rational } from '../../../core/expr';
import { isRational, norm, ordered, toNode } from './algebra';
import type { Exponent, Factor, Form, Term } from './algebra';

const R = fractions;
const LATEX_NAMES: Readonly<Record<string, string>> = { pi: '\\pi', tau: '\\tau', phi: '\\varphi', theta: '\\theta' };
const TEXT_NAMES: Readonly<Record<string, string>> = { pi: 'π', tau: 'τ', phi: 'φ', theta: 'θ' };
const NAMED = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp']);
const LATEX_INVERSE: Readonly<Record<string, string>> = { asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan' };
const TEXT_INVERSE: Readonly<Record<string, string>> = { asin: 'arcsin', acos: 'arccos', atan: 'arctan' };
const POWERED = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh']);
/** 1/cos is written sec, and 1/sin is written csc. */
const RECIPROCAL: Readonly<Record<string, string>> = { cos: 'sec', sin: 'csc' };

interface Style {
  latex: boolean;
}

const isSum = (node: Node) => norm(node).length > 1;
const isNegativeNumber = (node: Node) => node.type === 'num' && node.value < 0;

/** True when the text has a space or a sign outside every bracket, so it needs brackets around it. */
function hasTopLevelGap(text: string): boolean {
  let depth = 0;
  for (let i = 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '(' || c === '|') depth += c === '|' && depth > 0 ? -1 : 1;
    else if (c === ')') depth -= 1;
    else if (depth === 0 && /[ +\-·]/.test(c)) return true;
  }
  return false;
}

/** A call: \sin x, \ln\left|x\right|, \arctan\left(2x\right); or sin(x), ln|x|, arctan(2x). */
function callText(node: Node & { type: 'call' }, style: Style, power = ''): string {
  const args = node.args.map((arg) => write(arg, style));
  const [arg] = args;
  const simple = node.args[0]?.type === 'name' || node.args[0]?.type === 'num';
  if (node.name === 'abs') return style.latex ? `\\left|${arg}\\right|${power}` : `|${arg}|${power}`;
  const absInside = node.args[0]?.type === 'call' && node.args[0].name === 'abs' && node.args.length === 1;
  if (style.latex) {
    const head = LATEX_INVERSE[node.name] ?? (NAMED.has(node.name) ? `\\${node.name}` : `\\operatorname{${node.name}}`);
    if (absInside) return `${head}${power}${arg}`;
    return simple && args.length === 1 ? `${head}${power} ${arg}` : `${head}${power}\\left(${args.join(', ')}\\right)`;
  }
  const head = TEXT_INVERSE[node.name] ?? node.name;
  return absInside ? `${head}${arg}${power}` : `${head}(${args.join(', ')})${power}`;
}

function exponentText(exp: Exponent, style: Style): string {
  if (isRational(exp)) {
    const text = `${exp.n}${exp.d === 1n ? '' : `/${exp.d}`}`;
    if (style.latex) return `^{${text}}`;
    return exp.d === 1n && exp.n >= 0n ? `^${text}` : `^(${text})`;
  }
  const text = write(exp, style);
  if (style.latex) return `^{${text}}`;
  return /^(\d+(\.\d+)?|[a-zA-Zπ])$/.test(text) ? `^${text}` : `^(${text})`;
}

/** One factor to a power: x^{2}, \sqrt{x}, \sin^{2} x, \left(x+1\right)^{3}, e^{2x}. */
function factorText(f: Factor, exp: Exponent, style: Style, alone = false): string {
  const one = isRational(exp) && exp.n === 1n && exp.d === 1n;
  const base = f.base;
  if (isRational(exp) && exp.n === 1n && (exp.d === 2n || exp.d === 3n)) {
    const inner = write(base, style);
    if (style.latex) return exp.d === 2n ? `\\sqrt{${inner}}` : `\\sqrt[3]{${inner}}`;
    return `${exp.d === 2n ? 'sqrt' : 'cbrt'}(${inner})`;
  }
  if (base.type === 'call' && !one && isRational(exp) && exp.n > 0n && R.isInteger(exp) && POWERED.has(base.name)) {
    return callText(base, style, style.latex ? `^{${String(exp.n)}}` : `^${String(exp.n)}`);
  }
  let text = write(base, style);
  const wrap =
    (isSum(base) && !(alone && one)) ||
    isNegativeNumber(base) ||
    (!one && (base.type === 'call' || base.type === 'binary'));
  if (wrap) text = style.latex ? `\\left(${text}\\right)` : `(${text})`;
  return one ? text : `${text}${exponentText(exp, style)}`;
}

/** Parts side by side: 2x, x\sin x, 3\cdot 2^{x}; or 2x, x sin(x), 3·2^x. */
function joinParts(parts: string[], style: Style): string {
  return parts.reduce((out, part) => {
    if (out === '') return part;
    const digitNext = /^[\d.]/.test(part);
    if (style.latex) return `${out}${digitNext ? '\\cdot ' : ''}${part}`;
    const glued = /^[a-zA-Zπ(]/.test(part) && /^[\d.]+$/.test(out) && !/^[a-z]{2,}/.test(part);
    return `${out}${digitNext ? '·' : glued ? '' : ' '}${part}`;
  }, '');
}

/** 1/cos^2 x as sec^2 x, and -(a - b) c as (b - a) c, which read as a textbook writes them. */
function forReading(term: Term, single: boolean): Term {
  let { coef } = term;
  const factors = term.factors.map((f) => {
    const name = f.base.type === 'call' ? RECIPROCAL[f.base.name] : undefined;
    if (name && isRational(f.exp) && f.exp.d === 1n && f.exp.n < 0n && f.base.type === 'call') {
      return { ...f, base: build.call(name, ...f.base.args), exp: R.neg(f.exp) };
    }
    return f;
  });
  const plainSum = (f: Factor) => isSum(f.base) && isRational(f.exp) && f.exp.n === 1n && f.exp.d === 1n;
  const flip = single && coef.n < 0n ? factors.findIndex(plainSum) : -1;
  if (flip >= 0) {
    coef = R.neg(coef);
    const negated = toNode(norm(build.neg(factors[flip].base)));
    factors[flip] = { ...factors[flip], base: negated };
  }
  return { coef, factors };
}

function termText(raw: Term, style: Style, single = false): string {
  const term = forReading(raw, single);
  const top: string[] = [];
  const bottom: string[] = [];
  const magnitude = R.abs(term.coef);
  const below = (f: Factor) => isRational(f.exp) && f.exp.n < 0n;
  const lower = term.factors.filter(below);
  const upper = term.factors.filter((f) => !below(f));
  // A sum alone over or under the bar needs no brackets of its own.
  const topAlone = upper.length === 1 && magnitude.n === 1n && (lower.length > 0 || magnitude.d !== 1n);
  const bottomAlone = lower.length === 1 && magnitude.d === 1n;
  for (const f of lower) bottom.push(factorText(f, R.neg(f.exp as Rational), style, bottomAlone));
  for (const f of upper) top.push(factorText(f, f.exp, style, topAlone));
  if (magnitude.n !== 1n || top.length === 0) top.unshift(String(magnitude.n));
  if (magnitude.d !== 1n) bottom.unshift(String(magnitude.d));
  const over = joinParts(top, style);
  if (bottom.length === 0) return over;
  const under = joinParts(bottom, style);
  if (style.latex) return `\\frac{${over}}{${under}}`;
  const wrap = (text: string) => (hasTopLevelGap(text) ? `(${text})` : text);
  return `${wrap(over)}/${bottom.length > 1 ? `(${under})` : wrap(under)}`;
}

/** The number every term is over, when they share one: 2 for x/2 + 1/2. */
function sharedDenominator(form: Form): bigint | null {
  const d = form[0].coef.d;
  const plain = form.every(
    (term) => term.coef.d === d && term.factors.every((f) => !isRational(f.exp) || f.exp.n > 0n),
  );
  return form.length > 1 && d > 1n && plain ? d : null;
}

function formText(form: Form, style: Style): string {
  if (form.length === 0) return '0';
  const d = sharedDenominator(form);
  if (d !== null) {
    const scaled = form.map((term) => ({ coef: R.mul(term.coef, R.rational(d)), factors: term.factors }));
    const inner = formText(scaled, style);
    return style.latex ? `\\frac{${inner}}{${d}}` : `(${inner})/${d}`;
  }
  return ordered(form).reduce((out, term, i) => {
    const body = termText(term, style, form.length === 1);
    const negative = forReading(term, form.length === 1).coef.n < 0n;
    if (i === 0) return negative ? `-${body}` : body;
    return `${out} ${negative ? '-' : '+'} ${body}`;
  }, '');
}

function write(node: Node, style: Style): string {
  if (node.type === 'name') return (style.latex ? LATEX_NAMES : TEXT_NAMES)[node.name] ?? node.name;
  if (node.type === 'num') return node.text;
  if (node.type === 'call') return callText(node, style);
  return formText(norm(node), style);
}

/** A tree as tidy LaTeX. */
export const latexOf = (node: Node): string => formText(norm(node), { latex: true });

/** A tree as tidy plain text, as a line of a page shows it. */
export const textOf = (node: Node): string => formText(norm(node), { latex: false });
