// Sums: a finite sum added up exactly when its terms are fractions, a geometric series by a / (1 - r), the p-series
// with a known value (1/n^2 is pi^2/6), and otherwise partial sums with an estimate of the tail. A series whose terms
// do not shrink, or shrink no faster than 1/n, diverges, and the answer says so.
import { build, freeNames } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { constantOf, isRational, norm, substitute, tidy } from './algebra';
import { recognize } from './exact';
import { evaluator, valueOf } from './numeric';
import { latexOf } from './print';
import type { Bound } from './read';
import type { Step } from './types';

export type SumResult =
  | { ok: true; value: Node; approximate: boolean; steps: Step[] }
  | { ok: false; reason: 'diverges' | 'unsupported' | 'letters' | 'tooLarge'; steps: Step[] };

export interface SumQuestion {
  body: Node;
  x: string;
  from: Bound;
  to: Bound;
}

const MAX_TERMS = 100_000;
const ZETA: Readonly<Record<number, () => Node>> = {
  2: () => build.div(build.pow(build.name('pi'), build.num(2)), build.num(6)),
  4: () => build.div(build.pow(build.name('pi'), build.num(4)), build.num(90)),
  6: () => build.div(build.pow(build.name('pi'), build.num(6)), build.num(945)),
};

const boundText = (b: Bound) => ('infinite' in b ? (b.infinite > 0 ? '\\infty' : '-\\infty') : latexOf(b.node));

export function sumLatex(q: SumQuestion, body = q.body): string {
  return `\\sum_{${q.x}=${boundText(q.from)}}^{${boundText(q.to)}} ${latexOf(body)}`;
}

const whole = (b: Bound): number | null => {
  if ('infinite' in b) return null;
  const v = valueOf(b.node);
  return Number.isInteger(v) ? v : null;
};

function finite(q: SumQuestion, start: number, end: number): SumResult {
  if (end - start + 1 > MAX_TERMS) return { ok: false, reason: 'tooLarge', steps: [] };
  const terms: Node[] = [];
  let exact = true;
  let total = 0;
  const f = evaluator(q.body);
  for (let k = start; k <= end; k += 1) {
    if (exact && end - start < 400) {
      const term = tidy(substitute(q.body, q.x, build.num(k)));
      if (constantOf(norm(term)) === null && end - start > 12) exact = false;
      terms.push(term);
    } else exact = false;
    total += f({ [q.x]: k });
  }
  const value =
    exact && terms.length ? tidy(terms.reduce((a, b) => build.add(a, b))) : build.num(Number(total.toPrecision(12)));
  const step: Step = { rule: 'finiteSum', latex: `${sumLatex(q)} = ${latexOf(value)}` };
  return { ok: true, value, approximate: !exact, steps: [step] };
}

/** A geometric series: the ratio of neighbors does not depend on n. */
function geometric(q: SumQuestion, start: number): SumResult | null {
  const n = build.name(q.x);
  const ratio = tidy(build.div(substitute(q.body, q.x, build.add(n, build.num(1))), q.body));
  if (freeNames(ratio).includes(q.x)) return null;
  const r = valueOf(ratio);
  if (!Number.isFinite(r)) return null;
  const note = `r = ${latexOf(ratio)}`;
  if (Math.abs(r) >= 1)
    return { ok: false, reason: 'diverges', steps: [{ rule: 'geometric', latex: sumLatex(q), note }] };
  const first = tidy(substitute(q.body, q.x, build.num(start)));
  const value = tidy(build.div(first, build.sub(build.num(1), ratio)));
  return {
    ok: true,
    value,
    approximate: false,
    steps: [{ rule: 'geometric', latex: `${sumLatex(q)} = ${latexOf(value)}`, note }],
  };
}

/** c / n^p for whole p: a p-series, with its value when it is a familiar one. */
function pSeries(q: SumQuestion, start: number): SumResult | null {
  const [term] = norm(q.body);
  if (!term || norm(q.body).length !== 1 || term.factors.length !== 1) return null;
  const [f] = term.factors;
  if (f.base.type !== 'name' || f.base.name !== q.x || !isRational(f.exp) || f.exp.d !== 1n || f.exp.n >= 0n)
    return null;
  const p = -Number(f.exp.n);
  if (p <= 1)
    return { ok: false, reason: 'diverges', steps: [{ rule: 'knownSeries', latex: sumLatex(q), note: `p = ${p}` }] };
  const zeta = ZETA[p];
  if (!zeta || start < 1) return null;
  let value: Node = build.mul(build.div(build.num(Number(term.coef.n)), build.num(Number(term.coef.d))), zeta());
  for (let k = 1; k < start; k += 1) value = build.sub(value, substitute(q.body, q.x, build.num(k)));
  value = tidy(value);
  const step: Step = { rule: 'knownSeries', latex: `${sumLatex(q)} = ${latexOf(value)}`, note: `p = ${p}` };
  return { ok: true, value, approximate: false, steps: [step] };
}

/** Partial sums with the tail estimated from how fast the terms shrink. */
function numericSeries(q: SumQuestion, start: number): SumResult {
  const run = evaluator(q.body);
  const f = (k: number) => run({ [q.x]: k });
  const N = 200_000;
  let total = 0;
  for (let k = start; k <= N; k += 1) {
    const v = f(k);
    if (!Number.isFinite(v)) return { ok: false, reason: 'unsupported', steps: [] };
    total += v;
  }
  const [a, b] = [Math.abs(f(N / 2)), Math.abs(f(N))];
  const step = (latex: string): Step[] => [{ rule: 'seriesNumeric', latex }];
  if (b > 1e-9 * Math.max(1, Math.abs(total)) && b >= 0.99 * a)
    return { ok: false, reason: 'diverges', steps: step(sumLatex(q)) };
  const alternating = Math.sign(f(N)) !== Math.sign(f(N - 1));
  let estimate = total;
  if (alternating) estimate = total - f(N) / 2;
  else if (b > 0) {
    const p = Math.log2(a / b);
    if (p <= 1.02) return { ok: false, reason: 'diverges', steps: step(sumLatex(q)) };
    estimate = total + (N * f(N)) / (p - 1);
  }
  const exact = recognize(estimate, 1e-7);
  const value = exact ?? build.num(Number(estimate.toPrecision(8)));
  return {
    ok: true,
    value,
    approximate: !exact,
    steps: step(`${sumLatex(q)} ${exact ? '=' : '\\approx'} ${latexOf(value)}`),
  };
}

/** The value of a sum, with its steps. */
export function sumOf(q: SumQuestion): SumResult {
  const others = freeNames(q.body).filter((n) => n !== q.x && n !== 'pi' && n !== 'e');
  if (others.length > 0) return { ok: false, reason: 'letters', steps: [] };
  const start = whole(q.from);
  if (start === null) return { ok: false, reason: 'unsupported', steps: [] };
  const end = whole(q.to);
  if (end !== null) return finite(q, start, end);
  if (!('infinite' in q.to) || q.to.infinite < 0) return { ok: false, reason: 'unsupported', steps: [] };
  return geometric(q, start) ?? pSeries(q, start) ?? numericSeries(q, start);
}
