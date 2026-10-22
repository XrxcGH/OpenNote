// The Analyze tools on a smart table: Statistics, Regression, and Matrix. Each reads the selection (or the whole
// table), works the answer out, and adds it below the table as a new table, with a chart where the result has one.
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { formatQuickMath } from '../engine';
import type { Locale } from '../engine';
import { askText } from '../smart/prompt';
import type { SmartInstance } from '../smart/ops';
import { gridToBlockData } from './build';
import type { Grid } from './build';
import {
  asFraction,
  determinant,
  eigenvalues,
  inverse,
  isSquare,
  multiply,
  rankOf,
  reduce,
  solveSystem,
  transpose,
} from './linalg';
import type { Matrix } from './linalg';
import { addressOf, columnValues, parseRange, readBlock } from './read';
import type { Block } from './read';
import { MAX_DEGREE, equationOf, exponentialFit, polynomialFit } from './regression';
import type { Fit } from './regression';
import { boxPlot, histogram, summarize } from './stats';

export type AnalysisTool =
  | 'summary'
  | 'histogram'
  | 'boxPlot'
  | 'linear'
  | 'quadratic'
  | 'cubic'
  | 'polynomial'
  | 'exponential'
  | 'determinant'
  | 'inverse'
  | 'transpose'
  | 'multiply'
  | 'rref'
  | 'rank'
  | 'eigenvalues'
  | 'solve';

type Problem = { key: MessageKey; params?: Record<string, string | number> };
/** `latex` is the same answer as a display equation, for the "as an equation" output. */
type Made = { grids: Grid[]; what: string; latex?: string } | Problem;

const isProblem = (made: Made): made is Problem => 'key' in made;
const problem = (key: MessageKey, params?: Record<string, string | number>): Problem => ({
  key,
  ...(params ? { params } : {}),
});

const num = (value: number, locale: Locale) => (Number.isFinite(value) ? formatQuickMath(value, locale) : '');
const withUnit = (text: string, unit: string | null) => (unit && text !== '' ? `${text} ${unit}` : text);

/** A fraction when a small one matches, else the number. Fractions are text, so a table keeps them as typed. */
function fraction(value: number, locale: Locale): string {
  const f = asFraction(value);
  if (!f) return num(value, locale);
  return f.d === 1 ? String(f.n) : `${f.n}/${f.d}`;
}

/** A number for LaTeX: plain digits with no locale separators. */
const tex = (value: number) => (Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '0');
const texMatrix = (m: Matrix) =>
  `\\begin{bmatrix} ${m.map((row) => row.map(tex).join(' & ')).join(' \\ ')} \\end{bmatrix}`;

function texFit(fit: Fit): string {
  if (fit.kind === 'exponential') {
    const [a, b] = fit.coefficients;
    return `y = ${tex(a)}e^{${tex(b)}x}`;
  }
  const terms: string[] = [];
  for (let power = fit.degree; power >= 0; power--) {
    const c = fit.coefficients[power];
    if (c === 0 && fit.degree > 0) continue;
    const size = tex(Math.abs(c));
    const body = power === 0 ? size : `${size === '1' ? '' : size}x${power === 1 ? '' : `^{${power}}`}`;
    terms.push(terms.length === 0 ? `${c < 0 ? '-' : ''}${body}` : `${c < 0 ? '-' : '+'} ${body}`);
  }
  return `y = ${terms.join(' ') || '0'}`;
}

function matrixOf(block: Block): Matrix | Problem {
  const matrix: Matrix = [];
  for (let r = 0; r < block.rows.length; r++) {
    const row: number[] = [];
    for (let c = 0; c < block.cols.length; c++) {
      const value = block.values[r][c];
      if (value === null)
        return problem('tableMath.problem.notNumber', { address: addressOf(block.rows[r], block.cols[c]) });
      row.push(value);
    }
    matrix.push(row);
  }
  return matrix;
}

const asGrid = (matrix: Matrix, locale: Locale): Grid => ({
  rows: matrix.map((row) => row.map((value) => num(value, locale))),
  types: matrix[0].map(() => 'number' as const),
});

