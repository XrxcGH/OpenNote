import { describe, expect, it } from 'vitest';
import { CPI_FIRST_YEAR, CPI_U, cpiFor } from './cpi';
import type { EconForm, Values } from './forms';
import {
  FEDERAL,
  adjust,
  cagr,
  chain,
  dimensionIndex,
  doubling,
  gini,
  hdi,
  inequality,
  leontief,
  locationQuotients,
  lorenz,
  poverty,
  priceIndexes,
  segregation,
  shiftShare,
  taxOn,
} from './measures';
import { MEASURES } from './measuresForms';

describe('price indexes and adjustment', () => {
  it('computes Laspeyres, Paasche and Fisher', () => {
    const r = priceIndexes([2, 5], [10, 4], [3, 6], [8, 5])!;
    expect(r.laspeyres).toBeCloseTo(1.35, 12);
    expect(r.paasche).toBeCloseTo(54 / 41, 12);
    expect(r.fisher).toBeCloseTo(1.33343, 5);
  });
  it('rejects baskets of different lengths or no spending', () => {
    expect(priceIndexes([2, 5], [10], [3, 6], [8, 5])).toBeNull();
    expect(priceIndexes([0, 0], [10, 4], [3, 6], [8, 5])).toBeNull();
  });
  it('chains links and adjusts for inflation', () => {
    expect(chain([1.1, 1.1])[2]).toBeCloseTo(121, 9);
    expect(adjust(100, 130.7, 258.811)).toBeCloseTo(198.02, 2);
    expect(adjust(100, 0, 5)).toBeNull();
  });
  it('bundles the CPI series from 1913 with the published anchors', () => {
    expect(CPI_FIRST_YEAR).toBe(1913);
    expect(cpiFor(1990)).toBeCloseTo(130.7, 6);
    expect(cpiFor(2020)).toBeCloseTo(258.811, 6);
    expect(cpiFor(1900)).toBeNull();
    expect(CPI_U.every((x) => x > 0)).toBe(true);
  });
  it('computes growth', () => {
    expect(cagr(100, 200, 10)).toBeCloseTo(0.0717735, 6);
    expect(cagr(0, 200, 10)).toBeNull();
    expect(doubling(7)!.rule).toBe(10);
    expect(doubling(7)!.exact).toBeCloseTo(10.2448, 4);
    expect(doubling(0)).toBeNull();
  });
});

describe('inequality and poverty', () => {
  it('computes Gini, Theil and the others for 10, 20, 30, 40', () => {
    expect(gini([10, 20, 30, 40])).toBeCloseTo(0.25, 12);
    const r = inequality([10, 20, 30, 40], 1)!;
    expect(r.theilT).toBeCloseTo(0.10644, 5);
    expect(r.theilL).toBeCloseTo(Math.log(25) - (Math.log(10) + Math.log(20) + Math.log(30) + Math.log(40)) / 4, 12);
    expect(r.atkinson).toBeCloseTo(
      1 - Math.exp((Math.log(10) + Math.log(20) + Math.log(30) + Math.log(40)) / 4) / 25,
      12,
    );
    expect(r.p90p10).toBeCloseTo(37 / 13, 9);
    expect(r.palma).toBeNull();
  });
  it('is zero for equality and weights groups', () => {
    expect(gini([5, 5, 5])).toBe(0);
    expect(gini([10, 40], [1, 1])).toBeCloseTo(0.3, 12);
    expect(gini([10, 40], [3, 1])).toBeCloseTo(gini([10, 10, 10, 40])!, 12);
    expect(gini([])).toBeNull();
    expect(gini([-1, 2])).toBeNull();
  });
  it('gives the Lorenz curve', () => {
    expect(lorenz([10, 30])).toEqual([
      [0, 0],
      [0.5, 0.25],
      [1, 1],
    ]);
  });
  it('gives the Palma ratio for ten people', () => {
    const r = inequality([1, 1, 1, 1, 2, 2, 2, 2, 2, 10], 0.5)!;
    expect(r.palma).toBeCloseTo(10 / 4, 12);
  });
  it('computes the FGT measures at a line of 25', () => {
    const p = poverty([10, 20, 30, 40], 25)!;
    expect(p.headcount).toBe(0.5);
    expect(p.gap).toBeCloseTo(0.2, 12);
    expect(p.squaredGap).toBeCloseTo(0.1, 12);
    expect(poverty([10], 0)).toBeNull();
  });
});

