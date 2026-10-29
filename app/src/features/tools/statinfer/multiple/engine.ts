// The multiple-testing and meta-analysis tool's reports: adjusted p-values, combined p-values, meta-analysis with
// forest and funnel plots, volcano and Manhattan plots, and printed tables of critical values.
import { chiSquareQuantile, fQuantile, normalQuantile, tQuantile } from '../../subjects/stats/dist';
import { adjust, type Adjustment } from '../num/adjust';
import type { Mark, PlotSpec } from '../plot';
import { check, num, pTex, pText, step, tex, type Cell, type Report } from '../report';
import { checkP, combine, egger, hommel, metaAnalysis, type Study } from './stats';

export type Method = Exclude<Adjustment, 'none'> | 'hommel';
const METHODS: readonly Method[] = ['bonferroni', 'holm', 'hochberg', 'hommel', 'bh', 'by'];

export interface Labeled {
  readonly label: string;
  readonly p: number;
}

const adjusted = (p: readonly number[], method: Method) => (method === 'hommel' ? hommel(p) : adjust(p, method));

/** Every adjustment of a list of p-values, with the decisions at level alpha for the chosen method. */
export function adjustReport(items: readonly Labeled[], chosen: Method, alpha: number): Report {
  const p = items.map((i) => i.p);
  checkP(p);
  check(alpha > 0 && alpha < 1, 'alphaRange');
  const all = METHODS.map((m) => adjusted(p, m));
  const mine = all[METHODS.indexOf(chosen)];
  const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b] || a - b);
  const rejected = mine.filter((v) => v <= alpha).length;
  const multipliers = order
    .slice(0, 6)
    .map(
      (i, rank) =>
        `${tex(p[i])} \\times ${chosen === 'holm' ? p.length - rank : chosen === 'bh' ? `${p.length}/${rank + 1}` : '\\cdots'}`,
    );
  return {
    answer: {
      key: 'adjusted',
      vars: { count: `${rejected}`, m: `${p.length}`, alpha: num(alpha), method: chosen },
      latex: `${rejected} \\text{ of } ${p.length} \\text{ rejected at } \\alpha = ${tex(alpha)}`,
    },
    tables: [
      {
        title: 'adjustedTable',
        columns: [
          'label',
          'p',
          ...METHODS.map((m) => ({
            text: m === 'bh' ? 'BH (q)' : m === 'by' ? 'BY' : m[0].toUpperCase() + m.slice(1),
          })),
        ],
        rows: order.map((i): Cell[] => [items[i].label, p[i], ...all.map((column) => column[i])]),
      },
    ],
    steps: [
      step('mSort', undefined, { m: `${p.length}` }),
      step('mMultiply', `${multipliers.join(',\\; ')}${p.length > 6 ? ',\\; \\ldots' : ''}`, { method: chosen }),
      step('mMonotone'),
      step('mDecide', undefined, { count: `${rejected}`, alpha: num(alpha) }),
    ],
    notes: [{ key: 'qValues' }],
  };
}

/** Fisher's and Stouffer's combined tests of independent p-values. */
export function combineReport(p: readonly number[], weights?: readonly number[]): Report {
  const c = combine(p, weights);
  return {
    answer: {
      key: 'combined',
      vars: {
        x2: num(c.fisher),
        df: `${c.fisherDf}`,
        pf: pText(c.fisherP),
        z: num(c.stouffer, 5),
        pz: pText(c.stoufferP),
      },
      latex: `X^2(${c.fisherDf}) = ${tex(c.fisher)},\\; Z = ${tex(c.stouffer, 5)}`,
    },
    tables: [
      {
        title: 'tests',
        columns: ['test', 'statistic', 'df', 'p'],
        rows: [
          [{ key: 'fisherCombined' }, c.fisher, c.fisherDf, c.fisherP],
          [{ key: 'stouffer' }, c.stouffer, '', c.stoufferP],
        ],
      },
    ],
    steps: [
      step(
        'mFisher',
        `X^2 = -2\\sum \\ln p_i = ${tex(c.fisher)},\\quad df = 2k = ${c.fisherDf},\\; ${pTex(c.fisherP)}`,
      ),
      step('mStouffer', `Z = \\frac{\\sum w_i z_i}{\\sqrt{\\sum w_i^2}} = ${tex(c.stouffer)},\\; ${pTex(c.stoufferP)}`),
    ],
  };
}

