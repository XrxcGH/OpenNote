// WP2's registrations. Undo and redo on the page refine the tree's Ctrl+Z and Ctrl+Y while focus is in the page, so
// typing is never undone by a tree command. A hidden window flushes (ARCHITECTURE.md section 10.2), so typed text
// reaches the core before Windows can suspend or end the app.
import { dismissActionToasts } from '../../../state/toasts';
import { titleBarItems } from '../../../registries';
import { registerPageCommand } from '../keys';
import { shownQueue } from '../sync/shown';
import { RedoButton, UndoButton } from '../sync/UndoRedoButtons';

/**
 * Whether Ctrl+Z means the shown page: focus is in the page, or on nothing at all. Focus falls to the body when an undo
 * removes the focused block or a page tool closes, and the next Ctrl+Z must not undo a tree change such as the page's
 * creation (Beta 5 walk W2-4, W2-5). Focus in the tree, a dialog, or any other field keeps its own undo.
 */
export function pageHasUndo(): boolean {
  if (shownQueue.get() === null) return false;
  const focused = typeof document === 'undefined' ? null : document.activeElement;
  return !focused || focused === document.body || focused.closest('[data-scope="page"]') !== null;
}

registerPageCommand({
  id: 'page.undo',
  title: 'pageSync.undo',
  category: 'editing',
  when: pageHasUndo,
  run: () => {
    dismissActionToasts();
    return shownQueue.get()?.undo();
  },
});
registerPageCommand({
  id: 'page.redo',
  title: 'pageSync.redo',
  category: 'editing',
  when: pageHasUndo,
  run: () => shownQueue.get()?.redo(),
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void shownQueue.get()?.flushAll('hidden');
  });
}

// Always on screen, in every tab and in tablet mode: the title bar, and in the compact layout the app bar. They move
// into More last, after everything else, since they are the only way to undo without a keyboard.
titleBarItems.register({
  id: 'page.undoButton',
  side: 'end',
  order: 5,
  priority: 900,
  compact: 'appBar',
  Component: UndoButton,
});
titleBarItems.register({
  id: 'page.redoButton',
  side: 'end',
  order: 6,
  priority: 899,
  compact: 'appBar',
  Component: RedoButton,
});
