import '../text';
import { describe, expect, it } from 'vitest';

import { ControlError } from '../lib/errors';
import { integrate } from '../lib/num';
import { normalCdf } from '../lib/special';
import {
  atLeastK,
  c4,
  capability,
  cChart,
  chartConstants,
  fitWeibull,
  inventory,
  lifeModel,
  operatingCharacteristic,
  pChart,
  rangeConstants,
  systemReliability,
  variablesChart,
} from './engine';

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ControlError) return e.code;
    throw e;
  }
  return 'none';
};

describe('validation cases', () => {
  it('three components of 0.9: series 0.729, two in parallel 0.99, 2-out-of-3 0.972', () => {
    expect(systemReliability('series(0.9, 0.9, 0.9)').reliability).toBeCloseTo(0.729, 12);
    expect(systemReliability('parallel(0.9, 0.9)').reliability).toBeCloseTo(0.99, 12);
    expect(systemReliability('kofn(2, 0.9, 0.9, 0.9)').reliability).toBeCloseTo(0.972, 12);
    // Independent: 3 r² (1 − r) + r³
    expect(atLeastK(2, [0.9, 0.9, 0.9])).toBeCloseTo(3 * 0.81 * 0.1 + 0.729, 14);
  });

  it('Weibull β = 2, η = 1000 h: R(500 h) = 0.77880', () => {
    const r = lifeModel({ model: 'weibull', beta: 2, eta: 1000, t: 500 });
    expect(Math.abs(r.r - 0.7788)).toBeLessThan(1e-5);
    expect(r.r).toBeCloseTo(Math.exp(-0.25), 14);
  });

  it('chart constants for n = 5', () => {
    const k = chartConstants(5);
    expect(Math.abs(k.d2 - 2.32593)).toBeLessThan(1e-4);
    expect(Math.abs(k.d3 - 0.86408)).toBeLessThan(1e-4);
    expect(Math.abs(k.a2 - 0.57682)).toBeLessThan(1e-4);
    expect(k.d3Lower).toBe(0);
    expect(Math.abs(k.d4Upper - 2.1145)).toBeLessThan(1e-4);
    expect(Math.abs(k.c4 - 0.93999)).toBeLessThan(1e-4);
  });

  it('capability: USL 10.5, LSL 9.5, mean 10.1, σ 0.1 gives Cp 1.6667, Cpk 1.3333', () => {
    const r = capability({ usl: 10.5, lsl: 9.5, mean: 10.1, sigma: 0.1 });
    expect(r.cp).toBeCloseTo(5 / 3, 12);
    expect(r.cpk).toBeCloseTo(4 / 3, 12);
    expect(r.fractionOut).toBeCloseTo(normalCdf(-6) + 1 - normalCdf(4), 14);
  });

  it('single sampling n = 50, c = 1, p = 0.02: Pa = 0.73577', () => {
    const r = operatingCharacteristic({ n: 50, c: 1, p: 0.02 });
    expect(Math.abs(r.pa - 0.73577)).toBeLessThan(1e-5);
    expect(r.pa).toBeCloseTo(0.98 ** 50 + 50 * 0.02 * 0.98 ** 49, 14);
  });

  it('EOQ 223.61 and safety stock 32.90', () => {
    const r = inventory({
      demand: 1000,
      orderCost: 50,
      holdingCost: 2,
      service: 0.95,
      dailyMean: 1000 / 365,
      dailySd: 10,
      leadDays: 4,
    });
    expect(Math.abs(r.eoq - 223.61)).toBeLessThan(1e-2);
    expect(r.eoq).toBeCloseTo(Math.sqrt(50000), 12);
    expect(Math.abs((r.safetyStock ?? 0) - 32.9)).toBeLessThan(1e-2);
    expect(r.safetyStock).toBeCloseTo(1.6448536269514722 * 20, 8);
    expect(r.annualCost).toBeCloseTo(2 * Math.sqrt(50000), 9);
  });
});

