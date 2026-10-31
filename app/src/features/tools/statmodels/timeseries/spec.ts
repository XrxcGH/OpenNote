// The time series and forecasting tool. It takes a value column in time order, with an optional time column for the
// axis. It explores the series with transformations, correlograms, and Ljung-Box tests. It also decomposes the
// series, forecasts it by smoothing or ARIMA, and tests for trend (Mann-Kendall, Sen's slope, Dickey-Fuller).
import { completeRows, numbersAt, parseTable } from '../kit/data';
import { mean, variance } from '../kit/linalg';
import type { Outcome, Picture, ResultRow, ToolSpec, Values } from '../kit/spec';
import { fail, step } from '../kit/types';
import {
  acf,
  adf,
  decompose,
  difference,
  ljungBox,
  mannKendall,
  movingAverage,
  pacf,
  periodogram,
  type AdfKind,
} from './engine';
import { accuracy, arimaForecast, fitArima, smooth, type Accuracy, type SmoothingMethod } from './models';

const MONTHLY =
  'month,sales\n1,112\n2,118\n3,132\n4,129\n5,121\n6,135\n7,148\n8,148\n9,136\n10,119\n11,104\n12,118\n13,115\n' +
  '14,126\n15,141\n16,135\n17,125\n18,149\n19,170\n20,170\n21,158\n22,133\n23,114\n24,140';
const TEMPERATURE =
  'year,anomaly\n1,5.1\n2,5.3\n3,5.2\n4,5.8\n5,6.0\n6,5.9\n7,6.4\n8,6.6\n9,6.5\n10,7.0\n11,6.9\n12,7.3\n13,7.2\n' +
  '14,7.6\n15,7.5';

const is =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(String(v.analysis));
const pts = (xs: readonly number[], ys: readonly number[]) =>
  ys.map((v, i) => [xs[i], v] as [number, number]).filter(([, v]) => Number.isFinite(v));

interface Series {
  readonly y: number[];
  readonly t: number[];
  readonly name: string;
}

function readSeries(values: Values): Series {
  const table = parseTable(String(values.data));
  const name = String(values.value);
  const timeName = String(values.time);
  if (timeName === name) fail('sameColumn');
  const rows = completeRows(table, timeName ? [name, timeName] : [name]);
  const y = numbersAt(table, name, rows);
  const t = timeName ? numbersAt(table, timeName, rows) : y.map((_, i) => i + 1);
  if (y.length < 4) fail('shortSeries', '4');
  if (t.some((v, i) => i > 0 && !(v > t[i - 1]))) fail('timeOrder');
  return { y, t, name };
}

function transformed(y: readonly number[], kind: string, period: number, window: number): number[] {
  if (kind === 'log') {
    if (y.some((v) => v <= 0)) fail('logPositive', 'the series');
    return y.map(Math.log);
  }
  if (kind === 'diff') return [NaN, ...difference(y)];
  if (kind === 'seasonal') {
    if (y.length <= period + 3) fail('shortSeries', String(period + 4));
    return [...new Array<number>(period).fill(NaN), ...difference(y, period)];
  }
  if (kind === 'ma') return movingAverage(y, window);
  return [...y];
}

