// The statics form end to end: typed text in, results out, checked against hand calculations.
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { staticsSpec } from './spec';

const solve = (texts: Record<string, string>, system: 'si' | 'us' = 'si') => {
  const run = runTool(staticsSpec, { ...firstTexts(staticsSpec), ...texts }, system);
  if (!run.ok) throw new Error(JSON.stringify(run.error?.message ?? run.fields.map((f) => f.field)));
  return Object.fromEntries(run.outcome.rows.map((row) => [row.id, row.value]));
};
const v = (x: unknown) => (typeof x === 'object' && x !== null ? (x as { v: number }).v : (x as number));

describe('statics form', () => {
  it('vertical rectangular gate: F = rho g hc A and hcp = hc + I/(hc A)', () => {
    const r = solve({});
    const hc = 1 + 0.75;
    expect(v(r.force)).toBeCloseTo(1000 * 9.80665 * hc * 3, 6);
    expect(v(r.pressureCenterDepth)).toBeCloseTo(hc + (2 * 1.5 ** 3) / 12 / (hc * 3), 9);
  });
  it('a bare angle is in degrees and a tilted plate has a smaller force than a vertical one', () => {
    expect(v(solve({ angle: '45' }).force)).toBeLessThan(v(solve({ angle: '90' }).force));
    expect(v(solve({ angle: '45 deg' }).force)).toBeCloseTo(v(solve({ angle: '45' }).force), 9);
  });
  it('mercury and water chain: p = rho_m g (-0.2) + rho_w g (0.5)', () => {
    const r = solve({ mode: 'manometer' });
    expect(v(r.pressure)).toBeCloseTo(9.80665 * (13600 * -0.2 + 1000 * 0.5), 6);
  });
  it('US units read feet and pounds per cubic foot in the chain', () => {
    const si = solve({ mode: 'manometer', chain: '13600 kg/m^3, -0.2 m\n1000 kg/m^3, 0.5 m' });
    const us = solve({ mode: 'manometer', chain: '849 lb/ft^3, -0.6562 ft\n62.43 lb/ft^3, 1.6404 ft' }, 'us');
    expect(Math.abs(v(us.pressure) - v(si.pressure))).toBeLessThan(0.002 * Math.abs(v(si.pressure)));
  });
  it('wood block floats with 70 percent under: FB = W', () => {
    const r = solve({ mode: 'buoyancy' });
    expect(v(r.buoyantForce)).toBeCloseTo(700 * 9.80665 * 0.05, 9);
    expect(v(r.fractionSubmerged)).toBeCloseTo(0.7, 12);
  });
  it('Bernoulli leaves the one empty quantity as the answer', () => {
    const r = solve({ mode: 'bernoulli' });
    // p2 = p1 + rho (V1^2 - V2^2) / 2 - rho g (z2 - z1)
    expect(v(r.solved_p2)).toBeCloseTo(200000 + (1000 * (4 - 25)) / 2 - 1000 * 9.80665 * 10, 6);
    expect(() => solve({ mode: 'bernoulli', V2: '' })).toThrow();
  });
  it('venturi and pitot match the closed forms', () => {
    const r = solve({ mode: 'venturi', dp: '20 kPa', cd: '0.98' });
    const beta = 0.6;
    const q = 0.98 * ((Math.PI * 0.06 ** 2) / 4) * Math.sqrt((2 * 20000) / (1000 * (1 - beta ** 4)));
    expect(v(r.flow)).toBeCloseTo(q, 12);
    expect(v(solve({ mode: 'pitot', dp: '5 kPa', density: '1.2 kg/m^3' }).velocity)).toBeCloseTo(
      Math.sqrt(10000 / 1.2),
      9,
    );
    const viaReading = solve({
      mode: 'pitot',
      dp: '',
      meterFluid: '1000 kg/m^3',
      reading: '50 mm',
      density: '1.2 kg/m^3',
    });
    expect(v(viaReading.velocity)).toBeCloseTo(Math.sqrt((2 * (1000 - 1.2) * 9.80665 * 0.05) / 1.2), 9);
  });
  it('reports impossible input in words', () => {
    const run = runTool(staticsSpec, { ...firstTexts(staticsSpec), mode: 'venturi', throatD: '150 mm' }, 'si');
    expect(run.ok).toBe(false);
    expect(!run.ok && run.error?.message).toBe('calc');
    expect(!run.ok && run.error?.detail).toMatch(/narrower/);
    expect(runTool(staticsSpec, { ...firstTexts(staticsSpec), width: '2 kN' }, 'si').ok).toBe(false);
  });
});