describe('reliability', () => {
  it('reads nested diagrams and timed components', () => {
    const r = systemReliability('series(0.95, parallel(0.9, 0.8), kofn(2, 0.9, 0.85, 0.8))');
    const expected = 0.95 * (1 - 0.1 * 0.2) * (0.9 * 0.85 + 0.9 * 0.8 + 0.85 * 0.8 - 2 * 0.9 * 0.85 * 0.8);
    expect(r.reliability).toBeCloseTo(expected, 14);
  });

  it('MTTF of a parallel pair of exponentials is 1/λ₁ + 1/λ₂ − 1/(λ₁ + λ₂)', () => {
    const r = systemReliability('parallel(exp(0.001), exp(0.002))', 100);
    expect(r.mttf).toBeCloseTo(1000 + 500 - 1000 / 3, 4);
    expect(r.reliability).toBeCloseTo(1 - (1 - Math.exp(-0.1)) * (1 - Math.exp(-0.2)), 14);
    expect(r.curve?.r[0]).toBe(1);
  });

  it('exponential series hazard is the sum of rates', () => {
    const r = systemReliability('series(exp(0.01), exp(0.03))', 5);
    expect(r.mttf).toBeCloseTo(25, 6);
    expect(r.curve?.h[50]).toBeCloseTo(0.04, 5);
  });

  it('life model extras: Weibull MTTF, B10 life and conditional reliability', () => {
    const r = lifeModel({ model: 'weibull', beta: 2, eta: 1000, t: 500, extra: 100 });
    expect(r.mttf).toBeCloseTo(500 * Math.sqrt(Math.PI), 9);
    expect(r.b10).toBeCloseTo(1000 * Math.sqrt(-Math.log(0.9)), 9);
    expect(r.conditional).toBeCloseTo(Math.exp(-0.36) / Math.exp(-0.25), 14);
    expect(r.hazard).toBeCloseTo((2 / 1000) * 0.5, 14);
    const e = lifeModel({ model: 'exp', lambda: 0.002, t: 300 });
    expect(e.r).toBeCloseTo(Math.exp(-0.6), 14);
    expect(e.mttf).toBe(500);
  });

  it('fits a Weibull to exact quantiles', () => {
    // Times at the median-rank quantiles of a Weibull(1.8, 500) are fitted back exactly.
    const n = 8;
    const times = Array.from({ length: n }, (_, i) => 500 * (-Math.log(1 - (i + 1 - 0.3) / (n + 0.4))) ** (1 / 1.8));
    const f = fitWeibull(times);
    expect(f.beta).toBeCloseTo(1.8, 10);
    expect(f.eta).toBeCloseTo(500, 8);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('rejects bad diagrams and inputs', () => {
    expect(code(() => systemReliability('series(0.9, 1.2)'))).toBe('reliabilityRange');
    expect(code(() => systemReliability('series(0.9, 0.9'))).toBe('diagramSyntax');
    expect(code(() => systemReliability('kofn(4, 0.9, 0.9, 0.9)'))).toBe('kRange');
    expect(code(() => systemReliability(''))).toBe('diagramEmpty');
    expect(code(() => systemReliability('exp(-1)'))).toBe('ratePositive');
    expect(code(() => systemReliability('banana(1)'))).toBe('diagramSyntax');
    expect(code(() => lifeModel({ model: 'weibull', beta: 0, eta: 1, t: 1 }))).toBe('weibullPositive');
    expect(code(() => fitWeibull([1, 2]))).toBe('needThree');
    expect(code(() => fitWeibull([1, -2, 3]))).toBe('timesPositive');
  });
});

describe('control charts', () => {
  it('d2 for n = 2 is 2/√π and d3 is √(2 − d2²)', () => {
    const { d2, d3 } = rangeConstants(2);
    expect(d2).toBeCloseTo(2 / Math.sqrt(Math.PI), 9);
    expect(d3).toBeCloseTo(Math.sqrt(2 - 4 / Math.PI), 7);
  });

  it('d2 for n = 3 is 3/√π and d2 grows with n', () => {
    expect(rangeConstants(3).d2).toBeCloseTo(3 / Math.sqrt(Math.PI), 9);
    expect(rangeConstants(10).d2).toBeGreaterThan(rangeConstants(9).d2);
  });

  it('c4 equals E[s]/σ by direct integration over the chi distribution', () => {
    const n = 4;
    const k = n - 1;
    // E[s] = σ E[√(χ²_k / k)]
    const pdf = (x: number) =>
      Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.LN2) / (Math.sqrt(Math.PI) / 2);
    const es = integrate((x) => Math.sqrt(x / k) * pdf(x), 0, 200, 1e-12);
    expect(c4(n)).toBeCloseTo(es, 9);
  });

  it('x̄–R limits from subgroups', () => {
    const groups = [
      [10, 12, 11, 13, 9],
      [11, 11, 12, 10, 12],
      [12, 13, 11, 12, 14],
      [9, 10, 11, 10, 10],
    ];
    const r = variablesChart(groups, 'r');
    const k = chartConstants(5);
    const rbar = (4 + 2 + 3 + 2) / 4;
    const grand = (11 + 11.2 + 12.4 + 10) / 4;
    expect(r.charts[0].center).toBeCloseTo(grand, 12);
    expect(r.charts[0].ucl[0]).toBeCloseTo(grand + k.a2 * rbar, 12);
    expect(r.charts[1].ucl[0]).toBeCloseTo(k.d4Upper * rbar, 12);
    const s = variablesChart(groups, 's');
    expect(s.charts[1].id).toBe('s');
    expect(
      code(() =>
        variablesChart(
          [
            [1, 2],
            [1, 2, 3],
          ],
          'r',
        ),
      ),
    ).toBe('subgroupEqual');
  });

  it('p chart with varying sample sizes and a c chart that flags a point', () => {
    const p = pChart([3, 5, 2, 14], [100, 120, 80, 100]);
    const pbar = 24 / 400;
    expect(p.charts[0].center).toBeCloseTo(pbar, 14);
    expect(p.charts[0].ucl[1]).toBeCloseTo(pbar + 3 * Math.sqrt((pbar * (1 - pbar)) / 120), 14);
    expect(p.charts[0].out).toEqual([3]);
    const c = cChart([2, 3, 4, 2, 3, 15]);
    expect(c.charts[0].center).toBeCloseTo(29 / 6, 14);
    expect(c.charts[0].out).toEqual([5]);
    expect(code(() => pChart([3, 200], [100, 100]))).toBe('defectivesRange');
  });
});

describe('capability, sampling and inventory edge cases', () => {
  it('rejects impossible inputs', () => {
    expect(code(() => capability({ usl: 9, lsl: 10, mean: 9.5, sigma: 0.1 }))).toBe('specOrder');
    expect(code(() => capability({ usl: 11, lsl: 10, mean: 9.5, sigma: 0 }))).toBe('sdPositive');
    expect(code(() => operatingCharacteristic({ n: 50, c: 60, p: 0.02 }))).toBe('acceptRange');
    expect(code(() => operatingCharacteristic({ n: 50, c: 1, p: 1.5 }))).toBe('probabilityRange');
    expect(code(() => inventory({ demand: 0, orderCost: 50, holdingCost: 2 }))).toBe('inventoryPositive');
    expect(
      code(() => inventory({ demand: 10, orderCost: 50, holdingCost: 2, service: 1, dailySd: 1, leadDays: 1 })),
    ).toBe('serviceRange');
  });

  it('AOQ falls back to zero at both ends of the OC curve', () => {
    const r = operatingCharacteristic({ n: 50, c: 1, p: 0.02, lot: 1000 });
    expect(r.curve.aoq[0]).toBe(0);
    expect(r.aoq).toBeCloseTo(r.pa * 0.02 * 0.95, 14);
    expect(r.aoql).toBeGreaterThan(r.aoq);
  });

  it('huge demand stays finite', () => {
    expect(Number.isFinite(inventory({ demand: 1e15, orderCost: 1e6, holdingCost: 1e-3 }).eoq)).toBe(true);
  });
});
