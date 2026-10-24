// The agreement tool's outcomes for categories: 2 coders' codes or their cross-table, and Fleiss' kappa.
import { cells, lines, readMatrix } from '../kit/parse';
import { str, type Outcome, type ResultRow, type ResultTable, type Values } from '../kit/spec';
import { fail, step, type KitStep } from '../kit/types';
import { cohen, crossTab, fleiss, landisKoch, weightedKappa, type Weights } from './kappa';

/** The 2 coders' codes, one unit per line. */
export function readCodes(text: string): { first: string[]; second: string[] } {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'codes');
  const first: string[] = [];
  const second: string[] = [];
  for (const one of found) {
    const parts = cells(one.text);
    if (parts.length !== 2) fail('twoCodes', { line: one.line }, 'codes');
    first.push(parts[0]);
    second.push(parts[1]);
  }
  return { first, second };
}

function crossTable(categories: readonly string[], counts: readonly (readonly number[])[]): ResultTable {
  return {
    id: 'cross',
    columns: ['coder1', ...categories.map((raw) => ({ raw })), 'total'],
    rows: counts.map((row, i) => [categories[i], ...row, row.reduce((s, v) => s + v, 0)]),
  };
}

function kappaOutcome(
  categories: readonly string[],
  counts: readonly (readonly number[])[],
  weights: Weights,
): Outcome {
  const r = cohen(counts);
  const vars = { po: r.po, pe: r.pe, k: r.kappa, se: r.se, low: r.low, high: r.high, n: r.n };
  const rows: ResultRow[] = [
    { id: 'units', value: r.n },
    { id: 'po', value: r.po, sym: 'p_o' },
    { id: 'pe', value: r.pe, sym: 'p_e' },
    { id: 'kappa', value: r.kappa, sym: '\\kappa', answer: weights === 'none' },
    { id: 'se', value: r.se, sym: '\\mathrm{SE}' },
    { id: 'low', value: r.low },
    { id: 'high', value: r.high },
    { id: 'z', value: r.z, sym: 'z' },
    { id: 'p', value: r.p, sym: 'p' },
    { id: 'scottPi', value: r.scottPi, sym: '\\pi' },
    { id: 'pabak', value: r.pabak, sym: '\\mathrm{PABAK}' },
  ];
  const steps: KitStep[] = [
    step('agreement.po', 'p_o = \\frac{\\sum_i n_{ii}}{n} = [[po]]', vars),
    step('agreement.pe', 'p_e = \\sum_i p_{i\\cdot}\\, p_{\\cdot i} = [[pe]]', vars),
    step('agreement.kappa', '\\kappa = \\frac{p_o - p_e}{1 - p_e} = \\frac{[[po]] - [[pe]]}{1 - [[pe]]} = [[k]]', vars),
    step(
      'agreement.se',
      '\\kappa \\pm 1.96\\,\\mathrm{SE} = [[k]] \\pm 1.96 \\times [[se]] = [[[low]],\\ [[high]]]',
      vars,
    ),
  ];
  if (weights !== 'none') {
    const w = weightedKappa(counts, weights);
    const wv = { pow: w.pow, pew: w.pew, kw: w.kappa };
    rows.push({ id: 'weighted', value: w.kappa, sym: '\\kappa_w', answer: true });
    steps.push(
      step(
        weights === 'linear' ? 'agreement.linear' : 'agreement.quadratic',
        weights === 'linear' ? 'w_{ij} = 1 - \\frac{|i - j|}{k - 1}' : 'w_{ij} = 1 - \\frac{(i - j)^2}{(k - 1)^2}',
      ),
      step(
        'agreement.weighted',
        '\\kappa_w = \\frac{p_{o(w)} - p_{e(w)}}{1 - p_{e(w)}} = \\frac{[[pow]] - [[pew]]}{1 - [[pew]]} = [[kw]]',
        wv,
      ),
    );
  }
  return {
    rows,
    steps,
    tables: [crossTable(categories, counts)],
    notes: [{ id: 'scale', vars: { kappa: r.kappa, word: landisKoch(r.kappa) } }],
  };
}

export function runCodes(values: Values): Outcome {
  const { first, second } = readCodes(str(values, 'codes'));
  const order = str(values, 'order')
    .split(/[,;|]/)
    .map((one) => one.trim())
    .filter((one) => one !== '');
  const table = crossTab(first, second, order);
  return kappaOutcome(table.categories, table.counts, str(values, 'weights') as Weights);
}

export function runMatrix(values: Values): Outcome {
  const { header, rows } = readMatrix(str(values, 'matrix'), 'matrix');
  const categories = header ?? rows.map((_, i) => String(i + 1));
  return kappaOutcome(categories, rows, str(values, 'weights') as Weights);
}

export function runFleiss(values: Values): Outcome {
  const { header, rows } = readMatrix(str(values, 'counts'), 'counts');
  const r = fleiss(rows);
  const names = header ?? rows[0].map((_, j) => String(j + 1));
  const vars = { pBar: r.pBar, peBar: r.peBar, k: r.kappa, n: r.raters, N: r.subjects, p1: r.perSubject[0] };
  return {
    rows: [
      { id: 'subjects', value: r.subjects },
      { id: 'raters', value: r.raters },
      { id: 'pBar', value: r.pBar, sym: '\\bar{P}' },
      { id: 'peBar', value: r.peBar, sym: '\\bar{P}_e' },
      { id: 'fleiss', value: r.kappa, sym: '\\kappa', answer: true },
      { id: 'se0', value: r.se0, sym: '\\mathrm{SE}_0' },
      { id: 'z', value: r.z, sym: 'z' },
      { id: 'p', value: r.p, sym: 'p' },
    ],
    tables: [
      {
        id: 'categories',
        columns: ['category', 'share', 'categoryKappa'],
        rows: names.map((name, j) => [name, r.shares[j], r.perCategory[j]]),
      },
    ],
    steps: [
      step('agreement.fleissSubject', 'P_i = \\frac{\\sum_j n_{ij}^2 - n}{n(n - 1)},\\quad P_1 = [[p1]]', vars),
      step('agreement.fleissMean', '\\bar{P} = \\frac{1}{N} \\sum_i P_i = [[pBar]]', vars),
      step('agreement.fleissChance', '\\bar{P}_e = \\sum_j p_j^2 = [[peBar]]', vars),
      step('agreement.fleissKappa', '\\kappa = \\frac{\\bar{P} - \\bar{P}_e}{1 - \\bar{P}_e} = [[k]]', vars),
    ],
    notes: [{ id: 'scale', vars: { kappa: r.kappa, word: landisKoch(r.kappa) } }],
  };
}
