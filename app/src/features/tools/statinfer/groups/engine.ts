// The ANOVA tool's reports: one-way (with Welch, assumption checks, post-hoc tests, and a contrast), two-way
// factorial, repeated measures, a mixed design, and two-group effect sizes. Each ends in an APA-style sentence.
import { tQuantile } from '../../subjects/stats/dist';
import type { Group } from '../num/data';
import type { Mark, PlotSpec } from '../plot';
import { num, pTex, step, tex, type Cell, type Report } from '../report';
import {
  contrast,
  levene,
  mixed,
  oneWay,
  postHoc,
  repeated,
  shapiroWilk,
  twoGroupEffect,
  twoWay,
  welch,
  type PostHoc,
} from './stats';

/** A p-value in APA style: no leading zero, 3 decimals, or "< .001". */
export const apaP = (p: number): string => (p < 0.001 ? '< .001' : `= ${p.toFixed(3).replace(/^0/, '')}`);
const apa = (v: number, digits = 2): string => v.toFixed(digits);
const short = (v: number): string => v.toFixed(2).replace(/^(-?)0\./, '$1.');

function meansPlot(groups: readonly Group[], confidence: number): PlotSpec {
  const items = groups.map((g, i) => {
    const n = g.values.length;
    const m = g.values.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(g.values.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1));
    const half = n > 1 ? (tQuantile(1 - (1 - confidence) / 2, n - 1) * sd) / Math.sqrt(n) : 0;
    return { at: i, lo: m - half, mid: m, hi: m + half };
  });
  return {
    title: 'meansCi',
    x: { label: 'group', categories: groups.map((g) => g.label) },
    y: { label: 'meanAxis' },
    marks: [{ kind: 'intervals', items }],
  };
}

export function oneWayReport(
  groups: readonly Group[],
  method: PostHoc,
  weights: readonly number[] | null,
  confidence: number,
): Report {
  const values = groups.map((g) => g.values);
  const a = oneWay(values);
  const w = groups.every((g) => g.values.length >= 2) ? welch(values) : null;
  const lev = groups.every((g) => g.values.length >= 2) ? levene(values, 'mean') : null;
  const bf = groups.every((g) => g.values.length >= 2) ? levene(values, 'median') : null;
  const residuals = values.flatMap((g, i) => g.map((x) => x - a.means[i]));
  const sw = residuals.length >= 3 && residuals.some((r) => r !== residuals[0]) ? shapiroWilk(residuals) : null;
  const pairs = postHoc(values, method, confidence);
  const c = weights ? contrast(values, weights) : null;
  const names = groups.map((g) => g.label);
  return {
    answer: {
      key: 'oneway',
      vars: { df1: `${a.dfb}`, df2: `${a.dfw}`, f: apa(a.f), p: apaP(a.p), eta: short(a.eta2) },
      latex: `F(${a.dfb},\\ ${a.dfw}) = ${tex(a.f, 5)},\\; ${pTex(a.p)},\\; \\eta^2 = ${tex(a.eta2, 4)}`,
    },
    tables: [
      {
        title: 'groupSummary',
        columns: ['group', 'n', 'mean', 'sd'],
        rows: groups.map((g, i): Cell[] => [g.label, a.sizes[i], a.means[i], a.sds[i]]),
      },
      {
        title: 'anovaTable',
        columns: ['source', 'ss', 'df', 'ms', 'fStat', 'p'],
        rows: [
          [{ key: 'betweenGroups' }, a.ssb, a.dfb, a.msb, a.f, a.p],
          [{ key: 'withinGroups' }, a.ssw, a.dfw, a.msw, '', ''],
          [{ key: 'total' }, a.sst, a.n - 1, '', '', ''],
          ...(w ? [[{ key: 'welchAnova' }, '', `${a.dfb}, ${num(w.df2, 5)}`, '', w.f, w.p] as Cell[]] : []),
        ],
      },
      {
        title: 'effectSizes',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'eta2' }, a.eta2],
          [{ key: 'omega2' }, a.omega2],
          [{ key: 'cohenF' }, a.cohenF],
        ],
      },
      {
        title: 'postHocTable',
        columns: ['pair', 'difference', 'statistic', 'p', 'interval'],
        rows: pairs.map((r): Cell[] => [
          `${names[r.b]} − ${names[r.a]}`,
          r.diff,
          r.statistic,
          r.p,
          Number.isFinite(r.lower) ? `${num(r.lower)} to ${num(r.upper)}` : '',
        ]),
      },
      {
        title: 'assumptions',
        columns: ['test', 'statistic', 'p'],
        rows: [
          ...(lev ? [[{ key: 'levene' }, lev.f, lev.p] as Cell[]] : []),
          ...(bf ? [[{ key: 'brownForsythe' }, bf.f, bf.p] as Cell[]] : []),
          ...(sw ? [[{ key: 'shapiro' }, sw.w, sw.p] as Cell[]] : []),
          ...(c ? [[{ key: 'contrastRow' }, `t(${c.df}) = ${num(c.t, 5)}`, c.p] as Cell[]] : []),
        ],
      },
    ],
    steps: [
      step('gGrand', `\\bar{\\bar x} = ${tex(a.grand)}`, { n: `${a.n}`, k: `${a.k}` }),
      step('gSsb', `SS_B = \\sum n_i(\\bar x_i - \\bar{\\bar x})^2 = ${tex(a.ssb)}`),
      step('gSsw', `SS_W = \\sum\\sum (x_{ij} - \\bar x_i)^2 = ${tex(a.ssw)}`),
      step(
        'gF',
        `F = \\frac{SS_B/(k-1)}{SS_W/(N-k)} = \\frac{${tex(a.msb)}}{${tex(a.msw)}} = ${tex(a.f)},\\; ${pTex(a.p)}`,
      ),
      step('gEta', `\\eta^2 = \\frac{SS_B}{SS_T} = ${tex(a.eta2, 4)},\\quad \\omega^2 = ${tex(a.omega2, 4)}`),
      step(`gPost_${method}` as const),
      step(a.p < 0.05 ? 'gDiffer' : 'gNoDiffer', undefined, { f: apa(a.f), p: apaP(a.p), eta: short(a.eta2) }),
    ],
    plots: [meansPlot(groups, confidence)],
  };
}

