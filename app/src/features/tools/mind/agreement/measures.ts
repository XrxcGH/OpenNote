// The agreement tool's outcomes for Krippendorff's alpha, intraclass correlations, and Bland-Altman limits.
import { isMissing, lines, cells, readMatrix } from '../kit/parse';
import { num, str, type Outcome, type ResultRow, type Values } from '../kit/spec';
import { fail, step, whole, type StepKey } from '../kit/types';
import { blandAltman, iccForms, kooLi, meanSquares } from './icc';
import { alphaInterval, krippendorff, type Level } from './kripp';

/** Units as lists of values, from a table with units in rows or coders in rows. Missing cells become empty. */
export function readUnits(text: string, unitsInRows: boolean): string[][] {
  const found = lines(text).map((one) => cells(one.text));
  if (found.length === 0) fail('empty', {}, 'data');
  const width = Math.max(...found.map((row) => row.length));
  const grid = found.map((row) => Array.from({ length: width }, (_, i) => (isMissing(row[i] ?? '') ? '' : row[i])));
  if (unitsInRows) return grid;
  return Array.from({ length: width }, (_, u) => grid.map((row) => row[u]));
}

const DELTA: Record<Level, StepKey> = {
  nominal: 'agreement.deltaNominal',
  ordinal: 'agreement.deltaOrdinal',
  interval: 'agreement.deltaInterval',
  ratio: 'agreement.deltaRatio',
};

export function runKripp(values: Values): Outcome {
  const units = readUnits(str(values, 'data'), values.layout !== 'codersRows');
  const level = str(values, 'level') as Level;
  const r = krippendorff(units, level);
  const draws = whole(num(values, 'boot'), 0, 'boot');
  const vars = { dO: r.dObserved, dE: r.dExpected, a: r.alpha, n: r.pairable };
  const rows: ResultRow[] = [
    { id: 'units', value: r.units },
    { id: 'pairable', value: r.pairable },
    { id: 'dObserved', value: r.dObserved, sym: 'D_o' },
    { id: 'dExpected', value: r.dExpected, sym: 'D_e' },
    { id: 'alpha', value: r.alpha, sym: '\\alpha', answer: true },
  ];
  const notes = [];
  if (draws > 0) {
    const ci = alphaInterval(units, level, Math.min(draws, 20000), num(values, 'seed'));
    rows.push({ id: 'bootLow', value: ci.low }, { id: 'bootHigh', value: ci.high });
    notes.push({ id: 'bootstrap', vars: { used: ci.used, seed: num(values, 'seed') } });
  }
  return {
    rows,
    notes,
    tables: [
      {
        id: 'coincidence',
        columns: ['value', ...r.values.map((raw) => ({ raw }))],
        rows: r.values.map((v, i) => [v, ...r.coincidence[i]]),
      },
    ],
    steps: [
      step(
        'agreement.coincidence',
        'o_{ck} = \\sum_u \\frac{\\text{number of } c\\text{-}k \\text{ pairs in } u}{m_u - 1}',
        vars,
      ),
      step(DELTA[level]),
      step('agreement.observed', 'D_o = \\frac{1}{n} \\sum_{c,k} o_{ck}\\, \\delta^2_{ck} = [[dO]]', vars),
      step('agreement.expected', 'D_e = \\frac{1}{n(n - 1)} \\sum_{c,k} n_c n_k\\, \\delta^2_{ck} = [[dE]]', vars),
      step('agreement.alpha', '\\alpha = 1 - \\frac{D_o}{D_e} = 1 - \\frac{[[dO]]}{[[dE]]} = [[a]]', vars),
    ],
  };
}

const FORM_ROWS: Record<string, string> = {
  '1,1': 'icc11',
  '2,1': 'icc21',
  '3,1': 'icc31',
  '1,k': 'icc1k',
  '2,k': 'icc2k',
  '3,k': 'icc3k',
};

