// The recalculation worker with a stand-in that runs the worker's code in this thread after a delay.

import { describe, expect, it } from 'vitest';
import { createTable } from '../edit';
import { EN_US } from '../locale';
import type { Table } from '../model';
import { err } from '../values';
import { cellCount, createRecalcClient, WORKER_CELLS, BUSY_MS, type WorkerLike } from './client';
import type { RecalcReply, RecalcRequest } from './protocol';
import { applyChanges, respond } from './run';

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

  it('sends a large page to the worker and applies the changed cells', async () => {
    const worker = new SlowWorker(5);
    const client = createRecalcClient({ spawn: () => worker, threshold: 4, busyMs: 1000 });
    const [table] = await client.recalc([stale(3)]);
    expect(worker.posted).toBe(1);
    expect(table.rows.map((r) => r.cells[1].value)).toEqual([0, 2, 4]);
    client.dispose();
    expect(worker.terminated).toBe(true);
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

  it('turns error copies back into the engine errors', () => {
    const [table] = applyChanges([stale(1)], [{ table: 0, row: 0, col: 1, value: { error: 'DIV0' } }]);
    expect(table.rows[0].cells[1].value).toBe(err('DIV0'));
  });
});
