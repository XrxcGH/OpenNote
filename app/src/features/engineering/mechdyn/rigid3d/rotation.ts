// Rotations in four forms: a rotation matrix, ZYX Euler angles (yaw about z, then pitch about y, then roll about
// x), a unit quaternion (w, x, y, z), and an angle about an axis. Every form converts to the matrix and back. The
// matrix maps a vector's body-frame components to the reference frame. Angles are in rad.
import { matMul, type Mat } from '../num';
import { tex } from '../tex';
import { fail, finite, type MechStep, type Outcome } from '../types';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

const rx = (t: number): Mat => [
  [1, 0, 0],
  [0, Math.cos(t), -Math.sin(t)],
  [0, Math.sin(t), Math.cos(t)],
];
const ry = (t: number): Mat => [
  [Math.cos(t), 0, Math.sin(t)],
  [0, 1, 0],
  [-Math.sin(t), 0, Math.cos(t)],
];
const rz = (t: number): Mat => [
  [Math.cos(t), -Math.sin(t), 0],
  [Math.sin(t), Math.cos(t), 0],
  [0, 0, 1],
];

/** R = Rz(yaw) Ry(pitch) Rx(roll). */
export const eulerToMatrix = (yaw: number, pitch: number, roll: number): Mat =>
  matMul(matMul(rz(yaw), ry(pitch)), rx(roll));

/** Yaw, pitch, and roll from a matrix; at gimbal lock (pitch ±90°) roll is set to 0. */
export function matrixToEuler(R: Mat): { euler: Vec3; gimbal: boolean } {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -R[2][0])));
  if (Math.abs(Math.cos(pitch)) < 1e-7) return { euler: [Math.atan2(-R[0][1], R[1][1]), pitch, 0], gimbal: true };
  return { euler: [Math.atan2(R[1][0], R[0][0]), pitch, Math.atan2(R[2][1], R[2][2])], gimbal: false };
}

/** The unit quaternion of a rotation matrix (Shepperd's method), with w ≥ 0. */
export function matrixToQuat(R: Mat): Quat {
  const trace = R[0][0] + R[1][1] + R[2][2];
  let q: Quat;
  if (trace >= Math.max(R[0][0], R[1][1], R[2][2])) {
    const s = 2 * Math.sqrt(1 + trace);
    q = [s / 4, (R[2][1] - R[1][2]) / s, (R[0][2] - R[2][0]) / s, (R[1][0] - R[0][1]) / s];
  } else if (R[0][0] >= R[1][1] && R[0][0] >= R[2][2]) {
    const s = 2 * Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]);
    q = [(R[2][1] - R[1][2]) / s, s / 4, (R[0][1] + R[1][0]) / s, (R[0][2] + R[2][0]) / s];
  } else if (R[1][1] >= R[2][2]) {
    const s = 2 * Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]);
    q = [(R[0][2] - R[2][0]) / s, (R[0][1] + R[1][0]) / s, s / 4, (R[1][2] + R[2][1]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]);
    q = [(R[1][0] - R[0][1]) / s, (R[0][2] + R[2][0]) / s, (R[1][2] + R[2][1]) / s, s / 4];
  }
  return q[0] < 0 ? (q.map((v) => -v) as Quat) : q;
}