function summaryOf(block: Block, locale: Locale): Made {
  const columns = block.cols
    .map((_, i) => ({ i, summary: summarize(columnValues(block, i)) }))
    .filter((one) => one.summary !== null);
  if (columns.length === 0) return problem('tableMath.problem.noNumbers');
  const unitOf = (i: number) => block.units[i];
  const squared = (i: number) => (unitOf(i) ? `${unitOf(i)}²` : null);
  const rows: [MessageKey, (i: number) => string][] = [
    ['tableMath.label.count', (i) => String(columns.find((c) => c.i === i)!.summary!.count)],
    ['tableMath.label.sum', (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.sum, locale), unitOf(i))],
    ['tableMath.label.mean', (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.mean, locale), unitOf(i))],
    [
      'tableMath.label.median',
      (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.median, locale), unitOf(i)),
    ],
    [
      'tableMath.label.mode',
      (i) =>
        withUnit(
          columns
            .find((c) => c.i === i)!
            .summary!.mode.map((m) => num(m, locale))
            .join(', '),
          unitOf(i),
        ),
    ],
    ['tableMath.label.stdev', (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.stdev, locale), unitOf(i))],
    [
      'tableMath.label.stdevPop',
      (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.stdevPop, locale), unitOf(i)),
    ],
    [
      'tableMath.label.variance',
      (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.variance, locale), squared(i)),
    ],
    [
      'tableMath.label.variancePop',
      (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.variancePop, locale), squared(i)),
    ],
    ['tableMath.label.min', (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.min, locale), unitOf(i))],
    ['tableMath.label.max', (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.max, locale), unitOf(i))],
    ['tableMath.label.q1', (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.q1, locale), unitOf(i))],
    ['tableMath.label.q3', (i) => withUnit(num(columns.find((c) => c.i === i)!.summary!.q3, locale), unitOf(i))],
  ];
  const names = columns.map((c) => block.names[c.i]);
  return {
    what: t('tableMath.title.summary', { columns: names.join(', ') }),
    grids: [
      {
        head: [t('tableMath.label.statistic'), ...names],
        rows: rows.map(([label, cell]) => [t(label), ...columns.map((c) => cell(c.i))]),
      },
    ],
  };
}

function histogramOf(block: Block, locale: Locale): Made {
  const index = block.cols.findIndex((_, i) => columnValues(block, i).length > 0);
  if (index < 0) return problem('tableMath.problem.noNumbers');
  const bins = histogram(columnValues(block, index));
  const unit = block.units[index];
  const title = t('tableMath.title.histogram', { column: block.names[index] });
  return {
    what: title,
    grids: [
      {
        head: [t('tableMath.label.range'), t('tableMath.label.count')],
        rows: bins.map((bin) => [withUnit(`${num(bin.from, locale)}–${num(bin.to, locale)}`, unit), String(bin.count)]),
        types: ['text', 'number'],
        chart: { kind: 'bar', x: 0, series: [1], title },
      },
    ],
  };
}

function boxOf(block: Block, locale: Locale): Made {
  const index = block.cols.findIndex((_, i) => columnValues(block, i).length > 0);
  if (index < 0) return problem('tableMath.problem.noNumbers');
  const box = boxPlot(columnValues(block, index))!;
  const unit = block.units[index];
  const at = (v: number) => withUnit(num(v, locale), unit);
  const list: [MessageKey, string][] = [
    ['tableMath.label.min', at(box.min)],
    ['tableMath.label.q1', at(box.q1)],
    ['tableMath.label.median', at(box.median)],
    ['tableMath.label.q3', at(box.q3)],
    ['tableMath.label.max', at(box.max)],
    ['tableMath.label.iqr', at(box.iqr)],
    ['tableMath.label.lowWhisker', at(box.lowWhisker)],
    ['tableMath.label.highWhisker', at(box.highWhisker)],
    [
      'tableMath.label.outliers',
      box.outliers.length === 0 ? t('tableMath.label.none') : box.outliers.map(at).join(', '),
    ],
  ];
  const title = t('tableMath.title.boxPlot', { column: block.names[index] });
  const values = columnValues(block, index);
  return {
    what: title,
    latex: `${tex(box.min)} \\le Q_1 = ${tex(box.q1)} \\le \\tilde{x} = ${tex(box.median)} \\le Q_3 = ${tex(box.q3)} \\le ${tex(box.max)}`,
    grids: [
      {
        head: [block.names[index], t('tableMath.label.value')],
        rows: values.map((v) => [block.names[index], num(v, locale)]),
        types: ['text', 'number'],
        chart: { kind: 'box', x: 0, series: [1], title },
      },
      { head: [t('tableMath.label.statistic'), t('tableMath.label.value')], rows: list.map(([k, v]) => [t(k), v]) },
    ],
  };
}

