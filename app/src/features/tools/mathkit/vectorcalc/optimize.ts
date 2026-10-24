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

/**
 * Merges roots that are one point seen from different starts. A root-finding iteration converges only linearly to a
 * degenerate critical point (x^4 + y^4 at the origin), so its starts end up scattered over a small neighborhood; roots
 * within `tolerance` of each other are one, represented by the one where the gradient is smallest. Tiny coordinates
 * are snapped to 0.
 */
function cluster(found: Found[], tolerance: number, size: (x: number[]) => number): Found[] {
  const groups: Found[][] = [];
  for (const root of found) {
    const group = groups.find((g) => g.some((m) => Math.hypot(...m.x.map((v, i) => v - root.x[i])) < tolerance));
    if (group) group.push(root);
    else groups.push([root]);
  }
  return groups.map((g) => {
    const best = g.reduce((a, b) => (size(b.x) < size(a.x) ? b : a));
    return { x: best.x.map((v) => (Math.abs(v) < tolerance ? 0 : v)) };
  });
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
  if (usedVariables([fText], ['x', 'y', 'z']).includes('z')) throw new KitError('vcTwoVariables');
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
  const raw: Found[] = [];
  for (const start of grid([wx, wy], 9)) {
    const r = newtonSystem(system, start, { jacobian, tolerance: 1e-13, maxIterations: 40 });
    const inside = r.x[0] >= wx[0] - 1e-9 && r.x[0] <= wx[1] + 1e-9 && r.x[1] >= wy[0] - 1e-9 && r.x[1] <= wy[1] + 1e-9;
    if (r.converged && inside && Math.hypot(...system(r.x)) < 1e-8) addUnique(raw, r.x);
  }
  const width = Math.max(wx[1] - wx[0], wy[1] - wy[0]);
  const found = cluster(raw, 1e-4 * width, (x) => Math.hypot(...system(x)));
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

/** Whether g = c stays in a bounded set: g - c keeps one sign on a very large sphere in every direction. */
function constraintBounded(
  g: (v: readonly number[]) => number,
  c: number,
  ranges: readonly [number, number][],
): boolean {
  const center = ranges.map(([lo, hi]) => (lo + hi) / 2);
  const reach = 1e3 * (1 + Math.hypot(...ranges.map(([lo, hi]) => hi - lo)) + Math.hypot(...center));
  const dirs: number[][] =
    ranges.length === 2
      ? Array.from({ length: 360 }, (_, k) => [Math.cos((k * Math.PI) / 180), Math.sin((k * Math.PI) / 180)])
      : Array.from({ length: 600 }, (_, k) => {
          const z = 1 - (2 * (k + 0.5)) / 600;
          const r = Math.sqrt(1 - z * z);
          const a = k * Math.PI * (3 - Math.sqrt(5));
          return [r * Math.cos(a), r * Math.sin(a), z];
        });
  const signs = dirs.map((d) => Math.sign(g(center.map((v, i) => v + reach * d[i])) - c));
  return signs.every((s) => s === signs[0] && s !== 0 && Number.isFinite(s));
}

const cross3 = (a: number[], b: number[]): number[] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The second-order test on the tangent space of the constraint: the Hessian of the Lagrangian restricted to it. */
function localKind(gradient: number[], L: number[][]): 'min' | 'max' | 'saddle' | 'unknown' {
  const len = Math.hypot(...gradient);
  if (!(len > 1e-9)) return 'unknown';
  const g = gradient.map((v) => v / len);
  let basis: number[][];
  if (g.length === 2) basis = [[-g[1], g[0]]];
  else {
    const axis = [0, 1, 2].reduce((a, b) => (Math.abs(g[b]) < Math.abs(g[a]) ? b : a));
    const u = cross3(
      g,
      [0, 0, 0].map((_, i) => (i === axis ? 1 : 0)),
    );
    const u1 = u.map((v) => v / Math.hypot(...u));
    basis = [u1, cross3(g, u1)];
  }
  const apply = (b: number[]) => L.map((row) => row.reduce((t, w, j) => t + w * b[j], 0));
  const M = basis.map((a) => basis.map((b) => a.reduce((sum, v, i) => sum + v * apply(b)[i], 0)));
  const scale = Math.max(1, ...L.flat().map(Math.abs));
  let eig: number[];
  if (M.length === 1) eig = [M[0][0]];
  else {
    const mid = (M[0][0] + M[1][1]) / 2;
    const spread = Math.sqrt(Math.max(0, ((M[0][0] - M[1][1]) / 2) ** 2 + M[0][1] * M[1][0]));
    eig = [mid + spread, mid - spread];
  }
  const tol = 1e-9 * scale;
  if (eig.every((v) => v > tol)) return 'min';
  if (eig.every((v) => v < -tol)) return 'max';
  if (eig.some((v) => v > tol) && eig.some((v) => v < -tol)) return 'saddle';
  return 'unknown';
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
  const bounded = constraintBounded(compiled(gText, vars), c[0], ranges);
  const values = found.map((p) => f(p.x.slice(0, vars.length)));
  const best = Math.max(...values);
  const worst = Math.min(...values);
  // On a bounded constraint set the largest and smallest values are the extrema. On an unbounded one (a plane, a
  // hyperbola) f can run past every candidate, so each point is classified on its own by the second-order test.
  const hess = vars.map((u) =>
    vars.map((w) => ({
      f: compiled(partial(partial(fText, u), w), vars),
      g: compiled(partial(partial(gText, u), w), vars),
    })),
  );
  const grad = vars.map((u) => compiled(partial(gText, u), vars));
  const local = (x: number[]) => {
    const at = x.slice(0, vars.length);
    const L = hess.map((row) => row.map((h) => h.f(at) - x[vars.length] * h.g(at)));
    return localKind(
      grad.map((gr) => gr(at)),
      L,
    );
  };
  const label = (v: number, x: number[]) =>
    !bounded
      ? local(x)
      : found.length < 2 || best - worst < 1e-9
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
      `@${label(v, p.x)}`,
    ]);
  const lines: NumLine[] = found.length
    ? [line('vcLagrangeBest', { max: fmt(best, 10), min: fmt(worst, 10), n: String(found.length) })]
    : [line('vcLagrangeNone')];
  if (found.length && !bounded) lines.push(line('vcLagrangeUnbounded'));
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
