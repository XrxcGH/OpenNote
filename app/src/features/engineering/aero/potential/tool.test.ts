// The potential flow tool's form: the planning cases through the presets, the element list read from text, the
// probe in US units, and a list it cannot read.
import '../text';
import { describe, expect, it } from 'vitest';
import { initialValues, runSpec, unitKey } from '../ui/spec';
import type { ToolOutput } from '../ui/spec';
import { parseElements, spec } from './tool';

const run = (changes: Record<string, string>): ToolOutput => {
  const result = runSpec(spec, { ...initialValues(spec, 'si'), ...changes });
  if (!result.ok) throw result.error;
  return result.output;
};
const row = (output: ToolOutput, id: string) => output.rows.find((r) => r.id === id)?.value ?? NaN;
const text = (output: ToolOutput, id: string) => output.rows.find((r) => r.id === id)?.text ?? '';

describe('the potential flow tool', () => {
  it('gives the lifting cylinder its Kutta-Joukowski lift, with one stagnation point at the bottom', () => {
    const out = run({});
    expect(Math.abs(row(out, 'lift') / 1539.38 - 1)).toBeLessThan(1e-5);
    expect(text(out, 'stagnation')).toBe('(0.000, -1.000)');
    // Independent: on top of the cylinder the speed is 2U + Γ/(2πa) = 40 m/s, so Cp = 1 - 16.
    expect(row(out, 'Cp')).toBeCloseTo(-15, 9);
  });

  it('gives Cp = -3 on top of a cylinder without circulation', () => {
    const out = run({ preset: 'cylinder' });
    expect(row(out, 'Cp')).toBeCloseTo(-3, 9);
    expect(row(out, 'lift')).toBe(0);
    expect(text(out, 'stagnation')).toBe('(-1.000, 0), (1.000, 0)'.replace(/ 0\)/g, ' 0.000)'));
  });

  it('puts the Rankine half-body stagnation point at x = -m/(2 pi U)', () => {
    const out = run({ preset: 'halfBody', U: '1', m: '2*pi', px: '-1', py: '0.5' });
    expect(text(out, 'stagnation')).toBe('(-1.000, 0.000)');
  });

  it('reads an element list, sinks as negative sources', () => {
    expect(parseElements('uniform 1 30; sink 2 1 0')).toEqual([
      { kind: 'uniform', strength: 1, x: 0, y: 0, angle: 30 },
      { kind: 'source', strength: -2, x: 1, y: 0 },
    ]);
    expect(parseElements('vortex 2*pi, -1, 0.5')[0]?.strength).toBeCloseTo(2 * Math.PI, 12);
    const out = run({ preset: 'custom', elements: 'uniform 1; source 2*pi 0 0', px: '-1', py: '1' });
    expect(text(out, 'stagnation')).toBe('(-1.000, 0.000)');
  });

  it('places the probe from US units', () => {
    const us = run({ preset: 'cylinder', py: String(1 / 0.3048), [unitKey('py')]: 'ft' });
    expect(row(us, 'Cp')).toBeCloseTo(-3, 9);
  });

  it('says which element it cannot read, and refuses a probe on a singularity', () => {
    const bad = runSpec(spec, { ...initialValues(spec, 'si'), preset: 'custom', elements: 'uniform 1; spring 3 0 0' });
    expect(bad.ok ? '' : bad.error.code).toBe('elementText');
    expect(bad.ok ? {} : bad.error.vars).toEqual({ part: 'spring 3 0 0' });
    const on = runSpec(spec, { ...initialValues(spec, 'si'), py: '0' });
    expect(on.ok ? '' : on.error.code).toBe('probeOnElement');
  });

  it('reads a custom element list in US units when the window is in US units', () => {
    const ft = 0.3048;
    expect(parseElements('doublet 1 1 2; vortex 3 0 0; uniform 4', 'us')).toEqual([
      { kind: 'doublet', strength: ft ** 3, x: ft, y: 2 * ft },
      { kind: 'vortex', strength: 3 * ft * ft, x: 0, y: 0 },
      { kind: 'uniform', strength: 4 * ft, x: 0, y: 0, angle: 0 },
    ]);
    const values = {
      ...initialValues(spec, 'us'),
      preset: 'custom',
      elements: 'uniform 10; vortex 100 0 0',
      rho: '0.002377',
    };
    const result = runSpec(spec, values, 'us');
    if (!result.ok) throw result.error;
    // Kutta-Joukowski in US units: L' = rho U Gamma = 0.002377 x 10 x 100 = 2.377 lbf/ft, held in N/m.
    expect(row(result.output, 'lift') / ((2.377 * 4.4482216152605) / ft) - 1).toBeCloseTo(0, 9);
  });
});
