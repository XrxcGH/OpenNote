// Runs a regular expression or wildcard search in a worker with a time limit. When the limit passes the worker is
// ended, which is the only way to stop a pattern that backtracks without end, and the next search starts a new one.
// Where there are no workers the search runs on the page's own thread.
import { findInTexts } from './match';
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

/**
 * The matches in each text, or 'slow' when the search did not finish within `budgetMs` (the worker is then ended).
 * The clock starts when the worker is ready, so loading it does not count.
 */
export async function scanTexts(
  texts: readonly string[],
  query: string,
  options: FindOptions,
  budgetMs: number,
): Promise<TextRange[][] | 'slow'> {
  const target = start();
  if (!target || !(await target.ready)) {
    if (target) stop();
    return findInTexts(texts, query, options);
  }
  const { worker } = target;
  const id = nextId++;
  return new Promise((resolve) => {
    const done = (value: TextRange[][] | 'slow') => {
      clearTimeout(timer);
      worker.removeEventListener('message', heard);
      worker.removeEventListener('error', failed);
      resolve(value);
    };
    const heard = (event: MessageEvent<ScanResponse>) => {
      if ('id' in event.data && event.data.id === id) done(event.data.ranges);
    };
    const failed = () => {
      stop();
      done(findInTexts(texts, query, options));
    };
    const timer = setTimeout(() => {
      if (running === target) stop();
      done('slow');
    }, budgetMs);
    worker.addEventListener('message', heard);
    worker.addEventListener('error', failed, { once: true });
    const request: ScanRequest = { id, texts: [...texts], query, options };
    worker.postMessage(request);
  });
}
