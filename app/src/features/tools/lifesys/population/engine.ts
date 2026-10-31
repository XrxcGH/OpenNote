// Population dynamics: single-species growth (continuous and discrete), harvesting, predator-prey, and competition
// models with their equilibria classified by the Jacobian, metapopulations, island biogeography, species-area
// fits, and the logistic map's cobweb, bifurcation diagram, and Lyapunov exponent. Continuous models are integrated
// by the lane's Dormand-Prince solver.
import { LsError, nonNegative, positive, whole, within } from '../num/errors';
import { lineFit } from '../num/fit';
import { eigen2 } from '../num/linalg';
import { dopri } from '../num/ode';
import type { Rhs } from '../num/ode';
import type { CalcResult, Series, Step } from '../types';

type Point = [number, number];

/** The continuous logistic N(t) = K / (1 + ((K − N0)/N0) e^(−rt)). */
export const logistic = (N0: number, r: number, K: number, t: number): number =>
  K / (1 + ((K - N0) / N0) * Math.exp(-r * t));

export type Growth =
  'exponential' | 'logistic' | 'allee' | 'geometric' | 'discreteLogistic' | 'ricker' | 'bevertonHolt';

export interface GrowthInput {
  model: Growth;
  N0: number;
  r: number;
  K: number;
  A: number;
  t: number;
}

const DISCRETE: Record<string, (N: number, p: GrowthInput) => number> = {
  geometric: (N, p) => p.r * N,
  discreteLogistic: (N, p) => N + p.r * N * (1 - N / p.K),
  ricker: (N, p) => N * Math.exp(p.r * (1 - N / p.K)),
  bevertonHolt: (N, p) => (p.r * N) / (1 + ((p.r - 1) * N) / p.K),
};

/** A growth curve as points over time; discrete models step once per time unit. */
export function growthSeries(p: GrowthInput): Point[] {
  positive(p.N0, 'N₀');
  positive(p.t, 't');
  if (p.model !== 'exponential' && p.model !== 'geometric') positive(p.K, 'K');
  const step = DISCRETE[p.model];
  if (step) {
    whole(p.t, 't', 1);
    if (p.t > 2000) throw new LsError('errors.range', { name: 't', low: 1, high: 2000 });
    const out: Point[] = [[0, p.N0]];
    for (let k = 1; k <= p.t; k += 1) out.push([k, Math.max(0, step(out[k - 1][1], p))]);
    return out;
  }
  const count = 200;
  if (p.model === 'exponential')
    return Array.from({ length: count + 1 }, (_, i) => [(p.t * i) / count, p.N0 * Math.exp((p.r * p.t * i) / count)]);
  if (p.model === 'logistic')
    return Array.from({ length: count + 1 }, (_, i) => [
      (p.t * i) / count,
      logistic(p.N0, p.r, p.K, (p.t * i) / count),
    ]);
  positive(p.A, 'A');
  if (!(p.A < p.K)) throw new LsError('population.e.allee');
  const solution = dopri((_, [N]) => [p.r * N * (N / p.A - 1) * (1 - N / p.K)], [p.N0], 0, p.t, { maxStep: p.t / 200 });
  return solution.t.map((t, i) => [t, solution.y[i][0]]);
}

