// Biodiversity and field sampling: diversity indices and Hill numbers, Chao1 and ACE richness, Hurlbert rarefaction
// and a seeded species-accumulation curve, similarity between sites, quadrat, and point-quarter summaries,
// dispersion (variance-to-mean and Morisita) and mark-recapture estimates with intervals. Formulas follow Magurran
// (2004), Krebs (Ecological Methodology, 1999) and Chao (1984, 1987), written from the published equations.
import { LsError, nonNegative, positive, whole } from '../num/errors';
import { createRng } from '../num/rng';
import { brent } from '../num/roots';
import { chiSquareCdf, gammaP, lnChoose, tQuantile } from '../num/special';
import type { CalcResult, Step } from '../types';
import { interval } from '../ui/text';

const sum = (values: readonly number[]) => values.reduce((s, v) => s + v, 0);

function counts(values: readonly number[]): number[] {
  values.forEach((v) => whole(v, 'n'));
  const present = values.filter((v) => v > 0);
  if (present.length === 0) throw new LsError('errors.noSpecies');
  return present;
}

export interface Indices {
  S: number;
  N: number;
  shannon: number;
  evenness: number;
  simpson: number;
  simpsonUnbiased: number;
  hill0: number;
  hill1: number;
  hill2: number;
  bergerParker: number;
}

/** Diversity indices of an abundance list; `base` is e (natural log) or 2. */
export function indices(abundances: readonly number[], base: 'e' | '2' = 'e'): Indices {
  const n = counts(abundances);
  const N = sum(n);
  const log = base === '2' ? Math.log2 : Math.log;
  const p = n.map((x) => x / N);
  const shannon = -sum(p.map((x) => x * log(x)));
  const simpson = sum(p.map((x) => x * x));
  const S = n.length;
  return {
    S,
    N,
    shannon,
    evenness: S > 1 ? shannon / log(S) : NaN,
    simpson,
    simpsonUnbiased: N > 1 ? sum(n.map((x) => x * (x - 1))) / (N * (N - 1)) : NaN,
    hill0: S,
    hill1: Math.exp(-sum(p.map((x) => x * Math.log(x)))),
    hill2: 1 / simpson,
    bergerParker: Math.max(...n) / N,
  };
}

export function indicesResult(abundances: readonly number[], base: 'e' | '2'): CalcResult {
  const r = indices(abundances, base);
  const logName = base === '2' ? 'log₂' : 'ln';
  return {
    rows: [
      { label: 'diversity.r.richness', value: r.S },
      { label: 'diversity.r.total', value: r.N },
      { label: 'diversity.r.shannon', vars: { log: logName }, value: r.shannon },
      { label: 'diversity.r.evenness', value: r.evenness },
      { label: 'diversity.r.simpson', value: r.simpson },
      { label: 'diversity.r.simpsonUnbiased', value: r.simpsonUnbiased },
      { label: 'diversity.r.gini', value: 1 - r.simpson },
      { label: 'diversity.r.inverse', value: r.hill2 },
      { label: 'diversity.r.hill', vars: { q: 1 }, value: r.hill1 },
      { label: 'diversity.r.bergerParker', value: r.bergerParker },
    ],
    steps: [
      { key: 'diversity.s.proportions', vars: { N: r.N, S: r.S } },
      {
        key: 'diversity.s.shannon',
        vars: { log: logName, H: r.shannon },
        math: `H' = -\\sum_i p_i \\${base === '2' ? 'log_2' : 'ln'} p_i`,
      },
      { key: 'diversity.s.evenness', vars: { log: logName, H: r.shannon, S: r.S, J: r.evenness } },
      { key: 'diversity.s.simpson', vars: { D: r.simpson, U: r.simpsonUnbiased }, math: '\\lambda = \\sum_i p_i^2' },
      { key: 'diversity.s.hill', vars: { h0: r.hill0, h1: r.hill1, h2: r.hill2 } },
    ],
    latex: `H' = -\\sum_i p_i \\ln p_i`,
    table: {
      header: [
        { key: 'diversity.t.species' },
        { key: 'diversity.t.count' },
        { key: 'diversity.t.p' },
        { key: 'diversity.t.term' },
      ],
      rows: counts(abundances).map((x, i) => {
        const p = x / r.N;
        return [i + 1, x, p, -p * (base === '2' ? Math.log2(p) : Math.log(p))];
      }),
    },
  };
}

