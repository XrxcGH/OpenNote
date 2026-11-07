// Runs a regular expression or wildcard search in a worker with a time limit. When the limit passes the worker is
// ended, which is the only way to stop a pattern that backtracks without end, and the next search starts a new one.
// Where there are no workers the search is not run, because nothing could stop it.
import type { FindOptions, TextRange } from './match';
import type { ScanRequest, ScanResponse } from './scanWorker';

/** How long the worker may take to load, in milliseconds, before the search runs on the page instead. */
const START_MS = 5000;

interface Running {
  worker: Worker;
  ready: Promise<boolean>;
}

let running: Running | null | undefined;
let nextId = 1;

function start(): Running | null {
  if (running !== undefined) return running;
  if (typeof Worker === 'undefined') return (running = null);
  try {
    const worker = new Worker(new URL('./scanWorker.ts', import.meta.url), { type: 'module', name: 'find' });
    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), START_MS);
      const heard = (event: MessageEvent<ScanResponse>) => {
        if (!('ready' in event.data)) return;
        clearTimeout(timer);
        worker.removeEventListener('message', heard);
        resolve(true);
      };
      worker.addEventListener('message', heard);
      worker.addEventListener('error', () => resolve(false), { once: true });
    });
    running = { worker, ready };
  } catch {
    running = null;
  }
  return running;
}

function stop(): void {
  running?.worker.terminate();
  running = undefined;
}

/** What a search gives: the matches, or why there are none. 'superseded' means a newer search took its place. */
export type ScanResult = TextRange[][] | 'slow' | 'unavailable' | 'superseded';

let generation = 0;
let cancelRunning: (() => void) | null = null;

/**
 * The matches in each text, or 'slow' when the search did not finish within `budgetMs` (the worker is then ended).
 * One search runs at a time: a new search ends the one before it, which gives 'superseded'. Without a worker a
 * pattern is not run on the page's own thread, because nothing could stop it: the result is 'unavailable'.
 * The clock starts when the worker is ready, so loading it does not count.
 */
export async function scanTexts(
  texts: readonly string[],
  query: string,
  options: FindOptions,
  budgetMs: number,
): Promise<ScanResult> {
  const mine = ++generation;
  if (cancelRunning) {
    cancelRunning();
    stop();
  }
  const target = start();
  if (!target || !(await target.ready)) {
    if (target) stop();
    return 'unavailable';
  }
  if (mine !== generation) return 'superseded';
  const { worker } = target;
  const id = nextId++;
  return new Promise((resolve) => {
    const done = (value: ScanResult) => {
      clearTimeout(timer);
      worker.removeEventListener('message', heard);
      worker.removeEventListener('error', failed);
      if (cancelRunning === cancel) cancelRunning = null;
      resolve(value);
    };
    const cancel = () => done('superseded');
    const heard = (event: MessageEvent<ScanResponse>) => {
      if ('id' in event.data && event.data.id === id) done(event.data.ranges);
    };
    const failed = () => {
      stop();
      done('unavailable');
    };
    const timer = setTimeout(() => {
      if (running === target) stop();
      done('slow');
    }, budgetMs);
    cancelRunning = cancel;
    worker.addEventListener('message', heard);
    worker.addEventListener('error', failed, { once: true });
    const request: ScanRequest = { id, texts: [...texts], query, options };
    worker.postMessage(request);
  });
}
