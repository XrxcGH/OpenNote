// @vitest-environment jsdom
// Key scope precedence across the programs. Scopes, innermost first: codeDebug, codeEditor, a table mode (tableEdit
// or tableGrid), the text editor in its shortcut set, the page, and the app. Each program's key lane owns one
// fixture file in fixtures/scopes/. This test loads them all, so two programs that bind one chord in one scope fail.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands } from '../registries';
import { createMemoryNotesService } from '../services/notes/memory';
import { DEFAULT_SETTINGS, settingsStore } from '../state/settings';
import { createTestPlatform } from '../test/platform';
import { commandForKey } from './dispatcher';
import { appScopes } from './fixtures/scopes/app';
import { codeScopes } from './fixtures/scopes/code';
import { tablesScopes } from './fixtures/scopes/tables';
import { textScopes } from './fixtures/scopes/text';
import type { ScopeCase, ScopeFixture } from './fixtures/scopes/types';
import { scopeChain, setKeys } from './keymap';
import { chord, configureCommands, defineCommand } from './registry';
import type { Chord, CommandId, KeymapPresetId, KeyScope } from './types';

const FIXTURES: readonly ScopeFixture[] = [appScopes, textScopes, tablesScopes, codeScopes];
const PRESETS: readonly KeymapPresetId[] = ['default', 'docs', 'onenote'];

const disabled = new Set<CommandId>();
const stops: (() => void)[] = [];

beforeAll(() => {
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) });
  for (const fixture of FIXTURES) {
    for (const command of fixture.commands) {
      const presetKeys = Object.fromEntries(
        Object.entries(command.presetKeys ?? {}).map(([preset, keys]) => [preset, keys.map(chord)]),
      );
      const def = defineCommand({
        id: command.id,
        title: 'theme.commands.toggle',
        category: 'general',
        keys: command.keys?.map(chord),
        presetKeys,
        scope: command.scope,
        refines: command.refines,
        allowInTextInput: true,
        enabled: () => !disabled.has(command.id),
        run() {},
      });
      stops.push(commands.register(def));
    }
  }
});

afterAll(() => stops.splice(0).forEach((stop) => stop()));

const KEYS: Readonly<Record<string, { key: string; code: string }>> = {
  Enter: { key: 'Enter', code: 'Enter' },
  Space: { key: ' ', code: 'Space' },
  Tab: { key: 'Tab', code: 'Tab' },
  '`': { key: '`', code: 'Backquote' },
};

/** A key press as the browser reports it for a chord such as 'Ctrl+Shift+Tab', on a US layout. */
function pressFor(text: string, target: Element) {
  const parts = text.split('+');
  const name = parts[parts.length - 1];
  const has = (mod: string) => parts.slice(0, -1).includes(mod);
  const named = KEYS[name];
  const key = named?.key ?? (/^F\d+$/.test(name) ? name : name.toLowerCase());
  const code = named?.code ?? (/^\d$/.test(name) ? `Digit${name}` : /^[A-Z]$/.test(name) ? `Key${name}` : name);
  return {
    key,
    code,
    ctrlKey: has('Ctrl'),
    altKey: has('Alt'),
    shiftKey: has('Shift'),
    metaKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    target,
  };
}

/** An element nested in every scope around `at`, the way the page, editor, and table elements nest. */
function focusIn(at: KeyScope): Element {
  document.body.replaceChildren();
  let parent: Element = document.body;
  for (const scope of scopeChain(at).reverse()) {
    if (scope === 'global' || scope === 'workspace') continue;
    const element = document.createElement('div');
    element.setAttribute('data-scope', scope);
    parent.append(element);
    parent = element;
  }
  const target = document.createElement('div');
  target.tabIndex = 0;
  parent.append(target);
  return target;
}

function resolve(test: ScopeCase): CommandId | null {
  settingsStore.set({
    settings: { ...DEFAULT_SETTINGS, keymap: { preset: test.preset ?? 'default' } },
    readOnly: false,
  });
  disabled.clear();
  for (const id of test.disabled ?? []) disabled.add(id);
  return commandForKey(pressFor(test.chord, focusIn(test.at)))?.id ?? null;
}

describe('the scope chain', () => {
  it('puts the code editor inside the editor, and the debugger inside the code editor', () => {
    expect(scopeChain('codeDebug')).toEqual(['codeDebug', 'codeEditor', 'editor', 'page', 'workspace', 'global']);
  });

  it('puts both table modes inside the table, inside the editor', () => {
    expect(scopeChain('tableGrid')).toEqual(['tableGrid', 'editor.table', 'editor', 'page', 'workspace', 'global']);
    expect(scopeChain('tableEdit')).toEqual(['tableEdit', 'editor.table', 'editor', 'page', 'workspace', 'global']);
  });
});

describe.each(FIXTURES.map((fixture) => [fixture.program, fixture] as const))('the %s fixture', (_name, fixture) => {
  it.each(fixture.cases.map((test) => [`${test.chord} in ${test.at}: ${test.why}`, test] as const))(
    '%s',
    (_title, test) => {
      expect(resolve(test)).toBe(test.expect);
    },
  );
});

describe('the fixtures together', () => {
  it('bind no chord twice in one scope in any shortcut set', () => {
    const clashes: string[] = [];
    const ids = FIXTURES.flatMap((fixture) => fixture.commands.map((command) => command.id));
    for (const preset of PRESETS) {
      const seen = new Map<string, CommandId>();
      for (const id of ids) {
        const def = commands.get(id);
        if (!def) continue;
        for (const key of setKeys(def, preset)) {
          const slot = `${def.scope ?? 'global'} ${key as Chord}`;
          const other = seen.get(slot);
          if (other) clashes.push(`${preset}: ${slot} is ${other} and ${id}`);
          else seen.set(slot, id);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('name each command once', () => {
    const ids = FIXTURES.flatMap((fixture) => fixture.commands.map((command) => command.id));
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it('answer the plan key table for the shared chords', () => {
    const chords = ['Ctrl+D', 'Ctrl+Enter', 'Ctrl+5', 'Shift+F3', 'Ctrl+Space', 'F9', 'Ctrl+`'];
    const scopes: KeyScope[] = ['codeEditor', 'tableGrid', 'tableEdit', 'editor'];
    const cases = FIXTURES.flatMap((fixture) => fixture.cases);
    const missing = chords.flatMap((key) =>
      scopes
        .filter((at) => !cases.some((test) => test.chord === key && test.at === at && !test.preset))
        .map((at) => `${key} in ${at}`),
    );
    expect(missing).toEqual([]);
  });
});
