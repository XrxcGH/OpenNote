// The page's EditorHost (PLAN.md section 3.8; owner after WP0: WP3): how an editor reads settings and flags,
// announces, opens menus, and selects blocks, without importing stores itself.
import { isEnabled } from '../../app/flags';
import type { EditorHost, EditingSettingsView } from '../../editor/host';
import { getSettings } from '../../state/settings';
import { osStore } from '../../state/os';
import { announce, openMenu } from '../../ui';
import { selectOnPage } from './seams/selectionStore';

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

export function createEditorHost(overrides: Partial<EditorHost> = {}): EditorHost {
  return {
    settings: editingView,
    flag: isEnabled,
    announce,
    openMenu: ({ label, items, anchor }) => openMenu({ label, items, anchor }),
    screenReader: () => osStore.get().screenReader,
    spelling: () => null,
    selectBlocks: (blocks) => selectOnPage({ blocks, strokes: [] }, { announce: true }),
    ...overrides,
  };
}