export type Scale = 'plain' | 'log' | 'fisherZ';

const back = (scale: Scale) => (v: number) => (scale === 'log' ? Math.exp(v) : scale === 'fisherZ' ? Math.tanh(v) : v);

function forest(studies: readonly Study[], est: number, lo: number, hi: number, scale: Scale): PlotSpec {
  const z = 1.959963984540054;
  const shown = back(scale);
  const items = studies.map((s, i) => ({
    at: studies.length - i,
    lo: shown(s.y - z * Math.sqrt(s.v)),
    mid: shown(s.y),
    hi: shown(s.y + z * Math.sqrt(s.v)),
  }));
  const marks: Mark[] = [
    { kind: 'intervals', across: true, items },
    { kind: 'intervals', tone: 1, across: true, items: [{ at: 0, lo: shown(lo), mid: shown(est), hi: shown(hi) }] },
    { kind: 'vline', x: scale === 'log' ? 1 : 0 },
  ];
  return {
    title: 'forest',
    x: { label: 'effect' },
    y: { label: 'study', categories: ['Pooled', ...studies.map((s) => s.label).reverse()] },
    marks,
  };
}

function funnel(studies: readonly Study[], est: number): PlotSpec {
  const precision = studies.map((s) => 1 / Math.sqrt(s.v));
  const top = Math.max(...precision) * 1.1;
  const edge = Array.from({ length: 30 }, (_, i) => 0.2 + (i * (top - 0.2)) / 29);
  return {
    title: 'funnel',
    x: { label: 'effect' },
    y: { label: 'precision', min: 0 },
    marks: [
      { kind: 'points', points: studies.map((s, i) => ({ x: s.y, y: precision[i] })) },
      { kind: 'line', tone: 1, dashed: true, points: edge.map((p) => ({ x: est - 1.96 / p, y: p })) },
      { kind: 'line', tone: 1, dashed: true, points: edge.map((p) => ({ x: est + 1.96 / p, y: p })) },
      { kind: 'vline', x: est },
    ],
  };
}

/** Meta-analysis of study estimates (on the analysis scale) with their variances. */
export function metaReport(studies: readonly Study[], method: 'dl' | 'reml', scale: Scale, confidence: number): Report {
  const m = metaAnalysis(studies, method, confidence);
  const shown = back(scale);
  const e = studies.length >= 3 ? egger(studies) : null;
  const pooledRow = (key: 'fixedEffect' | 'randomEffects', p: typeof m.fixed): Cell[] => [
    { key },
    shown(p.estimate),
    `${num(shown(p.lower), 5)} to ${num(shown(p.upper), 5)}`,
    p.p,
  ];
  return {
    answer: {
      key: 'meta',
      vars: {
        est: num(shown(m.random.estimate), 5),
        lo: num(shown(m.random.lower), 4),
        hi: num(shown(m.random.upper), 4),
        i2: num(m.i2 * 100, 4),
      },
      latex:
        `\\hat\\mu_{RE} = ${tex(m.random.estimate, 5)}\\ (SE\\ ${tex(m.random.se, 5)}),\\; I^2` +
        ` = ${tex(m.i2 * 100, 4)}\\%`,
    },
    tables: [
      {
        title: 'studies',
        columns: ['study', 'estimate', 'variance', 'weightFixed', 'weightRandom'],
        rows: studies.map((s, i): Cell[] => [s.label, s.y, s.v, m.fixed.weights[i], m.random.weights[i]]),
      },
      {
        title: 'pooled',
        columns: ['measure', 'value', 'interval', 'p'],
        rows: [
          pooledRow('fixedEffect', m.fixed),
          pooledRow('randomEffects', m.random),
          ...(m.prediction
            ? [
                [
                  { key: 'predictionInterval' },
                  '',
                  `${num(shown(m.prediction.lower), 5)} to ${num(shown(m.prediction.upper), 5)}`,
                  '',
                ] as Cell[],
              ]
            : []),
        ],
      },
      {
        title: 'heterogeneity',
        columns: ['measure', 'value', 'p'],
        rows: [
          [{ key: 'cochranQ' }, m.q, m.pQ],
          [{ key: 'tau2' }, m.tau2, ''],
          [{ key: 'i2' }, m.i2 * 100, ''],
          ...(e ? [[{ key: 'egger' }, e.intercept, e.p] as Cell[]] : []),
        ],
      },
    ],
    steps: [
      step(
        'mWeights',
        `w_i = 1/v_i,\\quad \\hat\\mu_{FE} = \\frac{\\sum w_i y_i}{\\sum w_i} = ${tex(m.fixed.estimate)}`,
      ),
      step('mQ', `Q = \\sum w_i (y_i - \\hat\\mu_{FE})^2 = ${tex(m.q)},\\quad df = ${m.df}`),
      step(m.method === 'reml' ? 'mReml' : 'mDl', `\\hat\\tau^2 = ${tex(m.tau2)}`),
      step('mRandom', `\\hat\\mu_{RE} = ${tex(m.random.estimate)},\\quad SE = ${tex(m.random.se)}`),
      step('mI2', `I^2 = \\frac{Q - df}{Q} = ${tex(m.i2 * 100, 4)}\\%`),
      ...(scale === 'plain' ? [] : [step('mBack', undefined, { scale })]),
    ],
    plots: [
      forest(studies, m.random.estimate, m.random.lower, m.random.upper, scale),
      funnel(studies, m.random.estimate),
    ],
    notes: m.converged ? [] : [{ key: 'remlNoConverge' }],
  };
}

