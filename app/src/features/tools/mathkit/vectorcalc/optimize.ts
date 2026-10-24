// Optimization of functions of several variables: critical points with the second-derivative test, and constrained
// extrema by Lagrange multipliers. Both solve the stationarity equations by Newton's method from a grid of starting
// points, with the derivatives found symbolically.
import { newtonSystem, type Mat } from '../dense';
import { fmt } from '../numeric';
import { line, numbers, type NumLine, type NumOut } from '../numerics/common';
import { KitError, step, type KitStep } from '../types';
import { checkNames, compiled, partial, tex, usedVariables } from './field';

interface Found {
  x: number[];
}

/** Adds a point unless a close one is already there. */
function addUnique(found: Found[], x: number[]): void {
  if (!found.some((f) => f.x.every((v, i) => Math.abs(v - x[i]) < 1e-6 * Math.max(1, Math.abs(v))))) found.push({ x });
}

function grid(ranges: readonly [number, number][], perAxis: number): number[][] {
  let points: number[][] = [[]];
  for (const [lo, hi] of ranges) {
    const axis = Array.from({ length: perAxis }, (_, k) => lo + ((hi - lo) * (k + 0.5)) / perAxis);
    points = points.flatMap((p) => axis.map((v) => [...p, v]));
  }
  return points;
}

function windowOf(text: string, count: number): [number, number][] {
  const w = numbers(text, 'window');
  if (w.length !== 2 * count || w.some((v, i) => i % 2 === 0 && v >= w[i + 1]))
    throw new KitError('vcWindow', String(2 * count));
  return Array.from({ length: count }, (_, i) => [w[2 * i], w[2 * i + 1]] as [number, number]);
}

const typeOf = (D: number, fxx: number): 'min' | 'max' | 'saddle' | 'unknown' => {
  if (Math.abs(D) < 1e-9) return 'unknown';
  if (D < 0) return 'saddle';
  return fxx > 0 ? 'min' : 'max';
};

export function criticalPoints(fText: string, windowText: string): NumOut {
  checkNames(fText, ['x', 'y']);
  const vars = usedVariables([fText], ['x', 'y']);
  if (vars.length === 0) throw new KitError('vcNoVariables');
  const [wx, wy] = windowOf(windowText, 2);
  const fx = partial(fText, 'x');
  const fy = partial(fText, 'y');
  const fxx = partial(fx, 'x');
  const fxy = partial(fx, 'y');
  const fyy = partial(fy, 'y');
  const F = compiled(fText, ['x', 'y']);
  const gx = compiled(fx, ['x', 'y']);
  const gy = compiled(fy, ['x', 'y']);
  const hxx = compiled(fxx, ['x', 'y']);
  const hxy = compiled(fxy, ['x', 'y']);
  const hyy = compiled(fyy, ['x', 'y']);
  const system = (v: readonly number[]) => [gx(v), gy(v)];
  const jacobian = (v: readonly number[]): Mat => [
    [hxx(v), hxy(v)],
    [hxy(v), hyy(v)],
  ];
  const found: Found[] = [];
  for (const start of grid([wx, wy], 9)) {
    const r = newtonSystem(system, start, { jacobian, tolerance: 1e-13, maxIterations: 40 });
    const inside = r.x[0] >= wx[0] - 1e-9 && r.x[0] <= wx[1] + 1e-9 && r.x[1] >= wy[0] - 1e-9 && r.x[1] <= wy[1] + 1e-9;
    if (r.converged && inside && Math.hypot(...system(r.x)) < 1e-8)
      addUnique(
        found,
        r.x.map((v) => (Math.abs(v) < 1e-12 ? 0 : v)),
      );
  }
  found.sort((p, q) => p.x[0] - q.x[0] || p.x[1] - q.x[1]);
  const rows = found.map(({ x }) => {
    const D = hxx(x) * hyy(x) - hxy(x) ** 2;
    return [fmt(x[0], 8), fmt(x[1], 8), fmt(F(x), 8), fmt(hxx(x), 6), fmt(D, 6), `@${typeOf(D, hxx(x))}`];
  });
  const lines: NumLine[] = [line(found.length ? 'vcCriticalCount' : 'vcCriticalNone', { n: String(found.length) })];
  const steps: KitStep[] = [
    step('vcPartials', `f_x=${tex(fx)},\\ f_y=${tex(fy)}`),
    step('vcCriticalSystem', 'f_x=0,\\ f_y=0'),
    step('vcHessian', `f_{xx}=${tex(fxx)},\\ f_{xy}=${tex(fxy)},\\ f_{yy}=${tex(fyy)}`),
    step('vcSecondTest', 'D=f_{xx}f_{yy}-f_{xy}^{2}'),
  ];
  return {
    lines,
    tables: [{ title: 'critical', columns: ['x', 'y', 'f', 'fxx', 'D', 'type'], rows }],
    plots: [],
    fields: [],
    steps,
    latex: `f_x=${tex(fx)},\\ f_y=${tex(fy)}`,
  };
}

