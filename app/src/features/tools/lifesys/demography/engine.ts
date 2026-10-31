// Life tables and demography: cohort and period life tables; net reproduction with the intrinsic rate by the
// Euler-Lotka equation; fertility and growth measures; matrix analysis of Leslie or Lefkovitch models; a
// cohort-component projection; and population pyramids. Formulas follow Preston et al. (2001) and Caswell (2001),
// written from the published equations.
import { LsError, nonNegative, positive, whole, within } from '../num/errors';
import { dominantEigen, matVec } from '../num/linalg';
import { bracket, brent } from '../num/roots';
import type { CalcResult, Step } from '../types';

const sum = (values: readonly number[]) => values.reduce((s, v) => s + v, 0);

export interface LifeRow {
  x: number;
  n: number;
  l: number;
  d: number;
  q: number;
  p: number;
  L: number;
  T: number;
  e: number;
}

function finishTable(rows: Omit<LifeRow, 'T' | 'e'>[]): LifeRow[] {
  let T = 0;
  const out: LifeRow[] = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    T += rows[i].L;
    out.unshift({ ...rows[i], T, e: rows[i].l > 0 ? T / rows[i].l : NaN });
  }
  return out;
}

/** A cohort life table from the survivors at each age (the last count must be 0). */
export function cohortTable(ages: readonly number[], survivors: readonly number[]): LifeRow[] {
  if (ages.length < 2) throw new LsError('errors.points', { min: 2 });
  survivors.forEach((l) => nonNegative(l, 'lx'));
  for (let i = 1; i < ages.length; i += 1) {
    if (!(ages[i] > ages[i - 1])) throw new LsError('demography.e.ages');
    if (survivors[i] > survivors[i - 1]) throw new LsError('demography.e.rising');
  }
  if (survivors[survivors.length - 1] !== 0) throw new LsError('demography.e.lastZero');
  if (!(survivors[0] > 0)) throw new LsError('demography.e.firstPositive');
  const rows = ages.slice(0, -1).map((x, i) => {
    const n = ages[i + 1] - x;
    const l = survivors[i];
    const next = survivors[i + 1];
    const d = l - next;
    return { x, n, l, d, q: l > 0 ? d / l : NaN, p: l > 0 ? next / l : NaN, L: (n * (l + next)) / 2 };
  });
  return finishTable(rows);
}

/** Survivors from deaths in each interval, starting from their total. */
export const survivorsFromDeaths = (deaths: readonly number[]): number[] => {
  deaths.forEach((d) => nonNegative(d, 'dx'));
  const out = [sum(deaths)];
  for (const d of deaths) out.push(out[out.length - 1] - d);
  out[out.length - 1] = 0;
  return out;
};

/** nqx from a death rate: n M / (1 + (n − a) M). */
export const qFromM = (n: number, M: number, a = n / 2): number => (n * M) / (1 + (n - a) * M);

/** A period life table from age-specific death rates, with a radix of 100 000 and an open last interval. */
export function periodTable(
  ages: readonly number[],
  rates: readonly number[],
  aValues: readonly (number | null)[],
): LifeRow[] {
  if (ages.length < 2) throw new LsError('errors.points', { min: 2 });
  rates.forEach((m) => nonNegative(m, 'nMx'));
  if (!(rates[rates.length - 1] > 0)) throw new LsError('demography.e.openRate');
  let l = 100000;
  const rows: Omit<LifeRow, 'T' | 'e'>[] = [];
  ages.forEach((x, i) => {
    const open = i === ages.length - 1;
    const M = rates[i];
    if (open) {
      rows.push({ x, n: Infinity, l, d: l, q: 1, p: 0, L: l / M });
      return;
    }
    const n = ages[i + 1] - x;
    if (!(n > 0)) throw new LsError('demography.e.ages');
    const a = aValues[i] ?? n / 2;
    within(a, 'nax', 0, n);
    const q = Math.min(1, qFromM(n, M, a));
    const d = l * q;
    rows.push({ x, n, l, d, q, p: 1 - q, L: n * (l - d) + a * d });
    l -= d;
  });
  return finishTable(rows);
}