export function growthResult(p: GrowthInput): CalcResult {
  const series = growthSeries(p);
  const end = series[series.length - 1][1];
  const steps: Step[] = [
    { key: `population.s.${p.model}`, vars: { N0: p.N0, r: p.r, K: p.K, A: p.A, t: p.t, N: end } },
  ];
  const notes: Step[] = [];
  if (DISCRETE[p.model] && p.model !== 'geometric') {
    // The slope of the map at N* = K decides stability: |f'(K)| < 1.
    const slope = { discreteLogistic: 1 - p.r, ricker: 1 - p.r, bevertonHolt: 1 / p.r }[p.model as 'ricker'];
    notes.push({ key: Math.abs(slope) < 1 ? 'population.n.stableK' : 'population.n.unstableK', vars: { s: slope } });
  }
  if (p.model === 'allee') notes.push({ key: 'population.n.allee', vars: { A: p.A, K: p.K } });
  return {
    rows: [{ label: 'population.r.final', vars: { t: p.t }, value: end }],
    steps,
    notes,
    latex: {
      exponential: 'N(t) = N_0 e^{rt}',
      logistic: 'N(t) = \\frac{K}{1 + \\frac{K - N_0}{N_0} e^{-rt}}',
      allee: '\\frac{dN}{dt} = rN\\left(\\frac{N}{A} - 1\\right)\\left(1 - \\frac{N}{K}\\right)',
      geometric: 'N_{t+1} = \\lambda N_t',
      discreteLogistic: 'N_{t+1} = N_t + rN_t\\left(1 - \\frac{N_t}{K}\\right)',
      ricker: 'N_{t+1} = N_t e^{r(1 - N_t/K)}',
      bevertonHolt: 'N_{t+1} = \\frac{R N_t}{1 + (R-1)N_t/K}',
    }[p.model],
    plots: [
      {
        title: 'population.p.growth',
        x: { label: 'population.p.time' },
        y: { label: 'population.p.N' },
        series: [{ name: 'population.p.Nseries', points: series, style: DISCRETE[p.model] ? 'points' : 'line' }],
      },
    ],
  };
}

/** Harvested logistic equilibria: a constant quota H or a constant effort E. */
export function harvest(r: number, K: number, mode: 'quota' | 'effort', amount: number) {
  positive(r, 'r');
  positive(K, 'K');
  nonNegative(amount, mode === 'quota' ? 'H' : 'E');
  const msy = (r * K) / 4;
  if (mode === 'quota') {
    const disc = 1 - (4 * amount) / (r * K);
    if (disc < 0) return { msy, equilibria: [] as { N: number; stable: boolean }[], yield: amount };
    const root = Math.sqrt(disc);
    return {
      msy,
      equilibria: [
        { N: (K / 2) * (1 + root), stable: true },
        { N: (K / 2) * (1 - root), stable: false },
      ],
      yield: amount,
    };
  }
  const N = K * (1 - amount / r);
  return { msy, equilibria: N > 0 ? [{ N, stable: true }] : [], yield: amount * Math.max(N, 0), eMsy: r / 2 };
}

export function harvestResult(r: number, K: number, mode: 'quota' | 'effort', amount: number): CalcResult {
  const h = harvest(r, K, mode, amount);
  const rows: CalcResult['rows'] = [
    { label: 'population.r.msy', value: h.msy },
    { label: 'population.r.msyAt', value: K / 2 },
  ];
  h.equilibria.forEach((e) =>
    rows.push({ label: e.stable ? 'population.r.stableEq' : 'population.r.unstableEq', value: e.N }),
  );
  if (mode === 'effort') rows.push({ label: 'population.r.yield', value: h.yield });
  const curve: Point[] = Array.from({ length: 101 }, (_, i) => {
    const N = (K * i) / 100;
    return [N, r * N * (1 - N / K)];
  });
  const take: Point[] =
    mode === 'quota'
      ? [
          [0, amount],
          [K, amount],
        ]
      : [
          [0, 0],
          [K, amount * K],
        ];
  return {
    rows,
    steps: [
      { key: 'population.s.msy', vars: { r, K, m: h.msy }, math: '\\mathrm{MSY} = \\frac{rK}{4}' },
      { key: h.equilibria.length ? `population.s.${mode}` : 'population.s.collapse', vars: { a: amount } },
    ],
    latex:
      mode === 'quota'
        ? '\\frac{dN}{dt} = rN\\left(1 - \\frac{N}{K}\\right) - H'
        : '\\frac{dN}{dt} = rN\\left(1 - \\frac{N}{K}\\right) - EN',
    plots: [
      {
        title: 'population.p.harvest',
        x: { label: 'population.p.N' },
        y: { label: 'population.p.rate' },
        series: [
          { name: 'population.p.production', points: curve },
          { name: mode === 'quota' ? 'population.p.quota' : 'population.p.effort', points: take, style: 'dashed' },
        ],
      },
    ],
  };
}

