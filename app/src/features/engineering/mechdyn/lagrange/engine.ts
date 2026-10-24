// Lagrangian mechanics: equations of motion from typed kinetic and potential energy. L = T - V is differentiated
// symbolically for each generalized coordinate q and its rate q_dot. The chain rule over q, q_dot, and t gives
// d/dt of dL/dq_dot, and so M(q) q_ddot = f(q, q_dot, t). A Dormand-Prince integrator solves that at each step, with
// an energy check. Equilibria come from Newton's method on f with the rates at zero. Small oscillations come from
// the generalized eigenproblem of the linearized system.
import { build, dependsOn, type Node } from '../../../../core/expr';
import { symbolic } from '../symbolic';
import { compileExpr, readExpr } from '../expr';
import { dopri, generalizedEigen, solve } from '../num';
import { fail, finite, fmt, type MechStep, type Outcome, type Plot } from '../types';

export type LagrangeTemplate = 'pendulum' | 'double' | 'spring' | 'cart' | 'custom';

export interface LagrangeInput {
  template: LagrangeTemplate;
  coords: string[];
  T: string;
  V: string;
  /** Generalized force for each coordinate ('' for none). */
  forces: string[];
  params: [string, number][];
  q0: number[];
  qd0: number[];
  duration: number;
}

export const LAGRANGE_TEMPLATES: Record<
  Exclude<LagrangeTemplate, 'custom'>,
  Omit<LagrangeInput, 'template' | 'duration'>
> = {
  pendulum: {
    coords: ['th'],
    T: '1/2*m*L^2*th_dot^2',
    V: '-m*g*L*cos(th)',
    forces: [''],
    params: [
      ['m', 1],
      ['L', 1],
      ['g', 9.81],
    ],
    q0: [Math.PI / 2],
    qd0: [0],
  },
  double: {
    coords: ['th1', 'th2'],
    T: '1/2*(m1 + m2)*L1^2*th1_dot^2 + 1/2*m2*L2^2*th2_dot^2 + m2*L1*L2*th1_dot*th2_dot*cos(th1 - th2)',
    V: '-(m1 + m2)*g*L1*cos(th1) - m2*g*L2*cos(th2)',
    forces: ['', ''],
    params: [
      ['m1', 1],
      ['m2', 1],
      ['L1', 1],
      ['L2', 1],
      ['g', 9.81],
    ],
    q0: [Math.PI / 2, Math.PI / 2],
    qd0: [0, 0],
  },
  spring: {
    coords: ['r', 'th'],
    T: '1/2*m*(r_dot^2 + r^2*th_dot^2)',
    V: '-m*g*r*cos(th) + 1/2*k*(r - L0)^2',
    forces: ['', ''],
    params: [
      ['m', 1],
      ['k', 40],
      ['L0', 1],
      ['g', 9.81],
    ],
    q0: [1.2, 0.6],
    qd0: [0, 0],
  },
  cart: {
    coords: ['x', 'th'],
    T: '1/2*(M + m)*x_dot^2 + m*L*x_dot*th_dot*cos(th) + 1/2*m*L^2*th_dot^2',
    V: '1/2*k*x^2 - m*g*L*cos(th)',
    forces: ['', ''],
    params: [
      ['M', 2],
      ['m', 1],
      ['L', 1],
      ['k', 20],
      ['g', 9.81],
    ],
    q0: [0.1, 0.5],
    qd0: [0, 0],
  },
};

export const LAGRANGE_DEFAULTS: LagrangeInput = { template: 'pendulum', ...LAGRANGE_TEMPLATES.pendulum, duration: 10 };

const GREEK = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'eta',
  'theta',
  'lambda',
  'mu',
  'nu',
  'xi',
  'rho',
  'sigma',
  'tau',
  'phi',
  'chi',
  'psi',
  'omega',
]);

/** A coordinate or parameter name in LaTeX: th1 is theta_1, th_dot is theta with a dot, m2 is m_2. */
export function nameLatex(name: string): string {
  const dots = name.endsWith('_ddot') ? 2 : name.endsWith('_dot') ? 1 : 0;
  const base = dots === 2 ? name.slice(0, -5) : dots === 1 ? name.slice(0, -4) : name;
  const match = /^([A-Za-z]+?)_?(\d*)$/.exec(base);
  let letters = match ? match[1] : base;
  const digits = match ? match[2] : '';
  if (letters === 'th') letters = 'theta';
  let out = GREEK.has(letters) ? `\\${letters}` : letters.length > 1 ? `\\mathrm{${letters}}` : letters;
  if (dots) out = `\\${dots === 2 ? 'ddot' : 'dot'}{${out}}`;
  return `{${out}${digits ? `_{${digits}}` : ''}}`;
}

