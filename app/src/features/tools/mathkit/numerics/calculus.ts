// Numerical differentiation (finite differences and Richardson extrapolation) and numerical integration (the
// Riemann sums, trapezoid, Simpson, Romberg, and Gauss-Legendre rules) with the error against a reference value.
import { derivative, namesIn, read, readFunction, show, compile } from '../expr';
import { fmt, gaussLegendre, integrate } from '../numeric';
import { KitError, step, type KitStep } from '../types';
import { line, type NumLine, type NumOut, type NumTable } from './common';

/** The exact derivative at x0 by symbolic differentiation, or null when the rules cannot differentiate it. */
function exactDerivative(source: string, x0: number, order: 1 | 2): number | null {
  try {
    const node = read(source);
    if (![...namesIn(node)].every((name) => name === 'x')) return null;
    let d = derivative(node, 'x');
    if (order === 2) d = derivative(d, 'x');
    const value = compile(d, ['x'])([x0]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export interface DiffResult extends NumOut {
  best: number;
  exact: number | null;
}

/** The four finite-difference formulas for each step size. */
function stencils(F: (x: number) => number, x0: number, hs: readonly number[], order: 1 | 2) {
  const central = hs.map((s) =>
    order === 1 ? (F(x0 + s) - F(x0 - s)) / (2 * s) : (F(x0 + s) - 2 * F(x0) + F(x0 - s)) / (s * s),
  );
  const forward = hs.map((s) =>
    order === 1 ? (F(x0 + s) - F(x0)) / s : (F(x0 + 2 * s) - 2 * F(x0 + s) + F(x0)) / (s * s),
  );
  const backward = hs.map((s) =>
    order === 1 ? (F(x0) - F(x0 - s)) / s : (F(x0) - 2 * F(x0 - s) + F(x0 - 2 * s)) / (s * s),
  );
  const five = hs.map((s) =>
    order === 1
      ? (-F(x0 + 2 * s) + 8 * F(x0 + s) - 8 * F(x0 - s) + F(x0 - 2 * s)) / (12 * s)
      : (-F(x0 + 2 * s) + 16 * F(x0 + s) - 30 * F(x0) + 16 * F(x0 - s) - F(x0 - 2 * s)) / (12 * s * s),
  );
  return { central, forward, backward, five };
}

/** The Richardson table built on the central difference: the best estimate and the table to show. */
function richardsonTable(central: readonly number[], hs: readonly number[], levels: number) {
  const R: number[][] = central.map((v) => [v]);
  for (let k = 1; k < levels; k++) {
    for (let j = 1; j <= k; j++) R[k][j] = (4 ** j * R[k][j - 1] - R[k - 1][j - 1]) / (4 ** j - 1);
  }
  const best = R[levels - 1][levels - 1];
  const richardson: NumTable = {
    title: 'richardson',
    columns: ['h', ...Array.from({ length: levels }, (_, j) => (j === 0 ? 'central' : `~R${j}`))],
    rows: R.map((row, k) => [
      fmt(hs[k], 6),
      ...row.map((v) => fmt(v, 10)),
      ...new Array<string>(levels - row.length).fill(''),
    ]),
  };
  return { best, richardson };
}

/** The method, the Richardson rule, the result, and the exact derivative when it is known. */
function diffSteps(source: string, x0: number, order: 1 | 2, best: number, exact: number | null): KitStep[] {
  const steps: KitStep[] =
    order === 1
      ? [
          step(
            'numMethod',
            "f'(x)\\approx\\frac{f(x+h)-f(x)}{h}\\ (\\text{forward}),\\ \\frac{f(x+h)-f(x-h)}{2h}\\ (\\text{central})",
            {
              $method: 'kitMath.numerics.method.finiteDifference',
            },
          ),
          step('numMethod', "f'(x)\\approx\\frac{-f(x+2h)+8f(x+h)-8f(x-h)+f(x-2h)}{12h}", {
            $method: 'kitMath.numerics.method.fivePoint',
          }),
        ]
      : [
          step('numMethod', "f''(x)\\approx\\frac{f(x+h)-2f(x)+f(x-h)}{h^{2}}", {
            $method: 'kitMath.numerics.method.finiteDifference',
          }),
        ];
  steps.push(
    step('richardsonRule', 'R_{k,j}=\\frac{4^{j}R_{k,j-1}-R_{k-1,j-1}}{4^{j}-1}'),
    step('numValue', `${order === 1 ? "f'" : "f''"}(${fmt(x0)})\\approx${fmt(best, 10)}`),
  );
  if (exact !== null) {
    steps.push(
      step(
        'exactDerivative',
        show(order === 1 ? derivative(read(source), 'x') : derivative(derivative(read(source), 'x'), 'x')).replace(
          /\*/g,
          '\\cdot ',
        ),
        { value: fmt(exact, 10) },
      ),
    );
  }
  return steps;
}

/** f'(x0) by forward, backward, central, and five-point formulas for h, h/2, h/4 ..., then Richardson extrapolation. */
export function differentiate(source: string, x0: number, h: number, order: 1 | 2 = 1): DiffResult {
  if (!(h > 0) || !Number.isFinite(h)) throw new KitError('badStepSize');
  const f = readFunction(source, ['x']);
  if (!Number.isFinite(f([x0]))) throw new KitError('undefinedValue', `f(${fmt(x0)})`);
  const exact = exactDerivative(source, x0, order);
  const levels = 6;
  const hs = Array.from({ length: levels }, (_, k) => h / 2 ** k);
  const F = (x: number) => f([x]);
  const { central, forward, backward, five } = stencils(F, x0, hs, order);
  const err = (v: number) => (exact === null ? '' : fmt(Math.abs(v - exact), 3));
  const rows = hs.map((s, k) => [
    fmt(s, 6),
    fmt(forward[k], 10),
    fmt(backward[k], 10),
    fmt(central[k], 10),
    fmt(five[k], 10),
    err(central[k]),
  ]);
  // Richardson: R[k][j] = (4^j R[k][j-1] - R[k-1][j-1]) / (4^j - 1), starting from the central difference.
  const { best, richardson } = richardsonTable(central, hs, levels);
  const lines: NumLine[] = [line(order === 1 ? 'diffBest' : 'diffBest2', { x: fmt(x0), value: fmt(best, 10) })];
  if (exact !== null) lines.push(line('diffExact', { exact: fmt(exact, 10), error: fmt(Math.abs(best - exact), 3) }));
  // The observed order of the central formula from the last two step sizes.
  const e = central.map((v) => (exact === null ? NaN : Math.abs(v - exact)));
  if (exact !== null && e[3] > 1e-13 && e[4] > 1e-13) {
    lines.push(line('diffOrder', { order: fmt(Math.log2(e[3] / e[4]), 3) }));
  }
  const steps = diffSteps(source, x0, order, best, exact);
  return {
    lines,
    tables: [
      { title: 'differences', columns: ['h', 'forward', 'backward', 'central', 'fivePoint', 'errorCentral'], rows },
      richardson,
    ],
    plots: [
      {
        label: 'diffError',
        logx: true,
        logy: true,
        series:
          exact === null
            ? []
            : [
                { points: hs.map((s, k): [number, number] => [s, Math.max(Math.abs(central[k] - exact), 1e-17)]) },
                {
                  points: hs.map((s, k): [number, number] => [s, Math.max(Math.abs(forward[k] - exact), 1e-17)]),
                  tone: 1,
                },
                {
                  points: hs.map((s, k): [number, number] => [s, Math.max(Math.abs(five[k] - exact), 1e-17)]),
                  tone: 2,
                },
              ],
      },
    ].filter((plot) => plot.series.length > 0),
    fields: [],
    steps,
    best,
    exact,
  };
}

export type QuadMethod = 'left' | 'right' | 'midpoint' | 'trapezoid' | 'simpson' | 'romberg' | 'gauss';

/** One composite rule with n panels (n points for Gauss-Legendre) on [a, b]. */
export function composite(
  method: Exclude<QuadMethod, 'romberg'>,
  f: (x: number) => number,
  a: number,
  b: number,
  n: number,
): number {
  const h = (b - a) / n;
  if (method === 'left') {
    let s = 0;
    for (let i = 0; i < n; i++) s += f(a + i * h);
    return s * h;
  }
  if (method === 'right') {
    let s = 0;
    for (let i = 1; i <= n; i++) s += f(a + i * h);
    return s * h;
  }
  if (method === 'midpoint') {
    let s = 0;
    for (let i = 0; i < n; i++) s += f(a + (i + 0.5) * h);
    return s * h;
  }
  if (method === 'trapezoid') {
    let s = (f(a) + f(b)) / 2;
    for (let i = 1; i < n; i++) s += f(a + i * h);
    return s * h;
  }
  if (method === 'simpson') {
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
    return (s * h) / 3;
  }
  const { x, w } = gaussLegendre(n);
  const mid = (a + b) / 2;
  const half = (b - a) / 2;
  return half * x.reduce((s, xi, i) => s + w[i] * f(mid + half * xi), 0);
}

/** The Romberg table: row k starts from the trapezoid rule with 2^k panels. */
export function rombergTable(f: (x: number) => number, a: number, b: number, levels: number): number[][] {
  const R: number[][] = [];
  for (let k = 0; k < levels; k++) {
    const row: number[] = [composite('trapezoid', f, a, b, 2 ** k)];
    for (let j = 1; j <= k; j++) row.push((4 ** j * row[j - 1] - R[k - 1][j - 1]) / (4 ** j - 1));
    R.push(row);
  }
  return R;
}

const FORMULA: Record<QuadMethod, string> = {
  left: '\\int_a^b f\\,dx\\approx h\\sum_{i=0}^{n-1} f(x_i)',
  right: '\\int_a^b f\\,dx\\approx h\\sum_{i=1}^{n} f(x_i)',
  midpoint: '\\int_a^b f\\,dx\\approx h\\sum_{i=0}^{n-1} f\\left(\\frac{x_i+x_{i+1}}{2}\\right)',
  trapezoid: '\\int_a^b f\\,dx\\approx h\\left[\\frac{f(x_0)+f(x_n)}{2}+\\sum_{i=1}^{n-1} f(x_i)\\right]',
  simpson: '\\int_a^b f\\,dx\\approx\\frac{h}{3}\\left[f(x_0)+4f(x_1)+2f(x_2)+\\cdots+4f(x_{n-1})+f(x_n)\\right]',
  romberg: 'R_{k,j}=\\frac{4^{j}R_{k,j-1}-R_{k-1,j-1}}{4^{j}-1}',
  gauss:
    '\\int_a^b f\\,dx\\approx\\frac{b-a}{2}\\sum_{i=1}^{n} w_i\\, f\\left(\\frac{a+b}{2}+\\frac{b-a}{2}t_i\\right)',
};

/** The order of accuracy each rule has for a smooth function, to compare with the observed order. */
const ORDER: Record<QuadMethod, number> = {
  left: 1,
  right: 1,
  midpoint: 2,
  trapezoid: 2,
  simpson: 4,
  romberg: 0,
  gauss: 0,
};

export interface QuadResult extends NumOut {
  value: number;
  reference: number;
}

export function quadrature(source: string, a: number, b: number, n: number, method: QuadMethod): QuadResult {
  if (a === b) throw new KitError('emptyInterval');
  const g = readFunction(source, ['x']);
  const f = (x: number) => g([x]);
  for (const x of [a, (a + b) / 2, b]) if (!Number.isFinite(f(x))) throw new KitError('undefinedValue', `f(${fmt(x)})`);
  if (method === 'simpson' && n % 2 !== 0) throw new KitError('needEven');
  if (method === 'gauss' && (n < 1 || n > 12)) throw new KitError('badWhole', 'n: 1 to 12');
  if (method === 'romberg' && (n < 1 || n > 12)) throw new KitError('badWhole', 'n: 1 to 12');
  if (method !== 'romberg' && method !== 'gauss' && (n < 1 || n > 100000))
    throw new KitError('badWhole', 'n: 1 to 100000');
  const reference = integrate(f, a, b);
  const lines: NumLine[] = [];
  const tables: NumTable[] = [];
  const steps: KitStep[] = [step('numMethod', FORMULA[method], { $method: `kitMath.numerics.method.${method}` })];
  let value: number;
  let latex: string;
  if (method === 'romberg') {
    const R = rombergTable(f, a, b, n);
    value = R[n - 1][n - 1];
    tables.push({
      title: 'romberg',
      columns: ['~k', ...R.map((_, j) => (j === 0 ? 'trapezoid' : `~R${j}`))],
      rows: R.map((row, k) => [
        String(k),
        ...row.map((v) => fmt(v, 11)),
        ...new Array<string>(n - row.length).fill(''),
      ]),
    });
    latex = `R_{${n - 1},${n - 1}}=${fmt(value, 11)}`;
  } else {
    value = composite(method, f, a, b, n);
    if (method === 'gauss') {
      const { x, w } = gaussLegendre(n);
      tables.push({
        title: 'gaussNodes',
        columns: ['i', 'node', 'weight'],
        rows: x.map((xi, i) => [String(i + 1), fmt(xi, 10), fmt(w[i], 10)]),
      });
    } else {
      const h = (b - a) / n;
      steps.push(step('quadStep', `h=\\frac{b-a}{n}=\\frac{${fmt(b)}-${fmt(a)}}{${n}}=${fmt(h, 8)}`));
      const shown = Math.min(n, 12);
      tables.push({
        title: 'nodes',
        columns: ['i', 'xi', 'fxi'],
        rows: Array.from({ length: method === 'midpoint' ? shown : Math.min(n + 1, shown + 1) }, (_, i) => {
          const x = method === 'midpoint' ? a + (i + 0.5) * h : a + i * h;
          return [String(i), fmt(x, 8), fmt(f(x), 10)];
        }),
      });
    }
    latex = `\\int_{${fmt(a)}}^{${fmt(b)}} f\\,dx\\approx ${fmt(value, 10)}`;
  }
  lines.push(line('quadValue', { value: fmt(value, 10) }));
  lines.push(line('quadError', { reference: fmt(reference, 12), error: fmt(Math.abs(value - reference), 3) }));
  steps.push(step('numValue', latex));
  // How the error falls as the rule is refined.
  const plots: NumOut['plots'][number][] = [];
  if (method !== 'romberg' && method !== 'gauss') {
    const ns = [1, 2, 3, 4, 5, 6].map(
      (k) => (method === 'simpson' ? 2 : 1) * 2 ** (k - 1) * Math.max(1, Math.floor(n / 2 ** 2)),
    );
    const errors = ns.map((m) => Math.abs(composite(method, f, a, b, m) - reference));
    const rows = ns.map((m, i) => [
      String(m),
      fmt(composite(method, f, a, b, m), 11),
      fmt(errors[i], 3),
      i === 0 || errors[i] < 1e-14 || errors[i - 1] < 1e-14 ? '' : fmt(Math.log2(errors[i - 1] / errors[i]), 3),
    ]);
    tables.push({ title: 'convergence', columns: ['n', 'value', 'error', 'order'], rows });
    plots.push({
      label: 'quadError',
      logx: true,
      logy: true,
      series: [{ points: ns.map((m, i): [number, number] => [m, Math.max(errors[i], 1e-17)]) }],
    });
    const used = errors.filter((e) => e > 1e-14);
    if (used.length >= 3) {
      const observed = Math.log2(used[used.length - 2] / used[used.length - 1]);
      lines.push(line('quadOrder', { observed: fmt(observed, 3), expected: String(ORDER[method]) }));
    }
  } else if (method === 'gauss') {
    const ks = Array.from({ length: Math.min(8, 12) }, (_, i) => i + 1);
    const errors = ks.map((k) => Math.abs(composite('gauss', f, a, b, k) - reference));
    tables.push({
      title: 'convergence',
      columns: ['~points', 'value', 'error'],
      rows: ks.map((k, i) => [String(k), fmt(composite('gauss', f, a, b, k), 12), fmt(errors[i], 3)]),
    });
    lines.push(line('gaussExact', { degree: String(2 * n - 1) }));
  }
  return { lines, tables, plots, fields: [], steps, latex, value, reference };
}
