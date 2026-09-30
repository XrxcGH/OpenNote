// The dark mode setting from BRAND.md: Light, Dark, or Match Windows (the system setting).

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'opennote.theme';
const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

/** The theme actually shown, given the person's preference and the system setting. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** The quick toggle switches between light and dark; from "system" it switches to the opposite. */
export function toggledPreference(current: Theme): ThemePreference {
  return current === 'dark' ? 'light' : 'dark';
}

export function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (ORDER as string[]).includes(value);
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
