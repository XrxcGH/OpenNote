// Robot arm kinematics from a Denavit-Hartenberg table in either the standard form or the modified one. It gives
// each link transform, the end pose, the geometric Jacobian, and the manipulability. Inverse kinematics is closed
// form for planar 2R and 3R arms (both elbows, by the law of cosines) and damped least squares for any arm, with
// joint limits. It also samples the reachable workspace. Angles are in rad and lengths in m. The table holds the
// current joint values: theta for a revolute joint, d for a prismatic one.
import { matMul, solve, type Mat } from '../num';
import { tex } from '../tex';
import { fail, finite, fmt, type MechStep, type Outcome, type Plot } from '../types';

export type DhConvention = 'standard' | 'modified';
export type JointType = 'R' | 'P';

export interface DhRow {
  type: JointType;
  a: number;
  alpha: number;
  d: number;
  theta: number;
  /** Joint limits for inverse kinematics (null for none), in the joint's own units. */
  min: number | null;
  max: number | null;
}

export interface RobotKinInput {
  convention: DhConvention;
  rows: DhRow[];
  /** Target position for inverse kinematics; for a planar 3R arm the third entry is the end angle phi. */
  target: [number, number, number];
}

const R = (theta: number, a: number, alpha = 0, d = 0): DhRow => ({
  type: 'R',
  a,
  alpha,
  d,
  theta,
  min: null,
  max: null,
});
export const ROBOTKIN_DEFAULTS: RobotKinInput = {
  convention: 'standard',
  rows: [R((30 * Math.PI) / 180, 1), R((45 * Math.PI) / 180, 1)],
  target: [1.2, 0.8, 0],
};
export const SPATIAL_RRR: DhRow[] = [
  R((30 * Math.PI) / 180, 0, Math.PI / 2, 0.5),
  R((45 * Math.PI) / 180, 1),
  R((-60 * Math.PI) / 180, 1),
];

/** One link transform A_i. */
export function dhMatrix(row: DhRow, convention: DhConvention): Mat {
  const ct = Math.cos(row.theta),
    st = Math.sin(row.theta),
    ca = Math.cos(row.alpha),
    sa = Math.sin(row.alpha);
  if (convention === 'standard')
    return [
      [ct, -st * ca, st * sa, row.a * ct],
      [st, ct * ca, -ct * sa, row.a * st],
      [0, sa, ca, row.d],
      [0, 0, 0, 1],
    ];
  return [
    [ct, -st, 0, row.a],
    [st * ca, ct * ca, -sa, -sa * row.d],
    [st * sa, ct * sa, ca, ca * row.d],
    [0, 0, 0, 1],
  ];
}

/** T_0 (identity) to T_n, the pose of each frame in the base frame. */
export function frames(rows: readonly DhRow[], convention: DhConvention): Mat[] {
  const out: Mat[] = [
    [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ],
  ];
  for (const row of rows) out.push(matMul(out[out.length - 1], dhMatrix(row, convention)));
  return out;
}

