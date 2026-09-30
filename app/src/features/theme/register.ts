// Registers the theme and text size commands, the theme menu's items, the title bar toggle, and the Appearance
// section of Settings (ARCHITECTURE.md sections 9.3, 14.8, and 16.1).

import { chord, defineCommand } from '../../commands/registry';
import type { CommandContext, CommandDef } from '../../commands/types';
import type { ThemePreference } from '../../platform/types';
import { commands, contextMenus, settingsSections, titleBarItems } from '../../registries';
import { osStore } from '../../state/os';
import { getSettings } from '../../state/settings';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { currentTheme, setThemePreference, toggledPreference } from '../../theme/theme';
import type { ThemeSource } from '../../theme/theme';
import { ThemeToggle } from './ThemeToggle';
import { resetTextSize, stepTextSize } from './zoom';

const SOURCES: Partial<Record<CommandContext['source'], ThemeSource>> = {
  keyboard: 'shortcut',
  palette: 'palette',
  menu: 'menu',
};
const sourceOf = (ctx: CommandContext): ThemeSource => SOURCES[ctx.source] ?? 'toggle';

commands.register(
  defineCommand({
    id: 'theme.toggle',
    title: 'theme.commands.toggle',
    keywords: 'theme.keywords.theme',
    category: 'appearance',
    keys: [chord('Ctrl+Shift+D')],
    allowInTextInput: true,
    allowInModal: true,
    run(ctx) {
      // Under a contrast theme Windows sets the colors, so the switch says so instead of changing nothing silently.
      if (osStore.get().contrast) return ctx.announce(t('theme.contrastNote'));
      setThemePreference(toggledPreference(currentTheme()), sourceOf(ctx));
    },
  }),
);

const CHOICES: readonly { preference: ThemePreference; title: MessageKey }[] = [
  { preference: 'light', title: 'theme.commands.light' },
  { preference: 'dark', title: 'theme.commands.dark' },
  { preference: 'system', title: 'theme.commands.system' },
];

for (const [order, { preference, title }] of CHOICES.entries()) {
  const def: CommandDef = defineCommand({
    id: `theme.${preference}`,
    title,
    keywords: 'theme.keywords.theme',
    category: 'appearance',
    checked: () => getSettings().appearance.theme === preference,
    run: (ctx) => setThemePreference(preference, sourceOf(ctx)),
  });
  commands.register(def);
  contextMenus.register({ id: def.id, menu: 'theme.choices', command: def.id, group: 'choices', order });
}

commands.register(
  defineCommand({
    id: 'theme.openAppearance',
    title: 'theme.commands.openAppearance',
    keywords: 'theme.keywords.theme',
    category: 'appearance',
    run: (ctx) => ctx.navigate({ view: 'settings', section: 'appearance' }),
  }),
);
contextMenus.register({
  id: 'theme.openAppearance',
  menu: 'theme.choices',
  command: 'theme.openAppearance',
  group: 'settings',
  order: 0,
});

const ZOOM: readonly { id: `view.${string}`; title: MessageKey; key: string; run(): void }[] = [
  { id: 'view.zoomIn', title: 'theme.commands.zoomIn', key: 'Ctrl+=', run: () => stepTextSize(1) },
  { id: 'view.zoomOut', title: 'theme.commands.zoomOut', key: 'Ctrl+-', run: () => stepTextSize(-1) },
  { id: 'view.zoomReset', title: 'theme.commands.zoomReset', key: 'Ctrl+0', run: resetTextSize },
];

for (const { id, title, key, run } of ZOOM) {
  commands.register(
    defineCommand({
      id,
      title,
      keywords: 'theme.keywords.zoom',
      category: 'view',
      keys: [chord(key)],
      allowInTextInput: true,
      allowInModal: true,
      run,
    }),
  );
}

settingsSections.register({
  id: 'appearance',
  title: 'theme.appearance.title',
  icon: 'Palette',
  order: 20,
  load: () => import('./AppearanceSection'),
});

titleBarItems.register({
  id: 'theme.toggle',
  side: 'end',
  order: 100,
  priority: 100,
  compact: 'appBar',
  Component: ThemeToggle,
});
