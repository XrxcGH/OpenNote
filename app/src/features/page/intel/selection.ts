// The selected text in the editor that has focus, for the writing tools. A module of its own so the command's
// availability can be checked without loading the writing tools' parser.
import { shownPool } from '../pool/shown';

export function selection() {
  const active = shownPool.get()?.active();
  if (!active) return null;
  const { from, to, empty } = active.editor.state.selection;
  return empty ? null : { editor: active.editor, from, to };
}

/** Whether some text is selected in the editor that has focus. */
export function hasTextSelection(): boolean {
  return selection() !== null;
}
