import '../text';
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

  it('stress at a small load is the root bending stress 6FL/(wt^2)', () => {
    const P = 1e-4 * EI;
    const r = ok(solveCompliant({ ...unit, force: P }));
    // By hand: M = F L at the root, sigma = M (t/2) / (w t^3 / 12) = 6 F L / (w t^2).
    const sigma = (6 * P * 1) / (0.01 * 1e-6);
    expect(Math.abs(r.stress.bending - sigma) / sigma).toBeLessThan(1e-6);
    expect(Math.abs(r.stress.axial)).toBeLessThan(1e-3 * sigma);
  });

  it('rejects impossible input with a reason', () => {
    expect(solveCompliant({ ...unit, length: 0 })).toEqual({ ok: false, error: 'positiveLength' });
    expect(solveCompliant({ ...unit, E: -1 })).toEqual({ ok: false, error: 'positiveProperties' });
    expect(solveCompliant({ ...unit, type: 'pivot', rigidLength: 0 })).toEqual({ ok: false, error: 'pivotRigid' });
    expect(solveCompliant({ ...unit, type: 'fixedGuided', moment: 1 })).toEqual({ ok: false, error: 'guidedMoment' });
    expect(solveCompliant({ ...unit, force: Number.NaN })).toEqual({ ok: false, error: 'notNumber' });
  });
});

// The complete elliptic integrals by the arithmetic-geometric mean, for the buckled elastica.
function ellipticKE(k: number): [number, number] {
  let a = 1,
    g = Math.sqrt(1 - k * k),
    c = k,
    sum = (k * k) / 2,
    pow = 0.5;
  while (Math.abs(c) > 1e-15) {
    const an = (a + g) / 2;
    c = (a - g) / 2;
    g = Math.sqrt(a * g);
    a = an;
    pow *= 2;
    sum += pow * c * c;
  }
  const K = Math.PI / (2 * a);
  return [K, K * (1 - sum)];
}

describe('compliant mechanisms: end moment and buckling', () => {
  it('a pure end moment ML/EI = 1 uses the moment-load model, within 1% of the circular arc', () => {
    const r = ok(solveCompliant({ ...unit, force: 0, moment: EI }));
    // Exact: a circular arc of curvature M/EI = 1, so a/L = sin 1, b/L = 1 - cos 1, theta0 = 1 rad.
    expect(r.exact.a).toBeCloseTo(Math.sin(1), 6);
    expect(r.exact.b).toBeCloseTo(1 - Math.cos(1), 6);
    expect(r.exact.theta).toBeCloseTo(1, 6);
    // Howell's moment-load model: K = 1.5164 EI/L, Theta = 1/1.5164, theta0 = 1.5164 Theta = 1 rad.
    expect(r.prbm.constants).toBe('moment');
    expect(r.prbm.a).toBeCloseTo(0.846, 3);
    expect(r.prbm.b).toBeCloseTo(0.4501, 3);
    expect((r.prbm.endAngle * 180) / Math.PI).toBeCloseTo(57.3, 1);
    expect(Math.abs(r.prbm.a - Math.sin(1))).toBeLessThan(0.01);
    expect(Math.abs(r.prbm.b - (1 - Math.cos(1)))).toBeLessThan(0.01);
    expect(r.positionError).toBeLessThan(0.011);
  });

  it('a force with a moment keeps the end-force constants and says they are approximate', () => {
    const r = ok(solveCompliant({ ...unit, force: EI, moment: EI }));
    expect(r.prbm.constants).toBe('force');
    expect(r.steps.some((step) => step.key === 'compliantCombinedLoad')).toBe(true);
  });

  it('a compressive load of 1.5 times the critical load buckles the cantilever', () => {
    const Pcr = (Math.PI ** 2 * EI) / 4;
    const r = ok(solveCompliant({ ...unit, force: 1.5 * Pcr, forceAngle: Math.PI }));
    expect(r.buckled).toBe(true);
    expect(r.critical).toBeCloseTo(Pcr, 12);
    expect(r.steps.some((step) => step.key === 'compliantBuckled')).toBe(true);
    // Independent: the buckled cantilever has P/Pcr = (2K(k)/pi)^2, tip deflection 2k/K, tip x = 2E/K - 1, and end
    // angle 2 asin k. Solve K(k) = (pi/2) sqrt(1.5) by bisection.
    let [lo, hi] = [0, 0.999];
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2;
      if (ellipticKE(mid)[0] < (Math.PI / 2) * Math.sqrt(1.5)) lo = mid;
      else hi = mid;
    }
    const k = lo;
    const [K, E] = ellipticKE(k);
    expect(Math.abs(r.exact.b)).toBeCloseTo((2 * k) / K, 4);
    expect(r.exact.a).toBeCloseTo((2 * E) / K - 1, 4);
    expect(Math.abs(r.exact.theta)).toBeCloseTo(2 * Math.asin(k), 4);
  });

  it('below the critical load the straight shape stands', () => {
    const Pcr = (Math.PI ** 2 * EI) / 4;
    const r = ok(solveCompliant({ ...unit, force: 0.5 * Pcr, forceAngle: Math.PI }));
    expect(r.buckled).toBe(false);
    expect(Math.abs(r.exact.b)).toBeLessThan(1e-6);
  });
});
