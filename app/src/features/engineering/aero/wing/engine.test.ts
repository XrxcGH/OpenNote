import '../text';
import { describe, expect, it } from 'vitest';
import { AeroError } from '../common';
import { wing, type WingInput } from './engine';

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThan(tol);
const rect = (AR: number, extra: Partial<WingInput> = {}): WingInput => ({
  span: AR,
  area: AR,
  planform: 'tapered',
  taper: 1,
  twist: 0,
  a0: 2 * Math.PI,
  alphaL0: 0,
  alpha: 5,
  ...extra,
});

describe('lifting-line theory', () => {
  it('matches the elliptic wing of AR 8', () => {
    const r = wing(rect(8, { planform: 'elliptic' }));
    close(r.a, 5.0265, 1e-4);
    // Independent: a = a0 / (1 + a0/(pi AR)); CDi = CL^2/(pi AR) at CL = 0.5.
    close(r.a, (2 * Math.PI) / (1 + 2 / 8), 1e-9);
    close(r.delta, 0, 1e-9);
    const atHalf = wing(rect(8, { planform: 'elliptic', alpha: 0.5 / r.a / (Math.PI / 180) }));
    close(atHalf.CL, 0.5, 1e-9);
    close(atHalf.CDi, 0.0099472, 1e-4);
    close(atHalf.CDi, 0.25 / (8 * Math.PI), 1e-10);
  });

  it('matches the rectangular wing of AR 6 at 5 degrees', () => {
    const r = wing(rect(6));
    close(r.e, 0.954, 0.003);
    close(r.CL, 0.3954, 0.002);
    // CDi from the coefficients equals CL^2 (1 + delta)/(pi AR).
    close(r.CDi, (r.CL * r.CL * (1 + r.delta)) / (6 * Math.PI), 1e-12);
  });

  it('matches the rectangular wing of AR 8 and the tapered wing of taper 0.4', () => {
    close(wing(rect(8)).e, 0.937, 0.003);
    close(wing(rect(8, { taper: 0.4 })).e, 0.987, 0.003);
  });

  it('converges as the number of terms grows', () => {
    const a = wing(rect(6, { terms: 20 })).CL;
    const b = wing(rect(6, { terms: 80 })).CL;
    expect(Math.abs(a - b) / b).toBeLessThan(2e-3);
  });

  it('shifts the zero-lift angle with washout and keeps the lift slope', () => {
    const plain = wing(rect(8, { taper: 0.5 }));
    const washed = wing(rect(8, { taper: 0.5, twist: -3 }));
    close(washed.a, plain.a, 1e-12);
    expect(washed.alphaL0Wing).toBeGreaterThan(0);
    expect(washed.CL).toBeLessThan(plain.CL);
  });

  it('gives forces from a flight condition', () => {
    const r = wing(rect(8, { V: 50, rho: 1.225 }));
    close(r.lift ?? 0, 0.5 * 1.225 * 2500 * 8 * r.CL, 1e-9);
  });

  it('handles zero lift and rejects bad geometry', () => {
    const zero = wing(rect(6, { alpha: 0 }));
    close(zero.CL, 0, 1e-15);
    close(zero.e, wing(rect(6)).e, 1e-12);
    expect(() => wing(rect(6, { taper: 1.5 }))).toThrow(AeroError);
    expect(() => wing(rect(6, { span: 0 }))).toThrow(AeroError);
    expect(() => wing(rect(6, { area: -1 }))).toThrow(AeroError);
    expect(() => wing(rect(6, { terms: 1 }))).toThrow(AeroError);
    expect(() => wing(rect(6, { a0: 0 }))).toThrow(AeroError);
  });
});
