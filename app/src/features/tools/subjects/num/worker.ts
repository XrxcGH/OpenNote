// Running a long, pure engine (bootstrap, permutation tests, Gillespie runs, agent-based models, training) off the
// main thread, so the tool window stays responsive. A lane writes a small worker module that calls serveTasks with
// its engines, and the tool calls runTask with a function that starts that worker. Progress comes back as
// fractions. Cancel ends the worker at once, and without workers (tests, or a blocked worker) the engine runs on
// the main thread instead.
import { SubjectError } from '../errors';
import type { SubjectErrorCode } from '../errors';

/** What an engine gets while it runs: a way to report progress, and a question to ask between chunks of work. */
export interface TaskContext {
  /** Reports the share of the work done, from 0 to 1. */
  progress(fraction: number): void;
  /** True once the run was canceled; an engine may stop early when it sees it. */
  canceled(): boolean;
}

/** A pure engine function: plain data in, plain data out (both must survive structured cloning). */
export type TaskFn<I, O> = (input: I, ctx: TaskContext) => O;

export interface TaskSpec<I, O> {
  /** The name the worker module registered the engine under. */
  task: string;
  /** Starts the lane's worker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }). */
  spawn?: () => Worker;
  /** Loads the same engine for the main thread, used when no worker can start. */
  load: () => Promise<TaskFn<I, O>>;
}

export interface RunOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

type Request = { kind: 'run'; task: string; input: unknown };
type Reply =
  | { kind: 'progress'; fraction: number }
  | { kind: 'done'; output: unknown }
  | { kind: 'error'; code: SubjectErrorCode | null; detail: string; message: string };

/** Sends progress at most this often, so a tight loop does not flood the channel. */
const PROGRESS_MS = 50;

function throttled(send: (fraction: number) => void): (fraction: number) => void {
  let last = -Infinity;
  return (fraction) => {
    const now = Date.now();
    if (fraction < 1 && now - last < PROGRESS_MS) return;
    last = now;
    send(Math.min(1, Math.max(0, fraction)));
  };
}

function errorReply(error: unknown): Reply {
  if (error instanceof SubjectError) return { kind: 'error', code: error.code, detail: error.detail, message: '' };
  return { kind: 'error', code: null, detail: '', message: error instanceof Error ? error.message : String(error) };
}

function errorFrom(reply: Extract<Reply, { kind: 'error' }>): Error {
  return reply.code ? new SubjectError(reply.code, reply.detail) : new Error(reply.message);
}

/** The part of a worker's global scope serveTasks uses. */
export interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** Call once in a lane's worker module: answers run requests with the named engines. */
export function serveTasks(tasks: Record<string, TaskFn<never, unknown>>, scope: WorkerScope): void {
  scope.addEventListener('message', (event: MessageEvent) => {
    const request = event.data as Request;
    if (request?.kind !== 'run') return;
    const run = tasks[request.task] as TaskFn<unknown, unknown> | undefined;
    if (!run) {
      scope.postMessage(errorReply(new SubjectError('domain', `unknown task ${request.task}`)));
      return;
    }
    const ctx: TaskContext = {
      progress: throttled((fraction) => scope.postMessage({ kind: 'progress', fraction } satisfies Reply)),
      canceled: () => false,
    };
    try {
      scope.postMessage({ kind: 'done', output: run(request.input, ctx) } satisfies Reply);
    } catch (error) {
      scope.postMessage(errorReply(error));
    }
  });
}

const canceledError = () => new SubjectError('canceled');

async function runHere<I, O>(spec: TaskSpec<I, O>, input: I, options: RunOptions): Promise<O> {
  const run = await spec.load();
  if (options.signal?.aborted) throw canceledError();
  const ctx: TaskContext = {
    progress: throttled((fraction) => options.onProgress?.(fraction)),
    canceled: () => options.signal?.aborted ?? false,
  };
  const output = run(input, ctx);
  if (options.signal?.aborted) throw canceledError();
  options.onProgress?.(1);
  return output;
}

function startWorker(spawn: (() => Worker) | undefined): Worker | null {
  if (!spawn || typeof Worker === 'undefined') return null;
  try {
    return spawn();
  } catch {
    return null;
  }
}

function runThere<O>(worker: Worker, task: string, input: unknown, options: RunOptions): Promise<O> {
  return new Promise<O>((resolve, reject) => {
    const finish = (settle: () => void) => {
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
      settle();
    };
    const abort = () => finish(() => reject(canceledError()));
    options.signal?.addEventListener('abort', abort);
    worker.addEventListener('message', (event: MessageEvent) => {
      const reply = event.data as Reply;
      if (reply.kind === 'progress') options.onProgress?.(reply.fraction);
      else if (reply.kind === 'done') finish(() => resolve(reply.output as O));
      else finish(() => reject(errorFrom(reply)));
    });
    worker.addEventListener('error', (event: ErrorEvent) => finish(() => reject(new Error(event.message))));
    worker.postMessage({ kind: 'run', task, input } satisfies Request);
  });
}

/** Runs the engine in its worker when one can start, else on the main thread. A cancel rejects with 'canceled'. */
export async function runTask<I, O>(spec: TaskSpec<I, O>, input: I, options: RunOptions = {}): Promise<O> {
  if (options.signal?.aborted) throw canceledError();
  const worker = startWorker(spec.spawn);
  if (!worker) return runHere(spec, input, options);
  const output = await runThere<O>(worker, spec.task, input, options);
  options.onProgress?.(1);
  return output;
}
