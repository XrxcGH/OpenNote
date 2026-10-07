// Smart tables without an editor (Phase 7): how typed cells become a typed table, what a cell shows, fill, sort,
// filter, number formats, totals, and the chart a table gives. The operations run against a fake table block that
// keeps the data a real one would send.
import { describe, expect, it } from 'vitest';
import { createMarkdownCache } from '../../../editor/markdown';
import type { TableData } from '../../../editor/schema/specs';
import type { TableExtraHost } from '../../page';
import { EN_US, formatValue } from '../engine';
import { EMPTY_SMART, pruneSmart, readSmart, smartPatch, withColumn } from './data';
import type { SmartData } from './data';
import { filledText, shiftFormula } from './fill';
import { buildModel, inferType, shownFor } from './model';
import type { Grid } from './model';
import { addChart, fill, filterBy, setFormat, setTotal, sortColumn } from './ops';
import type { Range, SmartInstance } from './ops';

const COLUMNS = ['item', 'qty', 'price', 'total'];
const TEXT = [
  ['Item', 'Qty', 'Price', 'Total'],
  ['Pen', '2', '1.5', '=B1*C1'],
  ['Ink', '3', '4', ''],
  ['Pad', '10', '2.25', ''],
];

function dataOf(texts: readonly (readonly string[])[]): TableData {
  return {
    header: true,
    columns: COLUMNS.map((id) => ({ id, width: 160 })),
    rows: texts.map((row, r) => ({
      id: `row${r}`,
      cells: Object.fromEntries(COLUMNS.map((id, c) => [id, { markdown: row[c].replace(/[\\*]/g, '\\$&') }])),
    })),
  };
}

const plain = (markdown: string) => markdown.replace(/\\(.)/g, '$1');

const gridOf = (data: TableData): Grid => ({
  header: data.header,
  columnIds: data.columns.map((column) => column.id),
  texts: data.rows.map((row) => data.columns.map((column) => plain(row.cells[column.id].markdown))),
});

interface Fake {
  inst: SmartInstance;
  data(): TableData;
  smart(): SmartData;
  says(): string[];
}

function fake(texts = TEXT, caret = { row: 1, column: 1 }, range?: Range, smart: SmartData = EMPTY_SMART): Fake {
  let data = dataOf(texts);
  let state = smart;
  const said: string[] = [];
  const host = {
    cache: createMarkdownCache(),
    announce: (text: string) => said.push(text),
    apply: async (change: (data: TableData) => TableData | null) => {
      const next = change(data);
      if (!next) return false;
      data = next;
      return true;
    },
  } as unknown as TableExtraHost;
  const inst: SmartInstance = {
    host,
    locale: EN_US,
    smart: () => state,
    model: () => buildModel(gridOf(data), state, EN_US),
    caret: () => caret,
    range: () => range ?? { row0: caret.row, row1: caret.row, col0: caret.column, col1: caret.column },
    commit: async (next) => {
      state = next;
    },
  };
  return { inst, data: () => data, smart: () => state, says: () => said };
}

const column = (data: TableData, index: number) =>
  data.rows.slice(1).map((row) => plain(row.cells[data.columns[index].id].markdown));

describe('shiftFormula', () => {
  it('moves relative references and keeps pinned ones', () => {
    expect(shiftFormula('B1*C1', 1, 0)).toBe('B2*C2');
    expect(shiftFormula('B1*$C$1', 2, 1)).toBe('C3*$C$1');
    expect(shiftFormula('SUM(A1:A3)', 0, 1)).toBe('SUM(B1:B3)');
  });

  it('leaves text in quotes, column names, and function names alone', () => {
    expect(shiftFormula('"A1"&[Price]&LOG10(A1)', 1, 0)).toBe('"A1"&[Price]&LOG10(A2)');
  });

  it('refuses to leave the table', () => {
    expect(shiftFormula('A1', -1, 0)).toBeNull();
    expect(shiftFormula('A1', 0, -1)).toBeNull();
    expect(filledText('=A1+1', -1, 0)).toBe('=A1+1');
  });

  it('copies text that is not a formula', () => {
    expect(filledText('Pen', 3, 0)).toBe('Pen');
  });
});

