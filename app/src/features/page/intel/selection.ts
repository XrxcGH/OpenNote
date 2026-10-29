// The selected text in the editor that has focus, for the writing tools and Translate. While focus is in the command
// palette or a menu it is the editor that had focus last, as for the formatting commands.
//
// Opening the palette moves the browser's own selection into its search box, and closing it puts focus back in the
// editor with the caret where the words were, so the selection is gone by the time a command runs. The last selection
// seen is kept with the document it was seen in, and is used while that document has not changed. A module of its
// own so a command's availability can be checked without loading the writing tools' parser.
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { targetEditor } from '../formattingBar/target';

interface Remembered {
  editor: Editor;
  from: number;
  to: number;
  doc: Node;
}

let remembered: Remembered | null = null;

export interface Selected {
  editor: Editor;
  from: number;
  to: number;
}

export function selection(): Selected | null {
  const editor = targetEditor();
  if (!editor) return null;
  const { from, to, empty } = editor.state.selection;
  if (!empty) {
    remembered = { editor, from, to, doc: editor.state.doc };
    return { editor, from, to };
  }
  // The words are still where they were only if nothing was typed since.
  if (remembered && remembered.editor === editor && remembered.doc === editor.state.doc) {
    return { editor, from: remembered.from, to: remembered.to };
  }
  return null;
}

/** Whether some text is selected in the editor that has focus. */
export function hasTextSelection(): boolean {
  return selection() !== null;
}

/** Forgets the remembered selection, for tests. */
export function forgetSelection(): void {
  remembered = null;
}
