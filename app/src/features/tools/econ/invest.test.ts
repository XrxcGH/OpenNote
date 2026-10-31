import { describe, expect, it } from 'vitest';
import type { EconForm, Values } from './forms';
import {
  accruedInterest,
  binomialTree,
  blackScholes,
  bondPrice,
  bondRisk,
  bondYield,
  bootstrap,
  capm,
  covarianceFrom,
  dcf,
  dilution,
  gbmPaths,
  gordon,
  impliedVolatility,
  minimumVariance,
  normalCdf,
  poolShuffle,
  portfolioStats,
  postMoney,
  priceChange,
  returnsFrom,
  safeConversion,
  strategy,
  tangency,
  twoAssetMinVariance,
  ventureMethod,
  wacc,
} from './invest';
import { INVEST } from './investForms';

const bond = { face: 1000, coupon: 0.05, years: 10, frequency: 1 };
const option = { spot: 100, strike: 100, rate: 0.05, vol: 0.2, time: 1, dividend: 0 };

describe('bonds', () => {
  it('prices a 10-year 5% bond at 6%', () => {
    expect(bondPrice(bond, 0.06)).toBeCloseTo(926.4, 1);
    const risk = bondRisk(bond, 0.06)!;
    expect(risk.macaulay).toBeCloseTo(8.0225, 3);
    expect(risk.modified).toBeCloseTo(7.5684, 3);
  });
  it('prices at par when the yield equals the coupon', () => {
    expect(bondPrice(bond, 0.05)).toBeCloseTo(1000, 9);
    expect(bondPrice({ ...bond, frequency: 2 }, 0.05)).toBeCloseTo(1000, 9);
  });
  it('finds the yield to maturity', () => {
    expect(bondYield({ face: 1000, coupon: 0.04, years: 5, frequency: 1 }, 950)).toBeCloseTo(0.0516, 4);
    expect(bondYield(bond, 1000)).toBeCloseTo(0.05, 10);
    expect(bondYield(bond, -5)).toBeNull();
  });
  it('approximates a price change with duration and convexity', () => {
    const risk = bondRisk(bond, 0.06)!;
    const exact = bondPrice(bond, 0.07)! / risk.price - 1;
    expect(priceChange(risk, 0.01)).toBeCloseTo(exact, 3);
    expect(Math.abs(priceChange(risk, 0.01) - exact)).toBeLessThan(Math.abs(-risk.modified * 0.01 - exact));
  });
  it('rejects a term that is not a whole number of periods', () => {
    expect(bondPrice({ ...bond, years: 2.3 }, 0.05)).toBeNull();
  });
  it('accrues interest under three day counts', () => {
    expect(accruedInterest(6, 2, '2024-01-15', '2024-03-15', '2024-07-15', '30/360')!.accrued).toBeCloseTo(1, 12);
    expect(accruedInterest(6, 2, '2024-01-15', '2024-03-15', '2024-07-15', 'act/act')!.accrued).toBeCloseTo(
      (3 * 60) / 182,
      12,
    );
    expect(accruedInterest(6, 2, '2024-01-15', '2024-03-15', '2024-07-15', 'act/360')!.accrued).toBeCloseTo(1, 12);
    expect(accruedInterest(6, 2, '2024-03-15', '2024-01-15', '2024-07-15', '30/360')).toBeNull();
    expect(accruedInterest(6, 2, '2024-02-30', '2024-03-15', '2024-07-15', '30/360')).toBeNull();
  });
  it('bootstraps spot and forward rates', () => {
    const d1 = 1 / 1.05;
    const d2 = 1 / 1.06 ** 2;
    const r = bootstrap([
      { years: 1, coupon: 0, price: 100 * d1 },
      { years: 2, coupon: 4, price: 4 * (d1 + d2) + 100 * d2 },
    ])!;
    expect(r.spot[0]).toBeCloseTo(0.05, 12);
    expect(r.spot[1]).toBeCloseTo(0.06, 12);
    expect(r.forward[1]).toBeCloseTo(1.06 ** 2 / 1.05 - 1, 12);
    expect(bootstrap([{ years: 2, coupon: 0, price: 90 }])).toBeNull();
  });
});