function exploreOutcome(values: Values): Outcome {
  const { y, t } = readSeries(values);
  const period = Number(values.period);
  const z = transformed(y, String(values.transform), period, Number(values.window));
  const used = z.filter(Number.isFinite);
  if (used.length < 4) fail('shortSeries', '4');
  const lags = Math.min(Number(values.lags), used.length - 1);
  const r = acf(used, lags);
  const pr = pacf(r);
  const lb = ljungBox(used, lags);
  const band = 1.96 / Math.sqrt(used.length);
  const m = mean(used);
  const d = used.map((v) => v - m);
  const c0 = d.reduce((s, v) => s + v * v, 0);
  const c1 = d.slice(1).reduce((s, v, i) => s + v * d[i], 0);
  const lagIdx = r.map((_, k) => k + 1);
  const spec = periodogram(used);
  const peak = spec.reduce((best, q) => (q.power > best.power ? q : best), spec[0]);
  return {
    rows: [
      { id: 'r1', value: r[0], answer: true, sym: 'r_1' },
      { id: 'r2', value: r[1] ?? NaN, sym: 'r_2' },
      { id: 'lbQ', value: lb.q, sym: 'Q' },
      { id: 'lbDf', value: lb.df },
      { id: 'lbP', value: lb.p },
      { id: 'mean', value: m },
      { id: 'sd', value: Math.sqrt(variance(used)) },
      { id: 'n', value: used.length },
      { id: 'peakFreq', value: peak.freq },
      { id: 'peakPeriod', value: 1 / peak.freq },
    ],
    tables: [
      { id: 'acf', columns: ['lag', 'acf', 'pacf'], rows: r.map((v, k) => [k + 1, v, pr[k]]) },
      { id: 'periodogram', columns: ['freq', 'cycle', 'power'], rows: spec.map((q) => [q.freq, 1 / q.freq, q.power]) },
    ],
    steps: [
      step(
        'timeseries.acf',
        'r_1 = \\frac{\\sum (x_t - \\bar x)(x_{t+1} - \\bar x)}{\\sum (x_t - \\bar x)^2} = \\frac{[[c1]]}{[[c0]]} = [[r1]]',
        {
          c1,
          c0,
          r1: r[0],
        },
      ),
      step('timeseries.band', '\\pm \\frac{1.96}{\\sqrt{n}} = \\pm [[band]]', { band }),
      step('timeseries.pacf', undefined, { p1: pr[0] }),
      step('timeseries.ljungBox', 'Q = n(n + 2)\\sum_{k=1}^{[[h]]} \\frac{r_k^2}{n - k} = [[q]]', {
        h: lb.df,
        q: lb.q,
        p: lb.p,
      }),
      step(
        'timeseries.periodogram',
        'I(f_j) = \\frac{1}{n}\\left|\\sum_t (x_t - \\bar x)\\, e^{-2\\pi i f_j t}\\right|^2,\\quad f_j = \\frac{j}{n}',
        { f: peak.freq, cycle: 1 / peak.freq, power: peak.power },
      ),
    ],
    words: step(lb.p < 0.05 ? 'timeseries.wordsCorrelated' : 'timeseries.wordsWhite', undefined, {
      h: lb.df,
      q: lb.q,
      p: lb.p,
    }),
    pictures: [
      {
        id: 'series',
        type: 'plot',
        plot: { x: { label: 'time' }, y: { label: 'value' }, series: [{ id: 'series', points: pts(t, z) }] },
      },
      {
        id: 'correlogram',
        type: 'plot',
        plot: {
          x: { label: 'lag' },
          y: { label: 'correlation' },
          series: [
            { id: 'acf', points: pts(lagIdx, r), style: 'points' },
            { id: 'pacf', points: pts(lagIdx, pr), style: 'points' },
          ],
          hlines: [0, band, -band],
          yRange: [-1, 1],
          legend: true,
        },
      },
      {
        id: 'periodogram',
        type: 'plot',
        plot: {
          x: { label: 'freq' },
          y: { label: 'power' },
          series: [{ id: 'power', points: spec.map((q) => [q.freq, q.power] as [number, number]) }],
          vlines: [peak.freq],
        },
      },
    ],
    notes: ['regular', 'stationaryAcf', 'rawPeriodogram'],
  };
}

