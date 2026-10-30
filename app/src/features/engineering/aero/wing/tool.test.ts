// The finite wing tool's form: the planning cases through the fields, an angle typed in radians, 2*pi as a lift
// slope, and forces only when an airspeed is given.
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

describe('the finite wing tool', () => {
  it('matches the rectangular wing of AR 6 at 5 degrees', () => {
    const out = run({});
    expect(row(out, 'AR')).toBeCloseTo(6, 12);
    expect(Math.abs(row(out, 'e') - 0.954)).toBeLessThan(0.003);
    expect(Math.abs(row(out, 'CL') - 0.3954)).toBeLessThan(0.002);
    expect(out.rows.some((r) => r.id === 'lift')).toBe(false);
  });

  it('matches the elliptic wing of AR 8: a = 2 pi/(1 + 2/AR), and CDi = CL²/(pi AR)', () => {
    const out = run({ planform: 'elliptic', span: '16', area: '32' });
    expect(row(out, 'a')).toBeCloseTo(5.0265, 4);
    expect(row(out, 'e')).toBeCloseTo(1, 9);
    const CL = row(out, 'CL');
    expect(row(out, 'CDi')).toBeCloseTo((CL * CL) / (Math.PI * 8), 9);
  });

  it('reads an angle typed in radians the same as in degrees', () => {
    const rad = run({ alpha: String((5 * Math.PI) / 180), [unitKey('alpha')]: 'rad' });
    expect(row(rad, 'CL')).toBeCloseTo(row(run({}), 'CL'), 12);
  });

  it('gives the lift L = q S CL for a flight condition', () => {
    const out = run({ V: '50' });
    expect(row(out, 'lift')).toBeCloseTo(0.5 * 1.225 * 2500 * 24 * row(out, 'CL'), 6);
  });

  it('refuses a taper outside 0 to 1 and a zero span', () => {
    const taper = runSpec(spec, { ...initialValues(spec, 'si'), taper: '1.5' });
    expect(taper.ok ? '' : taper.error.code).toBe('taperRange');
    const span = runSpec(spec, { ...initialValues(spec, 'si'), span: '0' });
    expect(span.ok ? '' : span.error.code).toBe('notPositive');
  });
});
