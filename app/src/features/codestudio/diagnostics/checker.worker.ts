// The diagnostics worker's entry (client.ts starts it). It answers each request with the findings of one file, so
// parsing and checking a large file never holds up typing.

import { analyze, type AnalyzeRequest, type AnalyzeResult } from './analyze';
import { loadWorkerParser } from './workerParsers';

export interface WorkerRequest extends AnalyzeRequest {
  id: number;
}

export type WorkerReply = { id: number; result: AnalyzeResult } | { id: number; error: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply): void;
}

if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => {
    const { id } = event.data;
    analyze(event.data, loadWorkerParser).then(
      (result) => scope.postMessage({ id, result }),
      (error: unknown) => scope.postMessage({ id, error: String(error) }),
    );
  };
}
