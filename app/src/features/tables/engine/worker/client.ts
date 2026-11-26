// Recalculation off the page's thread (ADR 0065). A page whose tables hold more than 20,000 cells recalculates in a
// worker, so typing stays smooth. When the worker takes longer than 2 seconds, the formulas show #BUSY! until it
// answers; the person can stop it, which leaves #BUSY! until the next recalculation. Smaller pages recalculate on the
// page at once, unless a table iterates more than 1,000 passes: a small cycle can then still take seconds. Functions
// given through `EngineEnv.functions` stay on the page, so a page that needs them should recalculate there.

import { iterateLimits, type Table } from '../model';
import { DEFAULT_ENV, type EngineEnv } from '../recalc';
import { recalculateBook } from '../workbook';
import type { RecalcReply, RecalcRequest } from './protocol';
import { applyChanges, busyTables } from './run';

/** Pages with more cells than this recalculate in the worker. */
export const WORKER_CELLS = 20_000;
/** Pages with a table that iterates more passes than this recalculate in the worker, however small. */
export const WORKER_PASSES = 1000;
/** How long a recalculation may take before formulas show #BUSY!. */
export const BUSY_MS = 2000;

/** The part of a Worker the client uses, so tests can give a stand-in. */
export interface WorkerLike {
  onmessage: ((event: { data: RecalcReply }) => void) | null;
  postMessage(message: RecalcRequest): void;
  terminate(): void;
}

export interface RecalcClientOptions {
  spawn?: () => WorkerLike;
  /** Default WORKER_CELLS. */
  threshold?: number;
  /** Default BUSY_MS. */
  busyMs?: number;
}

export interface RecalcClient {
  /**
   * Recalculates a page. Resolves with the result, or after the busy time with #BUSY! in every formula cell; in that
   * case `late` gets the result when the worker finishes.
   */
  recalc(tables: readonly Table[], env?: EngineEnv, late?: (tables: Table[]) => void): Promise<Table[]>;
  /** Stops the worker's current recalculation, as the Stop button does. */
  stop(): void;
  dispose(): void;
}

/** How many cells the tables of a page hold. */
export function cellCount(tables: readonly Table[]): number {
  return tables.reduce((sum, t) => sum + t.rows.length * t.columns.length, 0);
}

/** True when a page should recalculate in the worker: it is large, or a table iterates many passes. */
export function needsWorker(tables: readonly Table[], threshold: number): boolean {
  if (cellCount(tables) > threshold) return true;
  if (tables.some((t) => t.iterate !== undefined && iterateLimits(t.iterate).max > WORKER_PASSES)) return true;
  // A short pattern can backtrack for hours, so a page that calls any REGEX function gets the busy budget.
  return tables.some(usesRegex);
}

const REGEX_CALL = /REGEX(?:TEST|MATCH|EXTRACT|REPLACE)\s*\(/i;

/** True when a formula of the table (a column, a cell, or a defined name) calls any REGEX function. */
function usesRegex(t: Table): boolean {
  if (t.columns.some((c) => c.formula !== undefined && REGEX_CALL.test(c.formula))) return true;
  if (t.names?.some((n) => REGEX_CALL.test(n.ref))) return true;
  return t.rows.some((r) => r.cells.some((c) => c.formula !== undefined && REGEX_CALL.test(c.formula)));
}

function spawnDefault(): WorkerLike {
  return new Worker(new URL('./recalc.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export function createRecalcClient(options: RecalcClientOptions = {}): RecalcClient {
  const threshold = options.threshold ?? WORKER_CELLS;
  const busyMs = options.busyMs ?? BUSY_MS;
  let worker: WorkerLike | null = null;
  let nextId = 0;
  const waiting = new Map<number, (reply: RecalcReply) => void>();

  const start = (): WorkerLike => {
    if (worker) return worker;
    const made = (options.spawn ?? spawnDefault)();
    made.onmessage = (event) => {
      const settle = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      settle?.(event.data);
    };
    worker = made;
    return made;
  };

  return {
    recalc(tables, env = DEFAULT_ENV, late) {
      if (!needsWorker(tables, threshold)) return Promise.resolve(recalculateBook(tables, env));
      const id = nextId++;
      return new Promise<Table[]>((resolve) => {
        let answered = false;
        const timer = setTimeout(() => {
          if (answered) return;
          answered = true;
          resolve(busyTables(tables));
        }, busyMs);
        waiting.set(id, (reply) => {
          const result = applyChanges(tables, reply.changes);
          if (answered) {
            late?.(result);
            return;
          }
          answered = true;
          clearTimeout(timer);
          resolve(result);
        });
        start().postMessage({ id, tables, today: env.today(), title: env.title });
      });
    },
    stop() {
      worker?.terminate();
      worker = null;
      waiting.clear();
    },
    dispose() {
      this.stop();
    },
  };
}
