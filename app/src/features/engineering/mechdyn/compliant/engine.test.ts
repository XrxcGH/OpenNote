import { describe, expect, it } from 'vitest';
import { COMPLIANT_DEFAULTS, elastica, solveCompliant, type CompliantInput } from './engine';

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
// L = 1 m, EI = 1/6 N m^2 (E 200 GPa, 10 mm x 1 mm), so PL^2/EI = 2 needs P = 1/3 N.
const unit: CompliantInput = {
  ...COMPLIANT_DEFAULTS,
  length: 1,
  E: 200e9,
  width: 0.01,
  thickness: 0.001,
  force: 0,
  forceAngle: Math.PI / 2,
};
const EI = (200e9 * 0.01 * 1e-9) / 12;

describe('compliant mechanisms', () => {
  it('cantilever, end force square to the beam, PL^2/EI = 2, by the elastica', () => {
    const r = ok(solveCompliant({ ...unit, force: 2 * EI }));
    expect(r.loadIndex).toBeCloseTo(2, 12);
    expect(Math.abs(r.exact.a - 0.83936)).toBeLessThan(1e-4);
    expect(Math.abs(r.exact.b - 0.49346)).toBeLessThan(1e-4);
    expect(Math.abs((r.exact.theta * 180) / Math.PI - 44.791)).toBeLessThan(1e-4 * 44.791);
    // Independent: integrating EI theta'' = -P cos(theta) once gives (EI/2) theta'^2 = P (sin theta0 - sin theta), and
    // at the root EI theta' = P a, so a/L = sqrt(2 sin theta0 / (PL^2/EI)).
    expect(r.exact.a).toBeCloseTo(Math.sqrt(2 * Math.sin(r.exact.theta)) / Math.sqrt(2), 6);
  });

  it('same by the pseudo-rigid-body model', () => {
    const r = ok(solveCompliant({ ...unit, force: 2 * EI }));
    expect(Math.abs(r.prbm.a - 0.84377)).toBeLessThan(1e-4);
    expect(Math.abs(r.prbm.b - 0.49111)).toBeLessThan(1e-4);
    expect(Math.abs((r.prbm.Theta * 180) / Math.PI - 35.294)).toBeLessThan(1e-3);
    expect(Math.abs((r.prbm.endAngle * 180) / Math.PI - 43.76)).toBeLessThan(0.01);
    // Within 0.6% of the elastica in position.
    expect(r.positionError).toBeLessThan(0.006);
    // Independent: 2.65 Theta = 2 cos Theta.
    expect(2.65 * r.prbm.Theta).toBeCloseTo(2 * Math.cos(r.prbm.Theta), 10);
  });

  it('small loads match linear beam theory', () => {
    const P = 1e-4 * EI;
    const r = ok(solveCompliant({ ...unit, force: P }));
    expect(r.exact.b).toBeCloseTo(P / (3 * EI), 8);
    // A pure end moment bends the beam into a circular arc of radius EI/M.
    const M = 0.5 * EI;
    const arc = elastica([{ length: 1, EI }], 0, 0, M)!;
    expect(arc.theta).toBeCloseTo(0.5, 9);
    expect(arc.a).toBeCloseTo(2 * Math.sin(0.5), 8);
  });

  it('fixed-guided flexure is antisymmetric with no end rotation', () => {
    const r = ok(solveCompliant({ ...unit, type: 'fixedGuided', force: 1e-4 * EI }));
    // Linear: delta = F L^3 / (12 EI).
    expect(r.exact.b).toBeCloseTo((1e-4 * EI) / (12 * EI), 8);
    expect(r.prbm.endAngle).toBe(0);
  });

  it('flexural pivot: PRBM with K = EI/l is close to the elastica', () => {
    const r = ok(solveCompliant({ ...unit, type: 'pivot', length: 0.05, rigidLength: 0.5, force: 0.01 }));
    expect(r.prbm.K).toBeCloseTo(EI / 0.05, 9);
    expect(r.positionError).toBeLessThan(0.01);
  });

  it('stress is the bending stress at the root plus the axial stress', () => {
    const r = ok(solveCompliant({ ...unit, force: 2 * EI }));
    const I = (0.01 * 1e-9) / 12;
    expect(r.stress.bending).toBeCloseTo((Math.abs(r.exact.rootMoment) * 0.0005) / I, 0);
  });

  it('rejects impossible input with a reason', () => {
    expect(solveCompliant({ ...unit, length: 0 })).toEqual({ ok: false, error: 'positiveLength' });
    expect(solveCompliant({ ...unit, E: -1 })).toEqual({ ok: false, error: 'positiveProperties' });
    expect(solveCompliant({ ...unit, type: 'pivot', rigidLength: 0 })).toEqual({ ok: false, error: 'pivotRigid' });
    expect(solveCompliant({ ...unit, type: 'fixedGuided', moment: 1 })).toEqual({ ok: false, error: 'guidedMoment' });
    expect(solveCompliant({ ...unit, force: Number.NaN })).toEqual({ ok: false, error: 'notNumber' });
  });
});
