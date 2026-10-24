import { describe, expect, it } from 'vitest';
import {
  bertrandDifferentiated,
  bertrandHomogeneous,
  collusion,
  concentration,
  cournot,
  mergerChange,
  monopoly,
  perfectDiscrimination,
  stackelberg,
  thirdDegree,
} from './firms';
import type { EconForm, Values } from './forms';
import { FIRMS } from './firmsForms';

describe('monopoly', () => {
  it('solves P = 100 - Q with MC 10', () => {
    const r = monopoly(100, 1, 10)!;
    expect(r.quantity).toBe(45);
    expect(r.price).toBe(55);
    expect(r.profit).toBe(2025);
    expect(r.deadweightLoss).toBeCloseTo(1012.5, 9);
    expect(r.lerner).toBeCloseTo(0.81818, 5);
    expect(r.lerner).toBeCloseTo(1 / r.elasticity, 12);
  });
  it('subtracts the fixed cost and rejects an impossible market', () => {
    expect(monopoly(100, 1, 10, 25)!.profit).toBe(2000);
    expect(monopoly(10, 1, 10)).toBeNull();
    expect(monopoly(100, 0, 10)).toBeNull();
  });
});

describe('price discrimination', () => {
  it('captures the whole surplus with first degree', () => {
    const r = perfectDiscrimination(100, 1, 10)!;
    expect(r.quantity).toBe(90);
    expect(r.profit).toBe(4050);
  });
  it('beats the single price with third degree', () => {
    const r = thirdDegree(
      [
        { a: 100, b: 1 },
        { a: 60, b: 1 },
      ],
      10,
    )!;
    expect(r.prices).toEqual([55, 35]);
    expect(r.quantities).toEqual([45, 25]);
    expect(r.profit).toBe(45 * 45 + 25 * 25);
    // one price for both: demand 160 - 2P, so P = 45 and profit (45 - 10)(70) = 2450
    expect(r.uniformPrice).toBeCloseTo(45, 9);
    expect(r.uniformProfit).toBeCloseTo(2450, 9);
    expect(r.profit).toBeGreaterThan(r.uniformProfit);
  });
  it('serves only the strong market when the other is below cost', () => {
    const r = thirdDegree(
      [
        { a: 100, b: 1 },
        { a: 8, b: 1 },
      ],
      10,
    )!;
    expect(r.quantities[1]).toBe(0);
    expect(r.uniformPrice).toBeCloseTo(55, 9);
  });
});

describe('competition', () => {
  it('finds the Cournot duopoly', () => {
    const r = cournot(100, 1, [10, 10])!;
    r.quantities.forEach((q) => expect(q).toBeCloseTo(30, 9));
    expect(r.price).toBeCloseTo(40, 9);
    r.profits.forEach((p) => expect(p).toBeCloseTo(900, 9));
  });
  it('handles n firms, unequal costs and a firm priced out', () => {
    const three = cournot(100, 1, [10, 10, 10])!;
    expect(three.quantities[0]).toBeCloseTo(22.5, 9);
    const unequal = cournot(100, 1, [10, 40])!;
    expect(unequal.quantities[0]).toBeCloseTo(40, 9);
    expect(unequal.quantities[1]).toBeCloseTo(10, 9);
    const out = cournot(100, 1, [10, 95])!;
    expect(out.quantities[1]).toBe(0);
    expect(out.quantities[0]).toBeCloseTo(45, 9);
  });
  it('finds the Stackelberg leader', () => {
    const r = stackelberg(100, 1, 10, 10)!;
    expect(r.leader).toBeCloseTo(45, 9);
    expect(r.follower).toBeCloseTo(22.5, 9);
    expect(r.price).toBeCloseTo(32.5, 9);
    expect(stackelberg(100, 1, 200, 10)).toBeNull();
  });
  it('prices at cost with Bertrand', () => {
    expect(bertrandHomogeneous(100, 1, [10, 10])!.prices).toEqual([10, 10]);
    const r = bertrandHomogeneous(100, 1, [10, 20])!;
    expect(r.prices[0]).toBe(20);
    expect(r.profits[0]).toBe(10 * 80);
    expect(r.profits[1]).toBe(0);
    expect(bertrandHomogeneous(100, 1, [10])).toBeNull();
  });
  it('solves differentiated Bertrand', () => {
    const r = bertrandDifferentiated([100, 100], 2, 1, [10, 10])!;
    // symmetric: p = (alpha + beta c) / (2 beta - gamma) = 120 / 3 = 40
    expect(r.prices[0]).toBeCloseTo(40, 9);
    expect(r.quantities[0]).toBeCloseTo(100 - 80 + 40, 9);
    expect(bertrandDifferentiated([100, 100], 1, 1, [10, 10])).toBeNull();
  });
});

describe('collusion and concentration', () => {
  it('finds the grim-trigger threshold', () => {
    const r = collusion(100, 1, 10, 2)!;
    expect(r.collusiveProfit).toBeCloseTo(1012.5, 9);
    expect(r.deviationProfit).toBeCloseTo(1139.0625, 9);
    expect(r.nashProfit).toBeCloseTo(900, 9);
    expect(r.criticalDiscount).toBeCloseTo(9 / 17, 9);
    expect(collusion(100, 1, 10, 3)!.criticalDiscount).toBeCloseTo(4 / 7, 9);
    expect(collusion(100, 1, 10, 1)).toBeNull();
  });
  it('computes HHI, CR4 and a merger', () => {
    const r = concentration([40, 30, 20, 10])!;
    expect(r.hhi).toBe(3000);
    expect(r.cr4).toBe(100);
    expect(mergerChange([40, 30, 20, 10], 2, 3)).toBe(400);
    expect(mergerChange([40, 30, 20, 10], 2, 2)).toBeNull();
    expect(concentration([1, 1])!.hhi).toBe(5000);
    expect(concentration([])).toBeNull();
    expect(concentration([0, 0])).toBeNull();
  });
});

function run(id: string, text: Record<string, string> = {}) {
  const form = FIRMS.forms.find((f) => f.id === id) as EconForm;
  const fields = typeof form.fields === 'function' ? form.fields({ text: {}, unit: {} }) : form.fields;
  const base = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options?.[0]?.value : '') ?? '']),
  );
  const values: Values = { text: { ...base, ...text }, unit: {} };
  return form.solve(values);
}
const headline = (o: ReturnType<typeof run>) => (o.ok ? o.headline : o.message);

describe('firm forms', () => {
  it('words the textbook answers', () => {
    expect(headline(run('monopoly'))).toBe('Output 45, price 55, profit 2,025');
    expect(headline(run('cournot'))).toMatch(/2 firms produce 60 in all at a price of 40/);
    expect(headline(run('collusion'))).toMatch(/0\.52941/);
    expect(headline(run('concentration'))).toMatch(/3,000/);
    expect(headline(run('stackelberg'))).toMatch(/32\.5/);
  });
  it('explains an impossible input', () => {
    expect(headline(run('monopoly', { a: '5' }))).toMatch(/no market/i);
    expect(headline(run('cournot', { costs: 'x' }))).toMatch(/costs/i);
    expect(headline(run('concentration', { shares: '' }))).toMatch(/shares/i);
  });
});
