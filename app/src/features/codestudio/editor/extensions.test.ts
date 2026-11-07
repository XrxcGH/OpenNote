// @vitest-environment jsdom
// The extension points the later code lanes use: problems with F8 and its read-out, breakpoints and the current
// line, inline values, the diff view, ghost text alternatives and partial accepts, and the completion list host.
import { completionStatus, startCompletion } from '@codemirror/autocomplete';
import { diagnosticCount } from '@codemirror/lint';
import { undo } from '@codemirror/commands';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { announcements, clearAnnouncements } from '../../../ui/announce';
import { registerCodeEditorCommands } from './commands';
import { createDiffView, diffLines } from './diff';
import { nextLine, nextWord } from './ghost';
import { configureTestCommands, ghostAt, mount, press, unmountAll } from './testEditor';

beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});
beforeEach(clearAnnouncements);
afterEach(unmountAll);

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('problems', () => {
  it('shows problems, moves to the next with F8, and reads it out', async () => {
    const editor = await mount({ language: 'python', text: 'x = 1\nprint(totl)\n', caret: 0 });
    editor.showProblems([
      {
        file: 'main.py',
        from: 12,
        to: 16,
        severity: 'error',
        code: 'F821',
        message: "Undefined name 'totl'",
        source: 'pyflakes',
      },
    ]);
    expect(diagnosticCount(editor.view.state)).toBe(1);
    press(editor, 'F8');
    expect(editor.view.state.selection.main.from).toBe(12);
    expect(announcements()).toContain("Line 2: Undefined name 'totl' (F821)");
  });
});

describe('debugger marks', () => {
  it('draws breakpoints, the current line, and inline values', async () => {
    const editor = await mount({ language: 'python', text: 'a = 1\nb = 2\nc = 3' });
    editor.setBreakpoints([1, 3]);
    editor.setCurrentLine(2);
    editor.setInlineValues([{ line: 1, text: 'a = 1' }]);
    expect(editor.view.dom.querySelectorAll('.cm-breakpoint').length).toBe(2);
    expect(editor.view.dom.querySelector('.cm-current-line-arrow')).not.toBeNull();
    expect(editor.view.dom.querySelector('.cm-current-line')?.textContent).toBe('b = 2');
    expect(editor.view.dom.querySelector('.cm-inline-value')?.textContent).toBe('a = 1');
    editor.setCurrentLine(null);
    expect(editor.view.dom.querySelector('.cm-current-line')).toBeNull();
  });
});

describe('the diff view', () => {
  it('diffs lines by their longest common subsequence', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'deleted', text: 'b' },
      { kind: 'inserted', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('shows the two sides, or one inline view, read-only', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const labels = { original: 'Before', modified: 'After' };
    const side = createDiffView(host, { original: 'a\nb', modified: 'a\nc', mode: 'sideBySide', labels });
    expect(side.views.length).toBe(2);
    expect(host.querySelector('.cm-diff-deleted')?.textContent).toBe('b');
    expect(host.querySelector('.cm-diff-inserted')?.textContent).toBe('c');
    expect(side.views[0]?.state.readOnly).toBe(true);
    side.destroy();
    const inline = createDiffView(host, { original: 'a\nb', modified: 'a\nc', mode: 'inline', labels });
    expect(inline.views.length).toBe(1);
    expect(host.querySelector('.cm-diff-deleted-block')?.textContent).toBe('b');
    inline.destroy();
  });
});

describe('ghost text', () => {
  it('accepts a word with Ctrl+Right, keeping the rest, and moves by word without ghost text', async () => {
    expect(nextWord(' total + 1')).toBe(' total');
    expect(nextWord('(x)')).toBe('(');
    expect(nextLine('a)\n  b')).toBe('a)');
    const editor = await mount({ language: 'python', text: 'print' });
    editor.showGhost([ghostAt(editor, '(total, x)')]);
    press(editor, 'ArrowRight', { ctrl: true });
    expect(editor.getText()).toBe('print(');
    expect(editor.hasGhost()).toBe(true);
    press(editor, 'ArrowRight', { ctrl: true });
    expect(editor.getText()).toBe('print(total');
    editor.run('completion.acceptLine');
    expect(editor.getText()).toBe('print(total, x)');
    expect(editor.hasGhost()).toBe(false);
  });

  it('inserts an accepted suggestion as one undo step', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.showGhost([ghostAt(editor, 'nt(total)')]);
    press(editor, 'Tab', { ctrl: true });
    expect(editor.getText()).toBe('print(total)');
    undo(editor.view);
    expect(editor.getText()).toBe('pri');
  });

  it('moves between alternatives with Alt+] and Alt+[', async () => {
    const editor = await mount({ language: 'python', text: 'x = ' });
    editor.showGhost([ghostAt(editor, '1'), ghostAt(editor, '2')]);
    press(editor, ']', { alt: true });
    expect(editor.root.querySelector('.cm-ghost-text')?.textContent).toBe('2');
    press(editor, '[', { alt: true });
    expect(editor.root.querySelector('.cm-ghost-text')?.textContent).toBe('1');
  });

  it('hides the ghost text on a caret move, and Escape dismisses it', async () => {
    const editor = await mount({ language: 'python', text: 'ab', caret: 2 });
    editor.showGhost([ghostAt(editor, 'c')]);
    editor.view.dispatch({ selection: { anchor: 1 } });
    expect(editor.hasGhost()).toBe(false);
    editor.showGhost([ghostAt(editor, 'c')]);
    press(editor, 'Escape');
    expect(editor.hasGhost()).toBe(false);
  });

  it('shows automatic suggestions after a typing pause', async () => {
    const editor = await mount({ language: 'python', text: 'pri' });
    editor.setSuggestionSource(({ pos, text }) =>
      text.endsWith('prin') ? { from: pos, text: 't()', origin: 'pattern', confidence: 0.9 } : null,
    );
    editor.view.dispatch({ changes: { from: 3, insert: 'n' }, selection: { anchor: 4 }, userEvent: 'input.type' });
    await until(() => editor.hasGhost());
    expect(editor.root.querySelector('.cm-ghost-text')?.textContent).toBe('t()');
  });
});

describe('the completion list host', () => {
  it('lists the sources’ items in score order and accepts with Ctrl+Tab', async () => {
    const editor = await mount({ language: 'python', text: 'to' });
    editor.setCompletionSources([
      {
        id: 'scope',
        prior: 1,
        complete: () => [
          { label: 'tomato', kind: 'variable', source: 'scope', score: 0.2 },
          { label: 'total', kind: 'variable', source: 'scope', score: 0.9 },
        ],
      },
    ]);
    startCompletion(editor.view);
    await until(() => completionStatus(editor.view.state) === 'active');
    const labels = [...editor.view.dom.querySelectorAll('.cm-completionLabel')].map((node) => node.textContent);
    expect(labels).toEqual(['total', 'tomato']);
    // CodeMirror ignores an accept in the first 75 ms after the list opens.
    await new Promise((resolve) => setTimeout(resolve, 100));
    press(editor, 'Tab', { ctrl: true });
    expect(editor.getText()).toBe('total');
  });
});