describe('portfolios', () => {
  it('finds the two-asset minimum-variance mix', () => {
    const r = twoAssetMinVariance(0.1, 0.15, 0.2, 0.3, 0.3)!;
    expect(r.weight).toBeCloseTo(0.76596, 5);
    expect(r.mean).toBeCloseTo(0.1117, 4);
    expect(r.sd).toBeCloseTo(0.18668, 4);
    expect(twoAssetMinVariance(0.1, 0.15, 0.2, 0.2, 1)).toBeNull();
  });
  it('agrees with the N-asset formula', () => {
    const cov = covarianceFrom(
      [0.2, 0.3],
      [
        [1, 0.3],
        [0.3, 1],
      ],
    )!;
    const r = minimumVariance([0.1, 0.15], cov)!;
    expect(r.weights[0]).toBeCloseTo(0.76596, 5);
    expect(r.sd).toBeCloseTo(0.18668, 4);
  });
  it('splits equally among identical uncorrelated assets', () => {
    const cov = covarianceFrom(
      [0.2, 0.2, 0.2],
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    )!;
    const r = minimumVariance([0.1, 0.1, 0.1], cov)!;
    r.weights.forEach((w) => expect(w).toBeCloseTo(1 / 3, 12));
    expect(r.sd).toBeCloseTo(0.2 / Math.sqrt(3), 12);
  });
  it('finds the tangency portfolio and the best Sharpe ratio', () => {
    const cov = covarianceFrom(
      [0.2, 0.3],
      [
        [1, 0.3],
        [0.3, 1],
      ],
    )!;
    const t = tangency([0.1, 0.15], cov, 0.03)!;
    expect(t.weights[0]).toBeCloseTo(0.53905, 4);
    const others = [0, 0.25, 0.5, 0.75, 1].map((w) => portfolioStats([w, 1 - w], [0.1, 0.15], cov, 0.03).sharpe!);
    others.forEach((s) => expect(t.sharpe!).toBeGreaterThanOrEqual(s - 1e-12));
  });
  it('rejects a covariance that is not square or not symmetric', () => {
    expect(covarianceFrom([0.2, 0.3], [[1, 0.3]])).toBeNull();
    expect(
      covarianceFrom(
        [0.2, 0.3],
        [
          [1, 0.3],
          [0.5, 1],
        ],
      ),
    ).toBeNull();
  });
  it('computes returns and a CAPM beta', () => {
    const rets = returnsFrom([100, 110, 99]);
    expect(rets[0]).toBeCloseTo(0.1, 12);
    expect(rets[1]).toBeCloseTo(-0.1, 12);
    const market = [0.02, -0.01, 0.03, 0.01, -0.02];
    const asset = market.map((m) => 0.01 + 2 * (m - 0.01));
    const r = capm(asset, market, 0.01)!;
    expect(r.beta).toBeCloseTo(2, 12);
    expect(r.alpha).toBeCloseTo(0, 12);
    expect(r.rSquared).toBeCloseTo(1, 12);
    expect(capm([1, 2], [1, 2], 0)).toBeNull();
    expect(capm([1, 2, 3], [1, 1, 1], 0)).toBeNull();
  });
});