/** LaTeX of a tree with every name written as nameLatex. */
export function treeLatex(node: Node, names: readonly string[]): string {
  let renamed = node;
  for (const name of names) renamed = symbolic().substitute(renamed, name, build.name(nameLatex(name)));
  return symbolic().latexOf(renamed);
}

const NAME = /^[A-Za-z][A-Za-z0-9]*$/;

export interface Equilibrium {
  q: number[];
  stable: boolean;
  /** Small-oscillation frequencies, rad/s (null when unstable). */
  omegas: number[] | null;
}

export interface LagrangeResult {
  /** Each equation of motion as LaTeX. */
  equations: string[];
  /** q_ddot as LaTeX for one coordinate. */
  explicit: string | null;
  massLatex: string;
  equilibria: Equilibrium[];
  energyDrift: number | null;
  period: number | null;
  /** Period over the small-oscillation period of the nearest stable equilibrium (one coordinate). */
  periodRatio: number | null;
  /** Time history of each coordinate. */
  motion: Plot;
  times: number[];
  states: number[][];
  steps: MechStep[];
  /** For tests and plots: the compiled right-hand side. */
  accel: (q: readonly number[], qd: readonly number[], t: number) => number[] | null;
  energy: (q: readonly number[], qd: readonly number[]) => number;
}

/** The typed formulas, read: names for the coordinates, their rates and accelerations, and the parameters. */
interface Parsed {
  coords: string[];
  qd: string[];
  qdd: string[];
  /** Every name a formula may use, in the order the compiled functions take values. */
  names: string[];
  T: Node;
  V: Node;
  Q: Node[];
}

type Fail = ReturnType<typeof fail>;

function invalidLagrange({ coords, params, q0, qd0, duration }: LagrangeInput): Fail | null {
  const n = coords.length;
  if (n < 1 || n > 3) return fail('lagrangeCoords');
  if (!coords.every((c) => NAME.test(c)) || new Set(coords).size !== n) return fail('lagrangeNames');
  const paramNames = params.map(([p]) => p);
  const distinct = new Set([...paramNames, ...coords, 't']).size === paramNames.length + n + 1;
  if (!paramNames.every((p) => NAME.test(p)) || !distinct) return fail('lagrangeNames');
  if (q0.length !== n || qd0.length !== n) return fail('robotJointCount');
  if (!finite(...q0, ...qd0, duration, ...params.map(([, v]) => v))) return fail('notNumber');
  if (duration <= 0 || duration > 1000) return fail('robotDuration');
  return null;
}

function readLagrange(input: LagrangeInput): Outcome<Parsed> {
  const bad = invalidLagrange(input);
  if (bad) return bad;
  const { coords } = input;
  const qd = coords.map((c) => `${c}_dot`);
  const qdd = coords.map((c) => `${c}_ddot`);
  const names = [...coords, ...qd, 't', ...input.params.map(([p]) => p)];
  const read = (text: string, syntax: 'lagrangeT' | 'lagrangeV' | 'lagrangeQ'): Outcome<Node> => {
    const r = readExpr(text, names);
    if (r.ok) return { ok: true, value: r.node };
    return fail(r.error === 'exprSyntax' ? syntax : 'exprUnknown', r.name ? { name: r.name } : undefined);
  };
  const T = read(input.T, 'lagrangeT');
  if (!T.ok) return T;
  const V = read(input.V, 'lagrangeV');
  if (!V.ok) return V;
  const Q: Node[] = [];
  for (let i = 0; i < coords.length; i += 1) {
    const r = read(input.forces[i] ?? '', 'lagrangeQ');
    if (!r.ok) return r;
    Q.push(r.value);
  }
  if (qd.some((v) => dependsOn(V.value, v))) return fail('lagrangeVelocityInV');
  return { ok: true, value: { coords, qd, qdd, names, T: T.value, V: V.value, Q } };
}

