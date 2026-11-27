// A text selection placed by number always ends in text (owner: WP4). Tiptap's setTextSelection makes a
// TextSelection at whatever positions it gets. A number can point between blocks, such as the end of a list after
// its last item.
//
// The page gives an editor a caret by number: an undo restores the one it recorded, and the pool restores the one an
// editor had before it was unmounted. The document may have changed under the number. Enter at such a caret threw
// "Cannot join bulletList onto paragraph" (nightly soak, seed 91, after an undo).
//
// This command replaces Tiptap's. It clamps both ends to the document and moves each one into the nearest text.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';

/** The selection from `anchor` to `head` with each end moved into the nearest text, or near it when there's none. */
export function textSelectionAt(doc: PMNode, anchor: number, head: number = anchor): Selection {
  const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.content.size));
  return TextSelection.between(doc.resolve(clamp(anchor)), doc.resolve(clamp(head)));
}

export const TextSelectionCommand = Extension.create({
  name: 'opennoteTextSelection',
  addCommands() {
    return {
      setTextSelection:
        (position) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const { from, to } = typeof position === 'number' ? { from: position, to: position } : position;
            tr.setSelection(textSelectionAt(tr.doc, from, to));
          }
          return true;
        },
    };
  },
});
