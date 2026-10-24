// Limits. Direct substitution works where the function is continuous. L'Hôpital's rule takes 0/0 and ∞/∞, up to four
// times. At infinity, a ratio of polynomials goes as its leading terms. Otherwise the values from each side say
// whether the limit exists, is infinite, or differs from the left and the right. A value found from the sides is
// shown exactly only when it is very close to a familiar number, and as a decimal otherwise.
import { build, dependsOn, freeNames } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { isRational, norm, substitute, tidy } from './algebra';
import { derivativeOf } from './derivative';
import { recognize } from './exact';
import { factorsNode } from './integrate';
import { polynomial } from './partial';
import { evaluator, valueOf } from './numeric';
import { latexOf } from './print';
import type { Bound } from './read';
import type { Step } from './types';

export type LimitValue = { node: Node } | { infinite: 1 | -1 };

export type LimitResult =
  | { ok: true; value: LimitValue; steps: Step[] }
  | { ok: false; reason: 'noLimit' | 'unsupported' | 'letters'; steps: Step[] };

export interface LimitQuestion {
  body: Node;
  x: string;
  to: Bound;
  side?: 'left' | 'right';
}

const MAX_LHOPITAL = 4;

export function boundLatex(bound: Bound): string {
  return 'infinite' in bound ? (bound.infinite > 0 ? '\\infty' : '-\\infty') : latexOf(bound.node);
}

export function valueLatex(value: LimitValue): string {
  return 'infinite' in value ? (value.infinite > 0 ? '\\infty' : '-\\infty') : latexOf(value.node);
}

function limLatex(q: LimitQuestion, body: Node): string {
  const side = q.side ? `^{${q.side === 'right' ? '+' : '-'}}` : '';
  return `\\lim_{${q.x} \\to ${boundLatex(q.to)}${side}} ${latexOf(body)}`;
}

/** The values of f as x approaches the point from one side (dir 1 from above, -1 from below), or at infinity. */
function approach(f: (x: number) => number, to: Bound, dir: 1 | -1): number[] {
  if ('infinite' in to) return [1e2, 1e3, 1e4, 1e5, 1e6, 1e7].map((t) => f(to.infinite * t));
  const a = valueOf(to.node);
  return [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7].map((h) => f(a + dir * h * Math.max(1, Math.abs(a))));
}

type Seen = { kind: 'value'; value: number } | { kind: 'infinite'; sign: 1 | -1 } | { kind: 'none' };

/** What a run of values is heading for: a number, plus or minus infinity, or nothing clear. */
function heading(values: number[]): Seen {
  const tail = values.slice(2).filter(Number.isFinite);
  if (tail.length < 3) {
    const infinite = values.slice(2).find((v) => v === Infinity || v === -Infinity);
    return infinite ? { kind: 'infinite', sign: infinite > 0 ? 1 : -1 } : { kind: 'none' };
  }
  const [a, b, c] = tail.slice(-3);
  const growing = Math.abs(c) > 1e5 && Math.abs(c) > 5 * Math.abs(b) && Math.abs(b) > 2 * Math.abs(a);
  if (growing && Math.sign(b) === Math.sign(c)) return { kind: 'infinite', sign: c > 0 ? 1 : -1 };
  // Slow growth, as of ln x: the steps between values do not shrink, so the values never settle.
  const [d1, d2] = [b - a, c - b];
  const creeping = Math.abs(c) > 10 && Math.sign(d1) === Math.sign(d2) && Math.abs(d2) >= 0.5 * Math.abs(d1);
  if (creeping && Math.abs(d2) > 1e-3 * Math.abs(c)) return { kind: 'infinite', sign: d2 > 0 ? 1 : -1 };
  const scale = Math.max(1, Math.abs(c));
  if (Math.abs(c - b) < 1e-4 * scale && Math.abs(b - a) < 1e-3 * scale) return { kind: 'value', value: c };
  return { kind: 'none' };
}

function asValue(seen: Seen): LimitValue | null {
  if (seen.kind === 'infinite') return { infinite: seen.sign };
  if (seen.kind !== 'value') return null;
  const exact = recognize(seen.value, 1e-6);
  return { node: exact ?? build.num(Number(seen.value.toPrecision(8))) };
}

const sameSeen = (a: Seen, b: Seen) =>
  a.kind === b.kind &&
  (a.kind !== 'value' || Math.abs(a.value - (b as { value: number }).value) < 1e-4 * Math.max(1, Math.abs(a.value))) &&
  (a.kind !== 'infinite' || a.sign === (b as { sign: number }).sign);

/** The limit from the values on each side. */
function numeric(q: LimitQuestion, body: Node): LimitResult {
  const run = evaluator(body);
  const f = (v: number) => run({ [q.x]: v });
  const right = q.side === 'left' ? null : heading(approach(f, q.to, 1));
  const left = q.side === 'right' || 'infinite' in q.to ? null : heading(approach(f, q.to, -1));
  const sides = [right, left].filter((s): s is Seen => s !== null);
  const agreed = sides.every((s) => sameSeen(s, sides[0]));
  const value = agreed ? asValue(sides[0]) : null;
  const latex = `${limLatex(q, body)} = ${value ? valueLatex(value) : '\\text{---}'}`;
  const step: Step = { rule: q.side ? 'oneSided' : 'limitNumeric', latex };
  return value ? { ok: true, value, steps: [step] } : { ok: false, reason: 'noLimit', steps: [step] };
}