function fitOf(block: Block, locale: Locale, tool: AnalysisTool, degree: number): Made {
  const two = block.cols.length >= 2;
  if (!two && block.cols.length !== 1) return problem('tableMath.problem.needPair');
  const xs: number[] = [];
  const ys: number[] = [];
  block.values.forEach((row, r) => {
    const x = two ? row[0] : r + 1;
    const y = two ? row[1] : row[0];
    if (x !== null && y !== null) {
      xs.push(x);
      ys.push(y);
    }
  });
  const needed = tool === 'exponential' ? 2 : degree + 1;
  if (xs.length < needed) return problem('tableMath.problem.fitPoints', { count: needed });
  if (tool === 'exponential' && ys.some((y) => !(y > 0))) return problem('tableMath.problem.exponentialPositive');
  const fit: Fit | null = tool === 'exponential' ? exponentialFit(xs, ys) : polynomialFit(xs, ys, degree);
  if (!fit) return problem('tableMath.problem.fitFailed');
  const xName = two ? block.names[0] : t('tableMath.label.value');
  const yName = two ? block.names[1] : block.names[0];
  const xUnit = two ? block.units[0] : null;
  const yUnit = two ? block.units[1] : block.units[0];
  const title = t('tableMath.title.fit', { y: yName, x: xName });
  const head = (name: string, unit: string | null) => (unit ? `${name} (${unit})` : name);
  const equation = equationOf(fit, (v) => formatSix(v, locale));
  return {
    what: title,
    latex: `${texFit(fit)}, \\quad r^{2} = ${tex(fit.r2)}`,
    grids: [
      {
        head: [t('tableMath.label.item'), t('tableMath.label.value')],
        rows: [
          [t('tableMath.label.equation'), equation],
          [t('tableMath.label.r2'), num(fit.r2, locale)],
          [t('tableMath.label.points'), String(fit.n)],
        ],
      },
      {
        head: [head(xName, xUnit), head(yName, yUnit), head(t('tableMath.label.fitted', { column: yName }), yUnit)],
        rows: xs.map((x, i) => [num(x, locale), num(ys[i], locale), num(fit.predict(x), locale)]),
        types: ['number', 'number', 'number'],
        chart: { kind: 'scatter', x: 0, series: [1, 2], title: `${title}: ${equation}` },
      },
    ],
  };
}

/** Six significant digits, so an equation stays readable. */
function formatSix(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale.tag, { maximumSignificantDigits: 6, useGrouping: false }).format(value);
}

function stepText(step: ReturnType<typeof reduce>['steps'][number], locale: Locale): string {
  if (step.kind === 'swap') return t('tableMath.step.swap', { a: step.a + 1, b: step.b + 1 });
  if (step.kind === 'scale') {
    return t('tableMath.step.scale', { row: step.row + 1, factor: fraction(step.factor, locale) });
  }
  return t('tableMath.step.add', { factor: fraction(step.factor, locale), from: step.from + 1, to: step.to + 1 });
}

