// Text that changed outside the editor: page undo, sync, another window (DESIGN 12). The editor applies it as one
// minimal change, outside the undo history, so the caret maps through it and the person's own undo stays valid.

import { Transaction } from '@codemirror/state';
import type { ChangeSpec, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** The smallest single change from one text to the other: the part between their common start and common end. */
export function minimalChange(before: string, after: string): ChangeSpec | null {
  if (before === after) return null;
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < shortest - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  )
    end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/** Replaces the editor's text without an undo step. Returns false when nothing changed. */
export function replaceExternally(view: EditorView, text: string): boolean {
  const doc: Text = view.state.doc;
  const change = minimalChange(doc.toString(), text);
  if (!change) return false;
  view.dispatch({
    changes: change,
    annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
  });
  return true;
}