describe('segregation and regional analysis', () => {
  it('computes dissimilarity of 0.5', () => {
    const s = segregation([10, 20, 70], [50, 30, 20])!;
    expect(s.dissimilarity).toBeCloseTo(0.5, 12);
    expect(s.exposureAToB + s.isolationA).toBeCloseTo(1, 12);
  });
  it('is zero when groups are spread alike and one when apart', () => {
    expect(segregation([10, 10], [20, 20])!.dissimilarity).toBe(0);
    const apart = segregation([10, 0], [0, 10])!;
    expect(apart.dissimilarity).toBe(1);
    expect(apart.entropy).toBeCloseTo(1, 12);
    expect(segregation([1], [1])).toBeNull();
  });
  it('computes location quotients', () => {
    const lq = locationQuotients([30, 70], [100, 400])!;
    expect(lq[0]).toBeCloseTo(0.3 / 0.2, 12);
    expect(lq[1]).toBeCloseTo(0.7 / 0.8, 12);
  });
  it('decomposes regional change exactly', () => {
    const s = shiftShare([100, 200], [130, 210], [1000, 2000], [1200, 2100])!;
    expect(s.totals.national).toBeCloseTo(300 * (3300 / 3000 - 1), 9);
    expect(s.totals.national + s.totals.mix + s.totals.competitive).toBeCloseTo(s.totals.change, 9);
    expect(s.mix[0]).toBeCloseTo(100 * (0.2 - 0.1), 9);
    expect(s.competitive[0]).toBeCloseTo(130 - 120, 9);
  });
  it('inverts the Leontief matrix', () => {
    const r = leontief([
      [0.2, 0.3],
      [0.4, 0.1],
    ])!;
    expect(r.inverse[0][0]).toBeCloseTo(1.5, 9);
    expect(r.inverse[0][1]).toBeCloseTo(0.5, 9);
    expect(r.inverse[1][0]).toBeCloseTo(2 / 3, 9);
    expect(r.inverse[1][1]).toBeCloseTo(4 / 3, 9);
    expect(r.multipliers[0]).toBeCloseTo(2.16667, 5);
    expect(r.multipliers[1]).toBeCloseTo(1.83333, 5);
    expect(leontief([[1]])).toBeNull();
  });
});

describe('HDI and taxes', () => {
  it('computes the HDI of 0.9, 0.8, 0.85', () => {
    expect(hdi(0.9, 0.8, 0.85)).toBeCloseTo(0.84902, 5);
    expect(hdi(0, 0.8, 0.85)).toBeNull();
  });
  it('builds dimension indices from goalposts', () => {
    expect(dimensionIndex(52.5, 20, 85)).toBeCloseTo(0.5, 12);
    expect(dimensionIndex(1000, 100, 10000, true)).toBeCloseTo(0.5, 12);
    expect(dimensionIndex(200000, 100, 10000, true)).toBe(1);
    expect(dimensionIndex(5, 10, 5)).toBeNull();
  });
  it('taxes 50 000 in three brackets', () => {
    const t = taxOn(50000, [
      { from: 0, rate: 0.1 },
      { from: 10000, rate: 0.2 },
      { from: 40000, rate: 0.3 },
    ])!;
    expect(t.tax).toBeCloseTo(10000, 9);
    expect(t.average).toBeCloseTo(0.2, 12);
    expect(t.marginal).toBe(0.3);
  });
  it('rejects a schedule that does not start at zero', () => {
    expect(taxOn(100, [{ from: 5, rate: 0.1 }])).toBeNull();
    expect(taxOn(-1, [{ from: 0, rate: 0.1 }])).toBeNull();
  });
  it('reproduces a hand-computed federal tax', () => {
    // 60 000 single, 2024: 1160 + 12% of 35 550 + 22% of 12 850
    const t = taxOn(60000, FEDERAL.single)!;
    expect(t.tax).toBeCloseTo(1160 + 4266 + 2827, 6);
  });
});

function run(id: string, text: Record<string, string> = {}) {
  const form = MEASURES.forms.find((f) => f.id === id) as EconForm;
  const initial: Values = { text: {}, unit: {} };
  const fields = typeof form.fields === 'function' ? form.fields(initial) : form.fields;
  const base = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options?.[0]?.value : '') ?? '']),
  );
  return form.solve({ text: { ...base, ...text }, unit: {} });
}
const headline = (o: ReturnType<typeof run>) => (o.ok ? o.headline : o.message);

describe('measure forms', () => {
  it('words the answers', () => {
    expect(headline(run('index'))).toMatch(/Laspeyres index is 1\.35/);
    expect(headline(run('real'))).toMatch(/198\.02/);
    expect(headline(run('inequality'))).toMatch(/Gini 0\.25/);
    expect(headline(run('segregation'))).toMatch(/0\.5/);
    expect(headline(run('tax'))).toMatch(/10,000/);
    expect(headline(run('hdi'))).toMatch(/0\.849/);
  });
  it('explains impossible input', () => {
    expect(headline(run('index', { q0: '1' }))).toMatch(/same number/i);
    expect(headline(run('real', { from: '1900' }))).toMatch(/1913/);
    expect(headline(run('inequality', { values: '' }))).toMatch(/incomes/i);
  });
  it('cuts the Palma shares inside a person when n is not a multiple of 10', () => {
    // 1..25 sum to 325. Poorest 40% = 10 people = 55. Poorest 90% = 22 people (253) + half of the 23rd (11.5).
    const r = inequality(
      Array.from({ length: 25 }, (_, i) => i + 1),
      0.5,
    )!;
    expect(r.palma).toBeCloseTo(60.5 / 55, 12);
  });
});
