// FORECAST.ETS and its kin: additive error, additive trend, additive season (AAA) exponential smoothing, the model the
// spreadsheet functions document. Owner: tables:fn-stats. Lazy chunk only.
//
// The timeline must have one step: the smallest gap between its sorted times, with every gap a whole number of steps.
// Repeated times are combined by the aggregation (1 average, 2 count, 3 count of values, 4 max, 5 median, 6 min,
// 7 sum), and missing steps are filled by straight lines between neighbors (completion 1) or with zeros (0).
//
// The season length is the argument, or found from the autocorrelation of the series once its line is removed (1).
// The start values come from a least-squares fit of a line plus a season, so a series that is exactly a line plus a
// season is forecast exactly. The smoothing weights alpha, beta, and gamma, each from 0 to 1, minimize the squared
// one-step errors: a coarse grid, then a few rounds of golden-section search on each weight.

import { asArray } from '../../arrays';
import { err, finish, isError, toNumber, type FormulaError, type Value } from '../../values';
import { normInv } from './distributionsKit';
import { leastSquares } from './regression';
import { failed, type Run } from './statsKit';

const MAX_SEASON = 8760;
/** The most steps a filled timeline may span; a wider one is #NUM!, so the work and memory stay bounded. */
export const MAX_SLOTS = 10000;

interface Series {
  readonly y: number[];
  readonly start: number;
  readonly step: number;
}

/** The numbers at one time, and how many items (numbers or not) were there, for aggregation 3. */
interface Group {
  readonly numbers: number[];
  items: number;
}

function aggregate(group: Group, how: number): number {
  const values = group.numbers;
  const s = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  switch (how) {
    case 2:
      return values.length;
    case 3:
      return group.items;
    case 4:
      return s[s.length - 1];
    case 5:
      return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    case 6:
      return s[0];
    case 7:
      return total;
    default:
      return total / values.length;
  }
}

