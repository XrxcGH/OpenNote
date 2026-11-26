// Extra keys for a table block's editor (ADR 0063). TableKeys (tableKit.ts) asks this file for
// bindings and tries them before its own. This is a stub: it adds none, so the keys stay as before. The keys
// lane owns this file from its first merge on and adds the spreadsheet keys here.
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorHost } from '../host';

/** A ProseMirror command. It returns false when it does nothing, so the next binding of the key runs. */
export type TableKeyCommand = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;

/** Bindings by ProseMirror key name, such as "Enter" or "Mod-ArrowDown". They run before TableKeys' own. */
export function extraTableKeys(_host: EditorHost): Readonly<Record<string, TableKeyCommand>> {
  return {};
}
