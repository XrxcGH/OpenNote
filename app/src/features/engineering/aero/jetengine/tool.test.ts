// The jet engine tool's form: the ideal turbojet from typed ambient values, the atmosphere at altitude, a
// non-ideal turbofan, the station table, the optional mass flow, and the US system.
import { describe, expect, it } from 'vitest';
import { atmosphere } from '../atmosphere/engine';
import { initialValues, runSpec, visibleFields } from '../ui/spec';
import type { ToolOutput } from '../ui/spec';
import { tableText } from '../ui/DataTable';
import { cycle, IDEAL } from './engine';
import { spec } from './tool';

const run = (changes: Record<string, string>, system: 'si' | 'us' = 'si'): ToolOutput => {
  const result = runSpec(spec, { ...initialValues(spec, system), ...changes }, system);
  if (!result.ok) throw result.error;
  return result.output;
};
const value = (output: ToolOutput, id: string) => output.rows.find((r) => r.id === id)?.value ?? NaN;
const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);

describe('the jet engine tool', () => {
  it('runs the ideal turbojet case from typed ambient values', () => {
    const out = run({ ambient: 'typed', T0: '216.7', P0: '22632' });
    rel(value(out, 'specificThrust'), 909.41, 1e-4);
    rel(value(out, 'S') * 1e6, 26.215, 1e-4);
    expect(out.tables?.[0]?.rows.length).toBe(6);
    expect(out.plots?.length).toBe(2);
    expect(out.latex).toContain('V_9');
  });

  it('reads the ambient state from the standard atmosphere', () => {
    const out = run({ altitude: '11000' });
    const air = atmosphere({ mode: 'altitude', altitude: 11000, kind: 'geometric' });
    rel(value(out, 'T0'), air.T, 1e-12);
    rel(value(out, 'P0'), air.p, 1e-12);
  });

  it('shows the loss fields only for the non-ideal cycle, and the fan fields only for a turbofan', () => {
    const ids = (v: Record<string, string>) =>
      visibleFields(spec, { ...initialValues(spec, 'si'), ...v }).map((f) => f.id);
    expect(ids({})).not.toContain('ec');
    expect(ids({ model: 'real' })).toContain('ec');
    expect(ids({ model: 'real' })).not.toContain('ef');
    expect(ids({ type: 'turbofan', model: 'real' })).toEqual(expect.arrayContaining(['ef', 'piFn', 'alpha']));
    expect(ids({ type: 'ramjet' })).not.toContain('piC');
  });

  it('runs a non-ideal turbofan the same as the engine', () => {
    const out = run({ type: 'turbofan', model: 'real', ambient: 'typed', T0: '216.7', P0: '22632', M0: '0.8' });
    const r = cycle({
      type: 'turbofan',
      ideal: false,
      M0: 0.8,
      T0: 216.7,
      P0: 22632,
      gammaC: 1.4,
      cpC: 1004,
      gammaT: 1.33,
      cpT: 1156,
      hPR: 42.8e6,
      Tt4: 1600,
      piC: 20,
      piF: 1.6,
      alpha: 5,
      losses: {
        ...IDEAL,
        piDmax: 0.98,
        piB: 0.96,
        piN: 0.98,
        piFn: 0.98,
        ec: 0.9,
        ef: 0.89,
        et: 0.89,
        etaB: 0.99,
        etaM: 0.99,
      },
    });
    rel(value(out, 'specificThrust'), r.specificThrust, 1e-12);
    expect(value(out, 'FR')).toBeGreaterThan(0);
  });

  it('gives thrust and fuel flow when the mass flow is typed', () => {
    const out = run({ m0: '50' });
    rel(value(out, 'thrust'), 50 * value(out, 'specificThrust'), 1e-12);
    rel(value(out, 'fuelFlow'), value(out, 'S') * value(out, 'thrust'), 1e-12);
  });

  it('writes the station table in the US system', () => {
    const out = run({ ambient: 'typed', T0: '390.06', P0: '472.68' }, 'us');
    const { header, rows } = tableText('jetengine', out.tables![0]!, 'us');
    expect(header).toEqual(['Station', 'Total temperature Tt (°R)', 'Total pressure Pt (lbf/ft²)']);
    expect(rows[0]?.[0]).toBe('0, free stream');
    // T0 = 390.06 R is 216.7 K; Tt0 = T0 tau_r.
    expect(Number(rows[0]?.[1])).toBeCloseTo(390.06 * (1 + 0.2 * 0.85 ** 2), 1);
  });

  it('says why an impossible engine cannot run', () => {
    const bad = runSpec(spec, { ...initialValues(spec, 'si'), type: 'ramjet', M0: '0' });
    expect(bad.ok ? '' : bad.error.code).toBe('ramjetStatic');
  });
});