function stepsGrid(matrix: Matrix, locale: Locale): Grid {
  const reduction = reduce(matrix);
  const rows: string[][] = [];
  const show = (label: string, m: Matrix) =>
    m.forEach((row, i) => rows.push([i === 0 ? label : '', ...row.map((v) => fraction(v, locale))]));
  show(t('tableMath.label.start'), matrix);
  for (const step of reduction.steps) show(stepText(step, locale), step.matrix);
  show(t('tableMath.step.reduced'), reduction.result);
  return { rows, types: [...matrix[0].map(() => 'text' as const), 'text'] };
}

async function multiplyOf(inst: SmartInstance, first: Matrix, locale: Locale): Promise<Made | null> {
  const model = inst.model();
  const answer = await askText({
    title: t('tableMath.prompt.multiplyTitle'),
    description: t('tableMath.prompt.multiplyDescription'),
    label: t('tableMath.prompt.multiplyLabel'),
    confirmLabel: t('tableMath.prompt.multiplyConfirm'),
    check: (text) => {
      const range = parseRange(text);
      if (!range) return t('tableMath.prompt.badRange');
      if (range.row1 >= model.table.rows.length || range.col1 >= model.columnIds.length) {
        return t('tableMath.prompt.outside', { rows: model.table.rows.length, columns: model.columnIds.length });
      }
      const rows = range.row1 - range.row0 + 1;
      return rows === first[0].length
        ? null
        : t('tableMath.prompt.shape', { first: first[0].length, range: text.trim(), second: rows });
    },
  });
  if (answer === null) return null;
  const range = parseRange(answer)!;
  const second = readBlock(
    model,
    locale,
    { row0: range.row0 + model.offset, row1: range.row1 + model.offset, col0: range.col0, col1: range.col1 },
    'keep',
  );
  if (!second) return problem('tableMath.problem.noNumbers');
  const other = matrixOf(second);
  if ('key' in other) return other;
  const product = multiply(first, other);
  if (!product) return problem('tableMath.prompt.badRange');
  return { what: t('tableMath.title.product'), latex: `AB = ${texMatrix(product)}`, grids: [asGrid(product, locale)] };
}

function matrixTool(tool: AnalysisTool, matrix: Matrix, locale: Locale): Made {
  const rows = matrix.length;
  const columns = matrix[0].length;
  const scalar = (label: MessageKey, text: string, what: MessageKey, latex?: string): Made => ({
    what: t(what),
    ...(latex ? { latex } : {}),
    grids: [{ head: [t('tableMath.label.statistic'), t('tableMath.label.value')], rows: [[t(label), text]] }],
  });
  switch (tool) {
    case 'transpose':
      return {
        what: t('tableMath.title.transpose'),
        latex: `A^{T} = ${texMatrix(transpose(matrix))}`,
        grids: [asGrid(transpose(matrix), locale)],
      };
    case 'rank':
      return scalar(
        'tableMath.label.rank',
        String(rankOf(matrix)),
        'tableMath.title.rank',
        `\\operatorname{rank}(A) = ${rankOf(matrix)}`,
      );
    case 'rref':
      return {
        what: t('tableMath.title.rref'),
        latex: `\\operatorname{rref}(A) = ${texMatrix(reduce(matrix).result)}`,
        grids: [stepsGrid(matrix, locale)],
      };
    case 'solve': {
      if (columns !== rows + 1) return problem('tableMath.problem.needSystem');
      const solution = solveSystem(matrix);
      if (solution.kind === 'none') return problem('tableMath.problem.noSolution');
      if (solution.kind === 'infinite') return problem('tableMath.problem.manySolutions', { rank: solution.rank });
      return {
        what: t('tableMath.title.solve'),
        latex: `x = ${texMatrix(solution.x.map((v) => [v]))}`,
        grids: [
          {
            head: [t('tableMath.label.unknown'), t('tableMath.label.value')],
            rows: solution.x.map((x, i) => [`x${i + 1}`, num(x, locale)]),
            types: ['text', 'number'],
          },
        ],
      };
    }
    default:
      break;
  }
  if (!isSquare(matrix)) return problem('tableMath.problem.needSquare', { rows, columns });
  if (tool === 'determinant') {
    return scalar(
      'tableMath.label.determinant',
      num(determinant(matrix), locale),
      'tableMath.title.determinant',
      `\\det A = ${tex(determinant(matrix))}`,
    );
  }
  if (tool === 'inverse') {
    const inv = inverse(matrix);
    return inv
      ? { what: t('tableMath.title.inverse'), latex: `A^{-1} = ${texMatrix(inv)}`, grids: [asGrid(inv, locale)] }
      : problem('tableMath.problem.singular');
  }
  if (rows > 8) return problem('tableMath.problem.tooBig');
  const found = eigenvalues(matrix);
  const list = found.real.map((value) => [t('tableMath.label.eigenvalue'), num(value, locale)]);
  if (found.complex > 0) list.push([t('tableMath.label.complexEigenvalues'), String(found.complex)]);
  return {
    what: t('tableMath.title.eigenvalues'),
    latex: found.real.length > 0 ? `\\lambda = ${found.real.map(tex).join(',\\; ')}` : undefined,
    grids: [{ head: [t('tableMath.label.statistic'), t('tableMath.label.value')], rows: list }],
  };
}

