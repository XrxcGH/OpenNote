// The title bar's theme toggle (ARCHITECTURE.md section 9.3, docs/BRAND.md section 11): a switch named "Dark mode",
// on when the shown theme is dark. A click, Enter, Space, or Ctrl+Shift+D switches between Light and Dark.
// Right-click, a long press, Shift+F10, or the Menu key opens the theme menu, and the click that can follow a long
// press is swallowed. A hidden description says whether the theme follows Windows. Under a Windows contrast theme
// the switch is aria-disabled but stays focusable, and explains why.

// One module per icon: the package index loads every icon, which slows the dev server and tests.
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon';
import { SunIcon } from '@phosphor-icons/react/dist/csr/Sun';
import { useId, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, RefObject } from 'react';
import { ariaKeyShortcuts, formatChord, useKeysFor } from '../../commands/keymap';
import type { Chord } from '../../commands/types';
import { useOs } from '../../state/os';
import { useSettings } from '../../state/settings';
import { t } from '../../strings/t';
import { setThemePreference, toggledPreference, useResolvedTheme } from '../../theme/theme';
import { Switch, Tooltip, useLongPress } from '../../ui';
import type { MenuAnchor } from '../../ui';
import { openThemeMenu } from './ThemeMenu';
import styles from './ThemeToggle.module.css';

function description(following: boolean, contrast: boolean): string {
  if (contrast) return t('theme.contrastNote');
  return t(following ? 'theme.toggle.following' : 'theme.toggle.choices');
}

/** The tooltip's shortcut. Under a contrast theme the tooltip explains why the switch does nothing instead. */
function shortcut(keys: readonly Chord[], contrast: boolean): string | null {
  return contrast || keys.length === 0 ? null : formatChord(keys[0]);
}

/** Shift+F10 and the Menu key, for engines that don't turn them into a contextmenu event. */
const isMenuKey = (event: KeyboardEvent) => (event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu';

/** A menu renders and joins the layer stack within about 100 ms of the request. */
const OPENING_MS = 100;

/**
 * Every way into the menu: a long press, right-click, Shift+F10, and the Menu key (for engines that send no
 * contextmenu event for the keys). A long press with touch or a pen can also send a contextmenu event, so a
 * request right after another opens nothing more.
 */
function useMenuTriggers(wrapper: RefObject<HTMLElement | null>) {
  const lastOpen = useRef(Number.NEGATIVE_INFINITY);
  const open = (anchor: MenuAnchor) => {
    const now = performance.now();
    if (now - lastOpen.current < OPENING_MS) return;
    lastOpen.current = now;
    openThemeMenu(anchor, wrapper.current?.querySelector<HTMLElement>('[role="switch"]') ?? null);
  };
  return {
    onLongPress: open,
    handlers: {
      onContextMenu(event: MouseEvent<HTMLElement>) {
        event.preventDefault();
        // Shift+F10 and the Menu key report no pointer position; the menu then opens below the switch.
        const fromKeyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0;
        open(fromKeyboard ? event.currentTarget : { x: event.clientX, y: event.clientY });
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (!isMenuKey(event)) return;
        event.preventDefault();
        open(event.currentTarget);
      },
    },
  };
}

export function ThemeToggle() {
  const shown = useResolvedTheme();
  const following = useSettings((settings) => settings.appearance.theme === 'system');
  const contrast = useOs((os) => os.contrast);
  const keys = useKeysFor('theme.toggle');
  const descriptionId = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const menu = useMenuTriggers(wrapper);
  const longPress = useLongPress(menu.onLongPress);
  const label = t('theme.darkMode');
  const dark = shown === 'dark';

  return (
    <span ref={wrapper} className={styles.toggle} data-theme-toggle="" {...longPress} {...menu.handlers}>
      <Tooltip label={contrast ? t('theme.contrastNote') : label} shortcut={shortcut(keys, contrast)}>
        <Switch
          label={label}
          checked={dark}
          describedBy={descriptionId}
          disabled={contrast ? 'aria' : undefined}
          keyShortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
          onChange={() => setThemePreference(toggledPreference(shown), 'toggle')}
        >
          {dark ? (
            <MoonIcon className={styles.moon} weight="fill" aria-hidden="true" />
          ) : (
            <SunIcon className={styles.sun} aria-hidden="true" />
          )}
        </Switch>
      </Tooltip>
      <span id={descriptionId} className={styles.hidden}>
        {description(following, contrast)}
      </span>
    </span>
  );
}
