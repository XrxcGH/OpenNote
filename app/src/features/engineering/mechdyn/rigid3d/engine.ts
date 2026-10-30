// Three-dimensional rigid bodies. A composite body's inertia tensor is the sum of each part's tensor about its own
// center, first turned by its orientation, then moved by the parallel-axis term. The principal moments and axes are its
// eigenvalues and eigenvectors. Euler's equations then give the angular velocity in the principal axes under a
// constant body-fixed torque, with energy and momentum checks. Tensor entries are I_xy = −∫xy dm, so the matrix
// is the one that maps ω to H. SI units throughout.
import { dopri, matMul, symEigen, transpose, type Mat } from '../num';
import { tex } from '../tex';
import { fail, finite, fmt, type MechStep, type Outcome, type Plot } from '../types';
import { eulerToMatrix, type Vec3 } from './rotation';

export type Shape = 'box' | 'cylinder' | 'sphere' | 'rod' | 'plate' | 'point';

/** How many sizes each shape takes: box a b c; cylinder r h (axis z); sphere r; rod L (along x); plate a b (in xy). */
export const SHAPE_SIZES: Readonly<Record<Shape, number>> = {
  box: 3,
  cylinder: 2,
  sphere: 1,
  rod: 1,
  plate: 2,
  point: 0,
};

export interface Body {
  shape: Shape;
  mass: number;
  sizes: number[];
  /** The body's center in the reference frame. */
  at: Vec3;
  /** Yaw, pitch, and roll of the body's own axes, rad. */
  turn: Vec3;
}

export interface RigidInput {
  /** The bodies, or null when the tensor is typed. */
  bodies: Body[] | null;
  tensor: Mat | null;
  /** Bodies only: the tensor about the origin, or about the composite center of mass. */
  about: 'origin' | 'center';
  /** Starting angular velocity and the constant torque, in the reference axes. */
  omega0: Vec3;
  torque: Vec3;
  duration: number;
}

export interface Axisymmetric {
  /** Index of the distinct principal moment. */
  axis: number;
  spin: number;
  /** ω's turning rate about the symmetry axis, seen in the body: (I3 − I) ω3 / I. */
  bodyRate: number;
  /** The symmetry axis's turning rate about H, seen from space: |H| / I. */
  spaceRate: number;
  /** Angle between H and the symmetry axis. */
  nutation: number;
  /** Fast-top precession under the torque across the spin axis: M⊥ / (I3 ω3), or null. */
  gyroRate: number | null;
}

export interface RigidResult {
  mass: number | null;
  center: Vec3 | null;
  tensor: Mat;
  moments: Vec3;
  /** Columns are the principal axes, right-handed. */
  axes: Mat;
  energy: number;
  momentum: number;
  axisymmetric: Axisymmetric | null;
  /** Relative change in energy and |H| over the run, when there is no torque. */
  drift: number | null;
  /** Null when a principal moment is zero, as for a thin rod alone. */
  omegaPlot: Plot | null;
  steps: MechStep[];
}

const eye = (): Mat => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const add = (A: Mat, B: Mat): Mat => A.map((row, i) => row.map((v, j) => v + B[i][j]));
const scale = (A: Mat, k: number): Mat => A.map((row) => row.map((v) => v * k));
const mulVec = (A: Mat, v: readonly number[]): Vec3 =>
  A.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as Vec3;
