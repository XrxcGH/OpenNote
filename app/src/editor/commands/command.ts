// What every editor command shares (owner: WP4): the ProseMirror command shape, and running one as its own undo
// step. It also builds changes on one transaction and finds the textblocks a selection covers.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { META_COMMAND } from '../meta';

/** A ProseMirror command: it checks without `dispatch`, and changes the document with it. */
export type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/** A change made on a transaction in place. It returns false, and changes nothing, when it doesn't apply. */
export type Change = (tr: Transaction) => boolean;

/** A command from a change. Checking runs the change on a throwaway transaction. */
export function fromChange(change: Change): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    if (!change(tr)) return false;
    dispatch?.(tr);
    return true;
  };
}

/** A change from a ProseMirror command, run on the transaction's current document and selection. */
export function viaCommand(command: Command): Change {
  return (tr) => {
    const state = EditorState.create({ doc: tr.doc, selection: tr.selection, storedMarks: tr.storedMarks });
    let made: Transaction | null = null;
    const ran = command(state, (next) => {
      made = next;
    });
    if (!ran || !made) return false;
    const next: Transaction = made;
    next.steps.forEach((step) => tr.step(step));
    if (next.selectionSet) tr.setSelection(next.selection.map(tr.doc, tr.mapping.slice(tr.steps.length)));
    if (next.storedMarksSet) tr.setStoredMarks(next.storedMarks);
    return true;
  };
}

/**
 * Runs a command on an editor as a command transaction, which the sync sends as its own step after any pending
 * typing. The editor keeps focus, so a command from the bar or the palette returns the caret to the text.
 */
export function runCommand(editor: Editor, command: Command, options: { focus?: boolean } = {}): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  let chain = editor.chain();
  if (options.focus ?? true) chain = chain.focus(undefined, { scrollIntoView: false });
  return chain
    .command(({ state, dispatch }) => command(state, dispatch))
    .setMeta(META_COMMAND, true)
    .run();
}

/** Whether a command can run on the editor now. */
export function canRun(editor: Editor, command: Command): boolean {
  return !editor.isDestroyed && editor.isEditable && command(editor.state);
}

export interface Textblock {
  node: PMNode;
  pos: number;
}

/** The textblocks from `from` to `to`, in document order. A caret touches the one it is in. */
export function textblocksBetween(doc: PMNode, from: number, to: number): Textblock[] {
  const found: Textblock[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) found.push({ node, pos });
    return !node.isTextblock;
  });
  if (found.length === 0) {
    const $from = doc.resolve(from);
    if ($from.parent.isTextblock) found.push({ node: $from.parent, pos: $from.before() });
  }
  return found;
}

/** The textblocks the transaction's selection touches. */
export function selectedTextblocks(tr: Transaction): Textblock[] {
  return textblocksBetween(tr.doc, tr.selection.from, tr.selection.to);
}

/** The depth of the innermost ancestor of `$pos` with one of the given types, or -1. */
export function ancestorDepth($pos: ResolvedPos, names: readonly string[]): number {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (names.includes($pos.node(depth).type.name)) return depth;
  }
  return -1;
}