/** The matrix of a quaternion, which is scaled to unit length first. */
export function quatToMatrix(quat: Quat): Mat {
  const n = Math.hypot(...quat);
  const [w, x, y, z] = quat.map((v) => v / n);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

/** Angle (0 to 180°) and unit axis of a quaternion; the axis is x when the angle is zero. */
export function quatToAxisAngle(quat: Quat): { angle: number; axis: Vec3 } {
  const sign = quat[0] < 0 ? -1 : 1;
  const [w, x, y, z] = quat.map((v) => (sign * v) / Math.hypot(...quat));
  const s = Math.hypot(x, y, z);
  if (s < 1e-15) return { angle: 0, axis: [1, 0, 0] };
  return { angle: 2 * Math.atan2(s, w), axis: [x / s, y / s, z / s] };
}

/** The unit quaternion of a turn by `angle` about `axis` (any length but zero). */
export function axisAngleToQuat(angle: number, axis: Vec3): Quat {
  const n = Math.hypot(...axis);
  const s = Math.sin(angle / 2) / n;
  const q: Quat = [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
  return q[0] < 0 ? (q.map((v) => -v) as Quat) : q;
}

/** How far a matrix is from a proper rotation: the largest entry of RᵀR − E, or 1 when det R isn't +1. */
export function rotationError(R: Mat): number {
  const det =
    R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
    R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
    R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (det < 0) return 1;
  let worst = 0;
  for (let i = 0; i < 3; i += 1)
    for (let j = 0; j < 3; j += 1) {
      const dot = R[0][i] * R[0][j] + R[1][i] * R[1][j] + R[2][i] * R[2][j];
      worst = Math.max(worst, Math.abs(dot - (i === j ? 1 : 0)));
    }
  return worst;
}

export type RotationForm = 'euler' | 'quaternion' | 'axisAngle' | 'matrix';

export interface RotationInput {
  form: RotationForm;
  /** Yaw, pitch, and roll, rad. */
  euler: Vec3;
  quat: Quat;
  angle: number;
  axis: Vec3;
  matrix: Mat;
}

export interface RotationResult {
  matrix: Mat;
  euler: Vec3;
  gimbal: boolean;
  quat: Quat;
  angle: number;
  axis: Vec3;
  /** The typed quaternion wasn't unit length. */
  normalized: boolean;
  steps: MechStep[];
}

const matLatex = (A: Mat) =>
  `\\begin{bmatrix}${A.map((row) => row.map((v) => tex(v)).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
const degLatex = (r: number) => `${tex((r * 180) / Math.PI)}^\\circ`;

function typedMatrix(input: RotationInput): Outcome<{ R: Mat; step: MechStep; normalized: boolean }> {
  const { form } = input;
  if (form === 'euler') {
    const R = eulerToMatrix(...input.euler);
    return { ok: true, value: { R, normalized: false, step: { key: 'rotFromEuler', math: `R = ${matLatex(R)}` } } };
  }
  if (form === 'quaternion') {
    const n = Math.hypot(...input.quat);
    if (n === 0) return fail('rotQuatZero');
    const R = quatToMatrix(input.quat);
    const normalized = Math.abs(n - 1) > 1e-9;
    return { ok: true, value: { R, normalized, step: { key: 'rotFromQuat', math: `R = ${matLatex(R)}` } } };
  }
  if (form === 'axisAngle') {
    if (Math.hypot(...input.axis) === 0) return fail('rotAxisZero');
    const R = quatToMatrix(axisAngleToQuat(input.angle, input.axis));
    return { ok: true, value: { R, normalized: false, step: { key: 'rotFromAxis', math: `R = ${matLatex(R)}` } } };
  }
  const R = input.matrix;
  if (R.length !== 3 || R.some((row) => row.length !== 3)) return fail('rigidTensor');
  if (rotationError(R) > 1e-6) return fail('rotMatrix');
  return { ok: true, value: { R, normalized: false, step: { key: 'rotFromMatrix', math: `R = ${matLatex(R)}` } } };
}

/** A rotation typed in one form, written in all four. */
export function solveRotation(input: RotationInput): Outcome<RotationResult> {
  if (!finite(...input.euler, ...input.quat, input.angle, ...input.axis, ...input.matrix.flat()))
    return fail('notNumber');
  const typed = typedMatrix(input);
  if (!typed.ok) return typed;
  const { R, step, normalized } = typed.value;
  const quat = matrixToQuat(R);
  const { angle, axis } = quatToAxisAngle(quat);
  const { euler, gimbal } = matrixToEuler(R);
  const steps: MechStep[] = [step];
  if (normalized) steps.push({ key: 'rotNormalized' });
  steps.push({ key: 'rotQuat', math: `q = (${quat.map((v) => tex(v)).join(',\\ ')})` });
  steps.push({
    key: 'rotAxisAngle',
    math:
      `\\theta = 2\\operatorname{atan2}(|\\mathbf v|, w) = ${degLatex(angle)},\\quad ` +
      `\\hat{\\mathbf n} = (${axis.map((v) => tex(v)).join(',\\ ')})`,
  });
  steps.push({
    key: 'rotEuler',
    math: `\\psi = ${degLatex(euler[0])},\\quad \\theta = ${degLatex(euler[1])},\\quad \\phi = ${degLatex(euler[2])}`,
  });
  if (gimbal) steps.push({ key: 'rotGimbal' });
  return { ok: true, value: { matrix: R, euler, gimbal, quat, angle, axis, normalized, steps } };
}
