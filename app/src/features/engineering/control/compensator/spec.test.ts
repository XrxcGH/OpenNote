// The compensator tool through the window's path: the plan's answers as shown, and problems on their fields.
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

describe('the compensator tool', () => {
  it('gives the Ziegler-Nichols PID for Ku = 48, ωu = 2.8284', () => {
    const r = rows({ mode: 'zn' });
    expect([r.pu, r.kpPid, r.tiPid, r.tdPid]).toEqual(['2.22146 s', '28.8', '1.11073 s', '0.277683 s']);
  });

  it('finds the same table from the plant 1/(s(s + 2)(s + 4))', () => {
    const r = rows({ mode: 'zn', source: 'plant', g: '1/(s (s + 2) (s + 4))' });
    expect(r.ku).toBe('48');
    expect(r.kpPid).toBe('28.8');
  });

  it('designs a lead that meets the margin and reports before and after', () => {
    const r = rows({ mode: 'lead' });
    expect(r.k).toBe('10');
    expect(Number(r.pmAfter.replace('°', ''))).toBeGreaterThan(49);
    // A 5° allowance lands just under 50° on this plant: it does not quite cover the phase lost as the crossover
    // moves up, which is why the allowance is a field the student can raise.
    expect(r.cmpPm).toMatch(/^17\.96\d*° → 49\.77\d*°$/);
  });

  it('marks impossible input on its field', () => {
    expect(problem({ mode: 'lead', pm: '95' })).toBe('pm: pmRange');
    expect(problem({ mode: 'lead', errorTarget: '-2' })).toBe('errorTarget: errorTarget');
    expect(problem({ mode: 'locus', zeta: '1.2' })).toBe('zeta: zetaRange');
    expect(problem({ mode: 'zn', ku: '0' })).toBe('ku: ultimatePositive');
    expect(problem({ mode: 'zn', source: 'plant', g: '1/(s + 1)' })).toBe('g: noUltimate');
    expect(problem({ mode: 'simc', tauC: '0' })).toBe('tauC: tauCPositive');
  });
});