export interface Gene {
  readonly label: string;
  readonly fold: number;
  readonly p: number;
}

/** A volcano plot: log₂ fold change against −log₁₀ p, with the line at the largest p kept by BH at q. */
export function volcanoReport(genes: readonly Gene[], q: number, foldCut: number): Report {
  checkP(genes.map((g) => g.p));
  check(q > 0 && q < 1, 'alphaRange');
  const bh = adjust(
    genes.map((g) => g.p),
    'bh',
  );
  const kept = genes.filter((g, i) => bh[i] <= q && Math.abs(g.fold) >= foldCut);
  const cutoff = Math.max(0, ...genes.filter((_, i) => bh[i] <= q).map((g) => g.p));
  const y = (p: number) => -Math.log10(Math.max(p, 1e-300));
  const marks: Mark[] = [
    { kind: 'points', points: genes.map((g) => ({ x: g.fold, y: y(g.p) })) },
    { kind: 'points', tone: 1, points: kept.map((g) => ({ x: g.fold, y: y(g.p) })) },
    ...(cutoff > 0 ? [{ kind: 'hline' as const, y: y(cutoff) }] : []),
    ...(foldCut > 0
      ? [
          { kind: 'vline' as const, x: foldCut },
          { kind: 'vline' as const, x: -foldCut },
        ]
      : []),
  ];
  return {
    answer: {
      key: 'volcano',
      vars: { count: `${kept.length}`, m: `${genes.length}`, q: num(q) },
      latex: `${kept.length} / ${genes.length}`,
    },
    tables: [
      {
        title: 'significant',
        columns: ['label', 'fold', 'p', 'qValue'],
        rows: genes
          .map((g, i): Cell[] => [g.label, g.fold, g.p, bh[i]])
          .filter((r) => (r[3] as number) <= q)
          .slice(0, 200),
      },
    ],
    steps: [step('mVolcano', undefined, { q: num(q), fold: num(foldCut) })],
    plots: [{ title: 'volcano', x: { label: 'foldAxis' }, y: { label: 'logP', min: 0 }, marks }],
  };
}

export interface Locus {
  readonly chromosome: string;
  readonly position: number;
  readonly p: number;
}

/** A Manhattan plot: loci laid end to end by chromosome against −log₁₀ p, with the genome-wide line. */
export function manhattanReport(loci: readonly Locus[], line: number): Report {
  checkP(loci.map((l) => l.p));
  check(line > 0 && line < 1, 'alphaRange');
  const chromosomes = [...new Set(loci.map((l) => l.chromosome))];
  let offset = 0;
  const starts = new Map<string, number>();
  for (const c of chromosomes) {
    starts.set(c, offset);
    offset += Math.max(...loci.filter((l) => l.chromosome === c).map((l) => l.position)) * 1.02 + 1;
  }
  const y = (p: number) => -Math.log10(Math.max(p, 1e-300));
  const marks: Mark[] = chromosomes.map((c, i) => ({
    kind: 'points' as const,
    tone: i % 2,
    points: loci.filter((l) => l.chromosome === c).map((l) => ({ x: (starts.get(c) ?? 0) + l.position, y: y(l.p) })),
  }));
  marks.push({ kind: 'hline', y: y(line) });
  const hits = loci.filter((l) => l.p <= line);
  return {
    answer: {
      key: 'manhattan',
      vars: { count: `${hits.length}`, m: `${loci.length}`, line: num(line) },
      latex: `p \\le ${tex(line)}`,
    },
    tables: [
      {
        title: 'significant',
        columns: ['chromosome', 'position', 'p'],
        rows: hits.slice(0, 200).map((l): Cell[] => [l.chromosome, l.position, l.p]),
      },
    ],
    steps: [step('mManhattan', undefined, { line: num(line) })],
    plots: [{ title: 'manhattan', x: { label: 'genome' }, y: { label: 'logP', min: 0 }, marks }],
  };
}

