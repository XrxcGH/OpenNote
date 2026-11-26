// @vitest-environment jsdom
// The page tab keys inside a code editor (owner decision: Tab indents, Ctrl+Tab accepts a suggestion). A stand-in
// command on Ctrl+Tab in the codeEditor scope refines Next tab, the way the code editor's command will.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installDispatcher } from '../../commands/dispatcher';
import { setKeys } from '../../commands/keymap';
import { chord, configureCommands, defineCommand } from '../../commands/registry';
import type { CommandId } from '../../commands/types';
import { commands } from '../../registries';
import { sessionStore } from '../../state/session';
import { createMemoryNotesService } from '../../services/notes/memory';
import { INITIAL_QOL, qolStore } from '../../state/qol';
import { DEFAULT_SETTINGS, settingsStore } from '../../state/settings';
import { createTestPlatform } from '../../test/platform';
import { treeStore } from '../tree';
import type { NodeId, NodeSummary } from '../../services/notes';
import './register';

const id = (value: string) => value as NodeId;
const page = (value: string): NodeSummary => ({
  id: id(value),
  kind: 'page',
  parentId: id('s1'),
  title: value,
  color: null,
  pageLevel: 0,
  childCount: 0,
  created: '2026-01-01T00:00:00Z',
  modified: '2026-01-01T00:00:00Z',
  readOnly: false,
});
const place = (pageId: string) => ({
  view: 'workspace' as const,
  notebookId: id('n1'),
  sectionId: id('s1'),
  pageId: id(pageId),
});

let acceptEnabled = true;
let accepted = 0;
const stops: (() => void)[] = [];
let editor: HTMLElement;

beforeAll(() => {
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) });
  stops.push(
    commands.register(
      defineCommand({
        id: 'test.code.accept' as CommandId,
        title: 'theme.commands.toggle',
        category: 'code',
        keys: [chord('Ctrl+Tab')],
        scope: 'codeEditor',
        refines: 'tabs.next',
        allowInTextInput: true,
        enabled: () => acceptEnabled,
        run: () => {
          accepted += 1;
        },
      }),
    ),
    installDispatcher(window),
  );
});

afterAll(() => stops.splice(0).forEach((stop) => stop()));

beforeEach(() => {
  acceptEnabled = true;
  accepted = 0;
  settingsStore.set({ settings: DEFAULT_SETTINGS, readOnly: false });
  qolStore.set(INITIAL_QOL);
  sessionStore.set((state) => ({ ...state, location: place('a'), back: [], forward: [] }));
  treeStore.set((state) => ({ ...state, nodes: { a: page('a'), b: page('b') } }));
  qolStore.set({
    ...INITIAL_QOL,
    tabs: [
      { id: 't1', location: place('a') },
      { id: 't2', location: place('b') },
    ] as never,
    activeTab: 't1' as never,
  });
  document.body.replaceChildren();
  const scope = document.createElement('div');
  scope.setAttribute('data-scope', 'codeEditor');
  editor = document.createElement('div');
  editor.tabIndex = 0;
  scope.append(editor);
  document.body.append(scope);
  editor.focus();
});

function press(key: string, init: KeyboardEventInit = {}) {
  editor.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, ...init }));
}

const active = () => qolStore.get().activeTab as string;

describe('page tab keys in a code editor', () => {
  it('runs the code command on Ctrl+Tab and leaves the tab alone', () => {
    press('Tab', { ctrlKey: true });
    expect(accepted).toBe(1);
    expect(active()).toBe('t1');
  });

  it('switches the tab on Ctrl+Tab when the code command is disabled', () => {
    acceptEnabled = false;
    press('Tab', { ctrlKey: true });
    expect(accepted).toBe(0);
    expect(active()).toBe('t2');
  });

  it('switches to the previous tab on Ctrl+Shift+Tab with the code command on or off', () => {
    qolStore.set((state) => ({ ...state, activeTab: 't2' as never }));
    press('Tab', { ctrlKey: true, shiftKey: true });
    expect(active()).toBe('t1');
    qolStore.set((state) => ({ ...state, activeTab: 't2' as never }));
    acceptEnabled = false;
    press('Tab', { ctrlKey: true, shiftKey: true });
    expect(active()).toBe('t1');
    expect(accepted).toBe(0);
  });

  it('switches tabs on Ctrl+PageDown and Ctrl+PageUp from inside the scope', () => {
    press('PageDown', { ctrlKey: true });
    expect(active()).toBe('t2');
    press('PageUp', { ctrlKey: true });
    expect(active()).toBe('t1');
    expect(accepted).toBe(0);
  });

  it('keeps Ctrl+PageDown and Ctrl+PageUp out of the OneNote set, where they move between pages', () => {
    const next = commands.get('tabs.next' as CommandId)!;
    const previous = commands.get('tabs.previous' as CommandId)!;
    expect(setKeys(next, 'onenote')).toEqual(['Ctrl+Tab']);
    expect(setKeys(previous, 'onenote')).toEqual(['Ctrl+Shift+Tab']);
    expect(setKeys(next, 'default')).toEqual(['Ctrl+Tab', 'Ctrl+PageDown']);
    expect(setKeys(previous, 'default')).toEqual(['Ctrl+Shift+Tab', 'Ctrl+PageUp']);
  });
});
