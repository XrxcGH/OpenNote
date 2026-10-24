// Differential equations by marching and by grids: an initial value problem y' = f(t, y) by Euler, Heun, RK4,
// adaptive RK45, or backward Euler, and a linear boundary value problem by finite differences or by shooting.
import { readFunction } from '../expr';
import { dopri45, fixedSteps, type FixedMethod, type Point } from '../integrators';
import { fmt } from '../numeric';
import { KitError, step, type KitStep } from '../types';
import { line, type NumLine, type NumOut, type NumTable } from './common';

export type IvpMethod = FixedMethod | 'rk45';

const FORMULA: Record<IvpMethod, string> = {
  euler: 'y_{n+1}=y_n+h\\,f(t_n,y_n)',
  heun: 'y_{n+1}=y_n+\\frac{h}{2}\\left[f(t_n,y_n)+f(t_{n+1},\\,y_n+h f(t_n,y_n))\\right]',
  rk4: 'y_{n+1}=y_n+\\frac{h}{6}(k_1+2k_2+2k_3+k_4)',
  rk45: 'y_{n+1}=y_n+h\\sum b_i k_i,\\ \\text{with a fourth-order estimate to choose } h',
  'backward-euler': 'y_{n+1}=y_n+h\\,f(t_{n+1},y_{n+1})',
};

const ORDER: Record<IvpMethod, number> = { euler: 1, heun: 2, rk4: 4, rk45: 5, 'backward-euler': 1 };

export interface IvpResult extends NumOut {
  final: number;
  points: Point[];
  exactFinal: number | null;
}

/** The error at the end for h, h/2, h/4, and h/8, with the order it shows, when the exact solution is known. */
function ivpConvergence(
  method: IvpMethod,
  h: number,
  run: (hh: number) => Point[],
  exactAt: (t: number) => number | null,
): { table: NumTable; order: NumLine | null } {
  const hs = [h, h / 2, h / 4, h / 8];
  const finals = hs.map((hh) => {
    const pts = run(hh);
    return Math.abs(pts[pts.length - 1].y[0] - (exactAt(pts[pts.length - 1].t) as number));
  });
  const table: NumTable = {
    title: 'ivpConvergence',
    columns: ['h', 'error', 'order'],
    rows: hs.map((hh, i) => [
      fmt(hh, 6),
      fmt(finals[i], 3),
      i === 0 || finals[i] < 1e-14 || finals[i - 1] < 1e-14 ? '' : fmt(Math.log2(finals[i - 1] / finals[i]), 3),
    ]),
  };
  const observed = finals[2] > 1e-14 && finals[3] > 1e-14 ? Math.log2(finals[2] / finals[3]) : null;
  return {
    table,
    order: observed === null ? null : line('ivpOrder', { observed: fmt(observed, 3), expected: String(ORDER[method]) }),
  };
}

/** The method, the problem, the first step in full, and the result. */
function ivpSteps(options: { f: string; t0: number; y0: number; h: number; method: IvpMethod }, points: Point[]) {
  const { t0, y0, h, method } = options;
  const g = readFunction(options.f, ['t', 'y']);
  const last = points[points.length - 1];
  const final = last.y[0];
  const steps: KitStep[] = [
    step('numMethod', FORMULA[method], { $method: `kitMath.numerics.method.${method}` }),
    step('ivpSetup', `y'=${options.f.replace(/\*/g, '\\cdot ')},\\quad y(${fmt(t0)})=${fmt(y0)}`),
  ];
  if (method !== 'rk45' && points.length > 1) {
    const [p0, p1] = points;
    const slope = g([p0.t, p0.y[0]]);
    if (method === 'euler') {
      steps.push(step('ivpFirst', `y_1=${fmt(y0)}+${fmt(h)}\\cdot ${fmt(slope, 8)}=${fmt(p1.y[0], 10)}`));
    } else if (method === 'rk4') {
      const k1 = slope;
      const k2 = g([p0.t + h / 2, y0 + (h / 2) * k1]);
      const k3 = g([p0.t + h / 2, y0 + (h / 2) * k2]);
      const k4 = g([p0.t + h, y0 + h * k3]);
      steps.push(
        step('ivpFirst', `k_1=${fmt(k1, 8)},\\ k_2=${fmt(k2, 8)},\\ k_3=${fmt(k3, 8)},\\ k_4=${fmt(k4, 8)}`),
        step('ivpFirst', `y_1=${fmt(p1.y[0], 10)}`),
      );
    } else {
      steps.push(step('ivpFirst', `y_1=${fmt(p1.y[0], 10)}`));
    }
  }
  steps.push(step('numValue', `y(${fmt(last.t, 8)})\\approx${fmt(final, 10)}`));
  return steps;
}

