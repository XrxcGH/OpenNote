// The page's side of the diagnostics worker. One worker serves every file. Where workers are missing (tests) or the
// worker fails to start, the page analyzes the file itself, so marks still come.

import type { AnalyzeRequest, AnalyzeResult } from './analyze';
import type { WorkerReply, WorkerRequest } from './checker.worker';

/** The part of a Worker the client uses, so tests can give a stand-in. */
export interface WorkerLike {
  onmessage: ((event: { data: WorkerReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export interface CheckerClient {
  analyze(request: AnalyzeRequest): Promise<AnalyzeResult>;
  dispose(): void;
}

function spawnDefault(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./checker.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

const inThread = (request: AnalyzeRequest) => import('./analyze').then((m) => m.analyze(request));

export function createCheckerClient(spawn: () => WorkerLike | null = spawnDefault): CheckerClient {
  let worker: WorkerLike | null | undefined;
  let next = 1;
  const pending = new Map<
    number,
    { request: AnalyzeRequest; resolve: (r: AnalyzeResult) => void; reject: (e: Error) => void }
  >();

  const failOver = () => {
    worker?.terminate();
    worker = null;
    for (const [id, p] of pending) {
      pending.delete(id);
      inThread(p.request).then(p.resolve, p.reject);
    }
  };

  const start = (): WorkerLike | null => {
    if (worker !== undefined) return worker;
    try {
      worker = spawn();
    } catch {
      worker = null;
    }
    if (worker) {
      worker.onmessage = ({ data }) => {
        const p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        if ('result' in data) p.resolve(data.result);
        else p.reject(new Error(data.error));
      };
      worker.onerror = failOver;
    }
    return worker;
  };

  return {
    analyze(request) {
      const w = start();
      if (!w) return inThread(request);
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { request, resolve, reject });
        w.postMessage({ id, ...request });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(new Error('The diagnostics worker stopped.'));
      pending.clear();
    },
  };
}