export function lifeTableResult(table: LifeRow[], kind: 'cohort' | 'period'): CalcResult {
  const first = table[0];
  const steps: Step[] =
    kind === 'cohort'
      ? [
          { key: 'demography.s.dx' },
          { key: 'demography.s.Lcohort', math: 'L_x = \\tfrac{n}{2}(l_x + l_{x+n})' },
          { key: 'demography.s.Tx', vars: { T: first.T, l: first.l, e: first.e }, math: 'e_x = T_x / l_x' },
        ]
      : [
          { key: 'demography.s.qFromM', math: '{}_nq_x = \\frac{n\\,{}_nM_x}{1 + (n - {}_na_x)\\,{}_nM_x}' },
          { key: 'demography.s.Lperiod', math: '{}_nL_x = n\\,l_{x+n} + {}_na_x\\,{}_nd_x' },
          { key: 'demography.s.open' },
          { key: 'demography.s.Tx', vars: { T: first.T, l: first.l, e: first.e }, math: 'e_x = T_x / l_x' },
        ];
  return {
    rows: [
      { label: 'demography.r.e0', vars: { x: first.x }, value: first.e },
      ...(table[1] ? [{ label: 'demography.r.e0' as const, vars: { x: table[1].x }, value: table[1].e }] : []),
    ],
    steps,
    latex: 'e_x = \\frac{T_x}{l_x}',
    table: {
      header: (['x', 'l', 'd', 'q', 'p', 'L', 'T', 'e'] as const).map((k) => ({ key: `demography.t.${k}` as const })),
      rows: table.map((r) => [r.x, r.l, r.d, r.q, r.p, r.L, r.T, r.e]),
    },
    plots: [
      {
        title: 'demography.p.survivorship',
        x: { label: 'demography.p.age' },
        y: { label: 'demography.p.lx', log: table.every((r) => r.l > 0) },
        series: [{ name: 'demography.p.lxSeries', points: table.map((r) => [r.x, r.l] as [number, number]) }],
      },
    ],
  };
}

/** R0, generation time, and the intrinsic rate r from a fecundity schedule (lx scaled so l0 = 1). */
export function fecundity(ages: readonly number[], lx: readonly number[], mx: readonly number[]) {
  if (ages.length < 1) throw new LsError('errors.points', { min: 1 });
  lx.forEach((l) => nonNegative(l, 'lx'));
  mx.forEach((m) => nonNegative(m, 'mx'));
  const l0 = lx[0];
  if (!(l0 > 0)) throw new LsError('demography.e.firstPositive');
  const l = lx.map((v) => v / l0);
  const lm = l.map((v, i) => v * mx[i]);
  const R0 = sum(lm);
  if (!(R0 > 0)) throw new LsError('demography.e.noBirths');
  const T = sum(lm.map((v, i) => v * ages[i])) / R0;
  const lotka = (r: number) => sum(lm.map((v, i) => v * Math.exp(-r * ages[i]))) - 1;
  const found = bracket(lotka, -5, 5, 1000);
  if (!found) throw new LsError('errors.bracket');
  const r = found[0] === found[1] ? found[0] : brent(lotka, found[0], found[1]);
  return { R0, T, r, lambda: Math.exp(r), lm };
}

export function fecundityResult(ages: readonly number[], lx: readonly number[], mx: readonly number[]): CalcResult {
  const f = fecundity(ages, lx, mx);
  return {
    rows: [
      { label: 'demography.r.R0', value: f.R0 },
      { label: 'demography.r.T', value: f.T },
      { label: 'demography.r.r', value: f.r },
      { label: 'demography.r.lambda', value: f.lambda },
      { label: 'demography.r.approxR', value: Math.log(f.R0) / f.T },
    ],
    steps: [
      { key: 'demography.s.R0', vars: { R0: f.R0 }, math: 'R_0 = \\sum_x l_x m_x' },
      { key: 'demography.s.T', vars: { T: f.T }, math: 'T = \\frac{\\sum_x x\\,l_x m_x}{R_0}' },
      { key: 'demography.s.lotka', vars: { r: f.r }, math: '\\sum_x e^{-rx} l_x m_x = 1' },
    ],
    latex: '\\sum_x e^{-rx} l_x m_x = 1',
    table: {
      header: [
        { key: 'demography.t.x' },
        { key: 'demography.t.lx' },
        { key: 'demography.t.mx' },
        { key: 'demography.t.lm' },
      ],
      rows: ages.map((x, i) => [x, lx[i] / lx[0], mx[i], f.lm[i]]),
    },
  };
}