export type Stability = 'stableNode' | 'unstableNode' | 'saddle' | 'stableSpiral' | 'unstableSpiral' | 'center';

/** Classifies an equilibrium from its Jacobian's eigenvalues. */
export function classify(J: readonly [number, number, number, number]): {
  kind: Stability;
  eig: { re: number; im: number }[];
} {
  const eig = eigen2(...J);
  const tol = 1e-9;
  let kind: Stability;
  if (Math.abs(eig[0].im) > tol)
    kind = Math.abs(eig[0].re) < tol ? 'center' : eig[0].re < 0 ? 'stableSpiral' : 'unstableSpiral';
  else if (eig[0].re * eig[1].re < 0) kind = 'saddle';
  else kind = eig[0].re < 0 && eig[1].re < 0 ? 'stableNode' : 'unstableNode';
  return { kind, eig };
}

const eigText = (eig: { re: number; im: number }[]) =>
  eig.map((e) =>
    Math.abs(e.im) > 1e-12 ? `${e.re.toPrecision(4)} ± ${Math.abs(e.im).toPrecision(4)}i` : e.re.toPrecision(4),
  );

function trajectory(f: Rhs, y0: readonly number[], tEnd: number): Point[] {
  const sol = dopri(f, y0, 0, tEnd, { maxStep: tEnd / 400, rtol: 1e-8, atol: 1e-10 });
  return sol.y.map((y) => [y[0], y[1]]);
}

export interface PredatorPrey {
  r: number;
  a: number;
  b: number;
  m: number;
  /** Prey carrying capacity; Infinity for Lotka-Volterra. */
  K: number;
  /** Handling time; 0 for a type I response. */
  h: number;
  N0: number;
  P0: number;
  t: number;
}

/** The coexistence equilibrium of predator-prey models (Lotka-Volterra when K is infinite and h is 0). */
export function predatorPreyEquilibrium(p: PredatorPrey) {
  const denom = p.a * (p.b - p.m * p.h);
  if (!(denom > 0)) throw new LsError('population.e.predator');
  const N = p.m / denom;
  const P = (p.r / p.a) * (Number.isFinite(p.K) ? 1 - N / p.K : 1) * (1 + p.a * p.h * N);
  const f = 1 + p.a * p.h * N;
  // The Jacobian of N' = rN(1 − N/K) − aNP/f, P' = baNP/f − mP at the equilibrium.
  const dfdN = (p.a * P) / (f * f);
  const J: [number, number, number, number] = [
    p.r * (1 - (2 * N) / p.K) - dfdN,
    -(p.a * N) / f,
    p.b * dfdN,
    (p.b * p.a * N) / f - p.m,
  ];
  return { N, P, ...classify(J) };
}

