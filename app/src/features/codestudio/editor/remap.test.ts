// @vitest-environment jsdom
// Remapping Accept and Next tab (DESIGN 5.3.1). Moving Accept to Alt+Enter gives Ctrl+Tab back to the page tabs and
// renames the chord in the Accept button and the announcement; moving Next tab away leaves Ctrl+Tab to Accept;
// Reset restores both. A third command on Ctrl+Tab conflicts with both.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../features';

// The palette loads on the first Ctrl press; a load that outlives the test file fails the teardown.
vi.mock('../../palette/open', async (original) => ({ ...(await original<object>()), preloadWhenIdle: () => () => {} }));
import { installDispatcher } from '../../../commands/dispatcher';
import { conflictsFor } from '../../../commands/keymap';
import { chord, defineCommand } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import { commands } from '../../../registries';
import type { NodeId, NodeSummary } from '../../../services/notes';
import { INITIAL_QOL, qolStore } from '../../../state/qol';
import { sessionStore } from '../../../state/session';
import { DEFAULT_SETTINGS, settingsStore } from '../../../state/settings';
import { announcements, clearAnnouncements } from '../../../ui/announce';
import { treeStore } from '../../tree';
import { configureTestCommands, ghostAt, mount, press, unmountAll } from './testEditor';

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
const active = () => qolStore.get().activeTab as string;

function shortcuts(map: Record<string, string[]>, suggestions: 'off' | 'automaticRules' = 'automaticRules'): void {
  settingsStore.set({
    settings: { ...DEFAULT_SETTINGS, shortcuts: map, code: { ...DEFAULT_SETTINGS.code, suggestions } },
    readOnly: false,
  });
}

let stop: () => void = () => {};
beforeAll(() => {
  configureTestCommands();
  stop = installDispatcher(window);
});
afterAll(() => stop());

beforeEach(() => {
  shortcuts({});
  clearAnnouncements();
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
});

afterEach(unmountAll);

describe('Accept moved to Alt+Enter', () => {
  it('accepts with Alt+Enter, gives Ctrl+Tab to the page tabs, and names Alt+Enter', async () => {
    shortcuts({ 'code.completion.accept': ['Alt+Enter'] });
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt()')]);
    expect(announcements()).toContain('Suggestion: nt(). Alt+Enter to accept.');
    const button = editor.root.querySelector<HTMLButtonElement>('.cm-ghost-accept');
    expect(button?.title).toBe('Accept suggestion (Alt+Enter)');
    press(editor, 'Tab', { ctrl: true });
    expect(active()).toBe('t2');
    expect(editor.getText()).toBe('pri');
    // Ctrl+Tab left focus in the editor; the ghost text still shows.
    press(editor, 'Enter', { alt: true });
    expect(editor.getText()).toBe('print()');
    expect(editor.root.querySelector('[id^="code-editor-description"]')?.textContent).toBe(
      'Tab indents. Alt+Enter accepts a suggestion. Escape, then Tab, leaves the editor.',
    );
  });

  it('updates the tooltip of a shown button when the chord changes', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt()')]);
    const button = editor.root.querySelector<HTMLButtonElement>('.cm-ghost-accept');
    expect(button?.title).toBe('Accept suggestion (Ctrl+Tab)');
    shortcuts({ 'code.completion.accept': ['Alt+Enter'] });
    expect(button?.title).toBe('Accept suggestion (Alt+Enter)');
  });
});

describe('Next tab moved to Ctrl+PageDown', () => {
  it('leaves Ctrl+Tab to Accept only', async () => {
    shortcuts({ 'tabs.next': ['Ctrl+PageDown'] }, 'off');
    const editor = await mount({ language: 'python', text: 'pri' });
    press(editor, 'Tab', { ctrl: true });
    expect(active()).toBe('t1');
    editor.showGhost([ghostAt(editor, 'nt()')]);
    press(editor, 'Tab', { ctrl: true });
    expect(editor.getText()).toBe('print()');
    expect(active()).toBe('t1');
  });
});

describe('Reset', () => {
  it('restores both', async () => {
    shortcuts({ 'code.completion.accept': ['Alt+Enter'], 'tabs.next': ['Ctrl+PageDown'] });
    shortcuts({}, 'off');
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt()')]);
    press(editor, 'Tab', { ctrl: true });
    expect(editor.getText()).toBe('print()');
    expect(active()).toBe('t1');
    press(editor, 'Tab', { ctrl: true });
    expect(active()).toBe('t2');
  });
});

describe('the conflict checker', () => {
  it('reports both Next tab and Accept for a third command on Ctrl+Tab', () => {
    const stopThird = commands.register(
      defineCommand({
        id: 'test.third' as CommandId,
        title: 'theme.commands.toggle',
        category: 'general',
        keys: [chord('Ctrl+Alt+F12')],
        run() {},
      }),
    );
    try {
      const ids = conflictsFor('test.third' as CommandId, chord('Ctrl+Tab')).map((def) => def.id);
      expect(ids).toContain('tabs.next');
      expect(ids).toContain('code.completion.accept');
    } finally {
      stopThird();
    }
  });
});
