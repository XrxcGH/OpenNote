// Whether the Format pane must draw again after a transaction. Typing at a caret changes the text but not what the
// pane shows: the format at the caret and its paragraph stay the same. Every field's read walks the selection, so the
// pane skips those transactions and keeps typing off the pane's cost (a long page, the pane open).
import type { EditorState } from '@tiptap/pm/state';

/** What the pane shows for a caret: the caret's marks and the paragraph's chain of nodes. A range has no key. */
export function paneKey(state: EditorState): string | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const marks = (state.storedMarks ?? $from.marks()).map((mark) => [mark.type.name, mark.attrs]);
  const chain: unknown[] = [];
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    chain.push([node.type.name, node.attrs]);
  }
  return JSON.stringify([marks, chain]);
}
