import { describe, expect, it } from 'vitest';
import { rad } from '../num';
import { fourBarAngles, grashof, LINKAGE_DEFAULTS, linkageState, solveLinkage, type LinkageInput } from './engine';

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
const deg = (r: number) => (r * 180) / Math.PI;
const rel = (x: number, y: number) => Math.abs(x - y) / Math.abs(y);

describe('four-bar linkages', () => {
  it('four-bar a 2, b 7, c 9, d 6: Grashof crank-rocker', () => {
    const g = grashof(2, 7, 9, 6);
    expect(g.s + g.l).toBe(11);
    expect(g.pq).toBe(13);
    expect(g.cls).toBe('crankRocker');
    expect(grashof(6, 7, 9, 2).cls).toBe('doubleCrank');
    expect(grashof(6, 2, 9, 7).cls).toBe('doubleRocker');
    expect(grashof(5, 7, 9, 6).cls).toBe('tripleRocker');
    expect(grashof(4, 4, 4, 4).cls).toBe('changePoint');
  });

  it('same, theta2 30 deg, open circuit: link angles and transmission angle', () => {
    const r = ok(solveLinkage(LINKAGE_DEFAULTS));
    expect(Math.abs(deg(r.state.theta3) - 88.837)).toBeLessThan(1e-3);
    expect(Math.abs(deg(r.state.theta4) - 117.286)).toBeLessThan(1e-3);
    expect(Math.abs(deg(r.state.transmission) - 28.449)).toBeLessThan(1e-3);
    // Cross-check: the half-angle theta3 closes the loop with theta4.
    const half = fourBarAngles(LINKAGE_DEFAULTS, rad(30))!;
    expect(half.theta3).toBeCloseTo(r.state.theta3, 10);
    expect(r.state.residual).toBeLessThan(1e-12);
    // Independent: B is c from O4 and b from A.
    const [bx, by] = r.state.joints.B;
    expect(Math.hypot(bx - 6, by)).toBeCloseTo(9, 10);
    expect(Math.hypot(bx - r.state.joints.A[0], by - r.state.joints.A[1])).toBeCloseTo(7, 10);
  });

  it('same, omega2 10 rad/s, alpha2 0: angular velocities and accelerations', () => {
    const r = ok(solveLinkage(LINKAGE_DEFAULTS));
    expect(rel(r.state.omega3, -5.991)).toBeLessThan(1e-3);
    expect(rel(r.state.omega4, -3.9917)).toBeLessThan(1e-3);
    expect(rel(r.state.alpha3, 26.08)).toBeLessThan(1e-3);
    expect(rel(r.state.alpha4, 53.331)).toBeLessThan(1e-3);
    // Independent: differentiate the position solution numerically in theta2.
    const h = 1e-5;
    const at = (t: number) => linkageState(LINKAGE_DEFAULTS, t)!;
    const t0 = rad(30);
    expect(r.state.omega4).toBeCloseTo((10 * (at(t0 + h).theta4 - at(t0 - h).theta4)) / (2 * h), 6);
    expect(r.state.alpha4).toBeCloseTo(
      (100 * (at(t0 + h).theta4 - 2 * at(t0).theta4 + at(t0 - h).theta4)) / (h * h),
      2,
    );
    // Norton's closed form for omega3.
    const { theta3: t3, theta4: t4 } = r.state;
    expect(r.state.omega3).toBeCloseTo((2 * 10 * Math.sin(t4 - t0)) / (7 * Math.sin(t3 - t4)), 10);
  });
});

