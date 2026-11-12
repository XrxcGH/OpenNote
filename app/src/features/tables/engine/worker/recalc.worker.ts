// The recalculation worker's entry (client.ts starts it). It answers each request with the cells that changed,
// after the lazy statistical chunk when a formula needs it.

import { respondWhenReady } from './run';
import type { RecalcReply, RecalcRequest } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<RecalcRequest>) => void) | null;
  postMessage(message: RecalcReply): void;
}

if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => void respondWhenReady(event.data).then((reply) => scope.postMessage(reply));
}
