// The dispatcher's scope, text field, and dialog rules, against real elements in the browser.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { navigate } from '../app/location';
import { commands } from '../registries';
import { createMemoryNotesService } from '../services/notes/memory';
import { pushLayer } from '../state/layers';
import { resetStores } from '../state/store';
import { createTestPlatform } from '../test/platform';
import { activeScopes, commandForKey, installDispatcher, reachesCommandsInText } from './dispatcher';
import { chord, configureCommands, defineCommand } from './registry';
import type { CommandDef } from './types';

const stops: (() => void)[] = [];

function add(id: string, rest: Partial<CommandDef>) {
  stops.push(
    commands.register(
      defineCommand({ id: `test.${id}`, title: 'theme.commands.toggle', category: 'general', run() {}, ...rest }),
    ),
  );
}

beforeAll(() =>
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) }),
);

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetStores();
  document.body.replaceChildren();
});

function element(html: string, selector: string): Element {
  document.body.innerHTML = html;
  const found = document.querySelector(selector);
  if (!found) throw new Error(`No ${selector}`);
  return found;
}

function press(target: Element | null, key: string, code: string, mods = '', repeat = false) {
  const has = (name: string) => mods.includes(name);
  return {
    key,
    code,
    ctrlKey: has('ctrl'),
    altKey: has('alt'),
    shiftKey: has('shift'),
    metaKey: false,
    isComposing: false,
    repeat,
    target,
  };
}

const run = (...args: Parameters<typeof press>) => commandForKey(press(...args))?.id ?? null;

describe('scopes', () => {
  it('come from data-scope around the focus, the view, and dialogs', () => {
    const row = element('<div data-scope="tree pagesTree"><button id="row"></button></div>', '#row');
    expect([...activeScopes(row, 'workspace')].sort()).toEqual(['global', 'pagesTree', 'tree', 'workspace']);
    expect([...activeScopes(row, 'settings')].sort()).toEqual(['global', 'pagesTree', 'tree']);
    const field = element('<div role="dialog"><input id="field"></div>', '#field');
    expect([...activeScopes(field, 'workspace')].sort()).toEqual(['dialog', 'global', 'workspace']);
    const palette = element('<div role="dialog" data-scope="palette"><input id="p"></div>', '#p');
    expect([...activeScopes(palette, 'workspace')].sort()).toEqual(['global', 'palette', 'workspace']);
  });

  it('run the most specific command, and fall through when it is unavailable', () => {
    add('palette', { keys: [chord('Ctrl+Alt+K')] });
    let selected = true;
    add('link', { keys: [chord('Ctrl+Alt+K')], scope: 'editor', refines: 'test.palette', enabled: () => selected });
    const editor = element('<div data-scope="page"><div data-scope="editor" id="e" tabindex="0"></div></div>', '#e');
    expect(run(editor, 'k', 'KeyK', 'ctrl alt')).toBe('test.link');
    selected = false;
    expect(run(editor, 'k', 'KeyK', 'ctrl alt')).toBe('test.palette');
    expect(run(document.body, 'k', 'KeyK', 'ctrl alt')).toBe('test.palette');
  });

  it('prefer a match by the typed key to one by the physical key', () => {
    add('shortcuts', { keys: [chord('Ctrl+]')], allowInTextInput: true });
    add('numbered', { keys: [chord('Ctrl+Shift+9')], scope: 'editor', allowInTextInput: true });
    const editor = element('<div data-scope="page editor" contenteditable="true" id="e"></div>', '#e');
    expect(run(editor, ']', 'Digit9', 'ctrl shift')).toBe('test.shortcuts');
    expect(run(editor, '(', 'Digit9', 'ctrl shift')).toBe('test.numbered');
  });

  it('keep workspace commands out of other views', () => {
    add('newPage', { keys: [chord('Ctrl+Alt+N')], scope: 'workspace' });
    expect(run(document.body, 'n', 'KeyN', 'ctrl alt')).toBe('test.newPage');
    navigate({ view: 'settings', section: 'general' });
    expect(run(document.body, 'n', 'KeyN', 'ctrl alt')).toBeNull();
  });
});