/** The series on an even timeline, or an error when the timeline has no single step. */
function seriesOf(values: Value, timeline: Value, completion: number, how: number): Series | FormulaError {
  if (isError(values)) return values;
  if (isError(timeline)) return timeline;
  const v = asArray(values).data;
  const t = asArray(timeline).data;
  if (v.length !== t.length) return err('NA');
  const byTime = new Map<number, Group>();
  for (let i = 0; i < t.length; i++) {
    const [time, value] = [t[i], v[i]];
    if (isError(time)) return time;
    if (isError(value)) return value;
    if (typeof time !== 'number') return err('VALUE');
    const group = byTime.get(time) ?? { numbers: [], items: 0 };
    if (typeof value === 'number') group.numbers.push(value);
    if (value !== null && value !== '') group.items += 1;
    byTime.set(time, group);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  if (times.length < 3) return err('NUM');
  let step = Infinity;
  for (let i = 1; i < times.length; i++) step = Math.min(step, times[i] - times[i - 1]);
  const span = Math.round((times[times.length - 1] - times[0]) / step);
  // Check the width before anything is allocated: one slot per step of a wide timeline would freeze the app.
  if (!(span < MAX_SLOTS)) return err('NUM');
  if (times.some((x) => Math.abs((x - times[0]) / step - Math.round((x - times[0]) / step)) > 1e-6)) return err('NUM');
  const slots: (number | null)[] = new Array<number | null>(span + 1).fill(null);
  for (const time of times) {
    const group = byTime.get(time) as Group;
    const counted = how === 3 ? group.items : group.numbers.length;
    if (counted > 0) slots[Math.round((time - times[0]) / step)] = aggregate(group, how);
  }
  return { y: fill(slots, completion), start: times[0], step };
}

/** Fills missing slots with zeros or by straight lines between known neighbors, in one pass. */
export function fill(slots: readonly (number | null)[], completion: number): number[] {
  if (completion === 0) return slots.map((x) => x ?? 0);
  const out = new Array<number>(slots.length);
  let before = -1;
  for (let i = 0; i < slots.length; i++) {
    const x = slots[i];
    if (x === null) continue;
    out[i] = x;
    // Fill the gap since the last known slot: flat before the first one, a straight line between two.
    const from = before < 0 ? x : (slots[before] as number);
    for (let j = before + 1; j < i; j++) out[j] = before < 0 ? x : from + ((x - from) * (j - before)) / (i - before);
    before = i;
  }
  const last = before < 0 ? 0 : (slots[before] as number);
  for (let j = before + 1; j < slots.length; j++) out[j] = last;
  return out;
}

/** The season length with the strongest autocorrelation peak of the series less its line, or 1 for none. */
export function detectSeason(y: number[]): number {
  const n = y.length;
  const line = leastSquares([y.map((_, i) => i)], y, true);
  const r = y.map((v, i) => v - line.intercept - line.coef[0] * i);
  const var0 = r.reduce((s, x) => s + x * x, 0);
  if (var0 <= 1e-12 * y.reduce((s, x) => s + x * x, 0)) return 1;
  const acf = (lag: number) => {
    let s = 0;
    for (let i = lag; i < n; i++) s += r[i] * r[i - lag];
    return s / var0;
  };
  const values = Array.from({ length: Math.min(MAX_SEASON, Math.floor(n / 2)) + 2 }, (_, lag) =>
    lag < 1 ? 1 : acf(lag),
  );
  let best = 1;
  let top = 0.2;
  for (let lag = 2; lag <= Math.min(MAX_SEASON, Math.floor(n / 2)); lag++) {
    const peak = values[lag] >= values[lag - 1] && values[lag] >= (values[lag + 1] ?? -Infinity);
    if (peak && values[lag] > top + 1e-9) {
      best = lag;
      top = values[lag];
    }
  }
  return best;
}

interface Model {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly m: number;
  readonly level: number;
  readonly trend: number;
  readonly season: number[];
  /** One-step predictions, one per observation. */
  readonly fitted: number[];
  readonly sse: number;
}

interface Start {
  readonly level: number;
  readonly trend: number;
  readonly season: readonly number[];
}

/**
 * Start values from the least-squares fit of a line plus one intercept per season position. The slope is the
 * within-position estimate: the sum of (i - mean i of its position)(y - mean y of its position) over the sum of the
 * squares. Each position's intercept is its mean y less the slope times its mean i. This is O(n), where a fit with
 * m - 1 dummy columns is O(n m^2).
 */
export function startOf(y: readonly number[], m: number): Start {
  const k = Math.max(1, m);
  const count = new Array<number>(k).fill(0);
  const sumI = new Array<number>(k).fill(0);
  const sumY = new Array<number>(k).fill(0);
  y.forEach((v, i) => {
    count[i % k] += 1;
    sumI[i % k] += i;
    sumY[i % k] += v;
  });
  let sxy = 0;
  let sxx = 0;
  y.forEach((v, i) => {
    const p = i % k;
    const di = i - sumI[p] / count[p];
    sxy += di * (v - sumY[p] / count[p]);
    sxx += di * di;
  });
  const trend = sxx > 0 ? sxy / sxx : 0;
  const intercepts = count.map((c, p) => (c > 0 ? (sumY[p] - trend * sumI[p]) / c : 0));
  const shift = intercepts.reduce((a, b) => a + b, 0) / k;
  return { level: shift - trend, trend, season: intercepts.map((g) => g - shift) };
}

function run(y: number[], m: number, alpha: number, beta: number, gamma: number, st: Start): Model {
  let { level, trend } = st;
  const season = m > 1 ? [...st.season] : [0];
  const fitted: number[] = [];
  let sse = 0;
  for (let i = 0; i < y.length; i++) {
    const p = m > 1 ? i % m : 0;
    const prediction = level + trend + season[p];
    fitted.push(prediction);
    sse += (y[i] - prediction) ** 2;
    const before = level;
    level = alpha * (y[i] - season[p]) + (1 - alpha) * (level + trend);
    trend = beta * (level - before) + (1 - beta) * trend;
    if (m > 1) season[p] = gamma * (y[i] - level) + (1 - gamma) * season[p];
  }
  return { alpha, beta, gamma, m, level, trend, season, fitted, sse };
}

const PHI = (Math.sqrt(5) - 1) / 2;

/** Minimizes f on [0, 1] by golden-section search around a start. */
function golden(f: (x: number) => number, start: number): number {
  let [a, b] = [Math.max(0, start - 0.1), Math.min(1, start + 0.1)];
  for (let i = 0; i < 30; i++) {
    const c = b - PHI * (b - a);
    const d = a + PHI * (b - a);
    if (f(c) <= f(d)) b = d;
    else a = c;
  }
  return (a + b) / 2;
}

export function fitModel(y: number[], m: number): Model {
  const grid = [0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99];
  const gammas = m > 1 ? grid : [0];
  // The start values do not depend on the weights, so they are fitted once.
  const st = startOf(y, m);
  let best = run(y, m, 0.5, 0.1, 0, st);
  for (const a of grid) {
    for (const b of grid) {
      for (const g of gammas) {
        const model = run(y, m, a, b, g, st);
        if (model.sse < best.sse) best = model;
      }
    }
  }
  let { alpha, beta, gamma } = best;
  for (let round = 0; round < 3; round++) {
    alpha = golden((x) => run(y, m, x, beta, gamma, st).sse, alpha);
    beta = golden((x) => run(y, m, alpha, x, gamma, st).sse, beta);
    if (m > 1) gamma = golden((x) => run(y, m, alpha, beta, x, st).sse, gamma);
  }
  const refined = run(y, m, alpha, beta, gamma, st);
  return refined.sse <= best.sse ? refined : best;
}

/** The forecast h steps past the last observation. */
function forecastAt(model: Model, n: number, h: number): number {
  const p = model.m > 1 ? (((n - 1 + Math.round(h)) % model.m) + model.m) % model.m : 0;
  return model.level + h * model.trend + model.season[p];
}

interface Options {
  readonly series: Series;
  readonly model: Model;
}

/** Reads values, timeline, and the optional season, completion, and aggregation arguments. */
function prepare(values: Value, timeline: Value, extra: (Value | undefined)[]): Options | FormulaError {
  const nums: number[] = [];
  for (const [i, fallback] of [1, 1, 1].entries()) {
    const v = extra[i];
    if (v === undefined || v === null) {
      nums.push(fallback);
      continue;
    }
    const n = toNumber(v);
    if (typeof n !== 'number') return n;
    nums.push(Math.trunc(n));
  }
  const [seasonArg, completion, how] = nums;
  if (seasonArg < 0 || seasonArg > MAX_SEASON || completion < 0 || completion > 1 || how < 1 || how > 7) {
    return err('NUM');
  }
  const series = seriesOf(values, timeline, completion, how);
  if (failed(series)) return series;
  const m = seasonArg === 1 ? detectSeason(series.y) : Math.max(1, seasonArg);
  if (series.y.length < 2 * m || series.y.length < 3) return err('NUM');
  return { series, model: fitModel(series.y, m) };
}

function stepsTo(target: Value, s: Series): number | FormulaError {
  const t = toNumber(target);
  if (typeof t !== 'number') return t;
  const last = s.start + (s.y.length - 1) * s.step;
  if (t < last) return err('NUM');
  return (t - last) / s.step;
}

const forecast: Run = ([target, values, timeline, ...rest]) => {
  const o = prepare(values, timeline, rest);
  if (failed(o)) return o;
  const h = stepsTo(target, o.series);
  return isError(h) ? h : finish(forecastAt(o.model, o.series.y.length, h));
};

const confint: Run = ([target, values, timeline, levelV, ...rest]) => {
  const o = prepare(values, timeline, rest);
  if (failed(o)) return o;
  const h = stepsTo(target, o.series);
  if (isError(h)) return h;
  const level = levelV === undefined || levelV === null ? 0.95 : toNumber(levelV);
  if (typeof level !== 'number') return level;
  if (level <= 0 || level >= 1) return err('NUM');
  const { alpha, beta, gamma, m, sse } = o.model;
  const sigma2 = sse / o.series.y.length;
  return finish(normInv((1 + level) / 2) * Math.sqrt(sigma2 * varianceFactor(alpha, beta, gamma, m, h)));
};

/**
 * The variance factor of an h-step forecast for the AAA model: 1 + the sum of c_j^2 for 1 <= j < round(h). Here
 * c_j = A + B j, plus G on whole seasons, with A = alpha, B = alpha beta, and G = gamma (1 - alpha). The sum has a
 * closed form, so a far target costs no more than a near one.
 */
export function varianceFactor(alpha: number, beta: number, gamma: number, m: number, h: number): number {
  const n = Math.max(1, Math.round(h)) - 1;
  const [a, b, g] = [alpha, alpha * beta, gamma * (1 - alpha)];
  const s1 = (n * (n + 1)) / 2;
  const s2 = (n * (n + 1) * (2 * n + 1)) / 6;
  let factor = 1 + n * a * a + 2 * a * b * s1 + b * b * s2;
  if (m > 1) {
    // On j = m q for q = 1..Q, each c_j^2 gains 2 G (A + B m q) + G^2.
    const q = Math.floor(n / m);
    factor += q * (2 * g * a + g * g) + g * b * m * q * (q + 1);
  }
  return factor;
}

const seasonality: Run = ([values, timeline, completion, how]) => {
  const o = prepare(values, timeline, [1, completion, how]);
  return failed(o) ? o : o.model.m;
};

function errors(o: Options): { mae: number; rmse: number; smape: number; mase: number } {
  const { y } = o.series;
  const e = y.map((v, i) => v - o.model.fitted[i]);
  const n = y.length;
  const mae = e.reduce((s, x) => s + Math.abs(x), 0) / n;
  const rmse = Math.sqrt(e.reduce((s, x) => s + x * x, 0) / n);
  const smape =
    y.reduce((s, v, i) => {
      const d = Math.abs(v) + Math.abs(o.model.fitted[i]);
      return s + (d === 0 ? 0 : (2 * Math.abs(e[i])) / d);
    }, 0) / n;
  const naive = y.slice(1).reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / (n - 1);
  return { mae, rmse, smape, mase: naive === 0 ? NaN : mae / naive };
}

const stat: Run = ([values, timeline, typeV, ...rest]) => {
  const type = toNumber(typeV ?? null);
  if (typeof type !== 'number') return type;
  const o = prepare(values, timeline, rest);
  if (failed(o)) return o;
  const k = Math.trunc(type);
  const e = errors(o);
  const pick = [o.model.alpha, o.model.beta, o.model.gamma, e.mase, e.smape, e.mae, e.rmse, o.series.step][k - 1];
  return pick === undefined ? err('NUM') : finish(pick);
};

export const runs: Readonly<Record<string, Run>> = {
  'FORECAST.ETS': forecast,
  'FORECAST.ETS.CONFINT': confint,
  'FORECAST.ETS.SEASONALITY': seasonality,
  'FORECAST.ETS.STAT': stat,
};