export function solveIvp(options: {
  f: string;
  exact?: string;
  t0: number;
  y0: number;
  tEnd: number;
  h: number;
  method: IvpMethod;
}): IvpResult {
  const { t0, y0, tEnd, h, method } = options;
  if (t0 === tEnd) throw new KitError('emptyInterval');
  if (method !== 'rk45' && (!(h > 0) || !Number.isFinite(h))) throw new KitError('badStepSize');
  if (method !== 'rk45' && Math.abs(tEnd - t0) / h > 100000) throw new KitError('tooManySteps');
  const g = readFunction(options.f, ['t', 'y']);
  const rhs = (t: number, y: readonly number[]) => [g([t, y[0]])];
  if (!Number.isFinite(rhs(t0, [y0])[0])) throw new KitError('undefinedValue', `f(${fmt(t0)}, ${fmt(y0)})`);
  const exactFn = options.exact?.trim() ? readFunction(options.exact, ['t']) : null;
  const run = (hh: number): Point[] =>
    method === 'rk45'
      ? dopri45(rhs, t0, [y0], tEnd, { rtol: 1e-9, atol: 1e-12 })
      : fixedSteps(method, rhs, t0, [y0], tEnd, hh);
  const points = run(h);
  const last = points[points.length - 1];
  const final = last.y[0];
  if (!Number.isFinite(final)) throw new KitError('blewUp');
  const exactAt = (t: number) => (exactFn ? exactFn([t]) : null);
  const exactFinal = exactAt(last.t);
  const rows = points.slice(0, 60).map((p, i) => {
    const e = exactAt(p.t);
    return [String(i), fmt(p.t, 8), fmt(p.y[0], 10), ...(e === null ? [] : [fmt(e, 10), fmt(Math.abs(p.y[0] - e), 3)])];
  });
  const lines: NumLine[] = [
    line('ivpFinal', { t: fmt(last.t, 8), y: fmt(final, 10), steps: String(points.length - 1) }),
  ];
  const tables: NumTable[] = [
    {
      title: 'ivp',
      columns: ['n', 't', 'y', ...(exactFn ? ['exact', 'error'] : [])],
      rows,
    },
  ];
  if (points.length > 61) lines.push(line('tableTruncated', { shown: '60', total: String(points.length) }));
  if (exactFinal !== null) {
    lines.push(line('ivpError', { exact: fmt(exactFinal, 10), error: fmt(Math.abs(final - exactFinal), 3) }));
  }
  if (method !== 'rk45' && exactFinal !== null) {
    const study = ivpConvergence(method, h, run, exactAt);
    tables.push(study.table);
    if (study.order) lines.push(study.order);
  }
  const steps = ivpSteps(options, points);
  const curve: [number, number][] = points.map((p) => [p.t, p.y[0]]);
  const series: NumOut['plots'][number]['series'] = [
    { points: curve },
    { points: curve.slice(0, 80), dots: true, tone: 1 },
  ];
  const exactSeries: [number, number][] = exactFn
    ? Array.from({ length: 121 }, (_, k) => {
        const t = t0 + ((tEnd - t0) * k) / 120;
        return [t, exactFn([t])];
      })
    : [];
  return {
    lines,
    tables,
    plots: [{ label: 'ivp', series: exactFn ? [...series, { points: exactSeries, tone: 3, dashed: true }] : series }],
    fields: [],
    steps,
    latex: `y(${fmt(last.t, 8)})\\approx${fmt(final, 10)}`,
    final,
    points,
    exactFinal,
  };
}

