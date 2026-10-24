// Systems of differential equations in the plane. For x' = A x the tool classifies the equilibrium and writes
// the general solution from the eigenvalues. A second-order equation is reduced to that system first. For a
// nonlinear system it finds the equilibria, the Jacobian at each, the nullclines, and trajectories for a portrait.
import { compile, derivative, latexOf, namesIn, read, show } from '../expr';
import { dopri45 } from '../integrators';
import { expm, newtonSystem, type Mat } from '../dense';
import { fmt } from '../numeric';
import { KitError, step, type KitStep } from '../types';

export type Kind =
  | 'stableNode'
  | 'unstableNode'
  | 'saddle'
  | 'stableSpiral'
  | 'unstableSpiral'
  | 'center'
  | 'stableImproper'
  | 'unstableImproper'
  | 'stableStar'
  | 'unstableStar'
  | 'lineOfEquilibria'
  | 'zeroMatrix';

export interface Classification {
  trace: number;
  det: number;
  discriminant: number;
  kind: Kind;
  /** The eigenvalues as [re, im] pairs. */
  eigenvalues: [number, number][];
  stable: 'stable' | 'unstable' | 'neutral';
}

type Pair = [number, number];
type Path = Pair[];

const near0 = (v: number, scale: number) => Math.abs(v) <= 1e-12 * Math.max(1, scale);

function kindOf(a: number, b: number, c: number, d: number): Kind {
  const trace = a + d;
  const det = a * d - b * c;
  const disc = trace * trace - 4 * det;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) ** 2;
  if (a === 0 && b === 0 && c === 0 && d === 0) return 'zeroMatrix';
  if (near0(det, scale)) return 'lineOfEquilibria';
  if (det < 0) return 'saddle';
  if (near0(disc, scale)) {
    const star = near0(b, scale) && near0(c, scale) && near0(a - d, scale);
    if (trace < 0) return star ? 'stableStar' : 'stableImproper';
    return star ? 'unstableStar' : 'unstableImproper';
  }
  if (disc > 0) return trace < 0 ? 'stableNode' : 'unstableNode';
  if (near0(trace, Math.sqrt(scale))) return 'center';
  return trace < 0 ? 'stableSpiral' : 'unstableSpiral';
}

export function classify(a: number, b: number, c: number, d: number): Classification {
  const trace = a + d;
  const det = a * d - b * c;
  const discriminant = trace * trace - 4 * det;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) ** 2;
  const root = Math.sqrt(near0(discriminant, scale) ? 0 : Math.abs(discriminant));
  const complex = discriminant < 0 && !near0(discriminant, scale);
  const eigenvalues: Pair[] = complex
    ? [
        [trace / 2, root / 2],
        [trace / 2, -root / 2],
      ]
    : [
        [(trace + root) / 2, 0],
        [(trace - root) / 2, 0],
      ];
  const kind = kindOf(a, b, c, d);
  const neutral = kind === 'zeroMatrix' || kind === 'center' || kind === 'lineOfEquilibria';
  const stable = neutral ? 'neutral' : kind.startsWith('stable') ? 'stable' : 'unstable';
  return { trace, det, discriminant, kind, eigenvalues, stable };
}

const matrixLatex = (rows: string[][]) => `\\begin{pmatrix}${rows.map((r) => r.join('&')).join('\\\\')}\\end{pmatrix}`;
const colLatex = (v: readonly number[]) => matrixLatex(v.map((x) => [fmt(x, 6)]));

/** An eigenvector of [[a, b], [c, d]] for the real eigenvalue lambda, scaled so its largest entry has size 1. */
export function eigenvector(a: number, b: number, c: number, d: number, lambda: number): Pair {
  let v: Pair;
  if (Math.abs(b) > 1e-12) v = [b, lambda - a];
  else if (Math.abs(c) > 1e-12) v = [lambda - d, c];
  else v = Math.abs(lambda - a) <= Math.abs(lambda - d) ? [1, 0] : [0, 1];
  const big = Math.max(Math.abs(v[0]), Math.abs(v[1])) || 1;
  return [v[0] / big, v[1] / big];
}

