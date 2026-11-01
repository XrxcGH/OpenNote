import '../text';
import { describe, expect, it } from 'vitest';
import { frames, ik2R, jacobian, ROBOTKIN_DEFAULTS, solveRobotKin, SPATIAL_RRR, type DhRow } from './engine';

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
const d2r = (d: number) => (d * Math.PI) / 180;

describe('forward kinematics', () => {
  it('planar 2R, L1 = L2 = 1, q = (30, 45) deg', () => {
    const r = ok(solveRobotKin(ROBOTKIN_DEFAULTS));
    expect(Math.abs(r.position[0] - 1.124844)).toBeLessThan(1e-6);
    expect(Math.abs(r.position[1] - 1.465926)).toBeLessThan(1e-6);
    expect(Math.abs(r.planarDet! - 0.707107)).toBeLessThan(1e-6);
    // Independent: x = cos q1 + cos(q1 + q2), y = sin q1 + sin(q1 + q2), det J = sin q2.
    expect(r.position[0]).toBeCloseTo(Math.cos(d2r(30)) + Math.cos(d2r(75)), 12);
    expect(r.planarDet!).toBeCloseTo(Math.sin(d2r(45)), 12);
    expect(r.manipulability).toBeCloseTo(Math.sin(d2r(45)), 12);
  });
});

describe('inverse kinematics', () => {
  it('inverse of the same point: both elbows reproduce it', () => {
    const x = Math.cos(d2r(30)) + Math.cos(d2r(75)),
      y = Math.sin(d2r(30)) + Math.sin(d2r(75));
    const r = ok(solveRobotKin({ ...ROBOTKIN_DEFAULTS, target: [x, y, 0] }));
    expect(r.ik.method).toBe('closed2R');
    expect(r.ik.solutions).toHaveLength(2);
    const sols = r.ik.solutions.map((s) => s.q.map((v) => (v * 180) / Math.PI));
    expect(sols.some(([a, b]) => Math.abs(a - 30) < 1e-9 && Math.abs(b - 45) < 1e-9)).toBe(true);
    expect(sols.some(([a, b]) => Math.abs(a - 75) < 1e-9 && Math.abs(b + 45) < 1e-9)).toBe(true);
    r.ik.solutions.forEach((s) => expect(s.error).toBeLessThan(1e-9));
  });
});

describe('spatial arms', () => {
  it('spatial RRR, standard DH: end position', () => {
    const r = ok(solveRobotKin({ ...ROBOTKIN_DEFAULTS, rows: SPATIAL_RRR, target: [1, 0.5, 1] }));
    expect(Math.abs(r.position[0] - 1.448889)).toBeLessThan(1e-6);
    expect(Math.abs(r.position[1] - 0.836516)).toBeLessThan(1e-6);
    expect(Math.abs(r.position[2] - 0.948288)).toBeLessThan(1e-6);
    // Independent: links 2 and 3 move in the vertical plane at azimuth 30 deg.
    const reach = Math.cos(d2r(45)) + Math.cos(d2r(-15));
    expect(r.position[0]).toBeCloseTo(reach * Math.cos(d2r(30)), 12);
    expect(r.position[2]).toBeCloseTo(0.5 + Math.sin(d2r(45)) + Math.sin(d2r(-15)), 12);
    // Numerical IK reaches a reachable target.
    expect(r.ik.reachable).toBe(true);
    r.ik.solutions.forEach((s) => expect(s.error).toBeLessThan(1e-9));
  });

  it('modified DH describes the same arm', () => {
    // Craig's form: each row carries the previous link's length and twist; a tool row adds the last link.
    const R = (theta: number, a: number, alpha: number, d = 0): DhRow => ({
      type: 'R',
      a,
      alpha,
      d,
      theta,
      min: null,
      max: null,
    });
    const rows = [
      R(d2r(30), 0, 0, 0.5),
      R(d2r(45), 0, Math.PI / 2),
      R(d2r(-60), 1, 0),
      { ...R(0, 1, 0), type: 'R' as const },
    ];
    const T = frames(rows, 'modified');
    const p = T[4].slice(0, 3).map((r) => r[3]);
    expect(p[0]).toBeCloseTo(1.448889, 6);
    expect(p[1]).toBeCloseTo(0.836516, 6);
    expect(p[2]).toBeCloseTo(0.948288, 6);
  });
});

