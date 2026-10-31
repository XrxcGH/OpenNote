import { describe, expect, it } from 'vitest';
import type { EconForm, Values } from './forms';
import {
  difference,
  forwardRate,
  isLm,
  keynesianCross,
  moneyMultiplier,
  nominalRate,
  phillips,
  pppRate,
  quantityTheory,
  solowPath,
  solowResidual,
  solowSteadyState,
  taylorRate,
} from './macro';
import { MACRO } from './macroForms';

describe('Keynesian cross', () => {
  it('solves C = 100 + 0.8 Y with I 200 and G 100', () => {
    const r = keynesianCross(100, 0.8, 0, 0, 200, 100)!;
    expect(r.income).toBeCloseTo(2000, 9);
    expect(r.spendingMultiplier).toBeCloseTo(5, 12);
    expect(r.taxMultiplier).toBeCloseTo(-4, 12);
    expect(r.balancedBudgetMultiplier).toBeCloseTo(1, 12);
  });
  it('shrinks the multiplier with a proportional tax', () => {
    const r = keynesianCross(100, 0.8, 0, 0.25, 200, 100)!;
    expect(r.spendingMultiplier).toBeCloseTo(1 / (1 - 0.6), 12);
    expect(r.taxes).toBeCloseTo(0.25 * r.income, 9);
    expect(r.income).toBeCloseTo(400 / 0.4, 9);
  });
  it('rejects a marginal propensity of one or more', () => {
    expect(keynesianCross(100, 1, 0, 0, 200, 100)).toBeNull();
    expect(keynesianCross(100, 0.8, 0, 1, 200, 100)).toBeNull();
  });
});

describe('IS-LM', () => {
  const base = { c0: 100, c1: 0.8, tax: 100, i0: 300, i1: 20, gov: 200, money: 1000, k: 0.5, h: 50 };
  it('finds r = 3 and Y = 2300', () => {
    const r = isLm(base)!;
    expect(r.rate).toBeCloseTo(3, 9);
    expect(r.income).toBeCloseTo(2300, 9);
  });
  it('moves with fiscal and monetary policy', () => {
    const fiscal = isLm({ ...base, gov: 220 })!;
    expect(fiscal.income).toBeGreaterThan(2300);
    expect(fiscal.rate).toBeGreaterThan(3);
    const monetary = isLm({ ...base, money: 1100 })!;
    expect(monetary.income).toBeGreaterThan(2300);
    expect(monetary.rate).toBeLessThan(3);
    // IS: Y = 2600 - 100 r, LM: Y = 2200 + 100 r (M = 1100) gives r = 2, Y = 2400
    expect(monetary.rate).toBeCloseTo(2, 9);
    expect(monetary.income).toBeCloseTo(2400, 9);
  });
  it('rejects a flat money demand', () => {
    expect(isLm({ ...base, h: 0 })).toBeNull();
  });
});

describe('Solow', () => {
  it('finds the steady state and golden rule', () => {
    const s = solowSteadyState(0.2, 0.01, 0.05, 1 / 3)!;
    expect(s.capital).toBeCloseTo(6.08581, 5);
    expect(s.output).toBeCloseTo(1.82574, 5);
    expect(s.goldenSaving).toBeCloseTo(1 / 3, 12);
    expect(s.consumption).toBeCloseTo(0.8 * s.output, 12);
    expect(s.goldenCapital).toBeGreaterThan(s.capital);
  });
  it('rises to the steady state from below and falls to it from above', () => {
    const up = solowPath(0.2, 0.01, 0.05, 1 / 3, 1, 400);
    const down = solowPath(0.2, 0.01, 0.05, 1 / 3, 12, 400);
    expect(up[400]).toBeCloseTo(6.08581, 3);
    expect(down[400]).toBeCloseTo(6.08581, 3);
    expect(up[1]).toBeGreaterThan(up[0]);
    expect(down[1]).toBeLessThan(down[0]);
  });
  it('rejects a saving rate outside zero to one', () => {
    expect(solowSteadyState(1.2, 0.01, 0.05, 0.3)).toBeNull();
    expect(solowSteadyState(0.2, 0, 0, 0.3)).toBeNull();
  });
  it('computes the Solow residual', () => {
    expect(solowResidual(3, 2, 1, 0.3)).toBeCloseTo(3 - 0.6 - 0.7, 12);
  });
});

