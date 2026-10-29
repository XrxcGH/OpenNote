// The spatial statistics tool. The data have x and y columns, and a value column for autocorrelation and
// interpolation. It describes a point pattern (centrography, Clark-Evans, quadrats, Ripley's L), tests spatial
// autocorrelation (Moran's I, Geary's C, local Moran), or interpolates (semivariogram, ordinary kriging, IDW).
import { completeRows, numbersAt, parseTable } from '../kit/data';
import type { Outcome, Picture, ToolSpec, Values } from '../kit/spec';
import { fail, step } from '../kit/types';
import {
  autocorrelation,
  boundingBox,
  centrography,
  empiricalVariogram,
  fitVariogram,
  idw,
  krige,
  nearestNeighbors,
  quadrats,
  ripley,
  spatialWeights,
  variogram,
  windowArea,
  type Autocorrelation,
  type Centrography,
  type Kriged,
  type Lag,
  type Point,
  type Ripley,
  type VariogramModel,
  type VariogramParams,
  type WeightKind,
  type Window,
} from './engine';

const PATTERN = 'x,y\n1,1\n2,2\n3,1\n4,3\n2,4\n0.5,3.2\n3.4,3.8\n1.6,0.4\n3.7,0.8\n0.8,2.1\n2.9,2.6\n1.2,3.6';
const GRID = 'x,y,value\n0,0,1\n1,0,2\n2,0,3\n0,1,2\n1,1,3\n2,1,4\n0,2,3\n1,2,4\n2,2,5';
const WELLS =
  'x,y,depth\n0,0,12.1\n2,0,13.4\n4,0,15.2\n0,2,12.8\n2,2,14.1\n4,2,15.9\n0,4,13.9\n2,4,15.0\n4,4,17.2\n1,1,12.9\n' +
  '3,1,14.6\n1,3,14.0\n3,3,15.8\n5,1,16.4\n5,3,17.0\n1,5,15.1\n3,5,16.3\n5,5,18.1';

const is =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(String(v.analysis));

interface Read {
  readonly points: Point[];
  readonly values: number[];
  readonly names: { x: string; y: string; value: string };
}

interface Prediction {
  readonly t: Point;
  readonly k: Kriged;
  readonly d: number;
}

function read(values: Values, withValue: boolean): Read {
  const table = parseTable(String(values.data));
  const names = { x: String(values.x), y: String(values.y), value: String(values.value) };
  if (names.x === names.y || (withValue && (names.value === names.x || names.value === names.y))) fail('sameColumn');
  const rows = completeRows(table, withValue ? [names.x, names.y, names.value] : [names.x, names.y]);
  const xs = numbersAt(table, names.x, rows);
  const ys = numbersAt(table, names.y, rows);
  return {
    points: xs.map((x, i) => ({ x, y: ys[i] })),
    values: withValue ? numbersAt(table, names.value, rows) : [],
    names,
  };
}

/** Lines of "x, y" pairs. */
function parsePairs(text: string, code: 'windowText' | 'targetLine'): number[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((line, i) => {
      const parts = line
        .split(/[\s,;]+/)
        .filter((s) => s !== '')
        .map(Number);
      if (parts.length < 2 || parts.some((v) => !Number.isFinite(v))) fail(code, String(i + 1));
      return parts;
    });
}

function readWindow(text: string, points: readonly Point[]): Window {
  if (text.trim() === '') return boundingBox(points);
  const parts = text
    .split(/[\s,;]+/)
    .filter((s) => s !== '')
    .map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) fail('windowText', '1');
  const w = parts as unknown as Window;
  if (!(w[1] > w[0] && w[3] > w[2])) fail('areaPositive');
  if (points.some((p) => p.x < w[0] || p.x > w[1] || p.y < w[2] || p.y > w[3])) fail('outsideWindow');
  return w;
}

