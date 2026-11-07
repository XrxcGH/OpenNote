// The page's side of running code (DESIGN 4.1 and 4.2). Every run gets a fresh worker. The worker is ended when the
// run is done, at the time limit, or at Stop.
//
// To start fast, the host keeps a warm worker per active runtime: loaded, but not yet locked down. The next run takes
// it, and the host loads another when the page is idle. A warm worker nobody used for two minutes is ended, so its
// memory returns. At most two runs go at once; more wait. Nothing from a worker is read before protocol.ts accepts
// it, and output is only ever text.

import type {
  RichMime,
  RunFile,
  RunLimits,
  RunRequest,
  RunStatus,
  RuntimeDiagnostic,
  RuntimeId,
  Stream,
  WorkerMessage,
} from '../contracts/run';
import type { TraceEvent } from '../contracts/debug';
import type { TestResult } from '../contracts/testing';
import { RUN_LIMITS, limitsWithin, readMessage } from './protocol';
import type { HostMessage } from './protocol';

/** The part of a worker the host uses, so tests can stand in for one. */
export interface WorkerLike {
  postMessage(message: HostMessage): void;
  terminate(): void;
  listen(onMessage: (data: unknown) => void, onError: (message: string) => void): void;
}

export type CreateWorker = (runtime: RuntimeId) => WorkerLike;

/** A browser worker as a WorkerLike. */
export function fromWorker(worker: Worker): WorkerLike {
  return {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    listen(onMessage, onError) {
      worker.onmessage = (event: MessageEvent) => onMessage(event.data);
      worker.onmessageerror = () => onError('message');
      worker.onerror = (event) => {
        event.preventDefault();
        onError(event.message || 'error');
      };
    },
  };
}

/** The app's run worker (worker.ts) for one runtime. */
export const createRunWorker: CreateWorker = (runtime) =>
  fromWorker(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `code-run-${runtime}` }));

/** What the console shows after a run, besides its output. */
export type RunNote = 'input-ended' | 'interactive-unavailable' | 'rich-refused' | 'output-cut';

export interface RunResult {
  status: RunStatus;
  exitCode?: number;
  /** For "error", the error's type when the runtime gives one; for "failed", what failed. */
  message: string;
  /** Running time in milliseconds, from when the runtime was ready. */
  elapsedMs: number;
  /** The runtime's version, as it reported it when the run started. */
  version?: string;
  /** Files the program wrote, shown read-only after the run and then dropped (DESIGN 4.3). */
  written: RunFile[];
  notes: RunNote[];
}

export interface RunCallbacks {
  onLoading?(percent: number): void;
  onStarted?(): void;
  onOutput?(stream: Stream, text: string): void;
  onInputWanted?(prompt: string): void;
  onRich?(mime: RichMime, data: string): void;
  onDiagnostics?(items: RuntimeDiagnostic[]): void;
  onTrace?(chunk: TraceEvent[]): void;
  onTest?(result: TestResult): void;
}

export interface RunHandle {
  /** Ends the run now, as Stop does. */
  stop(): void;
  /** Sends one line of interactive input. */
  input(text: string): void;
  /** Ends interactive input. */
  eof(): void;
  done: Promise<RunResult>;
}

/** A run request without its kind; the host adds it. */
export type RunOrder = Omit<RunRequest, 'kind'>;

export interface RunHostOptions {
  createWorker?: CreateWorker;
  /** The page's limits; a run may ask for less. */
  limits?: RunLimits;
  /** How long a warm worker waits for a run before it is ended. */
  idleMs?: number;
  maxRuns?: number;
  /** Runs a task when the page is idle. */
  whenIdle?: (task: () => void) => void;
}

/** Two minutes (DESIGN 4.2). */
export const IDLE_RELEASE_MS = 2 * 60 * 1000;
export const MAX_RUNS = 2;

const defaultIdle = (task: () => void): void => {
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
  if (idle) idle(task);
  else setTimeout(task, 0);
};

interface Warm {
  worker: WorkerLike;
  loaded: boolean;
  percent: number;
  failed: boolean;
  release: ReturnType<typeof setTimeout>;
  /** The run that took this worker, which now hears its messages. */
  take: ((data: unknown) => void) | null;
  takeError: ((message: string) => void) | null;
}

