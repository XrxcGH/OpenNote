// The virtualization plugin's key and what other features read from its state (plugin.ts). This file stays small,
// so the page's public index can export it without loading the plugin.
import { PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { DecorationSet, EditorView } from '@tiptap/pm/view';
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
  /** The leading rows a virtual table always draws, such as frozen header rows, wherever its window is. */
  readonly pinned: number;
  /** Counts the sets of marks, so a row marked again sees a new mark. */
  readonly marks: number;
  /**
   * The marks of the rows whose part changed last: each says whether the row is drawn and its number. They stay,
   * mapped through edits, until the next change replaces them, so a transaction a plugin appends never loses them.
   */
  readonly decorations: DecorationSet;
}

export const virtualRowsKey = new PluginKey<VirtualRowsState>('opennote.virtualRows');

/** The rows a virtual table draws now, in order: the pinned rows, then the window's. Null when it draws every row. */
export function drawnRows(state: EditorState): readonly number[] | null {
  const own = virtualRowsKey.getState(state);
  if (!own?.virtual) return null;
  const out: number[] = [];
  for (let i = 0; i < Math.min(own.pinned, own.window.from); i++) out.push(i);
  for (let i = own.window.from; i < own.window.to; i++) out.push(i);
  return out;
}

/**
 * Keeps the first `count` rows of a virtual table drawn wherever its window is, for frozen header rows. The page's
 * padding then holds only the rows between them and the window. Does nothing to a table that draws every row.
 */
export function setPinnedRows(view: EditorView, count: number): void {
  const own = virtualRowsKey.getState(view.state);
  if (!own || own.pinned === count) return;
  view.dispatch(view.state.tr.setMeta(virtualRowsKey, { pinned: count }).setMeta('addToHistory', false));
}
