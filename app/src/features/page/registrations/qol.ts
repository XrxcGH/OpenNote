// The quality-of-life features of typed notes and the page chrome: the commands, their keys, the command bar items,
// the settings part, and the hook that attaches the rest to each page view. This is the one registration file for
// that lane. It loads at start-up, so it holds definitions only; each command loads its code when it first runs.
import { announce } from '../../../ui';
import { chord, defineCommand } from '../../../commands/registry';
import type { CommandDef } from '../../../commands/types';
import { commandBar, commands } from '../../../registries';
import type { CommandBarItem } from '../../../registries/types';
import { t } from '../../../strings/t';
import { targetEditor } from '../formattingBar/target';
import { mountedPageHooks, shownMounted } from '../pagesApi';
import { editingSettingsParts } from '../registries';
import { openFind, readingLock } from '../qol/stores';
import { pageExtrasPrefs, setPrefs } from '../qol/prefs';

const shown = () => shownMounted.get() !== null;
const inList = () => targetEditor() !== null;

type Def = Parameters<typeof defineCommand>[0];
const register = (def: Def): void => {
  commands.register(defineCommand(def) as CommandDef);
};

// Reading mode: a lock against edits and ink.
register({
  id: 'page.lockForReading',
  title: 'pageExtras.lock.command',
  keywords: 'pageExtras.lock.commandKeywords',
  category: 'view',
  keys: [chord('Ctrl+Alt+L')],
  scope: 'page',
  allowInTextInput: true,
  flag: 'page.readingLock',
  when: shown,
  checked: () => readingLock.get(),
  run: () => void import('../qol/lock').then((module) => module.toggleReadingLock()),
});

// Word count and reading time.
register({
  id: 'page.announceWordCount',
  title: 'pageExtras.words.command',
  keywords: 'pageExtras.words.commandKeywords',
  category: 'view',
  flag: 'page.wordCount',
  when: shown,
  run: async () => {
    const mounted = shownMounted.get();
    if (!mounted) return;
    const { pageCounts } = await import('../qol/pageText');
    const counts = pageCounts(mounted);
    announce(
      counts.selection
        ? t('pageExtras.words.announceSelection', { count: counts.selection.words })
        : counts.page.words === 0
          ? t('pageExtras.words.empty')
          : t('pageExtras.words.announcePage', { count: counts.page.words, minutes: counts.page.minutes }),
    );
  },
});

// Checklists.
const checklist = () => import('../qol/checklistCommands');
register({
  id: 'checklist.checkAll',
  title: 'pageExtras.checklist.checkAll',
  keywords: 'pageExtras.checklist.commandKeywords',
  category: 'editing',
  scope: 'editor',
  allowInTextInput: true,
  flag: 'page.checklistExtras',
  when: inList,
  run: () => void checklist().then((module) => module.checkAll(true)),
});
register({
  id: 'checklist.uncheckAll',
  title: 'pageExtras.checklist.uncheckAll',
  keywords: 'pageExtras.checklist.commandKeywords',
  category: 'editing',
  scope: 'editor',
  allowInTextInput: true,
  flag: 'page.checklistExtras',
  when: inList,
  run: () => void checklist().then((module) => module.checkAll(false)),
});
for (const mode of ['keep', 'bottom', 'hide'] as const) {
  register({
    id: `checklist.finished.${mode}`,
    title: `pageExtras.checklist.${mode}`,
    keywords: 'pageExtras.checklist.commandKeywords',
    category: 'editing',
    scope: 'editor',
    flag: 'page.checklistExtras',
    when: inList,
    run: () => void checklist().then((module) => module.setFinishedMode(mode)),
  });
}
register({
  id: 'checklist.doneCount',
  title: 'pageExtras.checklist.toggleCount',
  keywords: 'pageExtras.checklist.commandKeywords',
  category: 'view',
  flag: 'page.checklistExtras',
  when: shown,
  checked: () => pageExtrasPrefs.get().doneCount,
  run: () => void checklist().then((module) => module.toggleDoneCount()),
});

// Typewriter scrolling.
register({
  id: 'page.typewriter',
  title: 'pageExtras.typewriter.command',
  keywords: 'pageExtras.typewriter.commandKeywords',
  category: 'view',
  flag: 'page.typewriter',
  when: shown,
  checked: () => pageExtrasPrefs.get().typewriter,
  run: () => setPrefs({ typewriter: !pageExtrasPrefs.get().typewriter }),
});

// Find and replace.
register({
  id: 'page.find',
  title: 'pageExtras.find.openFind',
  keywords: 'pageExtras.find.keywords',
  category: 'editing',
  keys: [chord('Ctrl+F')],
  scope: 'page',
  allowInTextInput: true,
  flag: 'page.findReplace',
  when: shown,
  run: () => openFind(false),
});
register({
  id: 'page.replace',
  title: 'pageExtras.find.openReplace',
  keywords: 'pageExtras.find.keywords',
  category: 'editing',
  keys: [chord('Ctrl+H')],
  scope: 'page',
  allowInTextInput: true,
  flag: 'page.findReplace',
  when: shown,
  run: () => openFind(true),
});

// The table of contents.
register({
  id: 'page.toc',
  title: 'pageExtras.toc.command',
  keywords: 'pageExtras.toc.commandKeywords',
  category: 'view',
  keys: [chord('Ctrl+Alt+T')],
  scope: 'page',
  allowInTextInput: true,
  flag: 'page.toc',
  when: shown,
  checked: () => pageExtrasPrefs.get().toc,
  run: () => setPrefs({ toc: !pageExtrasPrefs.get().toc }),
});

const bar = (item: Omit<CommandBarItem, 'id'>): CommandBarItem => ({ id: `qol.${item.command}`, ...item });
[
  bar({ tab: 'view', group: 'pageTools', command: 'page.toc', priority: 30, presentation: 'toggle', flag: 'page.toc' }),
  bar({
    tab: 'view',
    group: 'pageTools',
    command: 'page.lockForReading',
    priority: 29,
    presentation: 'toggle',
    flag: 'page.readingLock',
  }),
  bar({ tab: 'home', group: 'find', command: 'page.find', priority: 20, flag: 'page.findReplace' }),
  bar({ tab: 'home', group: 'paragraph', command: 'checklist.checkAll', priority: 36, flag: 'page.checklistExtras' }),
].forEach((item) => commandBar.register(item));

// Settings, then Editing.
editingSettingsParts.register({
  id: 'qol',
  title: 'pageExtras.settings.title',
  order: 70,
  load: () => import('../settings/EditingExtras'),
});

// What loads after start-up: the editor extensions and the hook that attaches the features to each page view.
void import('../qol/editorExtension');
mountedPageHooks.register({
  id: 'qol',
  attach(mounted) {
    let stop: (() => void) | null = null;
    let detached = false;
    void import('../qol/attach').then((module) => {
      stop = detached ? null : module.attachQol(mounted);
    });
    return () => {
      detached = true;
      stop?.();
    };
  },
});
