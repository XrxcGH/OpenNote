// Robot dynamics and control for planar serial arms of up to three revolute links moving in a vertical plane
// (gravity along -y). Joint torques come from the recursive Newton-Euler method; the mass matrix from unit joint
// accelerations; the Coriolis matrix from Christoffel symbols of the mass matrix; and the closed loop (PD, PD with
// gravity compensation, or computed torque) is simulated with the Dormand-Prince integrator. Angles are relative
// joint angles in rad, each measured from the previous link (the first from +x), counterclockwise positive.
import { dopri, solve, type OdeSolution } from '../num';
import { tex } from '../tex';
import { fail, finite, type MechStep, type Outcome, type Plot, type Series } from '../types';

export interface ArmLink {
  length: number;
  mass: number;
  /** Distance from the joint to the center of mass along the link. */
  com: number;
  /** Moment of inertia about the center of mass, kg m^2. */
  inertia: number;
}

export type Controller = 'none' | 'pd' | 'pdg' | 'ct';
export type Trajectory = 'step' | 'quintic';

export interface RobotDynInput {
  links: ArmLink[];
  g: number;
  q: number[];
  qd: number[];
  qdd: number[];
  controller: Controller;
  kp: number;
  kd: number;
  trajectory: Trajectory;
  target: number[];
  /** Move time for the quintic path, s. */
  moveTime: number;
  duration: number;
}

export const ROBOTDYN_DEFAULTS: RobotDynInput = {
  links: [
    { length: 1, mass: 1, com: 1, inertia: 0 },
    { length: 1, mass: 1, com: 1, inertia: 0 },
  ],
  g: 9.81,
  q: [0, 0],
  qd: [0, 0],
  qdd: [0, 0],
  controller: 'ct',
  kp: 100,
  kd: 20,
  trajectory: 'step',
  target: [Math.PI / 4, Math.PI / 6],
  moveTime: 2,
  duration: 3,
};

type V2 = [number, number];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];

/** Joint torques for given joint positions, rates, and accelerations (recursive Newton-Euler). */
export function inverseDynamics(
  links: readonly ArmLink[],
  q: readonly number[],
  qd: readonly number[],
  qdd: readonly number[],
  g: number,
): number[] {
  const n = links.length;
  let phi = 0,
    w = 0,
    al = 0;
  let aJoint: V2 = [0, g]; // the base accelerates upward at g in place of gravity
  const aCom: V2[] = [],
    e: V2[] = [],
    alphas: number[] = [];
  for (let i = 0; i < n; i += 1) {
    phi += q[i];
    w += qd[i];
    al += qdd[i];
    const u: V2 = [Math.cos(phi), Math.sin(phi)],
      nrm: V2 = [-u[1], u[0]];
    const { length: L, com: c } = links[i];
    aCom.push([aJoint[0] + al * c * nrm[0] - w * w * c * u[0], aJoint[1] + al * c * nrm[1] - w * w * c * u[1]]);
    aJoint = [aJoint[0] + al * L * nrm[0] - w * w * L * u[0], aJoint[1] + al * L * nrm[1] - w * w * L * u[1]];
    e.push(u);
    alphas.push(al);
  }
  const tau = new Array<number>(n).fill(0);
  let f: V2 = [0, 0];
  let m = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const { length: L, mass, com: c, inertia } = links[i];
    const inertial: V2 = [mass * aCom[i][0], mass * aCom[i][1]];
    m = m + cross([L * e[i][0], L * e[i][1]], f) + cross([c * e[i][0], c * e[i][1]], inertial) + inertia * alphas[i];
    f = [f[0] + inertial[0], f[1] + inertial[1]];
    tau[i] = m;
  }
  return tau;
}

export function massMatrix(links: readonly ArmLink[], q: readonly number[]): number[][] {
  const n = links.length;
  const zero = new Array<number>(n).fill(0);
  const cols = Array.from({ length: n }, (_, j) =>
    inverseDynamics(
      links,
      q,
      zero,
      zero.map((_, k) => (k === j ? 1 : 0)),
      0,
    ),
  );
  return Array.from({ length: n }, (_, i) => cols.map((col) => col[i]));
}