describe('options', () => {
  it('has an accurate normal distribution function', () => {
    expect(normalCdf(0)).toBe(0.5);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 12);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 12);
    expect(normalCdf(3)).toBeCloseTo(0.9986501019683699, 12);
    expect(normalCdf(-12)).toBe(0);
  });
  it('prices and hedges the at-the-money option', () => {
    const c = blackScholes(option, 'call')!;
    const p = blackScholes(option, 'put')!;
    expect(c.price).toBeCloseTo(10.4506, 4);
    expect(p.price).toBeCloseTo(5.5735, 4);
    expect(c.delta).toBeCloseTo(0.63683, 5);
    expect(c.gamma).toBeCloseTo(0.018762, 5);
    expect(c.vega).toBeCloseTo(37.524, 2);
    expect(c.theta).toBeCloseTo(-6.414, 2);
    expect(c.rho).toBeCloseTo(53.2325, 2);
    expect(p.delta).toBeCloseTo(c.delta - 1, 12);
  });
  it('obeys put-call parity with a dividend', () => {
    const o = { ...option, dividend: 0.02, strike: 95 };
    const c = blackScholes(o, 'call')!.price;
    const p = blackScholes(o, 'put')!.price;
    expect(c - p).toBeCloseTo(100 * Math.exp(-0.02) - 95 * Math.exp(-0.05), 10);
  });
  it('recovers the volatility from a price', () => {
    expect(
      impliedVolatility({ spot: 100, strike: 100, rate: 0.05, time: 1, dividend: 0 }, 'call', 10.4506),
    ).toBeCloseTo(0.2, 5);
    expect(impliedVolatility({ spot: 100, strike: 100, rate: 0.05, time: 1, dividend: 0 }, 'call', 0.0001)).toBeNull();
  });
  it('rejects non-positive inputs', () => {
    expect(blackScholes({ ...option, vol: 0 }, 'call')).toBeNull();
    expect(blackScholes({ ...option, time: 0 }, 'put')).toBeNull();
  });
  it('prices by the binomial tree', () => {
    expect(binomialTree(option, 'put', 3, true)!.price).toBeCloseTo(6.4996, 4);
    expect(binomialTree(option, 'put', 3, false)!.price).toBeCloseTo(6.1668, 4);
    expect(binomialTree(option, 'call', 600, false)!.price).toBeCloseTo(10.4506, 1);
    const t = binomialTree(option, 'put', 3, true)!;
    expect(t.tree[3]).toHaveLength(4);
    expect(binomialTree(option, 'put', 0, true)).toBeNull();
  });
  it('never values an American call on a no-dividend stock above the European one', () => {
    const a = binomialTree(option, 'call', 50, true)!.price;
    const e = binomialTree(option, 'call', 50, false)!.price;
    expect(a).toBeCloseTo(e, 10);
  });
  it('finds break-evens and extremes of strategies', () => {
    const straddle = strategy(
      [
        { kind: 'call', strike: 100, quantity: 1, premium: 5 },
        { kind: 'put', strike: 100, quantity: 1, premium: 5 },
      ],
      50,
      150,
    );
    expect(straddle.breakEvens).toEqual([90, 110]);
    expect(straddle.maxLoss).toBe(-10);
    const spread = strategy(
      [
        { kind: 'call', strike: 100, quantity: 1, premium: 6 },
        { kind: 'call', strike: 110, quantity: -1, premium: 2 },
      ],
      50,
      150,
    );
    expect(spread.breakEvens).toEqual([104]);
    expect(spread.maxProfit).toBe(6);
    expect(spread.maxLoss).toBe(-4);
  });
  it('simulates reproducible paths with the right average growth', () => {
    const a = gbmPaths(100, 0.05, 0.2, 1, 12, 3, 7);
    const b = gbmPaths(100, 0.05, 0.2, 1, 12, 3, 7);
    expect(a).toEqual(b);
    expect(a[0]).toHaveLength(13);
    const many = gbmPaths(100, 0.05, 0.2, 1, 4, 20000, 1);
    const avg = many.reduce((s, p) => s + p[4], 0) / many.length;
    expect(avg / 100).toBeCloseTo(Math.exp(0.05), 1);
  });
});

