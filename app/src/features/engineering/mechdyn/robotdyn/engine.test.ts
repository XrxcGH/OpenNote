import { describe, expect, it } from 'vitest';
import { coriolisMatrix, inverseDynamics, massMatrix, ROBOTDYN_DEFAULTS, solveRobotDyn, type ArmLink } from './engine';

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
const points: ArmLink[] = ROBOTDYN_DEFAULTS.links;

describe('robot arm terms', () => {
  it('2-link, point masses 1 kg at link ends, L = 1 m, q2 = 0: mass matrix', () => {
    const M = massMatrix(points, [0.3, 0]);
    expect(M[0][0]).toBeCloseTo(5, 9);
    expect(M[0][1]).toBeCloseTo(2, 9);
    expect(M[1][0]).toBeCloseTo(2, 9);
    expect(M[1][1]).toBeCloseTo(1, 9);
  });

  it('same arm horizontal, g 9.81: gravity torques', () => {
    const G = inverseDynamics(points, [0, 0], [0, 0], [0, 0], 9.81);
    expect(Math.abs(G[0] - 29.43)).toBeLessThan(1e-9);
    expect(Math.abs(G[1] - 9.81)).toBeLessThan(1e-9);
  });
});

describe('Newton-Euler against Lagrange', () => {
  it('Newton-Euler agrees with the Lagrange closed form for a general two-link arm', () => {
    const links: ArmLink[] = [
      { length: 0.8, mass: 2, com: 0.35, inertia: 0.1 },
      { length: 0.6, mass: 1.5, com: 0.25, inertia: 0.05 },
    ];
    const q = [0.4, -0.9],
      qd = [1.2, -0.7],
      qdd = [0.5, 2];
    const [m1, m2, l1, c1, c2, I1, I2, g] = [2, 1.5, 0.8, 0.35, 0.25, 0.1, 0.05, 9.81];
    const cq2 = Math.cos(q[1]),
      sq2 = Math.sin(q[1]);
    const M = [
      [m1 * c1 ** 2 + I1 + m2 * (l1 ** 2 + c2 ** 2 + 2 * l1 * c2 * cq2) + I2, m2 * (c2 ** 2 + l1 * c2 * cq2) + I2],
      [m2 * (c2 ** 2 + l1 * c2 * cq2) + I2, m2 * c2 ** 2 + I2],
    ];
    const h = -m2 * l1 * c2 * sq2;
    const C = [
      [h * qd[1], h * (qd[0] + qd[1])],
      [-h * qd[0], 0],
    ];
    const G = [
      (m1 * c1 + m2 * l1) * g * Math.cos(q[0]) + m2 * c2 * g * Math.cos(q[0] + q[1]),
      m2 * c2 * g * Math.cos(q[0] + q[1]),
    ];
    const tau = M.map((row, i) => row[0] * qdd[0] + row[1] * qdd[1] + C[i][0] * qd[0] + C[i][1] * qd[1] + G[i]);
    const rne = inverseDynamics(links, q, qd, qdd, g);
    expect(rne[0]).toBeCloseTo(tau[0], 10);
    expect(rne[1]).toBeCloseTo(tau[1], 10);
    const Cn = coriolisMatrix(links, q, qd);
    for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) expect(Cn[i][j]).toBeCloseTo(C[i][j], 6);
    expect(massMatrix(links, q)[0][0]).toBeCloseTo(M[0][0], 10);
  });
});

