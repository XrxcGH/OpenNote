// The page's EditorHost (PLAN.md section 3.8; owner after WP0: WP3): how an editor reads settings and flags,
// announces, opens menus, and selects blocks, without importing stores itself.
import { isEnabled } from '../../app/flags';
import type { EditorHost, EditingSettingsView, PageSettingsView } from '../../editor/host';
import type { PageViewJson } from '../../services/pages/types';
import { getSettings } from '../../state/settings';
import { osStore } from '../../state/os';
import { announce, openMenu } from '../../ui';
import { selectOnPage } from './seams/selectionStore';
import { pageSpelling } from './spelling/current';

function editingView(): EditingSettingsView {
  const editing = getSettings().editing;
  return {
    markdownShortcuts: editing.markdownShortcuts,
    slashMenu: editing.slashMenu,
    formattingBar: editing.formattingBar,
    autocorrect: { enabled: editing.autocorrect.enabled, entries: editing.autocorrect.entries },
    spelling: { enabled: editing.spelling.enabled, languages: editing.spelling.languages },
  };
}

/** Points between default tab stops when the page sets none (format spec 5.4.2). */
const DEFAULT_TAB = 36;

/**
 * The page's settings from its `view`. A `view.text` key whose value is invalid reads as missing, as the file
 * format says (R-VIEW-4).
 */
export function pageSettingsOf(view: PageViewJson | undefined): PageSettingsView {
  const text = view?.text;
  const keys = text !== null && typeof text === 'object' ? (text as Record<string, unknown>) : {};
  const tab = keys.defaultTab;
  return {
    text: {
      hyphenate: typeof keys.hyphenate === 'boolean' ? keys.hyphenate : false,
      defaultTab: typeof tab === 'number' && Number.isFinite(tab) && tab > 0 ? tab : DEFAULT_TAB,
    },
  };
}

export function createEditorHost(overrides: Partial<EditorHost> = {}): EditorHost {
  return {
    settings: editingView,
    flag: isEnabled,
    announce,
    openMenu: ({ label, items, anchor }) => openMenu({ label, items, anchor }),
    screenReader: () => osStore.get().screenReader,
    spelling: pageSpelling,
    selectBlocks: (blocks) => selectOnPage({ blocks, strokes: [] }, { announce: true }),
    graph: () => (isEnabled('math.grapher') ? import('../math').then((loaded) => loaded.graphRenderer) : null),
    math: () => (isEnabled('math.latex') ? import('../math').then((loaded) => loaded.mathRenderer) : null),
    ...overrides,
  };
}