/** Coriolis and centrifugal matrix from the Christoffel symbols of M (derivatives by central differences). */
export function coriolisMatrix(links: readonly ArmLink[], q: readonly number[], qd: readonly number[]): number[][] {
  const n = links.length;
  const h = 1e-6;
  const dM = Array.from({ length: n }, (_, k) => {
    const plus = massMatrix(
      links,
      q.map((v, i) => (i === k ? v + h : v)),
    );
    const minus = massMatrix(
      links,
      q.map((v, i) => (i === k ? v - h : v)),
    );
    return plus.map((row, i) => row.map((v, j) => (v - minus[i][j]) / (2 * h)));
  });
  return Array.from({ length: n }, (_, k) =>
    Array.from({ length: n }, (_, j) =>
      qd.reduce((s, qi, i) => s + 0.5 * (dM[i][k][j] + dM[j][k][i] - dM[k][i][j]) * qi, 0),
    ),
  );
}

/** Desired joint positions, rates, and accelerations at time t. */
export function reference(input: RobotDynInput, t: number): { q: number[]; qd: number[]; qdd: number[] } {
  const { q: q0, target, trajectory, moveTime: T } = input;
  if (trajectory === 'step' || t >= T) return { q: [...target], qd: target.map(() => 0), qdd: target.map(() => 0) };
  const s = t / T;
  const p = 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5;
  const dp = (30 * s ** 2 - 60 * s ** 3 + 30 * s ** 4) / T;
  const ddp = (60 * s - 180 * s ** 2 + 120 * s ** 3) / T ** 2;
  return {
    q: q0.map((a, i) => a + (target[i] - a) * p),
    qd: q0.map((a, i) => (target[i] - a) * dp),
    qdd: q0.map((a, i) => (target[i] - a) * ddp),
  };
}

export interface RobotDynResult {
  M: number[][];
  C: number[][];
  G: number[];
  /** Torques needed for the given q, q dot, q double dot. */
  torque: number[];
  angles: Plot;
  errors: Plot;
  torques: Plot;
  finalError: number[];
  steps: MechStep[];
}