function decomposeOutcome(values: Values): Outcome {
  const { y, t } = readSeries(values);
  const period = Number(values.period);
  const mult = values.decomposition === 'multiplicative';
  const d = decompose(y, period, mult);
  const finiteTrend = d.trend.filter(Number.isFinite);
  const firstT = d.trend.findIndex(Number.isFinite);
  return {
    rows: [
      { id: 'seasonRange', value: Math.max(...d.indices) - Math.min(...d.indices), answer: true },
      { id: 'trendStart', value: finiteTrend[0] },
      { id: 'trendEnd', value: finiteTrend[finiteTrend.length - 1] },
      { id: 'period', value: period },
      { id: 'n', value: y.length },
    ],
    tables: [{ id: 'indices', columns: ['season', 'index'], rows: d.indices.map((v, s) => [s + 1, v]) }],
    steps: [
      step(period % 2 === 0 ? 'timeseries.maEven' : 'timeseries.maOdd', '\\hat T_{[[t]]} = [[trend]]', {
        m: period,
        t: t[firstT],
        trend: d.trend[firstT],
      }),
      step(mult ? 'timeseries.detrendMult' : 'timeseries.detrendAdd', mult ? 'y_t / \\hat T_t' : 'y_t - \\hat T_t'),
      step(mult ? 'timeseries.indicesMult' : 'timeseries.indicesAdd', undefined, { first: d.indices[0] }),
      step(
        'timeseries.remainder',
        mult ? 'R_t = \\frac{y_t}{\\hat T_t \\hat S_t}' : 'R_t = y_t - \\hat T_t - \\hat S_t',
      ),
    ],
    words: step('timeseries.wordsDecompose', undefined, {
      high: d.indices.indexOf(Math.max(...d.indices)) + 1,
      low: d.indices.indexOf(Math.min(...d.indices)) + 1,
      range: Math.max(...d.indices) - Math.min(...d.indices),
    }),
    pictures: [
      {
        id: 'trend',
        type: 'plot',
        plot: {
          x: { label: 'time' },
          y: { label: 'value' },
          series: [
            { id: 'series', points: pts(t, y) },
            { id: 'trendLine', points: pts(t, d.trend) },
          ],
          legend: true,
        },
      },
      {
        id: 'seasonal',
        type: 'plot',
        plot: {
          x: { label: 'season' },
          y: { label: 'index' },
          series: [{ id: 'index', points: d.indices.map((v, s) => [s + 1, v] as [number, number]) }],
          hlines: [mult ? 1 : 0],
        },
      },
      {
        id: 'remainder',
        type: 'plot',
        plot: {
          x: { label: 'time' },
          y: { label: 'remainder' },
          series: [{ id: 'remainder', points: pts(t, d.remainder), style: 'points' }],
          hlines: [mult ? 1 : 0],
        },
      },
    ],
    notes: ['constantSeason', 'endsLost'],
  };
}

const accuracyRows = (a: Accuracy | null): ResultRow[] =>
  a
    ? [
        { id: 'mae', value: a.mae },
        { id: 'rmse', value: a.rmse },
        { id: 'mape', value: a.mape },
        { id: 'mase', value: a.mase },
      ]
    : [];

/** Fits on all but the last `holdout` values, forecasts them, and scores the forecasts. */
function holdoutScore(
  y: readonly number[],
  holdout: number,
  period: number,
  forecast: (train: number[], h: number) => number[],
) {
  if (holdout <= 0) return null;
  if (holdout > y.length - 4) fail('holdoutTooLong', String(y.length - 4));
  const train = y.slice(0, y.length - holdout);
  return accuracy(train, y.slice(y.length - holdout), forecast(train, holdout), period);
}

function forecastPicture(
  t: readonly number[],
  y: readonly number[],
  fitted: readonly number[],
  f: { forecast: number[]; low: number[]; high: number[] },
): Picture {
  const dt = t.length > 1 ? t[t.length - 1] - t[t.length - 2] : 1;
  const ft = f.forecast.map((_, h) => t[t.length - 1] + dt * (h + 1));
  const band = f.low.every(Number.isFinite)
    ? [{ points: ft.map((x, h) => [x, f.low[h], f.high[h]] as [number, number, number]), pen: 2 }]
    : [];
  return {
    id: 'forecast',
    type: 'plot',
    plot: {
      x: { label: 'time' },
      y: { label: 'value' },
      series: [
        { id: 'series', points: pts(t, y) },
        { id: 'fitted', points: pts(t, fitted), style: 'dashed' },
        { id: 'forecastLine', points: pts(ft, f.forecast), pen: 2 },
      ],
      bands: band,
      legend: true,
    },
  };
}

