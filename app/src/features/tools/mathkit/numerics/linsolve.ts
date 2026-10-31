// Systems of equations by iteration: Jacobi, Gauss-Seidel and SOR for linear systems, and Newton's method for
// nonlinear ones with the Jacobian written out.
import { newtonSystem, solveDense, type Mat } from '../dense';
import { spectralRadius } from '../eigen';
import { compile, derivative, namesIn, read, show } from '../expr';
import { fmt } from '../numeric';
import { KitError, step, type KitStep } from '../types';
import { line, numbers, rowsOf, type NumLine, type NumOut } from './common';

export type IterMethod = 'jacobi' | 'gauss-seidel' | 'sor';

const FORMULA: Record<IterMethod, string> = {
  jacobi: 'x_i^{(k+1)}=\\frac{1}{a_{ii}}\\left(b_i-\\sum_{j\\ne i}a_{ij}x_j^{(k)}\\right)',
  'gauss-seidel':
    'x_i^{(k+1)}=\\frac{1}{a_{ii}}\\left(b_i-\\sum_{j<i}a_{ij}x_j^{(k+1)}-\\sum_{j>i}a_{ij}x_j^{(k)}\\right)',
  sor: 'x_i^{(k+1)}=(1-\\omega)x_i^{(k)}+\\frac{\\omega}{a_{ii}}\\left(b_i-\\sum_{j<i}a_{ij}x_j^{(k+1)}-\\sum_{j>i}a_{ij}x_j^{(k)}\\right)',
};

/** The matrix that maps one iterate's error to the next: its spectral radius decides convergence. */
export function iterationMatrix(A: Mat, method: IterMethod, omega: number): Mat {
  const n = A.length;
  const D = A.map((row, i) => row.map((v, j) => (i === j ? v : 0)));
  const L = A.map((row, i) => row.map((v, j) => (j < i ? -v : 0)));
  const U = A.map((row, i) => row.map((v, j) => (j > i ? -v : 0)));
  const inverse = (M: Mat): Mat => {
    const columns = Array.from({ length: n }, (_, j) =>
      solveDense(
        M,
        Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)),
      ),
    );
    if (columns.some((c) => c === null)) throw new KitError('singular');
    return Array.from({ length: n }, (_, i) => columns.map((c) => (c as number[])[i]));
  };
  const mul = (X: Mat, Y: Mat): Mat => X.map((row) => Y[0].map((_, j) => row.reduce((s, v, k) => s + v * Y[k][j], 0)));
  if (method === 'jacobi')
    return mul(
      inverse(D),
      L.map((row, i) => row.map((v, j) => v + U[i][j])),
    );
  if (method === 'gauss-seidel') return mul(inverse(D.map((row, i) => row.map((v, j) => v - L[i][j]))), U);
  const left = D.map((row, i) => row.map((v, j) => v / omega - L[i][j]));
  const right = D.map((row, i) => row.map((v, j) => ((1 - omega) / omega) * v + U[i][j]));
  return mul(inverse(left), right);
}

export interface IterResult extends NumOut {
  x: number[];
  iterations: number;
  converged: boolean;
  radius: number;
  exact: number[] | null;
}

export function iterativeSolve(options: {
  A: string;
  b: string;
  x0?: string;
  method: IterMethod;
  omega: number;
  tolerance: number;
  maxIterations: number;
}): IterResult {
  const A = rowsOf(options.A, 'A');
  const b = numbers(options.b, 'b');
  const n = A.length;
  if (A.some((row) => row.length !== n) || b.length !== n) throw new KitError('badShape');
  if (n > 12) throw new KitError('tooLarge', '12');
  if (A.some((row, i) => row[i] === 0)) throw new KitError('zeroDiagonal');
  if (options.method === 'sor' && !(options.omega > 0 && options.omega < 2)) throw new KitError('badOmega');
  const omega = options.method === 'sor' ? options.omega : 1;
  let x = options.x0?.trim() ? numbers(options.x0, 'x0') : new Array<number>(n).fill(0);
  if (x.length !== n) throw new KitError('badShape');
  const exact = solveDense(A, b);
  const dominant = A.every((row, i) => Math.abs(row[i]) > row.reduce((s, v, j) => (j === i ? s : s + Math.abs(v)), 0));
  const radius = spectralRadius(iterationMatrix(A, options.method, omega));
  const residual = (v: number[]) =>
    Math.max(...A.map((row, i) => Math.abs(b[i] - row.reduce((s, a, j) => s + a * v[j], 0))));
  const rows: string[][] = [['0', ...x.map((v) => fmt(v, 8)), fmt(residual(x), 3)]];
  const history: [number, number][] = [[0, residual(x)]];
  let iterations = 0;
  let converged = false;
  for (let k = 1; k <= options.maxIterations; k++) {
    const next = x.slice();
    for (let i = 0; i < n; i++) {
      const source = options.method === 'jacobi' ? x : next;
      let s = b[i];
      for (let j = 0; j < n; j++) if (j !== i) s -= A[i][j] * source[j];
      const updated = s / A[i][i];
      next[i] = options.method === 'sor' ? (1 - omega) * x[i] + omega * updated : updated;
    }
    const change = Math.max(...next.map((v, i) => Math.abs(v - x[i])));
    x = next;
    iterations = k;
    const r = residual(x);
    if (k <= 25 || k % Math.ceil(options.maxIterations / 25) === 0)
      rows.push([String(k), ...x.map((v) => fmt(v, 8)), fmt(r, 3)]);
    history.push([k, Math.max(r, 1e-300)]);
    if (!Number.isFinite(r) || r > 1e150) break;
    if (change < options.tolerance && r < Math.max(options.tolerance * 10, 1e-300) * Math.max(1, ...b.map(Math.abs))) {
      converged = true;
      break;
    }
  }
  const lines: NumLine[] = [
    converged
      ? line('iterConverged', { k: String(iterations), x: x.map((v) => fmt(v, 8)).join(', ') })
      : line('iterNot', { k: String(iterations) }),
    line('iterRadius', { radius: fmt(radius, 5), verdict: radius < 1 ? 'yes' : 'no' }),
    line(dominant ? 'iterDominant' : 'iterNotDominant'),
  ];
  if (exact) lines.push(line('iterExact', { x: exact.map((v) => fmt(v, 8)).join(', ') }));
  const steps: KitStep[] = [
    step('numMethod', FORMULA[options.method], { $method: `kitMath.numerics.method.${options.method}` }),
    step('iterRate', `\\rho(T)=${fmt(radius, 5)}`),
  ];
  if (rows.length > 1) {
    steps.push(step('ivpFirst', `x^{(1)}=\\left(${rows[1].slice(1, 1 + n).join(',\\ ')}\\right)`));
  }
  return {
    lines,
    tables: [
      { title: 'iterations', columns: ['k', ...Array.from({ length: n }, (_, i) => `~x${i + 1}`), 'residual'], rows },
    ],
    plots: [{ label: 'iterResidual', logy: true, series: [{ points: history }] }],
    fields: [],
    steps,
    latex: `x\\approx\\left(${x.map((v) => fmt(v, 8)).join(',\\ ')}\\right)`,
    x,
    iterations,
    converged,
    radius,
    exact,
  };
}

