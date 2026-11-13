// The recalculation worker with a stand-in that runs the worker's code in this thread after a delay.

import { describe, expect, it } from 'vitest';
import { createTable } from '../edit';
import { EN_US } from '../locale';
import type { Table } from '../model';
import { err } from '../values';
import { cellCount, createRecalcClient, WORKER_CELLS, BUSY_MS, type WorkerLike } from './client';
import type { RecalcReply, RecalcRequest } from './protocol';
import { applyChanges, respond, respondWhenReady } from './run';

class SlowWorker implements WorkerLike {
  onmessage: ((event: { data: RecalcReply }) => void) | null = null;
  posted = 0;
  terminated = false;
  constructor(private readonly delay: number) {}
  postMessage(message: RecalcRequest): void {
    this.posted++;
    // Through JSON, as structured cloning copies plain data.
    const copy = JSON.parse(JSON.stringify(message)) as RecalcRequest;
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: respond(copy) });
    }, this.delay);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** A table whose formulas are stale: B is A*2 but holds nothing yet. */
function stale(rows: number): Table {
  const table = createTable(
    [
      { name: 'A', type: 'number' },
      { name: 'B', type: 'number', formula: '[A]*2' },
    ],
    Array.from({ length: rows }, (_, i) => [String(i)]),
    EN_US,
  );
  return { ...table, rows: table.rows.map((row) => ({ ...row, cells: [row.cells[0], { raw: '', value: null }] })) };
}

describe('recalculation worker', () => {
  it('keeps to the documented limits', () => {
    expect(WORKER_CELLS).toBe(20_000);
    expect(BUSY_MS).toBe(2000);
    expect(cellCount([stale(3)])).toBe(6);
  });

  it('recalculates a small page at once, without a worker', async () => {
    const worker = new SlowWorker(0);
    const client = createRecalcClient({ spawn: () => worker });
    const [table] = await client.recalc([stale(3)]);
    expect(table.rows.map((r) => r.cells[1].value)).toEqual([0, 2, 4]);
    expect(worker.posted).toBe(0);
  });

  it('sends a small page to the worker when a table iterates more than 1,000 passes (gap V2-4)', async () => {
    const worker = new SlowWorker(0);
    const client = createRecalcClient({ spawn: () => worker });
    await client.recalc([{ ...stale(3), iterate: { max: 1000, change: 0 } }]);
    expect(worker.posted).toBe(0);
    const [table] = await client.recalc([{ ...stale(3), iterate: { max: 1001, change: 0 } }]);
    expect(worker.posted).toBe(1);
    expect(table.rows.map((r) => r.cells[1].value)).toEqual([0, 2, 4]);
    client.dispose();
  });

  it('sends a large page to the worker and applies the changed cells', async () => {
    const worker = new SlowWorker(5);
    const client = createRecalcClient({ spawn: () => worker, threshold: 4, busyMs: 1000 });
    const [table] = await client.recalc([stale(3)]);
    expect(worker.posted).toBe(1);
    expect(table.rows.map((r) => r.cells[1].value)).toEqual([0, 2, 4]);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('carries the page title to the worker, so CELL("filename") reads it (gap G3)', async () => {
    const worker = new SlowWorker(0);
    const client = createRecalcClient({ spawn: () => worker, threshold: 4, busyMs: 1000 });
    const table = createTable(
      [
        { name: 'A', type: 'number' },
        { name: 'B', type: 'text', formula: 'CELL("filename")' },
      ],
      [['1'], ['2'], ['3']],
      EN_US,
    );
    const blank = { ...table, rows: table.rows.map((r) => ({ ...r, cells: [r.cells[0], { raw: '', value: null }] })) };
    const [done] = await client.recalc([blank], { today: () => 1, title: 'Budget' });
    expect(worker.posted).toBe(1);
    expect(done.rows.map((r) => r.cells[1].value)).toEqual(['Budget', 'Budget', 'Budget']);
    client.dispose();
  });

  it('shows #BUSY! past the busy time, then the results when the worker answers', async () => {
    const worker = new SlowWorker(80);
    const client = createRecalcClient({ spawn: () => worker, threshold: 4, busyMs: 10 });
    let late: Table[] | null = null;
    const arrived = new Promise<void>((resolve) => {
      void client
        .recalc([stale(3)], undefined, (tables) => {
          late = tables;
          resolve();
        })
        .then(([busy]) => {
          expect(busy.rows.map((r) => r.cells[1].value)).toEqual([err('BUSY'), err('BUSY'), err('BUSY')]);
          expect(busy.rows[0].cells[0].value).toBe(0);
        });
    });
    await arrived;
    expect(late![0].rows.map((r) => r.cells[1].value)).toEqual([0, 2, 4]);
  });

  it('gives a small page with a REGEX formula the busy time, and stops a worker that never answers (gap G1)', async () => {
    const hung: WorkerLike = { onmessage: null, postMessage: () => undefined, terminate: () => undefined };
    const client = createRecalcClient({ spawn: () => hung, busyMs: 10 });
    const table = createTable([{ name: 'A', type: 'text' }], [['']], EN_US);
    const page = {
      ...table,
      rows: [{ ...table.rows[0], cells: [{ raw: '=REGEXTEST("a","a")', value: null, formula: 'REGEXTEST("a","a")' }] }],
    };
    const [busy] = await client.recalc([page]);
    expect(busy.rows[0].cells[0].value).toEqual(err('BUSY'));
    client.dispose();
  });

  it('turns error copies back into the engine errors', () => {
    const [table] = applyChanges([stale(1)], [{ table: 0, row: 0, col: 1, value: { error: 'DIV0' } }]);
    expect(table.rows[0].cells[1].value).toBe(err('DIV0'));
  });
});

describe('the worker and the lazy statistical chunk', () => {
  it('waits in the worker for the lazy statistical chunk instead of answering #BUSY!', async () => {
    const table = createTable([{ name: 'A', type: 'number' }], [['']], EN_US);
    const page = {
      ...table,
      rows: [{ ...table.rows[0], cells: [{ raw: '=GEOMEAN(2,8)', value: null, formula: 'GEOMEAN(2,8)' }] }],
    };
    const reply = await respondWhenReady({ id: 1, tables: [page], today: 0 });
    expect(reply.changes).toEqual([{ table: 0, row: 0, col: 0, value: 4 }]);
  });
});
