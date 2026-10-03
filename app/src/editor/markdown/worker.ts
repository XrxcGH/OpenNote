// Parsing large blocks off the main thread (ARCHITECTURE.md section 9.1; owner after WP0: WP1). WP0's version
// parses on the main thread, with the same signature the module worker will have.
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseTextBlock } from './parse';

export interface ParseRequest {
  id: number;
  markdown: string;
}
/** `doc` is the textSchema document as JSON. */
export interface ParseResponse {
  id: number;
  doc: unknown;
}

export function parseInWorker(markdown: string, signal?: AbortSignal): Promise<PMNode> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return Promise.resolve(parseTextBlock(markdown));
}
