import { afterEach, describe, expect, it } from 'vitest';
import { commands } from '../registries';
import { DEFAULT_SETTINGS, settingsStore } from '../state/settings';
import { resetStores } from '../state/store';
import {
  commandsForChord,
  conflictsFor,
  defaultConflicts,
  hasOverride,
  keysFor,
  scopeDepth,
  scopesOverlap,
  setChangeFor,
  shortcutHint,
} from './keymap';
import { chord, defineCommand } from './registry';
import type { CommandDef, KeyScope } from './types';

const stops: (() => void)[] = [];

function add(id: string, rest: Partial<CommandDef> = {}) {
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

const withSettings = (patch: Partial<typeof DEFAULT_SETTINGS>) =>
  settingsStore.set({ settings: { ...DEFAULT_SETTINGS, ...patch }, readOnly: false });

describe('keysFor', () => {
  it('uses the defaults, then the shortcut set, then overrides', () => {
    add('keymap', { keys: [chord('Ctrl+Shift+D')], presetKeys: { onenote: [chord('Ctrl+Alt+D')] } });
    expect(keysFor('test.keymap')).toEqual(['Ctrl+Shift+D']);
    withSettings({ keymap: { preset: 'onenote' } });
    expect(keysFor('test.keymap')).toEqual(['Ctrl+Alt+D']);
    withSettings({ shortcuts: { 'test.keymap': ['Ctrl+Alt+K', 'not a chord'] } });
    expect(keysFor('test.keymap')).toEqual(['Ctrl+Alt+K']);
    expect(hasOverride('test.keymap')).toBe(true);
    withSettings({ shortcuts: { 'test.keymap': [] } });
    expect(keysFor('test.keymap')).toEqual([]);
    expect(keysFor('test.missing')).toEqual([]);
  });

  it('ignores overrides of fixed commands and keeps overrides of unknown ones', () => {
    add('fixed', { keys: [chord('Alt+Space')], customizable: false });
    withSettings({ shortcuts: { 'test.fixed': ['Ctrl+Alt+K'], 'later.command': ['Ctrl+Alt+L'] } });
    expect(keysFor('test.fixed')).toEqual(['Alt+Space']);
    expect(hasOverride('test.fixed')).toBe(false);
    expect(settingsStore.get().settings.shortcuts['later.command']).toEqual(['Ctrl+Alt+L']);
  });

  it('gives a hint from the first chord', () => {
    add('hint', { keys: [chord('Ctrl+Shift+D'), chord('Ctrl+Alt+D')] });
    expect(shortcutHint('test.hint')).toBe('Ctrl+Shift+D');
    expect(shortcutHint('test.missing')).toBeNull();
  });

  it('indexes commands by chord and follows rebinding', () => {
    add('indexed', { keys: [chord('Ctrl+Alt+I')] });
    expect(commandsForChord(chord('Ctrl+Alt+I')).map((def) => def.id)).toEqual(['test.indexed']);
    withSettings({ shortcuts: { 'test.indexed': ['Ctrl+Alt+J'] } });
    expect(commandsForChord(chord('Ctrl+Alt+I'))).toEqual([]);
    expect(commandsForChord(chord('Ctrl+Alt+J')).map((def) => def.id)).toEqual(['test.indexed']);
  });
});

describe('scopes', () => {
  it('nest, and overlap only along one branch', () => {
    const cases: [KeyScope, KeyScope, boolean][] = [
      ['global', 'editor.table', true],
      ['workspace', 'pagesTree', true],
      ['notebooksTree', 'pagesTree', false],
      ['tree', 'page', false],
      ['editor', 'pageObject', false],
      ['editor.code', 'page', true],
      ['palette', 'dialog', false],
      ['zoomBox', 'workspace', true],
    ];
    expect(cases.filter(([a, b, overlap]) => scopesOverlap(a, b) !== overlap)).toEqual([]);
    expect([scopeDepth('global'), scopeDepth('tree'), scopeDepth('editor.table')]).toEqual([0, 2, 4]);
  });
});

describe('conflicts', () => {
  it('finds commands in overlapping scopes, but not refinements', () => {
    add('palette', { keys: [chord('Ctrl+Alt+K')] });
    add('link', { keys: [chord('Ctrl+Alt+K')], scope: 'editor', refines: 'test.palette' });
    add('tree', { keys: [chord('Ctrl+Alt+M')], scope: 'notebooksTree' });
    add('pages', { keys: [chord('Ctrl+Alt+M')], scope: 'pagesTree' });
    add('other', { scope: 'tree' });
    expect(conflictsFor('test.other', chord('Ctrl+Alt+K')).map((def) => def.id)).toEqual(['test.palette']);
    expect(conflictsFor('test.other', chord('Ctrl+Alt+M')).map((def) => def.id)).toEqual(['test.tree', 'test.pages']);
    expect(conflictsFor('test.link', chord('Ctrl+Alt+K'))).toEqual([]);
    expect(defaultConflicts('default')).toEqual([]);
  });

  it('reports colliding defaults in each shortcut set', () => {
    add('first', { keys: [chord('Ctrl+Alt+F')] });
    add('second', { scope: 'tree', presetKeys: { onenote: [chord('Ctrl+Alt+F')] } });
    expect(defaultConflicts('default')).toEqual([]);
    expect(defaultConflicts('onenote')).toEqual(['Ctrl+Alt+F: test.first and test.second']);
  });
});

describe('shortcut sets', () => {
  it('says where a command moved in the OneNote set, and which command took its key', () => {
    add('code', { keys: [chord('Ctrl+Alt+E')], presetKeys: { onenote: [] }, scope: 'editor' });
    add('search', { presetKeys: { onenote: [chord('Ctrl+Alt+E')] } });
    add('same', { keys: [chord('Ctrl+Alt+S')] });
    expect(setChangeFor('test.code')).toBeNull();
    withSettings({ keymap: { preset: 'onenote' } });
    expect(setChangeFor('test.code')).toEqual({
      defaultKeys: ['Ctrl+Alt+E'],
      takenBy: [{ chord: 'Ctrl+Alt+E', id: 'test.search' }],
    });
    expect(setChangeFor('test.same')).toBeNull();
  });
});
