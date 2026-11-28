// A key or a press acts on the selection the browser shows (owner: WP4).
//
// The browser tells ProseMirror that its selection moved with a selectionchange event. Chromium queues that event
// as an ordinary task, and it runs input first. So a key pressed right after Shift+PageDown, Shift+End, or a click
// can reach the editor before the event does. ProseMirror's keydown reads only the DOM changes it had already
// planned to read, not that selection.
//
// The key then acted on the old selection. Backspace after Shift+PageDown deleted nothing, or it deleted the screen
// selected the round before (nightly soak, run 46047189415). A busy page widens that gap, and a person's keys fall
// in it too. A press has the same gap. A toolbar button keeps focus in the text and runs on the old selection. A
// press that moves focus away loses the new selection for good: ProseMirror reads a selectionchange only while its
// editor has focus.
//
// These listeners run on the window in the capture phase, before the shortcut dispatcher, the toolbar, the menus,
// and the editor's own handlers. They have the focused editor read the browser's selection now, as the queued event
// would have. ProseMirror's observer compares that selection with the one it read last and does nothing when they
// match, so a key that moved nothing costs a few microseconds.

import type { EditorView } from '@tiptap/pm/view';

/** The part of ProseMirror's view this reads. Its selectionchange handler calls the same method. */
interface ObservedView {
  composing?: boolean;
  domObserver?: { flush?: unknown };
}

let warnedMissing = false;

/** The editor whose editable element holds `target`: Tiptap marks that element with its editor. */
export function editorViewAt(target: EventTarget | null): EditorView | null {
  if (!target || !('closest' in target) || typeof target.closest !== 'function') return null;
  const dom = (target as Element).closest('.ProseMirror') as
    (Element & { editor?: { view?: EditorView; isDestroyed?: boolean } }) | null;
  const editor = dom?.editor;
  if (!editor || editor.isDestroyed || !editor.view) return null;
  return editor.view.dom === dom ? editor.view : null;
}

/**
 * Has `view` read the browser's selection and any DOM change it has not read yet. It leaves a composition alone:
 * the input method owns the DOM until it ends, and ProseMirror reads it then. If a ProseMirror update removes the
 * observer's flush, it warns once and does nothing, so keys work as they did before this module.
 */
export function readBrowserSelection(view: EditorView): void {
  const observed = view as unknown as ObservedView;
  if (observed.composing) return;
  const observer = observed.domObserver;
  const flush = observer?.flush;
  if (typeof flush !== 'function') {
    if (!warnedMissing)
      console.warn('keySelection: ProseMirror has no domObserver.flush, so keys may act on an old selection.');
    warnedMissing = true;
    return;
  }
  flush.call(observer);
}

/** Has the editor that holds `target` read the browser's selection. It never throws: it runs before every key. */
function readAt(target: EventTarget | null): void {
  try {
    const view = editorViewAt(target);
    if (view) readBrowserSelection(view);
  } catch (error) {
    console.error('keySelection: the editor could not read the selection.', error);
  }
}

/**
 * Reads the browser's selection into the focused editor before any key, press, or context menu is handled. Returns
 * a function that stops.
 */
export function installKeySelection(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    // An input method's key: keyCode 229 is "Process" on Windows and macOS and "Unidentified" on Android and some
    // on-screen keyboards. ProseMirror's own keydown leaves these to the composition too. No other field marks them.
    if (event.isComposing || event.keyCode === 229) return;
    readAt(event.target);
  };
  // A press reads the editor that has focus, before the press can move focus or run a command on its selection.
  const onPress = () => readAt(target.document.activeElement);
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('pointerdown', onPress, true);
  target.addEventListener('contextmenu', onPress, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('pointerdown', onPress, true);
    target.removeEventListener('contextmenu', onPress, true);
  };
}
