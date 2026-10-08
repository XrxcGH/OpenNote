// Folding (ARCHITECTURE.md section 18.2; owner: WP4). A heading folds its section, up to the next heading of the
// same or a higher level among its siblings. A list item folds its nested lists. Heading and list folds are view
// state, kept as positions that edits map. The page saves them in pageViews as keys that survive reloads: the
// block, the text, and which occurrence of that text it is.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/** A fold that survives a reload. The same shape as Phase 2's device-state FoldKey. */
export interface FoldKey {
  block: string;
  kind: 'heading' | 'item';
  text: string;
  occurrence: number;
}

export type FoldKind = FoldKey['kind'];

/** The folded headings and list items, by position. */
export interface FoldState {
  folded: readonly number[];
}

export const foldKey = new PluginKey<FoldState>('opennoteFolds');
/** A transaction's new fold positions, replacing the old ones. */
export const META_FOLDS = 'opennote.folds';

/** The fold positions of each document a folding editor made, so foldKeysFor can read them from the doc. */
const foldsByDoc = new WeakMap<PMNode, readonly number[]>();

export function rememberFolds(doc: PMNode, folded: readonly number[]): void {
  foldsByDoc.set(doc, folded);
}

/** The positions after a heading's section ends: its last sibling before a heading of the same or higher level. */
export function sectionEnd(doc: PMNode, headingPos: number): number {
  const $pos = doc.resolve(headingPos);
  const parent = $pos.parent;
  const heading = $pos.nodeAfter;
  if (!heading || heading.type.name !== 'heading') return headingPos;
  const level = heading.attrs.level as number;
  let end = headingPos + heading.nodeSize;
  for (let index = $pos.index() + 1; index < parent.childCount; index += 1) {
    const sibling = parent.child(index);
    if (sibling.type.name === 'heading' && (sibling.attrs.level as number) <= level) break;
    end += sibling.nodeSize;
  }
  return end;
}

/** What folds at `pos`: a heading with something in its section, or a list item with nested content. */
export function foldableAt(doc: PMNode, pos: number): FoldKind | null {
  const node = doc.nodeAt(pos);
  if (!node) return null;
  if (node.type.name === 'heading') return sectionEnd(doc, pos) > pos + node.nodeSize ? 'heading' : null;
  if (node.type.name === 'listItem') return node.childCount > 1 ? 'item' : null;
  return null;
}

/** The nodes a fold at `pos` hides, as [from, to] ranges of whole nodes. */
export function hiddenRanges(doc: PMNode, pos: number): [number, number][] {
  const node = doc.nodeAt(pos);
  if (!node) return [];
  const ranges: [number, number][] = [];
  if (node.type.name === 'heading') {
    let at = pos + node.nodeSize;
    const end = sectionEnd(doc, pos);
    while (at < end) {
      const sibling = doc.nodeAt(at)!;
      ranges.push([at, at + sibling.nodeSize]);
      at += sibling.nodeSize;
    }
  } else if (node.type.name === 'listItem') {
    let at = pos + 1;
    node.forEach((child, _offset, index) => {
      if (index > 0) ranges.push([at, at + child.nodeSize]);
      at += child.nodeSize;
    });
  }
  return ranges;
}

/** Every foldable heading and list item in document order, with its key's text. */
export function foldables(doc: PMNode): { pos: number; kind: FoldKind; node: PMNode; text: string }[] {
  const found: { pos: number; kind: FoldKind; node: PMNode; text: string }[] = [];
  doc.descendants((node, pos) => {
    const kind = foldableAt(doc, pos);
    if (kind) {
      const text = (kind === 'heading' ? node.textContent : (node.firstChild?.textContent ?? '')).trim();
      found.push({ pos, kind, node, text });
    }
    return !node.isTextblock;
  });
  return found;
}

/** The keys of a block's folds, for pageViews. */
export function foldKeysFor(doc: PMNode, block: string): FoldKey[] {
  const folded = new Set(foldsByDoc.get(doc) ?? []);
  const seen = new Map<string, number>();
  const keys: FoldKey[] = [];
  for (const { pos, kind, text } of foldables(doc)) {
    const id = `${kind}\u0000${text}`;
    const occurrence = seen.get(id) ?? 0;
    seen.set(id, occurrence + 1);
    if (folded.has(pos)) keys.push({ block, kind, text, occurrence });
  }
  return keys;
}

