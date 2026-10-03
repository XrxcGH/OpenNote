// Parsing large blocks off the main thread (ARCHITECTURE.md section 9.3). The page creates one module worker on first
// need, and it parses blocks into document JSON. Where workers aren't available, as in unit tests, or the worker
// fails to start, the same API parses on the main thread instead.
import type { Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { parseTextBlock } from './parse';

export interface ParseRequest {
  id: number;
  markdown: string;
}
/** `doc` is the textSchema document as JSON, or null when the worker could not parse it. */
export interface ParseResponse {
  id: number;
  doc: unknown;
}

/** Blocks up to this many UTF-16 units parse on the main thread within the feedback budget; longer ones here. */
export const MAIN_THREAD_PARSE_LIMIT = 64 * 1024;

interface Pending {
  readonly markdown: string;
  resolve(doc: PMNode): void;
}

const pending = new Map<number, Pending>();
let nextId = 1;
/** Undefined until the first request; null when there is no worker to use. */
let worker: Worker | null | undefined;

function settle(id: number, json: unknown): void {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  try {
    request.resolve(json === null ? parseTextBlock(request.markdown) : textSchema.nodeFromJSON(json));
  } catch {
    request.resolve(parseTextBlock(request.markdown));
  }
}

/** The worker failed: what it still owed is parsed here, and later requests stay on the main thread. */
function fail(): void {
  worker?.terminate();
  worker = null;
  for (const id of [...pending.keys()]) settle(id, null);
}

function start(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    const made = new Worker(new URL('./workerMain.ts', import.meta.url), { type: 'module', name: 'markdown' });
    made.onmessage = (event: MessageEvent<ParseResponse>) => settle(event.data.id, event.data.doc);
    made.onerror = fail;
    made.onmessageerror = fail;
    worker = made;
  } catch {
    worker = null;
  }
  return worker;
}

/** A text block's document, parsed in the worker. Rejects with the signal's reason when it aborts first. */
export function parseInWorker(markdown: string, signal?: AbortSignal): Promise<PMNode> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const target = start();
  if (!target) return Promise.resolve(parseTextBlock(markdown));
  const id = nextId++;
  return new Promise<PMNode>((resolve, reject) => {
    const abort = () => {
      pending.delete(id);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const done = (doc: PMNode) => {
      signal?.removeEventListener('abort', abort);
      resolve(doc);
    };
    pending.set(id, { markdown, resolve: done });
    const request: ParseRequest = { id, markdown };
    target.postMessage(request);
  });
}

/** For tests: forgets the worker, so the next request starts a new one. */
export function resetParseWorker(): void {
  worker?.terminate();
  worker = undefined;
  pending.clear();
}