interface Waiting {
  order: RunOrder;
  callbacks: RunCallbacks;
  start: (stopRequested: boolean) => void;
}

export class RunHost {
  private create: CreateWorker;
  private limits: RunLimits;
  private idleMs: number;
  private maxRuns: number;
  private whenIdle: (task: () => void) => void;
  private warmWorkers = new Map<RuntimeId, Warm>();
  private running = 0;
  private waiting: Waiting[] = [];
  private live = new Set<() => void>();
  private disposed = false;

  constructor(options: RunHostOptions = {}) {
    this.create = options.createWorker ?? createRunWorker;
    this.limits = options.limits ?? RUN_LIMITS;
    this.idleMs = options.idleMs ?? IDLE_RELEASE_MS;
    this.maxRuns = options.maxRuns ?? MAX_RUNS;
    this.whenIdle = options.whenIdle ?? defaultIdle;
  }

  /** Whether a warm worker for `runtime` is waiting, and whether it has loaded. */
  warmState(runtime: RuntimeId): 'none' | 'loading' | 'ready' {
    const warm = this.warmWorkers.get(runtime);
    return !warm ? 'none' : warm.loaded ? 'ready' : 'loading';
  }

  /** Loads a worker for `runtime` now, so its next run starts without loading. */
  warm(runtime: RuntimeId): void {
    if (this.disposed || this.warmWorkers.has(runtime)) return;
    const worker = this.create(runtime);
    const warm: Warm = {
      worker,
      loaded: false,
      percent: 0,
      failed: false,
      release: setTimeout(() => this.release(runtime), this.idleMs),
      take: null,
      takeError: null,
    };
    worker.listen(
      (data) => {
        if (warm.take) return warm.take(data);
        const message = readMessage(data);
        if (message?.kind === 'loading') {
          warm.percent = message.percent;
          warm.loaded = message.percent === 100;
        } else if (message?.kind === 'done') {
          // The runtime would not load: this worker is no use, and the next run loads its own.
          warm.failed = true;
          this.release(runtime);
        }
      },
      (error) => {
        if (warm.takeError) return warm.takeError(error);
        warm.failed = true;
        this.release(runtime);
      },
    );
    this.warmWorkers.set(runtime, warm);
    worker.postMessage({ kind: 'load', runtime });
  }

  /** Ends the warm worker of `runtime`, if there is one. */
  release(runtime: RuntimeId): void {
    const warm = this.warmWorkers.get(runtime);
    if (!warm) return;
    clearTimeout(warm.release);
    this.warmWorkers.delete(runtime);
    warm.worker.terminate();
  }

  /** Ends all workers: the warm ones and the running ones. */
  dispose(): void {
    this.disposed = true;
    for (const runtime of [...this.warmWorkers.keys()]) this.release(runtime);
    for (const stop of [...this.live]) stop();
    this.waiting = [];
  }

  /** Runs one program. It waits while two others run. */
  run(order: RunOrder, callbacks: RunCallbacks = {}): RunHandle {
    let stop: () => void = () => undefined;
    let post: (message: HostMessage) => void = () => undefined;
    let stopped = false;
    const done = new Promise<RunResult>((resolve) => {
      const start = (stopRequested: boolean) => {
        if (stopRequested) {
          resolve({ status: 'stopped', message: '', elapsedMs: 0, written: [], notes: [] });
          return;
        }
        this.running += 1;
        const session = this.begin(order, callbacks, (result) => {
          this.running -= 1;
          this.live.delete(session.stop);
          resolve(result);
          this.next();
        });
        this.live.add(session.stop);
        stop = session.stop;
        post = session.post;
        if (stopped) session.stop();
      };
      if (this.running < this.maxRuns && !this.disposed) {
        start(false);
      } else {
        const waiting: Waiting = { order, callbacks, start };
        this.waiting.push(waiting);
        stop = () => {
          this.waiting = this.waiting.filter((other) => other !== waiting);
          start(true);
        };
      }
    });
    return {
      stop: () => {
        stopped = true;
        stop();
      },
      input: (text) => post({ kind: 'input', text }),
      eof: () => post({ kind: 'eof' }),
      done,
    };
  }

  private next(): void {
    if (this.disposed || this.running >= this.maxRuns) return;
    const waiting = this.waiting.shift();
    waiting?.start(false);
  }

