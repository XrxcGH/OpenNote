// @vitest-environment jsdom
// Tab and Shift+Tab (owner decision of 2026-11-01, DESIGN 5.3.1): Tab indents in every state and never accepts a
// suggestion; Escape then Tab, Ctrl+M, or a read-only editor let Tab move focus. Expected texts are hand-worked from
// the indent rules: PEP 8's 4 spaces for Python, 2 for JavaScript, gofmt's and make's tab character.
import { completionStatus, snippet, startCompletion } from '@codemirror/autocomplete';
import { EditorSelection } from '@codemirror/state';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerCodeEditorCommands } from './commands';
import {
  configureTestCommands,
  ghostAt,
  mount,
  press,
  resetSettings,
  unmountAll,
  withCodeSettings,
} from './testEditor';
import { setTabMovesFocus } from './views';

beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});

afterEach(() => {
  unmountAll();
  resetSettings();
  setTabMovesFocus(false);
});

const text = (editor: { getText(): string }) => editor.getText();
const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('Tab indents in every state', () => {
  it('indents an empty caret to the next stop with no suggestion', async () => {
    const editor = await mount({ language: 'python', text: 'x', caret: 0 });
    const event = press(editor, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(text(editor)).toBe('    x');
    // A caret at column 2 goes to the next stop, column 4.
    const mid = await mount({ language: 'python', text: 'ab' });
    press(mid, 'Tab');
    expect(text(mid)).toBe('ab  ');
  });

  it('indents with ghost text shown, and the suggestion never enters the document', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt(total)')]);
    expect(editor.hasGhost()).toBe(true);
    press(editor, 'Tab');
    expect(text(editor)).toBe('pri ');
    expect(text(editor)).not.toContain('nt(total)');
    expect(editor.hasGhost()).toBe(false);
  });

  it('indents with the completion list open: the list closes and nothing comes from it', async () => {
    const editor = await mount({ language: 'python', text: 'to' });
    editor.setCompletionSources([
      { id: 'scope', prior: 1, complete: () => [{ label: 'total', kind: 'variable', source: 'scope', score: 1 }] },
    ]);
    startCompletion(editor.view);
    await until(() => completionStatus(editor.view.state) === 'active');
    expect(completionStatus(editor.view.state)).toBe('active');
    press(editor, 'Tab');
    expect(completionStatus(editor.view.state)).toBeNull();
    expect(text(editor)).toBe('to  ');
    expect(text(editor)).not.toContain('total');
  });

  it('indents inside a snippet instead of moving between fields', async () => {
    const editor = await mount({ language: 'python', text: '' });
    snippet('for ${1:item} in ${2:items}:')(editor.view, { label: 'for' }, 0, 0);
    expect(text(editor)).toBe('for item in items:');
    const { from, to } = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(from, to)).toBe('item');
    press(editor, 'Tab');
    // The selected field's line is indented; the field keeps its text.
    expect(text(editor)).toBe('    for item in items:');
  });

  it('indents every touched line of a selection and never replaces the text', async () => {
    const editor = await mount({ language: 'python', text: 'abc def' });
    editor.view.dispatch({ selection: { anchor: 4, head: 7 } });
    press(editor, 'Tab');
    expect(text(editor)).toBe('    abc def');
    const { from, to } = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(from, to)).toBe('def');

    editor.view.dispatch({ selection: { anchor: 0, head: editor.view.state.doc.length } });
    editor.setText('a\nb\nc');
    editor.view.dispatch({ selection: { anchor: 0, head: 3 } });
    press(editor, 'Tab');
    expect(text(editor)).toBe('    a\n    b\nc');
  });

  it('handles every caret', async () => {
    const editor = await mount({ language: 'javascript', text: ['a', 'b'].join('\n') });
    editor.view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]) });
    press(editor, 'Tab');
    expect(text(editor)).toBe(['  a', '  b'].join('\n'));
  });
});

