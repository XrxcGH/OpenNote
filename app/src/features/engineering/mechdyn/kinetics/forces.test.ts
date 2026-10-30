import { describe, expect, it } from 'vitest';
import { FORCES_DEFAULTS, solveForces, type ForcesInput } from './forces';

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
const g = 9.81;

describe('planar rigid-body equations of motion', () => {
  it('a rod pinned at one end, released level: alpha = 3g/(2L), pin reaction mg/4', () => {
    // L = 1 m, m = 2 kg, I_G = m L^2 / 12, pin at the left end.
    const r = ok(solveForces({ ...FORCES_DEFAULTS, mass: 2, IG: 2 / 12, pin: [-0.5, 0] }));
    expect(r.alpha).toBeCloseTo((-3 * g) / 2, 10);
    expect(r.aG[1]).toBeCloseTo((-3 * g) / 4, 10);
    expect(r.reactions[0].value).toBeCloseTo(0, 10);
    expect(r.reactions[1].value).toBeCloseTo((2 * g) / 4, 10);
  });

  it('the same rod swinging through level at omega 3 rad/s pulls the pin inward with m omega^2 L/2', () => {
    const r = ok(solveForces({ ...FORCES_DEFAULTS, mass: 2, IG: 2 / 12, pin: [-0.5, 0], omega: 3 }));
    // G is 0.5 m right of the pin, so the pin pulls it left: R_x = -m omega^2 (L/2) = -9 N.
    expect(r.reactions[0].value).toBeCloseTo(-9, 10);
    expect(r.reactions[1].value).toBeCloseTo((2 * g) / 4, 10);
  });

  it('a ladder released from rest at 60 degrees on a smooth floor and wall', () => {
    // L = 4 m, m = 10 kg, I_G = m L^2 / 12. Foot A on the floor to the right, top B on the wall to the left.
    const L = 4,
      m = 10,
      th = Math.PI / 3;
    const [c, s] = [Math.cos(th), Math.sin(th)];
    const input: ForcesInput = {
      ...FORCES_DEFAULTS,
      mass: m,
      IG: (m * L * L) / 12,
      support: 'sliding',
      contacts: [
        { at: [(L / 2) * c, (-L / 2) * s], normal: Math.PI / 2 },
        { at: [(-L / 2) * c, (L / 2) * s], normal: 0 },
      ],
    };
    const r = ok(solveForces(input));
    // By hand (energy, differentiated at rest): alpha = 3g cos(theta) / (2L), N_floor = mg(1 - 3/4 cos^2 theta),
    // N_wall = 3/4 mg sin(theta) cos(theta).
    expect(r.alpha).toBeCloseTo((3 * g * c) / (2 * L), 10);
    expect(r.reactions[0].value).toBeCloseTo(m * g * (1 - 0.75 * c * c), 9);
    expect(r.reactions[1].value).toBeCloseTo(0.75 * m * g * s * c, 9);
    expect(r.losesContact).toBe(false);
  });

  it('a disk pushed at its center rolls with a = 2P/(3m) and needs friction P/3', () => {
    const m = 3,
      R = 0.2,
      P = 12;
    const r = ok(
      solveForces({
        ...FORCES_DEFAULTS,
        mass: m,
        IG: (m * R * R) / 2,
        support: 'rolling',
        radius: R,
        loads: [{ force: P, angle: 0, at: [0, 0] }],
      }),
    );
    expect(r.aG[0]).toBeCloseTo((2 * P) / (3 * m), 10);
    expect(r.alpha).toBeCloseTo((-2 * P) / (3 * m * R), 10);
    expect(r.reactions[0].value).toBeCloseTo(m * g, 10);
    expect(Math.abs(r.reactions[1].value)).toBeCloseTo(P / 3, 10);
    expect(r.muNeeded).toBeCloseTo(P / 3 / (m * g), 10);
  });

  it('a free body under a couple spins without moving its center, and falls under gravity', () => {
    const r = ok(solveForces({ ...FORCES_DEFAULTS, support: 'free', IG: 0.5, couple: 2 }));
    expect(r.alpha).toBeCloseTo(4, 12);
    expect(r.aG[0]).toBeCloseTo(0, 12);
    expect(r.aG[1]).toBeCloseTo(-g, 12);
  });

  it('rejects impossible input', () => {
    expect(solveForces({ ...FORCES_DEFAULTS, mass: 0 })).toEqual({ ok: false, error: 'positiveMass' });
    expect(solveForces({ ...FORCES_DEFAULTS, IG: -1 })).toEqual({ ok: false, error: 'positiveInertia' });
    expect(solveForces({ ...FORCES_DEFAULTS, couple: Number.NaN })).toEqual({ ok: false, error: 'notNumber' });
    // Two contacts with the same normal through one point can't hold the body: the system is singular.
    const same = { at: [0, 0] as [number, number], normal: 0 };
    expect(solveForces({ ...FORCES_DEFAULTS, support: 'sliding', contacts: [same, same] }).ok).toBe(false);
  });
});