function pointsOutcome(values: Values): Outcome {
  const { points } = read(values, false);
  const w = readWindow(String(values.window), points);
  const area = windowArea(w);
  if (!(area > 0)) fail('areaPositive');
  const c = centrography(points, area);
  const nn = nearestNeighbors(points);
  const q = quadrats(points, w, Number(values.cols), Number(values.rows));
  const sims = Number(values.sims);
  const rip = ripley(points, w, sims, Number(values.seed));
  const word = c.p >= 0.05 ? 'random' : c.r < 1 ? 'clustered' : 'dispersed';
  return {
    rows: [
      { id: 'r', value: c.r, answer: true, sym: 'R' },
      { id: 'pattern', word },
      { id: 'meanNn', value: c.meanNn, sym: '\\bar d' },
      { id: 'expectedNn', value: c.expectedNn },
      { id: 'z', value: c.z },
      { id: 'p', value: c.p },
      { id: 'meanX', value: c.meanX },
      { id: 'meanY', value: c.meanY },
      { id: 'standardDistance', value: c.standardDistance },
      { id: 'area', value: area },
      { id: 'n', value: c.n },
      { id: 'vmr', value: q.vmr },
      { id: 'quadratChi2', value: q.chi2 },
      { id: 'quadratDf', value: q.df },
    ],
    tables: [
      {
        id: 'nn',
        columns: ['point', 'x', 'y', 'nearest', 'distance'],
        rows: points.map((p, i) => [`${i + 1}`, p.x, p.y, nn.j[i] + 1, nn.d[i]]),
      },
    ],
    steps: [
      step('spatial.meanNn', '\\bar d = \\frac{1}{n}\\sum d_i = [[d]]', { d: c.meanNn }),
      step(
        'spatial.expectedNn',
        'E(\\bar d) = \\frac{0.5}{\\sqrt{n / A}} = \\frac{0.5}{\\sqrt{[[n]] / [[a]]}} = [[e]]',
        { n: c.n, a: area, e: c.expectedNn },
      ),
      step(
        'spatial.clarkEvans',
        'R = \\frac{\\bar d}{E(\\bar d)} = [[r]],\\quad z = \\frac{\\bar d - E(\\bar d)}{0.26136 / \\sqrt{n^2 / A}} = [[z]]',
        {
          r: c.r,
          z: c.z,
        },
      ),
      step('spatial.quadrats', '\\text{VMR} = \\frac{s^2}{\\bar m} = \\frac{[[v]]}{[[m]]} = [[vmr]]', {
        v: q.variance,
        m: q.mean,
        vmr: q.vmr,
        k: q.counts.length,
      }),
      step('spatial.ripley', 'L(r) = \\sqrt{K(r) / \\pi}', { sims, seed: Number(values.seed) }),
    ],
    words: step(
      word === 'random'
        ? 'spatial.wordsRandom'
        : word === 'clustered'
          ? 'spatial.wordsClustered'
          : 'spatial.wordsDispersed',
      undefined,
      { r: c.r, z: c.z, p: c.p },
    ),
    pictures: pointsPictures(points, c, w, rip),
    notes: ['csrWindow', 'edgeEffects'],
  };
}

function pointsPictures(points: readonly Point[], c: Centrography, w: Window, rip: Ripley): Picture[] {
  const circle = Array.from({ length: 49 }, (_, k): [number, number] => {
    const t = (2 * Math.PI * k) / 48;
    return [c.meanX + c.standardDistance * Math.cos(t), c.meanY + c.standardDistance * Math.sin(t)];
  });
  const finite = (i: number) => Number.isFinite(rip.l[i]) && Number.isFinite(rip.low[i]);
  const keep = rip.radii.map((_, i) => i).filter(finite);
  return [
    {
      id: 'map',
      type: 'plot',
      plot: {
        x: { label: 'x' },
        y: { label: 'y' },
        series: [
          { id: 'points', points: points.map((p) => [p.x, p.y] as [number, number]), style: 'points' },
          { id: 'center', points: [[c.meanX, c.meanY]], style: 'points' },
          { id: 'standardDistance', points: circle, style: 'dashed' },
        ],
        xRange: [w[0], w[1]],
        yRange: [w[2], w[3]],
        legend: true,
      },
    },
    {
      id: 'ripley',
      type: 'plot',
      plot: {
        x: { label: 'radius' },
        y: { label: 'lMinusR' },
        series: [{ id: 'lMinusR', points: keep.map((i) => [rip.radii[i], rip.l[i]] as [number, number]) }],
        bands: [
          { points: keep.map((i) => [rip.radii[i], rip.low[i], rip.high[i]] as [number, number, number]), pen: 1 },
        ],
        hlines: [0],
      },
    },
  ];
}

const KIND_WORDS: Record<WeightKind, string> = {
  rook: 'rook',
  queen: 'queen',
  band: 'band',
  knn: 'knn',
  inverse: 'inverse',
  adjacency: 'adjacency',
};

