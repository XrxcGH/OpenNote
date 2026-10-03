// Registers the shell and storage quality-of-life features: the commands, their context menu items and command bar
// items, the Settings sections, the setup step, the recently closed list in the palette, and the listeners that
// follow tabs, power, and the folder watcher. One file, so other lanes' registrations never touch it.

import { isEnabled } from '../../app/flags';
import { getLocation, navigate, onNavigate } from '../../app/location';
import { chord, defineCommand } from '../../commands/registry';
import type { CommandContext, CommandDef, CommandId } from '../../commands/types';
import { shellCall } from '../../platform/shellqol';
import { commandBar, commands, paletteProviders, setupSteps, settingsSections } from '../../registries';
import type { NodeSummary } from '../../services/notes';
import { qolStore } from '../../state/qol';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { commitHabits } from './setup/habits';
import {
  copyTo,
  currentNode,
  duplicateNode,
  locationFor,
  notebookOf,
  selectedNodes,
  setArchived,
  setPinned,
  setShowArchived,
  sortSiblings,
  treeStore,
} from '../tree';
import type { SortKey } from '../tree';
import { followExternal } from './externalStore';
import { followPower, setFocusMode, toggleDock, toggleFocusMode, toggleMiniWindow } from './modes';
import { readPrefs } from './prefs';
import { openQuickCapture } from './quickCaptureControls';
import { closeActiveTab, duplicateTab, openInNewTab, openInWindow, reopenClosed, stepTab, trackTabs } from './tabs';

const register = (...defs: readonly CommandDef[]) => defs.forEach((def) => commands.register(def));

/** The node a command acts on, as a single node. */
const one = (ctx: CommandContext): NodeSummary | undefined => currentNode(ctx);

const isPage = (ctx: CommandContext) => one(ctx)?.kind === 'page';
const isSortable = (ctx: CommandContext) => {
  const node = one(ctx);
  return node !== undefined && node.kind !== 'notebook';
};

// ---- Pin, duplicate, Copy to, sort, archive ----

register(
  defineCommand({
    id: 'tree.pin',
    title: 'qol.commands.pin',
    category: 'notebooks',
    flag: 'qol.pins',
    when: (ctx) => isPage(ctx) && !one(ctx)?.pinned,
    run: (ctx) => {
      const node = one(ctx);
      return node ? setPinned(node.id, true) : undefined;
    },
  }),
  defineCommand({
    id: 'tree.unpin',
    title: 'qol.commands.unpin',
    category: 'notebooks',
    flag: 'qol.pins',
    when: (ctx) => isPage(ctx) && one(ctx)?.pinned === true,
    run: (ctx) => {
      const node = one(ctx);
      return node ? setPinned(node.id, false) : undefined;
    },
  }),
  defineCommand({
    id: 'tree.duplicate',
    title: 'qol.commands.duplicate',
    category: 'notebooks',
    flag: 'qol.pins',
    enabled: (ctx) => ['page', 'section'].includes(one(ctx)?.kind ?? ''),
    run: (ctx) => {
      const node = one(ctx);
      return node ? duplicateNode(node.id) : undefined;
    },
  }),
  defineCommand({
    id: 'tree.copyTo',
    title: 'qol.commands.copyTo',
    category: 'notebooks',
    flag: 'qol.pins',
    enabled: (ctx) => ['page', 'section'].includes(one(ctx)?.kind ?? ''),
    run: async (ctx) => {
      const many = selectedNodes(ctx);
      const node = one(ctx);
      const nodes = many ?? (node ? [node] : []);
      if (nodes.length > 0) await copyTo(ctx.notes, nodes);
    },
  }),
);

const SORTS: readonly (readonly [
  SortKey,
  'qol.commands.sortTitle' | 'qol.commands.sortCreated' | 'qol.commands.sortModified',
])[] = [
  ['title', 'qol.commands.sortTitle'],
  ['created', 'qol.commands.sortCreated'],
  ['modified', 'qol.commands.sortModified'],
];
for (const [key, title] of SORTS) {
  register(
    defineCommand({
      id: `tree.sort.${key}` as CommandId,
      title,
      category: 'notebooks',
      flag: 'qol.pins',
      enabled: isSortable,
      run: (ctx) => {
        const node = one(ctx);
        return node ? sortSiblings(ctx.notes, node, key) : undefined;
      },
    }),
  );
}

