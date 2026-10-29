// The econometrics and causal inference tool: fixed effects and first differences for panels, two-stage least
// squares, difference-in-differences, regression discontinuity, propensity-score weighting and matching, and causal
// diagrams with their back-door adjustment sets. Each analysis shows the transformation it makes, the estimate with
// the numbers put in, and the assumption that makes the estimate causal.
import { completeRows, numbersAt, parseTable, wordsAt } from '../kit/data';
import { buildDesign, mainTerms } from '../kit/design';
import { percent } from '../kit/format';
import { svg, text, line, W, type DrawContext } from '../kit/picture';
import { columnList, type Outcome, type Picture, type ResultTable, type ToolSpec, type Values } from '../kit/spec';
import { fail, step } from '../kit/types';
import { adjustmentSets, isBackdoorSet, layers, parseDag, type Dag } from './dag';
import {
  differenceInDifferences,
  panel,
  propensity,
  regressionDiscontinuity,
  tsls,
  type Estimate,
  type Kernel,
  type PanelKind,
  type RdFit,
  type TwoByTwo,
} from './engine';

const PANEL =
  'firm,year,x,y\na,1,1,3\na,2,2,5\na,3,3,7\nb,1,2,10\nb,2,3,12\nb,3,4,14.5\nc,1,5,20\nc,2,6,22\nc,3,7,24.5';
const IV = 'z,x,y\n1,2.1,5.0\n2,2.9,6.1\n3,4.2,9.2\n4,4.8,9.9\n5,6.1,12.8\n6,7.2,15.1\n7,7.9,16.0\n8,9.1,18.9';
const DID =
  'state,treated,post,y\nA,1,0,11\nA,1,1,17\nB,1,0,13\nB,1,1,19\nC,1,0,12\nC,1,1,18\nD,0,0,10\nD,0,1,13\nE,0,0,12\n' +
  'E,0,1,15\nF,0,0,11\nF,0,1,14';
const RD =
  'score,outcome\n-0.95,1.02\n-0.85,1.21\n-0.72,1.26\n-0.6,1.43\n-0.48,1.49\n-0.35,1.70\n-0.22,1.74\n-0.1,1.93\n' +
  '0.05,3.02\n0.15,3.18\n0.27,3.24\n0.4,3.43\n0.52,3.49\n0.66,3.70\n0.78,3.74\n0.9,3.93';
const PROPENSITY =
  'age,prior,treated,earnings\n22,0,0,14.1\n25,1,0,15.3\n31,0,0,16.2\n35,1,1,20.4\n41,0,0,18.1\n46,1,1,22.9\n' +
  '52,1,1,24.0\n58,0,1,23.2\n24,0,0,14.6\n29,1,1,19.1\n33,0,0,16.9\n38,1,0,18.3\n44,0,1,21.5\n49,1,0,20.2\n' +
  '55,1,1,24.6\n61,0,1,24.4';
const DAG_TEXT = 'Z -> X\nZ -> Y\nX -> Y\nX -> M -> Y\nY -> C';

const is =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(String(v.analysis));

function coefTable(id: string, coefs: readonly Estimate[]): ResultTable {
  return {
    id,
    columns: ['term', 'estimate', 'se', 't', 'p', 'low', 'high'],
    rows: coefs.map((c) => [c.name, c.coef, c.se, c.t, c.p, c.low, c.high]),
  };
}

function distinct(names: string[]): void {
  const used = names.filter((n) => n !== '');
  if (new Set(used).size < used.length) fail('sameColumn');
}

function feOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const yName = String(values.outcome);
  const xs = columnList(values.regressors);
  const entityName = String(values.entity);
  const timeName = String(values.time);
  if (xs.length === 0) fail('pickColumns');
  distinct([yName, entityName, timeName, ...xs]);
  const design = buildDesign(table, mainTerms(xs), {
    intercept: false,
    need: [yName, entityName, timeName].filter((n) => n),
  });
  const y = numbersAt(table, yName, design.rows);
  const entity = wordsAt(table, entityName, design.rows);
  const time = timeName ? numbersAt(table, timeName, design.rows) : null;
  const kind = String(values.effects) as PanelKind;
  const level = Number(values.level);
  const fit = panel(y, design.x, design.columns, entity, time, kind, values.se === 'cluster', level);
  const b = fit.coefs[0];
  const sxy = fit.xt.reduce((s, v, i) => s + v * fit.yt[i], 0);
  const sxx = fit.xt.reduce((s, v) => s + v * v, 0);
  const lo = Math.min(...fit.xt);
  const hi = Math.max(...fit.xt);
  return {
    rows: [
      { id: 'slope', value: b.coef, answer: true, sym: '\\hat\\beta' },
      { id: 'se', value: b.se },
      { id: 'p', value: b.p },
      { id: 'withinR2', value: fit.withinR2 },
      { id: 'n', value: fit.n },
      { id: 'groups', value: fit.groups },
      { id: 'df', value: fit.df },
    ],
    tables: [coefTable('coefficients', fit.coefs)],
    steps: [
      kind === 'firstdiff'
        ? step('causal.firstDiff', '\\Delta y_{it} = \\beta\\,\\Delta x_{it} + \\Delta u_{it}')
        : step(
            kind === 'twoway' ? 'causal.twoWay' : 'causal.within',
            kind === 'twoway'
              ? '\\ddot y_{it} = y_{it} - \\bar y_{i\\cdot} - \\bar y_{\\cdot t} + \\bar y'
              : '\\ddot x_{it} = x_{it} - \\bar x_i,\\quad \\ddot y_{it} = y_{it} - \\bar y_i',
          ),
      design.columns.length === 1
        ? step(
            'causal.withinSlope',
            '\\hat\\beta = \\frac{\\sum \\ddot x\\,\\ddot y}{\\sum \\ddot x^2} = \\frac{[[sxy]]}{[[sxx]]} = [[b]]',
            { sxy, sxx, b: b.coef },
          )
        : step('causal.withinMulti', undefined, { k: design.columns.length }),
      step(fit.clustered ? 'causal.clusterSe' : 'causal.classicalSe', undefined, {
        se: b.se,
        groups: fit.groups,
        df: fit.df,
      }),
      step('causal.feAssumption'),
    ],
    words: step('causal.wordsFe', undefined, { x: b.name, y: yName, b: b.coef, se: b.se, p: b.p }),
    pictures: [
      {
        id: 'within',
        type: 'plot',
        plot: {
          x: { label: 'xWithin' },
          y: { label: 'yWithin' },
          series: [
            { id: 'cases', points: fit.xt.map((v, i) => [v, fit.yt[i]] as [number, number]), style: 'points' },
            {
              id: 'slope',
              points: [
                [lo, (sxy / sxx) * lo],
                [hi, (sxy / sxx) * hi],
              ],
            },
          ],
        },
      },
    ],
    notes: ['strictExogeneity', 'timeInvariant'],
  };
}

function ivOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const yName = String(values.outcome);
  const endog = columnList(values.endogenous);
  const inst = columnList(values.instruments);
  const exog = columnList(values.exogenous);
  if (endog.length === 0 || inst.length === 0) fail('pickColumns');
  distinct([yName, ...endog, ...inst, ...exog]);
  const design = buildDesign(table, mainTerms(exog), { intercept: true, need: [yName, ...endog, ...inst] });
  const y = numbersAt(table, yName, design.rows);
  const cols = (names: string[]) => {
    const c = names.map((n) => numbersAt(table, n, design.rows));
    return y.map((_, i) => c.map((col) => col[i]));
  };
  const level = Number(values.level);
  const fit = tsls(y, cols(endog), design.x, cols(inst), [...design.columns, ...endog], level);
  const main = fit.coefs[design.columns.length];
  const fs = fit.firstStage[0];
  const z1 = numbersAt(table, inst[0], design.rows);
  const x1 = numbersAt(table, endog[0], design.rows);
  return {
    rows: [
      { id: 'ivSlope', value: main.coef, answer: true, sym: '\\hat\\beta_{IV}' },
      { id: 'se', value: main.se },
      { id: 'p', value: main.p },
      { id: 'firstF', value: fs.f },
      { id: 'firstR2', value: fs.r2 },
      { id: 'weak', word: fit.firstStage.every((f) => f.f >= 10) ? 'strong' : 'weak' },
      { id: 'hausman', value: fit.hausman.stat },
      { id: 'hausmanP', value: fit.hausman.p },
      { id: 'n', value: fit.n },
    ],
    tables: [
      coefTable('coefficients', fit.coefs),
      {
        id: 'firstStage',
        columns: ['endogenous', 'f', 'df1', 'df2', 'p', 'r2'],
        rows: fit.firstStage.map((f) => [f.name, f.f, f.df1, f.df2, f.p, f.r2]),
      },
    ],
    steps: [
      step('causal.firstStage', 'x = \\pi_0 + \\pi_1 z + v,\\quad F = [[f]]', { f: fs.f, x: fs.name }),
      step('causal.weakRule', undefined, { f: fs.f }),
      step('causal.secondStage', "\\hat\\beta = (X' P_Z X)^{-1} X' P_Z y,\\quad \\hat\\beta_{[[x]]} = [[b]]", {
        x: main.name,
        b: main.coef,
      }),
      step('causal.ivSe', '\\hat\\sigma = [[s]]', { s: fit.sigma }),
      step('causal.hausman', undefined, { stat: fit.hausman.stat, p: fit.hausman.p }),
      step('causal.ivAssumption'),
    ],
    words: step('causal.wordsIv', undefined, { x: main.name, y: yName, b: main.coef, se: main.se, f: fs.f }),
    pictures: [
      {
        id: 'firstStage',
        type: 'plot',
        plot: {
          x: { label: 'instrument' },
          y: { label: 'endogenous' },
          series: [{ id: 'cases', points: z1.map((v, i) => [v, x1[i]] as [number, number]), style: 'points' }],
        },
      },
    ],
    notes: ['relevance', 'exclusion'],
  };
}

function didOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const yName = String(values.outcome);
  const tName = String(values.treated);
  const pName = String(values.post);
  const cName = String(values.cluster);
  distinct([yName, tName, pName, cName]);
  const rows = completeRows(
    table,
    [yName, tName, pName, cName].filter((n) => n),
  );
  const level = Number(values.level);
  const fit = differenceInDifferences(
    numbersAt(table, yName, rows),
    numbersAt(table, tName, rows),
    numbersAt(table, pName, rows),
    { treated: tName, post: pName },
    cName ? wordsAt(table, cName, rows) : null,
    level,
  );
  const m = fit.means;
  const inter = fit.coefs[3];
  return {
    rows: [
      { id: 'did', value: m.did, answer: true, sym: '\\hat\\delta' },
      { id: 'se', value: inter.se },
      { id: 'p', value: inter.p },
      { id: 'low', value: inter.low },
      { id: 'high', value: inter.high },
      { id: 'n', value: fit.n },
    ],
    tables: [
      {
        id: 'means',
        columns: ['group', 'before', 'after', 'change'],
        rows: [
          ['@treatedGroup', m.treatedPre, m.treatedPost, m.treatedPost - m.treatedPre],
          ['@controlGroup', m.controlPre, m.controlPost, m.controlPost - m.controlPre],
        ],
      },
      coefTable('coefficients', fit.coefs),
    ],
    steps: [
      step('causal.didTable', undefined, {
        tPre: m.treatedPre,
        tPost: m.treatedPost,
        cPre: m.controlPre,
        cPost: m.controlPost,
      }),
      step('causal.did', '\\hat\\delta = ([[tpost]] - [[tpre]]) - ([[cpost]] - [[cpre]]) = [[d]]', {
        tpost: m.treatedPost,
        tpre: m.treatedPre,
        cpost: m.controlPost,
        cpre: m.controlPre,
        d: m.did,
      }),
      step(
        'causal.didRegression',
        'y = \\alpha + \\beta\\,T + \\gamma\\,\\text{post} + \\delta\\,T\\cdot\\text{post} + u',
        {
          se: inter.se,
          kind: fit.clustered ? 'cluster' : 'hc1',
        },
      ),
      step('causal.parallelTrends'),
    ],
    words: step('causal.wordsDid', undefined, { y: yName, d: m.did, se: inter.se, p: inter.p }),
    pictures: didPictures(m),
    notes: ['parallelTrends', 'noAnticipation'],
  };
}