function autocorrelationOutcome(values: Values): Outcome {
  const { points, values: x, names } = read(values, true);
  const kind = String(values.weights) as WeightKind;
  const w = spatialWeights(points, {
    kind,
    band: Number(values.band),
    k: Number(values.k),
    power: 1,
    adjacency: String(values.adjacency),
    standardize: values.standardize === 'row',
  });
  const perms = Number(values.permutations);
  const a = autocorrelation(x, w, perms, Number(values.seed));
  const mean = x.reduce((s, v) => s + v, 0) / x.length;
  const word = a.moran.permP >= 0.05 ? 'noPattern' : a.moran.value > a.moran.expected ? 'alike' : 'unlike';
  return {
    rows: [
      { id: 'moran', value: a.moran.value, answer: true, sym: 'I' },
      { id: 'moranExpected', value: a.moran.expected, sym: 'E(I)' },
      { id: 'moranZ', value: a.moran.z },
      { id: 'moranP', value: a.moran.p },
      { id: 'moranPermP', value: a.moran.permP },
      { id: 'geary', value: a.geary.value, sym: 'C' },
      { id: 'gearyZ', value: a.geary.z },
      { id: 'gearyP', value: a.geary.p },
      { id: 'gearyPermP', value: a.geary.permP },
      { id: 'pattern', word },
      { id: 's0', value: a.s0, sym: 'S_0' },
      { id: 'n', value: a.n },
    ],
    tables: [
      {
        id: 'local',
        columns: ['point', 'x', 'y', 'value', 'localI', 'quadrant', 'p'],
        rows: points.map((p, i) => [`${i + 1}`, p.x, p.y, x[i], a.local[i].i, `@${a.local[i].quadrant}`, a.local[i].p]),
      },
    ],
    steps: [
      step('spatial.weights', 'S_0 = \\sum_i \\sum_j w_{ij} = [[s0]]', {
        s0: a.s0,
        kind: KIND_WORDS[kind],
        standardize: values.standardize === 'row' ? 'yes' : 'no',
      }),
      step('spatial.center', 'z_i = x_i - \\bar x,\\quad \\bar x = [[mean]]', { mean }),
      step(
        'spatial.moran',
        "I = \\frac{n}{S_0}\\,\\frac{z' W z}{z' z} = [[i]],\\quad E(I) = -\\frac{1}{n - 1} = [[e]]",
        { i: a.moran.value, e: a.moran.expected },
      ),
      step('spatial.moranZ', 'z = \\frac{I - E(I)}{\\sqrt{\\operatorname{Var}(I)}} = [[z]]', {
        z: a.moran.z,
        p: a.moran.p,
      }),
      step('spatial.geary', 'C = \\frac{(n - 1)\\sum w_{ij}(x_i - x_j)^2}{2 S_0 \\sum z_i^2} = [[c]]', {
        c: a.geary.value,
      }),
      step('spatial.permutation', undefined, {
        perms,
        seed: Number(values.seed),
        pI: a.moran.permP,
        pC: a.geary.permP,
      }),
      step('spatial.local', 'I_i = \\frac{z_i}{m_2}\\sum_j w_{ij} z_j'),
    ],
    words: step(
      word === 'alike' ? 'spatial.wordsAlike' : word === 'unlike' ? 'spatial.wordsUnlike' : 'spatial.wordsNone',
      undefined,
      { value: names.value, i: a.moran.value, p: a.moran.permP },
    ),
    pictures: autocorrelationPictures(points, a),
    notes: ['weightsChoice', 'permutation'],
  };
}

function autocorrelationPictures(points: readonly Point[], a: Autocorrelation): Picture[] {
  const sig = (l: (typeof a.local)[number]) => l.p < 0.05;
  const groups = ['hh', 'll', 'hl', 'lh'] as const;
  const series = groups
    .map((g, k) => ({
      id: g,
      pen: k,
      style: 'points' as const,
      points: points
        .filter((_, i) => sig(a.local[i]) && a.local[i].quadrant === g)
        .map((p) => [p.x, p.y] as [number, number]),
    }))
    .filter((s) => s.points.length > 0);
  const quiet = points.filter((_, i) => !sig(a.local[i])).map((p) => [p.x, p.y] as [number, number]);
  const slope = a.moran.value;
  const zs = a.local.map((l) => l.z);
  const lo = Math.min(...zs);
  const hi = Math.max(...zs);
  return [
    {
      id: 'scatter',
      type: 'plot',
      plot: {
        x: { label: 'z' },
        y: { label: 'lag' },
        series: [
          { id: 'cases', points: a.local.map((l) => [l.z, l.lag] as [number, number]), style: 'points' },
          {
            id: 'slope',
            points: [
              [lo, slope * lo],
              [hi, slope * hi],
            ],
          },
        ],
        hlines: [0],
        vlines: [0],
      },
    },
    {
      id: 'lisa',
      type: 'plot',
      plot: {
        x: { label: 'x' },
        y: { label: 'y' },
        series: [...series, ...(quiet.length ? [{ id: 'ns', pen: 4, style: 'points' as const, points: quiet }] : [])],
        legend: true,
      },
    },
  ];
}

