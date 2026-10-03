// The Markdown worker's entry (worker.ts creates it). It answers each request with the document as JSON, or null when
// parsing failed, and the page then parses that block itself.
import { parseTextBlock } from './parse';
import type { ParseRequest, ParseResponse } from './worker';

export function respond(request: ParseRequest): ParseResponse {
  try {
    return { id: request.id, doc: parseTextBlock(request.markdown).toJSON() };
  } catch {
    return { id: request.id, doc: null };
  }
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: ParseResponse): void;
}

if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => scope.postMessage(respond(event.data));
}