export function predatorPreyResult(p: PredatorPrey): CalcResult {
  ['r', 'a', 'b', 'm', 'N0', 'P0', 't'].forEach((k) => positive(p[k as keyof PredatorPrey], k));
  nonNegative(p.h, 'h');
  const eq = predatorPreyEquilibrium(p);
  const f: Rhs = (_, [N, P]) => {
    const eaten = (p.a * N * P) / (1 + p.a * p.h * N);
    return [p.r * N * (Number.isFinite(p.K) ? 1 - N / p.K : 1) - eaten, p.b * eaten - p.m * P];
  };
  const path = trajectory(f, [p.N0, p.P0], p.t);
  const sol = dopri(f, [p.N0, p.P0], 0, p.t, { maxStep: p.t / 400, rtol: 1e-8, atol: 1e-10 });
  const nMax = Math.max(...path.map((q) => q[0]), eq.N) * 1.1;
  const pMax = Math.max(...path.map((q) => q[1]), eq.P) * 1.1;
  const preyNull: Point[] = Array.from({ length: 81 }, (_, i) => {
    const N = (nMax * i) / 80;
    return [N, (p.r / p.a) * (Number.isFinite(p.K) ? 1 - N / p.K : 1) * (1 + p.a * p.h * N)];
  });
  const lv = !Number.isFinite(p.K) && p.h === 0;
  const steps: Step[] = [
    { key: 'population.s.ppEq', vars: { N: eq.N, P: eq.P } },
    { key: 'population.s.jacobian', vars: { e: eigText(eq.eig).join(', ') } },
  ];
  if (lv) {
    const V = (N: number, P: number) => p.b * p.a * N - p.m * Math.log(N) + p.a * P - p.r * Math.log(P);
    const end = path[path.length - 1];
    steps.push({ key: 'population.s.conserved', vars: { v0: V(p.N0, p.P0), v1: V(end[0], end[1]) } });
  }
  return {
    rows: [
      { label: 'population.r.preyEq', value: eq.N },
      { label: 'population.r.predatorEq', value: eq.P },
      { label: 'population.r.stability', value: '', word: `population.k.${eq.kind}` },
    ],
    steps,
    notes: [{ key: `population.n.${eq.kind}` }],
    latex: lv
      ? '\\frac{dN}{dt} = rN - aNP,\\quad \\frac{dP}{dt} = baNP - mP'
      : '\\frac{dN}{dt} = rN\\left(1-\\frac{N}{K}\\right) - \\frac{aNP}{1+ahN},\\quad \\frac{dP}{dt} = \\frac{baNP}{1+ahN} - mP',
    plots: [
      {
        title: 'population.p.phase',
        x: { label: 'population.p.prey', min: 0, max: nMax },
        y: { label: 'population.p.predator', min: 0, max: pMax },
        series: [
          { name: 'population.p.trajectory', points: path },
          { name: 'population.p.preyNull', points: preyNull, style: 'dashed' },
          {
            name: 'population.p.predNull',
            points: [
              [eq.N, 0],
              [eq.N, pMax],
            ],
            style: 'dashed',
          },
        ],
      },
      {
        title: 'population.p.timeSeries',
        x: { label: 'population.p.time' },
        y: { label: 'population.p.N' },
        series: [
          { name: 'population.p.prey', points: sol.t.map((t, i) => [t, sol.y[i][0]] as Point) },
          { name: 'population.p.predator', points: sol.t.map((t, i) => [t, sol.y[i][1]] as Point) },
        ],
      },
    ],
  };
}

/** Functional responses of types I, II and III over a prey range. */
export function functionalResult(a: number, h: number, nMax: number): CalcResult {
  positive(a, 'a');
  nonNegative(h, 'h');
  positive(nMax, 'N');
  const at = (f: (N: number) => number): Point[] =>
    Array.from({ length: 101 }, (_, i) => [(nMax * i) / 100, f((nMax * i) / 100)]);
  return {
    rows: [{ label: 'population.r.maxRate', value: h > 0 ? 1 / h : Infinity }],
    steps: [{ key: 'population.s.functional' }],
    latex: 'f_{II}(N) = \\frac{aN}{1 + ahN}',
    plots: [
      {
        title: 'population.p.functional',
        x: { label: 'population.p.prey' },
        y: { label: 'population.p.intake' },
        series: [
          { name: 'population.p.type1', points: at((N) => a * N), style: 'dashed' },
          { name: 'population.p.type2', points: at((N) => (a * N) / (1 + a * h * N)) },
          { name: 'population.p.type3', points: at((N) => (a * N * N) / (1 + a * h * N * N)) },
        ],
      },
    ],
  };
}

export interface Competition {
  r1: number;
  r2: number;
  K1: number;
  K2: number;
  a12: number;
  a21: number;
  N1: number;
  N2: number;
  t: number;
}