describe('smart data', () => {
  it('reads what it understands and ignores the rest', () => {
    const smart = readSmart({
      smart: {
        columns: { a: { type: 'currency', decimals: 2, currency: 'EUR', junk: 1 }, b: { type: 'nonsense' } },
        filters: [{ column: 'a', op: 'gt', value: '3' }, { op: 'eq' }, 7],
        charts: [
          { id: 'c1', kind: 'bar', x: 'a', series: ['b', 4] },
          { id: 'c2', kind: 'wheel', x: 'a', series: [] },
        ],
      },
    });
    expect(smart.columns).toEqual({ a: { type: 'currency', decimals: 2, currency: 'EUR' } });
    expect(smart.filters).toEqual([{ column: 'a', op: 'gt', value: '3' }]);
    expect(smart.charts).toEqual([{ id: 'c1', kind: 'bar', x: 'a', series: ['b'] }]);
    expect(readSmart({})).toBe(EMPTY_SMART);
  });

  it('stores nothing when nothing is left, and drops columns that are gone', () => {
    expect(smartPatch(EMPTY_SMART)).toEqual({ smart: null });
    const some = withColumn(EMPTY_SMART, 'a', { type: 'number' });
    expect(smartPatch(some)).toEqual({ smart: some });
    expect(withColumn(some, 'a', { type: undefined })).toEqual(EMPTY_SMART);
    expect(pruneSmart(some, ['b']).columns).toEqual({});
  });
});

describe('the typed table', () => {
  it('infers numbers, percents, and dates from the cells', () => {
    expect(inferType(['1', '2.5', '', '7'], EN_US)).toBe('number');
    expect(inferType(['10%', '20%'], EN_US)).toBe('percent');
    expect(inferType(['2026-01-05', '2026-02-09'], EN_US)).toBe('date');
    expect(inferType(['a', 'b', '3'], EN_US)).toBe('text');
    expect(inferType(['=A1', '=A2'], EN_US)).toBe('number');
  });

  it('runs formulas that name cells and shows their results', () => {
    const model = buildModel(gridOf(dataOf(TEXT)), EMPTY_SMART, EN_US);
    expect(model.names).toEqual(['Item', 'Qty', 'Price', 'Total']);
    expect(model.table.rows[0].cells[3].value).toBe(3);
    expect(shownFor(model, EMPTY_SMART, 0, 3, EN_US)).toEqual({ text: '3', kind: 'number' });
    expect(shownFor(model, EMPTY_SMART, 0, 1, EN_US)).toBeNull();
  });

  it('shows an error in words and keeps text that is not a formula', () => {
    const texts = [...TEXT.slice(0, 1), ['x', '0', '1', '=C1/B1'], ['y', '=1+', '', '']];
    const model = buildModel(gridOf(dataOf(texts)), EMPTY_SMART, EN_US);
    expect(shownFor(model, EMPTY_SMART, 0, 3, EN_US)?.kind).toBe('error');
    expect(shownFor(model, EMPTY_SMART, 1, 1, EN_US)).toBeNull();
  });

  it('formats a column the person picked, and only the cells that change', () => {
    const smart = withColumn(EMPTY_SMART, 'price', { type: 'currency', currency: 'USD', decimals: 2 });
    const model = buildModel(gridOf(dataOf(TEXT)), smart, EN_US);
    expect(shownFor(model, smart, 0, 2, EN_US)?.text).toBe('$1.50');
    expect(formatValue(4, model.table.columns[2], EN_US)).toBe('$4.00');
  });

  it('hides the rows a filter leaves out', () => {
    const smart: SmartData = { ...EMPTY_SMART, filters: [{ column: 'qty', op: 'gt', value: '2' }] };
    expect(buildModel(gridOf(dataOf(TEXT)), smart, EN_US).shown).toEqual([1, 2]);
  });
});