describe('valuation and startups', () => {
  it('computes WACC and a Gordon value', () => {
    expect(wacc(600, 400, 0.12, 0.06, 0.25)).toBeCloseTo(0.09, 12);
    expect(gordon(2, 0.09, 0.04)).toBeCloseTo(40, 12);
    expect(gordon(2, 0.04, 0.04)).toBeNull();
    expect(wacc(0, 0, 0.1, 0.05, 0.2)).toBeNull();
  });
  it('discounts flows and a terminal value', () => {
    const r = dcf([100, 110], 0.1, { kind: 'growth', growth: 0.03 })!;
    expect(r.pvFlows).toBeCloseTo(100 / 1.1 + 110 / 1.21, 9);
    expect(r.terminal).toBeCloseTo((110 * 1.03) / 0.07, 9);
    expect(r.value).toBeCloseTo(100 / 1.1 + 110 / 1.21 + (110 * 1.03) / 0.07 / 1.21, 9);
    expect(dcf([100], 0.1, { kind: 'multiple', multiple: 8, metric: 50 })!.pvTerminal).toBeCloseTo(400 / 1.1, 9);
    expect(dcf([100], 0.03, { kind: 'growth', growth: 0.05 })).toBeNull();
  });
  it('computes post-money, ownership and dilution', () => {
    expect(postMoney({ investment: 1, preMoney: 4 })).toEqual({ post: 5, ownership: 0.2 });
    const d = dilution([
      { investment: 1, preMoney: 4 },
      { investment: 2, preMoney: 8 },
    ]);
    expect(d[0]).toBeCloseTo(0.8, 12);
    expect(d[1]).toBeCloseTo(0.64, 12);
  });
  it('shuffles an option pool into the pre-money', () => {
    const r = poolShuffle(8_000_000, 2_000_000, 10_000_000, 0.1)!;
    expect(r.shares).toBeCloseTo(8_000_000 / 0.7, 6);
    expect(r.investorShares / r.shares).toBeCloseTo(0.2, 12);
    expect(r.poolShares / r.shares).toBeCloseTo(0.1, 12);
    expect(r.price).toBeCloseTo(0.875, 12);
    expect(poolShuffle(8_000_000, 2_000_000, 10_000_000, 0.9)).toBeNull();
  });
  it('converts a SAFE at the lowest price', () => {
    const r = safeConversion(1_000_000, 10_000_000, 1, 5_000_000, 0.2)!;
    expect(r.price).toBe(0.5);
    expect(r.shares).toBe(2_000_000);
    expect(r.basis).toBe('cap');
    const d = safeConversion(1_000_000, 10_000_000, 1, 50_000_000, 0.2)!;
    expect(d.price).toBe(0.8);
    expect(d.basis).toBe('discount');
    expect(safeConversion(1_000_000, 10_000_000, 1, null, 0)!.basis).toBe('round');
    expect(safeConversion(0, 1, 1, null, 0)).toBeNull();
  });
  it('applies the venture method', () => {
    const r = ventureMethod(50_000_000, 5, 0.4, 2_000_000)!;
    expect(r.post).toBeCloseTo(50_000_000 / 1.4 ** 5, 6);
    expect(r.ownership).toBeCloseTo(2_000_000 / r.post, 12);
    expect(r.pre + 2_000_000).toBeCloseTo(r.post, 6);
  });
});

function run(id: string, text: Record<string, string> = {}) {
  const form = INVEST.forms.find((f) => f.id === id) as EconForm;
  const initial: Values = { text: {}, unit: {} };
  const fields = typeof form.fields === 'function' ? form.fields(initial) : form.fields;
  const base = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options?.[0]?.value : '') ?? '']),
  );
  return form.solve({ text: { ...base, ...text }, unit: {} });
}
const headline = (o: ReturnType<typeof run>) => (o.ok ? o.headline : o.message);

describe('investment forms', () => {
  it('words the answers', () => {
    expect(headline(run('bond'))).toMatch(/926\.4/);
    expect(headline(run('bond', { yield: '', price: '950', coupon: '4', years: '5' }))).toMatch(/5\.16/);
    expect(headline(run('blackScholes'))).toMatch(/10\.4506/);
    expect(headline(run('portfolio'))).toMatch(/76\.6%/);
    expect(headline(run('wacc'))).toMatch(/9%/);
    expect(headline(run('safe'))).toMatch(/2,000,000 shares/);
  });
  it('explains impossible input', () => {
    expect(headline(run('bond', { yield: '' }))).toMatch(/yield or the price/i);
    expect(headline(run('blackScholes', { vol: '0' }))).toMatch(/positive/i);
    expect(headline(run('portfolio', { corr: '1, 2' }))).toMatch(/correlation/i);
  });
});
