// The compressible tool's form: each family reads its own known; the branch and the shock solution reach the
// engine, angles show in degrees, and a problem comes back as a code the window says in words.
import '../text';
import { describe, expect, it } from 'vitest';
import { initialValues, runSpec } from '../ui/spec';
import type { ToolOutput } from '../ui/spec';
import { rowValue } from '../ui/words';
import { spec } from './tool';

const run = (changes: Record<string, string>): ToolOutput => {
  const result = runSpec(spec, { ...initialValues(spec, 'si'), ...changes });
  if (!result.ok) throw result.error;
  return result.output;
};
const row = (output: ToolOutput, id: string) => output.rows.find((r) => r.id === id)?.value ?? NaN;

describe('the compressible flow tool', () => {
  it('starts on isentropic flow at M = 2', () => {
    const out = run({});
    expect(row(out, 'TT0')).toBeCloseTo(0.555556, 5);
    expect(row(out, 'AA')).toBeCloseTo(1.6875, 5);
    expect(out.latex).toContain('A^*');
  });

  it('takes A/A* on the branch picked', () => {
    expect(row(run({ kisentropic: 'AA', value: '1.6875', branch: 'supersonic' }), 'M')).toBeCloseTo(2, 6);
    expect(row(run({ kisentropic: 'AA', value: '1.6875', branch: 'subsonic' }), 'M')).toBeLessThan(1);
  });

  it('gives the weak and strong oblique shocks, with angles in degrees', () => {
    const weak = run({ family: 'oblique', koblique: 'theta', value: '10', M1: '2' });
    expect(row(weak, 'beta')).toBeCloseTo(39.314, 3);
    const beta = weak.rows.find((r) => r.id === 'beta')!;
    expect(rowValue('compressible', beta, 'si')).toMatch(/^39\.31\d*°$/);
    const strong = run({ family: 'oblique', koblique: 'theta', value: '10', M1: '2', solution: 'strong' });
    expect(row(strong, 'beta')).toBeCloseTo(83.7, 3);
  });

  it('keeps each family’s known apart and reads Fanno from 4fL*/D', () => {
    const out = run({ family: 'fanno', kfanno: 'fLD', value: '1.06906', branch: 'subsonic', kisentropic: 'AA' });
    expect(row(out, 'M')).toBeCloseTo(0.5, 5);
    expect(row(run({ family: 'rayleigh', value: '0.5' }), 'T0T0s')).toBeCloseTo(0.691358, 5);
  });

  it('says what is wrong with an impossible input', () => {
    const shock = runSpec(spec, { ...initialValues(spec, 'si'), family: 'normal', value: '0.8' });
    expect(shock.ok ? '' : shock.error.code).toBe('shockSubsonic');
    const gas = runSpec(spec, { ...initialValues(spec, 'si'), gamma: '0.9' });
    expect(gas.ok ? '' : gas.error.code).toBe('gammaRange');
    const blank = runSpec(spec, { ...initialValues(spec, 'si'), value: '' });
    expect(blank.ok ? '' : blank.error.code).toBe('notNumber');
  });
});
