// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBootData, mergeBoot } from '../boot/defaults';
import type { BootOverrides } from '../boot/defaults';
import { initOs, osStore } from '../state/os';
import { getSettings, initSettings } from '../state/settings';
import { resetStores } from '../state/store';
import { createTestPlatform } from '../test/platform';
import { announcements, clearAnnouncements } from '../ui/announce';
import {
  addThemeParticipant,
  initTheme,
  loadPreference,
  resolveTheme,
  savePreference,
  setThemePreference,
  themeAnnouncement,
  toggledPreference,
} from './theme';

const windows = (dark: boolean) => ({ dark });
const root = () => document.documentElement;
let stop: (() => void) | null = null;

function start(overrides: BootOverrides = {}) {
  const boot = mergeBoot(defaultBootData(), overrides);
  const platform = createTestPlatform({ boot });
  initSettings(boot, platform);
  initOs(boot, platform);
  stop = initTheme(platform, { keepInStorage: false });
  return platform;
}

beforeEach(() => {
  vi.useFakeTimers();
  clearAnnouncements();
});

afterEach(() => {
  stop?.();
  stop = null;
  resetStores();
  vi.useRealTimers();
  for (const name of ['data-theme', 'data-contrast', 'data-motion', 'data-page-color', 'style']) {
    root().removeAttribute(name);
  }
});

describe('theme preference', () => {
  it('follows the Windows setting when set to system', () => {
    expect(resolveTheme('system', windows(true))).toBe('dark');
    expect(resolveTheme('system', windows(false))).toBe('light');
  });

  it('keeps an explicit choice regardless of Windows', () => {
    expect(resolveTheme('light', windows(true))).toBe('light');
    expect(resolveTheme('dark', windows(false))).toBe('dark');
  });

  it('toggles to the opposite of what is shown', () => {
    expect(toggledPreference('light')).toBe('dark');
    expect(toggledPreference('dark')).toBe('light');
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
});

describe('the theme controller', () => {
  it('always sets data-theme to the resolved theme, from the Windows setting Rust reports', () => {
    const platform = start({ os: { dark: true } });
    expect(root().dataset.theme).toBe('dark');
    platform.setOs({ dark: false });
    expect(root().dataset.theme).toBe('light');
    expect(platform.window.calls.frameTheme).toEqual(['dark', 'light']);
  });

  it('saves a choice and applies it', async () => {
    const platform = start();
    const update = vi.spyOn(platform.settings, 'update');
    setThemePreference('dark', 'settings');
    expect(getSettings().appearance.theme).toBe('dark');
    expect(root().dataset.theme).toBe('dark');
    expect(update).toHaveBeenCalledWith({ appearance: { theme: 'dark' } });
  });

  it('applies at most one change every 350 ms, and the latest request wins', () => {
    const platform = start();
    setThemePreference('dark', 'settings');
    setThemePreference('light', 'settings');
    setThemePreference('dark', 'settings');
    setThemePreference('light', 'settings');
    expect(root().dataset.theme).toBe('dark');
    vi.advanceTimersByTime(349);
    expect(root().dataset.theme).toBe('dark');
    vi.advanceTimersByTime(1);
    expect(root().dataset.theme).toBe('light');
    expect(platform.window.calls.frameTheme).toEqual(['light', 'dark', 'light']);
  });
});

describe('the appearance attributes and participants', () => {
  it('marks contrast themes, reduced motion, paper pages, the zoom, and the interface size', () => {
    const platform = start({
      os: { contrast: true, zoom: 1.25 },
      settings: { appearance: { motion: 'reduce', pageColor: 'paper', uiScale: 125 } },
    });
    expect(root().dataset.contrast).toBe('on');
    expect(root().dataset.motion).toBe('reduce');
    expect(root().dataset.pageColor).toBe('paper');
    expect(root().style.getPropertyValue('--zoom')).toBe('1.25');
    expect(root().style.getPropertyValue('--ui-scale')).toBe('1.25');
    platform.setOs({ contrast: false });
    expect(root().hasAttribute('data-contrast')).toBe(false);
  });

  it('waits for participants inside the crossfade, for at most 120 ms', async () => {
    start();
    const prepared: string[] = [];
    const stopWaiting = addThemeParticipant({ prepare: (theme) => new Promise(() => prepared.push(theme)) });
    setThemePreference('dark', 'settings');
    expect(prepared).toEqual(['dark']);
    expect(root().dataset.theme).toBe('light');
    await vi.advanceTimersByTimeAsync(120);
    expect(root().dataset.theme).toBe('dark');
    stopWaiting();
  });

  it('keeps a participant added before start-up, until it is removed', async () => {
    const prepared: string[] = [];
    const remove = addThemeParticipant({ prepare: (theme) => Promise.resolve(void prepared.push(theme)) });
    start();
    setThemePreference('dark', 'settings');
    await vi.advanceTimersByTimeAsync(0);
    remove();
    await vi.advanceTimersByTimeAsync(350);
    setThemePreference('light', 'settings');
    expect(prepared).toEqual(['dark']);
    expect(root().dataset.theme).toBe('light');
  });
});

describe('theme announcements', () => {
  const os = { dark: false, contrast: false };

  it('says when a click or the shortcut leaves Match Windows', () => {
    expect(themeAnnouncement('system', 'dark', 'shortcut', os)).toBe('Dark theme, no longer following Windows.');
    expect(themeAnnouncement('system', 'light', 'toggle', os)).toBe('Light theme, no longer following Windows.');
  });

  it('names the new theme for shortcuts and menus, and says nothing on the switch itself', () => {
    expect(themeAnnouncement('light', 'dark', 'shortcut', os)).toBe('Dark theme');
    expect(themeAnnouncement('light', 'system', 'menu', { ...os, dark: true })).toBe('Dark theme, following Windows');
    expect(themeAnnouncement('dark', 'light', 'toggle', os)).toBeNull();
    expect(themeAnnouncement('dark', 'light', 'settings', os)).toBeNull();
  });

  it('explains the contrast theme instead of changing nothing silently', () => {
    expect(themeAnnouncement('light', 'dark', 'shortcut', { ...os, contrast: true })).toBe(
      'A Windows contrast theme is on, so Windows sets the colors.',
    );
  });

  it('announces a palette choice', () => {
    start();
    setThemePreference('dark', 'palette');
    expect(announcements()).toEqual(['Dark theme']);
    expect(osStore.get().dark).toBe(false);
  });
});
