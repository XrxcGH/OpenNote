// The contingency-table tool's reports: association in an r × c table of counts (chi-square with residuals, G,
// Fisher's exact test, measures, and the trend test), McNemar's test on paired counts, and Cochran's Q. The
// forecast skill scores of a 2 × 2 table are here too.
import type { Mark, PlotSpec } from '../plot';
import { check, num, pTex, pText, step, tex, type Cell, type KitStep, type KitTable, type Report } from '../report';
import {
  chiSquare,
  checkTable,
  cochranQ,
  expected,
  fisher2x2,
  fisherMonteCarlo,
  gTest,
  linearTrend,
  MAX_FISHER_WORK,
  mcNemar,
  measures,
  skillScores,
  type Table,
} from './stats';

export interface Labeled {
  readonly table: Table;
  readonly rows: readonly string[];
  readonly cols: readonly string[];
}

export interface AssociationInput extends Labeled {
  readonly seed: bigint;
  readonly draws: number;
}

const text = (labels: readonly string[]) => labels.map((label) => ({ text: label }));

function observedTable(input: Labeled, e: number[][]): KitTable {
  const rows = input.table.map((row, i): Cell[] => [
    input.rows[i],
    ...row.map((o, j) => `${o} (${num(e[i][j], 4)})`),
    row.reduce((a, b) => a + b, 0),
  ]);
  const cols = input.cols.map((_, j) => input.table.reduce((s, row) => s + row[j], 0));
  rows.push([{ key: 'total' }, ...cols, cols.reduce((a, b) => a + b, 0)]);
  return { title: 'observedExpected', columns: [{ text: '' }, ...text(input.cols), 'total'], rows };
}

function residualTable(input: Labeled, e: number[][], n: number): KitTable {
  const rowTotals = input.table.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = input.cols.map((_, j) => input.table.reduce((s, row) => s + row[j], 0));
  const rows = input.table.map((row, i): Cell[] => [
    input.rows[i],
    ...row.map((o, j) => {
      const std = (o - e[i][j]) / Math.sqrt(e[i][j]);
      const adj = (o - e[i][j]) / Math.sqrt(e[i][j] * (1 - rowTotals[i] / n) * (1 - colTotals[j] / n));
      return `${num(std, 3)} / ${num(adj, 3)}`;
    }),
  ]);
  return { title: 'residuals', columns: [{ text: '' }, ...text(input.cols)], rows };
}

function contributionSteps(input: Labeled, e: number[][], chi2: number, df: number, p: number): KitStep[] {
  const m = { rows: input.table.map((r) => r.reduce((a, b) => a + b, 0)) };
  const n = m.rows.reduce((a, b) => a + b, 0);
  const col0 = input.table.reduce((s, row) => s + row[0], 0);
  const o = input.table[0][0];
  const terms = input.table.flatMap((row, i) =>
    row.map((cell, j) => `\\frac{(${cell} - ${tex(e[i][j], 4)})^2}{${tex(e[i][j], 4)}}`),
  );
  const shown = terms.length > 6 ? `${terms.slice(0, 4).join(' + ')} + \\cdots` : terms.join(' + ');
  return [
    step('tExpected', `E_{11} = \\frac{R_1 C_1}{N} = \\frac{${m.rows[0]} \\cdot ${col0}}{${n}} = ${tex(e[0][0])}`),
    step('tContribution', `\\frac{(O - E)^2}{E} = \\frac{(${o} - ${tex(e[0][0], 4)})^2}{${tex(e[0][0], 4)}}`),
    step('tChi2', `\\chi^2 = ${shown} = ${tex(chi2)}`),
    step('tDf', `df = (r - 1)(c - 1) = (${input.table.length} - 1)(${input.table[0].length} - 1) = ${df}`),
    step('tP', `${pTex(p)}`),
  ];
}

function barChart(input: Labeled): PlotSpec {
  const width = 0.8 / input.rows.length;
  const marks: Mark[] = input.rows.map((_, i) => ({
    kind: 'bars',
    tone: i,
    bars: input.cols.map((__, j) => {
      const x0 = j - 0.4 + i * width;
      return { x0, x1: x0 + width * 0.9, y: input.table[i][j] };
    }),
  }));
  return {
    title: 'groupedBars',
    legend: input.rows,
    x: { label: 'category', categories: input.cols },
    y: { label: 'count', min: 0 },
    marks,
  };
}

