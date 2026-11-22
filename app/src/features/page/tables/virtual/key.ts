// The virtualization plugin's key and what other features read from its state (plugin.ts). This file stays small,
// so the page's public index can export it without loading the plugin.
import { PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import type { RowWindow } from './rows';

export interface VirtualRowsState {
  /** The table's row count. */
  readonly rows: number;
  /** Whether the table is over the threshold. */
  readonly virtual: boolean;
  /** The drawn rows of a virtual table, from `from` up to `to`. */
  readonly window: RowWindow;
  /** The typical drawn row's height in CSS pixels, once measured. A row never drawn counts as this tall. */
  readonly rowHeight: number | null;
  /** Counts the sets of marks, so a row marked again sees a new mark. */
  readonly marks: number;
  /**
   * The marks of the rows whose part changed last: each says whether the row is drawn and its number. They stay,
   * mapped through edits, until the next change replaces them, so a transaction a plugin appends never loses them.
   */
  readonly decorations: DecorationSet;
}

export const virtualRowsKey = new PluginKey<VirtualRowsState>('opennote.virtualRows');

/** The rows a virtual table draws now, in order, or null when the table draws every row. */
export function drawnRows(state: EditorState): readonly number[] | null {
  const own = virtualRowsKey.getState(state);
  if (!own?.virtual) return null;
  const out: number[] = [];
  for (let i = own.window.from; i < own.window.to; i++) out.push(i);
  return out;
}