/** Chao1 richness: S + F1²/(2 F2), or the bias-corrected S + ((N - 1)/N) F1(F1 - 1)/2 when F2 = 0. */
export function chao1(abundances: readonly number[]): { estimate: number; F1: number; F2: number; S: number } {
  const n = counts(abundances);
  const N = sum(n);
  const F1 = n.filter((x) => x === 1).length;
  const F2 = n.filter((x) => x === 2).length;
  const S = n.length;
  const estimate = F2 > 0 ? S + (F1 * F1) / (2 * F2) : S + ((N - 1) / N) * ((F1 * (F1 - 1)) / 2);
  return { estimate, F1, F2, S };
}

/** ACE richness with the rare cutoff of 10 individuals (Chao and Lee 1992). */
export function ace(
  abundances: readonly number[],
  cutoff = 10,
): { estimate: number; coverage: number; gamma2: number } {
  const n = counts(abundances);
  const rare = n.filter((x) => x <= cutoff);
  const sAbund = n.length - rare.length;
  if (rare.length === 0) return { estimate: n.length, coverage: 1, gamma2: 0 };
  const nRare = sum(rare);
  const F1 = rare.filter((x) => x === 1).length;
  const coverage = 1 - F1 / nRare;
  if (coverage <= 0) throw new LsError('diversity.e.aceSingletons');
  let weighted = 0;
  for (let i = 1; i <= cutoff; i += 1) weighted += i * (i - 1) * rare.filter((x) => x === i).length;
  const gamma2 = nRare > 1 ? Math.max(((rare.length / coverage) * weighted) / (nRare * (nRare - 1)) - 1, 0) : 0;
  return { estimate: sAbund + rare.length / coverage + (F1 / coverage) * gamma2, coverage, gamma2 };
}

export function richnessResult(abundances: readonly number[]): CalcResult {
  const c = chao1(abundances);
  const a = ace(abundances);
  return {
    rows: [
      { label: 'diversity.r.richness', value: c.S },
      { label: 'diversity.r.chao1', value: c.estimate },
      { label: 'diversity.r.ace', value: a.estimate },
      { label: 'diversity.r.coverage', value: a.coverage },
    ],
    steps: [
      {
        key: c.F2 > 0 ? 'diversity.s.chao1' : 'diversity.s.chao1bc',
        vars: { S: c.S, F1: c.F1, F2: c.F2, est: c.estimate },
        math: 'S_{Chao1} = S_{obs} + \\frac{F_1^2}{2F_2}',
      },
      { key: 'diversity.s.ace', vars: { C: a.coverage, g: a.gamma2, est: a.estimate } },
    ],
    latex: 'S_{Chao1} = S_{obs} + \\frac{F_1^2}{2F_2}',
  };
}

/** Hurlbert's expected species in a subsample of n individuals, in log space. */
export function rarefy(abundances: readonly number[], n: number): number {
  const counted = counts(abundances);
  const N = sum(counted);
  whole(n, 'n', 1);
  if (n > N) throw new LsError('diversity.e.subsample', { N });
  const lnAll = lnChoose(N, n);
  return sum(counted.map((Ni) => (N - Ni < n ? 1 : 1 - Math.exp(lnChoose(N - Ni, n) - lnAll))));
}