function didPictures(m: TwoByTwo): Picture[] {
  return [
    {
      id: 'did',
      type: 'plot',
      plot: {
        x: { label: 'period' },
        y: { label: 'mean' },
        series: [
          {
            id: 'treatedGroup',
            points: [
              [0, m.treatedPre],
              [1, m.treatedPost],
            ],
          },
          {
            id: 'controlGroup',
            points: [
              [0, m.controlPre],
              [1, m.controlPost],
            ],
          },
          {
            id: 'counterfactual',
            pen: 0,
            style: 'dashed',
            points: [
              [0, m.treatedPre],
              [1, m.treatedPre + m.controlPost - m.controlPre],
            ],
          },
        ],
        xRange: [-0.1, 1.1],
        legend: true,
      },
    },
  ];
}

function rdOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const yName = String(values.outcome);
  const xName = String(values.running);
  distinct([yName, xName]);
  const rows = completeRows(table, [yName, xName]);
  const x = numbersAt(table, xName, rows);
  const y = numbersAt(table, yName, rows);
  const c = Number(values.cutoff);
  const h = Number(values.bandwidth);
  const kernel = String(values.kernel) as Kernel;
  const level = Number(values.level);
  const rd = regressionDiscontinuity(x, y, c, h, kernel, level);
  const sens: [number, number, number, number][] = [];
  for (const f of [0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 1.75, 2]) {
    try {
      const r = regressionDiscontinuity(x, y, c, h * f, kernel, level);
      sens.push([h * f, r.effect, r.low, r.high]);
    } catch {
      // Too few points at this bandwidth; the plot leaves it out.
    }
  }
  const binned = binnedMeans(x, y, c);
  const [lo, hi] = [Math.min(...x), Math.max(...x)];
  return {
    rows: [
      { id: 'rdEffect', value: rd.effect, answer: true, sym: '\\hat\\tau' },
      { id: 'se', value: rd.se },
      { id: 'p', value: rd.p },
      { id: 'low', value: rd.low },
      { id: 'high', value: rd.high },
      { id: 'leftIntercept', value: rd.left.intercept },
      { id: 'rightIntercept', value: rd.right.intercept },
      { id: 'leftN', value: rd.left.n },
      { id: 'rightN', value: rd.right.n },
    ],
    tables: [
      {
        id: 'sensitivity',
        columns: ['bandwidth', 'estimate', 'low', 'high'],
        rows: sens.map((s) => [...s]),
      },
    ],
    steps: [
      step('causal.rdWindow', undefined, { c, h, kernel, left: rd.left.n, right: rd.right.n }),
      step('causal.rdLines', '\\hat y_L(c) = [[l]],\\quad \\hat y_R(c) = [[r]]', {
        l: rd.left.intercept,
        r: rd.right.intercept,
      }),
      step('causal.rdEffect', '\\hat\\tau = \\hat y_R(c) - \\hat y_L(c) = [[r]] - [[l]] = [[t]]', {
        r: rd.right.intercept,
        l: rd.left.intercept,
        t: rd.effect,
      }),
      step('causal.rdSe', 'SE = \\sqrt{SE_L^2 + SE_R^2} = [[se]]', { se: rd.se }),
      step('causal.rdAssumption'),
    ],
    words: step('causal.wordsRd', undefined, {
      y: yName,
      c,
      t: rd.effect,
      lo: rd.low,
      hi: rd.high,
      level: percent(level),
    }),
    pictures: rdPictures(rd, sens, binned, { c, h, lo, hi }),
    notes: ['continuity', 'noSorting'],
  };
}