register(
  defineCommand({
    id: 'tree.archive',
    title: 'qol.commands.archive',
    category: 'notebooks',
    flag: 'qol.archive',
    when: (ctx) => one(ctx) !== undefined && !one(ctx)?.archived,
    run: (ctx) => {
      const node = one(ctx);
      return node ? setArchived(node.id, true) : undefined;
    },
  }),
  defineCommand({
    id: 'tree.unarchive',
    title: 'qol.commands.unarchive',
    category: 'notebooks',
    flag: 'qol.archive',
    when: (ctx) => one(ctx)?.archived === true,
    run: (ctx) => {
      const node = one(ctx);
      return node ? setArchived(node.id, false) : undefined;
    },
  }),
  defineCommand({
    id: 'tree.showArchived',
    title: 'qol.commands.showArchived',
    category: 'view',
    flag: 'qol.archive',
    checked: () => qolStore.get().showArchived,
    run: () => setShowArchived(!qolStore.get().showArchived),
  }),
);

// ---- Tabs, windows, and recently closed ----

/** The workspace place a tree row stands for. */
function placeOf(ctx: CommandContext) {
  const node = one(ctx);
  return node && node.kind !== 'notebook' && node.kind !== 'sectionGroup' ? locationFor(node.id) : null;
}

register(
  defineCommand({
    id: 'tabs.openInNewTab',
    title: 'qol.commands.openInTab',
    category: 'navigation',
    flag: 'qol.tabs',
    keys: [chord('Ctrl+Enter')],
    scope: 'tree',
    enabled: (ctx) => placeOf(ctx) !== null,
    run: (ctx) => {
      const place = placeOf(ctx);
      if (place) openInNewTab(place);
    },
  }),
  defineCommand({
    id: 'tabs.duplicate',
    title: 'qol.commands.duplicateTab',
    category: 'navigation',
    flag: 'qol.tabs',
    run: () => duplicateTab(),
  }),
  defineCommand({
    id: 'tabs.close',
    title: 'qol.commands.closeTab',
    category: 'navigation',
    flag: 'qol.tabs',
    keys: [chord('Ctrl+W')],
    allowInTextInput: true,
    enabled: () => qolStore.get().tabs.length > 1,
    run: () => closeActiveTab(),
  }),
  defineCommand({
    id: 'tabs.next',
    title: 'qol.commands.nextTab',
    category: 'navigation',
    flag: 'qol.tabs',
    keys: [chord('Ctrl+Tab')],
    allowInTextInput: true,
    enabled: () => qolStore.get().tabs.length > 1,
    run: () => stepTab(1),
  }),
  defineCommand({
    id: 'tabs.previous',
    title: 'qol.commands.previousTab',
    category: 'navigation',
    flag: 'qol.tabs',
    keys: [chord('Ctrl+Shift+Tab')],
    allowInTextInput: true,
    enabled: () => qolStore.get().tabs.length > 1,
    run: () => stepTab(-1),
  }),
  defineCommand({
    id: 'tabs.reopenClosed',
    title: 'qol.commands.reopenClosed',
    category: 'navigation',
    flag: 'qol.recentlyClosed',
    keys: [chord('Ctrl+Shift+T')],
    allowInTextInput: true,
    enabled: () => qolStore.get().closedTabs.length > 0,
    run: async (ctx) => {
      await reopenClosed(ctx.notes);
    },
  }),
  defineCommand({
    id: 'tabs.openInWindow',
    title: 'qol.commands.openInWindow',
    category: 'navigation',
    flag: 'qol.tabs',
    enabled: (ctx) => placeOf(ctx)?.pageId != null,
    run: async (ctx) => {
      const place = placeOf(ctx);
      if (place) await openInWindow(place);
    },
  }),
);