/** TFR, GRR, NRR (when person-years are given) and the mean age of childbearing from age-specific rates. */
export function fertility(
  starts: readonly number[],
  asfr: readonly number[],
  width: number,
  femaleShare: number,
  personYears: readonly (number | null)[],
) {
  positive(width, 'n');
  within(femaleShare, 'f', 0, 1);
  asfr.forEach((v) => nonNegative(v, 'ASFR'));
  const TFR = width * sum(asfr);
  if (!(TFR > 0)) throw new LsError('demography.e.noBirths');
  const meanAge = sum(asfr.map((v, i) => v * (starts[i] + width / 2))) / sum(asfr);
  const hasL = personYears.every((v) => v !== null);
  const NRR = hasL ? sum(asfr.map((v, i) => v * femaleShare * (personYears[i] as number))) : null;
  return { TFR, GRR: TFR * femaleShare, NRR, meanAge };
}

export function fertilityResult(
  starts: readonly number[],
  asfr: readonly number[],
  width: number,
  femaleShare: number,
  personYears: readonly (number | null)[],
): CalcResult {
  const f = fertility(starts, asfr, width, femaleShare, personYears);
  return {
    rows: [
      { label: 'demography.r.TFR', value: f.TFR },
      { label: 'demography.r.GRR', value: f.GRR },
      ...(f.NRR !== null ? [{ label: 'demography.r.NRR' as const, value: f.NRR }] : []),
      { label: 'demography.r.meanAge', value: f.meanAge },
    ],
    steps: [
      {
        key: 'demography.s.TFR',
        vars: { n: width, s: sum(asfr), TFR: f.TFR },
        math: '\\mathrm{TFR} = n \\sum \\mathrm{ASFR}',
      },
      { key: 'demography.s.GRR', vars: { f: femaleShare, GRR: f.GRR } },
      ...(f.NRR !== null ? [{ key: 'demography.s.NRR' as const, vars: { NRR: f.NRR } }] : []),
    ],
    latex: '\\mathrm{TFR} = n \\sum_x {}_nF_x',
  };
}

/** Crude rates per 1000, natural increase and growth, doubling time, and dependency ratios. */
export function ratesResult(
  births: number,
  deaths: number,
  population: number,
  migrants: number,
  young: number | null,
  old: number | null,
): CalcResult {
  nonNegative(births, 'B');
  nonNegative(deaths, 'D');
  positive(population, 'P');
  const cbr = (1000 * births) / population;
  const cdr = (1000 * deaths) / population;
  const rni = (births - deaths) / population;
  const growth = (births - deaths + migrants) / population;
  const rows: CalcResult['rows'] = [
    { label: 'demography.r.cbr', value: cbr },
    { label: 'demography.r.cdr', value: cdr },
    { label: 'demography.r.rni', value: 100 * rni, unit: '%' },
    { label: 'demography.r.growth', value: 100 * growth, unit: '%' },
  ];
  const steps: CalcResult['steps'] = [
    { key: 'demography.s.crude', vars: { B: births, D: deaths, P: population, b: cbr, d: cdr } },
    { key: 'demography.s.growth', vars: { r: 100 * growth } },
  ];
  if (growth > 0) {
    rows.push(
      { label: 'demography.r.doubling', value: Math.LN2 / growth },
      { label: 'demography.r.rule70', value: 70 / (100 * growth) },
    );
    steps.push({
      key: 'demography.s.doubling',
      vars: { r: growth, t: Math.LN2 / growth, t70: 70 / (100 * growth) },
      math: 't_2 = \\ln 2 / r',
    });
  }
  if (young !== null && old !== null) {
    nonNegative(young, '0–14');
    nonNegative(old, '65+');
    const working = population - young - old;
    if (!(working > 0)) throw new LsError('demography.e.working');
    rows.push(
      { label: 'demography.r.youngDep', value: (100 * young) / working },
      { label: 'demography.r.oldDep', value: (100 * old) / working },
      { label: 'demography.r.totalDep', value: (100 * (young + old)) / working },
    );
    steps.push({ key: 'demography.s.dependency', vars: { w: working } });
  }
  return { rows, steps, latex: 't_2 = \\frac{\\ln 2}{r}' };
}