/** At infinity, a ratio of polynomials goes as its leading terms. */
function leadingTerms(q: LimitQuestion, body: Node): LimitResult | null {
  if (!('infinite' in q.to)) return null;
  const [term] = norm(body);
  if (!term || norm(body).length !== 1) return null;
  const below = (f: (typeof term.factors)[number]) => isRational(f.exp) && f.exp.n < 0n;
  const top = polynomial(build.mul(factorsNode(term.factors.filter((f) => !below(f))), numberNode(term.coef)), q.x);
  const bottom = polynomial(tidy(build.div(build.num(1), factorsNode(term.factors.filter(below)))), q.x);
  if (!top || !bottom || (top.length === 1 && bottom.length === 1)) return null;
  const [n, d] = [top.length - 1, bottom.length - 1];
  const lead = Number(top[n].n) / Number(top[n].d) / (Number(bottom[d].n) / Number(bottom[d].d));
  let value: LimitValue;
  if (n < d) value = { node: build.num(0) };
  else if (n === d) value = { node: tidy(build.div(numberNode(top[n]), numberNode(bottom[d]))) };
  else value = { infinite: (Math.sign(lead) * (q.to.infinite < 0 && (n - d) % 2 === 1 ? -1 : 1)) as 1 | -1 };
  const step: Step = { rule: 'limitAtInfinity', latex: `${limLatex(q, body)} = ${valueLatex(value)}` };
  return { ok: true, value, steps: [step] };
}

const numberNode = (q: { n: bigint; d: bigint }) =>
  q.d === 1n ? build.num(Number(q.n)) : build.div(build.num(Number(q.n)), build.num(Number(q.d)));

/** f(a) when f is continuous at a: its exact value. */
function direct(q: LimitQuestion, body: Node): LimitResult | null {
  if ('infinite' in q.to) return null;
  const at = tidy(substitute(body, q.x, q.to.node));
  const value = valueOf(at);
  if (!Number.isFinite(value)) return null;
  const f = evaluator(body);
  const a = valueOf(q.to.node);
  const near = [1e-6, -1e-6].filter((h) => !(q.side === 'right' && h < 0) && !(q.side === 'left' && h > 0));
  const continuous = near.every((h) => Math.abs(f({ [q.x]: a + h }) - value) < 1e-3 * Math.max(1, Math.abs(value)));
  if (!continuous) return null;
  const step: Step = { rule: 'directSubstitution', latex: `${limLatex(q, body)} = ${latexOf(at)}` };
  return { ok: true, value: { node: at }, steps: [step] };
}

/** 0/0 or ∞/∞: the limit of the ratio of the derivatives. */
function lhopital(q: LimitQuestion, body: Node, depth: number): LimitResult | null {
  const [term] = norm(body);
  if (!term || norm(body).length !== 1 || depth >= MAX_LHOPITAL) return null;
  const below = (f: (typeof term.factors)[number]) => isRational(f.exp) && f.exp.n < 0n;
  const bottomFactors = term.factors.filter(below);
  if (bottomFactors.length === 0) return null;
  const top = tidy(build.mul(build.num(Number(term.coef.n)), factorsNode(term.factors.filter((f) => !below(f)))));
  const bottom = tidy(build.mul(build.num(Number(term.coef.d)), build.div(build.num(1), factorsNode(bottomFactors))));
  const ends = (node: Node) =>
    heading(approach((v) => evaluator(node)({ [q.x]: v }), q.to, q.side === 'left' ? -1 : 1));
  const [t, b] = [ends(top), ends(bottom)];
  const zero = (s: Seen) => s.kind === 'value' && Math.abs(s.value) < 1e-6;
  if (!((zero(t) && zero(b)) || (t.kind === 'infinite' && b.kind === 'infinite'))) return null;
  let next: Node;
  try {
    next = tidy(build.div(derivativeOf(top, q.x), derivativeOf(bottom, q.x)));
  } catch {
    return null;
  }
  const found = limitSteps({ ...q, body: next }, depth + 1);
  if (!found.ok) return null;
  const note = `\\frac{${latexOf(top)}}{${latexOf(bottom)}} \\to \\frac{${zero(t) ? '0' : '\\infty'}}{${zero(b) ? '0' : '\\infty'}}`;
  const step: Step = {
    rule: 'lhopital',
    latex: `${limLatex(q, body)} = ${limLatex(q, next)} = ${valueLatex(found.value)}`,
    note,
    children: found.steps,
  };
  return { ok: true, value: found.value, steps: [step] };
}

function limitSteps(q: LimitQuestion, depth = 0): LimitResult {
  const body = tidy(q.body);
  if (!dependsOn(body, q.x)) {
    return {
      ok: true,
      value: { node: body },
      steps: [{ rule: 'constant', latex: `${limLatex(q, body)} = ${latexOf(body)}` }],
    };
  }
  return direct(q, body) ?? leadingTerms(q, body) ?? lhopital(q, body, depth) ?? numeric(q, body);
}

/** The limit, with its steps. Letters other than the variable are not supported. */
export function limitOf(q: LimitQuestion): LimitResult {
  const others = freeNames(q.body).filter((n) => n !== q.x && n !== 'pi' && n !== 'e');
  if (others.length > 0) return { ok: false, reason: 'letters', steps: [] };
  return limitSteps(q);
}
