// The per-node Markdown cache (ARCHITECTURE.md section 9.2; owner after WP0: WP1). One cache serves one page view.
// WP0's version is a placeholder that remembers nothing, so serializing always walks the whole document.
import type { Node as PMNode } from '@tiptap/pm/model';

/** Opaque: only this folder looks inside. */
export interface MarkdownCache {
  readonly __brand: 'MarkdownCache';
}

interface CacheState extends MarkdownCache {
  readonly byNode: WeakMap<PMNode, string>;
}

export function createMarkdownCache(): MarkdownCache {
  const state: CacheState = { __brand: 'MarkdownCache', byNode: new WeakMap() };
  return state;
}

/** After a mount, in idle time: remembers each top-level node's Markdown. A no-op until WP1's cache lands. */
export function warmCache(_doc: PMNode, _markdown: string, _cache: MarkdownCache): void {}