  /** Takes the warm worker of the runtime, or makes a new one, and starts the run on it. */
  private begin(
    order: RunOrder,
    callbacks: RunCallbacks,
    finished: (result: RunResult) => void,
  ): { stop: () => void; post: (message: HostMessage) => void } {
    const limits = limitsWithin(order.limits, this.limits);
    const request: RunRequest = { ...order, kind: 'run', limits };
    const warm = this.warmWorkers.get(order.runtime);
    let worker: WorkerLike;
    let onMessage: (data: unknown) => void = () => undefined;
    let onError: (message: string) => void = () => undefined;
    if (warm && !warm.failed) {
      clearTimeout(warm.release);
      this.warmWorkers.delete(order.runtime);
      worker = warm.worker;
      warm.take = (data) => onMessage(data);
      warm.takeError = (message) => onError(message);
      // Still loading: the run shows the rest of the progress.
      if (!warm.loaded) callbacks.onLoading?.(warm.percent);
    } else {
      worker = this.create(order.runtime);
      worker.listen(
        (data) => onMessage(data),
        (message) => onError(message),
      );
    }
    // The next run of this runtime gets a warm worker too, loaded while the page is idle.
    this.whenIdle(() => this.warm(order.runtime));

    /** When the program started, as a performance.now() time; null before. */
    let started: number | null = null;
    let kept = 0;
    let version: string | undefined;
    let interactive = false;
    const notes = new Set<RunNote>();
    let finish: (status: RunStatus, message?: string, end?: Extract<WorkerMessage, { kind: 'done' }>) => void;
    let timer = setTimeout(() => finish('failed', 'load'), limits.loadMs);
    finish = (status, message = '', end) => {
      clearTimeout(timer);
      worker.terminate();
      finish = () => undefined;
      if (kept >= limits.outputChars) notes.add('output-cut');
      if (end?.inputEnded) notes.add('input-ended');
      if (request.stdin.mode === 'interactive' && started !== null && !interactive)
        notes.add('interactive-unavailable');
      finished({
        status,
        message,
        elapsedMs: started === null ? 0 : performance.now() - started,
        written: end?.written ?? [],
        notes: [...notes],
        ...(end?.exitCode === undefined ? {} : { exitCode: end.exitCode }),
        ...(version ? { version } : {}),
      });
    };
    onError = (message) => finish(/out of memory/i.test(message) ? 'memory' : 'failed', message);
    onMessage = (data) => {
      const message = readMessage(data);
      if (!message) {
        if ((data as { kind?: unknown } | null)?.kind === 'rich') notes.add('rich-refused');
        return;
      }
      this.deliver(message, callbacks, {
        started: () => {
          started = performance.now();
          version = message.kind === 'started' ? message.version : undefined;
          interactive = message.kind === 'started' && message.interactive === true;
          clearTimeout(timer);
          timer = setTimeout(() => finish('time'), limits.timeMs);
          callbacks.onStarted?.();
        },
        out: (stream, text) => {
          const room = limits.outputChars - kept;
          if (room <= 0) return notes.add('output-cut');
          const piece = text.slice(0, room);
          if (piece.length < text.length) notes.add('output-cut');
          kept += piece.length;
          callbacks.onOutput?.(stream, piece);
        },
        done: (end) => finish(end.status, end.message, end),
      });
    };
    worker.postMessage(request);
    return { stop: () => finish('stopped'), post: (message) => worker.postMessage(message) };
  }

  private deliver(
    message: WorkerMessage,
    callbacks: RunCallbacks,
    run: {
      started: () => void;
      out: (stream: Stream, text: string) => void;
      done: (end: Extract<WorkerMessage, { kind: 'done' }>) => void;
    },
  ): void {
    switch (message.kind) {
      case 'loading':
        return callbacks.onLoading?.(message.percent);
      case 'started':
        return run.started();
      case 'out':
        return run.out(message.stream, message.text);
      case 'input-wanted':
        return callbacks.onInputWanted?.(message.prompt);
      case 'rich':
        return callbacks.onRich?.(message.mime, message.data);
      case 'diagnostic':
        return callbacks.onDiagnostics?.(message.items);
      case 'trace':
        return callbacks.onTrace?.(message.chunk);
      case 'test':
        return callbacks.onTest?.(message.result);
      case 'done':
        return run.done(message);
    }
  }
}