/** Exact doubling time for a continuous growth rate r per year. */
export const doublingTime = (r: number): number => Math.LN2 / r;

export interface MatrixAnalysis {
  lambda: number;
  stable: number[];
  reproductive: number[];
  sensitivity: number[][];
  elasticity: number[][];
}

/** The dominant eigenvalue, stable distribution, reproductive values, sensitivities, and elasticities. */
export function matrixAnalysis(A: readonly (readonly number[])[]): MatrixAnalysis {
  const n = A.length;
  if (n < 2 || A.some((row) => row.length !== n)) throw new LsError('demography.e.square');
  const { value, right, left } = dominantEigen(A);
  const reproductive = left.map((v) => v / left[0]);
  const vw = sum(reproductive.map((v, i) => v * right[i]));
  const sensitivity = reproductive.map((v) => right.map((w) => (v * w) / vw));
  const elasticity = sensitivity.map((row, i) => row.map((s, j) => (A[i][j] * s) / value));
  return { lambda: value, stable: right, reproductive, sensitivity, elasticity };
}

export function matrixResult(
  A: readonly (readonly number[])[],
  start: readonly number[] | null,
  steps: number,
): CalcResult {
  const m = matrixAnalysis(A);
  whole(steps, 't', 1);
  const out: CalcResult = {
    rows: [
      { label: 'demography.r.lambda', value: m.lambda },
      { label: 'demography.r.rFromLambda', value: Math.log(m.lambda) },
    ],
    steps: [
      { key: 'demography.s.eigen', vars: { l: m.lambda }, math: '\\mathbf{A}\\mathbf{w} = \\lambda \\mathbf{w}' },
      { key: 'demography.s.stable' },
      {
        key: 'demography.s.sensitivity',
        math: 's_{ij} = \\frac{v_i w_j}{\\langle \\mathbf{v}, \\mathbf{w} \\rangle},\\quad e_{ij} = \\frac{a_{ij}}{\\lambda} s_{ij}',
      },
    ],
    latex: '\\mathbf{A}\\mathbf{w} = \\lambda \\mathbf{w}',
    table: {
      header: [
        { key: 'demography.t.stage' },
        { key: 'demography.t.stable' },
        { key: 'demography.t.reproductive' },
        { key: 'demography.t.elasticityRow' },
      ],
      rows: m.stable.map((w, i) => [i + 1, w, m.reproductive[i], sum(m.elasticity[i])]),
    },
  };
  if (start) {
    if (start.length !== A.length) throw new LsError('demography.e.startLength', { n: A.length });
    start.forEach((v) => nonNegative(v, 'n₀'));
    const totals: [number, number][] = [[0, sum(start)]];
    let n = [...start];
    for (let t = 1; t <= steps; t += 1) {
      n = matVec(A, n);
      totals.push([t, sum(n)]);
    }
    out.rows.push({ label: 'demography.r.projected', vars: { t: steps }, value: totals[totals.length - 1][1] });
    out.plots = [
      {
        title: 'demography.p.projection',
        x: { label: 'demography.p.step' },
        y: { label: 'demography.p.total' },
        series: [{ name: 'demography.p.totalSeries', points: totals }],
      },
    ];
  }
  return out;
}

export interface CohortGroup {
  start: number;
  population: number;
  survival: number;
  asfr: number;
  migrants: number;
}

/**
 * A female-only cohort-component projection in 5-year steps (Preston et al. 2001, chapter 6): survivors move up a
 * group, the open last group keeps its own survivors, births come from the mean of the start and end populations of
 * childbearing age, and net migrants arrive at the end of each step.
 */
export function cohortComponent(
  groups: readonly CohortGroup[],
  steps: number,
  srb: number,
  birthSurvival: number,
): number[][] {
  if (groups.length < 3) throw new LsError('errors.points', { min: 3 });
  whole(steps, 'steps', 1);
  if (steps > 40) throw new LsError('errors.range', { name: 'steps', low: 1, high: 40 });
  positive(srb, 'SRB');
  within(birthSurvival, 'S₀', 0, 1);
  groups.forEach((g) => {
    nonNegative(g.population, 'N');
    within(g.survival, 'S', 0, 1);
    nonNegative(g.asfr, 'ASFR');
  });
  const series: number[][] = [groups.map((g) => g.population)];
  for (let s = 0; s < steps; s += 1) {
    const now = series[series.length - 1];
    const next = now.map(() => 0);
    for (let i = 1; i < now.length; i += 1) next[i] = now[i - 1] * groups[i - 1].survival;
    const last = now.length - 1;
    next[last] += now[last] * groups[last].survival;
    const births = 5 * sum(groups.map((g, i) => (g.asfr * (now[i] + next[i])) / 2));
    next[0] = (births / (1 + srb)) * birthSurvival;
    series.push(next.map((v, i) => Math.max(0, v + groups[i].migrants)));
  }
  return series;
}

