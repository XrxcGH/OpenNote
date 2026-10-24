// Answers a calculus question with its steps: a derivative (of any order, partial, or at a point), an integral
// (indefinite with + C, or definite: exact when it can be, with a decimal beside it), a limit, or a sum. An answer
// that cannot be found says why, calmly, and a definite integral with no antiderivative in reach still gets its
// value numerically, marked as approximate.
import { build, freeNames } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { substitute, tidy, TooLarge } from './algebra';
import { bracket, derivativeSteps, dOf } from './derivative';
import { Integrator, intLatex } from './integrate';
import type { Integrated } from './integrate';
import { boundLatex, limitOf, valueLatex } from './limit';
import type { LimitValue } from './limit';
import { byParts, distribute, expandPolynomial, substitution } from './methods';
import { breaksInside, decimalText, definedOn, evaluator, integrateNumerically, valueOf } from './numeric';
import { partialFractions } from './partial';
import { latexOf, textOf } from './print';
import type { Bound, Question } from './read';
import { sumOf } from './series';
import { trigIdentities } from './trig';
import type { Answer, Solved, Step } from './types';

const METHODS = [partialFractions, expandPolynomial, trigIdentities, substitution, byParts, distribute];

/** An integrator for x with every method. */
export function integratorFor(x: string): Integrator {
  return new Integrator(x, METHODS, { parts: 3, substitution: true });
}

const CONSTANT_NAMES = new Set(['pi', 'e']);

/** An exact value with its decimal beside it, unless the exact value is already a plain number. */
function valueAnswer(node: Node): Answer {
  const exact = tidy(node);
  const value = valueOf(exact);
  const plain = exact.type === 'num' || (exact.type === 'unary' && exact.arg.type === 'num');
  if (plain || !Number.isFinite(value) || freeNames(exact).some((n) => !CONSTANT_NAMES.has(n))) {
    return { latex: latexOf(exact), text: textOf(exact) };
  }
  const decimal = decimalText(value);
  return { latex: `${latexOf(exact)} \\approx ${decimal}`, text: `${textOf(exact)} ≈ ${decimal}` };
}

const approximate = (value: number): Answer => ({
  latex: `\\approx ${decimalText(value)}`,
  text: `≈ ${decimalText(value)}`,
});

function derivative(q: Question & { kind: 'derivative' }): Solved {
  const { steps, result } = derivativeSteps(q.body, q.x, q.order);
  const all = [...steps];
  if (q.partial)
    all.unshift({ rule: 'partial', latex: `\\frac{\\partial}{\\partial ${q.x}}${bracket(latexOf(q.body))}` });
  if (!q.at)
    return { ok: true, kind: 'derivative', answer: { latex: latexOf(result), text: textOf(result) }, steps: all };
  const at = tidy(substitute(result, q.x, q.at));
  const where = `\\Big|_{${q.x}=${latexOf(q.at)}}`;
  all.push({ rule: 'evaluateAt', latex: `${dOf(q.x, q.order)}${bracket(latexOf(q.body))}${where} = ${latexOf(at)}` });
  return { ok: true, kind: 'derivative', answer: valueAnswer(at), steps: all };
}

const boundValue = (b: Bound) => ('infinite' in b ? b.infinite * Infinity : valueOf(b.node));

/** F at a bound: its value there, or its limit at infinity or where it is undefined. */
function at(F: Node, x: string, bound: Bound, side: 'left' | 'right'): LimitValue | null {
  if (!('infinite' in bound)) {
    const exact = tidy(substitute(F, x, bound.node));
    if (Number.isFinite(valueOf(exact))) return { node: exact };
  }
  const found = limitOf({ body: F, x, to: bound, ...('infinite' in bound ? {} : { side }) });
  return found.ok ? found.value : null;
}