/** The positions that saved keys name in this document. Keys that no longer match are dropped. */
export function positionsFor(doc: PMNode, keys: readonly FoldKey[]): number[] {
  const seen = new Map<string, number>();
  const wanted = new Set(keys.map((key) => `${key.kind}\u0000${key.text}\u0000${key.occurrence}`));
  const positions: number[] = [];
  for (const { pos, kind, text } of foldables(doc)) {
    const id = `${kind}\u0000${text}`;
    const occurrence = seen.get(id) ?? 0;
    seen.set(id, occurrence + 1);
    if (wanted.has(`${id}\u0000${occurrence}`)) positions.push(pos);
  }
  return positions;
}

export function foldsOf(state: EditorState): readonly number[] {
  return foldKey.getState(state)?.folded ?? [];
}

/** Sets the fold positions on a transaction. */
export function setFolds(tr: Transaction, folded: readonly number[]): Transaction {
  return tr.setMeta(
    META_FOLDS,
    [...new Set(folded)].sort((a, b) => a - b),
  );
}

/** The folds that hide `pos`. */
export function foldsHiding(state: EditorState, pos: number): number[] {
  return foldsOf(state).filter((fold) => hiddenRanges(state.doc, fold).some(([from, to]) => pos >= from && pos < to));
}

/**
 * Unfolds whatever hides `pos`, for F7, read aloud, undo, links, and Phase 8's search results. Returns whether
 * anything unfolded.
 */
export function unfoldTo(editor: Editor, pos: number): boolean {
  const hiding = foldsHiding(editor.state, pos);
  if (hiding.length === 0) return false;
  const remaining = foldsOf(editor.state).filter((fold) => !hiding.includes(fold));
  editor.view.dispatch(setFolds(editor.state.tr, remaining));
  return true;
}

/**
 * Unfolds whatever hides a DOM node, in the editor that shows it. For code that reveals something by its element: a
 * link, a search result, a spoken paragraph. Returns whether anything unfolded; a node outside an editor does nothing.
 */
export function unfoldAroundDom(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  const root = element?.closest('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null | undefined;
  const editor = root?.editor;
  if (!editor || editor.isDestroyed || !root?.contains(node)) return false;
  try {
    return unfoldTo(editor, editor.view.posAtDOM(node, 0));
  } catch {
    return false;
  }
}

/** The foldable heading or list item the selection is in: the innermost item with children, else its heading. */
export function foldTargetAt(state: EditorState): { pos: number; kind: FoldKind } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const pos = $from.before(depth);
    const kind = foldableAt(state.doc, pos);
    if (kind) return { pos, kind };
  }
  // A paragraph in a section: the section's heading.
  const parentDepth = Math.max(0, $from.depth - 1);
  const container = $from.node(parentDepth);
  const start = parentDepth === 0 ? 0 : $from.start(parentDepth);
  let offset = start;
  let target: { pos: number; kind: FoldKind } | null = null;
  for (let index = 0; index < $from.index(parentDepth); index += 1) {
    const child = container.child(index);
    if (child.type.name === 'heading' && sectionEnd(state.doc, offset) > $from.pos) {
      target = { pos: offset, kind: 'heading' };
    }
    offset += child.nodeSize;
  }
  return target;
}

/** The nesting depth of a list item: 1 for a top-level item. */
export function itemDepth(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(pos);
  let depth = 0;
  for (let d = $pos.depth; d >= 0; d -= 1) if ($pos.node(d).type.name.endsWith('List')) depth += 1;
  return depth;
}

/**
 * Show levels 1 to `level`: folds every heading of that level and every list item nested that deep, and unfolds
 * the levels above. `null` shows everything.
 */
export function foldsForLevel(state: EditorState, level: number | null): number[] {
  if (level === null) return [];
  return foldables(state.doc)
    .filter(({ pos, kind, node }) =>
      kind === 'heading' ? (node.attrs.level as number) >= level : itemDepth(state, pos) >= level,
    )
    .map(({ pos }) => pos);
}