export interface LinearResult {
  classification: Classification;
  eigenvectors: (Pair | null)[];
  generalSolution: string;
  steps: KitStep[];
  trajectories: Path[];
  field: Path[];
  /** Straight-line solutions along the real eigenvectors. */
  axes: Path[];
  extent: number;
}

interface Solution {
  steps: KitStep[];
  latex: string;
  eigenvectors: (Pair | null)[];
}

/** The eigen-analysis steps and the general solution for each kind of eigenvalues. */
function solutionFor(a: number, b: number, c: number, d: number, k: Classification): Solution {
  const [l1, l2] = k.eigenvalues;
  const steps: KitStep[] = [];
  const eigenvectors: (Pair | null)[] = [null, null];
  const vectorStep = (lambda: number, v: Pair) =>
    step('odeEigenvector', colLatex(v), { lambda: fmt(lambda), vector: `(${fmt(v[0])}, ${fmt(v[1])})` });
  const repeated = l1[1] === 0 && Math.abs(l1[0] - l2[0]) <= 1e-9 * (1 + Math.abs(l1[0]));
  const star = Math.abs(b) < 1e-12 && Math.abs(c) < 1e-12 && Math.abs(a - d) < 1e-12;
  if (l1[1] !== 0) {
    const alpha = l1[0];
    const beta = Math.abs(l1[1]);
    // v = u + i w with u = (b, alpha - a) and w = (0, beta) is an eigenvector for alpha + i beta.
    const u: Pair = [b, alpha - a];
    const w: Pair = [0, beta];
    steps.push(
      step('odeComplexEigen', `\\lambda=${fmt(alpha)}\\pm ${fmt(beta)}i`, { alpha: fmt(alpha), beta: fmt(beta) }),
    );
    steps.push(step('odeComplexVector', `\\mathbf v=${colLatex(u)}+i${colLatex(w)}`));
    const [U, W, cb, sb] = [colLatex(u), colLatex(w), `\\cos ${fmt(beta)}t`, `\\sin ${fmt(beta)}t`];
    const first = `c_1\\left(${U}${cb}-${W}${sb}\\right)`;
    const second = `c_2\\left(${U}${sb}+${W}${cb}\\right)`;
    return { steps, eigenvectors, latex: `\\mathbf x(t)=e^{${fmt(alpha)}t}\\left[${first}+${second}\\right]` };
  }
  if (k.kind === 'zeroMatrix') return { steps, eigenvectors, latex: '\\mathbf x(t)=\\mathbf c' };
  if (repeated && star) {
    steps.push(step('odeRepeated', `\\lambda=${fmt(l1[0])}`, { lambda: fmt(l1[0]) }));
    return { steps, eigenvectors, latex: `\\mathbf x(t)=e^{${fmt(l1[0])}t}\\mathbf c` };
  }
  if (repeated) {
    const lambda = l1[0];
    const v = eigenvector(a, b, c, d, lambda);
    eigenvectors[0] = v;
    steps.push(step('odeRepeated', `\\lambda=${fmt(lambda)}`, { lambda: fmt(lambda) }));
    steps.push(vectorStep(lambda, v));
    // A generalized eigenvector g solves (A - lambda I) g = v.
    const g: Pair = Math.abs(b) > 1e-12 ? [0, v[0] / b] : [v[1] / c, 0];
    steps.push(step('odeGeneralized', colLatex(g)));
    const e = `e^{${fmt(lambda)}t}`;
    const latex = `\\mathbf x(t)=c_1${e}${colLatex(v)}+c_2${e}\\left(t${colLatex(v)}+${colLatex(g)}\\right)`;
    return { steps, eigenvectors, latex };
  }
  steps.push(
    step('odeEigenvalues', `\\lambda_1=${fmt(l1[0])},\\;\\lambda_2=${fmt(l2[0])}`, {
      values: `${fmt(l1[0])}, ${fmt(l2[0])}`,
    }),
  );
  const parts: string[] = [];
  [l1, l2].forEach((l, index) => {
    const v = eigenvector(a, b, c, d, l[0]);
    eigenvectors[index] = v;
    steps.push(vectorStep(l[0], v));
    parts.push(`c_${index + 1}e^{${fmt(l[0])}t}${colLatex(v)}`);
  });
  return { steps, eigenvectors, latex: `\\mathbf x(t)=${parts.join('+')}` };
}

