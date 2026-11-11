// The recalculation worker's entry (client.ts starts it). It answers each request with the cells that changed.

import { respond } from './run';
import type { RecalcReply, RecalcRequest } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<RecalcRequest>) => void) | null;
  postMessage(message: RecalcReply): void;
}

if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => scope.postMessage(respond(event.data));
}