describe('the Jacobian', () => {
  it('the Jacobian matches finite differences, for revolute and prismatic joints', () => {
    const rows: DhRow[] = [
      ...SPATIAL_RRR.slice(0, 2),
      { type: 'P', a: 0, alpha: 0, d: 0.4, theta: 0.3, min: null, max: null },
    ];
    for (const conv of ['standard', 'modified'] as const) {
      const J = jacobian(rows, conv);
      const h = 1e-6;
      rows.forEach((_, j) => {
        const bump = (s: number) =>
          frames(
            rows.map((r, i) => (i !== j ? r : r.type === 'R' ? { ...r, theta: r.theta + s } : { ...r, d: r.d + s })),
            conv,
          )[3];
        const plus = bump(h),
          minus = bump(-h);
        for (let k = 0; k < 3; k += 1) expect(J[k][j]).toBeCloseTo((plus[k][3] - minus[k][3]) / (2 * h), 6);
      });
    }
  });
});

describe('planar 3R and impossible input', () => {
  it('planar 3R closed form honours the end angle', () => {
    const rows = [0.3, 0.2, 0.1].map((a, i): DhRow => ({
      type: 'R',
      a,
      alpha: 0,
      d: 0,
      theta: 0.2 * i,
      min: null,
      max: null,
    }));
    const r = ok(solveRobotKin({ convention: 'standard', rows, target: [0.35, 0.2, d2r(60)] }));
    expect(r.ik.method).toBe('closed3R');
    r.ik.solutions.forEach((s) => {
      expect(s.error).toBeLessThan(1e-12);
      expect(s.q[0] + s.q[1] + s.q[2]).toBeCloseTo(d2r(60), 9);
    });
  });

  it('reports unreachable targets and singular poses', () => {
    expect(ik2R(1, 1, 3, 0)).toHaveLength(0);
    const far = ok(solveRobotKin({ ...ROBOTKIN_DEFAULTS, target: [3, 0, 0] }));
    expect(far.ik.reachable).toBe(false);
    const straight = ok(
      solveRobotKin({ ...ROBOTKIN_DEFAULTS, rows: ROBOTKIN_DEFAULTS.rows.map((r) => ({ ...r, theta: 0 })) }),
    );
    expect(straight.singular).toBe(true);
  });

  it('rejects impossible input with a reason', () => {
    expect(solveRobotKin({ ...ROBOTKIN_DEFAULTS, rows: [] })).toEqual({ ok: false, error: 'robotKinRows' });
    expect(solveRobotKin({ ...ROBOTKIN_DEFAULTS, target: [Number.NaN, 0, 0] })).toEqual({
      ok: false,
      error: 'notNumber',
    });
    const bad = ROBOTKIN_DEFAULTS.rows.map((r) => ({ ...r, min: 1, max: 0 }));
    expect(solveRobotKin({ ...ROBOTKIN_DEFAULTS, rows: bad })).toEqual({ ok: false, error: 'robotLimits' });
  });
});

describe('numeric inverse kinematics on the workspace boundary', () => {
  it('reaches the fully stretched spatial RRR target and flags it singular', () => {
    // By hand: q1 = 30 deg, q2 = q3 = 0 lays links 2 and 3 end to end, 2 m out at the base height 0.5 m.
    const c30 = Math.cos(Math.PI / 6),
      s30 = Math.sin(Math.PI / 6);
    const r = ok(solveRobotKin({ ...ROBOTKIN_DEFAULTS, rows: SPATIAL_RRR, target: [2 * c30, 2 * s30, 0.5] }));
    expect(r.ik.reachable).toBe(true);
    const best = r.ik.solutions.reduce((a, b) => (a.error < b.error ? a : b));
    expect(best.error).toBeLessThan(1e-7 * 2.5);
    expect(best.singular).toBe(true);
    const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
    expect(wrap(best.q[0] - Math.PI / 6)).toBeCloseTo(0, 3);
    expect(wrap(best.q[1])).toBeCloseTo(0, 3);
    expect(wrap(best.q[2])).toBeCloseTo(0, 3);
    expect(r.steps.some((step) => step.key === 'robotKinBoundary')).toBe(true);
  });
});