/** Exact solution curves through a ring of starting points, by the matrix exponential. */
function exactCurves(A: Mat, k: Classification, extent: number): Path[] {
  const rate = Math.max(...k.eigenvalues.map((l) => Math.hypot(l[0], l[1])), 0.25);
  const T = Math.min(8, 4 / rate);
  const clip = extent * 1.05;
  const curves: Path[] = [];
  for (let s = 0; s < 8; s++) {
    const angle = (2 * Math.PI * s) / 8 + 0.2;
    for (const radius of [extent * 0.35, extent * 0.8]) {
      const x0 = [radius * Math.cos(angle), radius * Math.sin(angle)];
      const line: Path = [];
      for (let i = -60; i <= 60; i++) {
        const E = expm(A.map((row) => row.map((v) => (v * T * i) / 60)));
        const p: Pair = [E[0][0] * x0[0] + E[0][1] * x0[1], E[1][0] * x0[0] + E[1][1] * x0[1]];
        if (Math.abs(p[0]) <= clip && Math.abs(p[1]) <= clip) line.push(p);
      }
      curves.push(line);
    }
  }
  return curves;
}

type Window = [number, number, number, number];

/** Short segments along the vector field on a grid of the window. */
function fieldSegments(v: (x: number, y: number) => Pair, win: Window, n: number): Path[] {
  const [x0, x1, y0, y1] = win;
  const segments: Path[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * j) / n;
      const [vx, vy] = v(x, y);
      const len = Math.hypot(vx / (x1 - x0), vy / (y1 - y0));
      if (!Number.isFinite(len) || len < 1e-12) continue;
      const s = 0.35 / (n * len);
      segments.push([
        [x - vx * s, y - vy * s],
        [x + vx * s, y + vy * s],
      ]);
    }
  }
  return segments;
}

/** Everything for x' = A x with A = [[a, b], [c, d]], including curves for a phase portrait. */
export function analyzeLinear(a: number, b: number, c: number, d: number, extent = 4): LinearResult {
  if (![a, b, c, d].every(Number.isFinite) || !(extent > 0)) throw new KitError('badMatrix');
  const k = classify(a, b, c, d);
  const matrix = `\\begin{pmatrix}${fmt(a)}&${fmt(b)}\\\\${fmt(c)}&${fmt(d)}\\end{pmatrix}`;
  const solution = solutionFor(a, b, c, d, k);
  const steps: KitStep[] = [
    step('odeSystem', `\\mathbf x'=${matrix}\\mathbf x`),
    step('odeCharacteristic', `\\lambda^{2}-(${fmt(k.trace)})\\lambda+(${fmt(k.det)})=0`, {
      trace: fmt(k.trace),
      det: fmt(k.det),
    }),
    ...solution.steps,
    step('odeKind', undefined, { $kind: `kitMath.odes.kind.${k.kind}` }),
    step('odeGeneral', solution.latex),
  ];
  const win: Window = [-extent, extent, -extent, extent];
  const axes: Path[] = solution.eigenvectors
    .filter((v): v is Pair => v !== null)
    .map((v) => {
      const s = extent / Math.max(Math.abs(v[0]), Math.abs(v[1]));
      return [
        [-v[0] * s, -v[1] * s],
        [v[0] * s, v[1] * s],
      ];
    });
  const A: Mat = [
    [a, b],
    [c, d],
  ];
  return {
    classification: k,
    eigenvectors: solution.eigenvectors,
    generalSolution: solution.latex,
    steps,
    trajectories: exactCurves(A, k, extent),
    field: fieldSegments((x, y) => [a * x + b * y, c * x + d * y], win, 8),
    axes,
    extent,
  };
}

