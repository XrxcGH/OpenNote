// @vitest-environment jsdom
// The sheet commands in the registry (ADR 0063): Grid mode's Ctrl+D comes before the page's, applies only to a
// table with spreadsheet keys that had focus, leaves Ctrl+K to the palette, and follows the person's own chord.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { commandForKey } from '../../../commands/dispatcher';
import { chord, configureCommands, defineCommand } from '../../../commands/registry';
import type { CommandDef } from '../../../commands/types';
import { commands } from '../../../registries';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { setShortcut } from '../../../state/keymap';
import { resetStores } from '../../../state/store';
import { createTestPlatform } from '../../../test/platform';
import { activeSheet, clearActiveSheet, setActiveSheet } from './active';
import type { SheetRunner } from './active';
import { registerSheetKeyCommands } from './commands';

const stops: (() => void)[] = [];
const ran: string[] = [];
let documentKeys = false;
const sheet: SheetRunner = { run: (id) => (ran.push(id), true), documentKeys: () => documentKeys };

function add(id: string, rest: Partial<CommandDef>) {
  stops.push(
    commands.register(
      defineCommand({ id: `test.${id}`, title: 'theme.commands.toggle', category: 'general', run() {}, ...rest }),
    ),
  );
}

beforeAll(() => {
  initFlags('dev');
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) });
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  clearActiveSheet(sheet);
  documentKeys = false;
  resetStores();
});

function press(scope: string, key: string, code: string, mods: string) {
  document.body.innerHTML = `<div data-scope="page"><div contenteditable="true" data-scope="${scope}"></div></div>`;
  const target = document.querySelector('[contenteditable]');
  const has = (name: string) => mods.includes(name);
  const event = { key, code, ctrlKey: has('ctrl'), altKey: has('alt'), shiftKey: false, metaKey: false };
  return commandForKey({ ...event, isComposing: false, repeat: false, target })?.id ?? null;
}

const GRID = 'editor editor.table tableGrid';
const EDIT = 'editor editor.table tableEdit';

describe('the sheet commands', () => {
  it('run in Grid mode before the page, only for a spreadsheet table with focus', () => {
    stops.push(registerSheetKeyCommands());
    add('pageFill', { keys: [chord('Ctrl+D')], scope: 'page', allowInTextInput: true });
    add('palette', { keys: [chord('Ctrl+K')], allowInTextInput: true });
    expect(press(GRID, 'd', 'KeyD', 'ctrl')).toBe('test.pageFill');
    setActiveSheet(sheet);
    expect(activeSheet()).toBe(sheet);
    expect(press(GRID, 'd', 'KeyD', 'ctrl')).toBe('table.sheet.fillDown');
    expect(press(EDIT, 'd', 'KeyD', 'ctrl')).toBe('test.pageFill');
    expect(press(GRID, 'k', 'KeyK', 'ctrl')).toBe('test.palette');
    expect(press(EDIT, ';', 'Semicolon', 'ctrl')).toBe('table.sheet.insertDate');
    documentKeys = true;
    expect(press(GRID, 'd', 'KeyD', 'ctrl')).toBe('test.pageFill');
  });

  it('follow the chord the person gives them', async () => {
    stops.push(registerSheetKeyCommands());
    add('pageFill', { keys: [chord('Ctrl+D')], scope: 'page', allowInTextInput: true });
    setActiveSheet(sheet);
    await setShortcut('table.sheet.fillDown', [chord('Ctrl+Alt+D')]);
    expect(press(GRID, 'd', 'KeyD', 'ctrl')).toBe('test.pageFill');
    expect(press(GRID, 'd', 'KeyD', 'ctrl alt')).toBe('table.sheet.fillDown');
    void commands.get('table.sheet.fillDown')?.run({} as never, undefined);
    expect(ran).toEqual(['table.sheet.fillDown']);
  });
});
