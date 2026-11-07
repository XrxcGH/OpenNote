// What the symbol commands do, in a module that loads when one runs. registrations/textSymbols.ts declares them.
import type { Editor } from '@tiptap/core';
import { altX, altXSelected } from './altx';
import { pickSymbol } from './SymbolDialog';
import { pushRecent, readRecent, writeRecent } from './model';

/** The special characters the commands insert. */
export const SPECIAL = {
  nbsp: '\u00a0',
  nbHyphen: '\u2011',
  softHyphen: '\u00ad',
  emDash: '\u2014',
  enDash: '\u2013',
} as const;

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

/** Alt+X: the code before the caret becomes its character, or the character becomes its code. */
export function runAltX(editor: Editor): boolean {
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
    const result = altX(before);
    if (!result) return false;
    editor.view.dispatch(state.tr.insertText(result.replacement, from - result.length, from).scrollIntoView());
    return true;
  }
  const replacement = altXSelected(state.doc.textBetween(from, to, undefined, '\ufffc'));
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