const matTex = (A: readonly (readonly number[])[]) =>
  `\\begin{bmatrix}${A.map((row) => row.map((v) => tex(v, 4)).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;

type Fail = ReturnType<typeof fail>;

/** The reason the inputs can't be worked, or null when they can. */
function invalid(input: RobotDynInput): Fail | null {
  const { links, g, q, qd, qdd, kp, kd, target, moveTime, duration } = input;
  const n = links.length;
  if (n < 1 || n > 3) return fail('robotLinks');
  if ([q, qd, qdd, target].some((v) => v.length !== n)) return fail('robotJointCount');
  const linkNumbers = links.flatMap((l) => [l.length, l.mass, l.com, l.inertia]);
  if (!finite(g, kp, kd, moveTime, duration, ...q, ...qd, ...qdd, ...target, ...linkNumbers)) return fail('notNumber');
  if (links.some((l) => l.length <= 0)) return fail('positiveLength');
  if (links.some((l) => l.mass < 0 || l.inertia < 0)) return fail('negativeMass');
  if (links.some((l) => l.com < 0 || l.com > l.length)) return fail('robotCom');
  if (kp < 0 || kd < 0) return fail('negativeGains');
  if (duration <= 0 || duration > 600) return fail('robotDuration');
  if (input.trajectory === 'quintic' && moveTime <= 0) return fail('positiveTime');
  if (!solve(massMatrix(links, q), new Array<number>(n).fill(1))) return fail('robotSingularMass');
  return null;
}

/** M, C, G, and the torque at the given state, with their worked steps. */
function armTerms(input: RobotDynInput) {
  const { links, g, q, qd, qdd } = input;
  const zero = new Array<number>(links.length).fill(0);
  const M = massMatrix(links, q);
  const C = coriolisMatrix(links, q, qd);
  const G = inverseDynamics(links, q, zero, zero, g);
  const torque = inverseDynamics(links, q, qd, qdd, g);
  const steps: MechStep[] = [
    { key: 'robotDynEquation', math: `\\boldsymbol\\tau = M(q)\\ddot q + C(q,\\dot q)\\dot q + G(q)` },
    { key: 'robotDynMass', math: `M(q) = ${matTex(M)}\\ \\mathrm{kg\\,m^2}` },
    { key: 'robotDynCoriolis', math: `C(q,\\dot q) = ${matTex(C)}` },
    { key: 'robotDynGravity', math: `G(q) = ${matTex(G.map((v) => [v]))}\\ \\mathrm{N\\,m}` },
    { key: 'robotDynTorque', math: `\\boldsymbol\\tau = ${matTex(torque.map((v) => [v]))}\\ \\mathrm{N\\,m}` },
  ];
  return { M, C, G, torque, steps };
}

type Control = (t: number, x: readonly number[], v: readonly number[]) => number[];

/** The joint torques the controller asks for at time t and state (x, v). */
function controlLaw(input: RobotDynInput): Control {
  const { links, g, controller, kp, kd } = input;
  const zero = new Array<number>(links.length).fill(0);
  return (t, x, v) => {
    if (controller === 'none') return zero;
    const ref = reference(input, t);
    const e = ref.q.map((a, i) => a - x[i]);
    const ed = ref.qd.map((a, i) => a - v[i]);
    if (controller === 'pd' || controller === 'pdg') {
      const grav = controller === 'pdg' ? inverseDynamics(links, x, zero, zero, g) : zero;
      return e.map((ei, i) => kp * ei + kd * ed[i] + grav[i]);
    }
    const aCmd = ref.qdd.map((a, i) => a + kd * ed[i] + kp * e[i]);
    return inverseDynamics(links, x, v, aCmd, g);
  };
}

/** The closed loop from the given state: M(x) a = tau - (C v + G). */
function simulate(input: RobotDynInput, control: Control): OdeSolution {
  const { links, g, q, qd, duration } = input;
  const n = links.length;
  const zero = new Array<number>(n).fill(0);
  const rhs = (t: number, y: readonly number[]) => {
    const x = y.slice(0, n),
      v = y.slice(n);
    const tau = control(t, x, v);
    const bias = inverseDynamics(links, x, v, zero, g);
    const forces = tau.map((ti, i) => ti - bias[i]);
    return [...v, ...(solve(massMatrix(links, x), forces) ?? zero.map(() => Number.NaN))];
  };
  return dopri(rhs, 0, [...q, ...qd], duration, { rtol: 1e-10, atol: 1e-12, hmax: duration / 400 });
}

const deg = (r: number) => (r * 180) / Math.PI;

/** Joint angles, tracking errors, and torques against time. */
function plots(input: RobotDynInput, run: OdeSolution, control: Control) {
  const n = input.links.length;
  const joints = (pick: (j: number, k: number) => number): Series[] =>
    Array.from({ length: n }, (_, j) => ({
      name: 'joint',
      vars: { n: String(j + 1) },
      points: run.t.map((t, k) => [t, pick(j, k)] as [number, number]),
    }));
  const torques = run.t.map((t, k) => control(t, run.y[k].slice(0, n), run.y[k].slice(n)));
  return {
    angles: { x: 'time', y: 'jointAngle', series: joints((j, k) => deg(run.y[k][j])) } satisfies Plot,
    errors: {
      x: 'time',
      y: 'jointError',
      series: joints((j, k) => deg(reference(input, run.t[k]).q[j] - run.y[k][j])),
    } satisfies Plot,
    torques: { x: 'time', y: 'jointTorque', series: joints((j, k) => torques[k][j]) } satisfies Plot,
  };
}

const CONTROL_STEP = { ct: 'robotDynCt', pdg: 'robotDynPdg', pd: 'robotDynPd', none: 'robotDynFree' } as const;

export function solveRobotDyn(input: RobotDynInput): Outcome<RobotDynResult> {
  const bad = invalid(input);
  if (bad) return bad;
  const { M, C, G, torque, steps } = armTerms(input);
  const control = controlLaw(input);
  const run = simulate(input, control);
  if (!run.ok || run.y.some((y) => !finite(...y))) return fail('noConvergence');
  const last = run.y[run.y.length - 1];
  const finalError = reference(input, input.duration).q.map((a, i) => a - last[i]);
  steps.push({ key: CONTROL_STEP[input.controller], vars: { kp: tex(input.kp), kd: tex(input.kd) } });
  if (input.controller === 'ct') steps.push({ key: 'robotDynCtError', math: `\\ddot e + K_d\\dot e + K_p e = 0` });
  return { ok: true, value: { M, C, G, torque, ...plots(input, run, control), finalError, steps } };
}
