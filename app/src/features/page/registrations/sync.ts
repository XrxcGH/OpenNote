// WP2's registrations. Undo and redo on the page refine the tree's Ctrl+Z and Ctrl+Y while focus is in the page, so
// typing is never undone by a tree command. A hidden window flushes (ARCHITECTURE.md section 10.2), so typed text
// reaches the core before Windows can suspend or end the app.
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

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void shownQueue.get()?.flushAll('hidden');
  });
}
