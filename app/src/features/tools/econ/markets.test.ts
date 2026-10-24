import { describe, expect, it } from 'vitest';
import type { EconForm, Values } from './forms';
import {
  arcElasticity,
  equilibrium,
  externality,
  importPolicy,
  labor,
  openEconomy,
  priceControl,
  quota,
  unitTax,
  valueTax,
  validCurves,
} from './markets';
import { MARKETS } from './marketsForms';

// Qd = 100 - 2P and Qs = -20 + 2P: equilibrium at P = 30, Q = 40.
const K = { a: 100, b: 2, c: -20, d: 2 };

describe('equilibrium and elasticity', () => {
  it('finds the equilibrium, surplus and elasticities', () => {
    const e = equilibrium(K)!;
    expect(e.price).toBeCloseTo(30, 9);
    expect(e.quantity).toBeCloseTo(40, 9);
    expect(e.consumerSurplus).toBeCloseTo(400, 9);
    expect(e.producerSurplus).toBeCloseTo(400, 9);
    expect(e.demandElasticity).toBeCloseTo(-1.5, 9);
    expect(e.supplyElasticity).toBeCloseTo(1.5, 9);
  });
  it('rejects curves that never cross in the positive quadrant', () => {
    expect(equilibrium({ a: 10, b: 1, c: 50, d: 1 })).toBeNull();
    expect(equilibrium({ a: 10, b: 0, c: 0, d: 1 })).toBeNull();
    expect(validCurves({ a: 10, b: -1, c: 0, d: 1 })).toBe(false);
  });
  it('computes arc elasticity both ways', () => {
    const a = arcElasticity(10, 100, 12, 90)!;
    expect(a.elasticity).toBeCloseTo(-0.105263 / 0.181818, 5);
    expect(a.range).toBe('inelastic');
    expect(a.revenueChange).toBe(80);
    expect(arcElasticity(10, 100, 10, 90)).toBeNull();
    expect(arcElasticity(10, 100, 20, 40)!.range).toBe('elastic');
  });
});

describe('taxes and subsidies', () => {
  it('splits a 10 tax evenly', () => {
    const t = unitTax(K, 10)!;
    expect(t.buyersPay).toBeCloseTo(35, 9);
    expect(t.sellersGet).toBeCloseTo(25, 9);
    expect(t.quantity).toBeCloseTo(30, 9);
    expect(t.revenue).toBeCloseTo(300, 9);
    expect(t.deadweightLoss).toBeCloseTo(50, 9);
    expect(t.buyerShare).toBeCloseTo(0.5, 9);
    expect(t.sellerShare).toBeCloseTo(0.5, 9);
    expect(t.consumerSurplus + t.producerSurplus + t.revenue + t.deadweightLoss).toBeCloseTo(800, 9);
  });
  it('puts more of the tax on the less elastic side', () => {
    const t = unitTax({ a: 100, b: 1, c: 0, d: 4 }, 10)!;
    expect(t.buyerShare).toBeCloseTo(0.8, 9);
  });
  it('treats a subsidy as a negative tax with a cost', () => {
    const s = unitTax(K, -10)!;
    expect(s.quantity).toBeCloseTo(50, 9);
    expect(s.revenue).toBeCloseTo(-500, 9);
    expect(s.deadweightLoss).toBeCloseTo(50, 9);
  });
  it('handles a tax too large to leave any trade', () => {
    expect(unitTax(K, 100)).toBeNull();
  });
  it('handles an ad valorem tax', () => {
    const v = valueTax(K, 0.25)!;
    expect(v.buyersPay).toBeCloseTo(v.sellersGet * 1.25, 9);
    expect(demand(v.buyersPay)).toBeCloseTo(v.quantity, 9);
    expect(supply(v.sellersGet)).toBeCloseTo(v.quantity, 9);
    expect(valueTax(K, -1)).toBeNull();
  });
});

const demand = (p: number) => 100 - 2 * p;
const supply = (p: number) => -20 + 2 * p;

describe('price controls and quotas', () => {
  it('creates a shortage under a ceiling of 25', () => {
    const c = priceControl(K, 'ceiling', 25)!;
    expect(c.quantityDemanded).toBe(50);
    expect(c.quantitySupplied).toBe(30);
    expect(c.gap).toBe(20);
    expect(c.traded).toBe(30);
    // buyers served first by willingness to pay: CS = (100*30 - 450)/2 - 25*30 = 1275 - 750 = 525
    expect(c.consumerSurplus).toBeCloseTo(525, 9);
    expect(c.producerSurplus).toBeCloseTo(25 * 30 - (450 + 600) / 2, 9);
    expect(c.deadweightLoss).toBeCloseTo(800 - 525 - 225, 9);
  });
  it('ignores a ceiling above the equilibrium price', () => {
    const c = priceControl(K, 'ceiling', 35)!;
    expect(c.binding).toBe(false);
    expect(c.deadweightLoss).toBeCloseTo(0, 9);
  });
  it('creates a surplus under a floor of 35', () => {
    const c = priceControl(K, 'floor', 35)!;
    expect(c.gap).toBe(20);
    expect(c.traded).toBe(30);
  });
  it('finds the quota rent', () => {
    const q = quota(K, 30)!;
    expect(q.buyersPay).toBeCloseTo(35, 9);
    expect(q.sellersGet).toBeCloseTo(25, 9);
    expect(q.rent).toBeCloseTo(300, 9);
    expect(q.deadweightLoss).toBeCloseTo(50, 9);
    expect(quota(K, 50)!.binding).toBe(false);
  });
});