export function rarefactionResult(abundances: readonly number[], n: number): CalcResult {
  const N = sum(counts(abundances));
  const expected = rarefy(abundances, n);
  const step = Math.max(1, Math.floor(N / 80));
  const points: [number, number][] = [];
  for (let m = 1; m <= N; m += step) points.push([m, rarefy(abundances, m)]);
  if (points[points.length - 1][0] !== N) points.push([N, rarefy(abundances, N)]);
  return {
    rows: [{ label: 'diversity.r.rarefied', vars: { n }, value: expected }],
    steps: [
      {
        key: 'diversity.s.rarefy',
        vars: { n, N, E: expected },
        math: 'E(S_n) = \\sum_i \\left[1 - \\binom{N-N_i}{n} \\Big/ \\binom{N}{n}\\right]',
      },
    ],
    latex: 'E(S_n) = \\sum_i \\left[1 - \\binom{N-N_i}{n} \\Big/ \\binom{N}{n}\\right]',
    plots: [
      {
        title: 'diversity.p.rarefaction',
        x: { label: 'diversity.p.individuals' },
        y: { label: 'diversity.p.species' },
        series: [{ name: 'diversity.p.expected', points }],
      },
    ],
  };
}

/** Mean species-accumulation curve over random site orders, with a 95% band (2.5th and 97.5th percentiles). */
export function accumulation(table: readonly (readonly number[])[], runs: number, seed: number) {
  whole(runs, 'runs', 1);
  const sites = table[0]?.length ?? 0;
  if (sites < 2) throw new LsError('diversity.e.sites');
  const rng = createRng(seed);
  const curves: number[][] = [];
  const order = Array.from({ length: sites }, (_, i) => i);
  for (let r = 0; r < runs; r += 1) {
    const seen = new Set<number>();
    const curve: number[] = [];
    for (const site of rng.shuffle(order)) {
      table.forEach((row, species) => row[site] > 0 && seen.add(species));
      curve.push(seen.size);
    }
    curves.push(curve);
  }
  const at = (k: number, q: number) => {
    const sorted = curves.map((c) => c[k]).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  };
  return Array.from({ length: sites }, (_, k) => ({
    sites: k + 1,
    mean: sum(curves.map((c) => c[k])) / runs,
    low: at(k, 0.025),
    high: at(k, 0.975),
  }));
}

export function accumulationResult(table: readonly (readonly number[])[], runs: number, seed: number): CalcResult {
  const curve = accumulation(table, runs, seed);
  const last = curve[curve.length - 1];
  return {
    rows: [
      { label: 'diversity.r.allSites', value: last.mean },
      { label: 'diversity.r.firstSite', value: curve[0].mean },
    ],
    steps: [{ key: 'diversity.s.accumulation', vars: { runs, seed, sites: curve.length } }],
    plots: [
      {
        title: 'diversity.p.accumulation',
        x: { label: 'diversity.p.sites' },
        y: { label: 'diversity.p.species' },
        series: [
          { name: 'diversity.p.mean', points: curve.map((c) => [c.sites, c.mean]) },
          { name: 'diversity.p.low', points: curve.map((c) => [c.sites, c.low]), style: 'dashed' },
          { name: 'diversity.p.high', points: curve.map((c) => [c.sites, c.high]), style: 'dashed' },
        ],
      },
    ],
    table: {
      header: [
        { key: 'diversity.t.sites' },
        { key: 'diversity.t.mean' },
        { key: 'diversity.t.low' },
        { key: 'diversity.t.high' },
      ],
      rows: curve.map((c) => [c.sites, c.mean, c.low, c.high]),
    },
  };
}

export type Similarity = 'jaccard' | 'sorensen' | 'brayCurtis' | 'morisitaHorn';

/** Similarity (Jaccard, Sørensen, Morisita-Horn) or dissimilarity (Bray-Curtis) of two sites. */
export function similarity(x: readonly number[], y: readonly number[], kind: Similarity): number {
  if (x.length !== y.length) throw new LsError('diversity.e.lengths');
  [...x, ...y].forEach((v) => nonNegative(v, 'n'));
  const a = x.filter((v, i) => v > 0 && y[i] > 0).length;
  const b = x.filter((v, i) => v > 0 && !(y[i] > 0)).length;
  const c = y.filter((v, i) => v > 0 && !(x[i] > 0)).length;
  if (kind === 'jaccard') return a + b + c === 0 ? NaN : a / (a + b + c);
  if (kind === 'sorensen') return 2 * a + b + c === 0 ? NaN : (2 * a) / (2 * a + b + c);
  const X = sum(x);
  const Y = sum(y);
  if (kind === 'brayCurtis') return X + Y === 0 ? NaN : sum(x.map((v, i) => Math.abs(v - y[i]))) / (X + Y);
  const dx = sum(x.map((v) => v * v)) / (X * X);
  const dy = sum(y.map((v) => v * v)) / (Y * Y);
  return (2 * sum(x.map((v, i) => v * y[i]))) / ((dx + dy) * X * Y);
}