function rdPictures(
  rd: RdFit,
  sens: readonly (readonly number[])[],
  binned: [number, number][],
  ctx: { c: number; h: number; lo: number; hi: number },
): Picture[] {
  const { c, h, lo, hi } = ctx;
  const sideLine = (s: typeof rd.left, from: number, to: number): [number, number][] => [
    [from, s.intercept + s.slope * (from - c)],
    [to, s.intercept + s.slope * (to - c)],
  ];
  return [
    {
      id: 'rd',
      type: 'plot',
      plot: {
        x: { label: 'running' },
        y: { label: 'outcome' },
        series: [
          { id: 'bins', points: binned, style: 'points' },
          { id: 'leftLine', pen: 1, points: sideLine(rd.left, Math.max(lo, c - h), c) },
          { id: 'rightLine', pen: 2, points: sideLine(rd.right, c, Math.min(hi, c + h)) },
        ],
        vlines: [c],
        legend: true,
      },
    },
    {
      id: 'sensitivity',
      type: 'plot',
      plot: {
        x: { label: 'bandwidth' },
        y: { label: 'estimate' },
        series: [{ id: 'estimate', points: sens.map((s) => [s[0], s[1]] as [number, number]) }],
        bands: [{ points: sens.map((s) => [s[0], s[2], s[3]] as [number, number, number]), pen: 0 }],
        vlines: [h],
      },
    },
  ];
}

/** Means of x and y in 5 equal bins on each side of the cutoff, for the binned scatter. */
function binnedMeans(x: readonly number[], y: readonly number[], c: number): [number, number][] {
  const lo = Math.min(...x);
  const hi = Math.max(...x);
  const binned: [number, number][] = [];
  for (const right of [false, true]) {
    const [a, b] = right ? [c, hi] : [lo, c];
    const side = x.map((_, i) => i).filter((i) => (right ? x[i] >= c : x[i] < c));
    for (let k = 0; k < 5; k++) {
      const s = a + ((b - a) * k) / 5;
      const e = a + ((b - a) * (k + 1)) / 5;
      const inBin = side.filter((i) => x[i] >= s && (x[i] < e || (k === 4 && x[i] <= e)));
      if (inBin.length === 0) continue;
      const avg = (v: readonly number[]) => inBin.reduce((t, i) => t + v[i], 0) / inBin.length;
      binned.push([avg(x), avg(y)]);
    }
  }
  return binned;
}

function propensityOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const yName = String(values.outcome);
  const tName = String(values.treatment);
  const covs = columnList(values.covariates);
  if (covs.length === 0) fail('pickColumns');
  distinct([yName, tName, ...covs]);
  const design = buildDesign(table, mainTerms(covs), { intercept: false, need: [yName, tName] });
  const y = numbersAt(table, yName, design.rows);
  const t = numbersAt(table, tName, design.rows);
  const caliper = Number(values.caliper);
  const r = propensity(y, t, design.x, design.columns, caliper);
  const treatedScores = r.score.filter((_, i) => t[i] === 1).sort((a, b) => a - b);
  const controlScores = r.score.filter((_, i) => t[i] === 0).sort((a, b) => a - b);
  return {
    rows: [
      { id: 'ate', value: r.ate, answer: true, sym: '\\widehat{ATE}' },
      { id: 'ateSe', value: r.ateSe },
      { id: 'att', value: r.att, sym: '\\widehat{ATT}' },
      { id: 'attSe', value: r.attSe },
      { id: 'matchAtt', value: r.matchAtt },
      { id: 'matchSe', value: r.matchSe },
      { id: 'matched', value: r.matched },
      { id: 'dropped', value: r.dropped },
      { id: 'treatedN', value: r.treated },
      { id: 'controlN', value: r.controls },
    ],
    tables: [
      {
        id: 'balance',
        columns: ['covariate', 'raw', 'weighted', 'matchedSmd'],
        rows: r.balance.map((b) => [b.name, b.raw, b.weighted, b.matched]),
      },
    ],
    steps: [
      step('causal.score', "e(x) = P(T = 1 \\mid x) = \\frac{1}{1 + e^{-x'\\hat\\gamma}}"),
      step(
        'causal.ipwAte',
        '\\widehat{ATE} = \\frac{\\sum T y / e}{\\sum T / e} - \\frac{\\sum (1 - T) y / (1 - e)}{\\sum (1 - T) / (1 - e)} = [[ate]]',
        { ate: r.ate },
      ),
      step('causal.ipwAtt', '\\widehat{ATT} = [[att]]', { att: r.att }),
      step('causal.matching', undefined, { caliper, matched: r.matched, dropped: r.dropped, att: r.matchAtt }),
      step('causal.balance'),
      step('causal.ignorability'),
    ],
    words: step('causal.wordsPropensity', undefined, { y: yName, ate: r.ate, se: r.ateSe, att: r.matchAtt }),
    pictures: [
      {
        id: 'overlap',
        type: 'plot',
        plot: {
          x: { label: 'score' },
          y: { label: 'arm' },
          series: [
            { id: 'treatedGroup', style: 'points', points: treatedScores.map((s) => [s, 1] as [number, number]) },
            { id: 'controlGroup', style: 'points', points: controlScores.map((s) => [s, 0] as [number, number]) },
          ],
          xRange: [0, 1],
          yRange: [-0.5, 1.5],
          legend: true,
        },
      },
      {
        id: 'love',
        type: 'plot',
        plot: {
          x: { label: 'smd' },
          y: { label: 'covariateIndex' },
          series: [
            { id: 'raw', style: 'points', points: r.balance.map((b, i) => [b.raw, i + 1] as [number, number]) },
            {
              id: 'weighted',
              style: 'points',
              points: r.balance.map((b, i) => [b.weighted, i + 1] as [number, number]),
            },
          ],
          vlines: [-0.1, 0.1],
          marks: r.balance.map((b, i) => ({ x: b.raw, y: i + 1, text: b.name })),
          legend: true,
        },
      },
    ],
    notes: ['ignorability', 'overlap', 'knownScores'],
  };
}

function dagPicture(dag: Dag, x: string, y: string, adjust: readonly string[]) {
  return (ctx: DrawContext): string => {
    const p = ctx.palette;
    const levels = layers(dag);
    const height = Math.max(160, 70 * levels.length + 30);
    const pos = new Map<string, [number, number]>();
    levels.forEach((row, d) => row.forEach((n, k) => pos.set(n, [((k + 1) * W) / (row.length + 1), 40 + d * 70])));
    const parts = [`<rect width="${W}" height="${height}" fill="${p.surface}"/>`];
    for (const [a, b] of dag.edges) {
      const [x1, y1] = pos.get(a) as [number, number];
      const [x2, y2] = pos.get(b) as [number, number];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
      const [sx, sy, ex, ey] = [x1 + ux * 22, y1 + uy * 16, x2 - ux * 24, y2 - uy * 18];
      parts.push(line(sx, sy, ex, ey, p.text, false, 1.5));
      const pt = (a: number, b: number) => `${a.toFixed(1)},${b.toFixed(1)}`;
      const head = [
        pt(ex, ey),
        pt(ex - ux * 9 - uy * 4, ey - uy * 9 + ux * 4),
        pt(ex - ux * 9 + uy * 4, ey - uy * 9 - ux * 4),
      ].join(' ');
      parts.push(`<polygon points="${head}" fill="${p.text}"/>`);
    }
    for (const n of dag.nodes) {
      const [cx, cy] = pos.get(n) as [number, number];
      const role = n === x ? 0 : n === y ? 1 : adjust.includes(n) ? 2 : -1;
      const stroke = role >= 0 ? p.pens[role] : p.text;
      const shape = adjust.includes(n)
        ? `<rect x="${cx - 22}" y="${cy - 15}" width="44" height="30" rx="4" fill="${p.surface}" stroke="${stroke}" stroke-width="2"/>`
        : `<ellipse cx="${cx}" cy="${cy}" rx="22" ry="15" fill="${p.surface}" stroke="${stroke}" stroke-width="${role >= 0 ? 2 : 1}"/>`;
      parts.push(shape, text(cx, cy + 4, n, p.text, 'middle', 12));
    }
    return svg(parts, p, W, height);
  };
}

