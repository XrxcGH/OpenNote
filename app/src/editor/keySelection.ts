// A key acts on the selection the browser shows (owner: WP4).
//
// The browser tells ProseMirror that its selection moved with a selectionchange event. Chromium queues that event
// as an ordinary task, and it runs input first. So a key pressed right after Shift+PageDown, Shift+End, or a click
// can reach the editor before the event does. ProseMirror's keydown reads only the DOM changes it had already
// planned to read, not that selection.
//
// The key then acted on the old selection. Backspace after Shift+PageDown deleted nothing, or it deleted the screen
// selected the round before (nightly soak, run 46047189415). A busy page widens that gap, and a person's keys fall
// in it too.
//
// This listener runs on the window in the capture phase, before the shortcut dispatcher and the editor's own
// handlers. It has the focused editor read the browser's selection now, as the queued event would have.

import type { EditorView } from '@tiptap/pm/view';

/** The part of ProseMirror's DOM observer this reads. Its selectionchange handler calls the same method. */
interface ObservedView {
  domObserver?: { flush?: () => void };
}

/** The editor whose editable element holds `target`: Tiptap marks that element with its editor. */
export function editorViewAt(target: EventTarget | null): EditorView | null {
  if (!target || !('closest' in target) || typeof target.closest !== 'function') return null;
  const dom = (target as Element).closest('.ProseMirror') as
    (Element & { editor?: { view?: EditorView; isDestroyed?: boolean } }) | null;
  const editor = dom?.editor;
  if (!editor || editor.isDestroyed || !editor.view) return null;
  return editor.view.dom === dom ? editor.view : null;
}

/** Has `view` read the browser's selection and any DOM change it has not read yet. */
export function readBrowserSelection(view: EditorView): void {
  (view as unknown as ObservedView).domObserver?.flush?.();
}

/** Reads the browser's selection into the focused editor before any key is handled. Returns a function that stops. */
export function installKeySelection(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    // A composition owns the DOM until it ends, and ProseMirror reads it then.
    if (event.isComposing || event.key === 'Process') return;
    const view = editorViewAt(event.target);
    if (view) readBrowserSelection(view);
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