describe('joint-space control', () => {
  it('computed torque with the exact model: the error decays as the critically damped system', () => {
    const wn = 10;
    const r = ok(
      solveRobotDyn({ ...ROBOTDYN_DEFAULTS, controller: 'ct', kp: wn * wn, kd: 2 * wn, trajectory: 'step' }),
    );
    const e0 = ROBOTDYN_DEFAULTS.target;
    for (let j = 0; j < 2; j += 1) {
      for (const [t, eDeg] of r.errors.series[j].points.filter((_, k) => k % 25 === 0)) {
        const expected = e0[j] * (1 + wn * t) * Math.exp(-wn * t);
        expect(Math.abs((eDeg * Math.PI) / 180 - expected)).toBeLessThan(1e-6);
      }
    }
  });

  it('PD with gravity compensation settles on the target; plain PD sags under gravity', () => {
    const pdg = ok(solveRobotDyn({ ...ROBOTDYN_DEFAULTS, controller: 'pdg', kp: 200, kd: 40, duration: 8 }));
    pdg.finalError.forEach((e) => expect(Math.abs(e)).toBeLessThan(1e-4));
    const pd = ok(solveRobotDyn({ ...ROBOTDYN_DEFAULTS, controller: 'pd', kp: 200, kd: 40, duration: 8 }));
    expect(Math.abs(pd.finalError[0])).toBeGreaterThan(1e-2);
  });

  it('quintic trajectory tracking', () => {
    const r = ok(solveRobotDyn({ ...ROBOTDYN_DEFAULTS, trajectory: 'quintic', moveTime: 1, duration: 1.5 }));
    // Starting on the path with exact model, computed torque tracks it exactly.
    r.errors.series.forEach((s) => s.points.forEach(([, e]) => expect(Math.abs(e)).toBeLessThan(1e-5)));
  });
});

describe('impossible input', () => {
  it('rejects impossible input with a reason', () => {
    expect(solveRobotDyn({ ...ROBOTDYN_DEFAULTS, links: [] })).toEqual({ ok: false, error: 'robotLinks' });
    expect(solveRobotDyn({ ...ROBOTDYN_DEFAULTS, q: [0] })).toEqual({ ok: false, error: 'robotJointCount' });
    expect(solveRobotDyn({ ...ROBOTDYN_DEFAULTS, kp: -1 })).toEqual({ ok: false, error: 'negativeGains' });
    expect(
      solveRobotDyn({ ...ROBOTDYN_DEFAULTS, links: [{ length: 1, mass: 1, com: 2, inertia: 0 }, points[1]] }),
    ).toEqual({
      ok: false,
      error: 'robotCom',
    });
    expect(
      solveRobotDyn({
        ...ROBOTDYN_DEFAULTS,
        links: [{ length: 1, mass: 0, com: 0, inertia: 0 }],
        q: [0],
        qd: [0],
        qdd: [0],
        target: [1],
      }),
    ).toEqual({
      ok: false,
      error: 'robotSingularMass',
    });
    expect(solveRobotDyn({ ...ROBOTDYN_DEFAULTS, duration: 0 })).toEqual({ ok: false, error: 'robotDuration' });
  });
});

describe('edge cases', () => {
  it('q2 = 90 deg: M = [[3, 1], [1, 1]] by the closed form 3 + 2 cos q2 and 1 + cos q2', () => {
    const M = massMatrix(points, [0, Math.PI / 2]);
    expect(M[0][0]).toBeCloseTo(3, 9);
    expect(M[0][1]).toBeCloseTo(1, 9);
  });

  it('a hanging arm needs no gravity torque; zero gravity needs none anywhere', () => {
    inverseDynamics(points, [-Math.PI / 2, 0], [0, 0], [0, 0], 9.81).forEach((t) => expect(t).toBeCloseTo(0, 12));
    inverseDynamics(points, [0.7, 0.2], [0, 0], [0, 0], 0).forEach((t) => expect(t).toBeCloseTo(0, 12));
  });

  it('huge links scale the gravity torque linearly with mass and length', () => {
    const big: ArmLink[] = [{ length: 1e3, mass: 1e6, com: 1e3, inertia: 0 }];
    expect(inverseDynamics(big, [0], [0], [0], 9.81)[0] / (1e9 * 9.81)).toBeCloseTo(1, 12);
  });

  it('rejects zero or negative lengths, negative masses, and values that are not numbers', () => {
    const bad = (link: Partial<ArmLink>) =>
      solveRobotDyn({ ...ROBOTDYN_DEFAULTS, links: [{ ...points[0], ...link }, points[1]] });
    expect(bad({ length: 0 })).toEqual({ ok: false, error: 'positiveLength' });
    expect(bad({ length: -1 })).toEqual({ ok: false, error: 'positiveLength' });
    expect(bad({ mass: -1 })).toEqual({ ok: false, error: 'negativeMass' });
    expect(bad({ mass: Number.NaN })).toEqual({ ok: false, error: 'notNumber' });
  });
});