const dot = (u: readonly number[], v: readonly number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** A part's tensor about its own center, in its own axes (a diagonal matrix). */
export function centroidal({ shape, mass: m, sizes }: Pick<Body, 'shape' | 'mass' | 'sizes'>): Mat {
  const [a = 0, b = 0, c = 0] = sizes;
  const diag = (x: number, y: number, z: number): Mat => [
    [x, 0, 0],
    [0, y, 0],
    [0, 0, z],
  ];
  switch (shape) {
    case 'box':
      return diag((m * (b * b + c * c)) / 12, (m * (a * a + c * c)) / 12, (m * (a * a + b * b)) / 12);
    case 'cylinder':
      return diag((m * (3 * a * a + b * b)) / 12, (m * (3 * a * a + b * b)) / 12, (m * a * a) / 2);
    case 'sphere':
      return diag((2 * m * a * a) / 5, (2 * m * a * a) / 5, (2 * m * a * a) / 5);
    case 'rod':
      return diag(0, (m * a * a) / 12, (m * a * a) / 12);
    case 'plate':
      return diag((m * b * b) / 12, (m * a * a) / 12, (m * (a * a + b * b)) / 12);
    case 'point':
      return diag(0, 0, 0);
  }
}

/** The parallel-axis term m(|r|²E − rrᵀ). */
export const shiftTerm = (m: number, r: readonly number[]): Mat =>
  scale(
    add(
      scale(eye(), dot(r, r)),
      r.map((ri) => r.map((rj) => -ri * rj)),
    ),
    m,
  );

const matLatex = (A: Mat) =>
  `\\begin{bmatrix}${A.map((row) => row.map((v) => tex(v)).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;

function invalidBodies(bodies: readonly Body[]) {
  if (bodies.length === 0) return fail('listEmpty');
  if (!finite(...bodies.flatMap((b) => [b.mass, ...b.sizes, ...b.at, ...b.turn]))) return fail('notNumber');
  if (bodies.some((b) => b.mass < 0) || bodies.every((b) => b.mass === 0)) return fail('rigidMass');
  if (bodies.some((b) => b.sizes.some((s) => s <= 0))) return fail('rigidSize');
  return null;
}

/** The composite tensor about the origin, or about the center of mass, with each body's terms as steps. */
export function composite(bodies: readonly Body[], about: 'origin' | 'center') {
  const steps: MechStep[] = [];
  let I: Mat = scale(eye(), 0);
  let mass = 0;
  const moment: Vec3 = [0, 0, 0];
  bodies.forEach((b, i) => {
    const R = eulerToMatrix(...b.turn);
    const own = centroidal(b);
    const turned = matMul(matMul(R, own), transpose(R));
    const shift = shiftTerm(b.mass, b.at);
    const vars = { n: String(i + 1), shape: b.shape };
    steps.push({ key: 'rigidBody', vars, math: `I'_{${i + 1}} = ${matLatex(own)}` });
    if (b.turn.some((t) => t !== 0)) steps.push({ key: 'rigidTurn', math: `R I' R^T = ${matLatex(turned)}` });
    steps.push({ key: 'rigidShift', math: `m(|\\mathbf r|^2 E - \\mathbf r\\mathbf r^T) = ${matLatex(shift)}` });
    I = add(I, add(turned, shift));
    mass += b.mass;
    for (let k = 0; k < 3; k += 1) moment[k] += b.mass * b.at[k];
  });
  const center = moment.map((v) => v / mass) as Vec3;
  steps.push({ key: 'rigidSum', math: `I_O = ${matLatex(I)}` });
  if (about === 'center') {
    I = add(I, scale(shiftTerm(mass, center), -1));
    const c = center.map((v) => tex(v)).join(',\\ ');
    steps.push({
      key: 'rigidCenter',
      math: `\\mathbf c = (${c}):\\quad I_G = I_O - M(|\\mathbf c|^2 E - \\mathbf c\\mathbf c^T) = ${matLatex(I)}`,
    });
  }
  return { tensor: I, mass, center, steps };
}

/** Principal moments (ascending) and right-handed axes; null when the tensor isn't physical. */
export function principal(I: Mat): { moments: Vec3; axes: Mat } | null {
  const { values, vectors } = symEigen(I);
  const top = Math.max(...values.map(Math.abs), 1e-300);
  const tol = 1e-9 * top;
  if (values.some((v) => v < -tol)) return null;
  // Each principal moment is at most the sum of the other two (the triangle inequality of a real mass).
  if (values.some((v, i) => v > values.reduce((s, w, j) => (j === i ? s : s + w), 0) + tol)) return null;
  const axes = vectors.map((row) => [...row]);
  const [u, v, w] = [0, 1, 2].map((k) => axes.map((row) => row[k]));
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (dot(cross, w) < 0) axes.forEach((row) => (row[2] = -row[2]));
  return { moments: values.map((x) => (Math.abs(x) < tol ? 0 : x)) as Vec3, axes };
}

