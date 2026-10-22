// Textbook problems with their answers: derivatives, integrals, limits, and sums, typed as plain text (as on a line
// of a page) and as LaTeX (as in an equation or from handwriting). A derivative or an antiderivative is checked by
// its values against the textbook's answer (an antiderivative may differ by a constant); a number is checked as text.
import { describe, expect, it } from 'vitest';
import type { Node } from '../../../core/expr';
import { calculusAnswer } from './index';
import { evaluator, parameterValues } from './numeric';
import { expression } from './read';

const POINTS = [0.3, 0.55, 0.8, 1.15, 1.6, 2.2];

function parsed(text: string): Node {
  return expression(text.replace(/·/g, '*').replace(/\s*\+ C$/, ''), 'text');
}

/** True when a - b is the same constant at every point where both are defined. */
function differByConstant(a: Node, b: Node, x: string, names: string[], constant: boolean): boolean {
  const [f, g] = [evaluator(a), evaluator(b)];
  const fixed = parameterValues(names, x);
  const gaps = POINTS.map((p) => f({ ...fixed, [x]: p }) - g({ ...fixed, [x]: p })).filter(Number.isFinite);
  if (gaps.length < 3) return false;
  return gaps.every((gap) => Math.abs(gap - (constant ? gaps[0] : 0)) < 1e-7 * Math.max(1, Math.abs(gaps[0])));
}

function solved(source: string, mode: 'text' | 'latex' = 'text') {
  const found = calculusAnswer(source, { mode });
  expect(found, source).not.toBeNull();
  const result = found!.solved;
  expect(result.ok, `${source}: ${result.ok ? '' : result.reason}`).toBe(true);
  return result as Extract<typeof result, { ok: true }>;
}

const DERIVATIVES: [string, string][] = [
  ['d/dx(x^3) =', '3x^2'],
  ['d/dx(5x^4 - 3x^2 + 7x - 2) =', '20x^3 - 6x + 7'],
  ['d/dx(sqrt(x)) =', '1/(2sqrt(x))'],
  ['d/dx(1/x^2) =', '-2/x^3'],
  ['d/dx(x^2 sin(x)) =', '2x sin(x) + x^2 cos(x)'],
  ['d/dx(x e^x) =', 'e^x + x e^x'],
  ['d/dx((x^2+1)/(x-1)) =', '(x^2 - 2x - 1)/(x - 1)^2'],
  ['d/dx(sin(x)/x) =', '(x cos(x) - sin(x))/x^2'],
  ['d/dx((3x+1)^5) =', '15(3x+1)^4'],
  ['d/dx(sin(x^2)) =', '2x cos(x^2)'],
  ['d/dx(cos(3x)) =', '-3sin(3x)'],
  ['d/dx(tan(x)) =', 'sec(x)^2'],
  ['d/dx(e^(2x)) =', '2e^(2x)'],
  ['d/dx(ln(x^2+1)) =', '2x/(x^2+1)'],
  ['d/dx(ln(x)) =', '1/x'],
  ['d/dx(arctan(x)) =', '1/(1+x^2)'],
  ['d/dx(arcsin(x)) =', '1/sqrt(1-x^2)'],
  ['d/dx(2^x) =', '2^x ln(2)'],
  ['d/dx(sqrt(x^2+1)) =', 'x/sqrt(x^2+1)'],
  ['d/dx(e^(-x^2)) =', '-2x e^(-x^2)'],
  ['d/dx(x ln(x) - x) =', 'ln(x)'],
  ['d/dx(sin(x)cos(x)) =', 'cos(x)^2 - sin(x)^2'],
  ['d/dx(sec(x)) =', 'sec(x)tan(x)'],
  ['d^2/dx^2(x^4) =', '12x^2'],
  ['d²/dx²(sin(x)) =', '-sin(x)'],
  ['∂/∂x(x^2 y + y^3) =', '2x y'],
  ['d/dt(t^3 - 4t) =', '3t^2 - 4'],
  ['d/dx(a x^2 + b x) =', '2a x + b'],
];

