// The theme controller (ARCHITECTURE.md section 9). Every way of switching calls setThemePreference, which
// updates the settings store and sends the patch to Rust. The controller follows the store and the Windows
// appearance. It hands each resolved theme to the flash-safe applier, which crossfades the window and keeps the
// window frame in step. data-theme is always the resolved theme. The Windows setting comes from Rust, never
// from prefers-color-scheme.
//
// A shell that doesn't inject a boot payload yet also keeps the choice in localStorage, as Phase 0 did. That
// way it survives a restart until settings.json takes over.

import type { OsAppearance, Platform, ThemePreference } from '../platform/types';
import { osStore, useOs } from '../state/os';
import { getSettings, settingsStore, updateSettings, useSettings } from '../state/settings';
import { t } from '../strings/t';
import { announce } from '../ui/announce';
import { createThemeApplier } from './applier';
import type { Theme, ThemeApplier, ThemeParticipant } from './applier';
import { applyAppearance } from './appearance';

export type { ThemePreference } from '../platform/types';
export type { Theme, ThemeParticipant } from './applier';
export type ThemeSource = 'toggle' | 'menu' | 'shortcut' | 'palette' | 'settings' | 'setup';

const STORAGE_KEY = 'opennote.theme';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
/** The element that marks the title bar toggle, so changes made there aren't announced twice. */
export const TOGGLE_ATTRIBUTE = 'data-theme-toggle';

let keepInStorage = false;
let applier: ThemeApplier | null = null;
/** Every participant, with the function that removes it from the running applier. */
const participants = new Map<ThemeParticipant, () => void>();

/** The theme actually shown, given the person's preference and the Windows setting. */
export function resolveTheme(preference: ThemePreference, os: Pick<OsAppearance, 'dark'>): Theme {
  if (preference === 'system') return os.dark ? 'dark' : 'light';
  return preference;
}

export function useResolvedTheme(): Theme {
  const preference = useSettings((settings) => settings.appearance.theme);
  const dark = useOs((os) => os.dark);
  return resolveTheme(preference, { dark });
}

/** The theme shown now, outside React. */
export function currentTheme(): Theme {
  return resolveTheme(getSettings().appearance.theme, osStore.get());
}

/** The quick toggle switches between light and dark; from Match Windows it switches to the opposite. */
export function toggledPreference(current: Theme): ThemePreference {
  return current === 'dark' ? 'light' : 'dark';
}

export function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value);
}

export function loadPreference(storage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return isPreference(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function savePreference(storage: Pick<Storage, 'setItem'> | undefined, preference: ThemePreference): void {
  try {
    storage?.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
}

const storage = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

const ANNOUNCEMENTS = {
  changed: { dark: 'theme.announce.dark', light: 'theme.announce.light' },
  following: { dark: 'theme.announce.followingDark', light: 'theme.announce.followingLight' },
  leftWindows: { dark: 'theme.announce.leftWindowsDark', light: 'theme.announce.leftWindowsLight' },
} as const;

/** What a screen reader hears after a change (ARCHITECTURE.md section 9.3), or null when aria-checked says it. */
export function themeAnnouncement(
  before: ThemePreference,
  choice: ThemePreference,
  source: ThemeSource,
  os: Pick<OsAppearance, 'dark' | 'contrast'>,
): string | null {
  if (source === 'settings' || source === 'setup') return null;
  if (os.contrast) return t('theme.contrastNote');
  const theme = resolveTheme(choice, os);
  if (before === 'system' && choice !== 'system' && (source === 'toggle' || source === 'shortcut')) {
    return t(ANNOUNCEMENTS.leftWindows[theme]);
  }
  const onToggle = document.activeElement?.closest(`[${TOGGLE_ATTRIBUTE}]`) != null;
  if (source === 'toggle' || onToggle) return null;
  return t(ANNOUNCEMENTS[choice === 'system' ? 'following' : 'changed'][theme]);
}

/**
 * Every theme change goes through here. The store changes at once and the patch goes to Rust; the controller
 * applies the theme through the flash-safe applier. Under a contrast theme the choice is saved, and applies when
 * the contrast theme is off.
 */
export function setThemePreference(choice: ThemePreference, source: ThemeSource): void {
  const before = getSettings().appearance.theme;
  const message = themeAnnouncement(before, choice, source, osStore.get());
  if (before !== choice) void updateSettings({ appearance: { theme: choice } }).catch(() => {});
  if (keepInStorage) savePreference(storage(), choice);
  if (message) announce(message);
}

/**
 * Redraws something in the new theme inside the crossfade, before its new picture (Phase 5's ink). The applier
 * waits at most 120 ms for it. Returns a function that removes it.
 */
export function addThemeParticipant(participant: ThemeParticipant): () => void {
  participants.set(participant, applier?.addParticipant(participant) ?? (() => {}));
  return () => {
    participants.get(participant)?.();
    participants.delete(participant);
  };
}

const forcedColors = () => globalThis.matchMedia?.('(forced-colors: active)').matches ?? false;

/** Restores the choice saved by Phase 0. With nothing saved, the boot payload's choice stays. */
function restoreSavedPreference(): void {
  let saved: unknown = null;
  try {
    saved = storage()?.getItem(STORAGE_KEY);
  } catch {
    // Unavailable storage means nothing was saved.
  }
  if (!isPreference(saved)) return;
  settingsStore.set((state) => ({
    ...state,
    settings: { ...state.settings, appearance: { ...state.settings.appearance, theme: saved } },
  }));
}

/**
 * Applies the theme and the appearance attributes now and after every change, and sends the shown theme to the
 * window frame. With `keepInStorage` (no boot payload from Rust), the saved Phase 0 choice is restored first and
 * kept in step. Returns a function that stops following changes.
 */
export function initTheme(platform: Platform, options: { keepInStorage: boolean }): () => void {
  keepInStorage = options.keepInStorage;
  if (keepInStorage) restoreSavedPreference();
  const root = document.documentElement;
  const current = createThemeApplier({
    write(theme) {
      root.setAttribute('data-theme', theme);
      platform.window.setFrameTheme(theme);
    },
    crossfade: () => !osStore.get().contrast && !forcedColors(),
  });
  applier = current;
  for (const participant of participants.keys()) participants.set(participant, current.addParticipant(participant));
  const sync = () => {
    applyAppearance(root, getSettings(), osStore.get());
    current.request(currentTheme());
  };
  applyAppearance(root, getSettings(), osStore.get());
  current.init(currentTheme());
  const stops = [settingsStore.subscribe(sync), osStore.subscribe(sync)];
  return () => {
    stops.forEach((stop) => stop());
    current.dispose();
    if (applier === current) applier = null;
  };
}