/** The axisymmetric case: two equal principal moments and a distinct one. */
function axisymmetry(moments: Vec3, w: Vec3, M: Vec3): Axisymmetric | null {
  const top = Math.max(...moments);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * top;
  const axis = near(moments[0], moments[1]) ? 2 : near(moments[1], moments[2]) ? 0 : null;
  if (axis === null || near(moments[0], moments[2])) return null;
  const I = moments[axis === 2 ? 0 : 2];
  const I3 = moments[axis];
  const spin = w[axis];
  const H = Math.hypot(...moments.map((m, k) => m * w[k]));
  const across = Math.hypot(...M.map((v, k) => (k === axis ? 0 : v)));
  return {
    axis,
    spin,
    bodyRate: ((I3 - I) * spin) / I,
    spaceRate: H / I,
    nutation: H > 0 ? Math.acos(Math.max(-1, Math.min(1, (I3 * spin) / H))) : 0,
    gyroRate: across > 0 && spin !== 0 ? across / (I3 * spin) : null,
  };
}

/** Euler's equations in the principal axes, integrated over the run. */
function eulerRun(moments: Vec3, w0: Vec3, M: Vec3, duration: number) {
  const [I1, I2, I3] = moments;
  const run = dopri(
    (_, w) => [
      ((I2 - I3) * w[1] * w[2] + M[0]) / I1,
      ((I3 - I1) * w[2] * w[0] + M[1]) / I2,
      ((I1 - I2) * w[0] * w[1] + M[2]) / I3,
    ],
    0,
    w0,
    duration,
    { rtol: 1e-10, atol: 1e-12, hmax: duration / 600 },
  );
  const energy = (w: readonly number[]) => (I1 * w[0] ** 2 + I2 * w[1] ** 2 + I3 * w[2] ** 2) / 2;
  const momentum = (w: readonly number[]) => Math.hypot(I1 * w[0], I2 * w[1], I3 * w[2]);
  const change = (f: (w: readonly number[]) => number) => {
    const start = f(w0);
    return start > 0 ? Math.max(...run.y.map((w) => Math.abs(f(w) - start))) / start : 0;
  };
  const plot: Plot = {
    x: 'time',
    y: 'angularVelocity',
    series: [0, 1, 2].map((k) => ({
      name: 'principalOmega',
      vars: { n: String(k + 1) },
      points: run.t.map((t, i): [number, number] => [t, run.y[i][k]]),
    })),
  };
  return { ok: run.ok, plot, drift: Math.max(change(energy), change(momentum)) };
}

