// The dynamic modes tool's form: the planning matrix typed as text, the lateral modes named, the matrix built
// from derivatives, and a matrix it cannot read.
import '../text';
import { describe, expect, it } from 'vitest';
import { initialValues, runSpec } from '../ui/spec';
import type { ToolOutput } from '../ui/spec';
import { rowLabel } from '../ui/words';
import { longitudinalA } from './engine';
import { parseMatrix, spec } from './tool';

const run = (changes: Record<string, string>): ToolOutput => {
  const result = runSpec(spec, { ...initialValues(spec, 'si'), ...changes });
  if (!result.ok) throw result.error;
  return result.output;
};
const row = (output: ToolOutput, id: string) => output.rows.find((r) => r.id === id);

describe('the dynamic modes tool', () => {
  it('finds the planning short period and phugoid from the typed matrix', () => {
    const out = run({});
    expect(row(out, 'root0')?.text).toBe('−1.3521 ± 1.7249i');
    expect(row(out, 'wn0')?.value).toBeCloseTo(2.1917, 4);
    expect(row(out, 'zeta0')?.value).toBeCloseTo(0.6169, 4);
    expect(row(out, 'wn1')?.value).toBeCloseTo(0.11253, 4);
    expect(row(out, 'zeta1')?.value).toBeCloseTo(0.07037, 4);
    expect(rowLabel('flightmodes', row(out, 'wn1')!)).toBe('Phugoid: natural frequency ωn');
    expect(out.headline?.key).toBe('n.stable');
    // Independent: the period is 2 pi over the imaginary part.
    expect(row(out, 'period1')?.value).toBeCloseTo((2 * Math.PI) / 0.112247, 2);
  });

  it('names the Dutch roll, roll and spiral modes of a lateral matrix', () => {
    const out = run({ axis: 'lateral' });
    const names = out.rows.filter((r) => r.label === 'root').map((r) => r.vars?.mode);
    expect(names).toEqual(['@mode.dutchRoll', '@mode.roll', '@mode.spiral']);
  });

  it('builds the matrix from dimensional derivatives', () => {
    const out = run({ source: 'derivatives' });
    const A = longitudinalA({
      Xu: -0.045,
      Xw: 0.036,
      Zu: -0.37,
      Zw: -2.02,
      Mu: 0,
      Mw: -0.05,
      Mq: -2.05,
      Mwdot: -0.0051,
      U0: 67,
      theta0: 0,
    });
    const direct = run({ A: A.map((r) => r.join(' ')).join('; ') });
    expect(row(out, 'wn0')?.value).toBeCloseTo(row(direct, 'wn0')?.value ?? NaN, 12);
  });

  it('refuses a matrix that is not 4 by 4, and flags an unstable mode', () => {
    expect(() => parseMatrix('1 2; 3 4')).toThrow();
    const bad = runSpec(spec, { ...initialValues(spec, 'si'), A: '1 2 3 4; 5 6 7 8; 9 1 2 3; 4 5 6' });
    expect(bad.ok ? '' : bad.error.code).toBe('matrixShape');
    const up = run({ A: '-0.02 0.05 0 -9.81; -0.1 -1.2 60 0; 0.001 -0.05 1.5 0; 0 0 1 0' });
    expect(up.headline?.key).toBe('n.unstable');
  });
});