function smoothingOutcome(values: Values): Outcome {
  const { y, t } = readSeries(values);
  const method = String(values.method) as SmoothingMethod;
  const period = Number(values.period);
  const given = { alpha: Number(values.alpha), beta: Number(values.beta), gamma: Number(values.gamma) };
  const horizon = Number(values.horizon);
  const level = Number(values.level);
  const s = smooth(y, method, given, period, horizon, level);
  const score = holdoutScore(
    y,
    Number(values.holdout),
    period,
    (train, h) => smooth(train, method, given, period, h, level).forecast,
  );
  const first = s.fitted.findIndex(Number.isFinite);
  const showP = (k: 'beta' | 'gamma') => (k === 'beta' ? method !== 'ses' : method.startsWith('hw'));
  return {
    rows: [
      { id: 'next', value: s.forecast[0], answer: true, sym: '\\hat y_{n+1}' },
      { id: 'alpha', value: s.params.alpha, sym: '\\alpha' },
      ...(showP('beta') ? [{ id: 'beta', value: s.params.beta, sym: '\\beta' }] : []),
      ...(showP('gamma') ? [{ id: 'gamma', value: s.params.gamma, sym: '\\gamma' }] : []),
      { id: 'sigma', value: s.sigma },
      { id: 'sse', value: s.sse },
      ...accuracyRows(score),
    ],
    tables: [
      {
        id: 'forecasts',
        columns: ['h', 'forecast', 'low', 'high'],
        rows: s.forecast.map((f, h) => [h + 1, f, s.low[h], s.high[h]]),
      },
      {
        id: 'recursion',
        columns: ['t', 'y', 'fitted', 'level', 'trend'],
        rows: y
          .slice(first, first + 8)
          .map((v, i) => [t[first + i], v, s.fitted[first + i], s.level[first + i], s.trend[first + i]]),
      },
    ],
    steps: [
      step(`timeseries.${method}` as 'timeseries.ses', undefined, { period }),
      step('timeseries.firstUpdate', '\\hat y_{[[t]]} = [[f]],\\quad \\ell_{[[t]]} = [[l]]', {
        t: t[first],
        f: s.fitted[first],
        l: s.level[first],
      }),
      step(s.estimated.length ? 'timeseries.estimated' : 'timeseries.givenParams', undefined, {
        sse: s.sse,
        alpha: s.params.alpha,
      }),
      step('timeseries.smoothForecast', '\\hat y_{n+1} = [[f]]', { f: s.forecast[0] }),
      step(method === 'hwmult' ? 'timeseries.noInterval' : 'timeseries.interval', undefined, { sigma: s.sigma }),
    ],
    words: step('timeseries.wordsForecast', undefined, { f: s.forecast[0], lo: s.low[0], hi: s.high[0] }),
    pictures: [forecastPicture(t, y, s.fitted, s)],
    notes: ['regular', 'pastLikeFuture'],
  };
}

