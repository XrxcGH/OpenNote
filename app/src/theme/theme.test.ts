import { describe, expect, it } from 'vitest';
import {
  applyPreference,
  isToggleShortcut,
  loadPreference,
  resolveTheme,
  savePreference,
  toggledPreference,
} from './theme';

describe('theme preference', () => {
  it('follows the system setting when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('keeps an explicit choice regardless of the system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('toggles to the opposite of what is shown', () => {
    expect(toggledPreference('light')).toBe('dark');
    expect(toggledPreference('dark')).toBe('light');
  });

  it('recognizes Ctrl+Shift+D only without other modifiers or key repeats', () => {
    const keys = { code: 'KeyD', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false };
    expect(isToggleShortcut(keys)).toBe(true);
    expect(isToggleShortcut({ ...keys, repeat: true })).toBe(false);
    expect(isToggleShortcut({ ...keys, altKey: true })).toBe(false);
    expect(isToggleShortcut({ ...keys, metaKey: true })).toBe(false);
    expect(isToggleShortcut({ ...keys, ctrlKey: false })).toBe(false);
    expect(isToggleShortcut({ ...keys, shiftKey: false })).toBe(false);
    expect(isToggleShortcut({ ...keys, code: 'KeyF' })).toBe(false);
  });

  it('round-trips through storage and ignores bad values', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(loadPreference(storage)).toBe('system');
    savePreference(storage, 'dark');
    expect(loadPreference(storage)).toBe('dark');
    store.set('opennote.theme', 'purple');
    expect(loadPreference(storage)).toBe('system');
  });

  it('sets or clears the data-theme attribute', () => {
    const root = document.createElement('html');
    applyPreference(root, 'dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyPreference(root, 'system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