export function twoWayReport(data: readonly { a: string; b: string; y: number }[], type: 2 | 3): Report {
  const t = twoWay(data, type);
  const row = (key: 'factorA' | 'factorB' | 'interactionAB', r: typeof t.a): Cell[] => [
    { key },
    r.ss,
    r.df,
    r.ss / r.df,
    r.f,
    r.p,
    r.partialEta2,
  ];
  const marks: Mark[] = t.levelsB.map((_, j) => ({
    kind: 'line',
    tone: j,
    points: t.levelsA.map((__, i) => ({ x: i, y: t.cellMeans[i][j] })),
  }));
  return {
    answer: {
      key: 'twoway',
      vars: { fa: apa(t.a.f), fb: apa(t.b.f), fab: apa(t.ab.f), df: `${t.error.df}`, pab: apaP(t.ab.p) },
      latex: `F_A = ${tex(t.a.f)},\\ F_B = ${tex(t.b.f)},\\ F_{AB} = ${tex(t.ab.f)}`,
    },
    tables: [
      {
        title: 'anovaTable',
        columns: ['source', 'ss', 'df', 'ms', 'fStat', 'p', 'partialEta2'],
        rows: [
          row('factorA', t.a),
          row('factorB', t.b),
          row('interactionAB', t.ab),
          [{ key: 'error' }, t.error.ss, t.error.df, t.error.ms, '', '', ''],
        ],
      },
      {
        title: 'cellMeans',
        columns: [{ text: '' }, ...t.levelsB.map((l) => ({ text: l }))],
        rows: t.levelsA.map((l, i): Cell[] => [l, ...t.cellMeans[i]]),
      },
    ],
    steps: [
      step(t.balanced ? 'gBalanced' : type === 3 ? 'gTypeIII' : 'gTypeII'),
      step('gTwoF', `F = \\frac{MS_{\\text{effect}}}{MS_E},\\quad MS_E = ${tex(t.error.ms)}`),
      step(t.ab.p < 0.05 ? 'gInteraction' : 'gNoInteraction', undefined, { p: apaP(t.ab.p) }),
    ],
    plots: [
      {
        title: 'interaction',
        legend: t.levelsB,
        x: { label: 'factorAAxis', categories: t.levelsA },
        y: { label: 'meanAxis' },
        marks,
      },
    ],
  };
}