export function similarityResult(table: readonly (readonly number[])[], kind: Similarity): CalcResult {
  const sites = table[0]?.length ?? 0;
  if (sites < 2 || table.some((row) => row.length !== sites)) throw new LsError('diversity.e.sites');
  const column = (j: number) => table.map((row) => row[j]);
  const matrix = Array.from({ length: sites }, (_, i) =>
    Array.from({ length: sites }, (_, j) => similarity(column(i), column(j), kind)),
  );
  const steps: Step[] = [{ key: `diversity.s.${kind}` }];
  return {
    rows: [{ label: `diversity.r.${kind}`, vars: { a: 1, b: 2 }, value: matrix[0][1] }],
    steps,
    table: {
      header: [
        { key: 'diversity.t.site' },
        ...matrix.map((_, j) => ({ key: 'diversity.t.siteN' as const, vars: { n: j + 1 } })),
      ],
      rows: matrix.map((row, i) => [i + 1, ...row]),
    },
  };
}

/** Quadrat summaries: per species, the count, the quadrats it was in and its cover, over q quadrats of an area. */
export function quadrats(rows: readonly (readonly number[])[], q: number, area: number) {
  whole(q, 'q', 1);
  positive(area, 'A');
  const species = rows.map(([count, occupied, cover]) => {
    nonNegative(count, 'n');
    if (!(occupied >= 0 && occupied <= q)) throw new LsError('diversity.e.occupied', { q });
    return { density: count / (q * area), frequency: occupied / q, cover: (cover ?? 0) / q };
  });
  const total = (key: 'density' | 'frequency' | 'cover') => sum(species.map((s) => s[key]));
  const td = total('density');
  const tf = total('frequency');
  const tc = total('cover');
  return species.map((s) => {
    const rd = td > 0 ? (100 * s.density) / td : 0;
    const rf = tf > 0 ? (100 * s.frequency) / tf : 0;
    const rc = tc > 0 ? (100 * s.cover) / tc : 0;
    return { ...s, rd, rf, rc, importance: rd + rf + rc };
  });
}

export function quadratResult(
  labels: readonly string[],
  rows: readonly (readonly number[])[],
  q: number,
  area: number,
): CalcResult {
  const out = quadrats(rows, q, area);
  const top = out.reduce((best, s, i) => (s.importance > out[best].importance ? i : best), 0);
  return {
    rows: [
      { label: 'diversity.r.topSpecies', value: labels[top] || String(top + 1) },
      { label: 'diversity.r.topImportance', value: out[top].importance },
    ],
    steps: [{ key: 'diversity.s.quadrat', vars: { q, A: area } }, { key: 'diversity.s.importance' }],
    table: {
      header: (['species', 'density', 'frequency', 'cover', 'rd', 'rf', 'rc', 'iv'] as const).map((k) => ({
        key: `diversity.t.${k}` as const,
      })),
      rows: out.map((s, i) => [
        labels[i] || String(i + 1),
        s.density,
        s.frequency,
        s.cover,
        s.rd,
        s.rf,
        s.rc,
        s.importance,
      ]),
    },
  };
}

/** Point-centered quarter: density 1/d̄² from the four nearest-plant distances at each point. */
export function pointQuarter(rows: readonly (readonly number[])[]): { mean: number; density: number; n: number } {
  const distances = rows.flat();
  distances.forEach((d) => positive(d, 'd'));
  if (rows.some((row) => row.length !== 4)) throw new LsError('diversity.e.quarters');
  const mean = sum(distances) / distances.length;
  return { mean, density: 1 / (mean * mean), n: distances.length };
}