export type Distribution = 'normal' | 't' | 'chi2' | 'f';

const T_DF = [...Array.from({ length: 30 }, (_, i) => i + 1), 40, 50, 60, 80, 100, 120, Number.POSITIVE_INFINITY];
const UPPER = [0.1, 0.05, 0.025, 0.01, 0.005, 0.001];

/** A printed table of upper critical values, computed from the distribution (not copied from a book). */
export function criticalTable(distribution: Distribution, alpha: number, df1: number): Report {
  check(alpha > 0 && alpha < 1, 'alphaRange');
  const dfText = (df: number) => (Number.isFinite(df) ? `${df}` : '∞');
  if (distribution === 'normal') {
    const rows = UPPER.map((a): Cell[] => [num(a), normalQuantile(1 - a), num(2 * a)]);
    return {
      answer: {
        key: 'criticalNormal',
        vars: { z: num(normalQuantile(1 - alpha / 2)), alpha: num(alpha) },
        latex: `z_{${tex(alpha / 2)}} = ${tex(normalQuantile(1 - alpha / 2))}`,
      },
      tables: [{ title: 'criticalTable', columns: ['upperTail', 'criticalValue', 'twoSided'], rows }],
      steps: [step('mPrinted')],
    };
  }
  if (distribution === 't') {
    const rows = T_DF.map((df): Cell[] => [
      dfText(df),
      ...UPPER.map((a) => (Number.isFinite(df) ? tQuantile(1 - a, df) : normalQuantile(1 - a))),
    ]);
    return {
      answer: {
        key: 'criticalT',
        vars: { t: num(tQuantile(1 - alpha / 2, 10)), alpha: num(alpha) },
        latex: `t_{10,\\,${tex(alpha / 2)}} = ${tex(tQuantile(1 - alpha / 2, 10))}`,
      },
      tables: [{ title: 'criticalTable', columns: ['df', ...UPPER.map((a) => ({ text: num(a) }))], rows }],
      steps: [step('mPrinted')],
      notes: [{ key: 'upperTails' }],
    };
  }
  if (distribution === 'chi2') {
    check(Number.isInteger(df1) && df1 >= 1, 'dfWhole');
    const tails = [0.995, 0.99, 0.975, 0.95, 0.9, 0.1, 0.05, 0.025, 0.01, 0.005];
    const rows = T_DF.filter(Number.isFinite).map((df): Cell[] => [
      df,
      ...tails.map((a) => chiSquareQuantile(1 - a, df)),
    ]);
    return {
      answer: {
        key: 'criticalChi2',
        vars: { x: num(chiSquareQuantile(1 - alpha, df1)), df: `${df1}`, alpha: num(alpha) },
        latex: `\\chi^2_{${df1},\\,${tex(alpha)}} = ${tex(chiSquareQuantile(1 - alpha, df1))}`,
      },
      tables: [{ title: 'criticalTable', columns: ['df', ...tails.map((a) => ({ text: num(a) }))], rows }],
      steps: [step('mPrinted')],
      notes: [{ key: 'upperTails' }],
    };
  }
  const numerators = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30];
  const denominators = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 60, 120];
  const rows = denominators.map((d2): Cell[] => [d2, ...numerators.map((d1) => fQuantile(1 - alpha, d1, d2))]);
  return {
    answer: { key: 'criticalF', vars: { alpha: num(alpha) }, latex: `F_{${tex(alpha)}}` },
    tables: [
      { title: 'criticalTable', columns: ['dfDenominator', ...numerators.map((d) => ({ text: `${d}` }))], rows },
    ],
    steps: [step('mPrinted')],
    notes: [{ key: 'fTable', vars: { alpha: num(alpha) } }],
  };
}