function dagOutcome(values: Values): Outcome {
  const dag = parseDag(String(values.edges));
  const x = String(values.exposure).trim();
  const y = String(values.response).trim();
  const typed = String(values.adjust)
    .split(/[\s,;]+/)
    .filter((s) => s !== '');
  for (const n of typed) if (!dag.nodes.includes(n)) fail('dagNode', n);
  const a = adjustmentSets(dag, x, y);
  const best = a.minimal[0] ?? [];
  const shown = typed.length ? typed : best;
  const valid = isBackdoorSet(dag, x, y, typed);
  const list = (names: readonly string[]) => (names.length ? names.join(', ') : '∅');
  const role = (n: string) =>
    n === x
      ? '@exposure'
      : n === y
        ? '@outcome'
        : a.mediators.includes(n)
          ? '@mediator'
          : a.confounders.includes(n)
            ? '@confounder'
            : a.treatmentDescendants.includes(n)
              ? '@descendant'
              : a.colliders.includes(n)
                ? '@collider'
                : '@other';
  return {
    rows: [
      { id: 'minimalSet', value: a.minimal.length ? `{${list(best)}}` : '—', answer: true },
      { id: 'setCount', value: a.minimal.length },
      { id: 'typedValid', word: typed.length === 0 ? 'nothingTyped' : valid ? 'valid' : 'invalid' },
      { id: 'mediators', value: list(a.mediators) },
      { id: 'avoid', value: list(a.treatmentDescendants) },
      { id: 'nodes', value: dag.nodes.length },
    ],
    tables: [
      { id: 'sets', columns: ['set'], rows: a.minimal.map((s) => [`{${list(s)}}`]) },
      { id: 'roles', columns: ['node', 'role'], rows: dag.nodes.map((n) => [n, role(n)]) },
    ],
    steps: [
      step('causal.dagDescendants', undefined, { x, list: list(a.treatmentDescendants) }),
      step('causal.dagCandidates', undefined, { list: list(a.candidates), k: a.candidates.length }),
      step('causal.dagBackdoor', undefined, { x, y, open: a.openPaths ? 'yes' : 'no' }),
      step('causal.dagMinimal', undefined, { sets: a.minimal.map((s) => `{${list(s)}}`).join('; ') || '—' }),
      ...(typed.length
        ? [step(valid ? 'causal.dagTypedValid' : 'causal.dagTypedInvalid', undefined, { set: list(typed) })]
        : []),
    ],
    words: a.minimal.length
      ? step('causal.wordsDag', undefined, { x, y, set: list(best) })
      : step('causal.wordsDagNone', undefined, { x, y }),
    pictures: [{ id: 'dag', type: 'draw', draw: dagPicture(dag, x, y, shown) }],
    notes: ['dagComplete'],
  };
}

function run(values: Values): Outcome {
  switch (values.analysis) {
    case 'iv':
      return ivOutcome(values);
    case 'did':
      return didOutcome(values);
    case 'rd':
      return rdOutcome(values);
    case 'propensity':
      return propensityOutcome(values);
    case 'dag':
      return dagOutcome(values);
    default:
      return feOutcome(values);
  }
}

const notDag = (v: Values) => v.analysis !== 'dag';

