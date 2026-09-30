import { afterEach, describe, expect, it } from 'vitest';
import { keysFor } from '../commands/keymap';
import { chord, defineCommand } from '../commands/registry';
import type { CommandDef } from '../commands/types';
import { commands } from '../registries';
import { assignShortcut, resetAllShortcuts, resetShortcut, setShortcut, setShortcutSet } from './keymap';
import { DEFAULT_SETTINGS, getSettings, settingsStore } from './settings';
import { resetStores } from './store';

const stops: (() => void)[] = [];

function add(id: string, rest: Partial<CommandDef>) {
  stops.push(
    commands.register(
      defineCommand({ id: `test.${id}`, title: 'theme.commands.toggle', category: 'general', run() {}, ...rest }),
    ),
  );
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetStores();
});

describe('changing shortcuts', () => {
  it('takes a chord from the commands that use it, in one change', async () => {
    add('palette', { keys: [chord('Ctrl+K'), chord('Ctrl+Alt+P')] });
    add('theme', { keys: [chord('Ctrl+Shift+D')] });
    add('tree', { keys: [chord('Ctrl+K')], scope: 'notebooksTree' });
    add('pages', { keys: [chord('Ctrl+K')], scope: 'pagesTree' });
    await assignShortcut('test.theme', chord('Ctrl+K'));
    expect(keysFor('test.theme')).toEqual(['Ctrl+K']);
    expect(keysFor('test.palette')).toEqual(['Ctrl+Alt+P']);
    expect(keysFor('test.tree')).toEqual([]);
    expect(keysFor('test.pages')).toEqual([]);
  });

  it("removes the override when a command gets its set's own chords back", async () => {
    add('theme', { keys: [chord('Ctrl+Shift+D')] });
    await setShortcut('test.theme', [chord('Ctrl+Alt+D')]);
    expect(getSettings().shortcuts['test.theme']).toEqual(['Ctrl+Alt+D']);
    await setShortcut('test.theme', [chord('Ctrl+Shift+D')]);
    expect('test.theme' in getSettings().shortcuts).toBe(false);
    await setShortcut('test.theme', []);
    expect(keysFor('test.theme')).toEqual([]);
    await resetShortcut('test.theme');
    expect(keysFor('test.theme')).toEqual(['Ctrl+Shift+D']);
  });

  it('resets every known command and keeps overrides for commands it does not know', async () => {
    add('theme', { keys: [chord('Ctrl+Shift+D')] });
    settingsStore.set({
      settings: { ...DEFAULT_SETTINGS, shortcuts: { 'test.theme': ['Ctrl+Alt+D'], 'later.thing': ['Ctrl+Alt+L'] } },
      readOnly: false,
    });
    await resetAllShortcuts();
    expect(getSettings().shortcuts).toEqual({ 'later.thing': ['Ctrl+Alt+L'] });
  });

  it('switches the shortcut set', async () => {
    add('theme', { keys: [chord('Ctrl+Shift+D')], presetKeys: { onenote: [chord('Ctrl+Alt+D')] } });
    await setShortcutSet('onenote');
    expect(keysFor('test.theme')).toEqual(['Ctrl+Alt+D']);
  });
});
