import '../text';
import { describe, expect, it } from 'vitest';
import { rad } from '../num';
import { composite, principal, solveRigid3d, type Body, type RigidInput } from './engine';
import {
  axisAngleToQuat,
  eulerToMatrix,
  matrixToEuler,
  matrixToQuat,
  quatToAxisAngle,
  quatToMatrix,
  rotationError,
  type Quat,
  type Vec3,
} from './rotation';

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
const body = (patch: Partial<Body>): Body => ({
  shape: 'point',
  mass: 1,
  sizes: [],
  at: [0, 0, 0],
  turn: [0, 0, 0],
  ...patch,
});
const base: RigidInput = {
  bodies: null,
  tensor: null,
  about: 'origin',
  omega0: [0, 0, 0],
  torque: [0, 0, 0],
  duration: 2,
};

describe('inertia tensors', () => {
  it('a thin plate 0.4 x 0.2 m, 2 kg, about a corner', () => {
    const plate = body({ shape: 'plate', mass: 2, sizes: [0.4, 0.2], at: [0.2, 0.1, 0] });
    const r = ok(solveRigid3d({ ...base, bodies: [plate] }));
    const I = r.tensor;
    expect(I[0][0]).toBeCloseTo(0.026667, 6);
    expect(I[1][1]).toBeCloseTo(0.106667, 6);
    expect(I[0][1]).toBeCloseTo(-0.04, 12);
    expect(I[2][2]).toBeCloseTo(0.133333, 6);
    expect([0, 1, 2].map((k) => r.moments[k])).toEqual([
      expect.closeTo(0.010098, 6),
      expect.closeTo(0.123235, 6),
      expect.closeTo(0.133333, 6),
    ]);
    // Independent: the 2 x 2 block's eigenvalues in closed form.
    const [a, b, c] = [0.08 / 3, 0.32 / 3, -0.04];
    const mid = (a + b) / 2,
      half = Math.hypot((a - b) / 2, c);
    expect(r.moments[0]).toBeCloseTo(mid - half, 12);
    expect(r.moments[1]).toBeCloseTo(mid + half, 12);
  });

  it('the parallel-axis term, a turned body, and the tensor about the center of mass', () => {
    const sphere = body({ shape: 'sphere', mass: 2, sizes: [0.5], at: [1, 2, 3] });
    const I = composite([sphere], 'origin').tensor;
    // 2/5 m r^2 = 0.2, plus m(|r|^2 - x^2) = 2 * 13 on the diagonal and -m x y off it.
    expect(I[0][0]).toBeCloseTo(0.2 + 26, 12);
    expect(I[0][1]).toBeCloseTo(-4, 12);
    expect(I[1][2]).toBeCloseTo(-12, 12);
    expect(composite([sphere], 'center').tensor[0][0]).toBeCloseTo(0.2, 12);
    const box = body({ shape: 'box', mass: 12, sizes: [1, 2, 3], turn: [rad(90), 0, 0] });
    const turned = composite([box], 'origin').tensor;
    // m/12 (b^2 + c^2) = 13 about x before the turn; a quarter turn about z swaps the x and y moments.
    expect(turned[0][0]).toBeCloseTo(10, 12);
    expect(turned[1][1]).toBeCloseTo(13, 12);
    expect(turned[2][2]).toBeCloseTo(5, 12);
  });

  it('two point masses: a zero principal moment, so no simulation', () => {
    const r = ok(
      solveRigid3d({
        ...base,
        about: 'center',
        bodies: [body({ at: [1, 0, 0] }), body({ at: [-1, 0, 0] })],
        omega0: [0, 1, 0],
      }),
    );
    expect(r.center).toEqual([0, 0, 0]);
    expect(r.moments[0]).toBe(0);
    expect(r.moments[2]).toBeCloseTo(2, 12);
    expect(r.omegaPlot).toBeNull();
  });

  it('principal axes are orthonormal and right-handed', () => {
    const p = principal([
      [3, -1, 0.5],
      [-1, 4, 0.2],
      [0.5, 0.2, 5],
    ])!;
    expect(rotationError(p.axes)).toBeLessThan(1e-12);
  });
});