describe('trade', () => {
  it('imports at a low world price', () => {
    const t = openEconomy(K, 20)!;
    expect(t.direction).toBe('imports');
    expect(t.consumption).toBeCloseTo(60, 9);
    expect(t.production).toBeCloseTo(20, 9);
    expect(t.flow).toBeCloseTo(40, 9);
    expect(t.gainFromTrade).toBeGreaterThan(0);
    // total surplus: CS = 0.5 * 60 * 30 = 900, PS = 0.5 * 20 * (20 - 10) = 100
    expect(t.totalSurplus).toBeCloseTo(1000, 9);
  });
  it('exports at a high world price', () => {
    expect(openEconomy(K, 40)!.direction).toBe('exports');
  });
  it('gives the tariff triangles', () => {
    const p = importPolicy(K, 20, 'tariff', 5)!;
    expect(p.domesticPrice).toBe(25);
    expect(p.trade.flow).toBeCloseTo(50 - 30, 9);
    expect(p.revenue).toBeCloseTo(5 * 20, 9);
    // two triangles: 0.5 * 5 * (60 - 50) + 0.5 * 5 * (30 - 20)
    expect(p.deadweightLoss).toBeCloseTo(50, 9);
  });
  it('gives the same outcome from the equivalent import quota, with the rent to licence holders', () => {
    const p = importPolicy(K, 20, 'quota', 20)!;
    expect(p.domesticPrice).toBeCloseTo(25, 9);
    expect(p.revenue).toBeCloseTo(100, 9);
    expect(p.deadweightLoss).toBeCloseTo(50, 9);
    expect(importPolicy(K, 40, 'tariff', 5)).toBeNull();
  });
});

describe('externalities and labor', () => {
  it('finds the efficient quantity and the corrective tax', () => {
    const x = externality(K, 10)!;
    expect(x.efficientQuantity).toBeCloseTo(30, 9);
    expect(x.correctiveTax).toBe(10);
    expect(x.deadweightLoss).toBeCloseTo(50, 9);
    expect(x.priceBuyersPay).toBeCloseTo(35, 9);
  });
  it('treats a benefit as a subsidy to raise output', () => {
    const x = externality(K, -10)!;
    expect(x.efficientQuantity).toBeCloseTo(50, 9);
    expect(x.deadweightLoss).toBeCloseTo(50, 9);
  });
  it('compares competition with monopsony', () => {
    const l = labor(50, 1, 10, 1)!;
    expect(l.competitiveEmployment).toBeCloseTo(20, 9);
    expect(l.competitiveWage).toBeCloseTo(30, 9);
    expect(l.monopsonyEmployment).toBeCloseTo(40 / 3, 9);
    expect(l.monopsonyWage).toBeCloseTo(10 + 40 / 3, 9);
    expect(labor(5, 1, 10, 1)).toBeNull();
  });
});

function run(id: string, text: Record<string, string> = {}) {
  const form = MARKETS.forms.find((f) => f.id === id) as EconForm;
  const initial: Values = { text: {}, unit: {} };
  const fields = typeof form.fields === 'function' ? form.fields(initial) : form.fields;
  const base = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options?.[0]?.value : '') ?? '']),
  );
  const values: Values = { text: { ...base, ...text }, unit: {} };
  return form.solve(values);
}
const headline = (o: ReturnType<typeof run>) => (o.ok ? o.headline : o.message);

describe('market forms', () => {
  it('words the equilibrium', () => {
    expect(headline(run('market'))).toBe('Price 30, quantity 40');
    const out = run('market');
    expect(out.ok && out.steps.join(' ')).toMatch(/consumer surplus 400/i);
  });
  it('applies a policy', () => {
    expect(headline(run('policy', { policy: 'tax', level: '10' }))).toMatch(
      /Buyers pay 35, sellers keep 25, quantity 30/,
    );
    expect(headline(run('policy', { policy: 'ceiling', level: '25' }))).toMatch(/shortage of 20/);
  });
  it('explains impossible input', () => {
    expect(headline(run('market', { b: '0' }))).toMatch(/slope/i);
    expect(headline(run('policy', { policy: 'tax', level: '1000' }))).toMatch(/no trade/i);
  });
});
