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
    await platform.settings.update({ keymap: { preset: 'onenote' } });
    expect(getSettings().keymap.preset).toBe('onenote');
  });

  it('removes keys with null, as merge patches do', async () => {
    start();
    await updateSettings({ shortcuts: { 'theme.toggle': ['Ctrl+Alt+K'] } });
    expect(getSettings().shortcuts['theme.toggle']).toEqual(['Ctrl+Alt+K']);
    await updateSettings({ shortcuts: { 'theme.toggle': null } });
    expect(getSettings().shortcuts).toEqual({});
  });
});

describe('schema version 2', () => {
  it('starts every new key at its default', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      schemaVersion: 2,
      minWriterSchema: 1,
      text: {
        paste: { word: 'keepSource', docs: 'keepSource', onenote: 'keepSource', web: 'mergeFormatting' },
        measurementUnit: 'inches',
        darkCustomBackgrounds: 'exact',
      },
      tables: { newTableKeys: 'spreadsheet', formulaBar: true },
      code: {
        indent: {},
        pythonRuntime: 'quick',
        timeLimitSeconds: 10,
        memoryLimitMib: 64,
        formatOnSave: false,
        completionList: true,
        suggestions: 'automaticRules',
        acceptButton: 'touchOrPen',
        announceSuggestions: true,
        diagnostics: 'everything',
        cStandard: 'c17',
        cppStandard: 'cpp20',
        compilerWarnings: true,
      },
    });
  });

  it('keeps a code setting and rejects one outside its range', async () => {
    const platform = start();
    await updateSettings({ code: { suggestions: 'onRequest' } });
    expect(getSettings().code.suggestions).toBe('onRequest');
    await expect(platform.settings.update({ code: { timeLimitSeconds: 600 } })).rejects.toMatchObject({
      field: 'code.timeLimitSeconds',
    });
  });

  it('saves and reads back the Docs shortcut set', async () => {
    const platform = start();
    await updateSettings({ keymap: { preset: 'docs' } });
    expect(getSettings().keymap.preset).toBe('docs');
    const saved = JSON.parse(JSON.stringify(getSettings())) as typeof DEFAULT_SETTINGS;
    expect(saved.keymap.preset).toBe('docs');
    const bad = { keymap: { preset: 'word' } } as unknown as Parameters<typeof updateSettings>[0];
    await expect(platform.settings.update(bad)).rejects.toMatchObject({ field: 'keymap.preset' });
  });
});

describe('settings from an older shell', () => {
  it("fills fields the host doesn't send with defaults, and keeps what it sends", async () => {
    const platform = createWebPlatform();
    const { keymap: _keymap, ...older } = DEFAULT_SETTINGS;
    const partial = { ...older, appearance: { ...older.appearance, theme: 'dark', uiScale: undefined } };
    vi.spyOn(platform.settings, 'update').mockResolvedValue(partial as unknown as typeof DEFAULT_SETTINGS);
    initSettings(defaultBootData(), platform);
    await updateSettings({ appearance: { theme: 'dark' } });
    expect(getSettings().keymap.preset).toBe('default');
    expect(getSettings().appearance).toMatchObject({ theme: 'dark', uiScale: 100 });
    expect(getSettings().storage.notesFolder).toBeNull();
  });
});
