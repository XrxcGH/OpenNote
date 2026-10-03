// WP7's page history registrations: the panel, compare, F8 and Shift+F8, naming and deleting, and the Page history
// settings part. The panel, the diff, and the compare view load on first use.
import { registerPageCommand } from '../keys';
import type { PageCommandId } from '../keys';
import type { MessageKey } from '../../../strings/t';
import { editingSettingsParts } from '../registries';
import { shownQueue } from '../sync/shown';

type HistoryChunk = typeof import('../history/chunk');
let chunk: HistoryChunk | null = null;
const load = (): Promise<HistoryChunk> =>
  import('../history/chunk').then((loaded) => {
    chunk = loaded;
    return loaded;
  });

const shown = () => shownQueue.get() !== null;
const open = () => chunk?.isHistoryOpen() ?? false;

function command(id: PageCommandId, title: MessageKey, when: () => boolean, run: () => unknown) {
  registerPageCommand({
    id,
    title,
    keywords: 'history.commands.keywords',
    category: 'view',
    flag: 'page.history',
    when,
    run: () => void run(),
  });
}

const openPanel = () => load().then((history) => history.openHistory());
command('history.open', 'history.commands.open', shown, openPanel);
command('history.compareWith', 'history.commands.compareWith', shown, openPanel);
command('history.nameVersion', 'history.commands.nameVersion', shown, openPanel);
command('history.deleteHistory', 'history.commands.deleteHistory', shown, openPanel);
command('history.nextChange', 'history.commands.nextChange', open, () => chunk?.moveThroughChanges(1));
command('history.previousChange', 'history.commands.previousChange', open, () => chunk?.moveThroughChanges(-1));

editingSettingsParts.register({
  id: 'history',
  title: 'history.settings.title',
  order: 60,
  flag: 'page.history',
  load: () => import('../settings/EditingHistory'),
});
