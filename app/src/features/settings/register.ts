// Registers the Settings page's commands and its General and About sections. Open settings (Ctrl+,) works in text
// fields, and pressing it again leaves. Appearance, Updates, and Shortcuts are registered by their own features.

import { navigate, getLocation } from '../../app/location';
import { chord, defineCommand } from '../../commands/registry';
import { commands, settingsSections } from '../../registries';
import { leaveSettings } from './focus';

const inSettings = () => getLocation().view === 'settings';

commands.register(
  defineCommand({
    id: 'app.settings',
    title: 'commands.app.settings',
    keywords: 'commands.keywords.settings',
    category: 'general',
    keys: [chord('Ctrl+,')],
    allowInTextInput: true,
    run() {
      if (inSettings()) return leaveSettings();
      navigate({ view: 'settings', section: 'general' });
    },
  }),
);

commands.register(
  defineCommand({
    id: 'settings.back',
    title: 'commands.app.settingsBack',
    keywords: 'commands.keywords.settingsBack',
    category: 'navigation',
    when: inSettings,
    run: leaveSettings,
  }),
);

settingsSections.register({
  id: 'general',
  title: 'settings.sections.general',
  icon: 'Gear',
  order: 10,
  load: () => import('./General'),
});

settingsSections.register({
  id: 'about',
  title: 'settings.sections.about',
  icon: 'Info',
  order: 50,
  load: () => import('./About'),
});
