// Moving around the shell. F6 goes between regions (ARCHITECTURE.md section 11.6). Alt+Left and Alt+Right go back
// and forward through history (section 5.3); the compact layout first goes up one level. "Reveal in tree" selects
// the open page in the tree (FEATURES.md, Phase 2, "Back and forward").

import { canGoBack, canGoForward, getLocation, goBack, goForward } from '../../app/location';
import { chord, defineCommand } from '../../commands/registry';
import type { CommandDef } from '../../commands/types';
import { compactParent, isPaneShowing, setCompactScreen, setPaneShowing } from '../../shell/layout/paneActions';
import type { PaneId } from '../../shell/layout/solvePanes';
import { cycleRegion, focusRegionSoon } from '../../shell/regions';
import type { NodeId, NotesService } from '../../services/notes/types';
import { layoutStore } from '../../state/layout';
import { sessionStore, setExpanded } from '../../state/session';

/** Goes up one compact level if there is one, else back through history. */
export function historyBack(): boolean {
  const parent = compactParent();
  if (parent) {
    void setCompactScreen(parent);
    return true;
  }
  return goBack();
}

export function historyForward(): boolean {
  return goForward();
}

/** The notebook and section groups above a section, from the top down. */
async function containersAbove(notes: NotesService, id: NodeId | null): Promise<NodeId[]> {
  const path: NodeId[] = [];
  let current = id ? await notes.get(id) : null;
  while (current?.parentId) {
    path.unshift(current.parentId);
    current = await notes.get(current.parentId);
  }
  return path;
}

/** Shows the pane that holds the row, in the way the size class allows, without moving focus yet. */
async function showPane(pane: PaneId): Promise<void> {
  if (layoutStore.get().sizeClass === 'compact') return setCompactScreen(pane);
  if (pane === 'pages' && layoutStore.get().sizeClass === 'wide' && !isPaneShowing('notebooks')) {
    await setPaneShowing('notebooks', true, false);
  }
  await setPaneShowing(pane, true, false);
}

export async function revealInTree(notes: NotesService): Promise<void> {
  const location = getLocation();
  if (location.view !== 'workspace' || !location.sectionId) return;
  const pane: PaneId = location.pageId ? 'pages' : 'notebooks';
  const path = await containersAbove(notes, location.sectionId);
  setExpanded([...new Set([...sessionStore.get().expanded, ...path])]);
  await showPane(pane);
  requestAnimationFrame(() => focusRegionSoon(pane, 'main'));
}

export const NAV_COMMANDS: readonly CommandDef[] = [
  defineCommand({
    id: 'view.nextRegion',
    title: 'layout.commands.nextRegion',
    category: 'navigation',
    keys: [chord('F6')],
    customizable: false,
    allowInTextInput: true,
    palette: false,
    run: () => void cycleRegion(1),
  }),
  defineCommand({
    id: 'view.previousRegion',
    title: 'layout.commands.previousRegion',
    category: 'navigation',
    keys: [chord('Shift+F6')],
    customizable: false,
    allowInTextInput: true,
    palette: false,
    run: () => void cycleRegion(-1),
  }),
  defineCommand({
    id: 'nav.back',
    title: 'layout.commands.back',
    category: 'navigation',
    keywords: 'layout.keywords.history',
    keys: [chord('Alt+Left')],
    enabled: () => compactParent() !== null || canGoBack(),
    run: () => void historyBack(),
  }),
  defineCommand({
    id: 'nav.forward',
    title: 'layout.commands.forward',
    category: 'navigation',
    keywords: 'layout.keywords.history',
    keys: [chord('Alt+Right')],
    enabled: () => canGoForward(),
    run: () => void historyForward(),
  }),
  defineCommand({
    id: 'nav.revealInTree',
    title: 'layout.commands.revealInTree',
    category: 'navigation',
    enabled: () => {
      const location = getLocation();
      return location.view === 'workspace' && location.sectionId !== null;
    },
    run: (ctx) => revealInTree(ctx.notes),
  }),
];
