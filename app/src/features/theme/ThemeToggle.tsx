// The title bar's theme toggle (BRAND.md section 11) is a switch named "Dark mode" that shows the current theme.
// When it's on, the moon uses the Fill weight. Its shortcut shows in the tooltip and in aria-keyshortcuts.
// WP3 adds the description, the theme menu, long press, and the contrast-theme behavior.

// One module per icon: the package index loads every icon, which slows the dev server and tests.
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon';
import { SunIcon } from '@phosphor-icons/react/dist/csr/Sun';
import { ariaKeyShortcuts, formatChord, useKeysFor } from '../../commands/keymap';
import { t } from '../../strings/t';
import { setThemePreference, toggledPreference, useResolvedTheme } from '../../theme/theme';
import { Switch, Tooltip } from '../../ui';

export function ThemeToggle() {
  const shown = useResolvedTheme();
  const keys = useKeysFor('theme.toggle');
  const label = t('theme.darkMode');
  const dark = shown === 'dark';
  return (
    <Tooltip label={label} shortcut={keys[0] ? formatChord(keys[0]) : null}>
      <Switch
        label={label}
        checked={dark}
        keyShortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
        onChange={() => setThemePreference(toggledPreference(shown), 'toggle')}
      >
        {dark ? <MoonIcon weight="fill" aria-hidden="true" /> : <SunIcon aria-hidden="true" />}
      </Switch>
    </Tooltip>
  );
}