paletteProviders.register({
  id: 'qol.recentlyClosed',
  filter: 'all',
  search: (query) => {
    if (!isEnabled('qol.recentlyClosed')) return [];
    const needle = query.trim().toLowerCase();
    return qolStore
      .get()
      .closedTabs.filter((closed) => needle === '' || closed.title.toLowerCase().includes(needle))
      .map((closed, index) => ({
        id: `closed:${closed.closedAt}:${index}`,
        group: 'closed',
        title: closed.title,
        detail: t('qol.tabs.reopenDetail'),
        // Below the matches for what is typed, above nothing when the box is empty.
        score: needle === '' ? 1 : 40 - index,
        run: async () => {
          const { currentNotesService } = await import('../../services/notes');
          const notes = currentNotesService();
          if (notes) await reopenClosed(notes, closed);
        },
      }));
  },
});

// ---- Window modes ----

register(
  defineCommand({
    id: 'view.focusMode',
    title: 'qol.commands.focusMode',
    category: 'view',
    flag: 'qol.focusMode',
    keys: [chord('F11')],
    allowInTextInput: true,
    checked: () => qolStore.get().focusMode,
    run: () => toggleFocusMode(),
  }),
  defineCommand({
    id: 'window.toggleMini',
    title: 'qol.commands.miniWindow',
    category: 'view',
    flag: 'qol.miniWindow',
    checked: () => qolStore.get().miniWindow,
    run: () => toggleMiniWindow(),
  }),
  defineCommand({
    id: 'window.dockLeft',
    title: 'qol.commands.dockLeft',
    category: 'view',
    flag: 'qol.dock',
    checked: () => qolStore.get().docked === 'left',
    run: () => toggleDock('left'),
  }),
  defineCommand({
    id: 'window.dockRight',
    title: 'qol.commands.dockRight',
    category: 'view',
    flag: 'qol.dock',
    checked: () => qolStore.get().docked === 'right',
    run: () => toggleDock('right'),
  }),
  defineCommand({
    id: 'app.quickNote',
    title: 'qol.commands.quickNote',
    category: 'general',
    flag: 'qol.quickCapture',
    run: async () => {
      await openQuickCapture();
    },
  }),
  defineCommand({
    id: 'app.home',
    title: 'qol.commands.home',
    category: 'navigation',
    flag: 'qol.home',
    run: () => {
      qolStore.set((state) => ({ ...state, homeOpen: true }));
      if (getLocation().view !== 'workspace') {
        navigate(
          { view: 'workspace', notebookId: null, sectionId: null, pageId: null },
          { replace: true, focus: 'keep' },
        );
      }
      announce(t('qol.home.opened'));
    },
  }),
);

// ---- Storage, backups, checks, shortcuts, accessibility ----

register(
  defineCommand({
    id: 'notes.openFolder',
    title: 'qol.commands.openFolder',
    category: 'notebooks',
    flag: 'qol.openFolder',
    run: async () => (await import('./StorageSection')).openNotebookFolder(),
  }),
  defineCommand({
    id: 'notes.checkNotebook',
    title: 'qol.commands.checkNotebook',
    category: 'notebooks',
    flag: 'qol.checkNotebook',
    enabled: (ctx) => one(ctx) !== undefined,
    run: async (ctx) => {
      const node = one(ctx);
      const id = node ? (notebookOf(treeStore.get(), node.id) ?? (node.kind === 'notebook' ? node.id : null)) : null;
      const book = id ? await ctx.notes.get(id) : null;
      if (book) await (await import('./CheckNotebook')).openNotebookCheck(book);
    },
  }),
  defineCommand({
    id: 'notes.backupNow',
    title: 'qol.commands.backupNow',
    category: 'general',
    flag: 'qol.scheduledBackups',
    run: async () => {
      try {
        await shellCall('backup.run');
        showToast({ message: t('qol.backup.done') });
      } catch {
        showToast({ message: t('qol.backup.failed'), tone: 'danger' });
      }
    },
  }),
  defineCommand({
    id: 'notes.createShortcut',
    title: 'qol.commands.createShortcut',
    category: 'notebooks',
    flag: 'qol.shortcuts',
    enabled: (ctx) => one(ctx) !== undefined,
    run: async (ctx) => {
      const node = one(ctx);
      if (node) await (await import('./shortcuts')).createShortcutFor(ctx.notes, node);
    },
  }),
  defineCommand({
    id: 'page.checkAccessibility',
    title: 'qol.commands.checkAccessibility',
    category: 'general',
    flag: 'qol.a11yCheck',
    enabled: (ctx) => ['page', 'section'].includes(one(ctx)?.kind ?? ''),
    run: async (ctx) => {
      const node = one(ctx);
      if (node) await (await import('../a11yCheck')).openAccessibilityCheck(ctx.notes, node);
    },
  }),
);

