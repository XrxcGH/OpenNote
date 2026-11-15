// @vitest-environment jsdom
// Completion in a real editor (DESIGN 10.2, 5.3). The Python for snippet from the list has fields. Enter and
// Shift+Enter move between them, while Tab indents and stays in the field. An explicit request inserts the leading
// list item. Expected texts are hand-worked from the snippet template and PEP 8's 4-space indent.
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  setSelectedCompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerCodeEditorCommands } from '../editor/commands';
import { configureTestCommands, mount, press, resetSettings, unmountAll } from '../editor/testEditor';
import type { CodeEditor } from '../editor';
import { attachCompletion, forgetPicks } from './index';

// The first mount loads the Python language chunk, which can take seconds on a busy machine.
beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});

afterEach(() => {
  unmountAll();
  resetSettings();
  forgetPicks();
});

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

const selected = (editor: CodeEditor): string => {
  const { from, to } = editor.view.state.selection.main;
  return editor.view.state.sliceDoc(from, to);
};

async function insertForSnippet(editor: CodeEditor): Promise<void> {
  startCompletion(editor.view);
  await until(() => completionStatus(editor.view.state) === 'active');
  const options = currentCompletions(editor.view.state);
  const index = options.findIndex((option) => option.label === 'for' && option.type === 'snippet');
  expect(index).toBeGreaterThanOrEqual(0);
  editor.view.dispatch({ effects: setSelectedCompletion(index) });
  // CodeMirror ignores an accept within its interaction delay (75 ms) after the list opens.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(acceptCompletion(editor.view)).toBe(true);
}

describe('snippet fields', () => {
  it('moves with Enter and Shift+Enter, and Tab indents without moving', async () => {
    const editor = await mount({ language: 'python', text: 'fo' });
    attachCompletion(editor);
    await insertForSnippet(editor);
    expect(editor.getText()).toBe('for item in items:\n    pass');
    expect(selected(editor)).toBe('item');

    press(editor, 'Enter');
    expect(selected(editor)).toBe('items');
    press(editor, 'Enter', { shift: true });
    expect(selected(editor)).toBe('item');

    press(editor, 'Tab');
    expect(editor.getText()).toBe('    for item in items:\n    pass');
    expect(selected(editor)).toBe('item');
    // Still in the same snippet: Enter goes on to the next field.
    press(editor, 'Enter');
    expect(selected(editor)).toBe('items');
    expect(editor.getText()).toBe('    for item in items:\n    pass');
  }, 20_000);
});

describe('explicit requests in the editor', () => {
  it('inserts the leading list item, and nothing on a blank line', async () => {
    const editor = await mount({ language: 'python', text: 'total = 0\nfor n in nums:\n    tot' });
    attachCompletion(editor);
    expect(await editor.requestSuggestion(true)).toBe(true);
    expect(editor.getText()).toBe('total = 0\nfor n in nums:\n    total');

    const empty = await mount({ language: 'python', text: '' });
    attachCompletion(empty);
    expect(await empty.requestSuggestion(true)).toBe(false);
    expect(empty.getText()).toBe('');
  }, 20_000);

  it('shows the import alias as ghost text', async () => {
    const editor = await mount({ language: 'python', text: 'import numpy as ' });
    attachCompletion(editor);
    expect(await editor.requestSuggestion(false)).toBe(true);
    expect(editor.acceptSuggestion('all')).toBe('np');
    expect(editor.getText()).toBe('import numpy as np');
  }, 20_000);
});
