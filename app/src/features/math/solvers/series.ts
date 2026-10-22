// Taylor and Maclaurin series: the expansion of f about a to order n, from its derivatives there; the Lagrange bound
// on the remainder at a point, with the largest (n+1)th derivative found by sampling; and the data to draw f with its
// partial sums.
import {
  SolverError,
  asFraction,
  compile,
  derive,
  namesIn,
  niceNumber,
  numberText,
  read,
  show,
  type Node,
} from './expr';
import { samples, step, type Step, type XY } from './steps';

export interface SeriesInput {
  readonly f: string;
  /** The point to expand about; 0 gives the Maclaurin series. */
  readonly center: number;
  /** The highest power, from 1 to 20. */
  readonly order: number;
  /** Where to bound the remainder, or omitted for no bound. */
  readonly at?: number;
  /** The x range to draw. */
  readonly from: number;
  readonly to: number;
}

export interface SeriesResult {
  readonly steps: readonly Step[];
  /** The coefficient of (x - a)^k, for k from 0 to the order. */
  readonly coefficients: readonly number[];
  /** The polynomial as a person writes it, such as x − x^3/6. */
  readonly polynomial: string;
  readonly remainder: { readonly x: number; readonly bound: number; readonly actual: number } | null;
  readonly graph: { readonly f: readonly XY[]; readonly partials: readonly (readonly XY[])[] };
  /** P_k(x) for each order k. */
  readonly partial: (k: number, x: number) => number;
}

const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => String(n).replace(/\d/g, (d) => SUPER[Number(d)]);

/** 1/n for a whole n, which factorials need past the reach of a small fraction, or null. */
function reciprocal(c: number): [number, number] | null {
  const n = Math.round(1 / c);
  return n > 1 && Math.abs(1 / c - n) <= 1e-9 * n ? [1, n] : null;
}

/** The term c·(x − a)^k as it is written, with its sign separate. */
function termText(c: number, k: number, a: number): { negative: boolean; text: string } {
  const base = a === 0 ? 'x' : `(x ${a < 0 ? '+' : '−'} ${niceNumber(Math.abs(a))})`;
  const power = k === 0 ? '' : k === 1 ? base : `${base}^${k}`;
  const fraction = asFraction(Math.abs(c), 100_000, 1e-13) ?? reciprocal(Math.abs(c));
  let text: string;
  if (fraction && fraction[1] !== 1 && power) {
    const top = fraction[0] === 1 ? power : `${fraction[0]}·${power}`;
    text = `${top}/${fraction[1]}`;
  } else {
    const magnitude = fraction
      ? fraction[1] === 1
        ? String(fraction[0])
        : `${fraction[0]}/${fraction[1]}`
      : numberText(Math.abs(c));
    text = !power ? magnitude : magnitude === '1' ? power : `${magnitude}·${power}`;
  }
  return { negative: c < 0, text };
}

export function polynomialText(coefficients: readonly number[], a: number): string {
  let out = '';
  coefficients.forEach((c, k) => {
    if (Math.abs(c) < 1e-14) return;
    const { negative, text } = termText(c, k, a);
    out += out ? ` ${negative ? '−' : '+'} ${text}` : `${negative ? '−' : ''}${text}`;
  });
  return out || '0';
}

/** Expands f. Throws a SolverError when f or one of its derivatives is not defined at the center. */
export function taylor(input: SeriesInput): SeriesResult {
  const order = Math.round(input.order);
  if (!(order >= 1 && order <= 20)) throw new SolverError('series-order');
  const f = read(input.f);
  for (const used of namesIn(f)) if (used !== 'x') throw new SolverError('unknown-name', used);
  const a = input.center;
  const steps: Step[] = [
    step('seriesFormula', `f(x) ≈ Σ f⁽ᵏ⁾(${niceNumber(a)})/k!·(x − ${niceNumber(a)})^k, k = 0 … ${order}`),
  ];
  const coefficients: number[] = [];
  const derivatives: Node[] = [f];
  let current = f;
  for (let k = 0; k <= order + 1; k += 1) {
    if (k > 0) {
      current = derive(current, 'x');
      derivatives.push(current);
    }
    if (k > order) break;
    const value = compile(current, ['x'])([a]);
    if (!Number.isFinite(value)) throw new SolverError('series-undefined', niceNumber(a));
    coefficients.push(value / fact(k));
    const text = show(current);
    const label = k === 0 ? 'f' : `f${k <= 3 ? '′'.repeat(k) : `⁽${sup(k)}⁾`}`;
    steps.push(
      step(
        'seriesDerivative',
        `${text.length > 90 ? '' : `${label}(x) = ${text},  `}${label}(${niceNumber(a)}) = ${niceNumber(value)}`,
        { k: String(k) },
      ),
    );
  }
  const polynomial = polynomialText(coefficients, a);
  steps.push(step('seriesPolynomial', `P${sub(order)}(x) = ${polynomial}`));
  const partial = (k: number, x: number) => {
    let sum = 0;
    for (let i = Math.min(k, order); i >= 0; i -= 1) sum = sum * (x - a) + coefficients[i];
    return sum;
  };
  const fx = compile(f, ['x']);

  let remainder: SeriesResult['remainder'] = null;
  if (input.at !== undefined && Number.isFinite(input.at)) {
    const x = input.at;
    const next = compile(derivatives[order + 1], ['x']);
    const [lo, hi] = x < a ? [x, a] : [a, x];
    let M = 0;
    for (let i = 0; i <= 400; i += 1) M = Math.max(M, Math.abs(next([lo + ((hi - lo) * i) / 400])));
    // Sampling can miss the top of a peak between samples, so the bound is padded a little.
    M *= 1.001;
    const bound = (M * Math.abs(x - a) ** (order + 1)) / fact(order + 1);
    const actual = Math.abs(fx([x]) - partial(order, x));
    remainder = { x, bound, actual };
    steps.push(
      step(
        'seriesRemainder',
        `|R${sub(order)}(${niceNumber(x)})| ≤ M·|x − a|^${order + 1}/${order + 1}! = ${numberText(bound)}, with M = ${numberText(M)}`,
        {
          actual: numberText(actual),
        },
      ),
    );
  }
  const graph = {
    f: samples((x) => fx([x]), input.from, input.to),
    partials: Array.from({ length: order }, (_, i) => samples((x) => partial(i + 1, x), input.from, input.to)),
  };
  return { steps, coefficients, polynomial, remainder, graph, partial };
}

const sub = (n: number) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