export function lagrange(fText: string, gText: string, cText: string, windowText: string): NumOut {
  const order = ['x', 'y', 'z'];
  checkNames(fText, order);
  checkNames(gText, order);
  const vars = usedVariables([fText, gText], order);
  if (vars.length < 2) throw new KitError('vcLagrangeVariables');
  const c = numbers(cText, 'constraint value');
  if (c.length !== 1) throw new KitError('badNumber', 'constraint value');
  const ranges = windowOf(windowText, vars.length);
  const unknowns = [...vars, 'lambda'];
  const eqs = [...vars.map((v) => `(${partial(fText, v)}) - lambda*(${partial(gText, v)})`), `(${gText}) - (${c[0]})`];
  const residual = eqs.map((e) => compiled(e, unknowns));
  const J = eqs.map((e) => unknowns.map((u) => compiled(partial(e, u), unknowns)));
  const F = (v: readonly number[]) => residual.map((r) => r(v));
  const jac = (v: readonly number[]): Mat => J.map((row) => row.map((e) => e(v)));
  const f = compiled(fText, vars);
  const found: Found[] = [];
  const starts = grid(ranges, vars.length === 2 ? 9 : 5);
  for (const base of starts) {
    for (const lambda0 of [0, 1, -1]) {
      const r = newtonSystem(F, [...base, lambda0], { jacobian: jac, tolerance: 1e-13, maxIterations: 50 });
      const inside = ranges.every(([lo, hi], i) => r.x[i] >= lo - 1e-9 && r.x[i] <= hi + 1e-9);
      if (r.converged && inside && Math.hypot(...F(r.x)) < 1e-8)
        addUnique(
          found,
          r.x.map((v) => (Math.abs(v) < 1e-12 ? 0 : v)),
        );
    }
  }
  const values = found.map((p) => f(p.x.slice(0, vars.length)));
  const best = Math.max(...values);
  const worst = Math.min(...values);
  const label = (v: number) =>
    found.length < 2 || best - worst < 1e-9
      ? 'only'
      : Math.abs(v - best) < 1e-9
        ? 'max'
        : Math.abs(v - worst) < 1e-9
          ? 'min'
          : 'other';
  const rows = found
    .map((p, i) => ({ p, v: values[i] }))
    .sort((a, b) => b.v - a.v)
    .map(({ p, v }) => [
      ...p.x.slice(0, vars.length).map((x) => fmt(x, 8)),
      fmt(p.x[vars.length], 8),
      fmt(v, 8),
      `@${label(v)}`,
    ]);
  const lines: NumLine[] = found.length
    ? [line('vcLagrangeBest', { max: fmt(best, 10), min: fmt(worst, 10), n: String(found.length) })]
    : [line('vcLagrangeNone')];
  const steps: KitStep[] = [
    step('vcLagrangeSystem', `\\nabla f=\\lambda\\nabla g,\\quad g=${fmt(c[0])}`),
    step('vcLagrangeEquations', eqs.map((e) => `${tex(e)}=0`).join(',\\ ')),
    step('vcLagrangeCompare', 'f\\ \\text{at each candidate}'),
  ];
  return {
    lines,
    tables: [{ title: 'lagrange', columns: [...vars.map((v) => `~${v}`), 'lambda', 'f', 'type'], rows }],
    plots: [],
    fields: [],
    steps,
    ...(found.length ? { latex: `f_{\\max}=${fmt(best, 10)},\\ f_{\\min}=${fmt(worst, 10)}` } : {}),
  };
}