/** Lotka-Volterra competition: the coexistence point and which of the 4 outcomes the parameters give. */
export function competition(c: Competition) {
  const det = 1 - c.a12 * c.a21;
  const coexist = det !== 0 ? { N1: (c.K1 - c.a12 * c.K2) / det, N2: (c.K2 - c.a21 * c.K1) / det } : null;
  const oneWins = c.K1 > c.a12 * c.K2;
  const twoWins = c.K2 > c.a21 * c.K1;
  const outcome: 'coexist' | 'bistable' | 'first' | 'second' =
    oneWins && twoWins ? 'coexist' : !oneWins && !twoWins ? 'bistable' : oneWins ? 'first' : 'second';
  return { coexist, outcome };
}

export function competitionResult(c: Competition): CalcResult {
  (['r1', 'r2', 'K1', 'K2', 'N1', 'N2', 't'] as const).forEach((k) => positive(c[k], k));
  nonNegative(c.a12, 'α₁₂');
  nonNegative(c.a21, 'α₂₁');
  const { coexist, outcome } = competition(c);
  const f: Rhs = (_, [x, y]) => [c.r1 * x * (1 - (x + c.a12 * y) / c.K1), c.r2 * y * (1 - (y + c.a21 * x) / c.K2)];
  const path = trajectory(f, [c.N1, c.N2], c.t);
  const end = path[path.length - 1];
  const xMax = Math.max(c.K1, c.K2 / Math.max(c.a21, 1e-9), c.N1) * 1.1;
  const yMax = Math.max(c.K2, c.K1 / Math.max(c.a12, 1e-9), c.N2) * 1.1;
  const rows: CalcResult['rows'] = [];
  // In the bistable case the interior crossing is a saddle the trajectory leaves, so it is not named coexistence.
  const saddle = outcome === 'bistable';
  if (coexist && coexist.N1 > 0 && coexist.N2 > 0)
    rows.push(
      { label: saddle ? 'population.r.n1Saddle' : 'population.r.n1Eq', value: coexist.N1 },
      { label: saddle ? 'population.r.n2Saddle' : 'population.r.n2Eq', value: coexist.N2 },
    );
  rows.push(
    { label: 'population.r.end1', vars: { t: c.t }, value: end[0] },
    { label: 'population.r.end2', vars: { t: c.t }, value: end[1] },
  );
  return {
    rows,
    steps: [
      { key: 'population.s.isoclines', vars: { K1: c.K1, a12: c.a12, K2: c.K2, a21: c.a21 } },
      {
        key: 'population.s.coexist',
        vars: { n1: coexist?.N1 ?? NaN, n2: coexist?.N2 ?? NaN },
        math: 'N_1^* = \\frac{K_1 - \\alpha_{12}K_2}{1 - \\alpha_{12}\\alpha_{21}}',
      },
    ],
    notes: [{ key: `population.n.${outcome}` }],
    latex: '\\frac{dN_1}{dt} = r_1 N_1\\left(1 - \\frac{N_1 + \\alpha_{12}N_2}{K_1}\\right)',
    plots: [
      {
        title: 'population.p.competition',
        x: { label: 'population.p.n1', min: 0, max: xMax },
        y: { label: 'population.p.n2', min: 0, max: yMax },
        series: [
          { name: 'population.p.trajectory', points: path },
          {
            name: 'population.p.iso1',
            points: [
              [c.K1, 0],
              [0, c.K1 / Math.max(c.a12, 1e-9)],
            ],
            style: 'dashed',
          },
          {
            name: 'population.p.iso2',
            points: [
              [0, c.K2],
              [c.K2 / Math.max(c.a21, 1e-9), 0],
            ],
            style: 'dashed',
          },
        ],
      },
    ],
  };
}