export function pointQuarterResult(rows: readonly (readonly number[])[], unit: string): CalcResult {
  const r = pointQuarter(rows);
  return {
    rows: [
      { label: 'diversity.r.meanDistance', value: r.mean, unit },
      { label: 'diversity.r.density', value: r.density, unit: `/${unit}²` },
    ],
    steps: [
      {
        key: 'diversity.s.pointQuarter',
        vars: { n: r.n, d: r.mean, D: r.density, unit },
        math: 'D = 1/\\bar d^{\\,2}',
      },
    ],
    latex: 'D = \\frac{1}{\\bar d^{\\,2}}',
  };
}

/** Variance-to-mean ratio with its chi-square test, and Morisita's index of dispersion. */
export function dispersion(values: readonly number[]) {
  values.forEach((v) => whole(v, 'x'));
  const n = values.length;
  if (n < 2) throw new LsError('errors.points', { min: 2 });
  const N = sum(values);
  if (N === 0) throw new LsError('diversity.e.empty');
  const mean = N / n;
  const variance = sum(values.map((v) => (v - mean) ** 2)) / (n - 1);
  const chi2 = ((n - 1) * variance) / mean;
  const upper = 1 - chiSquareCdf(chi2, n - 1);
  const morisita = N > 1 ? (n * sum(values.map((v) => v * (v - 1)))) / (N * (N - 1)) : NaN;
  return { n, mean, variance, vmr: variance / mean, chi2, df: n - 1, upper, lower: 1 - upper, morisita };
}

export function dispersionResult(values: readonly number[]): CalcResult {
  const r = dispersion(values);
  const pattern = r.upper < 0.025 ? 'clumped' : r.lower < 0.025 ? 'uniform' : 'random';
  return {
    rows: [
      { label: 'diversity.r.mean', value: r.mean },
      { label: 'diversity.r.variance', value: r.variance },
      { label: 'diversity.r.vmr', value: r.vmr },
      { label: 'diversity.r.chi2', vars: { df: r.df }, value: r.chi2 },
      { label: 'diversity.r.pUpper', value: r.upper, digits: 4 },
      { label: 'diversity.r.pLower', value: r.lower, digits: 4 },
      { label: 'diversity.r.morisita', value: r.morisita },
    ],
    steps: [
      { key: 'diversity.s.vmr', vars: { n: r.n, m: r.mean, v: r.variance, vmr: r.vmr } },
      {
        key: 'diversity.s.chi2',
        vars: { chi2: r.chi2, df: r.df, p: r.upper },
        math: '\\chi^2 = \\frac{(n-1)s^2}{\\bar x}',
      },
      { key: 'diversity.s.morisita', vars: { I: r.morisita } },
    ],
    notes: [{ key: `diversity.n.${pattern}` }],
    latex: '\\chi^2 = \\frac{(n-1)s^2}{\\bar x}',
  };
}

/** The chi-square quantile, by bisection on the distribution function. */
function chiQuantile(p: number, df: number): number {
  return brent((x) => gammaP(df / 2, x / 2) - p, 1e-12, 10 * df + 100);
}

/** Lincoln-Petersen and Chapman estimates with the Chapman variance and a normal 95% interval. */
export function petersen(M: number, C: number, R: number) {
  whole(M, 'M', 1);
  whole(C, 'C', 1);
  whole(R, 'R', 0);
  if (R > C || R > M) throw new LsError('diversity.e.recaptures');
  const lincoln = R > 0 ? (M * C) / R : Infinity;
  const chapman = ((M + 1) * (C + 1)) / (R + 1) - 1;
  const variance = ((M + 1) * (C + 1) * (M - R) * (C - R)) / ((R + 1) ** 2 * (R + 2));
  const half = 1.959964 * Math.sqrt(variance);
  return { lincoln, chapman, se: Math.sqrt(variance), low: chapman - half, high: chapman + half };
}

