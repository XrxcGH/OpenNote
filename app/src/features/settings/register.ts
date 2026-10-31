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

/** Focuses the first of these elements once the section has drawn it, for up to two seconds. */
function focusWhenShown(ids: readonly string[], deadline = Date.now() + 2_000): void {
  const element = ids.map((id) => document.getElementById(id)).find((found) => found !== null);
  if (element) element.focus();
  else if (Date.now() < deadline) requestAnimationFrame(() => focusWhenShown(ids, deadline));
}

// Settings, then About, at the list of what needs Windows (ADR 0055). On Windows, where the list is empty, it
// stops at the version details.
commands.register(
  defineCommand({
    id: 'app.systemSupport',
    title: 'commands.app.systemSupport',
    keywords: 'commands.keywords.systemSupport',
    category: 'general',
    run() {
      navigate({ view: 'settings', section: 'about' });
      focusWhenShown(['settings-about-limits', 'settings-about']);
    },
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
