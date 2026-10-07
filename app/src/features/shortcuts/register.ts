// Registers Show keyboard shortcuts (Ctrl+/) and the Shortcuts section of Settings. Ctrl+/ works in text fields,
// and in dialogs, where pressing it again closes the list.

import { lazy } from 'react';
import { chord, defineCommand } from '../../commands/registry';
import { commands, settingsSections, shortcutListSections } from '../../registries';
import { GesturesTable } from './Gestures';
import { selectPageTitle } from './title';
import { closeOverlay, openOverlay, showOverlay } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';

const LazyShortcuts = lazy(() => import('./ShortcutsDialog'));

commands.register(
  defineCommand({
    id: 'app.shortcuts',
    title: 'commands.app.shortcuts',
    keywords: 'commands.keywords.shortcuts',
    category: 'help',
    keys: [chord('Ctrl+/')],
    // In the OneNote set Ctrl+/ makes a numbered list in a text box, so the list moves to F1, as OneNote's help.
    presetKeys: { onenote: [chord('F1')] },
    allowInTextInput: true,
    allowInModal: true,
    run() {
      if (openOverlay() === 'shortcuts') return closeOverlay();
      showOverlay('shortcuts', LazyShortcuts, {});
    },
  }),
);

// Select the page title: Ctrl+Shift+T in the OneNote set, where it takes the key from Reopen closed tab.
commands.register(
  defineCommand({
    id: 'page.selectTitle',
    title: 'shortcuts.selectTitle.title',
    keywords: 'shortcuts.selectTitle.keywords',
    category: 'navigation',
    presetKeys: { onenote: [chord('Ctrl+Shift+T')] },
    allowInTextInput: true,
    run(ctx) {
      if (!selectPageTitle()) ctx.announce(t('shortcuts.selectTitle.none'));
    },
  }),
);

settingsSections.register({
  id: 'shortcuts',
  title: 'settings.sections.shortcuts',
  icon: 'Keyboard',
  order: 40,
  load: () => import('./ShortcutsSection'),
});

// The pen and touch gestures, with whether each is on, after the keys that always work.
shortcutListSections.register({
  id: 'gestures',
  title: 'shortcuts.gestures.title',
  order: 10,
  flag: 'ink.gestures',
  Component: GesturesTable,
});
