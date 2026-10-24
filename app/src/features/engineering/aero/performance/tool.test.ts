// The performance tool's form: every mode through its fields, with the planning cases for the polar, the jet
// range and the neutral point, density from the standard atmosphere, k from e and AR, and US units.
import { describe, expect, it } from 'vitest';
import { initialValues, runSpec, unitKey, visibleFields } from '../ui/spec';
import type { ToolOutput } from '../ui/spec';
import { spec } from './tool';

const run = (changes: Record<string, string>): ToolOutput => {
  const result = runSpec(spec, { ...initialValues(spec, 'si'), ...changes });
  if (!result.ok) throw result.error;
  return result.output;
};
const row = (output: ToolOutput, id: string) => output.rows.find((r) => r.id === id)?.value ?? NaN;
const near = (value: number, expected: number, tol = 1e-4) => expect(Math.abs(value / expected - 1)).toBeLessThan(tol);

describe('the performance tool', () => {
  it('matches the sea-level polar, with the density from the standard atmosphere', () => {
    const out = run({});
    near(row(out, 'rho'), 1.225, 1e-5);
    near(row(out, 'LDmax'), 14.907);
    near(row(out, 'CLminD'), 0.74536);
    near(row(out, 'VminD'), 74.0, 2e-4);
    near(row(out, 'VminP'), 56.23, 2e-4);
  });

  it('matches the jet range at constant altitude', () => {
    const out = run({ mode: 'range', air: 'density', rho: '0.4135' });
    near(row(out, 'CLrange'), 0.43033);
    near(row(out, 'CDrange'), 0.033333);
    near(row(out, 'range') / 1000, 2741.6, 1e-3);
  });

  it('gives the propeller Breguet range from lb/(hp h)', () => {
    const out = run({ mode: 'range', engine: 'prop', cp: '0.45', [unitKey('cp')]: 'lb/(hp·h)', etaP: '0.8' });
    const c = (0.45 * 4.4482216152605) / (745.6998715822702 * 3600);
    // Independent: R = (eta/c) (L/D)max ln(Wi/Wf), with (L/D)max = 1/(2 sqrt(k CD0)).
    near(row(out, 'range'), (0.8 / c) * (1 / (2 * Math.sqrt(0.045 * 0.025))) * Math.log(1 / 0.8), 1e-9);
  });

  it('takes k from e and AR, and climbs, glides and turns', () => {
    near(row(run({ kFrom: 'eAR', e: '0.8', AR: '8' }), 'k'), 1 / (Math.PI * 6.4), 1e-12);
    const climb = run({ mode: 'climb' });
    expect(row(climb, 'maxClimbRate')).toBeGreaterThan(0);
    near(row(climb, 'glideAngle'), Math.atan(1 / 14.907) / (Math.PI / 180), 1e-4);
    near(row(climb, 'glideRange'), 1000 * 14.907, 1e-4);
    const level = run({ mode: 'turn' });
    near(row(level, 'n'), 2, 1e-12);
    near(row(level, 'radius'), 10000 / (9.80665 * Math.sqrt(3)), 1e-12);
  });

  it('finds the neutral point and static margin, and flags an unstable center of gravity', () => {
    const out = run({ mode: 'stability' });
    expect(row(out, 'hn')).toBeCloseTo(0.538, 9);
    expect(row(out, 'margin')).toBeCloseTo(0.238, 9);
    expect(out.headline?.key).toBe('n.stable');
    expect(run({ mode: 'stability', hcg: '0.6' }).headline?.key).toBe('n.unstable');
  });

  it('shows only the fields a mode uses, and gives the same polar in US units', () => {
    const ids = (mode: string) => visibleFields(spec, { ...initialValues(spec, 'si'), mode }).map((f) => f.id);
    expect(ids('turn')).toEqual(['mode', 'V', 'bank']);
    expect(ids('range')).toContain('ct');
    const us = runSpec(spec, initialValues(spec, 'us'), 'us');
    if (!us.ok) throw us.error;
    near(row(us.output, 'VminD'), 74.0, 2e-4);
  });

  it('refuses a fuel fraction of 1, a bank of 90 degrees and a jet that cannot climb', () => {
    const fuel = runSpec(spec, { ...initialValues(spec, 'si'), mode: 'range', fuel: '1' });
    expect(fuel.ok ? '' : fuel.error.code).toBe('fuelFraction');
    const bank = runSpec(spec, { ...initialValues(spec, 'si'), mode: 'turn', bank: '90' });
    expect(bank.ok ? '' : bank.error.code).toBe('bankRange');
    const weak = runSpec(spec, { ...initialValues(spec, 'si'), mode: 'climb', T: '2000' });
    expect(weak.ok ? '' : weak.error.code).toBe('cannotClimb');
  });
});