async function askDegree(): Promise<number | null> {
  const text = await askText({
    title: t('tableMath.prompt.degreeTitle'),
    description: t('tableMath.prompt.degreeDescription'),
    label: t('tableMath.prompt.degreeLabel'),
    initial: '2',
    confirmLabel: t('tableMath.prompt.degreeConfirm'),
    check: (typed) => {
      const n = Number(typed.trim());
      return Number.isInteger(n) && n >= 2 && n <= MAX_DEGREE ? null : t('tableMath.prompt.degreeProblem');
    },
  });
  return text === null ? null : Number(text.trim());
}

/** Runs an Analyze tool on the selection of the table with focus. False when nothing was added. */
export async function runAnalysis(
  inst: SmartInstance,
  tool: AnalysisTool,
  output: 'table' | 'equation' = 'table',
): Promise<boolean> {
  const { locale } = inst;
  const announce = (made: Problem) =>
    inst.host.announce((t as (key: MessageKey, params?: unknown) => string)(made.key, made.params));
  const block = readBlock(inst.model(), locale, inst.range());
  if (!block) {
    announce(problem('tableMath.problem.noNumbers'));
    return false;
  }
  if (block.mixed) {
    announce(problem('tableMath.problem.mixedUnits', block.mixed));
    return false;
  }
  let made: Made | null;
  if (tool === 'summary') made = summaryOf(block, locale);
  else if (tool === 'histogram') made = histogramOf(block, locale);
  else if (tool === 'boxPlot') made = boxOf(block, locale);
  else if (tool === 'linear' || tool === 'quadratic' || tool === 'cubic' || tool === 'exponential') {
    made = fitOf(block, locale, tool, tool === 'linear' ? 1 : tool === 'quadratic' ? 2 : 3);
  } else if (tool === 'polynomial') {
    const degree = await askDegree();
    if (degree === null) return false;
    made = fitOf(block, locale, tool, degree);
  } else {
    const matrix = matrixOf(block);
    if ('key' in matrix) made = matrix;
    else if (tool === 'multiply') made = await multiplyOf(inst, matrix, locale);
    else made = matrixTool(tool, matrix, locale);
  }
  if (made === null) return false;
  if (isProblem(made)) {
    announce(made);
    return false;
  }
  if (output === 'equation') {
    if (!made.latex) {
      announce(problem('tableMath.problem.noEquation'));
      return false;
    }
    const done = await inst.host.insertMath(made.latex);
    inst.host.announce(done ? t('tableMath.done.equation', { what: made.what }) : t('tableMath.problem.nothing'));
    return done;
  }
  // Each new table lands right below the one with focus, and takes focus, so the grids stack in order.
  let added = false;
  for (const grid of made.grids) {
    added = (await inst.host.insertTable(gridToBlockData(grid, inst.host.cache))) || added;
  }
  inst.host.announce(added ? t('tableMath.done.added', { what: made.what }) : t('tableMath.problem.nothing'));
  return added;
}
