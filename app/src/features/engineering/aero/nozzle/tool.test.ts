// The nozzle tool's form: the planning cases through the fields, US units that give the same answer, the regime
// as the headline, and the shock rows only when a shock stands in the nozzle.
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

describe('the nozzle tool', () => {
  it('places the shock for Ae/At = 2 and pb/p0 = 0.7, and gives the choked mass flow', () => {
    const out = run({});
    expect(out.headline?.key).toBe('regime.shockInside');
    expect(row(out, 'As')).toBeCloseTo(1.5101, 4);
    expect(row(out, 'Me')).toBeCloseTo(0.40669, 4);
    expect(row(out, 'c1')).toBeCloseTo(0.93716, 5);
    expect(row(out, 'c2')).toBeCloseTo(0.5134, 4);
    expect(row(out, 'c3')).toBeCloseTo(0.093933, 5);
    expect(row(out, 'mdot') / 0.082504 - 1).toBeLessThan(1e-4);
    expect(out.plots?.[0]?.marks?.map((m) => m.label)).toEqual(['shock', 'back']);
  });

  it('gives the same mass flow from US units: 1 cm² is 0.155 in², 500 kPa is 72.519 psi', () => {
    const us = initialValues(spec, 'us');
    const out = runSpec(spec, {
      ...us,
      throat: String(1 / 6.4516),
      [unitKey('throat')]: 'in²',
      p0: String(500000 / 6894.757293168),
      [unitKey('p0')]: 'psi',
      T0: '1080',
      [unitKey('T0')]: '°R',
      pb: String(350000 / 6894.757293168),
      [unitKey('pb')]: 'psi',
    });
    if (!out.ok) throw out.error;
    expect(row(out.output, 'mdot') / 0.082504 - 1).toBeLessThan(1e-4);
  });

  it('names the regime from subsonic to underexpanded and drops the shock rows without a shock', () => {
    expect(run({ pb: '480000' }).headline?.key).toBe('regime.subsonic');
    expect(run({ pb: '100000' }).headline?.key).toBe('regime.overexpanded');
    const under = run({ pb: '20000' });
    expect(under.headline?.key).toBe('regime.underexpanded');
    expect(under.rows.some((r) => r.id === 'As')).toBe(false);
    expect(row(under, 'Me')).toBeCloseTo(2.1972, 4);
  });

  it('refuses a back pressure above p0 and an area ratio below 1', () => {
    const back = runSpec(spec, { ...initialValues(spec, 'si'), pb: '600000' });
    expect(back.ok ? '' : back.error.code).toBe('backflow');
    const small = runSpec(spec, { ...initialValues(spec, 'si'), areaRatio: '0.5' });
    expect(small.ok ? '' : small.error.code).toBe('areaRatioBelowOne');
  });
});