export const causalSpec: ToolSpec = {
  fields: [
    { id: 'data', type: 'data', first: PANEL, rows: 6, when: notDag },
    { id: 'analysis', type: 'choice', options: ['fe', 'iv', 'did', 'rd', 'propensity', 'dag'], first: 'fe' },
    { id: 'outcome', type: 'column', data: 'data', first: 'y', when: notDag },
    { id: 'regressors', type: 'column', data: 'data', first: 'x', multi: true, when: is('fe') },
    { id: 'entity', type: 'column', data: 'data', first: 'firm', when: is('fe') },
    { id: 'time', type: 'column', data: 'data', first: 'year', optional: true, when: is('fe') },
    { id: 'effects', type: 'choice', options: ['entity', 'twoway', 'firstdiff'], first: 'entity', when: is('fe') },
    { id: 'se', type: 'choice', options: ['classical', 'cluster'], first: 'classical', when: is('fe') },
    { id: 'endogenous', type: 'column', data: 'data', first: 'x', multi: true, when: is('iv') },
    { id: 'instruments', type: 'column', data: 'data', first: 'z', multi: true, when: is('iv') },
    { id: 'exogenous', type: 'column', data: 'data', first: '', optional: true, multi: true, when: is('iv') },
    { id: 'treated', type: 'column', data: 'data', first: 'treated', when: is('did') },
    { id: 'post', type: 'column', data: 'data', first: 'post', when: is('did') },
    { id: 'cluster', type: 'column', data: 'data', first: '', optional: true, when: is('did') },
    { id: 'running', type: 'column', data: 'data', first: 'score', when: is('rd') },
    { id: 'cutoff', type: 'number', first: '0', when: is('rd') },
    { id: 'bandwidth', type: 'number', first: '1', min: 1e-12, when: is('rd') },
    { id: 'kernel', type: 'choice', options: ['triangular', 'uniform'], first: 'triangular', when: is('rd') },
    { id: 'treatment', type: 'column', data: 'data', first: 'treated', when: is('propensity') },
    { id: 'covariates', type: 'column', data: 'data', first: 'age', multi: true, when: is('propensity') },
    { id: 'caliper', type: 'number', first: '0.2', min: 1e-6, max: 10, when: is('propensity') },
    { id: 'edges', type: 'text', first: DAG_TEXT, rows: 5, when: is('dag') },
    { id: 'exposure', type: 'text', first: 'X', rows: 1, when: is('dag') },
    { id: 'response', type: 'text', first: 'Y', rows: 1, when: is('dag') },
    { id: 'adjust', type: 'text', first: '', rows: 1, when: is('dag') },
    { id: 'level', type: 'number', first: '0.95', min: 0.5, max: 0.999, when: (v) => is('fe', 'iv', 'did', 'rd')(v) },
  ],
  run,
  examples: [
    {
      id: 'panel',
      values: {
        data: PANEL,
        analysis: 'fe',
        outcome: 'y',
        regressors: 'x',
        entity: 'firm',
        time: 'year',
        effects: 'entity',
      },
    },
    {
      id: 'iv',
      values: { data: IV, analysis: 'iv', outcome: 'y', endogenous: 'x', instruments: 'z', exogenous: '' },
    },
    {
      id: 'did',
      values: { data: DID, analysis: 'did', outcome: 'y', treated: 'treated', post: 'post', cluster: 'state' },
    },
    {
      id: 'rd',
      values: {
        data: RD,
        analysis: 'rd',
        outcome: 'outcome',
        running: 'score',
        cutoff: '0',
        bandwidth: '1',
        kernel: 'triangular',
      },
    },
    {
      id: 'propensity',
      values: {
        data: PROPENSITY,
        analysis: 'propensity',
        outcome: 'earnings',
        treatment: 'treated',
        covariates: 'age\nprior',
        caliper: '0.5',
      },
    },
    { id: 'dag', values: { analysis: 'dag', edges: DAG_TEXT, exposure: 'X', response: 'Y', adjust: 'Z' } },
  ],
};