function fisherPart(input: AssociationInput, n: number) {
  const r = input.table.length;
  const c = input.table[0].length;
  if (r === 2 && c === 2) {
    const f = fisher2x2(input.table);
    const listed = f.terms.map(
      (term) => `${term.counted ? '\\mathbf{' : ''}${tex(term.p, 4)}${term.counted ? '}' : ''}`,
    );
    return {
      row: [{ key: 'fisherExact' }, '', '', f.p] as Cell[],
      steps: [step('tFisher', `p = ${listed.join(' + ')} \\to ${tex(f.p)}`, { count: `${f.terms.length}` })],
      note: null,
    };
  }
  if (n * input.draws > MAX_FISHER_WORK) return { row: null, steps: [], note: 'fisherSkipped' as const };
  const f = fisherMonteCarlo(input.table, input.seed, input.draws);
  return {
    row: [{ key: 'fisherMonteCarlo' }, `± ${num(f.se, 2)}`, '', f.p] as Cell[],
    steps: [step('tFisherMc', undefined, { draws: `${f.draws}`, seed: input.seed.toString(), se: num(f.se, 2) })],
    note: null,
  };
}

/** Association in an r × c table of counts. */
export function associationReport(input: AssociationInput): Report {
  const m = checkTable(input.table);
  const e = expected(m);
  const pearson = chiSquare(input.table);
  const g = gTest(input.table);
  const two = input.table.length === 2 && input.table[0].length === 2;
  const yates = two ? chiSquare(input.table, true) : null;
  const fisher = fisherPart(input, m.n);
  const trend = linearTrend(input.table);
  const mm = measures(input.table, pearson.chi2);
  const low = e.flat().filter((v) => v < 5).length;
  const tests: Cell[][] = [
    [{ key: 'pearson' }, pearson.chi2, pearson.df, pearson.p],
    ...(yates ? [[{ key: 'yates' }, yates.chi2, yates.df, yates.p] as Cell[]] : []),
    [{ key: 'gTest' }, g.chi2, g.df, g.p],
    ...(fisher.row ? [fisher.row] : []),
    [{ key: 'linearTrend' }, trend.m2, 1, trend.p],
  ];
  const measureRows: Cell[][] = [
    [{ key: 'phi' }, mm.phi],
    [{ key: 'cramerV' }, mm.cramerV],
    [{ key: 'contingencyC' }, mm.contingency],
    [{ key: 'lambdaRows' }, mm.lambdaRows],
    [{ key: 'lambdaCols' }, mm.lambdaCols],
    [{ key: 'lambdaSymmetric' }, mm.lambdaSymmetric],
    [{ key: 'gamma' }, mm.gamma],
  ];
  return {
    answer: {
      key: 'association',
      vars: { chi2: num(pearson.chi2), df: `${pearson.df}`, p: pText(pearson.p), v: num(mm.cramerV, 4) },
      latex: `\\chi^2(${pearson.df}) = ${tex(pearson.chi2)},\\; ${pTex(pearson.p)},\\; V = ${tex(mm.cramerV, 4)}`,
    },
    tables: [
      observedTable(input, e),
      { title: 'tests', columns: ['test', 'statistic', 'df', 'p'], rows: tests },
      { title: 'measures', columns: ['measure', 'value'], rows: measureRows },
      residualTable(input, e, m.n),
    ],
    steps: [...contributionSteps(input, e, pearson.chi2, pearson.df, pearson.p), ...fisher.steps],
    plots: [barChart(input)],
    notes: [
      ...(low > 0 ? [{ key: 'lowExpected' as const, vars: { count: `${low}`, cells: `${e.flat().length}` } }] : []),
      ...(fisher.note ? [{ key: fisher.note }] : []),
      { key: 'residualsRead' as const },
    ],
  };
}

