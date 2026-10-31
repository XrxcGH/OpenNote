import { describe, expect, it } from 'vitest';
import {
  annuityFv,
  annuityPv,
  depreciation,
  equivalentAnnual,
  benefitCost,
  effectiveRate,
  fv,
  icer,
  irrs,
  loanPayment,
  macrs,
  mirr,
  netMonetaryBenefit,
  npv,
  payback,
  periodsFor,
  perpetuity,
  profitabilityIndex,
  property,
  rateFor,
  schedule,
  sinkingDeposit,
} from './money';

describe('time value', () => {
  it('matches the textbook values', () => {
    expect(fv(1000, 0.05, 10)).toBeCloseTo(1628.89, 2);
    expect(annuityPv(1000, 0.05, 10)).toBeCloseTo(7721.73, 2);
    expect(effectiveRate(0.12, 12)).toBeCloseTo(0.126825, 6);
  });
  it('handles due, growing, zero-rate and continuous cases', () => {
    expect(annuityPv(1000, 0.05, 10, true)).toBeCloseTo(8107.82, 2);
    expect(annuityPv(100, 0.1, 3, false, 0.1)).toBeCloseTo(300 / 1.1, 9);
    expect(annuityPv(100, 0, 4)).toBe(400);
    expect(annuityFv(100, 0, 4)).toBe(400);
    expect(annuityFv(100, 0.1, 2)).toBeCloseTo(210, 9);
    expect(effectiveRate(0.1, Infinity)).toBeCloseTo(Math.exp(0.1) - 1, 12);
    expect(perpetuity(50, 0.05)).toBeCloseTo(1000, 9);
    expect(perpetuity(50, 0.02, 0.03)).toBeNull();
  });
  it('inverts a growth problem', () => {
    expect(rateFor(100, 200, 10)).toBeCloseTo(0.0717735, 6);
    expect(periodsFor(100, 200, 0.07)).toBeCloseTo(10.2448, 4);
    expect(rateFor(0, 200, 10)).toBeNull();
    expect(periodsFor(100, 200, 0)).toBeNull();
    expect(sinkingDeposit(1000, 0.1, 2)).toBeCloseTo((1000 * 0.1) / 0.21, 9);
  });
});

describe('loans', () => {
  it('prices a 30-year mortgage', () => {
    expect(loanPayment(300000, 0.06 / 12, 360)).toBeCloseTo(1798.65, 2);
    expect(loanPayment(1200, 0, 12)).toBe(100);
  });
  it('amortizes to zero and extra payments shorten it', () => {
    const plain = schedule(10000, 0.01, 12);
    expect(plain.rows).toHaveLength(12);
    expect(plain.rows[11].balance).toBe(0);
    expect(plain.interest).toBeCloseTo(loanPayment(10000, 0.01, 12) * 12 - 10000, 6);
    const faster = schedule(10000, 0.01, 12, 200);
    expect(faster.rows.length).toBeLessThan(12);
    expect(faster.interest).toBeLessThan(plain.interest);
  });
});

describe('project appraisal', () => {
  const flows = [-1000, 300, 400, 500];
  it('finds NPV, IRR and MIRR', () => {
    expect(npv(0.1, flows)).toBeCloseTo(-21.04, 2);
    expect(irrs(flows)[0]).toBeCloseTo(0.08896, 4);
    expect(mirr(flows, 0.1, 0.1)).toBeCloseTo(0.09223, 4);
  });
  it('reports every IRR when the signs change more than once', () => {
    const roots = irrs([-100, 230, -132]);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(0.1, 6);
    expect(roots[1]).toBeCloseTo(0.2, 6);
    expect(irrs([100, 200])).toEqual([]);
  });
  it('finds payback and the index', () => {
    expect(payback(flows)).toBeCloseTo(2 + 300 / 500, 9);
    expect(payback([-100, 10, 10])).toBeNull();
    expect(payback(flows, 0.1)).toBeNull();
    expect(profitabilityIndex(0.1, flows)).toBeCloseTo(978.96 / 1000, 4);
  });
});

describe('equivalent annual annuity and benefit-cost ratio', () => {
  const flows = [-1000, 500, 500, 500];
  it('matches hand values at 10%', () => {
    // NPV = 500 * 2.486852 - 1000 = 243.426; EAA = NPV * 0.1 / (1 - 1.1^-3) = 243.426 / 2.486852
    expect(equivalentAnnual(0.1, flows)).toBeCloseTo(97.885, 2);
    // PV benefits 1243.426 over 1000
    expect(benefitCost(0.1, flows)).toBeCloseTo(1.2434, 3);
    expect(benefitCost(0.1, [100, 200])).toBeNull();
    expect(equivalentAnnual(0, flows)).toBeCloseTo(500 / 3, 9);
  });
});

describe('depreciation', () => {
  it('declining balance switches to straight line and reaches salvage', () => {
    // 10000 cost, 0 salvage, 5 years, 200%: 4000, 2400, 1440, then SL on 2160 over 2 years = 1080 each.
    const d = depreciation('double', 10000, 0, 5);
    [4000, 2400, 1440, 1080, 1080].forEach((x, i) => expect(d[i]).toBeCloseTo(x, 9));
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(10000, 9);
    // 150% with salvage 1000: sum is cost - salvage.
    expect(depreciation('declining', 10000, 1000, 5).reduce((a, b) => a + b, 0)).toBeCloseTo(9000, 9);
  });
  it('gives the first-year amounts', () => {
    expect(depreciation('straight', 10000, 1000, 5)[0]).toBe(1800);
    expect(depreciation('double', 10000, 1000, 5)[0]).toBe(4000);
    expect(depreciation('syd', 10000, 1000, 5)[0]).toBe(3000);
  });
  it('never goes below salvage', () => {
    for (const method of ['straight', 'double', 'syd', 'declining'] as const) {
      const all = depreciation(method, 10000, 1000, 5);
      expect(all.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(9000 + 1e-9);
    }
    expect(depreciation('double', 10000, 1000, 5).reduce((a, b) => a + b, 0)).toBeCloseTo(9000, 9);
  });
  it('reproduces the published MACRS tables', () => {
    const pctOf = (x: number[]) => x.map((v) => Math.round(v * 10000) / 100);
    expect(pctOf(macrs(5))).toEqual([20, 32, 19.2, 11.52, 11.52, 5.76]);
    expect(pctOf(macrs(3))).toEqual([33.33, 44.44, 14.81, 7.41]);
    expect(pctOf(macrs(7)).slice(0, 4)).toEqual([14.29, 24.49, 17.49, 12.49]);
    expect(pctOf(macrs(5, 'q1'))[0]).toBe(35);
    expect(pctOf(macrs(5, 'q4'))[0]).toBe(5);
    expect(macrs(15).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

describe('property and cost-effectiveness', () => {
  it('computes cap rate, DSCR and cash on cash', () => {
    const p = property(120000, 1500000, 100000, 300000);
    expect(p.capRate).toBeCloseTo(0.08, 12);
    expect(p.dscr).toBeCloseTo(1.2, 12);
    expect(p.cashOnCash).toBeCloseTo(20000 / 300000, 12);
    expect(property(1, 1, 0, 0).dscr).toBeNull();
  });
  it('computes ICER and net monetary benefit', () => {
    expect(icer(50000, 20000, 5, 3.5)).toBeCloseTo(20000, 9);
    expect(icer(1, 1, 2, 2)).toBeNull();
    expect(netMonetaryBenefit(50000, 20000, 5, 3.5, 30000)).toBeCloseTo(15000, 9);
  });
});
