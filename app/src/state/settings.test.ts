import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBootData } from '../boot/defaults';
import { createWebPlatform } from '../platform/web';
import { resetStores } from './store';
import { DEFAULT_SETTINGS, getSettings, initSettings, updateSettings } from './settings';

afterEach(() => resetStores());

function start() {
  const platform = createWebPlatform();
  initSettings(defaultBootData(), platform);
  return platform;
}

describe('the settings slice', () => {
  it('applies a patch at once and keeps what the platform saved', async () => {
    const platform = start();
    const update = vi.spyOn(platform.settings, 'update');
    const pending = updateSettings({ appearance: { theme: 'dark' } });
    expect(getSettings().appearance.theme).toBe('dark');
    await pending;
    expect(update).toHaveBeenCalledWith({ appearance: { theme: 'dark' } });
    expect(getSettings().appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, theme: 'dark' });
  });

  it('reverts when the platform rejects the patch', async () => {
    start();
    // The web platform checks values as Rust does.
    const bad = { appearance: { textSize: 42 } } as unknown as Parameters<typeof updateSettings>[0];
    await expect(updateSettings(bad)).rejects.toMatchObject({ code: 'invalid', field: 'appearance.textSize' });
    expect(getSettings().appearance.textSize).toBe(100);
  });

  it('keeps a change for the session when the host has no settings store yet', async () => {
    const platform = start();
    vi.spyOn(platform.settings, 'update').mockRejectedValue({ code: 'notImplemented', message: 'later' });
    await updateSettings({ startup: { openLastPage: false } });
    expect(getSettings().startup.openLastPage).toBe(false);
  });

  it('follows changes the platform reports', async () => {
    const platform = start();
    await platform.settings.update({ keyboard: { preset: 'onenote' } });
    expect(getSettings().keyboard.preset).toBe('onenote');
  });

  it('removes keys with null, as merge patches do', async () => {
    start();
    await updateSettings({ shortcuts: { 'theme.toggle': ['Ctrl+Alt+K'] } });
    expect(getSettings().shortcuts['theme.toggle']).toEqual(['Ctrl+Alt+K']);
    await updateSettings({ shortcuts: { 'theme.toggle': null } });
    expect(getSettings().shortcuts).toEqual({});
  });
});