/** McNemar's test on a paired 2 × 2 table. */
export function pairedReport(input: Labeled): Report {
  const t = mcNemar(input.table);
  return {
    answer: {
      key: 'mcnemar',
      vars: { chi2: num(t.corrected), p: pText(t.pCorrected), exact: pText(t.pExact) },
      latex: `\\chi^2_{\\mathrm{cc}}(1) = ${tex(t.corrected)},\\; ${pTex(t.pCorrected)}`,
    },
    tables: [
      {
        title: 'tests',
        columns: ['test', 'statistic', 'df', 'p'],
        rows: [
          [{ key: 'mcnemarPlain' }, t.chi2, 1, t.p],
          [{ key: 'mcnemarCorrected' }, t.corrected, 1, t.pCorrected],
          [{ key: 'mcnemarExact' }, '', '', t.pExact],
        ],
      },
    ],
    steps: [
      step('tDiscordant', `b = ${t.b},\\quad c = ${t.c}`),
      step(
        'tMcnemar',
        `\\chi^2_{\\mathrm{cc}} = \\frac{(|b - c| - 1)^2}{b + c} = \\frac{(|${t.b} - ${t.c}| - 1)^2}{${t.b + t.c}} = ${tex(t.corrected)}`,
      ),
      step(
        'tMcnemarExact',
        `p = 2 P(X \\le ${Math.min(t.b, t.c)}),\\; X \\sim \\mathrm{Bin}(${t.b + t.c}, 0.5) = ${tex(t.pExact)}`,
      ),
    ],
  };
}

const squares = (values: readonly number[]): number => values.reduce((s, v) => s + v * v, 0);

/** Cochran's Q on rows of 0-or-1 outcomes, one row per subject. */
export function cochranReport(data: Table, names: readonly string[]): Report {
  const q = cochranQ(data);
  return {
    answer: {
      key: 'cochran',
      vars: { q: num(q.q), df: `${q.df}`, p: pText(q.p) },
      latex: `Q(${q.df}) = ${tex(q.q)},\\; ${pTex(q.p)}`,
    },
    tables: [
      {
        title: 'successes',
        columns: ['condition', 'count', 'proportion'],
        rows: q.columns.map((c, j): Cell[] => [names[j] ?? `${j + 1}`, c, c / data.length]),
      },
    ],
    steps: [
      step(
        'tCochranSums',
        `T = ${q.total},\\quad \\sum C_j^2 = ${squares(q.columns)},\\quad \\sum R_i^2 = ${squares(q.rows)}`,
      ),
      step(
        'tCochranQ',
        `Q = \\frac{(k-1)\\left(k\\sum C_j^2 - T^2\\right)}{kT - \\sum R_i^2} = ${tex(q.q)},\\quad df = ${q.df}`,
      ),
      step('tP', pTex(q.p)),
    ],
  };
}

/** Forecast verification from a 2 × 2 table. Rows are the forecast (yes, no); columns are what happened. */
export function forecastReport(table: Table): Report {
  check(table.length === 2 && table.every((row) => row.length === 2), 'needs2x2');
  const [[a, b], [c, d]] = table;
  const s = skillScores(a, b, c, d);
  const rows: Cell[][] = [
    [{ key: 'pod' }, s.pod, 'a/(a+c)'],
    [{ key: 'far' }, s.far, 'b/(a+b)'],
    [{ key: 'pofd' }, s.pofd, 'b/(b+d)'],
    [{ key: 'csi' }, s.csi, 'a/(a+b+c)'],
    [{ key: 'bias' }, s.bias, '(a+b)/(a+c)'],
    [{ key: 'accuracy' }, s.accuracy, '(a+d)/N'],
    [{ key: 'hss' }, s.hss, '(a+d−E)/(N−E)'],
    [{ key: 'pss' }, s.pss, 'POD − POFD'],
  ];
  return {
    answer: {
      key: 'forecast',
      vars: { pod: num(s.pod, 4), far: num(s.far, 4), hss: num(s.hss, 4) },
      latex: `\\mathrm{POD} = ${tex(s.pod, 5)},\\; \\mathrm{FAR} = ${tex(s.far, 5)},\\; \\mathrm{HSS} = ${tex(s.hss, 5)}`,
    },
    tables: [{ title: 'skill', columns: ['measure', 'value', 'formula'], rows }],
    steps: [
      step('tForecastCells', `a = ${a},\\; b = ${b},\\; c = ${c},\\; d = ${d},\\; N = ${a + b + c + d}`),
      step('tChance', `E = \\frac{(a+b)(a+c) + (c+d)(b+d)}{N} = ${tex(s.chance)}`),
      step('tHss', `\\mathrm{HSS} = \\frac{a + d - E}{N - E} = ${tex(s.hss)}`),
      step('tPss', `\\mathrm{PSS} = \\mathrm{POD} - \\mathrm{POFD} = ${tex(s.pod)} - ${tex(s.pofd)} = ${tex(s.pss)}`),
    ],
  };
}
