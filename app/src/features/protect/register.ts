// The storage and protection features' start-up (beta 5). features/index.ts loads every register.ts.
// It listens for the shell's storage events in every window: pages that must open again after their notebook's
// folder was renamed or moved, and a folder that kept its name. After a crash, the next start points once, calmly,
// to Check notebook for the notebook that is open (A2-2).

import { isEnabled } from '../../app/flags';
import { getLocation } from '../../app/location';
import { defineCommand } from '../../commands/registry';
import type { CommandContext, CommandDef, CommandId } from '../../commands/types';
import type { NodeSummary } from '../../services/notes';
import type { MessageKey } from '../../strings/t';
import { commands } from '../../registries';
import { mountedPageHooks, shownMounted } from '../page';
import { commandContext } from '../../commands/registry';
import { shellHost } from '../../platform/shellqol';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { loadExternalNotice } from '../qol';
import { ancestors, currentNode, treeStore } from '../tree';
import { pointToCheck } from './crashPointer';
import { entryLockState } from './entryLock';

if (typeof window !== 'undefined') {
  shellHost().listen((event) => {
    if (event.kind === 'reopenPages' && Array.isArray(event.pages)) {
      const location = getLocation();
      if (location.view === 'workspace' && location.pageId && event.pages.includes(location.pageId)) {
        const page = location.pageId;
        void loadExternalNotice().then((loaded) => loaded.reloadPage(page));
      }
    } else if (event.kind === 'folderRenameFailed') {
      showToast({ message: t('storage.folders.renameFailed') });
    }
  });
}

/** How long after start the pointer waits, so it never competes with the first paint or the safe start offer. */
const POINTER_DELAY_MS = 4000;

if (typeof window !== 'undefined') {
  setTimeout(() => {
    try {
      const location = getLocation();
      const notebook = location.view === 'workspace' ? location.notebookId : null;
      void commandContext('menu')
        .platform.diagnostics.startup()
        .then((startup) => pointToCheck(startup.report.previous, notebook))
        .catch(() => {});
    } catch {
      // The commands aren't configured in this window, so there is nothing to point to.
    }
  }, POINTER_DELAY_MS);
}

// Lock entry (A2-17, ADR 0041): the palette's Lock entry and Unlock entry, and the stamp banner on each page view.
const loadEntryLock = () => import('./entryLock');
const pageShown = () => shownMounted.get() !== null;
commands.register(
  defineCommand({
    id: 'protect.lockEntry',
    title: 'storage.lock.lockEntry',
    keywords: 'storage.lock.lockKeywords',
    category: 'editing',
    flag: 'page.lockEntry',
    when: () => pageShown() && !entryLockState.get()?.lock,
    run: () => void loadEntryLock().then((module) => module.lockEntry()),
  }) as CommandDef,
);
commands.register(
  defineCommand({
    id: 'protect.unlockEntry',
    title: 'storage.lock.unlockEntry',
    keywords: 'storage.lock.unlockKeywords',
    category: 'editing',
    flag: 'page.lockEntry',
    when: () => pageShown() && Boolean(entryLockState.get()?.lock),
    run: () => void loadEntryLock().then((module) => module.unlockEntry()),
  }) as CommandDef,
);
mountedPageHooks.register({
  id: 'entryLock',
  attach(mounted) {
    if (!isEnabled('page.lockEntry')) return () => undefined;
    let stop: (() => void) | null = null;
    let detached = false;
    void loadEntryLock()
      .then((module) => {
        stop = detached ? null : module.attachEntryLock(mounted);
      })
      .catch(() => undefined);
    return () => {
      detached = true;
      stop?.();
    };
  },
});

// Password-protected sections (A1-39, A2-16, A4-47; ADR 0042): the commands, the section menu, and the watchers
// that lock them again. The dialogs and watchers load on first use.
const loadSections = () => import('./sections');

function sectionFor(ctx: CommandContext): NodeSummary | undefined {
  const node = currentNode(ctx);
  if (!node) return undefined;
  if (node.kind === 'section') return node;
  if (node.kind !== 'page') return undefined;
  return ancestors(treeStore.get(), node.id).find((above) => above.kind === 'section');
}

const anyUnlocked = () =>
  Object.values(treeStore.get().nodes).some((node) => node?.kind === 'section' && node.protected === 'unlocked');

type SectionAction = 'protectSection' | 'unlockSection' | 'lockSection' | 'unprotectSection' | 'changePassword';
const SECTION_COMMANDS: readonly [
  id: string,
  title: string,
  state: 'none' | 'locked' | 'unlocked',
  action: SectionAction,
][] = [
  ['protect.protectSection', 'storage.sections.protect', 'none', 'protectSection'],
  ['protect.unlockSection', 'storage.sections.unlock', 'locked', 'unlockSection'],
  ['protect.lockSection', 'storage.sections.lock', 'unlocked', 'lockSection'],
  ['protect.changePassword', 'storage.sections.changePassword', 'unlocked', 'changePassword'],
  ['protect.unprotectSection', 'storage.sections.unprotect', 'unlocked', 'unprotectSection'],
];

// The section menu lists them through features/tree/qolMenus.ts, so they sit after the tree's own items.
for (const [id, title, state, action] of SECTION_COMMANDS) {
  commands.register(
    defineCommand({
      id: id as CommandId,
      title: title as MessageKey,
      keywords: 'storage.sections.keywords',
      category: 'notebooks',
      flag: 'sections.protect',
      when: (ctx) => {
        const section = sectionFor(ctx);
        return Boolean(section && (section.protected ?? 'none') === state && (state !== 'none' || !section.readOnly));
      },
      async run(ctx) {
        const section = sectionFor(ctx);
        if (!section) return;
        const module = await loadSections();
        await module[action](section);
      },
    }) as CommandDef,
  );
}

for (const [id, title, on] of [
  ['protect.helloOn', 'storage.sections.helloOn', true],
  ['protect.helloOff', 'storage.sections.helloOff', false],
] as const) {
  commands.register(
    defineCommand({
      id: id as CommandId,
      title: title as MessageKey,
      keywords: 'storage.sections.keywords',
      category: 'notebooks',
      flag: 'sections.protect',
      when: (ctx) => sectionFor(ctx)?.protected === 'unlocked',
      async run(ctx) {
        const section = sectionFor(ctx);
        if (section) await (await loadSections()).setHello(section, on);
      },
    }) as CommandDef,
  );
}

commands.register(
  defineCommand({
    id: 'protect.lockAll' as CommandId,
    title: 'storage.sections.lockAll',
    keywords: 'storage.sections.keywords',
    category: 'notebooks',
    flag: 'sections.protect',
    when: anyUnlocked,
    run: () => void loadSections().then((module) => module.lockAll()),
  }) as CommandDef,
);

if (typeof window !== 'undefined') {
  setTimeout(() => {
    if (isEnabled('sections.protect')) void loadSections().then((module) => module.startSectionLocks());
  }, POINTER_DELAY_MS);
}