const INTEGRALS: [string, string][] = [
  ['∫ x^2 dx =', 'x^3/3'],
  ['∫ (3x^2 + 2x + 1) dx =', 'x^3 + x^2 + x'],
  ['∫ 1/x dx =', 'ln(abs(x))'],
  ['∫ sqrt(x) dx =', '2/3 x^(3/2)'],
  ['∫ 1/x^3 dx =', '-1/(2x^2)'],
  ['∫ e^(3x) dx =', 'e^(3x)/3'],
  ['∫ sin(2x) dx =', '-cos(2x)/2'],
  ['∫ cos(x) dx =', 'sin(x)'],
  ['∫ sec(x)^2 dx =', 'tan(x)'],
  ['∫ 1/(1+x^2) dx =', 'arctan(x)'],
  ['∫ 1/sqrt(1-x^2) dx =', 'arcsin(x)'],
  ['∫ (2x+1)^4 dx =', '(2x+1)^5/10'],
  ['∫ 2x cos(x^2) dx =', 'sin(x^2)'],
  ['∫ x e^(x^2) dx =', 'e^(x^2)/2'],
  ['∫ x/(x^2+1) dx =', 'ln(x^2+1)/2'],
  ['∫ ln(x)/x dx =', 'ln(x)^2/2'],
  ['∫ sin(x)^3 cos(x) dx =', 'sin(x)^4/4'],
  ['∫ x sqrt(x+1) dx =', '2/5 (x+1)^(5/2) - 2/3 (x+1)^(3/2)'],
  ['∫ x e^x dx =', 'x e^x - e^x'],
  ['∫ x^2 e^x dx =', '(x^2 - 2x + 2) e^x'],
  ['∫ x sin(x) dx =', 'sin(x) - x cos(x)'],
  ['∫ ln(x) dx =', 'x ln(x) - x'],
  ['∫ x ln(x) dx =', 'x^2 ln(x)/2 - x^2/4'],
  ['∫ arctan(x) dx =', 'x arctan(x) - ln(1+x^2)/2'],
  ['∫ e^x sin(x) dx =', 'e^x (sin(x) - cos(x))/2'],
  ['∫ 1/(x^2-1) dx =', 'ln(abs(x-1))/2 - ln(abs(x+1))/2'],
  ['∫ (3x+5)/((x+1)(x+2)) dx =', '2ln(abs(x+1)) + ln(abs(x+2))'],
  ['∫ 1/(x(x+1)^2) dx =', 'ln(abs(x)) - ln(abs(x+1)) + 1/(x+1)'],
  ['∫ (x^3 + x)/(x - 1) dx =', 'x^3/3 + x^2/2 + 2x + 2ln(abs(x-1))'],
  ['∫ 1/(x^2+2x+5) dx =', 'arctan((x+1)/2)/2'],
  ['∫ sin(x)^2 dx =', 'x/2 - sin(2x)/4'],
  ['∫ cos(x)^2 dx =', 'x/2 + sin(2x)/4'],
  ['∫ sin(x)^3 dx =', 'cos(x)^3/3 - cos(x)'],
  ['∫ tan(x)^2 dx =', 'tan(x) - x'],
  ['∫ tan(x) dx =', '-ln(abs(cos(x)))'],
  ['∫ sec(x) dx =', 'ln(abs(sec(x)+tan(x)))'],
  ['∫ sec(x)^2 tan(x) dx =', 'tan(x)^2/2'],
  ['∫ sin(3x) cos(x) dx =', '-cos(4x)/8 - cos(2x)/4'],
  ['∫ sin(x) cos(x) dx =', 'sin(x)^2/2'],
  ['∫ 2^x dx =', '2^x/ln(2)'],
  ['∫ (x+1) e^x dx =', 'x e^x'],
  ['∫ 5 dx =', '5x'],
  ['int t^2 dt =', 't^3/3'],
];

const VALUES: [string, string][] = [
  ['∫_0^1 x^2 dx =', '1/3 ≈ 0.333333'],
  ['∫_0^π sin(x) dx =', '2'],
  ['∫_1^e 1/x dx =', '1'],
  ['∫_0^1 e^x dx =', 'e - 1 ≈ 1.71828'],
  ['∫_0^1 1/(1+x^2) dx =', 'π/4 ≈ 0.785398'],
  ['∫_1^∞ 1/x^2 dx =', '1'],
  ['∫_0^1 e^(-x^2) dx =', '≈ 0.746824'],
  ['∫_-1^2 (x^2 - 1) dx =', '0'],
  ['lim_(x→0) sin(x)/x =', '1'],
  ['lim_(x→0) (1 - cos(x))/x^2 =', '1/2 ≈ 0.5'],
  ['lim_(x→2) (x^2 - 4)/(x - 2) =', '4'],
  ['lim_(x→∞) (3x^2 + 1)/(2x^2 - x) =', '3/2 ≈ 1.5'],
  ['lim_(x→∞) (1 + 1/x)^x =', 'e ≈ 2.71828'],
  ['lim_(x→0^+) 1/x =', '∞'],
  ['lim_(x→3) x^2 + 1 =', '10'],
  ['lim x->0 (e^x - 1)/x =', '1'],
  ['lim_(x→∞) x e^(-x) =', '0'],
  ['sum_(n=1)^10 n^2 =', '385'],
  ['Σ_(n=1)^100 n =', '5050'],
  ['Σ_(n=0)^∞ (1/2)^n =', '2'],
  ['Σ_(n=1)^∞ 1/n^2 =', 'π^2/6 ≈ 1.64493'],
  ['Σ_(n=1)^∞ 1/3^n =', '1/2 ≈ 0.5'],
];