/** Lagrange's equations, symbolically: M(q) q_ddot = f(q, q_dot, t), and the pieces the steps show. */
interface Derived {
  L: Node;
  dLdqd: Node[];
  dLdq: Node[];
  M: Node[][];
  f: Node[];
  /** d/dt of dL/dq_dot, with the accelerations in it. */
  ddt: Node[];
}

function derive({ coords, qd, qdd, T, V, Q }: Parsed): Outcome<Derived> {
  const { derivativeOf: D, simplest } = symbolic();
  const L = build.sub(T, V);
  const dLdqd = qd.map((v) => D(L, v));
  const dLdq = coords.map((q) => D(L, q));
  const M = dLdqd.map((p) => qd.map((v) => D(p, v)));
  if (M.flat().some((m) => qd.some((v) => dependsOn(m, v)))) return fail('lagrangeNotQuadratic');
  // Velocity terms of d/dt(dL/dq_dot): sum over q_j of d/dq_j (dL/dq_dot_i) q_dot_j, plus the explicit time part.
  const velTerms = dLdqd.map((p) =>
    coords.reduce<Node>((acc, q, j) => build.add(acc, build.mul(D(p, q), build.name(qd[j]))), D(p, 't')),
  );
  const f = coords.map((_, i) => simplest(build.sub(build.add(Q[i], dLdq[i]), velTerms[i])));
  const ddt = dLdqd.map((_, i) =>
    simplest(M[i].reduce<Node>((acc, m, j) => build.add(acc, build.mul(m, build.name(qdd[j]))), velTerms[i])),
  );
  return { ok: true, value: { L, dLdqd, dLdq, M, f, ddt } };
}

/** The derivation in LaTeX: L, each coordinate's partials and equation, and q_ddot or the mass matrix. */
function derivationSteps(p: Parsed, d: Derived) {
  const { simplest } = symbolic();
  const all = [...p.names, ...p.qdd];
  const latex = (node: Node) => treeLatex(simplest(node), all);
  const equations = p.coords.map((_, i) => `${latex(build.sub(d.ddt[i], d.dLdq[i]))} = ${latex(p.Q[i])}`);
  const explicit = p.coords.length === 1 ? `${nameLatex(p.qdd[0])} = ${latex(build.div(d.f[0], d.M[0][0]))}` : null;
  const rows = d.M.map((row) => row.map(latex).join(' & ')).join(' \\\\ ');
  const massLatex = `\\begin{bmatrix}${rows}\\end{bmatrix}`;
  const steps: MechStep[] = [{ key: 'lagrangeL', math: `L = T - V = ${latex(d.L)}` }];
  p.coords.forEach((q, i) => {
    const rate = nameLatex(p.qd[i]);
    const parts = [
      `\\frac{\\partial L}{\\partial ${rate}} = ${latex(d.dLdqd[i])}`,
      `\\frac{d}{dt}\\frac{\\partial L}{\\partial ${rate}} = ${treeLatex(d.ddt[i], all)}`,
      `\\frac{\\partial L}{\\partial ${nameLatex(q)}} = ${latex(d.dLdq[i])}`,
    ];
    steps.push({ key: 'lagrangePartials', vars: { q }, math: parts.join(',\\quad ') });
    steps.push({ key: 'lagrangeEquation', vars: { q }, math: equations[i] });
  });
  steps.push(
    explicit ? { key: 'lagrangeExplicit', math: explicit } : { key: 'lagrangeMass', math: `M(q) = ${massLatex}` },
  );
  return { steps, equations, explicit, massLatex };
}

/** The compiled equations: q_ddot at a state, the mass matrix and f at a state, and the energy T + V. */
interface Numerics {
  n: number;
  M: (q: readonly number[]) => number[][];
  f: (q: readonly number[]) => number[];
  accel: LagrangeResult['accel'];
  energy: LagrangeResult['energy'];
  T: (q: readonly number[], v: readonly number[]) => number;
  V: (q: readonly number[]) => number;
}

