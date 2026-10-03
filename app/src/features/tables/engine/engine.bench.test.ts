// The Phase 7 exit gate (DEVELOPMENT.md): a 1,000-row table sorts and redraws its chart within 100 ms.
// Each run edits one cell, which recalculates every formula. It then filters and sorts on several columns,
// and builds the chart specs. The median of several runs must stay under budget, and the test prints its numbers.

import { describe, expect, it } from 'vitest';
import { buildChartSpec } from './chart';
import { createTable, setCellInput } from './edit';
import { viewIndices } from './filter';
import { EN_US } from './locale';
import type { Table } from './model';

const BUDGET_MS = 100;
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