function arimaOutcome(values: Values): Outcome {
  const { y, t } = readSeries(values);
  const [p, d, q] = [Number(values.p), Number(values.d), Number(values.q)];
  const estimation = String(values.estimation) as 'css' | 'yw' | 'ols';
  const horizon = Number(values.horizon);
  const level = Number(values.level);
  const period = Number(values.period);
  const drift = d === 1 && values.drift === 'withDrift';
  const withMean = d === 0 || drift;
  const fit = fitArima(y, p, d, q, estimation, drift);
  const f = arimaForecast(y, fit, horizon, level);
  const score = holdoutScore(
    y,
    Number(values.holdout),
    period,
    (train, h) => arimaForecast(train, fitArima(train, p, d, q, estimation, drift), h, level).forecast,
  );
  const lags = Math.min(10, fit.residuals.length - 2);
  const lb = ljungBox(fit.residuals, lags, Math.min(p + q, lags - 1));
  const names = [
    ...(d === 0 ? ['mean'] : drift ? ['drift'] : []),
    ...fit.phi.map((_, i) => `φ${i + 1}`),
    ...fit.theta.map((_, j) => `θ${j + 1}`),
  ];
  const coefs = [...(withMean ? [fit.mean] : []), ...fit.phi, ...fit.theta];
  const levelFitted =
    d === 0 ? fit.fitted : [...new Array<number>(d).fill(NaN), ...fit.fitted.map((v, i) => (d === 1 ? v + y[i] : NaN))];
  const model =
    `w_t = ${withMean ? '\\mu + ' : ''}` +
    fit.phi.map((_, i) => `\\phi_${i + 1}${withMean ? `(w_{t-${i + 1}} - \\mu)` : ` w_{t-${i + 1}}`} + `).join('') +
    fit.theta.map((_, j) => `\\theta_${j + 1} e_{t-${j + 1}} + `).join('') +
    'e_t';
  return {
    rows: [
      { id: 'next', value: f.forecast[0], answer: true, sym: '\\hat y_{n+1}' },
      { id: 'sigma2', value: fit.sigma2, sym: '\\hat\\sigma^2' },
      { id: 'css', value: fit.css },
      { id: 'residQ', value: lb.q },
      { id: 'residP', value: lb.p },
      { id: 'n', value: fit.n },
      ...accuracyRows(score),
    ],
    tables: [
      {
        id: 'coefficients',
        columns: ['term', 'estimate', 'se', 'z'],
        rows: names.map((nm, k) => [nm, coefs[k], fit.se[k], coefs[k] / fit.se[k]]),
      },
      {
        id: 'forecasts',
        columns: ['h', 'forecast', 'low', 'high'],
        rows: f.forecast.map((v, h) => [h + 1, v, f.low[h], f.high[h]]),
      },
    ],
    steps: [
      step(d === 0 ? 'timeseries.noDifference' : 'timeseries.differenced', 'w_t = (1 - B)^{[[d]]} y_t', { d }),
      ...(d === 0 ? [] : [step(drift ? 'timeseries.drift' : 'timeseries.noDrift', undefined, { mu: fit.mean })]),
      step('timeseries.model', model),
      step(`timeseries.${fit.method}Fit` as 'timeseries.cssFit', undefined, { css: fit.css, sigma2: fit.sigma2 }),
      step('timeseries.arimaForecast', '\\hat y_{n+1} = [[f]]', { f: f.forecast[0] }),
      step('timeseries.psi', '\\operatorname{Var}(e_{n+h}) = \\sigma^2 \\sum_{j<h} \\psi_j^2'),
      step('timeseries.residualCheck', undefined, { q: lb.q, p: lb.p, h: lb.df }),
    ],
    words: step('timeseries.wordsForecast', undefined, { f: f.forecast[0], lo: f.low[0], hi: f.high[0] }),
    pictures: [forecastPicture(t, y, levelFitted, f)],
    notes: ['stationaryAfter', 'invertible'],
  };
}

