// The Phase 7 exit gate (DEVELOPMENT.md): a 1,000-row table sorts and redraws its chart within 100 ms.
// Each run edits one cell and recalculates. It then filters and sorts on several columns, and builds the chart
// specs. The median of several runs must stay under budget, and the test prints its numbers.
// The spreadsheet budgets of the tables design (section 18, ADR 0065) follow: 100,000 cells with 10,000 formulas, a
// chain 10,000 formulas deep, and 1,000 sums over 10,000 rows. CI runners are slower than the development machine,
// so budgets there are multiplied by CI_FACTOR.

import { describe, expect, it } from 'vitest';
import { buildChartSpec } from './chart';
import { createTable, setCellInput } from './edit';
import { viewIndices } from './filter';
import { EN_US } from './locale';
import type { Table } from './model';

const BUDGET_MS = 100;
const CI_FACTOR = process.env.CI ? 3 : 1;
const QTY = 2;
const PRICE = 3;
const DUE = 4;
const TOTAL = 5;
const CATEGORY = 1;

function generate(rows: number): Table {
  let seed = 12345;
  const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const data = Array.from({ length: rows }, (_, i) => [
    `Item ${i}`,
    `Category ${i % 12}`,
    String(1 + Math.floor(next() * 50)),
    (1 + next() * 499).toFixed(2),
    `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
  ]);
  return createTable(
    [
      { name: 'Item' },
      { name: 'Category' },
      { name: 'Qty', type: 'number' },
      { name: 'Price', type: 'currency' },
      { name: 'Due', type: 'date' },
      { name: 'Total', type: 'currency', formula: '[Qty]*[Price]', total: 'sum' },
      { name: 'Share', type: 'percent', formula: '[Total]/SUM([Total])' },
      { name: 'Band', formula: 'IF([Total]>5000,"high",IF([Total]>1000,"mid","low"))' },
    ],
    data,
    EN_US,
  );
}

function median(table: Table, step: (t: Table, i: number) => void, repeats = 15): number {
  for (let i = 0; i < 3; i++) step(table, i);
  const times: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const started = performance.now();
    step(table, i);
    times.push(performance.now() - started);
  }
  return times.sort((a, b) => a - b)[Math.floor(repeats / 2)];
}

/** Edit, recalculate, filter, sort on two columns, and build a bar chart and a line chart. */
function editSortAndRedraw(table: Table, i: number): void {
  const edited = setCellInput(table, { row: i * 7, col: QTY, raw: String(10 + i) }, EN_US);
  const rows = viewIndices(
    edited,
    {
      filters: [{ column: QTY, op: 'ge', value: '5' }],
      sort: [{ column: CATEGORY }, { column: TOTAL, desc: true }],
    },
    EN_US,
  );
  const bar = buildChartSpec(edited, rows, { kind: 'bar', x: CATEGORY, series: [TOTAL], aggregate: 'sum' }, EN_US);
  const line = buildChartSpec(edited, rows, { kind: 'line', x: DUE, series: [PRICE, TOTAL] }, EN_US);
  if (bar.data.series.length === 0 || line.data.series.length === 0) throw new Error('empty chart');
}

describe('performance budget', () => {
  it('sorts on several columns and recalculates 1,000 rows, with the chart, in under 100 ms', () => {
    const table = generate(1000);
    const total = median(table, editSortAndRedraw);
    const sortOnly = median(table, (t) =>
      viewIndices(t, { sort: [{ column: CATEGORY }, { column: TOTAL, desc: true }, { column: QTY }] }, EN_US),
    );
    const recalcOnly = median(table, (t, i) => setCellInput(t, { row: i, col: QTY, raw: '3' }, EN_US));
    console.info(
      `1,000 rows: edit, sort, and chart ${total.toFixed(1)} ms; sort ${sortOnly.toFixed(1)} ms; ` +
        `recalculation ${recalcOnly.toFixed(1)} ms (budget ${BUDGET_MS} ms)`,
    );
    expect(total).toBeLessThan(BUDGET_MS);
    expect(sortOnly).toBeLessThan(BUDGET_MS);
    expect(recalcOnly).toBeLessThan(BUDGET_MS);
  });

  it('stays linear: 10,000 rows take well under a second', () => {
    const table = generate(10_000);
    const total = median(table, editSortAndRedraw, 5);
    console.info(`10,000 rows: edit, sort, and chart ${total.toFixed(1)} ms`);
    expect(total).toBeLessThan(BUDGET_MS * 10);
  });

  it('produces correct results at this size', () => {
    const table = generate(1000);
    const edited = setCellInput(table, { row: 0, col: QTY, raw: '2' }, EN_US);
    const row = edited.rows[0].cells;
    expect(row[TOTAL].value).toBeCloseTo((row[QTY].value as number) * (row[PRICE].value as number), 6);
    const share = edited.rows.reduce((sum, r) => sum + (r.cells[6].value as number), 0);
    expect(share).toBeCloseTo(1, 9);
  });
});

describe('spreadsheet budgets (ADR 0065)', () => {
  const NUMBERS = Array.from({ length: 10 }, (_, c) => ({ name: `N${c}`, type: 'number' as const }));

  it('edits one cell of 100,000 cells with 10,000 formulas in under 16 ms', () => {
    const data = Array.from({ length: 10_000 }, (_, i) => [
      String(i),
      String(i * 2),
      String(i % 7),
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      `=A${i + 1}+B${i + 1}*C${i + 1}`,
    ]);
    const table = createTable(NUMBERS, data, EN_US);
    const time = median(table, (t, i) => setCellInput(t, { row: 5 + i, col: 0, raw: String(9 + i) }, EN_US));
    const edited = setCellInput(table, { row: 5, col: 0, raw: '100' }, EN_US);
    console.info(`100,000 cells, 10,000 formulas: edit ${time.toFixed(1)} ms (budget 16 ms)`);
    expect(edited.rows[5].cells[9].value).toBe(100 + 10 * 5);
    expect(time).toBeLessThan(16 * CI_FACTOR);
  });

  it('edits the head of a 10,000-deep chain in under 30 ms', () => {
    const data = Array.from({ length: 10_000 }, (_, i) => ['1', i === 0 ? '=A1' : `=B${i}+A${i + 1}`]);
    const table = createTable(NUMBERS.slice(0, 2), data, EN_US);
    expect(table.rows[9999].cells[1].value).toBe(10_000);
    const time = median(table, (t, i) => setCellInput(t, { row: 0, col: 0, raw: String(2 + i) }, EN_US), 9);
    const edited = setCellInput(table, { row: 0, col: 0, raw: '2' }, EN_US);
    console.info(`10,000-deep chain: edit ${time.toFixed(1)} ms (budget 30 ms)`);
    expect(edited.rows[9999].cells[1].value).toBe(10_001);
    expect(time).toBeLessThan(30 * CI_FACTOR);
  });

  it('recalculates 1,000 cells of SUM(A1:A10000) in under 20 ms', () => {
    const data = Array.from({ length: 10_000 }, (_, i) => [String(i), i < 1000 ? `=SUM(A1:A10000)+${i}` : '']);
    const table = createTable(NUMBERS.slice(0, 2), data, EN_US);
    const time = median(table, (t, i) => setCellInput(t, { row: 5000 + i, col: 0, raw: String(i) }, EN_US));
    const edited = setCellInput(table, { row: 0, col: 0, raw: '1' }, EN_US);
    console.info(`1,000 sums over 10,000 rows: edit ${time.toFixed(1)} ms (budget 20 ms)`);
    expect(edited.rows[999].cells[1].value).toBe(49_995_000 + 1 + 999);
    expect(time).toBeLessThan(20 * CI_FACTOR);
  });
});
