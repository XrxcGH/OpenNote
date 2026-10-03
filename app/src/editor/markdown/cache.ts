// The per-node Markdown cache (ARCHITECTURE.md section 9.2). One cache serves one page view. ProseMirror shares
// unchanged nodes between states, so after a keystroke only the edited paragraph and its ancestors are new. A flush
// then serializes one paragraph and re-joins cached strings along one path.
import type { Node as PMNode } from '@tiptap/pm/model';

/** Opaque: only this folder looks inside. */
export interface MarkdownCache {
  readonly __brand: 'MarkdownCache';
}

/** What the serializer remembers about one node. */
export interface CacheEntry {
  /** What the text depends on from outside the node: a list item's marker width, else ''. */
  readonly ctx: string;
  /** The node's Markdown as its parent joins it, with the prefixes it applies to its own children. */
  readonly text: string;
  /**
   * The text with this node's own prefixes taken off: `> ` for a quote or callout, the continuation indent for a
   * list item. The same string as `text` for other nodes.
   */
  readonly inner: string;
  /**
   * Where each child's text starts and ends inside `inner` (UTF-16), for re-parsing a range. A dropped empty
   * paragraph has an empty span where it would be. Null when the children can't be mapped, because the writer
   * joined two adjacent lists into one.
   */
  readonly childStarts: Int32Array | null;
  readonly childEnds: Int32Array | null;
  /** A list item that holds more than one block, which makes its list loose. */
  readonly loose: boolean;
}

export interface CacheState extends MarkdownCache {
  readonly byNode: WeakMap<PMNode, CacheEntry>;
}

export function createMarkdownCache(): MarkdownCache {
  const state: CacheState = { __brand: 'MarkdownCache', byNode: new WeakMap() };
  return state;
}

export function stateOf(cache: MarkdownCache): CacheState {
  return cache as CacheState;
}