describe('Shift+Tab outdents', () => {
  it('removes one unit of leading whitespace per touched line, and nothing else', async () => {
    withCodeSettings({ indent: { python: { tabSize: 4, insertSpaces: true } } });
    const editor = await mount({ language: 'python', text: '        x\n  y\nz\n\tw' });
    editor.view.dispatch({ selection: { anchor: 0, head: editor.view.state.doc.length } });
    press(editor, 'Tab', { shift: true });
    expect(text(editor)).toBe('    x\ny\nz\nw');
    press(editor, 'Tab', { shift: true });
    press(editor, 'Tab', { shift: true });
    expect(text(editor)).toBe('x\ny\nz\nw');
  });
});

describe('indent units', () => {
  it('gives Python 4 spaces and JavaScript 2', async () => {
    const python = await mount({ language: 'python', text: '' });
    press(python, 'Tab');
    expect(text(python)).toBe('    ');
    const js = await mount({ language: 'javascript', text: '' });
    press(js, 'Tab');
    expect(text(js)).toBe('  ');
  });

  it('gives Go and Makefiles a tab character even with the spaces setting on', async () => {
    withCodeSettings({
      indent: { go: { tabSize: 4, insertSpaces: true }, makefile: { tabSize: 4, insertSpaces: true } },
    });
    const go = await mount({ language: 'go', text: '' });
    press(go, 'Tab');
    expect(text(go)).toBe('\t');
    const make = await mount({ language: 'makefile', text: 'all:\n', caret: 5 });
    press(make, 'Tab');
    expect(text(make)).toBe('all:\n\t');
  });

  it('keeps the indentation a file already uses unless the setting forces one', async () => {
    const detected = await mount({ language: 'python', text: 'if x:\n  y = 1\n', caret: 0 });
    press(detected, 'Tab');
    expect(text(detected)).toBe('  if x:\n  y = 1\n');
    withCodeSettings({ indent: { python: { tabSize: 4, insertSpaces: true } } });
    const forced = await mount({ language: 'python', text: 'if x:\n  y = 1\n', caret: 0 });
    press(forced, 'Tab');
    expect(text(forced)).toBe('    if x:\n  y = 1\n');
  });
});

describe('leaving the editor', () => {
  it('lets Tab move focus after Escape', async () => {
    const editor = await mount({ language: 'python', text: 'x' });
    press(editor, 'Escape');
    const tab = press(editor, 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(text(editor)).toBe('x');
  });

  it('leaves with Escape, Escape, Tab while ghost text shows', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt()')]);
    press(editor, 'Escape');
    expect(editor.hasGhost()).toBe(false);
    press(editor, 'Escape');
    expect(press(editor, 'Tab').defaultPrevented).toBe(false);
    expect(text(editor)).toBe('pri');
  });

  it('disarms on any other key', async () => {
    const editor = await mount({ language: 'python', text: '' });
    press(editor, 'Escape');
    press(editor, 'a');
    expect(press(editor, 'Tab').defaultPrevented).toBe(true);
  });

  it('makes Tab move focus after Ctrl+M, and indent again after a second Ctrl+M', async () => {
    const editor = await mount({ language: 'python', text: 'x', caret: 0 });
    press(editor, 'm', { ctrl: true });
    expect(press(editor, 'Tab').defaultPrevented).toBe(false);
    expect(press(editor, 'Tab', { shift: true }).defaultPrevented).toBe(false);
    expect(text(editor)).toBe('x');
    press(editor, 'm', { ctrl: true });
    press(editor, 'Tab');
    expect(text(editor)).toBe('    x');
  });

  it('lets Tab move focus in a read-only editor', async () => {
    const editor = await mount({ language: 'python', text: 'x', readOnly: true, caret: 0 });
    expect(press(editor, 'Tab').defaultPrevented).toBe(false);
    expect(text(editor)).toBe('x');
  });
});