function trendOutcome(values: Values): Outcome {
  const { y, t } = readSeries(values);
  const mk = mannKendall(y);
  const kinds: Record<string, AdfKind> = { constant: 'drift', constantTrend: 'trend', noConstant: 'none' };
  const kind = kinds[String(values.adfType)] ?? 'drift';
  const lags = Number(values.adfLags);
  const sims = Number(values.sims);
  const a = adf(y, lags, kind, sims, Number(values.seed));
  const senLine = t.map((x, i) => [x, mk.senIntercept + mk.sen * i] as [number, number]);
  return {
    rows: [
      { id: 'sen', value: mk.sen, answer: true, sym: '\\hat\\beta_{Sen}' },
      { id: 'mkS', value: mk.s, sym: 'S' },
      { id: 'mkZ', value: mk.z, sym: 'Z' },
      { id: 'mkP', value: mk.p },
      { id: 'tau', value: mk.tau },
      { id: 'adfTau', value: a.tau },
      { id: 'adf01', value: a.critical.p01 },
      { id: 'adf05', value: a.critical.p05 },
      { id: 'adf10', value: a.critical.p10 },
      { id: 'adfP', value: a.p },
    ],
    steps: [
      step('timeseries.mkS', 'S = \\sum_{i<j} \\operatorname{sign}(x_j - x_i) = [[s]]', { s: mk.s }),
      step('timeseries.mkVar', '\\operatorname{Var}(S) = \\frac{n(n-1)(2n+5) - \\sum t(t-1)(2t+5)}{18} = [[v]]', {
        v: mk.variance,
      }),
      step('timeseries.mkZ', 'Z = \\frac{S - \\operatorname{sign}(S)}{\\sqrt{\\operatorname{Var}(S)}} = [[z]]', {
        z: mk.z,
        p: mk.p,
      }),
      step('timeseries.sen', '\\hat\\beta = \\operatorname{median}\\frac{x_j - x_i}{j - i} = [[b]]', { b: mk.sen }),
      step(
        'timeseries.adf',
        '\\Delta y_t = \\alpha + \\gamma y_{t-1} + \\sum \\delta_i \\Delta y_{t-i} + e_t,\\quad \\tau = [[tau]]',
        {
          tau: a.tau,
          lags,
        },
      ),
      step('timeseries.adfSim', undefined, { sims: a.sims, seed: Number(values.seed), c05: a.critical.p05, p: a.p }),
    ],
    words: step(mk.p < 0.05 ? 'timeseries.wordsTrend' : 'timeseries.wordsNoTrend', undefined, {
      b: mk.sen,
      z: mk.z,
      p: mk.p,
    }),
    pictures: [
      {
        id: 'senLine',
        type: 'plot',
        plot: {
          x: { label: 'time' },
          y: { label: 'value' },
          series: [
            { id: 'series', points: pts(t, y), style: 'points' },
            { id: 'senFit', points: senLine },
          ],
          legend: true,
        },
      },
    ],
    notes: ['independentMk', 'adfLagsNote'],
  };
}

function run(values: Values): Outcome {
  switch (values.analysis) {
    case 'decompose':
      return decomposeOutcome(values);
    case 'smoothing':
      return smoothingOutcome(values);
    case 'arima':
      return arimaOutcome(values);
    case 'trend':
      return trendOutcome(values);
    default:
      return exploreOutcome(values);
  }
}

