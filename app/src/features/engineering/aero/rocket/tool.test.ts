// The rocket tool's form: the planning cases through the fields, US units that give the same impulse, the mass
// ratio left blank, and a separation warning at sea level.
import '../text';
import { describe, expect, it } from 'vitest';
import { initialValues, runSpec, unitKey } from '../ui/spec';
import type { ToolOutput } from '../ui/spec';
import { spec } from './tool';

const run = (changes: Record<string, string>): ToolOutput => {
  const result = runSpec(spec, { ...initialValues(spec, 'si'), ...changes });
  if (!result.ok) throw result.error;
  return result.output;
};
const row = (output: ToolOutput, id: string) => output.rows.find((r) => r.id === id)?.value ?? NaN;
const near = (value: number, expected: number, tol = 1e-4) => expect(Math.abs(value / expected - 1)).toBeLessThan(tol);

describe('the rocket tool', () => {
  it('matches the vacuum case with ε = 40', () => {
    const out = run({});
    near(row(out, 'cStar'), 1773.4);
    near(row(out, 'Me'), 4.2394);
    near(row(out, 'CF'), 1.8843);
    near(row(out, 'Isp'), 340.75);
    expect(row(out, 'pe') / 1000).toBeCloseTo(14.61, 1);
    // Independent: Δv = Isp g0 ln 3 for the impulse found.
    near(row(out, 'deltaV'), row(out, 'Isp') * 9.80665 * Math.log(3), 1e-12);
  });

  it('matches optimum expansion to sea level, with a blank mass ratio', () => {
    const out = run({ mode: 'optimum', pa: '101325', massRatio: '' });
    near(row(out, 'CF'), 1.5986);
    near(row(out, 'eps'), 8.973);
    near(row(out, 'Isp'), 289.09);
    expect(out.rows.some((r) => r.id === 'deltaV')).toBe(false);
    expect(out.headline).toBeUndefined();
  });

  it('gives the same impulse from US units', () => {
    const out = runSpec(spec, {
      ...initialValues(spec, 'us'),
      pc: String(7e6 / 6894.757293168),
      [unitKey('pc')]: 'psi',
      Tc: String(3500 * 1.8),
      [unitKey('Tc')]: '°R',
    });
    if (!out.ok) throw out.error;
    near(row(out.output, 'Isp'), 340.75);
  });

  it('warns of separation for ε = 40 at sea level, and refuses impossible inputs', () => {
    expect(run({ pa: '101325' }).headline?.key).toBe('n.separation');
    const vac = runSpec(spec, { ...initialValues(spec, 'si'), mode: 'optimum', pa: '0' });
    expect(vac.ok ? '' : vac.error.code).toBe('optimumVacuum');
    const mr = runSpec(spec, { ...initialValues(spec, 'si'), massRatio: '0.5' });
    expect(mr.ok ? '' : mr.error.code).toBe('massRatio');
    const hot = runSpec(spec, { ...initialValues(spec, 'si'), Tc: '-10' });
    expect(hot.ok ? '' : hot.error.code).toBe('notPositive');
  });
});
