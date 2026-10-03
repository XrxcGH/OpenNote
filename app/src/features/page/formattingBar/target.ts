// The editor that formatting commands act on (owner: WP4): the focused text editor. While focus is in the command
// bar, the palette, or a menu, it is the editor that had focus last. This module is light, because the start-up
// registrations read it for `when` and checked states.
import type { Editor } from '@tiptap/core';
import { shownPool } from '../pool/pool';
import type { EditorPool } from '../pool/pool';

let watched: EditorPool | null = null;
let last: string | null = null;
let stop: (() => void) | null = null;

function watch(): void {
  const pool = shownPool.get();
  if (pool === watched) return;
  stop?.();
  stop = null;
  last = null;
  watched = pool;
  if (pool) stop = pool.onActiveChange((block) => void (block !== null && (last = block)));
}

const usable = (editor: Editor | null | undefined): Editor | null =>
  editor && !editor.isDestroyed && editor.isEditable ? editor : null;

/** The editor a formatting command runs on, or null when no text editor is or was active on the shown page. */
export function targetEditor(): Editor | null {
  watch();
  const pool = shownPool.get();
  if (!pool) return null;
  const active = pool.active();
  if (active) {
    last = active.block;
    return usable(active.editor);
  }
  return last === null ? null : usable(pool.editor(last));
}
