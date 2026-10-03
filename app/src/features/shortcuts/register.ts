// Registers Show keyboard shortcuts (Ctrl+/) and the Shortcuts section of Settings. Ctrl+/ works in text fields,
// and in dialogs, where pressing it again closes the list.

import { lazy } from 'react';
import { chord, defineCommand } from '../../commands/registry';
import { commands, settingsSections } from '../../registries';
import { closeOverlay, openOverlay, showOverlay } from '../../shell/commandbar/overlays';

const LazyShortcuts = lazy(() => import('./ShortcutsDialog'));

commands.register(
  defineCommand({
    id: 'app.shortcuts',
    title: 'commands.app.shortcuts',
    keywords: 'commands.keywords.shortcuts',
    category: 'help',
    keys: [chord('Ctrl+/')],
    allowInTextInput: true,
    allowInModal: true,
    run() {
      if (openOverlay() === 'shortcuts') return closeOverlay();
      showOverlay('shortcuts', LazyShortcuts, {});
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
