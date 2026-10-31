// The scales tool's outcomes for reliability, scoring, and the Spearman-Brown prophecy.
import { sum } from '../kit/num';
import { readList, readMatrix } from '../kit/parse';
import { num, str, type Note, type Outcome, type ResultRow, type Values } from '../kit/spec';
import { fail, step, within, type KitStep } from '../kit/types';
import { scoreScales, type Subscale } from './items';
import { isBinary, kuderRichardson, lengthFor, reliability, spearmanBrown, splitHalf } from './reliability';

/** The respondents-by-items table, its item names, and how many incomplete rows were left out. */
export function readItems(text: string, keepMissing: boolean): { names: string[]; rows: number[][]; dropped: number } {
  const { header, rows } = readMatrix(text, 'data', true);
  const names = header ?? rows[0].map((_, j) => String(j + 1));
  if (keepMissing) return { names, rows, dropped: 0 };
  const complete = rows.filter((row) => row.every((v) => Number.isFinite(v)));
  return { names, rows: complete, dropped: rows.length - complete.length };
}

function krRows(rows: number[][]): { rows: ResultRow[]; steps: KitStep[] } {
  if (!isBinary(rows)) return { rows: [], steps: [] };
  const kr = kuderRichardson(rows);
  const vars = { k: rows[0].length, pq: kr.sumPq, v: kr.totalVariance, kr20: kr.kr20 };
  return {
    rows: [
      { id: 'kr20', value: kr.kr20, sym: '\\mathrm{KR}_{20}' },
      { id: 'kr21', value: kr.kr21, sym: '\\mathrm{KR}_{21}' },
    ],
    steps: [
      step(
        'scales.kr20',
        '\\mathrm{KR}_{20} = \\frac{k}{k - 1}\\left(1 - \\frac{\\sum pq}{\\sigma_X^2}\\right) ' +
          '= \\frac{[[k]]}{[[k]] - 1}\\left(1 - \\frac{[[pq]]}{[[v]]}\\right) = [[kr20]]',
        vars,
      ),
    ],
  };
}

export function runReliability(values: Values): Outcome {
  const { names, rows, dropped } = readItems(str(values, 'data'), false);
  const r = reliability(rows);
  const odd = splitHalf(rows, 'oddEven');
  const halves = splitHalf(rows, 'firstSecond');
  const kr = krRows(rows);
  const vars = {
    k: r.items,
    si: sum(r.itemVariances),
    sx: r.totalVariance,
    a: r.alpha,
    rbar: r.meanR,
    std: r.standardized,
    low: r.low,
    high: r.high,
    r: odd.r,
    sb: odd.corrected,
  };
  const notes: Note[] = dropped > 0 ? [{ id: 'dropped', vars: { n: dropped } }] : [];
  return {
    rows: [
      { id: 'respondents', value: r.respondents },
      { id: 'items', value: r.items },
      { id: 'alpha', value: r.alpha, sym: '\\alpha', answer: true },
      { id: 'low', value: r.low },
      { id: 'high', value: r.high },
      { id: 'standardized', value: r.standardized, sym: '\\alpha_{\\text{std}}' },
      { id: 'meanR', value: r.meanR, sym: '\\bar{r}' },
      { id: 'sumItems', value: sum(r.itemVariances), sym: '\\sum s_i^2' },
      { id: 'totalVariance', value: r.totalVariance, sym: 's_X^2' },
      { id: 'oddEven', value: odd.r },
      { id: 'oddEvenSb', value: odd.corrected },
      { id: 'halves', value: halves.r },
      { id: 'halvesSb', value: halves.corrected },
      ...kr.rows,
    ],
    tables: [
      {
        id: 'items',
        columns: ['item', 'mean', 'sd', 'itemTotal', 'itemRest', 'alphaIfDeleted'],
        rows: r.perItem.map((one, j) => [names[j], one.mean, one.sd, one.itemTotal, one.itemRest, one.alphaIfDeleted]),
      },
    ],
    steps: [
      step('scales.variances', '\\sum s_i^2 = [[si]],\\quad s_X^2 = [[sx]]', vars),
      step(
        'scales.alpha',
        '\\alpha = \\frac{k}{k - 1}\\left(1 - \\frac{\\sum s_i^2}{s_X^2}\\right) ' +
          '= \\frac{[[k]]}{[[k]] - 1}\\left(1 - \\frac{[[si]]}{[[sx]]}\\right) = [[a]]',
        vars,
      ),
      step(
        'scales.feldt',
        '1 - (1 - \\alpha)\\, F_{0.975},\\ 1 - (1 - \\alpha)\\, F_{0.025} = [[low]],\\ [[high]]',
        vars,
      ),
      step('scales.standardized', '\\alpha_{\\text{std}} = \\frac{k\\bar{r}}{1 + (k - 1)\\bar{r}} = [[std]]', vars),
      step('scales.split', 'r_{SB} = \\frac{2r}{1 + r} = \\frac{2 \\times [[r]]}{1 + [[r]]} = [[sb]]', vars),
      ...kr.steps,
    ],
    notes,
  };
}

