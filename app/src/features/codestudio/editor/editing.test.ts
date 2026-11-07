// @vitest-environment jsdom
// Editing in the code editor (DESIGN 5.3). The expected texts are hand-worked from each language's documented
// comment syntax (Python '#', C++ '//' and '/* */', Ruby '#', Lua '--') and indentation (PEP 8: a block after ':'
// is indented one level).
import { SearchQuery, replaceAll, setSearchQuery } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerCodeEditorCommands } from './commands';
import { PROJECT_LANGUAGES } from '../contracts';
import { loadLanguage } from './languages';
import { getSettings, settingsStore } from '../../../state/settings';
import { setPseudoLocale, t } from '../../../strings/t';
import { configureTestCommands, mount, press, resetSettings, unmountAll, withCodeSettings } from './testEditor';

beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});

afterEach(() => {
  unmountAll();
  resetSettings();
});

const selected = (view: EditorView) => view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to));

describe('language-aware indent on Enter', () => {
  it("indents 4 spaces after 'if x:' in Python", async () => {
    const editor = await mount({ language: 'python', text: 'if x:' });
    press(editor, 'Enter');
    expect(editor.getText()).toBe('if x:\n    ');
  });

  it("indents the configured width after '{' in C", async () => {
    withCodeSettings({ indent: { c: { tabSize: 3, insertSpaces: true } } });
    const editor = await mount({ language: 'c', text: 'int main() {' });
    expect(editor.indent).toEqual({ size: 3, tabs: false });
    press(editor, 'Enter');
    expect(editor.getText()).toBe('int main() {\n   ');
  });
});

describe('comments', () => {
  it("toggles a line comment with '#' in Python and '//' in C++", async () => {
    const python = await mount({ language: 'python', text: 'x = 1' });
    press(python, '/', { ctrl: true });
    expect(python.getText()).toBe('# x = 1');
    press(python, '/', { ctrl: true });
    expect(python.getText()).toBe('x = 1');
    const cpp = await mount({ language: 'cpp', text: 'int x;' });
    press(cpp, '/', { ctrl: true });
    expect(cpp.getText()).toBe('// int x;');
  });

  it("toggles a block comment with '/* */' in C++ (Shift+Alt+A)", async () => {
    const cpp = await mount({ language: 'cpp', text: 'int x;' });
    cpp.view.dispatch({ selection: { anchor: 0, head: 6 } });
    press(cpp, 'a', { alt: true, shift: true });
    expect(cpp.getText()).toBe('/* int x; */');
  });

  it('uses the legacy modes’ comment syntax: Ruby # and Lua --', async () => {
    const ruby = await mount({ language: 'ruby', text: 'puts 1' });
    press(ruby, '/', { ctrl: true });
    expect(ruby.getText()).toBe('# puts 1');
    const lua = await mount({ language: 'lua', text: 'print(1)' });
    press(lua, '/', { ctrl: true });
    expect(lua.getText()).toBe('-- print(1)');
  });
});

describe('carets and selections', () => {
  it('selects the next occurrence with Ctrl+D', async () => {
    const editor = await mount({ language: 'python', text: 'foo = foo + 1', caret: 1 });
    press(editor, 'd', { ctrl: true });
    expect(selected(editor.view)).toEqual(['foo']);
    press(editor, 'd', { ctrl: true });
    expect(selected(editor.view)).toEqual(['foo', 'foo']);
    expect(editor.view.state.selection.ranges.map((r) => r.from)).toEqual([0, 6]);
  });

  it('adds a caret below with Ctrl+Alt+Down', async () => {
    const editor = await mount({ language: 'python', text: 'ab\ncd', caret: 1 });
    press(editor, 'ArrowDown', { ctrl: true, alt: true });
    expect(editor.view.state.selection.ranges.length).toBe(2);
  });

  it('expands to the enclosing syntax and shrinks back', async () => {
    const editor = await mount({ language: 'python', text: 'f(a, b)', caret: 2 });
    press(editor, 'ArrowRight', { alt: true, shift: true });
    const first = selected(editor.view)[0];
    press(editor, 'ArrowRight', { alt: true, shift: true });
    const second = selected(editor.view)[0];
    expect(second?.length).toBeGreaterThan(first?.length ?? 0);
    press(editor, 'ArrowLeft', { alt: true, shift: true });
    expect(selected(editor.view)[0]).toBe(first);
  });
});

describe('lines', () => {
  it('moves, copies, and deletes lines', async () => {
    const editor = await mount({ language: 'python', text: 'a\nb\nc', caret: 2 });
    press(editor, 'ArrowUp', { alt: true });
    expect(editor.getText()).toBe('b\na\nc');
    press(editor, 'ArrowDown', { alt: true, shift: true });
    expect(editor.getText()).toBe('b\nb\na\nc');
    press(editor, 'k', { ctrl: true, shift: true });
    expect(editor.getText()).toBe('b\na\nc');
  });
});

