import '../text';
import { describe, expect, it } from 'vitest';

import { ControlError } from '../lib/errors';
import { analyzeChain, classify, gamblersRuin, queue } from './engine';

const errorCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ControlError) return e.code;
    throw e;
  }
  return 'none';
};

describe('discrete Markov chains', () => {
  it('finds the stationary distribution (5/6, 1/6) exactly', () => {
    const r = analyzeChain({ kind: 'discrete', matrix: '0.9 0.1\n0.5 0.5', steps: 1 });
    expect(r.stationary).toHaveLength(1);
    expect(r.stationary[0].map((c) => c.text)).toEqual(['5/6', '1/6']);
    // Independent check: π₁ · 0.1 = π₂ · 0.5 with π₁ + π₂ = 1.
    const pi2 = 0.1 / 0.6;
    expect(r.stationary[0][1].value).toBeCloseTo(pi2, 15);
    expect(r.irreducible).toBe(true);
    expect(r.classes[0].period).toBe(1);
  });

  it('gives mean first passage times for the two-state chain', () => {
    const r = analyzeChain({ kind: 'discrete', matrix: '0.9 0.1; 0.5 0.5' });
    expect(r.passage?.[0][1].text).toBe('10');
    expect(r.passage?.[1][0].text).toBe('2');
    expect(r.passage?.[0][0].text).toBe('6/5');
    expect(r.passage?.[1][1].text).toBe('6');
  });

  it('solves the gambler’s ruin: P(reach 10 from 3) = 3/10, expected duration 21', () => {
    const r = analyzeChain({ kind: 'discrete', matrix: gamblersRuin(10, '0.5'), steps: 1 });
    expect(r.absorbing).toEqual([0, 10]);
    const a = r.absorption;
    expect(a).toBeDefined();
    const row = a?.transient.indexOf(3) ?? -1;
    expect(a?.probabilities[row][1].text).toBe('3/10');
    expect(a?.probabilities[row][0].text).toBe('7/10');
    expect(a?.expected[row].text).toBe('21');
    // Independent: duration from i is i (N − i) for a fair game.
    a?.transient.forEach((s, i) => expect(a.expected[i].value).toBe(s * (10 - s)));
  });

  it('handles an unfair gambler’s ruin against the closed form', () => {
    const r = analyzeChain({ kind: 'discrete', matrix: gamblersRuin(5, '0.6'), steps: 1 });
    const q = 0.4 / 0.6;
    const exact = (i: number) => (1 - q ** i) / (1 - q ** 5);
    r.absorption?.transient.forEach((s, i) =>
      expect(r.absorption?.probabilities[i][1].value).toBeCloseTo(exact(s), 14),
    );
  });

  it('computes n-step probabilities exactly', () => {
    const r = analyzeChain({ kind: 'discrete', matrix: '0.9 0.1\n0.5 0.5', steps: 2, initial: '1 0' });
    // P² row 1 = (0.81 + 0.05, 0.09 + 0.05)
    expect(r.power?.matrix[0].map((c) => c.text)).toEqual(['43/50', '7/50']);
    expect(r.distribution?.[0].value).toBeCloseTo(0.86, 15);
  });

  it('switches to floating point for large step counts and approaches the stationary distribution', () => {
    const r = analyzeChain({ kind: 'discrete', matrix: '0.9 0.1\n0.5 0.5', steps: 5000 });
    expect(r.power?.matrix[1][0].value).toBeCloseTo(5 / 6, 12);
  });

  it('finds the period of a periodic chain', () => {
    const r = analyzeChain({ kind: 'discrete', matrix: '0 1\n1 0' });
    expect(r.classes[0].period).toBe(2);
    expect(r.stationary[0].map((c) => c.text)).toEqual(['1/2', '1/2']);
  });

  it('reports more than one closed class', () => {
    const cls = classify([
      [1, 0, 0],
      [0.5, 0, 0.5],
      [0, 0, 1],
    ]);
    expect(cls.filter((c) => c.closed)).toHaveLength(2);
    const r = analyzeChain({ kind: 'discrete', matrix: '1 0 0; 1/2 0 1/2; 0 0 1' });
    expect(r.stationary).toHaveLength(2);
    expect(r.steps.some((s) => s.key === 'markov.stationaryMany')).toBe(true);
  });

  it('rejects bad matrices with clear codes', () => {
    expect(errorCode(() => analyzeChain({ kind: 'discrete', matrix: '0.9 0.2\n0.5 0.5' }))).toBe('rowSumOne');
    expect(errorCode(() => analyzeChain({ kind: 'discrete', matrix: '1.5 -0.5\n0.5 0.5' }))).toBe(
      'negativeProbability',
    );
    expect(errorCode(() => analyzeChain({ kind: 'discrete', matrix: '1 0 0\n0 1 0' }))).toBe('notSquare');
    expect(errorCode(() => analyzeChain({ kind: 'discrete', matrix: '' }))).toBe('matrixEmpty');
    expect(errorCode(() => analyzeChain({ kind: 'discrete', matrix: 'a 1\n0 1' }))).toBe('matrixNumber');
    const big = Array.from({ length: 16 }, (_, i) =>
      Array.from({ length: 16 }, (__, j) => (i === j ? 1 : 0)).join(' '),
    );
    expect(errorCode(() => analyzeChain({ kind: 'discrete', matrix: big.join('\n') }))).toBe('tooManyStates');
    expect(errorCode(() => analyzeChain({ kind: 'discrete', matrix: '0.9 0.1\n0.5 0.5', initial: '0.5 0.6' }))).toBe(
      'initialSum',
    );
    expect(errorCode(() => gamblersRuin(10, '1.2'))).toBe('probabilityRange');
  });
});