describe('text fields, dialogs, repeats, and flags', () => {
  it('let only chords with Ctrl or Alt, or function keys, reach commands that allow it', () => {
    expect(
      [chord('Ctrl+K'), chord('Alt+Left'), chord('F2'), chord('Ctrl+C'), chord('Ctrl+Shift+Left')].map(
        reachesCommandsInText,
      ),
    ).toEqual([true, true, true, false, false]);
    add('palette', { keys: [chord('Ctrl+Alt+K')], allowInTextInput: true });
    add('newPage', { keys: [chord('Ctrl+Alt+N')] });
    add('undo', { keys: [chord('Ctrl+Z')], allowInTextInput: true });
    const field = element('<input id="f">', '#f');
    expect(run(field, 'k', 'KeyK', 'ctrl alt')).toBe('test.palette');
    expect(run(field, 'n', 'KeyN', 'ctrl alt')).toBeNull();
    expect(run(field, 'z', 'KeyZ', 'ctrl')).toBeNull();
    expect(run(element('<input type="checkbox" id="c">', '#c'), 'n', 'KeyN', 'ctrl alt')).toBe('test.newPage');
  });

  it('run only commands that allow it while a modal layer is open', () => {
    add('theme', { keys: [chord('Ctrl+Alt+Shift+T')], allowInModal: true });
    add('newPage', { keys: [chord('Ctrl+Alt+N')] });
    add('inDialog', { keys: [chord('Ctrl+Alt+R')], scope: 'dialog' });
    const pop = pushLayer({ id: 'd', kind: 'dialog', modal: true, close() {} });
    const inside = element('<div role="dialog"><button id="b"></button></div>', '#b');
    expect(run(inside, 'T', 'KeyT', 'ctrl alt shift')).toBe('test.theme');
    expect(run(inside, 'n', 'KeyN', 'ctrl alt')).toBeNull();
    expect(run(inside, 'r', 'KeyR', 'ctrl alt')).toBe('test.inDialog');
    pop();
    expect(run(document.body, 'n', 'KeyN', 'ctrl alt')).toBe('test.newPage');
  });

  it('repeat only commands that allow it, skip flags that are off, and leave key capture alone', () => {
    add('toggle', { keys: [chord('Ctrl+Shift+D')] });
    add('move', { keys: [chord('Ctrl+Shift+Up')], allowRepeat: true });
    add('flagged', { keys: [chord('Ctrl+Alt+B')], flag: 'storage.core' });
    expect(run(document.body, 'D', 'KeyD', 'ctrl shift', true)).toBeNull();
    expect(run(document.body, 'ArrowUp', 'ArrowUp', 'ctrl shift', true)).toBe('test.move');
    expect(run(document.body, 'b', 'KeyB', 'ctrl alt')).toBeNull();
    const capture = element('<div data-key-capture tabindex="0" id="k"></div>', '#k');
    expect(run(capture, 'D', 'KeyD', 'ctrl shift')).toBeNull();
  });
});

describe('the listener', () => {
  it('prevents the default only when a command runs', async () => {
    const ran = vi.fn();
    add('palette', { keys: [chord('Ctrl+Alt+K')], run: ran });
    const stop = installDispatcher(window);
    const keydown = (key: string) =>
      new KeyboardEvent('keydown', {
        key,
        code: `Key${key.toUpperCase()}`,
        ctrlKey: true,
        altKey: true,
        cancelable: true,
        bubbles: true,
      });
    const [hit, miss] = [keydown('k'), keydown('j')];
    document.body.dispatchEvent(hit);
    document.body.dispatchEvent(miss);
    stop();
    await vi.waitFor(() => expect(ran).toHaveBeenCalledOnce());
    expect([hit.defaultPrevented, miss.defaultPrevented]).toEqual([true, false]);
  });
});
