import { describe, expect, it } from 'vitest';
import {
  costMinimization,
  expenditure,
  firmSupply,
  indifferenceY,
  marshallian,
  shortRunCosts,
  slutsky,
  twoPeriod,
  utility,
} from './choice';
import type { Utility } from './choice';
import { CHOICE } from './choiceForms';
import type { EconForm, Values } from './forms';

const cd: Utility = { kind: 'cd', a: 0.3, b: 0.7 };

describe('Marshallian demand', () => {
  it('solves Cobb-Douglas', () => {
    const b = marshallian(cd, 2, 5, 100)!;
    expect(b.x).toBeCloseTo(15, 9);
    expect(b.y).toBeCloseTo(14, 9);
  });
  it('solves perfect complements', () => {
    const b = marshallian({ kind: 'compl', a: 1, b: 2 }, 1, 2, 100)!;
    expect(b.x).toBeCloseTo(50, 9);
    expect(b.y).toBeCloseTo(25, 9);
  });
  it('buys only the better deal with perfect substitutes', () => {
    expect(marshallian({ kind: 'subs', a: 1, b: 1 }, 1, 2, 100)).toEqual({ x: 100, y: 0 });
    expect(marshallian({ kind: 'subs', a: 1, b: 1 }, 3, 2, 100)).toEqual({ x: 0, y: 50 });
  });
  it('checks the corner for quasilinear utility', () => {
    const q: Utility = { kind: 'quasi', a: 10, b: 1 };
    expect(marshallian(q, 1, 1, 100)).toEqual({ x: 10, y: 90 });
    const corner = marshallian(q, 1, 1, 5)!;
    expect(corner.x).toBe(5);
    expect(corner.y).toBe(0);
  });
  it('spends the whole income for CES, and matches Cobb-Douglas as rho goes to 0', () => {
    const ces: Utility = { kind: 'ces', a: 0.5, b: 0.5, rho: 0.5 };
    const b = marshallian(ces, 2, 4, 120)!;
    expect(2 * b.x + 4 * b.y).toBeCloseTo(120, 9);
    // sigma = 2: x = 120 * 0.25 * 2^-2 / (0.25 * 2^-1 + 0.25 * 4^-1)
    expect(b.x).toBeCloseTo((120 * 0.25 * 0.25) / (0.25 * 0.5 + 0.25 * 0.25), 9);
    const near = marshallian({ kind: 'ces', a: 0.5, b: 0.5, rho: 1e-6 }, 2, 5, 100)!;
    expect(near.x).toBeCloseTo(25, 3);
  });
  it('rejects impossible input', () => {
    expect(marshallian(cd, 0, 5, 100)).toBeNull();
    expect(marshallian(cd, 2, 5, 0)).toBeNull();
    expect(marshallian({ kind: 'cd', a: -1, b: 1 }, 1, 1, 1)).toBeNull();
    expect(marshallian({ kind: 'ces', a: 1, b: 1, rho: 1 }, 1, 1, 1)).toBeNull();
  });
});

describe('Slutsky decomposition', () => {
  it('splits the effect of px rising from 2 to 4', () => {
    const s = slutsky(cd, 2, 5, 4, 5, 100)!;
    expect(s.totalX).toBeCloseTo(-7.5, 9);
    expect(s.compensated.x).toBeCloseTo(9.23358, 5);
    expect(s.substitutionX).toBeCloseTo(-5.76642, 5);
    expect(s.incomeX).toBeCloseTo(-1.73358, 5);
    expect(s.substitutionX + s.incomeX).toBeCloseTo(s.totalX, 12);
  });
  it('has a pure income effect for quasilinear demand and no substitution for complements', () => {
    const q = slutsky({ kind: 'quasi', a: 10, b: 1 }, 1, 1, 2, 1, 100)!;
    expect(q.incomeX).toBeCloseTo(0, 6);
    const c = slutsky({ kind: 'compl', a: 1, b: 2 }, 1, 2, 2, 2, 100)!;
    expect(c.substitutionX).toBeCloseTo(0, 6);
  });
  it('gives compensating and equivalent variation', () => {
    const s = slutsky(cd, 2, 5, 4, 5, 100)!;
    // CD: expenditure scales with the price index (px/p0)^0.3
    expect(s.compensatingVariation).toBeCloseTo(100 * (2 ** 0.3 - 1), 6);
    expect(s.equivalentVariation).toBeCloseTo(100 * (1 - 2 ** -0.3), 6);
    expect(s.compensatingVariation).toBeGreaterThan(s.equivalentVariation);
  });
  it('finds the expenditure function', () => {
    const u0 = utility(cd, 15, 14);
    expect(expenditure(cd, 2, 5, u0)).toBeCloseTo(100, 6);
  });
});

