// WP7's spelling registrations: F7 and Shift+F7, the Spelling settings part, checking each page as it shows, and
// the spelling menu on misspelled words. The work itself loads with the first page.
import { isEnabled } from '../../../app/flags';
import { registerPageCommand } from '../keys';
import { editingSettingsParts } from '../registries';
import { shownQueue } from '../sync/shown';

type SpellingChunk = typeof import('../spelling/chunk');
const load = (): Promise<SpellingChunk> => import('../spelling/chunk');
let chunk: SpellingChunk | null = null;

const available = () => shownQueue.get() !== null;
registerPageCommand({
  id: 'spelling.next',
  title: 'spelling.commands.next',
  keywords: 'spelling.commands.keywords',
  category: 'editing',
  flag: 'editor.spelling',
  when: available,
  run: () => load().then((spelling) => void spelling.moveToError(1)),
});
registerPageCommand({
  id: 'spelling.previous',
  title: 'spelling.commands.previous',
  keywords: 'spelling.commands.keywords',
  category: 'editing',
  flag: 'editor.spelling',
  when: available,
  run: () => load().then((spelling) => void spelling.moveToError(-1)),
});
editingSettingsParts.register({
  id: 'spelling',
  title: 'spelling.settings.title',
  order: 40,
  flag: 'editor.spelling',
  load: () => import('../settings/EditingSpelling'),
});

let detach: (() => void) | null = null;
let shown = 0;
shownQueue.subscribe(() => {
  const turn = (shown += 1);
  detach?.();
  detach = null;
  if (!shownQueue.get() || !isEnabled('editor.spelling')) return;
  void load().then((spelling) => {
    chunk = spelling;
    if (turn === shown) detach = spelling.attachShownPage();
  });
});
if (typeof window !== 'undefined') {
  window.addEventListener('contextmenu', (event) => void chunk?.spellingContextMenu(event), true);
}
