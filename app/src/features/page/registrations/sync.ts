// WP2's registrations: undo and redo on the page, which refine the tree's Ctrl+Z and Ctrl+Y while focus is in the
// page, so typing is never undone by a tree command.
import { registerPageCommand } from '../keys';
import { shownQueue } from '../sync/shown';

registerPageCommand({
  id: 'page.undo',
  title: 'pageSync.undo',
  category: 'editing',
  when: () => shownQueue.get() !== null,
  run: () => shownQueue.get()?.undo(),
});
registerPageCommand({
  id: 'page.redo',
  title: 'pageSync.redo',
  category: 'editing',
  when: () => shownQueue.get() !== null,
  run: () => shownQueue.get()?.redo(),
});