/** y'' + p y' + q y = 0 as the system x1' = x2, x2' = -q x1 - p x2, and its analysis. */
export function analyzeSecondOrder(p: number, q: number, extent = 4): LinearResult {
  const result = analyzeLinear(0, 1, -q, -p, extent);
  const system = `\\begin{pmatrix}0&1\\\\${fmt(-q)}&${fmt(-p)}\\end{pmatrix}`;
  const reduce = `y''+${fmt(p)}y'+${fmt(q)}y=0\\;\\Rightarrow\\;\\mathbf x'=${system}\\mathbf x`;
  return { ...result, steps: [step('odeReduce', reduce), ...result.steps] };
}

export interface Equilibrium {
  x: number;
  y: number;
  jacobian: Mat;
  classification: Classification;
  /** The linearization is a center, or has a zero eigenvalue, so it does not decide the nonlinear behavior. */
  inconclusive: boolean;
}

export interface NonlinearResult {
  equilibria: Equilibrium[];
  jacobianLatex: string;
  nullclines: { f: Path[]; g: Path[] };
  trajectories: Path[];
  field: Path[];
  steps: KitStep[];
  window: Window;
}

/** The curve h(x, y) = 0 on a grid of the window, as short segments (marching squares). */
function marching(h: (x: number, y: number) => number, win: Window, n = 70): Path[] {
  const [x0, x1, y0, y1] = win;
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  const value: number[][] = [];
  for (let i = 0; i <= n; i++) value.push(Array.from({ length: n + 1 }, (_, j) => h(x0 + i * dx, y0 + j * dy)));
  const cross = (xa: number, ya: number, va: number, xb: number, yb: number, vb: number): Pair | null => {
    if (!Number.isFinite(va) || !Number.isFinite(vb) || va === vb || va > 0 === vb > 0) return null;
    const s = va / (va - vb);
    return [xa + s * (xb - xa), ya + s * (yb - ya)];
  };
  const segments: Path[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const xa = x0 + i * dx;
      const ya = y0 + j * dy;
      const [v00, v10, v11, v01] = [value[i][j], value[i + 1][j], value[i + 1][j + 1], value[i][j + 1]];
      const pts = [
        cross(xa, ya, v00, xa + dx, ya, v10),
        cross(xa + dx, ya, v10, xa + dx, ya + dy, v11),
        cross(xa, ya + dy, v01, xa + dx, ya + dy, v11),
        cross(xa, ya, v00, xa, ya + dy, v01),
      ].filter((p): p is Pair => p !== null);
      if (pts.length === 2) segments.push([pts[0], pts[1]]);
      else if (pts.length === 4) segments.push([pts[0], pts[1]], [pts[2], pts[3]]);
    }
  }
  return segments;
}

interface Field {
  f: (p: readonly number[]) => number;
  g: (p: readonly number[]) => number;
  jacobian: (p: readonly number[]) => Mat;
  jacobianLatex: string;
}

function readField(fText: string, gText: string): Field {
  const fNode = read(fText);
  const gNode = read(gText);
  for (const node of [fNode, gNode]) {
    for (const name of namesIn(node)) if (name !== 'x' && name !== 'y') throw new KitError('unknown-name', name);
  }
  const make = (node: typeof fNode) => compile(node, ['x', 'y']);
  const [f, g] = [make(fNode), make(gNode)];
  const [fx, fy] = [make(derivative(fNode, 'x')), make(derivative(fNode, 'y'))];
  const [gx, gy] = [make(derivative(gNode, 'x')), make(derivative(gNode, 'y'))];
  if (![f([1, 1]), g([1, 1]), f([0.5, 0.3]), g([0.5, 0.3])].every(Number.isFinite)) {
    throw new KitError('undefinedTerm', `${fText}, ${gText}`);
  }
  const tex = (node: typeof fNode, v: string) => latexOf(show(derivative(node, v)));
  return {
    f,
    g,
    jacobian: (p) => [
      [fx(p), fy(p)],
      [gx(p), gy(p)],
    ],
    jacobianLatex: matrixLatex([
      [tex(fNode, 'x'), tex(fNode, 'y')],
      [tex(gNode, 'x'), tex(gNode, 'y')],
    ]),
  };
}