function compile(p: Parsed, d: Derived, params: readonly [string, number][]): Numerics {
  const n = p.coords.length;
  const values = params.map(([, v]) => v);
  const zero = new Array<number>(n).fill(0);
  const Mc = d.M.map((row) => row.map((m) => compileExpr(m, p.names)));
  const fc = d.f.map((fi) => compileExpr(fi, p.names));
  const Tc = compileExpr(p.T, p.names),
    Vc = compileExpr(p.V, p.names);
  const env = (q: readonly number[], v: readonly number[], t: number) => [...q, ...v, t, ...values];
  const accel = (q: readonly number[], v: readonly number[], t: number): number[] | null => {
    const e = env(q, v, t);
    return solve(
      Mc.map((row) => row.map((m) => m(e))),
      fc.map((fi) => fi(e)),
    );
  };
  return {
    n,
    M: (q) => Mc.map((row) => row.map((m) => m(env(q, zero, 0)))),
    f: (q) => fc.map((fi) => fi(env(q, zero, 0))),
    accel,
    energy: (q, v) => Tc(env(q, v, 0)) + Vc(env(q, v, 0)),
    T: (q, v) => Tc(env(q, v, 0)),
    V: (q) => Vc(env(q, zero, 0)),
  };
}

/** The Jacobian of g at q by central differences. */
function jacobian(g: (q: readonly number[]) => number[], q: readonly number[]): number[][] {
  const columns = q.map((_, j) => {
    const h = 1e-6 * Math.max(1, Math.abs(q[j]));
    const plus = g(q.map((v, k) => (k === j ? v + h : v)));
    const minus = g(q.map((v, k) => (k === j ? v - h : v)));
    return plus.map((p, i) => (p - minus[i]) / (2 * h));
  });
  return columns[0].map((_, i) => columns.map((column) => column[i]));
}

/** Newton's method on f(q, 0) = 0 from one start; null when it doesn't settle on a root. */
function newton(f: (q: readonly number[]) => number[], start: readonly number[]): number[] | null {
  let q = [...start];
  for (let it = 0; it < 60; it += 1) {
    const r = f(q);
    if (!finite(...r)) break;
    const step = solve(jacobian(f, q), r);
    if (!step) break;
    q = q.map((v, i) => v - step[i]);
    if (Math.hypot(...step) < 1e-12 * Math.max(1, Math.hypot(...q))) break;
  }
  const res = f(q);
  return finite(...q, ...res) && Math.hypot(...res) <= 1e-8 && q.every((v) => Math.abs(v) <= 7) ? q : null;
}

/** Equilibria from a grid of starts. Each comes with whether it is stable and its small-oscillation frequencies. */
function findEquilibria(num: Numerics): Equilibrium[] {
  const seeds = [-3, -1.5, 0, 1.5, 3];
  let grid: number[][] = [[]];
  for (let i = 0; i < num.n; i += 1) grid = grid.flatMap((g) => seeds.map((s) => [...g, s]));
  const equilibria: Equilibrium[] = [];
  for (const start of grid) {
    const q = newton(num.f, start);
    if (!q || equilibria.some((e) => e.q.every((v, i) => Math.abs(v - q[i]) < 1e-6))) continue;
    const K = jacobian(num.f, q).map((row) => row.map((v) => -v));
    const sym = K.map((row, i) => row.map((v, j) => (v + K[j][i]) / 2));
    const eig = generalizedEigen(sym, num.M(q));
    const stable = !!eig && eig.values.every((l) => l > 1e-12);
    equilibria.push({ q, stable, omegas: stable && eig ? eig.values.map(Math.sqrt) : null });
    if (equilibria.length >= 8) break;
  }
  return equilibria.sort((a, b) => Math.hypot(...a.q) - Math.hypot(...b.q));
}

/** The largest change in T + V over the run, relative to the largest |T| + |V|. */
function energyDrift(num: Numerics, ys: readonly number[][]): number {
  const n = num.n;
  const E = ys.map((y) => num.energy(y.slice(0, n), y.slice(n)));
  const scale = Math.max(
    ...ys.map((y) => Math.abs(num.T(y.slice(0, n), y.slice(n))) + Math.abs(num.V(y.slice(0, n)))),
    1e-300,
  );
  return Math.max(...E.map((e) => Math.abs(e - E[0]))) / scale;
}