describe('slider-cranks', () => {
  it('slider-crank r 50 mm, l 150 mm, theta 60 deg, omega 100 rad/s', () => {
    const input: LinkageInput = {
      ...LINKAGE_DEFAULTS,
      type: 'slider',
      a: 0.05,
      b: 0.15,
      c: 0,
      theta2: rad(60),
      omega2: 100,
      alpha2: 0,
    };
    const r = ok(solveLinkage(input));
    expect(rel(r.state.slider!.pos * 1000, 168.614)).toBeLessThan(1e-4);
    expect(rel(r.state.slider!.vel, -5.0839)).toBeLessThan(1e-4);
    expect(rel(r.state.slider!.acc, -166.92)).toBeLessThan(1e-4);
    // Independent: x(theta) = r cos + sqrt(l^2 - r^2 sin^2), differentiated numerically.
    const x = (t: number) => 0.05 * Math.cos(t) + Math.sqrt(0.0225 - (0.05 * Math.sin(t)) ** 2);
    const h = 1e-5,
      t = rad(60);
    expect(r.state.slider!.vel).toBeCloseTo((100 * (x(t + h) - x(t - h))) / (2 * h), 6);
    expect(r.stroke!.max - r.stroke!.min).toBeCloseTo(0.1, 12);
  });

  it('inverted slider-crank rates match numerical derivatives', () => {
    const input: LinkageInput = {
      ...LINKAGE_DEFAULTS,
      type: 'inverted',
      a: 1,
      d: 2,
      theta2: rad(50),
      omega2: 3,
      alpha2: 1,
    };
    const r = ok(solveLinkage(input));
    const h = 1e-6;
    // With alpha2 = 1, theta2(t) = t2 + 3t + t^2/2; check the first derivatives at t = 0.
    const s = (dt: number) => linkageState(input, rad(50) + 3 * dt + 0.5 * dt * dt)!;
    expect(r.state.omega4).toBeCloseTo((s(h).theta4 - s(-h).theta4) / (2 * h), 6);
    expect(r.state.slider!.vel).toBeCloseTo((s(h).slider!.pos - s(-h).slider!.pos) / (2 * h), 6);
    expect(r.state.alpha4).toBeCloseTo((s(1e-4).theta4 - 2 * s(0).theta4 + s(-1e-4).theta4) / 1e-8, 3);
  });
});

describe('sweeps, limits, and impossible input', () => {
  it('a crank-rocker sweeps the full turn and finds two toggle positions', () => {
    const r = ok(solveLinkage(LINKAGE_DEFAULTS));
    expect(r.sweep.length).toBe(361);
    expect(r.toggles.length).toBe(2);
    const t4 = r.toggles.map((t) => t.theta4);
    // The output never passes its toggle angles.
    const all = r.sweep.map((s) => s.theta4);
    expect(Math.max(...all)).toBeLessThanOrEqual(Math.max(...t4) + 1e-6);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(Math.min(...t4) - 1e-6);
  });

  it('a non-Grashof linkage has input limits and gaps in its sweep', () => {
    const r = ok(solveLinkage({ ...LINKAGE_DEFAULTS, a: 5, theta2: rad(90) }));
    expect(r.grashof!.cls).toBe('tripleRocker');
    expect(r.inputLimits.length).toBeGreaterThan(0);
    expect(r.sweep.length).toBeLessThan(361);
  });

  it('rejects impossible input with a reason', () => {
    expect(solveLinkage({ ...LINKAGE_DEFAULTS, a: 0 })).toEqual({ ok: false, error: 'positiveLinks' });
    expect(solveLinkage({ ...LINKAGE_DEFAULTS, a: 5, theta2: 0 })).toMatchObject({
      ok: false,
      error: 'linkNoAssembly',
    });
    expect(solveLinkage({ ...LINKAGE_DEFAULTS, type: 'slider', a: 2, b: 1, c: 0, theta2: rad(90) })).toMatchObject({
      ok: false,
      error: 'linkNoAssembly',
    });
    expect(solveLinkage({ ...LINKAGE_DEFAULTS, type: 'inverted', a: 2, d: 2, theta2: 0 })).toMatchObject({
      ok: false,
      error: 'linkThroughPivot',
    });
    expect(solveLinkage({ ...LINKAGE_DEFAULTS, b: Number.NaN })).toEqual({ ok: false, error: 'notNumber' });
  });
});
