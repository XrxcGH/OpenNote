/* eslint-disable opennote/feature-boundaries -- The tests hand the engines the math feature's algebra directly. */
import '../text';
import { describe, expect, it } from 'vitest';
import {
  COORDS_DEFAULTS,
  IMPACT_DEFAULTS,
  RIGID_DEFAULTS,
  ROLLING_DEFAULTS,
  solveCoords,
  solveImpact,
  solveRigid,
  solveRolling,
} from './engine';
import { simplest, substitute } from '../../../math/calculus/algebra';
import { derivativeOf } from '../../../math/calculus/derivative';
import { latexOf } from '../../../math/calculus/print';
import { provideSymbolic } from '../symbolic';

provideSymbolic({ derivativeOf, latexOf, simplest, substitute });

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};

describe('particle and planar rigid-body dynamics', () => {
  it('polar r = 2t^2, theta = t, at t = 1 s', () => {
    const r = ok(solveCoords({ ...COORDS_DEFAULTS, system: 'polar', first: '2t^2', second: 't', t: 1 }));
    expect(Math.abs(r.polar!.vr - 4)).toBeLessThan(1e-9);
    expect(Math.abs(r.polar!.vth - 2)).toBeLessThan(1e-9);
    expect(Math.abs(r.polar!.ar - 2)).toBeLessThan(1e-9);
    expect(Math.abs(r.polar!.ath - 8)).toBeLessThan(1e-9);
    // Independent: differentiate x = 2t^2 cos t and y = 2t^2 sin t by central differences.
    const x = (t: number) => 2 * t * t * Math.cos(t),
      y = (t: number) => 2 * t * t * Math.sin(t),
      h = 1e-4;
    expect(r.velocity[0]).toBeCloseTo((x(1 + h) - x(1 - h)) / (2 * h), 6);
    expect(r.acceleration[1]).toBeCloseTo((y(1 + h) - 2 * y(1) + y(1 - h)) / (h * h), 4);
    expect(r.speed).toBeCloseTo(Math.hypot(4, 2), 12);
  });

  it('rectangular motion on a circle gives the circle radius as the radius of curvature', () => {
    const r = ok(solveCoords({ system: 'rect', first: '3cos(2t)', second: '3sin(2t)', t: 0.7, tEnd: 4 }));
    expect(r.rho).toBeCloseTo(3, 9);
    expect(r.at).toBeCloseTo(0, 9);
    expect(r.an).toBeCloseTo(12, 9);
  });

  it('central impact m1 2 kg at 5 m/s, m2 3 kg at -1 m/s, e 0.8', () => {
    const r = ok(solveImpact(IMPACT_DEFAULTS));
    expect(Math.abs(r.v1[0] - -1.48)).toBeLessThan(1e-9);
    expect(Math.abs(r.v2[0] - 3.32)).toBeLessThan(1e-9);
    expect(Math.abs(r.energyLost - 7.776)).toBeLessThan(1e-9);
    // Independent: energy lost = (1 - e^2) m1 m2 / (2 (m1 + m2)) (v1 - v2)^2.
    expect(r.energyLost).toBeCloseTo(((1 - 0.64) * 6 * 36) / 10, 12);
  });

  it('oblique impact keeps the tangential parts', () => {
    const r = ok(solveImpact({ m1: 1, m2: 1, v1: [3, 4], v2: [0, 0], e: 1, line: 0 }));
    expect(r.v1[0]).toBeCloseTo(0, 12);
    expect(r.v1[1]).toBeCloseTo(4, 12);
    expect(r.v2[0]).toBeCloseTo(3, 12);
    expect(r.energyLost).toBeCloseTo(0, 12);
    const turned = ok(solveImpact({ m1: 1, m2: 1, v1: [1, 1], v2: [0, 0], e: 1, line: Math.PI / 4 }));
    expect(turned.v2[0]).toBeCloseTo(1, 12);
    expect(turned.v2[1]).toBeCloseTo(1, 12);
  });

  it('solid disk rolling without slip down a 30 deg incline', () => {
    const r = ok(solveRolling({ ...ROLLING_DEFAULTS, shape: 'disk', angle: Math.PI / 6, g: 9.81 }));
    expect(Math.abs(r.acceleration - 3.27)).toBeLessThan(1e-6);
    expect(Math.abs(r.acceleration - (2 / 3) * 9.81 * 0.5)).toBeLessThan(1e-12);
    expect(r.muNeeded).toBeCloseTo(Math.tan(Math.PI / 6) / 3, 12);
    expect(r.speed).toBeCloseTo(Math.sqrt((2 * 9.81 * 0.5) / 1.5), 12);
  });

  it('a body with too little friction slips', () => {
    const r = ok(solveRolling({ ...ROLLING_DEFAULTS, shape: 'hoop', mu: 0.1 }));
    expect(r.slipping).toBe(true);
    expect(r.acceleration).toBeCloseTo(9.81 * (0.5 - 0.1 * Math.cos(Math.PI / 6)), 12);
  });

  it('relative velocity, acceleration, and the instantaneous center', () => {
    const r = ok(solveRigid(RIGID_DEFAULTS));
    // vB = (2, 0) + 4 k x (0.3, 0.4) = (2 - 1.6, 1.2)
    expect(r.vB[0]).toBeCloseTo(0.4, 12);
    expect(r.vB[1]).toBeCloseTo(1.2, 12);
    // aB = -2 k x r - 16 r = (0.8 - 4.8, -0.6 - 6.4)
    expect(r.aB[0]).toBeCloseTo(-4, 12);
    expect(r.aB[1]).toBeCloseTo(-7, 12);
    // The IC has zero velocity: vA + w k x (IC - A) = 0.
    const [x, y] = r.ic!;
    expect(2 - 4 * y).toBeCloseTo(0, 12);
    expect(0 + 4 * x).toBeCloseTo(0, 12);
    expect(ok(solveRigid({ ...RIGID_DEFAULTS, omega: 0 })).ic).toBeNull();
  });

  it('rejects impossible input with a reason', () => {
    expect(solveImpact({ ...IMPACT_DEFAULTS, e: 1.2 })).toEqual({ ok: false, error: 'restitutionRange' });
    expect(solveImpact({ ...IMPACT_DEFAULTS, m1: 0 })).toEqual({ ok: false, error: 'positiveMass' });
    expect(solveImpact({ ...IMPACT_DEFAULTS, v1: [-5, 0] })).toEqual({ ok: false, error: 'noApproach' });
    expect(solveRolling({ ...ROLLING_DEFAULTS, angle: 0 })).toEqual({ ok: false, error: 'inclineAngle' });
    expect(solveRolling({ ...ROLLING_DEFAULTS, radius: -1 })).toEqual({ ok: false, error: 'positiveRadius' });
    expect(solveRigid({ ...RIGID_DEFAULTS, B: [0, 0] })).toEqual({ ok: false, error: 'samePoint' });
    expect(solveCoords({ ...COORDS_DEFAULTS, first: '2t^' })).toMatchObject({ ok: false, error: 'exprSyntax' });
    expect(solveCoords({ ...COORDS_DEFAULTS, first: 'q t' })).toMatchObject({ ok: false, error: 'exprUnknown' });
    expect(solveCoords({ ...COORDS_DEFAULTS, first: 'ln(t)', t: 0 })).toEqual({ ok: false, error: 'undefinedAtTime' });
    expect(solveCoords({ ...COORDS_DEFAULTS, t: Number.NaN })).toEqual({ ok: false, error: 'notNumber' });
  });
});