function definite(q: Question & { kind: 'integral' }, found: Integrated | null): Solved {
  const [from, to] = [q.from as Bound, q.to as Bound];
  const [a, b] = [boundValue(from), boundValue(to)];
  const head = `\\int_{${boundLatex(from)}}^{${boundLatex(to)}} ${latexOf(q.body)}\\,d${q.x}`;
  const run = evaluator(q.body);
  const f = (v: number) => run({ [q.x]: v });
  const finite = Number.isFinite(a) && Number.isFinite(b);
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  if (finite && breaksInside(q.body, q.x, lo, hi)) {
    return { ok: false, kind: 'integral', reason: 'undefinedOnInterval', steps: [] };
  }
  const numeric = finite && definedOn(f, a, b) ? integrateNumerically(f, a, b) : NaN;
  if (found) {
    const [upper, lower] = [at(found.node, q.x, to, 'left'), at(found.node, q.x, from, 'right')];
    const endless = (!upper && 'infinite' in to) || (!lower && 'infinite' in from);
    if (endless || (upper && lower && ('infinite' in upper || 'infinite' in lower))) {
      return { ok: false, kind: 'integral', reason: 'diverges', steps: [found.step] };
    }
    if (upper && lower && !('infinite' in upper) && !('infinite' in lower)) {
      const value = tidy(build.sub(upper.node, lower.node));
      const agrees =
        !Number.isFinite(numeric) || Math.abs(valueOf(value) - numeric) < 1e-6 * Math.max(1, Math.abs(numeric));
      if (agrees && Number.isFinite(valueOf(value))) {
        const rule = finite ? 'evaluate' : 'improper';
        const evaluate: Step = {
          rule,
          latex: `${head} = \\left[${latexOf(found.node)}\\right]_{${boundLatex(from)}}^{${boundLatex(to)}} = ${latexOf(value)}`,
          note: `${valueLatex(upper)} - ${valueLatex(lower).startsWith('-') ? `\\left(${valueLatex(lower)}\\right)` : valueLatex(lower)}`,
        };
        return { ok: true, kind: 'integral', answer: valueAnswer(value), steps: [found.step, evaluate] };
      }
    }
  }
  if (!Number.isFinite(numeric)) return { ok: false, kind: 'integral', reason: 'notInTable', steps: [] };
  const step: Step = { rule: 'numeric', latex: `${head} \\approx ${decimalText(numeric)}` };
  return { ok: true, kind: 'integral', answer: approximate(numeric), steps: [step] };
}

function integral(q: Question & { kind: 'integral' }): Solved {
  const found = integratorFor(q.x).integrate(q.body);
  if (q.from && q.to) return definite(q, found);
  if (!found) return { ok: false, kind: 'integral', reason: 'notInTable', steps: [] };
  const plusC: Step = { rule: 'constantOfIntegration', latex: `${intLatex(q.body, q.x)} = ${latexOf(found.node)} + C` };
  const answer = { latex: `${latexOf(found.node)} + C`, text: `${textOf(found.node)} + C` };
  return { ok: true, kind: 'integral', answer, steps: [found.step, plusC] };
}

function limit(q: Question & { kind: 'limit' }): Solved {
  const found = limitOf(q);
  if (!found.ok) return { ok: false, kind: 'limit', reason: found.reason, steps: found.steps };
  if ('infinite' in found.value) {
    const sign = found.value.infinite > 0 ? '' : '-';
    return { ok: true, kind: 'limit', answer: { latex: `${sign}\\infty`, text: `${sign}∞` }, steps: found.steps };
  }
  return { ok: true, kind: 'limit', answer: valueAnswer(found.value.node), steps: found.steps };
}

function sum(q: Question & { kind: 'sum' }): Solved {
  const found = sumOf(q);
  if (!found.ok) return { ok: false, kind: 'sum', reason: found.reason, steps: found.steps };
  const answer = found.approximate ? approximate(valueOf(found.value)) : valueAnswer(found.value);
  return { ok: true, kind: 'sum', answer, steps: found.steps };
}

/** Answers a question read by readQuestion. */
export function solveQuestion(q: Question): Solved {
  try {
    switch (q.kind) {
      case 'derivative':
        return derivative(q);
      case 'integral':
        return integral(q);
      case 'limit':
        return limit(q);
      default:
        return sum(q);
    }
  } catch (error) {
    if (error instanceof TooLarge) return { ok: false, kind: q.kind, reason: 'tooLarge', steps: [] };
    // A derivative the engine cannot take (floor, mod by x) or a tree too deep: no answer rather than a wrong one.
    if (error instanceof Error && 'code' in error) return { ok: false, kind: q.kind, reason: 'unsupported', steps: [] };
    throw error;
  }
}
