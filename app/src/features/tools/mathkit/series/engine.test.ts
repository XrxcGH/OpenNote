import { describe, expect, it } from 'vitest';
import { analyzePowerSeries, analyzeSeries } from './engine';

describe('series tests', () => {
  it('sum 1/n^2 converges (p = 2) to pi^2/6', () => {
    const r = analyzeSeries('1/n^2');
    expect(r.verdict).toBe('absolute');
    expect(r.steps.some((s) => s.key === 'pseriesConv')).toBe(true);
    expect(r.sum!).toBeCloseTo(Math.PI ** 2 / 6, 8);
    expect(r.sumLatex).toBe('\\frac{\\pi^{2}}{6}');
  });
  it('sum 1/n diverges', () => {
    const r = analyzeSeries('1/n');
    expect(r.verdict).toBe('diverges');
    expect(r.steps.some((s) => s.key === 'pseriesDiv')).toBe(true);
  });
  it('sum (-1)^n/n converges conditionally to -ln 2', () => {
    const r = analyzeSeries('(-1)^n/n');
    expect(r.verdict).toBe('conditional');
    expect(Math.abs(r.sum!)).toBeCloseTo(Math.LN2, 9);
    expect(r.sumLatex).toBe('-\\ln 2');
  });
  it('sum n!/n^n has ratio limit 1/e and converges', () => {
    const r = analyzeSeries('n!/n^n');
    expect(r.verdict).toBe('absolute');
    const ratio = r.steps.find((s) => s.key === 'ratio')!;
    expect(Number.parseFloat(ratio.vars!.limit)).toBeCloseTo(1 / Math.E, 4);
  });
  it('geometric series sums to a / (1 - r)', () => {
    const r = analyzeSeries('(1/2)^n', 0);
    expect(r.verdict).toBe('absolute');
    expect(r.sum!).toBeCloseTo(2, 12);
    expect(analyzeSeries('2^n', 0).verdict).toBe('diverges');
  });
  it('the n-th term test catches terms that do not vanish', () => {
    const r = analyzeSeries('n/(n+1)');
    expect(r.verdict).toBe('diverges');
    expect(r.steps.some((s) => s.key === 'nthDiverge')).toBe(true);
  });
  it('uses limit comparison for 1/(n^2+1)', () => {
    const r = analyzeSeries('1/(n^2+1)');
    expect(r.verdict).toBe('absolute');
    expect(r.sum!).toBeCloseTo((Math.PI / Math.tanh(Math.PI) - 1) / 2, 7);
  });
  it('uses the root test for (n/(2n+1))^n', () => {
    expect(analyzeSeries('(n/(2*n+1))^n').verdict).toBe('absolute');
  });
  it('rejects bad input with clear codes', () => {
    expect(() => analyzeSeries('')).toThrow();
    expect(() => analyzeSeries('1/m')).toThrow();
    expect(() => analyzeSeries('1/(n-1)', 1)).toThrow();
    expect(() => analyzeSeries('1/n', 1.5)).toThrow();
  });
});

describe('series that look like they fail the n-th term test but do not', () => {
  // Known from the p-series and Bertrand rules, and the alternating series test.
  const cases: [string, number, string][] = [
    ['1/n^1.01', 1, 'absolute'],
    ['sin(n)/n^2', 1, 'absolute'],
    ['ln(n)/n^2', 2, 'absolute'],
    ['1/(n*ln(n)^2)', 2, 'absolute'],
    ['n^5/1.01^n', 1, 'absolute'],
    ['(-1)^n/sqrt(n)', 1, 'conditional'],
    ['(-1)^n/ln(n)', 2, 'conditional'],
    ['1/(n*ln(n))', 2, 'diverges'],
    ['1/(n*ln(n)^0.5)', 2, 'diverges'],
    ['1/n^0.99', 1, 'diverges'],
    ['(-1)^n*(1+1/n)', 1, 'diverges'],
    ['cos(n)', 1, 'diverges'],
  ];
  it.each(cases)('%s from %i is %s', (term, start, verdict) => {
    expect(analyzeSeries(term, start).verdict).toBe(verdict);
  });
  it('1/(n ln n) is not called divergent because of a limit that is not zero', () => {
    const r = analyzeSeries('1/(n*ln(n))', 2);
    expect(r.steps.some((s) => s.key === 'nthDiverge')).toBe(false);
    expect(r.steps.some((s) => s.key === 'bertrandDiv')).toBe(true);
  });
  it('a terms-do-not-vanish verdict never reports a negative limit', () => {
    const r = analyzeSeries('n/(n+1)');
    expect(r.steps.find((s) => s.key === 'nthDiverge')!.vars!.limit.startsWith('-')).toBe(false);
  });
});

describe('power series', () => {
  it('sum x^n/n has R = 1 and interval [-1, 1)', () => {
    const r = analyzePowerSeries('x^n/n', '0', 1);
    expect(r.radius).toBeCloseTo(1, 6);
    expect(r.interval).toBe('[−1, 1)');
  });
  it('sum x^n/sqrt(n) has interval [-1, 1)', () => {
    expect(analyzePowerSeries('x^n/sqrt(n)', '0', 1).interval).toBe('[−1, 1)');
  });
  it('sum (x-2)^n/(3^n n^2) has R = 3 and interval [-1, 5]', () => {
    const r = analyzePowerSeries('(x-2)^n/(3^n*n^2)', '2', 1);
    expect(r.radius).toBeCloseTo(3, 6);
    expect(r.interval).toBe('[−1, 5]');
  });
  it('x^n/n! converges everywhere and n! x^n only at the center', () => {
    expect(analyzePowerSeries('x^n/n!', '0', 0).radius).toBe(Infinity);
    expect(analyzePowerSeries('n!*x^n', '0', 0).radius).toBe(0);
  });
  it('refuses a term that is not a power series about the center', () => {
    expect(() => analyzePowerSeries('sin(x)/n', '0', 1)).toThrow();
  });
});
