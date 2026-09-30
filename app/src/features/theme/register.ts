// Registers the theme's command and its title bar toggle. WP3 adds the theme choices, the menu, the zoom
// commands, and the Appearance section here.

import { chord, defineCommand } from '../../commands/registry';
import type { CommandContext } from '../../commands/types';
import { commands, titleBarItems } from '../../registries';
import { osStore } from '../../state/os';
import { getSettings } from '../../state/settings';
import { resolveTheme, setThemePreference, toggledPreference } from '../../theme/theme';
import type { ThemeSource } from '../../theme/theme';
import { ThemeToggle } from './ThemeToggle';

const SOURCES: Partial<Record<CommandContext['source'], ThemeSource>> = {
  keyboard: 'shortcut',
  palette: 'palette',
  menu: 'menu',
};

commands.register(
  defineCommand({
    id: 'theme.toggle',
    title: 'theme.commands.toggle',
    category: 'appearance',
    keys: [chord('Ctrl+Shift+D')],
    allowInTextInput: true,
    allowInModal: true,
    run(ctx) {
      const shown = resolveTheme(getSettings().appearance.theme, osStore.get());
      setThemePreference(toggledPreference(shown), SOURCES[ctx.source] ?? 'toggle');
    },
  }),
);

titleBarItems.register({
  id: 'theme.toggle',
  side: 'end',
  order: 100,
  priority: 100,
  compact: 'appBar',
  Component: ThemeToggle,
});