describe('indifference curves', () => {
  it('stay on the level set', () => {
    for (const u of [
      cd,
      { kind: 'subs', a: 1, b: 2 },
      { kind: 'quasi', a: 3, b: 1 },
      { kind: 'ces', a: 1, b: 1, rho: 0.5 },
    ] as Utility[]) {
      const level = utility(u, 4, 4);
      const y = indifferenceY(u, level, 2)!;
      expect(utility(u, 2, y)).toBeCloseTo(level, 9);
    }
    expect(indifferenceY(cd, 5, 0)).toBeNull();
    expect(indifferenceY({ kind: 'compl', a: 1, b: 1 }, 5, 6)).toBeNull();
  });
});

describe('production and cost', () => {
  it('minimizes the cost of Q = K^0.5 L^0.5', () => {
    const r = costMinimization({ kind: 'cd', a: 1, b: 0.5, c: 0.5 }, 4, 1, 10)!;
    expect(r.labor).toBeCloseTo(5, 9);
    expect(r.capital).toBeCloseTo(20, 9);
    expect(r.cost).toBeCloseTo(40, 9);
    expect(r.returns).toBe('constant');
    expect(r.mrts).toBeCloseTo(4, 9);
    expect(costMinimization({ kind: 'cd', a: 1, b: 0.5, c: 0.8 }, 4, 1, 10)!.returns).toBe('increasing');
  });
  it('handles fixed proportions and perfect substitutes', () => {
    const l = costMinimization({ kind: 'leontief', a: 2, b: 3 }, 4, 1, 10)!;
    expect(l.capital).toBe(20);
    expect(l.labor).toBe(30);
    expect(l.cost).toBe(140);
    const s = costMinimization({ kind: 'linear', a: 1, b: 1 }, 4, 1, 10)!;
    expect(s.capital).toBe(10);
    expect(s.labor).toBe(0);
    expect(costMinimization({ kind: 'cd', a: 1, b: 0.5, c: 0.5 }, 0, 1, 10)).toBeNull();
  });
  it('computes short-run costs and supply', () => {
    // Q = 2 sqrt(K L) with K = 4: L = Q^2 / 16
    const s = shortRunCosts(1, 0.5, 0.5, 4, 1, 1, 8)!;
    expect(s.labor).toBeCloseTo(16, 9);
    expect(s.totalCost).toBeCloseTo(20, 9);
    expect(s.marginalCost).toBeCloseTo((1 * 16) / (0.5 * 8), 9);
    expect(s.averageVariable).toBeCloseTo(2, 9);
    expect(s.averageTotal).toBeCloseTo(2.5, 9);
    // P = 10 on VC = Q^2 / 4 (MC = Q / 2): Q = 20 with K = 4 and A = 1... check by plugging in
    const q = firmSupply(1, 0.5, 0.5, 4, 1, 10)!;
    expect(q).toBeCloseTo(20, 9);
    expect(shortRunCosts(1, 0.5, 0.5, 4, 1, 1, q)!.marginalCost).toBeCloseTo(10, 9);
    expect(firmSupply(1, 0.5, 1.2, 4, 1, 10)).toBeNull();
  });
});

describe('two periods', () => {
  it('borrows when income comes later', () => {
    const r = twoPeriod(100, 110, 0.1, 0.9, 1)!;
    expect(r.wealth).toBeCloseTo(200, 9);
    expect(r.first).toBeCloseTo(200 / 1.9, 9);
    expect(r.saving).toBeCloseTo(100 - 200 / 1.9, 9);
    expect(r.second).toBeCloseTo(0.9 * 1.1 * (200 / 1.9), 9);
  });
  it('obeys the Euler equation and the budget', () => {
    const r = twoPeriod(100, 50, 0.05, 0.95, 2)!;
    expect(r.second / r.first).toBeCloseTo((0.95 * 1.05) ** 0.5, 9);
    expect(r.first + r.second / 1.05).toBeCloseTo(r.wealth, 9);
    expect(twoPeriod(0, 0, 0.1, 0.9, 1)).toBeNull();
  });
});

function run(id: string, text: Record<string, string> = {}) {
  const form = CHOICE.forms.find((f) => f.id === id) as EconForm;
  const initial: Values = { text: {}, unit: {} };
  const fields = typeof form.fields === 'function' ? form.fields(initial) : form.fields;
  const base = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options?.[0]?.value : '') ?? '']),
  );
  const merged: Values = { text: { ...base, ...text }, unit: {} };
  return form.solve(merged);
}
const headline = (o: ReturnType<typeof run>) => (o.ok ? o.headline : o.message);

describe('choice forms', () => {
  it('words the answers', () => {
    expect(headline(run('demand'))).toMatch(/x = 15, y = 14/);
    expect(headline(run('slutsky'))).toMatch(/total −7\.5/);
    expect(headline(run('cost'))).toMatch(/cost 40/);
    expect(headline(run('twoPeriod'))).toMatch(/105\.26/);
  });
  it('explains impossible input', () => {
    expect(headline(run('demand', { px: '0' }))).toMatch(/prices and income/i);
    expect(headline(run('cost', { w: '-1' }))).toMatch(/positive/i);
  });
});