describe('continuous Markov chains', () => {
  it('finds the stationary distribution of a two-state generator', () => {
    const r = analyzeChain({ kind: 'continuous', matrix: '-2 2\n3 -3', time: 0.5 });
    expect(r.stationary[0].map((c) => c.text)).toEqual(['3/5', '2/5']);
    expect(r.holding?.map((c) => c.value)).toEqual([0.5, 1 / 3]);
    // Independent closed form: P₀₀(t) = 3/5 + 2/5 e^{−5t}
    expect(r.power?.matrix[0][0].value).toBeCloseTo(0.6 + 0.4 * Math.exp(-2.5), 12);
  });

  it('fills a starred diagonal and gives the expected time to absorption', () => {
    // 0 → 1 at rate 1, 1 → 2 at rate 2, 2 absorbs: expected time from 0 is 1 + 1/2.
    const r = analyzeChain({ kind: 'continuous', matrix: '* 1 0\n0 * 2\n0 0 0' });
    expect(r.absorbing).toEqual([2]);
    expect(r.absorption?.expected.map((c) => c.text)).toEqual(['3/2', '1/2']);
  });

  it('rejects a generator whose rows do not sum to zero', () => {
    expect(errorCode(() => analyzeChain({ kind: 'continuous', matrix: '-2 1\n3 -3' }))).toBe('rowSumZero');
    expect(errorCode(() => analyzeChain({ kind: 'continuous', matrix: '1 -1\n3 -3' }))).toBe('negativeRate');
  });
});

describe('queues', () => {
  it('M/M/1 with ρ = 0.8 gives L = 4, Lq = 3.2, W = 5/μ', () => {
    for (const mu of [1, 2, 7.5]) {
      const r = queue({ lambda: 0.8 * mu, mu, servers: 1 });
      expect(r.rho).toBeCloseTo(0.8, 12);
      expect(r.l).toBeCloseTo(4, 9);
      expect(r.lq).toBeCloseTo(3.2, 9);
      expect(r.w).toBeCloseTo(5 / mu, 9);
      expect(r.wq).toBeCloseTo(4 / mu, 9);
      expect(r.pn[0]).toBeCloseTo(0.2, 12);
      expect(r.pn[3]).toBeCloseTo(0.2 * 0.8 ** 3, 12);
    }
  });

  it('M/M/2 agrees with the Erlang C formula worked by hand', () => {
    const r = queue({ lambda: 2, mu: 1.5, servers: 2 });
    const a = 2 / 1.5;
    const rho = a / 2;
    const p0 = 1 / (1 + a + (a * a) / (2 * (1 - rho)));
    const lq = (p0 * a * a * rho) / (2 * (1 - rho) ** 2);
    expect(r.p0).toBeCloseTo(p0, 12);
    expect(r.lq).toBeCloseTo(lq, 12);
    expect(r.l).toBeCloseTo(lq + a, 12);
    expect(r.pn[3]).toBeCloseTo((p0 * a ** 3) / (2 * 2), 12);
  });

  it('refuses an unstable or meaningless queue', () => {
    expect(errorCode(() => queue({ lambda: 1, mu: 1, servers: 1 }))).toBe('queueUnstable');
    expect(errorCode(() => queue({ lambda: -1, mu: 1, servers: 1 }))).toBe('ratesPositive');
    expect(errorCode(() => queue({ lambda: 1, mu: 2, servers: 0 }))).toBe('serversRange');
    // Huge but stable loads stay finite.
    const r = queue({ lambda: 150, mu: 1, servers: 160 });
    expect(Number.isFinite(r.l)).toBe(true);
  });
});