function findEquilibria(field: Field, win: Window): Equilibrium[] {
  const [x0, x1, y0, y1] = win;
  const F = (p: readonly number[]) => [field.f(p), field.g(p)];
  const found: Pair[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const start = [x0 + ((x1 - x0) * i) / n + 0.0113, y0 + ((y1 - y0) * j) / n + 0.0071];
      const r = newtonSystem(F, start, { jacobian: field.jacobian, tolerance: 1e-13, maxIterations: 80 });
      if (!r.converged) continue;
      const [x, y] = r.x;
      if (x < x0 - 1e-9 || x > x1 + 1e-9 || y < y0 - 1e-9 || y > y1 + 1e-9) continue;
      const snap = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
      const p: Pair = [snap(x), snap(y)];
      if (!found.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)) found.push(p);
    }
  }
  found.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return found.map(([x, y]) => {
    const jac = field.jacobian([x, y]);
    const classification = classify(jac[0][0], jac[0][1], jac[1][0], jac[1][1]);
    const open = ['center', 'lineOfEquilibria', 'zeroMatrix'].includes(classification.kind);
    return { x, y, jacobian: jac, classification, inconclusive: open };
  });
}

/** Trajectories from a grid of starting points, forward and backward until they leave a generous box. */
function trajectoriesOf(field: Field, win: Window): Path[] {
  const [x0, x1, y0, y1] = win;
  const [wx, wy] = [x1 - x0, y1 - y0];
  const rhs = (_t: number, p: readonly number[]) => [field.f(p), field.g(p)];
  const inside = (p: { y: number[] }) => p.y[0] > x0 - wx && p.y[0] < x1 + wx && p.y[1] > y0 - wy && p.y[1] < y1 + wy;
  const paths: Path[] = [];
  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 4; j++) {
      const start = [x0 + (wx * i) / 5, y0 + (wy * j) / 5];
      for (const T of [30, -30]) {
        const options = { rtol: 1e-7, atol: 1e-9, maxSteps: 3000, stop: (p: { y: number[] }) => !inside(p) };
        const points = dopri45(rhs, 0, start, T, options);
        paths.push(points.filter(inside).map((p): Pair => [p.y[0], p.y[1]]));
      }
    }
  }
  return paths;
}

/** The equilibria, Jacobians, nullclines, and some trajectories of x' = f(x, y), y' = g(x, y) in a window. */
export function analyzeNonlinear(fText: string, gText: string, win: Window = [-5, 5, -5, 5]): NonlinearResult {
  const [x0, x1, y0, y1] = win;
  if (![x0, x1, y0, y1].every(Number.isFinite) || !(x1 > x0) || !(y1 > y0)) throw new KitError('badRegion');
  const field = readField(fText, gText);
  const equilibria = findEquilibria(field, win);
  const steps: KitStep[] = [
    step('odeNonlinear', `x'=${latexOf(fText)},\\quad y'=${latexOf(gText)}`),
    step('odeFindEquilibria', undefined, { count: String(equilibria.length) }),
    step('odeJacobian', `J=${field.jacobianLatex}`),
  ];
  for (const e of equilibria) {
    const at = `(${fmt(e.x, 8)}, ${fmt(e.y, 8)})`;
    const rows = e.jacobian.map((r) => r.map((v) => fmt(v, 6)));
    steps.push(
      step('odeAtEquilibrium', matrixLatex(rows), {
        at,
        trace: fmt(e.classification.trace, 6),
        det: fmt(e.classification.det, 6),
        $kind: `kitMath.odes.kind.${e.classification.kind}`,
      }),
    );
    if (e.inconclusive) steps.push(step('odeInconclusive', undefined, { at }));
  }
  return {
    equilibria,
    jacobianLatex: field.jacobianLatex,
    nullclines: { f: marching((x, y) => field.f([x, y]), win), g: marching((x, y) => field.g([x, y]), win) },
    trajectories: trajectoriesOf(field, win),
    field: fieldSegments((x, y) => [field.f([x, y]), field.g([x, y])], win, 12),
    steps,
    window: win,
  };
}
