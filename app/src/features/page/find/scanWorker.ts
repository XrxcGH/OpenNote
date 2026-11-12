// The worker that runs a regular expression or wildcard search. A pattern the static check accepts can still take
// minutes on a long paragraph. Nothing can stop a regular expression that is running, so the search runs here.
// The page ends the worker when the time limit passes (scan.ts). The worker says it is ready once it has loaded.
import { findInTexts } from './match';
import type { TextRange } from './match';
import type { FindOptions } from './match';

export interface ScanRequest {
  id: number;
  texts: string[];
  query: string;
  options: FindOptions;
}

export type ScanResponse = { ready: true } | { id: number; ranges: TextRange[][] };

interface WorkerScope {
  onmessage: ((event: MessageEvent<ScanRequest>) => void) | null;
  postMessage(message: ScanResponse): void;
}

if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = ({ data }) =>
    scope.postMessage({ id: data.id, ranges: findInTexts(data.texts, data.query, data.options) });
  scope.postMessage({ ready: true });
}
