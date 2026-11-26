// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initFlags } from '../app/flags';
import { commandForKey } from '../commands/dispatcher';
import { keysFor } from '../commands/keymap';
import { chord, configureCommands, defineCommand } from '../commands/registry';
import type { CommandDef } from '../commands/types';
import { commands } from '../registries';
import { createMemoryNotesService } from '../services/notes/memory';
import { createTestPlatform } from '../test/platform';
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

// The table-grid context (ADR 0063): in a table's Grid mode its commands come before the page's and the editor's,
// Ctrl+K stays the palette, and a chord the person changes moves with the command. These are stand-ins for the
// sheet commands; features/tables/keys/commands.test.ts checks the real ones.
describe('the table-grid context', () => {
  beforeAll(() => {
    initFlags('dev');
    configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) });
  });

  function press(scope: string, key: string, code: string, mods: string) {
    document.body.innerHTML = `<div data-scope="page"><div contenteditable="true" data-scope="${scope}"></div></div>`;
    const target = document.querySelector('[contenteditable]');
    const has = (name: string) => mods.includes(name);
    const event = { key, code, ctrlKey: has('ctrl'), altKey: has('alt'), shiftKey: false, metaKey: false };
    return commandForKey({ ...event, isComposing: false, repeat: false, target })?.id ?? null;
  }

  const GRID = 'editor editor.table tableGrid';

  it('runs Grid mode’s chord before the page’s, and the page’s in Edit mode', () => {
    add('pageFill', { keys: [chord('Ctrl+D')], scope: 'page', allowInTextInput: true });
    add('gridFill', { keys: [chord('Ctrl+D')], scope: 'tableGrid', allowInTextInput: true });
    add('palette', { keys: [chord('Ctrl+K')], allowInTextInput: true });
    expect(press(GRID, 'd', 'KeyD', 'ctrl')).toBe('test.gridFill');
    expect(press('editor editor.table tableEdit', 'd', 'KeyD', 'ctrl')).toBe('test.pageFill');
    expect(press(GRID, 'k', 'KeyK', 'ctrl')).toBe('test.palette');
  });

  it('moves a grid command to the chord the person gives it', async () => {
    add('pageFill', { keys: [chord('Ctrl+D')], scope: 'page', allowInTextInput: true });
    add('gridFill', { keys: [chord('Ctrl+D')], scope: 'tableGrid', allowInTextInput: true });
    await setShortcut('test.gridFill', [chord('Ctrl+Alt+D')]);
    expect(press(GRID, 'd', 'KeyD', 'ctrl')).toBe('test.pageFill');
    expect(press(GRID, 'd', 'KeyD', 'ctrl alt')).toBe('test.gridFill');
  });
});