/** A tridiagonal solve (Thomas algorithm) of sub, diag, sup rows. */
export function thomas(sub: number[], diag: number[], sup: number[], rhs: number[]): number[] {
  const n = diag.length;
  const c = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  if (diag[0] === 0) throw new KitError('singular');
  c[0] = sup[0] / diag[0];
  d[0] = rhs[0] / diag[0];
  for (let i = 1; i < n; i++) {
    const denom = diag[i] - sub[i] * c[i - 1];
    if (denom === 0) throw new KitError('singular');
    c[i] = sup[i] / denom;
    d[i] = (rhs[i] - sub[i] * d[i - 1]) / denom;
  }
  const x = new Array<number>(n).fill(0);
  x[n - 1] = d[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = d[i] - c[i] * x[i + 1];
  return x;
}

export interface BvpResult extends NumOut {
  x: number[];
  y: number[];
}

/** y'' + p(x) y' + q(x) y = r(x) with y(a) = alpha and y(b) = beta. */
export function solveBvp(options: {
  p: string;
  q: string;
  r: string;
  a: number;
  b: number;
  alpha: number;
  beta: number;
  n: number;
  method: 'difference' | 'shooting';
  exact?: string;
}): BvpResult {
  const { a, b, alpha, beta, n, method } = options;
  if (!(b > a)) throw new KitError('emptyInterval');
  if (!Number.isInteger(n) || n < 2 || n > 2000) throw new KitError('badWhole', 'n: 2 to 2000');
  const P = readFunction(options.p, ['x']);
  const Q = readFunction(options.q, ['x']);
  const Rf = readFunction(options.r, ['x']);
  const h = (b - a) / n;
  const xs = Array.from({ length: n + 1 }, (_, i) => a + i * h);
  let ys: number[];
  const steps: KitStep[] = [];
  if (method === 'difference') {
    // Central differences: (y[i-1] - 2 y[i] + y[i+1]) / h^2 + p (y[i+1] - y[i-1]) / (2h) + q y[i] = r.
    const m = n - 1;
    const sub = new Array<number>(m).fill(0);
    const diag = new Array<number>(m).fill(0);
    const sup = new Array<number>(m).fill(0);
    const rhs = new Array<number>(m).fill(0);
    for (let i = 1; i <= m; i++) {
      const x = xs[i];
      const lower = 1 / (h * h) - P([x]) / (2 * h);
      const upper = 1 / (h * h) + P([x]) / (2 * h);
      diag[i - 1] = -2 / (h * h) + Q([x]);
      sub[i - 1] = lower;
      sup[i - 1] = upper;
      rhs[i - 1] = Rf([x]);
      if (i === 1) rhs[0] -= lower * alpha;
      if (i === m) rhs[m - 1] -= upper * beta;
    }
    const inner = thomas(sub, diag, sup, rhs);
    ys = [alpha, ...inner, beta];
    steps.push(
      step('numMethod', '\\frac{y_{i-1}-2y_i+y_{i+1}}{h^2}+p_i\\frac{y_{i+1}-y_{i-1}}{2h}+q_i y_i=r_i', {
        $method: 'kitMath.numerics.method.bvpDifference',
      }),
      step('bvpGrid', `h=\\frac{${fmt(b)}-${fmt(a)}}{${n}}=${fmt(h, 8)}`),
    );
  } else {
    // The problem is linear, so y = u + s v where u solves it with y'(a) = 0 and v solves the homogeneous problem with
    // v'(a) = 1; s is chosen so y(b) = beta.
    const march = (slope: number, homogeneous: boolean) => {
      const f = (x: number, y: readonly number[]) => [
        y[1],
        (homogeneous ? 0 : Rf([x])) - P([x]) * y[1] - Q([x]) * y[0],
      ];
      return fixedSteps('rk4', f, a, [homogeneous ? 0 : alpha, slope], b, h);
    };
    const u = march(0, false);
    const v = march(1, true);
    const vEnd = v[v.length - 1].y[0];
    if (Math.abs(vEnd) < 1e-14) throw new KitError('shootingFails');
    const s = (beta - u[u.length - 1].y[0]) / vEnd;
    ys = u.map((pt, i) => pt.y[0] + s * v[i].y[0]);
    steps.push(
      step('numMethod', "y''=r-p\\,y'-q\\,y,\\quad y(a)=\\alpha,\\ y'(a)=s", {
        $method: 'kitMath.numerics.method.shooting',
      }),
      step('bvpShoot', `s=\\frac{\\beta-u(b)}{v(b)}=${fmt(s, 10)}`),
    );
  }
  const exactFn = options.exact?.trim() ? readFunction(options.exact, ['x']) : null;
  const maxError = exactFn ? Math.max(...xs.map((x, i) => Math.abs(ys[i] - exactFn([x])))) : null;
  const lines: NumLine[] = [line('bvpMid', { x: fmt(xs[Math.floor(n / 2)], 8), y: fmt(ys[Math.floor(n / 2)], 10) })];
  if (maxError !== null) lines.push(line('bvpError', { error: fmt(maxError, 3) }));
  const stride = Math.max(1, Math.ceil(xs.length / 20));
  const rows = xs
    .map((x, i) => [x, ys[i], i] as const)
    .filter(([, , i]) => i % stride === 0 || i === n)
    .map(([x, y]) => [
      fmt(x, 8),
      fmt(y, 10),
      ...(exactFn ? [fmt(exactFn([x]), 10), fmt(Math.abs(y - exactFn([x])), 3)] : []),
    ]);
  steps.push(step('numValue', `y(${fmt(xs[Math.floor(n / 2)], 6)})\\approx${fmt(ys[Math.floor(n / 2)], 10)}`));
  return {
    lines,
    tables: [{ title: 'bvp', columns: ['x', 'y', ...(exactFn ? ['exact', 'error'] : [])], rows }],
    plots: [
      {
        label: 'bvp',
        series: [
          { points: xs.map((x, i): [number, number] => [x, ys[i]]) },
          ...(exactFn ? [{ points: xs.map((x): [number, number] => [x, exactFn([x])]), tone: 3, dashed: true }] : []),
        ],
      },
    ],
    fields: [],
    steps,
    x: xs,
    y: ys,
  };
}