/** One coordinate: the period from the turning points, and its ratio to the nearest stable small-oscillation one. */
function periodOf(events: readonly number[], q0: number, equilibria: readonly Equilibrium[]) {
  const ev = events.filter((t) => t > 1e-9);
  const period = ev.length >= 3 ? ev[2] - ev[0] : ev.length === 2 ? 2 * (ev[1] - ev[0]) : null;
  const near = equilibria.filter((e) => e.stable).sort((a, b) => Math.abs(a.q[0] - q0) - Math.abs(b.q[0] - q0))[0];
  const ratio = period !== null && near?.omegas ? (period * near.omegas[0]) / (2 * Math.PI) : null;
  return { period, ratio };
}

export function solveLagrange(input: LagrangeInput): Outcome<LagrangeResult> {
  const parsed = readLagrange(input);
  if (!parsed.ok) return parsed;
  const p = parsed.value;
  const derived = derive(p);
  if (!derived.ok) return derived;
  const d = derived.value;
  const { q0, qd0, duration } = input;
  const n = p.coords.length;
  const num = compile(p, d, input.params);
  if (d.M.some((row, i) => row[i].type === 'num' && row[i].value === 0) || !num.accel(q0, qd0, 0))
    return fail('lagrangeMassSingular');
  const { steps, equations, explicit, massLatex } = derivationSteps(p, d);
  const equilibria = findEquilibria(num);
  for (const e of equilibria.slice(0, 4))
    steps.push({
      key: e.stable ? 'lagrangeStable' : 'lagrangeUnstable',
      vars: { q: e.q.map((v) => fmt(v, 4)).join(', '), w: e.omegas ? e.omegas.map((w) => fmt(w, 4)).join(', ') : '' },
    });
  const nan = new Array<number>(n).fill(Number.NaN);
  const run = dopri(
    (t, y) => [...y.slice(n), ...(num.accel(y.slice(0, n), y.slice(n), t) ?? nan)],
    0,
    [...q0, ...qd0],
    duration,
    { rtol: 1e-10, atol: 1e-12, hmax: duration / 600, events: n === 1 ? [(_, y) => y[1]] : [] },
  );
  if (!run.ok || run.y.some((y) => !finite(...y))) return fail('noConvergence');
  const unforced = input.forces.every((s) => s.trim() === '' || s.trim() === '0');
  const conservative = unforced && ![p.T, p.V].some((x) => dependsOn(x, 't'));
  const drift = conservative ? energyDrift(num, run.y) : null;
  if (drift !== null) steps.push({ key: 'lagrangeEnergy', vars: { drift: fmt(drift, 2) } });
  const { period, ratio } =
    n === 1
      ? periodOf(
          run.events.map((e) => e.t),
          q0[0],
          equilibria,
        )
      : { period: null, ratio: null };
  if (period !== null && ratio !== null)
    steps.push({ key: 'lagrangePeriod', vars: { period: fmt(period), ratio: fmt(ratio, 6) } });
  const motion: Plot = {
    x: 'time',
    y: 'coordinate',
    series: p.coords.map((c, i) => ({
      name: 'coordinate',
      vars: { name: c },
      points: run.t.map((t, k): [number, number] => [t, run.y[k][i]]),
    })),
  };
  return {
    ok: true,
    value: {
      equations,
      explicit,
      massLatex,
      equilibria,
      energyDrift: drift,
      period,
      periodRatio: ratio,
      motion,
      times: run.t,
      states: run.y,
      steps,
      accel: num.accel,
      energy: num.energy,
    },
  };
}

/** Points to draw a template's bodies for one state: pivots, joints, and masses as a polyline. */
export function templateFrame(
  template: LagrangeTemplate,
  params: readonly [string, number][],
  q: readonly number[],
): [number, number][] {
  const p = Object.fromEntries(params);
  switch (template) {
    case 'pendulum':
      return [
        [0, 0],
        [p.L * Math.sin(q[0]), -p.L * Math.cos(q[0])],
      ];
    case 'double': {
      const a: [number, number] = [p.L1 * Math.sin(q[0]), -p.L1 * Math.cos(q[0])];
      return [[0, 0], a, [a[0] + p.L2 * Math.sin(q[1]), a[1] - p.L2 * Math.cos(q[1])]];
    }
    case 'spring':
      return [
        [0, 0],
        [q[0] * Math.sin(q[1]), -q[0] * Math.cos(q[1])],
      ];
    case 'cart':
      return [
        [q[0], 0],
        [q[0] + p.L * Math.sin(q[1]), -p.L * Math.cos(q[1])],
      ];
    default:
      return [];
  }
}
