// The theme controller (ARCHITECTURE.md section 9). Every way of switching calls setThemePreference, which
// updates the settings store, crossfades the window, and keeps the window frame in step.
//
// WP0 keeps Phase 0's behavior: "Match Windows" leaves data-theme unset, so the CSS media query decides, and
// without a boot payload from Rust the choice is also kept in localStorage. WP3 replaces both with settings.json
// and the flash-safe applier, without changing resolveTheme, useResolvedTheme, or setThemePreference.

import { flushSync } from 'react-dom';
import type { OsAppearance, Platform, ThemePreference } from '../platform/types';
import { osStore, useOs } from '../state/os';
import { getSettings, settingsStore, updateSettings, useSettings } from '../state/settings';

export type { ThemePreference } from '../platform/types';
export type Theme = 'light' | 'dark';
export type ThemeSource = 'toggle' | 'menu' | 'shortcut' | 'palette' | 'settings' | 'setup';

const STORAGE_KEY = 'opennote.theme';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

let keepInStorage = false;

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

/** Applies the preference to the document. "system" leaves the choice to the CSS media query. */
export function applyPreference(root: HTMLElement, preference: ThemePreference): void {
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

const storage = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

/** Every theme change goes through here. The source is for announcements, which WP3 adds. */
export function setThemePreference(choice: ThemePreference, source: ThemeSource): void {
  void source;
  // flushSync, so the new theme is in place when the view transition captures the new state.
  const update = () => flushSync(() => void updateSettings({ appearance: { theme: choice } }).catch(() => {}));
  // Crossfades every surface; engines without view transitions switch at once. A switch during the crossfade
  // skips the running transition, which rejects its ready promise.
  if (typeof document.startViewTransition === 'function') document.startViewTransition(update).ready.catch(() => {});
  else update();
  if (keepInStorage) savePreference(storage(), choice);
}

/**
 * Applies the theme now and after every change, and sends the shown theme to the window frame. With
 * `keepInStorage` (no boot payload from Rust), the saved Phase 0 choice is restored first and kept in step.
 * Returns a function that stops following changes.
 */
export function initTheme(platform: Platform, options: { keepInStorage: boolean }): () => void {
  keepInStorage = options.keepInStorage;
  if (keepInStorage) {
    const saved = loadPreference(storage());
    settingsStore.set((state) => ({
      ...state,
      settings: { ...state.settings, appearance: { ...state.settings.appearance, theme: saved } },
    }));
  }
  let shown: Theme | null = null;
  const apply = () => {
    const preference = getSettings().appearance.theme;
    applyPreference(document.documentElement, preference);
    const next = resolveTheme(preference, osStore.get());
    if (next !== shown) platform.window.setFrameTheme(next);
    shown = next;
  };
  apply();
  const stopSettings = settingsStore.subscribe(apply);
  const stopOs = osStore.subscribe(apply);
  return () => {
    stopSettings();
    stopOs();
  };
}
