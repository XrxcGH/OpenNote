// @vitest-environment jsdom
// Ctrl+Tab in a code editor (owner decision of 2026-11-01, DESIGN 5.3.1), with every feature registered, the app's
// dispatcher installed, two page tabs open, and qol.tabs on. The code editor's Accept refines Next tab: it accepts
// a suggestion, or asks for one, and the page tab stays; with suggestions Off and nothing showing, Next tab runs.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../features';

// The palette loads on the first Ctrl press; a load that outlives the test file fails the teardown.
vi.mock('../../palette/open', async (original) => ({ ...(await original<object>()), preloadWhenIdle: () => () => {} }));
import { installDispatcher } from '../../../commands/dispatcher';
import { commands } from '../../../registries';
import type { NodeId, NodeSummary } from '../../../services/notes';
import { INITIAL_QOL, qolStore } from '../../../state/qol';
import { sessionStore } from '../../../state/session';
import { treeStore } from '../../tree';
import type { CodeEditor } from './create';
import {
  configureTestCommands,
  ghostAt,
  mount,
  press,
  resetSettings,
  unmountAll,
  withCodeSettings,
} from './testEditor';

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
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function openTwoTabs(): void {
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
}

/** A source that answers `text` after `ms`, or nothing. */
const later =
  (ms: number, text: string | null) =>
  ({ pos }: { pos: number }) =>
    new Promise<{ from: number; text: string; origin: 'pattern'; confidence: number } | null>((resolve) =>
      setTimeout(() => resolve(text === null ? null : { from: pos, text, origin: 'pattern', confidence: 1 }), ms),
    );

beforeAll(configureTestCommands);

beforeEach(() => {
  resetSettings();
  openTwoTabs();
});

afterEach(() => {
  vi.restoreAllMocks();
  unmountAll();
});

/** Installs the app's dispatcher for the tests of one describe block. */
function withDispatcher(): void {
  let stop: () => void = () => {};
  beforeAll(() => {
    stop = installDispatcher(window);
  });
  afterAll(() => stop());
}

const acceptRuns = () => {
  const def = commands.get('code.completion.accept');
  if (!def) throw new Error('code.completion.accept is not registered');
  return vi.spyOn(def, 'run');
};

describe('with the dispatcher: accepting and asking', () => {
  withDispatcher();

  it('inserts a shown suggestion once and keeps the page tab', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    const runs = acceptRuns();
    editor.showGhost([ghostAt(editor, 'nt(total)')]);
    const event = press(editor, 'Tab', { ctrl: true });
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getText()).toBe('print(total)');
    expect(active()).toBe('t1');
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('asks for a suggestion when none shows, with a thinking indicator, then inserts it', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.setSuggestionSource(later(200, 'nt()'));
    press(editor, 'Tab', { ctrl: true });
    expect(editor.view.dom.querySelector('.cm-thinking')).not.toBeNull();
    expect(active()).toBe('t1');
    await wait(300);
    expect(editor.getText()).toBe('print()');
    expect(editor.view.dom.querySelector('.cm-thinking')).toBeNull();
  });

  it('changes nothing when the source finds nothing', async () => {
    const editor = await mount({ language: 'python', text: 'x = 1' });
    editor.setSuggestionSource(later(50, null));
    const before = editor.view.contentDOM.innerHTML;
    press(editor, 'Tab', { ctrl: true });
    await wait(150);
    expect(editor.getText()).toBe('x = 1');
    expect(active()).toBe('t1');
    expect(editor.view.dom.querySelector('.cm-thinking')).toBeNull();
    expect(editor.view.contentDOM.innerHTML).toBe(before);
  });

  it('inserts nothing when the person types during the wait', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.setSuggestionSource(later(200, 'nt()'));
    press(editor, 'Tab', { ctrl: true });
    await wait(50);
    editor.view.dispatch({ changes: { from: 3, insert: 'n' }, selection: { anchor: 4 }, userEvent: 'input.type' });
    await wait(300);
    expect(editor.getText()).toBe('prin');
  });
});

describe('with the dispatcher: the page tabs', () => {
  withDispatcher();

  it('switches the page tab when suggestions are Off and nothing shows', async () => {
    withCodeSettings({ suggestions: 'off' });
    const editor = await mount({ language: 'python', text: 'x' });
    press(editor, 'Tab', { ctrl: true });
    expect(active()).toBe('t2');
    expect(editor.getText()).toBe('x');
  });

  it('still accepts a shown suggestion with suggestions Off', async () => {
    withCodeSettings({ suggestions: 'off' });
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt()')]);
    press(editor, 'Tab', { ctrl: true });
    expect(editor.getText()).toBe('print()');
    expect(active()).toBe('t1');
  });

  it('goes to the previous page tab on Ctrl+Shift+Tab in every case', async () => {
    const cases: ((editor: CodeEditor) => void)[] = [
      (editor) => editor.showGhost([ghostAt(editor, 'nt()')]),
      () => {},
      () => withCodeSettings({ suggestions: 'off' }),
    ];
    for (const setUp of cases) {
      qolStore.set((state) => ({ ...state, activeTab: 't2' as never }));
      const editor = await mount({ language: 'python', text: 'pri' });
      setUp(editor);
      press(editor, 'Tab', { ctrl: true, shift: true });
      expect(active()).toBe('t1');
      expect(editor.getText()).toBe('pri');
      unmountAll();
      resetSettings();
    }
  });

  it('switches page tabs again after Escape, then Tab, leaves the editor', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    const outside = document.createElement('button');
    document.body.append(outside);
    press(editor, 'Escape');
    expect(press(editor, 'Tab').defaultPrevented).toBe(false);
    // The browser moves focus on an unprevented Tab; jsdom does not, so the test does.
    outside.focus();
    outside.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(active()).toBe('t2');
    expect(editor.getText()).toBe('pri');
  });

  it('keeps Ctrl+Tab from the editor’s parent', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt()')]);
    const heard = vi.fn();
    editor.root.parentElement?.addEventListener('keydown', heard);
    press(editor, 'Tab', { ctrl: true });
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('without the dispatcher', () => {
  it('runs the command once from the CodeMirror keymap and stops the key', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    const def = commands.get('code.completion.accept');
    if (!def) throw new Error('code.completion.accept is not registered');
    const runs = vi.spyOn(def, 'run');
    editor.showGhost([ghostAt(editor, 'nt()')]);
    const heard = vi.fn();
    editor.root.parentElement?.addEventListener('keydown', heard);
    const event = press(editor, 'Tab', { ctrl: true });
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getText()).toBe('print()');
    expect(runs).toHaveBeenCalledTimes(1);
    expect(heard).not.toHaveBeenCalled();
    expect(active()).toBe('t1');
  });
});
