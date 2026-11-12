// The recalculation worker's entry (client.ts starts it). It answers each request with the cells that changed.

import { loadFinance } from '../formula/fn/finance';
import { respond } from './run';
import type { RecalcReply, RecalcRequest } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<RecalcRequest>) => void) | null;
  postMessage(message: RecalcReply): void;
}

if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  // The worker only runs large pages, so it loads the financial chunk at once and answers after it lands: its
  // answers never hold a #BUSY! that would wait for the chunk. Requests still answer in order.
  const ready = loadFinance().catch(() => undefined);
  scope.onmessage = (event) => void ready.then(() => scope.postMessage(respond(event.data)));
}