export const timeseriesSpec: ToolSpec = {
  fields: [
    { id: 'data', type: 'data', first: MONTHLY, rows: 6 },
    {
      id: 'analysis',
      type: 'choice',
      options: ['explore', 'decompose', 'smoothing', 'arima', 'trend'],
      first: 'explore',
    },
    { id: 'value', type: 'column', data: 'data', first: 'sales' },
    { id: 'time', type: 'column', data: 'data', first: 'month', optional: true },
    {
      id: 'period',
      type: 'number',
      first: '12',
      integer: true,
      min: 1,
      max: 366,
      when: is('explore', 'decompose', 'smoothing', 'arima'),
    },
    {
      id: 'transform',
      type: 'choice',
      options: ['none', 'log', 'diff', 'seasonal', 'ma'],
      first: 'none',
      when: is('explore'),
    },
    {
      id: 'window',
      type: 'number',
      first: '3',
      integer: true,
      min: 2,
      max: 366,
      when: (v) => is('explore')(v) && v.transform === 'ma',
    },
    { id: 'lags', type: 'number', first: '6', integer: true, min: 1, max: 200, when: is('explore') },
    {
      id: 'decomposition',
      type: 'choice',
      options: ['additive', 'multiplicative'],
      first: 'additive',
      when: is('decompose'),
    },
    { id: 'method', type: 'choice', options: ['ses', 'holt', 'hwadd', 'hwmult'], first: 'ses', when: is('smoothing') },
    { id: 'alpha', type: 'number', first: '', optional: true, min: 1e-6, max: 0.999999, when: is('smoothing') },
    {
      id: 'beta',
      type: 'number',
      first: '',
      optional: true,
      min: 1e-6,
      max: 0.999999,
      when: (v) => is('smoothing')(v) && v.method !== 'ses',
    },
    {
      id: 'gamma',
      type: 'number',
      first: '',
      optional: true,
      min: 1e-6,
      max: 0.999999,
      when: (v) => is('smoothing')(v) && String(v.method).startsWith('hw'),
    },
    { id: 'p', type: 'number', first: '1', integer: true, min: 0, max: 5, when: is('arima') },
    { id: 'd', type: 'number', first: '0', integer: true, min: 0, max: 2, when: is('arima') },
    { id: 'q', type: 'number', first: '0', integer: true, min: 0, max: 5, when: is('arima') },
    {
      id: 'drift',
      type: 'choice',
      options: ['noDrift', 'withDrift'],
      first: 'noDrift',
      when: (v) => is('arima')(v) && Number(v.d) === 1,
    },
    { id: 'estimation', type: 'choice', options: ['css', 'yw', 'ols'], first: 'css', when: is('arima') },
    { id: 'horizon', type: 'number', first: '6', integer: true, min: 1, max: 120, when: is('smoothing', 'arima') },
    { id: 'holdout', type: 'number', first: '0', integer: true, min: 0, when: is('smoothing', 'arima') },
    {
      id: 'adfType',
      type: 'choice',
      options: ['constant', 'constantTrend', 'noConstant'],
      first: 'constant',
      when: is('trend'),
    },
    { id: 'adfLags', type: 'number', first: '1', integer: true, min: 0, max: 20, when: is('trend') },
    { id: 'sims', type: 'number', first: '10000', integer: true, min: 200, max: 20000, when: is('trend') },
    { id: 'seed', type: 'number', first: '1', integer: true, min: 0, when: is('trend') },
    { id: 'level', type: 'number', first: '0.95', min: 0.5, max: 0.999, when: is('smoothing', 'arima') },
  ],
  run,
  examples: [
    { id: 'correlogram', values: { data: MONTHLY, analysis: 'explore', value: 'sales', time: 'month', lags: '6' } },
    { id: 'decompose', values: { data: MONTHLY, analysis: 'decompose', value: 'sales', time: 'month', period: '12' } },
    { id: 'ses', values: { data: MONTHLY, analysis: 'smoothing', value: 'sales', method: 'ses', alpha: '0.3' } },
    {
      id: 'holtWinters',
      values: { data: MONTHLY, analysis: 'smoothing', value: 'sales', method: 'hwadd', period: '12', holdout: '0' },
    },
    {
      id: 'holt',
      values: { data: MONTHLY, analysis: 'smoothing', value: 'sales', method: 'holt', holdout: '6' },
    },
    {
      id: 'ar1',
      values: { data: MONTHLY, analysis: 'arima', value: 'sales', p: '1', d: '0', q: '0', estimation: 'yw' },
    },
    { id: 'arima', values: { data: MONTHLY, analysis: 'arima', value: 'sales', p: '1', d: '1', q: '1', holdout: '4' } },
    {
      id: 'trend',
      values: { data: TEMPERATURE, analysis: 'trend', value: 'anomaly', time: 'year', sims: '2000' },
    },
  ],
};