function eulerSteps(moments: Vec3, w: Vec3, sym: Axisymmetric | null, drift: number | null): MechStep[] {
  const [a, b, c] = moments.map((m) => tex(m));
  const steps: MechStep[] = [
    {
      key: 'rigidEuler',
      math:
        `${a}\\,\\dot\\omega_1 = (${b} - ${c})\\,\\omega_2\\omega_3 + M_1,\\quad ` +
        `${b}\\,\\dot\\omega_2 = (${c} - ${a})\\,\\omega_3\\omega_1 + M_2,\\quad ` +
        `${c}\\,\\dot\\omega_3 = (${a} - ${b})\\,\\omega_1\\omega_2 + M_3`,
    },
  ];
  if (sym) {
    const I = moments[sym.axis === 2 ? 0 : 2];
    const I3 = moments[sym.axis];
    const rate = `\\frac{(${tex(I3)} - ${tex(I)})\\times ${tex(sym.spin)}}{${tex(I)}}`;
    steps.push({
      key: 'rigidAxisymmetric',
      math: `\\Omega = \\frac{(I_3 - I)\\,\\omega_3}{I} = ${rate} = ${tex(sym.bodyRate)}\\ \\mathrm{rad/s}`,
    });
    const H = Math.hypot(...moments.map((m, k) => m * w[k]));
    const tilt = `\\theta = ${tex((sym.nutation * 180) / Math.PI)}^\\circ`;
    steps.push({
      key: 'rigidSpace',
      math: `\\dot\\phi = \\frac{|\\mathbf H|}{I} = \\frac{${tex(H)}}{${tex(I)}} = ${tex(sym.spaceRate)}\\ \\mathrm{rad/s},\\quad ${tilt}`,
    });
    if (sym.gyroRate !== null)
      steps.push({
        key: 'rigidGyro',
        math: `\\Omega_p = \\frac{M_\\perp}{I_3\\,\\omega_3} = ${tex(sym.gyroRate)}\\ \\mathrm{rad/s}`,
      });
  }
  if (drift !== null) steps.push({ key: 'rigidDrift', vars: { drift: fmt(drift, 2) } });
  return steps;
}

function invalidInput(input: RigidInput) {
  if (input.bodies) {
    const bad = invalidBodies(input.bodies);
    if (bad) return bad;
  } else {
    const T = input.tensor;
    if (!T || T.length !== 3 || T.some((row) => row.length !== 3)) return fail('rigidTensor');
    if (!finite(...T.flat())) return fail('notNumber');
    if (T.some((row, i) => row.some((v, j) => Math.abs(v - T[j][i]) > 1e-9 * Math.max(1, Math.abs(v)))))
      return fail('rigidSymmetric');
  }
  if (!finite(...input.omega0, ...input.torque, input.duration)) return fail('notNumber');
  if (input.duration <= 0 || input.duration > 600) return fail('robotDuration');
  return null;
}

export function solveRigid3d(input: RigidInput): Outcome<RigidResult> {
  const bad = invalidInput(input);
  if (bad) return bad;
  const built = input.bodies ? composite(input.bodies, input.about) : null;
  const tensor = built ? built.tensor : input.tensor!;
  const steps: MechStep[] = built ? built.steps : [{ key: 'rigidTyped', math: `I = ${matLatex(tensor)}` }];
  const p = principal(tensor);
  if (!p) return fail('rigidTriangle');
  const { moments, axes } = p;
  const [l1, l2, l3] = moments.map((m) => tex(m));
  steps.push({
    key: 'rigidPrincipal',
    math: `\\det(I - \\lambda E) = 0:\\quad I_1 = ${l1},\\ I_2 = ${l2},\\ I_3 = ${l3}`,
  });
  steps.push({ key: 'rigidAxes', math: `[\\mathbf e_1\\ \\mathbf e_2\\ \\mathbf e_3] = ${matLatex(axes)}` });
  // ω and the torque in the principal axes.
  const toPrincipal = (v: Vec3) => mulVec(transpose(axes), v);
  const w = toPrincipal(input.omega0);
  const M = toPrincipal(input.torque);
  const run = moments[0] > 0 ? eulerRun(moments, w, M, input.duration) : null;
  if (run && !run.ok) return fail('noConvergence');
  const torqueFree = M.every((v) => v === 0);
  const sym = axisymmetry(moments, w, M);
  const drift = torqueFree && run ? run.drift : null;
  if (run) steps.push(...eulerSteps(moments, w, sym, drift));
  else steps.push({ key: 'rigidNoRun' });
  const H = mulVec(tensor, input.omega0);
  return {
    ok: true,
    value: {
      mass: built ? built.mass : null,
      center: built ? built.center : null,
      tensor,
      moments,
      axes,
      energy: dot(input.omega0, H) / 2,
      momentum: Math.hypot(...H),
      axisymmetric: sym,
      drift,
      omegaPlot: run ? run.plot : null,
      steps,
    },
  };
}
