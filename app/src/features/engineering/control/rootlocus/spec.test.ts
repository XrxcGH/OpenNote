// The root locus tool through the window's path: the plan's answers as shown, and problems on their fields.
import { describe, expect, it } from 'vitest';
import { runTool } from '../ui/read';
import { firstTexts } from '../ui/spec';
import { spec } from './spec';

const run = (texts: Record<string, string>) => runTool(spec, { ...firstTexts(spec), ...texts }, 'si');
const rows = (texts: Record<string, string>) => {
  const r = run(texts);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return Object.fromEntries(r.outcome.rows.map((row) => [row.id, String(row.value)]));
};
const problem = (texts: Record<string, string>) => {
  const r = run(texts);
  if (r.ok) throw new Error('expected a problem');
  return r.fields.map((f) => `${f.field}: ${f.problem.key.split('.').pop()}`).join('; ') || r.error?.key;
};

describe('the root locus tool', () => {
  it('shows the rules for K/(s(s + 2)(s + 4))', () => {
    const r = rows({ mode: 'locus' });
    expect(r.centroid).toBe('−2');
    expect(r.asymptotes).toBe('60°, 180°, −60°');
    // K = −s(s + 2)(s + 4) at s = −2 + 2/√3 is 16/(3√3) = 3.0792.
    expect(r.breaks).toBe('−0.845299 (K = 3.0792)');
    expect(r.crossings).toBe('ω = 2.82843 rad/s (K = 48)');
    expect(r.ranges).toBe('0 < K < 48');
  });

  it('gives the stable range and the Routh verdicts', () => {
    expect(rows({ mode: 'range' }).ranges).toBe('0 < K < 48');
    const eps = rows({ mode: 'routh' });
    expect(eps.rhp).toBe('2');
    expect(eps.unstable).toBe('✓');
    const zeros = rows({ mode: 'routh', poly: 's^3 + 2s^2 + 4s + 8' });
    expect(zeros.axis).toBe('2');
    expect(zeros.marginal).toBe('✓');
  });

  it('finds K = 48 at s = 2.82843i', () => {
    expect(rows({ mode: 'gain', by: 'point', point: '2.828427125i' }).gain).toBe('48');
  });

  it('marks impossible input on its field', () => {
    expect(problem({ mode: 'routh', poly: '1/(s + 1)' })).toBe('poly: notPolynomial');
    expect(problem({ mode: 'routh', poly: '5' })).toBe('poly: routhOrder');
    expect(problem({ g: 's + 1' })).toBe('g: locusNoPoles');
    expect(problem({ g: '(s^3 + 1)/(s + 1)' })).toBe('g: improper');
    expect(problem({ mode: 'gain', by: 'point', point: '1 + i' })).toBe('point: notOnLocus');
    expect(problem({ mode: 'gain', zeta: '2' })).toBe('zeta: zetaRange');
  });
});