const col = (T: Mat, j: number): [number, number, number] => [T[0][j], T[1][j], T[2][j]];
const cross3 = (a: number[], b: number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The 6 x n geometric Jacobian: rows vx, vy, vz, wx, wy, wz. */
export function jacobian(rows: readonly DhRow[], convention: DhConvention): Mat {
  const T = frames(rows, convention);
  const pe = col(T[T.length - 1], 3);
  const J: Mat = Array.from({ length: 6 }, () => new Array<number>(rows.length).fill(0));
  rows.forEach((row, i) => {
    // Standard: joint i turns about z of frame i - 1. Modified: about z of frame i.
    const F = convention === 'standard' ? T[i] : T[i + 1];
    const z = col(F, 2),
      p = col(F, 3);
    const v = row.type === 'R' ? cross3(z, [pe[0] - p[0], pe[1] - p[1], pe[2] - p[2]]) : z;
    const w = row.type === 'R' ? z : [0, 0, 0];
    for (let k = 0; k < 3; k += 1) {
      J[k][i] = v[k];
      J[k + 3][i] = w[k];
    }
  });
  return J;
}

const det = (A: Mat): number => {
  const n = A.length;
  if (n === 1) return A[0][0];
  if (n === 2) return A[0][0] * A[1][1] - A[0][1] * A[1][0];
  return A[0].reduce(
    (s, v, j) => s + (j % 2 ? -1 : 1) * v * det(A.slice(1).map((r) => r.filter((_, k) => k !== j))),
    0,
  );
};
const gram = (A: Mat, rowsFirst: boolean): Mat => {
  const At = A[0].map((_, j) => A.map((r) => r[j]));
  return rowsFirst ? matMul(A, At) : matMul(At, A);
};

/** True when every joint turns about the same z direction in one plane (all alpha zero, all revolute). A twist of
 * 180° keeps the arm planar but turns the next joint the other way, so it goes to the numerical solver. */
export const isPlanar = (rows: readonly DhRow[]) =>
  rows.every((r) => r.type === 'R' && Math.abs(Math.sin(r.alpha)) < 1e-12 && Math.cos(r.alpha) > 0);

export interface IkSolution {
  q: number[];
  /** Distance from the target after solving, m. */
  error: number;
  withinLimits: boolean;
  label: 'elbowUp' | 'elbowDown' | 'numeric';
  /** Reached only by slow convergence, as on the edge of the workspace where the Jacobian loses rank. */
  singular: boolean;
}

export interface RobotKinResult {
  transforms: Mat[];
  position: [number, number, number];
  rotation: Mat;
  /** ZYX Euler angles of the end frame: yaw, pitch, roll. */
  euler: [number, number, number];
  J: Mat;
  /** Planar arms: det of the 2 x 2 position Jacobian (two joints); otherwise null. */
  planarDet: number | null;
  manipulability: number;
  singular: boolean;
  ik: { solutions: IkSolution[]; reachable: boolean; method: 'closed2R' | 'closed3R' | 'numeric' };
  joints: [number, number, number][];
  workspace: Plot;
  steps: MechStep[];
}

const withinLimits = (rows: readonly DhRow[], q: readonly number[]) =>
  rows.every((r, i) => (r.min === null || q[i] >= r.min - 1e-9) && (r.max === null || q[i] <= r.max + 1e-9));
const jointValue = (r: DhRow) => (r.type === 'R' ? r.theta : r.d);
const setJoints = (rows: readonly DhRow[], q: readonly number[]): DhRow[] =>
  rows.map((r, i) => (r.type === 'R' ? { ...r, theta: q[i] } : { ...r, d: q[i] }));
const endPos = (rows: readonly DhRow[], c: DhConvention) => col(frames(rows, c)[rows.length], 3);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Closed-form planar 2R inverse kinematics: both elbow solutions, or none when out of reach. */
export function ik2R(
  L1: number,
  L2: number,
  x: number,
  y: number,
): { q: [number, number]; label: 'elbowUp' | 'elbowDown' }[] {
  const c2 = (x * x + y * y - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  if (c2 > 1 + 1e-12 || c2 < -1 - 1e-12) return [];
  const clamped = Math.max(-1, Math.min(1, c2));
  return ([1, -1] as const).map((sign) => {
    const q2 = sign * Math.acos(clamped);
    const q1 = Math.atan2(y, x) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
    return {
      q: [wrapAngle(q1), q2] as [number, number],
      label: sign > 0 ? ('elbowDown' as const) : ('elbowUp' as const),
    };
  });
}

/** Damped least squares on the position, from a start; null when it stalls short of the target. A target on the
 * workspace boundary, where the Jacobian is singular, converges only slowly: it is accepted to 1e-7 of the reach and
 * flagged singular. */
export function ikNumeric(
  rows: readonly DhRow[],
  c: DhConvention,
  target: readonly number[],
  start: readonly number[],
): { q: number[]; singular: boolean } | null {
  let q = [...start];
  const reach = rows.reduce((s, r) => s + Math.abs(r.a) + Math.abs(r.d), 0) || 1;
  const lambda = 1e-3 * reach;
  for (let it = 0; it < 500; it += 1) {
    const arm = setJoints(rows, q);
    const p = endPos(arm, c);
    const e = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
    if (Math.hypot(...e) < 1e-12 * reach) return { q, singular: false };
    const Jv = jacobian(arm, c).slice(0, 3);
    const JJt = gram(Jv, true).map((row, i) => row.map((v, j) => v + (i === j ? lambda * lambda : 0)));
    const y = solve(JJt, e);
    if (!y) return null;
    // Limit the step so the linearization holds.
    let dq = Jv[0].map((_, j) => Jv.reduce((s, row, k) => s + row[j] * y[k], 0));
    const big = Math.max(...dq.map(Math.abs));
    if (big > 0.5) dq = dq.map((v) => (v * 0.5) / big);
    q = q.map((v, i) => {
      const r = rows[i];
      let next = v + dq[i];
      if (r.min !== null) next = Math.max(r.min, next);
      if (r.max !== null) next = Math.min(r.max, next);
      return next;
    });
  }
  const p = endPos(setJoints(rows, q), c);
  const miss = Math.hypot(target[0] - p[0], target[1] - p[1], target[2] - p[2]);
  if (miss < 1e-9 * reach) return { q, singular: false };
  return miss < 1e-7 * reach ? { q, singular: true } : null;
}

const matTex = (A: Mat) =>
  `\\begin{bmatrix}${A.map((r) => r.map((v) => tex(v, 4)).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;

type Fail = ReturnType<typeof fail>;

function invalid({ rows, target }: RobotKinInput): Fail | null {
  if (rows.length < 1 || rows.length > 6) return fail('robotKinRows');
  if (!finite(...target, ...rows.flatMap((r) => [r.a, r.alpha, r.d, r.theta, r.min ?? 0, r.max ?? 0])))
    return fail('notNumber');
  if (rows.some((r) => r.min !== null && r.max !== null && r.min > r.max)) return fail('robotLimits');
  return null;
}

const armReach = (rows: readonly DhRow[]) => rows.reduce((s, r) => s + Math.abs(r.a) + Math.abs(r.d), 0) || 1;

/** The end pose, the Jacobian, and how far the arm is from a singular configuration. */
function pose(rows: readonly DhRow[], c: DhConvention) {
  const n = rows.length;
  const T = frames(rows, c);
  const end = T[n];
  const position = col(end, 3);
  const rotation = end.slice(0, 3).map((r) => r.slice(0, 3));
  const pitch = Math.asin(Math.max(-1, Math.min(1, -rotation[2][0])));
  const euler: [number, number, number] = [
    Math.atan2(rotation[1][0], rotation[0][0]),
    pitch,
    Math.atan2(rotation[2][1], rotation[2][2]),
  ];
  const J = jacobian(rows, c);
  const planar = isPlanar(rows) && c === 'standard';
  const Jv = J.slice(0, planar ? 2 : 3);
  const planarDet = planar && n === 2 ? det(Jv) : null;
  const manipulability = Math.sqrt(Math.max(0, Jv.length <= n ? det(gram(Jv, true)) : det(gram(Jv, false))));
  const singular = manipulability < 1e-6 * armReach(rows) ** Math.min(n, Jv.length);
  return { T, end, position, rotation, euler, J, planar, planarDet, manipulability, singular };
}

type Pose = ReturnType<typeof pose>;

/** Each A_i, their product, the position, and the Jacobian measure. */
function forwardSteps(rows: readonly DhRow[], c: DhConvention, p: Pose): MechStep[] {
  const n = rows.length;
  const steps: MechStep[] = rows.map((row, i) => ({
    key: c === 'standard' ? 'robotKinAStandard' : 'robotKinAModified',
    vars: { i: String(i + 1) },
    math: `A_{${i + 1}} = ${matTex(dhMatrix(row, c))}`,
  }));
  steps.push({
    key: 'robotKinProduct',
    math: `T_0^{${n}} = ${rows.map((_, i) => `A_{${i + 1}}`).join('')} = ${matTex(p.end)}`,
  });
  steps.push({
    key: 'robotKinPosition',
    math: `\\mathbf p = (${p.position.map((v) => tex(v, 6)).join(',\\ ')})\\ \\mathrm{m}`,
  });
  steps.push({
    key: p.planarDet !== null ? 'robotKinPlanarDet' : 'robotKinManipulability',
    vars: { w: fmt(p.manipulability, 4) },
    math:
      p.planarDet !== null
        ? `\\det J = L_1 L_2\\sin\\theta_2 = ${tex(p.planarDet, 6)}`
        : `w = \\sqrt{\\det\\left(J_v J_v^{\\mathsf T}\\right)} = ${tex(p.manipulability, 4)}`,
  });
  if (p.singular) steps.push({ key: 'robotKinSingular' });
  return steps;
}

type Check = (q: number[], label: IkSolution['label']) => IkSolution;

const anglesTex = (solutions: readonly IkSolution[]) =>
  solutions.map((s) => `(${s.q.map((v) => tex((v * 180) / Math.PI, 6)).join(',\\ ')})^\\circ`).join(',\\ ');

/** Planar 2R and 3R: the wrist point, then the law of cosines for both elbows. */
function closedIk(rows: readonly DhRow[], target: readonly number[], check: Check, steps: MechStep[]) {
  const n = rows.length;
  const [L1, L2] = [rows[0].a, rows[1].a];
  const phi = target[2];
  const wx = n === 3 ? target[0] - rows[2].a * Math.cos(phi) : target[0];
  const wy = n === 3 ? target[1] - rows[2].a * Math.sin(phi) : target[1];
  const found = ik2R(L1, L2, wx, wy);
  const solutions = found.map(({ q, label }) =>
    check(n === 3 ? [q[0], q[1], wrapAngle(phi - q[0] - q[1])] : [...q], label),
  );
  if (n === 3)
    steps.push({
      key: 'robotKinWrist',
      math: `x_w = x - L_3\\cos\\phi = ${tex(wx)},\\ y_w = y - L_3\\sin\\phi = ${tex(wy)}`,
    });
  const c2 = (wx * wx + wy * wy - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  steps.push({
    key: 'robotKinCosines',
    math: `\\cos\\theta_2 = \\frac{x^2 + y^2 - L_1^2 - L_2^2}{2L_1L_2} = ${tex(c2, 6)}`,
  });
  const first = `\\theta_1 = \\operatorname{atan2}(y, x) - \\operatorname{atan2}(L_2\\sin\\theta_2,\\ L_1 + L_2\\cos\\theta_2)`;
  if (found.length) steps.push({ key: 'robotKinElbows', math: `${first}:\\ ${anglesTex(solutions)}` });
  return solutions;
}

/** Any arm: damped least squares from three starts, keeping the distinct answers. */
function numericIk(rows: readonly DhRow[], c: DhConvention, target: readonly number[], check: Check) {
  const seen: number[][] = [];
  const solutions: IkSolution[] = [];
  const starts = [
    rows.map(jointValue),
    rows.map((r) => (r.type === 'R' ? -r.theta : r.d)),
    rows.map((r, i) => (r.type === 'R' ? r.theta + (i % 2 ? -1 : 1) * 1.2 : r.d)),
  ];
  for (const s of starts) {
    const found = ikNumeric(rows, c, target, s);
    if (!found) continue;
    const norm = found.q.map((v, i) => (rows[i].type === 'R' ? wrapAngle(v) : v));
    if (seen.some((o) => o.every((v, i) => Math.abs(v - norm[i]) < 1e-6))) continue;
    seen.push(norm);
    solutions.push({ ...check(norm, 'numeric'), singular: found.singular });
  }
  return solutions;
}

const DLS = `\\Delta q = J_v^{\\mathsf T}\\left(J_v J_v^{\\mathsf T} + \\lambda^2 I\\right)^{-1}\\mathbf e`;

function inverse(input: RobotKinInput, p: Pose, steps: MechStep[]): RobotKinResult['ik'] {
  const { convention: c, rows, target } = input;
  const n = rows.length;
  const check: Check = (q, label) => {
    const at = endPos(setJoints(rows, q), c);
    const z = p.planar ? p.position[2] : target[2];
    const error = Math.hypot(target[0] - at[0], target[1] - at[1], z - at[2]);
    return { q, error, withinLimits: withinLimits(rows, q), label, singular: false };
  };
  const closed = p.planar && rows.every((r) => r.d === 0) && (n === 2 || n === 3);
  const solutions = closed ? closedIk(rows, target, check, steps) : numericIk(rows, c, target, check);
  if (!closed) steps.push({ key: 'robotKinDls', math: DLS });
  const reachable = solutions.some((s) => s.error < 1e-6 * armReach(rows));
  if (!reachable) steps.push({ key: 'robotKinUnreachable' });
  else if (solutions.some((s) => s.singular)) steps.push({ key: 'robotKinBoundary' });
  return { solutions, reachable, method: closed ? (n === 2 ? 'closed2R' : 'closed3R') : 'numeric' };
}

/** Samples of the reachable workspace: revolute joints over their limits or a full turn, prismatic ones over their
 * limits or 0 to 1 m. */
function workspace(rows: readonly DhRow[], c: DhConvention, planar: boolean): Plot {
  const n = rows.length;
  const per = Math.max(2, Math.floor(Math.pow(6000, 1 / n)));
  const ranges = rows.map((r) =>
    r.type === 'R' ? [r.min ?? -Math.PI, r.max ?? Math.PI] : [r.min ?? 0, r.max ?? Math.max(1, r.d)],
  );
  const cloud: [number, number][] = [];
  const side: [number, number][] = [];
  const idx = new Array<number>(n).fill(0);
  for (let count = 0; count < per ** n; count += 1) {
    const q = idx.map((k, i) => ranges[i][0] + ((ranges[i][1] - ranges[i][0]) * k) / (per - 1));
    const p = endPos(setJoints(rows, q), c);
    cloud.push([p[0], p[1]]);
    side.push([Math.hypot(p[0], p[1]), p[2]]);
    for (let i = 0; i < n; i += 1) {
      idx[i] += 1;
      if (idx[i] < per) break;
      idx[i] = 0;
    }
  }
  const sideView = planar ? [] : [{ name: 'workspaceSide' as const, points: side, dots: true }];
  return { x: 'x', y: 'y', equal: true, series: [{ name: 'workspaceTop', points: cloud, dots: true }, ...sideView] };
}

export function solveRobotKin(input: RobotKinInput): Outcome<RobotKinResult> {
  const bad = invalid(input);
  if (bad) return bad;
  const { convention: c, rows } = input;
  const p = pose(rows, c);
  const steps = forwardSteps(rows, c, p);
  const ik = inverse(input, p, steps);
  const { T, position, rotation, euler, J, planarDet, manipulability, singular } = p;
  return {
    ok: true,
    value: {
      ...{ transforms: T.slice(1), position, rotation, euler, J, planarDet, manipulability, singular, ik },
      joints: T.map((F) => col(F, 3)),
      workspace: workspace(rows, c, p.planar),
      steps,
    },
  };
}
