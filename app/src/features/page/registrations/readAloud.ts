// WP7's read-aloud registrations: Ctrl+Shift+U, next and previous paragraph, stop, and the Read aloud settings part.
// The engine, the reader, and the bar load on first use.
import { registerPageCommand } from '../keys';
import { editingSettingsParts } from '../registries';
import { shownQueue } from '../sync/shown';

type ReadAloudChunk = typeof import('../readAloud/chunk');
let chunk: ReadAloudChunk | null = null;
const load = (): Promise<ReadAloudChunk> =>
  import('../readAloud/chunk').then((loaded) => {
    chunk = loaded;
    return loaded;
  });

const shown = () => shownQueue.get() !== null;
const reading = () => chunk?.isReading() ?? false;

registerPageCommand({
  id: 'readAloud.toggle',
  title: 'readAloud.commands.toggle',
  keywords: 'readAloud.commands.keywords',
  category: 'view',
  flag: 'editor.readAloud',
  when: shown,
  run: () => load().then((readAloud) => readAloud.toggleReadAloud()),
});
registerPageCommand({
  id: 'readAloud.nextParagraph',
  title: 'readAloud.commands.next',
  keywords: 'readAloud.commands.keywords',
  category: 'view',
  flag: 'editor.readAloud',
  when: reading,
  run: () => chunk?.nextParagraph(),
});
registerPageCommand({
  id: 'readAloud.previousParagraph',
  title: 'readAloud.commands.previous',
  keywords: 'readAloud.commands.keywords',
  category: 'view',
  flag: 'editor.readAloud',
  when: reading,
  run: () => chunk?.previousParagraph(),
});
registerPageCommand({
  id: 'readAloud.stop',
  title: 'readAloud.commands.stop',
  keywords: 'readAloud.commands.keywords',
  category: 'view',
  flag: 'editor.readAloud',
  when: reading,
  run: () => chunk?.stopReadAloud(),
});
editingSettingsParts.register({
  id: 'readAloud',
  title: 'readAloud.settings.title',
  order: 50,
  flag: 'editor.readAloud',
  load: () => import('../settings/EditingReadAloud'),
});
