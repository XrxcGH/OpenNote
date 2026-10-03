// Re-parsing only the range of a block that changed (ARCHITECTURE.md section 9.3; owner after WP0: WP1). WP0's
// version always asks for a full parse, which is correct and only slower.
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownCache } from './cache';

export type Reparse = { from: number; to: number; content: Fragment } | 'full';

export function reparseRange(_doc: PMNode, _docMarkdown: string, _next: string, _cache: MarkdownCache): Reparse {
  return 'full';
}