describe('policy rules, money and parity', () => {
  it('applies the Taylor rule and the Phillips curve', () => {
    expect(taylorRate(2, 3, 2, 1)).toBeCloseTo(6, 12);
    expect(taylorRate(2, 3, 2, 1, 1.5, 0.5)).toBeCloseTo(7, 12);
    expect(phillips(2, 0.5, 6, 5)).toBeCloseTo(1.5, 12);
    expect(phillips(2, 0.5, 4, 5, 1)).toBeCloseTo(3.5, 12);
  });
  it('solves the quantity equation for the missing variable', () => {
    expect(quantityTheory(null, 5, 2, 100)!.m).toBe(40);
    expect(quantityTheory(40, null, 2, 100)!.v).toBe(5);
    expect(quantityTheory(40, 5, null, 100)!.p).toBe(2);
    expect(quantityTheory(40, 5, 2, null)!.y).toBe(100);
    expect(quantityTheory(40, 5, 2, 100)).toBeNull();
  });
  it('computes the money multiplier and the Fisher relation', () => {
    expect(moneyMultiplier(0.2, 0.1)).toBeCloseTo(4, 12);
    expect(moneyMultiplier(0, 0)).toBeNull();
    expect(nominalRate(0.02, 0.03)).toBeCloseTo(0.0506, 12);
  });
  it('computes covered parity and relative PPP', () => {
    expect(forwardRate(1.1, 0.05, 0.02)).toBeCloseTo((1.1 * 1.05) / 1.02, 12);
    expect(pppRate(100, 0.03, 0.01)).toBeCloseTo((100 * 1.03) / 1.01, 12);
  });
});

describe('difference equations', () => {
  it('converges when |a| < 1', () => {
    const d = difference(0.5, 10, 0, 40);
    expect(d.fixedPoint).toBe(20);
    expect(d.stable).toBe(true);
    expect(d.path[40]).toBeCloseTo(20, 6);
  });
  it('diverges when |a| > 1 and has no fixed point at a = 1', () => {
    expect(difference(-1.5, 10, 4, 5).stable).toBe(false);
    expect(difference(1, 2, 0, 3).fixedPoint).toBeNull();
    expect(difference(1, 2, 0, 3).path).toEqual([0, 2, 4, 6]);
  });
});

function run(id: string, text: Record<string, string> = {}) {
  const form = MACRO.forms.find((f) => f.id === id) as EconForm;
  const initial: Values = { text: {}, unit: {} };
  const fields = typeof form.fields === 'function' ? form.fields(initial) : form.fields;
  const base = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options?.[0]?.value : '') ?? '']),
  );
  return form.solve({ text: { ...base, ...text }, unit: {} });
}
const headline = (o: ReturnType<typeof run>) => (o.ok ? o.headline : o.message);

describe('macro forms', () => {
  it('words the answers', () => {
    expect(headline(run('cross'))).toMatch(/income 2,000/i);
    expect(headline(run('islm'))).toMatch(/income 2,300, interest rate 3/i);
    expect(headline(run('solow'))).toMatch(/6\.0858/);
    expect(headline(run('taylor'))).toMatch(/6%/);
  });
  it('explains impossible input', () => {
    expect(headline(run('cross', { c1: '1.2' }))).toMatch(/between 0 and 1/i);
    expect(headline(run('solow', { s: '0' }))).toMatch(/saving rate/i);
  });
});