const LATEX: [string, string][] = [
  ['\\frac{d}{dx}\\left(x^{3}\\sin x\\right)=', 'x^3 cos(x) + 3x^2 sin(x)'],
  ['\\frac{d}{dx}x^{2}=', '2x'],
  ['\\int x^{2}\\,dx=', 'x^3/3 + C'],
  ['\\int_{0}^{1}x^{2}dx=', '1/3 ≈ 0.333333'],
  ['\\int\\frac{1}{x}dx=', 'ln|x| + C'],
  ['\\lim_{x\\to0}\\frac{\\sin x}{x}=', '1'],
  ['\\sum_{n=1}^{\\infty}\\frac{1}{n^{2}}=', 'π^2/6 ≈ 1.64493'],
  ['\\frac{\\partial}{\\partial y}\\left(x^{2}y^{3}\\right)=', '3x^2 y^2'],
  ["f(x)=x^{3}\\\\f'(x)=", '3x^2'],
  ['\\int e^{2x}dx=', 'e^(2x)/2 + C'],
];

describe('calculus corpus', () => {
  it.each(DERIVATIVES)('%s', (source, expected) => {
    const result = solved(source);
    const x = /d\/d([a-z])|∂\/∂([a-z])|d²\/d([a-z])/.exec(source)?.slice(1).find(Boolean) ?? 'x';
    const names = ['a', 'b', 'y'];
    expect(differByConstant(parsed(result.answer.text), parsed(expected), x, names, false), result.answer.text).toBe(
      true,
    );
  });

  it.each(INTEGRALS)('%s', (source, expected) => {
    const result = solved(source);
    expect(result.answer.text.endsWith('+ C')).toBe(true);
    const x = /d([a-z])\s*=/.exec(source)?.[1] ?? 'x';
    expect(differByConstant(parsed(result.answer.text), parsed(expected), x, [], true), result.answer.text).toBe(true);
  });

  it.each(VALUES)('%s', (source, expected) => {
    expect(solved(source).answer.text).toBe(expected);
  });

  it.each(LATEX)('%s', (source, expected) => {
    const result = solved(source, 'latex');
    if (/[≈∞]/.test(expected) || /^\d+$/.test(expected)) expect(result.answer.text).toBe(expected);
    else {
      const x = /partial ([a-z])/.exec(source)?.[1] ?? 'x';
      const isIntegral = source.includes('\\int');
      const close = differByConstant(parsed(result.answer.text), parsed(expected), x, ['x', 'y'], isIntegral);
      expect(close, result.answer.text).toBe(true);
    }
  });
});

describe('questions that have no answer', () => {
  it.each([
    ['∫ e^(-x^2) dx =', 'notInTable'],
    ['∫ sin(x)/x dx =', 'notInTable'],
    ['lim_(x→0) 1/x =', 'noLimit'],
    ['Σ_(n=1)^∞ 1/n =', 'diverges'],
    ['∫_-1^1 1/x dx =', 'undefinedOnInterval'],
    ['∫_1^∞ 1/x dx =', 'diverges'],
  ])('%s says %s', (source, reason) => {
    const found = calculusAnswer(source, { mode: 'text' })!;
    expect(found.solved.ok).toBe(false);
    expect(found.solved.ok ? '' : found.solved.reason).toBe(reason);
  });

  it('leaves ordinary lines and equations alone', () => {
    for (const source of ['rent = 1200', 'x + 2 = 5', 'd = 4', 'the integral of x', 'lim =', '2 + 2 =']) {
      expect(calculusAnswer(source, { mode: 'text' }), source).toBeNull();
    }
  });
});