// ---- The command bar ----

const BAR: readonly (readonly [string, 'home' | 'view', string, string, number, ('toggle' | 'button' | 'menu')?])[] = [
  ['qol.home', 'home', 'go', 'app.home', 60],
  ['qol.quickNote', 'home', 'go', 'app.quickNote', 55],
  ['qol.focus', 'view', 'window', 'view.focusMode', 70, 'toggle'],
  ['qol.mini', 'view', 'window', 'window.toggleMini', 65, 'toggle'],
  ['qol.dockRight', 'view', 'window', 'window.dockRight', 60, 'toggle'],
  ['qol.showArchived', 'view', 'tree', 'tree.showArchived', 50, 'toggle'],
  ['qol.sort', 'view', 'tree', 'tree.sort.title', 45, 'menu'],
  ['qol.a11y', 'view', 'check', 'page.checkAccessibility', 40],
];
for (const [id, tab, group, command, priority, presentation] of BAR) {
  commandBar.register({
    id,
    tab,
    group,
    command: command as CommandId,
    priority,
    presentation,
    ...(presentation === 'menu' && { menu: 'tree.sort' as const }),
  });
}

// ---- Settings and setup ----

settingsSections.register({
  id: 'storage',
  title: 'qol.settings.storage',
  icon: 'HardDrives',
  order: 30,
  load: () => import('./StorageSection'),
});
settingsSections.register({
  id: 'windows',
  title: 'qol.settings.windows',
  icon: 'AppWindow',
  order: 35,
  load: () => import('./WindowsSection'),
});

setupSteps.register({
  id: 'habits',
  title: 'qol.setup.title',
  order: 25,
  scope: 'person',
  isEnabled: () => isEnabled('qol.onenoteKeys'),
  load: () => import('./setup/HabitsStep'),
  commit: commitHabits,
});

// ---- Listeners ----

/** A page window or the quick capture window shows one thing only, so it skips what the main window does. */
const isMainWindow = () => (window as { __OPENNOTE_WINDOW__?: unknown }).__OPENNOTE_WINDOW__ === undefined;

if (typeof window !== 'undefined' && isMainWindow()) {
  trackTabs();
  // Any move to a page or section leaves the Home page.
  onNavigate(({ to }) => {
    if (to.view === 'workspace' && (to.pageId || to.sectionId) && qolStore.get().homeOpen) {
      qolStore.set((state) => ({ ...state, homeOpen: false }));
    }
  });
  followExternal();
  followPower();
  void shellCall('external.start').catch(() => undefined);
  void readPrefs().then((prefs) => {
    if (prefs.startOnHome === true && isEnabled('qol.home')) qolStore.set((state) => ({ ...state, homeOpen: true }));
  });
  // Escape leaves focus mode when nothing else uses it.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && qolStore.get().focusMode && !event.defaultPrevented) setFocusMode(false);
  });
  // Picking the page that is already open (or its section) also leaves the Home page.
  document.addEventListener('click', (event) => {
    const row = (event.target as Element | null)?.closest(
      '[role="treeitem"][data-kind="page"], [role="treeitem"][data-kind="section"]',
    );
    if (row && qolStore.get().homeOpen) qolStore.set((state) => ({ ...state, homeOpen: false }));
  });
  void import('./shortcuts').then((loaded) => loaded.followJumpList());
}