/** Levins metapopulation: dp/dt = c p (1 − p) − e p, with p* = 1 − e/c. */
export function levinsResult(c: number, e: number, p0: number, t: number): CalcResult {
  positive(c, 'c');
  nonNegative(e, 'e');
  within(p0, 'p₀', 0, 1);
  positive(t, 't');
  const star = Math.max(0, 1 - e / c);
  const sol = dopri((_, [p]) => [c * p * (1 - p) - e * p], [p0], 0, t, { maxStep: t / 200 });
  return {
    rows: [{ label: 'population.r.pStar', value: star }],
    steps: [
      {
        key: star > 0 ? 'population.s.levins' : 'population.s.levinsExtinct',
        vars: { c, e, p: star },
        math: 'p^* = 1 - \\frac{e}{c}',
      },
    ],
    latex: '\\frac{dp}{dt} = cp(1 - p) - ep',
    plots: [
      {
        title: 'population.p.occupancy',
        x: { label: 'population.p.time' },
        y: { label: 'population.p.p', min: 0, max: 1 },
        series: [{ name: 'population.p.pSeries', points: sol.t.map((tt, i) => [tt, sol.y[i][0]] as Point) }],
      },
    ],
  };
}

/** Island biogeography with linear immigration and extinction curves over a pool of P species. */
export function islandResult(I0: number, E0: number, pool: number): CalcResult {
  positive(I0, 'I₀');
  positive(E0, 'E₀');
  positive(pool, 'P');
  const S = (I0 * pool) / (I0 + E0);
  const turnover = I0 * (1 - S / pool);
  return {
    rows: [
      { label: 'population.r.sStar', value: S },
      { label: 'population.r.turnover', value: turnover },
    ],
    steps: [{ key: 'population.s.island', vars: { I: I0, E: E0, P: pool, S }, math: 'S^* = \\frac{I_0 P}{I_0 + E_0}' }],
    latex: 'S^* = \\frac{I_0 P}{I_0 + E_0}',
    plots: [
      {
        title: 'population.p.island',
        x: { label: 'population.p.species' },
        y: { label: 'population.p.rate' },
        series: [
          {
            name: 'population.p.immigration',
            points: [
              [0, I0],
              [pool, 0],
            ],
          },
          {
            name: 'population.p.extinction',
            points: [
              [0, 0],
              [pool, E0],
            ],
          },
        ],
      },
    ],
  };
}

/** Species-area power law S = c A^z by a straight line on log-log axes. */
export function speciesAreaResult(rows: readonly (readonly number[])[]): CalcResult {
  rows.flat().forEach((v) => positive(v, 'A, S'));
  const fit = lineFit(
    rows.map((r) => Math.log10(r[0])),
    rows.map((r) => Math.log10(r[1])),
  );
  const c = 10 ** fit.intercept;
  const areas = rows.map((r) => r[0]);
  const low = Math.min(...areas);
  const high = Math.max(...areas);
  const curve: Point[] = Array.from({ length: 41 }, (_, i) => {
    const A = low * (high / low) ** (i / 40);
    return [A, c * A ** fit.slope];
  });
  return {
    rows: [
      { label: 'population.r.z', value: fit.slope },
      { label: 'population.r.c', value: c },
      { label: 'population.r.r2', value: fit.r2 },
    ],
    steps: [
      {
        key: 'population.s.speciesArea',
        vars: { z: fit.slope, se: fit.seSlope, c },
        math: '\\log S = \\log c + z \\log A',
      },
    ],
    latex: 'S = cA^z',
    plots: [
      {
        title: 'population.p.speciesArea',
        x: { label: 'population.p.area', log: true },
        y: { label: 'population.p.species', log: true },
        series: [
          { name: 'population.p.data', points: rows.map((r) => [r[0], r[1]] as Point), style: 'points' },
          { name: 'population.p.fit', points: curve },
        ],
      },
    ],
  };
}

/** The 2-cycle of the logistic map x → r x (1 − x), which exists for r > 3. */
export function twoCycle(r: number): [number, number] {
  if (!(r > 3)) throw new LsError('population.e.twoCycle');
  const root = Math.sqrt((r + 1) * (r - 3));
  return [(r + 1 + root) / (2 * r), (r + 1 - root) / (2 * r)];
}

/** The Lyapunov exponent of the logistic map: the mean of ln |r (1 − 2x)| along an orbit. */
export function lyapunov(r: number, x0 = 0.3, n = 1_000_000, transient = 1000): number {
  let x = x0;
  for (let i = 0; i < transient; i += 1) x = r * x * (1 - x);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    total += Math.log(Math.abs(r * (1 - 2 * x)) || 1e-300);
    x = r * x * (1 - x);
  }
  return total / n;
}