export function cohortComponentResult(
  groups: readonly CohortGroup[],
  steps: number,
  srb: number,
  birthSurvival: number,
): CalcResult {
  const series = cohortComponent(groups, steps, srb, birthSurvival);
  const totals = series.map((s) => sum(s));
  return {
    rows: [
      { label: 'demography.r.startTotal', value: totals[0] },
      { label: 'demography.r.endTotal', vars: { years: 5 * steps }, value: totals[totals.length - 1] },
      {
        label: 'demography.r.annualGrowth',
        value: (100 * Math.log(totals[totals.length - 1] / totals[0])) / (5 * steps),
        unit: '%',
      },
    ],
    steps: [
      { key: 'demography.s.survive' },
      { key: 'demography.s.births', vars: { srb } },
      { key: 'demography.s.migrants' },
    ],
    table: {
      header: [
        { key: 'demography.t.group' },
        ...series.map((_, k) => ({ key: 'demography.t.year' as const, vars: { y: 5 * k } })),
      ],
      rows: groups.map((g, i) => [g.start, ...series.map((s) => s[i])]),
    },
    plots: [
      {
        title: 'demography.p.projection',
        x: { label: 'demography.p.years' },
        y: { label: 'demography.p.total' },
        series: [{ name: 'demography.p.totalSeries', points: totals.map((t, k) => [5 * k, t] as [number, number]) }],
      },
    ],
  };
}

/** A population pyramid: males to the left, females to the right, in counts or percent of the total. */
export function pyramidResult(
  labels: readonly string[],
  rows: readonly (readonly number[])[],
  percent: boolean,
): CalcResult {
  if (rows.length < 2) throw new LsError('errors.points', { min: 2 });
  if (rows.some((r) => r.length !== 2 && r.length !== 4)) throw new LsError('demography.e.pyramidColumns');
  rows.flat().forEach((v) => nonNegative(v, 'N'));
  const second = rows.every((r) => r.length === 4);
  const total = (a: number, b: number) => sum(rows.map((r) => r[a] + r[b]));
  const t1 = total(0, 1);
  const t2 = second ? total(2, 3) : 1;
  const scale = (v: number, t: number) => (percent ? (100 * v) / t : v);
  const names = rows.map((_, i) => labels[i] || String(i + 1));
  const at = (i: number) => i;
  const series: NonNullable<CalcResult['plots']>[number]['series'] = [
    {
      name: 'demography.p.males',
      points: rows.map((r, i) => [-scale(r[0], t1), at(i)] as [number, number]),
      style: 'bars',
    },
    {
      name: 'demography.p.females',
      points: rows.map((r, i) => [scale(r[1], t1), at(i)] as [number, number]),
      style: 'bars',
    },
  ];
  if (second) {
    series.push(
      {
        name: 'demography.p.malesLater',
        points: rows.map((r, i) => [-scale(r[2], t2), at(i)] as [number, number]),
        style: 'outline',
      },
      {
        name: 'demography.p.femalesLater',
        points: rows.map((r, i) => [scale(r[3], t2), at(i)] as [number, number]),
        style: 'outline',
      },
    );
  }
  const males = sum(rows.map((r) => r[0]));
  return {
    rows: [
      { label: 'demography.r.population', value: t1 },
      { label: 'demography.r.sexRatio', value: (100 * males) / (t1 - males) },
    ],
    steps: [{ key: percent ? 'demography.s.pyramidPercent' : 'demography.s.pyramidCounts' }],
    plots: [
      {
        title: 'demography.p.pyramid',
        x: { label: percent ? 'demography.p.percent' : 'demography.p.count', absolute: true },
        y: { label: 'demography.p.ageGroup', categories: names },
        series,
      },
    ],
  };
}