export interface NewtonOut extends NumOut {
  root: number[];
  converged: boolean;
}

/** Newton's method for equations "left = right" (one per line) in the named unknowns, from a starting guess. */
export function newtonSolve(options: {
  equations: string;
  unknowns: string;
  start: string;
  tolerance: number;
}): NewtonOut {
  const names = options.unknowns
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const eqs = options.equations
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (names.length === 0 || names.length > 6 || eqs.length !== names.length)
    throw new KitError('badSystem', `${eqs.length}/${names.length}`);
  const x0 = numbers(options.start, 'start');
  if (x0.length !== names.length) throw new KitError('badSystem', `${x0.length}/${names.length}`);
  const trees = eqs.map((text) => {
    const parts = text.split('=');
    if (parts.length > 2) throw new KitError('unreadable', text);
    return read(parts.length === 2 ? `(${parts[0]}) - (${parts[1]})` : parts[0]);
  });
  // Every name must be one of the unknowns.
  for (const tree of trees) {
    const bad = [...namesIn(tree)].find((name) => !names.includes(name));
    if (bad) throw new KitError('unknown-name', bad);
  }
  const fns = trees.map((tree) => compile(tree, names));
  const F = (v: readonly number[]) => fns.map((fn) => fn(v));
  // The Jacobian by symbolic differentiation.
  const partials = trees.map((tree) => names.map((name) => derivative(tree, name)));
  const J = partials.map((row) => row.map((d) => compile(d, names)));
  const exactJ = (v: readonly number[]) => J.map((row) => row.map((fn) => fn(v)));
  if (!F(x0).every(Number.isFinite)) throw new KitError('undefinedValue', 'F');
  const result = newtonSystem(F, x0, { jacobian: exactJ, tolerance: options.tolerance, maxIterations: 60 });
  const rows = result.history.map((h, i) => {
    const prev = result.history[i - 1];
    return [
      String(h.iteration),
      ...h.x.map((v) => fmt(v, 10)),
      fmt(h.residual, 3),
      prev && prev.residual > 0 && h.residual > 0 ? fmt(Math.log(h.residual) / Math.log(prev.residual), 3) : '',
    ];
  });
  const lines: NumLine[] = [
    result.converged
      ? line('newtonRoot', {
          root: result.x.map((v, i) => `${names[i]} = ${fmt(v, 10)}`).join(', '),
          k: String(result.history.length - 1),
        })
      : line('newtonFail'),
  ];
  const jacobianLatex = `J=\\begin{pmatrix}${partials
    .map((row) => row.map((d) => show(d).replace(/\*/g, '\\cdot ')).join(' & '))
    .join(' \\\\ ')}\\end{pmatrix}`;
  const steps: KitStep[] = [
    step('numMethod', 'J(x^{(k)})\\,\\delta=-F(x^{(k)}),\\quad x^{(k+1)}=x^{(k)}+\\delta', {
      $method: 'kitMath.numerics.method.newtonSystem',
    }),
    step('newtonJacobian', jacobianLatex),
  ];
  if (result.history.length > 1) {
    steps.push(step('ivpFirst', `x^{(1)}=\\left(${result.history[1].x.map((v) => fmt(v, 10)).join(',\\ ')}\\right)`));
  }
  return {
    lines,
    tables: [{ title: 'newton', columns: ['k', ...names.map((n) => `~${n}`), 'residual', 'rate'], rows }],
    plots: [
      {
        label: 'iterResidual',
        logy: true,
        series: [{ points: result.history.map((h): [number, number] => [h.iteration, Math.max(h.residual, 1e-300)]) }],
      },
    ],
    fields: [],
    steps,
    latex: result.converged ? result.x.map((v, i) => `${names[i]}=${fmt(v, 10)}`).join(',\\ ') : undefined,
    root: result.x,
    converged: result.converged,
  };
}