describe('table operations', () => {
  it('sorts the rows by a column and keeps the header first', async () => {
    const table = fake();
    expect(await sortColumn(table.inst, 2, true)).toBe(true);
    expect(column(table.data(), 0)).toEqual(['Ink', 'Pad', 'Pen']);
    expect(plain(table.data().rows[0].cells.item.markdown)).toBe('Item');
    expect(table.says()[0]).toBe('Sorted by Price, largest first.');
    expect(await sortColumn(table.inst, 2, true)).toBe(false);
  });

  it('fills a formula down with its references moved', async () => {
    const table = fake(TEXT, { row: 1, column: 3 }, { row0: 1, row1: 3, col0: 3, col1: 3 });
    expect(await fill(table.inst, 'down')).toBe(true);
    expect(column(table.data(), 3)).toEqual(['=B1*C1', '=B2*C2', '=B3*C3']);
    const model = table.inst.model();
    expect(model.table.rows.map((row) => row.cells[3].value)).toEqual([3, 12, 22.5]);
  });

  it('moves a formula whose cell is bold', async () => {
    const texts = [TEXT[0], ['a', '1', '2', '=B1*C1'], ['b', '3', '4', '']];
    const table = fake(texts, { row: 2, column: 3 });
    table.data().rows[1].cells.total.markdown = String.raw`**\=B1\*C1**`;
    expect(await fill(table.inst, 'down')).toBe(true);
    expect(plain(table.data().rows[2].cells.total.markdown)).toContain('=B2*C2');
    expect(table.data().rows[2].cells.total.markdown.startsWith('**')).toBe(true);
  });

  it('fills one cell from the cell above it', async () => {
    const table = fake(TEXT, { row: 2, column: 3 });
    expect(await fill(table.inst, 'down')).toBe(true);
    expect(column(table.data(), 3)[1]).toBe('=B2*C2');
    expect(await fill(fake(TEXT, { row: 1, column: 3 }).inst, 'down')).toBe(false);
  });

  it('fills right across the selection', async () => {
    const texts = [TEXT[0], ['a', '1', '', ''], ['b', '=B1+1', '', '']];
    const table = fake(texts, { row: 2, column: 1 }, { row0: 2, row1: 2, col0: 1, col1: 3 });
    expect(await fill(table.inst, 'right')).toBe(true);
    expect(plain(table.data().rows[2].cells.price.markdown)).toBe('=C1+1');
    expect(plain(table.data().rows[2].cells.total.markdown)).toBe('=D1+1');
  });

  it('filters by the value under the caret, and clears the filter', async () => {
    const table = fake(TEXT, { row: 2, column: 1 });
    await filterBy(table.inst, 'greater');
    expect(table.smart().filters).toEqual([{ column: 'qty', op: 'gt', value: '3' }]);
    expect(table.inst.model().shown).toEqual([2]);
    expect(table.says().at(-1)).toBe('Showing 1 of 3 rows.');
    await filterBy(table.inst, 'clear');
    expect(table.smart().filters).toEqual([]);
    expect(await filterBy(table.inst, 'clear')).toBe(false);
  });

  it('keeps a filter on a header cell from being made', async () => {
    const table = fake(TEXT, { row: 0, column: 1 });
    expect(await filterBy(table.inst, 'equal')).toBe(false);
  });

  it('sets a number format and nudges decimals', async () => {
    const table = fake();
    await setFormat(table.inst, 2, { type: 'currency' });
    expect(table.smart().columns.price).toEqual({ type: 'currency', currency: 'USD' });
    await setFormat(table.inst, 2, { moreDecimals: -1 });
    expect(table.smart().columns.price?.decimals).toBe(1);
    await setFormat(table.inst, 2, { type: null });
    expect(table.smart().columns).toEqual({});
  });

  it('adds a total that sums the rows a filter shows', async () => {
    const table = fake();
    await setTotal(table.inst, 1, 'sum');
    expect(table.smart().columns.qty?.total).toBe('sum');
    const model = table.inst.model();
    expect(model.table.columns[1].total).toBe('sum');
  });

  it('makes a chart from the number columns, or from the selected cells', async () => {
    const table = fake();
    await addChart(table.inst, 'bar');
    const [chart] = table.smart().charts;
    expect(chart).toMatchObject({ kind: 'bar', x: 'item' });
    expect(chart.series).toEqual(['qty', 'price', 'total']);
    const ranged = fake(TEXT, { row: 1, column: 0 }, { row0: 2, row1: 3, col0: 0, col1: 2 });
    await addChart(ranged.inst, 'line');
    expect(ranged.smart().charts[0]).toMatchObject({ x: 'item', series: ['qty', 'price'], rows: { from: 1, to: 2 } });
  });

  it('says so when a table has no numbers to chart', async () => {
    const table = fake([TEXT[0], ['a', 'b', 'c', 'd']]);
    expect(await addChart(table.inst, 'bar')).toBe(false);
    expect(table.says()[0]).toBe('This table has no column of numbers to chart yet.');
  });
});