export function petersenResult(M: number, C: number, R: number): CalcResult {
  const r = petersen(M, C, R);
  return {
    rows: [
      { label: 'diversity.r.lincoln', value: r.lincoln },
      { label: 'diversity.r.chapman', value: r.chapman },
      { label: 'diversity.r.se', value: r.se },
      { label: 'diversity.r.ci', value: interval(r.low, r.high) },
    ],
    steps: [
      { key: 'diversity.s.lincoln', vars: { M, C, R, N: r.lincoln }, math: '\\hat N = \\frac{MC}{R}' },
      { key: 'diversity.s.chapman', vars: { M, C, R, N: r.chapman }, math: '\\hat N = \\frac{(M+1)(C+1)}{R+1} - 1' },
    ],
    notes: [{ key: 'diversity.n.closed' }],
    latex: '\\hat N = \\frac{(M+1)(C+1)}{R+1} - 1',
  };
}

/** Schnabel (with Chapman's +1) and Schumacher-Eschmeyer estimates from samples of C caught and R recaptured. */
export function schnabel(samples: readonly (readonly number[])[]) {
  if (samples.length < 2) throw new LsError('diversity.e.samples');
  let marked = 0;
  let sumCM = 0;
  let sumR = 0;
  let sumCM2 = 0;
  let sumRM = 0;
  let sumR2C = 0;
  for (const [C, R] of samples) {
    whole(C, 'C', 1);
    whole(R, 'R', 0);
    if (R > C || R > marked) throw new LsError('diversity.e.recaptures');
    sumCM += C * marked;
    sumR += R;
    sumCM2 += C * marked * marked;
    sumRM += R * marked;
    sumR2C += (R * R) / C;
    marked += C - R;
  }
  if (sumR === 0) throw new LsError('diversity.e.noRecaptures');
  const N = sumCM / (sumR + 1);
  // A Poisson interval on the recaptures (chi-square), turned into one on N.
  const rLow = chiQuantile(0.025, 2 * sumR) / 2;
  const rHigh = chiQuantile(0.975, 2 * sumR + 2) / 2;
  const se = schumacher(samples.length, sumCM2, sumRM, sumR2C);
  return { N, low: sumCM / rHigh, high: sumCM / rLow, sumR, sumCM, ...se };
}

function schumacher(m: number, sumCM2: number, sumRM: number, sumR2C: number) {
  const NSE = sumCM2 / sumRM;
  if (m < 3) return { NSE, seLow: NaN, seHigh: NaN };
  const s2 = (sumR2C - (sumRM * sumRM) / sumCM2) / (m - 2);
  const seInv = Math.sqrt(Math.max(s2, 0) / sumCM2);
  const t = tQuantile(0.975, m - 2);
  const inv = 1 / NSE;
  return { NSE, seLow: 1 / (inv + t * seInv), seHigh: inv - t * seInv > 0 ? 1 / (inv - t * seInv) : Infinity };
}

export function schnabelResult(samples: readonly (readonly number[])[]): CalcResult {
  const r = schnabel(samples);
  return {
    rows: [
      { label: 'diversity.r.schnabel', value: r.N },
      { label: 'diversity.r.ci', value: interval(r.low, r.high) },
      { label: 'diversity.r.schumacher', value: r.NSE },
      { label: 'diversity.r.ci', value: interval(r.seLow, r.seHigh) },
    ],
    steps: [
      { key: 'diversity.s.marked' },
      {
        key: 'diversity.s.schnabel',
        vars: { cm: r.sumCM, r: r.sumR, N: r.N },
        math: '\\hat N = \\frac{\\sum C_t M_t}{\\sum R_t + 1}',
      },
      { key: 'diversity.s.schumacher', vars: { N: r.NSE }, math: '\\hat N = \\frac{\\sum C_t M_t^2}{\\sum R_t M_t}' },
    ],
    notes: [{ key: 'diversity.n.closed' }],
    latex: '\\hat N = \\frac{\\sum C_t M_t}{\\sum R_t + 1}',
  };
}
