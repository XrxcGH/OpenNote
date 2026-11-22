// What a page does while the financial chunk is still loading. Owner: tables:fn-finance. Each test starts from fresh
// modules, so the chunk has not landed when it begins. PMT(0,10,-100) is 100 paid back in 10 payments at no interest:
// 10, worked by hand.

import { describe, expect, it, vi } from 'vitest';
import type { TableData } from '../../../editor/schema/specs';
import type { RecalcReply, RecalcRequest } from '../engine/worker/protocol';
import type { Table } from '../engine';
import type { BookMember } from './book';
import type { SmartModel } from './model';

// The chart export is checked through the model it hands the chart spec: the drawing itself is not under test.
const seen = vi.hoisted(() => ({ models: [] as SmartModel[] }));
vi.mock('./chartSpec', () => ({
  chartSpec: (model: SmartModel) => {
    seen.models.push(model);
    return null;
  },
}));

const TEXTS = [
  ['A', 'B'],
  ['1', '=PMT(0,10,-100)'],
  ['2', '=IFERROR(PMT(0,10,-100),0)'],
];

const data: TableData & { sheet: Record<string, unknown> } = {
  header: true,
  columns: [
    { id: 'a', width: 160 },
    { id: 'b', width: 160 },
  ],
  rows: TEXTS.map((row, r) => ({ id: `row${r}`, cells: { a: { markdown: row[0] }, b: { markdown: row[1] } } })),
  sheet: {},
};
const stored = data as unknown as Record<string, unknown>;

/** Fresh modules: the financial chunk has not loaded. */
async function fresh() {
  vi.resetModules();
  const finance = await import('../engine/formula/fn/finance');
  const book = await import('./book');
  const model = await import('./model');
  const { EMPTY_SMART } = await import('./data');
  const { EN_US } = await import('../engine');
  const raw = model.prepareModel(book.gridOfData(data), EMPTY_SMART, EN_US).raw;
  const results = () => model.buildModel(book.gridOfData(data), EMPTY_SMART, EN_US).table;
  return { finance, book, raw, results };
}

const valueAt = (table: Table, row: number) => table.rows[row].cells[1].value;
const isBusy = (value: unknown) =>
  typeof value === 'object' && value !== null && 'error' in value && value.error === 'BUSY';

/** Starts the worker's entry in this thread, with a stand-in worker scope. Returns what it posts. */
async function startWorker(): Promise<{
  posted: RecalcReply[];
  send: (request: RecalcRequest) => void;
  stop: () => void;
}> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const posted: RecalcReply[] = [];
  scope.WorkerGlobalScope = class {};
  scope.postMessage = (reply: RecalcReply) => posted.push(reply);
  await import('../engine/worker/recalc.worker');
  const onmessage = scope.onmessage as (event: { data: RecalcRequest }) => void;
  return {
    posted,
    send: (request) => onmessage({ data: request }),
    stop: () => {
      delete scope.WorkerGlobalScope;
      delete scope.postMessage;
      delete scope.onmessage;
    },
  };
}

/** A page member that records the value of the first financial cell each time the page calculates. */
function recorder(raw: Table): { got: unknown[]; member: BookMember } {
  const got: unknown[] = [];
  const member: BookMember = {
    element: { compareDocumentPosition: () => 0 } as unknown as Element,
    raw: () => raw,
    calculated: (table: Table) => got.push(valueAt(table, 0)),
  };
  return { got, member };
}

describe('while the financial chunk loads', () => {
  it('shows #BUSY!, caches nothing, and calculates the page again when the chunk lands', async () => {
    const { finance, book, raw, results } = await fresh();
    expect(finance.financeLoaded()).toBe(false);
    const before = results();
    expect(isBusy(valueAt(before, 0))).toBe(true);
    // IFERROR hides the stand-in and gives its fallback, 0: that is not the cell's value, so it must not be cached.
    expect(valueAt(before, 1)).toBe(0);
    expect(book.valuesPatch(stored, data, undefined, before)).toBeNull();

    const page = new book.PageBook();
    const { got, member } = recorder(raw);
    page.join(member);
    page.refresh();
    expect(got).toHaveLength(1);
    expect(isBusy(got[0])).toBe(true);
    await finance.loadFinance();
    // The chunk landed: the page calculated again without an edit.
    expect(got).toEqual([got[0], 10]);
    page.leave(member);
    const patch = book.valuesPatch(stored, data, undefined, results());
    expect((patch?.sheet as { values: unknown }).values).toEqual({ row1: { b: 10 }, row2: { b: 10 } });
  }, 60_000);

  it('has the worker answer only once the chunk has landed', async () => {
    const { raw } = await fresh();
    const worker = await startWorker();
    try {
      worker.send({ id: 1, tables: [raw], today: 45292 });
      await vi.waitFor(() => expect(worker.posted).toHaveLength(1), { timeout: 30_000 });
      const change = worker.posted[0].changes.find((one) => one.row === 0 && one.col === 1);
      expect(change?.value).toBe(10);
    } finally {
      worker.stop();
    }
  }, 60_000);

  it('gives a real error, not #BUSY!, once the worker cannot load the chunk', async () => {
    const { raw } = await fresh();
    vi.doMock('../engine/formula/fn/lazy/financial', () => {
      throw new Error('the chunk is missing');
    });
    const worker = await startWorker();
    try {
      worker.send({ id: 1, tables: [raw], today: 45292 });
      await vi.waitFor(() => expect(worker.posted).toHaveLength(1), { timeout: 30_000 });
      const change = worker.posted[0].changes.find((one) => one.row === 0 && one.col === 1);
      // #BUSY! would keep the page waiting for an answer that never comes (book.ts treats it as still working).
      expect(change?.value).toEqual({ error: 'CALC' });
    } finally {
      worker.stop();
      vi.doUnmock('../engine/formula/fn/lazy/financial');
    }
  }, 60_000);

  it('loads the chunk before it draws a chart for print', async () => {
    await fresh();
    const { exportTableCharts } = await import('./exportCharts');
    seen.models.length = 0;
    await exportTableCharts({
      header: true,
      columns: [{ id: 'a' }, { id: 'b' }],
      rows: TEXTS.map((row) => ({ cells: { a: row[0], b: row[1] } })),
      smart: { charts: [{ id: 'c1', kind: 'bar', x: 'a', series: ['b'] }] },
    });
    expect(seen.models).toHaveLength(1);
    expect(valueAt(seen.models[0].table, 0)).toBe(10);
  }, 60_000);
});

describe('after the page thread fails to load the financial chunk', () => {
  it('calculates the page again and caches values once the page thread cannot load the chunk', async () => {
    const { finance, book, raw, results } = await fresh();
    vi.doMock('../engine/formula/fn/lazy/financial', () => {
      throw new Error('the chunk is missing');
    });
    try {
      const page = new book.PageBook();
      const { got, member } = recorder(raw);
      page.join(member);
      page.refresh();
      expect(isBusy(got[0])).toBe(true);
      await vi.waitFor(() => expect(got).toHaveLength(2), { timeout: 30_000 });
      // No edit came: the failed load itself calculated the page again, and the cell now gives a real error.
      expect(got[1]).toEqual({ error: 'CALC' });
      page.leave(member);
      // Nothing is still loading, so values are cached again (the load does not start over on every calculation).
      expect(finance.financePending()).toBe(false);
      expect(book.valuesPatch(stored, data, undefined, results())).not.toBeNull();
    } finally {
      vi.doUnmock('../engine/formula/fn/lazy/financial');
    }
  }, 60_000);
});