export function cobwebResult(r: number, x0: number, steps: number): CalcResult {
  within(r, 'r', 0, 4);
  within(x0, 'x₀', 0, 1);
  whole(steps, 'n', 1);
  if (steps > 500) throw new LsError('errors.range', { name: 'n', low: 1, high: 500 });
  const web: Point[] = [[x0, 0]];
  const orbit: Point[] = [[0, x0]];
  let x = x0;
  for (let i = 1; i <= steps; i += 1) {
    const next = r * x * (1 - x);
    web.push([x, next], [next, next]);
    orbit.push([i, next]);
    x = next;
  }
  const map: Point[] = Array.from({ length: 101 }, (_, i) => [i / 100, (r * i * (100 - i)) / 10000]);
  const lambda = lyapunov(r, x0 === 0 || x0 === 1 ? 0.3 : x0, 100_000);
  const rows: CalcResult['rows'] = [
    { label: 'population.r.fixed', value: r > 1 ? 1 - 1 / r : 0 },
    { label: 'population.r.lyapunov', value: lambda, digits: 4 },
  ];
  if (r > 3) {
    const [a, b] = twoCycle(r);
    rows.push({ label: 'population.r.cycle', value: `${a.toPrecision(6)}, ${b.toPrecision(6)}` });
  }
  return {
    rows,
    steps: [
      { key: 'population.s.fixed', vars: { r, x: r > 1 ? 1 - 1 / r : 0, s: 2 - r }, math: 'x^* = 1 - \\frac{1}{r}' },
      { key: 'population.s.lyapunov', vars: { l: lambda }, math: '\\lambda = \\frac{1}{n}\\sum \\ln|r(1 - 2x_t)|' },
    ],
    notes: [{ key: lambda > 0 ? 'population.n.chaotic' : 'population.n.regular' }],
    latex: 'x_{t+1} = r x_t (1 - x_t)',
    plots: [
      {
        title: 'population.p.cobweb',
        x: { label: 'population.p.xt', min: 0, max: 1 },
        y: { label: 'population.p.xnext', min: 0, max: 1 },
        series: [
          { name: 'population.p.map', points: map },
          {
            name: 'population.p.diagonal',
            points: [
              [0, 0],
              [1, 1],
            ],
            style: 'dashed',
          },
          { name: 'population.p.web', points: web },
        ],
      },
      {
        title: 'population.p.orbit',
        x: { label: 'population.p.time' },
        y: { label: 'population.p.x', min: 0, max: 1 },
        series: [{ name: 'population.p.xSeries', points: orbit }],
      },
    ],
  };
}

/** The bifurcation diagram: the last values of each orbit as r runs from rMin to rMax. */
export function bifurcationResult(rMin: number, rMax: number): CalcResult {
  within(rMin, 'r', 0, 4);
  within(rMax, 'r', 0, 4);
  if (!(rMax > rMin)) throw new LsError('population.e.rRange');
  const points: Point[] = [];
  for (let i = 0; i <= 240; i += 1) {
    const r = rMin + ((rMax - rMin) * i) / 240;
    let x = 0.3;
    for (let k = 0; k < 500; k += 1) x = r * x * (1 - x);
    for (let k = 0; k < 32; k += 1) {
      x = r * x * (1 - x);
      points.push([r, x]);
    }
  }
  const series: Series[] = [{ name: 'population.p.attractor', points, style: 'points' }];
  return {
    rows: [{ label: 'population.r.firstSplit', value: 3 }],
    steps: [{ key: 'population.s.bifurcation' }],
    latex: 'x_{t+1} = r x_t (1 - x_t)',
    plots: [
      {
        title: 'population.p.bifurcation',
        x: { label: 'population.p.r', min: rMin, max: rMax },
        y: { label: 'population.p.x', min: 0, max: 1 },
        series,
      },
    ],
  };
}