function interpolationOutcome(values: Values): Outcome {
  const { points, values: z } = read(values, true);
  const model = String(values.model) as VariogramModel;
  let maxD = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      maxD = Math.max(maxD, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
  const bins = Number(values.lags);
  const width = Number.isNaN(Number(values.lagWidth)) ? maxD / 2 / bins : Number(values.lagWidth);
  const lags = empiricalVariogram(points, z, width, bins);
  const params = fitVariogram(model, lags);
  const power = Number(values.power);
  const targets = parsePairs(String(values.targets), 'targetLine').map(([x, y]) => ({ x, y }));
  if (targets.length === 0) fail('targetLine', '1');
  const preds = targets.map((t) => ({ t, k: krige(points, z, t, model, params), d: idw(points, z, t, power) }));
  const first = preds[0];
  return {
    rows: [
      { id: 'kriged', value: first.k.value, answer: true, sym: '\\hat z_0' },
      { id: 'krigingSd', value: Math.sqrt(first.k.variance), sym: '\\sigma_K' },
      { id: 'idw', value: first.d },
      { id: 'nugget', value: params.nugget },
      { id: 'sill', value: params.sill },
      { id: 'range', value: params.range },
      { id: 'n', value: points.length },
    ],
    tables: [
      {
        id: 'predictions',
        columns: ['x', 'y', 'kriged', 'krigingSd', 'idw'],
        rows: preds.map((p) => [p.t.x, p.t.y, p.k.value, Math.sqrt(p.k.variance), p.d]),
      },
      {
        id: 'lags',
        columns: ['h', 'pairs', 'gamma', 'model'],
        rows: lags.map((l) => [l.h, l.pairs, l.gamma, variogram(model, params, l.h)]),
      },
    ],
    steps: [
      step(
        'spatial.semivariogram',
        '\\hat\\gamma(h) = \\frac{1}{2N(h)}\\sum (z_i - z_j)^2,\\quad \\hat\\gamma([[h]]) = [[g]]',
        { h: lags[0].h, g: lags[0].gamma, pairs: lags[0].pairs, width },
      ),
      step('spatial.modelFit', undefined, { nugget: params.nugget, sill: params.sill, range: params.range }),
      step(
        'spatial.kriging',
        '\\begin{bmatrix}\\Gamma & 1\\\\ 1^\\top & 0\\end{bmatrix}\\begin{bmatrix}\\lambda\\\\ \\mu\\end{bmatrix} = ' +
          '\\begin{bmatrix}\\gamma_0\\\\ 1\\end{bmatrix},\\quad \\hat z_0 = \\lambda^\\top z = [[v]]',
        { v: first.k.value },
      ),
      step('spatial.krigingVariance', '\\sigma_K^2 = \\lambda^\\top\\gamma_0 + \\mu = [[s2]]', {
        s2: first.k.variance,
      }),
      step('spatial.idw', '\\hat z_0 = \\frac{\\sum z_i / d_i^{p}}{\\sum 1 / d_i^{p}} = [[v]]', {
        v: first.d,
        p: power,
      }),
    ],
    words: step('spatial.wordsKriging', undefined, {
      x: first.t.x,
      y: first.t.y,
      v: first.k.value,
      lo: first.k.value - 1.96 * Math.sqrt(first.k.variance),
      hi: first.k.value + 1.96 * Math.sqrt(first.k.variance),
    }),
    pictures: interpolationPictures(points, lags, model, params, preds),
    notes: ['stationary', 'level95'],
  };
}

function interpolationPictures(
  points: readonly Point[],
  lags: readonly Lag[],
  model: VariogramModel,
  params: VariogramParams,
  preds: readonly Prediction[],
): Picture[] {
  const hMax = Math.max(...lags.map((l) => l.h)) * 1.1;
  const curve = Array.from({ length: 41 }, (_, i): [number, number] => {
    const h = (hMax * i) / 40;
    return [h, variogram(model, params, h)];
  });
  return [
    {
      id: 'variogram',
      type: 'plot',
      plot: {
        x: { label: 'h' },
        y: { label: 'gamma' },
        series: [
          { id: 'empirical', points: lags.map((l) => [l.h, l.gamma] as [number, number]), style: 'points' },
          { id: 'fitted', points: curve },
        ],
        legend: true,
      },
    },
    {
      id: 'targets',
      type: 'plot',
      plot: {
        x: { label: 'x' },
        y: { label: 'y' },
        series: [
          { id: 'data', points: points.map((p) => [p.x, p.y] as [number, number]), style: 'points' },
          { id: 'target', points: preds.map(({ t }) => [t.x, t.y] as [number, number]), style: 'points' },
        ],
        marks: preds.map((p) => ({ x: p.t.x, y: p.t.y, text: p.k.value.toPrecision(4) })),
        legend: true,
      },
    },
  ];
}

function run(values: Values): Outcome {
  if (values.analysis === 'autocorrelation') return autocorrelationOutcome(values);
  if (values.analysis === 'interpolation') return interpolationOutcome(values);
  return pointsOutcome(values);
}

export const spatialSpec: ToolSpec = {
  fields: [
    { id: 'data', type: 'data', first: PATTERN, rows: 6 },
    { id: 'analysis', type: 'choice', options: ['points', 'autocorrelation', 'interpolation'], first: 'points' },
    { id: 'x', type: 'column', data: 'data', first: 'x' },
    { id: 'y', type: 'column', data: 'data', first: 'y' },
    { id: 'value', type: 'column', data: 'data', first: 'value', when: is('autocorrelation', 'interpolation') },
    { id: 'window', type: 'text', first: '0, 4, 0, 4', rows: 1, when: is('points') },
    { id: 'cols', type: 'number', first: '2', integer: true, min: 1, max: 50, when: is('points') },
    { id: 'rows', type: 'number', first: '2', integer: true, min: 1, max: 50, when: is('points') },
    { id: 'sims', type: 'number', first: '99', integer: true, min: 9, max: 999, when: is('points') },
    {
      id: 'weights',
      type: 'choice',
      options: ['rook', 'queen', 'band', 'knn', 'inverse', 'adjacency'],
      first: 'rook',
      when: is('autocorrelation'),
    },
    {
      id: 'band',
      type: 'number',
      first: '1.5',
      min: 1e-12,
      when: (v) => is('autocorrelation')(v) && v.weights === 'band',
    },
    {
      id: 'k',
      type: 'number',
      first: '4',
      integer: true,
      min: 1,
      when: (v) => is('autocorrelation')(v) && v.weights === 'knn',
    },
    {
      id: 'adjacency',
      type: 'text',
      first: '1: 2 4\n2: 3 5\n3: 6\n4: 5 7\n5: 6 8\n6: 9\n7: 8\n8: 9',
      rows: 4,
      when: (v) => is('autocorrelation')(v) && v.weights === 'adjacency',
    },
    { id: 'standardize', type: 'choice', options: ['binary', 'row'], first: 'binary', when: is('autocorrelation') },
    {
      id: 'permutations',
      type: 'number',
      first: '499',
      integer: true,
      min: 19,
      max: 9999,
      when: is('autocorrelation'),
    },
    { id: 'seed', type: 'number', first: '1', integer: true, min: 0, when: is('points', 'autocorrelation') },
    {
      id: 'model',
      type: 'choice',
      options: ['spherical', 'exponential', 'gaussian'],
      first: 'spherical',
      when: is('interpolation'),
    },
    { id: 'lags', type: 'number', first: '6', integer: true, min: 2, max: 50, when: is('interpolation') },
    { id: 'lagWidth', type: 'number', first: '', optional: true, min: 1e-12, when: is('interpolation') },
    { id: 'targets', type: 'text', first: '2.5, 2.5\n0.5, 4.5', rows: 2, when: is('interpolation') },
    { id: 'power', type: 'number', first: '2', min: 0.1, max: 10, when: is('interpolation') },
  ],
  run,
  examples: [
    { id: 'pattern', values: { data: PATTERN, analysis: 'points', x: 'x', y: 'y', window: '0, 4, 0, 4' } },
    {
      id: 'grid',
      values: { data: GRID, analysis: 'autocorrelation', x: 'x', y: 'y', value: 'value', weights: 'rook' },
    },
    {
      id: 'wells',
      values: {
        data: WELLS,
        analysis: 'interpolation',
        x: 'x',
        y: 'y',
        value: 'depth',
        model: 'spherical',
        targets: '2.5, 2.5\n4.5, 4.5',
      },
    },
  ],
};