export function repeatedReport(rows: readonly (readonly number[])[], names: readonly string[]): Report {
  const r = repeated(rows);
  const labels = names.length === r.means.length ? names : r.means.map((_, j) => `${j + 1}`);
  return {
    answer: {
      key: 'repeated',
      vars: { df1: `${r.df1}`, df2: `${r.df2}`, f: apa(r.f), p: apaP(r.p), gg: num(r.gg, 4), pgg: apaP(r.pGg) },
      latex: `F(${r.df1},\\ ${r.df2}) = ${tex(r.f)},\\; ${pTex(r.p)},\\; \\varepsilon_{GG} = ${tex(r.gg, 4)}`,
    },
    tables: [
      {
        title: 'anovaTable',
        columns: ['source', 'ss', 'df', 'ms', 'fStat', 'p'],
        rows: [
          [{ key: 'conditions' }, r.ssConditions, r.df1, r.ssConditions / r.df1, r.f, r.p],
          [{ key: 'subjects' }, r.ssSubjects, rows.length - 1, '', '', ''],
          [{ key: 'error' }, r.ssError, r.df2, r.ssError / r.df2, '', ''],
        ],
      },
      {
        title: 'sphericity',
        columns: ['measure', 'value', 'p'],
        rows: [
          [{ key: 'mauchly' }, `W = ${num(r.mauchlyW, 5)}, χ²(${r.mauchlyDf}) = ${num(r.mauchlyChi2, 5)}`, r.mauchlyP],
          [{ key: 'greenhouse' }, r.gg, r.pGg],
          [{ key: 'huynh' }, r.hf, r.pHf],
          [{ key: 'partialEta2' }, r.partialEta2, ''],
        ],
      },
    ],
    steps: [
      step(
        'gRm',
        `SS_{\\text{cond}} = ${tex(r.ssConditions)},\\; SS_{\\text{subj}} = ${tex(r.ssSubjects)},\\; SS_E` +
          ` = ${tex(r.ssError)}`,
      ),
      step('gF', `F = ${tex(r.f)},\\; ${pTex(r.p)}`),
      step(
        'gEpsilon',
        `\\hat\\varepsilon_{GG} = \\frac{\\operatorname{tr}(S^*)^2}{(k-1)\\operatorname{tr}(S^{*2})}` +
          ` = ${tex(r.gg, 4)}`,
      ),
    ],
    plots: [
      {
        title: 'conditionMeans',
        x: { label: 'conditionAxis', categories: labels },
        y: { label: 'meanAxis' },
        marks: [{ kind: 'line', points: r.means.map((m, j) => ({ x: j, y: m })) }],
      },
    ],
  };
}

export function mixedReport(groups: readonly (readonly (readonly number[])[])[]): Report {
  const m = mixed(groups);
  const keys = {
    between: 'betweenFactor',
    subjects: 'subjectsWithin',
    within: 'withinFactor',
    interaction: 'interactionBw',
    error: 'error',
  } as const;
  const inter = m.rows[3];
  return {
    answer: {
      key: 'mixed',
      vars: { fb: apa(m.rows[0].f), fw: apa(m.rows[2].f), fi: apa(inter.f), pi: apaP(inter.p) },
      latex:
        `F_{\\text{between}} = ${tex(m.rows[0].f)},\\ F_{\\text{within}} = ${tex(m.rows[2].f)},\\ F_{\\times}` +
        ` = ${tex(inter.f)}`,
    },
    tables: [
      {
        title: 'anovaTable',
        columns: ['source', 'ss', 'df', 'ms', 'fStat', 'p'],
        rows: m.rows.map((r): Cell[] => [
          { key: keys[r.source] },
          r.ss,
          r.df,
          r.ss / r.df,
          Number.isFinite(r.f) ? r.f : '',
          Number.isFinite(r.p) ? r.p : '',
        ]),
      },
    ],
    steps: [step('gMixed'), step('gMixedF')],
  };
}

export function effectReport(x: Group, y: Group, confidence: number): Report {
  const e = twoGroupEffect(x.values, y.values, confidence);
  const level = `${num(confidence * 100, 4)}%`;
  return {
    answer: {
      key: 'effect',
      vars: { d: num(e.d, 4), lo: num(e.lower, 4), hi: num(e.upper, 4), g: num(e.g, 4), level },
      latex: `d = ${tex(e.d, 5)}\\ (${tex(e.lower, 5)},\\ ${tex(e.upper, 5)})`,
    },
    tables: [
      {
        title: 'effectSizes',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'cohenD' }, e.d, `${num(e.lower)} to ${num(e.upper)}`],
          [{ key: 'hedgesG' }, e.g, ''],
          [{ key: 'glassDelta' }, e.glass, ''],
        ],
      },
    ],
    steps: [
      step(
        'gD',
        `d = \\frac{\\bar x_1 - \\bar x_2}{s_p} = ${tex(e.d)},\\quad t = d\\sqrt{\\frac{n_1 n_2}{n_1 + n_2}}` +
          ` = ${tex(e.t)}`,
      ),
      step('gNct', `(${tex(e.lower, 5)},\\ ${tex(e.upper, 5)})`, { df: `${e.df}`, level }),
      step('gHedges', `g = d\\left(1 - \\frac{3}{4\\,df - 1}\\right) = ${tex(e.g)}`),
      step('gTtestLink'),
    ],
  };
}
