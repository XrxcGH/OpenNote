// What the symbol commands do, in a module that loads when one runs. registrations/textSymbols.ts declares them.
import type { Editor } from '@tiptap/core';
import { altX, altXSelected } from './altx';
import { pickSymbol } from './SymbolDialog';
import { pushRecent, readRecent, writeRecent } from './model';

export { SPECIAL } from './model';

/** Types a character at the caret, replacing the selection, as one undo step. */
export function insertChar(editor: Editor, char: string): void {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.insertText(char);
      return true;
    })
    .run();
}

/** The placeholder that stands for an atom (an equation, an image, a line break) in a text range. */
const ATOM = String.fromCharCode(0xfffc);

/**
 * Alt+X: the code before the caret becomes its character, or the character becomes its code. It leaves atoms alone
 * (an inline equation, an image, a line break) and works inside one text block, so it never deletes content that
 * has no text.
 */
export function runAltX(editor: Editor): boolean {
  const { state } = editor;
  const { from, to, empty, $from, $to } = state.selection;
  if (empty) {
    if (!$from.nodeBefore?.isText) return false;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, ATOM);
    const result = altX(before);
    if (!result) return false;
    editor.view.dispatch(state.tr.insertText(result.replacement, from - result.length, from).scrollIntoView());
    return true;
  }
  if (!($from.sameParent($to) && $from.parent.isTextblock)) return false;
  const text = state.doc.textBetween(from, to, undefined, ATOM);
  if (text.includes(ATOM)) return false;
  const replacement = altXSelected(text);
  if (replacement === null) return false;
  editor.view.dispatch(state.tr.insertText(replacement, from, to).scrollIntoView());
  return true;
}

/** Opens the Symbol dialog and inserts the chosen symbol. */
export async function openSymbolDialog(editor: Editor): Promise<void> {
  const chosen = await pickSymbol();
  if (!chosen || editor.isDestroyed) return;
  insertChar(editor, chosen.char);
  writeRecent(pushRecent(readRecent(), chosen.cp));
}