describe('Euler’s equations', () => {
  it('torque-free axisymmetric body I = 1, I3 = 2, ω3 = 10 rad/s', () => {
    const r = ok(
      solveRigid3d({
        ...base,
        tensor: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 2],
        ],
        omega0: [1, 0, 10],
        duration: 1,
      }),
    );
    expect(r.axisymmetric!.bodyRate).toBeCloseTo(10, 9);
    expect(r.axisymmetric!.spaceRate).toBeCloseTo(Math.hypot(1, 20), 9);
    // Independent: ω1 = cos(Ωt), ω2 = sin(Ωt) for this start, with Ω = 10 rad/s.
    const end = r.omegaPlot!.series.map((s) => s.points[s.points.length - 1]);
    expect(end[0][0]).toBeCloseTo(1, 12);
    expect(end[0][1]).toBeCloseTo(Math.cos(10), 7);
    expect(end[1][1]).toBeCloseTo(Math.sin(10), 7);
    expect(end[2][1]).toBeCloseTo(10, 9);
    expect(r.drift!).toBeLessThan(1e-8);
  });

  it('a torque across the spin axis gives the fast-top precession rate', () => {
    const r = ok(
      solveRigid3d({
        ...base,
        tensor: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 2],
        ],
        omega0: [0, 0, 50],
        torque: [3, 4, 0],
      }),
    );
    expect(r.axisymmetric!.gyroRate).toBeCloseTo(5 / (2 * 50), 12);
    expect(r.drift).toBeNull();
  });

  it('rejects impossible input with a reason', () => {
    const tensor = (T: number[][]) => solveRigid3d({ ...base, tensor: T });
    expect(tensor([[1, 0, 0]])).toEqual({ ok: false, error: 'rigidTensor' });
    expect(
      tensor([
        [1, 0.5, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ).toEqual({ ok: false, error: 'rigidSymmetric' });
    expect(
      tensor([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 3],
      ]),
    ).toEqual({ ok: false, error: 'rigidTriangle' });
    expect(
      tensor([
        [-1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ).toEqual({ ok: false, error: 'rigidTriangle' });
    expect(solveRigid3d({ ...base, bodies: [body({ mass: -1 })] })).toEqual({ ok: false, error: 'rigidMass' });
    expect(solveRigid3d({ ...base, bodies: [body({ mass: 0 })] })).toEqual({ ok: false, error: 'rigidMass' });
    expect(solveRigid3d({ ...base, bodies: [body({ shape: 'sphere', sizes: [0] })] })).toEqual({
      ok: false,
      error: 'rigidSize',
    });
    expect(solveRigid3d({ ...base, bodies: [] })).toEqual({ ok: false, error: 'listEmpty' });
    expect(solveRigid3d({ ...base, bodies: [body({ at: [Number.NaN, 0, 0] })] })).toEqual({
      ok: false,
      error: 'notNumber',
    });
    expect(solveRigid3d({ ...base, bodies: [body({})], duration: 0 })).toEqual({ ok: false, error: 'robotDuration' });
  });
});

/** Rotates v by a unit quaternion as q v q*, independent of the matrix. */
function rotateByQuat([w, x, y, z]: Quat, v: Vec3): Vec3 {
  const mul = (a: Quat, b: Quat): Quat => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const r = mul(mul([w, x, y, z], [0, ...v]), [w, -x, -y, -z]);
  return [r[1], r[2], r[3]];
}

describe('rotations', () => {
  it('ZYX Euler angles yaw 30, pitch 20, roll 10 deg', () => {
    const R = eulerToMatrix(rad(30), rad(20), rad(10));
    const q = matrixToQuat(R);
    [0.951549, 0.038135, 0.189308, 0.239298].forEach((v, i) => expect(q[i]).toBeCloseTo(v, 6));
    // Independent: the half-angle product of the three turns.
    const [c1, s1, c2, s2, c3, s3] = [15, 10, 5].flatMap((d) => [Math.cos(rad(d)), Math.sin(rad(d))]);
    const half: Quat = [
      c3 * c2 * c1 + s3 * s2 * s1,
      s3 * c2 * c1 - c3 * s2 * s1,
      c3 * s2 * c1 + s3 * c2 * s1,
      c3 * c2 * s1 - s3 * s2 * c1,
    ];
    half.forEach((v, i) => expect(q[i]).toBeCloseTo(v, 12));
    const { angle, axis } = quatToAxisAngle(q);
    expect((angle * 180) / Math.PI).toBeCloseTo(35.817, 3);
    [0.12402, 0.61564, 0.77821].forEach((v, i) => expect(axis[i]).toBeCloseTo(v, 5));
    const back = matrixToEuler(R);
    expect(back.gimbal).toBe(false);
    back.euler.forEach((v, i) => expect(v).toBeCloseTo(rad([30, 20, 10][i]), 12));
  });

  it('every form converts back, including half turns and gimbal lock', () => {
    for (const [angle, axis] of [
      [Math.PI, [1, 0, 0]],
      [Math.PI, [0, 1, 0]],
      [Math.PI, [0, 0, 1]],
      [2.5, [1, -2, 0.5]],
      [0, [0, 0, 1]],
    ] as [number, Vec3][]) {
      const q = axisAngleToQuat(angle, axis);
      const R = quatToMatrix(q);
      expect(rotationError(R)).toBeLessThan(1e-12);
      const again = matrixToQuat(R);
      const sign = Math.sign(again[0] * q[0] + again[1] * q[1] + again[2] * q[2] + again[3] * q[3]) || 1;
      again.forEach((v, i) => expect(sign * v).toBeCloseTo(q[i], 12));
      const v: Vec3 = [0.3, -0.7, 1.1];
      const byMatrix = R.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
      rotateByQuat(q, v).forEach((x, i) => expect(byMatrix[i]).toBeCloseTo(x, 12));
    }
    const locked = matrixToEuler(eulerToMatrix(rad(30), rad(90), 0));
    expect(locked.gimbal).toBe(true);
    expect(locked.euler[0]).toBeCloseTo(rad(30), 9);
    expect(rotationError(eulerToMatrix(1, 2, 3).map((row) => row.map((x) => -x)))).toBe(1);
  });
});