describe('search, go to line, wrap, zoom, read-only', () => {
  it('replaces with a regular expression', async () => {
    const editor = await mount({ language: 'python', text: 'x1 = y1\nx2 = y2' });
    press(editor, 'h', { ctrl: true });
    expect(editor.view.dom.querySelector('.cm-search')).not.toBeNull();
    editor.view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: 'x(\\d)', regexp: true, replace: 'z$1' })),
    });
    replaceAll(editor.view);
    expect(editor.getText()).toBe('z1 = y1\nz2 = y2');
  });

  it('opens find with Ctrl+F and go to line with Ctrl+G', async () => {
    const editor = await mount({ language: 'python', text: 'a\nb' });
    press(editor, 'f', { ctrl: true });
    expect(editor.view.dom.querySelector('.cm-search')).not.toBeNull();
    editor.view.focus();
    press(editor, 'g', { ctrl: true });
    expect(editor.view.dom.querySelector('.cm-gotoLine, form')).not.toBeNull();
  });

  it('toggles word wrap with Alt+Z and zooms the code with Ctrl+= and Ctrl+-', async () => {
    const editor = await mount({ language: 'python', text: 'a' });
    press(editor, 'z', { alt: true });
    expect(editor.view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    press(editor, 'z', { alt: true });
    expect(editor.view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
    press(editor, '=', { ctrl: true });
    expect(editor.zoom).toBeCloseTo(1.1);
    press(editor, '-', { ctrl: true });
    press(editor, '-', { ctrl: true });
    expect(editor.zoom).toBeCloseTo(0.9);
    expect(editor.root.style.getPropertyValue('--code-zoom')).toBe('0.9');
  });

  it('keeps a read-only editor unchanged', async () => {
    const editor = await mount({ language: 'python', text: 'a\nb', readOnly: true, caret: 0 });
    press(editor, 'k', { ctrl: true, shift: true });
    press(editor, '/', { ctrl: true });
    expect(editor.getText()).toBe('a\nb');
  });

  it('folds a block', async () => {
    const editor = await mount({ language: 'python', text: 'def f():\n    return 1\n', caret: 0 });
    expect(editor.view.dom.querySelector('.cm-foldGutter')).not.toBeNull();
  });
});

describe('CodeMirror’s own text comes from the strings files', () => {
  // Every phrase name the bundled CodeMirror packages ask for: search, go to line, folding, problems, completions.
  const NAMES = [
    'Find',
    'Replace',
    'next',
    'previous',
    'all',
    'match case',
    'regexp',
    'by word',
    'replace',
    'replace all',
    'close',
    'current match',
    'on line',
    'replaced $ matches',
    'replaced match on line $',
    'Go to line',
    'go',
    'Fold line',
    'Unfold line',
    'Folded lines',
    'Unfolded lines',
    'to',
    'folded code',
    'unfold',
    'Diagnostics',
    'No diagnostics',
    'Completions',
    'Control character',
    'Selection deleted',
  ];

  it('shows the pseudo-locale in the search panel and in every phrase', async () => {
    setPseudoLocale(true);
    try {
      const editor = await mount({ language: 'python', text: 'def f(x):\n    return x\n' });
      for (const name of NAMES) expect(editor.view.state.phrase(name), name).not.toBe(name);
      editor.run('find');
      const field = editor.view.dom.querySelector<HTMLInputElement>('.cm-search input[name="search"]');
      expect(field?.placeholder).toBe(t('codeStudio.editor.phrases.find'));
      const close = editor.view.dom.querySelector('.cm-search button[name="close"]');
      expect(close?.getAttribute('aria-label')).toBe(t('codeStudio.editor.phrases.close'));
    } finally {
      setPseudoLocale(false);
    }
  });
});

describe('settings changes', () => {
  it('does nothing when the store reports the same settings, and reacts to a real change', async () => {
    let transactions = 0;
    const editor = await mount({
      language: 'python',
      text: 'if x:\n  y = 1\n',
      extensions: [EditorView.updateListener.of((update) => (transactions += update.transactions.length))],
    });
    const before = transactions;
    settingsStore.set({ settings: getSettings(), readOnly: true });
    expect(transactions).toBe(before);
    withCodeSettings({ indent: { python: { tabSize: 4, insertSpaces: true } } });
    expect(transactions).toBe(before + 1);
    editor.view.dispatch({ selection: { anchor: 0 } });
    press(editor, 'Tab');
    expect(editor.getText()).toBe('    if x:\n  y = 1\n');
  });
});

describe('language chunks', () => {
  it('loads support for every project language', async () => {
    for (const language of PROJECT_LANGUAGES) await expect(loadLanguage(language)).resolves.toBeDefined();
  });
});