/** Subscales from lines such as "anxiety: 1, 3, 5"; with none, one unnamed scale of every item. */
export function readSubscales(text: string, count: number): Subscale[] {
  const found = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (found.length === 0) return [{ name: '', items: Array.from({ length: count }, (_, j) => j + 1) }];
  return found.map((line, i) => {
    const at = line.indexOf(':');
    if (at < 1) fail('subscaleLine', { line: i + 1 }, 'subscales');
    return { name: line.slice(0, at).trim(), items: readList(line.slice(at + 1), 'subscales') };
  });
}

export function runScore(values: Values): Outcome {
  const { names, rows } = readItems(str(values, 'data'), true);
  const low = num(values, 'low');
  const high = num(values, 'high');
  if (!(high > low)) fail('lowHigh', {}, 'high');
  const reversedText = str(values, 'reversed').trim();
  const reversed = new Set(reversedText === '' ? [] : readList(reversedText, 'reversed'));
  const scales = readSubscales(str(values, 'subscales'), names.length);
  const method = str(values, 'method') === 'mean' ? 'mean' : 'sum';
  const maxMissing = num(values, 'maxMissing');
  const scores = scoreScales(rows, scales, { reversed, low, high, method, maxMissing });
  const unscored = scores.flat().filter((v) => Number.isNaN(v)).length;
  const vars = { low, high, sum: low + high, m: maxMissing };
  return {
    rows: [
      { id: 'respondents', value: rows.length },
      { id: 'subscales', value: scales.length },
      { id: 'reversedCount', value: reversed.size },
      { id: 'unscored', value: unscored },
    ],
    tables: [
      {
        id: 'scores',
        columns: ['respondent', ...scales.map((scale) => (scale.name === '' ? 'total' : { raw: scale.name }))],
        rows: scores.map((row, i) => [i + 1, ...row.map((v) => (Number.isNaN(v) ? '' : v))]),
      },
      {
        id: 'codebook',
        columns: ['item', 'scale', 'reversed'],
        rows: names.map((name, j) => [
          name,
          scales.length === 1 && scales[0].name === ''
            ? { word: 'total' }
            : scales
                .filter((scale) => scale.items.includes(j + 1))
                .map((scale) => scale.name)
                .join(', '),
          { word: reversed.has(j + 1) ? 'yes' : 'no' },
        ]),
      },
    ],
    steps: [
      step('scales.reverse', "x' = [[sum]] - x", vars),
      step(method === 'mean' ? 'scales.mean' : 'scales.sum'),
      step('scales.prorate', '\\text{score} = \\bar{x}_{\\text{answered}} \\times k', vars),
    ],
  };
}

export function runProphecy(values: Values): Outcome {
  const r = within(num(values, 'r'), 0, 1, 'r');
  const m = num(values, 'factor');
  if (!(m > 0)) fail('positive', {}, 'factor');
  const next = spearmanBrown(r, m);
  const target = num(values, 'target');
  const rows: ResultRow[] = [
    { id: 'r', value: r, sym: 'r' },
    { id: 'factor', value: m, sym: 'm' },
    { id: 'predicted', value: next, sym: "r'", answer: true },
  ];
  const vars = { r, m, next, target, need: NaN };
  const steps = [
    step(
      'scales.prophecy',
      "r' = \\frac{mr}{1 + (m - 1)r} = \\frac{[[m]] \\times [[r]]}{1 + ([[m]] - 1) \\times [[r]]} = [[next]]",
      vars,
    ),
  ];
  if (Number.isFinite(target)) {
    within(target, 0, 1, 'target');
    const need = lengthFor(r, target);
    rows.push({ id: 'needed', value: need, sym: 'm^*' });
    steps.push(step('scales.length', 'm^* = \\frac{r^*(1 - r)}{r(1 - r^*)} = [[need]]', { ...vars, need }));
  }
  return { rows, steps };
}
