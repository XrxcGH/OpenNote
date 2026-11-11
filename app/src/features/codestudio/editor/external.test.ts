// @vitest-environment jsdom
// Outside changes (DESIGN 12): page undo, sync, or another window replace the text as one minimal change that keeps
// the caret mapped and stays out of the undo history.
import { undo, undoDepth } from '@codemirror/commands';
import { afterEach, describe, expect, it } from 'vitest';
import { minimalChange } from './external';
import { mount, unmountAll } from './testEditor';

afterEach(unmountAll);

describe('minimalChange', () => {
  it('changes only the part between the common start and end', () => {
    expect(minimalChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' });
    expect(minimalChange('abc', 'abc')).toBeNull();
    expect(minimalChange('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' });
  });
});

describe('an external change', () => {
  it('keeps the caret mapped and does not enter undo history', async () => {
    const editor = await mount({ language: 'python', text: 'x = 1\ny = 2', caret: 9 });
    editor.view.dispatch({ changes: { from: 11, insert: '0' }, userEvent: 'input.type' });
    expect(undoDepth(editor.view.state)).toBe(1);
    // Someone else inserts a line at the top.
    editor.setText('# note\nx = 1\ny = 20');
    expect(editor.getText()).toBe('# note\nx = 1\ny = 20');
    expect(editor.view.state.selection.main.head).toBe(16);
    expect(undoDepth(editor.view.state)).toBe(1);
    // Undo takes back the person's own typing, not the outside change.
    undo(editor.view);
    expect(editor.getText()).toBe('# note\nx = 1\ny = 2');
  });
});
