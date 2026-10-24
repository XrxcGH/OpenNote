// The airfoil tool's form: an NACA designation and typed parameters give the same section, angles arrive in any
// unit, the flat plate drops the panels, and the coordinate table reads in the page's words.
import { describe, expect, it } from 'vitest';
import { tableText } from '../ui/DataTable';
import { initialValues, runSpec, unitKey, visibleFields } from '../ui/spec';
import type { ToolOutput } from '../ui/spec';
import { spec } from './tool';

const run = (changes: Record<string, string>, system: 'si' | 'us' = 'si'): ToolOutput => {
  const result = runSpec(spec, { ...initialValues(spec, system), ...changes });
  if (!result.ok) throw result.error;
  return result.output;
};
const value = (output: ToolOutput, id: string) => output.rows.find((r) => r.id === id)?.value ?? NaN;

describe('the airfoil tool', () => {
  it('runs NACA 2412 at 4° by both methods', () => {
    const out = run({});
    expect(value(out, 'alphaL0')).toBeCloseTo(-2.07724, 5);
    expect(value(out, 'clThin')).toBeCloseTo(2 * Math.PI * (4 + 2.077240404903986) * (Math.PI / 180), 9);
    expect(value(out, 'clPanel')).toBeCloseTo(0.7414048, 6);
    expect(out.plots?.map((p) => p.title)).toEqual(['section', 'cp']);
    expect(out.latex).toContain('c_l');
  });

  it('gives the same answer from typed camber and thickness', () => {
    const a = run({});
    const b = run({ shape: 'custom', m: '0.02', p: '0.4', t: '0.12' });
    expect(value(b, 'clPanel')).toBe(value(a, 'clPanel'));
    expect(value(b, 'cmThin')).toBe(value(a, 'cmThin'));
  });

  it('takes the angle in radians as well as degrees', () => {
    const out = run({ alpha: String((4 * Math.PI) / 180), [unitKey('alpha')]: 'rad' });
    expect(value(out, 'clPanel')).toBeCloseTo(value(run({}), 'clPanel'), 9);
  });

  it('shows only thin airfoil theory for a flat plate, and says why', () => {
    const out = run({ code: '0000', alpha: '5' });
    expect(value(out, 'clThin')).toBeCloseTo(0.548311, 6);
    expect(out.rows.some((r) => r.id === 'clPanel')).toBe(false);
    expect(out.notes?.map((n) => n.key)).toContain('n.noThickness');
    expect(out.plots?.length).toBe(1);
  });

  it('shows the design lift coefficient of a five-digit section, and flags high angles', () => {
    const out = run({ code: '23012', alpha: '20' });
    expect(value(out, 'cli')).toBeCloseTo(0.3, 12);
    expect(out.notes?.map((n) => n.key)).toContain('n.highAlpha');
  });

  it('tabulates the coordinates for the page', () => {
    const out = run({ te: 'open' });
    const table = tableText('airfoil', out.tables![0]!, 'si');
    expect(table.header).toEqual(['Station x/c', 'Upper x', 'Upper y', 'Lower x', 'Lower y']);
    expect(table.rows.length).toBe(18);
    expect(table.rows[0]![0]).toBe('0');
  });

  it('switches fields with the section kind', () => {
    const ids = (v: Record<string, string>) =>
      visibleFields(spec, { ...initialValues(spec, 'si'), ...v }).map((f) => f.id);
    expect(ids({})).toContain('code');
    expect(ids({})).not.toContain('m');
    expect(ids({ shape: 'custom' })).toEqual(expect.arrayContaining(['m', 'p', 't']));
  });

  it('reports a bad designation instead of guessing', () => {
    const result = runSpec(spec, { ...initialValues(spec, 'si'), code: '2012' });
    expect(result.ok).toBe(false);
  });
});