export function runIcc(values: Values): Outcome {
  const { rows: ratings } = readMatrix(str(values, 'ratings'), 'ratings');
  const ms = meanSquares(ratings);
  const forms = iccForms(ms);
  const at = (id: string) => forms.find((one) => one.id === id)!.value;
  const vars = { bms: ms.bms, jms: ms.jms, wms: ms.wms, ems: ms.ems, n: ms.n, k: ms.k, i2: at('2,1'), i3: at('3,1') };
  return {
    rows: [
      { id: 'targets', value: ms.n },
      { id: 'judges', value: ms.k },
      { id: 'bms', value: ms.bms, sym: '\\mathrm{BMS}' },
      { id: 'jms', value: ms.jms, sym: '\\mathrm{JMS}' },
      { id: 'wms', value: ms.wms, sym: '\\mathrm{WMS}' },
      { id: 'ems', value: ms.ems, sym: '\\mathrm{EMS}' },
      ...forms.map((one) => ({
        id: FORM_ROWS[one.id],
        value: one.value,
        sym: `\\mathrm{ICC}(${one.id})`,
        answer: one.id === '2,1' || one.id === '3,1',
      })),
    ],
    tables: [
      {
        id: 'forms',
        columns: ['form', 'icc', 'f', 'df1', 'df2', 'p', 'low', 'high'],
        rows: forms.map((one) => [`ICC(${one.id})`, one.value, one.f, one.df1, one.df2, one.p, one.low, one.high]),
      },
    ],
    steps: [
      step(
        'agreement.meanSquares',
        '\\mathrm{BMS} = [[bms]],\\ \\mathrm{JMS} = [[jms]],\\ \\mathrm{WMS} = [[wms]],\\ \\mathrm{EMS} = [[ems]]',
        vars,
      ),
      step(
        'agreement.icc21',
        '\\mathrm{ICC}(2,1) = \\frac{\\mathrm{BMS} - \\mathrm{EMS}}' +
          '{\\mathrm{BMS} + (k - 1)\\mathrm{EMS} + k(\\mathrm{JMS} - \\mathrm{EMS})/n} = [[i2]]',
        vars,
      ),
      step(
        'agreement.icc31',
        '\\mathrm{ICC}(3,1) = \\frac{\\mathrm{BMS} - \\mathrm{EMS}}{\\mathrm{BMS} + (k - 1)\\mathrm{EMS}} = [[i3]]',
        vars,
      ),
      step(
        'agreement.iccAverage',
        '\\mathrm{ICC}(\\cdot,k) = \\frac{k\\,\\mathrm{ICC}(\\cdot,1)}{1 + (k - 1)\\,\\mathrm{ICC}(\\cdot,1)}',
      ),
    ],
    notes: [{ id: 'iccScale', vars: { icc: at('2,1'), word: kooLi(at('2,1')) } }],
  };
}

function readPairs(text: string, pairs: boolean): { differences: number[]; means: number[] } {
  const { rows } = readMatrix(text, 'pairs');
  if (pairs) {
    if (rows[0].length !== 2) fail('twoColumns', {}, 'pairs');
    return { differences: rows.map((r) => r[0] - r[1]), means: rows.map((r) => (r[0] + r[1]) / 2) };
  }
  return { differences: rows.flat(), means: [] };
}

export function runBland(values: Values): Outcome {
  const pairs = values.input !== 'diffs';
  const { differences, means } = readPairs(str(values, 'pairs'), pairs);
  const r = blandAltman(differences, means);
  const vars = { bias: r.bias, sd: r.sd, lo: r.lower, hi: r.upper, n: r.n };
  const xs = pairs ? means : differences.map((_, i) => i + 1);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const across = (y: number): [number, number][] => [
    [x0, y],
    [x1, y],
  ];
  return {
    rows: [
      { id: 'pairs', value: r.n },
      { id: 'bias', value: r.bias, sym: '\\bar{d}', answer: true },
      { id: 'sdDiff', value: r.sd, sym: 's_d' },
      { id: 'lower', value: r.lower, sym: '\\text{lower}', answer: true },
      { id: 'upper', value: r.upper, sym: '\\text{upper}', answer: true },
      { id: 'biasLow', value: r.biasCi[0] },
      { id: 'biasHigh', value: r.biasCi[1] },
      { id: 'lowerLow', value: r.lowerCi[0] },
      { id: 'lowerHigh', value: r.lowerCi[1] },
      { id: 'upperLow', value: r.upperCi[0] },
      { id: 'upperHigh', value: r.upperCi[1] },
    ],
    steps: [
      step(pairs ? 'agreement.differences' : 'agreement.differencesGiven', 'd_i = a_i - b_i'),
      step('agreement.bias', '\\bar{d} = [[bias]],\\quad s_d = [[sd]]', vars),
      step(
        'agreement.limits',
        '\\bar{d} \\pm 1.96\\, s_d = [[bias]] \\pm 1.96 \\times [[sd]] = [[[lo]],\\ [[hi]]]',
        vars,
      ),
      step('agreement.limitCi', '\\mathrm{SE}_{\\text{limit}} = s_d \\sqrt{3/n}'),
    ],
    pictures: [
      {
        id: 'bland',
        plot: {
          x: { id: pairs ? 'mean' : 'pair' },
          y: { id: 'difference' },
          series: [
            { id: 'data', kind: 'points', points: xs.map((x, i) => [x, differences[i]]) },
            { id: 'biasLine', points: across(r.bias) },
            { id: 'limitLine', points: across(r.lower), dashed: true, pen: 2 },
            { id: '', points: across(r.upper), dashed: true, pen: 2 },
          ],
        },
      },
    ],
  };
}
